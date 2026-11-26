import { randomUUID } from 'node:crypto';
import https from 'node:https';
import { runWithContext } from '@hotelos/core';
import {
  PERMISSIONS,
  WEBHOOK_DELIVERY_RETENTION_DAYS,
  WEBHOOK_DISABLE_AFTER_HOURS,
  WEBHOOK_RESPONSE_EXCERPT_LENGTH,
  WEBHOOK_TIMEOUT_MS,
  shouldDisableWebhook,
  webhookRetryDelayMs,
} from '@hotelos/hotel-contracts';
import { prismaUnfiltered } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { openSecret } from '../../lib/secret-box.js';
import { sqlTimestamp } from '../../lib/sql-time.js';
import { BlockedAddressError, guardedLookup } from '../../lib/ssrf.js';
import { signatureHeader } from '../../lib/webhook-signature.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { invalidateSubscriptions } from './shared.js';

/**
 * Webhook göndericisi (modül 61).
 *
 * ### Akış
 *
 * 1. **Sahiplenme:** sırası gelen (`PENDING` / `RETRYING`, `nextAttemptAt <= şimdi`) ve aboneliği + uygulaması açık
 *    teslimatlar tek sorguda `SENDING` yapılır (`FOR UPDATE SKIP LOCKED`): iki süreç aynı teslimatı iki kez göndermez.
 *    Kilit süreli (`lockedUntil`); süreç gönderirken düşerse süre dolunca kayıt yeniden sıraya döner.
 * 2. **Gönderim:** abonelik başına **sırayla**, abonelikler arası paralel (`PARALLEL_SUBSCRIPTIONS`). Yavaş ya da
 *    kapalı bir alıcı diğer otellerin / uygulamaların teslimatını bekletmez. Bir alıcıya bağlanılamazsa (zaman aşımı,
 *    bağlantı reddi) o turdaki diğer teslimatları denenmeden sıraya geri bırakılır: deneme hakkı yanmaz, 50 teslimat
 *    × 10 sn beklenmez.
 * 3. **Sonuç:** 2xx başarı; değilse artan beklemeyle yeniden deneme (`webhookRetryDelayMs`), hak bitince `FAILED`.
 *    Aboneliğin art arda başarısızlık sayacı ve "ne zamandır başarısız" alanı güncellenir; hem sayı hem süre eşiği
 *    aşılınca abonelik kendiliğinden kapanır, entegrasyon yetkilisinin ziline uyarı düşer.
 *
 * ### Güvenlik
 *
 * Bağlantı **çözülen ve denetlenen IP'ye** kurulur (`lib/ssrf.js`): adres iç ağa çözülürse gönderilmez. Yönlendirme
 * takip edilmez (3xx başarısızdır). Cevap gövdesinin yalnız başı okunur ve saklanır (büyük cevap belleği şişirmez).
 */

const CLAIM_BATCH = 50;
const PARALLEL_SUBSCRIPTIONS = 8;
/** Sahiplenmenin süresi: bir turda bir alıcıya en fazla ~50 × 10 sn; süre dolarsa kayıt yeniden alınır. */
const CLAIM_LOCK_MS = 10 * 60_000;
/** Bir turun süresi: kalan sahiplenilmiş kayıtlar sıraya geri bırakılır. */
const ROUND_BUDGET_MS = 25_000;
/** Bağlanılamayan alıcının bu turdaki diğer teslimatları ne zaman yeniden denensin. */
const UNREACHABLE_RELEASE_MS = 60_000;
/** Olaydan sonra göndericinin uyanma gecikmesi (aynı istekte birden çok olay tek turda gitsin). */
const KICK_DELAY_MS = 300;
/** Okunan cevap baytı (fazlası okunmaz). */
const RESPONSE_READ_LIMIT = 8 * 1024;
/** Teslimatın deneme dökümünde tutulan en fazla satır (elle yeniden gönderimler dahil). */
const ATTEMPT_LOG_LIMIT = 20;
const PURGE_BATCH = 5_000;
export const WEBHOOK_SYSTEM_ACTOR = 'webhook-gonderici';
const USER_AGENT = 'FlexHotel-Webhooks/1.0';

