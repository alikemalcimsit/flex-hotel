import { randomUUID } from 'node:crypto';
import {
  MAX_ACTIVE_API_KEYS_PER_CLIENT,
  MAX_API_CLIENTS,
  MAX_WEBHOOKS_PER_CLIENT,
  WEBHOOK_SECRET_GRACE_HOURS,
  WEBHOOK_TEST_EVENT,
  buildWebhookEnvelope,
} from '@hotelos/hotel-contracts';
import { currentActor } from '@hotelos/core';
import { recordAudit } from '../../lib/audit.js';
import { encodeCursor, olderThan, parseCursor } from '../../lib/cursor.js';
import { AppError, ConflictError, NotFoundError, StaleWriteError, rethrowPrismaError } from '../../lib/errors.js';
import { lockApiClients, lockWebhookSubscriptions } from '../../lib/locks.js';
import { sealSecret } from '../../lib/secret-box.js';
import { generateApiKey, generateWebhookSecret } from '../../lib/webhook-signature.js';
import { writeWithEvents } from '../../lib/write.js';
import { kickWebhookSender } from './sender.js';
import {
  CLIENT_SELECT,
  DELIVERY_LIST_SELECT,
  KEY_SELECT,
  SUBSCRIPTION_SELECT,
  clientDto,
  deliveryDto,
  invalidateApiKeys,
  invalidateClientKeys,
  invalidateSubscriptions,
  keyDto,
  prisma,
  subscriptionDto,
} from './shared.js';

/**
 * Entegrasyon yönetimi (modül 61): uygulamalar, API anahtarları, webhook abonelikleri, teslimat logu.
 *
 * - Anahtarın ve imza sırrının **kendisi** yalnız oluşturulduğu cevapta döner; sonra hiçbir uçtan okunamaz
 *   (anahtarın özeti, sırrın şifreli hâli saklanır). Denetim kaydına da yazılmaz.
 * - Sayı sınırları (otelde 50 uygulama, uygulamada 10 açık anahtar / 10 abonelik) kilit altında sayılır.
 * - Ayar değişikliği iyimser kilitli (`expectedUpdatedAt`); durum değişince ilgili önbellek hemen silinir — iptal
 *   edilen anahtar en geç bir sonraki istekte reddedilir.
 */

const DELIVERY_STATS_WINDOW_MS = 24 * 3_600_000;
/** Aynı aboneliğe dakikada en fazla deneme gönderimi (düğmeye art arda basılmasın, alıcı boğulmasın). */
const MAX_TEST_DELIVERIES_PER_MINUTE = 5;
const CLIENT_LIMIT_LOCK = 'api-clients';

/** @param {any} tx @param {string} hotelId */
async function lockClientCreation(tx, hotelId) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${CLIENT_LIMIT_LOCK}:${hotelId}`}))`;
}

/** @param {any} tx @param {string} hotelId @param {string} clientId */
async function lockedClient(tx, hotelId, clientId) {
  if (!(await lockApiClients(tx, hotelId, [clientId])).has(clientId)) throw new NotFoundError('Uygulama bulunamadı');
  return tx.apiClient.findFirst({ where: { id: clientId, hotelId }, select: CLIENT_SELECT });
}

/** @param {any} tx @param {string} hotelId @param {string} clientId @param {string} subscriptionId */
async function lockedSubscription(tx, hotelId, clientId, subscriptionId) {
  const missing = new NotFoundError('Webhook aboneliği bulunamadı');
  if (!(await lockWebhookSubscriptions(tx, hotelId, [subscriptionId])).has(subscriptionId)) throw missing;
  const row = await tx.webhookSubscription.findFirst({
    where: { id: subscriptionId, hotelId, clientId },
    select: { ...SUBSCRIPTION_SELECT, secretSealed: true },
  });
  if (!row) throw missing;
  return row;
}

