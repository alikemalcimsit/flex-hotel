import { currentActor, toDecimal } from '@hotelos/core';
import { KITCHEN_UNIT_LABELS, MAX_STOCK_COUNT_LINES } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockWarehouses } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { writeWithEvents } from '../../lib/write.js';
import { hotelContext } from '../banquet/shared.js';
import { nextNumber } from '../purchasing/shared.js';
import { postStockMovements } from './movements.js';
import { STOCK_COST_SCALE, countDifference } from './rules.js';

/**
 * Stok sayımı (modül 44).
 *
 * - **Açılış:** depodaki mevcudu sıfır olmayan malzemeler o anki miktar ve ortalama maliyetle "beklenen" olarak
 *   dondurulur (sayım sürerken giren mal listeyi kaydırmaz). Listede olmayan malzeme sayarken eklenir
 *   (beklenen = o anki depo mevcudu, çoğu zaman 0). Depoda aynı anda **tek açık sayım** (kısmi tekil indeks).
 * - **Sayma:** sayılan miktarlar girilir (boş = sayılmadı); sayım ekranının gördüğü sürümle (iki sayımcı aynı anda
 *   yazarsa ikincisi güncel listeyi görür).
 * - **Onay:** sayılan her satır için fark = sayılan − **onay anındaki** depo mevcudu; sıfır olmayan fark
 *   `COUNT_ADJUST` hareketi olur (o anki ortalama maliyetle; maliyet değişmez). Sayılmayan satıra dokunulmaz.
 *   Fazla da eksik de yalnız onayla stoğa işler; iptal edilen sayım hiçbir şey değiştirmez.
 *
 * Kilit sırası: depo (paylaşımlı) → sayım (satırı `FOR UPDATE`) → malzeme kartları (postStockMovements).
 */

const SOURCE_TYPE = 'StockCount';
const NUMBER_PREFIX = 'SYM';
/** Tam sayı birimler (adet, gram, mililitre). */
const WHOLE_UNITS = Object.freeze(['PIECE', 'G', 'ML']);

/** @param {Date | null | undefined} value */
const iso = (value) => (value ? value.toISOString() : null);
/** @param {unknown} value */
const plain = (value) => (value === null || value === undefined ? null : toDecimal(String(value)).toString());
/** @param {unknown} value */
const money = (value) => toDecimal(String(value ?? 0)).toFixed(2);

const COUNT_SELECT = Object.freeze({
  id: true,
  number: true,
  status: true,
  note: true,
  openedBy: true,
  openedAt: true,
  approvedBy: true,
  approvedAt: true,
  cancelledBy: true,
  cancelledAt: true,
  cancelReason: true,
  adjustedLines: true,
  adjustedValue: true,
  updatedAt: true,
  warehouse: { select: { id: true, name: true } },
});

/** Sayımların satır özetleri. @param {any} client @param {string[]} countIds */
async function lineTotals(client, countIds) {
  if (countIds.length === 0) return new Map();
  const rows = await client.$queryRaw`
    SELECT "countId", COUNT(*)::int AS "lines", COUNT(*) FILTER (WHERE "countedQuantity" IS NOT NULL)::int AS "counted",
           COUNT(*) FILTER (WHERE "countedQuantity" IS NOT NULL AND "countedQuantity" <> "expectedQuantity")::int AS "differing"
    FROM "StockCountLine" WHERE "countId" = ANY(${countIds}::text[]) GROUP BY "countId"`;
  const byId = new Map(rows.map((row) => [row.countId, row]));
  return new Map(countIds.map((id) => [id, { lines: byId.get(id)?.lines ?? 0, counted: byId.get(id)?.counted ?? 0, differing: byId.get(id)?.differing ?? 0 }]));
}

