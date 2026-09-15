import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Oda planı entegrasyon testleri — gerçek PostgreSQL gerektirir.
 *
 * Buradaki iddialar ızgaranın gerçek veriyle tuttuğunu ve oda değişikliğinin
 * yan etkilerinin (eski oda kirli, yeni oda dolu) aynı transaction'da
 * gerçekleştiğini doğruluyor. Yarım kalmış bir taşıma, misafirin iki odada
 * görünmesi demektir.
 *
 * Çalıştırmak için:
 *   TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const HOTEL_TIME_ZONE = 'Europe/Istanbul';

describe('oda planı servisi (entegrasyon)', { skip }, () => {
  /** @type {any} */ let prismaUnfiltered;
  /** @type {any} */ let plan;
  /** @type {any} */ let rooms;
  /** @type {any} */ let core;
  let hotelId;
  let stdTypeId;
  let dlxTypeId;
  let room;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    const db = await import('../../db.js');
    prismaUnfiltered = db.prismaUnfiltered;
    plan = await import('./service.js');
    rooms = await import('../rooms/service.js');
    core = await import('@hotelos/core');
  });

  after(async () => {
    await prismaUnfiltered?.$disconnect();
  });

  beforeEach(async () => {
    await prismaUnfiltered.auditLog.deleteMany({});
    await prismaUnfiltered.eventLog.deleteMany({});
    await prismaUnfiltered.folioItem.deleteMany({});
    await prismaUnfiltered.folio.deleteMany({});
    await prismaUnfiltered.reservation.deleteMany({});
    await prismaUnfiltered.roomBlock.deleteMany({});
    await prismaUnfiltered.room.deleteMany({});
    await prismaUnfiltered.roomType.deleteMany({});
    await prismaUnfiltered.guest.deleteMany({});
    await prismaUnfiltered.season.deleteMany({});
    await prismaUnfiltered.tax.deleteMany({});
    await prismaUnfiltered.hotel.deleteMany({});

    const hotel = await prismaUnfiltered.hotel.create({
      data: { name: 'Plan Test Otel', code: `PLAN-${randomUUID().slice(0, 8)}` },
    });
    hotelId = hotel.id;

    const std = await prismaUnfiltered.roomType.create({
      data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 2, capacityChildren: 1 },
    });
    const dlx = await prismaUnfiltered.roomType.create({
      data: { hotelId, code: 'DLX', name: 'Deluxe', basePrice: '2000', capacityAdults: 1, capacityChildren: 0 },
    });
    stdTypeId = std.id;
    dlxTypeId = dlx.id;

    room = {};
    for (const [number, typeId, floor] of [
      ['101', std.id, 1],
      ['102', std.id, 1],
      ['103', std.id, 1],
      ['201', dlx.id, 2],
    ]) {
      room[number] = await prismaUnfiltered.room.create({ data: { hotelId, number, roomTypeId: typeId, floor } });
    }
  });

  const asUser = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: 'test@hotel.local' }, fn);

  /** Otelin bugününden `offset` gün sonrası (UTC gün başı). */
  const dayDate = (offset) => core.addDays(core.calendarDateInTimeZone(HOTEL_TIME_ZONE), offset);
  const day = (offset) => core.toIsoDay(dayDate(offset));

  async function seedReservation({
    roomTypeId = stdTypeId,
    roomId = null,
    checkIn = 1,
    checkOut = 4,
    status = 'CONFIRMED',
    adults = 2,
    children = 0,
    guestName = ['Test', 'Misafir'],
  } = {}) {
    const guest = await prismaUnfiltered.guest.create({
      data: { hotelId, firstName: guestName[0], lastName: guestName[1] },
    });
    return prismaUnfiltered.reservation.create({
      data: {
        hotelId,
        guestId: guest.id,
        roomTypeId,
        roomId,
        checkIn: new Date(`${day(checkIn)}T14:00:00.000Z`),
        checkOut: new Date(`${day(checkOut)}T12:00:00.000Z`),
        status,
        adults,
        children,
        totalPrice: '3000',
        confirmationCode: `P-${randomUUID().slice(0, 8)}`,
      },
    });
  }

  const loadPlan = (overrides = {}) =>
    plan.getRoomPlan(hotelId, { from: dayDate(0), days: 7, page: 1, pageSize: 40, ...overrides });

  const roomRow = (number) => prismaUnfiltered.room.findUnique({ where: { id: room[number].id } });
  const rowOf = (result, number) => result.items.find((entry) => entry.number === number);

  describe('ızgara verisi', () => {
    it('pencereyi gece gece verir ve bugünü işaretler', async () => {
      const result = await loadPlan({ days: 3 });

      assert.deepEqual(result.window.dates, [day(0), day(1), day(2)]);
      assert.equal(result.window.today, day(0));
      assert.equal(result.summary.length, 3);
    });

    it('rezervasyonu odasının satırına, doğru sütuna koyar', async () => {
      await seedReservation({ roomId: room['102'].id, checkIn: 1, checkOut: 3 });
      const result = await loadPlan();

      const bar = rowOf(result, '102').reservations[0];
      assert.equal(bar.startIndex, 1);
      assert.equal(bar.span, 2, 'çıkış günü boyanmaz');
      assert.equal(bar.nights, 2);
      assert.equal(bar.guestName, 'Test Misafir');
      assert.equal(rowOf(result, '101').reservations.length, 0);
    });

    it('pencereden taşan konaklamayı kırpar ve işaretler', async () => {
      await seedReservation({ roomId: room['101'].id, checkIn: -3, checkOut: 12 });
      const bar = rowOf(await loadPlan(), '101').reservations[0];

      assert.equal(bar.startIndex, 0);
      assert.equal(bar.span, 7);
      assert.equal(bar.continuesBefore, true);
      assert.equal(bar.continuesAfter, true);
    });

    it('iptal edilmiş rezervasyon ızgarada görünmez', async () => {
      await seedReservation({ roomId: room['101'].id, status: 'CANCELLED' });
      assert.equal(rowOf(await loadPlan(), '101').reservations.length, 0);
    });

    it('çıkış yapmış konaklama görünür (dün kim kaldı)', async () => {
      await seedReservation({ roomId: room['101'].id, checkIn: 0, checkOut: 1, status: 'CHECKED_OUT' });
      assert.equal(rowOf(await loadPlan(), '101').reservations.length, 1);
    });

    it('başka tipte odaya yerleşen misafiri işaretler', async () => {
      await seedReservation({ roomTypeId: dlxTypeId, roomId: room['101'].id, adults: 1 });
      assert.equal(rowOf(await loadPlan(), '101').reservations[0].typeMismatch, true);
    });

    it('arıza kaydını ayrı bar olarak çizer, süresiz kaydı pencere sonuna kadar uzatır', async () => {
      await asUser(() =>
        rooms.blockRoom(hotelId, room['103'].id, {
          type: 'OUT_OF_ORDER',
          startDate: dayDate(2),
          endDate: null,
          reason: 'Klima',
        }),
      );

      const row = rowOf(await loadPlan(), '103');
      assert.equal(row.blocks.length, 1);
      assert.equal(row.blocks[0].startIndex, 2);
      assert.equal(row.blocks[0].span, 5);
      assert.equal(row.blocks[0].continuesAfter, true);
      assert.equal(row.condition, 'IN_SERVICE', 'kayıt ileri tarihli; oda bugün çalışıyor');
    });

    it('bugün süren arıza kaydı satır başında rozet olur', async () => {
      await asUser(() =>
        rooms.blockRoom(hotelId, room['103'].id, {
          type: 'OUT_OF_SERVICE',
          startDate: dayDate(0),
          endDate: dayDate(2),
          reason: 'Perde',
        }),
      );
      assert.equal(rowOf(await loadPlan(), '103').condition, 'OUT_OF_SERVICE');
    });

    it('kat ve tip filtreleri satırları daraltır', async () => {
      const byFloor = await loadPlan({ floor: 2 });
      assert.deepEqual(byFloor.items.map((entry) => entry.number), ['201']);

      const byType = await loadPlan({ roomTypeId: stdTypeId });
      assert.deepEqual(byType.items.map((entry) => entry.number), ['101', '102', '103']);
    });

    it('odalar sayfalanır', async () => {
      const page = await loadPlan({ pageSize: 2, page: 2 });
      assert.equal(page.meta.total, 4);
      assert.equal(page.meta.totalPages, 2);
      assert.deepEqual(page.items.map((entry) => entry.number), ['103', '201']);
    });
  });

  describe('günlük özet', () => {
    it('sayfa ve filtre daralsa da otelin tamamından hesaplanır', async () => {
      await seedReservation({ roomId: room['201'].id, roomTypeId: dlxTypeId, adults: 1, checkIn: 0, checkOut: 2 });

      // Yalnızca 1. kat gösteriliyor ama özet 4 odalı otelin tamamına bakmalı.
      const result = await loadPlan({ floor: 1 });
      assert.equal(result.hotelRoomCount, 4);
      assert.equal(result.summary[0].occupied, 1);
      assert.equal(result.summary[0].occupancyPct, 25);
      assert.equal(result.items.length, 3);
    });

    it('giriş, çıkış ve oda bekleyen sayılarını ayırır', async () => {
      await seedReservation({ roomId: room['101'].id, checkIn: 0, checkOut: 2 });
      await seedReservation({ roomId: null, checkIn: 0, checkOut: 1 });

      const summary = (await loadPlan()).summary;
      assert.equal(summary[0].arrivals, 2);
      assert.equal(summary[0].unassigned, 1);
      assert.equal(summary[0].occupied, 1);
      assert.equal(summary[2].departures, 1);
    });

    it('arızalı oda satılabilir envanterden düşer', async () => {
      await asUser(() =>
        rooms.blockRoom(hotelId, room['103'].id, {
          type: 'OUT_OF_ORDER',
          startDate: dayDate(0),
          endDate: dayDate(1),
          reason: 'Su basması',
        }),
      );

      const summary = (await loadPlan()).summary;
      assert.equal(summary[0].sellable, 3);
      assert.equal(summary[0].outOfOrder, 1);
      assert.equal(summary[1].sellable, 4, 'kayıt bittiği gün oda envantere döner');
    });
  });

  describe('oda bekleyen şeridi', () => {
    it('yalnızca pencereye düşenleri, girişi yakın olan önce verir', async () => {
      await seedReservation({ roomId: null, checkIn: 3, checkOut: 5, guestName: ['Geç', 'Gelen'] });
      await seedReservation({ roomId: null, checkIn: 1, checkOut: 2, guestName: ['Erken', 'Gelen'] });
      await seedReservation({ roomId: null, checkIn: 40, checkOut: 42, guestName: ['Uzak', 'Gelecek'] });
      await seedReservation({ roomId: room['101'].id, checkIn: 1, checkOut: 2, guestName: ['Odası', 'Var'] });

      const result = await plan.getUnassignedForWindow(hotelId, { from: dayDate(0), days: 7, limit: 25 });
      assert.deepEqual(result.items.map((entry) => entry.guestName), ['Erken Gelen', 'Geç Gelen']);
      assert.equal(result.total, 2);
    });

    it('iptal edilmiş kayıt şeritte durmaz', async () => {
      await seedReservation({ roomId: null, checkIn: 1, checkOut: 2, status: 'CANCELLED' });
      const result = await plan.getUnassignedForWindow(hotelId, { from: dayDate(0), days: 7, limit: 25 });
      assert.equal(result.total, 0);
    });
  });

  describe('rezervasyon detayı', () => {
    it('konaklama, misafir ve folyo bilgisini birlikte verir', async () => {
      const reservation = await seedReservation({ roomId: room['101'].id, checkIn: 0, checkOut: 3 });
      const guest = await prismaUnfiltered.guest.findFirst({ where: { hotelId } });
      await prismaUnfiltered.folio.create({
        data: { hotelId, reservationId: reservation.id, guestId: guest.id, status: 'OPEN', balance: '1250.50' },
      });

      const detail = await plan.getReservationDetail(hotelId, reservation.id);
      assert.equal(detail.nights, 3);
      assert.equal(detail.room.number, '101');
      assert.equal(detail.folio.balance, '1250.5');
      assert.equal(detail.totalPrice, '3000');
      assert.equal(detail.actions.canChangeRoom, true);
      assert.equal(detail.actions.canUnassign, true);
    });

    it('çıkış yapmış konaklamada işlem düğmeleri kapalı ve sebebi yazılı', async () => {
      const reservation = await seedReservation({ roomId: room['101'].id, checkIn: -5, checkOut: -2, status: 'CHECKED_OUT' });
      const detail = await plan.getReservationDetail(hotelId, reservation.id);

      assert.equal(detail.actions.canChangeRoom, false);
      assert.equal(detail.actions.reason, 'Konaklama sona ermiş');
    });

    it('içerideki misafirin oda kaydı kaldırılamaz ama odası değiştirilebilir', async () => {
      const reservation = await seedReservation({ roomId: room['101'].id, checkIn: 0, checkOut: 3, status: 'CHECKED_IN' });
      const detail = await plan.getReservationDetail(hotelId, reservation.id);

      assert.equal(detail.actions.canChangeRoom, true);
      assert.equal(detail.actions.canUnassign, false);
    });
  });

  describe('oda değişikliği (sürükle-bırak)', () => {
    it('odası olmayan rezervasyona atar', async () => {
      const reservation = await seedReservation({ roomId: null });
      const result = await asUser(() => rooms.changeRoom(hotelId, reservation.id, room['101'].id));

      assert.equal(result.mode, 'ASSIGNED');
      assert.equal(result.reservation.roomNumber, '101');
    });

    it('gelmemiş misafiri başka odaya taşır, oda durumlarına dokunmaz', async () => {
      const reservation = await seedReservation({ roomId: room['101'].id, checkIn: 2, checkOut: 4 });
      const result = await asUser(() => rooms.changeRoom(hotelId, reservation.id, room['102'].id));

      assert.equal(result.mode, 'MOVED');
      assert.equal(result.previousRoomNumber, '101');
      assert.equal((await roomRow('102')).occupancy, 'VACANT', 'misafir henüz gelmedi');
    });

    it('içerideki misafiri taşır: eski oda boş+kirli, yeni oda dolu', async () => {
      const reservation = await seedReservation({ roomId: room['101'].id, checkIn: 0, checkOut: 3, status: 'CHECKED_IN' });
      await prismaUnfiltered.room.update({
        where: { id: room['101'].id },
        data: { occupancy: 'OCCUPIED', housekeepingStatus: 'CLEAN' },
      });

      const result = await asUser(() => rooms.changeRoom(hotelId, reservation.id, room['102'].id));
      assert.equal(result.mode, 'IN_HOUSE_MOVED');

      const previous = await roomRow('101');
      const next = await roomRow('102');
      assert.equal(previous.occupancy, 'VACANT');
      assert.equal(previous.housekeepingStatus, 'DIRTY', 'misafir çıktı, oda kullanılmış');
      assert.equal(next.occupancy, 'OCCUPIED');
    });

    it('taşıma denetim izi ve event bırakır', async () => {
      const reservation = await seedReservation({ roomId: room['101'].id, checkIn: 0, checkOut: 3, status: 'CHECKED_IN' });
      await asUser(() => rooms.changeRoom(hotelId, reservation.id, room['102'].id));

      const events = await prismaUnfiltered.eventLog.findMany({ where: { hotelId }, select: { name: true } });
      const names = events.map((entry) => entry.name);
      assert.ok(names.includes('room.assigned'));
      assert.ok(names.includes('room.unassigned'));
      assert.ok(names.includes('room.status.changed'));

      const audit = await prismaUnfiltered.auditLog.findMany({ where: { hotelId, entity: 'Reservation' } });
      assert.equal(audit.length, 1);
    });

    it('aynı odaya bırakılırsa yazma yapılmaz', async () => {
      const reservation = await seedReservation({ roomId: room['101'].id, checkIn: 0, checkOut: 3, status: 'CHECKED_IN' });
      const result = await asUser(() => rooms.changeRoom(hotelId, reservation.id, room['101'].id));

      assert.equal(result.mode, 'UNCHANGED');
      const audit = await prismaUnfiltered.auditLog.count({ where: { hotelId } });
      assert.equal(audit, 0);
    });

    it('dolu odaya taşımayı reddeder', async () => {
      const staying = await seedReservation({ roomId: room['101'].id, checkIn: 0, checkOut: 3, status: 'CHECKED_IN' });
      await seedReservation({ roomId: room['102'].id, checkIn: 1, checkOut: 2 });

      await assert.rejects(
        () => asUser(() => rooms.changeRoom(hotelId, staying.id, room['102'].id)),
        (error) => error.code === 'ROOM_NOT_FREE',
      );
    });

    it('arızalı odaya taşımayı reddeder', async () => {
      const staying = await seedReservation({ roomId: room['101'].id, checkIn: 0, checkOut: 3, status: 'CHECKED_IN' });
      await asUser(() =>
        rooms.blockRoom(hotelId, room['102'].id, {
          type: 'OUT_OF_ORDER',
          startDate: dayDate(1),
          endDate: dayDate(2),
          reason: 'Tadilat',
        }),
      );

      await assert.rejects(
        () => asUser(() => rooms.changeRoom(hotelId, staying.id, room['102'].id)),
        (error) => error.code === 'ROOM_NOT_FREE',
      );
    });

    it('kapasitesi yetmeyen odaya taşımayı reddeder', async () => {
      const staying = await seedReservation({ roomId: room['101'].id, checkIn: 0, checkOut: 3, adults: 2, status: 'CHECKED_IN' });

      await assert.rejects(
        () => asUser(() => rooms.changeRoom(hotelId, staying.id, room['201'].id)),
        (error) => error.code === 'CAPACITY_EXCEEDED',
      );
    });

    it('konaklaması bitmiş kayıt taşınamaz', async () => {
      const past = await seedReservation({ roomId: room['101'].id, checkIn: -5, checkOut: -2, status: 'CHECKED_IN' });

      await assert.rejects(
        () => asUser(() => rooms.changeRoom(hotelId, past.id, room['102'].id)),
        (error) => error.code === 'STAY_ENDED',
      );
    });

    it('çıkış yapmış rezervasyonun odası değiştirilemez', async () => {
      const done = await seedReservation({ roomId: room['101'].id, checkIn: 0, checkOut: 3, status: 'CHECKED_OUT' });

      await assert.rejects(
        () => asUser(() => rooms.changeRoom(hotelId, done.id, room['102'].id)),
        (error) => error.code === 'NOT_ASSIGNABLE',
      );
    });

    it('taşıma yeni overbooking yaratamaz', async () => {
      // DLX tek oda (201) ve o tipte iki talep var: içerideki misafiri oraya
      // taşımak, odası bekleyen DLX rezervasyonunu yersiz bırakır.
      const staying = await seedReservation({ roomId: room['101'].id, checkIn: 0, checkOut: 3, adults: 1, status: 'CHECKED_IN' });
      await seedReservation({ roomTypeId: dlxTypeId, roomId: null, checkIn: 0, checkOut: 3, adults: 1 });

      await assert.rejects(
        () => asUser(() => rooms.changeRoom(hotelId, staying.id, room['201'].id)),
        (error) => error.code === 'WOULD_OVERBOOK',
      );
    });
  });
});
