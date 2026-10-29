import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/**
 * Satın alma ve stok uçlarının büyük veride süresi (modül 45; ölçüm aracı, üretimde çalışmaz).
 *
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-purchasing.mjs
 *
 * Önce banket F&B ölçüm verisi kurulmuş olmalı (`perf-banquet-fnb.mjs`: 1.500 malzeme, 20.000 talep / ~200.000
 * satır — açık satırların büyük kısmı). Kurulum (yoksa; tamsa tekrar kurmaz):
 * - 200 tedarikçi (gruplu), 10 depo.
 * - 2.000 geçmiş teklif turu (40'ar satır, 4'er teklif → 320.000 teklif satırı), bunlardan 5.000 sipariş
 *   (12'şer satır, bütün durumlar), 8.000 mal kabul (8'er satır) ve her satırına bir stok hareketi.
 * - Depo satırları (malzeme × depo), malzemelerin mevcudu ve 600 malzemede minimum seviye.
 *
 * Ölçülen: açık satırlar (ilk sayfa, grup, arama, aralık), minimum stok önerileri, tur listesi / karşılaştırma,
 * sipariş listesi (ilk sayfa, teslim bekleyen, tedarikçi adı, malzeme adı, derin sayfa) ve ekranı, mal kabul listesi
 * (arama) ve ekranı, tedarikçi listesi (arama), stok mevcudu (ilk sayfa, minimum altı, arama), hareketler (malzeme,
 * depo + aralık, derin sayfa), stok özeti, depolar; yazma yolu (tur aç, teklif kaydet, kazanan → sipariş,
 * mal kabul); sonunda sorgu planları.
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 5);
const ACTOR = 'perf-purchasing';
const FNB_ACTOR = 'perf-fnb';
const SUPPLIERS = 200;
const WAREHOUSES = 10;
const PAST_ROUNDS = 2000;
const ROUND_LINES = 40;
const QUOTES_PER_ROUND = 4;
const ORDERS = 5000;
const ORDER_LINES = 12;
const RECEIPTS = 8000;
const RECEIPT_LINES = 8;
const MIN_LEVEL_ITEMS = 600;
const CHUNK = 5000;
const DAY_MS = 86_400_000;

const core = await import('@hotelos/core');
const contracts = await import('@hotelos/hotel-contracts');
const { Prisma } = await import('@prisma/client');
const { prisma } = await import('../src/db.js');
const { resolveHotelId } = await import('../src/lib/tenant.js');
const requests = await import('../src/modules/purchasing/service.js');
const suppliers = await import('../src/modules/purchasing/suppliers.js');
const rounds = await import('../src/modules/purchasing/rounds.js');
const orders = await import('../src/modules/purchasing/orders.js');
const receipts = await import('../src/modules/purchasing/receipts.js');
const stock = await import('../src/modules/stock/service.js');
const purchaseSettings = await import('../src/modules/purchasing/settings.js');

const hotelId = await resolveHotelId();
const hotel = await prisma.hotel.findFirst({ where: { id: hotelId } });
const today = core.toIsoDay(core.calendarDateInTimeZone(hotel.timezone));
const day = (offset) => core.toIsoDay(core.addDays(new Date(`${today}T00:00:00.000Z`), offset));
const dateOnly = (text) => new Date(`${text}T00:00:00.000Z`);
const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: ACTOR }, fn);

let seed = 45_2026;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (min, max) => min + Math.floor(rand() * (max - min + 1));
const sample = (list, count) => {
  const chosen = new Set();
  while (chosen.size < Math.min(count, list.length)) chosen.add(pick(list));
  return [...chosen];
};
const insert = async (model, rows) => {
  for (let index = 0; index < rows.length; index += CHUNK) await prisma[model].createMany({ data: rows.slice(index, index + CHUNK) });
};
const money = (value) => value.toFixed(2);

/* ══════════════════ Kurulum ══════════════════ */

const items = await prisma.stockItem.findMany({ where: { hotelId, createdBy: FNB_ACTOR }, select: { id: true, unit: true, unitCost: true, group: true } });
if (items.length === 0) {
  console.error('Önce perf-banquet-fnb.mjs ile banket F&B ölçüm verisini kurun.');
  process.exit(1);
}