/** @param {any} row @param {{ lines: number, counted: number, differing: number }} totals */
const countDto = (row, totals) => ({
  id: row.id,
  number: row.number,
  status: row.status,
  warehouse: row.warehouse,
  note: row.note,
  openedBy: row.openedBy,
  openedAt: iso(row.openedAt),
  approvedBy: row.approvedBy,
  approvedAt: iso(row.approvedAt),
  cancelledBy: row.cancelledBy,
  cancelledAt: iso(row.cancelledAt),
  cancelReason: row.cancelReason,
  adjustedLines: row.adjustedLines,
  adjustedValue: money(row.adjustedValue),
  lines: totals.lines,
  counted: totals.counted,
  differing: totals.differing,
  updatedAt: iso(row.updatedAt),
});

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, status?: string }} query
 */
export async function listCounts(hotelId, query) {
  const where = { hotelId, ...(query.status ? { status: query.status } : {}) };
  const [rows, total] = await Promise.all([
    prisma.stockCount.findMany({ where, select: COUNT_SELECT, orderBy: [{ openedAt: 'desc' }, { id: 'desc' }], ...toSkipTake(query) }),
    prisma.stockCount.count({ where }),
  ]);
  const totals = await lineTotals(prisma, rows.map((row) => row.id));
  return buildPage(rows.map((row) => countDto(row, totals.get(row.id))), total, query);
}

/**
 * Sayım ekranı: başlık + satırlar (ad sırası). Açık sayımda satırın "şu anki" depo mevcudu da gelir (onayda fark
 * buna göre yazılacak); onaylanmışta yazılan fark.
 * @param {string} hotelId @param {string} countId
 */
export async function getCount(hotelId, countId) {
  const row = await prisma.stockCount.findFirst({ where: { id: countId, hotelId }, select: COUNT_SELECT });
  if (!row) throw new NotFoundError('Sayım bulunamadı');
  const lines = await prisma.stockCountLine.findMany({
    where: { countId },
    orderBy: [{ stockItem: { name: 'asc' } }, { sortOrder: 'asc' }],
    select: { id: true, stockItemId: true, expectedQuantity: true, countedQuantity: true, differenceQuantity: true, unitCost: true, stockItem: { select: { code: true, name: true, unit: true, group: true } } },
  });
  const levels = row.status === 'OPEN' && lines.length
    ? await prisma.stockLevel.findMany({ where: { warehouseId: row.warehouse.id, stockItemId: { in: lines.map((line) => line.stockItemId) } }, select: { stockItemId: true, quantity: true } })
    : [];
  const levelOf = new Map(levels.map((level) => [level.stockItemId, plain(level.quantity)]));
  const totals = await lineTotals(prisma, [row.id]);
  return {
    ...countDto(row, totals.get(row.id)),
    lines: lines.map((line) => {
      const current = row.status === 'OPEN' ? levelOf.get(line.stockItemId) ?? '0' : null;
      const counted = line.countedQuantity === null ? null : String(line.countedQuantity);
      // Onaylanmışta yazılan fark; açıkta şu anki mevcuda göre önizleme (sayılmamış satırda yok).
      let difference = null;
      if (line.differenceQuantity !== null) difference = plain(line.differenceQuantity);
      else if (row.status === 'OPEN' && counted !== null) difference = (countDifference(counted, current) ?? toDecimal(0)).toString();
      return {
        id: line.id,
        stockItemId: line.stockItemId,
        code: line.stockItem.code,
        name: line.stockItem.name,
        unit: line.stockItem.unit,
        group: line.stockItem.group,
        expectedQuantity: plain(line.expectedQuantity),
        currentQuantity: current,
        countedQuantity: counted === null ? null : plain(counted),
        differenceQuantity: difference,
        unitCost: toDecimal(String(line.unitCost)).toFixed(STOCK_COST_SCALE),
        differenceValue: difference === null ? null : money(toDecimal(difference).times(toDecimal(String(line.unitCost)))),
      };
    }),
  };
}

/**
 * Sayım aç: deponun mevcutları dondurulur.
 * @param {string} hotelId @param {{ warehouseId: string, note: string | null }} input
 */
