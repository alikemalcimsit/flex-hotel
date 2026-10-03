import { randomInt } from 'node:crypto';
import { toDecimal, toMoneyString } from '@hotelos/core';
import { MINIBAR_LATE_CHARGE_HOURS } from '@hotelos/hotel-contracts';

/**
 * Minibar ve çamaşırhanenin saf kuralları (modül 19): veritabanı bilmez,
 * birim testli. Para `@hotelos/core` → `money.js` ile; yuvarlama sonda,
 * kuruşa, yarım yukarı.
 */

/** Fiş / sipariş numarasında kullanılan harfler: karışan karakterler (0/O, 1/I/L) yok. */
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const REFERENCE_LENGTH = 6;

/**
 * İnsanın okuyup söyleyebileceği numara: "MB-7K2Q9X", "LND-3XH8PA".
 * Otel içinde tekil (veritabanı kısıtı); çakışma olasılığı 31⁶'da bir.
 * @param {'MB' | 'LND'} prefix
 */
export function newReference(prefix) {
  let code = '';
  for (let index = 0; index < REFERENCE_LENGTH; index += 1) code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `${prefix}-${code}`;
}

/**
 * Satır toplamları: satır = birim × adet; toplam = Σ satır.
 * @param {Array<{ unitPrice: string, quantity: number }>} lines
 * @returns {{ lines: Array<{ unitPrice: string, quantity: number, total: string }>, total: string, itemCount: number }}
 */
export function lineTotals(lines) {
  let total = toDecimal(0);
  let itemCount = 0;
  const priced = lines.map((line) => {
    const lineTotal = toDecimal(line.unitPrice).times(line.quantity);
    total = total.plus(lineTotal);
    itemCount += line.quantity;
    return { ...line, total: toMoneyString(lineTotal) };
  });
  return { lines: priced, total: toMoneyString(total), itemCount };
}

/**
 * Çamaşır siparişinin tutarı: ara toplam = Σ satır; ekspres farkı = ara
 * toplam × yüzde (kuruşa yuvarlanır); toplam = ara toplam + fark. Ekspres
 * değilse fark ve yüzde sıfır (sipariş anındaki yüzde saklanır).
 *
 * @param {{ lines: Array<{ unitPrice: string, quantity: number }>, express: boolean, expressPct: string }} input
 */
export function laundryTotals({ lines, express, expressPct }) {
  const base = lineTotals(lines);
  const pct = express ? toDecimal(expressPct) : toDecimal(0);
  const surcharge = toMoneyString(toDecimal(base.total).times(pct).dividedBy(100));
  return {
    lines: base.lines,
    itemCount: base.itemCount,
    subtotal: base.total,
    expressPct: toMoneyString(pct),
    surcharge,
    total: toMoneyString(toDecimal(base.total).plus(toDecimal(surcharge))),
  };
}

/**
 * Sayım düzeltmesinde satırların fiyatı: siparişte zaten olan parça sipariş
 * anındaki fiyatını korur (fiyat listesi bu arada değişse de misafire söylenen
 * fiyat); yeni eklenen parça güncel fiyatla.
 *
 * @param {Array<{ itemId: string, quantity: number }>} requested
 * @param {Map<string, { unitPrice: string }>} existing siparişteki satırlar (ürün → fiyat)
 * @param {Map<string, { name: string, service?: string, price: string }>} catalog güncel liste
 */
export function repriceLines(requested, existing, catalog) {
  return requested.map((line) => {
    const item = catalog.get(line.itemId);
    const kept = existing.get(line.itemId);
    return {
      itemId: line.itemId,
      name: item.name,
      service: item.service,
      quantity: line.quantity,
      unitPrice: kept ? kept.unitPrice : item.price,
    };
  });
}

/**
 * Odanın kime yazılabileceği: içerideki misafir ve odadan yakın zamanda
 * ayrılanlar (çıkış yapan ya da başka odaya taşınan). Aynı konaklama iki kez
 * gelmez; içerideki misafir "ayrılan" listesinde yer almaz.
 *
 * @param {{
 *   inHouse: { id: string } | null,
 *   checkedOut: Array<{ id: string, at: Date }>,
 *   movedOut: Array<{ id: string, at: Date }>,
 *   now: Date,
 *   lateHours?: number,
 * }} input
 * @returns {{ inHouseId: string | null, lateIds: string[] }}
 */
export function chargeableStays({ inHouse, checkedOut, movedOut, now, lateHours = MINIBAR_LATE_CHARGE_HOURS }) {
  const since = now.getTime() - lateHours * 60 * 60 * 1000;
  const late = [...checkedOut, ...movedOut]
    .filter((stay) => stay.at.getTime() >= since && stay.id !== inHouse?.id)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  return { inHouseId: inHouse?.id ?? null, lateIds: [...new Set(late.map((stay) => stay.id))] };
}

/**
 * Ekranın seçtiği hedef odanın şu anki durumuyla uyuşuyor mu? Uyuşmuyorsa
 * (bu arada misafir çıktı, oda değişti) sebep: fiş yazılmaz, ekran tazelenir.
 *
 * @param {{ chargeTo: 'IN_HOUSE' | 'LATE' | 'NONE', reservationId?: string | null }} choice
 * @param {{ inHouseId: string | null, lateIds: string[] }} stays
 * @returns {string | null}
 */
export function chargeTargetError(choice, stays) {
  if (choice.chargeTo === 'NONE') return null;
  if (choice.chargeTo === 'IN_HOUSE') {
    if (!stays.inHouseId) return 'Odada artık konaklayan misafir yok; odayı yeniden açın';
    if (stays.inHouseId !== choice.reservationId) return 'Odadaki misafir değişmiş; odayı yeniden açın';
    return null;
  }
  if (!stays.lateIds.includes(choice.reservationId ?? '')) {
    return 'Bu misafir odadan ayrılalı çok olmuş ya da bu odada kalmamış; geç kalem yazılamaz';
  }
  return null;
}

/**
 * Folyoya gidecek olayın satırları: ürün adı, birim fiyat, adet.
 * @param {Array<{ name: string, unitPrice: string, quantity: number }>} lines
 */
export function chargeItems(lines) {
  return lines.map((line) => ({ description: line.name, unitPrice: line.unitPrice, quantity: line.quantity }));
}
