import { currentActor } from '@hotelos/core';
import { ASSET_DISPOSAL_TYPE_LABELS, assetCode, fromCents, toCents } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockAssets } from '../../lib/locks.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';
import { getAsset } from './assets-read.js';
import {
  accumulatedCents,
  addMovement,
  businessToday,
  dayDate,
  employeeLabel,
  isoDay,
  lastCoveredYear,
  loadAsset,
  locationLabel,
  money,
  nextSequence,
  postedByAsset,
  prisma,
  resolveCategory,
  resolveEmployee,
  resolveLocation,
} from './shared.js';

/**
 * Demirbaş kartının yazma işlemleri (modül 46): aç, düzelt, taşı, zimmetle / iade al, elden çıkar. Her işlem kartı
 * kilitler, sürüm damgasıyla yazar ve ekle-yalnız hareket geçmişine o anki adlarla satır ekler.
 *
 * - **Finansal kilit:** kaydedilmiş amortismanı olan kartın alış tarihi, tutarı, ömrü ve açılışı değişmez — yıl
 *   tablosu geriye dönük bozulmasın. Düzeltme için önce son yılın kaydı geri alınır.
 * - **Elden çıkarma (VUK):** çıkarıldığı yıl amortisman ayrılmaz; bu yüzden tarih, kartın amortismanla kapanmış son
 *   yılından sonra olmalı. Net değer (maliyet − birikmiş) o anda dondurulur; satışta kâr / zarar ondan hesaplanır.
 */

/** Finansal alanlar (kaydedilmiş amortisman varken değişmez). */
const FINANCIAL_FIELDS = Object.freeze(['purchaseDate', 'cost', 'usefulLifeYears', 'openingAccumulated', 'openingThroughYear']);
const FIELD_LABELS = Object.freeze({
  name: 'ad',
  categoryId: 'kategori',
  brand: 'marka',
  model: 'model',
  serialNumber: 'seri no',
  supplierName: 'tedarikçi',
  invoiceNumber: 'fatura no',
  warrantyUntil: 'garanti',
  note: 'not',
  purchaseDate: 'alış tarihi',
  cost: 'tutar',
  usefulLifeYears: 'ömür',
  openingAccumulated: 'önceki amortisman',
  openingThroughYear: 'önceki amortisman yılı',
});

/** Gelecek tarihli alış / açılış olamaz. @param {{ purchaseDate?: string, openingThroughYear?: number | null }} input @param {{ day: string, year: number }} today */
function assertNotFuture(input, today) {
  if (input.purchaseDate && input.purchaseDate > today.day) throw new ValidationError('Alış tarihi bugünden sonra olamaz', { field: 'purchaseDate' });
  if (input.openingThroughYear != null && input.openingThroughYear > today.year) {
    throw new ValidationError('Önceki amortisman yılı bu yıldan sonra olamaz', { field: 'openingThroughYear' });
  }
}

/** Kartın ilk değerleri (oluşturma + Excel). @param {Record<string, any>} input */
export function assetFinancialData(input, usefulLifeYears) {
  const opening = input.openingAccumulated && toCents(input.openingAccumulated) > 0n ? input.openingAccumulated : '0';
  return {
    purchaseDate: dayDate(input.purchaseDate),
    cost: input.cost,
    usefulLifeYears,
    openingAccumulated: opening,
    openingThroughYear: opening === '0' ? null : input.openingThroughYear,
    warrantyUntil: input.warrantyUntil ? dayDate(input.warrantyUntil) : null,
  };
}

/**
 * Demirbaş kartı aç. `requestId` ile idempotent: aynı form ikinci kez gelirse aynı kart döner.
 * @param {string} hotelId
 * @param {Record<string, any>} input `createAssetSchema`
 */