/**
 * @typedef {{ status: number, retryAfter: string | null, body: string, durationMs: number }} TransportResult
 * @typedef {(request: { url: string, body: string, headers: Record<string, string>, timeoutMs: number }) => Promise<TransportResult>} Transport
 */

/** @type {Transport} */
function httpsTransport({ url, body, headers, timeoutMs }) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: 'POST', headers, lookup: guardedLookup(), timeout: timeoutMs }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        if (size >= RESPONSE_READ_LIMIT) return;
        chunks.push(chunk);
        size += chunk.length;
        if (size >= RESPONSE_READ_LIMIT) response.destroy();
      });
      const finish = () =>
        resolve({
          status: response.statusCode ?? 0,
          retryAfter: typeof response.headers['retry-after'] === 'string' ? response.headers['retry-after'] : null,
          body: Buffer.concat(chunks).toString('utf8').slice(0, WEBHOOK_RESPONSE_EXCERPT_LENGTH),
          durationMs: Date.now() - startedAt,
        });
      response.on('end', finish);
      response.on('close', finish);
      response.on('error', finish);
    });
    // Toplam süre sınırı: `timeout` yalnız soket boşta kalınca tetiklenir; damla damla cevap veren alıcı takılmasın.
    const deadline = setTimeout(() => request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), timeoutMs);
    request.on('timeout', () => request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    request.on('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    request.on('close', () => clearTimeout(deadline));
    request.end(body);
  });
}

/** @type {Transport} */
let transport = httpsTransport;

/** Testler için (yerel alıcı yerine sahte taşıyıcı). @param {Transport | null} next */
export function setWebhookTransport(next) {
  transport = next ?? httpsTransport;
}

/**
 * Bağlantı hatasının ekranda okunacak hâli; `unreachable`: alıcıya hiç ulaşılamadı (turdaki diğerleri bekletilir).
 * @param {any} error
 */
export function describeTransportError(error) {
  const code = String(error?.code ?? '');
  if (error instanceof BlockedAddressError || code === 'EADDRBLOCKED') return { message: error.message, unreachable: true };
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return { message: `Zaman aşımı (${WEBHOOK_TIMEOUT_MS / 1000} sn içinde cevap yok)`, unreachable: true };
  if (code === 'ECONNREFUSED') return { message: 'Bağlantı reddedildi (alıcı adresi dinlemiyor)', unreachable: true };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { message: 'Alan adı çözülemedi', unreachable: true };
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return { message: 'Alıcıya ağ yolu yok', unreachable: true };
  if (/CERT|SELF_SIGNED|ERR_TLS|SSL/i.test(code) || /certificate/i.test(error?.message ?? '')) return { message: 'TLS sertifikası doğrulanamadı', unreachable: true };
  if (code === 'ECONNRESET' || code === 'EPIPE') return { message: 'Bağlantı koptu', unreachable: false };
  return { message: `Bağlantı hatası (${code || 'bilinmiyor'})`, unreachable: false };
}

/** @param {string | null} value Retry-After (saniye ya da HTTP tarihi) */
function retryAfterSeconds(value, now) {
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim());
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, Math.round((at - now.getTime()) / 1000));
}

/** Sırası gelenleri sahiplenir. @param {Date} now */
async function claimDue(now) {
  return prismaUnfiltered.$queryRaw`
    UPDATE "WebhookDelivery" d
    SET "status" = 'SENDING', "lockedUntil" = ${sqlTimestamp(new Date(now.getTime() + CLAIM_LOCK_MS))}
    WHERE d."id" IN (
      SELECT d2."id" FROM "WebhookDelivery" d2
      JOIN "WebhookSubscription" s ON s."id" = d2."subscriptionId"
      JOIN "ApiClient" c ON c."id" = s."clientId"
      WHERE d2."status" IN ('PENDING', 'RETRYING') AND d2."nextAttemptAt" <= ${sqlTimestamp(now)}
        AND s."status" = 'ACTIVE' AND s."deletedAt" IS NULL AND c."status" = 'ACTIVE' AND c."deletedAt" IS NULL
      ORDER BY d2."nextAttemptAt"
      LIMIT ${CLAIM_BATCH}::int
      FOR UPDATE OF d2 SKIP LOCKED
    )
    RETURNING d."id", d."hotelId", d."subscriptionId", d."eventId", d."eventType", d."payload", d."attempts", d."attemptLog", d."createdAt"`;
}

