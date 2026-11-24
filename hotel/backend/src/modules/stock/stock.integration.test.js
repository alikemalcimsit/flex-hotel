import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Stok hareketleri, sayım, satış düşümü, minimum altı önerisi ve maliyet raporu (modül 44) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: elle çıkış / fire (depo mevcudu, kart mevcudu, maliyet değişmez, hareket kaydı, yetersiz stok, istek kimliğiyle
 * tekrar), depolar arası transfer (çift hareket, kart toplamı sabit) → sayım (açılışta dondurma, satır girme + yeni
 * malzeme, onayda fark hareketi, depoda tek açık sayım, iptal) → satış düşümü (reçeteden malzemeye, ikram + zayi dahil,
 * ürün kimliği, yeniden yayında fark düzeltmesi, eski yayın atlanır, reçetesiz ürün atlanır, satış noktası → depo eşlemesi,
 * depo yoksa iş hatası) → minimum altı önerisi (STOCK talebi + zil; ikinci kez açılmaz) → maliyet raporları → izinler.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'stok@test.local';
const KITCHEN = 'mutfak@test.local';
const DESK = 'onburo@test.local';

describe('stok hareketleri, sayım ve satış düşümü (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let stockItems;
  /** @type {any} */ let recipes;
  /** @type {any} */ let stock;
  /** @type {any} */ let manual;
  /** @type {any} */ let counts;
  /** @type {any} */ let sales;
  /** @type {any} */ let suggestions;
  /** @type {any} */ let reports;
  /** @type {any} */ let settings;
  /** @type {any} */ let movements;
  /** @type {any} */ let write;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let otherHotelId;
  /** @type {Record<string, any>} */ let item;
  /** @type {Record<string, any>} */ let warehouse;
  /** @type {Record<string, any>} */ let menu;
  /** @type {Map<string, string>} */ let tokens;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    stockItems = await import('../recipes/stock-items.js');
    recipes = await import('../recipes/recipes.js');
    stock = await import('./service.js');
    manual = await import('./manual.js');
    counts = await import('./counts.js');
    sales = await import('./sales.js');
    suggestions = await import('./suggestions.js');
    reports = await import('./reports.js');
    settings = await import('./settings.js');
    movements = await import('./movements.js');
    write = await import('../../lib/write.js');
    cache = await import('../../lib/cache.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const boss = (fn) => as(MANAGER, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const D = (offset) => core.toIsoDay(core.addDays(today(), offset));

  async function rejectsWith(promise, code, message) {
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, code, `${error.code}: ${error.message}`);
      if (message) assert.match(error.message, message);
      return true;
    });
  }

  /** Mal kabulsüz stok girişi (giriş zinciri modül 45 testinde): depo + ortalama maliyet. */
  const receive = (warehouseId, lines) =>
    boss(() =>
      write.writeWithEvents(async (tx, stage) => {
        const result = await movements.postStockIn(tx, {
          hotelId,
          warehouseId,
          kind: 'RECEIPT',
          sourceType: 'Test',
          sourceId: randomUUID(),
          occurredAt: new Date(),
          actor: MANAGER,
          lines: lines.map((line) => ({ stockItemId: line.stockItemId, quantity: core.toDecimal(line.quantity), unitCost: line.unitCost })),
        });
        await stage('stock.changed', { hotelId, change: 'RECEIPT', stockItemIds: result.map((row) => row.stockItemId) });
        return result;
      }),
    );
  const card = (id) => db.stockItem.findUnique({ where: { id }, select: { onHand: true, unitCost: true } });
  const level = async (warehouseId, stockItemId) => String((await db.stockLevel.findUnique({ where: { warehouseId_stockItemId: { warehouseId, stockItemId } }, select: { quantity: true } }))?.quantity ?? '0');
  const moves = (where) => db.stockMovement.findMany({ where: { hotelId, ...where }, orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] });

  beforeEach(async () => {
    await resetDatabase(db);
    cache.cache.invalidatePrefix('settings:');
    tokens = new Map();
    hotelId = (await db.hotel.create({ data: { name: 'Büyük Ankara Oteli', code: `S${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka Otel', code: `O${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Stok Müdürü', role: 'MANAGER', passwordHash },
        { hotelId, email: KITCHEN, name: 'Mutfak Şefi', role: 'FNB', passwordHash },
        { hotelId, email: DESK, name: 'Ön Büro', role: 'FRONT_DESK', passwordHash },
      ],
    });
    const newStock = (input) => boss(() => stockItems.createStockItem(hotelId, contracts.createStockItemSchema.parse(input)));
    item = {
      dana: await newStock({ code: 'ET-010', name: 'Dana kıyma', group: 'MEAT', unit: 'KG', unitCost: '400' }),
      yumurta: await newStock({ name: 'Yumurta', group: 'DAIRY', unit: 'PIECE', unitCost: '4' }),
      domates: await newStock({ name: 'Domates', group: 'PRODUCE', unit: 'KG', unitCost: '30' }),
    };
    const newWarehouse = (input) => boss(() => stock.createWarehouse(hotelId, contracts.createWarehouseSchema.parse(input)));
    warehouse = { ana: await newWarehouse({ code: 'ANA', name: 'Ana depo' }), bar: await newWarehouse({ code: 'BAR', name: 'Bar deposu' }) };
    // Giriş: 10 kg kıyma @400, 60 yumurta @4, 5 kg domates @30 (hepsi ana depoya).
    await receive(warehouse.ana.id, [
      { stockItemId: item.dana.id, quantity: '10', unitCost: '400' },
      { stockItemId: item.yumurta.id, quantity: '60', unitCost: '4' },
      { stockItemId: item.domates.id, quantity: '5', unitCost: '30' },
    ]);
    // Menü: kategori, köfte (reçeteli), kola (reçetesiz), satış noktası.
    const category = await db.menuCategory.create({ data: { hotelId, name: 'Ana yemek', createdBy: MANAGER } });
    const kofte = await db.menuItem.create({ data: { hotelId, categoryId: category.id, name: 'Köfte', price: '250', taxCategory: 'FNB', createdBy: MANAGER } });
    const kola = await db.menuItem.create({ data: { hotelId, categoryId: category.id, name: 'Kola', price: '60', taxCategory: 'FNB', createdBy: MANAGER } });
    const outlet = await db.posOutlet.create({ data: { hotelId, code: 'REST', name: 'Restoran', createdBy: MANAGER } });
    const recipe = await boss(() =>
      recipes.createRecipe(
        hotelId,
        contracts.createRecipeSchema.parse({
          name: 'Köfte (porsiyon)',
          kind: 'DISH',
          menuItemId: kofte.id,
          yieldQuantity: '1',
          yieldUnit: 'PORTION',
          lines: [
            { stockItemId: item.dana.id, quantity: '200', unit: 'G', wastePct: '0' },
            { stockItemId: item.yumurta.id, quantity: '2', unit: 'PIECE', wastePct: '0' },
          ],
        }),
      ),
    );
    menu = { kofte, kola, outlet, recipe };
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });

  const move = (input) => boss(() => manual.createManualMovement(hotelId, contracts.manualStockMovementSchema.parse({ requestId: randomUUID(), ...input })));
  const paidPayload = (overrides = {}) => ({
    hotelId,
    checkId: overrides.checkId ?? randomUUID(),
    outletId: menu.outlet.id,
    number: 'A-12',
    businessDate: D(0),
    closedAt: new Date().toISOString(),
    grandTotal: '1000.00',
    items: [
      { menuItemId: menu.kofte.id, name: 'Köfte', sold: 3, comped: 1, wasted: 1 },
      { menuItemId: menu.kola.id, name: 'Kola', sold: 4, comped: 0, wasted: 0 },
    ],
    ...overrides,
  });

  /* ─────────────── Elle hareket ─────────────── */

  it('çıkış ve fire: depo ve kart mevcudu düşer, maliyet değişmez, hareket o anki ortalamayla; yetersiz stok reddedilir; aynı istek tekrar yazılmaz', async () => {
    const requestId = randomUUID();
    const issue = await boss(() => manual.createManualMovement(hotelId, contracts.manualStockMovementSchema.parse({ requestId, kind: 'ISSUE', warehouseId: warehouse.ana.id, lines: [{ stockItemId: item.dana.id, quantity: '2,5' }], note: 'Personel yemeği' })));
    assert.equal(issue.duplicate, false);
    assert.deepEqual(issue.lines.map((line) => [line.name, line.quantity, line.levelAfter, line.totalCost]), [['Dana kıyma', '2.5', '7.5', '1000.00']]);
    const dana = await card(item.dana.id);
    assert.equal(String(dana.onHand), '7.5');
    assert.equal(String(dana.unitCost), '400');
    assert.equal(await level(warehouse.ana.id, item.dana.id), '7.5');
    const [, out] = await moves({ stockItemId: item.dana.id });
    assert.deepEqual([out.kind, String(out.quantity), String(out.unitCost), String(out.totalCost), String(out.onHandAfter), out.sourceType, out.sourceId, out.note], ['ISSUE', '-2.5', '400', '-1000', '7.5', 'ManualMovement', requestId, 'Personel yemeği']);

    // Aynı istek ikinci kez: hareket yok, aynı özet.
    const again = await boss(() => manual.createManualMovement(hotelId, contracts.manualStockMovementSchema.parse({ requestId, kind: 'ISSUE', warehouseId: warehouse.ana.id, lines: [{ stockItemId: item.dana.id, quantity: '2.5' }] })));
    assert.equal(again.duplicate, true);
    assert.equal(again.lines[0].quantity, '2.5');
    assert.equal(String((await card(item.dana.id)).onHand), '7.5');

    // Fire sebep ister (sözleşme) ve mevcuttan fazlası çıkamaz.
    assert.throws(() => contracts.manualStockMovementSchema.parse({ requestId: randomUUID(), kind: 'WASTE', warehouseId: warehouse.ana.id, lines: [{ stockItemId: item.dana.id, quantity: '1' }] }));
    await rejectsWith(move({ kind: 'WASTE', warehouseId: warehouse.ana.id, lines: [{ stockItemId: item.dana.id, quantity: '8' }], note: 'Bozuldu' }), 'INSUFFICIENT_STOCK', /7\.5/);
    await rejectsWith(move({ kind: 'ISSUE', warehouseId: warehouse.bar.id, lines: [{ stockItemId: item.dana.id, quantity: '1' }] }), 'INSUFFICIENT_STOCK', /0/);
    // Adet tam sayı.
    await rejectsWith(move({ kind: 'ISSUE', warehouseId: warehouse.ana.id, lines: [{ stockItemId: item.yumurta.id, quantity: '1.5' }] }), 'VALIDATION', /tam sayı/);
    const waste = await move({ kind: 'WASTE', warehouseId: warehouse.ana.id, lines: [{ stockItemId: item.domates.id, quantity: '1' }], note: 'Ezildi' });
    assert.equal(waste.lines[0].totalCost, '30.00');
    assert.equal(String((await card(item.domates.id)).onHand), '4');
  });

  it('transfer: kaynaktan çıkar hedefe girer, kart toplamı değişmez; hareket listesi tür süzgeci ve kaynak bağları', async () => {
    const transfer = await move({ kind: 'TRANSFER', warehouseId: warehouse.ana.id, toWarehouseId: warehouse.bar.id, lines: [{ stockItemId: item.yumurta.id, quantity: '24' }] });
    assert.deepEqual([transfer.lines[0].levelAfter, transfer.lines[0].toLevelAfter], ['36', '24']);
    assert.equal(String((await card(item.yumurta.id)).onHand), '60');
    assert.equal(await level(warehouse.ana.id, item.yumurta.id), '36');
    assert.equal(await level(warehouse.bar.id, item.yumurta.id), '24');
    const rows = await moves({ stockItemId: item.yumurta.id, kind: { in: ['TRANSFER_OUT', 'TRANSFER_IN'] } });
    assert.deepEqual(rows.map((row) => [row.kind, String(row.quantity), row.warehouseId]).sort(), [['TRANSFER_IN', '24', warehouse.bar.id], ['TRANSFER_OUT', '-24', warehouse.ana.id]].sort());
    assert.ok(rows.every((row) => String(row.onHandAfter) === '60' || String(row.onHandAfter) === '36'));

    const list = await boss(() => stock.listMovements(hotelId, contracts.stockMovementListQuerySchema.parse({ kind: 'TRANSFER_IN' })));
    assert.equal(list.meta.total, 1);
    assert.equal(list.items[0].source.type, 'ManualMovement');
    // Bar deposu artık stoklu: pasife alınamaz.
    const bar = (await boss(() => stock.listWarehouses(hotelId, { includeInactive: true }))).find((row) => row.id === warehouse.bar.id);
    await rejectsWith(boss(() => stock.updateWarehouse(hotelId, warehouse.bar.id, contracts.updateWarehouseSchema.parse({ expectedUpdatedAt: bar.updatedAt, code: 'BAR', name: 'Bar deposu', isDefault: false, isActive: false }))), 'WAREHOUSE_HAS_STOCK');
  });

  /* ─────────────── Sayım ─────────────── */

  it('sayım: açılışta mevcutlar dondurulur, sayılan girilir (yeni malzeme eklenir), onayda fark hareket olur; depoda tek açık sayım; iptal stoğa dokunmaz', async () => {
    const opened = await boss(() => counts.createCount(hotelId, contracts.createStockCountSchema.parse({ warehouseId: warehouse.ana.id, note: 'Ay sonu' })));
    assert.match(opened.number, /^SYM-\d{4}-0001$/);
    assert.equal(opened.status, 'OPEN');
    assert.deepEqual(opened.lines.map((line) => [line.name, line.expectedQuantity, line.countedQuantity]), [['Dana kıyma', '10', null], ['Domates', '5', null], ['Yumurta', '60', null]]);
    await rejectsWith(boss(() => counts.createCount(hotelId, contracts.createStockCountSchema.parse({ warehouseId: warehouse.ana.id }))), 'COUNT_ALREADY_OPEN');
    // Bu arada satış / çıkış sürer: onayda fark o anki mevcuda göre yazılır.
    await move({ kind: 'ISSUE', warehouseId: warehouse.ana.id, lines: [{ stockItemId: item.dana.id, quantity: '1' }] });

    const bardak = await boss(() => stockItems.createStockItem(hotelId, contracts.createStockItemSchema.parse({ name: 'Bardak', group: 'OTHER', unit: 'PIECE', unitCost: '12' })));
    const saved = await boss(() =>
      counts.saveCountLines(
        hotelId,
        opened.id,
        contracts.updateStockCountLinesSchema.parse({
          expectedUpdatedAt: opened.updatedAt,
          lines: [
            { stockItemId: item.dana.id, countedQuantity: '8,5' },
            { stockItemId: item.yumurta.id, countedQuantity: '60' },
            { stockItemId: bardak.id, countedQuantity: '20' },
            { stockItemId: item.domates.id, countedQuantity: '' },
          ],
        }),
      ),
    );
    const byName = Object.fromEntries(saved.lines.map((line) => [line.name, line]));
    assert.deepEqual([byName['Dana kıyma'].currentQuantity, byName['Dana kıyma'].countedQuantity, byName['Dana kıyma'].differenceQuantity, byName['Dana kıyma'].differenceValue], ['9', '8.5', '-0.5', '-200.00']);
    assert.deepEqual([byName.Bardak.expectedQuantity, byName.Bardak.countedQuantity, byName.Bardak.differenceQuantity], ['0', '20', '20']);
    assert.equal(byName.Yumurta.differenceQuantity, '0');
    assert.equal(byName.Domates.countedQuantity, null);
    assert.equal(saved.counted, 3);
    // Eski sürümle yazmak reddedilir.
    await rejectsWith(boss(() => counts.saveCountLines(hotelId, opened.id, contracts.updateStockCountLinesSchema.parse({ expectedUpdatedAt: opened.updatedAt, lines: [{ stockItemId: item.dana.id, countedQuantity: '9' }] }))), 'STALE_WRITE');

    const approved = await boss(() => counts.approveCount(hotelId, opened.id, contracts.approveStockCountSchema.parse({ expectedUpdatedAt: saved.updatedAt })));
    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.adjustedLines, 2);
    assert.equal(approved.adjustedValue, '40.00'); // −0.5 kg × 400 + 20 × 12
    assert.equal(await level(warehouse.ana.id, item.dana.id), '8.5');
    assert.equal(String((await card(item.dana.id)).onHand), '8.5');
    assert.equal(String((await card(item.dana.id)).unitCost), '400');
    assert.equal(await level(warehouse.ana.id, bardak.id), '20');
    assert.equal(await level(warehouse.ana.id, item.domates.id), '5');
    const adjust = await moves({ kind: 'COUNT_ADJUST' });
    assert.deepEqual(adjust.map((row) => [row.stockItemId, String(row.quantity), row.sourceType, row.sourceId]).sort(), [[item.dana.id, '-0.5', 'StockCount', opened.id], [bardak.id, '20', 'StockCount', opened.id]].sort());
    await rejectsWith(boss(() => counts.cancelCount(hotelId, opened.id, contracts.cancelStockCountSchema.parse({ expectedUpdatedAt: approved.updatedAt, reason: 'Yanlış' }))), 'COUNT_NOT_OPEN');

    // Yeni sayım açılabilir; iptal hiçbir şeyi değiştirmez.
    const second = await boss(() => counts.createCount(hotelId, contracts.createStockCountSchema.parse({ warehouseId: warehouse.ana.id })));
    assert.match(second.number, /0002$/);
    const cancelled = await boss(() => counts.cancelCount(hotelId, second.id, contracts.cancelStockCountSchema.parse({ expectedUpdatedAt: second.updatedAt, reason: 'Yanlış depo seçildi' })));
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(await level(warehouse.ana.id, item.dana.id), '8.5');
    const listed = await boss(() => counts.listCounts(hotelId, contracts.stockCountListQuerySchema.parse({})));
    assert.deepEqual(listed.items.map((row) => row.status), ['CANCELLED', 'APPROVED']);
    const movementList = await boss(() => stock.listMovements(hotelId, contracts.stockMovementListQuerySchema.parse({ kind: 'COUNT_ADJUST' })));
    assert.deepEqual(movementList.items.map((row) => row.source.number), [opened.number, opened.number]);
  });

  /* ─────────────── Satış düşümü ─────────────── */

  it('satış düşümü: reçeteden malzemeye (satılan + ikram + zayi), ürün kimliğiyle; reçetesiz ürün atlanır; yeniden yayında fark; eski yayın atlanır', async () => {
    const checkId = randomUUID();
    const closedAt = new Date(Date.now() - 60_000).toISOString();
    const first = await as('inventory-worker', () => sales.consumeSale(hotelId, paidPayload({ checkId, closedAt })));
    assert.equal(first.posted, true);
    assert.equal(first.movements, 2);
    assert.deepEqual(first.skippedItems, ['Kola']);
    assert.match(first.message, /2 malzeme Ana depo/);
    // 5 porsiyon × (200 g kıyma + 2 yumurta) = 1 kg, 10 adet.
    assert.equal(String((await card(item.dana.id)).onHand), '9');
    assert.equal(String((await card(item.yumurta.id)).onHand), '50');
    assert.equal(String((await card(item.dana.id)).unitCost), '400');
    const saleMoves = await moves({ kind: 'SALE' });
    assert.deepEqual(saleMoves.map((row) => [row.stockItemId, String(row.quantity), String(row.totalCost), row.menuItemId, row.sourceType, row.sourceId]).sort(), [
      [item.dana.id, '-1', '-400', menu.kofte.id, 'PosCheck', checkId],
      [item.yumurta.id, '-10', '-40', menu.kofte.id, 'PosCheck', checkId],
    ].sort());

    // Adisyon yeniden açıldı, 2 satış kaldı (ikram ve zayi silindi): 3 porsiyona göre düzeltme (+0.4 kg, +4 adet).
    const later = new Date().toISOString();
    const second = await as('inventory-worker', () => sales.consumeSale(hotelId, paidPayload({ checkId, closedAt: later, items: [{ menuItemId: menu.kofte.id, name: 'Köfte', sold: 3, comped: 0, wasted: 0 }] })));
    assert.equal(second.posted, true);
    assert.match(second.message, /düzeltildi/);
    assert.equal(String((await card(item.dana.id)).onHand), '9.4');
    assert.equal(String((await card(item.yumurta.id)).onHand), '54');
    // Aynı yayın tekrar gelirse fark yok.
    const same = await as('inventory-worker', () => sales.consumeSale(hotelId, paidPayload({ checkId, closedAt: later, items: [{ menuItemId: menu.kofte.id, name: 'Köfte', sold: 3, comped: 0, wasted: 0 }] })));
    assert.equal(same.posted, false);
    // Eski yayın (ilk kapanış) geç gelirse atlanır.
    const stale = await as('inventory-worker', () => sales.consumeSale(hotelId, paidPayload({ checkId, closedAt })));
    assert.equal(stale.posted, false);
    assert.match(stale.skipped, /Daha yeni/);
    assert.equal(String((await card(item.dana.id)).onHand), '9.4');
    // Satış düşümü eksiye inebilir.
    const big = await as('inventory-worker', () => sales.consumeSale(hotelId, paidPayload({ items: [{ menuItemId: menu.kofte.id, name: 'Köfte', sold: 100, comped: 0, wasted: 0 }] })));
    assert.equal(big.posted, true);
    assert.equal(String((await card(item.dana.id)).onHand), '-10.6');
    // Hareket listesinde adisyon numarası ve ürün.
    const list = await boss(() => stock.listMovements(hotelId, contracts.stockMovementListQuerySchema.parse({ kind: 'SALE', stockItemId: item.dana.id })));
    assert.equal(list.items[0].source.type, 'PosCheck');
    assert.equal(list.items[0].menuItem.name, 'Köfte');
  });

  it('satış noktası → depo eşlemesi: eşlenen depodan düşer, eşlenmeyen varsayılandan; depo yoksa iş hatası', async () => {
    const described = await boss(() => settings.describeStockSettings(hotelId));
    assert.equal(described.defaultWarehouse.name, 'Ana depo');
    assert.deepEqual(described.outlets.map((row) => [row.name, row.warehouseId]), [['Restoran', null]]);
    const hotelRow = await db.hotel.findUnique({ where: { id: hotelId }, select: { updatedAt: true } });
    const saved = await boss(() => settings.saveStockSettings(hotelId, contracts.updateStockSettingsSchema.parse({ expectedUpdatedAt: hotelRow.updatedAt.toISOString(), outletWarehouses: [{ outletId: menu.outlet.id, warehouseId: warehouse.bar.id }] })));
    assert.deepEqual(saved.outlets.map((row) => [row.name, row.warehouseName]), [['Restoran', 'Bar deposu']]);
    await move({ kind: 'TRANSFER', warehouseId: warehouse.ana.id, toWarehouseId: warehouse.bar.id, lines: [{ stockItemId: item.dana.id, quantity: '2' }, { stockItemId: item.yumurta.id, quantity: '20' }] });
    const result = await as('inventory-worker', () => sales.consumeSale(hotelId, paidPayload({ items: [{ menuItemId: menu.kofte.id, name: 'Köfte', sold: 5, comped: 0, wasted: 0 }] })));
    assert.equal(result.warehouse, 'Bar deposu');
    assert.equal(await level(warehouse.bar.id, item.dana.id), '1');
    assert.equal(await level(warehouse.ana.id, item.dana.id), '8');
    assert.equal(await level(warehouse.bar.id, item.yumurta.id), '10');
    // Pasif depoya eşleme reddedilir; depo olmayan otelde iş hatası.
    await rejectsWith(boss(() => settings.saveStockSettings(hotelId, contracts.updateStockSettingsSchema.parse({ expectedUpdatedAt: saved.updatedAt, outletWarehouses: [{ outletId: menu.outlet.id, warehouseId: randomUUID() }] }))), 'VALIDATION', /Depo bulunamadı/);
    await rejectsWith(as('inventory-worker', () => sales.consumeSale(otherHotelId, { ...paidPayload(), hotelId: otherHotelId })), 'NO_WAREHOUSE');
  });

  /* ─────────────── Minimum altı önerisi ─────────────── */

  it('minimum altı: miktarı düşen malzeme için STOCK talebi + zil; talep açıkken ikinci kez açılmaz; minimum üstü öneri değil', async () => {
    const levels = await boss(() => stock.listLevels(hotelId, contracts.stockLevelListQuerySchema.parse({})));
    const danaRow = levels.items.find((row) => row.stockItemId === item.dana.id);
    await boss(() => stock.updateMinLevel(hotelId, item.dana.id, contracts.updateMinLevelSchema.parse({ expectedUpdatedAt: danaRow.updatedAt, minLevel: '12' })));
    const yumurtaRow = levels.items.find((row) => row.stockItemId === item.yumurta.id);
    await boss(() => stock.updateMinLevel(hotelId, item.yumurta.id, contracts.updateMinLevelSchema.parse({ expectedUpdatedAt: yumurtaRow.updatedAt, minLevel: '30' })));
    const none = await as('inventory-worker', () => suggestions.suggestPurchases(hotelId, [item.yumurta.id]));
    assert.equal(none.created, false);
    const first = await as('inventory-worker', () => suggestions.suggestPurchases(hotelId, [item.dana.id, item.yumurta.id, item.domates.id]));
    assert.equal(first.created, true);
    assert.match(first.number, /^STR-\d{4}-0001$/);
    assert.deepEqual(first.lines.length, 1);
    assert.match(first.lines[0], /Dana kıyma 2 \(elde 10, min 12\)/);
    const request = await db.purchaseRequest.findUnique({ where: { id: first.requestId }, include: { lines: true } });
    assert.equal(request.source, 'STOCK');
    assert.equal(request.status, 'OPEN');
    assert.deepEqual(request.lines.map((line) => [line.stockItemId, String(line.quantity)]), [[item.dana.id, '2']]);
    const alert = await db.staffAlert.findFirst({ where: { hotelId, kind: 'STOCK' } });
    assert.ok(alert);
    assert.match(alert.title, /1 malzeme minimumun altında/);
    assert.equal(alert.permission, 'purchasing.request');
    // Talep "talep edilen"e sayılır: aynı malzeme için yeniden talep yok.
    const again = await as('inventory-worker', () => suggestions.suggestPurchases(hotelId, [item.dana.id]));
    assert.equal(again.created, false);
    assert.equal(await db.purchaseRequest.count({ where: { hotelId } }), 1);
  });

  /* ─────────────── Maliyet raporu ─────────────── */

  it('maliyet raporu: giriş, satış, çıkış, fire, sayım farkı tutarları ve dönem sonu değer; ürün bazlı maliyet', async () => {
    await as('inventory-worker', () => sales.consumeSale(hotelId, paidPayload({ items: [{ menuItemId: menu.kofte.id, name: 'Köfte', sold: 5, comped: 0, wasted: 0 }] })));
    await move({ kind: 'WASTE', warehouseId: warehouse.ana.id, lines: [{ stockItemId: item.domates.id, quantity: '1' }], note: 'Çürük' });
    await move({ kind: 'ISSUE', warehouseId: warehouse.ana.id, lines: [{ stockItemId: item.yumurta.id, quantity: '10' }] });
    const report = await boss(() => reports.costReport(hotelId, contracts.stockCostReportQuerySchema.parse({ from: D(-1), to: D(0) })));
    const byName = Object.fromEntries(report.items.map((row) => [row.name, row]));
    assert.deepEqual([byName['Dana kıyma'].receiptQty, byName['Dana kıyma'].receiptCost, byName['Dana kıyma'].saleQty, byName['Dana kıyma'].saleCost, byName['Dana kıyma'].onHand, byName['Dana kıyma'].value], ['10', '4000.00', '1', '400.00', '9', '3600.00']);
    assert.deepEqual([byName.Yumurta.saleQty, byName.Yumurta.issueQty, byName.Yumurta.consumptionCost, byName.Yumurta.onHand], ['10', '10', '80.00', '40']);
    assert.deepEqual([byName.Domates.wasteQty, byName.Domates.wasteCost, byName.Domates.value], ['1', '30.00', '120.00']);
    assert.deepEqual(report.totals, { receiptCost: '4390.00', saleCost: '440.00', issueCost: '40.00', wasteCost: '30.00', consumptionCost: '510.00', countCost: '0.00', transferCost: '0.00', value: '3880.00', items: 3 });
    // Depo süzgeci: bar deposunda hareket yok.
    const bar = await boss(() => reports.costReport(hotelId, contracts.stockCostReportQuerySchema.parse({ from: D(-1), to: D(0), warehouseId: warehouse.bar.id })));
    assert.equal(bar.items.length, 0);
    // Ürün bazlı: ciro yok (adisyon kalemi yazılmadı) ama reçete maliyeti var.
    const products = await boss(() => reports.productCostReport(hotelId, contracts.stockProductReportQuerySchema.parse({ from: D(-1), to: D(0) })));
    assert.deepEqual(products.items.map((row) => [row.name, row.cost, row.ingredients, row.hasRecipe]), [['Köfte', '440.00', 2, true]]);
    assert.equal(products.totals.cost, '440.00');
    // Aralık sınırı sözleşmede.
    assert.throws(() => contracts.stockCostReportQuerySchema.parse({ from: '2024-01-01', to: '2026-01-01' }));
  });

  /* ─────────────── İzinler ─────────────── */

  it('izinler: elle hareket, sayım ve ayar `stock.manage`; görmek `stock.view`; ön büro giremez', async () => {
    const body = { requestId: randomUUID(), kind: 'ISSUE', warehouseId: warehouse.ana.id, lines: [{ stockItemId: item.dana.id, quantity: '1' }] };
    assert.equal((await call('POST', '/stock/movements', DESK, body)).statusCode, 403);
    assert.equal((await call('GET', '/stock/counts', DESK)).statusCode, 403);
    const created = await call('POST', '/stock/movements', MANAGER, body);
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().data.lines[0].levelAfter, '9');
    const listed = await call('GET', `/stock/movements?kind=ISSUE`, KITCHEN);
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(listed.json().data.meta.total, 1);
    assert.equal((await call('GET', `/stock/reports/cost?from=${D(-1)}&to=${D(0)}`, KITCHEN)).statusCode, 200);
    assert.equal((await call('GET', '/stock/settings', KITCHEN)).statusCode, 200);
    const count = await call('POST', '/stock/counts', MANAGER, { warehouseId: warehouse.ana.id });
    assert.equal(count.statusCode, 201, count.body);
    assert.equal((await call('GET', `/stock/counts/${count.json().data.id}`, KITCHEN)).statusCode, 200);
    // Eksik alan 400.
    assert.equal((await call('POST', '/stock/movements', MANAGER, { ...body, requestId: randomUUID(), kind: 'TRANSFER' })).statusCode, 400);
  });
});
