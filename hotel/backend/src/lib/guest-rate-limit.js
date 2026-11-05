import { AppError } from './errors.js';

/**
 * Oturumsuz misafir uçlarının hız sınırı (bağlantı belirteçli: oda servisi 41, misafir portalı 53) — iki katman.
 *
 * - **Bağlantı başına** (uç başına `max`, `guestLinkLimit`): sayaç belirtecin bağlantı kimliğidir. Otel Wi-Fi'ı yüzlerce
 *   misafiri tek NAT adresinden çıkarır; sınır yalnızca IP'ye göre olursa lobideki misafirler birbirinin kotasını yer
 *   (2500 kişilik otelde akşam folyosuna bakan 60 misafir = herkese 429).
 * - **IP başına tavan** (`applyGuestIpCeiling`, kaydedildiği kapsamdaki bütün misafir uçlarının toplamı): bağlantı
 *   kimliğini değiştirerek bağlantı sınırından kaçan rastgele belirteç denemesini durdurur. Tavan, tek NAT arkasındaki
 *   kalabalık bir otelin gerçek trafiğine göre yüksek tutulur; denemelerin her biri tek birincil anahtar okumasıdır ve
 *   imza 256 bit olduğundan tahmin edilemez.
 *
 * Genel sınırın anahtarındaki `x-actor` başlığı burada kullanılmaz (misafirin elinde; değiştirerek sınırdan kaçmasın).
 */

/** Bir IP'den kapsamdaki bütün misafir uçlarına dakikada en fazla istek (tek NAT arkasında ~2500 misafir). */
export const GUEST_IP_CEILING = 3000;
/** Anahtara giren bağlantı kimliğinin üst boyu (şema doğrulaması `onRequest`'ten sonra gelir; uzun yol belleği şişirmesin). */
const LINK_KEY_MAX = 64;
const WINDOW = '1 minute';

/**
 * Sayaç anahtarı: belirtecin bağlantı kimliği (imza kısmı anahtara girmez). Yolda belirteç yoksa IP.
 * @param {{ ip: string, params?: unknown }} request
 */
export function guestLinkKey(request) {
  const token = /** @type {{ token?: unknown }} */ (request.params ?? {}).token;
  const linkId = typeof token === 'string' ? token.split('.')[0].slice(0, LINK_KEY_MAX) : '';
  return linkId ? `link|${linkId}` : `ip|${request.ip}`;
}

/**
 * Uç başına bağlantı sınırı (route seçeneği).
 * @param {number} max dakikada
 */
export const guestLinkLimit = (max) => ({ config: { rateLimit: { max, timeWindow: WINDOW, keyGenerator: guestLinkKey } } });

/**
 * Kapsama IP tavanını bağlar (`onRequest`). Misafir uç eklentilerini kapsayan eklentide bir kez çağrılır; sayaç kapsamdaki
 * bütün uçlarda ortaktır.
 *
 * @param {import('fastify').FastifyInstance} app `@fastify/rate-limit` kayıtlı uygulamanın alt kapsamı
 * @param {{ max?: number }} [options]
 */
export function applyGuestIpCeiling(app, { max = GUEST_IP_CEILING } = {}) {
  const check = app.createRateLimit({ max, timeWindow: WINDOW, keyGenerator: (request) => `ip|${request.ip}` });
  app.addHook('onRequest', async (request, reply) => {
    const limit = await check(request);
    if (limit.isAllowed || !limit.isExceeded) return;
    reply.header('retry-after', String(limit.ttlInSeconds));
    throw new AppError('Bu ağdan çok fazla istek geldi. Lütfen biraz bekleyip tekrar deneyin.', { statusCode: 429, code: 'RATE_LIMITED' });
  });
}