/** Süreç gönderirken düştü: kilidi dolan kayıtlar sıraya döner (deneme sayılmaz). @param {Date} now */
export async function recoverStuckDeliveries(now = new Date()) {
  return prismaUnfiltered.$executeRaw`
    UPDATE "WebhookDelivery"
    SET "status" = CASE WHEN "attempts" = 0 THEN 'PENDING'::"WebhookDeliveryStatus" ELSE 'RETRYING'::"WebhookDeliveryStatus" END,
        "lockedUntil" = NULL, "nextAttemptAt" = ${sqlTimestamp(now)}
    WHERE "status" = 'SENDING' AND "lockedUntil" < ${sqlTimestamp(now)}`;
}

/** Sahiplenilmiş ama gönderilmemiş teslimatları sıraya geri bırakır. @param {string[]} ids @param {Date} at */
async function release(ids, at) {
  if (ids.length === 0) return;
  await prismaUnfiltered.$executeRaw`
    UPDATE "WebhookDelivery"
    SET "status" = CASE WHEN "attempts" = 0 THEN 'PENDING'::"WebhookDeliveryStatus" ELSE 'RETRYING'::"WebhookDeliveryStatus" END,
        "lockedUntil" = NULL, "nextAttemptAt" = ${sqlTimestamp(at)}
    WHERE "id" = ANY(${ids}::text[]) AND "status" = 'SENDING'`;
}

/** Cevabın saklanan başı (taşıyıcı ne verirse versin). @param {string | null | undefined} body */
const excerpt = (body) => (body ? String(body).slice(0, WEBHOOK_RESPONSE_EXCERPT_LENGTH) : null);

/** @param {unknown} log */
const appendLog = (log, entry) => [...(Array.isArray(log) ? log : []), entry].slice(-ATTEMPT_LOG_LIMIT);

/**
 * Aboneliğin imza sırları (yeni önce; geçiş süresindeki eski sır ikinci). Açılamayan sır teslimatı başarısız sayar.
 * @param {{ secretSealed: string, previousSecretSealed: string | null, previousSecretExpiresAt: Date | null }} subscription
 * @param {Date} now
 */
function signingSecrets(subscription, now) {
  const secrets = [openSecret(subscription.secretSealed)];
  if (subscription.previousSecretSealed && subscription.previousSecretExpiresAt && subscription.previousSecretExpiresAt > now) {
    secrets.push(openSecret(subscription.previousSecretSealed));
  }
  return secrets;
}

/**
 * Teslimatı başarılı yazar (yalnız hâlâ `SENDING` ise — elle yeniden gönderim araya girmişse dokunmaz).
 * @param {any} delivery @param {TransportResult} result @param {Date} now
 */
async function recordSuccess(delivery, result, now) {
  const attempts = delivery.attempts + 1;
  await prismaUnfiltered.$transaction([
    prismaUnfiltered.webhookDelivery.updateMany({
      where: { id: delivery.id, status: 'SENDING' },
      data: {
        status: 'SUCCEEDED',
        attempts,
        lastAttemptAt: now,
        deliveredAt: now,
        nextAttemptAt: null,
        lockedUntil: null,
        responseStatus: result.status,
        responseBody: excerpt(result.body),
        error: null,
        durationMs: result.durationMs,
        attemptLog: appendLog(delivery.attemptLog, { at: now.toISOString(), status: result.status, durationMs: result.durationMs, error: null }),
      },
    }),
    // Sayaçlar sürümü (updatedAt) ilerletmez: ekranda aboneliği düzenleyen personelin kaydı "eski" sayılmasın.
    prismaUnfiltered.$executeRaw`
      UPDATE "WebhookSubscription" SET "lastSuccessAt" = ${sqlTimestamp(now)}, "consecutiveFailures" = 0, "failingSince" = NULL
      WHERE "id" = ${delivery.subscriptionId}`,
  ]);
}

