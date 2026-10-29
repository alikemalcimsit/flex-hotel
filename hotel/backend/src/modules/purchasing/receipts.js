import { randomUUID } from 'node:crypto';
import { currentActor, toDecimal } from '@hotelos/core';
import { GOODS_RECEIPT_PREFIX, KITCHEN_UNIT_LABELS, PURCHASE_ORDER_STATUS_LABELS, RECEIVABLE_ORDER_STATUSES, utcToZonedWallTime, zonedWallTimeToUtc } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockPurchaseOrders, lockWarehouses } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { containsText, searchTokens } from '../../lib/search.js';
import { writeWithEvents } from '../../lib/write.js';
import { postStockIn } from '../stock/movements.js';
import { addDays, orderStatusAfterReceipt, receiptPlan } from './rules.js';
import { dateOnly, dayText, hotelContext, iso, money, nextNumber, plain, prisma } from './shared.js';

/**
 * Mal kabul / irsaliye (modül 45): siparişten gelen miktar depoya girer.
 *
 * Tek transaction'da (sıra: sipariş → depo → malzeme kartı):
 * - Sipariş kilitlenir; sürüm damgası ekranın gördüğüyle aynı olmalı (iki kişi aynı irsaliyeyi aynı
 *   anda giremez; ikincisi güncel kalanı görür). Depo paylaşımlı kilitlenir (bu arada pasife alınamaz).
 * - Miktar sınırı: kalan (adet) / kalan + %5 (tartılan, ölçülen). Tutarlar sipariş fiyatıyla.
 * - Stok girer (`postStockIn`): depo satırı, malzemenin toplam mevcudu, hareketli ortalama maliyet,
 *   değişmez hareket kaydı.
 * - Sipariş satırının teslim alınanı ve siparişin durumu (kısmen / tam / eksik kapandı) güncellenir.
 * - Tedarikçi borcu iş olayı yayınlanır (`purchase.goods.received`; vade = kabul günü + tedarikçi vadesi).
 * Aynı tedarikçinin aynı irsaliye numarası ikinci kez girilemez (veritabanı kısıtı).
 */

const RECEIPT_LIST_SELECT = Object.freeze({
  id: true,
  number: true,
  waybillNumber: true,
  receivedOn: true,
  note: true,
  netTotal: true,
  taxTotal: true,
  grandTotal: true,
  closedShort: true,
  receivedBy: true,
  createdAt: true,
  order: { select: { id: true, number: true, currency: true, paymentTermDays: true } },
  supplier: { select: { id: true, code: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  _count: { select: { lines: true } },
});

/** @param {any} row */
const listDto = (row) => ({
  id: row.id,
  number: row.number,
  waybillNumber: row.waybillNumber,
  receivedOn: dayText(row.receivedOn),
  dueDate: addDays(dayText(row.receivedOn), row.order.paymentTermDays),
  note: row.note,
  currency: row.order.currency,
  netTotal: money(row.netTotal),
  taxTotal: money(row.taxTotal),
  grandTotal: money(row.grandTotal),
  closedShort: row.closedShort,
  receivedBy: row.receivedBy,
  createdAt: iso(row.createdAt),
  order: { id: row.order.id, number: row.order.number },
  supplier: row.supplier,
  warehouse: row.warehouse,
  lines: row._count.lines,
});

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, supplierId?: string, warehouseId?: string, search?: string, from?: string, to?: string }} query
 */
