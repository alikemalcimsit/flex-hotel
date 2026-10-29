import { toDecimal } from '@hotelos/core';
import { STOCK_QUANTITY_SCALE } from '@hotelos/hotel-contracts';
import { lockStockItems } from '../../lib/locks.js';
import { sqlTimestamp } from '../../lib/sql-time.js';
import { STOCK_COST_SCALE, applyReceipts } from './rules.js';

/**
 * Stok girişi (modül 45; 44 çıkış / transfer / sayımı bunun yanına yazar).
 *
 * Tek transaction içinde, çağıranın kilitlerinden sonra (sıra: sipariş → depo → malzeme kartı):
 * 1. Malzeme kartları kimlik sırasıyla kilitlenir (aynı malzemeye eşzamanlı iki giriş ortalamayı
 *    birbirinin eski değerinden hesaplayamaz).
 * 2. Her malzemenin girişleri belgedeki sırayla hareketli ortalamaya işlenir (`applyReceipts`).
 * 3. Kart (toplam mevcut, birim maliyet), depo satırı (tek ifadede upsert) ve değişmez hareket
 *    kayıtları (hareket sonrası mevcut ve ortalama maliyetle) yazılır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{
 *   hotelId: string, warehouseId: string, kind: 'RECEIPT', sourceType: string, sourceId: string,
 *   occurredAt: Date, actor: string, note?: string | null,
 *   lines: Array<{ stockItemId: string, quantity: import('@hotelos/core').Decimal, unitCost: string }>,
 * }} input
 * @returns {Promise<Array<{ stockItemId: string, name: string, onHandBefore: string, onHandAfter: string, costBefore: string, costAfter: string }>>}
 */
export async function postStockIn(tx, { hotelId, warehouseId, kind, sourceType, sourceId, occurredAt, actor, note = null, lines }) {
  const itemIds = [...new Set(lines.map((line) => line.stockItemId))];
  const locked = await lockStockItems(tx, hotelId, itemIds);
  if (locked.size !== itemIds.length) throw new Error('Stok girişinde malzeme kartı bulunamadı');
  const items = await tx.stockItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, onHand: true, unitCost: true } });
  const byId = new Map(items.map((item) => [item.id, item]));

  const now = new Date();
  const movements = [];
  const summary = [];
  /** @type {Map<string, import('@hotelos/core').Decimal>} */
  const levelDelta = new Map();
  for (const itemId of itemIds) {
    const item = byId.get(itemId);
    const entries = lines.filter((line) => line.stockItemId === itemId);
    const result = applyReceipts({ onHand: String(item.onHand), unitCost: String(item.unitCost) }, entries.map((entry) => ({ quantity: entry.quantity, price: entry.unitCost })));
    entries.forEach((entry, index) => {
      const step = result.steps[index];
      movements.push({
        hotelId,
        kind,
        stockItemId: itemId,
        warehouseId,
        quantity: entry.quantity.toFixed(STOCK_QUANTITY_SCALE),
        unitCost: toDecimal(entry.unitCost).toFixed(STOCK_COST_SCALE),
        totalCost: entry.quantity.times(toDecimal(entry.unitCost)).toFixed(2),
        onHandAfter: step.onHandAfter.toFixed(STOCK_QUANTITY_SCALE),
        avgCostAfter: step.avgCostAfter.toFixed(STOCK_COST_SCALE),
        sourceType,
        sourceId,
        note,
        occurredAt,
        createdBy: actor,
      });
    });
    const added = entries.reduce((total, entry) => total.plus(entry.quantity), toDecimal(0));
    levelDelta.set(itemId, added);
    await tx.stockItem.update({
      where: { id: itemId },
      data: { onHand: result.onHand.toFixed(STOCK_QUANTITY_SCALE), unitCost: result.unitCost.toFixed(STOCK_COST_SCALE), costUpdatedAt: now },
    });
    summary.push({
      stockItemId: itemId,
      name: item.name,
      onHandBefore: toDecimal(String(item.onHand)).toString(),
      onHandAfter: result.onHand.toString(),
      costBefore: toDecimal(String(item.unitCost)).toFixed(STOCK_COST_SCALE),
      costAfter: result.unitCost.toFixed(STOCK_COST_SCALE),
    });
  }

  // Depo satırları tek ifadede: yoksa açılır, varsa artırılır.
  const levelIds = [...levelDelta.keys()];
  const levelQuantities = levelIds.map((id) => levelDelta.get(id).toFixed(STOCK_QUANTITY_SCALE));
  await tx.$executeRaw`
    INSERT INTO "StockLevel" ("id", "hotelId", "warehouseId", "stockItemId", "quantity", "updatedAt")
    SELECT gen_random_uuid()::text, ${hotelId}, ${warehouseId}, v."stockItemId", v."quantity", ${sqlTimestamp(now)}
    FROM unnest(${levelIds}::text[], ${levelQuantities}::numeric[]) AS v("stockItemId", "quantity")
    ON CONFLICT ("warehouseId", "stockItemId") DO UPDATE SET "quantity" = "StockLevel"."quantity" + EXCLUDED."quantity", "updatedAt" = EXCLUDED."updatedAt"`;
  await tx.stockMovement.createMany({ data: movements });
  return summary;
}
