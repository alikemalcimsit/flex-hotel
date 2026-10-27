import { toIsoDay, toMoneyString } from '@hotelos/core';
import { prisma } from '../../db.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { lockPosShifts } from '../../lib/locks.js';
import { getActiveTaxes, getHotelSettings } from '../settings/service.js';
import { checkNumber, checkTotals } from './rules.js';

/**
 * Restoran POS (modül 39) servislerinin ortak parçaları: biçimler, otel bağlamı, politika,
 * numara serisi, açık vardiya ve adisyon toplamlarının yeniden yazılması.
 */

/** @param {Date | null | undefined} value */
export const iso = (value) => (value ? value.toISOString() : null);
/** @param {Date | null | undefined} value */
export const day = (value) => (value ? toIsoDay(value) : null);
export const money = (value) => toMoneyString(String(value ?? 0));
export const optionalMoney = (value) => (value === null || value === undefined ? null : money(value));
/** "YYYY-AA-GG" → @db.Date değeri. @param {string} text */
export const dateOnly = (text) => new Date(`${text}T00:00:00.000Z`);

/** Politika satırı yokken geçerli değerler (migration'daki varsayılanlarla aynı). */
export const DEFAULT_POS_SETTINGS = Object.freeze({
  adjustmentApprovalAmount: '1000.00',
  cashVarianceAlert: '100.00',
  trayCharge: '0.00',
  deliveryTargetMinutes: 30,
  prepLeadMinutes: 30,
  trayAlertMinutes: 90,
  guestOrderingEnabled: false,
  updatedAt: null,
});

/**
 * Otelin para birimi, saat dilimi ve iş günü.
 * @param {string} hotelId
 */
export async function hotelContext(hotelId) {
  const [hotel, businessDate] = await Promise.all([getHotelSettings(hotelId), getBusinessDate(hotelId)]);
  return { hotel, currency: hotel.currency, timezone: hotel.timezone, today: toIsoDay(businessDate) };
}

/**
 * POS politikası (satır yoksa varsayılanlar).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 */
export async function loadPosSettings(client, hotelId) {
  const row = await client.posSettings.findFirst({ where: { hotelId } });
  if (!row) return { ...DEFAULT_POS_SETTINGS };
  return {
    adjustmentApprovalAmount: money(row.adjustmentApprovalAmount),
    cashVarianceAlert: money(row.cashVarianceAlert),
    trayCharge: money(row.trayCharge),
    deliveryTargetMinutes: row.deliveryTargetMinutes,
    prepLeadMinutes: row.prepLeadMinutes,
    trayAlertMinutes: row.trayAlertMinutes,
    guestOrderingEnabled: row.guestOrderingEnabled,
    updatedAt: iso(row.updatedAt),
  };
}

/**
 * Sıradaki adisyon numarası (otel × yıl): tek ifadede artırılır; aynı anda iki istek iki
 * ayrı numara alır, geri alınan transaction numarayı tüketmez.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {number} year
 */
export async function nextCheckNumber(tx, hotelId, year) {
  const [row] = await tx.$queryRaw`
    INSERT INTO "PosSequence" ("hotelId", "kind", "year", "last") VALUES (${hotelId}, 'CHECK', ${year}, 1)
    ON CONFLICT ("hotelId", "kind", "year") DO UPDATE SET "last" = "PosSequence"."last" + 1
    RETURNING "last"`;
  return checkNumber(year, row.last);
}

/**
 * Kişinin açık vardiyası (paylaşımlı kilitle: vardiya kapanırken kasaya para girmez,
 * adisyon açılmaz). Yoksa iş kuralı hatası.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} email küçük harf
 * @param {{ who?: string }} [options] hata metninde kimin vardiyası
 */