if ((await prisma.supplier.count({ where: { hotelId, createdBy: ACTOR } })) < SUPPLIERS) {
  const started = performance.now();
  const now = Date.now();
  const supplierRows = Array.from({ length: SUPPLIERS }, (_, index) => ({
    id: randomUUID(),
    hotelId,
    code: `PS-${String(index + 1).padStart(4, '0')}`,
    name: `Ölçüm tedarikçisi ${String(index + 1).padStart(4, '0')}`,
    taxNumber: String(5_000_000_000 + index),
    paymentTermDays: pick([7, 15, 30, 45, 60]),
    leadTimeDays: between(0, 5),
    groups: sample(contracts.STOCK_ITEM_GROUPS, between(1, 3)),
    isActive: rand() > 0.05,
    createdBy: ACTOR,
  }));
  await insert('supplier', supplierRows);
  const hasDefault = (await prisma.warehouse.count({ where: { hotelId, isDefault: true } })) > 0;
  const warehouseRows = Array.from({ length: WAREHOUSES }, (_, index) => ({
    id: randomUUID(),
    hotelId,
    code: `PW-${index + 1}`,
    name: `Ölçüm deposu ${index + 1}`,
    isDefault: !hasDefault && index === 0,
    createdBy: ACTOR,
  }));
  await insert('warehouse', warehouseRows);

  // Geçmiş turlar: 40 satır, 4 teklif; satırların bir kısmı siparişe döner.
  const roundRows = [];
  const roundLineRows = [];
  const quoteRows = [];
  const quoteLineRows = [];
  for (let index = 0; index < PAST_ROUNDS; index += 1) {
    const roundId = randomUUID();
    const createdAt = new Date(now - between(1, 700) * DAY_MS);
    const lines = sample(items, ROUND_LINES).map((item, sortOrder) => ({
      id: randomUUID(),
      hotelId,
      roundId,
      stockItemId: item.id,
      quantity: (item.unit === 'PIECE' ? between(10, 400) : between(5, 200) + rand()).toFixed(3),
      unit: item.unit,
      neededBy: new Date(createdAt.getTime() + between(1, 6) * DAY_MS),
      sortOrder,
      cost: Number(item.unitCost),
    }));
    roundRows.push({ id: roundId, hotelId, number: `TKT-PF-${String(index + 1).padStart(5, '0')}`, status: 'AWARDED', neededBy: lines[0].neededBy, createdBy: ACTOR, createdAt, awardedAt: createdAt });
    for (const supplier of sample(supplierRows, QUOTES_PER_ROUND)) {
      const quoteId = randomUUID();
      quoteRows.push({ id: quoteId, hotelId, roundId, supplierId: supplier.id, deliveryDays: between(0, 5), createdBy: ACTOR, createdAt });
      for (const line of lines) quoteLineRows.push({ id: randomUUID(), hotelId, quoteId, roundLineId: line.id, unitPrice: rand() < 0.1 ? null : (line.cost * (0.85 + rand() * 0.3)).toFixed(4), taxRatePct: pick(['1', '10', '20']) });
    }
    for (const { cost, ...line } of lines) roundLineRows.push(line);
  }
  await insert('purchaseRound', roundRows);
  await insert('purchaseRoundLine', roundLineRows);
  await insert('purchaseQuote', quoteRows);
  await insert('purchaseQuoteLine', quoteLineRows);

  // Siparişler: bütün durumlar; teslim alınanların mal kabulü, satırına hareket.
  const statuses = ['RECEIVED', 'RECEIVED', 'RECEIVED', 'PARTIALLY_RECEIVED', 'APPROVED', 'CLOSED', 'CANCELLED', 'REJECTED', 'PENDING_APPROVAL'];
  const orderRows = [];
  const orderLineRows = [];
  for (let index = 0; index < ORDERS; index += 1) {
    const orderId = randomUUID();
    const status = pick(statuses);
    const createdAt = new Date(now - between(0, 700) * DAY_MS);
    const supplier = pick(supplierRows);
    let net = 0;
    let tax = 0;
    const lines = sample(items, ORDER_LINES).map((item, sortOrder) => {
      const quantity = item.unit === 'PIECE' ? between(10, 300) : between(2, 80);
      const price = Number(item.unitCost) * (0.9 + rand() * 0.2);
      const lineNet = Math.round(quantity * price * 100) / 100;
      const lineTax = Math.round(lineNet * 10) / 100;
      net += lineNet;
      tax += lineTax;
      const received = status === 'RECEIVED' ? quantity : status === 'PARTIALLY_RECEIVED' || status === 'CLOSED' ? Math.floor(quantity / 2) : 0;
      return { id: randomUUID(), hotelId, orderId, stockItemId: item.id, quantity: String(quantity), unit: item.unit, unitPrice: price.toFixed(4), taxRatePct: '10', netAmount: money(lineNet), taxAmount: money(lineTax), total: money(lineNet + lineTax), receivedQuantity: String(received), sortOrder };
    });
    orderLineRows.push(...lines);
    orderRows.push({
      id: orderId,
      hotelId,
      number: `SAS-PF-${String(index + 1).padStart(5, '0')}`,
      supplierId: supplier.id,
      status,
      expectedOn: new Date(createdAt.getTime() + supplier.leadTimeDays * DAY_MS),
      paymentTermDays: supplier.paymentTermDays,
      currency: hotel.currency,
      netTotal: money(net),
      taxTotal: money(tax),
      grandTotal: money(net + tax),
      receivedTotal: status === 'RECEIVED' ? money(net + tax) : status === 'PARTIALLY_RECEIVED' || status === 'CLOSED' ? money((net + tax) / 2) : '0',
      approvalId: status === 'PENDING_APPROVAL' ? randomUUID() : null,
      createdBy: ACTOR,
      createdAt,
      ...(status === 'CANCELLED' ? { cancelledAt: createdAt, cancelledBy: ACTOR, cancelReason: 'Ölçüm' } : {}),
      ...(status === 'CLOSED' ? { closedAt: createdAt, closedBy: ACTOR, closeReason: 'Ölçüm' } : {}),
      ...(status === 'REJECTED' ? { rejectedAt: createdAt } : {}),
    });
  }
  await insert('purchaseOrder', orderRows);
  await insert('purchaseOrderLine', orderLineRows);

  const receivedOrders = orderRows.filter((order) => ['RECEIVED', 'PARTIALLY_RECEIVED', 'CLOSED'].includes(order.status));
  const linesByOrder = new Map();
  for (const line of orderLineRows) {
    const list = linesByOrder.get(line.orderId) ?? [];
    list.push(line);
    linesByOrder.set(line.orderId, list);
  }
  const receiptRows = [];
  const receiptLineRows = [];
  const movementRows = [];
  const levels = new Map();
  for (let index = 0; index < RECEIPTS; index += 1) {
    const order = receivedOrders[index % receivedOrders.length];
    const receiptId = randomUUID();
    const warehouse = pick(warehouseRows);
    const receivedOn = new Date(Date.UTC(order.createdAt.getUTCFullYear(), order.createdAt.getUTCMonth(), order.createdAt.getUTCDate()) + between(0, 3) * DAY_MS);
    let net = 0;
    for (const line of linesByOrder.get(order.id).slice(0, RECEIPT_LINES)) {
      const quantity = Math.max(1, Math.floor(Number(line.quantity) / 2));
      const lineNet = Math.round(quantity * Number(line.unitPrice) * 100) / 100;
      net += lineNet;
      receiptLineRows.push({ id: randomUUID(), hotelId, receiptId, orderLineId: line.id, stockItemId: line.stockItemId, quantity: String(quantity), unitPrice: line.unitPrice, taxRatePct: '10', netAmount: money(lineNet), taxAmount: money(lineNet / 10), total: money(lineNet * 1.1) });
      const key = `${warehouse.id}|${line.stockItemId}`;
      levels.set(key, (levels.get(key) ?? 0) + quantity);
      movementRows.push({
        id: randomUUID(),
        hotelId,
        kind: 'RECEIPT',
        stockItemId: line.stockItemId,
        warehouseId: warehouse.id,
        quantity: String(quantity),
        unitCost: line.unitPrice,
        totalCost: money(lineNet),
        onHandAfter: String(quantity),
        avgCostAfter: line.unitPrice,
        sourceType: 'GoodsReceipt',
        sourceId: receiptId,
        occurredAt: new Date(receivedOn.getTime() + 10 * 3_600_000),
        createdBy: ACTOR,
      });
    }
    receiptRows.push({
      id: receiptId,
      hotelId,
      number: `MKB-PF-${String(index + 1).padStart(5, '0')}`,
      orderId: order.id,
      supplierId: order.supplierId,
      warehouseId: warehouse.id,
      waybillNumber: `PF-${index + 1}`,
      receivedOn,
      netTotal: money(net),
      taxTotal: money(net / 10),
      grandTotal: money(net * 1.1),
      receivedBy: ACTOR,
    });
  }
  await insert('goodsReceipt', receiptRows);
  await insert('goodsReceiptLine', receiptLineRows);
  await insert('stockMovement', movementRows);
  await insert(
    'stockLevel',
    [...levels.entries()].map(([key, quantity]) => {
      const [warehouseId, stockItemId] = key.split('|');
      return { id: randomUUID(), hotelId, warehouseId, stockItemId, quantity: String(quantity) };
    }),
  );
  await prisma.$executeRaw`
    UPDATE "StockItem" s SET "onHand" = COALESCE((SELECT SUM(l."quantity") FROM "StockLevel" l WHERE l."stockItemId" = s."id"), 0)
    WHERE s."hotelId" = ${hotelId} AND s."createdBy" = ${FNB_ACTOR}`;
  const tracked = sample(items, MIN_LEVEL_ITEMS);
  for (const item of tracked) await prisma.stockItem.update({ where: { id: item.id }, data: { minLevel: String(between(10, 400)) } });
  for (const table of ['Supplier', 'Warehouse', 'PurchaseRound', 'PurchaseRoundLine', 'PurchaseQuote', 'PurchaseQuoteLine', 'PurchaseOrder', 'PurchaseOrderLine', 'GoodsReceipt', 'GoodsReceiptLine', 'StockMovement', 'StockLevel', 'StockItem', 'PurchaseRequestLine']) {
    await prisma.$executeRawUnsafe(`ANALYZE "${table}"`);
  }
  console.log(
    `Kurulum: ${supplierRows.length} tedarikçi, ${warehouseRows.length} depo, ${roundRows.length} tur (${roundLineRows.length} satır, ${quoteLineRows.length} teklif satırı), ` +
      `${orderRows.length} sipariş (${orderLineRows.length} satır), ${receiptRows.length} mal kabul, ${movementRows.length} hareket, ${levels.size} depo satırı · ` +
      `${((performance.now() - started) / 1000).toFixed(0)} sn`,
  );
}

