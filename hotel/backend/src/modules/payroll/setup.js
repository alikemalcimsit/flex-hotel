import { currentActor } from '@hotelos/core';
import { payrollParameterValuesSchema } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import { BUILT_IN_PARAMETER_SETS } from './catalog.js';
import { dateOnly, day, ensureSystemElements, iso, loadPayrollSettings, markRunsStale, prisma } from './shared.js';

/**
 * Bordro ayarları (modül 51): işyeri bilgileri, yasal parametre setleri (FlexAI kataloğundan yükleme, düzeltme,
 * teyit), ödeme / kesinti kalemleri.
 *
 * Parametre seti değişince (ya da teyit kalkınca) o tarihten itibaren hesaplanmış açık bordrolar yeniden
 * hesaplanmalı olur. Onaylı ya da onaydaki bordronun kullandığı set değiştirilemez / silinemez.
 */

/* ═══════════════ İşyeri ═══════════════ */

/** @param {string} hotelId */
export async function getPayrollSettings(hotelId) {
  const row = await loadPayrollSettings(prisma, hotelId);
  return { ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
}

/** @param {string} hotelId @param {any} input */
export async function savePayrollSettings(hotelId, input) {
  const { expectedUpdatedAt, ...data } = input;
  await writeWithEvents(async (tx, stage) => {
    const before = await tx.payrollSettings.findFirst({ where: { hotelId } });
    if (before && expectedUpdatedAt && before.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) throw new StaleWriteError('Ayarlar bu arada değişti; yenileyip tekrar deneyin');
    await tx.payrollSettings.upsert({ where: { hotelId }, create: { hotelId, ...data, updatedBy: currentActor() }, update: { ...data, updatedBy: currentActor() } });
    await recordAudit(tx, { hotelId, entity: 'PayrollSettings', entityId: hotelId, action: before ? 'UPDATE' : 'CREATE', before: before ? { sector: before.sector, treasuryDiscount: before.treasuryDiscount, sgkWorkplaceNo: before.sgkWorkplaceNo } : null, after: data });
    if (!before || before.sector !== data.sector || before.treasuryDiscount !== data.treasuryDiscount) await markRunsStale(tx, hotelId, { fromYear: 2000, fromMonth: 1 });
    await stage('payroll.settings.changed', { hotelId, area: 'SETTINGS' });
  });
  return getPayrollSettings(hotelId);
}

/* ═══════════════ Yasal parametreler ═══════════════ */

/** @param {any} row @param {Set<string>} usedIds */
const presentSet = (row, usedIds) => ({
  id: row.id,
  validFrom: day(row.validFrom),
  label: row.label,
  values: row.values,
  sources: row.sources,
  catalogKey: row.catalogKey,
  verifiedBy: row.verifiedBy,
  verifiedAt: iso(row.verifiedAt),
  locked: usedIds.has(row.id),
  updatedAt: iso(row.updatedAt),
});

/** @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId */
async function lockedSetIds(client, hotelId) {
  const rows = await client.payrollRun.findMany({ where: { hotelId, status: { in: ['PENDING_APPROVAL', 'APPROVED'] }, parameterSetId: { not: null } }, select: { parameterSetId: true }, distinct: ['parameterSetId'] });
  return new Set(rows.map((row) => row.parameterSetId));
}

/** Otelin setleri + kataloğun henüz yüklenmemiş setleri. @param {string} hotelId */
export async function listParameterSets(hotelId) {
  const [rows, used] = await Promise.all([prisma.payrollParameterSet.findMany({ where: { hotelId }, orderBy: { validFrom: 'desc' }, take: 100 }), lockedSetIds(prisma, hotelId)]);
  const loaded = new Set(rows.map((row) => row.catalogKey).filter(Boolean));
  const dates = new Set(rows.map((row) => day(row.validFrom)));
  return {
    items: rows.map((row) => presentSet(row, used)),
    catalog: BUILT_IN_PARAMETER_SETS.filter((set) => !loaded.has(set.key) && !dates.has(set.validFrom)).map((set) => ({ key: set.key, validFrom: set.validFrom, label: set.label })),
  };
}

/**
 * Kataloğun yüklenmemiş setlerini otele kopyalar (aynı yürürlük günü varsa o set atlanır). Yüklenen set teyitsizdir.
 * @param {string} hotelId @param {string[] | null} keys boşsa hepsi
 */
export async function loadCatalogSets(hotelId, keys = null) {
  await writeWithEvents(async (tx, stage) => {
    const existing = await tx.payrollParameterSet.findMany({ where: { hotelId }, select: { validFrom: true, catalogKey: true } });
    const dates = new Set(existing.map((row) => day(row.validFrom)));
    const loaded = new Set(existing.map((row) => row.catalogKey).filter(Boolean));
    const wanted = BUILT_IN_PARAMETER_SETS.filter((set) => (!keys || keys.includes(set.key)) && !loaded.has(set.key) && !dates.has(set.validFrom));
    if (wanted.length === 0) throw new ConflictError('Yüklenecek yeni hazır set yok', 'PAYROLL_CATALOG_EMPTY');
    for (const set of wanted) {
      const created = await tx.payrollParameterSet.create({ data: { hotelId, validFrom: dateOnly(set.validFrom), label: set.label, values: set.values, sources: set.sources, catalogKey: set.key, createdBy: currentActor() } });
      await recordAudit(tx, { hotelId, entity: 'PayrollParameterSet', entityId: created.id, action: 'CREATE', after: { validFrom: set.validFrom, label: set.label, catalogKey: set.key } });
    }
    await ensureSystemElements(tx, hotelId);
    await markRunsStale(tx, hotelId, { fromYear: Number(wanted.at(-1).validFrom.slice(0, 4)), fromMonth: 1 });
    await stage('payroll.settings.changed', { hotelId, area: 'PARAMETERS' });
  });
  return listParameterSets(hotelId);
}

/**
 * Seti ekler ya da düzeltir. Değişen set teyitsiz olur (yeniden teyit gerekir). Onaylı / onaydaki bordronun seti
 * değiştirilemez: yeni yürürlük tarihli set eklenir.
 * @param {string} hotelId @param {any} input @param {string | null} setId
 */
export async function saveParameterSet(hotelId, input, setId = null) {
  const values = payrollParameterValuesSchema.parse(input.values);
  try {
    await writeWithEvents(async (tx, stage) => {
      if (setId) {
        const before = await tx.payrollParameterSet.findFirst({ where: { id: setId, hotelId } });
        if (!before) throw new NotFoundError('Parametre seti bulunamadı');
        if ((await lockedSetIds(tx, hotelId)).has(setId)) throw new ConflictError('Onaylı / onaydaki bordronun kullandığı set değişmez; yeni yürürlük tarihli set ekleyin', 'PAYROLL_PARAMETERS_LOCKED');
        await tx.payrollParameterSet.update({ where: { id: setId }, data: { validFrom: dateOnly(input.validFrom), label: input.label, values, sources: input.sources ?? [], verifiedBy: null, verifiedAt: null } });
        await recordAudit(tx, { hotelId, entity: 'PayrollParameterSet', entityId: setId, action: 'UPDATE', before: { validFrom: day(before.validFrom), label: before.label, values: before.values }, after: { validFrom: input.validFrom, label: input.label, values } });
        const from = new Date(Math.min(before.validFrom.getTime(), dateOnly(input.validFrom).getTime()));
        await markRunsStale(tx, hotelId, { fromYear: from.getUTCFullYear(), fromMonth: from.getUTCMonth() + 1 });
      } else {
        const created = await tx.payrollParameterSet.create({ data: { hotelId, validFrom: dateOnly(input.validFrom), label: input.label, values, sources: input.sources ?? [], createdBy: currentActor() } });
        await recordAudit(tx, { hotelId, entity: 'PayrollParameterSet', entityId: created.id, action: 'CREATE', after: { validFrom: input.validFrom, label: input.label, values } });
        await markRunsStale(tx, hotelId, { fromYear: Number(input.validFrom.slice(0, 4)), fromMonth: Number(input.validFrom.slice(5, 7)) });
      }
      await stage('payroll.settings.changed', { hotelId, area: 'PARAMETERS' });
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu yürürlük tarihinde başka bir set var' });
  }
  return listParameterSets(hotelId);
}

/**
 * "Resmî metinle teyit ettim": kim ve ne zaman denetim izinde. Teyitsiz setle hesaplanan bordro onaya gidemez.
 * @param {string} hotelId @param {string} setId @param {boolean} verified
 */
export async function verifyParameterSet(hotelId, setId, verified) {
  await writeWithEvents(async (tx, stage) => {
    const row = await tx.payrollParameterSet.findFirst({ where: { id: setId, hotelId } });
    if (!row) throw new NotFoundError('Parametre seti bulunamadı');
    if (!verified && (await lockedSetIds(tx, hotelId)).has(setId)) throw new ConflictError('Onaylı / onaydaki bordronun setinin teyidi kaldırılamaz', 'PAYROLL_PARAMETERS_LOCKED');
    await tx.payrollParameterSet.update({ where: { id: setId }, data: verified ? { verifiedBy: currentActor(), verifiedAt: new Date() } : { verifiedBy: null, verifiedAt: null } });
    await recordAudit(tx, { hotelId, entity: 'PayrollParameterSet', entityId: setId, action: 'UPDATE', before: { verifiedBy: row.verifiedBy }, after: { verifiedBy: verified ? currentActor() : null } });
    await stage('payroll.settings.changed', { hotelId, area: 'PARAMETERS' });
  });
  return listParameterSets(hotelId);
}

/** @param {string} hotelId @param {string} setId */
export async function deleteParameterSet(hotelId, setId) {
  await writeWithEvents(async (tx, stage) => {
    const row = await tx.payrollParameterSet.findFirst({ where: { id: setId, hotelId } });
    if (!row) throw new NotFoundError('Parametre seti bulunamadı');
    const used = await tx.payrollRun.findFirst({ where: { hotelId, parameterSetId: setId }, select: { number: true } });
    if (used) throw new ConflictError(`${used.number} bordrosu bu setle hesaplandı; set silinmez`, 'PAYROLL_PARAMETERS_IN_USE');
    await tx.payrollParameterSet.delete({ where: { id: setId } });
    await recordAudit(tx, { hotelId, entity: 'PayrollParameterSet', entityId: setId, action: 'DELETE', before: { validFrom: day(row.validFrom), label: row.label } });
    await markRunsStale(tx, hotelId, { fromYear: row.validFrom.getUTCFullYear(), fromMonth: row.validFrom.getUTCMonth() + 1 });
    await stage('payroll.settings.changed', { hotelId, area: 'PARAMETERS' });
  });
  return listParameterSets(hotelId);
}

/* ═══════════════ Kalemler ═══════════════ */

/** @param {string} hotelId */
export async function listPayElements(hotelId) {
  await ensureSystemElements(prisma, hotelId);
  const rows = await prisma.payElement.findMany({ where: { hotelId }, orderBy: [{ system: 'desc' }, { kind: 'asc' }, { name: 'asc' }], take: 200 });
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, kind: row.kind, system: row.system, sgk: row.sgk, gv: row.gv, dv: row.dv, exemption: row.exemption, isActive: row.isActive }));
}

