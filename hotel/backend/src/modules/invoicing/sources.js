import { calendarDateInTimeZone, toDecimal, toIsoDay } from '@hotelos/core';
import { EVENT_UNIT_TO_INVOICE_UNIT, INVOICE_FOLIO_GROUP_LABELS, buildInvoiceLines, invoiceTotals, toCents } from '@hotelos/hotel-contracts';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { chargeLine } from '../folios/rules.js';
import { day, dotted, money } from './shared.js';

/**
 * Faturanın kaynakları (modül 16 / 49): folyo kalemleri, etkinlik kalemleri, elle girilen satırlar → fatura
 * satırları (`buildInvoiceLines`) ve kaynağın varsayılan alıcısı.
 *
 * Folyo faturası gelir grubu başına tek satırdır (geceler "Konaklama" satırında, dönemiyle); etkinlik
 * faturası kalem başına; serbest fatura ve iptal bedeli faturası personelin satırlarıyla — birim tutar otelin
 * vergi ayarıyla (dahil vergiler içinde) folyodaki formülle hesaplanır.
 */

/** @typedef {import('@hotelos/hotel-contracts').InvoiceBuyer} InvoiceBuyer */

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | any} client
 * @param {string} hotelId
 * @param {Record<string, unknown>} where
 * @returns {Promise<InvoiceBuyer | null>} aynı misafirin / carinin son kesilmiş faturasındaki alıcı
 */
async function lastBuyer(client, hotelId, where) {
  const row = await client.invoice.findFirst({ where: { hotelId, status: 'ISSUED', ...where }, orderBy: { issuedAt: 'desc' }, select: { buyer: true } });
  return row?.buyer && typeof row.buyer === 'object' && row.buyer.type ? /** @type {InvoiceBuyer} */ (row.buyer) : null;
}

/** Ad soyadı ayır: son sözcük soyad. @param {string} name */
function splitName(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) } : { firstName: parts[0] ?? '', lastName: '' };
}

/**
 * Cari → alıcı. Kimlik (ünvan, vergi no, daire, iletişim) carinin kartından; adres son faturadan (kartta
 * serbest metin). Şahıs carisi (düğün çifti, bireysel müşteri) kişi alıcıdır: ad soyad ayrılır, TC kimlik no
 * karttan; önceki faturası varsa onun alıcısı.
 * @param {any} account @param {InvoiceBuyer | null} last
 * @returns {InvoiceBuyer}
 */
export function buyerFromAccount(account, last) {
  if (account.type === 'PERSON') {
    if (last && (last.type === 'PERSON' || last.type === 'FOREIGN')) return { ...last, email: last.email ?? account.email ?? null, phone: last.phone ?? account.phone ?? null };
    return {
      type: 'PERSON',
      ...splitName(account.name),
      taxNumber: account.taxNumber?.length === 11 ? account.taxNumber : null,
      street: account.address ?? null,
      district: null,
      city: null,
      postalCode: null,
      country: 'Türkiye',
      email: account.email ?? null,
      phone: account.phone ?? null,
      alias: null,
    };
  }
  return {
    type: 'COMPANY',
    district: null,
    city: null,
    postalCode: null,
    country: 'Türkiye',
    alias: null,
    // Önceki faturada yabancı şirket seçildiyse (yurt dışındaki acente) öyle kalır.
    ...(last?.type === 'COMPANY' || last?.type === 'FOREIGN_COMPANY' ? last : {}),
    name: account.name,
    taxNumber: account.taxNumber ?? last?.taxNumber ?? null,
    taxOffice: account.taxOffice ?? last?.taxOffice ?? null,
    street: last?.street ?? account.address ?? null,
    email: account.email ?? last?.email ?? null,
    phone: account.phone ?? last?.phone ?? null,
  };
}

/**
 * Misafir → alıcı. Önceki faturası varsa onun alıcısı (adres, uyruk dahil); yoksa kimlik belgesinden:
 * T.C. kimliği → kişi, pasaport ya da yabancı uyruk → yabancı uyruklu kişi.
 * @param {any} guest @param {InvoiceBuyer | null} last
 * @returns {InvoiceBuyer}
 */