export async function createAsset(hotelId, input) {
  const existing = await prisma.asset.findFirst({ where: { hotelId, requestId: input.requestId }, select: { id: true } });
  if (existing) return getAsset(hotelId, existing.id);
  const today = await businessToday(hotelId);
  assertNotFuture(input, today);
  const actor = currentActor();
  try {
    const id = await writeWithEvents(async (tx, stage) => {
      const category = await resolveCategory(tx, hotelId, input.categoryId);
      const location = await resolveLocation(tx, hotelId, input);
      const employee = input.employeeId ? await resolveEmployee(tx, hotelId, input.employeeId) : null;
      const code = assetCode(await nextSequence(tx, hotelId, 'ASSET', 0));
      const asset = await tx.asset.create({
        data: {
          hotelId,
          code,
          requestId: input.requestId,
          name: input.name,
          categoryId: category.id,
          brand: input.brand ?? null,
          model: input.model ?? null,
          serialNumber: input.serialNumber ?? null,
          supplierName: input.supplierName ?? null,
          invoiceNumber: input.invoiceNumber ?? null,
          note: input.note ?? null,
          roomId: location.roomId,
          areaId: location.areaId,
          employeeId: employee?.id ?? null,
          assignedAt: employee ? new Date() : null,
          createdBy: actor,
          ...assetFinancialData(input, input.usefulLifeYears ?? category.usefulLifeYears),
        },
        select: { id: true },
      });
      await addMovement(tx, { hotelId, assetId: asset.id, kind: 'CREATED', toLabel: location.label, actor });
      if (employee) await addMovement(tx, { hotelId, assetId: asset.id, kind: 'ASSIGNED', toLabel: employee.label, actor });
      await stage('asset.changed', { hotelId, change: 'CREATED', assetIds: [asset.id] });
      return asset.id;
    });
    return getAsset(hotelId, id);
  } catch (error) {
    const raced = await prisma.asset.findFirst({ where: { hotelId, requestId: input.requestId }, select: { id: true } });
    if (raced) return getAsset(hotelId, raced.id);
    rethrowPrismaError(error);
  }
}

/** Formun gönderdiği alanlardan değişenler. @param {Record<string, any>} asset @param {Record<string, any>} data */
function changedFields(asset, data) {
  const current = {
    ...asset,
    purchaseDate: isoDay(asset.purchaseDate),
    warrantyUntil: isoDay(asset.warrantyUntil),
    cost: money(asset.cost),
    openingAccumulated: money(asset.openingAccumulated),
  };
  const same = (key, value) => (['cost', 'openingAccumulated'].includes(key) ? money(value ?? '0') === current[key] : (value ?? null) === (current[key] ?? null));
  return Object.keys(data).filter((key) => !same(key, data[key]));
}

/**
 * Kart düzeltmesi: kimlik alanları her zaman, finansal alanlar yalnız kaydedilmiş amortisman yokken.
 * @param {string} hotelId @param {string} assetId @param {Record<string, any>} input `updateAssetSchema`
 */
