import { Prisma } from '@prisma/client';
import { toDecimal, toMoneyString } from '@hotelos/core';
import { hotelContext, money, prisma } from './shared.js';

/**
 * Restoran satış raporu (modül 39): iş günü aralığında (en fazla `MAX_POS_REPORT_DAYS`)
 * kapanmış adisyonlar — satış noktası, gün, garson kırılımı; tahsilat yöntemleri, odaya
 * yazılan, indirim / ikram / iptal / zayi, en çok satan ürünler.
 *
 * Her parça tek gruplu sorgu (`PosCheck (hotelId, businessDate, outletId)`, ürün kırılımında
 * kalemin kapanış günü `PosOrderLine (hotelId, businessDate)`, ödeme ve odaya yazmada
 * `(hotelId, businessDate…)` index'leri). Tarihler metin olarak `::date` ile verilir
 * (saat dilimi kayması yok).
 */

/** Raporda listelenen en çok satan ürün sayısı. */
const TOP_ITEMS = 20;

/**
 * @param {string} hotelId
 * @param {{ from?: string, to?: string, outletId?: string }} query iş günleri "YYYY-AA-GG" (verilmezse bugünün iş günü)
 */
export async function salesReport(hotelId, query) {
  const { currency, today } = await hotelContext(hotelId);
  const from = query.from ?? today;
  const to = query.to ?? today;
  const outletId = query.outletId;
  const outlet = outletId ? Prisma.sql`AND c."outletId" = ${outletId}` : Prisma.empty;
  // Ödeme, odaya yazma ve kalem kendi iş gününü taşır: adisyona yalnızca satış noktası süzgecinde bağlanılır.
  const ofOutlet = (alias) => (outletId ? Prisma.sql`JOIN "PosCheck" c ON c."id" = ${Prisma.raw(alias)}."checkId" AND c."outletId" = ${outletId}` : Prisma.empty);
  const [byOutlet, byDay, byWaiter, payments, rooms, adjustments, items] = await Promise.all([
    prisma.$queryRaw`
      SELECT c."outletId", o."name" AS "outletName", COUNT(*)::int AS "checks", COALESCE(SUM(c."covers"), 0)::int AS "covers",
             SUM(c."subtotal")::text AS "subtotal", SUM(c."discountTotal")::text AS "discountTotal", SUM(c."compTotal")::text AS "compTotal",
             SUM(c."voidTotal")::text AS "voidTotal", SUM(c."netTotal")::text AS "netTotal", SUM(c."taxTotal")::text AS "taxTotal",
             SUM(c."grandTotal")::text AS "grandTotal"
      FROM "PosCheck" c JOIN "PosOutlet" o ON o."id" = c."outletId"
      WHERE c."hotelId" = ${hotelId} AND c."status" = 'CLOSED' AND c."businessDate" BETWEEN ${from}::date AND ${to}::date ${outlet}
      GROUP BY 1, 2 ORDER BY 2`,
    prisma.$queryRaw`
      SELECT to_char(c."businessDate", 'YYYY-MM-DD') AS "date", COUNT(*)::int AS "checks", COALESCE(SUM(c."covers"), 0)::int AS "covers",
             SUM(c."grandTotal")::text AS "grandTotal"
      FROM "PosCheck" c
      WHERE c."hotelId" = ${hotelId} AND c."status" = 'CLOSED' AND c."businessDate" BETWEEN ${from}::date AND ${to}::date ${outlet}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw`
      SELECT c."waiterEmail", COUNT(*)::int AS "checks", COALESCE(SUM(c."covers"), 0)::int AS "covers",
             SUM(c."grandTotal")::text AS "grandTotal", SUM(c."discountTotal" + c."compTotal")::text AS "givenAway"
      FROM "PosCheck" c
      WHERE c."hotelId" = ${hotelId} AND c."status" = 'CLOSED' AND c."businessDate" BETWEEN ${from}::date AND ${to}::date ${outlet}
      GROUP BY 1 ORDER BY SUM(c."grandTotal") DESC`,
    prisma.$queryRaw`
      SELECT p."method", p."kind", COUNT(*)::int AS "count", SUM(p."amount")::text AS "amount"
      FROM "PosPayment" p ${ofOutlet('p')}
      WHERE p."hotelId" = ${hotelId} AND p."status" = 'POSTED' AND p."businessDate" BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1, 2`,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS "count", COALESCE(SUM(r."amount"), 0)::text AS "amount"
      FROM "PosRoomCharge" r ${ofOutlet('r')}
      WHERE r."hotelId" = ${hotelId} AND r."businessDate" BETWEEN ${from}::date AND ${to}::date`,
    prisma.$queryRaw`
      SELECT a."kind", a."waste", COUNT(*)::int AS "count", SUM(a."value")::text AS "value"
      FROM "PosAdjustment" a JOIN "PosCheck" c ON c."id" = a."checkId"
      WHERE c."hotelId" = ${hotelId} AND c."status" = 'CLOSED' AND c."businessDate" BETWEEN ${from}::date AND ${to}::date ${outlet}
        AND a."status" = 'APPLIED' AND a."supersededAt" IS NULL
      GROUP BY 1, 2`,
    prisma.$queryRaw`
      SELECT l."menuItemId", l."name",
             SUM(l."quantity" - l."voidedQuantity" - l."compedQuantity")::int AS "quantity",
             SUM((l."quantity" - l."voidedQuantity" - l."compedQuantity") * l."unitPrice")::text AS "amount"
      FROM "PosOrderLine" l ${ofOutlet('l')}
      WHERE l."hotelId" = ${hotelId} AND l."businessDate" BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1, 2
      HAVING SUM(l."quantity" - l."voidedQuantity" - l."compedQuantity") > 0
      ORDER BY SUM((l."quantity" - l."voidedQuantity" - l."compedQuantity") * l."unitPrice") DESC, 2
      LIMIT ${TOP_ITEMS}`,
  ]);

  const total = (rows, field) => toMoneyString(rows.reduce((sum, row) => sum.plus(toDecimal(row[field] ?? 0)), toDecimal(0)));
  const checks = byOutlet.reduce((sum, row) => sum + row.checks, 0);
  const covers = byOutlet.reduce((sum, row) => sum + row.covers, 0);
  const grand = toDecimal(total(byOutlet, 'grandTotal'));
  const methods = {};
  for (const row of payments) {
    const entry = (methods[row.method] ??= { method: row.method, count: 0, received: '0.00', reversed: '0.00', net: '0.00' });
    if (row.kind === 'REVERSAL') entry.reversed = toMoneyString(toDecimal(entry.reversed).plus(toDecimal(row.amount)));
    else {
      entry.received = toMoneyString(toDecimal(entry.received).plus(toDecimal(row.amount)));
      entry.count += row.count;
    }
    entry.net = toMoneyString(toDecimal(entry.net).plus(toDecimal(row.amount)));
  }
  const adjustment = (kind, waste = null) => {
    const rows = adjustments.filter((row) => row.kind === kind && (waste === null || row.waste === waste));
    return { count: rows.reduce((sum, row) => sum + row.count, 0), value: total(rows, 'value') };
  };

  return {
    currency,
    from,
    to,
    totals: {
      checks,
      covers,
      subtotal: total(byOutlet, 'subtotal'),
      discountTotal: total(byOutlet, 'discountTotal'),
      compTotal: total(byOutlet, 'compTotal'),
      voidTotal: total(byOutlet, 'voidTotal'),
      netTotal: total(byOutlet, 'netTotal'),
      taxTotal: total(byOutlet, 'taxTotal'),
      grandTotal: toMoneyString(grand),
      averageCheck: checks ? toMoneyString(grand.dividedBy(checks)) : '0.00',
      averageCover: covers ? toMoneyString(grand.dividedBy(covers)) : '0.00',
    },
    outlets: byOutlet.map((row) => ({
      outletId: row.outletId,
      outletName: row.outletName,
      checks: row.checks,
      covers: row.covers,
      discountTotal: money(row.discountTotal),
      compTotal: money(row.compTotal),
      voidTotal: money(row.voidTotal),
      netTotal: money(row.netTotal),
      taxTotal: money(row.taxTotal),
      grandTotal: money(row.grandTotal),
    })),
    days: byDay.map((row) => ({ date: row.date, checks: row.checks, covers: row.covers, grandTotal: money(row.grandTotal) })),
    waiters: byWaiter.map((row) => ({ waiterEmail: row.waiterEmail, checks: row.checks, covers: row.covers, grandTotal: money(row.grandTotal), givenAway: money(row.givenAway) })),
    payments: Object.values(methods).sort((a, b) => a.method.localeCompare(b.method)),
    roomCharges: { count: rooms[0].count, amount: money(rooms[0].amount) },
    adjustments: {
      comp: adjustment('COMP'),
      void: adjustment('VOID'),
      waste: adjustment('VOID', true),
      discount: adjustment('DISCOUNT'),
    },
    topItems: items.map((item) => ({ menuItemId: item.menuItemId, name: item.name, quantity: item.quantity, amount: money(item.amount) })),
  };
}
