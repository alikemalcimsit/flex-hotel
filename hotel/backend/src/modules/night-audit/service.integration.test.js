import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Gün kapanış (night audit, modül 18) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: kapanışın gelmeyenleri düşmesi, o gecenin oda ücretini basması,
 * günlük özeti (doluluk / ADR / RevPAR / tahsilat) yazması, kasa farkını
 * raporlaması, iş gününü ilerletmesi (getBusinessDate), olay yayınlaması ve
 * aynı günün iki kez kapatılamaması.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const DESK = 'resepsiyon@test.local';

describe('gün kapanış (entegrasyon)', { skip }, () => {
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let nightAudit;
  /** @type {any} */ let businessDate;
  /** @type {any} */ let reservations;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  /** @type {any} */ let std;
  /** @type {Record<string, any>} */ let room;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    nightAudit = await import('./service.js');
    businessDate = await import('../../lib/business-date.js');
    reservations = await import('../reservations/service.js');
    cache = await import('../../lib/cache.js');
  });

  after(async () => {
    await db?.$disconnect();
  });

  const as = (actor, fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const day = (offset) => core.toIsoDay(core.addDays(today(), offset));
  const at = (time, offset = 0) => new Date(`${day(offset)}T${time}:00.000Z`);
  const eventsNamed = (name) => db.eventLog.findMany({ where: { hotelId, name }, orderBy: { occurredAt: 'asc' }, select: { payload: true } });

  beforeEach(async () => {
    await resetDatabase(db);
    reservations.clearReservationCache();
    cache.cache.invalidatePrefix('settings:');
    cache.cache.invalidatePrefix('business-date:');
    const hotel = await db.hotel.create({
      data: { name: 'Gece Otel', code: `N${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, checkInTime: '14:00', checkOutTime: '12:00' },
    });
    hotelId = hotel.id;
    await db.user.create({ data: { hotelId, email: DESK, name: 'Resepsiyon', passwordHash: 'x', role: 'FRONT_DESK' } });
    std = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 3, capacityChildren: 1 } });
    room = {};
    for (const number of ['101', '102', '103']) {
      room[number] = await db.room.create({ data: { hotelId, number, roomTypeId: std.id } });
    }
  });

  /** İçerideki konaklama (giriş `checkIn` gün önce, geceleri `nightly`). */
  async function seedInHouse({ checkIn = -1, checkOut = 1, roomNumber = '101', nightly = '1000.00' } = {}) {
    const guest = await db.guest.create({ data: { hotelId, firstName: 'Mehmet', lastName: 'Kaya', idType: 'NATIONAL_ID', idNumber: '10000000146', nationality: 'TR' } });
    const stay = await db.reservation.create({
      data: {
        hotelId, guestId: guest.id, roomTypeId: std.id, roomId: room[roomNumber].id,
        checkIn: new Date(day(checkIn)), checkOut: new Date(day(checkOut)), status: 'CHECKED_IN',
        checkedInAt: at('15:00', checkIn), checkedInBy: DESK, confirmedAt: new Date(),
        totalPrice: core.toMoneyString(core.toDecimal(nightly).times(checkOut - checkIn)),
        confirmationCode: `H${randomUUID().slice(0, 7).toUpperCase()}`,
      },
    });
    await db.reservationNight.createMany({ data: core.eachNight(stay.checkIn, stay.checkOut).map((date) => ({ hotelId, reservationId: stay.id, date, amount: nightly })) });
    return stay;
  }

  /** Gelmeyen adayı: girişi bugün, onaylı, giriş yapılmamış. */
  async function seedNoShow({ roomNumber = '102', nightly = '1000.00' } = {}) {
    const guest = await db.guest.create({ data: { hotelId, firstName: 'Ayşe', lastName: 'Demir', idType: 'NATIONAL_ID', idNumber: '10000000278', nationality: 'TR' } });
    const stay = await db.reservation.create({
      data: {
        hotelId, guestId: guest.id, roomTypeId: std.id, roomId: room[roomNumber].id,
        checkIn: new Date(day(0)), checkOut: new Date(day(2)), status: 'CONFIRMED', confirmedAt: new Date(),
        totalPrice: core.toMoneyString(core.toDecimal(nightly).times(2)),
        confirmationCode: `H${randomUUID().slice(0, 7).toUpperCase()}`,
      },
    });
    await db.reservationNight.createMany({ data: core.eachNight(stay.checkIn, stay.checkOut).map((date) => ({ hotelId, reservationId: stay.id, date, amount: nightly })) });
    return stay;
  }

  it('iş günü başta takvim günü (hiç kapanış yok)', async () => {
    assert.equal(core.toIsoDay(await businessDate.getBusinessDate(hotelId)), day(0));
  });

  it('kapanış: gelmeyeni düşer, oda ücretini basar, özeti yazar, günü ilerletir, olay yayınlar', async () => {
    const inHouse = await seedInHouse({ checkIn: -1, checkOut: 1, roomNumber: '101' });
    const noShow = await seedNoShow({ roomNumber: '102' });

    const status = await nightAudit.getAuditStatus(hotelId);
    assert.equal(status.businessDay, day(0));
    assert.equal(status.status, 'OPEN');
    assert.equal(status.noShows.length, 1);
    assert.equal(status.inHouse, 1);

    const result = await as(DESK, () => nightAudit.closeDay(hotelId, { counts: [{ method: 'CASH', counted: '0.00' }], note: 'Devir tamam' }));

    // Gelmeyen düştü.
    const nsRow = await db.reservation.findUnique({ where: { id: noShow.id } });
    assert.equal(nsRow.status, 'NO_SHOW');

    // O gecenin (day0) oda ücreti içerideki konaklamaya işlendi.
    const items = await db.folioItem.findMany({ where: { reservationId: inHouse.id, source: 'ROOM_NIGHT' } });
    assert.ok(items.some((i) => core.toIsoDay(i.serviceDate) === day(0)), 'bu gecenin oda ücreti işlenmeli');

    // Günlük özet.
    assert.equal(result.stats.roomsSellable, 3);
    assert.equal(result.stats.roomsSold, 1);
    assert.equal(result.stats.occupancyPct, '33.33');
    assert.equal(result.stats.roomRevenue, '1000.00');
    assert.equal(result.stats.adr, '1000.00');
    assert.equal(result.stats.revpar, '333.33');
    assert.equal(result.noShowCount, 1);

    // Kasa: beklenen 0, sayılan 0, fark 0.
    assert.equal(result.shift.variance, '0.00');

    // İş günü ilerledi.
    assert.equal(core.toIsoDay(await businessDate.getBusinessDate(hotelId)), day(1));

    // Olay yayınlandı.
    const closed = await eventsNamed('night.audit.closed');
    assert.equal(closed.length, 1);
    assert.equal(closed[0].payload.businessDay, day(0));
    assert.equal(closed[0].payload.noShows, 1);
  });

  it('kapandıktan sonra tekrar kapatılamaz (gün gelmeden ileriye gidilemez)', async () => {
    await seedInHouse({ roomNumber: '101' });
    await as(DESK, () => nightAudit.closeDay(hotelId, { counts: [] }));
    // İlk kapanıştan sonra iş günü = yarın; takvim bugünde olduğu için kapatılamaz.
    await assert.rejects(
      as(DESK, () => nightAudit.closeDay(hotelId, { counts: [] })),
      (error) => error.code === 'DAY_NOT_ARRIVED' || error.code === 'ALREADY_CLOSED',
    );
  });

  it('kasa farkı: sayılan beklenenden fazlaysa artı', async () => {
    await seedInHouse({ roomNumber: '101' });
    const result = await as(DESK, () => nightAudit.closeDay(hotelId, { counts: [{ method: 'CASH', counted: '250.00' }] }));
    const cash = result.shift.counts.find((row) => row.method === 'CASH');
    assert.equal(cash.variance, '250.00');
    assert.equal(result.shift.countedTotal, '250.00');
  });

  it('startNightAudit IN_PROGRESS işaretler ve night.audit.started yayınlar', async () => {
    await seedInHouse({ roomNumber: '101' });
    const status = await as(DESK, () => nightAudit.startNightAudit(hotelId));
    assert.equal(status.status, 'IN_PROGRESS');
    assert.equal((await eventsNamed('night.audit.started')).length, 1);
    // Başlatmak günü ilerletmez.
    assert.equal(core.toIsoDay(await businessDate.getBusinessDate(hotelId)), day(0));
  });
});
