import { Decimal, toDecimal } from '@hotelos/core';
import { KITCHEN_UNIT_LABELS, MAX_OVER_RECEIPT_PCT, MIN_REQUEST_REASON_LENGTH, STOCK_QUANTITY_SCALE, bestQuoteLine } from '@hotelos/hotel-contracts';
import { purchaseRounding } from '../recipes/rules.js';

/**
 * Satın almanın saf kuralları (modül 45; birim testli): satır tutarı ve KDV, talep satırlarının
 * teklif turunda malzeme başına birleşmesi, satır bazında kazanan planı (tedarikçi başına sipariş),
 * mal kabul planı (fazla teslim toleransı), sipariş / talep / tur durumunun türetilmesi, onay eşiği,
 * minimum stok önerisi ve vade günü.
 *
 * Tutarlar: satır KDV hariç tutarı = miktar × birim fiyat (kuruşa yuvarlı), KDV = tutar × oran
 * (kuruşa yuvarlı, satır başına — irsaliye / faturadaki gibi), toplam = ikisinin toplamı; belge
 * toplamı satırların toplamıdır (yeniden yuvarlanmaz).
 */

const HALF_UP = Decimal.ROUND_HALF_UP;

/** @param {string} day YYYY-MM-DD @param {number} days */
export function addDays(day, days) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** @param {string} day YYYY-MM-DD */
const dayLabel = (day) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;

/**
 * @param {string | Decimal} quantity @param {string | Decimal} unitPrice KDV hariç @param {string | Decimal} taxRatePct
 * @returns {{ net: Decimal, tax: Decimal, total: Decimal }}
 */
export function lineAmounts(quantity, unitPrice, taxRatePct) {
  const net = toDecimal(quantity).times(toDecimal(unitPrice)).toDecimalPlaces(2, HALF_UP);
  const tax = net.times(toDecimal(taxRatePct)).dividedBy(100).toDecimalPlaces(2, HALF_UP);
  return { net, tax, total: net.plus(tax) };
}

/** @param {Array<{ net: Decimal, tax: Decimal, total: Decimal }>} rows */
export function sumAmounts(rows) {
  return rows.reduce((acc, row) => ({ net: acc.net.plus(row.net), tax: acc.tax.plus(row.tax), total: acc.total.plus(row.total) }), {
    net: toDecimal(0),
    tax: toDecimal(0),
    total: toDecimal(0),
  });
}

/**
 * Eşik 0'dan büyükse ve KDV dahil tutar eşiğe eşit ya da üstündeyse sipariş onaya gider.
 * @param {string | Decimal} grandTotal @param {string | Decimal} threshold
 */
export function needsApproval(grandTotal, threshold) {
  const limit = toDecimal(threshold);
  return limit.greaterThan(0) && toDecimal(grandTotal).greaterThanOrEqualTo(limit);
}

/**
 * Talep satırları (malzeme × etkinlik / talep) teklif turunda malzeme başına birleşir: miktar toplamı,
 * en erken ihtiyaç günü. Talep satırının birimi malzemenin bugünkü biriminden farklıysa (birim talep
 * açıldıktan sonra değişmiş) satır birleştirilmez, `mismatched`'e düşer.
 *
 * @param {Array<{ id: string, stockItemId: string, quantity: string | Decimal, unit: string, neededBy: string }>} lines
 * @param {Map<string, string>} itemUnits malzeme → bugünkü stok birimi
 */
export function consolidateRoundLines(lines, itemUnits) {
  /** @type {Map<string, { stockItemId: string, unit: string, quantity: Decimal, neededBy: string, requestLineIds: string[] }>} */
  const items = new Map();
  const mismatched = new Set();
  for (const line of lines) {
    const unit = itemUnits.get(line.stockItemId);
    if (!unit || unit !== line.unit) {
      mismatched.add(line.stockItemId);
      continue;
    }
    let item = items.get(line.stockItemId);
    if (!item) {
      item = { stockItemId: line.stockItemId, unit, quantity: toDecimal(0), neededBy: line.neededBy, requestLineIds: [] };
      items.set(line.stockItemId, item);
    }
    item.quantity = item.quantity.plus(toDecimal(line.quantity));
    if (line.neededBy < item.neededBy) item.neededBy = line.neededBy;
    item.requestLineIds.push(line.id);
  }
  return { items, mismatched: [...mismatched] };
}

