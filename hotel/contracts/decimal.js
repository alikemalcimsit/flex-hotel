/**
 * Ondalık metin normalizasyonu — hem sunucu hem tarayıcı kullanır.
 *
 * Float'a çevirip geri yazmaz: "12345678901234.99" gibi bir değer `Number()`
 * turundan geçtiğinde hassasiyet kaybeder. Burada yalnızca metin üzerinde
 * çalışılıyor.
 */

/**
 * "05.500" → "5.5", "7." → "7", ".5" → "0.5", "-0.000" → "0"
 * @param {string | number} value
 * @returns {string}
 * @throws {Error} sayı olmayan girdi için
 */
export function normalizeDecimalString(value) {
  const trimmed = String(value).trim();
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new Error(`Geçersiz sayı: "${value}"`);
  }
  const sign = match[1] === '-' ? '-' : '';
  const whole = (match[2] ?? '').replace(/^0+(?=\d)/, '') || '0';
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const signed = `${sign}${fraction ? `${whole}.${fraction}` : whole}`;
  // "-0" ve "-0.000" tek bir sıfıra indirgenir; eksi işaretli sıfır saklamıyoruz.
  return signed === '-0' ? '0' : signed;
}
