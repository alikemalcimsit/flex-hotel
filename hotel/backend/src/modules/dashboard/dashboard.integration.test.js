import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';

/**
 * Günlük durum ekranı (modül 13) — gerçek PostgreSQL, gerçek HTTP.
 *
 * Gün sonu cümlesinin kanıtı: müdür sabah tek istekte günü görür — doluluk
 * (satılabilir oda paydasıyla, dünle kıyaslı), kalan satılabilir oda, gelecek
 * (dünden kalanlar dahil) / gidecek, dolu / boş / kirli / arızalı oda, bu
 * gecenin **vergiler hariç** oda geliri, ADR ve RevPAR, oda tipine göre
 * kırılım, konaklayan misafirler, açık arızalar; haftalık seri oda planının gün
 * özetiyle birebir aynı. Ayrıca fazla satış, izinler, otel kapsamı, önbelleğin
 * değişiklikte tazelenmesi ve girdi doğrulaması.
 *
 * Senaryo (D = otelin bugünü; 10 oda, 109 arızalı, 110 hizmet dışı; oda
 * fiyatına KDV %10 + konaklama vergisi %2 dahil):
 *
 * | Kayıt | Durum        | Giriş → çıkış | Oda | Gece fiyatı | Kişi / pansiyon |
 * |-------|--------------|---------------|-----|-------------|-----------------|
 * | R1    | CONFIRMED    | D → D+2       | 101 | 1000        | 2+1 HB          |
 * | R2    | CHECKED_IN   | D-1 → D+1     | 102 | 1200        | 2 BB            |
 * | R3    | CHECKED_IN   | D-2 → D       | 103 | 900         | 1 BB            |
 * | R4    | CHECKED_OUT  | D-3 → D+2     | 104 | 800 (erken çıkış bugün) | 1 BB |
 * | R5    | PENDING      | D → D+1       | —   | 1100        | 1 BB            |
 * | R6    | CANCELLED    | D → D+1       | 105 | 5000        |                 |
 * | R7    | NO_SHOW      | D → D+1       | 106 | 5000        |                 |
 * | R8    | CONFIRMED    | D-1 → D+1     | —   | 700 (dün gelmedi) | 2 AI      |
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
  async function seedStay(targetHotelId, { status, from, to, room = null, price, typeId = roomType.id, extra = {} }) {
    const guest = await db.guest.create({ data: { hotelId: targetHotelId, firstName: 'Misafir', lastName: randomUUID().slice(0, 6) } });
    const nights = core.eachNight(at(from), at(to));
    const reservation = await db.reservation.create({
      data: {
        hotelId: targetHotelId,
        guestId: guest.id,
        roomTypeId: typeId,
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
    // Oda fiyatına dahil KDV %10 + konaklama vergisi %2 → net = brüt / 1,12.
    // Hariç vergi fiyatın içinde değil, oda dışı vergi odayı ilgilendirmez: ikisi de sayılmaz.
    await db.tax.createMany({
      data: [
        { hotelId, name: 'KDV', rate: '10', isIncluded: true, appliesTo: ['ROOM', 'FNB'] },
        { hotelId, name: 'Konaklama vergisi', rate: '2', isIncluded: true, appliesTo: ['ROOM'] },
        { hotelId, name: 'Servis', rate: '5', isIncluded: false, appliesTo: ['ROOM'] },
        { hotelId, name: 'Alkol ÖTV', rate: '20', isIncluded: true, appliesTo: ['FNB'] },
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
    await seedStay(hotelId, { status: 'CONFIRMED', from: 0, to: 2, room: rooms[101].id, price: 1000, extra: { adults: 2, children: 1, boardType: 'HB' } });
    await seedStay(hotelId, {
      status: 'CHECKED_IN',
      from: -1,
      to: 1,
      room: rooms[102].id,
      price: 1200,
      extra: { checkedInAt: yesterday, adults: 2, boardType: 'BB' },
    });
    await seedStay(hotelId, { status: 'CHECKED_IN', from: -2, to: 0, room: rooms[103].id, price: 900, extra: { checkedInAt: at(-2) } });
    await seedStay(hotelId, {
      status: 'CHECKED_OUT',
      from: -3,
      to: 2,
      room: rooms[104].id,
      price: 800,
      extra: { checkedInAt: at(-3), checkedOutAt: new Date() },
    });
    await seedStay(hotelId, { status: 'PENDING', from: 0, to: 1, price: 1100, extra: { adults: 1, boardType: 'BB' } });
    await seedStay(hotelId, { status: 'CANCELLED', from: 0, to: 1, room: rooms[105].id, price: 5000, extra: { cancelledAt: new Date() } });
    await seedStay(hotelId, { status: 'NO_SHOW', from: 0, to: 1, room: rooms[106].id, price: 5000, extra: { noShowAt: new Date() } });
    await seedStay(hotelId, { status: 'CONFIRMED', from: -1, to: 1, price: 700, extra: { adults: 2, boardType: 'AI' } });

    // Başka otelin bu geceki satışı sayılmaz.
    const otherType = await db.roomType.create({
      data: { hotelId: otherHotelId, code: 'STD', name: 'Standart', basePrice: '100', capacityAdults: 2 },
    });
    await seedStay(otherHotelId, { status: 'CONFIRMED', from: 0, to: 1, price: 99999, typeId: otherType.id, extra: { adults: 2 } });
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

  it('gün sonu: müdür günü tek istekte görür — doluluk, gelen / giden, oda durumu, net gelir, ADR, RevPAR, misafirler', async () => {
    const response = await get('/dashboard/today');
    assert.equal(response.statusCode, 200, response.body);
    const data = response.json().data;

    assert.equal(data.businessDate, iso(0));
    assert.equal(data.currency, 'TRY');
    assert.equal(data.totalRooms, 10);
    assert.equal(data.includedTaxRate, '12', 'oda fiyatındaki dahil vergiler: KDV + konaklama');

    // Bu gece: R1 + R2 + R5 (opsiyonlu) + R8 (dünden). R3 bugün çıkıyor, R4 erken çıktı, iptal / gelmedi sayılmaz.
    const today = data.today;
    assert.equal(today.sold, 4);
    assert.equal(today.sellable, 9, 'arızalı 109 paydadan düşer; hizmet dışı 110 düşmez');
    assert.equal(today.available, 5);
    assert.equal(today.outOfOrder, 1);
    assert.equal(today.outOfService, 1);
    assert.equal(today.occupancyPct, 44);
    assert.equal(today.unassigned, 2, 'R5 ve R8 odasız');
    assert.equal(today.pendingSold, 1);
    assert.equal(today.grossRevenue, '4000.00');
    assert.equal(today.revenue, '3571.43', '4000 / 1,12 — vergiler hariç');
    assert.equal(today.pendingRevenue, '982.14', 'R5: 1100 / 1,12');
    assert.equal(today.adr, '892.86');
    assert.equal(today.revpar, '396.83', 'net gelir / 9 satılabilir oda');
    assert.deepEqual(today.otherCurrencies, []);

    // Dün gece (gerçekleşen): R2 + R3 + R4 (çıkmadan önceki gece) + R8 (gelmese de onaylı).
    assert.equal(data.yesterday.date, iso(-1));
    assert.equal(data.yesterday.sold, 4);
    assert.equal(data.yesterday.grossRevenue, '3600.00');
    assert.equal(data.yesterday.revenue, '3214.29');

    // Ön büro: gelecekler R1 + R5 + R8 (R8 dünden kalma), gidecek R3; R4 bugün çıktı; içeride R2 + R3.
    assert.deepEqual(data.arrivals, { expected: 3, unassigned: 2, checkedIn: 0, late: 1 });
    assert.deepEqual(data.departures, { expected: 1, overdue: 0, checkedOut: 1 });
    assert.equal(data.inHouse, 2);

    assert.deepEqual(data.guests, {
      stays: 4,
      adults: 7,
      children: 1,
      guests: 8,
      byBoard: [
        { boardType: 'BB', stays: 2, adults: 3, children: 0, guests: 3 },
        { boardType: 'HB', stays: 1, adults: 2, children: 1, guests: 3 },
        { boardType: 'AI', stays: 1, adults: 2, children: 0, guests: 2 },
      ],
    });

    assert.deepEqual(data.rooms, {
      total: 10,
      occupied: 2,
      vacant: 8,
      vacantReady: 3, // 101, 107, 108 — 109/110 arıza kayıtlı, 104/105 kirli, 106 temizleniyor
      vacantReadyFree: 2, // 101 bu gece R1'e atanmış: odasız gelene verilemez
      dirty: 2,
      cleaning: 1,
      clean: 6,
      inspected: 1,
    });

    assert.deepEqual(
      data.roomTypes.map((row) => [row.code, row.sold, row.sellable, row.available, row.occupancyPct]),
      [['STD', 4, 9, 5, 44]],
      'oda tipine göre kırılım otelin toplamıyla tutarlı',
    );

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
    assert.equal(week.includedTaxRate, '12');

    const expected = [
      // gün, satılan, brüt gelir — R4 geçmiş gecelerde sayılır, erken çıkıştan sonraki gecelerde sayılmaz
      [iso(-3), 1, '800.00'],
      [iso(-2), 2, '1700.00'],
      [iso(-1), 4, '3600.00'],
      [iso(0), 4, '4000.00'],
      [iso(1), 1, '1000.00'],
      [iso(2), 0, '0.00'],
      [iso(3), 0, '0.00'],
    ];
    assert.deepEqual(
      week.days.map((row) => [row.date, row.sold, row.grossRevenue]),
      expected,
    );
    assert.equal(week.days[2].revenue, '3214.29');
    assert.equal(week.days[2].adr, '803.57');
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

  it('fazla satış gizlenmez: doluluk %100’ü geçer, kalan oda eksiye düşer', async () => {
    for (let index = 0; index < 7; index += 1) {
      await seedStay(hotelId, { status: 'CONFIRMED', from: 0, to: 1, price: 1000 });
    }
    const data = (await get('/dashboard/today')).json().data;
    assert.equal(data.today.sold, 11);
    assert.equal(data.today.sellable, 9);
    assert.equal(data.today.occupancyPct, 122);
    assert.equal(data.today.available, -2);
    assert.equal(data.roomTypes[0].available, -2, 'müsaitlik ekranıyla aynı');
    const week = (await get(`/dashboard/week?from=${iso(0)}`)).json().data;
    assert.equal(week.days[0].occupancyPct, 122);
  });

  it('saat taşıyan tarihler gün düzeyinde sayılır (demo verisi 11:00): bugün gelen içeride, bugün giden dışarıda', async () => {
    const before = (await get('/dashboard/today')).json().data;
    const elevenAm = (offset) => new Date(at(offset).getTime() + 11 * 3600 * 1000);
    // Bugün 11:00'de gelecek, oda 108'e atanmış.
    await seedStay(hotelId, {
      status: 'CONFIRMED',
      from: 0,
      to: 1,
      room: rooms[108].id,
      price: 1000,
      extra: { checkIn: elevenAm(0), checkOut: elevenAm(1), adults: 2 },
    });
    // Bugün 11:00'de çıkacak, içeride.
    await seedStay(hotelId, {
      status: 'CHECKED_IN',
      from: -1,
      to: 0,
      room: rooms[105].id,
      price: 1000,
      extra: { checkIn: elevenAm(-1), checkOut: elevenAm(0), checkedInAt: elevenAm(-1) },
    });
    dashboard.clearDashboardCache();
    (await import('../front-desk/service.js')).clearFrontDeskCache();

    const after = (await get('/dashboard/today')).json().data;
    assert.equal(after.today.sold, before.today.sold + 1, 'yalnızca bugün gelen bu gece satılmış');
    assert.equal(after.guests.stays, before.guests.stays + 1);
    assert.equal(after.guests.adults, before.guests.adults + 2);
    assert.equal(after.arrivals.expected, before.arrivals.expected + 1, 'bugün 11:00 gelen, gelecekler listesinde');
    assert.equal(after.departures.expected, before.departures.expected + 1, 'bugün 11:00 çıkan, gidecekler listesinde');
    assert.equal(after.arrivals.late, before.arrivals.late, 'bugün gelen gecikmiş sayılmaz');
    assert.equal(after.rooms.vacantReadyFree, before.rooms.vacantReadyFree - 1, '108 bu gece verilmiş');

    // Ön büro listeleri de aynı kayıtları gösterir (kartın bağlandığı ekran).
    const arrivals = (await get('/front-desk/arrivals?view=EXPECTED&pageSize=50', 'admin@test.local')).json().data;
    assert.equal(arrivals.meta.total, after.arrivals.expected);
    const departures = (await get('/front-desk/departures?view=EXPECTED&pageSize=50', 'admin@test.local')).json().data;
    assert.equal(departures.meta.total, after.departures.expected);
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
      core.toDecimal(after.today.grossRevenue).minus(core.toDecimal(before.today.grossRevenue)).toFixed(2),
      core.toDecimal(night.amount).toFixed(2),
    );
    assert.equal(after.arrivals.expected, before.arrivals.expected + 1);
    assert.equal(after.guests.adults, before.guests.adults + 2);
  });

  it('vergi ayarı değişince gelir yeniden hesaplanır (ayar ekranından; önbellek olayla tazelenir)', async () => {
    assert.equal((await get('/dashboard/today')).json().data.today.revenue, '3571.43');
    const tax = await db.tax.findFirst({ where: { hotelId, name: 'Konaklama vergisi' } });
    const response = await app.inject({
      method: 'PUT',
      url: `/settings/taxes/${tax.id}`,
      headers: { authorization: `Bearer ${await tokenOf('admin@test.local')}` },
      payload: { name: tax.name, rate: '2', isIncluded: false, appliesTo: ['ROOM'], expectedUpdatedAt: tax.updatedAt.toISOString() },
    });
    assert.equal(response.statusCode, 200, response.body);
    const data = (await get('/dashboard/today')).json().data;
    assert.equal(data.includedTaxRate, '10', 'konaklama vergisi artık fiyatın içinde değil');
    assert.equal(data.today.revenue, '3636.36', '4000 / 1,10');
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
