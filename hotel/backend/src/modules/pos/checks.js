import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { currentActor, toDecimal, toMoneyString } from '@hotelos/core';
import {
  APPROVAL_TYPE_LABELS,
  MAX_CHECK_LINES,
  MAX_COVERS,
  MAX_POS_OUTLETS,
  POS_ADJUSTMENT_KIND_LABELS,
  tableState,
} from '@hotelos/hotel-contracts';
import { prismaUnfiltered } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, ForbiddenError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockPosChecks, lockPosShifts } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { findActiveStaffByEmail } from '../../lib/staff.js';
import { writeWithEvents } from '../../lib/write.js';
import { requestApproval } from '../approvals/service.js';
import { chargePostingStatus } from '../extras/posting-status.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { getActiveTaxes, getHotelSettings } from '../settings/service.js';
import { adjustmentNeedsApproval, adjustmentValue, checkBalance, checkTotals, lineFreeQuantity, splitPlan } from './rules.js';
import { dateOnly, day, hotelContext, iso, loadPosSettings, money, nextCheckNumber, prisma, recomputeCheckTotals, requireOpenShift } from './shared.js';

/**
 * Adisyon servisi (modül 39).
 *
 * ### Akış
 *
 * Garson açık vardiyasıyla adisyon açar (masada ya da masasız). "Gönder" bir **sipariş
 * turu** oluşturur: kalemler ürünün o anki adını, fiyatını, vergi kategorisini ve
 * istasyonunu kopyalar; mutfak ekranı (modül 40) turu `pos.order.sent` ile alır. Gönderilmiş
 * kalem silinmez: **iptal** (zayi işaretiyle), **ikram** ve adisyona **indirim** düzeltme
 * kaydıdır, şef garson yetkisi ister; değeri politikadaki eşiğe eşit / üstündeyse dört göz
 * onaya gider ve karar gelene kadar adisyon ödenemez. Bakiye sıfırlanınca adisyon kapanır.
 *
 * ### Kilit ve sürüm
 *
 * vardiya → adisyon (birden fazlası kimlik sırasıyla). Toplamlar adisyon kilidi altında
 * kalemlerden yeniden yazılır; ödeme toplamı ham SQL'le (sürüm damgası ilerlemez).
 * Bölme, birleştirme, taşıma, devir, kapatma ekranın gördüğü sürümle yapılır.
 */

/** Adisyon ekranında listelenen en fazla ödeme / düzeltme (bir adisyonda bu kadar olmaz). */
const DETAIL_LIMIT = 200;
/** Numara aramasında en kısa parça (trigram index'i üç karakterle çalışır). */
const MIN_NUMBER_SEARCH = 3;

const CHECK_SUMMARY_SELECT = Object.freeze({
  id: true,
  number: true,
  status: true,
  outletId: true,
  tableId: true,
  covers: true,
  waiterEmail: true,
  openedAt: true,
  billRequestedAt: true,
  closedAt: true,
  grandTotal: true,
  paidTotal: true,
  roomChargeTotal: true,
  updatedAt: true,
});

/* ══════════════════ Biçim ══════════════════ */

/** @param {any} row */
function checkSummary(row) {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    outletId: row.outletId,
    tableId: row.tableId,
    tableName: row.table?.name ?? null,
    outletName: row.outlet?.name ?? null,
    covers: row.covers,
    waiterEmail: row.waiterEmail,
    openedAt: iso(row.openedAt),
    billRequestedAt: iso(row.billRequestedAt),
    closedAt: iso(row.closedAt),
    grandTotal: money(row.grandTotal),
    paidTotal: money(row.paidTotal),
    roomChargeTotal: money(row.roomChargeTotal),
    balance: checkBalance({ grandTotal: String(row.grandTotal), paidTotal: String(row.paidTotal), roomChargeTotal: String(row.roomChargeTotal) }),
    updatedAt: iso(row.updatedAt),
  };
}

/**
 * Kilitli adisyon (sürüm verildiyse denetlenir).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} checkId
 * @param {{ expectedUpdatedAt?: Date | null, open?: boolean }} [options] `open`: açık olmalı
 */
export async function lockedCheck(tx, hotelId, checkId, { expectedUpdatedAt = null, open = true } = {}) {
  await lockPosChecks(tx, hotelId, [checkId]);
  const check = await tx.posCheck.findFirst({
    where: { id: checkId, hotelId },
    select: {
      ...CHECK_SUMMARY_SELECT,
      shiftId: true,
      subtotal: true,
      discountTotal: true,
      businessDate: true,
      outlet: { select: { id: true, name: true, allowRoomCharge: true, isActive: true } },
      table: { select: { name: true } },
    },
  });
  if (!check) throw new NotFoundError('Adisyon bulunamadı');
  if (expectedUpdatedAt && check.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError('Adisyon siz bakarken değişti; ekran yenilendi, tekrar deneyin.');
  if (open && check.status !== 'OPEN') throw new ConflictError(check.status === 'CLOSED' ? 'Adisyon kapanmış' : 'Adisyon iptal edilmiş', 'CHECK_CLOSED');
  return check;
}

/**
 * Onay bekleyen işler: düzeltmeler (adet, kalem başına), tahsilatlar (tutar) ve ödeme iptalleri.
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} checkId
 */
export async function pendingState(client, checkId) {
  const [adjustments, payments, voids] = await Promise.all([
    client.posAdjustment.findMany({ where: { checkId, status: 'PENDING' }, select: { kind: true, lineId: true, quantity: true } }),
    client.posPayment.aggregate({ where: { checkId, status: 'PENDING' }, _sum: { amount: true }, _count: { _all: true } }),
    client.posPayment.count({ where: { checkId, voidRequestedAt: { not: null } } }),
  ]);
  const byLine = new Map();
  for (const entry of adjustments) if (entry.lineId) byLine.set(entry.lineId, (byLine.get(entry.lineId) ?? 0) + (entry.quantity ?? 0));
  return {
    adjustments: adjustments.length,
    discounts: adjustments.filter((entry) => entry.kind === 'DISCOUNT').length,
    byLine,
    payments: payments._count._all,
    pendingPaid: money(payments._sum.amount ?? 0),
    voids,
  };
}

/**
 * Bakiye sıfırlandıysa ve bekleyen iş yoksa adisyonu kapatır (adisyon kilitliyken).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Function} stage
 * @param {{ hotelId: string, checkId: string, today: string }} input
 * @returns {Promise<boolean>} kapandı mı
 */
export async function closeIfSettled(tx, stage, { hotelId, checkId, today }) {
  const check = await tx.posCheck.findFirst({
    where: { id: checkId, hotelId },
    select: { id: true, status: true, outletId: true, tableId: true, grandTotal: true, paidTotal: true, roomChargeTotal: true, _count: { select: { lines: true } } },
  });
  if (check.status !== 'OPEN' || check._count.lines === 0) return false;
  const balance = toDecimal(checkBalance({ grandTotal: String(check.grandTotal), paidTotal: String(check.paidTotal), roomChargeTotal: String(check.roomChargeTotal) }));
  if (!balance.isZero()) return false;
  const pending = await pendingState(tx, checkId);
  if (pending.adjustments || pending.payments || pending.voids) return false;
  const actor = currentActor();
  const closedAt = new Date();
  const closed = await tx.posCheck.update({
    where: { id: checkId },
    data: { status: 'CLOSED', closedAt, closedBy: actor, businessDate: dateOnly(today), billRequestedAt: null },
    select: { number: true },
  });
  // Kalemler kapanış gününü taşır: ürün satış raporu adisyona dönmeden gün aralığıyla okur.
  await tx.posOrderLine.updateMany({ where: { checkId }, data: { businessDate: dateOnly(today) } });
  await recordAudit(tx, { hotelId, entity: 'PosCheck', entityId: checkId, action: 'UPDATE', before: { status: 'OPEN' }, after: { status: 'CLOSED', grandTotal: money(check.grandTotal), by: actor } });
  await stage('pos.check.changed', { hotelId, checkId, outletId: check.outletId, tableId: check.tableId, change: 'CLOSED' });
  await stage('fnb.order.paid', {
    hotelId,
    checkId,
    outletId: check.outletId,
    number: closed.number,
    businessDate: today,
    closedAt: closedAt.toISOString(),
    grandTotal: money(check.grandTotal),
    items: await soldItems(tx, checkId),
  });
  return true;
}

/**
 * Kapanan adisyonun ürün başına satılan / ikram / zayi adetleri (stok düşümü için): zayi,
 * uygulanmış "hazırlandı" işaretli iptaller; hazırlanmadan iptal edilen düşülmez.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} checkId
 */
async function soldItems(tx, checkId) {
  const [lines, waste] = await Promise.all([
    tx.posOrderLine.findMany({ where: { checkId }, select: { id: true, menuItemId: true, name: true, quantity: true, voidedQuantity: true, compedQuantity: true } }),
    tx.posAdjustment.findMany({ where: { checkId, kind: 'VOID', status: 'APPLIED', waste: true }, select: { lineId: true, quantity: true } }),
  ]);
  const wastedByLine = new Map();
  for (const entry of waste) wastedByLine.set(entry.lineId, (wastedByLine.get(entry.lineId) ?? 0) + entry.quantity);
  const items = new Map();
  for (const line of lines) {
    const entry = items.get(line.menuItemId) ?? { menuItemId: line.menuItemId, name: line.name, sold: 0, comped: 0, wasted: 0 };
    entry.sold += line.quantity - line.voidedQuantity - line.compedQuantity;
    entry.comped += line.compedQuantity;
    entry.wasted += Math.min(line.voidedQuantity, wastedByLine.get(line.id) ?? 0);
    items.set(line.menuItemId, entry);
  }
  return [...items.values()].filter((entry) => entry.sold + entry.comped + entry.wasted > 0);
}

/**
 * İsteyen personelin ziline onay sonucu (kişi bulunamazsa şef garson yetkilisine).
 * @param {string} hotelId
 * @param {{ id: string, type: string, requestedBy: string, note: string | null, summary: string }} approval
 * @param {string} outcome 'GRANTED' | 'FAILED' | 'approval.denied' | 'approval.expired'
 * @param {string} checkId
 * @param {string | null} [failure] onaylandı ama uygulanamadıysa sebebi
 */
export async function alertRequester(hotelId, approval, outcome, checkId, failure = null) {
  const staff = approval.requestedBy?.includes('@') ? await findActiveStaffByEmail(prismaUnfiltered, hotelId, approval.requestedBy.toLowerCase()) : null;
  const label = APPROVAL_TYPE_LABELS[approval.type] ?? 'Onay';
  const titles = {
    GRANTED: `${label} onaylandı: ${approval.summary}`,
    FAILED: `${label} onaylandı ama uygulanamadı: ${approval.summary}`,
    'approval.denied': `${label} reddedildi: ${approval.summary}`,
    'approval.expired': `${label} onayının süresi doldu: ${approval.summary}`,
  };
  const body = outcome === 'FAILED' ? failure : outcome === 'approval.denied' ? `Gerekçe: ${approval.note ?? '—'}. İşlem uygulanmadı.` : outcome === 'approval.expired' ? 'İşlem uygulanmadı; gerekiyorsa yeniden isteyin.' : null;
  await writeWithEvents((tx, stage) =>
    raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'APPROVAL_DECIDED',
      severity: outcome === 'GRANTED' ? 'INFO' : 'WARNING',
      title: (titles[outcome] ?? approval.summary).slice(0, 200),
      body,
      link: `/pos/adisyon/${checkId}`,
      userId: staff?.id ?? null,
      permission: staff ? null : PERMISSIONS.POS_SUPERVISE,
      entityType: 'Approval',
      entityId: approval.id,
      dedupeKey: `approval-decided:${approval.id}`,
    }),
  );
}

