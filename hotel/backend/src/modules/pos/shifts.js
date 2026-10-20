import { currentActor, toDecimal, toMoneyString } from '@hotelos/core';
import { prismaUnfiltered } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, ForbiddenError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockPosShifts } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { shiftCash, varianceNeedsAlert } from './rules.js';
import { dateOnly, day, hotelContext, iso, loadPosSettings, money, optionalMoney, prisma } from './shared.js';

/**
 * Garson vardiyası (modül 39): kasa avansıyla açılır, parayı alan garsonun nakit / kart
 * tahsilatı vardiyasına yazılır; kapanışta açık adisyon ve onay bekleyen ödeme kalmaz, kasadaki
 * nakit sayılır, **beklenen** (avans + işlenmiş nakit, iptaller düşülmüş) ile fark kaydedilir.
 * Fark politikadaki eşiği aşarsa şef garson / müdüre uyarı düşer.
 *
 * - Bir garsonun aynı anda tek açık vardiyası olur (kısmi tekil index).
 * - Kapanış vardiyayı **özel** kilitler; adisyon açan, ödeme alan, devir alan işlemler
 *   paylaşımlı kilit tutar: kapanış sayımı sırasında kasaya para girmez.
 * - Rapor: adisyon / kişi / satış, indirim / ikram / iptal / zayi, yöntem bazında tahsilat,
 *   odaya yazılan, en çok satan ürünler — vardiya başına birkaç gruplu sorgu (N+1 yok).
 */

/** Raporda listelenen en çok satan ürün sayısı. */
const TOP_ITEMS = 10;

const SHIFT_SELECT = Object.freeze({
  id: true,
  waiterEmail: true,
  outletId: true,
  status: true,
  openingFloat: true,
  businessDate: true,
  openedAt: true,
  closedAt: true,
  closedBy: true,
  countedCash: true,
  expectedCash: true,
  variance: true,
  note: true,
  updatedAt: true,
  outlet: { select: { name: true } },
});

/** @param {any} row */
function toShiftDto(row) {
  return {
    id: row.id,
    waiterEmail: row.waiterEmail,
    outletId: row.outletId,
    outletName: row.outlet?.name ?? null,
    status: row.status,
    openingFloat: money(row.openingFloat),
    businessDate: day(row.businessDate),
    openedAt: iso(row.openedAt),
    closedAt: iso(row.closedAt),
    closedBy: row.closedBy,
    countedCash: optionalMoney(row.countedCash),
    expectedCash: optionalMoney(row.expectedCash),
    variance: optionalMoney(row.variance),
    note: row.note,
    updatedAt: iso(row.updatedAt),
  };
}

/**
 * Vardiyanın kasa hareketleri (işlenmiş) yöntem ve tür bazında; nakit net (iptaller düşülmüş).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} shiftId
 */