/* ══════════════════ Ölçüm ══════════════════ */

const results = [];
async function measure(name, fn, rounds = ROUNDS) {
  const times = [];
  let last;
  for (let round = 0; round < rounds; round += 1) {
    const begin = performance.now();
    last = await fn(round);
    times.push(performance.now() - begin);
  }
  const sorted = (rounds > 1 ? times.slice(1) : times).sort((a, b) => a - b);
  results.push({ name, best: sorted[0], median: sorted[Math.floor(sorted.length / 2)], worst: sorted.at(-1) });
  return last;
}
const parse = (schema, input) => contracts[schema].parse(input);

const sampleRound = await prisma.purchaseRound.findFirst({ where: { hotelId, createdBy: ACTOR }, orderBy: { createdAt: 'desc' }, select: { id: true } });
const sampleOrder = await prisma.purchaseOrder.findFirst({ where: { hotelId, createdBy: ACTOR, status: 'PARTIALLY_RECEIVED' }, select: { id: true } });
const sampleReceipt = await prisma.goodsReceipt.findFirst({ where: { hotelId, receivedBy: ACTOR }, select: { id: true, number: true } });
const sampleItem = await prisma.stockItem.findFirst({ where: { hotelId, createdBy: FNB_ACTOR, stockMovements: { some: {} } }, select: { id: true, name: true } });
const sampleWarehouse = await prisma.warehouse.findFirst({ where: { hotelId, createdBy: ACTOR }, select: { id: true } });
const itemWord = sampleItem.name.split(' ')[2];