/**
 * Satır bazında kazanan planı. Her seçim için: satır turda ve açık (siparişe dönmemiş, bırakılmamış),
 * teklif satırı bu satırın, fiyatı girilmiş, teklifin geçerliliği bugün sürüyor, tedarikçi etkin.
 * En uygun teklif (ihtiyaca yetişen → fiyat → termin → önce girilen; yalnız geçerli adaylar arasında)
 * dışındaki seçim gerekçe ister. Teklif, bugün + termin satırın ihtiyaç gününden sonraysa "geç"tir.
 * Geçerli seçimler tedarikçi başına gruplanır (her grup bir sipariş).
 *
 * @param {{
 *   lines: Array<{ id: string, name: string, neededBy: string, ordered: boolean, released: boolean }>,
 *   quotes: Array<{ id: string, supplierId: string, supplierName: string, supplierActive: boolean, deliveryDays: number, validUntil: string | null, createdAt: string,
 *     lines: Array<{ id: string, roundLineId: string, unitPrice: string | null, taxRatePct: string }> }>,
 *   awards: Array<{ roundLineId: string, quoteLineId: string, reason?: string | null }>,
 *   today: string,
 * }} input
 */
export function planAward({ lines, quotes, awards, today }) {
  const lineIndex = new Map(lines.map((line, index) => [line.id, index]));
  /** @type {Map<string, { quote: any, line: any }>} */
  const quoteLines = new Map();
  const neededBy = new Map(lines.map((line) => [line.id, line.neededBy]));
  /** @type {Map<string, Array<{ id: string, unitPrice: string | null, deliveryDays: number, createdAt: string, late: boolean }>>} */
  const candidates = new Map();
  for (const quote of quotes) {
    const usable = quote.supplierActive && (!quote.validUntil || quote.validUntil >= today);
    const arrives = addDays(today, quote.deliveryDays);
    for (const line of quote.lines) {
      quoteLines.set(line.id, { quote, line });
      if (!usable || line.unitPrice === null) continue;
      const list = candidates.get(line.roundLineId) ?? [];
      list.push({ id: line.id, unitPrice: line.unitPrice, deliveryDays: quote.deliveryDays, createdAt: quote.createdAt, late: Boolean(neededBy.get(line.roundLineId)) && arrives > neededBy.get(line.roundLineId) });
      candidates.set(line.roundLineId, list);
    }
  }

  /** @type {Record<string, string>} */
  const fields = {};
  /** @type {Map<string, { supplierId: string, supplierName: string, quoteId: string, deliveryDays: number, lines: any[] }>} */
  const groups = new Map();
  awards.forEach((award, index) => {
    const at = lineIndex.get(award.roundLineId);
    if (at === undefined) {
      fields[`awards.${index}.roundLineId`] = 'Satır bu turda yok';
      return;
    }
    const line = lines[at];
    if (line.ordered) {
      fields[`awards.${index}.roundLineId`] = `${line.name}: zaten siparişe döndü`;
      return;
    }
    if (line.released) {
      fields[`awards.${index}.roundLineId`] = `${line.name}: turdan bırakıldı`;
      return;
    }
    const found = quoteLines.get(award.quoteLineId);
    if (!found || found.line.roundLineId !== line.id) {
      fields[`awards.${index}.quoteLineId`] = `${line.name}: seçilen teklif bu satırın değil`;
      return;
    }
    const { quote, line: quoteLine } = found;
    if (quoteLine.unitPrice === null) {
      fields[`awards.${index}.quoteLineId`] = `${line.name}: ${quote.supplierName} bu malzemeye fiyat vermedi`;
      return;
    }
    if (!quote.supplierActive) {
      fields[`awards.${index}.quoteLineId`] = `${line.name}: ${quote.supplierName} pasif`;
      return;
    }
    if (quote.validUntil && quote.validUntil < today) {
      fields[`awards.${index}.quoteLineId`] = `${line.name}: ${quote.supplierName} teklifinin geçerliliği ${dayLabel(quote.validUntil)} tarihinde doldu`;
      return;
    }
    const best = bestQuoteLine(candidates.get(line.id) ?? []);
    const reason = award.reason?.trim() || null;
    if (best !== quoteLine.id && (!reason || reason.length < MIN_REQUEST_REASON_LENGTH)) {
      fields[`awards.${index}.reason`] = `${line.name}: en uygun teklif dışı seçim için gerekçe yazın (en az ${MIN_REQUEST_REASON_LENGTH} karakter)`;
      return;
    }
    let group = groups.get(quote.supplierId);
    if (!group) {
      group = { supplierId: quote.supplierId, supplierName: quote.supplierName, quoteId: quote.id, deliveryDays: quote.deliveryDays, lines: [] };
      groups.set(quote.supplierId, group);
    }
    group.lines.push({ at, roundLineId: line.id, quoteLineId: quoteLine.id, unitPrice: quoteLine.unitPrice, taxRatePct: quoteLine.taxRatePct, reason: best === quoteLine.id ? null : reason, best: best === quoteLine.id });
  });
  for (const group of groups.values()) group.lines.sort((a, b) => a.at - b.at);
  return { fields, groups: [...groups.values()] };
}

/**
 * Satırın teslim alınabilecek en fazla miktarı: adette kalan; tartılan / ölçülen malzemede
 * sipariş × (1 + tolerans) − teslim alınan (binde bire aşağı yuvarlı).
 * @param {{ quantity: string | Decimal, receivedQuantity: string | Decimal, unit: string }} line
 */