/* ══════════════════ Okuma ══════════════════ */

/**
 * Adisyon ekranı: başlık, turlar, kalemler (serbest / iptal / ikram adetleri), düzeltmeler,
 * ödemeler, odaya yazılanlar (folyoya işlendi mi), toplamlar ve vergi dökümü, bakiye, onay
 * bekleyenler.
 *
 * @param {string} hotelId
 * @param {string} checkId
 */
export async function getCheck(hotelId, checkId) {
  const row = await prisma.posCheck.findFirst({
    where: { id: checkId, hotelId },
    select: {
      ...CHECK_SUMMARY_SELECT,
      shiftId: true,
      note: true,
      openedBy: true,
      closedBy: true,
      businessDate: true,
      voidedAt: true,
      voidedBy: true,
      reopenedAt: true,
      reopenedBy: true,
      reopenReason: true,
      splitFromId: true,
      subtotal: true,
      compTotal: true,
      voidTotal: true,
      discountPct: true,
      discountTotal: true,
      netTotal: true,
      taxTotal: true,
      outlet: { select: { id: true, code: true, name: true, allowRoomCharge: true } },
      table: { select: { id: true, name: true } },
      splitFrom: { select: { id: true, number: true } },
      orders: { orderBy: { seq: 'asc' }, select: { id: true, seq: true, status: true, sentAt: true, sentBy: true } },
      lines: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          orderId: true,
          menuItemId: true,
          name: true,
          station: true,
          taxCategory: true,
          unitPrice: true,
          quantity: true,
          voidedQuantity: true,
          compedQuantity: true,
          note: true,
          order: { select: { id: true, seq: true, status: true, sentAt: true, sentBy: true } },
        },
      },
      adjustments: {
        orderBy: { requestedAt: 'desc' },
        take: DETAIL_LIMIT,
        select: { id: true, kind: true, lineId: true, quantity: true, waste: true, discountPct: true, discountAmount: true, value: true, reason: true, status: true, requestedBy: true, requestedAt: true, approvalId: true, decidedAt: true, decidedBy: true, supersededAt: true },
      },
      payments: {
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        take: DETAIL_LIMIT,
        select: { id: true, kind: true, status: true, method: true, amount: true, reference: true, receivedBy: true, receivedAt: true, approvalId: true, reversalOfId: true, voidedAt: true, voidReason: true, voidRequestedAt: true, shiftId: true },
      },
      roomCharges: { orderBy: { chargedAt: 'desc' }, take: DETAIL_LIMIT, select: { id: true, reservationId: true, roomNumber: true, guestName: true, amount: true, eventId: true, chargedBy: true, chargedAt: true } },
    },
  });
  if (!row) throw new NotFoundError('Adisyon bulunamadı');
  const [taxes, posting, hotel] = await Promise.all([
    getActiveTaxes(hotelId),
    chargePostingStatus(hotelId, row.roomCharges.map((charge) => charge.eventId)),
    getHotelSettings(hotelId),
  ]);
  const appliedDiscount = row.adjustments.find((entry) => entry.kind === 'DISCOUNT' && entry.status === 'APPLIED' && !entry.supersededAt);
  const totals = checkTotals({
    lines: row.lines.map((line) => ({ ...line, unitPrice: String(line.unitPrice) })),
    discountPct: appliedDiscount?.discountPct ? String(appliedDiscount.discountPct) : null,
    discountAmount: appliedDiscount?.discountAmount ? String(appliedDiscount.discountAmount) : null,
    taxes,
  });
  const pendingByLine = new Map();
  for (const entry of row.adjustments) if (entry.status === 'PENDING' && entry.lineId) pendingByLine.set(entry.lineId, (pendingByLine.get(entry.lineId) ?? 0) + (entry.quantity ?? 0));

  return {
    ...checkSummary(row),
    currency: hotel.currency,
    shiftId: row.shiftId,
    note: row.note,
    outlet: row.outlet,
    table: row.table,
    openedBy: row.openedBy,
    closedBy: row.closedBy,
    businessDate: day(row.businessDate),
    voidedAt: iso(row.voidedAt),
    voidedBy: row.voidedBy,
    reopenedAt: iso(row.reopenedAt),
    reopenedBy: row.reopenedBy,
    reopenReason: row.reopenReason,
    splitFrom: row.splitFrom,
    totals: {
      subtotal: money(row.subtotal),
      compTotal: money(row.compTotal),
      voidTotal: money(row.voidTotal),
      discountPct: row.discountPct === null ? null : toDecimal(String(row.discountPct)).toString(),
      discountTotal: money(row.discountTotal),
      netTotal: money(row.netTotal),
      taxTotal: money(row.taxTotal),
      grandTotal: money(row.grandTotal),
      taxes: totals.taxes,
    },
    orders: [...new Map([...row.orders, ...row.lines.map((line) => line.order)].map((order) => [order.id, order])).values()]
      .sort((a, b) => a.sentAt - b.sentAt || a.seq - b.seq)
      .map((order) => ({ ...order, sentAt: iso(order.sentAt) })),
    lines: row.lines.map((line) => ({
      id: line.id,
      orderId: line.orderId,
      orderSeq: line.order.seq,
      menuItemId: line.menuItemId,
      name: line.name,
      station: line.station,
      unitPrice: money(line.unitPrice),
      quantity: line.quantity,
      voidedQuantity: line.voidedQuantity,
      compedQuantity: line.compedQuantity,
      pendingQuantity: pendingByLine.get(line.id) ?? 0,
      freeQuantity: lineFreeQuantity(line, pendingByLine.get(line.id) ?? 0),
      total: toMoneyString(toDecimal(String(line.unitPrice)).times(line.quantity - line.voidedQuantity - line.compedQuantity)),
      note: line.note,
    })),
    adjustments: row.adjustments.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      kindLabel: POS_ADJUSTMENT_KIND_LABELS[entry.kind],
      lineId: entry.lineId,
      quantity: entry.quantity,
      waste: entry.waste,
      discountPct: entry.discountPct === null ? null : toDecimal(String(entry.discountPct)).toString(),
      discountAmount: entry.discountAmount === null ? null : money(entry.discountAmount),
      value: money(entry.value),
      reason: entry.reason,
      status: entry.status,
      requestedBy: entry.requestedBy,
      requestedAt: iso(entry.requestedAt),
      approvalId: entry.approvalId,
      decidedAt: iso(entry.decidedAt),
      decidedBy: entry.decidedBy,
      superseded: Boolean(entry.supersededAt),
    })),
    payments: row.payments.map((payment) => ({
      id: payment.id,
      kind: payment.kind,
      status: payment.status,
      method: payment.method,
      amount: money(payment.amount),
      reference: payment.reference,
      receivedBy: payment.receivedBy,
      receivedAt: iso(payment.receivedAt),
      approvalId: payment.approvalId,
      reversalOfId: payment.reversalOfId,
      voided: Boolean(payment.voidedAt),
      voidReason: payment.voidReason,
      voidPending: Boolean(payment.voidRequestedAt),
      shiftId: payment.shiftId,
    })),
    roomCharges: row.roomCharges.map((charge) => ({
      id: charge.id,
      reservationId: charge.reservationId,
      roomNumber: charge.roomNumber,
      guestName: charge.guestName,
      amount: money(charge.amount),
      chargedBy: charge.chargedBy,
      chargedAt: iso(charge.chargedAt),
      posting: posting.get(charge.eventId) ?? { status: 'PENDING' },
    })),
    pending: {
      adjustments: row.adjustments.filter((entry) => entry.status === 'PENDING').length,
      payments: row.payments.filter((payment) => payment.status === 'PENDING').length,
      voids: row.payments.filter((payment) => payment.voidRequestedAt).length,
    },
  };
}

