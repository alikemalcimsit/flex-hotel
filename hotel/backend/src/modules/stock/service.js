import { currentActor, toDecimal } from '@hotelos/core';
import { KITCHEN_UNIT_LABELS, MAX_WAREHOUSES, zonedWallTimeToUtc } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockStockItems, lockWarehouses } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { MATCH_NOTHING, matchStockItemIds, searchTokens } from '../../lib/search.js';
import { writeWithEvents } from '../../lib/write.js';
import { hotelContext } from '../banquet/shared.js';
import { stockValue } from './rules.js';

/**
 * Stok çekirdeği ekranları (modül 45; 44 çıkış / transfer / fire / sayım ve maliyet raporunu ekler).
 *
 * - **Depo:** otelde en fazla `MAX_WAREHOUSES`; tek varsayılan depo (mal kabulde önce seçili, pasif
 *   olamaz). Stoğu olan depo pasife alınamaz.
 * - **Mevcut:** malzeme kartında toplam (depoların toplamı), depo satırında depo bazında; değer =
 *   mevcut × hareketli ortalama maliyet. Yoldaki = açık siparişlerin teslim alınmamış kısmı.
 * - **Hareket:** değişmez kayıt; kaynağına (mal kabul) bağlı.
 * - **Minimum seviye:** altına düşen malzeme satın alma önerisine girer.
 */

/** Tam sayı birimler (adet, gram, mililitre). */
const WHOLE_UNITS = Object.freeze(['PIECE', 'G', 'ML']);
/** Teslim bekleyen sipariş durumları (yoldaki mal). */
const OPEN_ORDER_STATUSES = Object.freeze(['PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED']);

/** @param {Date | null | undefined} value */
const iso = (value) => (value ? value.toISOString() : null);
/** @param {unknown} value */
const plain = (value) => toDecimal(String(value ?? 0)).toString();
/** @param {unknown} value */
const money = (value) => toDecimal(String(value ?? 0)).toFixed(2);

/* ─────────────── Depo ─────────────── */

const WAREHOUSE_SELECT = Object.freeze({ id: true, code: true, name: true, isDefault: true, isActive: true, createdBy: true, createdAt: true, updatedAt: true });

/** @param {any} row */
const warehouseDto = (row) => ({ ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) });

/**
 * @param {string} hotelId @param {{ includeInactive?: boolean }} query
 */
export async function listWarehouses(hotelId, { includeInactive = false } = {}) {
  const rows = await prisma.warehouse.findMany({
    where: { hotelId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ isDefault: 'desc' }, { isActive: 'desc' }, { name: 'asc' }],
    take: MAX_WAREHOUSES,
    select: WAREHOUSE_SELECT,
  });
  const ids = rows.map((row) => row.id);
  const stats = ids.length
    ? await prisma.$queryRaw`
        SELECT l."warehouseId", COUNT(*) FILTER (WHERE l."quantity" <> 0)::int AS "items",
               COALESCE(SUM(GREATEST(l."quantity", 0) * s."unitCost"), 0)::text AS "value"
        FROM "StockLevel" l JOIN "StockItem" s ON s."id" = l."stockItemId"
        WHERE l."hotelId" = ${hotelId} AND l."warehouseId" = ANY(${ids}::text[]) GROUP BY l."warehouseId"`
    : [];
  const byId = new Map(stats.map((row) => [row.warehouseId, row]));
  return rows.map((row) => ({ ...warehouseDto(row), items: byId.get(row.id)?.items ?? 0, value: money(byId.get(row.id)?.value ?? 0) }));
}

/** @param {string} hotelId @param {{ code: string, name: string, isDefault: boolean }} input */
export async function createWarehouse(hotelId, input) {
  const actor = currentActor();
  try {
    const row = await writeWithEvents(async (tx, stage) => {
      const [count, hasDefault] = await Promise.all([tx.warehouse.count({ where: { hotelId } }), tx.warehouse.count({ where: { hotelId, isDefault: true } })]);
      if (count >= MAX_WAREHOUSES) throw new ValidationError(`Otelde en fazla ${MAX_WAREHOUSES} depo olur`);
      // İlk depo kendiliğinden varsayılan; yeni varsayılan seçilirse eskisi düşer (tek varsayılan kısıtı).
      const isDefault = input.isDefault || hasDefault === 0;
      if (isDefault && hasDefault) await tx.warehouse.updateMany({ where: { hotelId, isDefault: true }, data: { isDefault: false } });
      const created = await tx.warehouse.create({ data: { hotelId, code: input.code, name: input.name, isDefault, isActive: true, createdBy: actor }, select: WAREHOUSE_SELECT });
      await recordAudit(tx, { hotelId, entity: 'Warehouse', entityId: created.id, action: 'CREATE', after: { code: created.code, name: created.name, isDefault } });
      await stage('stock.changed', { hotelId, change: 'WAREHOUSE', stockItemIds: [] });
      return created;
    });
    return warehouseDto(row);
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kodlu bir depo zaten var' });
  }
}

