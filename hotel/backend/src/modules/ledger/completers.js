import { toDecimal, toMoneyString } from '@hotelos/core';

/**
 * Karşı taraf tamamlayıcıları (modül 48): bir belgenin ön muhasebe kayıtları (cari + kasa / banka) fişi tek başına
 * dengelemez; kalan fark kaynağa göre bölünür. Her tamamlayıcı **ağırlık listesi** döner: `{ source, key, weight,
 * accountId? }` — motor farkı bu ağırlıklarla kuruşa böler ve her payı kuralın hesabına yazar (`accountId` verilmişse
 * kural yerine doğrudan o hesap — fişte seçilen masraf hesabı). Boş liste "kayıtlar kendi aralarında dengeli"
 * demektir (etkinlik tahsilatı, maaş ödemesi, virman); kalan kuruş / kur farkı kambiyo hesabına gider.
 *
 * Ağırlıklar işaretsizdir: ters kayıt grubunda fark eksi çıkar, paylar da eksi olur (aynı oranlar).
 */

/** "20.00" → "20", "10.50" → "10.5": kural anahtarı oran biçimi. @param {unknown} rate */
export const rateKey = (rate) => toDecimal(String(rate ?? 0)).toString();

/** @param {Map<string, import('@hotelos/core').Decimal>} map @param {string} key @param {unknown} amount */
function accumulate(map, key, amount) {
  map.set(key, (map.get(key) ?? toDecimal(0)).plus(toDecimal(String(amount ?? 0))));
}

/** @param {Map<string, import('@hotelos/core').Decimal>} map @param {string} source */
const vatWeights = (map, source) => [...map].filter(([, amount]) => !amount.isZero()).map(([rate, amount]) => ({ source, key: rate, weight: toMoneyString(amount.abs()) }));

const GUEST_LEDGER_SOURCES = new Set(['FOLIO_PAYMENT', 'FOLIO_TRANSFER', 'POS_PAYMENT', 'SPA_PAYMENT']);
const BALANCED_SOURCES = new Set(['EVENT_PAYMENT', 'PAYROLL_PAYMENT', 'EMPLOYEE_ADVANCE']);

/**
 * @typedef {{ source: string, key: string, weight: string, accountId?: string | null, description?: string | null }} CounterWeight
 */

/**
 * Belgenin karşı taraf ağırlıkları.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId
 * @param {{ sourceType: string, sourceId: string, records: Array<any> }} group
 * @returns {Promise<CounterWeight[]>}
 */
export async function counterWeights(tx, hotelId, group) {
  const { sourceType, sourceId } = group;
  if (GUEST_LEDGER_SOURCES.has(sourceType)) return [{ source: 'GUEST_LEDGER', key: '', weight: '1' }];
  if (BALANCED_SOURCES.has(sourceType)) return [];
  switch (sourceType) {
    case 'GOODS_RECEIPT':
      return goodsReceiptWeights(tx, hotelId, sourceId);
    case 'EVENT_CHARGE':
      return eventChargeWeights(tx, hotelId, sourceId);
    case 'INVOICE':
      return invoiceWeights(tx, hotelId, sourceId);
    case 'AGENCY_BONUS':
      return [{ source: 'AGENCY_BONUS', key: '', weight: '1' }];
    case 'OPENING':
      return [{ source: 'OPENING', key: '', weight: '1' }];
    case 'VOUCHER':
      return voucherWeights(tx, hotelId, sourceId);
    case 'INSTRUMENT':
      return instrumentWeights(tx, hotelId, sourceId);
    case 'PAYROLL':
      return payrollWeights(tx, hotelId, sourceId);
    default:
      return [];
  }
}

/** Mal kabul: KDV hariç tutar stoğa, KDV oran bazında indirilecek KDV'ye. */
async function goodsReceiptWeights(tx, hotelId, receiptId) {
  const lines = await tx.goodsReceiptLine.findMany({ where: { hotelId, receiptId }, select: { netAmount: true, taxAmount: true, taxRatePct: true } });
  const net = lines.reduce((sum, line) => sum.plus(String(line.netAmount)), toDecimal(0));
  const vat = new Map();
  for (const line of lines) accumulate(vat, rateKey(line.taxRatePct), line.taxAmount);
  const weights = [{ source: 'PURCHASE', key: '', weight: toMoneyString(net.abs()) }, ...vatWeights(vat, 'VAT_INPUT')];
  return weights.some((item) => item.weight !== '0.00') ? weights : [{ source: 'PURCHASE', key: '', weight: '1' }];
}

