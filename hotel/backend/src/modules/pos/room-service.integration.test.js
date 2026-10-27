import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Oda servisi (modül 41) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: tanımlar (oda servisi noktası odaya yazmaya açık, restoran adisyonu açılmaz, tepsi ücreti gizli sistem
 * ürünü, açık siparişte tür değişmez), hemen sipariş (vardiyada adisyon + tur + tepsi ücreti, mutfak olayında oda,
 * çift dokunuş, adisyon ekranının teslim öncesi sınırları, adım geçişleri, sürüm), teslim (tamamı odaya → folyo
 * birebir, tekrar gönderim; kapıda bölünmüş ödeme + kalan odaya, fazla / eksik / büyük ödeme, götürenin kasası),
 * planlı sipariş (kurallar, hazırlık listesi, zamanlayıcı: vardiya yokken bir kez uyarı, girenin yoksa noktanın
 * vardiyası, gece oda değişikliği, tükenen ürünle elle gönderme), misafir QR (bağlantı, oturumsuz menü, imza, sipariş
 * kapalı, tekrar gönderim, açık sipariş sınırı, misafirin iptali, kabulde kalem değişimi, ret, bekleme uyarısı,
 * yenilenen / oda değişen / çıkan bağlantı, hız sınırı), istekten siparişe (istek işlemde → teslimde tamam, iptalde
 * açık), iptal (zayi, şef garson, planlı adisyonsuz), tur ekleme (hazır → mutfak, yoldayken yok), tepsi / gecikme /
 * konaklama bitti uyarıları, geçmiş ve rapor, izinler, otel kapsamı ve eşzamanlılık.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'mudur@test.local';
const WAITER = 'siparis@test.local';
const RUNNER = 'kat-servis@test.local';
const ACCOUNTANT = 'muhasebe@test.local';
const DESK = 'onburo@test.local';
const HOUSEKEEPER = 'katgorevlisi@test.local';
const TC = '10000000146';
const MINUTE = 60_000;

