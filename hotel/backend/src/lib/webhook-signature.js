import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Webhook imzası ve API anahtarı üretimi (modül 61).
 *
 * İmza: `X-FlexHotel-Signature: t=<unix saniye>,v1=<hex>[,v1=<hex>]`, `HMAC-SHA256(sır, t + "." + ham gövde)`. Zaman
 * imzaya girer: kaydedilmiş bir teslimat sonradan yeniden oynatılırsa alıcı eski zamanı görüp reddeder. Sır
 * yenilenince geçiş süresince eski sırla ikinci imza da gönderilir.
 *
 * Anahtar: `fhk_<12 karakter önek>_<43 karakter sır>`. Önek anahtarı bulmak için (tekil indeks), saklanan yalnız
 * bütün anahtarın SHA-256 özeti. Sır 256 bit rastgele olduğundan yavaş özet (bcrypt) gerekmez; her istekte
 * doğrulandığı için hızlı olması da şart.
 */

/** Alıcı tarafında kabul edilen en eski imza (doküman ve doğrulayıcı). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** @param {string} secret @param {number} timestamp @param {string} body */
export function signWebhook(secret, timestamp, body) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * @param {string[]} secrets geçerli sırlar (yeni önce)
 * @param {number} timestamp unix saniye
 * @param {string} body
 */
export function signatureHeader(secrets, timestamp, body) {
  return [`t=${timestamp}`, ...secrets.map((secret) => `v1=${signWebhook(secret, timestamp, body)}`)].join(',');
}

/**
 * Alıcının yapacağı doğrulama (testler ve doküman örneği bununla aynı).
 * @param {string} header @param {string} body @param {string} secret
 * @param {{ now?: number, toleranceSeconds?: number }} [options] `now` unix saniye
 */
export function verifyWebhookSignature(header, body, secret, { now = Math.floor(Date.now() / 1000), toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS } = {}) {
  if (typeof header !== 'string') return false;
  const parts = header.split(',').map((part) => part.split('='));
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > toleranceSeconds) return false;
  const expected = Buffer.from(signWebhook(secret, timestamp, body));
  return parts.some(([key, value]) => key === 'v1' && typeof value === 'string' && value.length === expected.length && timingSafeEqual(Buffer.from(value), expected));
}

/** Webhook imza sırrı (bir kez gösterilir). */
export const generateWebhookSecret = () => `whsec_${randomBytes(32).toString('base64url')}`;

/** @param {string} token */
export const hashApiKey = (token) => createHash('sha256').update(token).digest('hex');

/** Yeni API anahtarı: metin (bir kez gösterilir), önek (saklanır), özet (saklanır). */
export function generateApiKey() {
  const prefix = [...randomBytes(12)].map((byte) => BASE32[byte & 31]).join('');
  const token = `fhk_${prefix}_${randomBytes(32).toString('base64url')}`;
  return { token, prefix, secretHash: hashApiKey(token) };
}

/** İki özeti sabit sürede karşılaştırır (zamanlama ile özet tahmini olmasın). @param {string} a @param {string} b */
export function sameHash(a, b) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/**
 * `Idempotency-Key`'i rezervasyonun istek kimliğine çevirir: uygulamaya özel (iki uygulamanın aynı anahtarı çakışmaz),
 * deterministik (tekrar gelen istek aynı kimliği bulur), UUID biçiminde.
 * @param {string} clientId @param {string} key
 */
export function idempotencyRequestId(clientId, key) {
  const hex = createHash('sha256').update(`api:${clientId}:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
