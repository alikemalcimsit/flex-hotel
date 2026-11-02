import { calendarDateInTimeZone, toIsoDay, toMoneyString } from '@hotelos/core';
import { INVOICE_TAX_CODES, zonedWallTimeToUtc } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';

export { prisma };
export { hotelContext } from '../banquet/shared.js';

/**
 * Fatura modülünün ortak parçaları (modül 16 çekirdeği + 49): ayar, vergi kodu eşlemesi, numara sırası,
 * zaman çizelgesi ve görünüm dönüşümleri.
 */

/** @param {Date | null | undefined} value */
export const iso = (value) => (value ? value.toISOString() : null);
/** @param {Date | null | undefined} value */
export const day = (value) => (value ? toIsoDay(value) : null);
/** @param {string} text YYYY-MM-DD */
export const dateOnly = (text) => new Date(`${text}T00:00:00.000Z`);
/** @param {unknown} value */
export const money = (value) => toMoneyString(String(value ?? 0));
const trMoney = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Zaman çizelgesi / onay metni için: "12.345,60 TRY" (para birimi verilmezse yalnız tutar). @param {unknown} amount @param {string} [currency] */
export const priced = (amount, currency) => `${trMoney.format(Number(money(amount)))}${currency ? ` ${currency}` : ''}`;
/** "2026-10-12" → "12.10.2026". @param {string} text */
export const dotted = (text) => text.split('-').reverse().join('.');

/**
 * Faturanın tarihi otelin **takvim** günüdür (iş günü değil): gece kapanışı gecikse de fatura gerçek
 * düzenlendiği günü taşır, numaralar tarih sırasını bozmaz.
 * @param {string} timezone
 */
export const calendarToday = (timezone) => toIsoDay(calendarDateInTimeZone(timezone));

/**
 * Faturalama başlangıcının ilk anı (otelin saatiyle gece yarısı): bu andan önce kapanan folyo / etkinlik önceki
 * sistemde faturalanmış sayılır.
 * @param {{ startDate: Date }} settings @param {string} timezone
 */
export const invoicingStartsAt = (settings, timezone) => zonedWallTimeToUtc(`${toIsoDay(settings.startDate)}T00:00`, timezone);

/** Otelin saat diliminde "SS:DD:ss" (UBL `IssueTime`). @param {Date} at @param {string} timezone */
export function clockTime(at, timezone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(at);
}

/** @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId */
export function loadInvoiceSettings(client, hotelId) {
  return client.invoiceSettings.findUnique({ where: { hotelId } });
}

/**
 * Otelin vergi satırı → GİB vergi kodu (adıyla).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId
 * @returns {Promise<Map<string, { code: string, name: string }>>}
 */
export async function loadTaxCodeMap(client, hotelId) {
  const rows = await client.invoiceTaxCode.findMany({ where: { hotelId }, select: { taxId: true, code: true } });
  return new Map(rows.map((row) => [row.taxId, { code: row.code, name: INVOICE_TAX_CODES[row.code] ?? row.code }]));
}

/**
 * Seri × yıl sırasının sıradaki numarası. Satır kilidi işlem sonuna kadar tutulur: eşzamanlı iki kesim
 * sırayla numara alır; işlem geri alınırsa sıra da geri alınır (boşluk kalmaz).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} prefix @param {number} year
 */
export async function nextInvoiceSequence(tx, hotelId, prefix, year) {
  const rows = /** @type {Array<{ last: number }>} */ (
    await tx.$queryRaw`
      INSERT INTO "InvoiceSequence" ("hotelId", "prefix", "year", "last") VALUES (${hotelId}, ${prefix}, ${year}, 1)
      ON CONFLICT ("hotelId", "prefix", "year") DO UPDATE SET "last" = "InvoiceSequence"."last" + 1
      RETURNING "last"`
  );
  return Number(rows[0].last);
}

