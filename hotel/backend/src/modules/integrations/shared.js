import { maskApiKey } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { cache } from '../../lib/cache.js';

/**
 * Entegrasyon modülünün (61) ortak parçaları: DTO'lar ve önbellek anahtarları.
 *
 * İki önbellek var, ikisi de değişiklikte hemen silinir:
 * - **Anahtar** (`apikey:<önek>`, 60 sn): her API isteği anahtarı doğrular; 2500 kişilik otelin entegrasyon trafiğinde
 *   her istekte veritabanına gitmesin. İptal / uygulama kapatma / hız sınırı değişikliği önbelleği siler.
 * - **Abonelikler** (`webhooks:subs:<otel>`, 30 sn): her iş olayında (rezervasyon, ödeme…) "bu otelde bu olayı isteyen
 *   abonelik var mı" sorulur; çoğu otelde cevap "yok"tur ve sorgu atılmamalı.
 */

export { prisma };

export const API_KEY_CACHE_TTL_MS = 60_000;
export const SUBSCRIPTIONS_CACHE_TTL_MS = 30_000;

export const apiKeyCacheKey = (prefix) => `apikey:${prefix}`;
export const subscriptionsCacheKey = (hotelId) => `webhooks:subs:${hotelId}`;

/** @param {string} hotelId */
export function invalidateSubscriptions(hotelId) {
  cache.invalidatePrefix(subscriptionsCacheKey(hotelId));
}

/** @param {string[]} prefixes */
export function invalidateApiKeys(prefixes) {
  for (const prefix of prefixes) cache.invalidatePrefix(apiKeyCacheKey(prefix));
}

/** Uygulamanın bütün anahtarlarının önbelleğini siler (uygulama kapandı, hız sınırı değişti). */
export async function invalidateClientKeys(db, hotelId, clientId) {
  const keys = await db.apiKey.findMany({ where: { hotelId, clientId }, select: { prefix: true }, take: 500 });
  invalidateApiKeys(keys.map((key) => key.prefix));
}

const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

export const CLIENT_SELECT = Object.freeze({
  id: true,
  name: true,
  description: true,
  contactEmail: true,
  status: true,
  rateLimitPerMinute: true,
  bookingStatus: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {any} row */
export function clientDto(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    contactEmail: row.contactEmail ?? null,
    status: row.status,
    rateLimitPerMinute: row.rateLimitPerMinute,
    bookingStatus: row.bookingStatus,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export const KEY_SELECT = Object.freeze({
  id: true,
  clientId: true,
  name: true,
  prefix: true,
  scopes: true,
  expiresAt: true,
  lastUsedAt: true,
  lastUsedIp: true,
  revokedAt: true,
  revokedBy: true,
  createdBy: true,
  createdAt: true,
});

/** Anahtarın durumu (ekran rozeti). @param {any} row @param {Date} now */
export function keyState(row, now = new Date()) {
  if (row.revokedAt) return 'REVOKED';
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

/** Sır ve özet hiç dönmez; önek ekranda anahtarı tanımak için. @param {any} row @param {Date} [now] */
export function keyDto(row, now = new Date()) {
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    prefix: row.prefix,
    display: maskApiKey(row.prefix),
    scopes: row.scopes,
    state: keyState(row, now),
    expiresAt: iso(row.expiresAt),
    lastUsedAt: iso(row.lastUsedAt),
    lastUsedIp: row.lastUsedIp ?? null,
    revokedAt: iso(row.revokedAt),
    revokedBy: row.revokedBy ?? null,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
  };
}

export const SUBSCRIPTION_SELECT = Object.freeze({
  id: true,
  clientId: true,
  url: true,
  events: true,
  status: true,
  consecutiveFailures: true,
  failingSince: true,
  disabledReason: true,
  disabledAt: true,
  lastSuccessAt: true,
  lastFailureAt: true,
  previousSecretExpiresAt: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

/** Sır hiç dönmez. @param {any} row @param {Date} [now] */
export function subscriptionDto(row, now = new Date()) {
  const graceUntil = row.previousSecretExpiresAt && row.previousSecretExpiresAt.getTime() > now.getTime() ? row.previousSecretExpiresAt : null;
  return {
    id: row.id,
    clientId: row.clientId,
    url: row.url,
    events: row.events,
    status: row.status,
    consecutiveFailures: row.consecutiveFailures,
    failingSince: iso(row.failingSince),
    disabledReason: row.disabledReason ?? null,
    disabledAt: iso(row.disabledAt),
    lastSuccessAt: iso(row.lastSuccessAt),
    lastFailureAt: iso(row.lastFailureAt),
    previousSecretValidUntil: iso(graceUntil),
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export const DELIVERY_LIST_SELECT = Object.freeze({
  id: true,
  subscriptionId: true,
  eventId: true,
  eventType: true,
  status: true,
  attempts: true,
  nextAttemptAt: true,
  lastAttemptAt: true,
  responseStatus: true,
  durationMs: true,
  error: true,
  deliveredAt: true,
  createdAt: true,
  subscription: { select: { url: true, clientId: true, client: { select: { name: true } } } },
});

/** @param {any} row */
export function deliveryDto(row) {
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    clientId: row.subscription?.clientId ?? null,
    clientName: row.subscription?.client?.name ?? null,
    url: row.subscription?.url ?? null,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: iso(row.nextAttemptAt),
    lastAttemptAt: iso(row.lastAttemptAt),
    responseStatus: row.responseStatus ?? null,
    durationMs: row.durationMs ?? null,
    error: row.error ?? null,
    deliveredAt: iso(row.deliveredAt),
    createdAt: iso(row.createdAt),
  };
}
