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

/* ─────────────── Modül 44: çıkış / transfer / sayım / satış düşümü ─────────────── */

/**
 * Giriş dışı hareketin (çıkış, fire, transfer, sayım farkı, satış) mevcuda etkisi: miktar işaretli eklenir,
 * **birim maliyet değişmez** (hareketli ortalama yalnız girişte güncellenir; çıkış o anki ortalamayla değerlenir).
 *
 * @param {{ onHand: string | Decimal, unitCost: string | Decimal }} start
 * @param {string | Decimal} quantity işaretli (çıkışta eksi)
 * @returns {{ onHand: Decimal, unitCost: Decimal, totalCost: Decimal }} yeni mevcut, (aynı) maliyet, hareketin işaretli tutarı
 */
export function applyDelta(start, quantity) {
  const delta = toDecimal(quantity);
  if (delta.isZero()) throw new RangeError('Hareket miktarı 0 olamaz');
  const unitCost = toDecimal(start.unitCost);
  return {
    onHand: toDecimal(start.onHand).plus(delta).toDecimalPlaces(STOCK_QUANTITY_SCALE),
    unitCost,
    totalCost: delta.times(unitCost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
  };
}

/**
 * Sayım farkı: sayılan − onay anındaki depo mevcudu (onayda depo o kadar düzeltilir). Sayılmayan satır (null) fark
 * üretmez; sıfır fark hareket üretmez.
 *
 * @param {string | Decimal | null} counted
 * @param {string | Decimal} current
 * @returns {Decimal | null}
 */
export function countDifference(counted, current) {
  if (counted === null || counted === undefined || counted === '') return null;
  const diff = toDecimal(counted).minus(toDecimal(current)).toDecimalPlaces(STOCK_QUANTITY_SCALE);
  return diff.isZero() ? null : diff;
}

/**
 * Kapanan adisyonun malzeme ihtiyacı: ürün başına (satılan + ikram + zayi) × reçetenin birim ihtiyacı, stok
 * biriminde, binde bire yuvarlı (yukarı değil — tüketim ölçümü). Reçetesi olmayan ürün `skipped`'a düşer.
 *
 * @param {Array<{ menuItemId: string, name: string, sold: number, comped: number, wasted: number }>} items
 * @param {Map<string, { recipeId: string, perUnit: Map<string, Decimal> }>} recipesByMenuItem menü ürünü → reçetenin verim birimi başına malzeme ihtiyacı
 * @returns {{ required: Map<string, Decimal>, skipped: string[] }} anahtar `${menuItemId}:${stockItemId}`
 */
export function saleRequirements(items, recipesByMenuItem) {
  /** @type {Map<string, Decimal>} */
  const required = new Map();
  const skipped = [];
  for (const item of items) {
    const portions = toDecimal(item.sold + item.comped + item.wasted);
    if (!portions.greaterThan(0)) continue;
    const recipe = recipesByMenuItem.get(item.menuItemId);
    if (!recipe) {
      skipped.push(item.name);
      continue;
    }
    for (const [stockItemId, perUnit] of recipe.perUnit) {
      const quantity = toDecimal(perUnit).times(portions).toDecimalPlaces(STOCK_QUANTITY_SCALE, Decimal.ROUND_HALF_UP);
      if (quantity.isZero()) continue;
      const key = `${item.menuItemId}:${stockItemId}`;
      required.set(key, (required.get(key) ?? new Decimal(0)).plus(quantity));
    }
  }
  return { required, skipped };
}

/**
 * Yeniden yayınlanan adisyon (yeniden açılıp kapanmış) için düzeltme: hedef tüketim − daha önce düşülen. Sonuç
 * işaretli **hareket** miktarıdır (tüketim artınca eksi, azalınca artı). Sıfır fark hareket üretmez.
 *
 * @param {Map<string, Decimal>} required anahtar `${menuItemId}:${stockItemId}`, tüketilecek (pozitif)
 * @param {Map<string, Decimal>} consumed aynı anahtarla daha önce düşülen (pozitif)
 * @returns {Array<{ key: string, menuItemId: string, stockItemId: string, quantity: Decimal }>}
 */
export function saleDeltas(required, consumed) {
  const keys = new Set([...required.keys(), ...consumed.keys()]);
  const deltas = [];
  for (const key of keys) {
    const target = required.get(key) ?? new Decimal(0);
    const done = consumed.get(key) ?? new Decimal(0);
    const quantity = done.minus(target).toDecimalPlaces(STOCK_QUANTITY_SCALE);
    if (quantity.isZero()) continue;
    const [menuItemId, stockItemId] = key.split(':');
    deltas.push({ key, menuItemId, stockItemId, quantity });
  }
  return deltas.sort((a, b) => a.key.localeCompare(b.key));
}
