import { currentActor } from '@hotelos/core';
import { MAX_MENU_CATEGORIES, MAX_MENU_ITEMS, MAX_POS_OUTLETS, MAX_POS_TABLES_PER_OUTLET } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { containsText } from '../../lib/search.js';
import { writeWithEvents } from '../../lib/write.js';
import { getHotelSettings } from '../settings/service.js';
import { iso, loadPosSettings, money, prisma } from './shared.js';

/**
 * POS tanımları (modül 39) ve menü (modül 38'in menü kısmı): satış noktaları, masalar,
 * menü grupları, ürünler (fiyat, vergi kategorisi, istasyon, tükendi) ve politika.
 *
 * Silme yok: satış geçmişi olan kayıt silinmez, pasife alınır (adisyon kalemleri ürünün
 * gönderildiği anki adını / fiyatını kopyalar; ürünün sonraki değişikliği geçmişi bozmaz).
 */

const OUTLET_SELECT = Object.freeze({ id: true, code: true, name: true, allowRoomCharge: true, isActive: true, sortOrder: true, updatedAt: true });
const TABLE_SELECT = Object.freeze({ id: true, outletId: true, name: true, seats: true, zone: true, isActive: true, sortOrder: true, updatedAt: true });
const CATEGORY_SELECT = Object.freeze({ id: true, name: true, sortOrder: true, isActive: true, outletIds: true, updatedAt: true, _count: { select: { items: true } } });
const ITEM_SELECT = Object.freeze({
  id: true,
  categoryId: true,
  code: true,
  name: true,
  description: true,
  price: true,
  taxCategory: true,
  station: true,
  isActive: true,
  soldOut: true,
  sortOrder: true,
  updatedAt: true,
  category: { select: { name: true } },
});

/** @param {any} row */
const outletDto = (row) => ({ ...row, updatedAt: iso(row.updatedAt) });
/** @param {any} row */
const tableDto = (row) => ({ ...row, updatedAt: iso(row.updatedAt) });
/** @param {any} row */
const categoryDto = (row) => ({ id: row.id, name: row.name, sortOrder: row.sortOrder, isActive: row.isActive, outletIds: row.outletIds, itemCount: row._count?.items ?? 0, updatedAt: iso(row.updatedAt) });
/** @param {any} row */
const itemDto = (row) => ({
  id: row.id,
  categoryId: row.categoryId,
  categoryName: row.category?.name ?? null,
  code: row.code,
  name: row.name,
  description: row.description,
  price: money(row.price),
  taxCategory: row.taxCategory,
  station: row.station,
  isActive: row.isActive,
  soldOut: row.soldOut,
  sortOrder: row.sortOrder,
  updatedAt: iso(row.updatedAt),
});

/** Kayıt sürüm denetimi. @param {{ updatedAt: Date }} row @param {Date} expected */
function assertVersion(row, expected) {
  if (row.updatedAt.getTime() !== expected.getTime()) throw new StaleWriteError();
}

/**
 * Tanım yazımlarının ortak kalıbı: iş + denetim izi + `pos.setup.changed`.
 * @template T
 * @param {string} hotelId
 * @param {'OUTLET' | 'TABLE' | 'CATEGORY' | 'ITEM' | 'SETTINGS'} entity
 * @param {(tx: any) => Promise<{ id: string, audit: { entity: string, action: string, before?: any, after?: any }, result: T }>} work
 * @param {string} [uniqueMessage]
 * @returns {Promise<T>}
 */
async function writeSetup(hotelId, entity, work, uniqueMessage) {
  try {
    return await writeWithEvents(async (tx, stage) => {
      const { id, audit, result } = await work(tx);
      await recordAudit(tx, { hotelId, entityId: id, ...audit });
      await stage('pos.setup.changed', { hotelId, entity, entityId: id });
      return result;
    });
  } catch (error) {
    rethrowPrismaError(error, uniqueMessage ? { uniqueMessage } : undefined);
  }
}

/* ══════════════════ Satış noktası ══════════════════ */

/** @param {string} hotelId */
export async function listOutlets(hotelId) {
  const rows = await prisma.posOutlet.findMany({ where: { hotelId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], take: MAX_POS_OUTLETS, select: OUTLET_SELECT });
  return { items: rows.map(outletDto) };
}