export function buyerFromGuest(guest, last) {
  if (last) return { ...last, email: last.email ?? guest.email ?? null, phone: last.phone ?? guest.phone ?? null };
  const nationality = guest.nationality ? String(guest.nationality).toUpperCase().slice(0, 2) : null;
  const foreign = guest.idType === 'PASSPORT' || (nationality !== null && nationality !== 'TR');
  return {
    type: foreign ? 'FOREIGN' : 'PERSON',
    firstName: guest.firstName,
    lastName: guest.lastName,
    taxNumber: !foreign && guest.idType === 'NATIONAL_ID' ? guest.idNumber : null,
    nationality: foreign ? nationality : null,
    passportNo: foreign ? guest.idNumber : null,
    street: null,
    district: null,
    city: null,
    postalCode: null,
    country: foreign ? null : 'Türkiye',
    email: guest.email ?? null,
    phone: guest.phone ?? null,
    alias: null,
  };
}

/** Etkinlik müşterisi (carisi yoksa) → alıcı. @param {any} client @returns {InvoiceBuyer} */
function buyerFromEventClient(client) {
  if (client.type === 'PERSON') {
    return { type: 'PERSON', ...splitName(client.name), taxNumber: client.taxNumber?.length === 11 ? client.taxNumber : null, street: client.address ?? null, district: null, city: null, country: 'Türkiye', email: client.email ?? null, phone: client.phone ?? null };
  }
  return { type: 'COMPANY', name: client.name, taxNumber: client.taxNumber ?? null, taxOffice: client.taxOffice ?? null, street: client.address ?? null, district: null, city: null, country: 'Türkiye', email: client.email ?? null, phone: client.phone ?? null };
}

/**
 * Vergi tutarı vergi satırlarıyla tutmayan kalem (eski / dışarıdan yazılmış kayıt): fatura vergiyi satırlardan
 * kurar; satırı eksik kalem faturayı sessizce eksik vergili keserdi. Sebebi söyleyerek durur.
 * @param {Array<{ taxAmount: unknown, taxLines: unknown }>} items @param {string} what
 */
function assertTaxBreakdown(items, what) {
  const broken = items.filter((item) => {
    const lines = Array.isArray(item.taxLines) ? item.taxLines : [];
    return lines.reduce((sum, line) => sum + toCents(String(line.amount)), 0n) !== toCents(money(item.taxAmount));
  }).length;
  if (broken) {
    throw new ConflictError(`${broken} ${what} kaleminin vergi dökümü eksik (vergi tutarı vergi satırlarıyla tutmuyor; eski kayıt): kalemler ters kayıtla düzeltilip yeniden işlenmeden faturalanamaz`, 'INVOICE_TAX_BREAKDOWN');
  }
}

/** @param {any} taxLines */
const chargeTaxes = (taxLines) => (Array.isArray(taxLines) ? taxLines : []).map((line) => ({ taxId: line.taxId, rate: String(line.rate), amount: String(line.amount) }));

/* ═══════════════ Folyo ═══════════════ */

/**
 * Kapanmış folyonun fatura kaynağı.
 * @param {any} client @param {string} hotelId @param {string} folioId
 */
export async function folioSource(client, hotelId, folioId) {
  const folio = await client.folio.findFirst({
    where: { id: folioId, hotelId },
    select: {
      id: true,
      status: true,
      window: true,
      currency: true,
      chargesTotal: true,
      reservationId: true,
      guestId: true,
      closedAt: true,
      guest: { select: { id: true, firstName: true, lastName: true, nationality: true, idType: true, idNumber: true, email: true, phone: true } },
      reservation: { select: { confirmationCode: true, agencyId: true, room: { select: { number: true } } } },
    },
  });
  if (!folio) throw new NotFoundError('Folyo bulunamadı');
  const items = await client.folioItem.findMany({
    where: { hotelId, folioId },
    select: { type: true, taxCategory: true, netAmount: true, taxAmount: true, total: true, taxLines: true, serviceDate: true, quantity: true },
  });
  assertTaxBreakdown(items, 'folyo');
  const charges = items.map((item) => {
    const group = item.type === 'DISCOUNT' ? (item.taxCategory ?? 'OTHER') : item.type;
    return {
      group,
      description: INVOICE_FOLIO_GROUP_LABELS[group] ?? INVOICE_FOLIO_GROUP_LABELS.OTHER,
      discount: item.type === 'DISCOUNT',
      net: money(item.netAmount),
      taxes: chargeTaxes(item.taxLines),
      quantity: String(item.quantity),
      unitCode: group === 'ROOM' ? 'DAY' : 'C62',
      serviceDate: day(item.serviceDate),
    };
  });
  return { folio, charges, expectedTotal: money(folio.chargesTotal) };
}

