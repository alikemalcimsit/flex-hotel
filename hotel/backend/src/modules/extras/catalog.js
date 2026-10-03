import { toDecimal, toMoneyString } from '@hotelos/core';
import { LAUNDRY_MAX_ACTIVE_ITEMS, MINIBAR_MAX_ACTIVE_ITEMS } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, rethrowPrismaError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';

/**
 * Minibar ve çamaşırhane fiyat listeleri (modül 19).
 *
 * Fiyat vergi ayarına göre (kalem tipi minibar / çamaşırhane) dahil ya da
 * hariç yorumlanır; vergi folyoda hesaplanır. Fiş ve sipariş satırları ürünün
 * o anki adını ve fiyatını saklar: liste sonradan değişse de geçmiş değişmez.
 * Ürün silinmez, pasife alınır ya da (yumuşak) silinir; kodu yeniden
 * kullanılabilir (kısmi tekil index).
 *
 * Satıştaki ürün sayısı sınırlı (`*_MAX_ACTIVE_ITEMS`): giriş ekranı bütün
 * listeyi tek seferde gösterir — sınır, o okumanın da sınırıdır.
 */

/** Prisma Decimal → "1234.50" (bütün modüllerdeki gibi iki ondalık). */
const money = (value) => (value === null || value === undefined ? null : toMoneyString(String(value)));
const iso = (value) => (value ? value.toISOString() : null);

/** Katalog türleri: model adı, etiket, satıştaki ürün sınırı, ek alan. */
const CATALOGS = Object.freeze({
  MINIBAR: { model: 'minibarItem', label: 'Minibar ürünü', max: MINIBAR_MAX_ACTIVE_ITEMS, entity: 'MinibarItem' },
  LAUNDRY: { model: 'laundryItem', label: 'Çamaşır kalemi', max: LAUNDRY_MAX_ACTIVE_ITEMS, entity: 'LaundryItem' },
});

/** @param {any} row */
function toItemDto(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    ...(row.category !== undefined ? { category: row.category, parLevel: row.parLevel } : {}),
    ...(row.service !== undefined ? { service: row.service } : {}),
    price: money(row.price),
    active: row.active,
    sortOrder: row.sortOrder,
    updatedAt: iso(row.updatedAt),
  };
}

/** Denetim izi özeti. */
const itemAudit = (row) => toItemDto(row);

/**
 * Yönetim listesi (sayfalı, aramalı).
 * @param {'MINIBAR' | 'LAUNDRY'} kind
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string, includeInactive: boolean }} query
 */
export async function listCatalog(kind, hotelId, query) {
  const { model } = CATALOGS[kind];
  const where = {
    hotelId,
    ...(query.includeInactive ? {} : { active: true }),
    ...(query.search
      ? { OR: [{ code: { contains: query.search, mode: 'insensitive' } }, { name: { contains: query.search, mode: 'insensitive' } }] }
      : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma[model].findMany({ where, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }], ...toSkipTake(query) }),
    prisma[model].count({ where }),
  ]);
  return buildPage(rows.map(toItemDto), total, query);
}

/**
 * Giriş ekranının satıştaki ürünleri (sıralı). Sınır, satıştaki ürün sınırıdır.
 * @param {'MINIBAR' | 'LAUNDRY'} kind
 * @param {string} hotelId
 */