/**
 * Adisyon listesi (sayfalı; kapanmış adisyon araması, rapor): durum, satış noktası, garson,
 * numara / masa araması, gün aralığı (kapanış iş günü — verilirse yalnız kapanmışlar gelir;
 * açık adisyonlar masa planındadır). En yeni açılan önce.
 * @param {string} hotelId
 * @param {any} query `posCheckListQuerySchema`
 */
export async function listChecks(hotelId, query) {
  const { currency } = await hotelContext(hotelId);
  const and = [];
  if (query.status) and.push({ status: query.status });
  if (query.outletId) and.push({ outletId: query.outletId });
  if (query.waiterEmail) and.push({ waiterEmail: query.waiterEmail });
  if (query.from) and.push({ businessDate: { gte: dateOnly(day(query.from)) } });
  if (query.to) and.push({ businessDate: { lte: dateOnly(day(query.to)) } });
  const search = query.search?.trim();
  if (search) {
    const found = await searchCheckIds(hotelId, query, search);
    const rows = found.ids.length
      ? await prisma.posCheck.findMany({ where: { hotelId, id: { in: found.ids } }, select: { ...CHECK_SUMMARY_SELECT, table: { select: { name: true } }, outlet: { select: { name: true } } } })
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const page = buildPage(found.ids.map((id) => checkSummary(byId.get(id))), found.total, query);
    return { ...page, meta: { ...page.meta, currency } };
  }
  const where = { hotelId, ...(and.length ? { AND: and } : {}) };
  const [rows, total] = await Promise.all([
    prisma.posCheck.findMany({
      where,
      orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
      ...toSkipTake(query),
      select: { ...CHECK_SUMMARY_SELECT, table: { select: { name: true } }, outlet: { select: { name: true } } },
    }),
    prisma.posCheck.count({ where }),
  ]);
  const page = buildPage(rows.map(checkSummary), total, query);
  return { ...page, meta: { ...page.meta, currency } };
}

/**
 * Aramalı adisyon listesinin sayfası: numara parçası (en az 3 karakter; trigram index'i) ya da masa
 * adı (birebir; `(tableId, openedAt)` index'i). Eşleşenler önce ayrı hesaplanır (MATERIALIZED):
 * "en yeni önce + ilk 25" sıralaması planlayıcıyı tarih index'iyle bütün geçmişi taramaya
 * itmesin; eşleşme kümesi iki index'in birleşimiyle bulunup yalnızca o sıralanır.
 *
 * @param {string} hotelId
 * @param {any} query süzgeçler ve sayfa
 * @param {string} search
 * @returns {Promise<{ ids: string[], total: number }>}
 */
async function searchCheckIds(hotelId, query, search) {
  // Masa adı birebir (büyük / küçük harf duyarsız). Prisma'nın duyarsız `equals`'ı ILIKE'tır: `%` ve `_` joker
  // olurdu ("%_" her masayı eşlerdi); karşılaştırma jokersiz yapılır.
  const tables = await prisma.$queryRaw`SELECT "id" FROM "PosTable" WHERE "hotelId" = ${hotelId} AND lower("name") = lower(${search}) LIMIT ${MAX_POS_OUTLETS}`;
  const tableIds = tables.map((table) => table.id);
  const like = search.length >= MIN_NUMBER_SEARCH ? `%${search.toUpperCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%` : null;
  if (!like && !tableIds.length) return { ids: [], total: 0 };
  const match = [...(like ? [Prisma.sql`"number" LIKE ${like}`] : []), ...(tableIds.length ? [Prisma.sql`"tableId" = ANY(${tableIds}::text[])`] : [])];
  const filters = [Prisma.sql`"hotelId" = ${hotelId}`, Prisma.sql`(${Prisma.join(match, ' OR ')})`];
  if (query.status) filters.push(Prisma.sql`"status" = ${query.status}::"PosCheckStatus"`);
  if (query.outletId) filters.push(Prisma.sql`"outletId" = ${query.outletId}`);
  if (query.waiterEmail) filters.push(Prisma.sql`"waiterEmail" = ${query.waiterEmail}`);
  if (query.from) filters.push(Prisma.sql`"businessDate" >= ${day(query.from)}::date`);
  if (query.to) filters.push(Prisma.sql`"businessDate" <= ${day(query.to)}::date`);
  const hits = Prisma.sql`WITH hits AS MATERIALIZED (SELECT "id", "openedAt" FROM "PosCheck" WHERE ${Prisma.join(filters, ' AND ')})`;
  const { skip, take } = toSkipTake(query);
  const [rows, [{ total }]] = await Promise.all([
    prisma.$queryRaw`${hits} SELECT "id" FROM hits ORDER BY "openedAt" DESC, "id" DESC LIMIT ${take} OFFSET ${skip}`,
    prisma.$queryRaw`${hits} SELECT COUNT(*)::int AS "total" FROM hits`,
  ]);
  return { ids: rows.map((row) => row.id), total };
}

/**
 * Masa planı: satış noktasının masaları (durum: boş / dolu / hesap istiyor) ve açık
 * adisyonları; masasız açık adisyonlar ayrıca. İki sorgu (N+1 yok).
 *
 * @param {string} hotelId
 * @param {string} outletId
 */
