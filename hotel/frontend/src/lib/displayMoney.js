import { convertFromHotelCurrency } from '@hotelos/hotel-contracts';
import { formatMoney } from './format.js';

/**
 * Gösterim para birimi (modül 60): kayıtlar otelin para biriminde kalır; kullanıcı bir döviz seçtiyse tutarların
 * yanında güncel kurdan yaklaşık karşılık gösterilir. Saf yardımcılar — React tarafı `useDisplayCurrency`, `MoneyText`.
 */

/**
 * `GET /exchange-rates/current` cevabından gösterim bilgisi; seçim yoksa, döviz otelin kendi parasıysa ya da kullanılabilir
 * kur yoksa null (karşılık gösterilmez).
 * @param {string | null | undefined} displayCurrency
 * @param {{ hotelCurrency: string, rates: Array<{ currency: string, rate: string, date: string, usable: boolean }> } | null | undefined} current
 * @returns {{ currency: string, hotelCurrency: string, rate: string, date: string } | null}
 */
export function resolveDisplay(displayCurrency, current) {
  if (!displayCurrency || !current?.rates) return null;
  if (displayCurrency === current.hotelCurrency) return null;
  const row = current.rates.find((entry) => entry.currency === displayCurrency);
  if (!row || row.usable === false || !Number(row.rate)) return null;
  return { currency: displayCurrency, hotelCurrency: current.hotelCurrency, rate: row.rate, date: row.date };
}

/**
 * Yaklaşık karşılık metni ("48,97 EUR") ya da null. Tutar otelin para biriminde değilse (ör. döviz ödemesi) çevrilmez.
 * @param {string | number | null | undefined} amount
 * @param {string | null | undefined} amountCurrency tutarın para birimi (boşsa otelinki sayılır)
 * @param {ReturnType<typeof resolveDisplay>} display
 * @returns {string | null}
 */
export function formatApprox(amount, amountCurrency, display) {
  if (!display || amount === null || amount === undefined || amount === '') return null;
  if (amountCurrency && amountCurrency !== display.hotelCurrency) return null;
  const converted = convertFromHotelCurrency(amount, display.rate);
  return converted === null ? null : formatMoney(converted, display.currency);
}

/**
 * Tek satırlık metin: "1.250,00 TRY (≈ 25,42 EUR)"; karşılık yoksa yalnız tutar. Metin gereken yerler için (title,
 * dışa aktarım, toast); ekranda `MoneyText` tercih edin.
 * @param {string | number | null | undefined} amount @param {string} [currency] @param {ReturnType<typeof resolveDisplay>} [display]
 */
export function formatMoneyWithDisplay(amount, currency = '', display = null) {
  const base = formatMoney(amount, currency);
  const approx = formatApprox(amount, currency, display);
  return approx ? `${base} (≈ ${approx})` : base;
}