/**
 * Başarısız denemeyi yazar; hak bittiyse `FAILED`. Aboneliğin sayacı artar, eşik aşıldıysa abonelik kapanır.
 * @param {any} delivery
 * @param {{ status: number | null, body: string | null, durationMs: number | null, error: string, retryAfter: string | null }} outcome
 * @param {Date} now
 * @param {{ info?: Function, warn?: Function, error?: Function }} logger
 */
async function recordFailure(delivery, outcome, now, logger) {
  const attempts = delivery.attempts + 1;
  const delay = webhookRetryDelayMs(attempts, { retryAfterSeconds: retryAfterSeconds(outcome.retryAfter, now), jitter: Math.random() });
  const final = delay === null;
  await prismaUnfiltered.webhookDelivery.updateMany({
    where: { id: delivery.id, status: 'SENDING' },
    data: {
      status: final ? 'FAILED' : 'RETRYING',
      attempts,
      lastAttemptAt: now,
      nextAttemptAt: final ? null : new Date(now.getTime() + delay),
      lockedUntil: null,
      responseStatus: outcome.status,
      responseBody: excerpt(outcome.body),
      error: outcome.error,
      durationMs: outcome.durationMs,
      attemptLog: appendLog(delivery.attemptLog, { at: now.toISOString(), status: outcome.status, durationMs: outcome.durationMs, error: outcome.error }),
    },
  });
  const [state] = await prismaUnfiltered.$queryRaw`
    UPDATE "WebhookSubscription"
    SET "consecutiveFailures" = "consecutiveFailures" + 1, "lastFailureAt" = ${sqlTimestamp(now)},
        "failingSince" = COALESCE("failingSince", ${sqlTimestamp(now)})
    WHERE "id" = ${delivery.subscriptionId}
    RETURNING "consecutiveFailures", "failingSince", "status", "clientId", "hotelId", "url"`;
  if (state && state.status === 'ACTIVE' && shouldDisableWebhook({ consecutiveFailures: state.consecutiveFailures, failingSince: state.failingSince, now })) {
    await disableFailingSubscription(delivery.subscriptionId, state, outcome.error, logger);
  }
}

/**
 * Kesintisiz başarısız aboneliği kapatır (koşullu: aynı anda iki tur kapatmaya çalışırsa tek uyarı çıkar).
 * @param {string} subscriptionId
 * @param {{ consecutiveFailures: number, clientId: string, hotelId: string, url: string }} state
 * @param {string} lastError
 */
async function disableFailingSubscription(subscriptionId, state, lastError, logger) {
  const reason = `${WEBHOOK_DISABLE_AFTER_HOURS} saattir teslimat yapılamadı (art arda ${state.consecutiveFailures} başarısız deneme; son hata: ${lastError})`;
  const disabled = await writeWithEvents(async (tx, stage) => {
    const changed = await tx.webhookSubscription.updateMany({
      where: { id: subscriptionId, hotelId: state.hotelId, status: 'ACTIVE' },
      data: { status: 'DISABLED', disabledReason: reason.slice(0, 500), disabledAt: new Date() },
    });
    if (changed.count === 0) return false;
    await recordAudit(tx, {
      hotelId: state.hotelId,
      entity: 'WebhookSubscription',
      entityId: subscriptionId,
      action: 'UPDATE',
      before: { status: 'ACTIVE' },
      after: { status: 'DISABLED', disabledReason: reason },
    });
    const client = await tx.apiClient.findFirst({ where: { id: state.clientId, hotelId: state.hotelId }, select: { name: true } });
    await raiseStaffAlert(tx, stage, {
      hotelId: state.hotelId,
      kind: 'INTEGRATION',
      severity: 'WARNING',
      title: `Webhook kapandı: ${client?.name ?? 'uygulama'}`,
      body: `${state.url} adresine ${reason}. Alıcı düzelince abonelikten yeniden açın; bekleyen olaylar o zaman gönderilir.`,
      link: `/entegrasyonlar/uygulamalar/${state.clientId}`,
      permission: PERMISSIONS.INTEGRATIONS_MANAGE,
      entityType: 'WebhookSubscription',
      entityId: subscriptionId,
      dedupeKey: `webhook-disabled:${subscriptionId}`,
    });
    return true;
  });
  if (disabled) {
    invalidateSubscriptions(state.hotelId);
    logger?.warn?.({ subscriptionId, hotelId: state.hotelId }, 'Webhook aboneliği art arda başarısızlık yüzünden kapatıldı');
  }
}