export async function requireOpenShift(tx, hotelId, email, { who = 'Sizin' } = {}) {
  const shift = await tx.posShift.findFirst({ where: { hotelId, waiterEmail: email, status: 'OPEN' }, select: { id: true } });
  if (!shift) throw new ConflictError(`${who} açık vardiyanız yok; önce vardiya açın (kasa avansıyla).`, 'NO_SHIFT');
  await lockPosShifts(tx, hotelId, [shift.id], { shared: true });
  const locked = await tx.posShift.findFirst({ where: { id: shift.id }, select: { id: true, status: true, waiterEmail: true, outletId: true } });
  // Kilidi beklerken kapanmış olabilir.
  if (locked.status !== 'OPEN') throw new ConflictError(`${who} vardiyanız az önce kapandı; yeniden açın.`, 'NO_SHIFT');
  return locked;
}

/**
 * Adisyonun toplamlarını kalemlerinden ve geçerli indiriminden hesaplar (yazmaz): toplamlar,
 * vergi dökümü, kategori başına brüt / toplam ve hesapta kullanılan vergiler.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {string} checkId
 */
export async function computeCheckTotals(client, hotelId, checkId) {
  const [check, lines, taxes, discount] = await Promise.all([
    client.posCheck.findFirst({ where: { id: checkId, hotelId }, select: { id: true } }),
    client.posOrderLine.findMany({ where: { checkId }, select: { quantity: true, voidedQuantity: true, compedQuantity: true, unitPrice: true, taxCategory: true } }),
    getActiveTaxes(hotelId),
    client.posAdjustment.findFirst({
      where: { checkId, kind: 'DISCOUNT', status: 'APPLIED', supersededAt: null },
      orderBy: { requestedAt: 'desc' },
      select: { discountPct: true, discountAmount: true },
    }),
  ]);
  if (!check) throw new NotFoundError('Adisyon bulunamadı');
  const totals = checkTotals({
    lines: lines.map((line) => ({ ...line, unitPrice: String(line.unitPrice) })),
    discountPct: discount?.discountPct === null || discount?.discountPct === undefined ? null : String(discount.discountPct),
    discountAmount: discount?.discountAmount === null || discount?.discountAmount === undefined ? null : String(discount.discountAmount),
    taxes,
  });
  return { ...totals, discountPct: discount?.discountPct ?? null, appliedTaxes: taxes };
}

/**
 * Adisyonun kalemlerinden ve uygulanmış indiriminden toplamları yeniden yazar (adisyon
 * kilitliyken). Ödeme toplamlarına dokunmaz.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} checkId
 */
export async function recomputeCheckTotals(tx, hotelId, checkId) {
  const totals = await computeCheckTotals(tx, hotelId, checkId);
  await tx.posCheck.update({
    where: { id: checkId },
    data: {
      subtotal: totals.subtotal,
      compTotal: totals.compTotal,
      voidTotal: totals.voidTotal,
      discountPct: totals.discountPct,
      discountTotal: totals.discountTotal,
      netTotal: totals.netTotal,
      taxTotal: totals.taxTotal,
      grandTotal: totals.grandTotal,
    },
  });
  return totals;
}

/**
 * İşlenmiş ödemelerin ve odaya yazılanların toplamını yeniden yazar (adisyon kilitliyken).
 * Ham SQL: sürüm damgası ilerlemez — ödeme, aynı anda kalem gönderen garsonun ekranını
 * "kayıt değişti" hatasına düşürmemeli.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} checkId
 */
export async function recomputeCheckPayments(tx, checkId) {
  const [row] = await tx.$queryRaw`
    UPDATE "PosCheck" SET
      "paidTotal" = COALESCE((SELECT SUM(p."amount") FROM "PosPayment" p WHERE p."checkId" = ${checkId} AND p."status" = 'POSTED'), 0),
      "roomChargeTotal" = COALESCE((SELECT SUM(r."amount") FROM "PosRoomCharge" r WHERE r."checkId" = ${checkId}), 0)
    WHERE "id" = ${checkId}
    RETURNING "paidTotal"::text AS "paidTotal", "roomChargeTotal"::text AS "roomChargeTotal", "grandTotal"::text AS "grandTotal"`;
  return { paidTotal: money(row.paidTotal), roomChargeTotal: money(row.roomChargeTotal), grandTotal: money(row.grandTotal) };
}

export { prisma };
