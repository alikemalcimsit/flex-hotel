import { ASSET_WARRANTY_EXPIRED_LOOKBACK_DAYS, ASSET_WARRANTY_WARN_DAYS, PERMISSIONS } from '@hotelos/hotel-contracts';
import { writeWithEvents } from '../../lib/write.js';
import { addDays, businessToday, daysBetween, isoDay, locationLabel, prisma } from './shared.js';

/**
 * Garanti takibi (modül 46): bitmek üzere olan / bitmiş garantiler ve günde en fazla bir zil.
 *
 * Zil kart başına **bir kez** çalar: garanti bitişi `ASSET_WARRANTY_WARN_DAYS` güne girdiğinde, o bitiş tarihi
 * için (`warrantyAlertedFor`). Garanti uzatılırsa (tarih değişirse) yeniden çalar. Aynı gün yakalanan kartlar tek
 * zilde toplanır (dedupeKey) — 30 gün boyunca her gün aynı liste için zil çalmaz.
 */

/** Zil metninde en fazla örnek kart. */
const MAX_ALERT_EXAMPLES = 3;

/**
 * @param {string} hotelId
 * @param {{ state: 'EXPIRING' | 'EXPIRED', withinDays?: number }} query
 */
export async function listWarranty(hotelId, { state, withinDays }) {
  const today = await businessToday(hotelId);
  const expiring = state === 'EXPIRING';
  const window = withinDays ?? (expiring ? ASSET_WARRANTY_WARN_DAYS : ASSET_WARRANTY_EXPIRED_LOOKBACK_DAYS);
  const range = expiring ? { gte: today.date, lte: addDays(today.date, window) } : { lt: today.date, gte: addDays(today.date, -window) };
  const rows = await prisma.asset.findMany({
    where: { hotelId, status: 'ACTIVE', warrantyUntil: range },
    select: {
      id: true,
      code: true,
      name: true,
      warrantyUntil: true,
      supplierName: true,
      category: { select: { name: true } },
      room: { select: { number: true } },
      area: { select: { name: true } },
    },
    orderBy: { warrantyUntil: expiring ? 'asc' : 'desc' },
  });
  return {
    today: today.day,
    items: rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      categoryName: row.category.name,
      locationLabel: locationLabel(row),
      warrantyUntil: isoDay(row.warrantyUntil),
      daysLeft: daysBetween(today.date, row.warrantyUntil),
      supplierName: row.supplierName,
    })),
  };
}

/**
 * Garantisi `ASSET_WARRANTY_WARN_DAYS` güne giren ve bu bitiş için zili çalmamış kartlar → tek zil.
 * @param {string} hotelId
 * @param {{ raiseStaffAlert: Function }} deps zil bağımlılığı (test sahteleyebilir)
 * @returns {Promise<{ alerted: number }>}
 */
export async function sweepWarranty(hotelId, { raiseStaffAlert }) {
  const today = await businessToday(hotelId);
  return writeWithEvents(async (tx, stage) => {
    const due = await tx.$queryRaw`
      SELECT "id", "code", "name", "warrantyUntil" FROM "Asset"
      WHERE "hotelId" = ${hotelId} AND "status" = 'ACTIVE'
        AND "warrantyUntil" BETWEEN ${today.date} AND ${addDays(today.date, ASSET_WARRANTY_WARN_DAYS)}
        AND "warrantyAlertedFor" IS DISTINCT FROM "warrantyUntil"
      ORDER BY "warrantyUntil", "code"
      FOR UPDATE SKIP LOCKED`;
    if (due.length === 0) return { alerted: 0 };
    const examples = due.slice(0, MAX_ALERT_EXAMPLES).map((row) => `${row.code} ${row.name} (${isoDay(row.warrantyUntil)})`);
    const more = due.length > MAX_ALERT_EXAMPLES ? ` ve ${due.length - MAX_ALERT_EXAMPLES} kart daha` : '';
    await raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'ASSET',
      severity: 'INFO',
      title: `${due.length} demirbaşın garantisi ${ASSET_WARRANTY_WARN_DAYS} gün içinde bitiyor`,
      body: `${examples.join(', ')}${more}.`,
      link: '/demirbas/garanti',
      permission: PERMISSIONS.ASSETS_MANAGE,
      dedupeKey: `asset-warranty:${hotelId}:${today.day}`,
    });
    await tx.$executeRaw`UPDATE "Asset" SET "warrantyAlertedFor" = "warrantyUntil" WHERE "id" = ANY(${due.map((row) => row.id)}::text[])`;
    return { alerted: due.length };
  });
}
