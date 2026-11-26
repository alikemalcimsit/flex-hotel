import { KBS_KIND_LABELS, KBS_LATE_AFTER_MS, kbsMissingFields, kbsMissingText, kbsRetryAt } from '@hotelos/hotel-contracts';
import { toIsoDay } from '@hotelos/core';
import { prismaUnfiltered } from '../../db.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { startRecurringJobs } from '../../lib/recurring.js';
import { openSecret } from '../../lib/secret-box.js';
import { SQL_NOW, sqlTimestamp } from '../../lib/sql-time.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { KbsProviderError, kbsProviderFor } from './providers/index.js';
import { onKbsEnqueued } from './queue.js';
import { KBS_PERSON_SELECT, loadKbsSettings, prisma } from './shared.js';

/**
 * KBS göndericisi (modül 58).
 *
 * - **Üstlenme:** sırası gelen bekleyen bildirimler tek SQL ile "gönderiliyor"a alınır (`FOR UPDATE SKIP LOCKED`); bağlı olduğu
 *   bildirim (girişi) bildirilmemişse beklenir. KBS'si kapalı otelin bildirimi üstlenilmez (ayar açılınca gider).
 * - **Kimlik gönderim anında** kartın güncel halinden kurulur: personel eksik alanı tamamlayıp "tekrar gönder" der.
 * - **Sonuç:** kabul → "bildirildi" (referans); geçici hata → artan aralıkla yeniden, hak bitince "gönderilemedi" + zil; kalıcı hata
 *   → "gönderilemedi" + zil. Bağlı olduğu bildirim iptal edildiyse iptal.
 * - **Takılı kalan:** süreç gönderirken kapanırsa 5 dakika sonra sıraya geri.
 * - **Gecikme:** 2 saattir bildirilemeyen giriş için zil (bir kez).
 */

/** Tek tek üstlenilir: gönderim uzun sürse de üstlenilip bekleyen satır takılı sayılıp ikinci kez gönderilmez. */
const BATCH = 1;
const MAX_ROUNDS = 200;
export const KBS_STALE_SENDING_MS = 5 * 60_000;
const KICK_DEBOUNCE_MS = 150;

/** @param {number} limit */
export function claimDueKbs(limit = BATCH) {
  return prismaUnfiltered.$queryRaw`
    UPDATE "KbsNotification" n
    SET "state" = 'SENDING', "lockedAt" = ${SQL_NOW}, "attempts" = n."attempts" + 1, "updatedAt" = ${SQL_NOW}
    WHERE n."id" IN (
      SELECT k."id" FROM "KbsNotification" k
      JOIN "KbsSettings" s ON s."hotelId" = k."hotelId" AND s."isEnabled"
      LEFT JOIN "KbsNotification" d ON d."id" = k."dependsOnId"
      WHERE k."state" = 'PENDING' AND k."nextAttemptAt" <= ${SQL_NOW}
        AND (k."dependsOnId" IS NULL OR d."state" IN ('SENT', 'MANUAL'))
      ORDER BY k."createdAt"
      LIMIT ${limit}
      FOR UPDATE OF k SKIP LOCKED
    )
    RETURNING n.*`;
}

/**
 * Sonucu yaz — bildirim hâlâ "gönderiliyor"daysa.
 * @param {any} row @param {any} data @param {{ ok: boolean, code: string | null, message: string | null }} log @param {{ title: string, body: string } | null} [alert]
 */
async function finish(row, data, log, alert = null) {
  await writeWithEvents(async (tx, stage) => {
    const { count } = await tx.kbsNotification.updateMany({ where: { id: row.id, state: 'SENDING' }, data: { ...data, lockedAt: null } });
    if (count === 0) return;
    await tx.kbsLog.create({ data: { hotelId: row.hotelId, notificationId: row.id, ...log, message: log.message?.slice(0, 500) ?? null, actor: 'system' } });
    await stage('kbs.notification.changed', { hotelId: row.hotelId, notificationId: row.id, reservationId: row.reservationId, kind: row.kind, state: data.state });
    if (alert) {
      await raiseStaffAlert(tx, stage, {
        hotelId: row.hotelId,
        kind: 'KBS',
        severity: 'WARNING',
        title: alert.title.slice(0, 200),
        body: alert.body,
        link: `/kbs/bildirimler/${row.id}`,
        permission: PERMISSIONS.KBS_SEND,
        entityType: 'KbsNotification',
        entityId: row.id,
        dedupeKey: `kbs:${row.id}:failed`,
      });
    }
  });
}

