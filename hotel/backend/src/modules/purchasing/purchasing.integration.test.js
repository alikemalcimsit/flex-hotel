import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Satın alma ve stok çekirdeği (modül 45) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: elle talep → açık satırların malzeme başına birleşmesi → teklif turu (ekranın gördüğü
 * toplam, eşzamanlı iki tur) → teklifler (sürüm damgası) → satır bazında kazanan (en uygun dışı
 * gerekçe, tedarikçi başına sipariş, KDV satırda) → mal kabul (kısmi, %5 tolerans, adette tolerans
 * yok, aynı irsaliye, eksik kapatma, eşzamanlı iki kabul) → stok (depo satırı, toplam mevcut,
 * hareketli ortalama — elle hesaplanmış sayılarla, hareket kaydı) → borç olayı (vade); eşik üstü
 * siparişin dört göz onayı, reddin satırları tura döndürmesi, iptal, turun kapatılması; minimum
 * stok önerisi; depo kuralları; malzeme birimi / maliyet koruması; PDF; izinler ve otel kapsamı.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'satinalma@test.local';
const MANAGER2 = 'genelmudur@test.local';
const KITCHEN = 'mutfak@test.local';
const ACCOUNTING = 'muhasebe@test.local';
const DESK = 'onburo@test.local';

