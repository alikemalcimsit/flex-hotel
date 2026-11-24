import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Paket servis (modül 42) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: sipariş (vardiyada masasız adisyon + tur + paket ücreti, telefon normalleşir, numara, çift dokunuş, en az
 * tutar, vardiyasız / salon noktasında yok), kurye ve teslim (atamada kuryenin zili, kapıda para varsa kuryenin
 * vardiyası şart, bölünmüş kapı ödemesi kuryenin kasasına, eksik ödeme reddi, adisyon kapanır, turlar servis, tekrar
 * teslim aynı sonuç), ön ödeme (tamamı ödense de adisyon teslime kadar açık — mutfak görür; kalan için kapı yöntemi
 * şart), adisyon ekranı sınırları (ödeme / bölme yok; tur eklenince hazır sipariş mutfağa döner, yoldayken eklenmez),
 * mutfak ekranı senkronu, iptal (garson / şef garson, zayi, ön ödemeli), pano / geçmiş / tekrar gelen müşteri ve
 * izinler (HTTP).
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'mudur@test.local';
const WAITER = 'paket@test.local';
const COURIER = 'kurye@test.local';
const ACCOUNTANT = 'muhasebe@test.local';

describe('paket servis (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let setup;
  /** @type {any} */ let checks;
  /** @type {any} */ let payments;
  /** @type {any} */ let shifts;
  /** @type {any} */ let delivery;
  /** @type {any} */ let read;
  /** @type {any} */ let kitchen;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  /** @type {Record<string, any>} */ let outlet;
  /** @type {Record<string, any>} */ let item;
  /** @type {Map<string, string>} */ let tokens;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    setup = await import('./setup.js');
    checks = await import('./checks.js');
    payments = await import('./payments.js');
    shifts = await import('./shifts.js');
    delivery = await import('./delivery.js');
    read = await import('./delivery-read.js');
    kitchen = await import('./kitchen.js');
    cache = await import('../../lib/cache.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const parse = (schema, input) => contracts[schema].parse(input);
  const lastEvent = (name) => db.eventLog.findFirst({ where: { hotelId, name }, orderBy: { occurredAt: 'desc' } });

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
    const hotel = await db.hotel.create({
      data: { name: 'Sahil Oteli', code: `P${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY', largePaymentThreshold: '20000', phoneCountryCode: '90' },
    });
    hotelId = hotel.id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Yiyecek İçecek Müdürü', role: 'MANAGER', passwordHash },
        { hotelId, email: WAITER, name: 'Paket Sorumlusu', role: 'FNB', passwordHash },
        { hotelId, email: COURIER, name: 'Kurye', role: 'FNB', passwordHash },
        { hotelId, email: ACCOUNTANT, name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
      ],
    });
    await db.tax.create({ data: { hotelId, name: 'KDV', rate: '10', isIncluded: true, appliesTo: ['FNB'] } });
    await as(MANAGER, async () => {
      outlet = {
        rest: await setup.createOutlet(hotelId, parse('createPosOutletSchema', { code: 'REST', name: 'Ana Restoran' })),
        paket: await setup.createOutlet(hotelId, parse('createPosOutletSchema', { code: 'PAKET', name: 'Paket Servis', kind: 'DELIVERY', allowRoomCharge: false })),
      };
      const main = await setup.createCategory(hotelId, parse('createMenuCategorySchema', { name: 'Ana yemek' }));
      const make = (input) => setup.createItem(hotelId, parse('createMenuItemSchema', input));
      item = {
        kofte: await make({ categoryId: main.id, code: 'KOFTE', name: 'Izgara köfte', price: '450', station: 'HOT' }),
        cay: await make({ categoryId: main.id, code: 'CAY', name: 'Çay', price: '40', station: 'BAR' }),
      };
      await setup.updateSettings(hotelId, parse('updatePosSettingsSchema', { adjustmentApprovalAmount: '1000', cashVarianceAlert: '100', deliveryFee: '25', deliveryMinOrder: '150', deliveryOrderMinutes: 45 }));
    });
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });

  /* ── Yardımcılar ── */

  const L = (menuItem, quantity = 1) => ({ menuItemId: menuItem.id, quantity });
  const openShift = (email) => as(email, () => shifts.openShift(hotelId, parse('openPosShiftSchema', { openingFloat: '200' })));
  const orderInput = (input = {}) => ({
    requestId: randomUUID(),
    outletId: outlet.paket.id,
    source: 'PHONE',
    customerName: 'Ayşe Yılmaz',
    phone: '0532 111 22 33',
    address: 'Atatürk Cad. No 12 D 4, Konyaaltı',
    lines: [L(item.kofte), L(item.cay, 2)],
    doorMethod: 'CASH',
    ...input,
  });
  const create = (email, input) => as(email, () => delivery.createDeliveryOrder(hotelId, parse('createDeliveryOrderSchema', orderInput(input))));
  const advance = (email, order, status, extra = {}) =>
    as(email, () => delivery.advanceDeliveryOrder(hotelId, order.id, parse('advanceDeliveryOrderSchema', { expectedUpdatedAt: order.updatedAt, status, ...extra })));
  const deliver = (email, order, paymentsInput = [], requestId = randomUUID()) =>
    as(email, () => delivery.deliverDeliveryOrder(hotelId, order.id, parse('deliverDeliveryOrderSchema', { requestId, expectedUpdatedAt: order.updatedAt, payments: paymentsInput })));
  const cancel = (email, order, extra = {}) =>
    as(email, () => delivery.cancelDeliveryOrder(hotelId, order.id, parse('cancelDeliveryOrderSchema', { expectedUpdatedAt: order.updatedAt, reason: 'Müşteri vazgeçti', ...extra }), { canSupervise: email === MANAGER }));
  const checkOf = (order) => db.posCheck.findFirst({ where: { id: order.checkId }, include: { lines: { orderBy: { sortOrder: 'asc' } }, orders: true } });

  /* ── Sipariş ── */

  it('sipariş: vardiyada masasız adisyon + tur + paket ücreti; telefon normalleşir; çift dokunuş aynı sipariş; en az tutar', async () => {
    await rejectsWith(create(WAITER), 'NO_SHIFT');
    await openShift(WAITER);
    await rejectsWith(create(WAITER, { lines: [L(item.cay, 2)] }), 'VALIDATION', /En az sipariş tutarı 150\.00/);
    await rejectsWith(create(WAITER, { outletId: outlet.rest.id }), 'VALIDATION', /Paket servis noktası/);

    const requestId = randomUUID();
    const order = await create(WAITER, { requestId, changeFor: '600' });
    const again = await create(WAITER, { requestId, changeFor: '600' });
    assert.equal(again.id, order.id);
    assert.match(order.number, /^PS-\d{4}-000001$/);
    assert.equal(order.status, 'RECEIVED');
    assert.equal(order.phone, '905321112233');
    assert.equal(order.total, '555.00'); // 450 + 2×40 + 25 ücret
    assert.equal(order.balance, '555.00');
    assert.deepEqual(order.items.map((row) => row.name), ['Izgara köfte', 'Çay']);
    assert.equal(order.changeFor, '600.00');

    const check = await checkOf(order);
    assert.equal(check.tableId, null);
    assert.equal(check.status, 'OPEN');
    assert.deepEqual(check.lines.map((line) => [line.name, line.station]), [['Izgara köfte', 'HOT'], ['Çay', 'BAR'], ['Paket servis ücreti', 'NONE']]);
    assert.equal(await db.deliveryOrder.count({ where: { hotelId } }), 1);
    assert.equal((await lastEvent('pos.delivery.changed')).payload.change, 'CREATED');
    assert.ok(await lastEvent('fnb.order.placed'));

    // Paket noktasında düz adisyon açılmaz; açık paket siparişi varken nokta türü değişmez.
    await rejectsWith(as(WAITER, () => checks.openCheck(hotelId, parse('openPosCheckSchema', { requestId: randomUUID(), outletId: outlet.paket.id }))), 'VALIDATION', /paket siparişiyle/);
    const current = await db.posOutlet.findFirst({ where: { id: outlet.paket.id } });
    await rejectsWith(
      as(MANAGER, () => setup.updateOutlet(hotelId, outlet.paket.id, parse('updatePosOutletSchema', { expectedUpdatedAt: current.updatedAt, code: 'PAKET', name: 'Paket Servis', kind: 'DINING' }))),
      'OUTLET_IN_USE',
    );
  });

  /* ── Kurye ve teslim ── */

  it('kurye ve teslim: atamada zil; kapıda para varsa kuryenin vardiyası şart; bölünmüş ödeme kuryenin kasasına; adisyon kapanır', async () => {
    await openShift(WAITER);
    let order = await create(WAITER);
    order = await advance(WAITER, order, 'PREPARING');
    assert.equal((await checkOf(order)).orders[0].status, 'PREPARING');

    order = await as(WAITER, () => delivery.assignDeliveryCourier(hotelId, order.id, parse('assignDeliveryCourierSchema', { expectedUpdatedAt: order.updatedAt, courierEmail: COURIER })));
    assert.equal(order.courierEmail, COURIER);
    const courier = await db.user.findFirst({ where: { email: COURIER } });
    const alert = await db.staffAlert.findFirst({ where: { hotelId, userId: courier.id } });
    assert.equal(alert.title, `Paket ${order.number} size atandı`);
    assert.equal(alert.link, `/pos/paket/siparis/${order.id}`);

    await rejectsWith(advance(WAITER, order, 'ON_THE_WAY'), 'NO_SHIFT', /kurye vardiya açsın/);
    const courierShift = await openShift(COURIER);
    order = await advance(WAITER, order, 'ON_THE_WAY');
    assert.equal(order.status, 'ON_THE_WAY');
    assert.ok(order.dispatchedAt);

    await rejectsWith(deliver(COURIER, order, [{ method: 'CASH', amount: '300' }]), 'VALIDATION', /Kalan 255\.00 ödenmedi/);
    const requestId = randomUUID();
    const done = await deliver(COURIER, order, [{ method: 'CASH', amount: '300' }, { method: 'CARD', amount: '255', reference: 'PRV-1' }], requestId);
    assert.equal(done.status, 'DELIVERED');
    assert.equal(done.balance, '0.00');
    assert.equal(done.durations.total !== null, true);
    const check = await checkOf(order);
    assert.equal(check.status, 'CLOSED');
    assert.ok(check.orders.every((round) => round.status === 'SERVED'));
    const paid = await db.posPayment.findMany({ where: { checkId: order.checkId }, orderBy: { amount: 'asc' } });
    assert.deepEqual(paid.map((row) => [row.method, row.shiftId]), [['CARD', courierShift.id], ['CASH', courierShift.id]]);
    assert.ok(await lastEvent('fnb.order.paid'));

    const replay = await deliver(COURIER, order, [{ method: 'CASH', amount: '300' }, { method: 'CARD', amount: '255', reference: 'PRV-1' }], requestId);
    assert.equal(replay.status, 'DELIVERED');
    assert.equal(await db.posPayment.count({ where: { checkId: order.checkId } }), 2);
  });

  /* ── Ön ödeme ── */

  it('ön ödeme: tamamı ödense de adisyon teslime kadar açık (mutfak görür); teslim ödemesiz kapanır; kalan için kapı yöntemi şart', async () => {
    await openShift(WAITER);
    await rejectsWith(create(WAITER, { doorMethod: null, prepayments: [{ method: 'CARD', amount: '200', reference: 'HVL-1' }] }), 'VALIDATION', /Kalan 355\.00 kapıda/);

    const order = await create(WAITER, { doorMethod: null, prepayments: [{ method: 'CARD', amount: '555', reference: 'HVL-2' }] });
    assert.equal(order.balance, '0.00');
    assert.equal((await checkOf(order)).status, 'OPEN');
    assert.equal(order.payments.length, 1);
    const board = await kitchen.listKitchenBoard(hotelId, {});
    assert.equal(board.length, 1);
    assert.deepEqual(board[0].delivery, { id: order.id, number: order.number, customerName: 'Ayşe Yılmaz' });

    const done = await deliver(WAITER, order);
    assert.equal(done.status, 'DELIVERED');
    assert.equal(done.courierEmail, WAITER); // kurye atanmadıysa teslim eden
    assert.equal((await checkOf(order)).status, 'CLOSED');
  });

  /* ── Adisyon ekranı ve mutfak ── */

  it('adisyon ekranı: ödeme / bölme yok; tur eklenince hazır sipariş mutfağa döner; yoldayken eklenmez', async () => {
    await openShift(WAITER);
    await openShift(COURIER);
    let order = await create(WAITER);
    await rejectsWith(as(WAITER, () => payments.receivePayment(hotelId, order.checkId, parse('posPaymentSchema', { requestId: randomUUID(), method: 'CASH', amount: '100' }))), 'DELIVERY_NOT_DELIVERED');
    const check = await checkOf(order);
    await rejectsWith(
      as(WAITER, () => checks.splitCheck(hotelId, order.checkId, parse('splitPosCheckSchema', { expectedUpdatedAt: check.updatedAt, lines: [{ lineId: check.lines[0].id, quantity: 1 }] }))),
      'DELIVERY_CHECK',
    );

    order = await advance(WAITER, order, 'READY');
    await as(WAITER, () => checks.sendOrder(hotelId, order.checkId, parse('sendPosOrderSchema', { requestId: randomUUID(), lines: [{ menuItemId: item.cay.id, quantity: 1 }] })));
    order = await read.getDeliveryOrder(hotelId, order.id);
    assert.equal(order.status, 'RECEIVED');
    assert.equal(order.readyAt, null);
    assert.equal(order.total, '595.00');

    order = await advance(WAITER, order, 'ON_THE_WAY', { courierEmail: COURIER });
    await rejectsWith(as(WAITER, () => checks.sendOrder(hotelId, order.checkId, parse('sendPosOrderSchema', { requestId: randomUUID(), lines: [{ menuItemId: item.cay.id, quantity: 1 }] }))), 'DELIVERY_LOCKED');
  });

  it('mutfak ekranı: son tur hazır olunca sipariş hazır; SERVED reddedilir; garsona zil gitmez', async () => {
    await openShift(WAITER);
    const order = await create(WAITER);
    const [card] = await kitchen.listKitchenBoard(hotelId, {});
    const preparing = await as(WAITER, () => kitchen.advanceKitchenOrder(hotelId, card.orderId, { status: 'PREPARING', expectedUpdatedAt: new Date(card.updatedAt) }));
    assert.equal((await read.getDeliveryOrder(hotelId, order.id)).status, 'PREPARING');
    const ready = await as(WAITER, () => kitchen.advanceKitchenOrder(hotelId, card.orderId, { status: 'READY', expectedUpdatedAt: new Date(preparing.updatedAt) }));
    const synced = await read.getDeliveryOrder(hotelId, order.id);
    assert.equal(synced.status, 'READY');
    assert.ok(synced.readyAt);
    await rejectsWith(as(WAITER, () => kitchen.advanceKitchenOrder(hotelId, card.orderId, { status: 'SERVED', expectedUpdatedAt: new Date(ready.updatedAt) })), 'INVALID_TRANSITION', /paket servis panosundan/);
    assert.equal(await db.staffAlert.count({ where: { hotelId } }), 0);
  });

  /* ── İptal ── */

  it('iptal: mutfak başlamadan garson; başladıysa şef garson (zayi); adisyon sıfırla kapanır; ön ödemeli önce ödeme iptali', async () => {
    await openShift(WAITER);
    const fresh = await create(WAITER);
    const cancelled = await cancel(WAITER, fresh);
    assert.equal(cancelled.status, 'CANCELLED');
    const closed = await checkOf(fresh);
    assert.equal(closed.status, 'CLOSED');
    assert.equal(String(closed.grandTotal), '0');

    let started = await create(WAITER);
    started = await advance(WAITER, started, 'PREPARING');
    await rejectsWith(cancel(WAITER, started), 'FORBIDDEN', /şef garson/);
    await cancel(MANAGER, started);
    const waste = await db.posAdjustment.findMany({ where: { checkId: started.checkId, kind: 'VOID' } });
    assert.ok(waste.some((row) => row.waste));
    assert.ok(waste.filter((row) => row.waste).every((row) => row.lineId));

    const prepaid = await create(WAITER, { doorMethod: 'CASH', prepayments: [{ method: 'CARD', amount: '100', reference: 'HVL-3' }] });
    await rejectsWith(cancel(WAITER, prepaid), 'CHECK_HAS_PAYMENTS');
  });

  /* ── Pano, geçmiş, müşteri, izinler ── */

  it('pano, geçmiş ve tekrar gelen müşteri; raporcu okur ama yazamaz (HTTP)', async () => {
    await openShift(WAITER);
    const first = await create(WAITER, { address: 'Eski adres sokak 1' });
    await cancel(WAITER, first);
    const second = await create(WAITER, { customerName: 'Ayşe Y.', address: 'Yeni adres sokak 2', addressNote: 'Kapı kodu 1234' });
    await create(WAITER, { customerName: 'Mehmet Demir', phone: '+90 555 000 11 22', address: 'Liman Mah. 7' });

    const board = await read.getDeliveryBoard(hotelId, {});
    assert.equal(board.columns.kitchen.total, 2);
    assert.equal(board.today.cancelled, 1);
    assert.equal(board.settings.deliveryFee, '25.00');

    const byPhone = await read.listDeliveryOrders(hotelId, parse('deliveryListQuerySchema', { search: '0532 111 22 33' }));
    assert.equal(byPhone.meta.total, 2);
    const byName = await read.listDeliveryOrders(hotelId, parse('deliveryListQuerySchema', { search: 'mehmet' }));
    assert.equal(byName.items[0].customerName, 'Mehmet Demir');
    const active = await read.listDeliveryOrders(hotelId, parse('deliveryListQuerySchema', { state: 'ACTIVE' }));
    assert.equal(active.meta.total, 2);

    const customer = await read.findDeliveryCustomer(hotelId, { phone: '05321112233' });
    assert.equal(customer.customerName, 'Ayşe Y.');
    assert.deepEqual(
      customer.addresses.map((row) => [row.address, row.addressNote]),
      [['Yeni adres sokak 2', 'Kapı kodu 1234'], ['Eski adres sokak 1', null]],
    );

    const view = await call('GET', '/pos/delivery/board', ACCOUNTANT);
    assert.equal(view.statusCode, 200, view.body);
    const denied = await call('POST', `/pos/delivery/orders/${second.id}/advance`, ACCOUNTANT, { expectedUpdatedAt: second.updatedAt, status: 'READY' });
    assert.equal(denied.statusCode, 403);
    const created = await call('POST', '/pos/delivery/orders', WAITER, orderInput({ customerName: 'HTTP Müşteri' }));
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().data.customerName, 'HTTP Müşteri');
  });
});