/** Girişin KBS referansı (çıkış / oda değişikliği için). @param {any} row */
async function checkInRefOf(row) {
  if (row.kind === 'CHECK_IN') return null;
  const checkIn = await prisma.kbsNotification.findFirst({
    where: { hotelId: row.hotelId, reservationId: row.reservationId, guestId: row.guestId, kind: 'CHECK_IN', state: { not: 'CANCELLED' }, createdAt: { lte: row.createdAt } },
    orderBy: { createdAt: 'desc' },
    select: { providerRef: true, resolvedNote: true, state: true },
  });
  return checkIn?.providerRef ?? (checkIn?.state === 'MANUAL' ? 'ELLE' : null);
}

/** @param {any} settings */
function passwordOf(settings) {
  if (!settings.passwordSealed) return null;
  try {
    return openSecret(settings.passwordSealed);
  } catch {
    throw new KbsProviderError('KBS parolası çözülemedi (sunucu anahtarı değişmiş olabilir); ayarlardan parolayı yeniden girin', { code: 'KBS_SECRET' });
  }
}

/**
 * Bir bildirimi gönderir. Hata fırlatmaz; sonucu kayda yazar.
 * @param {any} row üstlenilmiş satır @param {Date} [now]
 */
export async function deliverKbs(row, now = new Date()) {
  const label = `${KBS_KIND_LABELS[row.kind]} bildirimi`;
  try {
    const settings = await loadKbsSettings(prisma, row.hotelId);
    const provider = kbsProviderFor(settings.provider);
    if (!provider) throw new KbsProviderError('KBS sağlayıcısı tanımsız', { code: 'KBS_CONFIG' });
    const person = await prisma.guest.findFirst({ where: { id: row.guestId, hotelId: row.hotelId }, select: KBS_PERSON_SELECT });
    if (!person) throw new KbsProviderError('Misafir kartı bulunamadı', { code: 'KBS_GUEST' });
    if (row.kind === 'CHECK_IN') {
      const missing = kbsMissingFields(person, settings);
      if (missing.length > 0) throw new KbsProviderError(`Eksik bilgi: ${kbsMissingText(missing)}. Misafir kartını tamamlayıp tekrar gönderin.`, { code: 'MISSING_FIELDS' });
    }
    const result = await provider.send(
      { hotelId: row.hotelId, settings, password: passwordOf(settings) },
      {
        kind: row.kind,
        roomNumber: row.roomNumber,
        previousRoomNumber: row.previousRoomNumber,
        occurredAt: row.createdAt.toISOString(),
        checkInRef: await checkInRefOf(row),
        person: { ...person, birthDate: person.birthDate ? toIsoDay(person.birthDate) : null },
      },
    );
    await finish(row, { state: 'SENT', sentAt: now, providerRef: result.ref, lastCode: result.code, lastMessage: result.message, nextAttemptAt: null }, { ok: true, code: result.code, message: `${result.message ?? 'Bildirildi'} · referans ${result.ref}` });
  } catch (error) {
    const err = /** @type {any} */ (error);
    const retryable = err instanceof KbsProviderError ? err.retryable : true;
    const code = typeof err?.code === 'string' ? err.code : 'KBS_ERROR';
    const message = String(err?.message ?? err).slice(0, 500);
    const retryAt = retryable ? kbsRetryAt(row.attempts, now) : null;
    if (retryAt) {
      await finish(row, { state: 'PENDING', nextAttemptAt: retryAt, lastCode: code, lastMessage: message }, { ok: false, code, message: `${message} · ${row.attempts}. deneme; sıradaki ${retryAt.toISOString()}` });
      return;
    }
    await finish(
      row,
      { state: 'FAILED', nextAttemptAt: null, lastCode: code, lastMessage: message },
      { ok: false, code, message },
      { title: `KBS ${label.toLowerCase()} gönderilemedi: ${row.guestName}`, body: `${message} Oda ${row.roomNumber}. KBS ekranından tekrar gönderin ya da elle bildirip işaretleyin.` },
    );
  }
}

/** Bağlı olduğu bildirim iptal edilen bekleyenleri iptal eder. */
export async function cancelOrphanedKbs() {
  const rows = await prisma.kbsNotification.findMany({ where: { state: 'PENDING', dependsOn: { state: 'CANCELLED' } }, select: { id: true, hotelId: true, reservationId: true, kind: true }, take: 200 });
  for (const row of rows) {
    await writeWithEvents(async (tx, stage) => {
      const { count } = await tx.kbsNotification.updateMany({ where: { id: row.id, state: 'PENDING' }, data: { state: 'CANCELLED', nextAttemptAt: null, lastMessage: 'Bağlı olduğu bildirim iptal edildi' } });
      if (count === 0) return;
      await tx.kbsLog.create({ data: { hotelId: row.hotelId, notificationId: row.id, ok: true, code: 'CANCELLED', message: 'Bağlı olduğu bildirim iptal edildi', actor: 'system' } });
      await stage('kbs.notification.changed', { hotelId: row.hotelId, notificationId: row.id, reservationId: row.reservationId, kind: row.kind, state: 'CANCELLED' });
    });
  }
  return rows.length;
}