async function shiftPayments(client, shiftId) {
  const groups = await client.posPayment.groupBy({
    by: ['method', 'kind'],
    where: { shiftId, status: 'POSTED' },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const methods = {};
  let cashNet = toDecimal(0);
  for (const group of groups) {
    const entry = (methods[group.method] ??= { method: group.method, count: 0, received: '0.00', reversed: '0.00', net: '0.00' });
    const amount = toDecimal(String(group._sum.amount ?? 0));
    if (group.kind === 'REVERSAL') entry.reversed = toMoneyString(toDecimal(entry.reversed).plus(amount));
    else {
      entry.received = toMoneyString(toDecimal(entry.received).plus(amount));
      entry.count += group._count._all;
    }
    entry.net = toMoneyString(toDecimal(entry.net).plus(amount));
    if (group.method === 'CASH') cashNet = cashNet.plus(amount);
  }
  return { methods: Object.values(methods).sort((a, b) => a.method.localeCompare(b.method)), cashNet: toMoneyString(cashNet) };
}

/**
 * Vardiyanın bekleyen işleri: açık adisyonlar (vardiyanın sahibi olduğu), onay bekleyen
 * tahsilat ve ödeme iptalleri (vardiyanın kasasına girecek / çıkacak).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} shiftId
 */
async function shiftBlockers(client, shiftId) {
  const [openChecks, pendingPayments, pendingVoids] = await Promise.all([
    client.posCheck.count({ where: { shiftId, status: 'OPEN' } }),
    client.posPayment.count({ where: { shiftId, status: 'PENDING' } }),
    client.posPayment.count({ where: { shiftId, voidRequestedAt: { not: null } } }),
  ]);
  return { openChecks, pendingPayments, pendingVoids };
}

/* ══════════════════ Aç ══════════════════ */

/**
 * Vardiya açar (oturumdaki garson için). Satış noktası verilirse varsayılan ekran odur.
 * @param {string} hotelId
 * @param {{ openingFloat: string, outletId?: string | null }} input
 */
export async function openShift(hotelId, input) {
  const actor = currentActor();
  const { today } = await hotelContext(hotelId);
  let shiftId;
  try {
    shiftId = await writeWithEvents(async (tx, stage) => {
      if (input.outletId) {
        const outlet = await tx.posOutlet.findFirst({ where: { id: input.outletId, hotelId }, select: { isActive: true } });
        if (!outlet?.isActive) throw new ValidationError('Satış noktası bulunamadı ya da kapalı', { field: 'outletId' });
      }
      const row = await tx.posShift.create({
        data: { hotelId, waiterEmail: actor, outletId: input.outletId ?? null, openingFloat: input.openingFloat, businessDate: dateOnly(today) },
        select: { id: true },
      });
      await recordAudit(tx, { hotelId, entity: 'PosShift', entityId: row.id, action: 'CREATE', after: { waiterEmail: actor, openingFloat: input.openingFloat, outletId: input.outletId ?? null, businessDate: today } });
      await stage('pos.shift.changed', { hotelId, shiftId: row.id, change: 'OPENED' });
      return row.id;
    });
  } catch (error) {
    // Kısmi tekil index (bir garsona tek açık vardiya): Prisma alan adlarıyla bildirir.
    if (error?.code === 'P2002') throw new ConflictError('Zaten açık bir vardiyanız var; önce onu kapatın.', 'SHIFT_OPEN');
    rethrowPrismaError(error);
  }
  return getShift(hotelId, shiftId, { canSeeAll: true });
}

/* ══════════════════ Okuma ══════════════════ */

/**
 * Vardiya ve canlı kasası: beklenen nakit, yöntem bazında tahsilat, bekleyen işler.
 * Başkasının vardiyası yalnızca rapor / şef garson yetkisiyle.
 *
 * @param {string} hotelId
 * @param {string} shiftId
 * @param {{ canSeeAll: boolean }} access
 */
export async function getShift(hotelId, shiftId, { canSeeAll }) {
  const row = await prisma.posShift.findFirst({ where: { id: shiftId, hotelId }, select: SHIFT_SELECT });
  if (!row) throw new NotFoundError('Vardiya bulunamadı');
  if (!canSeeAll && row.waiterEmail !== currentActor()) throw new ForbiddenError('Başka garsonun vardiyasını göremezsiniz');
  const [payments, blockers, { currency }] = await Promise.all([shiftPayments(prisma, shiftId), shiftBlockers(prisma, shiftId), hotelContext(hotelId)]);
  const cash = shiftCash({ openingFloat: money(row.openingFloat), cashNet: payments.cashNet, countedCash: optionalMoney(row.countedCash) });
  return {
    ...toShiftDto(row),
    currency,
    cash: {
      openingFloat: money(row.openingFloat),
      cashNet: payments.cashNet,
      // Kapanmış vardiyada kayıtlı değer (sonradan değişmez); açıkta canlı hesap.
      expectedCash: row.status === 'CLOSED' ? money(row.expectedCash) : cash.expectedCash,
    },
    payments: payments.methods,
    blockers,
  };
}

/** Oturumdaki garsonun açık vardiyası (yoksa `null`). @param {string} hotelId */
export async function getCurrentShift(hotelId) {
  const row = await prisma.posShift.findFirst({ where: { hotelId, waiterEmail: currentActor(), status: 'OPEN' }, select: { id: true } });
  return { shift: row ? await getShift(hotelId, row.id, { canSeeAll: true }) : null };
}

/**
 * Vardiya listesi (sayfalı; en yeni açılan önce): durum, garson, iş günü aralığı. Sayfadaki
 * vardiyaların tahsilatı ve adisyon sayısı iki gruplu sorguyla.
 *
 * @param {string} hotelId
 * @param {any} query `posShiftListQuerySchema`
 * @param {{ canSeeAll: boolean }} access yetkisizse yalnızca kendi vardiyaları
 */
export async function listShifts(hotelId, query, { canSeeAll }) {
  const { currency } = await hotelContext(hotelId);
  const where = {
    hotelId,
    ...(query.status ? { status: query.status } : {}),
    ...(canSeeAll ? (query.waiterEmail ? { waiterEmail: query.waiterEmail } : {}) : { waiterEmail: currentActor() }),
    ...(query.from || query.to
      ? { businessDate: { ...(query.from ? { gte: dateOnly(day(query.from)) } : {}), ...(query.to ? { lte: dateOnly(day(query.to)) } : {}) } }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.posShift.findMany({ where, orderBy: [{ openedAt: 'desc' }, { id: 'desc' }], ...toSkipTake(query), select: SHIFT_SELECT }),
    prisma.posShift.count({ where }),
  ]);
  const ids = rows.map((row) => row.id);
  const [payments, checks] = ids.length
    ? await Promise.all([
        prisma.posPayment.groupBy({ by: ['shiftId', 'method'], where: { shiftId: { in: ids }, status: 'POSTED' }, _sum: { amount: true } }),
        prisma.posCheck.groupBy({ by: ['shiftId', 'status'], where: { shiftId: { in: ids } }, _count: { _all: true }, _sum: { grandTotal: true } }),
      ])
    : [[], []];
  const items = rows.map((row) => {
    const mine = payments.filter((group) => group.shiftId === row.id);
    const sum = (method) => toMoneyString(mine.filter((group) => group.method === method).reduce((acc, group) => acc.plus(toDecimal(String(group._sum.amount ?? 0))), toDecimal(0)));
    const byStatus = (status) => checks.find((group) => group.shiftId === row.id && group.status === status);
    return {
      ...toShiftDto(row),
      cashNet: sum('CASH'),
      cardNet: sum('CARD'),
      closedChecks: byStatus('CLOSED')?._count._all ?? 0,
      openChecks: byStatus('OPEN')?._count._all ?? 0,
      sales: money(byStatus('CLOSED')?._sum.grandTotal ?? 0),
    };
  });
  const page = buildPage(items, total, query);
  return { ...page, meta: { ...page.meta, currency } };
}

/* ══════════════════ Kapat ══════════════════ */

/**
 * Vardiyayı kapatır: kendi vardiyasını garson, başkasınınkini şef garson kapatır. Açık
 * adisyon (devredilmeli), onay bekleyen tahsilat ya da ödeme iptali varsa kapanmaz.
 * Sayılan nakit ile beklenen arasındaki fark kaydedilir; eşiği aşarsa uyarı.
 *
 * @param {string} hotelId
 * @param {string} shiftId
 * @param {{ expectedUpdatedAt: Date, countedCash: string, note?: string | null }} input
 * @param {{ canSupervise: boolean }} access
 */
export async function closeShift(hotelId, shiftId, input, { canSupervise }) {
  const actor = currentActor();
  const { currency } = await hotelContext(hotelId);
  const outcome = await writeWithEvents(async (tx, stage) => {
    if (!(await lockPosShifts(tx, hotelId, [shiftId])).has(shiftId)) throw new NotFoundError('Vardiya bulunamadı');
    const shift = await tx.posShift.findFirst({ where: { id: shiftId }, select: SHIFT_SELECT });
    if (shift.waiterEmail !== actor && !canSupervise) throw new ForbiddenError('Başka garsonun vardiyasını yalnızca şef garson kapatır');
    if (shift.status !== 'OPEN') throw new ConflictError('Vardiya zaten kapanmış', 'SHIFT_CLOSED');
    if (shift.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new StaleWriteError('Vardiya siz bakarken değişti; ekran yenilendi, tekrar deneyin.');
    const blockers = await shiftBlockers(tx, shiftId);
    if (blockers.openChecks) {
      throw new ConflictError(`Vardiyada ${blockers.openChecks} açık adisyon var; kapatın ya da başka garsona devredin.`, 'OPEN_CHECKS', { openChecks: blockers.openChecks });
    }
    if (blockers.pendingPayments || blockers.pendingVoids) {
      throw new ConflictError('Onay bekleyen tahsilat ya da ödeme iptali var; karar gelmeden kasa sayılmaz.', 'PENDING_APPROVAL', blockers);
    }
    const [payments, settings] = await Promise.all([shiftPayments(tx, shiftId), loadPosSettings(tx, hotelId)]);
    const cash = shiftCash({ openingFloat: money(shift.openingFloat), cashNet: payments.cashNet, countedCash: input.countedCash });
    await tx.posShift.update({
      where: { id: shiftId },
      data: { status: 'CLOSED', closedAt: new Date(), closedBy: actor, countedCash: input.countedCash, expectedCash: cash.expectedCash, variance: cash.variance, note: input.note ?? null },
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'PosShift',
      entityId: shiftId,
      action: 'UPDATE',
      before: { status: 'OPEN' },
      after: { status: 'CLOSED', openingFloat: money(shift.openingFloat), cashNet: payments.cashNet, expectedCash: cash.expectedCash, countedCash: input.countedCash, variance: cash.variance, by: actor },
    });
    await stage('pos.shift.changed', { hotelId, shiftId, change: 'CLOSED' });
    const alert = varianceNeedsAlert(cash.variance, settings.cashVarianceAlert);
    if (alert) {
      const short = toDecimal(cash.variance).isNegative();
      await raiseStaffAlert(tx, stage, {
        hotelId,
        kind: 'POS',
        severity: 'WARNING',
        title: `Kasa ${short ? 'açığı' : 'fazlası'}: ${shift.waiterEmail} — ${cash.variance} ${currency}`.slice(0, 200),
        body: `Beklenen ${cash.expectedCash}, sayılan ${input.countedCash} ${currency} (uyarı eşiği ${settings.cashVarianceAlert}).${input.note ? ` Not: ${input.note}` : ''}`.slice(0, 1000),
        link: `/pos/vardiyalar/${shiftId}`,
        permission: PERMISSIONS.POS_SUPERVISE,
        entityType: 'PosShift',
        entityId: shiftId,
        dedupeKey: `pos-variance:${shiftId}`,
      });
    }
    return { alert };
  });
  return { shift: await getShift(hotelId, shiftId, { canSeeAll: true }), varianceAlert: outcome.alert };
}

/* ══════════════════ Rapor ══════════════════ */

/**
 * Garson vardiya raporu: vardiyanın kapanmış adisyonları (devirle gelenler dahil; devredilen
 * hariç), kişi, satış, vergi; indirim / ikram / iptal / zayi; tahsilat (yöntem bazında,
 * iptaller düşülmüş); odaya yazılan; kasa (avans, beklenen, sayılan, fark); en çok satanlar.
 *
 * @param {string} hotelId
 * @param {string} shiftId
 * @param {{ canSeeAll: boolean }} access
 */
export async function shiftReport(hotelId, shiftId, access) {
  const [shift, { currency }] = await Promise.all([getShift(hotelId, shiftId, access), hotelContext(hotelId)]);
  const [totals, waste, rooms, items, voidedChecks] = await Promise.all([
    prisma.posCheck.aggregate({
      where: { hotelId, shiftId, status: 'CLOSED' },
      _count: { _all: true },
      _sum: { covers: true, subtotal: true, discountTotal: true, compTotal: true, voidTotal: true, netTotal: true, taxTotal: true, grandTotal: true },
    }),
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS "count", COALESCE(SUM(a."value"), 0)::text AS "value"
      FROM "PosAdjustment" a JOIN "PosCheck" c ON c."id" = a."checkId"
      WHERE c."hotelId" = ${hotelId} AND c."shiftId" = ${shiftId} AND c."status" = 'CLOSED'
        AND a."kind" = 'VOID' AND a."status" = 'APPLIED' AND a."waste" = true`,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS "count", COALESCE(SUM(r."amount"), 0)::text AS "amount"
      FROM "PosRoomCharge" r JOIN "PosCheck" c ON c."id" = r."checkId"
      WHERE c."hotelId" = ${hotelId} AND c."shiftId" = ${shiftId}`,
    prisma.$queryRaw`
      SELECT l."menuItemId", l."name",
             SUM(l."quantity" - l."voidedQuantity" - l."compedQuantity")::int AS "quantity",
             SUM((l."quantity" - l."voidedQuantity" - l."compedQuantity") * l."unitPrice")::text AS "amount"
      FROM "PosOrderLine" l JOIN "PosCheck" c ON c."id" = l."checkId"
      WHERE c."hotelId" = ${hotelId} AND c."shiftId" = ${shiftId} AND c."status" = 'CLOSED'
      GROUP BY 1, 2
      HAVING SUM(l."quantity" - l."voidedQuantity" - l."compedQuantity") > 0
      ORDER BY SUM((l."quantity" - l."voidedQuantity" - l."compedQuantity") * l."unitPrice") DESC, 2
      LIMIT ${TOP_ITEMS}`,
    prisma.posCheck.count({ where: { hotelId, shiftId, status: 'VOID' } }),
  ]);
  const sum = totals._sum;
  const checks = totals._count._all;
  const grand = toDecimal(String(sum.grandTotal ?? 0));
  const covers = sum.covers ?? 0;
  return {
    currency,
    shift,
    sales: {
      checks,
      voidedChecks,
      covers,
      subtotal: money(sum.subtotal ?? 0),
      discountTotal: money(sum.discountTotal ?? 0),
      compTotal: money(sum.compTotal ?? 0),
      voidTotal: money(sum.voidTotal ?? 0),
      wasteTotal: money(waste[0].value),
      wasteCount: waste[0].count,
      netTotal: money(sum.netTotal ?? 0),
      taxTotal: money(sum.taxTotal ?? 0),
      grandTotal: toMoneyString(grand),
      averageCheck: checks ? toMoneyString(grand.dividedBy(checks)) : '0.00',
      averageCover: covers ? toMoneyString(grand.dividedBy(covers)) : '0.00',
    },
    roomCharges: { count: rooms[0].count, amount: money(rooms[0].amount) },
    topItems: items.map((item) => ({ menuItemId: item.menuItemId, name: item.name, quantity: item.quantity, amount: money(item.amount) })),
  };
}

/**
 * Vardiyası olmayan garsonun "devret" listesi için açık vardiyalar (garson adıyla).
 * Bir otelde aynı anda açık vardiya sayısı garson sayısıyla sınırlıdır.
 * @param {string} hotelId
 */
export async function openShiftWaiters(hotelId) {
  const rows = await prisma.posShift.findMany({
    where: { hotelId, status: 'OPEN' },
    orderBy: [{ waiterEmail: 'asc' }],
    take: 500,
    select: { id: true, waiterEmail: true, openedAt: true, outlet: { select: { name: true } } },
  });
  // Adlar tek sorguda (garson başına sorgu yok).
  const staff = rows.length
    ? await prismaUnfiltered.user.findMany({ where: { hotelId, email: { in: rows.map((row) => row.waiterEmail) } }, select: { email: true, name: true } })
    : [];
  const names = new Map(staff.map((user) => [user.email.toLowerCase(), user.name]));
  return {
    waiters: rows.map((row) => ({
      shiftId: row.id,
      waiterEmail: row.waiterEmail,
      name: names.get(row.waiterEmail) ?? row.waiterEmail,
      openedAt: iso(row.openedAt),
      outletName: row.outlet?.name ?? null,
    })),
  };
}
