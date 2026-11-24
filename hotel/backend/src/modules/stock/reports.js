import { Prisma } from '@prisma/client';
import { toDecimal } from '@hotelos/core';
import { zonedWallTimeToUtc } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { sqlTimestamp } from '../../lib/sql-time.js';
import { hotelContext } from '../banquet/shared.js';
import { STOCK_COST_SCALE, stockValue } from './rules.js';

/**
 * Maliyet raporları (modül 44), hareket kayıtlarından (değişmez; her hareket o anki ortalama maliyetle):
 *
 * - **Malzeme bazlı:** dönemde giriş (mal kabul), satış düşümü, çıkış, fire, sayım farkı, transfer (depo süzgecinde
 *   net) miktar ve tutarı; bugünkü mevcut ve değer (depo süzgecinde deponun mevcudu, kartın ortalama maliyetiyle).
 *   Tüketim = satış + çıkış + fire (sayım farkı ayrı: kayıp / fazla).
 * - **Ürün bazlı:** menü ürünü başına satılan adet ve ciro (kapanan adisyon kalemleri, iş günü aralığı) ile
 *   reçeteden düşen malzeme maliyeti (`SALE` hareketleri, **adisyonun iş gününe** göre — ciro ile aynı takvim) → brüt
 *   kâr ve yemek maliyeti yüzdesi.
 *
 * Malzeme raporunda gün aralığı otelin günüdür; hareketler işlem anına göre.
 */

/** @param {unknown} value */
const money = (value) => toDecimal(String(value ?? 0)).toFixed(2);
/** @param {unknown} value */
const plain = (value) => toDecimal(String(value ?? 0)).toString();