/**
 * Sırası gelen bildirimleri gönderir (sıralı: KBS servisleri tesis başına hız sınırlı; sıra korunur).
 * @param {{ error?: Function }} [logger] @returns {Promise<number>}
 */
export async function dispatchDueKbs(logger) {
  await cancelOrphanedKbs();
  let processed = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const rows = /** @type {any[]} */ (await claimDueKbs(BATCH));
    if (rows.length === 0) break;
    for (const row of rows) {
      try {
        await deliverKbs(row);
      } catch (error) {
        logger?.error?.({ err: error, notificationId: row.id }, 'KBS sonucu yazılamadı');
      }
    }
    processed += rows.length;
  }
  return processed;
}

/** Takılı kalan gönderimleri sıraya geri koyar. @param {Date} [now] */
export function recoverStaleKbs(now = new Date()) {
  const cut = new Date(now.getTime() - KBS_STALE_SENDING_MS);
  return prismaUnfiltered.$executeRaw`
    UPDATE "KbsNotification" SET "state" = 'PENDING', "nextAttemptAt" = ${SQL_NOW}, "lockedAt" = NULL
    WHERE "state" = 'SENDING' AND "lockedAt" < ${sqlTimestamp(cut)}`;
}

/** 2 saattir bildirilemeyen giriş bildirimleri için bir kez zil. @param {Date} [now] */
export async function alertLateKbs(now = new Date()) {
  const rows = await prisma.kbsNotification.findMany({
    where: { kind: 'CHECK_IN', state: { in: ['PENDING', 'SENDING', 'FAILED'] }, lateAlertedAt: null, createdAt: { lt: new Date(now.getTime() - KBS_LATE_AFTER_MS) }, hotel: { kbsSettings: { isEnabled: true } } },
    select: { id: true, hotelId: true, guestName: true, roomNumber: true, lastMessage: true },
    take: 200,
  });
  for (const row of rows) {
    await writeWithEvents(async (tx, stage) => {
      const { count } = await tx.kbsNotification.updateMany({ where: { id: row.id, lateAlertedAt: null }, data: { lateAlertedAt: now } });
      if (count === 0) return;
      await raiseStaffAlert(tx, stage, {
        hotelId: row.hotelId,
        kind: 'KBS',
        severity: 'CRITICAL',
        title: `KBS giriş bildirimi gecikti: ${row.guestName}`,
        body: `Oda ${row.roomNumber} misafirinin girişi 2 saattir bildirilemedi${row.lastMessage ? ` (${row.lastMessage})` : ''}. Yasal süre geçmeden KBS ekranından elle bildirin.`,
        link: `/kbs/bildirimler/${row.id}`,
        permission: PERMISSIONS.KBS_SEND,
        entityType: 'KbsNotification',
        entityId: row.id,
        dedupeKey: `kbs:${row.id}:late`,
      });
    });
  }
  return rows.length;
}

/* ═══════════════ Tetikleme ve zamanlama ═══════════════ */

let kickTimer = null;
let running = false;
let rerun = false;
let autoKick = true;
/** @type {{ error?: Function } | undefined} */
let kickLogger;

/** Yeni bildirim sıraya girdi: kısa bekleme sonra gönder. */
export function kickKbsDispatcher() {
  if (!autoKick || kickTimer) return;
  kickTimer = setTimeout(async () => {
    kickTimer = null;
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      do {
        rerun = false;
        await dispatchDueKbs(kickLogger);
      } while (rerun);
    } catch (error) {
      kickLogger?.error?.({ err: error }, 'KBS gönderici turu başarısız');
    } finally {
      running = false;
    }
  }, KICK_DEBOUNCE_MS);
  kickTimer.unref?.();
}
onKbsEnqueued(kickKbsDispatcher);

/** Testler: kendiliğinden göndermeyi kapat / aç (test göndericiyi elle çağırır). @param {boolean} value */
export function setKbsAutoKick(value) {
  autoKick = value;
  if (!value && kickTimer) {
    clearTimeout(kickTimer);
    kickTimer = null;
  }
}

/** @param {{ info: Function, error: Function }} logger */
export function startKbsJobs(logger) {
  kickLogger = logger;
  return startRecurringJobs(logger, [
    {
      name: 'kbs-dispatch',
      intervalMs: 30_000,
      run: async () => {
        if (running) return 0;
        running = true;
        try {
          return await dispatchDueKbs(logger);
        } finally {
          running = false;
        }
      },
    },
    { name: 'kbs-recover', intervalMs: 5 * 60_000, run: () => recoverStaleKbs() },
    { name: 'kbs-late', intervalMs: 60 * 60_000, run: () => alertLateKbs() },
  ]);
}
