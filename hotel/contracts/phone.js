/**
 * Telefon numarası biçimleri.
 *
 * Misafir kartına numara her biçimde yazılabilir ("0532 111 00 01",
 * "+90 532 111 00 01", "532 111 00 01"). Bildirim gönderirken tek bir
 * uluslararası biçime (yalnızca rakam, ülke koduyla: "905321110001") çevrilir.
 * Kural, gelen WhatsApp mesajından misafir bulan eşleştirmeyle aynıdır
 * (backend `messaging/rules.js → phoneMatchScore`):
 *
 * - `+` ya da `00` ile yazılmışsa ülke kodu yazılıdır.
 * - `0` ile başlıyorsa yerel yazımdır; otelin telefon ülke kodu eklenir.
 * - Ülke koduyla başlayan ve ulusal numaradan uzun yazım zaten uluslararasıdır.
 * - Kalanı ülke kodu yazılmamış yerel numara sayılır.
 */

/** E.164: ülke koduyla en fazla 15 rakam. */
const MAX_INTERNATIONAL_DIGITS = 15;

/** Ülke koduyla birlikte en kısa anlamlı numara. */
const MIN_INTERNATIONAL_DIGITS = 8;

/**
 * Ulusal numaranın (ülke kodu hariç) en uzun hâli. Ülke koduyla başlayıp bundan
 * uzun olan yazım uluslararası kabul edilir ("905321110001" → 12 > 10).
 */
const MAX_NATIONAL_DIGITS = 10;

/**
 * @param {string | null | undefined} written kartta yazılı numara
 * @param {string | null | undefined} countryCode otelin telefon ülke kodu ("90")
 * @returns {string | null} uluslararası rakamlar; numara değilse `null`
 */
export function internationalPhone(written, countryCode) {
  const text = String(written ?? '').trim();
  const digits = text.replace(/\D/g, '');
  if (!digits) return null;

  let international;
  if (text.startsWith('+') || digits.startsWith('00')) {
    international = digits.replace(/^0+/, '');
  } else if (digits.startsWith('0')) {
    if (!countryCode) return null;
    international = `${countryCode}${digits.replace(/^0+/, '')}`;
  } else if (countryCode && digits.startsWith(countryCode) && digits.length > MAX_NATIONAL_DIGITS) {
    international = digits;
  } else {
    if (!countryCode) return null;
    international = `${countryCode}${digits}`;
  }

  if (international.length < MIN_INTERNATIONAL_DIGITS || international.length > MAX_INTERNATIONAL_DIGITS) return null;
  return international;
}

/**
 * Ekranda gösterim: "+90 532 111 00 01" gibi ayrıntılı biçimlendirme ülkeye
 * göre değişir; burada yalnızca "+" ile uluslararası yazım verilir.
 *
 * @param {string | null | undefined} international
 */
export function displayPhone(international) {
  return international ? `+${international}` : '';
}