export async function activeCatalog(kind, hotelId) {
  const { model, max } = CATALOGS[kind];
  const rows = await prisma[model].findMany({
    where: { hotelId, active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    take: max,
  });
  return rows.map(toItemDto);
}

/**
 * Satıştaki ürün sınırı aşılmasın (giriş ekranı listeyi tek seferde çizer).
 * @param {any} tx
 * @param {'MINIBAR' | 'LAUNDRY'} kind
 * @param {string} hotelId
 * @param {string | null} exceptId
 */
async function assertActiveLimit(tx, kind, hotelId, exceptId) {
  const { model, max, label } = CATALOGS[kind];
  const active = await tx[model].count({ where: { hotelId, active: true, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (active >= max) {
    throw new ConflictError(`Satışta en fazla ${max} ${label.toLocaleLowerCase('tr')} olabilir; önce kullanılmayanları pasife alın.`, 'CATALOG_LIMIT');
  }
}

/**
 * Kod otel içinde (silinmemişler arasında) tekil.
 * @param {any} tx
 * @param {'MINIBAR' | 'LAUNDRY'} kind
 * @param {string} hotelId
 * @param {string} code
 * @param {string | null} exceptId
 */
async function assertCodeFree(tx, kind, hotelId, code, exceptId) {
  const { model } = CATALOGS[kind];
  const taken = await tx[model].findFirst({ where: { hotelId, code, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  if (taken) throw new ConflictError(`${code} kodu kullanılıyor; başka bir kod seçin.`, 'DUPLICATE', { field: 'code' });
}

/**
 * @param {'MINIBAR' | 'LAUNDRY'} kind
 * @param {string} hotelId
 * @param {object} input `minibarItemInputSchema` / `laundryItemInputSchema` çıktısı
 */
export async function createCatalogItem(kind, hotelId, input) {
  const { model, entity } = CATALOGS[kind];
  try {
    return await writeWithEvents(async (tx, stage) => {
      await assertCodeFree(tx, kind, hotelId, input.code, null);
      if (input.active) await assertActiveLimit(tx, kind, hotelId, null);
      const created = await tx[model].create({ data: { hotelId, ...input } });
      await recordAudit(tx, { hotelId, entity, entityId: created.id, action: 'CREATE', after: itemAudit(created) });
      await stage('extras.catalog.changed', { hotelId, catalog: kind });
      return toItemDto(created);
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kod kullanılıyor' });
  }
}

/**
 * @param {'MINIBAR' | 'LAUNDRY'} kind
 * @param {string} hotelId
 * @param {string} id
 * @param {object} input `update*ItemSchema` çıktısı (sürüm damgalı)
 */
export async function updateCatalogItem(kind, hotelId, id, input) {
  const { model, entity, label } = CATALOGS[kind];
  const { expectedUpdatedAt, ...data } = input;
  try {
    return await writeWithEvents(async (tx, stage) => {
      const before = await tx[model].findFirst({ where: { id, hotelId } });
      if (!before) throw new NotFoundError(`${label} bulunamadı`);
      await assertCodeFree(tx, kind, hotelId, data.code, id);
      if (data.active && !before.active) await assertActiveLimit(tx, kind, hotelId, id);
      await updateWithVersionCheck(tx, model, { id, hotelId }, expectedUpdatedAt, data, `${label} bulunamadı`);
      const after = await tx[model].findFirst({ where: { id, hotelId } });
      await recordAudit(tx, { hotelId, entity, entityId: id, action: 'UPDATE', before: itemAudit(before), after: itemAudit(after) });
      await stage('extras.catalog.changed', { hotelId, catalog: kind });
      return toItemDto(after);
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kod kullanılıyor' });
  }
}

/**
 * Ürünü listeden kaldırır (yumuşak silme): geçmiş fiş ve siparişlerdeki
 * satırlar adını ve fiyatını kendisi taşıdığı için etkilenmez.
 * @param {'MINIBAR' | 'LAUNDRY'} kind
 * @param {string} hotelId
 * @param {string} id
 */
export async function deleteCatalogItem(kind, hotelId, id) {
  const { model, entity, label } = CATALOGS[kind];
  await writeWithEvents(async (tx, stage) => {
    const before = await tx[model].findFirst({ where: { id, hotelId } });
    if (!before) throw new NotFoundError(`${label} bulunamadı`);
    await tx[model].update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    await recordAudit(tx, { hotelId, entity, entityId: id, action: 'DELETE', before: itemAudit(before) });
    await stage('extras.catalog.changed', { hotelId, catalog: kind });
  });
}

/** @param {string} hotelId */
export async function getLaundrySettings(hotelId) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId }, select: { laundryExpressPct: true, currency: true } });
  if (!hotel) throw new NotFoundError('Otel kaydı bulunamadı');
  return { expressPct: toDecimal(String(hotel.laundryExpressPct)).toString(), currency: hotel.currency };
}

/**
 * Ekspres farkı (yüzde). Açık siparişler sipariş anındaki yüzdeyi korur.
 * @param {string} hotelId
 * @param {{ expressPct: string }} input
 */
export async function updateLaundrySettings(hotelId, { expressPct }) {
  await writeWithEvents(async (tx, stage) => {
    const before = await tx.hotel.findFirst({ where: { id: hotelId }, select: { laundryExpressPct: true } });
    if (!before) throw new NotFoundError('Otel kaydı bulunamadı');
    await tx.hotel.update({ where: { id: hotelId }, data: { laundryExpressPct: expressPct } });
    await recordAudit(tx, {
      hotelId,
      entity: 'Hotel',
      entityId: hotelId,
      action: 'UPDATE',
      before: { laundryExpressPct: toDecimal(String(before.laundryExpressPct)).toString() },
      after: { laundryExpressPct: expressPct },
    });
    await stage('extras.catalog.changed', { hotelId, catalog: 'SETTINGS' });
    // Otel satırı (sürüm damgası) değişti: ayarların önbelleği de tazelensin, yoksa
    // açık "Genel parametreler" formu eski damgayla kaydedemez.
    await stage('settings.hotel.updated', { hotelId, changedFields: ['laundryExpressPct'] });
  });
  return getLaundrySettings(hotelId);
}
