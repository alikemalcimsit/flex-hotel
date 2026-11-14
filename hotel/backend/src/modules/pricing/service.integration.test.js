import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Fiyatlandırma (modül 28) entegrasyon testleri: fiyat planı ve paket yönetimi,
 * çakışma reddi, ve rezervasyon fiyatına etkisi (sezon çarpanının yerine plan,
 * kişi başı ek, paketin sabit gecelik fiyatı).
 */

const ZONE = 'Europe/Istanbul';
const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

describe('Fiyatlandırma servisi (modül 28)', { skip }, () => {
  let db;
  let core;
  let cache;
  let pricing;
  let reservations;
  let resetDatabase;
  let hotelId;
  let types;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    cache = await import('../../lib/cache.js');
    pricing = await import('./service.js');
    reservations = await import('../reservations/service.js');
  });

  after(async () => {
    await db?.$disconnect();
  });

  const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: 'desk@hotel.local' }, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const day = (offset) => core.toIsoDay(core.addDays(today(), offset));

  beforeEach(async () => {
    await resetDatabase(db);
    reservations.clearReservationCache();
    cache.cache.clear();
    const hotel = await db.hotel.create({
      data: { name: 'Fiyat Otel', code: `P${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, phoneCountryCode: '90' },
    });
    hotelId = hotel.id;
    const type = (code, basePrice, capacityAdults = 4, capacityChildren = 2) =>
      db.roomType.create({ data: { hotelId, code, name: `${code} oda`, basePrice, capacityAdults, capacityChildren } });
    types = { std: await type('STD', '1000'), dlx: await type('DLX', '2000') };
    await db.room.create({ data: { hotelId, number: '101', roomTypeId: types.std.id } });
    await db.room.create({ data: { hotelId, number: '102', roomTypeId: types.std.id } });
  });

  const plan = (overrides = {}) => ({
    roomTypeId: types.std.id,
    name: 'Yaz BB',
    boardType: 'BB',
    startDate: new Date(day(5)),
    endDate: new Date(day(40)),
    price: '3000',
    baseOccupancy: 2,
    extraAdultRate: '750',
    childRate: '300',
    minStay: null,
    isActive: true,
    ...overrides,
  });

  const reservationInput = (overrides = {}) => ({
    guestId: null,
    guest: { firstName: 'Ayşe', lastName: 'Yılmaz', phone: '0532 111 00 01', email: 'ayse@example.com', nationality: 'TR' },
    forceNewGuest: false,
    roomTypeId: types.std.id,
    adults: 2,
    children: 0,
    boardType: 'BB',
    checkIn: new Date(day(10)),
    checkOut: new Date(day(12)),
    status: 'CONFIRMED',
    source: 'PHONE',
    notes: null,
    requestId: randomUUID(),
    waitlistId: null,
    roomId: null,
    manualTotal: null,
    priceNote: null,
    packageId: null,
    ...overrides,
  });

  describe('fiyat planı', () => {
    it('plan açılır, listelenir ve sıcak okuma sezon yerine planı verir', async () => {
      const created = await as(() => pricing.createRatePlan(hotelId, plan()));
      assert.equal(created.price, '3000.00');
      assert.equal(created.roomTypeName, 'STD oda');

      const list = await pricing.listRatePlans(hotelId, { page: 1, pageSize: 20 });
      assert.equal(list.items.length, 1);

      const active = await pricing.getActiveRatePlans(hotelId);
      assert.equal(active.length, 1);
      assert.equal(active[0].price, '3000.00');
    });

    it('aynı oda tipi + pansiyon için dönem çakışması reddedilir', async () => {
      await as(() => pricing.createRatePlan(hotelId, plan()));
      await assert.rejects(
        as(() => pricing.createRatePlan(hotelId, plan({ name: 'Çakışan', startDate: new Date(day(30)), endDate: new Date(day(50)) }))),
        /çakış/i,
      );
      // Başka pansiyon çakışmaz.
      const other = await as(() => pricing.createRatePlan(hotelId, plan({ name: 'Yaz HB', boardType: 'HB', price: '3800' })));
      assert.equal(other.boardType, 'HB');
    });

    it('rezervasyon plan fiyatını alır; kişi başı ek yansır; çarpan null', async () => {
      await as(() => pricing.createRatePlan(hotelId, plan()));
      cache.cache.clear();

      // 3 yetişkin + 1 çocuk, 2 gece: her gece 3000 + 1×750 + 1×300 = 4050
      const result = await as(() => reservations.createReservation(hotelId, reservationInput({ adults: 3, children: 1 })));
      assert.equal(result.reservation.totalPrice, '8100.00');
      const nights = await db.reservationNight.findMany({ where: { reservationId: result.reservation.id }, orderBy: { date: 'asc' } });
      assert.equal(Number(nights[0].amount), 4050);
      assert.equal(nights[0].multiplier, null);
      assert.equal(Number(nights[0].baseRate), 3000);
    });

    it('plan yoksa sezon çarpanı geçerli kalır (geriye uyum)', async () => {
      await db.season.create({ data: { hotelId, name: 'Yaz', startDate: new Date(day(5)), endDate: new Date(day(40)), multiplier: '1.5' } });
      cache.cache.clear();
      const result = await as(() => reservations.createReservation(hotelId, reservationInput()));
      // Taban 1000 × 1.5 × 2 gece = 3000
      assert.equal(result.reservation.totalPrice, '3000.00');
    });
  });

  describe('paket', () => {
    const pkg = (overrides = {}) => ({
      code: 'BALAYI',
      name: 'Balayı Paketi',
      description: 'Oda + SPA + şampanya',
      boardType: 'HB',
      nightlyPrice: '5000',
      components: [{ label: 'SPA', note: 'çift masaj' }, { label: 'Şampanya' }],
      isActive: true,
      ...overrides,
    });

    it('paket açılır ve yayındaki paketler seçicide döner', async () => {
      const created = await as(() => pricing.createPackage(hotelId, pkg()));
      assert.equal(created.nightlyPrice, '5000.00');
      assert.equal(created.components.length, 2);

      const active = await pricing.getActivePackages(hotelId);
      assert.equal(active.length, 1);
      assert.equal(active[0].boardType, 'HB');
    });

    it('rezervasyona paket seçilince pansiyon paketten gelir ve fiyat sabit gecelik olur', async () => {
      const created = await as(() => pricing.createPackage(hotelId, pkg()));
      cache.cache.clear();

      const result = await as(() =>
        reservations.createReservation(hotelId, reservationInput({ packageId: created.id, boardType: 'BB' })),
      );
      // 2 gece × 5000 = 10000; pansiyon paketten (HB).
      assert.equal(result.reservation.totalPrice, '10000.00');
      assert.equal(result.reservation.boardType, 'HB');
      assert.equal(result.reservation.package?.id, created.id);
      const nights = await db.reservationNight.findMany({ where: { reservationId: result.reservation.id } });
      assert.equal(Number(nights[0].amount), 5000);
      assert.equal(nights[0].seasonName, 'Balayı Paketi');
    });

    it('pasif paket rezervasyona seçilemez', async () => {
      const created = await as(() => pricing.createPackage(hotelId, pkg()));
      await as(() => pricing.deletePackage(hotelId, created.id));
      cache.cache.clear();
      await assert.rejects(
        as(() => reservations.createReservation(hotelId, reservationInput({ packageId: created.id }))),
        /paket/i,
      );
    });
  });
});
