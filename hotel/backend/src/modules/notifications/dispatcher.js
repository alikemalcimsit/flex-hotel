import { Prisma } from '@prisma/client';
import { notificationRetryAt, quietHoursRelease } from '@hotelos/hotel-contracts';
import { prisma, prismaUnfiltered } from '../../db.js';
import { AppError } from '../../lib/errors.js';
import { openSecret } from '../../lib/secret-box.js';
import { writeWithEvents } from '../../lib/write.js';
import { getHotelSettings } from '../settings/service.js';
import { providerFor } from './providers/index.js';
import { NETGSM_REPORT_BATCH } from './providers/netgsm.js';
import { ProviderError } from './providers/provider-error.js';
import { smsQuietHours } from './rules.js';
import { raiseDeliveryFailureAlert } from './service.js';

/**
 * Bildirim göndericisi (modül 9).
 *
 * ### Üstlenme
 *
 * Sırası gelen bildirimler tek SQL ile "gönderiliyor" durumuna alınır
 * (`FOR UPDATE SKIP LOCKED`): aynı bildirimi iki süreç ya da iki tur aynı anda
 * göndermez. Backend birden fazla örnekle çalıştırılsa da doğru kalır.
 *
 * ### Hatalar
 *
 * Geçici hatada (ağ, hız sınırı) artan aralıklarla yeniden denenir
 * (`NOTIFICATION_RETRY_DELAYS_MS`). Kalıcı hatada (yanlış parola, tanımsız
 * başlık, reddedilen adres) ya da deneme hakkı bitince bildirim "gönderilemedi"
 * olur ve personel uyarılır.
 *
 * ### Takılı kalan
 *
 * Süreç gönderim sırasında kapanırsa bildirim "gönderiliyor"da kalır;
 * `recoverStaleNotifications` belirli süre sonra onu sıraya geri koyar. O
 * ender durumda sağlayıcı iletiyi kabul etmiş olabilir ve ileti iki kez
 * gidebilir — hiç gitmemesinden iyidir.
 */

/** Bir turda üstlenilen en fazla bildirim. */
const DISPATCH_BATCH = 20;

/** Aynı anda sağlayıcıya verilen en fazla bildirim (süreç başına). */
const DISPATCH_CONCURRENCY = 4;

/** Bir çalıştırmada en fazla tur (sıra çok uzunsa diğer işler de nefes alsın). */
const MAX_ROUNDS_PER_RUN = 10;

/** "Gönderiliyor"da bu kadar kalan bildirim takılı sayılır. */
export const STALE_SENDING_MS = 5 * 60_000;

/** Teslim raporu bu kadar süre sorulur; sonrasında "gönderildi" olarak kalır. */
const DELIVERY_REPORT_WINDOW_MS = 48 * 60 * 60_000;

/** Otel başına bir raporlama turunda en fazla sorgu (Netgsm: dakikada 10). */
const REPORT_CALLS_PER_HOTEL = 4;

/** Olay haberiyle tetiklenen gönderimin toplanma beklemesi. */
const KICK_DEBOUNCE_MS = 100;

const CLAIM_COLUMNS = Prisma.sql`n."id", n."hotelId", n."channel", n."source", n."recipient", n."recipientName",
  n."subject", n."body", n."attempts"`;

/**
 * Sırası gelmiş bildirimleri üstlenir.
 * @param {number} limit
 */
export function claimDueNotifications(limit = DISPATCH_BATCH) {
  return prismaUnfiltered.$queryRaw`
    UPDATE "Notification" n
    SET "status" = 'SENDING', "lockedAt" = now(), "attempts" = n."attempts" + 1, "updatedAt" = now()
    WHERE n."id" IN (
      SELECT "id" FROM "Notification"
      WHERE "status" = 'PENDING' AND "deletedAt" IS NULL AND "nextAttemptAt" <= now()
      ORDER BY "nextAttemptAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING ${CLAIM_COLUMNS}`;
}

/**
 * @param {string} id
 * @param {object} data
 * @param {{ event?: [string, object], alert?: object }} [effects]
 */