/**
 * @param {string} hotelId @param {string} warehouseId
 * @param {{ expectedUpdatedAt: Date, code: string, name: string, isDefault: boolean, isActive: boolean }} input
 */
export async function updateWarehouse(hotelId, warehouseId, input) {
  try {
    const row = await writeWithEvents(async (tx, stage) => {
      if (!(await lockWarehouses(tx, hotelId, [warehouseId])).has(warehouseId)) throw new NotFoundError('Depo bulunamadı');
      const before = await tx.warehouse.findUnique({ where: { id: warehouseId }, select: WAREHOUSE_SELECT });
      if (before.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new StaleWriteError();
      if (before.isDefault && !input.isDefault) throw new ValidationError('Otelde bir varsayılan depo olmalı; başka bir depoyu varsayılan yapın', { fields: { isDefault: 'Varsayılanı başka depoya taşıyın' } });
      if (input.isDefault && !input.isActive) throw new ValidationError('Varsayılan depo pasif olamaz', { fields: { isActive: 'Varsayılan depo pasif olamaz' } });
      if (before.isActive && !input.isActive) {
        const stocked = await tx.stockLevel.count({ where: { warehouseId, quantity: { not: 0 } } });
        if (stocked > 0) throw new ConflictError(`Depoda ${stocked} malzemenin stoğu var; pasife almadan önce stok başka depoya aktarılmalı (transfer: modül 44)`, 'WAREHOUSE_HAS_STOCK');
      }
      if (input.isDefault && !before.isDefault) await tx.warehouse.updateMany({ where: { hotelId, isDefault: true }, data: { isDefault: false } });
      const data = { code: input.code, name: input.name, isDefault: input.isDefault, isActive: input.isActive };
      const updated = await tx.warehouse.update({ where: { id: warehouseId }, data, select: WAREHOUSE_SELECT });
      await recordAudit(tx, { hotelId, entity: 'Warehouse', entityId: warehouseId, action: 'UPDATE', before: { code: before.code, name: before.name, isDefault: before.isDefault, isActive: before.isActive }, after: data });
      await stage('stock.changed', { hotelId, change: 'WAREHOUSE', stockItemIds: [] });
      return updated;
    });
    return warehouseDto(row);
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kodlu bir depo zaten var' });
  }
}

/* ─────────────── Mevcut ─────────────── */

/**
 * Özet: stok değeri, eldeki malzeme, minimum altı, izlenen malzeme, etkin depo.
 * @param {string} hotelId
 */
export async function getStockSummary(hotelId) {
  const [[totals], warehouses, [lastReceipt]] = await Promise.all([
    prisma.$queryRaw`
      SELECT COALESCE(SUM(GREATEST("onHand", 0) * "unitCost"), 0)::text AS "value",
             COUNT(*) FILTER (WHERE "onHand" > 0)::int AS "inStock",
             COUNT(*) FILTER (WHERE "isActive" AND "minLevel" IS NOT NULL)::int AS "tracked",
             COUNT(*) FILTER (WHERE "isActive" AND "minLevel" IS NOT NULL AND "onHand" < "minLevel")::int AS "belowMin"
      FROM "StockItem" WHERE "hotelId" = ${hotelId}`,
    prisma.warehouse.count({ where: { hotelId, isActive: true } }),
    prisma.stockMovement.findMany({ where: { hotelId, kind: 'RECEIPT' }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 1, select: { occurredAt: true } }),
  ]);
  return { value: money(totals.value), inStock: totals.inStock, tracked: totals.tracked, belowMin: totals.belowMin, warehouses, lastReceiptAt: iso(lastReceipt?.occurredAt ?? null) };
}

/**
 * Malzeme bazında mevcut: toplam, depo dağılımı, yoldaki (açık sipariş kalanı), minimum, değer.
 * Pasif ve stoğu olmayan malzeme listelenmez.
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string, group?: string, belowMin?: boolean, inStock?: boolean }} query
 */
export async function listLevels(hotelId, query) {
  /** @type {any[]} */
  const and = [{ OR: [{ isActive: true }, { onHand: { not: 0 } }] }];
  if (query.group) and.push({ group: query.group });
  if (query.inStock) and.push({ onHand: { gt: 0 } });
  if (query.belowMin) and.push({ isActive: true, minLevel: { not: null } }, { onHand: { lt: prisma.stockItem.fields.minLevel } });
  const tokens = searchTokens(query.search);
  if (tokens.length) {
    const lists = await Promise.all(tokens.map((token) => matchStockItemIds(prisma, hotelId, token)));
    and.push(...lists.map((ids) => (ids.length ? { id: { in: ids } } : MATCH_NOTHING)));
  }
  const where = { hotelId, AND: and };
  const [rows, total] = await Promise.all([
    prisma.stockItem.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...toSkipTake(query),
      select: { id: true, code: true, name: true, group: true, unit: true, onHand: true, minLevel: true, unitCost: true, costUpdatedAt: true, isActive: true, updatedAt: true },
    }),
    prisma.stockItem.count({ where }),
  ]);
  const ids = rows.map((row) => row.id);
  const [levels, onOrder] = ids.length
    ? await Promise.all([
        prisma.stockLevel.findMany({
          where: { hotelId, stockItemId: { in: ids }, quantity: { not: 0 } },
          orderBy: { warehouse: { name: 'asc' } },
          select: { stockItemId: true, quantity: true, warehouse: { select: { id: true, name: true } } },
        }),
        prisma.$queryRaw`
          SELECT ol."stockItemId", SUM(GREATEST(ol."quantity" - ol."receivedQuantity", 0))::text AS "quantity"
          FROM "PurchaseOrderLine" ol JOIN "PurchaseOrder" o ON o."id" = ol."orderId"
          WHERE ol."hotelId" = ${hotelId} AND ol."stockItemId" = ANY(${ids}::text[]) AND o."status"::text = ANY(${[...OPEN_ORDER_STATUSES]}::text[])
          GROUP BY ol."stockItemId"`,
      ])
    : [[], []];
  /** @type {Map<string, any[]>} */
  const byItem = new Map();
  for (const level of levels) {
    const list = byItem.get(level.stockItemId) ?? [];
    list.push({ warehouseId: level.warehouse.id, warehouseName: level.warehouse.name, quantity: plain(level.quantity) });
    byItem.set(level.stockItemId, list);
  }
  const orderedBy = new Map(onOrder.map((row) => [row.stockItemId, row.quantity]));
  return buildPage(
    rows.map((row) => ({
      id: row.id,
      stockItemId: row.id,
      code: row.code,
      name: row.name,
      group: row.group,
      unit: row.unit,
      onHand: plain(row.onHand),
      minLevel: row.minLevel === null ? null : plain(row.minLevel),
      belowMin: row.minLevel !== null && row.onHand.lessThan(row.minLevel),
      onOrder: plain(orderedBy.get(row.id) ?? 0),
      unitCost: toDecimal(String(row.unitCost)).toFixed(4),
      costUpdatedAt: iso(row.costUpdatedAt),
      value: money(stockValue(String(row.onHand), String(row.unitCost))),
      isActive: row.isActive,
      updatedAt: iso(row.updatedAt),
      warehouses: byItem.get(row.id) ?? [],
    })),
    total,
    query,
  );
}

