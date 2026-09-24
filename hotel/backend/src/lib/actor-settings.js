import { prismaUnfiltered } from '../db.js';
import { cache } from './cache.js';

/**
 * Aktörün otel bazındaki açık/kapalı ayarı (modül 12).
 *
 * İki okuma yolu var:
 *
 * - **Aktörün kendisi** (`readActorEnabled`): her olayda veritabanından okur.
 *   Kapatma anında geçerli olmalı; tek satırlık, tekil index'li bir sorgu.
 * - **Sık soran ekranlar ve kurallar** (`isActorEnabledCached`): ör. "bu
 *   otelde AI misafire cevap verir mi" her gelen mesajda ve gelen kutusunun
 *   her açılışında sorulur. Kısa süre önbelleklenir; kapatınca bu süreçte
 *   hemen silinir, başka süreçlerde en geç `CACHE_TTL_MS` sonra yenilenir
 *   (bu arada gelen iş yine aktörün kendi okumasına takılıp personele düşer).
 *
 * Satır yoksa aktör açıktır: yeni bir aktör kimse ayar girmeden çalışsın.
 */

const CACHE_TTL_MS = 30_000;
const cacheKey = (hotelId, actorName) => `actors:${hotelId}:${actorName}`;

/**
 * @param {string | null | undefined} hotelId
 * @param {string} actorName
 */
export async function readActorEnabled(hotelId, actorName) {
  if (!hotelId) return false;
  const setting = await prismaUnfiltered.actorSetting.findFirst({
    where: { hotelId, actorName, deletedAt: null },
    select: { enabled: true },
  });
  return setting?.enabled ?? true;
}

/**
 * @param {string} hotelId
 * @param {string} actorName
 * @returns {Promise<boolean>}
 */
export function isActorEnabledCached(hotelId, actorName) {
  return cache.getOrSet(cacheKey(hotelId, actorName), () => readActorEnabled(hotelId, actorName), CACHE_TTL_MS);
}

/** Açma/kapama sonrası (commit'ten sonra). @param {string} hotelId */
export function invalidateActorSettings(hotelId) {
  cache.invalidatePrefix(`actors:${hotelId}:`);
}