describe('satın alma ve stok (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let stockItems;
  /** @type {any} */ let requests;
  /** @type {any} */ let suppliers;
  /** @type {any} */ let rounds;
  /** @type {any} */ let orders;
  /** @type {any} */ let receipts;
  /** @type {any} */ let settings;
  /** @type {any} */ let stock;
  /** @type {any} */ let approvals;
  /** @type {any} */ let eventBus;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let otherHotelId;
  /** @type {Record<string, any>} */ let item;
  /** @type {Record<string, any>} */ let supplier;
  /** @type {Record<string, any>} */ let warehouse;
  /** @type {Map<string, string>} */ let tokens;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    stockItems = await import('../recipes/stock-items.js');
    requests = await import('./service.js');
    suppliers = await import('./suppliers.js');
    rounds = await import('./rounds.js');
    orders = await import('./orders.js');
    receipts = await import('./receipts.js');
    settings = await import('./settings.js');
    stock = await import('../stock/service.js');
    approvals = await import('../approvals/service.js');
    ({ eventBus } = await import('../../lib/events.js'));
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

  beforeEach(async () => {
    await resetDatabase(db);
    cache.cache.invalidatePrefix('settings:');
    tokens = new Map();
    hotelId = (await db.hotel.create({ data: { name: 'Büyük Ankara Oteli', code: `P${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka Otel', code: `O${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Satın Alma Müdürü', role: 'MANAGER', passwordHash },
        { hotelId, email: MANAGER2, name: 'Genel Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: KITCHEN, name: 'Mutfak Şefi', role: 'FNB', passwordHash },
        { hotelId, email: ACCOUNTING, name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
        { hotelId, email: DESK, name: 'Ön Büro', role: 'FRONT_DESK', passwordHash },
      ],
    });
    const newStock = (input) => boss(() => stockItems.createStockItem(hotelId, contracts.createStockItemSchema.parse(input)));
    item = {
      dana: await newStock({ code: 'ET-010', name: 'Dana but', group: 'MEAT', unit: 'KG', unitCost: '400' }),
      domates: await newStock({ name: 'Domates', group: 'PRODUCE', unit: 'KG', unitCost: '30' }),
      yumurta: await newStock({ name: 'Yumurta', group: 'DAIRY', unit: 'PIECE', unitCost: '4.25' }),
    };
    const newSupplier = (input) => boss(() => suppliers.createSupplier(hotelId, contracts.createSupplierSchema.parse(input)));
    supplier = {
      kasap: await newSupplier({ code: 'KSP', name: 'Ankara Kasabı', taxNumber: '1234567890', paymentTermDays: 30, leadTimeDays: 1, groups: ['MEAT'] }),
      hal: await newSupplier({ name: 'Hal Sebze', paymentTermDays: 15, leadTimeDays: 1, groups: ['PRODUCE', 'MEAT'] }),
      toptan: await newSupplier({ name: 'Toptan Gıda', paymentTermDays: 45, leadTimeDays: 2, groups: ['DAIRY'] }),
    };
    const newWarehouse = (input) => boss(() => stock.createWarehouse(hotelId, contracts.createWarehouseSchema.parse(input)));
    warehouse = { ana: await newWarehouse({ code: 'ANA', name: 'Ana depo' }), soguk: await newWarehouse({ code: 'SGK', name: 'Soğuk oda' }) };
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });

  /* ── Zincir yardımcıları ── */

  const newRequest = (lines, { source = 'MANUAL', neededBy = D(3), email = KITCHEN } = {}) =>
    as(email, () => requests.createRequest(hotelId, contracts.createPurchaseRequestSchema.parse({ source, neededBy, lines })));
  const openLines = (query = {}) => as(MANAGER, () => rounds.listOpenLines(hotelId, contracts.openRequestLinesQuerySchema.parse(query)));
  const newRound = (items, extra = {}) => boss(() => rounds.createRound(hotelId, contracts.createPurchaseRoundSchema.parse({ items, ...extra })));
  /** Turu açık satırların gördüğü toplamlarla açar. */
  async function roundOf(...stockItemIds) {
    const page = await openLines({ pageSize: 100 });
    return newRound(stockItemIds.map((stockItemId) => ({ stockItemId, expectedQuantity: page.items.find((row) => row.stockItemId === stockItemId).quantity })));
  }
  const reloadRound = (roundId) => boss(() => rounds.getRound(hotelId, roundId));
  async function quote(roundId, supplierId, deliveryDays, prices, extra = {}) {
    const round = await reloadRound(roundId);
    const lines = round.lines.map((line) => ({ roundLineId: line.id, unitPrice: prices[line.stockItemId] ?? null, taxRatePct: '1' }));
    return boss(() => rounds.saveQuote(hotelId, roundId, supplierId, contracts.savePurchaseQuoteSchema.parse({ expectedUpdatedAt: round.updatedAt, deliveryDays, lines, ...extra })));
  }
  /** Kazanan: { stockItemId: [supplierId, reason?] } */
  async function award(roundId, picks, email = MANAGER) {
    const round = await reloadRound(roundId);
    const awards = Object.entries(picks).map(([stockItemId, [supplierId, reason]]) => {
      const line = round.lines.find((entry) => entry.stockItemId === stockItemId);
      const cell = round.quotes.find((entry) => entry.supplierId === supplierId).lines.find((entry) => entry.roundLineId === line.id);
      return { roundLineId: line.id, quoteLineId: cell.id, reason: reason ?? null };
    });
    return as(email, () => rounds.awardRound(hotelId, roundId, contracts.awardPurchaseRoundSchema.parse({ expectedUpdatedAt: round.updatedAt, awards })));
  }
  const reloadOrder = (orderId) => boss(() => orders.getOrder(hotelId, orderId));
  async function receive(orderId, quantities, { warehouseId = warehouse.ana.id, waybillNumber = `IRS-${randomUUID().slice(0, 6)}`, closeShort = false, email = KITCHEN, expectedUpdatedAt } = {}) {
    const order = await reloadOrder(orderId);
    const lines = Object.entries(quantities).map(([stockItemId, quantity]) => ({ orderLineId: order.lines.find((line) => line.stockItemId === stockItemId).id, quantity }));
    return as(email, () =>
      receipts.receiveGoods(
        hotelId,
        orderId,
        contracts.receiveGoodsSchema.parse({ expectedUpdatedAt: expectedUpdatedAt ?? order.updatedAt, warehouseId, waybillNumber, receivedOn: D(0), closeShort, lines }),
      ),
    );
  }
  const stockItem = (id) => db.stockItem.findUnique({ where: { id }, select: { onHand: true, unitCost: true } });
  const requestStatus = async (requestId) => (await db.purchaseRequest.findUnique({ where: { id: requestId }, select: { status: true } })).status;

  it('talep → teklif turu → satır bazında kazanan → sipariş → mal kabul: stok, hareketli ortalama, borç olayı', async () => {
    const r1 = await newRequest([
      { stockItemId: item.dana.id, quantity: '20', neededBy: D(3) },
      { stockItemId: item.domates.id, quantity: '15', neededBy: D(2) },
    ]);
    const r2 = await newRequest([
      { stockItemId: item.dana.id, quantity: '5', neededBy: D(5) },
      { stockItemId: item.yumurta.id, quantity: '360', neededBy: D(2) },
    ]);
    assert.match(r1.number, /^STR-\d{4}-0001$/);
    assert.equal(r1.source, 'MANUAL');
    await rejectsWith(newRequest([{ stockItemId: item.yumurta.id, quantity: '2.5' }]), 'VALIDATION', /adet tam sayı/);
    await rejectsWith(newRequest([{ stockItemId: item.dana.id, quantity: '1' }], { neededBy: D(-1) }), 'VALIDATION', /bugünden önce/);

    // Açık satırlar malzeme başına: dana 20 + 5, en erken ihtiyaç D+3.
    const open = await openLines({ pageSize: 100 });
    const dana = open.items.find((row) => row.stockItemId === item.dana.id);
    assert.deepEqual([dana.quantity, dana.neededBy, dana.requests, dana.lines], ['25', D(3), 2, 2]);
    assert.equal(open.meta.total, 3);

    // Ekranın gördüğü toplam tutmazsa tur açılmaz.
    await rejectsWith(newRound([{ stockItemId: item.dana.id, expectedQuantity: '20' }]), 'LINES_CHANGED', /Dana but: 20 → 25/);
    const round = await roundOf(item.dana.id, item.domates.id, item.yumurta.id);
    assert.match(round.number, /^TKT-\d{4}-0001$/);
    assert.deepEqual(
      round.lines.map((line) => [line.name, line.quantity, line.neededBy]),
      [
        ['Domates', '15', D(2)],
        ['Yumurta', '360', D(2)],
        ['Dana but', '25', D(3)],
      ],
    );
    assert.equal(await requestStatus(r1.id), 'IN_PROGRESS');
    assert.equal((await openLines()).meta.total, 0);

    // Teklifler: kasap danada ucuz; hal domates + yumurta; toptancı yumurtada aynı fiyat, uzun termin.
    await quote(round.id, supplier.kasap.id, 1, { [item.dana.id]: '415.5' });
    await quote(round.id, supplier.hal.id, 1, { [item.dana.id]: '420', [item.domates.id]: '28.4', [item.yumurta.id]: '4.10' });
    // Eski sürümle teklif: başkası bu arada teklif girdi.
    await rejectsWith(
      boss(() =>
        rounds.saveQuote(
          hotelId,
          round.id,
          supplier.toptan.id,
          contracts.savePurchaseQuoteSchema.parse({ expectedUpdatedAt: round.updatedAt, deliveryDays: 2, lines: [{ roundLineId: round.lines[1].id, unitPrice: '4.10', taxRatePct: '1' }] }),
        ),
      ),
      'STALE_WRITE',
    );
    let compare = await quote(round.id, supplier.toptan.id, 2, { [item.yumurta.id]: '4.10' });
    const best = (stockItemId) => {
      const line = compare.lines.find((entry) => entry.stockItemId === stockItemId);
      return compare.quotes.find((entry) => entry.lines.some((cell) => cell.id === line.bestQuoteLineId)).supplierName;
    };
    assert.equal(best(item.dana.id), 'Ankara Kasabı');
    assert.equal(best(item.domates.id), 'Hal Sebze');
    assert.equal(best(item.yumurta.id), 'Hal Sebze'); // eşit fiyatta kısa termin
    const halQuote = compare.quotes.find((entry) => entry.supplierId === supplier.hal.id);
    // Hal toplamı: 25 × 420 = 10500 + 105 KDV; 15 × 28.4 = 426 + 4.26; 360 × 4.10 = 1476 + 14.76.
    assert.deepEqual([halQuote.net, halQuote.tax, halQuote.total, halQuote.pricedLines], ['12402.00', '124.02', '12526.02', 3]);

    // En uygun dışı seçim gerekçe ister.
    await rejectsWith(award(round.id, { [item.yumurta.id]: [supplier.toptan.id] }), 'VALIDATION', /gerekçe/);
    const { orders: created, round: awarded } = await award(round.id, {
      [item.dana.id]: [supplier.kasap.id],
      [item.domates.id]: [supplier.hal.id],
      [item.yumurta.id]: [supplier.toptan.id, 'Hal yumurtası kırık geliyor'],
    });
    assert.equal(awarded.status, 'AWARDED');
    assert.equal(created.length, 3);
    assert.ok(created.every((order) => order.status === 'APPROVED'));
    assert.deepEqual(created.map((order) => order.number).sort(), ['SAS-', 'SAS-', 'SAS-'].map((prefix, index) => `${prefix}${today().getUTCFullYear()}-000${index + 1}`));
    assert.equal(await requestStatus(r1.id), 'ORDERED');
    assert.equal(await requestStatus(r2.id), 'ORDERED');
    const byName = Object.fromEntries(created.map((order) => [order.supplierName, order]));
    // Kasap: 25 × 415.5 = 10387.50; KDV %1 = 103.875 → 103.88; toplam 10491.38.
    let kasap = await reloadOrder(byName['Ankara Kasabı'].id);
    assert.deepEqual([kasap.netTotal, kasap.taxTotal, kasap.grandTotal, kasap.paymentTermDays, kasap.expectedOn], ['10387.50', '103.88', '10491.38', 30, D(1)]);
    const toptan = await reloadOrder(byName['Toptan Gıda'].id);
    assert.equal(toptan.lines[0].awardReason, 'Hal yumurtası kırık geliyor');
    assert.equal(toptan.grandTotal, '1490.76');

    // Mal kabul 1 (ana depo): 10.2 kg — elde stok yok, maliyet alış fiyatı.
    const events = [];
    const unsubscribe = eventBus.subscribeMany(['purchase.goods.received', 'stock.changed'], 'test:purchasing', (payload, envelope) => events.push({ name: envelope.name, payload }));
    try {
      const first = await receive(kasap.id, { [item.dana.id]: '10.2' }, { waybillNumber: 'K-1001' });
      // 10.2 × 415.5 = 4238.10; KDV 42.381 → 42.38; toplam 4280.48; vade = bugün + 30.
      assert.deepEqual([first.netTotal, first.taxTotal, first.grandTotal, first.dueDate], ['4238.10', '42.38', '4280.48', D(30)]);
      assert.match(first.number, /^MKB-\d{4}-0001$/);
      const goods = events.find((event) => event.name === 'purchase.goods.received').payload;
      assert.deepEqual([goods.grandTotal, goods.dueDate, goods.supplierId, goods.currency], ['4280.48', D(30), supplier.kasap.id, 'TRY']);
      assert.deepEqual(events.find((event) => event.name === 'stock.changed').payload.stockItemIds, [item.dana.id]);
    } finally {
      unsubscribe();
    }
    let dana1 = await stockItem(item.dana.id);
    assert.deepEqual([String(dana1.onHand), String(dana1.unitCost)], ['10.2', '415.5']);
    kasap = await reloadOrder(kasap.id);
    assert.equal(kasap.status, 'PARTIALLY_RECEIVED');
    assert.deepEqual([kasap.lines[0].receivedQuantity, kasap.lines[0].remaining, kasap.lines[0].receivable], ['10.2', '14.8', '16.05']);

    // Aynı tedarikçinin aynı irsaliyesi ikinci kez girilemez; tolerans üstü miktar reddedilir.
    await rejectsWith(receive(kasap.id, { [item.dana.id]: '1' }, { waybillNumber: 'K-1001' }), 'VALIDATION', /zaten girildi/);
    await rejectsWith(receive(kasap.id, { [item.dana.id]: '16.06' }), 'VALIDATION', /en fazla 16\.05 kg/);

    // Mal kabul 2 (soğuk oda): 15 kg (%5 içinde fazla) → sipariş tam.
    await receive(kasap.id, { [item.dana.id]: '15' }, { warehouseId: warehouse.soguk.id, waybillNumber: 'K-1002' });
    kasap = await reloadOrder(kasap.id);
    assert.equal(kasap.status, 'RECEIVED');
    // 15 × 415.5 = 6232.50; KDV 62.325 → 62.33; 6294.83 + 4280.48 = 10575.31.
    assert.equal(kasap.receivedTotal, '10575.31');
    await rejectsWith(boss(() => orders.cancelOrder(hotelId, kasap.id, { expectedUpdatedAt: new Date(kasap.updatedAt), reason: 'Deneme iptal' })), 'ORDER_STATUS');

    // Adette tolerans yok.
    await rejectsWith(receive(toptan.id, { [item.yumurta.id]: '361' }), 'VALIDATION', /en fazla 360 adet/);

    // Eksik kapatma: domates 14 kg gelir, kalanı gelmeyecek.
    const hal = await reloadOrder(byName['Hal Sebze'].id);
    const closing = await receive(hal.id, { [item.domates.id]: '14' }, { closeShort: true });
    assert.equal(closing.closedShort, true);
    assert.equal((await reloadOrder(hal.id)).status, 'CLOSED');

    // İkinci tur: danayı haldan ucuza al → hareketli ortalama: (25.2 × 415.5 + 5 × 380) / 30.2 = 409.6225.
    await newRequest([{ stockItemId: item.dana.id, quantity: '5' }]);
    const round2 = await roundOf(item.dana.id);
    await quote(round2.id, supplier.hal.id, 1, { [item.dana.id]: '380' });
    const second = (await award(round2.id, { [item.dana.id]: [supplier.hal.id] })).orders[0];
    await receive(second.id, { [item.dana.id]: '5' });
    dana1 = await stockItem(item.dana.id);
    assert.deepEqual([String(dana1.onHand), String(dana1.unitCost)], ['30.2', '409.6225']);

    // Depo dağılımı ve değer: ana 10.2 + 5, soğuk 15; değer 30.2 × 409.6225 = 12370.5995 → 12370.60.
    const levels = await boss(() => stock.listLevels(hotelId, contracts.stockLevelListQuerySchema.parse({ search: 'dana' })));
    const level = levels.items[0];
    assert.deepEqual([level.onHand, level.value, level.unitCost], ['30.2', '12370.60', '409.6225']);
    assert.deepEqual(
      level.warehouses.map((entry) => [entry.warehouseName, entry.quantity]),
      [
        ['Ana depo', '15.2'],
        ['Soğuk oda', '15'],
      ],
    );
    const moves = await boss(() => stock.listMovements(hotelId, contracts.stockMovementListQuerySchema.parse({ stockItemId: item.dana.id })));
    assert.deepEqual(
      moves.items.map((move) => [move.quantity, move.unitCost, move.onHandAfter, move.avgCostAfter]),
      [
        ['5', '380.0000', '30.2', '409.6225'],
        ['15', '415.5000', '25.2', '415.5000'],
        ['10.2', '415.5000', '10.2', '415.5000'],
      ],
    );
    assert.match(moves.items[2].source.number, /^MKB-/);
    const summary = await boss(() => stock.getStockSummary(hotelId));
    // Dana 12370.60 + domates 14 × 28.4 = 397.60 → 12768.20.
    assert.deepEqual([summary.value, summary.inStock, summary.warehouses], ['12768.20', 2, 2]);
  });

  it('eşik üstü sipariş onaya gider: dört göz, red satırları tura döndürür, onay siparişi açar; iptal ve tur kapatma', async () => {
    await boss(() => settings.updatePurchaseSettings(hotelId, contracts.updatePurchaseSettingsSchema.parse({ orderApprovalAmount: '10000', defaultTaxRatePct: '10' })));
    const request = await newRequest([{ stockItemId: item.dana.id, quantity: '30' }]);
    const round = await roundOf(item.dana.id);
    await quote(round.id, supplier.kasap.id, 2, { [item.dana.id]: '415.5' });
    let [order] = (await award(round.id, { [item.dana.id]: [supplier.kasap.id] })).orders;
    // 30 × 415.5 = 12465 + 124.65 = 12589.65 ≥ 10000 → onay.
    assert.deepEqual([order.status, order.grandTotal], ['PENDING_APPROVAL', '12589.65']);
    let detail = await reloadOrder(order.id);
    assert.equal(detail.approval.status, 'PENDING');
    assert.equal((await db.approval.findUnique({ where: { id: detail.approval.id } })).type, 'PURCHASE_ORDER');

    await rejectsWith(receive(order.id, { [item.dana.id]: '1' }), 'ORDER_STATUS', /Onay bekliyor/);
    await rejectsWith(boss(() => orders.cancelOrder(hotelId, order.id, { expectedUpdatedAt: new Date(detail.updatedAt), reason: 'Vazgeçtik' })), 'ORDER_PENDING_APPROVAL');
    await rejectsWith(boss(() => approvals.decideApproval(hotelId, detail.approval.id, 'GRANTED', { note: 'Kendime' })), 'SELF_DECISION');

    // Red: sipariş reddedilir, satır tura döner (yeniden seçilebilir), talep yine teklif / siparişte.
    await as(MANAGER2, () => approvals.decideApproval(hotelId, detail.approval.id, 'DENIED', { note: 'Fiyat yüksek, pazarlık yapın' }));
    detail = await reloadOrder(order.id);
    assert.equal(detail.status, 'REJECTED');
    let current = await reloadRound(round.id);
    assert.equal(current.status, 'OPEN');
    assert.deepEqual([current.lines[0].state, current.lines[0].awardedQuoteLineId], ['PENDING', null]);
    assert.equal(await requestStatus(request.id), 'IN_PROGRESS');
    const alert = await db.staffAlert.findFirst({ where: { hotelId, entityId: detail.approval.id }, select: { title: true, link: true } });
    assert.match(alert.title, /reddedildi/);
    assert.equal(alert.link, `/satin-alma/siparisler/${order.id}`);

    // Pazarlık: yeni fiyat, yeniden seçim → onay → onaylı (onaylayan genel müdür).
    await quote(round.id, supplier.kasap.id, 2, { [item.dana.id]: '400' });
    [order] = (await award(round.id, { [item.dana.id]: [supplier.kasap.id] })).orders;
    assert.equal(order.status, 'PENDING_APPROVAL'); // 12000 + 120 = 12120
    detail = await reloadOrder(order.id);
    await as(MANAGER2, () => approvals.decideApproval(hotelId, detail.approval.id, 'GRANTED', { note: 'Uygun' }));
    detail = await reloadOrder(order.id);
    assert.deepEqual([detail.status, detail.approvedBy, detail.grandTotal], ['APPROVED', MANAGER2, '12120.00']);
    assert.equal(await requestStatus(request.id), 'ORDERED');

    // Onaylı, teslim alınmamış sipariş iptal → satır tura döner; tur kapatılınca talebe döner.
    await boss(() => orders.cancelOrder(hotelId, order.id, { expectedUpdatedAt: new Date(detail.updatedAt), reason: 'Etkinlik ertelendi' }));
    current = await reloadRound(round.id);
    assert.equal(current.status, 'OPEN');
    await boss(() => rounds.cancelRound(hotelId, round.id, { expectedUpdatedAt: new Date(current.updatedAt), reason: 'Etkinlik ertelendi' }));
    current = await reloadRound(round.id);
    assert.deepEqual([current.status, current.lines[0].state], ['CANCELLED', 'RELEASED']);
    assert.equal(await requestStatus(request.id), 'OPEN');
    const open = await openLines();
    assert.deepEqual([open.meta.total, open.items[0].quantity], [1, '30']);
  });

  it('eşzamanlılık: aynı satırlara iki tur, aynı tura iki seçim, aynı siparişe iki mal kabul', async () => {
    await newRequest([{ stockItemId: item.domates.id, quantity: '40' }]);
    const items = [{ stockItemId: item.domates.id, expectedQuantity: '40' }];
    const roundsTried = await Promise.allSettled([newRound(items), newRound(items)]);
    assert.equal(roundsTried.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(roundsTried.find((result) => result.status === 'rejected').reason.code, 'LINES_CHANGED');
    const round = roundsTried.find((result) => result.status === 'fulfilled').value;

    await quote(round.id, supplier.hal.id, 1, { [item.domates.id]: '28' });
    const snapshot = await reloadRound(round.id);
    const pick = { roundLineId: snapshot.lines[0].id, quoteLineId: snapshot.quotes[0].lines[0].id };
    const awardOnce = () => boss(() => rounds.awardRound(hotelId, round.id, contracts.awardPurchaseRoundSchema.parse({ expectedUpdatedAt: snapshot.updatedAt, awards: [pick] })));
    const awards = await Promise.allSettled([awardOnce(), awardOnce()]);
    assert.equal(awards.filter((result) => result.status === 'fulfilled').length, 1);
    assert.ok(['STALE_WRITE', 'ROUND_STATUS'].includes(awards.find((result) => result.status === 'rejected').reason.code));
    assert.equal(await db.purchaseOrder.count({ where: { hotelId } }), 1);

    const order = await db.purchaseOrder.findFirst({ where: { hotelId }, select: { id: true, updatedAt: true } });
    const both = await Promise.allSettled([
      receive(order.id, { [item.domates.id]: '20' }, { expectedUpdatedAt: order.updatedAt.toISOString(), waybillNumber: 'H-1' }),
      receive(order.id, { [item.domates.id]: '20' }, { expectedUpdatedAt: order.updatedAt.toISOString(), waybillNumber: 'H-2' }),
    ]);
    assert.equal(both.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(both.find((result) => result.status === 'rejected').reason.code, 'STALE_WRITE');
    const domates = await stockItem(item.domates.id);
    assert.equal(String(domates.onHand), '20');
    assert.equal(await db.stockMovement.count({ where: { hotelId } }), 1);
  });

  it('minimum stok önerisi, depo kuralları, malzeme birimi ve maliyet koruması', async () => {
    const level = async (id) => (await boss(() => stock.listLevels(hotelId, contracts.stockLevelListQuerySchema.parse({ pageSize: 100 })))).items.find((row) => row.stockItemId === id);
    const setMin = async (id, minLevel) => boss(async () => stock.updateMinLevel(hotelId, id, contracts.updateMinLevelSchema.parse({ expectedUpdatedAt: (await level(id)).updatedAt, minLevel })));
    await setMin(item.dana.id, '20');
    await rejectsWith(setMin(item.yumurta.id, '100.5'), 'VALIDATION', /adet tam sayı/);
    await setMin(item.yumurta.id, '120');

    const suggestions = async () => (await as(KITCHEN, () => requests.listSuggestions(hotelId, contracts.purchaseSuggestionQuerySchema.parse({})))).items;
    let list = await suggestions();
    assert.deepEqual(
      list.map((row) => [row.name, row.suggested]),
      [
        ['Dana but', '20'],
        ['Yumurta', '120'],
      ],
    );
    // Öneriden talep: öneri düşer (talep edilen sayılır); banket talebi düşmez.
    await newRequest([{ stockItemId: item.dana.id, quantity: '12.5' }], { source: 'STOCK' });
    list = await suggestions();
    assert.deepEqual(list.find((row) => row.name === 'Dana but').suggested, '7.5');

    // Malzemenin açık talebi varken birimi değişmez.
    const dana = await db.stockItem.findUnique({ where: { id: item.dana.id } });
    await rejectsWith(
      boss(() =>
        stockItems.updateStockItem(
          hotelId,
          item.dana.id,
          contracts.updateStockItemSchema.parse({ expectedUpdatedAt: dana.updatedAt.toISOString(), code: 'ET-010', name: 'Dana but', group: 'MEAT', unit: 'G', unitCost: '0.4', allergens: [], isActive: true }),
        ),
      ),
      'UNIT_IN_USE',
      /açık talebi/,
    );

    // Elde stok varken maliyet elle değişmez.
    const round = await roundOf(item.dana.id);
    await quote(round.id, supplier.kasap.id, 1, { [item.dana.id]: '410' });
    const [order] = (await award(round.id, { [item.dana.id]: [supplier.kasap.id] })).orders;
    await receive(order.id, { [item.dana.id]: '12.5' });
    const stocked = await db.stockItem.findUnique({ where: { id: item.dana.id } });
    await rejectsWith(
      boss(() =>
        stockItems.updateStockItem(
          hotelId,
          item.dana.id,
          contracts.updateStockItemSchema.parse({ expectedUpdatedAt: stocked.updatedAt.toISOString(), code: 'ET-010', name: 'Dana but', group: 'MEAT', unit: 'KG', unitCost: '999', allergens: [], isActive: true }),
        ),
      ),
      'COST_FROM_STOCK',
    );
    assert.deepEqual((await level(item.dana.id)).belowMin, true); // 12.5 < 20

    // Depo: yeni varsayılan eskisini düşürür; varsayılan pasife alınamaz; stoklu depo pasife alınamaz.
    const bar = await boss(() => stock.createWarehouse(hotelId, contracts.createWarehouseSchema.parse({ code: 'BAR', name: 'Bar deposu', isDefault: true })));
    let all = await boss(() => stock.listWarehouses(hotelId, { includeInactive: true }));
    assert.deepEqual(all.filter((row) => row.isDefault).map((row) => row.code), ['BAR']);
    const edit = (row, changes) => boss(() => stock.updateWarehouse(hotelId, row.id, contracts.updateWarehouseSchema.parse({ expectedUpdatedAt: row.updatedAt, code: row.code, name: row.name, isDefault: row.isDefault, isActive: row.isActive, ...changes })));
    await rejectsWith(edit(bar, { isActive: false }), 'VALIDATION', /Varsayılan depo pasif|varsayılan/);
    const ana = all.find((row) => row.code === 'ANA');
    assert.deepEqual([ana.items, ana.value], [1, '5125.00']); // 12.5 × 410
    await rejectsWith(edit(ana, { isActive: false }), 'WAREHOUSE_HAS_STOCK');
    await edit(all.find((row) => row.code === 'SGK'), { isActive: false });
    all = await boss(() => stock.listWarehouses(hotelId, {}));
    assert.deepEqual(all.map((row) => row.code), ['BAR', 'ANA']);
    // Pasif depoya mal kabul yapılmaz.
    await newRequest([{ stockItemId: item.domates.id, quantity: '3' }]);
    const round2 = await roundOf(item.domates.id);
    await quote(round2.id, supplier.hal.id, 1, { [item.domates.id]: '28' });
    const [order2] = (await award(round2.id, { [item.domates.id]: [supplier.hal.id] })).orders;
    await rejectsWith(receive(order2.id, { [item.domates.id]: '3' }, { warehouseId: warehouse.soguk.id }), 'WAREHOUSE_INACTIVE');
  });

  it('izinler, otel kapsamı ve sipariş PDF', async () => {
    await newRequest([{ stockItemId: item.dana.id, quantity: '4' }]);
    const round = await roundOf(item.dana.id);
    await quote(round.id, supplier.kasap.id, 1, { [item.dana.id]: '410' });
    const [order] = (await award(round.id, { [item.dana.id]: [supplier.kasap.id] })).orders;

    assert.equal((await call('GET', '/purchasing/orders', DESK)).statusCode, 403);
    assert.equal((await call('GET', '/stock/levels', DESK)).statusCode, 403);
    assert.equal((await call('GET', '/purchasing/orders', ACCOUNTING)).statusCode, 200);
    assert.equal((await call('GET', '/stock/levels', ACCOUNTING)).statusCode, 200);
    // Mutfak talep açar ve mal kabul eder, tur / sipariş yönetemez.
    assert.equal((await call('POST', '/purchasing/rounds', KITCHEN, { items: [{ stockItemId: item.dana.id, expectedQuantity: '1' }] })).statusCode, 403);
    assert.equal((await call('POST', `/purchasing/orders/${order.id}/cancel`, KITCHEN, { expectedUpdatedAt: new Date().toISOString(), reason: 'Deneme iptal' })).statusCode, 403);
    assert.equal((await call('GET', '/stock/warehouses', KITCHEN)).statusCode, 200);
    assert.equal((await call('GET', '/purchasing/suggestions', KITCHEN)).statusCode, 200);
    // Muhasebe izler, mal kabul etmez.
    const detail = await reloadOrder(order.id);
    const receiptBody = { expectedUpdatedAt: detail.updatedAt, warehouseId: warehouse.ana.id, waybillNumber: 'X-1', receivedOn: D(0), lines: [{ orderLineId: detail.lines[0].id, quantity: '1' }] };
    assert.equal((await call('POST', `/purchasing/orders/${order.id}/receipts`, ACCOUNTING, receiptBody)).statusCode, 403);
    const ok = await call('POST', `/purchasing/orders/${order.id}/receipts`, KITCHEN, receiptBody);
    assert.equal(ok.statusCode, 201, ok.body);

    const pdf = await call('GET', `/purchasing/orders/${order.id}/pdf`, ACCOUNTING);
    assert.equal(pdf.statusCode, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');

    // Başka otelin kapsamında görünmez.
    await rejectsWith(as(MANAGER, () => orders.getOrder(otherHotelId, order.id)), 'NOT_FOUND');
    await rejectsWith(as(MANAGER, () => rounds.getRound(otherHotelId, round.id)), 'NOT_FOUND');
    await rejectsWith(as(MANAGER, () => suppliers.getSupplier(otherHotelId, supplier.kasap.id)), 'NOT_FOUND');
    assert.equal((await as(MANAGER, () => stock.listWarehouses(otherHotelId, {}))).length, 0);
  });
});
