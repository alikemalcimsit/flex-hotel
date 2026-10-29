import { currentActor, runWithContext, toDecimal } from '@hotelos/core';
import { APPROVAL_TYPE_LABELS, PURCHASE_ORDER_STATUS_LABELS, RECEIVABLE_ORDER_STATUSES } from '@hotelos/hotel-contracts';
import { prismaUnfiltered } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, rethrowPrismaError } from '../../lib/errors.js';
import { lockPurchaseOrders, lockPurchaseRounds } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { containsText, matchStockItemIds, searchTokens } from '../../lib/search.js';
import { findActiveStaffByEmail } from '../../lib/staff.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { receivableQuantity } from './rules.js';
import { dateOnly, dayText, hotelContext, iso, money, plain, prisma, releaseOrderLines } from './shared.js';

/**
 * Satın alma siparişi (modül 45): tedarikçi başına, teklif turundan doğar.
 *
 * Durumlar: onay bekliyor → onaylı → kısmen teslim → teslim alındı; eksik kapatıldı; reddedildi
 * (onay reddi / süresi doldu); iptal. Onay kararı onay kuyruğundan gelir (`subscribers.js`) ve
 * **karar verenin** adıyla işlenir. Reddedilen ya da iptal edilen siparişin satırları teklif turuna
 * geri döner (yeniden kazanan seçilir). Mal kabul görmüş sipariş iptal edilmez, eksik kapatılır.
 */

/** Sipariş ekranında listelenen en fazla mal kabul (sayısı listede `receipts`). */
const ORDER_RECEIPT_PREVIEW = 50;

const ORDER_LIST_SELECT = Object.freeze({
  id: true,
  number: true,
  status: true,
  expectedOn: true,
  paymentTermDays: true,
  currency: true,
  netTotal: true,
  taxTotal: true,
  grandTotal: true,
  receivedTotal: true,
  approvalId: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  supplierId: true,
  supplier: { select: { code: true, name: true } },
  round: { select: { id: true, number: true } },
  _count: { select: { lines: true, receipts: true } },
});

/** @param {any} row @param {string} today */
const listDto = (row, today) => ({
  id: row.id,
  number: row.number,
  status: row.status,
  supplierId: row.supplierId,
  supplierCode: row.supplier.code,
  supplierName: row.supplier.name,
  round: row.round,
  expectedOn: dayText(row.expectedOn),
  late: RECEIVABLE_ORDER_STATUSES.includes(row.status) && dayText(row.expectedOn) < today,
  paymentTermDays: row.paymentTermDays,
  currency: row.currency,
  netTotal: money(row.netTotal),
  taxTotal: money(row.taxTotal),
  grandTotal: money(row.grandTotal),
  receivedTotal: money(row.receivedTotal),
  lines: row._count.lines,
  receipts: row._count.receipts,
  createdBy: row.createdBy,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, status?: string, open?: boolean, supplierId?: string, search?: string, from?: string, to?: string }} query
 */
export async function listOrders(hotelId, query) {
  const { today } = await hotelContext(hotelId);
  /** @type {Record<string, any>} */
  const where = { hotelId };
  if (query.status) where.status = query.status;
  else if (query.open) where.status = { in: [...RECEIVABLE_ORDER_STATUSES] };
  if (query.supplierId) where.supplierId = query.supplierId;
  if (query.from || query.to) where.expectedOn = { ...(query.from ? { gte: dateOnly(query.from) } : {}), ...(query.to ? { lte: dateOnly(query.to) } : {}) };
  const tokens = searchTokens(query.search);
  if (tokens.length) {
    const items = await Promise.all(tokens.map((token) => matchStockItemIds(prisma, hotelId, token)));
    where.AND = tokens.map((token, index) => ({
      OR: [
        { number: containsText(token) },
        { supplier: { name: containsText(token) } },
        ...(items[index].length ? [{ lines: { some: { stockItemId: { in: items[index] } } } }] : []),
      ],
    }));
  }
  const [rows, total] = await Promise.all([
    prisma.purchaseOrder.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(query), select: ORDER_LIST_SELECT }),
    prisma.purchaseOrder.count({ where }),
  ]);
  return buildPage(
    rows.map((row) => listDto(row, today)),
    total,
    query,
  );
}