/** @param {string} timezone @param {string} from @param {string} to */
function periodBounds(timezone, from, to) {
  const next = new Date(Date.parse(`${to}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
  // Ham SQL'e oturum saat diliminden bağımsız damga (bkz. lib/sql-time.js).
  return { start: sqlTimestamp(zonedWallTimeToUtc(`${from}T00:00`, timezone)), end: sqlTimestamp(zonedWallTimeToUtc(`${next}T00:00`, timezone)) };
}

/**
 * @param {string} hotelId
 * @param {{ from: string, to: string, warehouseId?: string }} query
 */
export async function costReport(hotelId, query) {
  const { timezone } = await hotelContext(hotelId);
  const { start, end } = periodBounds(timezone, query.from, query.to);
  const warehouseFilter = query.warehouseId ? Prisma.sql`AND m."warehouseId" = ${query.warehouseId}` : Prisma.empty;
  const rows = await prisma.$queryRaw`
    WITH "moves" AS (
      SELECT m."stockItemId",
             SUM(m."quantity") FILTER (WHERE m."kind" = 'RECEIPT') AS "receiptQty",
             SUM(m."totalCost") FILTER (WHERE m."kind" = 'RECEIPT') AS "receiptCost",
             -SUM(m."quantity") FILTER (WHERE m."kind" = 'SALE') AS "saleQty",
             -SUM(m."totalCost") FILTER (WHERE m."kind" = 'SALE') AS "saleCost",
             -SUM(m."quantity") FILTER (WHERE m."kind" = 'ISSUE') AS "issueQty",
             -SUM(m."totalCost") FILTER (WHERE m."kind" = 'ISSUE') AS "issueCost",
             -SUM(m."quantity") FILTER (WHERE m."kind" = 'WASTE') AS "wasteQty",
             -SUM(m."totalCost") FILTER (WHERE m."kind" = 'WASTE') AS "wasteCost",
             SUM(m."quantity") FILTER (WHERE m."kind" = 'COUNT_ADJUST') AS "countQty",
             SUM(m."totalCost") FILTER (WHERE m."kind" = 'COUNT_ADJUST') AS "countCost",
             SUM(m."quantity") FILTER (WHERE m."kind" IN ('TRANSFER_IN', 'TRANSFER_OUT')) AS "transferQty",
             SUM(m."totalCost") FILTER (WHERE m."kind" IN ('TRANSFER_IN', 'TRANSFER_OUT')) AS "transferCost"
      FROM "StockMovement" m
      WHERE m."hotelId" = ${hotelId} AND m."occurredAt" >= ${start} AND m."occurredAt" < ${end} ${warehouseFilter}
      GROUP BY m."stockItemId"
    ), "current" AS (
      ${query.warehouseId
        ? Prisma.sql`SELECT l."stockItemId", l."quantity" AS "onHand" FROM "StockLevel" l WHERE l."hotelId" = ${hotelId} AND l."warehouseId" = ${query.warehouseId} AND l."quantity" <> 0`
        : Prisma.sql`SELECT s."id" AS "stockItemId", s."onHand" FROM "StockItem" s WHERE s."hotelId" = ${hotelId} AND s."onHand" <> 0`}
    )
    SELECT s."id", s."code", s."name", s."group"::text AS "group", s."unit"::text AS "unit", s."unitCost"::text AS "unitCost",
           COALESCE(c."onHand", 0)::text AS "onHand",
           COALESCE(mv."receiptQty", 0)::text AS "receiptQty", COALESCE(mv."receiptCost", 0)::text AS "receiptCost",
           COALESCE(mv."saleQty", 0)::text AS "saleQty", COALESCE(mv."saleCost", 0)::text AS "saleCost",
           COALESCE(mv."issueQty", 0)::text AS "issueQty", COALESCE(mv."issueCost", 0)::text AS "issueCost",
           COALESCE(mv."wasteQty", 0)::text AS "wasteQty", COALESCE(mv."wasteCost", 0)::text AS "wasteCost",
           COALESCE(mv."countQty", 0)::text AS "countQty", COALESCE(mv."countCost", 0)::text AS "countCost",
           COALESCE(mv."transferQty", 0)::text AS "transferQty", COALESCE(mv."transferCost", 0)::text AS "transferCost"
    FROM "StockItem" s
    LEFT JOIN "moves" mv ON mv."stockItemId" = s."id"
    LEFT JOIN "current" c ON c."stockItemId" = s."id"
    WHERE s."hotelId" = ${hotelId} AND (mv."stockItemId" IS NOT NULL OR c."stockItemId" IS NOT NULL)
    ORDER BY s."name", s."id"`;
  const totals = { receiptCost: toDecimal(0), saleCost: toDecimal(0), issueCost: toDecimal(0), wasteCost: toDecimal(0), countCost: toDecimal(0), transferCost: toDecimal(0), value: toDecimal(0) };
  const items = rows.map((row) => {
    const value = stockValue(row.onHand, row.unitCost);
    const consumptionCost = toDecimal(row.saleCost).plus(row.issueCost).plus(row.wasteCost);
    totals.receiptCost = totals.receiptCost.plus(row.receiptCost);
    totals.saleCost = totals.saleCost.plus(row.saleCost);
    totals.issueCost = totals.issueCost.plus(row.issueCost);
    totals.wasteCost = totals.wasteCost.plus(row.wasteCost);
    totals.countCost = totals.countCost.plus(row.countCost);
    totals.transferCost = totals.transferCost.plus(row.transferCost);
    totals.value = totals.value.plus(value);
    return {
      stockItemId: row.id,
      code: row.code,
      name: row.name,
      group: row.group,
      unit: row.unit,
      unitCost: toDecimal(row.unitCost).toFixed(STOCK_COST_SCALE),
      receiptQty: plain(row.receiptQty),
      receiptCost: money(row.receiptCost),
      saleQty: plain(row.saleQty),
      saleCost: money(row.saleCost),
      issueQty: plain(row.issueQty),
      issueCost: money(row.issueCost),
      wasteQty: plain(row.wasteQty),
      wasteCost: money(row.wasteCost),
      countQty: plain(row.countQty),
      countCost: money(row.countCost),
      transferQty: plain(row.transferQty),
      transferCost: money(row.transferCost),
      consumptionCost: consumptionCost.toFixed(2),
      onHand: plain(row.onHand),
      value: value.toFixed(2),
    };
  });
  const consumption = totals.saleCost.plus(totals.issueCost).plus(totals.wasteCost);
  return {
    from: query.from,
    to: query.to,
    warehouseId: query.warehouseId ?? null,
    totals: {
      receiptCost: totals.receiptCost.toFixed(2),
      saleCost: totals.saleCost.toFixed(2),
      issueCost: totals.issueCost.toFixed(2),
      wasteCost: totals.wasteCost.toFixed(2),
      consumptionCost: consumption.toFixed(2),
      countCost: totals.countCost.toFixed(2),
      transferCost: totals.transferCost.toFixed(2),
      value: totals.value.toFixed(2),
      items: items.length,
    },
    items,
  };
}

/**
 * Ürün bazlı: kapanan adisyon kalemlerinden satılan adet ve ciro (KDV dahil liste fiyatıyla; iptal / ikram düşülmüş),
 * reçeteden düşen maliyet (`SALE` hareketleri, ürün kimliğiyle). Yemek maliyeti yüzdesi = maliyet / ciro.
 * @param {string} hotelId
 * @param {{ from: string, to: string, warehouseId?: string }} query
 */
export async function productCostReport(hotelId, query) {
  const warehouseFilter = query.warehouseId ? Prisma.sql`AND m."warehouseId" = ${query.warehouseId}` : Prisma.empty;
  const rows = await prisma.$queryRaw`
    WITH "sales" AS (
      SELECT l."menuItemId", SUM(l."quantity" - l."voidedQuantity" - l."compedQuantity")::int AS "sold", SUM(l."compedQuantity")::int AS "comped",
             SUM((l."quantity" - l."voidedQuantity" - l."compedQuantity") * l."unitPrice") AS "revenue"
      FROM "PosOrderLine" l
      WHERE l."hotelId" = ${hotelId} AND l."businessDate" >= ${query.from}::date AND l."businessDate" <= ${query.to}::date
      GROUP BY l."menuItemId"
    ), "costs" AS (
      SELECT m."menuItemId", -SUM(m."totalCost") AS "cost", COUNT(DISTINCT m."stockItemId")::int AS "ingredients"
      FROM "StockMovement" m JOIN "PosCheck" c ON c."id" = m."sourceId"
      WHERE m."hotelId" = ${hotelId} AND m."kind" = 'SALE' AND m."sourceType" = 'PosCheck' AND m."menuItemId" IS NOT NULL
        AND c."businessDate" >= ${query.from}::date AND c."businessDate" <= ${query.to}::date ${warehouseFilter}
      GROUP BY m."menuItemId"
    )
    SELECT i."id", i."code", i."name", i."system"::text AS "system", cat."name" AS "category", (r."id" IS NOT NULL) AS "hasRecipe",
           COALESCE(s."sold", 0) AS "sold", COALESCE(s."comped", 0) AS "comped", COALESCE(s."revenue", 0)::text AS "revenue",
           COALESCE(c."cost", 0)::text AS "cost", COALESCE(c."ingredients", 0) AS "ingredients"
    FROM "MenuItem" i
    JOIN "MenuCategory" cat ON cat."id" = i."categoryId"
    LEFT JOIN "Recipe" r ON r."menuItemId" = i."id"
    LEFT JOIN "sales" s ON s."menuItemId" = i."id"
    LEFT JOIN "costs" c ON c."menuItemId" = i."id"
    WHERE i."hotelId" = ${hotelId} AND i."system" IS NULL AND (s."menuItemId" IS NOT NULL OR c."menuItemId" IS NOT NULL)
    ORDER BY COALESCE(s."revenue", 0) DESC, i."name"`;
  let revenueTotal = toDecimal(0);
  let costTotal = toDecimal(0);
  const items = rows.map((row) => {
    const revenue = toDecimal(row.revenue);
    const cost = toDecimal(row.cost);
    revenueTotal = revenueTotal.plus(revenue);
    costTotal = costTotal.plus(cost);
    return {
      menuItemId: row.id,
      code: row.code,
      name: row.name,
      category: row.category,
      hasRecipe: row.hasRecipe,
      sold: row.sold,
      comped: row.comped,
      revenue: revenue.toFixed(2),
      cost: cost.toFixed(2),
      margin: revenue.minus(cost).toFixed(2),
      foodCostPct: revenue.greaterThan(0) ? cost.dividedBy(revenue).times(100).toFixed(1) : null,
      ingredients: row.ingredients,
    };
  });
  return {
    from: query.from,
    to: query.to,
    warehouseId: query.warehouseId ?? null,
    totals: {
      revenue: revenueTotal.toFixed(2),
      cost: costTotal.toFixed(2),
      margin: revenueTotal.minus(costTotal).toFixed(2),
      foodCostPct: revenueTotal.greaterThan(0) ? costTotal.dividedBy(revenueTotal).times(100).toFixed(1) : null,
      items: items.length,
    },
    items,
  };
}