export async function createCount(hotelId, { warehouseId, note }) {
  const actor = currentActor();
  const { today } = await hotelContext(hotelId);
  try {
    const id = await writeWithEvents(async (tx, stage) => {
      if (!(await lockWarehouses(tx, hotelId, [warehouseId], { shared: true })).has(warehouseId)) throw new NotFoundError('Depo bulunamadı');
      const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId }, select: { name: true, isActive: true } });
      if (!warehouse.isActive) throw new ValidationError(`${warehouse.name} pasif; sayım açılamaz`, { fields: { warehouseId: 'Depo pasif' } });
      const open = await tx.stockCount.findFirst({ where: { hotelId, warehouseId, status: 'OPEN' }, select: { number: true } });
      if (open) throw new ConflictError(`${warehouse.name} için açık bir sayım var (${open.number}); önce onaylayın ya da iptal edin`, 'COUNT_ALREADY_OPEN');
      const levels = await tx.stockLevel.findMany({
        where: { warehouseId, quantity: { not: 0 } },
        orderBy: { stockItem: { name: 'asc' } },
        take: MAX_STOCK_COUNT_LINES,
        select: { stockItemId: true, quantity: true, stockItem: { select: { unitCost: true } } },
      });
      const number = await nextNumber(tx, hotelId, NUMBER_PREFIX, Number(today.slice(0, 4)));
      const count = await tx.stockCount.create({ data: { hotelId, number, warehouseId, status: 'OPEN', note, openedBy: actor }, select: { id: true } });
      if (levels.length) {
        await tx.stockCountLine.createMany({
          data: levels.map((level, index) => ({ hotelId, countId: count.id, stockItemId: level.stockItemId, expectedQuantity: level.quantity, unitCost: level.stockItem.unitCost, sortOrder: index })),
        });
      }
      await recordAudit(tx, { hotelId, entity: 'StockCount', entityId: count.id, action: 'CREATE', after: { number, warehouse: warehouse.name, lines: levels.length, note } });
      await stage('stock.changed', { hotelId, change: 'COUNT', stockItemIds: [] });
      return count.id;
    });
    return getCount(hotelId, id);
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu depo için açık bir sayım zaten var' });
  }
}

/**
 * Açık sayımı kilitler ve sürümünü denetler. @returns sayım satırı
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} countId @param {Date} expectedUpdatedAt
 */
