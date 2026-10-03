import { toDecimal, toIsoDay, toMoneyString } from '@hotelos/core';
import { LAUNDRY_OPEN_STATUSES } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ValidationError } from '../../lib/errors.js';
import { getHotelSettings } from '../settings/service.js';
import { guestFullName } from '../reservations/guests.js';

/**
 * Günlük minibar / çamaşırhane raporu (modül 19).
 *
 * Her bölüm tek toplama sorgusu (GROUP BY) — günün bütün satırları çekilip
 * uygulamada toplanmaz. Index'ler: fişler `(hotelId, businessDate, recordedAt, id)`,
 * çamaşır alınan `(hotelId, businessDate)`, teslim `(hotelId, deliveredBusinessDate, …)`,
 * açık / geciken `(hotelId, status, dueAt, id)`.
 *
 * Tutarlar fiyat listesinin tutarıdır (vergi ayarına göre dahil / hariç);
 * folyoya giden vergili toplam folyo raporlarında.
 */

/** Raporda gösterilen en fazla ürün / personel / geciken sipariş satırı. */
const REPORT_TOP_ROWS = 30;

/** @param {unknown} value */
const money = (value) => toMoneyString(String(value ?? '0'));

/**
 * @param {string} hotelId
 * @param {{ date?: string }} query
 * @param {{ now?: Date }} [options]
 */
