import { randomInt } from 'node:crypto';

/**
 * İnsanın okuyup söyleyebileceği kayıt numaraları: "MB-7K2Q9X" (minibar fişi),
 * "LND-3XH8PA" (çamaşır siparişi), "LF-9QW4ZT" (kayıp eşya etiketi).
 *
 * Karışan karakterler (0/O, 1/I/L) yok: telefonda okunur, poşetin üstüne elle
 * yazılır. Otel içinde tekilliği veritabanı kısıtı korur; çakışma olasılığı
 * 31⁶'da bir, üreten servis birkaç kez dener.
 */

const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const REFERENCE_LENGTH = 6;

/**
 * @param {string} prefix "MB", "LND", "LF"
 */
export function newReference(prefix) {
  let code = '';
  for (let index = 0; index < REFERENCE_LENGTH; index += 1) code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `${prefix}-${code}`;
}

/**
 * Aramadaki kelime bu önekli bir numara mı? Önekli ("LF-9QW4ZT") ya da öneksiz
 * ("9qw4zt") yazılabilir; numaranın tam hâlini döndürür, değilse `null`.
 * @param {string} prefix
 * @param {string} token
 * @returns {string | null}
 */
export function referenceFromToken(prefix, token) {
  const pattern = new RegExp(`^(${prefix}-)?[A-Z0-9]{${REFERENCE_LENGTH}}$`, 'i');
  if (!pattern.test(token)) return null;
  return `${prefix}-${token.toUpperCase().replace(new RegExp(`^${prefix}-`), '')}`;
}