export async function getFloor(hotelId, outletId) {
  const [outlet, tables, checks, hotel] = await Promise.all([
    prisma.posOutlet.findFirst({ where: { id: outletId, hotelId }, select: { id: true, name: true, allowRoomCharge: true, isActive: true } }),
    prisma.posTable.findMany({ where: { hotelId, outletId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, seats: true, zone: true } }),
    prisma.posCheck.findMany({
      where: { hotelId, outletId, status: 'OPEN' },
      orderBy: { openedAt: 'asc' },
      select: { ...CHECK_SUMMARY_SELECT, table: { select: { name: true } } },
    }),
    getHotelSettings(hotelId),
  ]);
  if (!outlet) throw new NotFoundError('Satış noktası bulunamadı');
  const summaries = checks.map(checkSummary);
  return {
    outlet,
    currency: hotel.currency,
    tables: tables.map((table) => {
      const open = summaries.filter((check) => check.tableId === table.id);
      return { ...table, state: tableState(open), checks: open };
    }),
    tableless: summaries.filter((check) => !check.tableId),
  };
}

/* ══════════════════ Açma ve düzenleme ══════════════════ */

/**
 * Adisyon açar (açan garsonun açık vardiyasına). İstek kimliği tekrar gelirse aynı adisyon.
 * @param {string} hotelId
 * @param {any} input `openPosCheckSchema`
 */
export async function openCheck(hotelId, input) {
  const actor = currentActor();
  const { today } = await hotelContext(hotelId);
  const sourceKey = `check:${input.requestId}`;
  let checkId;
  try {
    checkId = await writeWithEvents(async (tx, stage) => {
      const existing = await tx.posCheck.findFirst({ where: { hotelId, sourceKey }, select: { id: true } });
      if (existing) return existing.id;
      const shift = await requireOpenShift(tx, hotelId, actor);
      const outlet = await tx.posOutlet.findFirst({ where: { id: input.outletId, hotelId }, select: { id: true, isActive: true } });
      if (!outlet || !outlet.isActive) throw new ValidationError('Satış noktası bulunamadı ya da kapalı', { field: 'outletId' });
      if (input.tableId) {
        const table = await tx.posTable.findFirst({ where: { id: input.tableId, hotelId }, select: { outletId: true, isActive: true } });
        if (!table || table.outletId !== outlet.id || !table.isActive) throw new ValidationError('Masa bu satış noktasında değil ya da kapalı', { field: 'tableId' });
      }
      const number = await nextCheckNumber(tx, hotelId, Number(today.slice(0, 4)));
      const row = await tx.posCheck.create({
        data: {
          hotelId,
          outletId: outlet.id,
          tableId: input.tableId ?? null,
          number,
          covers: input.covers,
          note: input.note ?? null,
          waiterEmail: actor,
          shiftId: shift.id,
          sourceKey,
          openedBy: actor,
        },
        select: { id: true, tableId: true },
      });
      await recordAudit(tx, { hotelId, entity: 'PosCheck', entityId: row.id, action: 'CREATE', after: { number, outletId: outlet.id, tableId: row.tableId, covers: input.covers } });
      await stage('pos.check.changed', { hotelId, checkId: row.id, outletId: outlet.id, tableId: row.tableId, change: 'OPENED' });
      return row.id;
    });
  } catch (error) {
    // Aynı istek aynı anda iki kez geldi (çift dokunuş, ağ tekrarı): kazananın adisyonu.
    const winner = isDuplicateSource(error) ? await prisma.posCheck.findFirst({ where: { hotelId, sourceKey }, select: { id: true } }) : null;
    if (!winner) rethrowPrismaError(error);
    checkId = winner.id;
  }
  return getCheck(hotelId, checkId);
}

/** İstek anahtarı (`sourceKey`) tekilliğine takılan eşzamanlı tekrar mı? @param {any} error */
function isDuplicateSource(error) {
  return error?.code === 'P2002' && String(error.meta?.target ?? '').includes('sourceKey');
}

/** Kişi sayısı, not. @param {string} hotelId @param {string} checkId @param {any} input `updatePosCheckSchema` */
export async function updateCheck(hotelId, checkId, input) {
  await writeWithEvents(async (tx, stage) => {
    const check = await lockedCheck(tx, hotelId, checkId, { expectedUpdatedAt: input.expectedUpdatedAt });
    await tx.posCheck.update({ where: { id: checkId }, data: { covers: input.covers, note: input.note ?? null } });
    await recordAudit(tx, { hotelId, entity: 'PosCheck', entityId: checkId, action: 'UPDATE', before: { covers: check.covers }, after: { covers: input.covers, note: input.note ?? null } });
    await stage('pos.check.changed', { hotelId, checkId, outletId: check.outletId, tableId: check.tableId, change: 'UPDATED' });
  });
  return getCheck(hotelId, checkId);
}

/**
 * Sipariş turu ("Gönder"): ürünler aktif, tükenmemiş ve bu satış noktasında satılıyor
 * olmalı. Kalemler ürünün o anki adını, fiyatını, vergi kategorisini ve istasyonunu kopyalar.
 * Hesap istenmişse yeni sipariş isteği geri alır. İstek kimliği tekrar gelirse ikinci tur açılmaz.
 *
 * @param {string} hotelId
 * @param {string} checkId
 * @param {any} input `sendPosOrderSchema`
 */