export async function updateAsset(hotelId, assetId, input) {
  const { expectedUpdatedAt, ...fields } = input;
  const data = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  if ('openingAccumulated' in data && (!data.openingAccumulated || toCents(data.openingAccumulated) === 0n)) {
    data.openingAccumulated = '0';
    data.openingThroughYear = null;
  }
  const today = await businessToday(hotelId);
  assertNotFuture(data, today);
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      await lockAssets(tx, hotelId, [assetId]);
      const asset = await loadAsset(tx, hotelId, assetId);
      const changed = changedFields(asset, data);
      if (changed.length === 0) return;
      if (changed.some((key) => FINANCIAL_FIELDS.includes(key))) {
        const posted = await tx.assetDepreciation.count({ where: { assetId } });
        if (posted > 0) {
          throw new ConflictError('Bu demirbaşın kaydedilmiş amortismanı var; alış tarihi, tutar, ömür ve önceki amortisman değişmez — önce son yılın kaydını geri alın', 'FINANCIALS_LOCKED');
        }
      }
      if (changed.includes('categoryId')) await resolveCategory(tx, hotelId, data.categoryId);
      const patch = Object.fromEntries(changed.map((key) => [key, data[key] ?? null]));
      if ('purchaseDate' in patch) patch.purchaseDate = dayDate(patch.purchaseDate);
      if ('warrantyUntil' in patch) {
        patch.warrantyUntil = patch.warrantyUntil ? dayDate(patch.warrantyUntil) : null;
        patch.warrantyAlertedFor = null;
      }
      await updateWithVersionCheck(tx, 'asset', { id: assetId, hotelId }, expectedUpdatedAt, patch, 'Demirbaş bulunamadı');
      await addMovement(tx, { hotelId, assetId, kind: 'UPDATED', note: `Düzeltilen: ${changed.map((key) => FIELD_LABELS[key] ?? key).join(', ')}`, actor });
      await recordAudit(tx, {
        hotelId,
        entity: 'Asset',
        entityId: assetId,
        action: 'UPDATE',
        before: Object.fromEntries(changed.map((key) => [key, String(asset[key] ?? '')])),
        after: Object.fromEntries(changed.map((key) => [key, String(data[key] ?? '')])),
      });
      await stage('asset.changed', { hotelId, change: 'UPDATED', assetIds: [assetId] });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getAsset(hotelId, assetId);
}

/**
 * Kartı başka bir odaya / alana taşı.
 * @param {string} hotelId @param {string} assetId @param {{ expectedUpdatedAt: Date, roomId?: string | null, areaId?: string | null, note?: string | null }} input
 */
export async function transferAsset(hotelId, assetId, input) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    await lockAssets(tx, hotelId, [assetId]);
    const asset = await loadAsset(tx, hotelId, assetId);
    const target = await resolveLocation(tx, hotelId, input);
    if (target.roomId === asset.roomId && target.areaId === asset.areaId) throw new ValidationError('Demirbaş zaten orada', { field: 'areaId' });
    await updateWithVersionCheck(tx, 'asset', { id: assetId, hotelId }, input.expectedUpdatedAt, { roomId: target.roomId, areaId: target.areaId }, 'Demirbaş bulunamadı');
    await addMovement(tx, { hotelId, assetId, kind: 'TRANSFERRED', fromLabel: locationLabel(asset), toLabel: target.label, note: input.note ?? null, actor });
    await stage('asset.changed', { hotelId, change: 'TRANSFERRED', assetIds: [assetId] });
  });
  return getAsset(hotelId, assetId);
}

/**
 * Personele zimmetle (başkasının zimmetindeyse devir: geçmişte kimden kime yazılır).
 * @param {string} hotelId @param {string} assetId @param {{ expectedUpdatedAt: Date, employeeId: string, note?: string | null }} input
 */
export async function assignAsset(hotelId, assetId, input) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    await lockAssets(tx, hotelId, [assetId]);
    const asset = await loadAsset(tx, hotelId, assetId);
    if (asset.employeeId === input.employeeId) throw new ValidationError('Demirbaş zaten bu personelin zimmetinde', { field: 'employeeId' });
    const employee = await resolveEmployee(tx, hotelId, input.employeeId);
    await updateWithVersionCheck(tx, 'asset', { id: assetId, hotelId }, input.expectedUpdatedAt, { employeeId: employee.id, assignedAt: new Date() }, 'Demirbaş bulunamadı');
    const fromLabel = asset.employee ? employeeLabel(asset.employee) : null;
    await addMovement(tx, { hotelId, assetId, kind: 'ASSIGNED', fromLabel, toLabel: employee.label, note: input.note ?? null, actor });
    await stage('asset.changed', { hotelId, change: 'ASSIGNED', assetIds: [assetId] });
  });
  return getAsset(hotelId, assetId);
}

/**
 * Zimmetten iade al.
 * @param {string} hotelId @param {string} assetId @param {{ expectedUpdatedAt: Date, note?: string | null }} input
 */