const open = await measure('açık satırlar (ilk sayfa)', () => rounds.listOpenLines(hotelId, parse('openRequestLinesQuerySchema', {})));
await measure('açık satırlar (grup)', () => rounds.listOpenLines(hotelId, parse('openRequestLinesQuerySchema', { group: 'MEAT' })));
await measure('açık satırlar (arama)', () => rounds.listOpenLines(hotelId, parse('openRequestLinesQuerySchema', { search: itemWord })));
await measure('açık satırlar (7 gün)', () => rounds.listOpenLines(hotelId, parse('openRequestLinesQuerySchema', { from: today, to: day(6) })));
await measure('minimum stok önerileri', () => requests.listSuggestions(hotelId, parse('purchaseSuggestionQuerySchema', {})));
await measure('tur listesi', () => rounds.listRounds(hotelId, parse('purchaseRoundListQuerySchema', {})));
await measure('tur listesi (malzeme adı)', () => rounds.listRounds(hotelId, parse('purchaseRoundListQuerySchema', { search: itemWord })));
await measure('karşılaştırma (40 satır × 4 teklif)', () => rounds.getRound(hotelId, sampleRound.id));
await measure('siparişler (ilk sayfa)', () => orders.listOrders(hotelId, parse('purchaseOrderListQuerySchema', {})));
await measure('siparişler (teslim bekleyen)', () => orders.listOrders(hotelId, parse('purchaseOrderListQuerySchema', { open: 'true' })));
await measure('siparişler (tedarikçi adı)', () => orders.listOrders(hotelId, parse('purchaseOrderListQuerySchema', { search: 'tedarikçisi 0042' })));
await measure('siparişler (malzeme adı)', () => orders.listOrders(hotelId, parse('purchaseOrderListQuerySchema', { search: itemWord })));
await measure('siparişler (derin sayfa 150)', () => orders.listOrders(hotelId, parse('purchaseOrderListQuerySchema', { page: 150 })));
await measure('sipariş ekranı', () => orders.getOrder(hotelId, sampleOrder.id));
await measure('mal kabuller (ilk sayfa)', () => receipts.listReceipts(hotelId, parse('goodsReceiptListQuerySchema', {})));
await measure('mal kabuller (arama)', () => receipts.listReceipts(hotelId, parse('goodsReceiptListQuerySchema', { search: sampleReceipt.number.slice(-5) })));
await measure('mal kabul ekranı', () => receipts.getReceipt(hotelId, sampleReceipt.id));
await measure('tedarikçiler (arama)', () => suppliers.listSuppliers(hotelId, parse('supplierListQuerySchema', { search: '0042' })));
await measure('stok mevcudu (ilk sayfa)', () => stock.listLevels(hotelId, parse('stockLevelListQuerySchema', {})));
await measure('stok mevcudu (minimum altı)', () => stock.listLevels(hotelId, parse('stockLevelListQuerySchema', { belowMin: 'true' })));
await measure('stok mevcudu (arama)', () => stock.listLevels(hotelId, parse('stockLevelListQuerySchema', { search: itemWord })));
await measure('hareketler (malzeme)', () => stock.listMovements(hotelId, parse('stockMovementListQuerySchema', { stockItemId: sampleItem.id })));
await measure('hareketler (depo + 30 gün)', () => stock.listMovements(hotelId, parse('stockMovementListQuerySchema', { warehouseId: sampleWarehouse.id, from: day(-30), to: today })));
await measure('hareketler (derin sayfa 500)', () => stock.listMovements(hotelId, parse('stockMovementListQuerySchema', { page: 500 })));
await measure('stok özeti', () => stock.getStockSummary(hotelId));
await measure('depolar', () => stock.listWarehouses(hotelId, { includeInactive: true }));

