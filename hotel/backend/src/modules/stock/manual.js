import { currentActor, toDecimal } from '@hotelos/core';
import { KITCHEN_UNIT_LABELS, MANUAL_STOCK_MOVEMENT_KIND_LABELS } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { lockStockItems, lockWarehouses } from '../../lib/locks.js';
import { writeWithEvents } from '../../lib/write.js';
import { postStockMovements } from './movements.js';

/**
 * Elle stok hareketi (modül 44): çıkış (departman kullanımı), fire (sebep zorunlu), depolar arası transfer.
 *
 * - Miktar depodaki mevcuttan fazla olamaz (eksiye yalnız satış düşümü iner).
 * - Formun ürettiği `requestId` tekrar işleme anahtarıdır: aynı istek ikinci kez gelirse hareket yazılmaz, ilk
 *   sonucun özeti döner (`sourceType = 'ManualMovement'`, `sourceId = requestId`).
 * - Kilit sırası: depo(lar) paylaşımlı → malzeme kartları; tekrar denetimi kart kilidi altında (çift gönderim yarışı yok).
 */

/** Tam sayı birimler (adet, gram, mililitre). */
const WHOLE_UNITS = Object.freeze(['PIECE', 'G', 'ML']);
const SOURCE_TYPE = 'ManualMovement';

/**
 * @param {string} hotelId
 * @param {{ requestId: string, kind: 'ISSUE' | 'WASTE' | 'TRANSFER', warehouseId: string, toWarehouseId: string | null, note: string | null, lines: Array<{ stockItemId: string, quantity: string }> }} input
 * @returns {Promise<{ requestId: string, kind: string, duplicate: boolean, warehouse: { id: string, name: string }, toWarehouse: { id: string, name: string } | null, lines: Array<{ stockItemId: string, name: string, unit: string, quantity: string, levelAfter: string, totalCost: string }> }>}
 */
