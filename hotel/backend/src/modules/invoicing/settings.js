import { currentActor } from '@hotelos/core';
import { EDOC_PROVIDERS, EDOC_PROVIDER_LABELS, INVOICE_TAX_CODES } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import { calendarToday, dateOnly, day, hotelContext, iso, prisma } from './shared.js';
import { forgetTaxpayer } from './taxpayers.js';

/**
 * Fatura ayarları (modül 16 / 49): satıcı (otelin işletmesi) bilgileri, seriler, otomatik taslak, entegratör ve
 * ortam, otelin vergi satırlarının GİB vergi koduna eşlenmesi; test ortamının mükellef listesi.
 */

/** Test ortamında en fazla mükellef (liste ekranı tek sayfa). */
const MAX_TEST_TAXPAYERS = 200;

const SETTINGS_FIELDS = Object.freeze([
  'legalName',
  'taxNumber',
  'taxOffice',
  'mersisNo',
  'tradeRegistryNo',
  'street',
  'district',
  'city',
  'postalCode',
  'country',
  'phone',
  'email',
  'website',
  'eFaturaPrefix',
  'eArsivPrefix',
  'provider',
  'environment',
  'senderAlias',
  'autoDraft',
  'footerNote',
  'bankInfo',
]);

/** Vergi adından GİB kodu önerisi (ayar ekranı; personel onaylar). @param {string} name */
export function suggestTaxCode(name) {
  const lower = name.toLocaleLowerCase('tr-TR');
  if (lower.includes('konaklama')) return '0059';
  if (lower.includes('kdv') || lower.includes('katma')) return '0015';
  return null;
}

/** @param {string} hotelId */
export async function getInvoiceSettings(hotelId) {
  const [context, settings, taxes, codes, testTaxpayers, issuedCount] = await Promise.all([
    hotelContext(hotelId),
    prisma.invoiceSettings.findUnique({ where: { hotelId } }),
    prisma.tax.findMany({ where: { hotelId }, select: { id: true, name: true, rate: true, isIncluded: true, appliesTo: true }, orderBy: { name: 'asc' } }),
    prisma.invoiceTaxCode.findMany({ where: { hotelId }, select: { taxId: true, code: true } }),
    prisma.testTaxpayer.findMany({ where: { hotelId }, orderBy: { title: 'asc' }, take: MAX_TEST_TAXPAYERS }),
    prisma.invoice.count({ where: { hotelId, status: { not: 'DRAFT' } } }),
  ]);
  const mapped = new Map(codes.map((row) => [row.taxId, row.code]));
  return {
    settings: settings ? { ...Object.fromEntries(SETTINGS_FIELDS.map((field) => [field, /** @type {any} */ (settings)[field]])), startDate: day(settings.startDate), updatedAt: iso(settings.updatedAt), updatedBy: settings.updatedBy } : null,
    taxes: taxes.map((tax) => ({
      id: tax.id,
      name: tax.name,
      rate: String(tax.rate),
      isIncluded: tax.isIncluded,
      appliesTo: tax.appliesTo,
      code: mapped.get(tax.id) ?? null,
      suggested: suggestTaxCode(tax.name),
    })),
    taxCodes: Object.entries(INVOICE_TAX_CODES).map(([code, name]) => ({ code, name })),
    providers: EDOC_PROVIDERS.map((name) => ({ name, label: EDOC_PROVIDER_LABELS[name] })),
    testTaxpayers: testTaxpayers.map((row) => ({ id: row.id, taxNumber: row.taxNumber, title: row.title, alias: row.alias, behavior: row.behavior, updatedAt: iso(row.updatedAt) })),
    issuedCount,
    today: calendarToday(context.timezone),
  };
}

/**
 * Faturalama başlangıcı bugünden sonra olamaz (kuyruk bugünü kapsamalı). İleri alınması, aradaki faturalanmamış
 * folyo / etkinlikleri kuyruktan çıkarır (önceki sistemde faturalandıkları kabul edilir): ekran bunu söyler,
 * denetim izi önceki günü tutar.
 * @param {string} hotelId @param {any} input
 */