/**
 * Zaman çizelgesine satır.
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {{ hotelId: string, invoiceId: string, kind: string, state?: string | null, code?: string | null, message?: string | null, actor: string }} entry
 */
export function addInvoiceLog(client, { hotelId, invoiceId, kind, state = null, code = null, message = null, actor }) {
  return client.invoiceLog.create({
    data: { hotelId, invoiceId, kind, state: /** @type {any} */ (state), code, message: message ? message.slice(0, 1000) : null, actor },
  });
}

/** Liste satırı alanları (alıcının bütün bilgisi ve satırlar ayrıntıda). */
export const INVOICE_LIST_SELECT = Object.freeze({
  id: true,
  source: true,
  status: true,
  uuid: true,
  number: true,
  documentType: true,
  folioId: true,
  eventId: true,
  ledgerAccountId: true,
  currency: true,
  issueDate: true,
  issuedAt: true,
  serviceFrom: true,
  serviceTo: true,
  buyerType: true,
  buyerName: true,
  buyerTaxNumber: true,
  netTotal: true,
  taxTotal: true,
  total: true,
  edocState: true,
  edocStatusCode: true,
  edocMessage: true,
  edocAttempts: true,
  edocNextAttemptAt: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {any} row */
export const invoiceListView = (row) => ({
  id: row.id,
  source: row.source,
  status: row.status,
  uuid: row.uuid,
  number: row.number,
  documentType: row.documentType,
  folioId: row.folioId,
  eventId: row.eventId,
  ledgerAccountId: row.ledgerAccountId,
  currency: row.currency,
  issueDate: day(row.issueDate),
  issuedAt: iso(row.issuedAt),
  serviceFrom: day(row.serviceFrom),
  serviceTo: day(row.serviceTo),
  buyerType: row.buyerType,
  buyerName: row.buyerName,
  buyerTaxNumber: row.buyerTaxNumber,
  netTotal: money(row.netTotal),
  taxTotal: money(row.taxTotal),
  total: money(row.total),
  edocState: row.edocState,
  edocStatusCode: row.edocStatusCode,
  edocMessage: row.edocMessage,
  edocAttempts: row.edocAttempts,
  edocNextAttemptAt: iso(row.edocNextAttemptAt),
  createdBy: row.createdBy,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

/** @param {any} line */
export const invoiceLineView = (line) => ({
  id: line.id,
  description: line.description,
  quantity: String(line.quantity),
  unitCode: line.unitCode,
  unitPrice: money(line.unitPrice),
  gross: money(line.grossAmount),
  discount: money(line.discountAmount),
  net: money(line.netAmount),
  taxAmount: money(line.taxAmount),
  total: money(line.total),
  taxes: line.taxes ?? [],
  serviceFrom: day(line.serviceFrom),
  serviceTo: day(line.serviceTo),
  taxCategory: line.taxCategory,
  unitAmount: line.unitAmount === null || line.unitAmount === undefined ? null : money(line.unitAmount),
});

/**
 * Fatura satırlarının veritabanı satırı.
 * @param {string} hotelId @param {string} invoiceId
 * @param {Array<import('@hotelos/hotel-contracts').InvoiceLine & { taxCategory?: string | null, unitAmount?: string | null }>} lines
 */
export const lineRows = (hotelId, invoiceId, lines) =>
  lines.map((line, index) => ({
    hotelId,
    invoiceId,
    sortOrder: index,
    description: line.description,
    quantity: line.quantity,
    unitCode: line.unitCode,
    unitPrice: line.unitPrice,
    grossAmount: line.gross,
    discountAmount: line.discount,
    netAmount: line.net,
    taxAmount: line.taxAmount,
    total: line.total,
    taxes: line.taxes,
    serviceFrom: line.serviceFrom ? dateOnly(line.serviceFrom) : null,
    serviceTo: line.serviceTo ? dateOnly(line.serviceTo) : null,
    taxCategory: line.taxCategory ?? null,
    unitAmount: line.unitAmount ?? null,
  }));
