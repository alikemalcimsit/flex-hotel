import { BOARD_TYPE_LABELS, TAX_APPLIES_TO_LABELS } from '@hotelos/hotel-contracts';
import { getCurrentLocale, getIntlLocale, setCurrentLocale } from '../i18n/current.js';

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

/**
 * Biçimlendiriciler etkin arayüz dilinde (modül 60: tr-TR / en-GB). Dil modül düzeyinde: `I18nProvider` değiştirir;
 * React dışından (test, yardımcı) `setFormatLocale('en')` ile de ayarlanabilir. İmzalar değişmedi.
 */
export function setFormatLocale(locale) {
  return setCurrentLocale(locale);
}

/** @returns {string} 'tr' | 'en' */
export function getFormatLocale() {
  return getCurrentLocale();
}

/** @type {Map<string, Intl.NumberFormat | Intl.DateTimeFormat>} */
const cache = new Map();

/**
 * @param {'number' | 'date'} kind @param {string} name @param {object} options
 */
function cached(kind, name, options) {
  const locale = getIntlLocale();
  const key = `${kind}|${name}|${locale}`;
  if (!cache.has(key)) cache.set(key, kind === 'number' ? new Intl.NumberFormat(locale, options) : new Intl.DateTimeFormat(locale, options));
  return cache.get(key);
}

const MONEY_OPTIONS = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const DATE_OPTIONS = { day: '2-digit', month: 'short', year: 'numeric' };
const numberFormatter = () => cached('number', 'money', MONEY_OPTIONS);
const dateFormatter = () => cached('date', 'date', DATE_OPTIONS);

/**
 * Gün hassasiyetli değerler ("2026-10-15") saat dilimi taşımaz; tarayıcının
 * yerel saatiyle biçimlendirilirse UTC'nin gerisindeki bir bölgede bir gün
 * önce görünür. Bu yüzden UTC ile basılır.
 */
const dayOnlyFormatter = () => cached('date', 'dayOnly', { ...DATE_OPTIONS, timeZone: 'UTC' });
const DAY_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Dilin ondalık ayracı ("," / "."). */
function decimalText(value) {
  return getCurrentLocale() === 'tr' ? String(value).replace('.', ',') : String(value);
}

/**
 * @param {string | number | null | undefined} value Decimal string
 * @param {string} [currency] ISO kodu
 */
export function formatMoney(value, currency = '') {
  if (value === null || value === undefined || value === '') return '—';
  const formatted = numberFormatter().format(Number(value));
  return currency ? `${formatted} ${currency}` : formatted;
}

/**
 * Oran gösterimi: "10" → "%10", "8.5" → "%8,5" (İngilizcede "8.5%")
 * @param {string | number | null | undefined} value
 */
export function formatPercent(value) {
  if (value === null || value === undefined || value === '') return '—';
  return getCurrentLocale() === 'tr' ? `%${decimalText(value)}` : `${decimalText(value)}%`;
}

/**
 * Çarpan gösterimi: "1.3" → "1,3×"
 * @param {string | number | null | undefined} value
 */
export function formatMultiplier(value) {
  if (value === null || value === undefined || value === '') return '—';
  return `${decimalText(value)}×`;
}

const dateTimeFormatter = () => cached('date', 'dateTime', { ...DATE_OPTIONS, hour: '2-digit', minute: '2-digit' });

/**
 * Tarih ve saat ("03 Kas 2026 14:05"; tarayıcının saat diliminde).
 * @param {string | Date | null | undefined} value ISO zaman
 */
export function formatDateTime(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter().format(date);
}

/**
 * @param {string | Date | null | undefined} value ISO tarih
 */
export function formatDate(value) {
  if (!value) return '—';
  if (typeof value === 'string' && DAY_ONLY_PATTERN.test(value)) {
    return dayOnlyFormatter().format(new Date(`${value}T00:00:00.000Z`));
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter().format(date);
}
