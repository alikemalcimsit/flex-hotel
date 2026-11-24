import { randomUUID } from 'node:crypto';
import { runWithContext } from '@hotelos/core';
import { startRecurringJobs } from '../../lib/recurring.js';
import { SQL_NOW, sqlTimestamp } from '../../lib/sql-time.js';
import { sendSpaNotification } from './notify.js';
import { SPA_SYSTEM_ACTOR, loadSpaSettings, prisma } from './shared.js';

/**
 * Spa'nın zamanlanmış işi (yalnızca sunucu sürecinde, modül 57).
 *
 * | İş                     | Sıklık | Neden |
 * |------------------------|--------|-------|
 * | Randevu hatırlatması   | 5 dk   | Randevudan ayardaki saat kadar önce (varsayılan 2 saat) misafire hatırlatma |
 *
 * Hatırlatma yalnız konaklamaya bağlı açık randevuya gider. Randevu hatırlatma süresinden daha kısa süre önce
 * alındıysa (onay bildirimi az önce gitti) hatırlatma gönderilmez. Her randevu önce **sahiplenilir**
 * (`reminderSentAt` koşullu yazılır): iki süreç aynı anda çalışsa da tek hatırlatma gider. Sahiplenme randevunun
 * sürümünü (`updatedAt`) ilerletmez — ekranı açık personelin işlemi "bayat" sayılmasın.
 */
const REMINDER_INTERVAL_MS = 5 * 60_000;
const BATCH = 200;
const BUDGET_MS = 30_000;
/** Ayarın üst sınırı (saat): taranacak en uzak randevu. */
const MAX_REMINDER_HOURS = 72;
const HOUR_MS = 3_600_000;

/**
 * Bir otelin vadesi gelen hatırlatmaları.
 * @param {string} hotelId @param {{ now?: Date, budgetMs?: number, logger?: any }} [options]
 * @returns {Promise<number>} kuyruğa yazılan hatırlatma
 */
export async function sendDueSpaReminders(hotelId, { now = new Date(), budgetMs = BUDGET_MS, logger = console } = {}) {
  const settings = await loadSpaSettings(prisma, hotelId);
  if (!settings.reminderHours) return 0;
  const deadline = Date.now() + budgetMs;
  const lead = settings.reminderHours * HOUR_MS;
  const rows = await prisma.spaAppointment.findMany({
    where: { hotelId, status: 'BOOKED', reminderSentAt: null, reservationId: { not: null }, startsAt: { gt: now, lte: new Date(now.getTime() + lead) } },
    select: { id: true, startsAt: true, createdAt: true },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    take: BATCH,
  });
  let sent = 0;
  for (const row of rows) {
    if (Date.now() > deadline) break;
    const claimed = await prisma.$executeRaw`
      UPDATE "SpaAppointment" SET "reminderSentAt" = ${sqlTimestamp(now)}
      WHERE "id" = ${row.id} AND "hotelId" = ${hotelId} AND "status" = 'BOOKED' AND "reminderSentAt" IS NULL`;
    if (!claimed) continue;
    // Randevu zaten hatırlatma süresinin içinde alındı: onay az önce gitti, ikinci ileti gürültü olur.
    if (row.startsAt.getTime() - row.createdAt.getTime() <= lead) continue;
    if (await sendSpaNotification(hotelId, row.id, 'SPA_REMINDER', logger)) sent += 1;
  }
  return sent;
}

/**
 * Bütün otellerin hatırlatmaları. Yalnız yaklaşan, hatırlatılmamış randevusu olan oteller taranır (kısmi indeks).
 * Bir otelin hatası diğerlerini durdurmaz.
 * @param {{ error?: Function }} [logger]
 */
export async function runSpaReminderJob(logger = console) {
  const hotels = /** @type {Array<{ hotelId: string }>} */ (
    await prisma.$queryRaw`
      SELECT DISTINCT "hotelId" FROM "SpaAppointment"
      WHERE "status" = 'BOOKED' AND "reminderSentAt" IS NULL AND "reservationId" IS NOT NULL
        AND "startsAt" > ${SQL_NOW} AND "startsAt" <= ${SQL_NOW} + make_interval(hours => ${MAX_REMINDER_HOURS}::int)`
  );
  let total = 0;
  for (const { hotelId } of hotels) {
    try {
      total += await runWithContext({ correlationId: randomUUID(), actor: SPA_SYSTEM_ACTOR }, () => sendDueSpaReminders(hotelId, { logger }));
    } catch (error) {
      logger.error?.({ err: error, hotelId }, 'Spa hatırlatmaları gönderilemedi');
    }
  }
  return total;
}

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startSpaJobs(logger) {
  return startRecurringJobs(logger, [
    {
      name: 'spa-reminders',
      intervalMs: REMINDER_INTERVAL_MS,
      run: async () => {
        const sent = await runSpaReminderJob(logger);
        if (sent > 0) logger.info({ sent }, 'Spa randevu hatırlatmaları sıraya alındı');
      },
    },
  ]);
}