async function finish(id, data, { event, alert } = {}) {
  await writeWithEvents(async (tx, stage) => {
    // Yalnızca hâlâ bu gönderimin elindeyse yaz (kurtarıcı sıraya geri koymuş olabilir).
    const { count } = await tx.notification.updateMany({
      where: { id, status: 'SENDING' },
      data: { ...data, lockedAt: null },
    });
    if (count === 0) return;
    if (event) await stage(...event);
    if (alert) await raiseDeliveryFailureAlert(tx, stage, alert);
  });
}

/** @param {string} hotelId @param {string} channel @param {string} message */
function recordChannelFailure(hotelId, channel, message) {
  // `updatedAt` değişmez: yönetici formu açıkken kaydetme bayat sayılmasın.
  return prismaUnfiltered.$executeRaw`
    UPDATE "NotificationChannelConfig"
    SET "lastFailureAt" = now(), "lastFailureError" = ${message}
    WHERE "hotelId" = ${hotelId} AND "channel" = ${channel}::"NotificationChannel" AND "deletedAt" IS NULL`;
}

/**
 * Bir bildirimi gönderir. Hata fırlatmaz; sonucu kayda yazar.
 *
 * @param {{ id: string, hotelId: string, channel: string, source: string, recipient: string, recipientName: string | null, subject: string | null, body: string, attempts: number }} row
 * @param {{ test?: boolean }} [options] test: kanal kapalı olsa da, sessiz saatte de gönder; yeniden deneme yok
 * @returns {Promise<{ ok: boolean, error: string | null }>}
 */
export async function deliverNotification(row, { test = false } = {}) {
  const now = new Date();
  const config = await prisma.notificationChannelConfig.findFirst({
    where: { hotelId: row.hotelId, channel: row.channel },
    select: { enabled: true, settings: true, secret: true },
  });

  if (!config || (!config.enabled && !test)) {
    await finish(
      row.id,
      { status: 'CANCELLED', cancelledAt: now, cancelReason: 'Kanal kapalı olduğu için gönderilmedi', nextAttemptAt: null },
      { event: ['notification.cancelled', { hotelId: row.hotelId, notificationId: row.id, channel: row.channel }] },
    );
    return { ok: false, error: 'Kanal kapalı' };
  }

  const settings = /** @type {Record<string, any>} */ (config.settings ?? {});
  if (!test && row.channel === 'SMS') {
    const { timezone } = await getHotelSettings(row.hotelId);
    const release = quietHoursRelease(now, timezone, smsQuietHours(settings));
    if (release) {
      // Sessiz saatte sıraya geri; deneme hakkı yenmez.
      await finish(row.id, { status: 'PENDING', nextAttemptAt: release, attempts: { decrement: 1 } });
      return { ok: false, error: 'Sessiz saatler' };
    }
  }

  let error;
  let providerName = null;
  let result = null;
  try {
    const provider = providerFor(row.channel, settings);
    if (!provider) {
      throw new ProviderError('Kanalın gönderim geçidi bağlı değil', { code: 'PROVIDER_MISSING', retryable: true });
    }
    providerName = provider.name;
    const secret = config.secret ? openSecret(config.secret) : null;
    result = await provider.send({
      hotelId: row.hotelId,
      settings,
      secret,
      to: row.recipient,
      toName: row.recipientName,
      subject: row.subject,
      text: row.body,
    });
  } catch (caught) {
    if (caught instanceof ProviderError) error = caught;
    else if (caught instanceof AppError) {
      // Sır açılamadı / anahtar yok: ayar sorunu, denemekle düzelmez.
      error = new ProviderError(caught.message, { code: caught.code, retryable: false, configIssue: true });
    } else {
      error = new ProviderError(`Beklenmeyen hata: ${caught?.message ?? 'bilinmiyor'}`, {
        code: 'UNEXPECTED',
        retryable: true,
      });
    }
  }

  if (result) {
    // Sağlayıcı kabul etti. Kayıt burada, gönderim `try`'ının dışında yazılır:
    // yazım hatası "gönderilemedi" sanılıp ileti ikinci kez gönderilmesin.
    await finish(
      row.id,
      {
        status: 'SENT',
        sentAt: new Date(),
        provider: providerName,
        providerMessageId: result.providerMessageId ?? null,
        errorCode: null,
        error: null,
        nextAttemptAt: null,
      },
      {
        event: [
          'notification.sent',
          { hotelId: row.hotelId, notificationId: row.id, channel: row.channel, provider: providerName },
        ],
      },
    );
    return { ok: true, error: null };
  }

  const retryAt = error.retryable && !test ? notificationRetryAt(row.attempts, now) : null;
  const base = { provider: providerName, errorCode: error.code, error: error.message };
  if (retryAt) {
    await finish(
      row.id,
      { ...base, status: 'PENDING', nextAttemptAt: retryAt },
      {
        event: [
          'notification.failed',
          { hotelId: row.hotelId, notificationId: row.id, channel: row.channel, errorCode: error.code, final: false },
        ],
      },
    );
  } else {
    await finish(
      row.id,
      { ...base, status: 'FAILED', failedAt: new Date(), nextAttemptAt: null },
      {
        event: [
          'notification.failed',
          { hotelId: row.hotelId, notificationId: row.id, channel: row.channel, errorCode: error.code, final: true },
        ],
        // Test sonucunu yönetici zaten ekranda görüyor.
        alert: test
          ? undefined
          : { hotelId: row.hotelId, channel: row.channel, errorCode: error.code, error: error.message, notificationId: row.id },
      },
    );
  }
  if (error.configIssue) await recordChannelFailure(row.hotelId, row.channel, error.message);
  return { ok: false, error: error.message };
}