export function receivableQuantity(line) {
  const ordered = toDecimal(line.quantity);
  const ceiling = line.unit === 'PIECE' ? ordered : ordered.times(100 + MAX_OVER_RECEIPT_PCT).dividedBy(100);
  const left = ceiling.minus(toDecimal(line.receivedQuantity)).toDecimalPlaces(STOCK_QUANTITY_SCALE, Decimal.ROUND_DOWN);
  return left.greaterThan(0) ? left : toDecimal(0);
}

/**
 * Mal kabul planı: girilen miktarlar sipariş satırlarıyla eşleşir, sınır denetlenir, tutarlar sipariş
 * fiyatıyla hesaplanır. 0 girilen satır atlanır. Sipariş, her satır sipariş miktarına ulaşınca tamdır.
 *
 * @param {{
 *   orderLines: Array<{ id: string, stockItemId: string, name: string, unit: string, quantity: string, receivedQuantity: string, unitPrice: string, taxRatePct: string }>,
 *   inputLines: Array<{ orderLineId: string, quantity: string }>,
 * }} input
 */
export function receiptPlan({ orderLines, inputLines }) {
  const byId = new Map(orderLines.map((line) => [line.id, line]));
  /** @type {Record<string, string>} */
  const fields = {};
  /** @type {Map<string, Decimal>} */
  const incoming = new Map();
  const lines = [];
  inputLines.forEach((input, index) => {
    const line = byId.get(input.orderLineId);
    if (!line) {
      fields[`lines.${index}.orderLineId`] = 'Satır bu siparişte yok';
      return;
    }
    const quantity = toDecimal(input.quantity);
    if (quantity.isZero()) return;
    const limit = receivableQuantity(line);
    if (quantity.greaterThan(limit)) {
      const unit = KITCHEN_UNIT_LABELS[line.unit] ?? line.unit;
      fields[`lines.${index}.quantity`] = limit.isZero()
        ? `${line.name}: sipariş miktarı tamamen teslim alındı`
        : `${line.name}: en fazla ${limit.toString()} ${unit} teslim alınabilir${line.unit === 'PIECE' ? '' : ` (sipariş + %${MAX_OVER_RECEIPT_PCT})`}`;
      return;
    }
    incoming.set(line.id, quantity);
    lines.push({ orderLine: line, quantity, ...lineAmounts(quantity, line.unitPrice, line.taxRatePct) });
  });
  const fullyReceived = orderLines.every((line) => toDecimal(line.receivedQuantity).plus(incoming.get(line.id) ?? 0).greaterThanOrEqualTo(toDecimal(line.quantity)));
  return { fields, lines, totals: sumAmounts(lines), fullyReceived };
}

/** @param {{ fullyReceived: boolean, closeShort: boolean }} input */
export function orderStatusAfterReceipt({ fullyReceived, closeShort }) {
  if (fullyReceived) return 'RECEIVED';
  return closeShort ? 'CLOSED' : 'PARTIALLY_RECEIVED';
}

/**
 * Talebin durumu satır sayılarından: hiçbiri turda değilse açık, hepsi siparişe döndüyse "siparişe
 * döndü", arası "teklif / siparişte". İptal ayrı işlemdir (yalnız açık talep).
 * @param {{ lines: number, inRound: number, ordered: number }} counts
 */
export function requestStatusOf({ lines, inRound, ordered }) {
  if (inRound === 0) return 'OPEN';
  return ordered === lines ? 'ORDERED' : 'IN_PROGRESS';
}

/**
 * Turun durumu satırlarından: bekleyen (siparişe dönmemiş, bırakılmamış) satır varsa açık; yoksa en az
 * biri siparişe döndüyse "siparişe döndü", hiçbiri dönmediyse iptal.
 * @param {Array<{ ordered: boolean, released: boolean }>} lines
 */
export function roundStatusOf(lines) {
  if (lines.some((line) => !line.ordered && !line.released)) return 'OPEN';
  return lines.some((line) => line.ordered) ? 'AWARDED' : 'CANCELLED';
}

/**
 * Minimum stok önerisi: minimum − (eldeki + yoldaki siparişler + henüz siparişe dönmemiş stok talepleri);
 * 0 ya da altı öneri değildir. Satın alma yuvarlamasıyla yukarı (kg / L binde bir, diğerleri tam).
 *
 * @param {{ minLevel: string | Decimal, onHand: string | Decimal, onOrder: string | Decimal, requested: string | Decimal, unit: string }} input
 * @returns {Decimal | null}
 */
export function stockSuggestion({ minLevel, onHand, onOrder, requested, unit }) {
  const gap = toDecimal(minLevel).minus(toDecimal(onHand)).minus(toDecimal(onOrder)).minus(toDecimal(requested));
  if (!gap.greaterThan(0)) return null;
  return purchaseRounding(gap, unit);
}
