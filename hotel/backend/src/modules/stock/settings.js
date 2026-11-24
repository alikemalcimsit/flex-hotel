import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { cache } from '../../lib/cache.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';

/**
 * Stok ayarları (modül 44), `Hotel.settings.stock` (Json; yeni kolon yok — modül 34'ün yield kalıbı):
 *
 * - `outletWarehouses`: satış noktası → stoğunun düştüğü depo. Eşlenmemiş nokta **varsayılan depodan** düşer.
 *
 * Sıcak okuma önbellekli (`settings:<hotel>:stock`); kayıt otel kaydının sürüm damgasıyla.
 */

const HOT_READ_TTL_MS = 30_000;
const cacheKey = (hotelId) => `settings:${hotelId}:stock`;

/** @param {any} raw */
const normalize = (raw) => ({ outletWarehouses: Array.isArray(raw?.outletWarehouses) ? raw.outletWarehouses.filter((link) => link?.outletId && link?.warehouseId).map((link) => ({ outletId: String(link.outletId), warehouseId: String(link.warehouseId) })) : [] });

/**
 * @param {string} hotelId
 * @returns {Promise<{ outletWarehouses: Array<{ outletId: string, warehouseId: string }>, updatedAt: string }>}
 */
export async function getStockSettings(hotelId) {
  return cache.getOrSet(
    cacheKey(hotelId),
    async () => {
      const hotel = await prisma.hotel.findFirst({ where: { id: hotelId }, select: { settings: true, updatedAt: true } });
      if (!hotel) throw new NotFoundError('Otel bulunamadı');
      return { ...normalize(hotel.settings?.stock), updatedAt: hotel.updatedAt.toISOString() };
    },
    HOT_READ_TTL_MS,
  );
}

/**
 * Ekran için: eşlemeler satış noktası / depo adlarıyla, eşlenmemiş etkin noktalar varsayılan depoyla.
 * @param {string} hotelId
 */
export async function describeStockSettings(hotelId) {
  const [settings, outlets, warehouses] = await Promise.all([
    getStockSettings(hotelId),
    prisma.posOutlet.findMany({ where: { hotelId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, kind: true } }),
    prisma.warehouse.findMany({ where: { hotelId }, select: { id: true, name: true, isDefault: true, isActive: true } }),
  ]);
  const warehouseOf = new Map(warehouses.map((row) => [row.id, row]));
  const linkOf = new Map(settings.outletWarehouses.map((link) => [link.outletId, link.warehouseId]));
  const fallback = warehouses.find((row) => row.isDefault && row.isActive) ?? null;
  return {
    updatedAt: settings.updatedAt,
    defaultWarehouse: fallback ? { id: fallback.id, name: fallback.name } : null,
    outlets: outlets.map((outlet) => {
      const linked = linkOf.has(outlet.id) ? warehouseOf.get(linkOf.get(outlet.id)) ?? null : null;
      return { outletId: outlet.id, name: outlet.name, kind: outlet.kind, warehouseId: linked?.id ?? null, warehouseName: linked?.name ?? null, warehouseActive: linked ? linked.isActive : null };
    }),
  };
}

/**
 * Satış noktasının stoğunun düştüğü depo (eşleme yoksa varsayılan; hiç depo yoksa null).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId @param {string} outletId
 * @returns {Promise<{ id: string, name: string, isActive: boolean, viaDefault: boolean } | null>}
 */
export async function warehouseForOutlet(client, hotelId, outletId) {
  const settings = await getStockSettings(hotelId);
  const linked = settings.outletWarehouses.find((link) => link.outletId === outletId);
  if (linked) {
    const row = await client.warehouse.findFirst({ where: { id: linked.warehouseId, hotelId }, select: { id: true, name: true, isActive: true } });
    if (row) return { ...row, viaDefault: false };
  }
  const fallback = await client.warehouse.findFirst({ where: { hotelId, isDefault: true }, select: { id: true, name: true, isActive: true } });
  return fallback ? { ...fallback, viaDefault: true } : null;
}

/**
 * @param {string} hotelId
 * @param {{ expectedUpdatedAt: Date, outletWarehouses: Array<{ outletId: string, warehouseId: string }> }} input
 */
export async function saveStockSettings(hotelId, input) {
  await writeWithEvents(async (tx, stage, afterCommit) => {
    const hotel = await tx.hotel.findFirst({ where: { id: hotelId }, select: { settings: true } });
    if (!hotel) throw new NotFoundError('Otel bulunamadı');
    const outletIds = input.outletWarehouses.map((link) => link.outletId);
    const warehouseIds = [...new Set(input.outletWarehouses.map((link) => link.warehouseId))];
    const [outlets, warehouses] = await Promise.all([
      outletIds.length ? tx.posOutlet.findMany({ where: { hotelId, id: { in: outletIds } }, select: { id: true } }) : [],
      warehouseIds.length ? tx.warehouse.findMany({ where: { hotelId, id: { in: warehouseIds } }, select: { id: true, name: true, isActive: true } }) : [],
    ]);
    const knownOutlets = new Set(outlets.map((row) => row.id));
    const warehouseOf = new Map(warehouses.map((row) => [row.id, row]));
    /** @type {Record<string, string>} */
    const fields = {};
    input.outletWarehouses.forEach((link, index) => {
      if (!knownOutlets.has(link.outletId)) fields[`outletWarehouses.${index}.outletId`] = 'Satış noktası bulunamadı';
      const warehouse = warehouseOf.get(link.warehouseId);
      if (!warehouse) fields[`outletWarehouses.${index}.warehouseId`] = 'Depo bulunamadı';
      else if (!warehouse.isActive) fields[`outletWarehouses.${index}.warehouseId`] = `${warehouse.name} pasif`;
    });
    if (Object.keys(fields).length) throw new ValidationError(`Eşlemede düzeltilmesi gereken satırlar var: ${Object.values(fields)[0]}`, { fields });

    const before = normalize(hotel.settings?.stock);
    const next = { outletWarehouses: input.outletWarehouses.map((link) => ({ outletId: link.outletId, warehouseId: link.warehouseId })) };
    const settings = { ...(hotel.settings ?? {}), stock: { ...(hotel.settings?.stock ?? {}), ...next } };
    await updateWithVersionCheck(tx, 'hotel', { id: hotelId }, input.expectedUpdatedAt, { settings }, 'Otel bulunamadı');
    await recordAudit(tx, { hotelId, entity: 'StockSettings', entityId: hotelId, action: 'UPDATE', before: { outletWarehouses: before.outletWarehouses }, after: next });
    await stage('stock.changed', { hotelId, change: 'SETTINGS', stockItemIds: [] });
    afterCommit(() => cache.invalidatePrefix(`settings:${hotelId}:`));
  });
  return describeStockSettings(hotelId);
}