/**
 * Test iletisini (önceden "gönderiliyor" yazılmış) gönderir.
 * @param {string} hotelId
 * @param {string} notificationId
 */
export async function deliverTestNotification(hotelId, notificationId) {
  const row = await prisma.notification.findFirst({
    where: { id: notificationId, hotelId, status: 'SENDING' },
    select: {
      id: true,
      hotelId: true,
      channel: true,
      source: true,
      recipient: true,
      recipientName: true,
      subject: true,
      body: true,
      attempts: true,
    },
  });
  if (!row) return { ok: false, error: 'Test iletisi bulunamadı' };
  return deliverNotification(row, { test: true });
}

/** @template T @param {T[]} items @param {number} limit @param {(item: T) => Promise<unknown>} fn */
async function runLimited(items, limit, fn) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Sırası gelmiş bildirimleri gönderir.
 * @param {{ error?: Function }} [logger]
 * @returns {Promise<number>} işlenen bildirim
 */
export async function dispatchDueNotifications(logger) {
  let processed = 0;
  for (let round = 0; round < MAX_ROUNDS_PER_RUN; round += 1) {
    const rows = await claimDueNotifications(DISPATCH_BATCH);
    if (rows.length === 0) break;
    await runLimited(rows, DISPATCH_CONCURRENCY, async (row) => {
      try {
        await deliverNotification(row);
      } catch (error) {
        // deliverNotification kendi hatasını yazar; buraya yalnızca veritabanı kopması gelir.
        logger?.error?.({ err: error, notificationId: row.id }, 'Bildirim sonucu yazılamadı');
      }
    });
    processed += rows.length;
    if (rows.length < DISPATCH_BATCH) break;
  }
  return processed;
}

/**
 * Takılı kalan gönderimleri sıraya geri koyar.
 * @param {Date} [now]
 * @returns {Promise<number>}
 */
export function recoverStaleNotifications(now = new Date()) {
  const cut = new Date(now.getTime() - STALE_SENDING_MS);
  return prismaUnfiltered.$executeRaw`
    UPDATE "Notification"
    SET "status" = 'PENDING', "nextAttemptAt" = now(), "lockedAt" = NULL, "updatedAt" = now()
    WHERE "status" = 'SENDING' AND "lockedAt" < ${cut} AND "deletedAt" IS NULL`;
}

/* ══════════════════ Teslim raporu ══════════════════ */

/**
 * Sağlayıcıdan teslim raporu alır (bugün yalnızca Netgsm).
 *
 * Gönderilmiş ama sonucu bilinmeyen SMS'ler otel başına paketlenir; rapor
 * "iletildi" derse bildirim `DELIVERED`, "iletilemedi" derse `FAILED` olur
 * ve personel uyarılır.
 *
 * @param {{ error?: Function }} [logger]
 * @param {Date} [now]
 * @returns {Promise<number>} güncellenen bildirim
 */