describe('oda servisi (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let setup;
  /** @type {any} */ let checks;
  /** @type {any} */ let payments;
  /** @type {any} */ let shifts;
  /** @type {any} */ let rs;
  /** @type {any} */ let read;
  /** @type {any} */ let guest;
  /** @type {any} */ let jobs;
  /** @type {any} */ let folios;
  /** @type {any} */ let requests;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let otherHotelId;
  /** @type {Record<string, any>} */ let outlet;
  /** @type {Record<string, any>} */ let item;
  /** @type {any} */ let roomType;
  /** @type {Record<string, any>} */ let room;
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
    rs = await import('./room-service.js');
    read = await import('./room-service-read.js');
    guest = await import('./room-service-guest.js');
    jobs = await import('./room-service-jobs.js');
    folios = await import('../folios/service.js');
    requests = await import('../guest-requests/service.js');
    cache = await import('../../lib/cache.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const D = (offset) => core.toIsoDay(core.addDays(core.calendarDateInTimeZone(ZONE), offset));
  const wall = (minutes) => contracts.utcToZonedWallTime(new Date(Date.now() + minutes * MINUTE), ZONE);
  const lastEvent = (name) => db.eventLog.findFirst({ where: { hotelId, name }, orderBy: { occurredAt: 'desc' } });
  const parse = (schema, input) => contracts[schema].parse(input);

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
      data: { name: 'Büyük Ankara Oteli', code: `R${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY', largePaymentThreshold: '20000' },
    });
    hotelId = hotel.id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka Otel', code: `O${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Yiyecek İçecek Müdürü', role: 'MANAGER', passwordHash },
        { hotelId, email: WAITER, name: 'Sipariş Alan', role: 'FNB', passwordHash },
        { hotelId, email: RUNNER, name: 'Kat Servisi', role: 'FNB', passwordHash },
        { hotelId, email: ACCOUNTANT, name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
        { hotelId, email: DESK, name: 'Ön Büro', role: 'FRONT_DESK', passwordHash },
        { hotelId, email: HOUSEKEEPER, name: 'Kat Görevlisi', role: 'HOUSEKEEPING', passwordHash },
      ],
    });
    await db.tax.create({ data: { hotelId, name: 'KDV', rate: '10', isIncluded: true, appliesTo: ['FNB'] } });
    roomType = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '3000', capacityAdults: 2, capacityChildren: 0 } });
    room = {};
    for (const number of ['101', '102', '103']) room[number] = await db.room.create({ data: { hotelId, number, roomTypeId: roomType.id } });

    await as(MANAGER, async () => {
      outlet = {
        rest: await setup.createOutlet(hotelId, parse('createPosOutletSchema', { code: 'REST', name: 'Ana Restoran' })),
        rs: await setup.createOutlet(hotelId, parse('createPosOutletSchema', { code: 'RS', name: 'Oda Servisi', kind: 'ROOM_SERVICE' })),
      };
      const breakfast = await setup.createCategory(hotelId, parse('createMenuCategorySchema', { name: 'Kahvaltı', outletIds: [outlet.rs.id] }));
      const main = await setup.createCategory(hotelId, parse('createMenuCategorySchema', { name: 'Ana yemek' }));
      const drinks = await setup.createCategory(hotelId, parse('createMenuCategorySchema', { name: 'İçecek' }));
      const make = (input) => setup.createItem(hotelId, parse('createMenuItemSchema', input));
      item = {
        omlet: await make({ categoryId: breakfast.id, code: 'OMLET', name: 'Omlet', price: '180', station: 'HOT' }),
        menemen: await make({ categoryId: breakfast.id, code: 'MENEMEN', name: 'Menemen', price: '160', station: 'HOT' }),
        kofte: await make({ categoryId: main.id, code: 'KOFTE', name: 'Izgara köfte', price: '450', station: 'HOT' }),
        cay: await make({ categoryId: drinks.id, code: 'CAY', name: 'Çay', price: '40', station: 'BAR' }),
        kahve: await make({ categoryId: drinks.id, code: 'KAHVE', name: 'Türk kahvesi', price: '90', station: 'BAR' }),
      };
      await setup.updateSettings(
        hotelId,
        parse('updatePosSettingsSchema', {
          adjustmentApprovalAmount: '1000',
          cashVarianceAlert: '100',
          trayCharge: '50',
          deliveryTargetMinutes: 30,
          prepLeadMinutes: 30,
          trayAlertMinutes: 90,
          guestOrderingEnabled: true,
        }),
      );
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
  const open = (method, url, payload, remoteAddress = '127.0.0.1') => app.inject({ method, url, payload, remoteAddress });

  /* ── Yardımcılar ── */

  const L = (menuItem, quantity = 1, note) => ({ menuItemId: menuItem.id, quantity, ...(note ? { note } : {}) });
  const openShift = (email, input = {}) => as(email, () => shifts.openShift(hotelId, parse('openPosShiftSchema', { openingFloat: '200', ...input })));
  const create = (email, input) =>
    as(email, () =>
      rs.createOrder(hotelId, parse('createRoomServiceOrderSchema', { requestId: randomUUID(), outletId: outlet.rs.id, lines: [L(item.omlet), L(item.cay, 2)], ...input })),
    );
  const advance = (email, order, status, extra = {}) =>
    as(email, () => rs.advanceOrder(hotelId, order.id, parse('advanceRoomServiceOrderSchema', { expectedUpdatedAt: order.updatedAt, status, ...extra })));
  const deliver = (email, order, extra = {}) =>
    as(email, () => rs.deliverOrder(hotelId, order.id, parse('deliverRoomServiceOrderSchema', { requestId: randomUUID(), expectedUpdatedAt: order.updatedAt, ...extra })));
  const cancel = (email, order, input, canSupervise = false) =>
    as(email, () => rs.cancelOrder(hotelId, order.id, parse('cancelRoomServiceOrderSchema', { expectedUpdatedAt: order.updatedAt, ...input }), { canSupervise }));
  const get = (orderId) => as(MANAGER, () => read.getOrder(hotelId, orderId));
  const sweep = (minutesLater) => as('system', () => jobs.sweepRoomService(hotelId, { now: new Date(Date.now() + minutesLater * MINUTE) }));
  const settings = () => as(MANAGER, () => setup.getSettings(hotelId));
  const policy = async (changes) => {
    const current = await settings();
    return as(MANAGER, () =>
      setup.updateSettings(hotelId, parse('updatePosSettingsSchema', { expectedUpdatedAt: current.updatedAt, adjustmentApprovalAmount: '1000', cashVarianceAlert: '100', ...changes })),
    );
  };

  async function seedStay({ roomNumber = '101', status = 'CHECKED_IN', lastName = 'Kaya', checkOut = 1 } = {}) {
    const guestRow = await db.guest.create({ data: { hotelId, firstName: 'Ayşe', lastName, idType: 'NATIONAL_ID', idNumber: TC, nationality: 'TR' } });
    return db.reservation.create({
      data: {
        hotelId,
        guestId: guestRow.id,
        roomTypeId: roomType.id,
        roomId: room[roomNumber].id,
        checkIn: new Date(D(-2)),
        checkOut: new Date(D(checkOut)),
        status,
        checkedInAt: new Date(Date.now() - 2 * 86_400_000),
        checkedInBy: DESK,
        confirmedAt: new Date(),
        totalPrice: '9000.00',
        confirmationCode: `H${randomUUID().slice(0, 7).toUpperCase()}`,
      },
    });
  }

  /* ══════════════════ Tanımlar ══════════════════ */

  it('tanımlar: oda servisi noktası odaya yazmaya açık; restoran adisyonu açılmaz; tepsi ücreti gizli sistem ürünü; açık siparişte tür değişmez', async () => {
    await rejectsWith(
      as(MANAGER, () => setup.createOutlet(hotelId, parse('createPosOutletSchema', { code: 'RS2', name: 'Havuz servisi', kind: 'ROOM_SERVICE', allowRoomCharge: false }))),
      'VALIDATION',
      /odaya yazmaya açık/,
    );
    // Tepsi ücreti: sistem grubunda gizli ürün; terminalde, tanım listesinde yok; fiyatı politikadan.
    const tray = await db.menuItem.findFirst({ where: { hotelId, system: 'TRAY_CHARGE' }, include: { category: true } });
    assert.equal(String(tray.price), '50');
    assert.equal(tray.station, 'NONE');
    assert.equal(tray.category.system, true);
    const terminal = await as(WAITER, () => setup.getTerminal(hotelId));
    assert.equal(terminal.items.length, 5);
    assert.ok(!terminal.categories.some((category) => category.name === tray.category.name));
    assert.equal((await as(MANAGER, () => setup.listItems(hotelId, parse('menuItemListQuerySchema', {})))).meta.total, 5);
    assert.equal((await as(MANAGER, () => setup.listCategories(hotelId))).items.length, 3);
    assert.equal(terminal.settings.trayCharge, '50.00');
    await policy({ trayCharge: '75' });
    assert.equal(String((await db.menuItem.findFirst({ where: { hotelId, system: 'TRAY_CHARGE' } })).price), '75');
    assert.equal(await db.menuItem.count({ where: { hotelId, system: 'TRAY_CHARGE' } }), 1);
    // Sistem ürünü düzenlenmez, tükendi yapılmaz, restoranın turuna girmez.
    await rejectsWith(as(MANAGER, () => setup.setSoldOut(hotelId, tray.id, { soldOut: true })), 'NOT_FOUND');
    await openShift(WAITER);
    const restCheck = await as(WAITER, () => checks.openCheck(hotelId, parse('openPosCheckSchema', { requestId: randomUUID(), outletId: outlet.rest.id })));
    await rejectsWith(as(WAITER, () => checks.sendOrder(hotelId, restCheck.id, parse('sendPosOrderSchema', { requestId: randomUUID(), lines: [{ menuItemId: tray.id, quantity: 1 }] }))), 'VALIDATION', /bulunamadı/);
    // Kahvaltı grubu yalnızca oda servisinde.
    await rejectsWith(as(WAITER, () => checks.sendOrder(hotelId, restCheck.id, parse('sendPosOrderSchema', { requestId: randomUUID(), lines: [L(item.omlet)] }))), 'VALIDATION', /satılmıyor/);
    // Oda servisi noktasında restoran adisyonu açılmaz.
    await rejectsWith(as(WAITER, () => checks.openCheck(hotelId, parse('openPosCheckSchema', { requestId: randomUUID(), outletId: outlet.rs.id }))), 'VALIDATION', /oda servisi siparişiyle/);
    // Açık siparişi olan oda servisi noktası salona çevrilmez, kapatılmaz.
    const stay = await seedStay();
    await create(WAITER, { reservationId: stay.id });
    const base = { code: 'RS', name: 'Oda Servisi', allowRoomCharge: true, sortOrder: 0, expectedUpdatedAt: outlet.rs.updatedAt };
    await rejectsWith(as(MANAGER, () => setup.updateOutlet(hotelId, outlet.rs.id, parse('updatePosOutletSchema', { ...base, kind: 'DINING' }))), 'OUTLET_IN_USE');
    await rejectsWith(as(MANAGER, () => setup.updateOutlet(hotelId, outlet.rs.id, parse('updatePosOutletSchema', { ...base, isActive: false }))), 'OUTLET_IN_USE');
    await rejectsWith(as(MANAGER, () => setup.updateOutlet(hotelId, outlet.rs.id, parse('updatePosOutletSchema', { ...base, allowRoomCharge: false }))), 'VALIDATION', /odaya yazmaya açık/);
    // Tür verilmeden kaydedilen nokta türünü korur.
    const renamed = await as(MANAGER, () => setup.updateOutlet(hotelId, outlet.rs.id, parse('updatePosOutletSchema', { ...base, name: 'Oda Servisi (24 saat)' })));
    assert.equal(renamed.kind, 'ROOM_SERVICE');
  });

  /* ══════════════════ Hemen sipariş → odaya teslim ══════════════════ */

  it('hemen sipariş: vardiyada adisyon + tur + tepsi ücreti; mutfak olayında oda; çift dokunuş; teslim öncesi adisyon sınırları; adımlar; tamamı odaya → folyo birebir', async () => {
    const stay = await seedStay();
    await rejectsWith(create(WAITER, { reservationId: stay.id }), 'NO_SHIFT');
    const waiterShift = await openShift(WAITER);
    const runnerShift = await openShift(RUNNER);
    const requestId = randomUUID();
    let order = await create(WAITER, { requestId, reservationId: stay.id, lines: [L(item.omlet), L(item.cay, 2, 'şekersiz')], covers: 2, note: 'Kapıyı çalmayın' });
    assert.equal(order.status, 'RECEIVED');
    assert.equal(order.source, 'STAFF');
    assert.match(order.number, /^OS-\d{4}-000001$/);
    assert.equal(order.itemsTotal, '260.00');
    assert.equal(Date.parse(order.dueAt) - Date.parse(order.receivedAt) <= 30 * MINUTE + 1000, true);
    let check = await as(WAITER, () => checks.getCheck(hotelId, order.checkId));
    assert.equal(check.shiftId, waiterShift.id);
    assert.equal(check.tableId, null);
    assert.equal(check.totals.grandTotal, '310.00');
    assert.deepEqual(check.lines.map((line) => [line.name, line.quantity]), [['Omlet', 1], ['Çay', 2], ['Oda servisi ücreti', 1]]);
    assert.equal(check.roomService.number, order.number);
    const placed = await lastEvent('fnb.order.placed');
    assert.equal(placed.payload.roomNumber, '101');
    assert.equal(placed.payload.deliverAt, null);
    assert.equal(placed.payload.lines.find((line) => line.name === 'Oda servisi ücreti').station, 'NONE');
    // Çift dokunuş: aynı sipariş.
    assert.equal((await create(WAITER, { requestId, reservationId: stay.id })).id, order.id);
    assert.equal(await db.roomServiceOrder.count({ where: { hotelId } }), 1);
    assert.equal(await db.posCheck.count({ where: { hotelId } }), 1);

    const board = await as(WAITER, () => read.getBoard(hotelId, {}));
    assert.deepEqual(board.columns.kitchen.items.map((card) => card.id), [order.id]);
    assert.equal(board.columns.kitchen.total, 1);

    // Adisyon ekranı: teslimden önce ödeme / odaya yaz / kapatma yok; bölme, taşıma yok.
    await rejectsWith(as(RUNNER, () => payments.receivePayment(hotelId, order.checkId, parse('posPaymentSchema', { requestId: randomUUID(), method: 'CASH', amount: '10' }))), 'ROOM_SERVICE_NOT_DELIVERED');
    await rejectsWith(as(RUNNER, () => payments.chargeToRoom(hotelId, order.checkId, parse('posRoomChargeSchema', { requestId: randomUUID(), reservationId: stay.id, amount: '310' }))), 'ROOM_SERVICE_NOT_DELIVERED');
    await rejectsWith(as(WAITER, () => checks.closeCheck(hotelId, order.checkId, { expectedUpdatedAt: new Date(check.updatedAt) })), 'ROOM_SERVICE_NOT_DELIVERED');
    await rejectsWith(as(WAITER, () => checks.moveCheck(hotelId, order.checkId, { expectedUpdatedAt: new Date(check.updatedAt), tableId: null })), 'ROOM_SERVICE_CHECK');
    await rejectsWith(
      as(WAITER, () => checks.splitCheck(hotelId, order.checkId, parse('splitPosCheckSchema', { expectedUpdatedAt: check.updatedAt, lines: [{ lineId: check.lines[1].id, quantity: 1 }] }))),
      'ROOM_SERVICE_CHECK',
    );

    // Adımlar; eski sürümle yazılmaz; geri adım yok.
    const stale = order;
    order = await advance(WAITER, order, 'PREPARING');
    await rejectsWith(advance(WAITER, stale, 'READY'), 'STALE_WRITE');
    assert.deepEqual((await db.posOrder.findMany({ where: { checkId: order.checkId } })).map((row) => row.status), ['PREPARING']);
    order = await advance(WAITER, order, 'READY');
    await rejectsWith(advance(WAITER, order, 'PREPARING'), 'INVALID_TRANSITION');
    await rejectsWith(advance(WAITER, order, 'ON_THE_WAY', { runnerEmail: 'yok@test.local' }), 'VALIDATION', /Götüren/);
    order = await advance(WAITER, order, 'ON_THE_WAY', { runnerEmail: RUNNER });
    assert.equal(order.runnerEmail, RUNNER);
    assert.equal(order.durations.kitchen !== null, true);

    // Teslim: tamamı odaya.
    const deliverId = randomUUID();
    const delivered = await deliver(RUNNER, order, { requestId: deliverId });
    assert.equal(delivered.status, 'DELIVERED');
    assert.equal(delivered.deliveredBy, RUNNER);
    assert.equal(delivered.check.status, 'CLOSED');
    assert.equal(delivered.check.roomChargeTotal, '310.00');
    assert.equal(delivered.check.balance, '0.00');
    assert.deepEqual([...new Set((await db.posOrder.findMany({ where: { checkId: order.checkId } })).map((row) => row.status))], ['SERVED']);
    const charged = await lastEvent('fnb.order.charged');
    assert.equal(charged.payload.reservationId, stay.id);
    assert.equal(charged.payload.reference, check.number);
    assert.deepEqual(charged.payload.items.map((row) => [row.description, row.unitPrice, row.taxCategory]), [[`Oda Servisi · ${order.number}`, '310.00', 'FNB']]);
    await as('billing-worker', () => folios.postExternalCharge(hotelId, charged.payload, { source: 'FNB_ORDER', eventId: charged.id }));
    const posted = await db.folioItem.findMany({ where: { hotelId, sourceKey: { startsWith: `evt:${charged.id}:` } } });
    assert.equal(posted.reduce((sum, row) => sum + Math.round(Number(row.total) * 100), 0), 31000);
    // Aynı teslim isteği tekrar: ikinci kez yazılmaz.
    await deliver(RUNNER, order, { requestId: deliverId });
    assert.equal(await db.posRoomCharge.count({ where: { hotelId } }), 1);
    // Başka istekle ikinci teslim: sipariş teslim edilmiş.
    await rejectsWith(deliver(RUNNER, delivered), 'INVALID_TRANSITION');
    // Kapanış izi: satış raporu ve vardiya raporu için iş günü.
    assert.ok((await db.posCheck.findFirst({ where: { id: order.checkId } })).businessDate);
    assert.equal(runnerShift.waiterEmail, RUNNER);
  });

  /* ══════════════════ Kapıda ödeme ══════════════════ */

  it('kapıda ödeme: bölünmüş nakit + kart, kalan odaya; fazla / ödenmemiş kalan / büyük ödeme + kalan reddedilir; para götürenin kasasına', async () => {
    const stay = await seedStay();
    await openShift(WAITER);
    const runnerShift = await openShift(RUNNER, { openingFloat: '200' });
    let order = await create(WAITER, { reservationId: stay.id, lines: [L(item.omlet, 2), L(item.kahve)] });
    order = await advance(RUNNER, order, 'ON_THE_WAY');
    const fresh = () => get(order.id);
    // Toplam: 360 + 90 + tepsi 50 = 500.
    await rejectsWith(deliver(RUNNER, order, { payments: [{ method: 'CASH', amount: '501' }] }), 'VALIDATION', /aşıyor/);
    await rejectsWith(deliver(RUNNER, order, { payments: [{ method: 'CASH', amount: '400' }], chargeRemainder: false }), 'VALIDATION', /Kalan 100\.00 ödenmedi/);
    // Büyük ödeme (onaya gider) varken kalan odaya yazılmaz.
    await db.hotel.update({ where: { id: hotelId }, data: { largePaymentThreshold: '300' } });
    cache.cache.invalidatePrefix('settings:');
    await rejectsWith(deliver(RUNNER, order, { payments: [{ method: 'CASH', amount: '300' }] }), 'VALIDATION', /büyük ödeme/);
    await db.hotel.update({ where: { id: hotelId }, data: { largePaymentThreshold: '20000' } });
    cache.cache.invalidatePrefix('settings:');
    // Vardiyasız kapı ödemesi yok (ödemesiz teslim vardiya istemez).
    await rejectsWith(deliver(MANAGER, order, { payments: [{ method: 'CASH', amount: '100' }] }), 'NO_SHIFT');
    assert.equal((await fresh()).status, 'ON_THE_WAY');

    const done = await deliver(RUNNER, await fresh(), {
      payments: [
        { method: 'CASH', amount: '150' },
        { method: 'CARD', amount: '250', reference: 'SLIP-7' },
      ],
    });
    assert.equal(done.status, 'DELIVERED');
    assert.equal(done.check.status, 'CLOSED');
    assert.equal(done.check.paidTotal, '400.00');
    assert.equal(done.check.roomChargeTotal, '100.00');
    const rows = await db.posPayment.findMany({ where: { checkId: order.checkId }, orderBy: { amount: 'asc' } });
    assert.deepEqual(rows.map((row) => [row.method, String(row.amount), row.shiftId]), [
      ['CASH', '150', runnerShift.id],
      ['CARD', '250', runnerShift.id],
    ]);
    const shift = await as(RUNNER, () => shifts.getShift(hotelId, runnerShift.id, { canSeeAll: false }));
    assert.equal(shift.cash.expectedCash, '350.00');
  });

  /* ══════════════════ Planlı sipariş (kahvaltı kartı) ══════════════════ */

  it('planlı sipariş: kurallar; hazırlık listesi; zamanlayıcı vardiya yokken bir kez uyarır, noktanın vardiyasına düşürür, gece oda değişikliğini izler; tükenen ürünle elle gönderme', async () => {
    const stay = await seedStay();
    const stay2 = await seedStay({ roomNumber: '102', lastName: 'Demir' });
    await rejectsWith(create(WAITER, { reservationId: stay.id, deliverAt: wall(5) }), 'VALIDATION', /en az 10 dakika/);
    await rejectsWith(create(WAITER, { reservationId: stay.id, deliverAt: wall(60 * 24 * 4) }), 'VALIDATION', /en fazla 3 gün/);
    await rejectsWith(create(WAITER, { reservationId: stay.id, deliverAt: `${D(2)}T08:00` }), 'VALIDATION', /çıkıyor/);

    // Vardiya gerekmez (gece kahvaltı kartı girişi).
    const at = wall(120);
    const first = await create(WAITER, { reservationId: stay.id, deliverAt: at, lines: [L(item.omlet, 2), L(item.menemen), L(item.cay, 3)] });
    assert.equal(first.status, 'SCHEDULED');
    assert.equal(first.checkId, null);
    assert.equal(Date.parse(first.deliverAt) - Date.parse(first.releaseAt), 30 * MINUTE);
    assert.equal(first.dueAt, first.deliverAt);
    const second = await create(WAITER, { reservationId: stay2.id, deliverAt: wall(125), lines: [L(item.menemen), L(item.cay)] });

    const prep = await as(WAITER, () => read.prepList(hotelId, parse('roomServicePrepQuerySchema', { date: at.slice(0, 10) })));
    assert.equal(prep.total, 2);
    assert.deepEqual(
      prep.items.map((row) => [row.name, row.quantity]),
      [['Çay', 4], ['Menemen', 2], ['Omlet', 2]],
    );
    assert.equal(prep.slots.reduce((sum, slot) => sum + slot.orders.length, 0), 2);
    const board = await as(WAITER, () => read.getBoard(hotelId, {}));
    assert.equal(board.scheduled.total, 2);
    assert.equal(board.scheduled.next.number, first.number);

    // Zamanı gelmeden düşmez.
    assert.equal((await sweep(60)).released, 0);
    // Zamanı geldi, açık vardiya yok: bir kez uyarı.
    let result = await sweep(100);
    assert.equal(result.released, 0);
    assert.equal(result.releaseFailed, 2);
    assert.equal((await sweep(100)).releaseFailed, 0);
    const waitAlert = await db.staffAlert.findFirst({ where: { hotelId, dedupeKey: 'room-service:wait' } });
    assert.equal(waitAlert.count, 2);
    assert.equal(waitAlert.permission, contracts.PERMISSIONS.POS_SUPERVISE);

    // Gece oda değişikliği; girenin vardiyası yok → oda servisi noktasının vardiyası.
    await db.reservation.update({ where: { id: stay.id }, data: { roomId: room['103'].id } });
    await openShift(RUNNER, { outletId: outlet.rs.id });
    result = await sweep(100);
    assert.equal(result.released, 2);
    const released = await get(first.id);
    assert.equal(released.status, 'RECEIVED');
    assert.equal(released.roomNumber, '103');
    const check = await as(MANAGER, () => checks.getCheck(hotelId, released.checkId));
    assert.equal(check.waiterEmail, RUNNER);
    assert.equal(check.totals.grandTotal, String((2 * 180 + 160 + 3 * 40 + 50).toFixed(2)));
    const placed = await db.eventLog.findMany({ where: { hotelId, name: 'fnb.order.placed' } });
    assert.ok(placed.some((event) => event.payload.roomNumber === '103' && event.payload.deliverAt === released.deliverAt));
    assert.equal((await db.roomServiceOrder.findFirst({ where: { id: first.id } })).waitAlertedAt, null);

    // Elle gönderme: tükenen ürün kalemi değiştirilerek.
    const third = await create(WAITER, { reservationId: stay2.id, deliverAt: wall(240), lines: [L(item.kofte)] });
    await as(MANAGER, () => setup.setSoldOut(hotelId, item.kofte.id, { soldOut: true }));
    await openShift(WAITER);
    const release = (lines) => as(WAITER, () => rs.releaseOrder(hotelId, third.id, parse('acceptRoomServiceOrderSchema', { expectedUpdatedAt: third.updatedAt, ...(lines ? { lines } : {}) })));
    await rejectsWith(release(), 'VALIDATION', /tükendi/);
    const sent = await release([L(item.menemen)]);
    assert.equal(sent.status, 'RECEIVED');
    assert.deepEqual(sent.items.map((row) => row.name), ['Menemen']);
    assert.equal((await as(MANAGER, () => checks.getCheck(hotelId, sent.checkId))).waiterEmail, WAITER);
  });

  /* ══════════════════ Misafir QR ══════════════════ */

  it('misafir QR: bağlantı; oturumsuz menü; imza; kapalıyken sipariş yok; tekrar gönderim; açık sipariş sınırı; misafirin iptali; kabulde kalem değişimi; ret; bekleme uyarısı; yenilenen / oda değişen / çıkan bağlantı', async () => {
    const stay = await seedStay();
    const other = await seedStay({ roomNumber: '102', lastName: 'Demir' });
    const issued = await call('POST', `/pos/room-service/links/${stay.id}`, DESK);
    assert.equal(issued.statusCode, 200, issued.body);
    const link = issued.json().data.link;
    assert.ok(link.valid);
    assert.ok(link.path.startsWith(`${contracts.ROOM_SERVICE_GUEST_PATH}/`));
    const token = link.token;
    assert.match(token, contracts.ROOM_SERVICE_TOKEN_PATTERN);

    const menu = await open('GET', `/public/room-service/${token}`);
    assert.equal(menu.statusCode, 200, menu.body);
    assert.equal(menu.headers['cache-control'], 'no-store');
    assert.equal(menu.headers['referrer-policy'], 'no-referrer');
    const data = menu.json().data;
    assert.equal(data.roomNumber, '101');
    assert.equal(data.guestFirstName, 'Ayşe');
    assert.ok(!menu.body.includes('Kaya'), 'soyadı misafir sayfasına gitmez');
    assert.ok(data.orderingEnabled);
    assert.equal(data.trayCharge, '50.00');
    assert.deepEqual(data.outlets.map((row) => row.name), ['Oda Servisi']);
    // Grup sırası tanımdaki sıra, eşitse ad (Kahvaltı yalnızca oda servisinde satılır, yine de görünür).
    assert.deepEqual(data.outlets[0].categories.map((row) => row.name), ['Ana yemek', 'Kahvaltı', 'İçecek']);
    assert.ok(!menu.body.includes('Oda servisi ücreti'));

    // İmza: tek karakter değişirse yok; bilinmeyen bağlantı yok.
    const flipped = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    assert.equal((await open('GET', `/public/room-service/${flipped}`)).statusCode, 404);
    assert.equal((await open('GET', `/public/room-service/${randomUUID()}.${token.split('.')[1]}`)).statusCode, 404);
    assert.equal((await open('GET', '/public/room-service/bozuk')).statusCode, 400);

    const order = (input = {}, address) =>
      open('POST', `/public/room-service/${token}/orders`, { requestId: randomUUID(), outletId: outlet.rs.id, lines: [L(item.omlet), L(item.cay, 2)], ...input }, address);
    await policy({ guestOrderingEnabled: false });
    const closed = await order();
    assert.equal(closed.statusCode, 409);
    assert.equal(closed.json().code, 'GUEST_ORDERING_CLOSED');
    await policy({ guestOrderingEnabled: true });

    const requestId = randomUUID();
    const placed = await order({ requestId, note: 'Limonlu' });
    assert.equal(placed.statusCode, 201, placed.body);
    const first = placed.json().data.order;
    assert.equal(first.status, 'REQUESTED');
    assert.deepEqual(first.items.map((row) => Object.keys(row).sort()), [['name', 'note', 'quantity', 'unitPrice'], ['name', 'note', 'quantity', 'unitPrice']]);
    assert.equal((await order({ requestId })).json().data.order.id, first.id);
    const row = await db.roomServiceOrder.findFirst({ where: { id: first.id } });
    assert.equal(row.createdBy, 'misafir · oda 101');
    assert.equal(row.source, 'GUEST');
    assert.equal(row.checkId, null);
    assert.ok(await db.staffAlert.findFirst({ where: { hotelId, dedupeKey: 'room-service:guest-order', permission: contracts.PERMISSIONS.POS_OPERATE } }));

    // Açık misafir siparişi sınırı.
    const second = (await order({ lines: [L(item.menemen)] })).json().data.order;
    await order({ lines: [L(item.kahve)] });
    const limited = await order({ lines: [L(item.cay)] });
    assert.equal(limited.statusCode, 409);
    assert.equal(limited.json().code, 'GUEST_ORDER_LIMIT');

    // Misafir kabulden önce kendi siparişini iptal eder; başkasınınkini göremez.
    const cancelled = await open('POST', `/public/room-service/${token}/orders/${second.id}/cancel`);
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal(cancelled.json().data.orders.find((row2) => row2.id === second.id).status, 'CANCELLED');
    await openShift(WAITER);
    const foreign = await create(WAITER, { reservationId: other.id });
    assert.equal((await open('POST', `/public/room-service/${token}/orders/${foreign.id}/cancel`)).statusCode, 404);

    // Kabul: omlet tükendi, misafirle konuşulup menemene çevrildi; kabul edenin vardiyasında mutfağa.
    const current = await get(first.id);
    const accepted = await as(WAITER, () => rs.acceptOrder(hotelId, first.id, parse('acceptRoomServiceOrderSchema', { expectedUpdatedAt: current.updatedAt, lines: [L(item.menemen), L(item.cay, 2)] })));
    assert.equal(accepted.status, 'RECEIVED');
    assert.deepEqual(accepted.items.map((item2) => item2.name), ['Menemen', 'Çay']);
    assert.equal(accepted.dueAt, current.dueAt, 'teslim hedefi misafirin sipariş anından');
    await rejectsWith(as(WAITER, () => rs.acceptOrder(hotelId, first.id, parse('acceptRoomServiceOrderSchema', { expectedUpdatedAt: accepted.updatedAt }))), 'INVALID_TRANSITION');

    // Ret: misafir sebebi görür.
    const third = await db.roomServiceOrder.findFirst({ where: { hotelId, status: 'REQUESTED' } });
    await as(WAITER, () => rs.rejectOrder(hotelId, third.id, parse('rejectRoomServiceOrderSchema', { expectedUpdatedAt: third.updatedAt, reason: 'Mutfak kapandı' })));
    const status = (await open('GET', `/public/room-service/${token}/orders`)).json().data.orders;
    assert.equal(status.find((row2) => row2.id === third.id).rejectReason, 'Mutfak kapandı');
    assert.equal(status.find((row2) => row2.id === first.id).status, 'RECEIVED');

    // Kabul bekleyen misafir siparişi 5 dakika sonra şef garsona.
    await order({ lines: [L(item.kahve)] });
    assert.equal((await sweep(contracts.GUEST_ORDER_ALERT_MINUTES + 1)).waiting, 1);
    assert.equal((await sweep(contracts.GUEST_ORDER_ALERT_MINUTES + 1)).waiting, 0);
    // Kimse kabul etmezse teslim hedefini aşınca düşer: misafir "onay bekliyor"da kalmaz, sebebi görür; şef garsona bilgi.
    const unanswered = await db.roomServiceOrder.findFirst({ where: { hotelId, status: 'REQUESTED' } });
    const lateBy = (Date.parse(unanswered.dueAt) - Date.now()) / 60_000 + contracts.GUEST_ORDER_EXPIRY_MINUTES + 1;
    assert.equal((await sweep(lateBy - 2)).expired, 0);
    assert.equal((await sweep(lateBy)).expired, 1);
    assert.equal((await sweep(lateBy)).expired, 0);
    const expired = (await open('GET', `/public/room-service/${token}/orders`)).json().data.orders.find((row2) => row2.id === unanswered.id);
    assert.equal(expired.status, 'REJECTED');
    assert.equal(expired.rejectReason, contracts.GUEST_ORDER_EXPIRED_REASON);
    assert.equal((await db.roomServiceOrder.findFirst({ where: { id: unanswered.id } })).rejectedBy, 'system');
    assert.ok(await db.staffAlert.findFirst({ where: { hotelId, dedupeKey: 'room-service:guest-expired', permission: contracts.PERMISSIONS.POS_SUPERVISE } }));

    // Yenilenen bağlantı eskisini öldürür.
    const renewed = (await call('POST', `/pos/room-service/links/${stay.id}`, DESK)).json().data.link.token;
    assert.notEqual(renewed, token);
    const old = await open('GET', `/public/room-service/${token}`);
    assert.equal(old.statusCode, 409);
    assert.equal(old.json().code, 'LINK_EXPIRED');
    assert.equal((await open('GET', `/public/room-service/${renewed}`)).statusCode, 200);
    // Oda değişince ve çıkışta geçersiz.
    await db.reservation.update({ where: { id: stay.id }, data: { roomId: room['103'].id } });
    const moved = await open('GET', `/public/room-service/${renewed}`);
    assert.equal(moved.statusCode, 409);
    assert.match(moved.json().error, /Odanız değişti/);
    const linkView = (await call('GET', `/pos/room-service/links/${stay.id}`, DESK)).json().data;
    assert.equal(linkView.link.valid, false);
    await db.reservation.update({ where: { id: stay.id }, data: { roomId: room['101'].id, status: 'CHECKED_OUT', checkedOutAt: new Date(), checkedOutBy: DESK } });
    assert.match((await open('GET', `/public/room-service/${renewed}`)).json().error, /sona erdi/);
    // İptal edilen bağlantı.
    const fresh = (await call('POST', `/pos/room-service/links/${other.id}`, DESK)).json().data.link.token;
    assert.equal((await call('DELETE', `/pos/room-service/links/${other.id}`, DESK)).statusCode, 200);
    assert.equal((await open('GET', `/public/room-service/${fresh}`)).statusCode, 409);
  });

  it('misafir QR: yazma uçlarında IP başına hız sınırı; aynı anda gelen siparişler sınırı aşmaz', async () => {
    const stay = await seedStay();
    const token = (await as(DESK, () => guest.issueLink(hotelId, stay.id))).link.token;
    const statuses = [];
    for (let index = 0; index < 11; index += 1) statuses.push((await open('POST', `/public/room-service/${token}/orders/${randomUUID()}/cancel`, undefined, '10.9.8.7')).statusCode);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(404));
    assert.equal(statuses[10], 429);
    // Başka IP etkilenmez.
    assert.equal((await open('POST', `/public/room-service/${token}/orders/${randomUUID()}/cancel`, undefined, '10.9.8.8')).statusCode, 404);

    const burst = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        open('POST', `/public/room-service/${token}/orders`, { requestId: randomUUID(), outletId: outlet.rs.id, lines: [L(item.cay, index + 1)] }, `10.1.1.${index + 1}`),
      ),
    );
    assert.deepEqual(burst.map((response) => response.statusCode).sort(), [201, 201, 201, 409, 409]);
    assert.equal(await db.roomServiceOrder.count({ where: { hotelId, source: 'GUEST', status: 'REQUESTED' } }), contracts.MAX_GUEST_ACTIVE_ORDERS);
  });

  /* ══════════════════ İstekten siparişe ══════════════════ */

  it('istekten siparişe: istek işlemde; ikinci çevirme yok; başka konaklama yok; iptalde istek yeniden açık; teslimde tamamlanır', async () => {
    const stay = await seedStay();
    const other = await seedStay({ roomNumber: '102', lastName: 'Demir' });
    await openShift(WAITER);
    const request = (category = 'ROOM_SERVICE') =>
      db.guestRequest.create({ data: { hotelId, reservationId: stay.id, roomId: room['101'].id, category, title: 'İki çay ve omlet', dueAt: new Date(Date.now() + 30 * MINUTE), createdBy: DESK } });
    const asked = await request();
    let order = await create(WAITER, { reservationId: stay.id, guestRequestId: asked.id });
    assert.equal(order.source, 'REQUEST');
    assert.equal(order.guestRequest.status, 'IN_PROGRESS');
    await rejectsWith(create(WAITER, { reservationId: stay.id, guestRequestId: asked.id }), 'REQUEST_LINKED');
    const another = await request();
    await rejectsWith(create(WAITER, { reservationId: other.id, guestRequestId: another.id }), 'VALIDATION', /başka bir konaklamanın/);
    const housekeeping = await request('HOUSEKEEPING');
    await rejectsWith(create(WAITER, { reservationId: stay.id, guestRequestId: housekeeping.id }), 'VALIDATION', /Yalnızca oda servisi/);

    await cancel(WAITER, order, { reason: 'Misafir vazgeçti' });
    assert.equal((await db.guestRequest.findFirst({ where: { id: asked.id } })).status, 'OPEN');
    order = await create(WAITER, { reservationId: stay.id, guestRequestId: asked.id });
    order = await advance(WAITER, order, 'ON_THE_WAY');
    await deliver(WAITER, order);
    const done = await db.guestRequest.findFirst({ where: { id: asked.id } });
    assert.equal(done.status, 'DONE');
    assert.match(done.resolutionNote, new RegExp(order.number));
    // Teslimden sonra yeniden açılan istek yeniden siparişe çevrilir (kural: aynı anda tek bitmemiş sipariş).
    await as(DESK, () => requests.changeRequestStatus(hotelId, asked.id, { status: 'OPEN', note: null, expectedUpdatedAt: done.updatedAt }));
    const again = await create(WAITER, { reservationId: stay.id, guestRequestId: asked.id });
    assert.equal(again.source, 'REQUEST');
    assert.equal(again.guestRequest.status, 'IN_PROGRESS');
    await rejectsWith(create(WAITER, { reservationId: stay.id, guestRequestId: asked.id }), 'REQUEST_LINKED');
    assert.ok(await db.eventLog.findFirst({ where: { hotelId, name: 'guest.request.updated', payload: { path: ['status'], equals: 'DONE' } } }));
  });

  /* ══════════════════ İptal ve tur ekleme ══════════════════ */

  it('tur ekleme ve iptal: hazır sipariş mutfağa döner; yoldayken kalem eklenmez; mutfaktaki iptal şef garsonla ve zayi; başlamamış iptal zayisiz; planlı iptal adisyonsuz', async () => {
    const stay = await seedStay();
    await openShift(WAITER);
    await openShift(RUNNER);
    let order = await create(WAITER, { reservationId: stay.id, lines: [L(item.omlet), L(item.cay)] });
    order = await advance(WAITER, order, 'READY');
    await as(WAITER, () => checks.sendOrder(hotelId, order.checkId, parse('sendPosOrderSchema', { requestId: randomUUID(), lines: [L(item.kahve)] })));
    order = await get(order.id);
    assert.equal(order.status, 'RECEIVED');
    assert.equal(order.readyAt, null);
    assert.deepEqual(order.items.map((row) => row.name), ['Omlet', 'Çay', 'Türk kahvesi']);
    assert.equal(order.itemsTotal, '310.00');
    assert.equal((await lastEvent('fnb.order.placed')).payload.roomNumber, '101');
    order = await advance(RUNNER, order, 'ON_THE_WAY');
    await rejectsWith(as(WAITER, () => checks.sendOrder(hotelId, order.checkId, parse('sendPosOrderSchema', { requestId: randomUUID(), lines: [L(item.cay)] }))), 'ROOM_SERVICE_LOCKED');
    // Yoldan geri (misafir odada yok): hazır.
    order = await advance(RUNNER, order, 'READY');
    assert.equal(order.runnerEmail, null);
    assert.ok(order.readyAt);

    await rejectsWith(cancel(WAITER, order, { reason: 'Misafir vazgeçti' }), 'FORBIDDEN');
    const cancelled = await cancel(MANAGER, order, { reason: 'Misafir vazgeçti', waste: true }, true);
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.check.status, 'CLOSED');
    assert.equal(cancelled.check.grandTotal, '0.00');
    const paid = await lastEvent('fnb.order.paid');
    assert.deepEqual(
      paid.payload.items.map((row) => [row.name, row.sold, row.wasted]).sort(),
      // Tepsi ücreti zayi sayılmaz (satılan / ikram / zayi hepsi sıfır: stoka gitmez).
      [['Omlet', 0, 1], ['Türk kahvesi', 0, 1], ['Çay', 0, 1]].sort(),
    );

    // Mutfak başlamadan: sipariş alan iptal eder, zayi yok.
    const early = await create(WAITER, { reservationId: stay.id, lines: [L(item.menemen)] });
    await cancel(WAITER, early, { reason: 'Yanlış oda' });
    assert.ok((await lastEvent('fnb.order.paid')).payload.items.every((row) => row.wasted === 0));
    // Planlı: adisyonsuz.
    const planned = await create(WAITER, { reservationId: stay.id, deliverAt: wall(180) });
    const dropped = await cancel(WAITER, planned, { reason: 'Misafir aradı' });
    assert.equal(dropped.status, 'CANCELLED');
    assert.equal(dropped.checkId, null);
    // İptal edilmiş sipariş ilerlemez, teslim edilmez.
    await rejectsWith(advance(WAITER, dropped, 'READY'), 'INVALID_TRANSITION');
  });

  /* ══════════════════ Tepsi, gecikme, konaklama bitti ══════════════════ */

  it('zamanlanmış uyarılar: gecikme bir kez; tepsi uyarısı ve toplama (kat hizmetleri); konaklaması biten mutfaktaki için uyarı, planlı iptal', async () => {
    const stay = await seedStay();
    const stay2 = await seedStay({ roomNumber: '102', lastName: 'Demir' });
    await openShift(WAITER);
    const delivered = await deliver(WAITER, await create(WAITER, { reservationId: stay.id }));
    const waiting = await create(WAITER, { reservationId: stay2.id });
    const planned = await create(WAITER, { reservationId: stay2.id, deliverAt: wall(300) });

    let trays = await as(HOUSEKEEPER, () => read.listTrays(hotelId, {}));
    assert.deepEqual(trays.items.map((row) => [row.id, row.overdue]), [[delivered.id, false]]);
    // Takip penceresi (24 saat): dünkü işaretlenmemiş tepsi oda temizliğiyle toplanmış sayılır — listede, sayaçta yok.
    const yesterday = await deliver(WAITER, await create(WAITER, { reservationId: stay.id }));
    await db.roomServiceOrder.update({ where: { id: yesterday.id }, data: { deliveredAt: new Date(Date.now() - (contracts.TRAY_TRACKING_HOURS + 1) * 3_600_000) } });
    assert.equal((await as(HOUSEKEEPER, () => read.listTrays(hotelId, {}))).total, 1);
    assert.equal((await as(WAITER, () => read.getBoard(hotelId, {}))).trays.pending, 1);
    assert.equal((await get(yesterday.id)).trayOverdue, false);

    const late = await sweep(31);
    assert.equal(late.late, 1);
    assert.equal(late.trays, 0);
    assert.equal((await sweep(31)).late, 0);
    assert.equal((await sweep(91)).trays, 1);
    assert.equal((await sweep(91)).trays, 0);
    const trayAlert = await db.staffAlert.findFirst({ where: { hotelId, dedupeKey: 'room-service:tray' } });
    assert.equal(trayAlert.link, '/oda-servisi/tepsiler');

    // Kat görevlisi tepsiyi toplar (HTTP); tekrar işaret sonucu değiştirmez; panoyu göremez.
    assert.equal((await call('GET', '/pos/room-service/board', HOUSEKEEPER)).statusCode, 403);
    const collected = await call('POST', '/pos/room-service/trays/collect', HOUSEKEEPER, { orderIds: [delivered.id, waiting.id] });
    assert.equal(collected.statusCode, 200, collected.body);
    assert.deepEqual(collected.json().data, { collected: 1, skipped: 1 });
    assert.deepEqual((await call('POST', '/pos/room-service/trays/collect', HOUSEKEEPER, { orderIds: [delivered.id] })).json().data, { collected: 0, skipped: 1 });
    trays = await as(HOUSEKEEPER, () => read.listTrays(hotelId, {}));
    assert.equal(trays.total, 0);
    assert.equal((await get(delivered.id)).trayCollectedBy, HOUSEKEEPER);

    // Misafir çıktı: mutfaktaki için uyarı (bir kez), planlı otomatik iptal.
    await db.reservation.update({ where: { id: stay2.id }, data: { status: 'CHECKED_OUT', checkedOutAt: new Date(), checkedOutBy: DESK } });
    const ended = await sweep(0);
    assert.equal(ended.staleStays, 1);
    assert.equal(ended.cancelled, 1);
    assert.equal((await sweep(0)).staleStays, 0);
    assert.equal((await get(planned.id)).status, 'CANCELLED');
    assert.equal((await get(planned.id)).cancelledBy, 'system');
    // Konaklama bitti: kalan odaya yazılamaz, kapıda alınır.
    const runnerOrder = await get(waiting.id);
    await rejectsWith(deliver(WAITER, runnerOrder), 'VALIDATION', /içeride değil/);
    const settled = await deliver(WAITER, runnerOrder, { payments: [{ method: 'CASH', amount: runnerOrder.check.balance }], chargeRemainder: false });
    assert.equal(settled.status, 'DELIVERED');
  });

  /* ══════════════════ Geçmiş ve rapor ══════════════════ */

  it('geçmiş ve rapor: durum / arama / sayfa; sayılar, süreler, zamanında oranı, ciro ve tepsi ücreti, götüren, saat', async () => {
    const stay = await seedStay();
    const stay2 = await seedStay({ roomNumber: '102', lastName: 'Demirci' });
    await openShift(WAITER);
    const a = await deliver(WAITER, await create(WAITER, { reservationId: stay.id, lines: [L(item.omlet)] }));
    const b = await deliver(WAITER, await create(WAITER, { reservationId: stay2.id, lines: [L(item.kahve, 2)] }));
    const c = await create(WAITER, { reservationId: stay2.id, lines: [L(item.cay)] });
    await cancel(WAITER, c, { reason: 'Misafir vazgeçti' });
    // Süreler: a 25 dakikada (zamanında), b 40 dakikada (gecikti).
    const stamp = async (order, minutes) => {
      const start = new Date(Date.now() - 60 * MINUTE);
      await db.roomServiceOrder.update({
        where: { id: order.id },
        data: {
          receivedAt: start,
          readyAt: new Date(start.getTime() + 15 * MINUTE),
          dispatchedAt: new Date(start.getTime() + 18 * MINUTE),
          deliveredAt: new Date(start.getTime() + minutes * MINUTE),
          dueAt: new Date(start.getTime() + 30 * MINUTE),
        },
      });
    };
    await stamp(a, 25);
    await stamp(b, 40);

    const list = (query) => as(MANAGER, () => read.listOrders(hotelId, parse('roomServiceListQuerySchema', query)));
    assert.equal((await list({})).meta.total, 3);
    assert.equal((await list({ state: 'DELIVERED' })).meta.total, 2);
    assert.equal((await list({ state: 'CANCELLED' })).meta.total, 1);
    assert.deepEqual((await list({ search: '102' })).items.map((row) => row.id).sort(), [b.id, c.id].sort());
    assert.deepEqual((await list({ search: 'demirci' })).items.length, 2);
    assert.deepEqual((await list({ search: a.number.slice(-4) })).items.map((row) => row.id), [a.id]);
    assert.equal((await list({ search: '%_' })).meta.total, 0);
    const paged = await list({ pageSize: 1, page: 2 });
    assert.equal(paged.items.length, 1);
    assert.equal(paged.meta.totalPages, 3);

    const report = await as(MANAGER, () => read.roomServiceReport(hotelId, {}));
    assert.equal(report.summary.orders, 3);
    assert.equal(report.summary.delivered, 2);
    assert.equal(report.summary.cancelled, 1);
    assert.equal(report.summary.onTimePct, 50);
    assert.equal(report.timing.asap.total.avg, 32.5);
    assert.equal(report.timing.asap.kitchen.p50, 15);
    assert.equal(report.timing.asap.transitAvg, 14.5);
    // Ciro: (180 + 50) + (180 + 50) = 460; tepsi ücreti 2 × 50.
    assert.equal(report.revenue.grandTotal, '460.00');
    assert.equal(report.revenue.trayCharges, '100.00');
    assert.equal(report.revenue.roomCharged, '460.00');
    assert.deepEqual(report.byRunner.map((row) => [row.runnerEmail, row.delivered]), [[WAITER, 2]]);
    assert.equal(report.byHour.reduce((sum, row) => sum + row.orders, 0), 3);
    assert.equal(report.byDay.length, 1);
    assert.equal(report.trays.uncollected, 2);
    // HTTP: rapor yetkisi.
    assert.equal((await call('GET', '/pos/room-service/report', WAITER)).statusCode, 403);
    assert.equal((await call('GET', '/pos/room-service/report', ACCOUNTANT)).statusCode, 200);
  });

  /* ══════════════════ İzinler, kapsam, eşzamanlılık ══════════════════ */

  it('izinler, otel kapsamı ve eşzamanlılık: rol başına uçlar; başka otelin siparişi yok; aynı anda iki teslimde tek kazanan; kabul ile ret yarışı', async () => {
    const stay = await seedStay();
    assert.equal((await call('GET', '/pos/room-service/board', ACCOUNTANT)).statusCode, 200);
    assert.equal((await call('POST', '/pos/room-service/orders', ACCOUNTANT, { requestId: randomUUID(), outletId: outlet.rs.id, reservationId: stay.id, lines: [L(item.cay)] })).statusCode, 403);
    assert.equal((await call('GET', '/pos/room-service/board', DESK)).statusCode, 403);
    assert.equal((await call('GET', '/pos/room-service/trays', DESK)).statusCode, 200);
    assert.equal((await call('GET', `/pos/room-service/links/${stay.id}`, DESK)).statusCode, 200);
    assert.equal((await call('GET', `/pos/room-service/links/${stay.id}`, ACCOUNTANT)).statusCode, 403);
    // Otel bağlamı (saatler otelin diliminde): oda servisi personeli ve kat görevlisi okur; tam otel kaydı yalnız ayar yetkilisine.
    for (const email of [WAITER, HOUSEKEEPER, DESK]) {
      assert.equal((await call('GET', '/settings/hotel', email)).statusCode, 403);
      const context = await call('GET', '/settings/hotel/context', email);
      assert.equal(context.statusCode, 200, context.body);
      assert.deepEqual(Object.keys(context.json().data).sort(), ['code', 'currency', 'defaultBoardType', 'name', 'timezone', 'today']);
      assert.equal(context.json().data.timezone, ZONE);
    }
    assert.equal((await app.inject({ method: 'GET', url: '/settings/hotel/context' })).statusCode, 401);
    const bad = await call('POST', '/pos/room-service/orders', WAITER, { requestId: randomUUID(), outletId: outlet.rs.id, reservationId: stay.id, lines: [{ menuItemId: item.cay.id, quantity: 0 }] });
    assert.equal(bad.statusCode, 400);

    await openShift(WAITER);
    await openShift(RUNNER);
    const created = await call('POST', '/pos/room-service/orders', WAITER, { requestId: randomUUID(), outletId: outlet.rs.id, reservationId: stay.id, lines: [L(item.cay, 2)], deliverAt: null });
    assert.equal(created.statusCode, 201, created.body);
    let order = created.json().data;
    await rejectsWith(as(MANAGER, () => read.getOrder(otherHotelId, order.id)), 'NOT_FOUND');
    await rejectsWith(as(WAITER, () => rs.advanceOrder(otherHotelId, order.id, parse('advanceRoomServiceOrderSchema', { expectedUpdatedAt: order.updatedAt, status: 'READY' }))), 'NOT_FOUND');
    await rejectsWith(as(DESK, () => guest.issueLink(otherHotelId, stay.id)), 'VALIDATION');

    // Aynı anda iki teslim (farklı istek): tek kazanan, tek odaya yazma.
    order = await advance(WAITER, order, 'ON_THE_WAY');
    const outcomes = await Promise.allSettled([deliver(WAITER, order), deliver(RUNNER, order)]);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    assert.ok(['STALE_WRITE', 'INVALID_TRANSITION'].includes(outcomes.find((outcome) => outcome.status === 'rejected').reason.code));
    assert.equal(await db.posRoomCharge.count({ where: { hotelId } }), 1);

    // Kabul ile ret aynı anda: biri kazanır.
    const token = (await as(DESK, () => guest.issueLink(hotelId, stay.id))).link.token;
    const asked = (await open('POST', `/public/room-service/${token}/orders`, { requestId: randomUUID(), outletId: outlet.rs.id, lines: [L(item.kahve)] })).json().data.order;
    const row = await db.roomServiceOrder.findFirst({ where: { id: asked.id } });
    const race = await Promise.allSettled([
      as(WAITER, () => rs.acceptOrder(hotelId, asked.id, parse('acceptRoomServiceOrderSchema', { expectedUpdatedAt: row.updatedAt }))),
      as(RUNNER, () => rs.rejectOrder(hotelId, asked.id, parse('rejectRoomServiceOrderSchema', { expectedUpdatedAt: row.updatedAt, reason: 'Mutfak kapandı' }))),
    ]);
    assert.equal(race.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    const final = await db.roomServiceOrder.findFirst({ where: { id: asked.id } });
    assert.ok(['RECEIVED', 'REJECTED'].includes(final.status));
    assert.equal(await db.posCheck.count({ where: { hotelId, sourceKey: `room-service:${asked.id}` } }), final.status === 'RECEIVED' ? 1 : 0);
  });
});