export async function listReceipts(hotelId, query) {
  /** @type {Record<string, any>} */
  const where = { hotelId };
  if (query.supplierId) where.supplierId = query.supplierId;
  if (query.warehouseId) where.warehouseId = query.warehouseId;
  if (query.from || query.to) where.receivedOn = { ...(query.from ? { gte: dateOnly(query.from) } : {}), ...(query.to ? { lte: dateOnly(query.to) } : {}) };
  const tokens = searchTokens(query.search);
  if (tokens.length) {
    where.AND = tokens.map((token) => ({
      OR: [{ number: containsText(token) }, { waybillNumber: containsText(token) }, { order: { number: containsText(token) } }, { supplier: { name: containsText(token) } }],
    }));
  }
  const [rows, total] = await Promise.all([
    prisma.goodsReceipt.findMany({ where, orderBy: [{ receivedOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(query), select: RECEIPT_LIST_SELECT }),
    prisma.goodsReceipt.count({ where }),
  ]);
  return buildPage(rows.map(listDto), total, query);
}

/** @param {string} hotelId @param {string} receiptId */
export async function getReceipt(hotelId, receiptId) {
  const row = await prisma.goodsReceipt.findFirst({
    where: { id: receiptId, hotelId },
    select: {
      ...RECEIPT_LIST_SELECT,
      lines: {
        orderBy: { orderLine: { sortOrder: 'asc' } },
        select: {
          id: true,
          stockItemId: true,
          quantity: true,
          unitPrice: true,
          taxRatePct: true,
          netAmount: true,
          taxAmount: true,
          total: true,
          orderLine: { select: { id: true, quantity: true, receivedQuantity: true, unit: true, stockItem: { select: { code: true, name: true } } } },
        },
      },
    },
  });
  if (!row) throw new NotFoundError('Mal kabul bulunamadı');
  return {
    ...listDto(row),
    lines: row.lines.map((line) => ({
      id: line.id,
      stockItemId: line.stockItemId,
      code: line.orderLine.stockItem.code,
      name: line.orderLine.stockItem.name,
      unit: line.orderLine.unit,
      quantity: plain(line.quantity),
      ordered: plain(line.orderLine.quantity),
      receivedToDate: plain(line.orderLine.receivedQuantity),
      unitPrice: plain(line.unitPrice),
      taxRatePct: plain(line.taxRatePct),
      netAmount: money(line.netAmount),
      taxAmount: money(line.taxAmount),
      total: money(line.total),
    })),
  };
}

/**
 * Mal kabul: gelen miktar depoya girer, sipariş ilerler, tedarikçi borcu doğar.
 * @param {string} hotelId @param {string} orderId
 * @param {{ expectedUpdatedAt: Date, warehouseId: string, waybillNumber: string, receivedOn: string, note?: string | null, closeShort: boolean, lines: Array<{ orderLineId: string, quantity: string }> }} input
 */
export async function receiveGoods(hotelId, orderId, input) {
  const actor = currentActor();
  const { today, timezone } = await hotelContext(hotelId);
  if (input.receivedOn > today) throw new ValidationError('Kabul günü bugünden sonra olamaz', { fields: { receivedOn: 'Kabul günü bugünden sonra olamaz' } });
  try {
    const id = await writeWithEvents(async (tx, stage) => {
      if (!(await lockPurchaseOrders(tx, hotelId, [orderId])).has(orderId)) throw new NotFoundError('Sipariş bulunamadı');
      const order = await tx.purchaseOrder.findUnique({
        where: { id: orderId },
        select: {
          number: true,
          status: true,
          updatedAt: true,
          createdAt: true,
          supplierId: true,
          paymentTermDays: true,
          currency: true,
          receivedTotal: true,
          supplier: { select: { name: true } },
          lines: {
            orderBy: { sortOrder: 'asc' },
            select: { id: true, stockItemId: true, quantity: true, unit: true, receivedQuantity: true, unitPrice: true, taxRatePct: true, stockItem: { select: { name: true, unit: true } } },
          },
        },
      });
      if (order.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new StaleWriteError();
      if (!RECEIVABLE_ORDER_STATUSES.includes(order.status)) {
        throw new ConflictError(`Bu durumdaki siparişe mal kabul yapılmaz (${PURCHASE_ORDER_STATUS_LABELS[order.status]})`, 'ORDER_STATUS');
      }
      const orderDay = utcToZonedWallTime(order.createdAt, timezone).slice(0, 10);
      if (input.receivedOn < orderDay) throw new ValidationError('Kabul günü sipariş gününden önce olamaz', { fields: { receivedOn: `Sipariş ${orderDay} tarihinde açıldı` } });

      if (!(await lockWarehouses(tx, hotelId, [input.warehouseId], { shared: true })).has(input.warehouseId)) throw new NotFoundError('Depo bulunamadı');
      const warehouse = await tx.warehouse.findUnique({ where: { id: input.warehouseId }, select: { name: true, isActive: true } });
      if (!warehouse.isActive) throw new ConflictError(`${warehouse.name} pasif; mal kabul başka depoya yapılır`, 'WAREHOUSE_INACTIVE');
      const duplicate = await tx.goodsReceipt.findFirst({ where: { hotelId, supplierId: order.supplierId, waybillNumber: input.waybillNumber }, select: { number: true } });
      if (duplicate) throw new ValidationError(`Bu irsaliye ${duplicate.number} ile zaten girildi`, { fields: { waybillNumber: `Bu irsaliye ${duplicate.number} ile zaten girildi` } });

      const plan = receiptPlan({
        orderLines: order.lines.map((line) => ({
          id: line.id,
          stockItemId: line.stockItemId,
          name: line.stockItem.name,
          unit: line.unit,
          quantity: String(line.quantity),
          receivedQuantity: String(line.receivedQuantity),
          unitPrice: String(line.unitPrice),
          taxRatePct: String(line.taxRatePct),
        })),
        inputLines: input.lines,
      });
      const lineById = new Map(order.lines.map((line) => [line.id, line]));
      input.lines.forEach((entry, index) => {
        const line = lineById.get(entry.orderLineId);
        if (line && line.unit !== line.stockItem.unit && Number(entry.quantity) > 0) {
          plan.fields[`lines.${index}.quantity`] = `${line.stockItem.name}: stok birimi siparişten sonra ${KITCHEN_UNIT_LABELS[line.stockItem.unit]} oldu; birimi geri alın ya da siparişi kapatın`;
        }
      });
      const messages = Object.values(plan.fields);
      if (messages.length) throw new ValidationError(`Mal kabulde düzeltilmesi gereken satırlar var: ${messages[0]}${messages.length > 1 ? ` (+${messages.length - 1})` : ''}`, { fields: plan.fields });
      if (plan.lines.length === 0) throw new ValidationError('En az bir satırda gelen miktar girin', { fields: { lines: 'En az bir satırda gelen miktar girin' } });

      const receiptId = randomUUID();
      const number = await nextNumber(tx, hotelId, GOODS_RECEIPT_PREFIX, Number(input.receivedOn.slice(0, 4)));
      const closedShort = input.closeShort && !plan.fullyReceived;
      await tx.goodsReceipt.create({
        data: {
          id: receiptId,
          hotelId,
          number,
          orderId,
          supplierId: order.supplierId,
          warehouseId: input.warehouseId,
          waybillNumber: input.waybillNumber,
          receivedOn: dateOnly(input.receivedOn),
          note: input.note ?? null,
          netTotal: money(plan.totals.net),
          taxTotal: money(plan.totals.tax),
          grandTotal: money(plan.totals.total),
          closedShort,
          receivedBy: actor,
        },
      });
      await tx.goodsReceiptLine.createMany({
        data: plan.lines.map((line) => ({
          hotelId,
          receiptId,
          orderLineId: line.orderLine.id,
          stockItemId: line.orderLine.stockItemId,
          quantity: line.quantity.toFixed(3),
          unitPrice: line.orderLine.unitPrice,
          taxRatePct: line.orderLine.taxRatePct,
          netAmount: money(line.net),
          taxAmount: money(line.tax),
          total: money(line.total),
        })),
      });
      await tx.$executeRaw`
        UPDATE "PurchaseOrderLine" AS l SET "receivedQuantity" = l."receivedQuantity" + v."quantity"
        FROM unnest(${plan.lines.map((line) => line.orderLine.id)}::text[], ${plan.lines.map((line) => line.quantity.toFixed(3))}::numeric[]) AS v("id", "quantity")
        WHERE l."id" = v."id" AND l."orderId" = ${orderId}`;
      const status = orderStatusAfterReceipt({ fullyReceived: plan.fullyReceived, closeShort: input.closeShort });
      const now = new Date();
      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: {
          status,
          receivedTotal: money(toDecimal(String(order.receivedTotal)).plus(plan.totals.total)),
          ...(status === 'CLOSED' ? { closedAt: now, closedBy: actor, closeReason: input.note ?? `${number} ile eksik kapatıldı` } : {}),
        },
      });

      const occurredAt = input.receivedOn === today ? now : zonedWallTimeToUtc(`${input.receivedOn}T12:00`, timezone);
      const stock = await postStockIn(tx, {
        hotelId,
        warehouseId: input.warehouseId,
        kind: 'RECEIPT',
        sourceType: 'GoodsReceipt',
        sourceId: receiptId,
        occurredAt,
        actor,
        note: `${number} · ${order.supplier.name} · İrsaliye ${input.waybillNumber}`.slice(0, 200),
        lines: plan.lines.map((line) => ({ stockItemId: line.orderLine.stockItemId, quantity: line.quantity, unitCost: line.orderLine.unitPrice })),
      });

      const dueDate = addDays(input.receivedOn, order.paymentTermDays);
      await recordAudit(tx, {
        hotelId,
        entity: 'GoodsReceipt',
        entityId: receiptId,
        action: 'CREATE',
        after: {
          number,
          order: order.number,
          supplier: order.supplier.name,
          waybillNumber: input.waybillNumber,
          warehouse: warehouse.name,
          receivedOn: input.receivedOn,
          grandTotal: money(plan.totals.total),
          dueDate,
          orderStatus: status,
          lines: plan.lines.slice(0, 40).map((line) => `${line.orderLine.name} ${line.quantity.toString()}`),
          costs: stock.slice(0, 40).map((item) => `${item.name}: ${item.costBefore} → ${item.costAfter}`),
        },
      });
      await stage('purchase.goods.received', {
        hotelId,
        receiptId,
        orderId,
        supplierId: order.supplierId,
        netTotal: money(plan.totals.net),
        taxTotal: money(plan.totals.tax),
        grandTotal: money(plan.totals.total),
        currency: order.currency,
        dueDate,
      });
      await stage('purchase.order.changed', { hotelId, orderId, change: status === 'CLOSED' ? 'CLOSED' : 'RECEIVED' });
      await stage('stock.changed', { hotelId, change: 'RECEIPT', stockItemIds: stock.map((item) => item.stockItemId) });
      return receiptId;
    });
    return getReceipt(hotelId, id);
  } catch (error) {
    rethrowPrismaError(error);
  }
}
