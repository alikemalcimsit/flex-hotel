import { API_UNAUTHENTICATED_LIMIT, parseApiKey } from '@hotelos/hotel-contracts';
import { getContext } from '@hotelos/core';
import { prismaUnfiltered } from '../../db.js';
import { cache } from '../../lib/cache.js';
import { AppError, ForbiddenError, UnauthorizedError } from '../../lib/errors.js';
import { hashApiKey, sameHash } from '../../lib/webhook-signature.js';
import { API_KEY_CACHE_TTL_MS, apiKeyCacheKey } from '../integrations/shared.js';

/**
 * Açık API kimlik doğrulaması (modül 61).
 *
 * - `Authorization: Bearer fhk_<önek>_<sır>`. Biçimi yanlış anahtar veritabanına hiç gitmez.
 * - Anahtar satırı önekle (tekil indeks) bulunur, bütün anahtarın SHA-256 özeti sabit sürede karşılaştırılır. Satır
 *   60 sn önbellekte (bulunamayan önek de: rastgele önekle tarama veritabanını yormasın); iptal / uygulama değişikliği
 *   önbelleği hemen siler.
 * - Başarısız denemeler IP başına sayılır: dakikada `API_UNAUTHENTICATED_LIMIT` başarısızlıktan sonra o IP'nin
 *   anahtarsız / yanlış anahtarlı istekleri doğrulanmadan 429 alır (anahtar tahmini).
 * - "Son kullanım" en fazla dakikada bir yazılır (her istekte yazma yok; tablo kilitlenmez).
 */

const LAST_USED_WRITE_INTERVAL_MS = 60_000;
const FAILURE_WINDOW_MS = 60_000;
/** Bellekte izlenen en fazla IP (saldırı altında bellek şişmesin; doluysa en eskisi atılır). */
const MAX_TRACKED_IPS = 20_000;

/** @type {Map<string, { count: number, resetAt: number }>} */
const failures = new Map();
/** @type {Map<string, number>} */
const lastUsedWrites = new Map();

/** @param {string} ip */
function failureCount(ip, now) {
  const entry = failures.get(ip);
  if (!entry || entry.resetAt <= now) return 0;
  return entry.count;
}

/** @param {string} ip */
function recordFailure(ip, now) {
  const entry = failures.get(ip);
  if (!entry || entry.resetAt <= now) {
    if (failures.size >= MAX_TRACKED_IPS) failures.delete(failures.keys().next().value);
    failures.set(ip, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
  } else entry.count += 1;
}

/** Testler için. */
export function resetApiAuthState() {
  failures.clear();
  lastUsedWrites.clear();
}

/** @param {string} prefix */
function loadKey(prefix) {
  return cache.getOrSet(
    apiKeyCacheKey(prefix),
    async () =>
      (await prismaUnfiltered.apiKey.findFirst({
        where: { prefix },
        select: {
          id: true,
          hotelId: true,
          clientId: true,
          secretHash: true,
          scopes: true,
          expiresAt: true,
          revokedAt: true,
          client: { select: { id: true, name: true, status: true, deletedAt: true, rateLimitPerMinute: true, bookingStatus: true } },
        },
      })) ?? false,
    API_KEY_CACHE_TTL_MS,
  );
}

/** @param {string} keyId @param {string} ip */
function touchLastUsed(keyId, ip, logger) {
  const now = Date.now();
  if ((lastUsedWrites.get(keyId) ?? 0) + LAST_USED_WRITE_INTERVAL_MS > now) return;
  if (lastUsedWrites.size >= MAX_TRACKED_IPS) lastUsedWrites.delete(lastUsedWrites.keys().next().value);
  lastUsedWrites.set(keyId, now);
  prismaUnfiltered.apiKey
    .updateMany({ where: { id: keyId }, data: { lastUsedAt: new Date(now), lastUsedIp: String(ip).slice(0, 64) } })
    .catch((error) => logger?.warn?.({ err: error, keyId }, 'API anahtarının son kullanımı yazılamadı'));
}

/**
 * İsteğin anahtarını doğrular; geçerliyse çağıranı döner. Hata 401 / 403 / 429.
 * @param {import('fastify').FastifyRequest} request
 * @returns {Promise<import('./service.js').ApiCaller & { rateLimitPerMinute: number, prefix: string }>}
 */
export async function authenticateApiRequest(request) {
  const now = Date.now();
  const ip = request.ip;
  if (failureCount(ip, now) >= API_UNAUTHENTICATED_LIMIT) {
    throw new AppError('Bu adresten çok fazla geçersiz anahtar denemesi geldi; bir dakika bekleyin.', { statusCode: 429, code: 'RATE_LIMITED' });
  }
  const fail = (error) => {
    recordFailure(ip, now);
    return error;
  };

  const header = request.headers.authorization;
  const token = typeof header === 'string' && /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : null;
  if (!token) throw fail(new UnauthorizedError('API anahtarı gerekli: "Authorization: Bearer fhk_…" başlığı'));
  const parsed = parseApiKey(token);
  if (!parsed) throw fail(new UnauthorizedError('API anahtarı geçersiz'));

  const row = await loadKey(parsed.prefix);
  if (!row || !sameHash(row.secretHash, hashApiKey(token))) throw fail(new UnauthorizedError('API anahtarı geçersiz'));
  if (row.revokedAt) throw fail(new UnauthorizedError('API anahtarı iptal edilmiş'));
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= now) throw fail(new UnauthorizedError('API anahtarının süresi dolmuş; panelden yeni anahtar alın'));
  if (!row.client || row.client.deletedAt) throw fail(new UnauthorizedError('API anahtarı geçersiz'));
  if (row.client.status !== 'ACTIVE') throw Object.assign(new ForbiddenError('Uygulama otel tarafından kapatılmış'), { code: 'CLIENT_DISABLED' });

  touchLastUsed(row.id, ip, request.log);
  const caller = {
    keyId: row.id,
    prefix: parsed.prefix,
    clientId: row.clientId,
    clientName: row.client.name,
    hotelId: row.hotelId,
    scopes: row.scopes,
    bookingStatus: row.client.bookingStatus,
    rateLimitPerMinute: row.client.rateLimitPerMinute,
  };
  // Denetim kaydı ve olaylar işlemi yapan uygulamayı göstersin ("api:CRM (fhk_ab12…)").
  const context = getContext();
  if (context) context.actor = `api:${caller.clientName} (fhk_${parsed.prefix})`.slice(0, 120);
  return caller;
}

/**
 * @param {{ scopes: string[] }} caller @param {string | null} scope
 */
export function assertScope(caller, scope) {
  if (scope && !caller.scopes.includes(scope)) {
    throw Object.assign(new ForbiddenError(`Bu anahtarın "${scope}" kapsamı yok`), { code: 'SCOPE_REQUIRED' });
  }
}
