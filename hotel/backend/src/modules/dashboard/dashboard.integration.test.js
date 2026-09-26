import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';

/**
 * Günlük durum ekranı (modül 13) — gerçek PostgreSQL, gerçek HTTP.
 *
 * Gün sonu cümlesinin kanıtı: müdür sabah tek istekte günü görür — doluluk
 * (satılabilir oda paydasıyla), gelecek / gidecek, dolu / boş / kirli /
 * arızalı oda, bu gecenin oda geliri ve ADR, açık arızalar; haftalık seri
 * oda planının gün özetiyle birebir aynı. Ayrıca izinler, otel kapsamı,
 * önbelleğin değişiklikte tazelenmesi ve girdi doğrulaması.
 *
 * Senaryo (D = otelin bugünü; 10 oda, 109 arızalı, 110 hizmet dışı):
 *
 * | Kayıt | Durum        | Giriş → çıkış | Oda | Gece fiyatı |
 * |-------|--------------|---------------|-----|-------------|
 * | R1    | CONFIRMED    | D → D+2       | 101 | 1000        |
 * | R2    | CHECKED_IN   | D-1 → D+1     | 102 | 1200        |
 * | R3    | CHECKED_IN   | D-2 → D       | 103 | 900         |
 * | R4    | CHECKED_OUT  | D-3 → D+2     | 104 | 800 (erken çıkış bugün) |
 * | R5    | PENDING      | D → D+1       | —   | 1100        |
 * | R6    | CANCELLED    | D → D+1       | 105 | 5000        |
 * | R7    | NO_SHOW      | D → D+1       | 106 | 5000        |
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';

describe('günlük durum ekranı (modül 13, entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let dashboard;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let otherHotelId;
  let roomType;
  /** @type {Record<string, any>} */ let rooms;
  /** @type {Map<string, string>} */ let tokens;
  /** @type {Date} */ let D;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    delete process.env.OPENAI_API_KEY;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    dashboard = await import('./service.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const at = (offset) => core.addDays(D, offset);
  const iso = (offset) => core.toIsoDay(at(offset));

  /** Rezervasyon ve geceleri (fiyatı sabit) doğrudan yazılır: durumlar senaryodaki gibi. */
  async function seedStay(targetHotelId, { status, from, to, room = null, price, extra = {} }) {
    const guest = await db.guest.create({ data: { hotelId: targetHotelId, firstName: 'Misafir', lastName: randomUUID().slice(0, 6) } });
    const nights = core.eachNight(at(from), at(to));
    const reservation = await db.reservation.create({
      data: {
        hotelId: targetHotelId,
        guestId: guest.id,
        roomTypeId: roomType.id,
        roomId: room,
        checkIn: at(from),
        checkOut: at(to),
        status,
        totalPrice: String(price * nights.length),
        confirmationCode: `T-${randomUUID().slice(0, 10)}`,
        ...extra,
      },
    });
    await db.reservationNight.createMany({
      data: nights.map((date) => ({ hotelId: targetHotelId, reservationId: reservation.id, date, amount: String(price) })),
    });
    return reservation;
  }

  beforeEach(async () => {
    await resetDatabase(db);
    (await import('../../lib/cache.js')).cache.clear();
    dashboard.clearDashboardCache();
    (await import('../front-desk/service.js')).clearFrontDeskCache();
    tokens = new Map();
    D = core.calendarDateInTimeZone(ZONE);

    const hotel = await db.hotel.create({ data: { name: 'Durum Otel', code: `DSH-${randomUUID().slice(0, 8)}`, timezone: ZONE, currency: 'TRY' } });
    hotelId = hotel.id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka', code: `OTH-${randomUUID().slice(0, 8)}`, timezone: ZONE } })).id;
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: 'admin@test.local', name: 'Yönetici', role: 'ADMIN', passwordHash },
        { hotelId, email: 'mudur@test.local', name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: 'muhasebe@test.local', name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
        { hotelId, email: 'resepsiyon@test.local', name: 'Resepsiyon', role: 'FRONT_DESK', passwordHash },
      ],
    });
    roomType = await db.roomType.create({
      data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1500', capacityAdults: 2, capacityChildren: 1 },
    });
    rooms = {};
    const states = {
      102: { occupancy: 'OCCUPIED' },
      103: { occupancy: 'OCCUPIED' },
      104: { housekeepingStatus: 'DIRTY' },
      105: { housekeepingStatus: 'DIRTY' },
      106: { housekeepingStatus: 'CLEANING' },
      107: { housekeepingStatus: 'INSPECTED' },
    };
    for (let number = 101; number <= 110; number += 1) {
      rooms[number] = await db.room.create({
        data: { hotelId, number: String(number), roomTypeId: roomType.id, floor: 1, ...(states[number] ?? {}) },
      });
    }
    await db.roomBlock.create({
      data: { hotelId, roomId: rooms[109].id, type: 'OUT_OF_ORDER', startDate: at(-1), endDate: at(2), reason: 'Klima arızası', createdBy: 'test' },
    });
    await db.roomBlock.create({
      data: { hotelId, roomId: rooms[110].id, type: 'OUT_OF_SERVICE', startDate: at(0), endDate: null, reason: 'Boya', createdBy: 'test' },
    });

    const yesterday = new Date(at(-1).getTime() + 12 * 3600 * 1000);
    await seedStay(hotelId, { status: 'CONFIRMED', from: 0, to: 2, room: rooms[101].id, price: 1000 });
    await seedStay(hotelId, { status: 'CHECKED_IN', from: -1, to: 1, room: rooms[102].id, price: 1200, extra: { checkedInAt: yesterday } });
    await seedStay(hotelId, { status: 'CHECKED_IN', from: -2, to: 0, room: rooms[103].id, price: 900, extra: { checkedInAt: at(-2) } });
    await seedStay(hotelId, {
      status: 'CHECKED_OUT',
      from: -3,
      to: 2,
      room: rooms[104].id,
      price: 800,
      extra: { checkedInAt: at(-3), checkedOutAt: new Date() },
    });
    await seedStay(hotelId, { status: 'PENDING', from: 0, to: 1, price: 1100 });
    await seedStay(hotelId, { status: 'CANCELLED', from: 0, to: 1, room: rooms[105].id, price: 5000, extra: { cancelledAt: new Date() } });
    await seedStay(hotelId, { status: 'NO_SHOW', from: 0, to: 1, room: rooms[106].id, price: 5000, extra: { noShowAt: new Date() } });

    // Başka otelin bu geceki satışı sayılmaz.
    const otherType = await db.roomType.create({
      data: { hotelId: otherHotelId, code: 'STD', name: 'Standart', basePrice: '100', capacityAdults: 2 },
    });
    const otherGuest = await db.guest.create({ data: { hotelId: otherHotelId, firstName: 'Başka', lastName: 'Misafir' } });
    const other = await db.reservation.create({
      data: {
        hotelId: otherHotelId,
        guestId: otherGuest.id,
        roomTypeId: otherType.id,
        checkIn: at(0),
        checkOut: at(1),
        status: 'CONFIRMED',
        totalPrice: '99999',
        confirmationCode: `O-${randomUUID().slice(0, 10)}`,
      },
    });
    await db.reservationNight.create({ data: { hotelId: otherHotelId, reservationId: other.id, date: at(0), amount: '99999' } });
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const get = async (url, email = 'mudur@test.local') =>
    app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${await tokenOf(email)}` } });

  it('gün sonu: müdür günü tek istekte görür — doluluk, gelecek / gidecek, oda durumu, gelir, ADR, arızalar', async () => {
    const response = await get('/dashboard/today');
    assert.equal(response.statusCode, 200, response.body);
    const data = response.json().data;

    assert.equal(data.businessDate, iso(0));
    assert.equal(data.currency, 'TRY');
    assert.equal(data.totalRooms, 10);

    // Bu gece: R1 + R2 + R5 (opsiyonlu). R3 bugün çıkıyor, R4 erken çıktı, iptal / gelmedi sayılmaz.
    assert.equal(data.today.sold, 3);
    assert.equal(data.today.sellable, 9, 'arızalı 109 paydadan düşer; hizmet dışı 110 düşmez');
    assert.equal(data.today.outOfOrder, 1);
    assert.equal(data.today.outOfService, 1);
    assert.equal(data.today.occupancyPct, 33);
    assert.equal(data.today.unassigned, 1, 'R5 odası verilmemiş');
    assert.equal(data.today.pendingSold, 1);
    assert.equal(data.today.revenue, '3300.00');
    assert.equal(data.today.adr, '1100.00');
    assert.deepEqual(data.today.otherCurrencies, []);

    // Ön büro: gelecekler R1 + R5 (R5 odasız), gidecek R3; R4 bugün çıktı; içeride R2 + R3.
    assert.deepEqual(data.arrivals, { expected: 2, unassigned: 1, checkedIn: 0 });
    assert.deepEqual(data.departures, { expected: 1, overdue: 0, checkedOut: 1 });
    assert.equal(data.inHouse, 2);

    assert.deepEqual(data.rooms, {
      total: 10,
      occupied: 2,
      vacant: 8,
      vacantReady: 3, // 101, 107, 108 — 109/110 arıza kayıtlı, 104/105 kirli, 106 temizleniyor
      dirty: 2,
      cleaning: 1,
      clean: 6,
      inspected: 1,
    });

    assert.equal(data.faults.total, 2);
    assert.deepEqual(
      data.faults.items.map((item) => [item.roomNumber, item.type, item.reason]),
      [
        ['109', 'OUT_OF_ORDER', 'Klima arızası'],
        ['110', 'OUT_OF_SERVICE', 'Boya'],
      ],
    );
    assert.equal(data.faults.items[1].endDate, null, 'süresiz kayıt');
  });

  it('haftalık seri oda planının gün özetiyle aynı; geçmiş gerçekleşen, gelecek eldeki', async () => {
    const response = await get(`/dashboard/week?from=${iso(-3)}`);
    assert.equal(response.statusCode, 200, response.body);
    const week = response.json().data;
    assert.equal(week.from, iso(-3));
    assert.equal(week.to, iso(3));
    assert.equal(week.days.length, 7);

    const expected = [
      // gün, satılan, gelir — R4 geçmiş gecelerde sayılır, erken çıkıştan sonraki gecelerde sayılmaz
      [iso(-3), 1, '800.00'],
      [iso(-2), 2, '1700.00'],
      [iso(-1), 3, '2900.00'],
      [iso(0), 3, '3300.00'],
      [iso(1), 1, '1000.00'],
      [iso(2), 0, '0.00'],
      [iso(3), 0, '0.00'],
    ];
    assert.deepEqual(
      week.days.map((row) => [row.date, row.sold, row.revenue]),
      expected,
    );
    assert.equal(week.days[2].adr, '966.67');
    assert.equal(week.days[5].adr, null, 'satış olmayan günde ADR yok');

    // Oda planı ekranı aynı günler için aynı doluluğu gösterir.
    const plan = await get(`/plan?from=${iso(-3)}&days=7`, 'admin@test.local');
    assert.equal(plan.statusCode, 200, plan.body);
    const planSummary = plan.json().data.summary;
    assert.deepEqual(
      week.days.map((row) => [row.date, row.sold, row.sellable, row.occupancyPct]),
      planSummary.map((row) => [row.date, row.sold, row.sellable, row.occupancyPct]),
    );

    // Başlangıç verilmezse bugünden.
    const current = (await get('/dashboard/week')).json().data;
    assert.equal(current.from, iso(0));
  });

  it('yeni rezervasyon açılınca bugünün sayıları tazelenir (önbellek bayat kalmaz)', async () => {
    const before = (await get('/dashboard/today')).json().data;
    const created = await app.inject({
      method: 'POST',
      url: '/reservations',
      headers: { authorization: `Bearer ${await tokenOf('resepsiyon@test.local')}` },
      payload: {
        guest: { firstName: 'Yeni', lastName: 'Misafir', phone: '+905321110002' },
        roomTypeId: roomType.id,
        adults: 2,
        boardType: 'BB',
        checkIn: iso(0),
        checkOut: iso(1),
        requestId: randomUUID(),
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const reservationId = created.json().data.reservation.id;
    const night = await db.reservationNight.findFirst({ where: { reservationId, date: at(0) } });

    const after = (await get('/dashboard/today')).json().data;
    assert.equal(after.today.sold, before.today.sold + 1);
    assert.equal(
      core.toDecimal(after.today.revenue).minus(core.toDecimal(before.today.revenue)).toFixed(2),
      core.toDecimal(night.amount).toFixed(2),
    );
    assert.equal(after.arrivals.expected, before.arrivals.expected + 1);
  });

  it('izinler: müdür ve muhasebe görür, resepsiyon görmez, oturumsuz 401', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/dashboard/today' })).statusCode, 401);
    assert.equal((await get('/dashboard/today', 'resepsiyon@test.local')).statusCode, 403);
    assert.equal((await get('/dashboard/week', 'resepsiyon@test.local')).statusCode, 403);
    assert.equal((await get('/dashboard/today', 'muhasebe@test.local')).statusCode, 200);
    assert.equal((await get('/dashboard/today', 'admin@test.local')).statusCode, 200);
  });

  it('girdi doğrulaması: bozuk tarih 400, çok uzak pencere 422', async () => {
    const broken = await get('/dashboard/week?from=bozuk');
    assert.equal(broken.statusCode, 400);
    assert.equal(broken.json().code, 'VALIDATION');
    const far = await get(`/dashboard/week?from=${iso(-400)}`);
    assert.equal(far.statusCode, 422);
    assert.match(far.json().error, /en fazla 366 gün/);
  });
});