/**
 * Sipariş ekranı: satırlar (kalan / teslim alınabilir), mal kabuller, onay durumu.
 * @param {string} hotelId @param {string} orderId
 */
export async function getOrder(hotelId, orderId) {
  const [{ today }, row] = await Promise.all([
    hotelContext(hotelId),
    prisma.purchaseOrder.findFirst({
      where: { id: orderId, hotelId },
      select: {
        ...ORDER_LIST_SELECT,
        note: true,
        approvedAt: true,
        approvedBy: true,
        rejectedAt: true,
        cancelledAt: true,
        cancelledBy: true,
        cancelReason: true,
        closedAt: true,
        closedBy: true,
        closeReason: true,
        supplier: { select: { code: true, name: true, contactName: true, phone: true, email: true, taxOffice: true, taxNumber: true, address: true } },
        lines: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            stockItemId: true,
            quantity: true,
            unit: true,
            unitPrice: true,
            taxRatePct: true,
            netAmount: true,
            taxAmount: true,
            total: true,
            receivedQuantity: true,
            stockItem: { select: { code: true, name: true, group: true } },
            roundLine: { select: { awardReason: true, neededBy: true } },
          },
        },
        receipts: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: ORDER_RECEIPT_PREVIEW,
          select: { id: true, number: true, waybillNumber: true, receivedOn: true, grandTotal: true, closedShort: true, receivedBy: true, createdAt: true, warehouse: { select: { name: true } } },
        },
      },
    }),
  ]);
  if (!row) throw new NotFoundError('Sipariş bulunamadı');
  const approval = row.approvalId
    ? await prismaUnfiltered.approval.findFirst({ where: { id: row.approvalId, hotelId }, select: { id: true, status: true, decidedBy: true, decidedAt: true, note: true, expiresAt: true } })
    : null;
  const receivable = RECEIVABLE_ORDER_STATUSES.includes(row.status);
  return {
    ...listDto(row, today),
    supplier: row.supplier,
    note: row.note,
    approvedAt: iso(row.approvedAt),
    approvedBy: row.approvedBy,
    rejectedAt: iso(row.rejectedAt),
    cancelledAt: iso(row.cancelledAt),
    cancelledBy: row.cancelledBy,
    cancelReason: row.cancelReason,
    closedAt: iso(row.closedAt),
    closedBy: row.closedBy,
    closeReason: row.closeReason,
    receivable,
    approval: approval ? { ...approval, decidedAt: iso(approval.decidedAt), expiresAt: iso(approval.expiresAt) } : null,
    lines: row.lines.map((line) => {
      const left = toDecimal(String(line.quantity)).minus(toDecimal(String(line.receivedQuantity)));
      return {
        id: line.id,
        stockItemId: line.stockItemId,
        code: line.stockItem.code,
        name: line.stockItem.name,
        group: line.stockItem.group,
        unit: line.unit,
        quantity: plain(line.quantity),
        receivedQuantity: plain(line.receivedQuantity),
        remaining: left.greaterThan(0) ? left.toString() : '0',
        receivable: receivable ? receivableQuantity({ quantity: String(line.quantity), receivedQuantity: String(line.receivedQuantity), unit: line.unit }).toString() : '0',
        unitPrice: plain(line.unitPrice),
        taxRatePct: plain(line.taxRatePct),
        netAmount: money(line.netAmount),
        taxAmount: money(line.taxAmount),
        total: money(line.total),
        neededBy: dayText(line.roundLine?.neededBy ?? null),
        awardReason: line.roundLine?.awardReason ?? null,
      };
    }),
    receiptList: row.receipts.map((receipt) => ({
      id: receipt.id,
      number: receipt.number,
      waybillNumber: receipt.waybillNumber,
      receivedOn: dayText(receipt.receivedOn),
      warehouseName: receipt.warehouse.name,
      grandTotal: money(receipt.grandTotal),
      closedShort: receipt.closedShort,
      receivedBy: receipt.receivedBy,
      createdAt: iso(receipt.createdAt),
    })),
  };
}

/**
 * Turu (varsa) ve siparişi sırasıyla kilitler. Tur kimliği sipariş açılırken yazılır ve değişmez.
 * @param {any} tx @param {string} hotelId @param {string} orderId
 */
