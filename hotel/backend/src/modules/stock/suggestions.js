import { Prisma } from '@prisma/client';
import { addDays, toDecimal, toIsoDay } from '@hotelos/core';
import { PERMISSIONS } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { lockStockItems } from '../../lib/locks.js';
import { writeWithEvents } from '../../lib/write.js';
import { hotelContext } from '../banquet/shared.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { createRequestInTx } from '../purchasing/service.js';
import { stockSuggestion } from '../purchasing/rules.js';

/**
 * Minimum altı önerisi (modül 44, inventory-worker): miktarı değişen malzemelerden minimumun altına düşenler için
 * **tek** satın alma talebi açılır (kaynak `STOCK`; satırlar malzeme başına) ve satın alma yetkilisine zil gider.
 *
 * Açık = minimum − (eldeki + yoldaki sipariş + siparişe dönmemiş elle / stok talebi) > 0 — modül 45'in öneri
 * ekranıyla aynı hesap (`stockSuggestion`). Açılan talep "talep edilen"e sayıldığı için aynı malzeme için ikinci
 * talep açılmaz; talep iptal edilirse bir sonraki hareket yeniden önerir. Hesap ve talep **tek transaction'da, kartlar
 * kilitliyken** yapılır: aynı anda kapanan iki adisyon aynı açık için iki talep açamaz (ikincisi kilidi bekler, güncel
 * "talep edilen"i görür).
 */

/** Talebin ihtiyaç günü: bugün + bu kadar gün (tedarikçi vadesi teklif turunda belirlenir). */
const NEEDED_IN_DAYS = 2;

/**
 * @param {string} hotelId
 * @param {string[]} stockItemIds
 * @returns {Promise<{ created: boolean, message: string, requestId?: string, number?: string, lines?: string[] }>}
 */
export async function suggestPurchases(hotelId, stockItemIds) {
  const ids = [...new Set(stockItemIds)].filter(Boolean);
  if (ids.length === 0) return { created: false, message: 'Miktarı değişen malzeme yok' };
  const { today } = await hotelContext(hotelId);
  const neededBy = toIsoDay(addDays(today, NEEDED_IN_DAYS));
  return writeWithEvents(async (tx, stage) => {
    await lockStockItems(tx, hotelId, ids);
    const rows = await tx.$queryRaw`
    WITH "tracked" AS MATERIALIZED (
      SELECT s."id", s."name", s."unit"::text AS "unit", s."onHand", s."minLevel"
      FROM "StockItem" s WHERE s."hotelId" = ${hotelId} AND s."isActive" AND s."minLevel" IS NOT NULL AND s."id" = ANY(${ids}::text[])
    ), "ordered" AS (
      SELECT ol."stockItemId", SUM(GREATEST(ol."quantity" - ol."receivedQuantity", 0)) AS "quantity"
      FROM "PurchaseOrder" o JOIN "PurchaseOrderLine" ol ON ol."orderId" = o."id"
      WHERE o."hotelId" = ${hotelId} AND o."status"::text IN ('PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED') AND ol."stockItemId" IN (SELECT "id" FROM "tracked")
      GROUP BY ol."stockItemId"
    ), "requested" AS (
      SELECT rl."stockItemId", SUM(rl."quantity") AS "quantity"
      FROM "PurchaseRequest" r JOIN "PurchaseRequestLine" rl ON rl."requestId" = r."id"
      LEFT JOIN "PurchaseRoundLine" pl ON pl."id" = rl."roundLineId"
      WHERE r."hotelId" = ${hotelId} AND r."status"::text IN ('OPEN', 'IN_PROGRESS') AND r."source"::text IN ('MANUAL', 'STOCK')
        AND pl."orderLineId" IS NULL AND rl."stockItemId" IN (SELECT "id" FROM "tracked")
      GROUP BY rl."stockItemId"
    )
    SELECT t."id", t."name", t."unit", t."onHand"::text AS "onHand", t."minLevel"::text AS "minLevel",
           COALESCE(o."quantity", 0)::text AS "onOrder", COALESCE(q."quantity", 0)::text AS "requested"
    FROM "tracked" t LEFT JOIN "ordered" o ON o."stockItemId" = t."id" LEFT JOIN "requested" q ON q."stockItemId" = t."id"
    ORDER BY t."name"`;
    const lines = rows
      .map((row) => ({ row, suggested: stockSuggestion({ minLevel: row.minLevel, onHand: row.onHand, onOrder: row.onOrder, requested: row.requested, unit: row.unit }) }))
      .filter((entry) => entry.suggested && entry.suggested.greaterThan(0));
    if (lines.length === 0) return { created: false, message: 'Minimum altına düşen malzeme yok' };

    const request = await createRequestInTx(
      tx,
      stage,
      hotelId,
      {
        source: 'STOCK',
        neededBy,
        note: 'Minimum stok seviyesi önerisi (inventory-worker)',
        lines: lines.map(({ row, suggested }) => ({ stockItemId: row.id, quantity: suggested.toString(), neededBy: null })),
      },
      today,
    );
    const summary = lines.map(({ row, suggested }) => `${row.name} ${suggested.toString()} (elde ${toDecimal(row.onHand).toString()}, min ${toDecimal(row.minLevel).toString()})`);
    await raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'STOCK',
      severity: 'WARNING',
      title: `${lines.length} malzeme minimumun altında; talep ${request.number} açıldı`,
      body: summary.slice(0, 5).join(' · ') + (summary.length > 5 ? ` (+${summary.length - 5})` : ''),
      link: `/satin-alma/talepler/${request.id}`,
      permission: PERMISSIONS.PURCHASING_REQUEST,
      entityType: 'PurchaseRequest',
      entityId: request.id,
      dedupeKey: `stock-suggest:${request.id}`,
    });
    return { created: true, message: `Minimum altı ${lines.length} malzeme için ${request.number} talebi açıldı`, requestId: request.id, number: request.number, lines: summary };
  });
}

export { Prisma };
