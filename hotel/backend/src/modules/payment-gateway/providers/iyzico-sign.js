import { createHmac, randomBytes } from 'node:crypto';

/**
 * iyzico imzaları (modül 50). Kaynak: docs.iyzico.com "HMACSHA256 Auth" ve "Response Signature Validation"; iyzipay-node
 * `lib/utils.js` (`generateAuthorizationHeaderV2`, `calculateHmacSHA256Signature`). Resmî test vektörleri `iyzico.test.js`'te.
 */

/** İstek kimlik doğrulaması (IYZWSv2): hex(HMAC-SHA256(secret, randomKey + yol + gövde)) → base64("apiKey:..&randomKey:..&signature:.."). */
export function authorizationHeader({ apiKey, secretKey, path, body, randomKey }) {
  const signature = createHmac('sha256', secretKey).update(randomKey + path + body).digest('hex');
  return `IYZWSv2 ${Buffer.from(`apiKey:${apiKey}&randomKey:${randomKey}&signature:${signature}`).toString('base64')}`;
}

/** İstek başına rastgele anahtar (`x-iyzi-rnd`). */
export const randomKey = () => `${Date.now()}${randomBytes(8).toString('hex')}`;

/**
 * Tutar imza ve karşılaştırma için: sondaki sıfırlar atılır ("10.50" → "10.5", 5.20000000 → "5.2", "10.0" → "10").
 * @param {string | number} value
 */
export function normalizeAmount(value) {
  const text = typeof value === 'number' ? value.toFixed(8) : String(value);
  if (!text.includes('.')) return text;
  return text.replace(/0+$/, '').replace(/\.$/, '');
}

/** Gönderilen tutar (iyzipay-node `formatPrice`): "2480.00" → "2480.0", "15.340000" → "15.34". @param {string} value */
export function formatPrice(value) {
  const normalized = normalizeAmount(value);
  return normalized.includes('.') ? normalized : `${normalized}.0`;
}

/** Cevap imzası: hex(HMAC-SHA256(secret, alanlar ":" ile)). @param {string} secretKey @param {Array<string | number>} fields */
export const responseSignature = (secretKey, fields) => createHmac('sha256', secretKey).update(fields.map(String).join(':')).digest('hex');

/** Checkout Form sonucu imzası alanları (sıra önemli). @param {any} result */
export const retrieveSignatureFields = (result) => [result.paymentStatus, result.paymentId, result.currency, result.basketId, result.conversationId, normalizeAmount(result.paidPrice), normalizeAmount(result.price), result.token];