async function lockOrderWithRound(tx, hotelId, orderId) {
  const seed = await tx.purchaseOrder.findFirst({ where: { id: orderId, hotelId }, select: { roundId: true } });
  if (!seed) throw new NotFoundError('Sipariş bulunamadı');
  if (seed.roundId) await lockPurchaseRounds(tx, hotelId, [seed.roundId]);
  await lockPurchaseOrders(tx, hotelId, [orderId]);
  return tx.purchaseOrder.findUnique({
    where: { id: orderId },
    select: { number: true, status: true, updatedAt: true, roundId: true, receivedTotal: true, approvalId: true, supplier: { select: { name: true } } },
  });
}

/**
 * Onaylı, hiç teslim alınmamış siparişi iptal eder; satırlar tura döner. Onay bekleyen sipariş
 * onay kuyruğundan reddedilir (isteyen kendi isteğini geri çekemez, onaylayan karar verir).
 * @param {string} hotelId @param {string} orderId @param {{ expectedUpdatedAt: Date, reason: string }} input
 */
export async function cancelOrder(hotelId, orderId, { expectedUpdatedAt, reason }) {
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      const order = await lockOrderWithRound(tx, hotelId, orderId);
      if (order.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
      if (order.status === 'PENDING_APPROVAL') throw new ConflictError('Onay bekleyen sipariş onay kuyruğundan reddedilir', 'ORDER_PENDING_APPROVAL');
      if (order.status !== 'APPROVED') throw new ConflictError(`Bu durumdaki sipariş iptal edilemez (${PURCHASE_ORDER_STATUS_LABELS[order.status]}); teslim alınmışsa eksik kapatın`, 'ORDER_STATUS');
      await tx.purchaseOrder.update({ where: { id: orderId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: actor, cancelReason: reason } });
      await releaseOrderLines(tx, stage, { hotelId, orderId, roundId: order.roundId });
      await recordAudit(tx, { hotelId, entity: 'PurchaseOrder', entityId: orderId, action: 'UPDATE', before: { status: order.status }, after: { status: 'CANCELLED', reason, number: order.number } });
      await stage('purchase.order.changed', { hotelId, orderId, change: 'CANCELLED' });
    });
    return getOrder(hotelId, orderId);
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Kısmen teslim alınmış siparişin kalanı gelmeyecek: eksik kapatılır (stok ve borç yalnız gelen kadar).
 * @param {string} hotelId @param {string} orderId @param {{ expectedUpdatedAt: Date, reason: string }} input
 */
export async function closeOrder(hotelId, orderId, { expectedUpdatedAt, reason }) {
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      const order = await lockOrderWithRound(tx, hotelId, orderId);
      if (order.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
      if (order.status !== 'PARTIALLY_RECEIVED') {
        throw new ConflictError(
          order.status === 'APPROVED' ? 'Hiç teslim alınmamış sipariş eksik kapatılmaz, iptal edilir' : `Bu durumdaki sipariş kapatılamaz (${PURCHASE_ORDER_STATUS_LABELS[order.status]})`,
          'ORDER_STATUS',
        );
      }
      await tx.purchaseOrder.update({ where: { id: orderId }, data: { status: 'CLOSED', closedAt: new Date(), closedBy: actor, closeReason: reason } });
      await recordAudit(tx, { hotelId, entity: 'PurchaseOrder', entityId: orderId, action: 'UPDATE', before: { status: order.status }, after: { status: 'CLOSED', reason, number: order.number } });
      await stage('purchase.order.changed', { hotelId, orderId, change: 'CLOSED' });
    });
    return getOrder(hotelId, orderId);
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Onay kuyruğunun kararı (dinleyiciden): onaylandıysa sipariş onaylı olur; reddedildi / süresi
 * dolduysa reddedilir ve satırlar tura döner. Aynı haber iki kez gelse de bir kez uygulanır.
 *
 * @param {{ hotelId: string, approvalId: string, type: string }} payload
 * @param {{ name: string }} envelope
 */
