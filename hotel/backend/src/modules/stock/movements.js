import { toDecimal } from '@hotelos/core';
import { KITCHEN_UNIT_LABELS, STOCK_QUANTITY_SCALE } from '@hotelos/hotel-contracts';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { lockStockItems } from '../../lib/locks.js';
import { sqlTimestamp } from '../../lib/sql-time.js';
import { STOCK_COST_SCALE, applyDelta, applyReceipts } from './rules.js';

/**
 * Stok girişi (modül 45); giriş dışı hareketler (modül 44) aşağıda `postStockMovements`.
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

/* ─────────────── Modül 44: giriş dışı hareketler ─────────────── */

/**
 * Çıkış / fire / transfer (çıkan ya da giren tarafı) / sayım farkı / satış düşümü: miktar işaretli,
 * **birim maliyet değişmez** (o anki hareketli ortalamayla değerlenir). Transfer iki çağrıdır: kaynakta eksi
 * (`TRANSFER_OUT`), hedefte artı (`TRANSFER_IN`) — kartın toplam mevcudu değişmez, depo satırları değişir.
 *
 * Aynı transaction içinde, çağıranın kilitlerinden sonra (sıra: belge → depo → malzeme kartı):
 * 1. Kartlar kimlik sırasıyla kilitlenir; depo satırları okunur.
 * 2. `allowNegative` değilse çıkış depodaki mevcuttan fazla olamaz (satış düşümü eksiye iner: adisyon
 *    kapandı, stok kaydı geride kalmış olabilir — sayım düzeltir).
 * 3. Kart mevcudu, depo satırı (tek ifadede upsert) ve değişmez hareket kayıtları yazılır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{
 *   hotelId: string, warehouseId: string, kind: 'ISSUE' | 'WASTE' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'COUNT_ADJUST' | 'SALE',
 *   sourceType: string, sourceId: string, occurredAt: Date, actor: string, note?: string | null, allowNegative?: boolean,
 *   lines: Array<{ stockItemId: string, quantity: import('@hotelos/core').Decimal, menuItemId?: string | null }>,
 * }} input
 * @returns {Promise<Array<{ stockItemId: string, name: string, unit: string, quantity: string, onHandBefore: string, onHandAfter: string, levelBefore: string, levelAfter: string, totalCost: string }>>}
 */
export async function postStockMovements(tx, { hotelId, warehouseId, kind, sourceType, sourceId, occurredAt, actor, note = null, allowNegative = false, lines }) {
  const itemIds = [...new Set(lines.map((line) => line.stockItemId))];
  const locked = await lockStockItems(tx, hotelId, itemIds);
  if (locked.size !== itemIds.length) throw new NotFoundError('Malzeme kartı bulunamadı');
  const [items, levels] = await Promise.all([
    tx.stockItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, unit: true, onHand: true, unitCost: true } }),
    tx.stockLevel.findMany({ where: { warehouseId, stockItemId: { in: itemIds } }, select: { stockItemId: true, quantity: true } }),
  ]);
  const byId = new Map(items.map((item) => [item.id, item]));
  const levelOf = new Map(levels.map((level) => [level.stockItemId, toDecimal(String(level.quantity))]));

  const now = new Date();
  const movements = [];
  const summary = [];
  /** @type {Record<string, string>} */
  const shortages = {};
  /** @type {Map<string, import('@hotelos/core').Decimal>} */
  const levelDelta = new Map();
  for (const itemId of itemIds) {
    const item = byId.get(itemId);
    const entries = lines.filter((line) => line.stockItemId === itemId);
    const total = entries.reduce((sum, entry) => sum.plus(entry.quantity), toDecimal(0));
    const levelBefore = levelOf.get(itemId) ?? toDecimal(0);
    const levelAfter = levelBefore.plus(total).toDecimalPlaces(STOCK_QUANTITY_SCALE);
    if (!allowNegative && levelAfter.isNegative()) {
      shortages[itemId] = `${item.name}: depoda ${levelBefore.toString()} ${KITCHEN_UNIT_LABELS[item.unit] ?? item.unit} var, ${total.abs().toString()} çıkılamaz`;
      continue;
    }
    let onHand = toDecimal(String(item.onHand));
    const unitCost = toDecimal(String(item.unitCost));
    let costSum = toDecimal(0);
    for (const entry of entries) {
      const step = applyDelta({ onHand, unitCost }, entry.quantity);
      onHand = step.onHand;
      costSum = costSum.plus(step.totalCost);
      movements.push({
        hotelId,
        kind,
        stockItemId: itemId,
        warehouseId,
        quantity: entry.quantity.toFixed(STOCK_QUANTITY_SCALE),
        unitCost: unitCost.toFixed(STOCK_COST_SCALE),
        totalCost: step.totalCost.toFixed(2),
        onHandAfter: onHand.toFixed(STOCK_QUANTITY_SCALE),
        avgCostAfter: unitCost.toFixed(STOCK_COST_SCALE),
        sourceType,
        sourceId,
        menuItemId: entry.menuItemId ?? null,
        note,
        occurredAt,
        createdBy: actor,
      });
    }
    levelDelta.set(itemId, total);
    await tx.stockItem.update({ where: { id: itemId }, data: { onHand: onHand.toFixed(STOCK_QUANTITY_SCALE) } });
    summary.push({
      stockItemId: itemId,
      name: item.name,
      unit: item.unit,
      quantity: total.toString(),
      onHandBefore: toDecimal(String(item.onHand)).toString(),
      onHandAfter: onHand.toString(),
      levelBefore: levelBefore.toString(),
      levelAfter: levelAfter.toString(),
      totalCost: costSum.toFixed(2),
    });
  }
  const shortageList = Object.values(shortages);
  if (shortageList.length) {
    throw new ConflictError(`Depoda yeterli stok yok — ${shortageList[0]}${shortageList.length > 1 ? ` (+${shortageList.length - 1})` : ''}`, 'INSUFFICIENT_STOCK', { fields: shortages });
  }

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