export async function sendOrder(hotelId, checkId, input) {
  const actor = currentActor();
  const sourceKey = `order:${input.requestId}`;
  try {
    await writeWithEvents(async (tx, stage) => {
      const sent = async () => {
        const existing = await tx.posOrder.findFirst({ where: { hotelId, sourceKey }, select: { checkId: true } });
        if (existing && existing.checkId !== checkId) throw new ConflictError('Bu istek başka bir adisyonda kullanıldı; ekranı yenileyin.', 'DUPLICATE_REQUEST');
        return Boolean(existing);
      };
      // Tur gönderildiyse (tekrar) adisyon bu arada kapanmış olsa da sonuç aynı ekrandır.
      if (await sent()) return;
      const check = await lockedCheck(tx, hotelId, checkId);
      // Aynı istek eşzamanlı geldiyse ikincisi kilidi bekledi: ilki turu yazdı.
      if (await sent()) return;
      const itemIds = [...new Set(input.lines.map((line) => line.menuItemId))];
      const items = await tx.menuItem.findMany({
        where: { hotelId, id: { in: itemIds } },
        select: { id: true, name: true, price: true, taxCategory: true, station: true, isActive: true, soldOut: true, category: { select: { isActive: true, outletIds: true } } },
      });
      const byId = new Map(items.map((item) => [item.id, item]));
      const fields = {};
      input.lines.forEach((line, index) => {
        const item = byId.get(line.menuItemId);
        if (!item) fields[`lines.${index}.menuItemId`] = 'Ürün bulunamadı';
        else if (!item.isActive || !item.category.isActive) fields[`lines.${index}.menuItemId`] = `${item.name} satıştan kalkmış`;
        else if (item.soldOut) fields[`lines.${index}.menuItemId`] = `${item.name} tükendi`;
        else if (item.category.outletIds.length && !item.category.outletIds.includes(check.outletId)) fields[`lines.${index}.menuItemId`] = `${item.name} bu satış noktasında satılmıyor`;
      });
      if (Object.keys(fields).length) throw new ValidationError(Object.values(fields)[0], { fields });
      const [lineCount, last] = await Promise.all([tx.posOrderLine.count({ where: { checkId } }), lastOrderSeq(tx, checkId)]);
      if (lineCount + input.lines.length > MAX_CHECK_LINES) throw new ConflictError(`Bir adisyonda en fazla ${MAX_CHECK_LINES} kalem olur; yeni adisyon açın.`, 'LIMIT');
      const orderId = randomUUID();
      const seq = last + 1;
      await tx.posOrder.create({ data: { id: orderId, hotelId, checkId, outletId: check.outletId, seq, sourceKey, sentBy: actor } });
      // Kalem kimlikleri burada üretilir: mutfağa giden iş olayı kalemleri kimliğiyle taşır.
      const lineIds = input.lines.map(() => randomUUID());
      await tx.posOrderLine.createMany({
        data: input.lines.map((line, index) => {
          const item = byId.get(line.menuItemId);
          return {
            id: lineIds[index],
            hotelId,
            checkId,
            orderId,
            menuItemId: item.id,
            name: item.name,
            station: item.station,
            taxCategory: item.taxCategory,
            unitPrice: money(item.price),
            quantity: line.quantity,
            note: line.note ?? null,
            sortOrder: lineCount + index,
          };
        }),
      });
      if (check.billRequestedAt) await tx.posCheck.update({ where: { id: checkId }, data: { billRequestedAt: null } });
      const totals = await recomputeCheckTotals(tx, hotelId, checkId);
      await recordAudit(tx, {
        hotelId,
        entity: 'PosOrder',
        entityId: orderId,
        action: 'CREATE',
        after: { check: check.number, lines: input.lines.map((line) => `${line.quantity} × ${byId.get(line.menuItemId).name}`).slice(0, 40), grandTotal: totals.grandTotal },
      });
      const stations = [...new Set(input.lines.map((line) => byId.get(line.menuItemId).station).filter((station) => station !== 'NONE'))];
      await stage('pos.order.sent', { hotelId, checkId, orderId, outletId: check.outletId, stations });
      await stage('fnb.order.placed', {
        hotelId,
        checkId,
        orderId,
        outletId: check.outletId,
        outletName: check.outlet.name,
        number: check.number,
        seq,
        tableName: check.table?.name ?? null,
        covers: check.covers,
        waiterEmail: check.waiterEmail,
        lines: input.lines.map((line, index) => {
          const item = byId.get(line.menuItemId);
          return { lineId: lineIds[index], menuItemId: item.id, name: item.name, quantity: line.quantity, station: item.station, note: line.note ?? null };
        }),
      });
      await stage('pos.check.changed', { hotelId, checkId, outletId: check.outletId, tableId: check.tableId, change: 'UPDATED' });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getCheck(hotelId, checkId);
}

/**
 * Hesap iste / geri al (masa planında "hesap istiyor").
 * @param {string} hotelId @param {string} checkId @param {{ requested: boolean }} input
 */
export async function requestBill(hotelId, checkId, { requested }) {
  await writeWithEvents(async (tx, stage) => {
    const check = await lockedCheck(tx, hotelId, checkId);
    if (requested && toDecimal(String(check.grandTotal)).isZero()) throw new ConflictError('Adisyonda ödenecek tutar yok (boş ya da tamamı ikram); adisyonu kapatın.', 'EMPTY_CHECK');
    await tx.posCheck.update({ where: { id: checkId }, data: { billRequestedAt: requested ? new Date() : null } });
    await stage('pos.check.changed', { hotelId, checkId, outletId: check.outletId, tableId: check.tableId, change: 'BILL' });
  });
  return getCheck(hotelId, checkId);
}

/* ══════════════════ Düzeltme ══════════════════ */

/**
 * Düzeltmeyi uygular (adisyon kilitliyken): kalemin iptal / ikram adedi ya da adisyonun
 * indirimi (önceki indirimin yerine geçer). Ödeme toplamı yeni toplamı aşıyorsa uygulanmaz.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {{ id?: string, kind: string, lineId: string | null, quantity: number | null }} adjustment
 * @param {string} checkId
 * @returns {Promise<string | null>} uygulanamadıysa sebebi
 */
async function applyAdjustment(tx, hotelId, adjustment, checkId) {
  if (adjustment.kind === 'DISCOUNT') {
    await tx.posAdjustment.updateMany({
      where: { checkId, kind: 'DISCOUNT', status: 'APPLIED', supersededAt: null, ...(adjustment.id ? { id: { not: adjustment.id } } : {}) },
      data: { supersededAt: new Date() },
    });
  } else {
    const field = adjustment.kind === 'VOID' ? 'voidedQuantity' : 'compedQuantity';
    await tx.posOrderLine.update({ where: { id: adjustment.lineId }, data: { [field]: { increment: adjustment.quantity } } });
  }
  const totals = await recomputeCheckTotals(tx, hotelId, checkId);
  const check = await tx.posCheck.findFirst({ where: { id: checkId }, select: { paidTotal: true, roomChargeTotal: true } });
  const settled = toDecimal(String(check.paidTotal)).plus(toDecimal(String(check.roomChargeTotal)));
  if (settled.greaterThan(toDecimal(totals.grandTotal))) return `Alınan ödeme (${money(settled)}) yeni toplamı (${totals.grandTotal}) aşıyor; önce ödemeyi iptal edin.`;
  return null;
}

/**
 * İkram / iptal / indirim (şef garson yetkisi, gerekçeli). Değer eşiğe eşit / üstündeyse dört
 * göz onaya gider (istek "onay bekliyor"); değilse hemen uygulanır. İptal edilen kalem
 * hazırlandıysa zayi işaretlenir.
 *
 * @param {string} hotelId
 * @param {string} checkId
 * @param {any} input `posAdjustmentSchema`
 */
export async function requestAdjustment(hotelId, checkId, input) {
  const actor = currentActor();
  const { hotel } = await hotelContext(hotelId);
  await writeWithEvents(async (tx, stage) => {
    const check = await lockedCheck(tx, hotelId, checkId);
    const [settings, pending] = await Promise.all([loadPosSettings(tx, hotelId), pendingState(tx, checkId)]);
    if (pending.payments) throw new ConflictError('Onay bekleyen ödeme var; karar gelmeden adisyon toplamı değiştirilmez.', 'PENDING_APPROVAL');
    let line = null;
    let value;
    if (input.kind === 'DISCOUNT') {
      if (toDecimal(String(check.subtotal)).isZero()) throw new ConflictError('İndirim uygulanacak tutar yok', 'EMPTY_CHECK');
      if (pending.discounts) throw new ConflictError('Onay bekleyen bir indirim var; karar gelmeden yenisi istenmez.', 'PENDING_ADJUSTMENT');
      value = adjustmentValue({ kind: 'DISCOUNT', subtotal: money(check.subtotal), discountPct: input.discountPct ?? null, discountAmount: input.discountAmount ?? null });
    } else {
      line = await tx.posOrderLine.findFirst({ where: { id: input.lineId, checkId }, select: { id: true, name: true, unitPrice: true, quantity: true, voidedQuantity: true, compedQuantity: true } });
      if (!line) throw new ValidationError('Kalem bu adisyonun değil', { field: 'lineId' });
      const free = lineFreeQuantity(line, pending.byLine.get(line.id) ?? 0);
      if (input.quantity > free) throw new ValidationError(free > 0 ? `En fazla ${free} adet` : 'Kalemin düzeltilecek adedi yok (iptal / ikram / onay bekleyen)', { field: 'quantity' });
      value = adjustmentValue({ kind: input.kind, unitPrice: money(line.unitPrice), quantity: input.quantity });
    }
    const needsApproval = adjustmentNeedsApproval(value, settings.adjustmentApprovalAmount);
    const id = randomUUID();
    const what =
      input.kind === 'DISCOUNT'
        ? `${POS_ADJUSTMENT_KIND_LABELS.DISCOUNT} ${input.discountPct ? `%${input.discountPct}` : money(input.discountAmount)}`
        : `${POS_ADJUSTMENT_KIND_LABELS[input.kind]} ${input.quantity} × ${line.name}${input.waste ? ' (zayi)' : ''}`;
    let approvalId = null;
    if (needsApproval) {
      ({ approvalId } = await requestApproval(tx, stage, {
        hotelId,
        type: 'POS_ADJUSTMENT',
        summary: `${what}: ${check.number} · ${check.outlet.name}${check.table ? ` masa ${check.table.name}` : ''} — ${money(value)} ${hotel.currency}`.slice(0, 200),
        reason: input.reason,
        amount: value,
        currency: hotel.currency,
        data: {
          Adisyon: `${check.number} · ${check.outlet.name}${check.table ? ` · masa ${check.table.name}` : ''}`,
          İşlem: what,
          Değer: `${money(value)} ${hotel.currency}`,
          'Adisyon toplamı': `${money(check.grandTotal)} ${hotel.currency}`,
          Garson: check.waiterEmail,
          İsteyen: actor,
        },
        entityType: 'PosAdjustment',
        entityId: id,
        requestedBy: actor,
      }));
    }
    await tx.posAdjustment.create({
      data: {
        id,
        hotelId,
        checkId,
        kind: input.kind,
        lineId: line?.id ?? null,
        quantity: input.kind === 'DISCOUNT' ? null : input.quantity,
        waste: input.kind === 'VOID' ? input.waste : false,
        discountPct: input.discountPct ?? null,
        discountAmount: input.discountAmount ?? null,
        value,
        reason: input.reason,
        status: needsApproval ? 'PENDING' : 'APPLIED',
        requestedBy: actor,
        approvalId,
      },
    });
    if (!needsApproval) {
      const blocked = await applyAdjustment(tx, hotelId, { id, kind: input.kind, lineId: line?.id ?? null, quantity: input.quantity ?? null }, checkId);
      if (blocked) throw new ConflictError(blocked, 'PAID_EXCEEDS_TOTAL');
    }
    await recordAudit(tx, {
      hotelId,
      entity: 'PosAdjustment',
      entityId: id,
      action: 'CREATE',
      after: { check: check.number, what, value, reason: input.reason, status: needsApproval ? 'PENDING' : 'APPLIED', approvalId },
    });
    await stage('pos.check.changed', { hotelId, checkId, outletId: check.outletId, tableId: check.tableId, change: 'ADJUSTED' });
  });
  return getCheck(hotelId, checkId);
}

export const POS_ADJUSTMENT_APPROVAL_TYPE = 'POS_ADJUSTMENT';

/**
 * Düzeltme onayının sonucu (servis dinleyicisi): onaylanınca uygulanır (adisyon hâlâ açık,
 * kalemde yeterli adet var ve ödeme yeni toplamı aşmıyorsa); reddedilir / süresi dolarsa
 * düşer. Aynı haber iki kez gelse de bir kez uygulanır.
 *
 * @param {{ hotelId: string, approvalId: string, type: string }} payload
 * @param {{ name: string }} envelope
 */
export async function applyAdjustmentDecision(payload, envelope) {
  if (payload.type !== POS_ADJUSTMENT_APPROVAL_TYPE) return { handled: false };
  const hotelId = payload.hotelId;
  const approval = await prismaUnfiltered.approval.findFirst({
    where: { id: payload.approvalId, hotelId },
    select: { id: true, type: true, entityId: true, requestedBy: true, decidedBy: true, note: true, summary: true },
  });
  if (!approval?.entityId) return { handled: false };
  const seed = await prisma.posAdjustment.findFirst({ where: { id: approval.entityId, hotelId }, select: { checkId: true } });
  if (!seed) return { handled: false };
  const granted = envelope.name === 'approval.granted';
  const outcomeName = envelope.name === 'approval.denied' ? 'DENIED' : 'EXPIRED';

  const outcome = await writeWithEvents(async (tx, stage) => {
    const check = await lockedCheck(tx, hotelId, seed.checkId, { open: false });
    const adjustment = await tx.posAdjustment.findFirst({ where: { id: approval.entityId }, select: { id: true, kind: true, lineId: true, quantity: true, status: true, approvalId: true } });
    if (adjustment.status !== 'PENDING' || adjustment.approvalId !== approval.id) return { stale: true };
    let failure = null;
    if (granted) {
      if (check.status !== 'OPEN') failure = 'Adisyon bu arada kapandı.';
      else if (adjustment.lineId) {
        const line = await tx.posOrderLine.findFirst({ where: { id: adjustment.lineId }, select: { checkId: true, quantity: true, voidedQuantity: true, compedQuantity: true } });
        if (line.checkId !== check.id || lineFreeQuantity(line) < adjustment.quantity) failure = 'Kalem bu arada değişti (başka adisyona taşındı ya da adedi kalmadı).';
      }
      if (!failure) {
        // Önce "uygulandı": indirimin yeniden hesabı yalnızca uygulanmış indirimi görür (yoksa eski
        // indirim düşer, yenisi sayılmaz ve adisyon indirimsiz kalırdı).
        await tx.posAdjustment.update({ where: { id: adjustment.id }, data: { status: 'APPLIED', decidedAt: new Date(), decidedBy: approval.decidedBy ?? currentActor() } });
        failure = await applyAdjustment(tx, hotelId, adjustment, check.id);
        // Uygulanamadıysa geri al: aynı transaction'da kalem / indirim / durum eski hâline döner.
        if (failure) throw new AdjustmentRollback(failure);
      }
    }
    const status = granted && !failure ? 'APPLIED' : 'DECLINED';
    if (status === 'DECLINED') {
      await tx.posAdjustment.update({ where: { id: adjustment.id }, data: { status, decidedAt: new Date(), decidedBy: approval.decidedBy ?? currentActor() } });
    }
    await recordAudit(tx, { hotelId, entity: 'PosAdjustment', entityId: adjustment.id, action: 'UPDATE', before: { status: 'PENDING' }, after: { status, outcome: granted ? (failure ?? 'GRANTED') : outcomeName, approvalId: approval.id } });
    await stage('pos.check.changed', { hotelId, checkId: check.id, outletId: check.outletId, tableId: check.tableId, change: 'ADJUSTED' });
    return { applied: status === 'APPLIED', failure, checkId: check.id };
  }).catch(async (error) => {
    if (!(error instanceof AdjustmentRollback)) throw error;
    // Uygulama ödeme sınırına takıldı: düzeltme ayrı işlemde reddedilmiş sayılır.
    return writeWithEvents(async (tx, stage) => {
      const check = await lockedCheck(tx, hotelId, seed.checkId, { open: false });
      const current = await tx.posAdjustment.findFirst({ where: { id: approval.entityId }, select: { status: true } });
      if (current.status !== 'PENDING') return { stale: true };
      await tx.posAdjustment.update({ where: { id: approval.entityId }, data: { status: 'DECLINED', decidedAt: new Date(), decidedBy: approval.decidedBy ?? currentActor() } });
      await recordAudit(tx, { hotelId, entity: 'PosAdjustment', entityId: approval.entityId, action: 'UPDATE', before: { status: 'PENDING' }, after: { status: 'DECLINED', outcome: error.message, approvalId: approval.id } });
      await stage('pos.check.changed', { hotelId, checkId: check.id, outletId: check.outletId, tableId: check.tableId, change: 'ADJUSTED' });
      return { applied: false, failure: error.message, checkId: check.id };
    });
  });
  if (!outcome.stale) await alertRequester(hotelId, approval, granted ? (outcome.applied ? 'GRANTED' : 'FAILED') : envelope.name, outcome.checkId, outcome.failure);
  return { handled: true, applied: Boolean(outcome.applied) };
}

/**
 * Adisyonda görünen en büyük tur numarası: kendi turları ve bölme / birleştirmeyle gelen
 * kalemlerin turları (yeni tur bunun devamı; ekranda aynı numaralı iki tur olmaz).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} checkId
 */
async function lastOrderSeq(tx, checkId) {
  const [row] = await tx.$queryRaw`
    SELECT COALESCE(MAX(o."seq"), 0)::int AS "seq" FROM "PosOrder" o
    WHERE o."checkId" = ${checkId} OR o."id" IN (SELECT l."orderId" FROM "PosOrderLine" l WHERE l."checkId" = ${checkId})`;
  return row.seq;
}

/** Onaylı düzeltme uygulanamadı: transaction geri alınır, ayrı işlemde reddedilir. */
class AdjustmentRollback extends Error {}

/* ══════════════════ Bölme, taşıma, birleştirme, devir ══════════════════ */

/**
 * Adisyonu böler: seçilen kalemler (adetleriyle) aynı masada yeni adisyona taşınır. Ödemeler
 * kaynakta kalır; kaynağın yeni toplamı alınan ödemenin altına düşemez.
 *
 * @param {string} hotelId
 * @param {string} checkId
 * @param {any} input `splitPosCheckSchema`
 * @returns {Promise<{ source: any, target: any }>}
 */
export async function splitCheck(hotelId, checkId, input) {
  const actor = currentActor();
  const { today } = await hotelContext(hotelId);
  let targetId;
  try {
    targetId = await writeWithEvents(async (tx, stage) => {
      const check = await lockedCheck(tx, hotelId, checkId, { expectedUpdatedAt: input.expectedUpdatedAt });
      const [lines, pending] = await Promise.all([
        tx.posOrderLine.findMany({ where: { checkId }, select: { id: true, orderId: true, menuItemId: true, name: true, station: true, taxCategory: true, unitPrice: true, quantity: true, voidedQuantity: true, compedQuantity: true, note: true } }),
        pendingState(tx, checkId),
      ]);
      if (pending.discounts) throw new ConflictError('Onay bekleyen indirim var; karar gelmeden adisyon bölünmez.', 'PENDING_ADJUSTMENT');
      if (pending.payments || pending.voids) throw new ConflictError('Onay bekleyen ödeme ya da ödeme iptali var; karar gelmeden adisyon bölünmez.', 'PENDING_APPROVAL');
      const plan = splitPlan(lines, input.lines, pending.byLine);
      if (Object.keys(plan.errors).length) throw new ValidationError(Object.values(plan.errors)[0], { fields: plan.errors });
      const number = await nextCheckNumber(tx, hotelId, Number(today.slice(0, 4)));
      const target = await tx.posCheck.create({
        data: { hotelId, outletId: check.outletId, tableId: check.tableId, number, covers: 1, waiterEmail: check.waiterEmail, shiftId: check.shiftId, openedBy: actor, splitFromId: check.id },
        select: { id: true },
      });
      if (plan.whole.length) await tx.posOrderLine.updateMany({ where: { id: { in: plan.whole }, checkId }, data: { checkId: target.id } });
      const byId = new Map(lines.map((line) => [line.id, line]));
      let order = 0;
      for (const move of plan.partial) {
        const line = byId.get(move.lineId);
        await tx.posOrderLine.update({ where: { id: line.id }, data: { quantity: { decrement: move.quantity } } });
        await tx.posOrderLine.create({
          data: {
            hotelId,
            checkId: target.id,
            orderId: line.orderId,
            menuItemId: line.menuItemId,
            name: line.name,
            station: line.station,
            taxCategory: line.taxCategory,
            unitPrice: line.unitPrice,
            quantity: move.quantity,
            note: line.note,
            sortOrder: (order += 1),
          },
        });
      }
      const sourceTotals = await recomputeCheckTotals(tx, hotelId, checkId);
      await recomputeCheckTotals(tx, hotelId, target.id);
      const settled = toDecimal(String(check.paidTotal)).plus(toDecimal(String(check.roomChargeTotal)));
      if (settled.greaterThan(toDecimal(sourceTotals.grandTotal))) {
        throw new ConflictError(`Bu adisyondan ${money(settled)} alındı; bölündükten sonra kalan toplam (${sourceTotals.grandTotal}) bunun altına düşemez.`, 'PAID_EXCEEDS_TOTAL');
      }
      await recordAudit(tx, { hotelId, entity: 'PosCheck', entityId: check.id, action: 'UPDATE', after: { split: number, moved: input.lines } });
      await recordAudit(tx, { hotelId, entity: 'PosCheck', entityId: target.id, action: 'CREATE', after: { number, splitFrom: check.number } });
      for (const id of [check.id, target.id]) await stage('pos.check.changed', { hotelId, checkId: id, outletId: check.outletId, tableId: check.tableId, change: 'SPLIT' });
      return target.id;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  const [source, target] = await Promise.all([getCheck(hotelId, checkId), getCheck(hotelId, targetId)]);
  return { source, target };
}

/**
 * Adisyonu başka masaya (aynı satış noktası) ya da masasıza taşır.
 * @param {string} hotelId @param {string} checkId @param {any} input `movePosCheckSchema`
 */
export async function moveCheck(hotelId, checkId, input) {
  await writeWithEvents(async (tx, stage) => {
    const check = await lockedCheck(tx, hotelId, checkId, { expectedUpdatedAt: input.expectedUpdatedAt });
    if (input.tableId) {
      const table = await tx.posTable.findFirst({ where: { id: input.tableId, hotelId }, select: { outletId: true, isActive: true, name: true } });
      if (!table || table.outletId !== check.outletId || !table.isActive) throw new ValidationError('Masa bu satış noktasında değil ya da kapalı', { field: 'tableId' });
    }
    await tx.posCheck.update({ where: { id: checkId }, data: { tableId: input.tableId } });
    await recordAudit(tx, { hotelId, entity: 'PosCheck', entityId: checkId, action: 'UPDATE', before: { tableId: check.tableId }, after: { tableId: input.tableId } });
    await stage('pos.check.changed', { hotelId, checkId, outletId: check.outletId, tableId: input.tableId, change: 'MOVED' });
    if (check.tableId && check.tableId !== input.tableId) await stage('pos.check.changed', { hotelId, checkId, outletId: check.outletId, tableId: check.tableId, change: 'MOVED' });
  });
  return getCheck(hotelId, checkId);
}

/**
 * Kaynak adisyonu hedefe birleştirir (aynı satış noktası): kalemler ve uygulanmış ikram /
 * iptal kayıtları taşınır, kişi sayıları toplanır; kaynak "iptal (birleştirildi)" kapanır.
 * Kaynağın ödemesi, odaya yazılanı ya da onay bekleyen işi varsa birleştirilmez.
 *
 * @param {string} hotelId @param {string} targetId @param {any} input `mergePosCheckSchema`
 */
export async function mergeChecks(hotelId, targetId, input) {
  const actor = currentActor();
  if (input.sourceCheckId === targetId) throw new ValidationError('Adisyon kendisiyle birleştirilmez', { field: 'sourceCheckId' });
  await writeWithEvents(async (tx, stage) => {
    await lockPosChecks(tx, hotelId, [targetId, input.sourceCheckId]);
    const target = await lockedCheck(tx, hotelId, targetId, { expectedUpdatedAt: input.expectedUpdatedAt });
    const source = await lockedCheck(tx, hotelId, input.sourceCheckId);
    if (source.outletId !== target.outletId) throw new ValidationError('Yalnızca aynı satış noktasının adisyonları birleştirilir', { field: 'sourceCheckId' });
    const [payments, rooms, pending] = await Promise.all([
      tx.posPayment.count({ where: { checkId: source.id, status: { in: ['POSTED', 'PENDING'] } } }),
      tx.posRoomCharge.count({ where: { checkId: source.id } }),
      pendingState(tx, source.id),
    ]);
    if (payments || rooms) throw new ConflictError(`${source.number} adisyonundan ödeme alınmış; birleştirilemez (kalanı ayrı kapatın).`, 'CHECK_HAS_PAYMENTS');
    if (pending.adjustments) throw new ConflictError(`${source.number} adisyonunun onay bekleyen düzeltmesi var.`, 'PENDING_ADJUSTMENT');
    const lineCount = await tx.posOrderLine.count({ where: { checkId: { in: [source.id, target.id] } } });
    if (lineCount > MAX_CHECK_LINES) throw new ConflictError(`Birleşik adisyon ${MAX_CHECK_LINES} kalemi aşar`, 'LIMIT');
    const offset = await lastOrderSeq(tx, target.id);
    await tx.$executeRaw`UPDATE "PosOrder" SET "checkId" = ${target.id}, "seq" = "seq" + ${offset} WHERE "checkId" = ${source.id}`;
    await tx.posOrderLine.updateMany({ where: { checkId: source.id }, data: { checkId: target.id } });
    await tx.posAdjustment.updateMany({ where: { checkId: source.id, kind: { in: ['COMP', 'VOID'] } }, data: { checkId: target.id } });
    await tx.posAdjustment.updateMany({ where: { checkId: source.id, kind: 'DISCOUNT', status: 'APPLIED', supersededAt: null }, data: { supersededAt: new Date() } });
    await recomputeCheckTotals(tx, hotelId, source.id);
    await tx.posCheck.update({ where: { id: source.id }, data: { status: 'VOID', voidedAt: new Date(), voidedBy: actor, billRequestedAt: null, note: `Birleştirildi → ${target.number}` } });
    await tx.posCheck.update({ where: { id: target.id }, data: { covers: Math.min(MAX_COVERS, target.covers + source.covers) } });
    await recomputeCheckTotals(tx, hotelId, target.id);
    await recordAudit(tx, { hotelId, entity: 'PosCheck', entityId: target.id, action: 'UPDATE', after: { merged: source.number } });
    await recordAudit(tx, { hotelId, entity: 'PosCheck', entityId: source.id, action: 'UPDATE', before: { status: 'OPEN' }, after: { status: 'VOID', mergedInto: target.number } });
    await stage('pos.check.changed', { hotelId, checkId: target.id, outletId: target.outletId, tableId: target.tableId, change: 'MERGED' });
    await stage('pos.check.changed', { hotelId, checkId: source.id, outletId: source.outletId, tableId: source.tableId, change: 'MERGED' });
  });
  return getCheck(hotelId, targetId);
}

/**
 * Adisyonu başka garsona devreder (vardiya kapanırken açık adisyon kalmaz). Kendi adisyonunu
 * herkes devreder; başkasınınkini şef garson. Hedef garsonun açık vardiyası olmalı.
 *
 * @param {string} hotelId @param {string} checkId @param {any} input `transferPosCheckSchema`
 * @param {{ canSupervise: boolean }} access
 */
export async function transferCheck(hotelId, checkId, input, { canSupervise }) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const target = await tx.posShift.findFirst({ where: { hotelId, waiterEmail: input.waiterEmail, status: 'OPEN' }, select: { id: true } });
    if (!target) throw new ValidationError('Bu garsonun açık vardiyası yok', { field: 'waiterEmail' });
    await lockPosShifts(tx, hotelId, [target.id], { shared: true });
    const check = await lockedCheck(tx, hotelId, checkId, { expectedUpdatedAt: input.expectedUpdatedAt });
    if (check.waiterEmail !== actor && !canSupervise) throw new ForbiddenError('Başka garsonun adisyonunu yalnızca şef garson devreder');
    if (check.waiterEmail === input.waiterEmail) throw new ValidationError('Adisyon zaten bu garsonda', { field: 'waiterEmail' });
    const shift = await tx.posShift.findFirst({ where: { id: target.id }, select: { status: true } });
    if (shift.status !== 'OPEN') throw new ValidationError('Bu garsonun vardiyası az önce kapandı', { field: 'waiterEmail' });
    await tx.posCheck.update({ where: { id: checkId }, data: { waiterEmail: input.waiterEmail, shiftId: target.id } });
    await recordAudit(tx, { hotelId, entity: 'PosCheck', entityId: checkId, action: 'UPDATE', before: { waiterEmail: check.waiterEmail }, after: { waiterEmail: input.waiterEmail, by: actor } });
    await stage('pos.check.changed', { hotelId, checkId, outletId: check.outletId, tableId: check.tableId, change: 'TRANSFERRED' });
  });
  return getCheck(hotelId, checkId);
}

/* ══════════════════ Kapatma ══════════════════ */

/**
 * Adisyonu kapatır: kalemi olan adisyonun bakiyesi sıfır olmalı (tamamı ikram / iptal
 * edilmiş adisyon da sıfırdır) ve onay bekleyen iş kalmamalı. Ödeme alınınca adisyon zaten
 * kendiliğinden kapanır; bu uç sıfır toplamlı adisyon içindir.
 *
 * @param {string} hotelId @param {string} checkId @param {{ expectedUpdatedAt: Date }} input
 */
export async function closeCheck(hotelId, checkId, { expectedUpdatedAt }) {
  const { today } = await hotelContext(hotelId);
  await writeWithEvents(async (tx, stage) => {
    const check = await lockedCheck(tx, hotelId, checkId, { expectedUpdatedAt });
    const lines = await tx.posOrderLine.count({ where: { checkId } });
    if (lines === 0) throw new ConflictError('Kalemi olmayan adisyon kapatılmaz; boş adisyonu iptal edin.', 'EMPTY_CHECK');
    const balance = checkBalance({ grandTotal: money(check.grandTotal), paidTotal: money(check.paidTotal), roomChargeTotal: money(check.roomChargeTotal) });
    if (!toDecimal(balance).isZero()) throw new ConflictError(`Adisyonun ${balance} bakiyesi var; önce ödeme alın.`, 'BALANCE_DUE');
    const pending = await pendingState(tx, checkId);
    if (pending.adjustments || pending.payments || pending.voids) throw new ConflictError('Onay bekleyen düzeltme, ödeme ya da ödeme iptali var; karar bekleniyor.', 'PENDING_APPROVAL');
    await closeIfSettled(tx, stage, { hotelId, checkId, today });
  });
  return getCheck(hotelId, checkId);
}

/**
 * Boş adisyonu (yanlışlıkla açılmış; kalemi yok) iptal eder.
 * @param {string} hotelId @param {string} checkId @param {{ expectedUpdatedAt: Date }} input
 */
export async function voidEmptyCheck(hotelId, checkId, { expectedUpdatedAt }) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const check = await lockedCheck(tx, hotelId, checkId, { expectedUpdatedAt });
    const [lines, payments] = await Promise.all([tx.posOrderLine.count({ where: { checkId } }), tx.posPayment.count({ where: { checkId } })]);
    if (lines || payments) throw new ConflictError('Kalemi ya da ödemesi olan adisyon iptal edilmez; kalemler şef garsonca iptal edilir.', 'CHECK_NOT_EMPTY');
    await tx.posCheck.update({ where: { id: checkId }, data: { status: 'VOID', voidedAt: new Date(), voidedBy: actor, billRequestedAt: null } });
    await recordAudit(tx, { hotelId, entity: 'PosCheck', entityId: checkId, action: 'UPDATE', before: { status: 'OPEN' }, after: { status: 'VOID', by: actor } });
    await stage('pos.check.changed', { hotelId, checkId, outletId: check.outletId, tableId: check.tableId, change: 'VOIDED' });
  });
  return getCheck(hotelId, checkId);
}