/** Etkinlik bedeli: kalemlerin vergi dökümüyle gelir + hesaplanan KDV (iptal bedelinde aynı oranlarla). */
async function eventChargeWeights(tx, hotelId, eventId) {
  const event = await tx.event.findFirst({ where: { id: eventId, hotelId }, select: { netTotal: true, taxTotal: true, items: { select: { taxLines: true } } } });
  if (!event) return [{ source: 'REVENUE', key: 'EVENT', weight: '1' }];
  const vat = new Map();
  for (const item of event.items) for (const line of /** @type {any[]} */ (item.taxLines ?? [])) accumulate(vat, rateKey(line.rate), line.amount);
  // Döküm kalem toplamından saparsa (elle düzeltilmiş etkinlik) vergi toplamı tek anahtara.
  const dumped = [...vat.values()].reduce((sum, amount) => sum.plus(amount), toDecimal(0));
  const tax = toDecimal(String(event.taxTotal));
  const vatPart = dumped.equals(tax) ? vatWeights(vat, 'VAT_OUTPUT') : tax.isZero() ? [] : [{ source: 'VAT_OUTPUT', key: '', weight: toMoneyString(tax.abs()) }];
  const weights = [{ source: 'REVENUE', key: 'EVENT', weight: toMoneyString(toDecimal(String(event.netTotal)).abs()) }, ...vatPart];
  return weights.some((item) => item.weight !== '0.00') ? weights : [{ source: 'REVENUE', key: 'EVENT', weight: '1' }];
}

/** Serbest fatura: net tutar gelire, vergi dökümü oran bazında hesaplanan KDV'ye. */
async function invoiceWeights(tx, hotelId, invoiceId) {
  const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, hotelId }, select: { netTotal: true, taxTotal: true, taxes: true } });
  if (!invoice) return [{ source: 'REVENUE', key: 'INVOICE', weight: '1' }];
  const vat = new Map();
  for (const line of /** @type {any[]} */ (invoice.taxes ?? [])) accumulate(vat, rateKey(line.rate), line.amount);
  const dumped = [...vat.values()].reduce((sum, amount) => sum.plus(amount), toDecimal(0));
  const tax = toDecimal(String(invoice.taxTotal));
  const vatPart = dumped.equals(tax) ? vatWeights(vat, 'VAT_OUTPUT') : tax.isZero() ? [] : [{ source: 'VAT_OUTPUT', key: '', weight: toMoneyString(tax.abs()) }];
  const weights = [{ source: 'REVENUE', key: 'INVOICE', weight: toMoneyString(toDecimal(String(invoice.netTotal)).abs()) }, ...vatPart];
  return weights.some((item) => item.weight !== '0.00') ? weights : [{ source: 'REVENUE', key: 'INVOICE', weight: '1' }];
}

/**
 * Ön muhasebe fişi: tahsilat / ödemede çek-senet satırları (alınan çek portföye, verilen çek ödenecek, ciro portföyden
 * çıkar); carisiz giriş / çıkışta fişte seçilen hesap ya da kural; virman kendi içinde dengeli.
 */
async function voucherWeights(tx, hotelId, voucherId) {
  const voucher = await tx.accountingVoucher.findFirst({
    where: { id: voucherId, hotelId },
    select: { type: true, glAccountId: true, lines: { select: { kind: true, amount: true, instrumentKind: true, instrument: { select: { kind: true, direction: true } } } } },
  });
  if (!voucher) return [];
  if (voucher.type === 'TRANSFER') return [];
  if (voucher.type === 'TREASURY_IN' || voucher.type === 'TREASURY_OUT') {
    return [{ source: voucher.type, key: '', weight: '1', accountId: voucher.glAccountId ?? null }];
  }
  if (voucher.type === 'OPENING') return [{ source: 'OPENING', key: '', weight: '1' }];
  const byKey = new Map();
  for (const line of voucher.lines) {
    if (line.kind === 'TREASURY') continue;
    const kind = line.kind === 'ENDORSE' ? (line.instrument?.kind ?? 'CHEQUE') : (line.instrumentKind ?? 'CHEQUE');
    const direction = line.kind === 'CHEQUE_OUT' ? 'ISSUED' : 'RECEIVED';
    accumulate(byKey, `${kind}:${direction}`, line.amount);
  }
  return [...byKey].filter(([, amount]) => !amount.isZero()).map(([key, amount]) => ({ source: 'INSTRUMENT', key, weight: toMoneyString(amount.abs()) }));
}

/** Çek / senet işlemi: fark çek / senet hesabına (tahsil kapatır, karşılıksız geri açar, ödeme kapatır). */
async function instrumentWeights(tx, hotelId, instrumentId) {
  const instrument = await tx.instrument.findFirst({ where: { id: instrumentId, hotelId }, select: { kind: true, direction: true } });
  if (!instrument) return [];
  return [{ source: 'INSTRUMENT', key: `${instrument.kind}:${instrument.direction}`, weight: '1' }];
}

/** Bordro tahakkuku: gider departman ağırlığıyla (işveren maliyeti). */
async function payrollWeights(tx, hotelId, runId) {
  const rows = /** @type {Array<{ departmentId: string | null, cost: string }>} */ (
    await tx.$queryRaw`
      SELECT e."departmentId", COALESCE(SUM(e."employerCost"), 0)::text AS "cost"
      FROM "PayrollEntry" e WHERE e."runId" = ${runId} AND e."hotelId" = ${hotelId}
      GROUP BY e."departmentId"`
  );
  const weights = rows.filter((row) => !toDecimal(row.cost).isZero()).map((row) => ({ source: 'PAYROLL_EXPENSE', key: row.departmentId ?? '', weight: toMoneyString(toDecimal(row.cost).abs()) }));
  return weights.length ? weights : [{ source: 'PAYROLL_EXPENSE', key: '', weight: '1' }];
}
