import { subtract, sum, toDecimal, toMoneyString } from '@hotelos/core';

/**
 * Gün kapanışının saf hesapları (modül 18). Veritabanı yok: birim testlenir.
 */

/** Tüm ödeme yöntemleri (kasa sayımı satırları bunlarla açılır). */
export const CASH_METHODS = Object.freeze(['CASH', 'CARD', 'TRANSFER', 'VIRTUAL_POS', 'AGENCY', 'VOUCHER']);

/**
 * Doluluk yüzdesi (satılan / satılabilir × 100). Satılabilir 0 ise 0.
 * @param {number} sold @param {number} sellable
 * @returns {string} iki ondalık, "0.00"–"100.00"
 */
export function occupancyPct(sold, sellable) {
  if (!sellable || sellable <= 0) return '0.00';
  return toMoneyString(toDecimal(sold).div(sellable).times(100));
}

/**
 * ADR: satılan oda başına oda geliri (satılan 0 ise 0).
 * @param {string | number} roomRevenue @param {number} sold
 */
export function adr(roomRevenue, sold) {
  if (!sold || sold <= 0) return '0.00';
  return toMoneyString(toDecimal(roomRevenue).div(sold));
}

/**
 * RevPAR: satılabilir oda başına oda geliri (satılabilir 0 ise 0).
 * @param {string | number} roomRevenue @param {number} sellable
 */
export function revpar(roomRevenue, sellable) {
  if (!sellable || sellable <= 0) return '0.00';
  return toMoneyString(toDecimal(roomRevenue).div(sellable));
}

/**
 * Kasa sayımını uzlaştırır: her yöntem için beklenen (sistem) − sayılan = fark.
 * Sayılmayan yöntem için sayılan 0 varsayılır. Fark artı = kasada fazla.
 *
 * @param {Array<{ method: string, expected: string }>} expectedByMethod
 * @param {Array<{ method: string, counted: string }>} countedByMethod
 * @returns {{ counts: Array<{ method: string, expected: string, counted: string, variance: string }>, expectedTotal: string, countedTotal: string, variance: string }}
 */
export function reconcileCash(expectedByMethod, countedByMethod) {
  const countedMap = new Map(countedByMethod.map((row) => [row.method, row.counted]));
  const expectedMap = new Map(expectedByMethod.map((row) => [row.method, row.expected]));
  const methods = CASH_METHODS.filter((method) => expectedMap.has(method) || countedMap.has(method));

  const counts = methods.map((method) => {
    const expected = toMoneyString(expectedMap.get(method) ?? '0');
    const counted = toMoneyString(countedMap.get(method) ?? '0');
    return { method, expected, counted, variance: toMoneyString(subtract(counted, expected)) };
  });

  const expectedTotal = toMoneyString(sum(...counts.map((row) => row.expected)));
  const countedTotal = toMoneyString(sum(...counts.map((row) => row.counted)));
  return { counts, expectedTotal, countedTotal, variance: toMoneyString(subtract(countedTotal, expectedTotal)) };
}