/**
 * Kapanmış adisyonu yeniden açar (şef garson, gerekçeli): yalnızca aynı iş günü, adisyonun
 * vardiyası hâlâ açıkken ve odaya yazılan tutar yoksa (folyoya işlenen tutar POS'tan geri
 * alınamaz). Ödeme düzeltmesi açık adisyonda hatalı giriş iptaliyle yapılır.
 *
 * @param {string} hotelId @param {string} checkId @param {{ reason: string }} input
 */
export async function reopenCheck(hotelId, checkId, { reason }) {
  const actor = currentActor();
  const { today } = await hotelContext(hotelId);
  await writeWithEvents(async (tx, stage) => {
    // Kilit sırası vardiya → adisyon: vardiya kapanırken içine açık adisyon geri dönmesin.
    const seed = await tx.posCheck.findFirst({ where: { id: checkId, hotelId }, select: { shiftId: true } });
    if (!seed) throw new NotFoundError('Adisyon bulunamadı');
    await lockPosShifts(tx, hotelId, [seed.shiftId], { shared: true });
    const check = await lockedCheck(tx, hotelId, checkId, { open: false });
    if (check.status !== 'CLOSED') throw new ConflictError('Yalnızca kapanmış adisyon yeniden açılır', 'CHECK_STATUS');
    if (check.shiftId !== seed.shiftId) throw new StaleWriteError('Adisyon siz bakarken değişti; tekrar deneyin.');
    if (day(check.businessDate) !== today) throw new ConflictError('Önceki iş gününün adisyonu yeniden açılmaz (gün kapandı).', 'DAY_CLOSED');
    const [shift, rooms] = await Promise.all([tx.posShift.findFirst({ where: { id: check.shiftId }, select: { status: true } }), tx.posRoomCharge.count({ where: { checkId } })]);
    if (shift.status !== 'OPEN') throw new ConflictError('Adisyonun vardiyası kapandı (kasa sayıldı); yeniden açılmaz.', 'SHIFT_CLOSED');
    if (rooms) throw new ConflictError('Odaya yazılan adisyon yeniden açılmaz; düzeltme folyoda yapılır.', 'ROOM_CHARGED');
    await tx.posCheck.update({ where: { id: checkId }, data: { status: 'OPEN', closedAt: null, closedBy: null, businessDate: null, reopenedAt: new Date(), reopenedBy: actor, reopenReason: reason } });
    // Kalemler satış raporundan çıkar (yeniden kapanınca yeni günle döner).
    await tx.posOrderLine.updateMany({ where: { checkId }, data: { businessDate: null } });
    await recordAudit(tx, { hotelId, entity: 'PosCheck', entityId: checkId, action: 'UPDATE', before: { status: 'CLOSED' }, after: { status: 'OPEN', reason, by: actor } });
    await stage('pos.check.changed', { hotelId, checkId, outletId: check.outletId, tableId: check.tableId, change: 'REOPENED' });
  });
  return getCheck(hotelId, checkId);
}

/** Düzeltmenin adisyonu (onay ekranından geçiş). @param {string} hotelId @param {string} adjustmentId */
export async function findAdjustmentCheck(hotelId, adjustmentId) {
  const row = await prisma.posAdjustment.findFirst({ where: { id: adjustmentId, hotelId }, select: { checkId: true } });
  if (!row) throw new NotFoundError('Düzeltme bulunamadı');
  return { checkId: row.checkId };
}