/** @param {string} hotelId @param {any} input `createPosOutletSchema` */
export function createOutlet(hotelId, input) {
  const actor = currentActor();
  return writeSetup(
    hotelId,
    'OUTLET',
    async (tx) => {
      if ((await tx.posOutlet.count({ where: { hotelId } })) >= MAX_POS_OUTLETS) throw new ConflictError(`En fazla ${MAX_POS_OUTLETS} satış noktası tanımlanabilir`, 'LIMIT');
      const row = await tx.posOutlet.create({ data: { hotelId, ...input, createdBy: actor }, select: OUTLET_SELECT });
      return { id: row.id, audit: { entity: 'PosOutlet', action: 'CREATE', after: outletDto(row) }, result: outletDto(row) };
    },
    'Bu kodlu bir satış noktası zaten var',
  );
}

/**
 * Satış noktasını günceller. Açık adisyonu varken pasife alınamaz (servis yarıda kalır).
 * @param {string} hotelId @param {string} outletId @param {any} input `updatePosOutletSchema`
 */
export function updateOutlet(hotelId, outletId, input) {
  const { expectedUpdatedAt, ...data } = input;
  return writeSetup(
    hotelId,
    'OUTLET',
    async (tx) => {
      const before = await tx.posOutlet.findFirst({ where: { id: outletId, hotelId }, select: OUTLET_SELECT });
      if (!before) throw new NotFoundError('Satış noktası bulunamadı');
      assertVersion(before, expectedUpdatedAt);
      if (before.isActive && !data.isActive && (await tx.posCheck.count({ where: { hotelId, outletId, status: 'OPEN' } })) > 0) {
        throw new ConflictError('Bu satış noktasında açık adisyon var; önce kapatın ya da taşıyın.', 'OUTLET_IN_USE');
      }
      const row = await tx.posOutlet.update({ where: { id: outletId }, data, select: OUTLET_SELECT });
      return { id: outletId, audit: { entity: 'PosOutlet', action: 'UPDATE', before: outletDto(before), after: outletDto(row) }, result: outletDto(row) };
    },
    'Bu kodlu bir satış noktası zaten var',
  );
}

/* ══════════════════ Masa ══════════════════ */

