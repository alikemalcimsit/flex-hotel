import { randomUUID } from 'node:crypto';
import { runWithContext } from '@hotelos/core';
import { startRecurringJobs } from '../../lib/recurring.js';
import { writeWithEvents } from '../../lib/write.js';
import { alertOwner, overdueInstallments, releaseOption } from './events.js';
import { dateOnly, day, hotelContext, money, prisma } from './shared.js';

/**
 * Banketin zamanlanmış işi (modül 37, yalnızca sunucu sürecinde). Her tur, açık
 * etkinliği olan oteller sırayla; bir otelin hatası diğerlerini durdurmaz.
 *
 * | Ne                         | Ne yapar |
 * |----------------------------|----------|
 * | Opsiyon süresi doldu       | Son günü (otelin iş günüyle) geçen opsiyon düşer: salon bırakılır, dosya talebe döner; sorumluya ve sırası yükselenlere haber |
 * | Opsiyonun son günü         | Sorumluya "bugün kesinleştirin ya da uzatın" (günde bir) |
 * | Gecikmiş taksit            | Vadesi geçip ödenmemiş tutar: sorumluya (günde bir) |
 * | Kapatılmamış etkinlik      | Son oturumu bitmiş kesin etkinlik: "gerçekleşen kişiyi girip kapatın" (bir kez) |
 *
 * Hatırlatmalar `dedupeKey` ile **bir kez** yazılır (her tur yeniden "okunmadı"
 * yapmasın diye var olan anahtar atlanır).
 */

export const SYSTEM_ACTOR = 'system';
const SWEEP_INTERVAL_MS = 15 * 60_000;
/** Bir turda bir otelde işlenen en fazla etkinlik (fazlası sonraki tura kalır). */
const BATCH = 200;
/** Son oturum bittikten bu kadar sonra "kapatın" hatırlatması. */
const COMPLETE_REMINDER_HOURS = 12;
const HOUR_MS = 3_600_000;

/**
 * Anahtarı yoksa uyarı yazar (varsa hiç dokunmaz).
 * @param {{ hotelId: string, event: any, title: string, body: string, severity?: string, dedupeKey: string }} input
 * @returns {Promise<boolean>} yazıldı mı
 */
async function alertOnce(input) {
  const exists = await prisma.staffAlert.findFirst({ where: { hotelId: input.hotelId, dedupeKey: input.dedupeKey }, select: { id: true } });
  if (exists) return false;
  await writeWithEvents((tx, stage) => alertOwner(tx, stage, input));
  return true;
}

/**
 * Bir otelin turu.
 * @param {string} hotelId
 * @param {{ warn: Function }} logger
 */
export async function sweepHotel(hotelId, logger) {
  const { today } = await hotelContext(hotelId);
  const result = { expired: 0, lastDay: 0, overdue: 0, toComplete: 0 };

  const expired = await prisma.event.findMany({
    where: { hotelId, status: 'TENTATIVE', optionUntil: { lt: dateOnly(today) } },
    orderBy: [{ optionUntil: 'asc' }, { id: 'asc' }],
    take: BATCH,
    select: { id: true },
  });
  for (const { id } of expired) {
    try {
      const outcome = await releaseOption(hotelId, id, { expectedUpdatedAt: null, reason: `Opsiyon süresi doldu (iş günü ${today})` }, { expiredBefore: today });
      if (!outcome.skipped) result.expired += 1;
    } catch (error) {
      logger.warn({ err: error, hotelId, eventId: id }, 'Opsiyonu dolan etkinlik bırakılamadı');
    }
  }

  const lastDay = await prisma.event.findMany({
    where: { hotelId, status: 'TENTATIVE', optionUntil: dateOnly(today) },
    orderBy: { id: 'asc' },
    take: BATCH,
    select: { id: true, code: true, name: true, ownerEmail: true },
  });
  for (const event of lastDay) {
    const sent = await alertOnce({
      hotelId,
      event,
      severity: 'WARNING',
      title: `Opsiyonun son günü: ${event.name}`,
      body: `${event.code}: opsiyon bugün bitiyor. Kesinleştirin, uzatın ya da bırakın; aksi hâlde salon yarın boşa çıkar.`,
      dedupeKey: `banquet-option-last-day:${event.id}:${today}`,
    });
    if (sent) result.lastDay += 1;
  }

  const overdue = await overdueInstallments(prisma, hotelId, today, BATCH);
  if (overdue.length) {
    const events = await prisma.event.findMany({ where: { hotelId, id: { in: overdue.map((row) => row.eventId) } }, select: { id: true, code: true, name: true, ownerEmail: true, currency: true } });
    const byId = new Map(events.map((event) => [event.id, event]));
    for (const row of overdue) {
      const event = byId.get(row.eventId);
      if (!event) continue;
      const sent = await alertOnce({
        hotelId,
        event,
        severity: 'WARNING',
        title: `Gecikmiş ödeme: ${event.name}`,
        body: `${event.code}: vadesi geçmiş ${money(row.overdue)} ${event.currency} ödenmedi (en eski vade ${row.oldestDue}). Müşteriyle görüşün.`,
        dedupeKey: `banquet-overdue:${event.id}:${today}`,
      });
      if (sent) result.overdue += 1;
    }
  }

  const ended = await prisma.event.findMany({
    where: { hotelId, status: 'DEFINITE', lastEndAt: { lt: new Date(Date.now() - COMPLETE_REMINDER_HOURS * HOUR_MS) } },
    orderBy: [{ lastEndAt: 'asc' }, { id: 'asc' }],
    take: BATCH,
    select: { id: true, code: true, name: true, ownerEmail: true, lastEndAt: true },
  });
  for (const event of ended) {
    const sent = await alertOnce({
      hotelId,
      event,
      title: `Etkinliği kapatın: ${event.name}`,
      body: `${event.code} ${day(event.lastEndAt)} tarihinde bitti. Gerçekleşen kişi sayısını girip "gerçekleşti" yapın; proforma ve faturaya geçilir.`,
      dedupeKey: `banquet-complete:${event.id}`,
    });
    if (sent) result.toComplete += 1;
  }
  return result;
}

/**
 * Bir tur: etkinlik kaydı olan oteller (otel tablosu küçük; etkinliklerden "distinct"
 * çekmek yıllar içinde büyüyen tabloyu tarardı).
 * @param {{ info: Function, warn: Function }} logger
 */
export async function runBanquetSweep(logger) {
  const hotels = await prisma.$queryRaw`
    SELECT h."id" AS "hotelId" FROM "Hotel" h
    WHERE EXISTS (SELECT 1 FROM "Event" e WHERE e."hotelId" = h."id")
    ORDER BY h."id"`;
  for (const { hotelId } of /** @type {Array<{ hotelId: string }>} */ (hotels)) {
    try {
      await runWithContext({ correlationId: randomUUID(), actor: SYSTEM_ACTOR }, async () => {
        const result = await sweepHotel(hotelId, logger);
        if (Object.values(result).some(Boolean)) logger.info({ hotelId, ...result }, 'Banket turu');
      });
    } catch (error) {
      logger.warn({ err: error, hotelId }, 'Banket turu bu otelde tamamlanamadı');
    }
  }
  return hotels.length;
}

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startBanquetJobs(logger) {
  return startRecurringJobs(logger, [{ name: 'banquet-sweep', intervalMs: SWEEP_INTERVAL_MS, run: () => runBanquetSweep(logger) }]);
}
