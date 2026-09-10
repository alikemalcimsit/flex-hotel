import { BOARD_TYPE_LABELS, TAX_APPLIES_TO_LABELS } from '@hotelos/hotel-contracts';

/**
 * Görüntüleme biçimlendiricileri.
 *
 * Dikkat: bu fonksiyonlar yalnızca **ekranda göstermek** içindir. Backend'den
 * gelen para/oran değerleri string'dir ve öyle kalır; burada `Number()`
 * çağrılıyorsa sebebi sadece binlik ayracı basmaktır. Hesap yapılacaksa
 * sunucuda, `@hotelos/core`'daki `money.js` ile yapılır.
 *
 * Etiketler contracts paketinden geliyor — açılır listedeki seçenekle şemanın
 * kabul ettiği değerin ayrışmaması için.
 */

export { BOARD_TYPE_LABELS, TAX_APPLIES_TO_LABELS };

const numberFormatter = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * @param {string | number | null | undefined} value Decimal string
 * @param {string} [currency] ISO kodu
 */
export function formatMoney(value, currency = '') {
  if (value === null || value === undefined || value === '') return '—';
  const formatted = numberFormatter.format(Number(value));
  return currency ? `${formatted} ${currency}` : formatted;
}

/**
 * Oran gösterimi: "10" → "%10", "8.5" → "%8,5"
 * @param {string | number | null | undefined} value
 */
export function formatPercent(value) {
  if (value === null || value === undefined || value === '') return '—';
  return `%${String(value).replace('.', ',')}`;
}

/**
 * Çarpan gösterimi: "1.3" → "1,3×"
 * @param {string | number | null | undefined} value
 */
export function formatMultiplier(value) {
  if (value === null || value === undefined || value === '') return '—';
  return `${String(value).replace('.', ',')}×`;
}

/**
 * @param {string | Date | null | undefined} value ISO tarih
 */
export function formatDate(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}
