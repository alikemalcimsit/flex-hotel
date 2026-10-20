import { toDecimal, toMoneyString } from '@hotelos/core';
import { chargeLine } from '../folios/rules.js';

/**
 * Restoran POS'un saf kuralları (modül 39) — veritabanı, HTTP ve saat bilmez.
 *
 * Fiyatlar vergi dahil brüttür; vergi folyonun motoruyla (`chargeLine`) dökülür: restoran
 * adisyonu ile odaya yazılan tutar aynı vergiyi aynı yuvarlamayla görür. Para hesabı
 * `@hotelos/core` decimal ile; indirim kalemlere **kuruş kuruş** dağıtılır (toplam birebir
 * tutar).
 */

const ZERO = () => toDecimal(0);
const cents = (value) => toDecimal(value).times(100).round().toNumber();
const fromCents = (value) => toMoneyString(toDecimal(value).dividedBy(100));

/* ══════════════════ Kalem ══════════════════ */

/**
 * Kalemin faturalanan adedi ve tutarları: iptal ve ikram adetleri düşülür; ikram ve
 * iptalin değeri (rapor) ayrıca.
 *
 * @param {{ quantity: number, voidedQuantity: number, compedQuantity: number, unitPrice: string }} line
 */
export function lineAmounts(line) {
  const price = toDecimal(line.unitPrice);
  const billable = line.quantity - line.voidedQuantity - line.compedQuantity;
  return {
    billableQuantity: billable,
    gross: toMoneyString(price.times(billable)),
    compValue: toMoneyString(price.times(line.compedQuantity)),
    voidValue: toMoneyString(price.times(line.voidedQuantity)),
  };
}

/**
 * Kalemin düzeltmeye açık adedi: iptal / ikram edilmiş ve onay bekleyen düzeltmelerin
 * adetleri düşülmüş.
 *
 * @param {{ quantity: number, voidedQuantity: number, compedQuantity: number }} line
 * @param {number} pendingQuantity aynı kalemde onay bekleyen ikram / iptal adedi
 */
export const lineFreeQuantity = (line, pendingQuantity = 0) => line.quantity - line.voidedQuantity - line.compedQuantity - pendingQuantity;

/* ══════════════════ İndirim ══════════════════ */

/**
 * Adisyon indiriminin tutarı: yüzde ise ara toplamın yüzdesi (kuruşa yuvarlanır), tutar
 * ise ara toplamı aşamaz.
 *
 * @param {string} subtotal
 * @param {{ discountPct: string | null, discountAmount: string | null }} discount
 */
export function discountValue(subtotal, { discountPct, discountAmount }) {
  const base = toDecimal(subtotal);
  if (discountPct) return toMoneyString(base.times(toDecimal(discountPct)).dividedBy(100));
  if (discountAmount) return toMoneyString(toDecimal(discountAmount).greaterThan(base) ? base : toDecimal(discountAmount));
  return '0.00';
}

/**
 * Tutarı ağırlıklara orantılı, kuruş kuruş dağıtır (en büyük kalan yöntemi): parçaların
 * toplamı tutara birebir eşittir; eşit kalanda önce gelen kazanır.
 *
 * @param {string} amount
 * @param {string[]} weights eksi olmayan tutarlar
 * @returns {string[]}
 */
export function allocate(amount, weights) {
  const total = weights.reduce((sum, weight) => sum + cents(weight), 0);
  const target = cents(amount);
  if (total === 0 || target === 0) return weights.map(() => '0.00');
  const raw = weights.map((weight) => (cents(weight) * target) / total);
  const floors = raw.map(Math.floor);
  let left = target - floors.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const entry of order) {
    if (left <= 0) break;
    floors[entry.index] += 1;
    left -= 1;
  }
  return floors.map(fromCents);
}

/* ══════════════════ Adisyon toplamı ══════════════════ */

/**
 * Adisyonun toplamları: ara toplam (faturalanan kalemler), ikram ve iptal değeri, indirim,
 * vergisiz, vergi, toplam, vergi dökümü (ad + oran + dahil / hariç) ve **vergi kategorisi
 * başına** brüt / toplam.
 *
 * Vergi kategori başına hesaplanır (fatura düzeyinde, oran oran): kalemlerin brütü
 * kategoride toplanır, indirim kategorilere orantılı dağıtılır, folyonun motoru her
 * kategoriye bir kez uygulanır. Odaya yazılan adisyon folyoya aynı kategorilerle gider;
 * folyo aynı motorla aynı toplamı bulur (bkz. `roomChargeItems`).
 *
 * @param {{
 *   lines: Array<{ quantity: number, voidedQuantity: number, compedQuantity: number, unitPrice: string, taxCategory: string }>,
 *   discountPct: string | null,
 *   discountAmount: string | null,
 *   taxes: Array<{ id: string, name: string, rate: string, isIncluded: boolean, appliesTo: string[] }>,
 * }} input
 */
