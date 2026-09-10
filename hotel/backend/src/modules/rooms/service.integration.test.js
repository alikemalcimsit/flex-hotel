import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Entegrasyon testleri — gerçek PostgreSQL gerektirir.
 *
 * Buradaki iddialar yalnızca veritabanıyla doğrulanabilir: çifte rezervasyonu
 * engelleyen EXCLUDE kısıtı, blok çakışması, müsaitlik sayımının gerçek
 * veriyle tutması. Hepsi "sessizce yanlış çalışırsa oda iki kez satılır"
 * sınıfından.
 *
 * Çalıştırmak için (boş bir test veritabanı ile):
 *   DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy
 *   TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

describe('oda envanteri servisi (entegrasyon)', { skip }, () => {
  /** @type {any} */ let prismaUnfiltered;
  /** @type {any} */ let service;
  /** @type {any} */ let runWithContext;
  let hotelId;
  let stdTypeId;
  let dlxTypeId;
  let rooms;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    const db = await import('../../db.js');
    prismaUnfiltered = db.prismaUnfiltered;
    service = await import('./service.js');
    ({ runWithContext } = await import('@hotelos/core'));
  });

  after(async () => {
    await prismaUnfiltered?.$disconnect();
  });

  beforeEach(async () => {
    await prismaUnfiltered.auditLog.deleteMany({});
    await prismaUnfiltered.eventLog.deleteMany({});
    await prismaUnfiltered.reservation.deleteMany({});
    await prismaUnfiltered.roomBlock.deleteMany({});
    await prismaUnfiltered.room.deleteMany({});
    await prismaUnfiltered.roomType.deleteMany({});
    await prismaUnfiltered.guest.deleteMany({});
    await prismaUnfiltered.hotel.deleteMany({});

    const hotel = await prismaUnfiltered.hotel.create({
      data: { name: 'Test Otel', code: `TEST-${randomUUID().slice(0, 8)}` },
    });
    hotelId = hotel.id;

    const std = await prismaUnfiltered.roomType.create({
      data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000' },
    });
    const dlx = await prismaUnfiltered.roomType.create({
      data: { hotelId, code: 'DLX', name: 'Deluxe', basePrice: '2000' },
    });
    stdTypeId = std.id;
    dlxTypeId = dlx.id;

    rooms = {};
    for (const [number, typeId, floor] of [
      ['101', std.id, 1],
      ['102', std.id, 1],
      ['103', std.id, 1],
      ['201', dlx.id, 2],
    ]) {
      const room = await prismaUnfiltered.room.create({
        data: { hotelId, number, roomTypeId: typeId, floor },
      });
      rooms[number] = room;
    }
  });

  const asUser = (fn) => runWithContext({ correlationId: randomUUID(), actor: 'test@hotel.local' }, fn);

  /** Doğrudan veritabanına rezervasyon yazar (modül 4 henüz yok). */
  async function seedReservation({
    roomTypeId = stdTypeId,
    roomId = null,
    checkIn = '2026-10-15',
    checkOut = '2026-10-18',
    status = 'CONFIRMED',
    code = `R-${randomUUID().slice(0, 8)}`,
  } = {}) {
    const guest = await prismaUnfiltered.guest.create({
      data: { hotelId, firstName: 'Test', lastName: 'Misafir' },
    });
    return prismaUnfiltered.reservation.create({
      data: {
        hotelId,
        guestId: guest.id,
        roomTypeId,
        roomId,
        checkIn: new Date(`${checkIn}T14:00:00.000Z`),
        checkOut: new Date(`${checkOut}T12:00:00.000Z`),
        status,
        totalPrice: '3000',
        confirmationCode: code,
      },
    });
  }

  const availability = (checkIn, checkOut, roomTypeId = stdTypeId) =>
    service.checkAvailability(hotelId, {
      checkIn: new Date(`${checkIn}T00:00:00.000Z`),
      checkOut: new Date(`${checkOut}T00:00:00.000Z`),
      roomTypeId,
    });

  describe('çifte rezervasyon koruması', () => {
    it('aynı odaya çakışan ikinci rezervasyon veritabanınca reddedilir', async () => {
      await seedReservation({ roomId: rooms['101'].id, checkIn: '2026-10-15', checkOut: '2026-10-18' });

      await assert.rejects(
        () => seedReservation({ roomId: rooms['101'].id, checkIn: '2026-10-16', checkOut: '2026-10-20' }),
        /no_double_booking|exclusion|constraint/i,
      );
    });

    it('çıkış günü devreden oda aynı gün tekrar satılabilir', async () => {
      await seedReservation({ roomId: rooms['101'].id, checkIn: '2026-10-15', checkOut: '2026-10-18' });

      // 18'de çıkıyor, yeni misafir 18'de giriyor — çakışma değil.
      await assert.doesNotReject(() =>
        seedReservation({ roomId: rooms['101'].id, checkIn: '2026-10-18', checkOut: '2026-10-20' }),
      );
    });

    it('iptal edilmiş rezervasyon odayı bloke etmez', async () => {
      await seedReservation({
        roomId: rooms['101'].id,
        checkIn: '2026-10-15',
        checkOut: '2026-10-18',
        status: 'CANCELLED',
      });

      await assert.doesNotReject(() =>
        seedReservation({ roomId: rooms['101'].id, checkIn: '2026-10-15', checkOut: '2026-10-18' }),
      );
    });

    it('çıkış girişten önce olamaz', async () => {
      await assert.rejects(
        () => seedReservation({ checkIn: '2026-10-18', checkOut: '2026-10-15' }),
        /date_order|constraint|check/i,
      );
    });
  });

  describe('müsaitlik sayımı', () => {
    it('boş otelde tüm odalar müsait', async () => {
      assert.equal(await availability('2026-10-15', '2026-10-18'), 3);
    });

    it('atanmamış rezervasyon envanterden düşer', async () => {
      await seedReservation({ checkIn: '2026-10-15', checkOut: '2026-10-18' });
      assert.equal(await availability('2026-10-15', '2026-10-18'), 2);
    });

    it('atanmış rezervasyon envanterden düşer', async () => {
      await seedReservation({ roomId: rooms['101'].id, checkIn: '2026-10-15', checkOut: '2026-10-18' });
      assert.equal(await availability('2026-10-15', '2026-10-18'), 2);
    });

    it('komşu tarihteki rezervasyon envanteri etkilemez', async () => {
      await seedReservation({ roomId: rooms['101'].id, checkIn: '2026-10-18', checkOut: '2026-10-20' });
      assert.equal(await availability('2026-10-15', '2026-10-18'), 3);
    });

    it('gecelerin en düşüğü alınır', async () => {
      // Yalnızca 16 gecesi iki rezervasyon var.
      await seedReservation({ checkIn: '2026-10-16', checkOut: '2026-10-17' });
      await seedReservation({ checkIn: '2026-10-16', checkOut: '2026-10-17' });

      assert.equal(await availability('2026-10-16', '2026-10-17'), 1, '16 gecesi 1 oda kalmalı');
      assert.equal(await availability('2026-10-15', '2026-10-18'), 1, 'darboğaz geceye göre');
    });

    it('bloklu oda envanterden düşer', async () => {
      await asUser(() =>
        service.blockRoom(hotelId, rooms['101'].id, {
          startDate: new Date('2026-10-15T00:00:00.000Z'),
          endDate: new Date('2026-10-18T00:00:00.000Z'),
          reason: 'Tadilat',
        }),
      );
      assert.equal(await availability('2026-10-15', '2026-10-18'), 2);
    });

    it('diğer oda tipini etkilemez', async () => {
      await seedReservation({ roomId: rooms['101'].id });
      assert.equal(await availability('2026-10-15', '2026-10-18', dlxTypeId), 1);
    });

    it('upgrade envanteri doğru yansıtır', async () => {
      // Standart rezervasyon Deluxe odaya yerleşince Standart envanteri boşalır.
      const reservation = await seedReservation({ roomTypeId: stdTypeId });
      await asUser(() => service.assignRoom(hotelId, reservation.id, rooms['201'].id));

      assert.equal(await availability('2026-10-15', '2026-10-18', stdTypeId), 3, 'Standart envanteri serbest');
      assert.equal(await availability('2026-10-15', '2026-10-18', dlxTypeId), 0, 'Deluxe oda işgal edildi');
    });
  });

  describe('bloklar', () => {
    it('çakışan iki blok konamaz', async () => {
      await asUser(() =>
        service.blockRoom(hotelId, rooms['101'].id, {
          startDate: new Date('2026-10-15T00:00:00.000Z'),
          endDate: new Date('2026-10-20T00:00:00.000Z'),
          reason: 'Tadilat',
        }),
      );

      await assert.rejects(() =>
        asUser(() =>
          service.blockRoom(hotelId, rooms['101'].id, {
            startDate: new Date('2026-10-18T00:00:00.000Z'),
            endDate: new Date('2026-10-25T00:00:00.000Z'),
            reason: 'Boya',
          }),
        ),
      );
    });

    it('rezervasyonlu oda bloklanamaz ve çakışan kayıtlar bildirilir', async () => {
      await seedReservation({ roomId: rooms['101'].id, checkIn: '2026-10-15', checkOut: '2026-10-18', code: 'DEMO-1' });

      await assert.rejects(
        () =>
          asUser(() =>
            service.blockRoom(hotelId, rooms['101'].id, {
              startDate: new Date('2026-10-16T00:00:00.000Z'),
              endDate: new Date('2026-10-17T00:00:00.000Z'),
              reason: 'Tadilat',
            }),
          ),
        (error) => error.code === 'HAS_RESERVATIONS' && error.details.reservations[0].confirmationCode === 'DEMO-1',
      );
    });

    it('süresiz blok sonraki tüm tarihleri kapatır', async () => {
      await asUser(() =>
        service.blockRoom(hotelId, rooms['101'].id, {
          startDate: new Date('2026-10-15T00:00:00.000Z'),
          endDate: null,
          reason: 'Süresiz',
        }),
      );
      assert.equal(await availability('2027-01-01', '2027-01-05'), 2);
    });

    it('blok kaldırılınca oda tekrar satılabilir', async () => {
      const block = await asUser(() =>
        service.blockRoom(hotelId, rooms['101'].id, {
          startDate: new Date('2026-10-15T00:00:00.000Z'),
          endDate: new Date('2026-10-18T00:00:00.000Z'),
          reason: 'Tadilat',
        }),
      );
      await asUser(() => service.unblockRoom(hotelId, block.id));

      assert.equal(await availability('2026-10-15', '2026-10-18'), 3);
    });
  });

  describe('oda atama', () => {
    it('uygun odayı atar ve event bırakır', async () => {
      const reservation = await seedReservation();
      const result = await asUser(() => service.assignRoom(hotelId, reservation.id, rooms['102'].id));

      assert.equal(result.roomNumber, '102');

      const event = await prismaUnfiltered.eventLog.findFirst({ where: { name: 'room.assigned' } });
      assert.equal(event.payload.roomNumber, '102');
      assert.ok(event.publishedAt);
    });

    it('dolu odaya atama reddedilir', async () => {
      await seedReservation({ roomId: rooms['102'].id, checkIn: '2026-10-15', checkOut: '2026-10-18' });
      const second = await seedReservation({ checkIn: '2026-10-16', checkOut: '2026-10-19' });

      await assert.rejects(() => asUser(() => service.assignRoom(hotelId, second.id, rooms['102'].id)));
    });

    it('aday listesi dolu ve bloklu odaları elemez', async () => {
      await seedReservation({ roomId: rooms['101'].id, checkIn: '2026-10-15', checkOut: '2026-10-18' });
      await asUser(() =>
        service.blockRoom(hotelId, rooms['102'].id, {
          startDate: new Date('2026-10-15T00:00:00.000Z'),
          endDate: new Date('2026-10-18T00:00:00.000Z'),
          reason: 'Tadilat',
        }),
      );

      const reservation = await seedReservation();
      const candidates = await service.getAssignableRooms(hotelId, reservation.id);

      assert.deepEqual(candidates.map((room) => room.number), ['103']);
    });

    it('otomatik atama en uygun odayı seçer', async () => {
      await prismaUnfiltered.room.update({ where: { id: rooms['101'].id }, data: { status: 'DIRTY' } });
      const reservation = await seedReservation();

      const result = await asUser(() => service.autoAssignRoom(hotelId, reservation.id));

      assert.equal(result.assigned, true);
      assert.equal(result.room.number, '102', 'kirli 101 yerine temiz 102 seçilmeli');
    });

    it('boş oda yoksa otomatik atama sebebiyle birlikte başarısız olur', async () => {
      for (const number of ['101', '102', '103']) {
        await seedReservation({ roomId: rooms[number].id, checkIn: '2026-10-15', checkOut: '2026-10-18' });
      }
      const reservation = await seedReservation();

      const result = await asUser(() => service.autoAssignRoom(hotelId, reservation.id));

      assert.equal(result.assigned, false);
      assert.match(result.reason, /bulunamadı/);
    });

    it('oda değiştirmede eski oda serbest kalır', async () => {
      const reservation = await seedReservation();
      await asUser(() => service.assignRoom(hotelId, reservation.id, rooms['101'].id));
      await asUser(() => service.assignRoom(hotelId, reservation.id, rooms['102'].id));

      const candidates = await service.getAssignableRooms(hotelId, reservation.id);
      assert.ok(candidates.some((room) => room.number === '101'), '101 tekrar boşa düşmeli');
    });

    it('giriş yapmış misafirin odası kaldırılamaz', async () => {
      const reservation = await seedReservation({ roomId: rooms['101'].id, status: 'CHECKED_IN' });

      await assert.rejects(
        () => asUser(() => service.unassignRoom(hotelId, reservation.id)),
        (error) => error.code === 'GUEST_IN_ROOM',
      );
    });

    it('atama bekleyenler listesi girişi yakın olanı öne alır', async () => {
      await seedReservation({ checkIn: '2026-11-01', checkOut: '2026-11-03', code: 'GEC' });
      await seedReservation({ checkIn: '2026-10-15', checkOut: '2026-10-18', code: 'YAKIN' });

      const page = await service.listUnassignedReservations(hotelId, { page: 1, pageSize: 25 });
      assert.equal(page.items[0].confirmationCode, 'YAKIN');
    });
  });

  describe('oda yaşam döngüsü', () => {
    it('silinen oda numarası tekrar kullanılabilir', async () => {
      await asUser(() => service.deleteRoom(hotelId, rooms['103'].id));
      const recreated = await asUser(() =>
        service.createRoom(hotelId, { number: '103', floor: 1, roomTypeId: stdTypeId, notes: null }),
      );
      assert.equal(recreated.number, '103');
    });

    it('aktif rezervasyonu olan oda silinemez', async () => {
      await seedReservation({ roomId: rooms['101'].id });

      await assert.rejects(
        () => asUser(() => service.deleteRoom(hotelId, rooms['101'].id)),
        (error) => error.code === 'IN_USE' && error.details.usage.aktifRezervasyon === 1,
      );
    });

    it('bloklu odanın durumu elle değiştirilemez', async () => {
      await asUser(() =>
        service.blockRoom(hotelId, rooms['101'].id, {
          startDate: new Date(Date.now() - 86_400_000),
          endDate: null,
          reason: 'Arıza',
        }),
      );
      const room = await prismaUnfiltered.room.findUnique({ where: { id: rooms['101'].id } });

      await assert.rejects(
        () =>
          asUser(() =>
            service.setRoomStatus(hotelId, rooms['101'].id, {
              status: 'AVAILABLE',
              expectedUpdatedAt: room.updatedAt,
            }),
          ),
        (error) => error.code === 'ROOM_BLOCKED',
      );
    });

    it('sistem kaynaklı durum değişikliği sürüm damgası istemez', async () => {
      await service.applySystemRoomStatus(hotelId, rooms['101'].id, 'OCCUPIED', 'Misafir giriş yaptı');
      const room = await prismaUnfiltered.room.findUnique({ where: { id: rooms['101'].id } });
      assert.equal(room.status, 'OCCUPIED');
    });
  });
});