/** @param {string} hotelId @param {string} outletId */
export async function listTables(hotelId, outletId) {
  const rows = await prisma.posTable.findMany({
    where: { hotelId, outletId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    take: MAX_POS_TABLES_PER_OUTLET,
    select: TABLE_SELECT,
  });
  return { items: rows.map(tableDto) };
}

/** @param {any} tx @param {string} hotelId @param {string} outletId */
async function assertOutlet(tx, hotelId, outletId) {
  const outlet = await tx.posOutlet.findFirst({ where: { id: outletId, hotelId }, select: { id: true } });
  if (!outlet) throw new ValidationError('Satış noktası bulunamadı', { field: 'outletId' });
}

/** @param {string} hotelId @param {any} input `createPosTableSchema` */
export function createTable(hotelId, input) {
  return writeSetup(
    hotelId,
    'TABLE',
    async (tx) => {
      await assertOutlet(tx, hotelId, input.outletId);
      if ((await tx.posTable.count({ where: { outletId: input.outletId } })) >= MAX_POS_TABLES_PER_OUTLET) {
        throw new ConflictError(`Bir satış noktasında en fazla ${MAX_POS_TABLES_PER_OUTLET} masa olur`, 'LIMIT');
      }
      const row = await tx.posTable.create({ data: { hotelId, ...input }, select: TABLE_SELECT });
      return { id: row.id, audit: { entity: 'PosTable', action: 'CREATE', after: tableDto(row) }, result: tableDto(row) };
    },
    'Bu satış noktasında aynı adlı bir masa zaten var',
  );
}

/**
 * Toplu masa ekleme ("1–24"): var olan adlar atlanır (yeniden çalıştırmak güvenli).
 * @param {string} hotelId @param {any} input `bulkPosTablesSchema`
 */
export function createTablesBulk(hotelId, input) {
  return writeSetup(hotelId, 'TABLE', async (tx) => {
    await assertOutlet(tx, hotelId, input.outletId);
    const names = Array.from({ length: input.to - input.from + 1 }, (_, index) => `${input.prefix}${input.from + index}`);
    const existing = new Set((await tx.posTable.findMany({ where: { outletId: input.outletId, name: { in: names } }, select: { name: true } })).map((row) => row.name));
    const fresh = names.filter((name) => !existing.has(name));
    const count = await tx.posTable.count({ where: { outletId: input.outletId } });
    if (count + fresh.length > MAX_POS_TABLES_PER_OUTLET) throw new ConflictError(`Bir satış noktasında en fazla ${MAX_POS_TABLES_PER_OUTLET} masa olur`, 'LIMIT');
    if (fresh.length) {
      await tx.posTable.createMany({
        data: fresh.map((name, index) => ({ hotelId, outletId: input.outletId, name, seats: input.seats, zone: input.zone ?? null, sortOrder: count + index })),
      });
    }
    return {
      id: input.outletId,
      audit: { entity: 'PosTable', action: 'CREATE', after: { outletId: input.outletId, created: fresh, skipped: [...existing] } },
      result: { created: fresh.length, skipped: existing.size },
    };
  });
}

/**
 * Masayı günceller. Açık adisyonu olan masa başka satış noktasına taşınamaz ve pasife alınamaz.
 * @param {string} hotelId @param {string} tableId @param {any} input `updatePosTableSchema`
 */
export function updateTable(hotelId, tableId, input) {
  const { expectedUpdatedAt, ...data } = input;
  return writeSetup(
    hotelId,
    'TABLE',
    async (tx) => {
      const before = await tx.posTable.findFirst({ where: { id: tableId, hotelId }, select: TABLE_SELECT });
      if (!before) throw new NotFoundError('Masa bulunamadı');
      assertVersion(before, expectedUpdatedAt);
      await assertOutlet(tx, hotelId, data.outletId);
      const moving = data.outletId !== before.outletId || (before.isActive && !data.isActive);
      if (moving && (await tx.posCheck.count({ where: { hotelId, tableId, status: 'OPEN' } })) > 0) {
        throw new ConflictError('Masada açık adisyon var; önce kapatın ya da başka masaya taşıyın.', 'TABLE_IN_USE');
      }
      const row = await tx.posTable.update({ where: { id: tableId }, data, select: TABLE_SELECT });
      return { id: tableId, audit: { entity: 'PosTable', action: 'UPDATE', before: tableDto(before), after: tableDto(row) }, result: tableDto(row) };
    },
    'Bu satış noktasında aynı adlı bir masa zaten var',
  );
}

/* ══════════════════ Menü grubu ══════════════════ */

/** @param {string} hotelId */
export async function listCategories(hotelId) {
  const rows = await prisma.menuCategory.findMany({ where: { hotelId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], take: MAX_MENU_CATEGORIES, select: CATEGORY_SELECT });
  return { items: rows.map(categoryDto) };
}

/** Grubun satış noktaları bu otelin mi. @param {any} tx @param {string} hotelId @param {string[]} outletIds */
async function assertOutlets(tx, hotelId, outletIds) {
  if (!outletIds.length) return;
  const found = await tx.posOutlet.count({ where: { hotelId, id: { in: outletIds } } });
  if (found !== new Set(outletIds).size) throw new ValidationError('Satış noktalarından biri bulunamadı', { field: 'outletIds' });
}

/** @param {string} hotelId @param {any} input `createMenuCategorySchema` */
export function createCategory(hotelId, input) {
  const actor = currentActor();
  return writeSetup(
    hotelId,
    'CATEGORY',
    async (tx) => {
      if ((await tx.menuCategory.count({ where: { hotelId } })) >= MAX_MENU_CATEGORIES) throw new ConflictError(`En fazla ${MAX_MENU_CATEGORIES} menü grubu olur`, 'LIMIT');
      await assertOutlets(tx, hotelId, input.outletIds);
      const row = await tx.menuCategory.create({ data: { hotelId, ...input, outletIds: [...new Set(input.outletIds)], createdBy: actor }, select: CATEGORY_SELECT });
      return { id: row.id, audit: { entity: 'MenuCategory', action: 'CREATE', after: categoryDto(row) }, result: categoryDto(row) };
    },
    'Bu adla bir menü grubu zaten var',
  );
}

/** @param {string} hotelId @param {string} categoryId @param {any} input `updateMenuCategorySchema` */
export function updateCategory(hotelId, categoryId, input) {
  const { expectedUpdatedAt, ...data } = input;
  return writeSetup(
    hotelId,
    'CATEGORY',
    async (tx) => {
      const before = await tx.menuCategory.findFirst({ where: { id: categoryId, hotelId }, select: CATEGORY_SELECT });
      if (!before) throw new NotFoundError('Menü grubu bulunamadı');
      assertVersion(before, expectedUpdatedAt);
      await assertOutlets(tx, hotelId, data.outletIds);
      const row = await tx.menuCategory.update({ where: { id: categoryId }, data: { ...data, outletIds: [...new Set(data.outletIds)] }, select: CATEGORY_SELECT });
      return { id: categoryId, audit: { entity: 'MenuCategory', action: 'UPDATE', before: categoryDto(before), after: categoryDto(row) }, result: categoryDto(row) };
    },
    'Bu adla bir menü grubu zaten var',
  );
}

/* ══════════════════ Ürün ══════════════════ */

/**
 * Ürün listesi (tanım ekranı; sayfalı): gruba, duruma ve ad / koda göre.
 * @param {string} hotelId @param {any} query `menuItemListQuerySchema`
 */
export async function listItems(hotelId, query) {
  const where = /** @type {Record<string, any>} */ ({ hotelId });
  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.active) where.isActive = query.active === 'true';
  const search = query.search?.trim();
  if (search) where.OR = [{ name: containsText(search) }, { code: { contains: search.toUpperCase() } }];
  const [rows, total] = await Promise.all([
    prisma.menuItem.findMany({ where, orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }], ...toSkipTake(query), select: ITEM_SELECT }),
    prisma.menuItem.count({ where }),
  ]);
  return buildPage(rows.map(itemDto), total, query);
}

