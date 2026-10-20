import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Restoran POS (modül 39) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: tanımlar (toplu masa, satış noktası kısıtı, tükendi, politika sürümü), vardiya
 * (tek açık vardiya, vardiyasız işlem yok, kapanışta açık adisyon / bekleyen onay engeli,
 * beklenen nakit = avans + nakit − iptal, fark ve uyarı, rapor), adisyon (çift dokunuşta tek
 * adisyon, sipariş turu fiyat kopyası ve tekrar gönderimde tek tur, masa durumu, hesap isteme),
 * düzeltme (eşik altı hemen, eşik üstü dört göz, red, indirimin yerine geçmesi, ödemeyi aşan
 * düzeltme), ödeme (kısmi, fazla tutar, tekrar gönderim, eşzamanlı iki tam ödemede tek kazanan,
 * sürüme dokunmama, büyük ödeme onayı, kapanınca masanın boşalması), ödeme iptali (yeniden
 * açma, ters kayıt asıl vardiyaya, red), odaya yaz (folyo kalemleri vergi kategorisi başına,
 * folyo toplamı birebir, kapalı satış noktası, çıkmış misafir, yuvarlama önerisi), bölme /
 * taşıma / birleştirme / devir, kasa birleşimi, satış raporu, zamanlanmış iş, izinler ve otel
 * kapsamı.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
/** Şef garson + tanım + rapor (MANAGER rolü). */
const MANAGER = 'mudur@test.local';
/** Dört göz onayını veren ikinci yönetici. */
const MANAGER2 = 'genelmudur@test.local';
/** Garsonlar (FNB rolü: yalnızca `pos.operate`). */
const WAITER = 'garson1@test.local';
const WAITER2 = 'garson2@test.local';
/** Muhasebe (yalnızca `pos.report`). */
const ACCOUNTANT = 'muhasebe@test.local';
/** Ön büro (POS yetkisi yok). */
const DESK = 'onburo@test.local';
/** Bu tutar ve üstü tahsilat onaya gider. */
const THRESHOLD = '20000.00';
const TC = '10000000146';