/**
 * Bir aboneliğin sahiplenilmiş teslimatları (sırayla).
 * @param {any[]} deliveries @param {any} subscription @param {number} deadline @param {any} logger
 * @returns {Promise<{ sent: number, released: string[] }>}
 */
async function sendGroup(deliveries, subscription, deadline, logger) {
  let sent = 0;
  for (const [index, delivery] of deliveries.entries()) {
    if (Date.now() > deadline) return { sent, released: deliveries.slice(index).map((row) => row.id) };
    const now = new Date();
    let secrets;
    try {
      secrets = signingSecrets(subscription, now);
    } catch (error) {
      await recordFailure(delivery, { status: null, body: null, durationMs: null, error: `İmza sırrı açılamadı: ${error.message}`, retryAfter: null }, now, logger);
      continue;
    }
    const body = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(now.getTime() / 1000);
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
      'user-agent': USER_AGENT,
      'x-flexhotel-event': delivery.eventType,
      'x-flexhotel-event-id': delivery.eventId,
      'x-flexhotel-delivery': delivery.id,
      'x-flexhotel-signature': signatureHeader(secrets, timestamp, body),
    };
    try {
      const result = await transport({ url: subscription.url, body, headers, timeoutMs: WEBHOOK_TIMEOUT_MS });
      if (result.status >= 200 && result.status < 300) {
        await recordSuccess(delivery, result, new Date());
        sent += 1;
      } else {
        const error = result.status >= 300 && result.status < 400 ? `Alıcı yönlendirme döndü (${result.status}); yönlendirme takip edilmez` : `Alıcı ${result.status} döndü`;
        await recordFailure(delivery, { status: result.status, body: result.body, durationMs: result.durationMs, error, retryAfter: result.retryAfter }, new Date(), logger);
      }
    } catch (error) {
      const described = describeTransportError(error);
      await recordFailure(delivery, { status: null, body: null, durationMs: Date.now() - now.getTime(), error: described.message, retryAfter: null }, new Date(), logger);
      if (described.unreachable && index < deliveries.length - 1) {
        // Alıcıya ulaşılamıyor: bu turdaki diğerleri deneme hakkı yakmadan bir dakika sonraya.
        const rest = deliveries.slice(index + 1).map((row) => row.id);
        await release(rest, new Date(Date.now() + UNREACHABLE_RELEASE_MS));
        return { sent, released: [] };
      }
    }
  }
  return { sent, released: [] };
}

/**
 * Bir gönderim turu: takılı kalanları geri al, sırası gelenleri sahiplen, abonelik başına gönder. Tur süresi dolarsa
 * kalanlar sıraya döner.
 * @param {{ info?: Function, warn?: Function, error?: Function }} [logger]
 * @param {{ budgetMs?: number }} [options]
 * @returns {Promise<{ claimed: number, sent: number }>}
 */