/** @param {any} tx @param {string} hotelId @param {string} categoryId */
async function assertCategory(tx, hotelId, categoryId) {
  const category = await tx.menuCategory.findFirst({ where: { id: categoryId, hotelId }, select: { id: true } });
  if (!category) throw new ValidationError('Menü grubu bulunamadı', { field: 'categoryId' });
}

const itemUnique = 'Bu kodlu ya da bu grupta aynı adlı bir ürün zaten var';

/** @param {string} hotelId @param {any} input `createMenuItemSchema` */
export function createItem(hotelId, input) {
  const actor = currentActor();
  return writeSetup(
    hotelId,
    'ITEM',
    async (tx) => {
      if ((await tx.menuItem.count({ where: { hotelId } })) >= MAX_MENU_ITEMS) throw new ConflictError(`En fazla ${MAX_MENU_ITEMS} ürün tanımlanabilir`, 'LIMIT');
      await assertCategory(tx, hotelId, input.categoryId);
      const row = await tx.menuItem.create({ data: { hotelId, ...input, createdBy: actor }, select: ITEM_SELECT });
      return { id: row.id, audit: { entity: 'MenuItem', action: 'CREATE', after: itemDto(row) }, result: itemDto(row) };
    },
    itemUnique,
  );
}

/**
 * Ürünü günceller. Fiyat değişikliği yalnızca yeni siparişlere yansır (gönderilmiş kalem
 * fiyatını kopyalamıştır).
 * @param {string} hotelId @param {string} itemId @param {any} input `updateMenuItemSchema`
 */
export function updateItem(hotelId, itemId, input) {
  const { expectedUpdatedAt, ...data } = input;
  return writeSetup(
    hotelId,
    'ITEM',
    async (tx) => {
      const before = await tx.menuItem.findFirst({ where: { id: itemId, hotelId }, select: ITEM_SELECT });
      if (!before) throw new NotFoundError('Ürün bulunamadı');
      assertVersion(before, expectedUpdatedAt);
      await assertCategory(tx, hotelId, data.categoryId);
      const row = await tx.menuItem.update({ where: { id: itemId }, data, select: ITEM_SELECT });
      return { id: itemId, audit: { entity: 'MenuItem', action: 'UPDATE', before: itemDto(before), after: itemDto(row) }, result: itemDto(row) };
    },
    itemUnique,
  );
}