const assertVersion = (row, expectedUpdatedAt) => {
  if (row.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
};

/* ─────────────── Uygulamalar ─────────────── */

/**
 * Uygulama listesi (otelde en fazla `MAX_API_CLIENTS`; tek sorguda sayaçlarla).
 * @param {string} hotelId
 */
export async function listApiClients(hotelId) {
  const now = new Date();
  const rows = await prisma.apiClient.findMany({
    where: { hotelId },
    select: {
      ...CLIENT_SELECT,
      keys: { where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { lastUsedAt: true } },
      _count: { select: { subscriptions: { where: { deletedAt: null } } } },
    },
    orderBy: [{ name: 'asc' }],
    take: MAX_API_CLIENTS,
  });
  return rows.map((row) => {
    const used = row.keys.map((key) => key.lastUsedAt).filter(Boolean).sort((a, b) => b - a);
    return { ...clientDto(row), activeKeyCount: row.keys.length, webhookCount: row._count.subscriptions, lastUsedAt: used[0]?.toISOString() ?? null };
  });
}

/**
 * Uygulama ayrıntısı: anahtarlar (en yeni 50), abonelikler ve son 24 saatin teslimat özeti.
 * @param {string} hotelId @param {string} clientId
 */
export async function getApiClient(hotelId, clientId) {
  const now = new Date();
  const client = await prisma.apiClient.findFirst({
    where: { id: clientId, hotelId },
    select: {
      ...CLIENT_SELECT,
      keys: { select: KEY_SELECT, orderBy: [{ createdAt: 'desc' }], take: 50 },
      subscriptions: { where: { deletedAt: null }, select: SUBSCRIPTION_SELECT, orderBy: [{ createdAt: 'asc' }], take: MAX_WEBHOOKS_PER_CLIENT },
    },
  });
  if (!client) throw new NotFoundError('Uygulama bulunamadı');
  const subscriptionIds = client.subscriptions.map((row) => row.id);
  const stats = subscriptionIds.length
    ? await prisma.webhookDelivery.groupBy({
        by: ['subscriptionId', 'status'],
        where: { hotelId, subscriptionId: { in: subscriptionIds }, createdAt: { gte: new Date(now.getTime() - DELIVERY_STATS_WINDOW_MS) } },
        _count: { _all: true },
      })
    : [];
  const statsFor = (id) => Object.fromEntries(stats.filter((row) => row.subscriptionId === id).map((row) => [row.status, row._count._all]));
  return {
    ...clientDto(client),
    keys: client.keys.map((row) => keyDto(row, now)),
    subscriptions: client.subscriptions.map((row) => ({ ...subscriptionDto(row, now), last24h: statsFor(row.id) })),
  };
}

/**
 * @param {string} hotelId
 * @param {object} input `apiClientCreateSchema` çıktısı
 */
export async function createApiClient(hotelId, input) {
  try {
    const id = await writeWithEvents(async (tx) => {
      await lockClientCreation(tx, hotelId);
      const count = await tx.apiClient.count({ where: { hotelId } });
      if (count >= MAX_API_CLIENTS) throw new ConflictError(`Otelde en fazla ${MAX_API_CLIENTS} uygulama olabilir; kullanılmayanları silin.`, 'LIMIT_REACHED');
      const row = await tx.apiClient.create({
        data: { hotelId, ...input, createdBy: currentActor() },
        select: CLIENT_SELECT,
      });
      await recordAudit(tx, { hotelId, entity: 'ApiClient', entityId: row.id, action: 'CREATE', after: clientDto(row) });
      return row.id;
    });
    return getApiClient(hotelId, id);
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu adla bir uygulama zaten var' });
  }
}

/**
 * Ayar / durum değişikliği. Kapatılan uygulamanın anahtarları hemen reddedilir, webhook'ları gönderilmez (bekleyenler
 * açılınca gider).
 * @param {string} hotelId @param {string} clientId @param {object} input `apiClientUpdateSchema` çıktısı
 */
export async function updateApiClient(hotelId, clientId, input) {
  const { expectedUpdatedAt, ...changes } = input;
  const data = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
  try {
    await writeWithEvents(async (tx) => {
      const current = await lockedClient(tx, hotelId, clientId);
      assertVersion(current, expectedUpdatedAt);
      if (Object.keys(data).length === 0) return;
      const updated = await tx.apiClient.update({ where: { id: clientId }, data, select: CLIENT_SELECT });
      await recordAudit(tx, { hotelId, entity: 'ApiClient', entityId: clientId, action: 'UPDATE', before: clientDto(current), after: clientDto(updated) });
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu adla bir uygulama zaten var' });
  }
  await invalidateClientKeys(prisma, hotelId, clientId);
  invalidateSubscriptions(hotelId);
  return getApiClient(hotelId, clientId);
}

/**
 * Uygulamayı siler (yumuşak): anahtarlar iptal, abonelikler silinir, bekleyen teslimatlar "gönderilmedi" kapanır.
 * Uygulamanın açtığı rezervasyonlar durur (bağı kalır, ekranda "Dış sistem (API)").
 * @param {string} hotelId @param {string} clientId @param {{ expectedUpdatedAt: Date }} input
 */
export async function deleteApiClient(hotelId, clientId, { expectedUpdatedAt }) {
  const prefixes = await writeWithEvents(async (tx) => {
    const current = await lockedClient(tx, hotelId, clientId);
    assertVersion(current, expectedUpdatedAt);
    const now = new Date();
    const actor = currentActor();
    const keys = await tx.apiKey.findMany({ where: { hotelId, clientId }, select: { prefix: true } });
    await tx.apiKey.updateMany({ where: { hotelId, clientId, revokedAt: null }, data: { revokedAt: now, revokedBy: actor } });
    const subscriptions = await tx.webhookSubscription.findMany({ where: { hotelId, clientId }, select: { id: true } });
    await tx.webhookSubscription.updateMany({ where: { hotelId, clientId }, data: { deletedAt: now, status: 'PAUSED' } });
    await failPendingDeliveries(tx, subscriptions.map((row) => row.id), 'Uygulama silindi; gönderilmedi');
    await tx.apiClient.update({ where: { id: clientId }, data: { deletedAt: now, status: 'DISABLED' } });
    await recordAudit(tx, { hotelId, entity: 'ApiClient', entityId: clientId, action: 'DELETE', before: clientDto(current) });
    return keys.map((key) => key.prefix);
  });
  invalidateApiKeys(prefixes);
  invalidateSubscriptions(hotelId);
}

/** @param {any} tx @param {string[]} subscriptionIds @param {string} reason */
async function failPendingDeliveries(tx, subscriptionIds, reason) {
  if (subscriptionIds.length === 0) return;
  await tx.webhookDelivery.updateMany({
    where: { subscriptionId: { in: subscriptionIds }, status: { in: ['PENDING', 'RETRYING'] } },
    data: { status: 'FAILED', nextAttemptAt: null, error: reason },
  });
}

/* ─────────────── Anahtarlar ─────────────── */

/**
 * Yeni anahtar. Dönen `token` bir daha gösterilmez.
 * @param {string} hotelId @param {string} clientId @param {object} input `apiKeyCreateSchema` çıktısı
 * @returns {Promise<{ key: ReturnType<typeof keyDto>, token: string }>}
 */
export async function createApiKey(hotelId, clientId, input) {
  const generated = generateApiKey();
  const now = new Date();
  const row = await writeWithEvents(async (tx) => {
    await lockedClient(tx, hotelId, clientId);
    const active = await tx.apiKey.count({ where: { hotelId, clientId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } });
    if (active >= MAX_ACTIVE_API_KEYS_PER_CLIENT) {
      throw new ConflictError(`Bir uygulamada en fazla ${MAX_ACTIVE_API_KEYS_PER_CLIENT} açık anahtar olabilir; kullanılmayanı iptal edin.`, 'LIMIT_REACHED');
    }
    const created = await tx.apiKey.create({
      data: {
        hotelId,
        clientId,
        name: input.name,
        prefix: generated.prefix,
        secretHash: generated.secretHash,
        scopes: input.scopes,
        expiresAt: input.expiresInDays ? new Date(now.getTime() + input.expiresInDays * 86_400_000) : null,
        createdBy: currentActor(),
      },
      select: KEY_SELECT,
    });
    await recordAudit(tx, { hotelId, entity: 'ApiKey', entityId: created.id, action: 'CREATE', after: keyDto(created, now) });
    return created;
  });
  return { key: keyDto(row, now), token: generated.token };
}

/**
 * Anahtarı iptal eder (geri alınmaz). Önbellek hemen silinir.
 * @param {string} hotelId @param {string} clientId @param {string} keyId
 */
export async function revokeApiKey(hotelId, clientId, keyId) {
  const now = new Date();
  const row = await writeWithEvents(async (tx) => {
    await lockedClient(tx, hotelId, clientId);
    const current = await tx.apiKey.findFirst({ where: { id: keyId, hotelId, clientId }, select: KEY_SELECT });
    if (!current) throw new NotFoundError('Anahtar bulunamadı');
    if (current.revokedAt) throw new ConflictError('Anahtar zaten iptal edilmiş', 'ALREADY_REVOKED');
    const updated = await tx.apiKey.update({ where: { id: keyId }, data: { revokedAt: now, revokedBy: currentActor() }, select: KEY_SELECT });
    await recordAudit(tx, { hotelId, entity: 'ApiKey', entityId: keyId, action: 'UPDATE', before: keyDto(current, now), after: keyDto(updated, now) });
    return updated;
  });
  invalidateApiKeys([row.prefix]);
  return keyDto(row, now);
}

/* ─────────────── Webhook abonelikleri ─────────────── */

/**
 * Yeni abonelik. Dönen `secret` (imza sırrı) bir daha gösterilmez.
 * @param {string} hotelId @param {string} clientId @param {object} input `webhookCreateSchema` çıktısı
 */
export async function createWebhook(hotelId, clientId, input) {
  const secret = generateWebhookSecret();
  const sealed = sealSecret(secret);
  const row = await writeWithEvents(async (tx) => {
    await lockedClient(tx, hotelId, clientId);
    const existing = await tx.webhookSubscription.findMany({ where: { hotelId, clientId }, select: { url: true } });
    if (existing.length >= MAX_WEBHOOKS_PER_CLIENT) throw new ConflictError(`Bir uygulamada en fazla ${MAX_WEBHOOKS_PER_CLIENT} abonelik olabilir.`, 'LIMIT_REACHED');
    if (existing.some((row_) => row_.url === input.url)) throw new ConflictError('Bu adrese zaten bir abonelik var; olaylarını düzenleyin.', 'DUPLICATE_URL');
    const created = await tx.webhookSubscription.create({
      data: { hotelId, clientId, url: input.url, events: input.events, secretSealed: sealed, createdBy: currentActor() },
      select: SUBSCRIPTION_SELECT,
    });
    await recordAudit(tx, { hotelId, entity: 'WebhookSubscription', entityId: created.id, action: 'CREATE', after: subscriptionDto(created) });
    return created;
  });
  invalidateSubscriptions(hotelId);
  return { subscription: subscriptionDto(row), secret };
}

/**
 * Adres / olaylar / durum. Yeniden açmak (duraklatılmış ya da hatalar yüzünden kapanmış) sayaçları sıfırlar; bekleyen
 * teslimatlar o zaman gönderilir.
 * @param {string} hotelId @param {string} clientId @param {string} subscriptionId @param {object} input `webhookUpdateSchema` çıktısı
 */
export async function updateWebhook(hotelId, clientId, subscriptionId, input) {
  const row = await writeWithEvents(async (tx) => {
    const current = await lockedSubscription(tx, hotelId, clientId, subscriptionId);
    assertVersion(current, input.expectedUpdatedAt);
    const data = {};
    if (input.url !== undefined && input.url !== current.url) {
      const clash = await tx.webhookSubscription.findFirst({ where: { hotelId, clientId, url: input.url, id: { not: subscriptionId } }, select: { id: true } });
      if (clash) throw new ConflictError('Bu adrese zaten bir abonelik var.', 'DUPLICATE_URL');
      data.url = input.url;
    }
    if (input.events !== undefined) data.events = input.events;
    if (input.status !== undefined && input.status !== current.status) {
      data.status = input.status;
      if (input.status === 'ACTIVE') Object.assign(data, { consecutiveFailures: 0, failingSince: null, disabledReason: null, disabledAt: null });
    }
    if (Object.keys(data).length === 0) return current;
    if (data.status === 'ACTIVE') {
      // Bekleyenler geri çekilme yüzünden saatlerce ileride olabilir: alıcı düzeldi denip açıldı, hemen gönderilsin.
      await tx.webhookDelivery.updateMany({ where: { subscriptionId, status: { in: ['PENDING', 'RETRYING'] } }, data: { nextAttemptAt: new Date() } });
    }
    const updated = await tx.webhookSubscription.update({ where: { id: subscriptionId }, data, select: SUBSCRIPTION_SELECT });
    await recordAudit(tx, { hotelId, entity: 'WebhookSubscription', entityId: subscriptionId, action: 'UPDATE', before: subscriptionDto(current), after: subscriptionDto(updated) });
    return updated;
  });
  invalidateSubscriptions(hotelId);
  if (row.status === 'ACTIVE') kickWebhookSender();
  return subscriptionDto(row);
}

/**
 * İmza sırrını yeniler. Eski sır `WEBHOOK_SECRET_GRACE_HOURS` saat ikinci imza olarak gönderilir (alıcı yeni sırrı
 * yerleştirene kadar teslimat kesilmez). Dönen `secret` bir daha gösterilmez.
 * @param {string} hotelId @param {string} clientId @param {string} subscriptionId @param {{ expectedUpdatedAt: Date }} input
 */
export async function rotateWebhookSecret(hotelId, clientId, subscriptionId, { expectedUpdatedAt }) {
  const secret = generateWebhookSecret();
  const sealed = sealSecret(secret);
  const graceUntil = new Date(Date.now() + WEBHOOK_SECRET_GRACE_HOURS * 3_600_000);
  const row = await writeWithEvents(async (tx) => {
    const current = await lockedSubscription(tx, hotelId, clientId, subscriptionId);
    assertVersion(current, expectedUpdatedAt);
    const updated = await tx.webhookSubscription.update({
      where: { id: subscriptionId },
      data: { secretSealed: sealed, previousSecretSealed: current.secretSealed, previousSecretExpiresAt: graceUntil },
      select: SUBSCRIPTION_SELECT,
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'WebhookSubscription',
      entityId: subscriptionId,
      action: 'UPDATE',
      before: { secretRotatedAt: null },
      after: { secretRotatedAt: new Date().toISOString(), previousSecretValidUntil: graceUntil.toISOString() },
    });
    return updated;
  });
  return { subscription: subscriptionDto(row), secret };
}

/**
 * Aboneliği siler; bekleyen teslimatları "gönderilmedi" kapatır (geçmiş log 30 gün durur).
 * @param {string} hotelId @param {string} clientId @param {string} subscriptionId @param {{ expectedUpdatedAt: Date }} input
 */
export async function deleteWebhook(hotelId, clientId, subscriptionId, { expectedUpdatedAt }) {
  await writeWithEvents(async (tx) => {
    const current = await lockedSubscription(tx, hotelId, clientId, subscriptionId);
    assertVersion(current, expectedUpdatedAt);
    await tx.webhookSubscription.update({ where: { id: subscriptionId }, data: { deletedAt: new Date(), status: 'PAUSED' } });
    await failPendingDeliveries(tx, [subscriptionId], 'Abonelik silindi; gönderilmedi');
    await recordAudit(tx, { hotelId, entity: 'WebhookSubscription', entityId: subscriptionId, action: 'DELETE', before: subscriptionDto(current) });
  });
  invalidateSubscriptions(hotelId);
}

/**
 * Deneme olayı: aboneliğin adresine `webhook.test` gönderir (imza dahil gerçek teslimat). Abonelik açık olmalı.
 * @param {string} hotelId @param {string} clientId @param {string} subscriptionId
 */
export async function sendTestWebhook(hotelId, clientId, subscriptionId) {
  const id = await writeWithEvents(async (tx) => {
    const current = await lockedSubscription(tx, hotelId, clientId, subscriptionId);
    if (current.status !== 'ACTIVE') throw new ConflictError('Deneme göndermek için önce aboneliği açın.', 'WEBHOOK_NOT_ACTIVE');
    const client = await tx.apiClient.findFirst({ where: { id: clientId, hotelId }, select: { status: true } });
    if (client?.status !== 'ACTIVE') throw new ConflictError('Uygulama kapalı; önce uygulamayı açın.', 'CLIENT_DISABLED');
    const recent = await tx.webhookDelivery.count({
      where: { subscriptionId, eventType: WEBHOOK_TEST_EVENT, createdAt: { gte: new Date(Date.now() - 60_000) } },
    });
    if (recent >= MAX_TEST_DELIVERIES_PER_MINUTE) {
      throw new AppError('Bir dakikada en fazla 5 deneme gönderilebilir; biraz bekleyin.', { statusCode: 429, code: 'RATE_LIMITED' });
    }
    const eventId = randomUUID();
    const now = new Date();
    const delivery = await tx.webhookDelivery.create({
      data: {
        hotelId,
        subscriptionId,
        eventId,
        eventType: WEBHOOK_TEST_EVENT,
        payload: buildWebhookEnvelope({
          eventId,
          type: WEBHOOK_TEST_EVENT,
          occurredAt: now,
          hotelId,
          data: { message: 'FlexHotel deneme olayı: imzayı doğrulayıp 2xx dönün.', subscriptionId },
        }),
        status: 'PENDING',
        nextAttemptAt: now,
      },
      select: { id: true },
    });
    await recordAudit(tx, { hotelId, entity: 'WebhookDelivery', entityId: delivery.id, action: 'CREATE', after: { eventType: WEBHOOK_TEST_EVENT, subscriptionId } });
    return delivery.id;
  });
  kickWebhookSender();
  return getWebhookDelivery(hotelId, id);
}

/* ─────────────── Teslimat logu ─────────────── */

/**
 * İmleçli teslimat listesi (en yeni önce). Uygulama süzgeci aboneliklerine çevrilir (indeks: abonelik + zaman).
 * @param {string} hotelId @param {object} query `webhookDeliveryListQuerySchema` çıktısı
 */
export async function listWebhookDeliveries(hotelId, query) {
  const cursor = parseCursor(query.cursor);
  /** @type {import('@prisma/client').Prisma.WebhookDeliveryWhereInput} */
  const where = { hotelId };
  if (query.subscriptionId) where.subscriptionId = query.subscriptionId;
  else if (query.clientId) {
    const subscriptions = await prisma.webhookSubscription.findMany({
      // `deletedAt` anahtarı bilerek var (değeri yok): silinmiş aboneliklerin geçmiş teslimatları da listelenir.
      where: { hotelId, clientId: query.clientId, deletedAt: undefined },
      select: { id: true },
      take: 200,
    });
    where.subscriptionId = { in: subscriptions.map((row) => row.id) };
  }
  if (query.status) where.status = query.status;
  if (query.eventType) where.eventType = query.eventType;
  const rows = await prisma.webhookDelivery.findMany({
    where: cursor ? { AND: [where, olderThan('createdAt', cursor)] } : where,
    select: DELIVERY_LIST_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
  });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(deliveryDto),
    nextCursor: rows.length > query.limit && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
  };
}

/** Teslimat ayrıntısı: gövde, denemeler, cevabın başı. @param {string} hotelId @param {string} deliveryId */
export async function getWebhookDelivery(hotelId, deliveryId) {
  const row = await prisma.webhookDelivery.findFirst({
    where: { id: deliveryId, hotelId },
    select: { ...DELIVERY_LIST_SELECT, payload: true, responseBody: true, attemptLog: true },
  });
  if (!row) throw new NotFoundError('Teslimat bulunamadı');
  return { ...deliveryDto(row), payload: row.payload, responseBody: row.responseBody ?? null, attemptLog: Array.isArray(row.attemptLog) ? row.attemptLog : [] };
}

/**
 * Yeniden gönder: bitmiş (teslim edilmiş ya da edilememiş) teslimat aynı olay kimliğiyle sıraya döner, deneme hakkı
 * yeniden başlar. Alıcı tekrar gelen olayı `id` ile tanır.
 * @param {string} hotelId @param {string} deliveryId
 */
export async function redeliverWebhook(hotelId, deliveryId) {
  await writeWithEvents(async (tx) => {
    const row = await tx.webhookDelivery.findFirst({
      where: { id: deliveryId, hotelId },
      select: { id: true, status: true, attemptLog: true, subscription: { select: { status: true, deletedAt: true, client: { select: { status: true, deletedAt: true } } } } },
    });
    if (!row) throw new NotFoundError('Teslimat bulunamadı');
    if (!['SUCCEEDED', 'FAILED'].includes(row.status)) throw new ConflictError('Teslimat zaten sırada ya da gönderiliyor.', 'DELIVERY_IN_PROGRESS');
    const subscription = row.subscription;
    if (!subscription || subscription.deletedAt || subscription.client?.deletedAt) throw new ConflictError('Abonelik silinmiş; yeniden gönderilemez.', 'WEBHOOK_DELETED');
    if (subscription.status !== 'ACTIVE' || subscription.client?.status !== 'ACTIVE') {
      throw new ConflictError('Yeniden göndermek için önce aboneliği ve uygulamayı açın.', 'WEBHOOK_NOT_ACTIVE');
    }
    const now = new Date();
    const changed = await tx.webhookDelivery.updateMany({
      where: { id: deliveryId, status: { in: ['SUCCEEDED', 'FAILED'] } },
      data: {
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: now,
        lockedUntil: null,
        error: null,
        attemptLog: [...(Array.isArray(row.attemptLog) ? row.attemptLog : []), { at: now.toISOString(), status: null, durationMs: null, error: null, note: `Elle yeniden gönderildi (${currentActor()})` }].slice(-20),
      },
    });
    if (changed.count === 0) throw new ConflictError('Teslimat bu arada değişti; listeyi yenileyin.', 'DELIVERY_IN_PROGRESS');
    await recordAudit(tx, { hotelId, entity: 'WebhookDelivery', entityId: deliveryId, action: 'UPDATE', before: { status: row.status }, after: { status: 'PENDING', redelivered: true } });
  });
  kickWebhookSender();
  return getWebhookDelivery(hotelId, deliveryId);
}