// Yazma yolu: açık satırların ilk 40 malzemesinden tur → 3 teklif → kazanan → bir siparişe mal kabul.
// Ölçüm otelinde onay eşiği kapalı: siparişler onaylı açılır, mal kabul hemen ölçülür (onay yolu entegrasyon testinde).
const policy = await purchaseSettings.getPurchaseSettings(hotelId);
if (Number(policy.orderApprovalAmount) !== 0) {
  await as(() => purchaseSettings.updatePurchaseSettings(hotelId, parse('updatePurchaseSettingsSchema', { expectedUpdatedAt: policy.updatedAt, orderApprovalAmount: '0', defaultTaxRatePct: policy.defaultTaxRatePct })));
}
const roundItems = open.items.filter((row) => row.unitMismatchLines === 0).slice(0, 40);
const created = await measure('tur aç (40 malzeme, açık satırlar birleşir)', () => as(() => rounds.createRound(hotelId, parse('createPurchaseRoundSchema', { items: roundItems.map((row) => ({ stockItemId: row.stockItemId, expectedQuantity: row.quantity })) }))), 1);
const quoteSuppliers = await prisma.supplier.findMany({ where: { hotelId, createdBy: ACTOR, isActive: true }, take: 3, select: { id: true } });
let view = created;
for (const [index, supplier] of quoteSuppliers.entries()) {
  view = await measure(
    `teklif kaydet (${index + 1}. tedarikçi, 40 satır)`,
    () =>
      as(() =>
        rounds.saveQuote(
          hotelId,
          created.id,
          supplier.id,
          parse('savePurchaseQuoteSchema', { expectedUpdatedAt: view.updatedAt, deliveryDays: index, lines: view.lines.map((line) => ({ roundLineId: line.id, unitPrice: (Number(line.currentCost) * (0.9 + index * 0.05)).toFixed(2), taxRatePct: '1' })) }),
        ),
      ),
    1,
  );
}
const awarded = await measure(
  'kazanan seçimi → siparişler (40 satır)',
  () => as(() => rounds.awardRound(hotelId, created.id, parse('awardPurchaseRoundSchema', { expectedUpdatedAt: view.updatedAt, awards: view.lines.map((line) => ({ roundLineId: line.id, quoteLineId: line.bestQuoteLineId })) }))),
  1,
);
const receivable = awarded.orders.find((order) => order.status === 'APPROVED');
if (receivable) {
  const detail = await orders.getOrder(hotelId, receivable.id);
  await measure(
    `mal kabul (${detail.lines.length} satır, stok + ortalama)`,
    () =>
      as(() =>
        receipts.receiveGoods(
          hotelId,
          receivable.id,
          parse('receiveGoodsSchema', { expectedUpdatedAt: detail.updatedAt, warehouseId: sampleWarehouse.id, waybillNumber: `PF-W-${Date.now()}`, receivedOn: today, lines: detail.lines.map((line) => ({ orderLineId: line.id, quantity: line.remaining })) }),
        ),
      ),
    1,
  );
}

