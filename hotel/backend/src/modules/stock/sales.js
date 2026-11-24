import { toDecimal } from '@hotelos/core';
import { prisma } from '../../db.js';
import { ConflictError } from '../../lib/errors.js';
import { lockWarehouses } from '../../lib/locks.js';
import { writeWithEvents } from '../../lib/write.js';
import { loadRecipeGraph } from '../recipes/graph.js';
import { demandCalculator } from '../recipes/rules.js';
import { postStockMovements } from './movements.js';
import { saleDeltas, saleRequirements } from './rules.js';
import { warehouseForOutlet } from './settings.js';

/**
 * Satış düşümü (modül 44): kapanan adisyonun (`fnb.order.paid`) ürünleri reçetelerinden malzemeye açılır ve
 * satış noktasının deposundan düşülür (`SALE`, ürün kimliğiyle — ürün bazlı maliyet raporu).
 *
 * - **Hangi depo:** `Hotel.settings.stock.outletWarehouses` eşlemesi, yoksa varsayılan depo; depo yoksa iş kuralı
 *   hatası (aktör manuel göreve düşürür).
 * - **Ne düşer:** satılan + ikram + zayi (hazırlanıp iptal edilen) adet × reçetenin verim birimi başına ihtiyacı
 *   (ara reçeteler açılır, fire payı brüt). Reçetesi olmayan ürün ve sistem ürünleri (tepsi / paket ücreti) atlanır,
 *   özette sayılır. Stok eksiye inebilir (adisyon gerçek; kayıt geride kalmıştır — sayım düzeltir).
 * - **Yeniden yayın:** adisyon yeniden açılıp kapanırsa olay yeniden gelir; adisyon başına **son yayın** esastır:
 *   hedef tüketim − daha önce düşülen = düzeltme hareketi (artı ya da eksi). Daha yeni bir kapanış işlenmişse
 *   eski yayın atlanır (`occurredAt` = kapanış anı).
 *
 * Kilit sırası: depo (paylaşımlı) → malzeme kartları.
 */

const SOURCE_TYPE = 'PosCheck';

/**
 * @param {string} hotelId
 * @param {{ checkId: string, outletId: string, number: string, closedAt: string, items: Array<{ menuItemId: string, name: string, sold: number, comped: number, wasted: number }> }} payload
 * @returns {Promise<{ posted: boolean, skipped?: string, message: string, movements: number, skippedItems: string[], warehouse: string | null }>}
 */
export async function consumeSale(hotelId, payload) {
  const closedAt = new Date(payload.closedAt);
  return writeWithEvents(async (tx, stage) => {
    const warehouse = await warehouseForOutlet(tx, hotelId, payload.outletId);
    if (!warehouse) throw new ConflictError(`Adisyon ${payload.number}: stok düşülecek depo yok (önce bir depo tanımlayın)`, 'NO_WAREHOUSE');
    if (!warehouse.isActive) throw new ConflictError(`Adisyon ${payload.number}: ${warehouse.name} pasif; satış noktasını etkin bir depoya eşleyin`, 'WAREHOUSE_INACTIVE');
    await lockWarehouses(tx, hotelId, [warehouse.id], { shared: true });

    const existing = await tx.stockMovement.findMany({
      where: { hotelId, sourceType: SOURCE_TYPE, sourceId: payload.checkId, kind: 'SALE' },
      select: { menuItemId: true, stockItemId: true, quantity: true, occurredAt: true },
    });
    const newest = existing.reduce((max, row) => (row.occurredAt > max ? row.occurredAt : max), new Date(0));
    if (newest > closedAt) return { posted: false, skipped: 'Daha yeni kapanış işlenmiş', message: `Adisyon ${payload.number}: daha yeni kapanış zaten işlenmiş; eski yayın atlandı`, movements: 0, skippedItems: [], warehouse: warehouse.name };
    /** @type {Map<string, import('@hotelos/core').Decimal>} */
    const consumed = new Map();
    for (const row of existing) {
      const key = `${row.menuItemId}:${row.stockItemId}`;
      consumed.set(key, (consumed.get(key) ?? toDecimal(0)).minus(toDecimal(String(row.quantity))));
    }

    const menuItemIds = [...new Set(payload.items.map((item) => item.menuItemId))];
    const menuItems = menuItemIds.length
      ? await tx.menuItem.findMany({ where: { hotelId, id: { in: menuItemIds } }, select: { id: true, system: true, recipe: { select: { id: true, isActive: true } } } })
      : [];
    const recipeOf = new Map(menuItems.filter((item) => item.system === null && item.recipe).map((item) => [item.id, item.recipe.id]));
    const graph = recipeOf.size ? await loadRecipeGraph(tx, hotelId, recipeOf.values()) : { recipes: new Map(), stockItems: new Map() };
    const demand = demandCalculator(graph);
    /** @type {Map<string, { recipeId: string, perUnit: Map<string, import('@hotelos/core').Decimal> }>} */
    const recipesByMenuItem = new Map();
    for (const [menuItemId, recipeId] of recipeOf) {
      const need = demand(recipeId);
      recipesByMenuItem.set(menuItemId, { recipeId, perUnit: new Map([...need.stock].map(([stockItemId, entry]) => [stockItemId, entry.perUnit])) });
    }
    const systemItems = menuItems.filter((item) => item.system !== null).map((item) => item.id);
    const { required, skipped } = saleRequirements(payload.items.filter((item) => !systemItems.includes(item.menuItemId)), recipesByMenuItem);
    const deltas = saleDeltas(required, consumed);
    if (deltas.length === 0) {
      return { posted: false, skipped: 'Düşülecek malzeme yok', message: skipped.length ? `Adisyon ${payload.number}: reçetesi olmayan ${skipped.length} ürün atlandı, düşülecek malzeme yok` : `Adisyon ${payload.number}: stok etkisi yok`, movements: 0, skippedItems: skipped, warehouse: warehouse.name };
    }
    const posted = await postStockMovements(tx, {
      hotelId,
      warehouseId: warehouse.id,
      kind: 'SALE',
      sourceType: SOURCE_TYPE,
      sourceId: payload.checkId,
      occurredAt: closedAt,
      actor: 'inventory-worker',
      note: `Adisyon ${payload.number}`,
      allowNegative: true,
      lines: deltas.map((delta) => ({ stockItemId: delta.stockItemId, menuItemId: delta.menuItemId, quantity: delta.quantity })),
    });
    await stage('stock.changed', { hotelId, change: 'SALE', stockItemIds: posted.map((row) => row.stockItemId) });
    const correction = existing.length > 0;
    return {
      posted: true,
      message: `Adisyon ${payload.number}: ${posted.length} malzeme ${warehouse.name} deposundan ${correction ? 'düzeltildi' : 'düşüldü'}${skipped.length ? ` (reçetesiz ${skipped.length} ürün atlandı)` : ''}`,
      movements: deltas.length,
      skippedItems: skipped,
      warehouse: warehouse.name,
    };
  });
}

export { prisma };
