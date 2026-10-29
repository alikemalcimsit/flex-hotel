import { Decimal, toDecimal } from '@hotelos/core';
import { STOCK_QUANTITY_SCALE } from '@hotelos/hotel-contracts';

/**
 * Stok çekirdeğinin saf kuralları (modül 45; 44 bunların üstüne çıkış / transfer / sayım ekler).
 *
 * Maliyet yöntemi **hareketli ortalama**: her girişte malzemenin birim maliyeti eldeki ve gelen
 * miktarın ağırlıklı ortalamasına çekilir. Maliyet malzeme kartında, otel geneli tek değerdir
 * (depolar arası aynı); çıkışlar (44) maliyeti değiştirmez, yalnız miktarı.
 */

/** Birim maliyet basamağı (malzeme kartı `unitCost` Decimal(14,4)). */
export const STOCK_COST_SCALE = 4;

/**
 * Girişten sonraki birim maliyet.
 *
 * - Elde stok varsa: (eldeki × eski maliyet + gelen × alış fiyatı) ÷ (eldeki + gelen).
 * - Elde stok yoksa ya da eksideyse (44'te sayım farkı / önce çıkış): alış fiyatı — eksi stoğun
 *   eski maliyeti ortalamaya karışırsa maliyet anlamsızlaşır (eksi ağırlık).
 *
 * @param {{ onHand: string | Decimal, unitCost: string | Decimal, quantity: string | Decimal, price: string | Decimal }} input
 * @returns {Decimal} 4 basamağa yuvarlanmış yeni birim maliyet
 */
export function movingAverageCost({ onHand, unitCost, quantity, price }) {
  const held = toDecimal(onHand);
  const incoming = toDecimal(quantity);
  if (!incoming.greaterThan(0)) throw new RangeError('Giriş miktarı 0\'dan büyük olmalı');
  if (!held.greaterThan(0)) return toDecimal(price).toDecimalPlaces(STOCK_COST_SCALE, Decimal.ROUND_HALF_UP);
  const value = held.times(toDecimal(unitCost)).plus(incoming.times(toDecimal(price)));
  return value.dividedBy(held.plus(incoming)).toDecimalPlaces(STOCK_COST_SCALE, Decimal.ROUND_HALF_UP);
}

/**
 * Aynı malzemenin bir belgede birden çok girişi (ör. aynı irsaliyede iki satır) sırayla işlenir:
 * her biri bir öncekinin sonucunu "eldeki" sayar. Hareket satırları bu sırayla yazılır.
 *
 * @param {{ onHand: string | Decimal, unitCost: string | Decimal }} start
 * @param {Array<{ quantity: string | Decimal, price: string | Decimal }>} entries
 * @returns {{ steps: Array<{ onHandAfter: Decimal, avgCostAfter: Decimal }>, onHand: Decimal, unitCost: Decimal }}
 */
export function applyReceipts(start, entries) {
  let onHand = toDecimal(start.onHand);
  let unitCost = toDecimal(start.unitCost);
  const steps = entries.map((entry) => {
    unitCost = movingAverageCost({ onHand, unitCost, quantity: entry.quantity, price: entry.price });
    onHand = onHand.plus(toDecimal(entry.quantity)).toDecimalPlaces(STOCK_QUANTITY_SCALE);
    return { onHandAfter: onHand, avgCostAfter: unitCost };
  });
  return { steps, onHand, unitCost };
}

/**
 * Stok değeri (mevcut × birim maliyet), kuruşa yuvarlı. Eksi mevcut 0 değer sayılır (değer raporu 44).
 * @param {string | Decimal} onHand @param {string | Decimal} unitCost
 */
export function stockValue(onHand, unitCost) {
  const held = toDecimal(onHand);
  if (!held.greaterThan(0)) return toDecimal(0);
  return held.times(toDecimal(unitCost)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