export function checkTotals({ lines, discountPct, discountAmount, taxes }) {
  const amounts = lines.map(lineAmounts);
  const subtotal = amounts.reduce((sum, entry) => sum.plus(toDecimal(entry.gross)), ZERO());
  const compTotal = amounts.reduce((sum, entry) => sum.plus(toDecimal(entry.compValue)), ZERO());
  const voidTotal = amounts.reduce((sum, entry) => sum.plus(toDecimal(entry.voidValue)), ZERO());
  const discount = discountValue(toMoneyString(subtotal), { discountPct, discountAmount });

  /** @type {Map<string, import('@hotelos/core').Decimal>} */
  const byCategory = new Map();
  lines.forEach((line, index) => byCategory.set(line.taxCategory, (byCategory.get(line.taxCategory) ?? ZERO()).plus(toDecimal(amounts[index].gross))));
  const keys = [...byCategory.keys()].sort();
  const shares = allocate(discount, keys.map((key) => toMoneyString(byCategory.get(key))));

  let net = ZERO();
  let tax = ZERO();
  let total = ZERO();
  const categories = [];
  /** @type {Map<string, { name: string, rate: string, included: boolean, amount: import('@hotelos/core').Decimal }>} */
  const breakdown = new Map();
  keys.forEach((key, index) => {
    const gross = byCategory.get(key).minus(toDecimal(shares[index]));
    if (gross.isZero()) return;
    const charged = chargeLine({ amount: toMoneyString(gross), quantity: 1, taxCategory: key, taxes });
    net = net.plus(toDecimal(charged.netAmount));
    tax = tax.plus(toDecimal(charged.taxAmount));
    total = total.plus(toDecimal(charged.total));
    categories.push({ taxCategory: key, gross: toMoneyString(gross), total: charged.total });
    for (const taxLine of charged.taxLines) {
      const breakdownKey = `${taxLine.name}|${taxLine.rate}|${taxLine.included}`;
      const entry = breakdown.get(breakdownKey) ?? { name: taxLine.name, rate: taxLine.rate, included: taxLine.included, amount: ZERO() };
      entry.amount = entry.amount.plus(toDecimal(taxLine.amount));
      breakdown.set(breakdownKey, entry);
    }
  });
  return {
    subtotal: toMoneyString(subtotal),
    compTotal: toMoneyString(compTotal),
    voidTotal: toMoneyString(voidTotal),
    discountTotal: discount,
    netTotal: toMoneyString(net),
    taxTotal: toMoneyString(tax),
    grandTotal: toMoneyString(total),
    categories,
    taxes: [...breakdown.values()]
      .map((entry) => ({ ...entry, amount: toMoneyString(entry.amount) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr') || Number(a.rate) - Number(b.rate)),
  };
}

/* ══════════════════ Odaya yaz ══════════════════ */

/** Swap aramasında denenecek en fazla kuruş adımı (kategori başına). */
const ROOM_CHARGE_SEARCH_STEPS = 3;

/**
 * Odaya yazılan tutarın folyo kalemleri: kategori başına brüt; folyo bu brütlere kendi
 * motoruyla (dahil vergi içinde, hariç vergi üstüne) vergi uygulayınca toplam **tam olarak**
 * odaya yazılan tutar olur.
 *
 * - Tutar adisyonun kategori toplamlarının tamamıysa (önceden ödeme yok) kalemler
 *   kategorilerin kendisidir.
 * - Kısmi tutar kategorilere toplamlarıyla orantılı dağıtılır; her kategoride folyo
 *   toplamı payı aşmayan en büyük brüt seçilir, kalan kuruşlar başka kategorilere (gerekirse
 *   bir kategoriden bir kuruş alınıp ötekine verilerek) kapatılır.
 * - Hariç vergi (servis ücreti) kuruş yuvarlaması bazı tutarları **erişilemez** kılar
 *   (brüt 1 kuruş artınca toplam 2 kuruş artar). O zaman tutar reddedilir ve en yakın iki
 *   erişilebilir tutar önerilir.
 *
 * @param {{
 *   categories: Array<{ taxCategory: string, gross: string, total: string }>,
 *   amount: string,
 *   taxes: Array<{ id: string, name: string, rate: string, isIncluded: boolean, appliesTo: string[] }>,
 * }} input
 * @returns {{ items: Array<{ taxCategory: string, gross: string }>, error?: undefined } | { items: [], error: string, nearest: string[] }}
 */
export function roomChargeItems({ categories, amount, taxes }) {
  const live = categories.filter((category) => cents(category.total) > 0);
  const target = cents(amount);
  const full = live.reduce((sum, category) => sum + cents(category.total), 0);
  if (target <= 0 || live.length === 0) return { items: [], error: 'Odaya yazılacak tutar yok', nearest: [] };
  if (target > full) return { items: [], error: 'Tutar adisyon toplamını aşıyor', nearest: [fromCents(full)] };
  if (target === full) return { items: live.map((category) => ({ taxCategory: category.taxCategory, gross: category.gross })) };

  const totalOf = (index, gross) =>
    gross <= 0 ? 0 : cents(chargeLine({ amount: fromCents(gross), quantity: 1, taxCategory: live[index].taxCategory, taxes }).total);
  const ceiling = live.map((category) => cents(category.gross));
  const parts = allocate(amount, live.map((category) => category.total)).map(cents);

  // Her kategoride toplamı payı aşmayan en büyük brüt (orantılı tahminden yürüyerek).
  const grosses = live.map((category, index) => {
    let gross = Math.min(ceiling[index], Math.floor((parts[index] * ceiling[index]) / cents(category.total)));
    while (gross > 0 && totalOf(index, gross) > parts[index]) gross -= 1;
    while (gross < ceiling[index] && totalOf(index, gross + 1) <= parts[index]) gross += 1;
    return gross;
  });
  const reached = () => grosses.reduce((sum, gross, index) => sum + totalOf(index, gross), 0);
  let left = target - reached();

  // Kalan kuruşlar: önce tek adımlar (kalanı aşmayan en büyük artış).
  for (let guard = 0; left > 0 && guard < live.length * ROOM_CHARGE_SEARCH_STEPS * 4; guard += 1) {
    let best = -1;
    let bestDelta = 0;
    grosses.forEach((gross, index) => {
      if (gross >= ceiling[index]) return;
      const delta = totalOf(index, gross + 1) - totalOf(index, gross);
      if (delta <= left && delta > bestDelta) {
        best = index;
        bestDelta = delta;
      }
    });
    if (best < 0) break;
    grosses[best] += 1;
    left -= bestDelta;
  }
  // Tek adım sığmadıysa: bir kategoriden geri alıp ötekine fazlasını ver (küçük arama).
  if (left > 0) {
    search: for (let down = 0; down < live.length; down += 1) {
      for (let up = 0; up < live.length; up += 1) {
        if (up === down) continue;
        for (let take = 1; take <= ROOM_CHARGE_SEARCH_STEPS; take += 1) {
          for (let give = 1; give <= ROOM_CHARGE_SEARCH_STEPS; give += 1) {
            if (grosses[down] - take < 0 || grosses[up] + give > ceiling[up]) continue;
            const change =
              totalOf(up, grosses[up] + give) - totalOf(up, grosses[up]) - (totalOf(down, grosses[down]) - totalOf(down, grosses[down] - take));
            if (change === left) {
              grosses[down] -= take;
              grosses[up] += give;
              left = 0;
              break search;
            }
          }
        }
      }
    }
  }
  if (left !== 0) {
    const lower = target - left;
    const steps = grosses
      .map((gross, index) => (gross < ceiling[index] ? totalOf(index, gross + 1) - totalOf(index, gross) : null))
      .filter((delta) => delta !== null && delta > left);
    const upper = steps.length ? lower + Math.min(...steps) : null;
    return {
      items: [],
      error: 'Bu tutar vergi (servis ücreti) kuruş yuvarlaması yüzünden folyoya birebir yazılamıyor',
      nearest: [lower, upper].filter((value) => value !== null && value > 0).map(fromCents),
    };
  }
  return {
    items: grosses
      .map((gross, index) => ({ taxCategory: live[index].taxCategory, gross: fromCents(gross) }))
      .filter((item) => cents(item.gross) > 0),
  };
}

/** Kalan: toplam − alınan − odaya yazılan. @param {{ grandTotal: string, paidTotal: string, roomChargeTotal: string }} check */
export const checkBalance = (check) =>
  toMoneyString(toDecimal(check.grandTotal).minus(toDecimal(check.paidTotal)).minus(toDecimal(check.roomChargeTotal)));

/* ══════════════════ Düzeltme ══════════════════ */

/**
 * Düzeltmenin para etkisi: ikram / iptalde adet × birim fiyat; indirimde indirim tutarı
 * (şu anki ara toplama göre).
 *
 * @param {{ kind: 'COMP' | 'VOID' | 'DISCOUNT', unitPrice?: string, quantity?: number, subtotal?: string, discountPct?: string | null, discountAmount?: string | null }} input
 */
export function adjustmentValue({ kind, unitPrice, quantity, subtotal, discountPct = null, discountAmount = null }) {
  if (kind === 'DISCOUNT') return discountValue(subtotal ?? '0', { discountPct, discountAmount });
  return toMoneyString(toDecimal(unitPrice ?? 0).times(quantity ?? 0));
}

/**
 * Düzeltme onaya gider mi? Eşik 0 ise hiç gitmez; değilse değer eşiğe eşit ya da büyükse.
 * @param {string} value
 * @param {string} threshold
 */
export function adjustmentNeedsApproval(value, threshold) {
  const limit = toDecimal(threshold);
  if (!limit.greaterThan(0)) return false;
  return toDecimal(value).greaterThanOrEqualTo(limit);
}

/* ══════════════════ Bölme ══════════════════ */

/**
 * Adisyon bölme planı: her seçilen kalemden taşınacak adet, kalemin serbest adedini
 * (iptal / ikram / onay bekleyen düşülmüş) aşamaz. Serbest adedin tamamı taşınıyor ve
 * kalemde iptal / ikram yoksa kalem **olduğu gibi** taşınır; değilse kalem bölünür (kaynakta
 * adet azalır, hedefte yeni kalem açılır). Kaynakta faturalanan kalem kalmazsa bölme
 * anlamsızdır (taşıma kullanılır).
 *
 * @param {Array<{ id: string, quantity: number, voidedQuantity: number, compedQuantity: number }>} lines kaynak adisyonun kalemleri
 * @param {Array<{ lineId: string, quantity: number }>} moves
 * @param {Map<string, number>} pending kalem → onay bekleyen adet
 * @returns {{ errors: Record<string, string>, whole: string[], partial: Array<{ lineId: string, quantity: number }> }}
 */
export function splitPlan(lines, moves, pending = new Map()) {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const errors = {};
  const whole = [];
  const partial = [];
  moves.forEach((move, index) => {
    const line = byId.get(move.lineId);
    if (!line) {
      errors[`lines.${index}.lineId`] = 'Kalem bu adisyonun değil';
      return;
    }
    const waiting = pending.get(line.id) ?? 0;
    if (waiting > 0) {
      errors[`lines.${index}.lineId`] = 'Kalemin onay bekleyen düzeltmesi var';
      return;
    }
    const free = lineFreeQuantity(line);
    if (move.quantity > free) {
      errors[`lines.${index}.quantity`] = free > 0 ? `En fazla ${free} adet taşınır` : 'Kalemin taşınacak adedi yok';
      return;
    }
    if (move.quantity === line.quantity) whole.push(line.id);
    else partial.push({ lineId: line.id, quantity: move.quantity });
  });
  if (!Object.keys(errors).length) {
    const remaining = lines.reduce((sum, line) => {
      const moved = moves.find((move) => move.lineId === line.id)?.quantity ?? 0;
      return sum + lineFreeQuantity(line) - moved;
    }, 0);
    if (remaining <= 0) errors.lines = 'Bütün kalemler taşınıyor: bölmek yerine adisyonu masaya taşıyın';
  }
  return { errors, whole, partial };
}

/* ══════════════════ Vardiya ══════════════════ */

/**
 * Vardiya kasası: beklenen nakit = avans + işlenmiş nakit tahsilat (iptal kayıtları
 * düşülmüş); fark = sayılan − beklenen.
 *
 * @param {{ openingFloat: string, cashNet: string, countedCash?: string | null }} input
 */
export function shiftCash({ openingFloat, cashNet, countedCash = null }) {
  const expected = toDecimal(openingFloat).plus(toDecimal(cashNet));
  return {
    expectedCash: toMoneyString(expected),
    variance: countedCash === null ? null : toMoneyString(toDecimal(countedCash).minus(expected)),
  };
}

/**
 * Kasa farkı uyarı gerektiriyor mu (mutlak değer eşikten büyük; eşik 0 ise her fark).
 * @param {string} variance
 * @param {string} threshold
 */
export const varianceNeedsAlert = (variance, threshold) => toDecimal(variance).abs().greaterThan(toDecimal(threshold));

/* ══════════════════ Numara ══════════════════ */

/** "ADS-2026-000123". @param {number} year @param {number} sequence */
export const checkNumber = (year, sequence) => `ADS-${year}-${String(sequence).padStart(6, '0')}`;