export async function getExtrasReport(hotelId, { date }, { now = new Date() } = {}) {
  const [businessDate, hotel] = await Promise.all([getBusinessDate(hotelId).then(toIsoDay), getHotelSettings(hotelId)]);
  const day = date ?? businessDate;
  if (day > businessDate) throw new ValidationError('İleri tarihli rapor alınmaz.', { field: 'date' });

  const [minibarTargets, minibarItems, minibarStaff, laundryReceived, laundryDelivered, laundryServices, openNow, overdue] = await Promise.all([
    prisma.$queryRaw`
      SELECT c."chargeTarget" AS "target", COUNT(*)::int AS "slips", COUNT(DISTINCT c."roomId")::int AS "rooms",
             SUM(c."itemCount")::int AS "items", SUM(c."totalAmount")::text AS "amount"
      FROM "MinibarConsumption" c
      WHERE c."hotelId" = ${hotelId} AND c."businessDate" = ${day}::date AND c."deletedAt" IS NULL
      GROUP BY 1`,
    prisma.$queryRaw`
      SELECT l."itemId", l."name", c."chargeTarget" = 'NONE' AS "loss",
             SUM(l."quantity")::int AS "quantity", SUM(l."total")::text AS "amount"
      FROM "MinibarConsumption" c
      JOIN "MinibarConsumptionLine" l ON l."consumptionId" = c."id"
      WHERE c."hotelId" = ${hotelId} AND c."businessDate" = ${day}::date AND c."deletedAt" IS NULL
      GROUP BY 1, 2, 3
      ORDER BY SUM(l."total") DESC
      LIMIT ${REPORT_TOP_ROWS * 2}`,
    prisma.$queryRaw`
      SELECT c."recordedBy" AS "staff", COUNT(*)::int AS "slips", COUNT(DISTINCT c."roomId")::int AS "rooms",
             SUM(c."totalAmount")::text AS "amount"
      FROM "MinibarConsumption" c
      WHERE c."hotelId" = ${hotelId} AND c."businessDate" = ${day}::date AND c."deletedAt" IS NULL
      GROUP BY 1
      ORDER BY COUNT(*) DESC
      LIMIT ${REPORT_TOP_ROWS}`,
    prisma.$queryRaw`
      SELECT o."status", o."express", COUNT(*)::int AS "orders", SUM(o."itemCount")::int AS "items", SUM(o."total")::text AS "amount"
      FROM "LaundryOrder" o
      WHERE o."hotelId" = ${hotelId} AND o."businessDate" = ${day}::date AND o."deletedAt" IS NULL
      GROUP BY 1, 2`,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS "orders", COALESCE(SUM(o."itemCount"), 0)::int AS "items",
             COALESCE(SUM(o."subtotal"), 0)::text AS "subtotal", COALESCE(SUM(o."surcharge"), 0)::text AS "surcharge",
             COALESCE(SUM(o."total"), 0)::text AS "amount"
      FROM "LaundryOrder" o
      WHERE o."hotelId" = ${hotelId} AND o."deliveredBusinessDate" = ${day}::date AND o."deletedAt" IS NULL`,
    prisma.$queryRaw`
      SELECT l."service", SUM(l."quantity")::int AS "quantity", SUM(l."total")::text AS "amount"
      FROM "LaundryOrder" o
      JOIN "LaundryOrderLine" l ON l."orderId" = o."id"
      WHERE o."hotelId" = ${hotelId} AND o."deliveredBusinessDate" = ${day}::date AND o."deletedAt" IS NULL
      GROUP BY 1
      ORDER BY 1`,
    prisma.laundryOrder.count({ where: { hotelId, status: { in: [...LAUNDRY_OPEN_STATUSES] } } }),
    prisma.laundryOrder.findMany({
      where: { hotelId, status: { in: [...LAUNDRY_OPEN_STATUSES] }, dueAt: { lt: now } },
      select: {
        id: true,
        reference: true,
        status: true,
        dueAt: true,
        total: true,
        room: { select: { number: true } },
        reservation: { select: { id: true, status: true, guest: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: REPORT_TOP_ROWS,
    }),
  ]);
  const overdueCount = overdue.length < REPORT_TOP_ROWS
    ? overdue.length
    : await prisma.laundryOrder.count({ where: { hotelId, status: { in: [...LAUNDRY_OPEN_STATUSES] }, dueAt: { lt: now } } });

  return {
    date: day,
    businessDate,
    isToday: day === businessDate,
    currency: hotel.currency,
    minibar: summarizeMinibar(minibarTargets, minibarItems, minibarStaff),
    laundry: {
      received: summarizeReceived(laundryReceived),
      delivered: {
        orders: laundryDelivered[0]?.orders ?? 0,
        items: laundryDelivered[0]?.items ?? 0,
        subtotal: money(laundryDelivered[0]?.subtotal),
        surcharge: money(laundryDelivered[0]?.surcharge),
        amount: money(laundryDelivered[0]?.amount),
        byService: laundryServices.map((row) => ({ service: row.service, quantity: row.quantity, amount: money(row.amount) })),
      },
      openNow,
      overdueCount,
      overdue: overdue.map((row) => ({
        id: row.id,
        reference: row.reference,
        status: row.status,
        dueAt: row.dueAt.toISOString(),
        total: money(row.total),
        roomNumber: row.room?.number ?? null,
        guestName: guestFullName(row.reservation.guest),
        stayStatus: row.reservation.status,
      })),
    },
  };
}

/**
 * @param {Array<{ target: string, slips: number, rooms: number, items: number, amount: string }>} targets
 * @param {Array<{ itemId: string, name: string, loss: boolean, quantity: number, amount: string }>} items
 * @param {Array<{ staff: string, slips: number, rooms: number, amount: string }>} staff
 */
export function summarizeMinibar(targets, items, staff) {
  const byTarget = Object.fromEntries(
    ['IN_HOUSE', 'LATE', 'NONE'].map((target) => {
      const row = targets.find((entry) => entry.target === target);
      return [target, { slips: row?.slips ?? 0, rooms: row?.rooms ?? 0, items: row?.items ?? 0, amount: money(row?.amount) }];
    }),
  );
  const charged = toDecimal(byTarget.IN_HOUSE.amount).plus(toDecimal(byTarget.LATE.amount));
  // Ürün başına: folyoya yazılan ve kayıp ayrı sütun.
  const products = new Map();
  for (const row of items) {
    const entry = products.get(row.itemId) ?? { itemId: row.itemId, name: row.name, quantity: 0, charged: toDecimal(0), lossQuantity: 0, loss: toDecimal(0) };
    if (row.loss) {
      entry.lossQuantity += row.quantity;
      entry.loss = entry.loss.plus(toDecimal(row.amount));
    } else {
      entry.quantity += row.quantity;
      entry.charged = entry.charged.plus(toDecimal(row.amount));
    }
    products.set(row.itemId, entry);
  }
  return {
    byTarget,
    chargedAmount: toMoneyString(charged),
    lossAmount: byTarget.NONE.amount,
    items: [...products.values()]
      .sort((a, b) => b.charged.plus(b.loss).comparedTo(a.charged.plus(a.loss)))
      .slice(0, REPORT_TOP_ROWS)
      .map((entry) => ({ ...entry, charged: toMoneyString(entry.charged), loss: toMoneyString(entry.loss) })),
    staff: staff.map((row) => ({ staff: row.staff, slips: row.slips, rooms: row.rooms, amount: money(row.amount) })),
  };
}

/**
 * O gün alınan siparişler, şimdiki durumlarına göre.
 * @param {Array<{ status: string, express: boolean, orders: number, items: number, amount: string }>} rows
 */
export function summarizeReceived(rows) {
  const total = { orders: 0, items: 0, express: 0, cancelled: 0, amount: toDecimal(0) };
  const byStatus = {};
  for (const row of rows) {
    total.orders += row.orders;
    total.items += row.items;
    if (row.express) total.express += row.orders;
    if (row.status === 'CANCELLED') total.cancelled += row.orders;
    else total.amount = total.amount.plus(toDecimal(row.amount));
    byStatus[row.status] = (byStatus[row.status] ?? 0) + row.orders;
  }
  return { ...total, amount: toMoneyString(total.amount), byStatus };
}
