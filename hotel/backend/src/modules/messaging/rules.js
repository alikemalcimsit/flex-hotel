import { MESSAGE_PREVIEW_LENGTH } from '@hotelos/hotel-contracts';

/**
 * Gelen kutusunun saf kuralları — veritabanı ve HTTP bilmez.
 *
 * - İmleç: binlerce konuşmada sayfa numarası yerine "şu kayıttan sonrası".
 *   Yeni mesaj gelip liste kaysa bile aynı kayıt iki kez görünmez.
 * - Özet: listede her satır için mesaj tablosuna gitmemek için son mesajın
 *   kısaltılmış hâli konuşmada saklanır.
 * - Telefon eşleştirme: kanalın bildirdiği numarayla misafir kartındaki numara
 *   aynı biçimde yazılmamış olabilir (+90, 0090, boşluk).
 */

const CURSOR_SEPARATOR = '|';
const ELLIPSIS = '…';

/**
 * @param {{ at: Date, id: string }} position sıralama anahtarı (zaman + kimlik)
 * @returns {string}
 */
export function encodeCursor({ at, id }) {
  return Buffer.from(`${at.toISOString()}${CURSOR_SEPARATOR}${id}`, 'utf8').toString('base64url');
}

/**
 * Bozuk ya da elle değiştirilmiş imleç `null` döner; çağıran bunu doğrulama
 * hatasına çevirir (500 değil).
 *
 * @param {string | undefined | null} value
 * @returns {{ at: Date, id: string } | null}
 */
export function decodeCursor(value) {
  if (!value) return null;
  let decoded;
  try {
    decoded = Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const separator = decoded.lastIndexOf(CURSOR_SEPARATOR);
  if (separator <= 0) return null;
  const at = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { at, id };
}

/**
 * "Bu konumdan daha eski" filtresi — (zaman, kimlik) azalan sırası için.
 * Aynı milisaniyede yazılmış iki kayıt kimlikle ayrılır.
 *
 * @param {string} timeField
 * @param {{ at: Date, id: string }} cursor
 */
export function olderThan(timeField, cursor) {
  return {
    OR: [{ [timeField]: { lt: cursor.at } }, { [timeField]: cursor.at, id: { lt: cursor.id } }],
  };
}

/**
 * Liste satırındaki son mesaj: satır sonları ve fazla boşluklar tek boşluğa
 * iner, uzun metin kesilir.
 *
 * @param {string} text
 * @param {number} [max]
 */
export function messagePreview(text, max = MESSAGE_PREVIEW_LENGTH) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`;
}

/**
 * Aday kartları bulmakta kullanılan son rakam sayısı. Ulusal numaralar hemen
 * her ülkede en az bu uzunlukta; kesin karar `phoneMatchScore`'da verilir.
 * Veritabanındaki ifade dizini de aynı sayıyı kullanır (`Guest_phone_match_idx`).
 */
export const PHONE_MATCH_DIGITS = 7;

/** Rakamlar; baştaki sıfırlar (yerel "0", uluslararası "00") atılmış. */
function significantDigits(value) {
  return String(value ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

/**
 * Kanal adresinin arama anahtarı: son `PHONE_MATCH_DIGITS` rakam.
 *
 * @param {string} address
 * @returns {string | null} telefon değilse (web chat oturumu, kısa kod) `null`
 */
export function phoneMatchKey(address) {
  const digits = significantDigits(address);
  return digits.length >= PHONE_MATCH_DIGITS ? digits.slice(-PHONE_MATCH_DIGITS) : null;
}

/**
 * Karttaki numara kanaldan gelen numara mı; ne kadar kesin?
 *
 * Kanal numarayı ülke koduyla gönderir ("905321110001"). Kartta:
 * - `+` ya da `00` ile yazılmışsa ülke kodu bellidir → birebir karşılaştırılır (`2`).
 * - `0` ile ya da ülke kodu olmadan yazılmışsa ("0532 111 00 01",
 *   "532 111 00 01") otelin telefon ülke koduyla tamamlanır (`1`).
 * - Aksi hâlde eşleşmez (`0`). Son rakamları aynı ama ülkesi farklı iki numara
 *   ("+1 533 222 3344" ↔ kartta "0533 222 33 44", otel TR) ayrılır: yanlış
 *   misafire bağlanmak (başkasının odası, başkasının adı) hiç bağlanmamaktan
 *   kötüdür.
 *
 * @param {string | null | undefined} stored kartta yazılı olan
 * @param {string} incoming kanaldan gelen (uluslararası)
 * @param {string | null | undefined} countryCode otelin telefon ülke kodu ("90")
 * @returns {0 | 1 | 2}
 */
export function phoneMatchScore(stored, incoming, countryCode) {
  const target = significantDigits(incoming);
  const written = String(stored ?? '').trim();
  const digits = written.replace(/\D/g, '');
  if (target.length < PHONE_MATCH_DIGITS || digits.length < PHONE_MATCH_DIGITS) return 0;

  if (written.startsWith('+') || digits.startsWith('00')) {
    return digits.replace(/^0+/, '') === target ? 2 : 0;
  }
  if (!digits.startsWith('0') && digits === target) return 2;
  if (!countryCode) return 0;
  return `${countryCode}${digits.replace(/^0+/, '')}` === target ? 1 : 0;
}

/** @param {string} address */
export function normalizeEmail(address) {
  const value = String(address ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ? value : null;
}

/**
 * Teslim durumu yalnızca ileri gider: "okundu" bilgisi gelmişken geç kalan
 * "gönderildi" bildirimi durumu geri almamalı. Hata, henüz iletilmemiş mesaj
 * için geçerlidir.
 *
 * @param {string} current
 * @param {string} next
 * @returns {boolean}
 */
export function deliveryAdvances(current, next) {
  const order = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3 };
  if (next === 'FAILED') return current === 'PENDING' || current === 'SENT';
  if (current === 'FAILED') return next !== 'PENDING';
  return (order[next] ?? -1) > (order[current] ?? -1);
}