/**
 * Minimum seviye (stok biriminde; boş = izlenmez). Kartın sürüm damgasıyla.
 * @param {string} hotelId @param {string} stockItemId @param {{ expectedUpdatedAt: Date, minLevel: string | null }} input
 */
export async function updateMinLevel(hotelId, stockItemId, { expectedUpdatedAt, minLevel }) {
  try {
    await writeWithEvents(async (tx, stage) => {
      if (!(await lockStockItems(tx, hotelId, [stockItemId])).has(stockItemId)) throw new NotFoundError('Malzeme bulunamadı');
      const before = await tx.stockItem.findUnique({ where: { id: stockItemId }, select: { name: true, unit: true, minLevel: true, updatedAt: true } });
      if (before.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
      if (minLevel !== null && WHOLE_UNITS.includes(before.unit) && !toDecimal(minLevel).isInteger()) {
        throw new ValidationError(`${KITCHEN_UNIT_LABELS[before.unit]} tam sayı olmalı`, { fields: { minLevel: `${KITCHEN_UNIT_LABELS[before.unit]} tam sayı olmalı` } });
      }
      await tx.stockItem.update({ where: { id: stockItemId }, data: { minLevel } });
      await recordAudit(tx, {
        hotelId,
        entity: 'StockLevel',
        entityId: stockItemId,
        action: 'UPDATE',
        before: { item: before.name, minLevel: before.minLevel === null ? null : plain(before.minLevel) },
        after: { item: before.name, minLevel },
      });
      await stage('stock.changed', { hotelId, change: 'MIN_LEVEL', stockItemIds: [stockItemId] });
    });
    return await levelOf(hotelId, stockItemId);
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/** Tek malzemenin mevcut satırı (min seviye kaydından sonra ekrana). @param {string} hotelId @param {string} stockItemId */
async function levelOf(hotelId, stockItemId) {
  const row = await prisma.stockItem.findFirst({ where: { id: stockItemId, hotelId }, select: { id: true, name: true, unit: true, onHand: true, minLevel: true, updatedAt: true } });
  if (!row) throw new NotFoundError('Malzeme bulunamadı');
  return {
    stockItemId: row.id,
    name: row.name,
    unit: row.unit,
    onHand: plain(row.onHand),
    minLevel: row.minLevel === null ? null : plain(row.minLevel),
    belowMin: row.minLevel !== null && row.onHand.lessThan(row.minLevel),
    updatedAt: iso(row.updatedAt),
  };
}

/* ─────────────── Hareket ─────────────── */

/**
 * Stok hareketleri (en yeni önce): malzeme, depo, gün aralığı (otelin günü).
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, stockItemId?: string, warehouseId?: string, from?: string, to?: string }} query
 */
export async function listMovements(hotelId, query) {
  const { timezone } = await hotelContext(hotelId);
  /** @type {Record<string, any>} */
  const where = { hotelId };
  if (query.stockItemId) where.stockItemId = query.stockItemId;
  if (query.warehouseId) where.warehouseId = query.warehouseId;
  if (query.from || query.to) {
    const next = (day) => new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
    where.occurredAt = {
      ...(query.from ? { gte: zonedWallTimeToUtc(`${query.from}T00:00`, timezone) } : {}),
      ...(query.to ? { lt: zonedWallTimeToUtc(`${next(query.to)}T00:00`, timezone) } : {}),
    };
  }
  const [rows, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      ...toSkipTake(query),
      select: {
        id: true,
        kind: true,
        quantity: true,
        unitCost: true,
        totalCost: true,
        onHandAfter: true,
        avgCostAfter: true,
        sourceType: true,
        sourceId: true,
        note: true,
        occurredAt: true,
        createdBy: true,
        stockItem: { select: { id: true, code: true, name: true, unit: true } },
        warehouse: { select: { id: true, name: true } },
      },
    }),
    prisma.stockMovement.count({ where }),
  ]);
  const receiptIds = [...new Set(rows.filter((row) => row.sourceType === 'GoodsReceipt').map((row) => row.sourceId))];
  const receipts = receiptIds.length ? await prisma.goodsReceipt.findMany({ where: { hotelId, id: { in: receiptIds } }, select: { id: true, number: true, orderId: true } }) : [];
  const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  return buildPage(
    rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      stockItem: row.stockItem,
      warehouse: row.warehouse,
      quantity: plain(row.quantity),
      unitCost: toDecimal(String(row.unitCost)).toFixed(4),
      totalCost: money(row.totalCost),
      onHandAfter: plain(row.onHandAfter),
      avgCostAfter: toDecimal(String(row.avgCostAfter)).toFixed(4),
      source: row.sourceType === 'GoodsReceipt' && receiptById.has(row.sourceId) ? { type: 'GoodsReceipt', id: row.sourceId, number: receiptById.get(row.sourceId).number, orderId: receiptById.get(row.sourceId).orderId } : { type: row.sourceType, id: row.sourceId, number: null, orderId: null },
      note: row.note,
      occurredAt: iso(row.occurredAt),
      createdBy: row.createdBy,
    })),
    total,
    query,
  );
}