export async function saveInvoiceSettings(hotelId, input) {
  const actor = currentActor();
  const context = await hotelContext(hotelId);
  if (input.startDate > calendarToday(context.timezone)) throw new ValidationError('Faturalama başlangıcı bugünden sonra olamaz', { field: 'startDate' });
  await writeWithEvents(async (tx, stage) => {
    const existing = await tx.invoiceSettings.findUnique({ where: { hotelId } });
    if (existing && (!input.expectedUpdatedAt || existing.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime())) throw new StaleWriteError();
    if (!existing && input.expectedUpdatedAt) throw new StaleWriteError();
    const taxIds = input.taxCodes.map((row) => row.taxId);
    const owned = await tx.tax.findMany({ where: { hotelId, id: { in: taxIds } }, select: { id: true } });
    if (owned.length !== new Set(taxIds).size) throw new ValidationError('Eşlenen vergilerden biri bu otelin değil ya da silinmiş', { field: 'taxCodes' });
    const data = Object.fromEntries(SETTINGS_FIELDS.map((field) => [field, input[field] ?? null]));
    data.country = input.country ?? 'Türkiye';
    data.autoDraft = input.autoDraft ?? true;
    data.startDate = dateOnly(input.startDate);
    const saved = existing
      ? await tx.invoiceSettings.update({ where: { hotelId }, data: { ...data, updatedBy: actor } })
      : await tx.invoiceSettings.create({ data: { hotelId, ...data, updatedBy: actor } });
    await tx.invoiceTaxCode.deleteMany({ where: { hotelId } });
    if (input.taxCodes.length) await tx.invoiceTaxCode.createMany({ data: input.taxCodes.map((row) => ({ hotelId, taxId: row.taxId, code: row.code })) });
    await recordAudit(tx, {
      hotelId,
      entity: 'InvoiceSettings',
      entityId: hotelId,
      action: existing ? 'UPDATE' : 'CREATE',
      before: existing ? { ...Object.fromEntries(SETTINGS_FIELDS.map((field) => [field, /** @type {any} */ (existing)[field]])), startDate: day(existing.startDate) } : null,
      after: { ...Object.fromEntries(SETTINGS_FIELDS.map((field) => [field, /** @type {any} */ (saved)[field]])), startDate: day(saved.startDate), taxCodes: input.taxCodes },
    });
    await stage('invoice.settings.changed', { hotelId });
  });
  return getInvoiceSettings(hotelId);
}

/* ─────────────── Test mükellefleri ─────────────── */

/** @param {string} hotelId @param {any} input */
export async function createTestTaxpayer(hotelId, input) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    if ((await tx.testTaxpayer.count({ where: { hotelId } })) >= MAX_TEST_TAXPAYERS) throw new ConflictError(`Test ortamında en fazla ${MAX_TEST_TAXPAYERS} mükellef`, 'TEST_TAXPAYER_LIMIT');
    if (await tx.testTaxpayer.findFirst({ where: { hotelId, taxNumber: input.taxNumber }, select: { id: true } })) throw new ValidationError('Bu vergi no listede var', { field: 'taxNumber' });
    const created = await tx.testTaxpayer.create({ data: { hotelId, ...input, createdBy: actor } });
    await forgetTaxpayer(tx, hotelId, input.taxNumber);
    await recordAudit(tx, { hotelId, entity: 'TestTaxpayer', entityId: created.id, action: 'CREATE', after: input });
    await stage('invoice.settings.changed', { hotelId });
  });
  return getInvoiceSettings(hotelId);
}

/** @param {string} hotelId @param {string} taxpayerId @param {any} input */
export async function updateTestTaxpayer(hotelId, taxpayerId, input) {
  await writeWithEvents(async (tx, stage) => {
    const row = await tx.testTaxpayer.findFirst({ where: { id: taxpayerId, hotelId } });
    if (!row) throw new NotFoundError('Test mükellefi bulunamadı');
    if (input.taxNumber !== row.taxNumber && (await tx.testTaxpayer.findFirst({ where: { hotelId, taxNumber: input.taxNumber }, select: { id: true } }))) {
      throw new ValidationError('Bu vergi no listede var', { field: 'taxNumber' });
    }
    await tx.testTaxpayer.update({ where: { id: taxpayerId }, data: input });
    await forgetTaxpayer(tx, hotelId, row.taxNumber);
    await forgetTaxpayer(tx, hotelId, input.taxNumber);
    await recordAudit(tx, { hotelId, entity: 'TestTaxpayer', entityId: taxpayerId, action: 'UPDATE', before: { taxNumber: row.taxNumber, title: row.title, alias: row.alias, behavior: row.behavior }, after: input });
    await stage('invoice.settings.changed', { hotelId });
  });
  return getInvoiceSettings(hotelId);
}

/** @param {string} hotelId @param {string} taxpayerId */
export async function deleteTestTaxpayer(hotelId, taxpayerId) {
  await writeWithEvents(async (tx, stage) => {
    const row = await tx.testTaxpayer.findFirst({ where: { id: taxpayerId, hotelId } });
    if (!row) throw new NotFoundError('Test mükellefi bulunamadı');
    await tx.testTaxpayer.delete({ where: { id: taxpayerId } });
    await forgetTaxpayer(tx, hotelId, row.taxNumber);
    await recordAudit(tx, { hotelId, entity: 'TestTaxpayer', entityId: taxpayerId, action: 'DELETE', before: { taxNumber: row.taxNumber, title: row.title } });
    await stage('invoice.settings.changed', { hotelId });
  });
  return getInvoiceSettings(hotelId);
}
