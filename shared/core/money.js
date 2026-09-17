import Decimal from 'decimal.js';

/**
 * Para ve oran aritmetiği.
 *
 * Neden ayrı bir katman: değerleri API'de string olarak taşımak yarım çözümdür —
 * biri `Number(basePrice) * nights` yazdığı anda kayan nokta geri gelir ve
 * ay sonunda mizan birkaç kuruş tutmaz. Hesap yapılacaksa buradan yapılır.
 *
 * Modül 4 (rezervasyon fiyatı), 15 (folyo), 16 (fatura), 17 (ödeme) bu
 * fonksiyonları kullanmalı; `Number()` ile çarpma yapmamalı.
 */

// 20 anlamlı basamak, otel fiyatları için fazlasıyla yeterli.
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/** Para alanlarının ondalık basamak sayısı (şemadaki Decimal(12,2) ile hizalı). */
export const MONEY_SCALE = 2;

/**
 * @param {string | number | Decimal} value
 * @returns {Decimal}
 */
export function toDecimal(value) {
  try {
    return new Decimal(typeof value === 'number' ? String(value) : value);
  } catch {
    throw new TypeError(`Sayıya çevrilemedi: ${JSON.stringify(value)}`);
  }
}

/**
 * Çarpım. Zincirleme çarpımlarda ara yuvarlama yapılmaz — yalnızca sonda.
 * @param {...(string | number | Decimal)} values
 * @returns {Decimal}
 */
export function multiply(...values) {
  return values.reduce((acc, value) => acc.times(toDecimal(value)), new Decimal(1));
}

/**
 * @param {...(string | number | Decimal)} values
 * @returns {Decimal}
 */
export function sum(...values) {
  return values.reduce((acc, value) => acc.plus(toDecimal(value)), new Decimal(0));
}

/**
 * @param {string | number | Decimal} a
 * @param {string | number | Decimal} b
 * @returns {Decimal}
 */
export function subtract(a, b) {
  return toDecimal(a).minus(toDecimal(b));
}

/**
 * Yüzde hesabı: `percentOf('1000', '18')` → 180
 * @param {string | number | Decimal} value
 * @param {string | number | Decimal} percent
 * @returns {Decimal}
 */
export function percentOf(value, percent) {
  return toDecimal(value).times(toDecimal(percent)).dividedBy(100);
}

/**
 * Veritabanına/HTTP'ye yazılacak nihai değer. Yuvarlama **yalnızca burada**
 * yapılır; ara adımlarda yuvarlamak hata biriktirir.
 * @param {string | number | Decimal} value
 * @param {number} [scale]
 * @returns {string}
 */
export function toMoneyString(value, scale = MONEY_SCALE) {
  return toDecimal(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed(scale);
}

/**
 * @param {string | number | Decimal} a
 * @param {string | number | Decimal} b
 * @returns {boolean}
 */
export function isEqual(a, b) {
  return toDecimal(a).equals(toDecimal(b));
}

/**
 * @param {string | number | Decimal} value
 * @returns {boolean}
 */
export function isZero(value) {
  return toDecimal(value).isZero();
}

export { Decimal };
