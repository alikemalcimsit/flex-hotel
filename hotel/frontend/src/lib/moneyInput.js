/**
 * Para girişi (ızgara hücreleri): ekranda Türkçe biçim, sunucuya düz ondalık metin.
 * Bütçe ızgarası (modül 27) ve kontrat fiyat tablosu (modül 29) ortak kullanır.
 */

const moneyFormatter = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * Hücrenin görünen hali: "1234.5" → "1.234,5"; boş → "".
 * @param {string | null | undefined} value
 */
export function cellText(value) {
  return value === null || value === undefined || value === '' ? '' : moneyFormatter.format(Number(value));
}

/**
 * Kullanıcının yazdığı hücre → sunucu biçimi: "1.234,50" / "1234.5" / "1 234" →
 * "1234.50"-benzeri metin; boş → null. Geçersiz metin olduğu gibi döner
 * (doğrulama sözleşmede, hata hücrenin yanında gösterilir).
 * @param {string} text
 */
export function parseCell(text) {
  const trimmed = String(text ?? '').trim().replace(/\s/g, '');
  if (!trimmed) return null;
  // Türkçe biçim: nokta binlik, virgül ondalık. Yalnızca nokta varsa ve 3 haneli gruplarsa binliktir.
  if (trimmed.includes(',')) return trimmed.replace(/\./g, '').replace(',', '.');
  if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) return trimmed.replace(/\./g, '');
  return trimmed;
}