export async function returnAsset(hotelId, assetId, input) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    await lockAssets(tx, hotelId, [assetId]);
    const asset = await loadAsset(tx, hotelId, assetId);
    if (!asset.employee) throw new ConflictError('Demirbaş kimsenin zimmetinde değil', 'NOT_ASSIGNED');
    await updateWithVersionCheck(tx, 'asset', { id: assetId, hotelId }, input.expectedUpdatedAt, { employeeId: null, assignedAt: null }, 'Demirbaş bulunamadı');
    await addMovement(tx, { hotelId, assetId, kind: 'RETURNED', fromLabel: employeeLabel(asset.employee), note: input.note ?? null, actor });
    await stage('asset.changed', { hotelId, change: 'RETURNED', assetIds: [assetId] });
  });
  return getAsset(hotelId, assetId);
}

/**
 * Elden çıkar (satış, hurda, kayıp). Zimmet düşer; net değer dondurulur.
 * @param {string} hotelId @param {string} assetId
 * @param {{ expectedUpdatedAt: Date, type: 'SOLD' | 'SCRAPPED' | 'LOST', disposedOn: string, price?: string | null, reason: string }} input
 */
export async function disposeAsset(hotelId, assetId, input) {
  const today = await businessToday(hotelId);
  if (input.disposedOn > today.day) throw new ValidationError('Elden çıkarma tarihi bugünden sonra olamaz', { field: 'disposedOn' });
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    await lockAssets(tx, hotelId, [assetId]);
    const asset = await loadAsset(tx, hotelId, assetId);
    if (input.disposedOn < isoDay(asset.purchaseDate)) throw new ValidationError('Elden çıkarma tarihi alış tarihinden önce olamaz', { field: 'disposedOn' });
    const posted = (await postedByAsset(tx, [assetId])).get(assetId);
    const covered = lastCoveredYear(asset, posted);
    const disposedYear = Number(input.disposedOn.slice(0, 4));
    if (disposedYear <= covered) {
      throw new ConflictError(
        `Bu demirbaşın ${covered} yılı amortismanı ayrılmış; elden çıkarma tarihi ${covered + 1} ya da sonrası olmalı (VUK: çıkarıldığı yıl amortisman ayrılmaz) — gerekirse önce son yılın kaydını geri alın`,
        'DEPRECIATION_POSTED',
      );
    }
    const bookValue = fromCents(toCents(String(asset.cost)) - accumulatedCents(asset, posted));
    await updateWithVersionCheck(
      tx,
      'asset',
      { id: assetId, hotelId },
      input.expectedUpdatedAt,
      {
        status: 'DISPOSED',
        disposalType: input.type,
        disposedOn: dayDate(input.disposedOn),
        disposalPrice: input.type === 'SOLD' ? input.price : null,
        disposalReason: input.reason,
        disposalBookValue: bookValue,
        disposedBy: actor,
        employeeId: null,
        assignedAt: null,
      },
      'Demirbaş bulunamadı',
    );
    const note = [`${ASSET_DISPOSAL_TYPE_LABELS[input.type]}: ${input.reason}`, asset.employee ? `zimmet düştü (${employeeLabel(asset.employee)})` : null].filter(Boolean).join(' · ');
    await addMovement(tx, { hotelId, assetId, kind: 'DISPOSED', fromLabel: locationLabel(asset), note, actor });
    await recordAudit(tx, {
      hotelId,
      entity: 'Asset',
      entityId: assetId,
      action: 'UPDATE',
      before: { status: 'ACTIVE' },
      after: { status: 'DISPOSED', disposalType: input.type, disposedOn: input.disposedOn, price: input.price ?? null, bookValue },
    });
    await stage('asset.changed', { hotelId, change: 'DISPOSED', assetIds: [assetId] });
  });
  return getAsset(hotelId, assetId);
}