export async function applyOrderDecision(payload, envelope) {
  if (payload.type !== 'PURCHASE_ORDER') return { handled: false };
  const hotelId = payload.hotelId;
  const approval = await prismaUnfiltered.approval.findFirst({
    where: { id: payload.approvalId, hotelId },
    select: { id: true, type: true, entityId: true, requestedBy: true, decidedBy: true, note: true, summary: true },
  });
  if (!approval?.entityId) return { handled: false };
  const granted = envelope.name === 'approval.granted';
  const outcome = await writeWithEvents(async (tx, stage) => {
    const order = await lockOrderWithRound(tx, hotelId, approval.entityId).catch((error) => {
      if (error instanceof NotFoundError) return null;
      throw error;
    });
    if (!order || order.status !== 'PENDING_APPROVAL' || order.approvalId !== approval.id) return { stale: true };
    if (granted) {
      await tx.purchaseOrder.update({ where: { id: approval.entityId }, data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: approval.decidedBy } });
      await recordAudit(tx, { hotelId, entity: 'PurchaseOrder', entityId: approval.entityId, action: 'UPDATE', before: { status: 'PENDING_APPROVAL' }, after: { status: 'APPROVED', approvedBy: approval.decidedBy, approvalId: approval.id } });
      await stage('purchase.order.changed', { hotelId, orderId: approval.entityId, change: 'APPROVED' });
      return { applied: true };
    }
    await tx.purchaseOrder.update({ where: { id: approval.entityId }, data: { status: 'REJECTED', rejectedAt: new Date() } });
    await releaseOrderLines(tx, stage, { hotelId, orderId: approval.entityId, roundId: order.roundId });
    await recordAudit(tx, {
      hotelId,
      entity: 'PurchaseOrder',
      entityId: approval.entityId,
      action: 'UPDATE',
      before: { status: 'PENDING_APPROVAL' },
      after: { status: 'REJECTED', outcome: envelope.name === 'approval.denied' ? 'DENIED' : 'EXPIRED', note: approval.note, approvalId: approval.id },
    });
    await stage('purchase.order.changed', { hotelId, orderId: approval.entityId, change: 'REJECTED' });
    return { applied: false };
  });
  if (!outcome.stale) await alertRequester(hotelId, approval, envelope.name, approval.entityId);
  return { handled: true, applied: Boolean(outcome.applied) };
}

/**
 * Siparişi açan kişiye kararın haberi (zil). İsteyen artık personel değilse satın alma yöneticilerine.
 * @param {string} hotelId @param {any} approval @param {string} outcome @param {string} orderId
 */
async function alertRequester(hotelId, approval, outcome, orderId) {
  const staff = approval.requestedBy?.includes('@') ? await findActiveStaffByEmail(prismaUnfiltered, hotelId, approval.requestedBy.toLowerCase()) : null;
  const label = APPROVAL_TYPE_LABELS[approval.type] ?? 'Onay';
  const titles = {
    'approval.granted': `${label} onaylandı: ${approval.summary}`,
    'approval.denied': `${label} reddedildi: ${approval.summary}`,
    'approval.expired': `${label} onayının süresi doldu: ${approval.summary}`,
  };
  const body =
    outcome === 'approval.granted'
      ? 'Sipariş tedarikçiye gönderilebilir (PDF).'
      : outcome === 'approval.denied'
        ? `Gerekçe: ${approval.note ?? '—'}. Satırlar teklif turuna döndü; yeniden kazanan seçilebilir.`
        : 'Satırlar teklif turuna döndü; gerekiyorsa yeniden seçip onaya gönderin.';
  await writeWithEvents((tx, stage) =>
    raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'APPROVAL_DECIDED',
      severity: outcome === 'approval.granted' ? 'INFO' : 'WARNING',
      title: (titles[outcome] ?? approval.summary).slice(0, 200),
      body,
      link: `/satin-alma/siparisler/${orderId}`,
      userId: staff?.id ?? null,
      permission: staff ? null : PERMISSIONS.PURCHASING_MANAGE,
      entityType: 'Approval',
      entityId: approval.id,
      dedupeKey: `approval-decided:${approval.id}`,
    }),
  );
}

/**
 * Dinleyici girişi: kararı veren kişinin bağlamında çalıştırır.
 * @param {{ hotelId: string, approvalId: string, type: string, decidedBy?: string }} payload
 * @param {{ id: string, name: string, correlationId?: string }} envelope
 */
export function onPurchaseApprovalDecision(payload, envelope) {
  if (payload?.type !== 'PURCHASE_ORDER') return Promise.resolve({ handled: false });
  return runWithContext({ correlationId: envelope.correlationId, causationId: envelope.id, actor: payload.decidedBy ?? 'system' }, () => applyOrderDecision(payload, envelope));
}