/**
 * Folyonun varsayılan alıcısı: bakiyesi "Acente / cari" ya da voucher ile bir cariye aktarıldıysa o cari
 * (en büyük aktarım), değilse misafir.
 * @param {any} client @param {string} hotelId @param {any} folio
 * @returns {Promise<{ buyer: InvoiceBuyer, ledgerAccountId: string | null, guestId: string | null }>}
 */
export async function folioDefaultBuyer(client, hotelId, folio) {
  const transfer = await client.payment.findFirst({
    where: { hotelId, folioId: folio.id, method: { in: ['AGENCY', 'VOUCHER'] }, kind: 'PAYMENT', status: 'POSTED', reversal: { is: null } },
    orderBy: [{ folioAmount: 'desc' }, { receivedAt: 'asc' }],
    select: { ledgerAccountId: true },
  });
  let accountId = transfer?.ledgerAccountId ?? null;
  if (transfer && !accountId && folio.reservation?.agencyId) {
    accountId = (await client.ledgerAccount.findFirst({ where: { hotelId, agencyId: folio.reservation.agencyId }, select: { id: true } }))?.id ?? null;
  }
  if (accountId) {
    const account = await client.ledgerAccount.findFirst({ where: { id: accountId, hotelId }, select: { id: true, type: true, name: true, taxNumber: true, taxOffice: true, address: true, email: true, phone: true } });
    if (account) return { buyer: buyerFromAccount(account, await lastBuyer(client, hotelId, { ledgerAccountId: account.id })), ledgerAccountId: account.id, guestId: null };
  }
  const guest = folio.guest;
  return { buyer: buyerFromGuest(guest, await lastBuyer(client, hotelId, { guestId: guest.id })), ledgerAccountId: null, guestId: guest.id };
}

/* ═══════════════ Etkinlik ═══════════════ */

/**
 * Etkinliğin fatura kaynağı: gerçekleşmişse kalemleri, iptal bedeli kesinleşmişse elle satır (iptal bedeli).
 * @param {any} client @param {string} hotelId @param {string} eventId @param {string} timezone
 */
export async function eventSource(client, hotelId, eventId, timezone) {
  const event = await client.event.findFirst({
    where: { id: eventId, hotelId },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      currency: true,
      grandTotal: true,
      cancellationFee: true,
      firstStartAt: true,
      lastEndAt: true,
      client: { select: { id: true, type: true, name: true, taxOffice: true, taxNumber: true, address: true, email: true, phone: true, ledgerAccount: { select: { id: true, type: true, name: true, taxNumber: true, taxOffice: true, address: true, email: true, phone: true } } } },
    },
  });
  if (!event) throw new NotFoundError('Etkinlik bulunamadı');
  const zoned = (value) => (value ? toIsoDay(calendarDateInTimeZone(timezone, value)) : null);
  const serviceFrom = zoned(event.firstStartAt);
  const serviceTo = zoned(event.lastEndAt) ?? serviceFrom;
  if (event.status === 'COMPLETED') {
    const items = await client.eventItem.findMany({
      where: { eventId: event.id, hotelId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, description: true, billedQuantity: true, unit: true, netAmount: true, taxAmount: true, taxLines: true },
    });
    assertTaxBreakdown(items, 'etkinlik');
    const charges = items.map((item) => ({
      group: item.id,
      description: item.description,
      net: money(item.netAmount),
      taxes: chargeTaxes(item.taxLines),
      quantity: String(item.billedQuantity),
      unitCode: EVENT_UNIT_TO_INVOICE_UNIT[item.unit] ?? 'C62',
      serviceDate: serviceTo,
    }));
    return { event, kind: /** @type {const} */ ('COMPLETED'), charges, expectedTotal: money(event.grandTotal), serviceFrom, serviceTo };
  }
  const fee = event.cancellationFee === null ? toDecimal(0) : toDecimal(String(event.cancellationFee));
  if (event.status === 'CANCELLED' && fee.greaterThan(0)) {
    return { event, kind: /** @type {const} */ ('CANCELLATION'), charges: null, expectedTotal: money(fee), serviceFrom, serviceTo };
  }
  throw new ConflictError('Etkinlik faturaya hazır değil: gerçekleşmiş ya da iptal bedeli kesinleşmiş olmalı', 'EVENT_NOT_INVOICEABLE');
}