/**
 * Otelin kendi kalemi. Sistem kalemi değişmez (kanunun davranışı). Kullanılmış kalemin vergi davranışı değişince
 * açık bordrolar yeniden hesaplanmalı olur.
 * @param {string} hotelId @param {any} input @param {string | null} elementId
 */
export async function savePayElement(hotelId, input, elementId = null) {
  try {
    await writeWithEvents(async (tx, stage) => {
      if (elementId) {
        const before = await tx.payElement.findFirst({ where: { id: elementId, hotelId } });
        if (!before) throw new NotFoundError('Kalem bulunamadı');
        if (before.system) throw new ConflictError('Sistem kalemi değiştirilemez', 'PAY_ELEMENT_SYSTEM');
        if (before.code !== input.code) throw new ValidationError('Kalem kodu değişmez', { fields: { code: 'Kod değişmez' } });
        await tx.payElement.update({ where: { id: elementId }, data: { name: input.name, kind: input.kind, sgk: input.sgk, gv: input.gv, dv: input.dv, exemption: input.exemption, isActive: input.isActive } });
        await recordAudit(tx, { hotelId, entity: 'PayElement', entityId: elementId, action: 'UPDATE', before: { name: before.name, sgk: before.sgk, gv: before.gv, dv: before.dv, exemption: before.exemption }, after: input });
        await markRunsStale(tx, hotelId, { fromYear: 2000, fromMonth: 1 });
      } else {
        const created = await tx.payElement.create({ data: { hotelId, ...input, system: false } });
        await recordAudit(tx, { hotelId, entity: 'PayElement', entityId: created.id, action: 'CREATE', after: input });
      }
      await stage('payroll.settings.changed', { hotelId, area: 'ELEMENT' });
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kalem kodu kullanılıyor' });
  }
  return listPayElements(hotelId);
}