describe('restoran POS (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let setup;
  /** @type {any} */ let checks;
  /** @type {any} */ let payments;
  /** @type {any} */ let shifts;
  /** @type {any} */ let reports;
  /** @type {any} */ let jobs;
  /** @type {any} */ let approvals;
  /** @type {any} */ let cash;
  /** @type {any} */ let folios;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let otherHotelId;
  /** @type {Record<string, any>} */ let outlet;
  /** @type {Record<string, any>} */ let table;
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
    reports = await import('./reports.js');
    jobs = await import('./jobs.js');
    approvals = await import('../approvals/service.js');
    cash = await import('../payments/service.js');
    folios = await import('../folios/service.js');
    cache = await import('../../lib/cache.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const today = () => core.toIsoDay(core.calendarDateInTimeZone(ZONE));
  const D = (offset) => core.toIsoDay(core.addDays(core.calendarDateInTimeZone(ZONE), offset));
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
      data: { name: 'Büyük Ankara Oteli', code: `P${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY', largePaymentThreshold: THRESHOLD },
    });
    hotelId = hotel.id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka Otel', code: `O${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Restoran Müdürü', role: 'MANAGER', passwordHash },
        { hotelId, email: MANAGER2, name: 'Genel Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: WAITER, name: 'Ali Garson', role: 'FNB', passwordHash },
        { hotelId, email: WAITER2, name: 'Ayşe Garson', role: 'FNB', passwordHash },
        { hotelId, email: ACCOUNTANT, name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
        { hotelId, email: DESK, name: 'Ön Büro', role: 'FRONT_DESK', passwordHash },
      ],
    });
    // Yiyecek-içecek KDV %10 dahil; butik / tütün KDV %20 dahil.
    await db.tax.createMany({
      data: [
        { hotelId, name: 'KDV', rate: '10', isIncluded: true, appliesTo: ['FNB'] },
        { hotelId, name: 'KDV', rate: '20', isIncluded: true, appliesTo: ['OTHER'] },
      ],
    });
    roomType = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '3000', capacityAdults: 2, capacityChildren: 0 } });
    room = {};
    for (const number of ['101', '102']) room[number] = await db.room.create({ data: { hotelId, number, roomTypeId: roomType.id } });

    await as(MANAGER, async () => {
      outlet = {
        rest: await setup.createOutlet(hotelId, parse('createPosOutletSchema', { code: 'REST', name: 'Ana Restoran' })),
        bar: await setup.createOutlet(hotelId, parse('createPosOutletSchema', { code: 'BAR', name: 'Lobi Bar', allowRoomCharge: false })),
      };
      await setup.createTablesBulk(hotelId, parse('bulkPosTablesSchema', { outletId: outlet.rest.id, from: 1, to: 10, zone: 'İç salon' }));
      await setup.createTable(hotelId, parse('createPosTableSchema', { outletId: outlet.bar.id, name: 'B1', seats: 2 }));
      const main = await setup.createCategory(hotelId, parse('createMenuCategorySchema', { name: 'Ana yemek' }));
      const drinks = await setup.createCategory(hotelId, parse('createMenuCategorySchema', { name: 'İçecek' }));
      const tobacco = await setup.createCategory(hotelId, parse('createMenuCategorySchema', { name: 'Tütün', outletIds: [outlet.bar.id] }));
      const shop = await setup.createCategory(hotelId, parse('createMenuCategorySchema', { name: 'Butik' }));
      const make = (input) => setup.createItem(hotelId, parse('createMenuItemSchema', input));
      item = {
        kofte: await make({ categoryId: main.id, code: 'KOFTE', name: 'Izgara köfte', price: '450', station: 'HOT' }),
        salata: await make({ categoryId: main.id, code: 'SALATA', name: 'Çoban salata', price: '220', station: 'COLD' }),
        bira: await make({ categoryId: drinks.id, code: 'BIRA', name: 'Fıçı bira', price: '180', station: 'BAR' }),
        puro: await make({ categoryId: tobacco.id, code: 'PURO', name: 'Puro', price: '600', taxCategory: 'OTHER', station: 'NONE' }),
        cikolata: await make({ categoryId: shop.id, code: 'CIKO', name: 'El yapımı çikolata', price: '120', taxCategory: 'OTHER', station: 'NONE' }),
      };
      await setup.updateSettings(hotelId, parse('updatePosSettingsSchema', { adjustmentApprovalAmount: '1000', cashVarianceAlert: '100' }));
    });
    const tables = await db.posTable.findMany({ where: { hotelId }, select: { id: true, name: true, outletId: true } });
    table = Object.fromEntries(tables.map((row) => [row.name, row]));
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });

  /* ── Yardımcılar (servis, şemadan geçirilmiş girdiyle) ── */

  const openShift = (email, openingFloat = '500') => as(email, () => shifts.openShift(hotelId, parse('openPosShiftSchema', { openingFloat })));
  const openCheck = (email, input = {}) =>
    as(email, () => checks.openCheck(hotelId, parse('openPosCheckSchema', { requestId: randomUUID(), outletId: outlet.rest.id, tableId: table['1'].id, covers: 2, ...input })));
  const send = (email, checkId, lines, requestId = randomUUID()) =>
    as(email, () =>
      checks.sendOrder(hotelId, checkId, parse('sendPosOrderSchema', { requestId, lines: lines.map(([menuItem, quantity, note]) => ({ menuItemId: menuItem.id, quantity, note })) })),
    );
  const pay = (email, checkId, method, amount, extra = {}) =>
    as(email, () =>
      payments.receivePayment(hotelId, checkId, parse('posPaymentSchema', { requestId: randomUUID(), method, amount, ...(method === 'CARD' ? { reference: 'SLIP-1001' } : {}), ...extra })),
    );
  const adjust = (email, checkId, input) => as(email, () => checks.requestAdjustment(hotelId, checkId, parse('posAdjustmentSchema', input)));
  const lineOf = (check, menuItem) => check.lines.find((line) => line.menuItemId === menuItem.id);
  const reload = (checkId) => as(MANAGER, () => checks.getCheck(hotelId, checkId));
  const grant = (approvalId, note = 'Uygun') => as(MANAGER2, () => approvals.decideApproval(hotelId, approvalId, 'GRANTED', { note }));
  const deny = (approvalId, note = 'Uygun değil') => as(MANAGER2, () => approvals.decideApproval(hotelId, approvalId, 'DENIED', { note }));
  const floorState = async (tableName, outletId = outlet.rest.id) =>
    (await as(WAITER, () => checks.getFloor(hotelId, outletId))).tables.find((row) => row.name === tableName).state;
  const editItem = (dto, changes) =>
    as(MANAGER, () =>
      setup.updateItem(
        hotelId,
        dto.id,
        parse('updateMenuItemSchema', {
          expectedUpdatedAt: dto.updatedAt,
          categoryId: dto.categoryId,
          code: dto.code,
          name: dto.name,
          description: dto.description,
          price: dto.price,
          taxCategory: dto.taxCategory,
          station: dto.station,
          isActive: dto.isActive,
          sortOrder: dto.sortOrder,
          ...changes,
        }),
      ),
    );

  async function seedStay({ roomNumber = '101', status = 'CHECKED_IN', lastName = 'Kaya' } = {}) {
    const guest = await db.guest.create({ data: { hotelId, firstName: 'Ayşe', lastName, idType: 'NATIONAL_ID', idNumber: TC, nationality: 'TR' } });
    return db.reservation.create({
      data: {
        hotelId,
        guestId: guest.id,
        roomTypeId: roomType.id,
        roomId: room[roomNumber].id,
        checkIn: new Date(D(-2)),
        checkOut: new Date(D(1)),
        status,
        checkedInAt: new Date(Date.now() - 2 * 86_400_000),
        checkedInBy: DESK,
        checkedOutAt: status === 'CHECKED_OUT' ? new Date() : null,
        checkedOutBy: status === 'CHECKED_OUT' ? DESK : null,
        confirmedAt: new Date(),
        totalPrice: '9000.00',
        confirmationCode: `H${randomUUID().slice(0, 7).toUpperCase()}`,
      },
    });
  }

  /* ══════════════════ Tanımlar ══════════════════ */

  it('tanımlar: toplu masa var olanı atlar; terminal satılanları verir; politika sürümü; pasif ürün satılmaz', async () => {
    const again = await as(MANAGER, () => setup.createTablesBulk(hotelId, parse('bulkPosTablesSchema', { outletId: outlet.rest.id, from: 8, to: 12 })));
    assert.deepEqual(again, { created: 2, skipped: 3 });
    await rejectsWith(as(MANAGER, () => setup.createTable(hotelId, parse('createPosTableSchema', { outletId: outlet.rest.id, name: '1' }))), 'DUPLICATE', /aynı adlı/);

    const terminal = await as(WAITER, () => setup.getTerminal(hotelId));
    assert.equal(terminal.outlets.length, 2);
    assert.equal(terminal.tables.length, 13);
    assert.equal(terminal.items.length, 5);
    assert.equal(terminal.settings.adjustmentApprovalAmount, '1000.00');

    // Politika: eski sürümle yazılmaz.
    await rejectsWith(as(MANAGER, () => setup.updateSettings(hotelId, parse('updatePosSettingsSchema', { adjustmentApprovalAmount: '500', cashVarianceAlert: '50' }))), 'STALE_WRITE');

    // Pasif ürün ve pasif grup terminalde görünmez, siparişe girmez.
    await editItem(item.salata, { isActive: false });
    assert.equal((await as(WAITER, () => setup.getTerminal(hotelId))).items.length, 4);
    await openShift(WAITER);
    const check = await openCheck(WAITER);
    await rejectsWith(send(WAITER, check.id, [[item.salata, 1]]), 'VALIDATION', /satıştan kalkmış/);
    const page = await as(MANAGER, () => setup.listItems(hotelId, parse('menuItemListQuerySchema', { search: 'köf' })));
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].code, 'KOFTE');
  });

  /* ══════════════════ Adisyon ve sipariş ══════════════════ */

  it('adisyon: vardiyasız açılmaz; tek açık vardiya; çift dokunuşta tek adisyon; tur fiyatı kopyalar, tekrar gönderimde tek tur; masa durumu', async () => {
    await rejectsWith(openCheck(WAITER), 'NO_SHIFT');
    await openShift(WAITER);
    await rejectsWith(openShift(WAITER), 'SHIFT_OPEN');

    const requestId = randomUUID();
    const [a, b] = await Promise.all([openCheck(WAITER, { requestId }), openCheck(WAITER, { requestId })]);
    assert.equal(a.id, b.id);
    assert.equal(await db.posCheck.count({ where: { hotelId } }), 1);
    assert.match(a.number, /^ADS-\d{4}-000001$/);
    assert.equal(await floorState('1'), 'OCCUPIED');
    assert.equal(await floorState('2'), 'FREE');

    const orderKey = randomUUID();
    const lines = [
      [item.kofte, 2],
      [item.salata, 1, 'Az tuzlu'],
      [item.bira, 2],
    ];
    await Promise.all([send(WAITER, a.id, lines, orderKey), send(WAITER, a.id, lines, orderKey)]);
    let check = await reload(a.id);
    assert.equal(check.orders.length, 1);
    assert.equal(check.lines.length, 3);
    assert.equal(lineOf(check, item.salata).note, 'Az tuzlu');
    // 900 + 220 + 360 = 1480; KDV %10 dahil: 1480 − 1480 / 1,1.
    assert.equal(check.totals.grandTotal, '1480.00');
    assert.equal(check.totals.taxTotal, '134.55');
    assert.equal(check.balance, '1480.00');
    const sent = await lastEvent('pos.order.sent');
    assert.deepEqual(sent.payload.stations, ['HOT', 'COLD', 'BAR']);
    // İş olayı (mutfak / fnb-worker): tur bir kez, kalemler kimlik, adet, istasyon ve notla.
    const placed = await db.eventLog.findMany({ where: { hotelId, name: 'fnb.order.placed' } });
    assert.equal(placed.length, 1);
    assert.equal(placed[0].payload.seq, 1);
    assert.equal(placed[0].payload.tableName, '1');
    assert.equal(placed[0].payload.number, a.number);
    assert.deepEqual(
      placed[0].payload.lines.map((line) => [line.name, line.quantity, line.station, line.note]),
      [
        ['Izgara köfte', 2, 'HOT', null],
        ['Çoban salata', 1, 'COLD', 'Az tuzlu'],
        ['Fıçı bira', 2, 'BAR', null],
      ],
    );
    assert.deepEqual(placed[0].payload.lines.map((line) => line.lineId).sort(), check.lines.map((line) => line.id).sort());
    // Aynı istek başka adisyonda kullanılamaz.
    const other = await openCheck(WAITER, { tableId: table['2'].id });
    await rejectsWith(send(WAITER, other.id, lines, orderKey), 'DUPLICATE_REQUEST');

    // Fiyat değişikliği gönderilmiş kaleme dokunmaz.
    item.kofte = await editItem(item.kofte, { price: '500' });
    await send(WAITER, a.id, [[item.kofte, 1]]);
    check = await reload(a.id);
    assert.deepEqual(check.lines.filter((line) => line.menuItemId === item.kofte.id).map((line) => line.unitPrice).sort(), ['450.00', '500.00']);
    assert.equal(check.totals.grandTotal, '1980.00');

    // Hesap istendi → masa "hesap istiyor"; yeni sipariş isteği geri alır.
    await as(WAITER, () => checks.requestBill(hotelId, a.id, { requested: true }));
    assert.equal(await floorState('1'), 'BILL');
    await send(WAITER, a.id, [[item.bira, 1]]);
    assert.equal(await floorState('1'), 'OCCUPIED');

    // Tükendi ve satış noktası kısıtı.
    await as(MANAGER, () => setup.setSoldOut(hotelId, item.salata.id, { soldOut: true }));
    await rejectsWith(send(WAITER, a.id, [[item.salata, 1]]), 'VALIDATION', /tükendi/);
    await rejectsWith(send(WAITER, a.id, [[item.puro, 1]]), 'VALIDATION', /bu satış noktasında satılmıyor/);

    // Açık adisyonlu satış noktası pasife alınamaz; eski sürümle adisyon güncellenmez.
    const rest = await db.posOutlet.findFirst({ where: { id: outlet.rest.id } });
    await rejectsWith(
      as(MANAGER, () => setup.updateOutlet(hotelId, outlet.rest.id, parse('updatePosOutletSchema', { code: 'REST', name: 'Ana Restoran', isActive: false, expectedUpdatedAt: rest.updatedAt }))),
      'OUTLET_IN_USE',
    );
    await rejectsWith(as(WAITER, () => checks.updateCheck(hotelId, a.id, parse('updatePosCheckSchema', { expectedUpdatedAt: a.updatedAt, covers: 4 }))), 'STALE_WRITE');

    // Arama: numara parçası (en az 3 karakter) ya da masa adı (birebir); süzgeçlerle birlikte.
    const search = (input) => as(WAITER, () => checks.listChecks(hotelId, parse('posCheckListQuerySchema', input)));
    assert.deepEqual((await search({ search: a.number.slice(-6) })).items.map((row) => row.id), [a.id]);
    assert.deepEqual((await search({ search: '1' })).items.map((row) => row.id), [a.id]);
    assert.equal((await search({ search: '1', status: 'CLOSED' })).meta.total, 0);
    assert.equal((await search({ search: '%_' })).meta.total, 0);
    assert.equal((await search({ search: 'zz' })).meta.total, 0);

    // Boş adisyon iptal edilir, kalemlisi edilmez.
    const fresh = await reload(other.id);
    const voided = await as(WAITER, () => checks.voidEmptyCheck(hotelId, other.id, { expectedUpdatedAt: new Date(fresh.updatedAt) }));
    assert.equal(voided.status, 'VOID');
    check = await reload(a.id);
    await rejectsWith(as(WAITER, () => checks.voidEmptyCheck(hotelId, a.id, { expectedUpdatedAt: new Date(check.updatedAt) })), 'CHECK_NOT_EMPTY');
  });

  /* ══════════════════ Düzeltme ══════════════════ */

  it('düzeltme: eşik altı hemen, eşik üstü dört göz; bekleyen düzeltme ödemeyi durdurur; red düşer; indirim öncekinin yerine geçer', async () => {
    await openShift(WAITER);
    const { id } = await openCheck(WAITER);
    await send(WAITER, id, [
      [item.kofte, 4],
      [item.bira, 2],
    ]);
    let check = await reload(id);
    assert.equal(check.totals.grandTotal, '2160.00');
    const kofte = lineOf(check, item.kofte);

    // Garson düzeltme yapamaz (şef garson yetkisi).
    const forbidden = await call('POST', `/pos/checks/${id}/adjustments`, WAITER, { kind: 'COMP', lineId: kofte.id, quantity: 1, reason: 'Müşteri memnuniyeti' });
    assert.equal(forbidden.statusCode, 403);

    // 450 < 1000: hemen uygulanır.
    check = await adjust(MANAGER, id, { kind: 'COMP', lineId: kofte.id, quantity: 1, reason: 'Geç servis' });
    assert.equal(check.totals.grandTotal, '1710.00');
    assert.equal(check.totals.compTotal, '450.00');
    assert.equal(lineOf(check, item.kofte).freeQuantity, 3);

    // 3 × 450 = 1350 ≥ 1000: onaya gider; adet ayrılır, toplam değişmez, ödeme alınmaz.
    check = await adjust(MANAGER, id, { kind: 'VOID', lineId: kofte.id, quantity: 3, waste: true, reason: 'Yanlış masa' });
    const pending = check.adjustments.find((entry) => entry.status === 'PENDING');
    assert.ok(pending.approvalId);
    assert.equal(check.totals.grandTotal, '1710.00');
    assert.equal(lineOf(check, item.kofte).pendingQuantity, 3);
    assert.equal(lineOf(check, item.kofte).freeQuantity, 0);
    await rejectsWith(adjust(MANAGER, id, { kind: 'COMP', lineId: kofte.id, quantity: 1, reason: 'Tekrar' }), 'VALIDATION', /düzeltilecek adedi yok/);
    await rejectsWith(pay(WAITER, id, 'CASH', '100'), 'PENDING_ADJUSTMENT');
    await rejectsWith(as(MANAGER, () => approvals.decideApproval(hotelId, pending.approvalId, 'GRANTED', { note: 'Kendime' })), 'SELF_DECISION');

    // Red: düzeltme düşer, adet serbest kalır; isteyenin ziline haber.
    await deny(pending.approvalId, 'Mutfak hazırladı, iptal değil ikram olmalı');
    check = await reload(id);
    assert.equal(check.adjustments.find((entry) => entry.id === pending.id).status, 'DECLINED');
    assert.equal(lineOf(check, item.kofte).freeQuantity, 3);
    const denied = await db.staffAlert.findFirst({ where: { hotelId, dedupeKey: `approval-decided:${pending.approvalId}` } });
    assert.equal(denied.userId, (await db.user.findFirst({ where: { hotelId, email: MANAGER } })).id);
    assert.match(denied.link, new RegExp(`/pos/adisyon/${id}`));

    // Yeniden: onaylanınca uygulanır (zayi).
    check = await adjust(MANAGER, id, { kind: 'VOID', lineId: kofte.id, quantity: 3, waste: true, reason: 'Yanlış masaya girildi' });
    await grant(check.adjustments.find((entry) => entry.status === 'PENDING').approvalId);
    check = await reload(id);
    assert.equal(lineOf(check, item.kofte).voidedQuantity, 3);
    assert.equal(check.totals.voidTotal, '1350.00');
    assert.equal(check.totals.grandTotal, '360.00');

    // İndirim: yüzde, sonra tutar (öncekinin yerine geçer); bekleyen indirim varken ikincisi istenmez.
    check = await adjust(MANAGER, id, { kind: 'DISCOUNT', discountPct: '10', reason: 'Sadakat kartı' });
    assert.equal(check.totals.discountTotal, '36.00');
    assert.equal(check.totals.grandTotal, '324.00');
    check = await adjust(MANAGER, id, { kind: 'DISCOUNT', discountAmount: '50', reason: 'Yönetici jesti' });
    assert.equal(check.totals.discountTotal, '50.00');
    assert.equal(check.totals.grandTotal, '310.00');
    assert.equal(check.adjustments.filter((entry) => entry.kind === 'DISCOUNT' && !entry.superseded && entry.status === 'APPLIED').length, 1);
    const policy = await setup.getSettings(hotelId);
    await as(MANAGER, () => setup.updateSettings(hotelId, parse('updatePosSettingsSchema', { ...policy, expectedUpdatedAt: policy.updatedAt, adjustmentApprovalAmount: '100' })));
    check = await adjust(MANAGER, id, { kind: 'DISCOUNT', discountPct: '50', reason: 'Büyük indirim' });
    assert.equal(check.pending.adjustments, 1);
    // Bekleyen indirim toplamı değiştirmez; eski indirim yürürlükte.
    assert.equal(check.totals.discountTotal, '50.00');
    await rejectsWith(adjust(MANAGER, id, { kind: 'DISCOUNT', discountPct: '5', reason: 'Bir tane daha' }), 'PENDING_ADJUSTMENT');
    // Onaylanınca yeni indirim eskisinin yerine geçer: 360 × %50 = 180.
    await grant(check.adjustments.find((entry) => entry.status === 'PENDING').approvalId);
    check = await reload(id);
    assert.equal(check.totals.discountPct, '50');
    assert.equal(check.totals.discountTotal, '180.00');
    assert.equal(check.totals.grandTotal, '180.00');
    assert.equal(check.adjustments.filter((entry) => entry.kind === 'DISCOUNT' && entry.status === 'APPLIED' && !entry.superseded).length, 1);
  });

  it('düzeltme: ödemeyi aşacak düzeltme hemen reddedilir; onaylansa da uygulanmaz ve isteyene "uygulanamadı" düşer', async () => {
    await openShift(WAITER);
    const { id } = await openCheck(WAITER);
    await send(WAITER, id, [[item.kofte, 3]]);
    await pay(WAITER, id, 'CASH', '1000');
    let check = await reload(id);
    const kofte = lineOf(check, item.kofte);
    await rejectsWith(adjust(MANAGER, id, { kind: 'COMP', lineId: kofte.id, quantity: 1, reason: 'İkram' }), 'PAID_EXCEEDS_TOTAL', /aşıyor/);
    check = await adjust(MANAGER, id, { kind: 'VOID', lineId: kofte.id, quantity: 3, reason: 'Hepsi iptal' });
    const pending = check.adjustments.find((entry) => entry.status === 'PENDING');
    await grant(pending.approvalId);
    check = await reload(id);
    assert.equal(check.adjustments.find((entry) => entry.id === pending.id).status, 'DECLINED');
    assert.equal(lineOf(check, item.kofte).voidedQuantity, 0);
    assert.equal(check.totals.grandTotal, '1350.00');
    const alert = await db.staffAlert.findFirst({ where: { hotelId, dedupeKey: `approval-decided:${pending.approvalId}` } });
    assert.match(alert.title, /uygulanamadı/);
  });

  /* ══════════════════ Ödeme ══════════════════ */

  it('ödeme: kısmi nakit + kart; fazla tutar; tekrar gönderim; eşzamanlı iki tam ödemede tek kazanan; sürüm ilerlemez; kapanınca masa boşalır', async () => {
    await openShift(WAITER);
    const { id } = await openCheck(WAITER);
    await send(WAITER, id, [
      [item.kofte, 2],
      [item.bira, 2],
    ]);
    const before = await reload(id);
    assert.equal(before.totals.grandTotal, '1260.00');

    const tooMuch = await call('POST', `/pos/checks/${id}/payments`, WAITER, { requestId: randomUUID(), method: 'CASH', amount: '1260.01' });
    assert.equal(tooMuch.statusCode, 422);
    assert.ok(tooMuch.json().fields.amount);
    // Şema hatası 400 (alan alan), iş kuralı hatası 422.
    const noSlip = await call('POST', `/pos/checks/${id}/payments`, WAITER, { requestId: randomUUID(), method: 'CARD', amount: '100' });
    assert.equal(noSlip.statusCode, 400);
    assert.ok(noSlip.json().fields.reference);

    const body = { requestId: randomUUID(), method: 'CASH', amount: '500' };
    const first = await call('POST', `/pos/checks/${id}/payments`, WAITER, body);
    assert.equal(first.statusCode, 201, first.body);
    const again = await call('POST', `/pos/checks/${id}/payments`, WAITER, body);
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().data.created, false);
    assert.equal(await db.posPayment.count({ where: { checkId: id } }), 1);
    let check = await reload(id);
    assert.equal(check.balance, '760.00');
    // Ödeme sürüm damgasını ilerletmez: aynı anda sipariş giren garsonun ekranı bozulmaz.
    assert.equal(check.updatedAt, before.updatedAt);

    const race = await Promise.allSettled([pay(WAITER, id, 'CARD', '760'), pay(WAITER, id, 'CARD', '760')]);
    assert.equal(race.filter((entry) => entry.status === 'fulfilled').length, 1);
    const lost = race.find((entry) => entry.status === 'rejected');
    assert.ok(['NO_BALANCE', 'CHECK_CLOSED'].includes(lost.reason.code), lost.reason.code);
    check = await reload(id);
    assert.equal(check.status, 'CLOSED');
    assert.equal(check.businessDate, today());
    assert.equal(check.balance, '0.00');
    assert.equal(await floorState('1'), 'FREE');
    await rejectsWith(pay(WAITER, id, 'CASH', '1'), 'CHECK_CLOSED');
  });

  it('ödeme: eşik üstü tahsilat onaya gider; bekleyen bakiyeyi tutar; kasada bekleyen; onaylanınca adisyon kapanır', async () => {
    await openShift(WAITER);
    const { id } = await openCheck(WAITER, { covers: 40 });
    // 45 × 450 = 20 250 ≥ 20 000.
    await send(WAITER, id, [[item.kofte, 45]]);
    const { payment } = await pay(WAITER, id, 'CASH', '20250');
    assert.equal(payment.status, 'PENDING');
    let check = await reload(id);
    assert.equal(check.status, 'OPEN');
    assert.equal(check.pending.payments, 1);
    await rejectsWith(pay(WAITER, id, 'CARD', '10'), 'NO_BALANCE', /onay bekleyen/);
    const summary = await as(MANAGER, () => cash.getCashSummary(hotelId, { mine: false }));
    const waiting = summary.pending.items.find((row) => row.id === payment.id);
    assert.equal(waiting.origin, 'POS');
    assert.equal(waiting.pos.number, check.number);
    await grant(payment.approvalId, 'Kasada sayıldı');
    check = await reload(id);
    assert.equal(check.status, 'CLOSED');
    assert.equal(check.paidTotal, '20250.00');
  });

  it('ödeme iptali: kapanmış adisyon önce yeniden açılır; dört göz; ters kayıt asıl vardiyaya; bekleyen iptal kapanışı durdurur; red sonrası adisyon kapanır', async () => {
    const shift = await openShift(WAITER);
    const { id } = await openCheck(WAITER);
    await send(WAITER, id, [[item.kofte, 2]]);
    const { payment } = await pay(WAITER, id, 'CASH', '900');
    assert.equal((await reload(id)).status, 'CLOSED');
    await rejectsWith(as(WAITER, () => payments.requestPaymentVoid(hotelId, id, payment.id, { reason: 'Yanlış tutar' })), 'CHECK_CLOSED');

    const byWaiter = await call('POST', `/pos/checks/${id}/reopen`, WAITER, { reason: 'Ödeme yanlış' });
    assert.equal(byWaiter.statusCode, 403);
    let check = await as(MANAGER, () => checks.reopenCheck(hotelId, id, { reason: 'Ödeme yanlış girildi' }));
    assert.equal(check.status, 'OPEN');
    assert.equal(check.reopenReason, 'Ödeme yanlış girildi');

    check = await as(WAITER, () => payments.requestPaymentVoid(hotelId, id, payment.id, { reason: 'Kart yerine nakit girildi' }));
    assert.equal(check.pending.voids, 1);
    await rejectsWith(as(WAITER, () => payments.requestPaymentVoid(hotelId, id, payment.id, { reason: 'Tekrar' })), 'PAYMENT_RULE');
    await rejectsWith(as(WAITER, () => checks.closeCheck(hotelId, id, { expectedUpdatedAt: new Date(check.updatedAt) })), 'PENDING_APPROVAL');
    const voidApproval = (await db.posPayment.findFirst({ where: { id: payment.id } })).voidApprovalId;
    await grant(voidApproval);
    const reversal = await db.posPayment.findFirst({ where: { reversalOfId: payment.id } });
    assert.equal(reversal.kind, 'REVERSAL');
    assert.equal(String(reversal.amount), '-900');
    assert.equal(reversal.shiftId, shift.id);
    assert.equal(reversal.receivedBy, WAITER);
    check = await reload(id);
    assert.equal(check.status, 'OPEN');
    assert.equal(check.balance, '900.00');
    const { payment: card } = await pay(WAITER, id, 'CARD', '900');
    assert.equal((await reload(id)).status, 'CLOSED');

    // İptal reddedilirse adisyon (bakiyesi sıfır) yeniden kapanır.
    await as(MANAGER, () => checks.reopenCheck(hotelId, id, { reason: 'Slip kontrolü' }));
    await as(WAITER, () => payments.requestPaymentVoid(hotelId, id, card.id, { reason: 'Slip okunmuyor' }));
    await deny((await db.posPayment.findFirst({ where: { id: card.id } })).voidApprovalId, 'Slip bankada görünüyor');
    check = await reload(id);
    assert.equal(check.status, 'CLOSED');
    assert.equal(check.payments.find((row) => row.id === card.id).voidPending, false);
  });

  /* ══════════════════ Odaya yaz ══════════════════ */

  it('odaya yaz: içerideki misafir; folyo kalemleri vergi kategorisi başına ve folyo toplamı birebir; kapalı satış noktası; çıkmış misafir; yuvarlama önerisi', async () => {
    // Yiyecek-içeceğe %5 servis (hariç): odaya yazılan tutar folyoda aynı kalmalı.
    await db.tax.create({ data: { hotelId, name: 'Servis', rate: '5', isIncluded: false, appliesTo: ['FNB'] } });
    cache.cache.invalidatePrefix('settings:');
    const stay = await seedStay();
    const gone = await seedStay({ roomNumber: '102', status: 'CHECKED_OUT', lastName: 'Demir' });
    await openShift(WAITER);

    const found = await as(WAITER, () => payments.inHouseStays(hotelId, { search: '101' }));
    assert.deepEqual(found.stays.map((row) => row.roomNumber), ['101']);
    assert.equal((await as(WAITER, () => payments.inHouseStays(hotelId, { search: 'Demir' }))).stays.length, 0);
    assert.equal((await as(WAITER, () => payments.inHouseStays(hotelId, { search: 'kaya' }))).stays[0].guestName, 'Ayşe Kaya');

    const { id } = await openCheck(WAITER);
    await send(WAITER, id, [
      [item.kofte, 2],
      [item.cikolata, 1],
    ]);
    let check = await reload(id);
    // Yiyecek 900 → 940,91 (servis 40,91); butik 120 → toplam 1060,91.
    assert.equal(check.totals.grandTotal, '1060.91');
    const charge = (input) => as(WAITER, () => payments.chargeToRoom(hotelId, id, parse('posRoomChargeSchema', { requestId: randomUUID(), reservationId: stay.id, ...input })));
    await rejectsWith(charge({ reservationId: gone.id, amount: '100' }), 'VALIDATION', /içeride değil/);
    await rejectsWith(charge({ amount: '1060.92' }), 'VALIDATION', /En fazla/);

    await pay(WAITER, id, 'CASH', '60.91');
    const requestId = randomUUID();
    check = await charge({ requestId, amount: '1000.00' });
    assert.equal(check.status, 'CLOSED');
    assert.equal(check.roomChargeTotal, '1000.00');
    assert.equal(check.roomCharges[0].roomNumber, '101');
    // Tekrar gönderim ikinci kez yazmaz.
    await charge({ requestId, amount: '1000.00' });
    assert.equal(await db.posRoomCharge.count({ where: { checkId: id } }), 1);

    const event = await lastEvent('fnb.order.charged');
    assert.equal(event.payload.reservationId, stay.id);
    assert.equal(event.payload.reference, check.number);
    assert.deepEqual(event.payload.items.map((row) => [row.taxCategory, row.unitPrice]), [
      ['FNB', '848.33'],
      ['OTHER', '113.11'],
    ]);
    // Folyo aktörünün işi (uygulama içinde zaten çalıştıysa tekrar işleme tek yazar): kalemler
    // kendi vergi kategorisiyle; toplam odaya yazılan tutar.
    await as('billing-worker', () => folios.postExternalCharge(hotelId, event.payload, { source: 'FNB_ORDER', eventId: event.id }));
    const posted = await db.folioItem.findMany({ where: { hotelId, sourceKey: { startsWith: `evt:${event.id}:` } }, orderBy: { sourceKey: 'asc' } });
    assert.deepEqual(posted.map((row) => row.taxCategory), ['FNB', 'OTHER']);
    assert.equal(posted.reduce((sum, row) => sum + Math.round(Number(row.total) * 100), 0), 100000);
    check = await reload(id);
    assert.equal(check.roomCharges[0].posting.status, 'POSTED');
    await rejectsWith(as(MANAGER, () => checks.reopenCheck(hotelId, id, { reason: 'Düzeltme' })), 'ROOM_CHARGED');

    // Bar odaya yazmaya kapalı.
    const bar = await openCheck(WAITER, { outletId: outlet.bar.id, tableId: table.B1.id });
    await send(WAITER, bar.id, [[item.bira, 1]]);
    await rejectsWith(
      as(WAITER, () => payments.chargeToRoom(hotelId, bar.id, parse('posRoomChargeSchema', { requestId: randomUUID(), reservationId: stay.id, amount: '50' }))),
      'ROOM_CHARGE_DISABLED',
    );

    // Tek kategori + servis: 100,16 folyoya birebir yazılamaz; en yakın iki tutar önerilir.
    const single = await openCheck(WAITER, { tableId: table['3'].id });
    await send(WAITER, single.id, [[item.kofte, 1]]);
    const unreachable = await call('POST', `/pos/checks/${single.id}/room-charge`, WAITER, { requestId: randomUUID(), reservationId: stay.id, amount: '100.16' });
    assert.equal(unreachable.statusCode, 422);
    assert.match(unreachable.json().error, /100,15 TRY ya da 100,17 TRY/);
    const near = await as(WAITER, () => payments.chargeToRoom(hotelId, single.id, parse('posRoomChargeSchema', { requestId: randomUUID(), reservationId: stay.id, amount: '100.15' })));
    assert.equal(near.roomChargeTotal, '100.15');
  });

  /* ══════════════════ Bölme, taşıma, birleştirme, devir ══════════════════ */

  it('bölme / taşıma / birleştirme / devir: adetler ve toplamlar korunur; ödemeyi aşan bölme ve ödemeli birleştirme yok; devir yetkisi', async () => {
    await openShift(WAITER);
    const source = await openCheck(WAITER);
    await send(WAITER, source.id, [
      [item.kofte, 4],
      [item.bira, 2],
      [item.salata, 1],
    ]);
    let check = await reload(source.id);
    await adjust(MANAGER, source.id, { kind: 'COMP', lineId: lineOf(check, item.bira).id, quantity: 1, reason: 'Hoş geldin' });
    check = await reload(source.id);
    assert.equal(check.totals.grandTotal, '2200.00');

    const moves = [
      { lineId: lineOf(check, item.kofte).id, quantity: 2 },
      { lineId: lineOf(check, item.salata).id, quantity: 1 },
      { lineId: lineOf(check, item.bira).id, quantity: 1 },
    ];
    await rejectsWith(as(WAITER, () => checks.splitCheck(hotelId, source.id, parse('splitPosCheckSchema', { expectedUpdatedAt: source.updatedAt, lines: moves }))), 'STALE_WRITE');
    await assert.rejects(
      as(WAITER, () =>
        checks.splitCheck(hotelId, source.id, parse('splitPosCheckSchema', { expectedUpdatedAt: check.updatedAt, lines: [{ lineId: lineOf(check, item.bira).id, quantity: 2 }] })),
      ),
      (error) => error.code === 'VALIDATION' && /En fazla 1 adet/.test(error.message),
    );
    const split = await as(WAITER, () => checks.splitCheck(hotelId, source.id, parse('splitPosCheckSchema', { expectedUpdatedAt: check.updatedAt, lines: moves })));
    assert.equal(split.target.splitFrom.id, source.id);
    assert.equal(split.target.tableId, table['1'].id);
    assert.equal(split.target.totals.grandTotal, '1300.00');
    // Bölünen kalemler kaynağın turunda kalır; hedef ekranı o turu da gösterir.
    assert.equal(split.target.orders.length, 1);
    assert.ok(split.target.lines.every((line) => split.target.orders.some((order) => order.id === line.orderId)));
    assert.equal(split.source.totals.grandTotal, '900.00');
    // İkramlı bira kaynakta kaldı (adedi 1, ikram 1).
    assert.deepEqual([lineOf(split.source, item.bira).quantity, lineOf(split.source, item.bira).compedQuantity], [1, 1]);

    // Kaynaktan 500 alındı: 1 köfte daha taşınırsa kalan 450 < 500.
    await pay(WAITER, source.id, 'CASH', '500');
    check = await reload(source.id);
    await rejectsWith(
      as(WAITER, () =>
        checks.splitCheck(hotelId, source.id, parse('splitPosCheckSchema', { expectedUpdatedAt: check.updatedAt, lines: [{ lineId: lineOf(check, item.kofte).id, quantity: 1 }] })),
      ),
      'PAID_EXCEEDS_TOTAL',
    );

    // Taşıma: aynı satış noktası içinde.
    let target = await as(WAITER, () => checks.moveCheck(hotelId, split.target.id, parse('movePosCheckSchema', { expectedUpdatedAt: split.target.updatedAt, tableId: table['2'].id })));
    assert.equal(await floorState('2'), 'OCCUPIED');
    await rejectsWith(as(WAITER, () => checks.moveCheck(hotelId, target.id, parse('movePosCheckSchema', { expectedUpdatedAt: target.updatedAt, tableId: table.B1.id }))), 'VALIDATION');

    // Birleştirme: ödemeli kaynak birleşmez; ödemesiz kaynak hedefe katılır, kendisi iptal olur.
    await rejectsWith(
      as(WAITER, () => checks.mergeChecks(hotelId, target.id, parse('mergePosCheckSchema', { expectedUpdatedAt: target.updatedAt, sourceCheckId: source.id }))),
      'CHECK_HAS_PAYMENTS',
    );
    const third = await openCheck(WAITER, { tableId: table['3'].id, covers: 3 });
    await send(WAITER, third.id, [[item.kofte, 1]]);
    target = await as(WAITER, () => checks.mergeChecks(hotelId, target.id, parse('mergePosCheckSchema', { expectedUpdatedAt: target.updatedAt, sourceCheckId: third.id })));
    assert.equal(target.totals.grandTotal, '1750.00');
    assert.equal(target.covers, 4);
    const merged = await reload(third.id);
    assert.equal(merged.status, 'VOID');
    assert.match(merged.note, /Birleştirildi/);
    assert.equal(merged.lines.length, 0);
    // Birleşen adisyonun turu hedefe devam numarasıyla taşındı; yeni tur ondan sonra gelir.
    assert.deepEqual(target.orders.map((order) => order.seq), [1, 2]);
    target = await send(WAITER, target.id, [[item.bira, 1]]);
    assert.deepEqual(target.orders.map((order) => order.seq), [1, 2, 3]);
    assert.ok(target.lines.every((line) => target.orders.some((order) => order.id === line.orderId)));

    // Devir: hedefin açık vardiyası olmalı; başkasının adisyonunu garson devredemez.
    await rejectsWith(as(WAITER, () => checks.transferCheck(hotelId, target.id, parse('transferPosCheckSchema', { expectedUpdatedAt: target.updatedAt, waiterEmail: WAITER2 }), { canSupervise: false })), 'VALIDATION', /açık vardiyası yok/);
    const shift2 = await openShift(WAITER2);
    await rejectsWith(as(WAITER2, () => checks.transferCheck(hotelId, target.id, parse('transferPosCheckSchema', { expectedUpdatedAt: target.updatedAt, waiterEmail: WAITER2 }), { canSupervise: false })), 'FORBIDDEN');
    target = await as(WAITER, () => checks.transferCheck(hotelId, target.id, parse('transferPosCheckSchema', { expectedUpdatedAt: target.updatedAt, waiterEmail: WAITER2 }), { canSupervise: false }));
    assert.equal(target.waiterEmail, WAITER2);
    assert.equal(target.shiftId, shift2.id);
    const back = await call('POST', `/pos/checks/${target.id}/transfer`, MANAGER, { expectedUpdatedAt: target.updatedAt, waiterEmail: WAITER });
    assert.equal(back.statusCode, 200, back.body);
    assert.equal(back.json().data.waiterEmail, WAITER);
  });

  /* ══════════════════ Vardiya, kasa, rapor ══════════════════ */

  it('vardiya kapanışı: açık adisyon ve bekleyen onay engeller; beklenen nakit avans + nakit − iptal; fark uyarısı; rapor; kasa birleşimi; satış raporu', async () => {
    const shift = await openShift(WAITER, '500');
    await openShift(WAITER2, '300');

    // 1: 3 köfte, 1'i zayi iptal (450 < 1000 hemen) → 900 nakit.
    const one = await openCheck(WAITER, { covers: 2 });
    await send(WAITER, one.id, [[item.kofte, 3]]);
    await adjust(MANAGER, one.id, { kind: 'VOID', lineId: lineOf(await reload(one.id), item.kofte).id, quantity: 1, waste: true, reason: 'Yere düştü' });
    await pay(WAITER, one.id, 'CASH', '900');
    // 2: köfte + bira → 630 kart.
    const two = await openCheck(WAITER, { tableId: table['2'].id, covers: 1 });
    await send(WAITER, two.id, [
      [item.kofte, 1],
      [item.bira, 1],
    ]);
    await pay(WAITER, two.id, 'CARD', '630');
    // 3: 2 bira 360 nakit; hatalı giriş iptal edilir, kartla yeniden alınır.
    const three = await openCheck(WAITER, { tableId: table['3'].id, covers: 2 });
    await send(WAITER, three.id, [[item.bira, 2]]);
    const { payment: wrong } = await pay(WAITER, three.id, 'CASH', '360');
    await as(MANAGER, () => checks.reopenCheck(hotelId, three.id, { reason: 'Kartla ödedi' }));
    await as(WAITER, () => payments.requestPaymentVoid(hotelId, three.id, wrong.id, { reason: 'Kartla ödedi, nakit girildi' }));
    await grant((await db.posPayment.findFirst({ where: { id: wrong.id } })).voidApprovalId);
    await pay(WAITER, three.id, 'CARD', '360');
    // 4: açık kalan.
    const four = await openCheck(WAITER, { tableId: table['4'].id });
    await send(WAITER, four.id, [[item.salata, 1]]);

    let current = await as(WAITER, () => shifts.getShift(hotelId, shift.id, { canSeeAll: false }));
    assert.equal(current.cash.expectedCash, '1400.00');
    assert.equal(current.blockers.openChecks, 1);
    const close = (email, countedCash, access = { canSupervise: false }, expectedUpdatedAt = new Date(current.updatedAt)) =>
      as(email, () => shifts.closeShift(hotelId, shift.id, parse('closePosShiftSchema', { expectedUpdatedAt, countedCash, note: 'Gün sonu' }), access));
    await rejectsWith(close(WAITER, '1400'), 'OPEN_CHECKS', /1 açık adisyon/);
    const fourDto = await reload(four.id);
    await as(WAITER, () => checks.transferCheck(hotelId, four.id, parse('transferPosCheckSchema', { expectedUpdatedAt: fourDto.updatedAt, waiterEmail: WAITER2 }), { canSupervise: false }));
    await rejectsWith(close(WAITER2, '1400'), 'FORBIDDEN');
    await rejectsWith(close(WAITER, '1400', { canSupervise: false }, new Date(0)), 'STALE_WRITE');

    const closed = await close(WAITER, '1250');
    assert.equal(closed.shift.status, 'CLOSED');
    assert.equal(closed.shift.expectedCash, '1400.00');
    assert.equal(closed.shift.variance, '-150.00');
    assert.equal(closed.varianceAlert, true);
    const alert = await db.staffAlert.findFirst({ where: { hotelId, dedupeKey: `pos-variance:${shift.id}` } });
    assert.equal(alert.kind, 'POS');
    assert.equal(alert.permission, contracts.PERMISSIONS.POS_SUPERVISE);
    assert.match(alert.title, /Kasa açığı/);

    // Stok iş olayı: kapanan adisyonun satılan / ikram / zayi adetleri (hazırlanmadan iptal düşmez).
    const paid = await db.eventLog.findFirst({ where: { hotelId, name: 'fnb.order.paid', payload: { path: ['checkId'], equals: one.id } } });
    assert.deepEqual(paid.payload.items, [{ menuItemId: item.kofte.id, name: 'Izgara köfte', sold: 2, comped: 0, wasted: 1 }]);
    assert.equal(paid.payload.businessDate, today());
    assert.equal(paid.payload.grandTotal, '900.00');
    // Yeniden açılıp kapanan adisyon yeniden yayınlanır (tüketici son yayını esas alır).
    assert.equal(await db.eventLog.count({ where: { hotelId, name: 'fnb.order.paid', payload: { path: ['checkId'], equals: three.id } } }), 2);

    // Kapanan vardiyayla işlem yapılmaz; vardiyası kapanan adisyon yeniden açılmaz.
    await rejectsWith(openCheck(WAITER), 'NO_SHIFT');
    await rejectsWith(as(MANAGER, () => checks.reopenCheck(hotelId, one.id, { reason: 'Kontrol' })), 'SHIFT_CLOSED');

    const report = await as(WAITER, () => shifts.shiftReport(hotelId, shift.id, { canSeeAll: false }));
    assert.equal(report.sales.checks, 3);
    assert.equal(report.sales.covers, 5);
    assert.equal(report.sales.grandTotal, '1890.00');
    assert.equal(report.sales.voidTotal, '450.00');
    assert.equal(report.sales.wasteTotal, '450.00');
    assert.equal(report.sales.wasteCount, 1);
    const byMethod = Object.fromEntries(report.shift.payments.map((row) => [row.method, row]));
    assert.deepEqual([byMethod.CASH.received, byMethod.CASH.reversed, byMethod.CASH.net], ['1260.00', '-360.00', '900.00']);
    assert.equal(byMethod.CARD.net, '990.00');
    assert.deepEqual(report.topItems[0], { menuItemId: item.kofte.id, name: 'Izgara köfte', quantity: 3, amount: '1350.00' });
    // Başkasının vardiyası: garson göremez, rapor yetkilisi görür.
    await rejectsWith(as(WAITER2, () => shifts.shiftReport(hotelId, shift.id, { canSeeAll: false })), 'FORBIDDEN');
    const viaHttp = await call('GET', `/pos/shifts/${shift.id}/report`, ACCOUNTANT);
    assert.equal(viaHttp.statusCode, 200, viaHttp.body);

    // Vardiya listesi: garson yalnızca kendisininkini; yönetici hepsini (sayfa toplamlarıyla).
    const mine = await as(WAITER, () => shifts.listShifts(hotelId, parse('posShiftListQuerySchema', {}), { canSeeAll: false }));
    assert.equal(mine.items.length, 1);
    const all = await as(MANAGER, () => shifts.listShifts(hotelId, parse('posShiftListQuerySchema', {}), { canSeeAll: true }));
    assert.equal(all.items.length, 2);
    const listed = all.items.find((row) => row.id === shift.id);
    assert.deepEqual([listed.cashNet, listed.cardNet, listed.closedChecks, listed.sales], ['900.00', '990.00', 3, '1890.00']);

    // Kasa: restoran kaynağı; hareketler imleçle eksiksiz.
    const summary = await as(MANAGER, () => cash.getCashSummary(hotelId, { mine: false }));
    assert.equal(summary.origins.POS, '1890.00');
    assert.equal(summary.origins.FOLIO, '0.00');
    const seen = [];
    let cursor;
    do {
      const page = await as(MANAGER, () => cash.listCashMovements(hotelId, { mine: false, limit: 2, origin: 'POS', cursor }));
      seen.push(...page.movements.map((row) => [row.origin, row.kind, row.pos.number]));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.equal(seen.length, 5);
    assert.ok(seen.every((row) => row[0] === 'POS'));
    assert.equal(seen.filter((row) => row[1] === 'REVERSAL').length, 1);
    assert.equal((await as(MANAGER, () => cash.listCashMovements(hotelId, { mine: false, limit: 10, origin: 'EVENT' }))).movements.length, 0);

    // Satış raporu (iş günü; satış noktası; garson; ürün; zayi).
    const sales = await as(ACCOUNTANT, () => reports.salesReport(hotelId, { from: today(), to: today() }));
    assert.equal(sales.totals.checks, 3);
    assert.equal(sales.totals.grandTotal, '1890.00');
    assert.equal(sales.outlets[0].outletName, 'Ana Restoran');
    assert.equal(sales.waiters[0].waiterEmail, WAITER);
    assert.equal(sales.adjustments.waste.value, '450.00');
    assert.equal(sales.days[0].date, today());
    const filtered = await as(ACCOUNTANT, () => reports.salesReport(hotelId, { from: today(), to: today(), outletId: outlet.bar.id }));
    assert.equal(filtered.totals.checks, 0);
    const tooLong = await call('GET', `/pos/reports/sales?from=${D(-40)}&to=${today()}`, ACCOUNTANT);
    assert.equal(tooLong.statusCode, 400);
    assert.ok(tooLong.json().fields.to);
  });

  /* ══════════════════ Zamanlanmış iş ══════════════════ */

  it('zamanlanmış iş: uzun açık vardiya ve unutulmuş adisyon şef garsona bir kez', async () => {
    await openShift(WAITER);
    const check = await openCheck(WAITER);
    await send(WAITER, check.id, [[item.kofte, 1]]);
    const later = new Date(Date.now() + 17 * 3_600_000);
    assert.deepEqual(await jobs.sweepHotel(hotelId, { now: later }), { staleShifts: 1, staleChecks: 1 });
    assert.deepEqual(await jobs.sweepHotel(hotelId, { now: later }), { staleShifts: 0, staleChecks: 0 });
    const alerts = await db.staffAlert.findMany({ where: { hotelId, kind: 'POS' }, orderBy: { dedupeKey: 'asc' } });
    assert.deepEqual(alerts.map((row) => row.dedupeKey.split(':')[0]), ['pos-stale-check', 'pos-stale-shift']);
    assert.ok(alerts.every((row) => row.permission === contracts.PERMISSIONS.POS_SUPERVISE));
    assert.deepEqual(await jobs.sweepHotel(hotelId, { now: new Date() }), { staleShifts: 0, staleChecks: 0 });
  });

  /* ══════════════════ İzinler ve otel kapsamı ══════════════════ */

  it('izinler ve otel kapsamı: rol başına uçlar; başka otelin adisyonu görünmez ve değişmez', async () => {
    assert.equal((await call('GET', '/pos/terminal', DESK)).statusCode, 403);
    assert.equal((await call('GET', '/pos/terminal', WAITER)).statusCode, 200);
    assert.equal((await call('GET', '/pos/settings', WAITER)).statusCode, 403);
    assert.equal((await call('GET', `/pos/reports/sales?from=${today()}&to=${today()}`, WAITER)).statusCode, 403);
    assert.equal((await call('PUT', `/pos/menu/items/${item.bira.id}/sold-out`, WAITER, { soldOut: true })).statusCode, 403);
    assert.equal((await call('GET', '/pos/terminal', ACCOUNTANT)).statusCode, 403);
    assert.equal((await call('GET', '/pos/checks', ACCOUNTANT)).statusCode, 200);
    assert.equal((await call('GET', `/pos/reports/sales?from=${today()}&to=${today()}`, ACCOUNTANT)).statusCode, 200);
    assert.equal((await call('PUT', `/pos/menu/items/${item.bira.id}/sold-out`, MANAGER, { soldOut: true })).statusCode, 200);

    const opened = await call('POST', '/pos/shifts', WAITER, { openingFloat: '250,50' });
    assert.equal(opened.statusCode, 201, opened.body);
    assert.equal(opened.json().data.openingFloat, '250.50');
    const created = await call('POST', '/pos/checks', WAITER, { requestId: randomUUID(), outletId: outlet.rest.id, tableId: table['5'].id, covers: 2 });
    assert.equal(created.statusCode, 201, created.body);
    const checkId = created.json().data.id;
    const bad = await call('POST', `/pos/checks/${checkId}/orders`, WAITER, { requestId: randomUUID(), lines: [{ menuItemId: item.kofte.id, quantity: 0 }] });
    assert.equal(bad.statusCode, 400);

    await rejectsWith(as(MANAGER, () => checks.getCheck(otherHotelId, checkId)), 'NOT_FOUND');
    await rejectsWith(as(MANAGER, () => checks.getFloor(otherHotelId, outlet.rest.id)), 'NOT_FOUND');
    await rejectsWith(send(WAITER, checkId, [[item.kofte, 1]]).then(() => as(WAITER, () => checks.sendOrder(otherHotelId, checkId, parse('sendPosOrderSchema', { requestId: randomUUID(), lines: [{ menuItemId: item.kofte.id, quantity: 1 }] })))), 'NOT_FOUND');
    await rejectsWith(
      as(WAITER, () => payments.receivePayment(otherHotelId, checkId, parse('posPaymentSchema', { requestId: randomUUID(), method: 'CASH', amount: '10' }))),
      'NO_SHIFT',
    );
  });
});
