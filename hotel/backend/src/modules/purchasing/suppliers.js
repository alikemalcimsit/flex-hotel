import { currentActor } from '@hotelos/core';
import { recordAudit } from '../../lib/audit.js';
import { NotFoundError, StaleWriteError, rethrowPrismaError } from '../../lib/errors.js';
import { lockSuppliers } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { containsText, searchTokens } from '../../lib/search.js';
import { writeWithEvents } from '../../lib/write.js';
import { dayText, iso, money, prisma } from './shared.js';

/**
 * Tedarikçi kartı (modül 45): vergi bilgisi, ödeme vadesi (mal kabulden itibaren; tedarikçi borcunun
 * vadesi), olağan termin (teklifte varsayılan), tedarik ettiği malzeme grupları (teklif turunda öneri).
 * Ad ve vergi no otelde tek (veritabanı kısıtı); pasif tedarikçi yeni teklife / kazanana alınmaz,
 * açık siparişleri sürer.
 */

/** Liste satırında gösterilen son siparişler. */
const SUPPLIER_RECENT_ORDERS = 10;
/** Teslim bekleyen sipariş durumları (kartta "açık sipariş"). */
const OPEN_ORDER_STATUSES = Object.freeze(['PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED']);

const SUPPLIER_SELECT = Object.freeze({
  id: true,
  code: true,
  name: true,
  contactName: true,
  phone: true,
  email: true,
  taxOffice: true,
  taxNumber: true,
  address: true,
  paymentTermDays: true,
  leadTimeDays: true,
  groups: true,
  notes: true,
  isActive: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {any} row */
const toDto = (row) => ({ ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) });

/** @param {any} input */
const toData = (input) => ({
  code: input.code ?? null,
  name: input.name,
  contactName: input.contactName ?? null,
  phone: input.phone ?? null,
  email: input.email ?? null,
  taxOffice: input.taxOffice ?? null,
  taxNumber: input.taxNumber ?? null,
  address: input.address ?? null,
  paymentTermDays: input.paymentTermDays,
  leadTimeDays: input.leadTimeDays,
  groups: [...new Set(input.groups ?? [])],
  notes: input.notes ?? null,
});

/**
 * Tedarikçi adı / kodu / vergi no / yetkili kelimeyi içeren kayıtlar (trigram index: ad).
 * @param {string} token
 */
const supplierTokenWhere = (token) => ({
  OR: [{ name: containsText(token) }, { code: containsText(token) }, { taxNumber: { startsWith: token } }, { contactName: containsText(token) }],
});

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string, group?: string, active?: boolean }} query
 */
export async function listSuppliers(hotelId, query) {
  /** @type {Record<string, any>} */
  const where = { hotelId };
  if (query.active !== undefined) where.isActive = query.active;
  if (query.group) where.groups = { has: query.group };
  const tokens = searchTokens(query.search);
  if (tokens.length) where.AND = tokens.map(supplierTokenWhere);
  const [rows, total] = await Promise.all([
    prisma.supplier.findMany({ where, orderBy: [{ isActive: 'desc' }, { name: 'asc' }, { id: 'asc' }], ...toSkipTake(query), select: SUPPLIER_SELECT }),
    prisma.supplier.count({ where }),
  ]);
  const ids = rows.map((row) => row.id);
  const stats = ids.length
    ? await prisma.$queryRaw`
        SELECT "supplierId",
               COUNT(*) FILTER (WHERE "status"::text = ANY(${[...OPEN_ORDER_STATUSES]}::text[]))::int AS "openOrders",
               MAX("createdAt") AS "lastOrderAt"
        FROM "PurchaseOrder" WHERE "hotelId" = ${hotelId} AND "supplierId" = ANY(${ids}::text[]) GROUP BY "supplierId"`
    : [];
  const byId = new Map(stats.map((row) => [row.supplierId, row]));
  return buildPage(
    rows.map((row) => ({ ...toDto(row), openOrders: byId.get(row.id)?.openOrders ?? 0, lastOrderAt: iso(byId.get(row.id)?.lastOrderAt ?? null) })),
    total,
    query,
  );
}

/** @param {string} hotelId @param {string} supplierId */
export async function getSupplier(hotelId, supplierId) {
  const row = await prisma.supplier.findFirst({ where: { id: supplierId, hotelId }, select: SUPPLIER_SELECT });
  if (!row) throw new NotFoundError('Tedarikçi bulunamadı');
  const [orders, [totals]] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { hotelId, supplierId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: SUPPLIER_RECENT_ORDERS,
      select: { id: true, number: true, status: true, expectedOn: true, grandTotal: true, receivedTotal: true, createdAt: true },
    }),
    prisma.$queryRaw`
      SELECT COUNT(*) FILTER (WHERE "status"::text = ANY(${[...OPEN_ORDER_STATUSES]}::text[]))::int AS "openOrders",
             COALESCE(SUM("receivedTotal"), 0)::text AS "receivedTotal"
      FROM "PurchaseOrder" WHERE "hotelId" = ${hotelId} AND "supplierId" = ${supplierId}`,
  ]);
  return {
    ...toDto(row),
    openOrders: totals.openOrders,
    receivedTotal: money(totals.receivedTotal),
    recentOrders: orders.map((order) => ({
      id: order.id,
      number: order.number,
      status: order.status,
      expectedOn: dayText(order.expectedOn),
      grandTotal: money(order.grandTotal),
      receivedTotal: money(order.receivedTotal),
      createdAt: iso(order.createdAt),
    })),
  };
}

/** @param {string} hotelId @param {any} input `createSupplierSchema` */
export async function createSupplier(hotelId, input) {
  const actor = currentActor();
  try {
    const id = await writeWithEvents(async (tx, stage) => {
      const row = await tx.supplier.create({ data: { hotelId, ...toData(input), createdBy: actor }, select: { id: true } });
      await recordAudit(tx, { hotelId, entity: 'Supplier', entityId: row.id, action: 'CREATE', after: toData(input) });
      await stage('purchase.supplier.changed', { hotelId, supplierId: row.id, change: 'CREATED' });
      return row.id;
    });
    return getSupplier(hotelId, id);
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/** @param {string} hotelId @param {string} supplierId @param {any} input `updateSupplierSchema` */
export async function updateSupplier(hotelId, supplierId, input) {
  try {
    await writeWithEvents(async (tx, stage) => {
      if (!(await lockSuppliers(tx, hotelId, [supplierId])).has(supplierId)) throw new NotFoundError('Tedarikçi bulunamadı');
      const before = await tx.supplier.findUnique({ where: { id: supplierId }, select: SUPPLIER_SELECT });
      if (before.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new StaleWriteError();
      const data = { ...toData(input), isActive: input.isActive };
      await tx.supplier.update({ where: { id: supplierId }, data });
      const { createdAt, updatedAt, createdBy, id, ...previous } = before;
      await recordAudit(tx, { hotelId, entity: 'Supplier', entityId: supplierId, action: 'UPDATE', before: previous, after: data });
      await stage('purchase.supplier.changed', { hotelId, supplierId, change: 'UPDATED' });
    });
    return getSupplier(hotelId, supplierId);
  } catch (error) {
    rethrowPrismaError(error);
  }
}
