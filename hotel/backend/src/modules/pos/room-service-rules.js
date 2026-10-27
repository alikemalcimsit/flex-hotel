import { toDecimal, toMoneyString } from '@hotelos/core';
import { utcToZonedWallTime } from '@hotelos/hotel-contracts';

/**
 * Oda servisinin (modül 41) saf kuralları: sipariş numarası, menü kalemlerinin denetimi ve fiyat kopyası, teslimde
 * kapı ödemesi + odaya yazılacak kalan, ileri saatli siparişin hangi vardiyaya düşeceği ve hazırlık listesi.
 * Veritabanına dokunmaz; servis ve birim testler aynı kuralı kullanır.
 */

/** "OS-2026-000123". @param {number} year @param {number} sequence */
export const roomServiceNumber = (year, sequence) => `OS-${year}-${String(sequence).padStart(6, '0')}`;

/**
 * Sipariş kalemlerinin ürün denetimi: ürün var, sistem ürünü değil, aktif (grubuyla), tükenmemiş ve bu satış
 * noktasında satılıyor. Restoranın turu da oda servisi de bu kuralı kullanır.
 *
 * @param {Array<{ menuItemId: string }>} lines
 * @param {Map<string, { name: string, isActive: boolean, soldOut: boolean, system: string | null, category: { isActive: boolean, outletIds: string[] } }>} itemsById
 * @param {string} outletId
 * @param {string} [path] hata alanının ön eki
 * @returns {Record<string, string>} alan → hata (boşsa geçerli)
 */
export function menuLineErrors(lines, itemsById, outletId, path = 'lines') {
  /** @type {Record<string, string>} */
  const fields = {};
  lines.forEach((line, index) => {
    const item = itemsById.get(line.menuItemId);
    const key = `${path}.${index}.menuItemId`;
    if (!item || item.system) fields[key] = 'Ürün bulunamadı';
    else if (!item.isActive || !item.category.isActive) fields[key] = `${item.name} satıştan kalkmış`;
    else if (item.soldOut) fields[key] = `${item.name} tükendi`;
    else if (item.category.outletIds.length && !item.category.outletIds.includes(outletId)) fields[key] = `${item.name} bu satış noktasında satılmıyor`;
  });
  return fields;
}

/**
 * Sipariş edilen kalemlerin kopyası (ad, vergi dahil birim fiyat, istasyon, vergi kategorisi) ve toplamı. Misafir
 * siparişi kabul edilene kadar fiyat bu kopyadadır; mutfağa düşünce adisyon kalemleri ürünün **o anki** fiyatını alır
 * (restoranla aynı kural).
 *
 * @param {Array<{ menuItemId: string, quantity: number, note?: string | null }>} lines
 * @param {Map<string, { id: string, name: string, price: any, station: string, taxCategory: string }>} itemsById
 */
export function quoteItems(lines, itemsById) {
  let total = toDecimal(0);
  const items = lines.map((line) => {
    const item = itemsById.get(line.menuItemId);
    const unitPrice = toMoneyString(toDecimal(String(item.price)));
    total = total.plus(toDecimal(unitPrice).times(line.quantity));
    return { menuItemId: item.id, name: item.name, unitPrice, quantity: line.quantity, note: line.note ?? null, station: item.station, taxCategory: item.taxCategory };
  });
  return { items, itemsTotal: toMoneyString(total) };
}

/**
 * Teslimde ödeme planı: kapıda alınanlar kalan bakiyeyi aşamaz (para üstü elde verilir, kasaya alınan yazılır);
 * kalan varsa odaya yazılır, yazılmayacaksa teslim yapılmaz (oda servisinde açık hesap kalmaz).
 *
 * @param {{ balance: string, payments: Array<{ amount: string }>, chargeRemainder: boolean }} input
 * @returns {{ error: string | null, field: string | null, paid: string, remainder: string }}
 */