/**
 * Etkinliğin alıcısı: müşterinin carisi varsa o (kimlik carinin kartından), yoksa müşteri kartı.
 * @param {any} client @param {string} hotelId @param {any} event
 */
export async function eventDefaultBuyer(client, hotelId, event) {
  const account = event.client.ledgerAccount;
  if (account) return { buyer: buyerFromAccount(account, await lastBuyer(client, hotelId, { ledgerAccountId: account.id })), ledgerAccountId: account.id };
  return { buyer: buyerFromEventClient(event.client), ledgerAccountId: null };
}

/* ═══════════════ Elle girilen satırlar ═══════════════ */

/**
 * Serbest fatura / iptal bedeli satırları: folyodaki formülle (otelin vergi ayarı, kategori).
 * @param {any} client @param {string} hotelId
 * @param {Array<{ description: string, quantity: string, unitCode: string, unitAmount: string, taxCategory: string }>} inputs
 */
export async function manualCharges(client, hotelId, inputs) {
  const taxes = await client.tax.findMany({ where: { hotelId }, select: { id: true, name: true, rate: true, isIncluded: true, appliesTo: true } });
  const settings = taxes.map((tax) => ({ ...tax, rate: String(tax.rate) }));
  return inputs.map((input, index) => {
    const line = chargeLine({ amount: input.unitAmount, quantity: /** @type {any} */ (input.quantity), taxCategory: input.taxCategory, taxes: settings });
    return {
      group: `m${index}`,
      description: input.description,
      net: line.netAmount,
      taxes: chargeTaxes(line.taxLines),
      quantity: input.quantity,
      unitCode: input.unitCode,
      serviceDate: null,
      input,
    };
  });
}

/**
 * Kaynak satırlarından fatura satırları + toplamlar. Folyo faturasında konaklama satırı dönemini taşır;
 * elle girilen satırlar girdilerini (kategori, birim tutar) saklar ki taslak yeniden düzenlenebilsin.
 *
 * @param {{ source: 'FOLIO' | 'EVENT' | 'MANUAL', charges: any[], taxCodes: Map<string, { code: string, name: string }>, expectedTotal?: string | null }} input
 */
export function composeInvoice({ source, charges, taxCodes, expectedTotal = null }) {
  const { lines, problems } = buildInvoiceLines({ charges, taxCodes });
  const inputs = new Map(charges.filter((charge) => charge.input).map((charge) => [charge.group, charge.input]));
  const decorated = lines.map((line) => {
    const input = inputs.get(line.group);
    let description = line.description;
    if (source === 'FOLIO' && line.serviceFrom && line.serviceTo) {
      description = `${line.description} (${line.serviceFrom === line.serviceTo ? dotted(line.serviceFrom) : `${dotted(line.serviceFrom)} – ${dotted(line.serviceTo)}`})`;
    }
    return { ...line, description, taxCategory: input?.taxCategory ?? null, unitAmount: input?.unitAmount ?? null };
  });
  const totals = invoiceTotals(decorated);
  if (problems.length === 0 && decorated.length === 0) problems.push('Faturalanacak tutar yok');
  if (problems.length === 0 && expectedTotal !== null && totals.payable !== money(expectedTotal)) {
    problems.push(`Fatura toplamı (${totals.payable}) kaynağın toplamıyla (${money(expectedTotal)}) tutmuyor`);
  }
  return { lines: decorated, totals, problems };
}