const plans = {};
const capture = async (name, sql) => {
  const explained = await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
  plans[name] = explained.map((row) => row['QUERY PLAN']).filter((text) => /Index|Execution Time|Seq Scan|Bitmap/.test(text));
};
await capture(
  'açık satırlar (sayım)',
  Prisma.sql`SELECT COUNT(DISTINCT l."stockItemId") FROM "PurchaseRequestLine" l JOIN "PurchaseRequest" r ON r."id" = l."requestId" WHERE l."hotelId" = ${hotelId} AND l."roundLineId" IS NULL AND r."status"::text IN ('OPEN', 'IN_PROGRESS')`,
);
await capture('siparişler (ilk sayfa)', Prisma.sql`SELECT "id" FROM "PurchaseOrder" WHERE "hotelId" = ${hotelId} ORDER BY "createdAt" DESC, "id" DESC LIMIT 25`);
await capture('hareketler (malzeme)', Prisma.sql`SELECT "id" FROM "StockMovement" WHERE "hotelId" = ${hotelId} AND "stockItemId" = ${sampleItem.id} ORDER BY "occurredAt" DESC, "id" DESC LIMIT 50`);
await capture(
  'yoldaki miktar (sayfa malzemeleri)',
  Prisma.sql`SELECT ol."stockItemId", SUM(GREATEST(ol."quantity" - ol."receivedQuantity", 0)) FROM "PurchaseOrderLine" ol JOIN "PurchaseOrder" o ON o."id" = ol."orderId" WHERE ol."hotelId" = ${hotelId} AND ol."stockItemId" = ANY(${roundItems.slice(0, 25).map((row) => row.stockItemId)}::text[]) AND o."status"::text IN ('PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED') GROUP BY 1`,
);

const pad = (text, width) => String(text).padEnd(width);
console.log(`\nÖlçüm ayrıntısı: açık satırlarda ${open.meta.total} malzeme`);
console.log(`\n${pad('ölçüm', 52)}${pad('en iyi', 10)}${pad('ortanca', 10)}en kötü`);
for (const row of results) console.log(`${pad(row.name, 52)}${pad(`${row.best.toFixed(0)} ms`, 10)}${pad(`${row.median.toFixed(0)} ms`, 10)}${row.worst.toFixed(0)} ms`);
for (const [name, lines] of Object.entries(plans)) {
  console.log(`\nPlan — ${name}:`);
  for (const line of lines) console.log(`  ${line.trim()}`);
}
await prisma.$disconnect();