export async function runWebhookSenderRound(logger = console, { budgetMs = ROUND_BUDGET_MS } = {}) {
  const deadline = Date.now() + budgetMs;
  await recoverStuckDeliveries();
  const claimed = await claimDue(new Date());
  if (claimed.length === 0) return { claimed: 0, sent: 0 };

  const subscriptionIds = [...new Set(claimed.map((row) => row.subscriptionId))];
  const subscriptions = await prismaUnfiltered.webhookSubscription.findMany({
    where: { id: { in: subscriptionIds } },
    select: { id: true, url: true, secretSealed: true, previousSecretSealed: true, previousSecretExpiresAt: true },
  });
  const byId = new Map(subscriptions.map((row) => [row.id, row]));
  const groups = subscriptionIds.map((id) => ({ subscription: byId.get(id), deliveries: claimed.filter((row) => row.subscriptionId === id).sort((a, b) => a.createdAt - b.createdAt) }));

  let sent = 0;
  const released = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < groups.length) {
      const group = groups[cursor];
      cursor += 1;
      if (!group.subscription) {
        released.push(...group.deliveries.map((row) => row.id));
        continue;
      }
      try {
        const result = await runWithContext({ correlationId: randomUUID(), actor: WEBHOOK_SYSTEM_ACTOR }, () => sendGroup(group.deliveries, group.subscription, deadline, logger));
        sent += result.sent;
        released.push(...result.released);
      } catch (error) {
        logger?.error?.({ err: error, subscriptionId: group.subscription.id }, 'Webhook teslimat grubu yazılamadı');
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_SUBSCRIPTIONS, groups.length) }, worker));
  await release(released, new Date());
  return { claimed: claimed.length, sent };
}

/* ─────────────── Uyandırma ─────────────── */

let enabled = false;
let kickTimer = null;
let running = false;
let rerun = false;
let kickLogger = console;

/** Sunucu süreci göndericiyi açar (testler ve betikler açmaz; turu kendileri çağırır). */
export function enableWebhookSender(logger) {
  enabled = true;
  kickLogger = logger ?? console;
}

export function disableWebhookSender() {
  enabled = false;
  if (kickTimer) clearTimeout(kickTimer);
  kickTimer = null;
}

/** Sıraya teslimat eklendi: kısa gecikmeyle tur çalışsın (zamanlayıcıyı beklemeden). */
export function kickWebhookSender() {
  if (!enabled || kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    void runKicked();
  }, KICK_DELAY_MS);
  kickTimer.unref?.();
}

async function runKicked() {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    do {
      rerun = false;
      const { claimed } = await runWebhookSenderRound(kickLogger);
      if (claimed >= CLAIM_BATCH) rerun = true;
    } while (rerun && enabled);
  } catch (error) {
    kickLogger?.error?.({ err: error }, 'Webhook göndericisi turu başarısız');
  } finally {
    running = false;
  }
}

/** Zamanlanmış tur (uyandırmayla çakışmaz). */
export async function runScheduledWebhookRound(logger) {
  kickLogger = logger ?? kickLogger;
  await runKicked();
}

/* ─────────────── Temizlik ─────────────── */

/**
 * Saklama süresi dolan teslimatlar silinir (paketler hâlinde; uzun kilit yok); süresi geçen eski imza sırları atılır.
 * @param {Date} [now]
 * @returns {Promise<number>} silinen teslimat
 */
export async function purgeWebhookDeliveries(now = new Date()) {
  const cut = new Date(now.getTime() - WEBHOOK_DELIVERY_RETENTION_DAYS * 86_400_000);
  let total = 0;
  for (;;) {
    const deleted = await prismaUnfiltered.$executeRaw`
      DELETE FROM "WebhookDelivery"
      WHERE "id" IN (SELECT "id" FROM "WebhookDelivery" WHERE "createdAt" < ${sqlTimestamp(cut)} AND "status" NOT IN ('SENDING') LIMIT ${PURGE_BATCH}::int)`;
    total += deleted;
    if (deleted < PURGE_BATCH) break;
  }
  await prismaUnfiltered.$executeRaw`
    UPDATE "WebhookSubscription" SET "previousSecretSealed" = NULL, "previousSecretExpiresAt" = NULL
    WHERE "previousSecretExpiresAt" <= ${sqlTimestamp(now)}`;
  return total;
}