async function lockOpenCount(tx, hotelId, countId, expectedUpdatedAt) {
  const [row] = await tx.$queryRaw`SELECT "id", "number", "status", "warehouseId", "updatedAt" FROM "StockCount" WHERE "id" = ${countId} AND "hotelId" = ${hotelId} FOR UPDATE`;
  if (!row) throw new NotFoundError('Sayım bulunamadı');
  if (row.status !== 'OPEN') throw new ConflictError(`Sayım ${row.number} ${row.status === 'APPROVED' ? 'onaylanmış' : 'iptal edilmiş'}; değiştirilemez`, 'COUNT_NOT_OPEN');
  if (new Date(row.updatedAt).getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError('Sayım bu arada değişti (başka bir sayımcı yazdı); liste yenilendi, tekrar deneyin.');
  return row;
}

/**
 * Sayılan miktarlar (boş = sayılmadı); listede olmayan malzeme eklenir (beklenen = şu anki depo mevcudu).
 * @param {string} hotelId @param {string} countId
 * @param {{ expectedUpdatedAt: Date, lines: Array<{ stockItemId: string, countedQuantity: string | null }> }} input
 */
export async function saveCountLines(hotelId, countId, { expectedUpdatedAt, lines }) {
  await writeWithEvents(async (tx, stage) => {
    const count = await lockOpenCount(tx, hotelId, countId, expectedUpdatedAt);
    const ids = [...new Set(lines.map((line) => line.stockItemId))];
    if (ids.length !== lines.length) throw new ValidationError('Aynı malzeme iki kez gönderilmiş', { fields: { lines: 'Aynı malzeme iki kez' } });
    const [items, existing, levels] = await Promise.all([
      tx.stockItem.findMany({ where: { hotelId, id: { in: ids } }, select: { id: true, name: true, unit: true, unitCost: true } }),
      tx.stockCountLine.findMany({ where: { countId }, select: { stockItemId: true, sortOrder: true } }),
      tx.stockLevel.findMany({ where: { warehouseId: count.warehouseId, stockItemId: { in: ids } }, select: { stockItemId: true, quantity: true } }),
    ]);
    const itemOf = new Map(items.map((item) => [item.id, item]));
    const known = new Set(existing.map((line) => line.stockItemId));
    const levelOf = new Map(levels.map((level) => [level.stockItemId, level.quantity]));
    /** @type {Record<string, string>} */
    const fields = {};
    lines.forEach((line, index) => {
      const item = itemOf.get(line.stockItemId);
      if (!item) fields[`lines.${index}.stockItemId`] = 'Malzeme bulunamadı';
      else if (line.countedQuantity !== null && WHOLE_UNITS.includes(item.unit) && !toDecimal(line.countedQuantity).isInteger()) fields[`lines.${index}.countedQuantity`] = `${item.name}: ${KITCHEN_UNIT_LABELS[item.unit]} tam sayı olmalı`;
    });
    const messages = Object.values(fields);
    if (messages.length) throw new ValidationError(`Sayımda düzeltilmesi gereken satırlar var: ${messages[0]}${messages.length > 1 ? ` (+${messages.length - 1})` : ''}`, { fields });
    const additions = lines.filter((line) => !known.has(line.stockItemId));
    if (existing.length + additions.length > MAX_STOCK_COUNT_LINES) throw new ValidationError(`Sayımda en fazla ${MAX_STOCK_COUNT_LINES} satır olur`);

    let sortOrder = existing.reduce((max, line) => Math.max(max, line.sortOrder), -1) + 1;
    for (const line of lines) {
      const item = itemOf.get(line.stockItemId);
      if (known.has(line.stockItemId)) {
        await tx.stockCountLine.updateMany({ where: { countId, stockItemId: line.stockItemId }, data: { countedQuantity: line.countedQuantity } });
      } else {
        await tx.stockCountLine.create({
          data: { hotelId, countId, stockItemId: line.stockItemId, expectedQuantity: levelOf.get(line.stockItemId) ?? 0, countedQuantity: line.countedQuantity, unitCost: item.unitCost, sortOrder: sortOrder++ },
        });
      }
    }
    // Sürüm damgası ilerler: eşzamanlı ikinci sayımcı güncel listeyi görür.
    await tx.stockCount.update({ where: { id: countId }, data: { updatedAt: new Date() } });
    await stage('stock.changed', { hotelId, change: 'COUNT', stockItemIds: [] });
  });
  return getCount(hotelId, countId);
}

/**
 * Onay: sayılan satırların farkı stoğa işler (`COUNT_ADJUST`), sayım kapanır.
 * @param {string} hotelId @param {string} countId @param {{ expectedUpdatedAt: Date }} input
 */
export async function approveCount(hotelId, countId, { expectedUpdatedAt }) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const head = await tx.stockCount.findFirst({ where: { id: countId, hotelId }, select: { warehouseId: true } });
    if (!head) throw new NotFoundError('Sayım bulunamadı');
    await lockWarehouses(tx, hotelId, [head.warehouseId], { shared: true });
    const count = await lockOpenCount(tx, hotelId, countId, expectedUpdatedAt);
    const warehouse = await tx.warehouse.findUnique({ where: { id: count.warehouseId }, select: { name: true } });
    const lines = await tx.stockCountLine.findMany({ where: { countId, countedQuantity: { not: null } }, select: { id: true, stockItemId: true, countedQuantity: true, stockItem: { select: { name: true } } } });
    if (lines.length === 0) throw new ValidationError('Hiç satır sayılmadı; onaylanacak fark yok (sayımı iptal edebilirsiniz)');
    const levels = await tx.stockLevel.findMany({ where: { warehouseId: count.warehouseId, stockItemId: { in: lines.map((line) => line.stockItemId) } }, select: { stockItemId: true, quantity: true } });
    const levelOf = new Map(levels.map((level) => [level.stockItemId, String(level.quantity)]));
    const adjustments = [];
    for (const line of lines) {
      const difference = countDifference(String(line.countedQuantity), levelOf.get(line.stockItemId) ?? '0');
      if (difference) adjustments.push({ lineId: line.id, stockItemId: line.stockItemId, name: line.stockItem.name, quantity: difference });
    }
    const now = new Date();
    const posted = adjustments.length
      ? await postStockMovements(tx, {
          hotelId,
          warehouseId: count.warehouseId,
          kind: 'COUNT_ADJUST',
          sourceType: SOURCE_TYPE,
          sourceId: countId,
          occurredAt: now,
          actor,
          note: `Sayım ${count.number}`,
          allowNegative: true,
          lines: adjustments.map((entry) => ({ stockItemId: entry.stockItemId, quantity: entry.quantity })),
        })
      : [];
    const costOf = new Map(posted.map((row) => [row.stockItemId, toDecimal(row.totalCost)]));
    const unitCosts = await tx.stockItem.findMany({ where: { id: { in: lines.map((line) => line.stockItemId) } }, select: { id: true, unitCost: true } });
    const unitCostOf = new Map(unitCosts.map((row) => [row.id, row.unitCost]));
    for (const line of lines) {
      const adjustment = adjustments.find((entry) => entry.lineId === line.id);
      await tx.stockCountLine.update({ where: { id: line.id }, data: { differenceQuantity: adjustment ? adjustment.quantity.toFixed(3) : '0', unitCost: unitCostOf.get(line.stockItemId) } });
    }
    const adjustedValue = adjustments.reduce((sum, entry) => sum.plus(costOf.get(entry.stockItemId) ?? 0), toDecimal(0));
    await tx.stockCount.update({ where: { id: countId }, data: { status: 'APPROVED', approvedBy: actor, approvedAt: now, adjustedLines: adjustments.length, adjustedValue: adjustedValue.toFixed(2) } });
    await recordAudit(tx, {
      hotelId,
      entity: 'StockCount',
      entityId: countId,
      action: 'UPDATE',
      before: { status: 'OPEN' },
      after: { status: 'APPROVED', warehouse: warehouse.name, counted: lines.length, adjusted: adjustments.length, adjustedValue: adjustedValue.toFixed(2), differences: adjustments.slice(0, 40).map((entry) => `${entry.name} ${entry.quantity.toString()}`) },
    });
    await stage('stock.changed', { hotelId, change: 'COUNT', stockItemIds: adjustments.map((entry) => entry.stockItemId) });
  });
  return getCount(hotelId, countId);
}

/**
 * İptal: hiçbir şey stoğa işlemez.
 * @param {string} hotelId @param {string} countId @param {{ expectedUpdatedAt: Date, reason: string }} input
 */
export async function cancelCount(hotelId, countId, { expectedUpdatedAt, reason }) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const count = await lockOpenCount(tx, hotelId, countId, expectedUpdatedAt);
    await tx.stockCount.update({ where: { id: countId }, data: { status: 'CANCELLED', cancelledBy: actor, cancelledAt: new Date(), cancelReason: reason } });
    await recordAudit(tx, { hotelId, entity: 'StockCount', entityId: countId, action: 'UPDATE', before: { status: 'OPEN' }, after: { status: 'CANCELLED', number: count.number, reason } });
    await stage('stock.changed', { hotelId, change: 'COUNT', stockItemIds: [] });
  });
  return getCount(hotelId, countId);
}
