import { currentActor } from '@hotelos/core';
import { KITCHEN_UNIT_LABELS, unitsCompatible } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockStockItems } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { containsText, searchTokens } from '../../lib/search.js';
import { writeWithEvents } from '../../lib/write.js';
import { iso, nameTaken, prisma, unitCostText } from './graph.js';

/**
 * Malzeme kartı (modül 43; 44'ün stok kartının yalın hâli): kod, ad, grup, stok birimi,
 * güncel birim maliyet (KDV hariç), alerjenler. Silinmez; pasife alınan malzeme yeni reçete
 * satırına seçilmez, var olan reçetelerde hesaba girmeye devam eder.
 *
 * Reçetede kullanılan malzemenin birim **ailesi** değişemez (kg → L çevrilemez; satırlar
 * anlamsızlaşırdı); aynı ailede değişim (kg → g) serbesttir, satırlar kendi biriminde durur.
 */

const STOCK_SELECT = Object.freeze({
  id: true,
  code: true,
  name: true,
  group: true,
  unit: true,
  unitCost: true,
  costUpdatedAt: true,
  allergens: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { recipeLines: true } },
});

/** @param {any} row */
export function toStockItemDto(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    group: row.group,
    unit: row.unit,
    unitCost: unitCostText(row.unitCost),
    costUpdatedAt: iso(row.costUpdatedAt),
    allergens: row.allergens ?? [],
    isActive: row.isActive,
    usedInRecipes: row._count?.recipeLines ?? 0,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** Denetim izine giden alanlar (sayaç / damga değil). @param {ReturnType<typeof toStockItemDto>} dto */
const auditView = (dto) => ({ code: dto.code, name: dto.name, group: dto.group, unit: dto.unit, unitCost: dto.unitCost, allergens: dto.allergens, isActive: dto.isActive });

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string, group?: string, active?: boolean }} query
 */
export async function listStockItems(hotelId, query) {
  /** @type {Record<string, any>} */
  const where = { hotelId };
  if (query.group) where.group = query.group;
  if (query.active !== undefined) where.isActive = query.active;
  const tokens = searchTokens(query.search);
  if (tokens.length) where.AND = tokens.map((token) => ({ OR: [{ name: containsText(token) }, { code: containsText(token) }] }));
  const [rows, total] = await Promise.all([
    prisma.stockItem.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...toSkipTake(query), select: STOCK_SELECT }),
    prisma.stockItem.count({ where }),
  ]);
  return buildPage(rows.map(toStockItemDto), total, query);
}

/** @param {string} hotelId @param {string} stockItemId */
export async function getStockItem(hotelId, stockItemId) {
  const row = await prisma.stockItem.findFirst({ where: { id: stockItemId, hotelId }, select: STOCK_SELECT });
  if (!row) throw new NotFoundError('Malzeme bulunamadı');
  return toStockItemDto(row);
}

/**
 * @param {string} hotelId
 * @param {any} input `createStockItemSchema`
 */
export async function createStockItem(hotelId, input) {
  const actor = currentActor();
  try {
    return await writeWithEvents(async (tx, stage) => {
      if (await nameTaken(tx, 'StockItem', hotelId, input.name)) throw new ValidationError('Bu adla bir malzeme zaten var', { field: 'name' });
      const row = await tx.stockItem.create({
        data: { hotelId, ...input, costUpdatedAt: new Date(), createdBy: actor },
        select: STOCK_SELECT,
      });
      const dto = toStockItemDto(row);
      await recordAudit(tx, { hotelId, entity: 'StockItem', entityId: row.id, action: 'CREATE', after: auditView(dto) });
      await stage('recipe.stock_item.changed', { hotelId, stockItemId: row.id, change: 'CREATED' });
      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kodlu bir malzeme zaten var' });
  }
}

/**
 * @param {string} hotelId
 * @param {string} stockItemId
 * @param {any} input `updateStockItemSchema`
 */
export async function updateStockItem(hotelId, stockItemId, input) {
  const { expectedUpdatedAt, ...data } = input;
  try {
    return await writeWithEvents(async (tx, stage) => {
      if (!(await lockStockItems(tx, hotelId, [stockItemId])).has(stockItemId)) throw new NotFoundError('Malzeme bulunamadı');
      const before = await tx.stockItem.findFirst({ where: { id: stockItemId, hotelId }, select: STOCK_SELECT });
      if (before.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
      if (data.name.toLowerCase() !== before.name.toLowerCase() && (await nameTaken(tx, 'StockItem', hotelId, data.name, stockItemId))) {
        throw new ValidationError('Bu adla bir malzeme zaten var', { field: 'name' });
      }
      if (data.unit !== before.unit && !unitsCompatible(data.unit, before.unit) && before._count.recipeLines > 0) {
        throw new ConflictError(
          `Bu malzeme ${before._count.recipeLines} reçete satırında ${KITCHEN_UNIT_LABELS[before.unit]} ile kullanılıyor; ${KITCHEN_UNIT_LABELS[data.unit]} birimine çevrilemez. Aynı aileden bir birim seçin ya da yeni malzeme açın.`,
          'UNIT_IN_USE',
        );
      }
      const costChanged = !before.unitCost.equals(data.unitCost);
      const after = await tx.stockItem.update({
        where: { id: stockItemId },
        data: { ...data, ...(costChanged ? { costUpdatedAt: new Date() } : {}) },
        select: STOCK_SELECT,
      });
      const dto = toStockItemDto(after);
      await recordAudit(tx, { hotelId, entity: 'StockItem', entityId: stockItemId, action: 'UPDATE', before: auditView(toStockItemDto(before)), after: auditView(dto) });
      await stage('recipe.stock_item.changed', { hotelId, stockItemId, change: 'UPDATED' });
      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kodlu bir malzeme zaten var' });
  }
}