export async function pollDeliveryReports(logger, now = new Date()) {
  const since = new Date(now.getTime() - DELIVERY_REPORT_WINDOW_MS);
  const hotels = await prisma.notification.groupBy({
    by: ['hotelId'],
    // groupBy soft-delete filtresinin dışında: koşul açıkça yazılı.
    where: {
      status: 'SENT',
      channel: 'SMS',
      provider: 'netgsm',
      sentAt: { gte: since },
      providerMessageId: { not: null },
      deletedAt: null,
    },
  });

  let updated = 0;
  for (const { hotelId } of hotels) {
    try {
      updated += await pollHotelReports(hotelId, since);
    } catch (error) {
      logger?.error?.({ err: error, hotelId }, 'Teslim raporu alınamadı');
    }
  }
  return updated;
}

/** @param {string} hotelId @param {Date} since */
async function pollHotelReports(hotelId, since) {
  const config = await prisma.notificationChannelConfig.findFirst({
    where: { hotelId, channel: 'SMS' },
    select: { settings: true, secret: true },
  });
  if (!config?.secret) return 0;
  const provider = providerFor('SMS', config.settings ?? {});
  if (!provider?.report) return 0;
  const secret = openSecret(config.secret);

  const rows = await prisma.notification.findMany({
    where: { hotelId, status: 'SENT', channel: 'SMS', provider: provider.name, sentAt: { gte: since }, providerMessageId: { not: null } },
    orderBy: [{ sentAt: 'asc' }],
    take: NETGSM_REPORT_BATCH * REPORT_CALLS_PER_HOTEL,
    select: { id: true, providerMessageId: true },
  });

  let updated = 0;
  for (let offset = 0; offset < rows.length; offset += NETGSM_REPORT_BATCH) {
    const batch = rows.slice(offset, offset + NETGSM_REPORT_BATCH);
    const report = await provider.report({ settings: config.settings, secret, jobIds: batch.map((row) => row.providerMessageId) });
    for (const row of batch) {
      const result = report.get(row.providerMessageId);
      if (!result || result.state === 'PENDING') continue;
      updated += await applyReport(hotelId, row.id, result);
    }
  }
  return updated;
}

/**
 * @param {string} hotelId
 * @param {string} id
 * @param {{ state: 'DELIVERED' | 'FAILED', message?: string, code?: string }} result
 */
async function applyReport(hotelId, id, result) {
  return writeWithEvents(async (tx, stage) => {
    const delivered = result.state === 'DELIVERED';
    const { count } = await tx.notification.updateMany({
      where: { id, hotelId, status: 'SENT' },
      data: delivered
        ? { status: 'DELIVERED', deliveredAt: new Date() }
        : { status: 'FAILED', failedAt: new Date(), errorCode: result.code, error: result.message },
    });
    if (count === 0) return 0;
    if (delivered) {
      await stage('notification.delivered', { hotelId, notificationId: id, channel: 'SMS' });
    } else {
      await stage('notification.failed', { hotelId, notificationId: id, channel: 'SMS', errorCode: result.code, final: true });
      await raiseDeliveryFailureAlert(tx, stage, {
        hotelId,
        channel: 'SMS',
        errorCode: result.code,
        error: result.message,
        notificationId: id,
      });
    }
    return 1;
  });
}

/* ══════════════════ Tetikleme ══════════════════ */

let kickTimer = null;
let running = false;
let rerun = false;
/** @type {{ error?: Function } | undefined} */
let kickLogger;

/**
 * Yeni bildirim sıraya girdi: kısa bir bekleme sonra gönder. Olay dağıtımını
 * bekletmez (dinleyiciler bekleniyor; gönderim HTTP isteğini tutmamalı).
 * Gönderim sürerken gelen haber, tur bitince bir tur daha çalıştırır.
 */
export function kickDispatcher() {
  if (kickTimer) return;
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
        await dispatchDueNotifications(kickLogger);
      } while (rerun);
    } catch (error) {
      kickLogger?.error?.({ err: error }, 'Bildirim gönderici turu başarısız');
    } finally {
      running = false;
    }
  }, KICK_DEBOUNCE_MS);
  kickTimer.unref?.();
}

/** @param {{ error?: Function }} logger */
export function setDispatcherLogger(logger) {
  kickLogger = logger;
}

/** Dağıtıcı turu sürüyor mu (zamanlayıcının çakışmaması için). */
export function dispatcherBusy() {
  return running;
}

/** Testler ve kapanış: bekleyen tetiklemeyi iptal et. */
export function stopDispatcher() {
  if (kickTimer) clearTimeout(kickTimer);
  kickTimer = null;
}