export async function createManualMovement(hotelId, input) {
  const actor = currentActor();
  const warehouseIds = [input.warehouseId, ...(input.toWarehouseId ? [input.toWarehouseId] : [])];
  const itemIds = [...new Set(input.lines.map((line) => line.stockItemId))];
  return writeWithEvents(async (tx, stage) => {
    // Sıra: depo (paylaşımlı) → kartlar. Tekrar denetimi kart kilidinden SONRA: aynı isteğin iki eşzamanlı kopyası
    // kilitte sıralanır, ikincisi ilkinin hareketini görür ve yeniden yazmaz.
    const locked = await lockWarehouses(tx, hotelId, warehouseIds, { shared: true });
    if (locked.size !== warehouseIds.length) throw new NotFoundError('Depo bulunamadı');
    await lockStockItems(tx, hotelId, itemIds);
    const existing = await tx.stockMovement.findMany({
      where: { hotelId, sourceType: SOURCE_TYPE, sourceId: input.requestId },
      select: { kind: true, stockItemId: true, warehouseId: true, quantity: true, totalCost: true, onHandAfter: true, stockItem: { select: { name: true, unit: true } }, warehouse: { select: { id: true, name: true } } },
    });
    if (existing.length) return replay(input, existing);

    const warehouses = await tx.warehouse.findMany({ where: { id: { in: warehouseIds } }, select: { id: true, name: true, isActive: true } });
    const warehouseOf = new Map(warehouses.map((row) => [row.id, row]));
    const inactive = warehouses.find((row) => !row.isActive);
    if (inactive) throw new ValidationError(`${inactive.name} pasif; hareket yapılamaz`, { fields: { warehouseId: 'Depo pasif' } });

    const items = await tx.stockItem.findMany({ where: { hotelId, id: { in: input.lines.map((line) => line.stockItemId) } }, select: { id: true, name: true, unit: true, isActive: true } });
    const itemOf = new Map(items.map((item) => [item.id, item]));
    /** @type {Record<string, string>} */
    const fields = {};
    input.lines.forEach((line, index) => {
      const item = itemOf.get(line.stockItemId);
      if (!item) fields[`lines.${index}.stockItemId`] = 'Malzeme bulunamadı';
      else if (!item.isActive) fields[`lines.${index}.stockItemId`] = `${item.name} pasif`;
      else if (WHOLE_UNITS.includes(item.unit) && !toDecimal(line.quantity).isInteger()) fields[`lines.${index}.quantity`] = `${item.name}: ${KITCHEN_UNIT_LABELS[item.unit]} tam sayı olmalı`;
    });
    const messages = Object.values(fields);
    if (messages.length) throw new ValidationError(`Harekette düzeltilmesi gereken satırlar var: ${messages[0]}${messages.length > 1 ? ` (+${messages.length - 1})` : ''}`, { fields });

    const occurredAt = new Date();
    const common = { hotelId, sourceType: SOURCE_TYPE, sourceId: input.requestId, occurredAt, actor, note: input.note };
    const outLines = input.lines.map((line) => ({ stockItemId: line.stockItemId, quantity: toDecimal(line.quantity).negated() }));
    const outKind = input.kind === 'TRANSFER' ? 'TRANSFER_OUT' : input.kind;
    const out = await postStockMovements(tx, { ...common, warehouseId: input.warehouseId, kind: outKind, lines: outLines });
    const toWarehouse = input.toWarehouseId ? warehouseOf.get(input.toWarehouseId) : null;
    const inbound = toWarehouse
      ? await postStockMovements(tx, { ...common, warehouseId: toWarehouse.id, kind: 'TRANSFER_IN', lines: input.lines.map((line) => ({ stockItemId: line.stockItemId, quantity: toDecimal(line.quantity) })) })
      : [];
    const inboundOf = new Map(inbound.map((row) => [row.stockItemId, row]));

    const warehouse = warehouseOf.get(input.warehouseId);
    await recordAudit(tx, {
      hotelId,
      entity: 'StockMovement',
      entityId: input.requestId,
      action: 'CREATE',
      after: {
        kind: MANUAL_STOCK_MOVEMENT_KIND_LABELS[input.kind],
        warehouse: warehouse.name,
        toWarehouse: toWarehouse?.name ?? null,
        note: input.note,
        lines: out.slice(0, 40).map((row) => `${row.name} ${toDecimal(row.quantity).abs().toString()}`),
      },
    });
    await stage('stock.changed', { hotelId, change: 'MOVEMENT', stockItemIds: out.map((row) => row.stockItemId) });
    return {
      requestId: input.requestId,
      kind: input.kind,
      duplicate: false,
      warehouse: { id: warehouse.id, name: warehouse.name },
      toWarehouse: toWarehouse ? { id: toWarehouse.id, name: toWarehouse.name } : null,
      lines: out.map((row) => ({
        stockItemId: row.stockItemId,
        name: row.name,
        unit: row.unit,
        quantity: toDecimal(row.quantity).abs().toString(),
        levelAfter: row.levelAfter,
        toLevelAfter: inboundOf.get(row.stockItemId)?.levelAfter ?? null,
        totalCost: toDecimal(row.totalCost).abs().toFixed(2),
      })),
    };
  });
}

/**
 * Aynı istek daha önce işlenmiş: hareketlerden özet (çift gönderim hata değil, aynı cevap).
 * @param {{ requestId: string, kind: string, warehouseId: string, toWarehouseId: string | null }} input
 * @param {any[]} movements
 */
function replay(input, movements) {
  const outbound = movements.filter((row) => row.kind !== 'TRANSFER_IN');
  const inbound = new Map(movements.filter((row) => row.kind === 'TRANSFER_IN').map((row) => [row.stockItemId, row]));
  const source = outbound[0]?.warehouse ?? null;
  const target = inbound.values().next().value?.warehouse ?? null;
  return {
    requestId: input.requestId,
    kind: input.kind,
    duplicate: true,
    warehouse: source ? { id: source.id, name: source.name } : { id: input.warehouseId, name: '' },
    toWarehouse: target ? { id: target.id, name: target.name } : null,
    lines: outbound.map((row) => ({
      stockItemId: row.stockItemId,
      name: row.stockItem.name,
      unit: row.stockItem.unit,
      quantity: toDecimal(String(row.quantity)).abs().toString(),
      levelAfter: null,
      toLevelAfter: null,
      totalCost: toDecimal(String(row.totalCost)).abs().toFixed(2),
    })),
  };
}

export { prisma };