export function doorSettlement({ balance, payments, chargeRemainder }) {
  const due = toDecimal(balance);
  const paid = payments.reduce((sum, payment) => sum.plus(toDecimal(payment.amount)), toDecimal(0));
  const result = (error, field) => ({ error, field, paid: toMoneyString(paid), remainder: toMoneyString(due.minus(paid).greaterThan(0) ? due.minus(paid) : 0) });
  if (payments.length && !due.greaterThan(0)) return result('Siparişin ödenecek tutarı yok; kapıda ödeme alınmaz.', 'payments');
  if (paid.greaterThan(due)) return result(`Kapıda alınan (${toMoneyString(paid)}) kalan tutarı (${toMoneyString(due)}) aşıyor; para üstünü elde verin, kasaya alınan tutarı yazın.`, 'payments');
  if (due.minus(paid).greaterThan(0) && !chargeRemainder) return result(`Kalan ${toMoneyString(due.minus(paid))} ödenmedi: kapıda alın ya da odaya yazın.`, 'chargeRemainder');
  return result(null, null);
}

/**
 * Zamanı gelen planlı sipariş kimin vardiyasına düşer: siparişi girenin açık vardiyası (hangi noktada olursa olsun),
 * yoksa oda servisi noktasında en erken açılmış vardiya. İkisi de yoksa düşmez (personel "mutfağa gönder" der;
 * uyarı düşer).
 *
 * @param {Array<{ id: string, waiterEmail: string, outletId: string | null, openedAt: Date }>} openShifts
 * @param {{ createdBy: string, outletId: string }} order
 * @returns {{ id: string, waiterEmail: string } | null}
 */
export function pickReleaseShift(openShifts, { createdBy, outletId }) {
  const own = openShifts.find((shift) => shift.waiterEmail === createdBy);
  if (own) return own;
  const atOutlet = openShifts.filter((shift) => shift.outletId === outletId).sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime() || a.id.localeCompare(b.id));
  return atOutlet[0] ?? null;
}

/**
 * Hazırlık listesi: siparişler teslim saatine göre aralıklara (otelin saatiyle) toplanır; her aralıkta ve günün
 * tamamında ürün başına adet (mutfağın üretim listesi; notlu kalem ayrı sayılır: "2 × omlet (az pişmiş)").
 *
 * @param {Array<{ id: string, deliverAt: Date, items: Array<{ menuItemId: string, name: string, quantity: number, note?: string | null, station?: string }> }>} orders teslim saatine göre sıralı olmalı değil; burada sıralanır
 * @param {{ timeZone: string, slotMinutes: number }} options
 */
export function prepSlots(orders, { timeZone, slotMinutes }) {
  const slots = new Map();
  const day = new Map();
  const add = (bucket, item) => {
    if (item.station === 'NONE') return;
    const key = `${item.menuItemId}|${item.note ?? ''}`;
    const entry = bucket.get(key) ?? { menuItemId: item.menuItemId, name: item.name, note: item.note ?? null, quantity: 0 };
    entry.quantity += item.quantity;
    bucket.set(key, entry);
  };
  const sorted = [...orders].sort((a, b) => a.deliverAt.getTime() - b.deliverAt.getTime() || a.id.localeCompare(b.id));
  for (const order of sorted) {
    const wall = utcToZonedWallTime(order.deliverAt, timeZone);
    const minutes = Number(wall.slice(11, 13)) * 60 + Number(wall.slice(14, 16));
    const start = Math.floor(minutes / slotMinutes) * slotMinutes;
    const time = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
    const slot = slots.get(time) ?? { time, orders: [], items: new Map() };
    slot.orders.push(order);
    for (const item of order.items) {
      add(slot.items, item);
      add(day, item);
    }
    slots.set(time, slot);
  }
  const list = (bucket) => [...bucket.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, 'tr') || (a.note ?? '').localeCompare(b.note ?? '', 'tr'));
  return {
    slots: [...slots.values()].map((slot) => ({ time: slot.time, orders: slot.orders, items: list(slot.items) })),
    items: list(day),
  };
}