/**
 * Servis sırasında "tükendi" anahtarı (şef garson): sürüm istemez — iki kişi aynı anda
 * "tükendi" derse sonuç aynıdır.
 * @param {string} hotelId @param {string} itemId @param {{ soldOut: boolean }} input
 */
export function setSoldOut(hotelId, itemId, { soldOut }) {
  return writeSetup(hotelId, 'ITEM', async (tx) => {
    const before = await tx.menuItem.findFirst({ where: { id: itemId, hotelId }, select: ITEM_SELECT });
    if (!before) throw new NotFoundError('Ürün bulunamadı');
    const row = await tx.menuItem.update({ where: { id: itemId }, data: { soldOut }, select: ITEM_SELECT });
    return { id: itemId, audit: { entity: 'MenuItem', action: 'UPDATE', before: { soldOut: before.soldOut }, after: { soldOut } }, result: itemDto(row) };
  });
}

/* ══════════════════ Politika ══════════════════ */

/** @param {string} hotelId */
export const getSettings = (hotelId) => loadPosSettings(prisma, hotelId);

/**
 * Politika (tek satır; ilk kayıtta açılır). Otel satırı kilitlenir: ilk kayıt iki kez açılmaz.
 * @param {string} hotelId @param {any} input `updatePosSettingsSchema`
 */
export async function updateSettings(hotelId, input) {
  const { expectedUpdatedAt, ...data } = input;
  await writeSetup(hotelId, 'SETTINGS', async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Hotel" WHERE "id" = ${hotelId} FOR UPDATE`;
    const before = await tx.posSettings.findFirst({ where: { hotelId } });
    if (before && (!expectedUpdatedAt || before.updatedAt.getTime() !== expectedUpdatedAt.getTime())) throw new StaleWriteError();
    if (!before && expectedUpdatedAt) throw new StaleWriteError();
    const after = before ? await tx.posSettings.update({ where: { hotelId }, data }) : await tx.posSettings.create({ data: { hotelId, ...data } });
    const snapshot = (row) => (row ? { adjustmentApprovalAmount: money(row.adjustmentApprovalAmount), cashVarianceAlert: money(row.cashVarianceAlert) } : null);
    return { id: hotelId, audit: { entity: 'PosSettings', action: before ? 'UPDATE' : 'CREATE', before: snapshot(before), after: snapshot(after) }, result: null };
  });
  return getSettings(hotelId);
}

/* ══════════════════ Terminal ══════════════════ */

/**
 * POS terminalinin açılış verisi (tek çağrı): satış noktaları, masaları, grupları ve satılan
 * ürünleri (aktif; grubun satış noktası kısıtıyla). Boyut sınırlı (satış noktası, masa,
 * grup, ürün sınırları).
 *
 * @param {string} hotelId
 */
export async function getTerminal(hotelId) {
  const [outlets, tables, categories, items, settings, hotel] = await Promise.all([
    prisma.posOutlet.findMany({ where: { hotelId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], take: MAX_POS_OUTLETS, select: OUTLET_SELECT }),
    prisma.posTable.findMany({ where: { hotelId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], take: MAX_POS_OUTLETS * MAX_POS_TABLES_PER_OUTLET, select: TABLE_SELECT }),
    prisma.menuCategory.findMany({ where: { hotelId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], take: MAX_MENU_CATEGORIES, select: CATEGORY_SELECT }),
    prisma.menuItem.findMany({
      where: { hotelId, isActive: true, category: { isActive: true } },
      // Menü sırası: önce grubun sırası, sonra ürünün.
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
      take: MAX_MENU_ITEMS,
      select: ITEM_SELECT,
    }),
    loadPosSettings(prisma, hotelId),
    getHotelSettings(hotelId),
  ]);
  return {
    currency: hotel.currency,
    outlets: outlets.map(outletDto),
    tables: tables.map(tableDto),
    categories: categories.map(categoryDto),
    items: items.map(itemDto),
    settings,
  };
}
