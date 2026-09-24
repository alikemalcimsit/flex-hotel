import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Entegrasyon testleri — gerçek PostgreSQL gerektirir.
 *
 * Buradaki iddialar yalnızca veritabanıyla doğrulanabilir: çifte rezervasyonu
 * engelleyen EXCLUDE kısıtı, rezervasyon ↔ arıza kaydı tetikleyicisi, satır
 * kilitleri, müsaitlik sayımının gerçek veriyle tutması. Hepsi "sessizce yanlış
 * çalışırsa oda iki kez satılır" sınıfından.
 *
 * Tarihler "bugün"e göre göreli: sabit tarihler ("2026-10-15") o gün geçince
 * geçmişe düşer ve testler kural yüzünden değil takvim yüzünden kırılır.
 *
 * Çalıştırmak için (boş bir test veritabanı ile):
 *   DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy
 *   TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

/** Test otelinin saat dilimi (Hotel tablosunun varsayılanı). */
const HOTEL_TIME_ZONE = 'Europe/Istanbul';

describe('oda envanteri servisi (entegrasyon)', { skip }, () => {
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  /** @type {any} */ let prismaUnfiltered;
  /** @type {any} */ let service;
  /** @type {any} */ let core;
  let hotelId;
  let stdTypeId;
  let dlxTypeId;
  let rooms;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    const db = await import('../../db.js');
    prismaUnfiltered = db.prismaUnfiltered;
    service = await import('./service.js');
    core = await import('@hotelos/core');
  });

  after(async () => {
    await prismaUnfiltered?.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prismaUnfiltered);

    const hotel = await prismaUnfiltered.hotel.create({
      data: { name: 'Test Otel', code: `TEST-${randomUUID().slice(0, 8)}` },
    });
    hotelId = hotel.id;

    const std = await prismaUnfiltered.roomType.create({
      data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 2, capacityChildren: 1 },
    });
    const dlx = await prismaUnfiltered.roomType.create({
      data: { hotelId, code: 'DLX', name: 'Deluxe', basePrice: '2000', capacityAdults: 2, capacityChildren: 0 },
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
      rooms[number] = await prismaUnfiltered.room.create({ data: { hotelId, number, roomTypeId: typeId, floor } });
    }
  });

  const asUser = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: 'test@hotel.local' }, fn);

  /** Otelin bugününden `offset` gün sonrası (UTC gün başı). */
  const dayDate = (offset) => core.addDays(core.calendarDateInTimeZone(HOTEL_TIME_ZONE), offset);
  /** `YYYY-MM-DD` */
  const day = (offset) => core.toIsoDay(dayDate(offset));

  /** Doğrudan veritabanına rezervasyon yazar (modül 4 henüz yok). Saatler gerçekçi: giriş 14:00, çıkış 12:00. */
  /** Durum içeride / çıkmış ise giriş-çıkış zamanları. */
  const stayTimes = (status) => ({
    ...(['CHECKED_IN', 'CHECKED_OUT'].includes(status) ? { checkedInAt: new Date(), checkedInBy: 'test' } : {}),
    ...(status === 'CHECKED_OUT' ? { checkedOutAt: new Date(), checkedOutBy: 'test' } : {}),
  });

  async function seedReservation({
    roomTypeId = stdTypeId,
    roomId = null,
    checkIn = 10,
    checkOut = 13,
    status = 'CONFIRMED',
    adults = 2,
    children = 0,
    code = `R-${randomUUID().slice(0, 8)}`,
    checkInTime = '14:00',
    checkOutTime = '12:00',
  } = {}) {
    const guest = await prismaUnfiltered.guest.create({ data: { hotelId, firstName: 'Test', lastName: 'Misafir' } });
    return prismaUnfiltered.reservation.create({
      data: {
        hotelId,
        guestId: guest.id,
        roomTypeId,
        roomId,
        checkIn: new Date(`${day(checkIn)}T${checkInTime}:00.000Z`),
        checkOut: new Date(`${day(checkOut)}T${checkOutTime}:00.000Z`),
        status,
        adults,
        children,
        totalPrice: '3000',
        confirmationCode: code,
        // İçerideki kaydın giriş, çıkmış kaydın iki zamanı da olur (kısıt; modül 6).
        ...stayTimes(status),
      },
    });
  }

  /** Servisi atlayıp doğrudan arıza kaydı yazar (geçmişte başlamış kayıtlar için). */
  const insertBlock = ({ roomId, type = 'OUT_OF_ORDER', start, end }) =>
    prismaUnfiltered.roomBlock.create({
      data: {
        hotelId,
        roomId,
        type,
        startDate: dayDate(start),
        endDate: end == null ? null : dayDate(end),
        reason: 'Test',
        createdBy: 'test',
      },
    });

  const block = (roomNumber, { type = 'OUT_OF_ORDER', start = 10, end = 13, reason = 'Tadilat' } = {}) =>
    asUser(() =>
      service.blockRoom(hotelId, rooms[roomNumber].id, {
        type,
        startDate: dayDate(start),
        endDate: end == null ? null : dayDate(end),
        reason,
      }),
    );

  const availability = (checkIn, checkOut, roomTypeId = stdTypeId) =>
    service.checkAvailability(hotelId, { checkIn: dayDate(checkIn), checkOut: dayDate(checkOut), roomTypeId });

  const roomRow = (number) => prismaUnfiltered.room.findUnique({ where: { id: rooms[number].id } });

  describe('çifte rezervasyon koruması (veritabanı)', () => {
    it('aynı odaya çakışan ikinci rezervasyon reddedilir', async () => {
      await seedReservation({ roomId: rooms['101'].id, checkIn: 10, checkOut: 13 });
      await assert.rejects(
        () => seedReservation({ roomId: rooms['101'].id, checkIn: 11, checkOut: 15 }),
        /no_double_booking/i,
      );
    });

    it('çıkış günü devreden oda aynı gün tekrar satılabilir', async () => {
      await seedReservation({ roomId: rooms['101'].id, checkIn: 10, checkOut: 13 });
      await assert.doesNotReject(() => seedReservation({ roomId: rooms['101'].id, checkIn: 13, checkOut: 15 }));
    });

    it('geç çıkış (16:00) ile aynı gün girişi (14:00) gece hesabında çakışmaz', async () => {
      // Eski kısıt ham saatleri karşılaştırıp bunu reddediyordu; uygulama ise "çakışmaz" diyordu.
      await seedReservation({ roomId: rooms['101'].id, checkIn: 10, checkOut: 13, checkOutTime: '16:00' });
      await assert.doesNotReject(() => seedReservation({ roomId: rooms['101'].id, checkIn: 13, checkOut: 15 }));
    });

    it('iptal edilmiş rezervasyon odayı tutmaz', async () => {
      await seedReservation({ roomId: rooms['101'].id, status: 'CANCELLED' });
      await assert.doesNotReject(() => seedReservation({ roomId: rooms['101'].id }));
    });

    it('çıkış girişten önce olamaz', async () => {
      await assert.rejects(() => seedReservation({ checkIn: 13, checkOut: 10 }), /date_order/i);
    });

    it('aynı gün giriş-çıkış (0 gece) reddedilir', async () => {
      await assert.rejects(
        () => seedReservation({ checkIn: 10, checkOut: 10, checkInTime: '09:00', checkOutTime: '18:00' }),
        /date_order/i,
      );
    });
  });

  describe('müsaitlik sayımı', () => {
    it('boş otelde tüm odalar müsait', async () => {
      assert.equal(await availability(10, 13), 3);
    });

    it('atanmamış rezervasyon envanterden düşer', async () => {
      await seedReservation();
      assert.equal(await availability(10, 13), 2);
    });

    it('atanmış rezervasyon envanterden düşer', async () => {
      await seedReservation({ roomId: rooms['101'].id });
      assert.equal(await availability(10, 13), 2);
    });

    it('komşu tarihteki rezervasyon envanteri etkilemez', async () => {
      await seedReservation({ roomId: rooms['101'].id, checkIn: 13, checkOut: 15 });
      assert.equal(await availability(10, 13), 3);
    });

    it('gecelerin en düşüğü alınır', async () => {
      await seedReservation({ checkIn: 11, checkOut: 12 });
      await seedReservation({ checkIn: 11, checkOut: 12 });
      assert.equal(await availability(11, 12), 1);
      assert.equal(await availability(10, 13), 1, 'darboğaz geceye göre');
    });

    it('arızalı oda envanterden düşer', async () => {
      await block('101');
      assert.equal(await availability(10, 13), 2);
    });

    it('hizmet dışı oda envanterden düşmez', async () => {
      await block('101', { type: 'OUT_OF_SERVICE' });
      assert.equal(await availability(10, 13), 3);
    });

    it('upgrade envanteri doğru yansıtır', async () => {
      const reservation = await seedReservation();
      await asUser(() => service.assignRoom(hotelId, reservation.id, rooms['201'].id));
      assert.equal(await availability(10, 13, stdTypeId), 3, 'Standart envanteri serbest');
      assert.equal(await availability(10, 13, dlxTypeId), 0, 'Deluxe oda işgal edildi');
    });

    it('transaction içinde sorulunca aynı transaction\'ın yazdığı rezervasyonu da sayar (modül 4 sözleşmesi)', async () => {
      const { prisma } = await import('../../db.js');
      const { lockRoomTypes } = await import('../../lib/locks.js');
      const stay = { checkIn: dayDate(10), checkOut: dayDate(13), roomTypeId: stdTypeId };
      const guest = await prismaUnfiltered.guest.create({ data: { hotelId, firstName: 'Grup', lastName: 'Misafir' } });

      const counts = await prisma.$transaction(async (tx) => {
        await lockRoomTypes(tx, hotelId, [stdTypeId]);
        await tx.reservation.create({
          data: {
            hotelId,
            guestId: guest.id,
            roomTypeId: stdTypeId,
            checkIn: stay.checkIn,
            checkOut: stay.checkOut,
            status: 'CONFIRMED',
            adults: 2,
            totalPrice: '3000',
            confirmationCode: `R-${randomUUID().slice(0, 8)}`,
          },
        });
        return {
          insideTransaction: await service.checkAvailability(hotelId, stay, { client: tx }),
          outsideTransaction: await service.checkAvailability(hotelId, stay),
        };
      });

      assert.equal(counts.insideTransaction, 2, 'grup rezervasyonunun ikinci odası ilkini görmeli');
      assert.equal(counts.outsideTransaction, 3, 'commit edilmemiş yazma dışarıdan görünmez');
      assert.equal(await availability(10, 13), 2, 'commit sonrası herkes görür');
    });
  });

  describe('arıza kayıtları', () => {
    it('çakışan iki kayıt Türkçe mesajla reddedilir (eskiden 500 dönüyordu)', async () => {
      await block('101', { start: 10, end: 15 });
      await assert.rejects(
        () => block('101', { start: 12, end: 18, reason: 'Boya' }),
        (error) => error.code === 'BLOCK_OVERLAP' && error.statusCode === 409 && /çakışan/.test(error.message),
      );
    });

    it('rezervasyonlu oda arızaya alınamaz ve çakışan kayıtlar bildirilir', async () => {
      await seedReservation({ roomId: rooms['101'].id, code: 'DEMO-1' });
      await assert.rejects(
        () => block('101', { start: 11, end: 12 }),
        (error) => error.code === 'HAS_RESERVATIONS' && error.details.reservations[0].confirmationCode === 'DEMO-1',
      );
    });

    it('çakışan kayıt sayısı örnek listesiyle kısaltılmaz', async () => {
      for (let offset = 10; offset < 16; offset += 1) {
        await seedReservation({ roomId: rooms['101'].id, checkIn: offset, checkOut: offset + 1 });
      }
      await assert.rejects(
        () => block('101', { start: 10, end: 16 }),
        (error) => {
          assert.match(error.message, /6 rezervasyonu var/);
          assert.equal(error.details.total, 6);
          assert.equal(error.details.shown, 5);
          return true;
        },
      );
    });

    it('öğlen çıkan misafirin çıkış günü başlayan kayıt engellenmez', async () => {
      await seedReservation({ roomId: rooms['101'].id, checkIn: 10, checkOut: 13 });
      await assert.doesNotReject(() => block('101', { start: 13, end: 15 }));
    });

    it('bugünden önce başlayamaz (geçmiş değiştirilemez)', async () => {
      await assert.rejects(() => block('101', { start: -1, end: 3 }), (error) => error.code === 'VALIDATION');
    });

    it('talep dolu tipte arıza kaydı overbooking yaratacaksa reddedilir', async () => {
      // Canlıda bulunan hata: iki kayıt da kabul ediliyor, müsaitlik -1'e düşüyordu.
      for (let i = 0; i < 3; i += 1) await seedReservation();

      await assert.rejects(
        () => block('101'),
        (error) =>
          error.code === 'WOULD_OVERBOOK' &&
          error.details.total === 3 &&
          error.details.nights[0].roomTypeCode === 'STD',
      );
      assert.equal(await availability(10, 13), 0, 'envanter değişmemeli');
    });

    it('aynı durumda hizmet dışı kaydı kabul edilir (envanteri azaltmaz)', async () => {
      for (let i = 0; i < 3; i += 1) await seedReservation();
      await assert.doesNotReject(() => block('101', { type: 'OUT_OF_SERVICE' }));
    });

    it('süresiz kayıt sonraki tüm tarihleri kapatır', async () => {
      await block('101', { start: 10, end: null });
      assert.equal(await availability(200, 204), 2);
    });

    it('başlamamış kayıt kaldırılınca iptal edilir ve oda tekrar satılabilir', async () => {
      const created = await block('101');
      const result = await asUser(() => service.removeBlock(hotelId, created.id));

      assert.equal(result.mode, 'CANCELLED');
      assert.equal(await availability(10, 13), 3);
    });

    it('süren kayıt bitirilir: geçmiş korunur, oda kirli olur', async () => {
      const running = await insertBlock({ roomId: rooms['101'].id, start: -3, end: null });
      const result = await asUser(() => service.removeBlock(hotelId, running.id));

      assert.equal(result.mode, 'ENDED');
      const row = await prismaUnfiltered.roomBlock.findUnique({ where: { id: running.id } });
      assert.equal(row.deletedAt, null, 'kayıt silinmemeli');
      assert.equal(core.toIsoDay(row.endDate), day(0), 'bitişi bugüne çekilmeli');
      assert.equal((await roomRow('101')).housekeepingStatus, 'DIRTY', 'tadilattan çıkan oda temizlik ister');
    });

    it('bitmiş kayda dokunulmaz', async () => {
      const ended = await insertBlock({ roomId: rooms['101'].id, start: -5, end: -2 });
      await assert.rejects(
        () => asUser(() => service.removeBlock(hotelId, ended.id)),
        (error) => error.code === 'BLOCK_ENDED',
      );
    });

    it('kayıt listesi sayfalıdır ve süren/bitmiş diye ayrılır', async () => {
      await insertBlock({ roomId: rooms['101'].id, start: -9, end: -6 });
      await insertBlock({ roomId: rooms['101'].id, start: -5, end: -2 });
      await block('101', { start: 10, end: 12 });
      await block('102', { start: 0, end: 4 });

      const active = await service.listBlocks(hotelId, { scope: 'ACTIVE', page: 1, pageSize: 1 });
      assert.equal(active.meta.total, 2);
      assert.equal(active.items.length, 1, 'sayfa boyutuna uyulmalı');
      assert.equal(active.items[0].state, 'CURRENT', 'yakın olan önce');

      const past = await service.listBlocks(hotelId, { scope: 'PAST', page: 1, pageSize: 25 });
      assert.equal(past.meta.total, 2);
      assert.equal(past.items[0].removal, 'ALREADY_ENDED');
    });

    it('servis atlansa da arızalı odaya rezervasyon yazılamaz (tetikleyici)', async () => {
      await block('101');
      await assert.rejects(() => seedReservation({ roomId: rooms['101'].id }), /Reservation_room_blocked/);
    });

    it('servis atlansa da rezervasyonlu odaya kayıt yazılamaz (tetikleyici)', async () => {
      await seedReservation({ roomId: rooms['101'].id });
      await assert.rejects(
        () => insertBlock({ roomId: rooms['101'].id, start: 11, end: 12 }),
        /RoomBlock_has_reservations/,
      );
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

    it('dolu odaya atama anlaşılır kodla reddedilir', async () => {
      await seedReservation({ roomId: rooms['102'].id });
      const second = await seedReservation({ checkIn: 11, checkOut: 14 });
      await assert.rejects(
        () => asUser(() => service.assignRoom(hotelId, second.id, rooms['102'].id)),
        (error) => error.code === 'ROOM_NOT_FREE',
      );
    });

    it('arızalı odaya atama reddedilir (canlıda bulunan hata)', async () => {
      await block('101', { start: 11, end: 14 });
      const reservation = await seedReservation();
      await assert.rejects(
        () => asUser(() => service.assignRoom(hotelId, reservation.id, rooms['101'].id)),
        (error) => error.code === 'ROOM_NOT_FREE' && /arızalı/.test(error.message),
      );
    });

    it('iptal edilmiş rezervasyona oda atanamaz', async () => {
      const reservation = await seedReservation({ status: 'CANCELLED' });
      await assert.rejects(
        () => asUser(() => service.assignRoom(hotelId, reservation.id, rooms['101'].id)),
        (error) => error.code === 'NOT_ASSIGNABLE' && /İptal/.test(error.message),
      );
    });

    it('aday listesi dolu, arızalı ve hizmet dışı odaları eler', async () => {
      await seedReservation({ roomId: rooms['101'].id });
      await block('102', { type: 'OUT_OF_SERVICE' });
      const reservation = await seedReservation();

      const page = await service.getAssignableRooms(hotelId, reservation.id);
      assert.deepEqual(page.items.map((room) => room.number), ['103']);
    });

    it('bugün gelen misafir için temiz oda kirliden önce önerilir', async () => {
      await prismaUnfiltered.room.update({ where: { id: rooms['101'].id }, data: { housekeepingStatus: 'DIRTY' } });
      const reservation = await seedReservation({ checkIn: 0, checkOut: 2 });

      const page = await service.getAssignableRooms(hotelId, reservation.id);
      const recommended = page.items.find((room) => room.recommended);
      assert.equal(recommended.number, '102');
      assert.equal(page.recommendedRoomId, rooms['102'].id);
    });

    it('ileri tarihli konaklamada odanın bugünkü kirliliği önemsenmez', async () => {
      await prismaUnfiltered.room.update({ where: { id: rooms['101'].id }, data: { housekeepingStatus: 'DIRTY' } });
      const reservation = await seedReservation({ checkIn: 30, checkOut: 32 });

      const page = await service.getAssignableRooms(hotelId, reservation.id);
      assert.equal(page.items.find((room) => room.recommended).number, '101');
    });

    it('farklı tipler sınıfıyla etiketlenir, alt sınıf "upgrade" görünmez', async () => {
      const stdGuest = await seedReservation();
      const upgrade = await service.getAssignableRooms(hotelId, stdGuest.id, { includeOtherTypes: true });
      assert.equal(upgrade.items.find((room) => room.number === '201').kind, 'UPGRADE');

      const dlxGuest = await seedReservation({ roomTypeId: dlxTypeId, checkIn: 20, checkOut: 22 });
      const downgrade = await service.getAssignableRooms(hotelId, dlxGuest.id, { includeOtherTypes: true });
      assert.equal(downgrade.items.find((room) => room.number === '101').kind, 'DOWNGRADE');
    });

    it('kapasitesi yetmeyen tip listelenmez ve atanamaz', async () => {
      const bigFamily = await seedReservation({ adults: 2, children: 1 });

      const page = await service.getAssignableRooms(hotelId, bigFamily.id, { includeOtherTypes: true });
      assert.ok(!page.items.some((room) => room.number === '201'), 'Deluxe çocuk kabul etmiyor');

      await assert.rejects(
        () => asUser(() => service.assignRoom(hotelId, bigFamily.id, rooms['201'].id)),
        (error) => error.code === 'CAPACITY_EXCEEDED',
      );
    });

    it('hedef tipte overbooking yaratan upgrade reddedilir ve listelenmez', async () => {
      // Deluxe'ün tek odası var ve onu bekleyen atanmamış bir Deluxe misafiri var.
      await seedReservation({ roomTypeId: dlxTypeId });
      const stdGuest = await seedReservation();

      const page = await service.getAssignableRooms(hotelId, stdGuest.id, { includeOtherTypes: true });
      assert.ok(!page.items.some((room) => room.number === '201'));

      await assert.rejects(
        () => asUser(() => service.assignRoom(hotelId, stdGuest.id, rooms['201'].id)),
        (error) => error.code === 'WOULD_OVERBOOK',
      );
    });

    it('zaten overbook olan tipte aynı tipe yerleştirme engellenmez', async () => {
      for (let i = 0; i < 4; i += 1) await seedReservation();
      const reservation = await seedReservation();
      assert.equal(await availability(10, 13), -2);

      await assert.doesNotReject(() => asUser(() => service.assignRoom(hotelId, reservation.id, rooms['101'].id)));
    });

    it('otomatik atama en uygun odayı seçer', async () => {
      await prismaUnfiltered.room.update({ where: { id: rooms['101'].id }, data: { housekeepingStatus: 'DIRTY' } });
      const reservation = await seedReservation({ checkIn: 0, checkOut: 2 });

      const result = await asUser(() => service.autoAssignRoom(hotelId, reservation.id));
      assert.equal(result.assigned, true);
      assert.equal(result.room.number, '102');
    });

    it('eşzamanlı iki otomatik atama aynı odayı almaz', async () => {
      const first = await seedReservation();
      const second = await seedReservation();

      const [a, b] = await Promise.all([
        asUser(() => service.autoAssignRoom(hotelId, first.id)),
        asUser(() => service.autoAssignRoom(hotelId, second.id)),
      ]);

      assert.equal(a.assigned, true);
      assert.equal(b.assigned, true);
      assert.notEqual(a.room.id, b.room.id);
    });

    it('boş oda yoksa otomatik atama sebebiyle birlikte başarısız olur', async () => {
      for (const number of ['101', '102', '103']) await seedReservation({ roomId: rooms[number].id });
      const reservation = await seedReservation();

      const result = await asUser(() => service.autoAssignRoom(hotelId, reservation.id));
      assert.equal(result.assigned, false);
      assert.match(result.reason, /bulunamadı/);
    });

    it('oda değiştirmede eski oda serbest kalır', async () => {
      const reservation = await seedReservation();
      await asUser(() => service.assignRoom(hotelId, reservation.id, rooms['101'].id));
      await asUser(() => service.assignRoom(hotelId, reservation.id, rooms['102'].id));

      const page = await service.getAssignableRooms(hotelId, reservation.id);
      assert.ok(page.items.some((room) => room.number === '101'));
    });

    it('giriş yapmış misafirin odası kaldırılamaz', async () => {
      const reservation = await seedReservation({ roomId: rooms['101'].id, status: 'CHECKED_IN', checkIn: -1, checkOut: 2 });
      await assert.rejects(
        () => asUser(() => service.unassignRoom(hotelId, reservation.id)),
        (error) => error.code === 'GUEST_IN_ROOM',
      );
    });

    it('atama bekleyenler listesi girişi yakın olanı öne alır, bitmiş konaklamayı göstermez', async () => {
      await seedReservation({ checkIn: 40, checkOut: 42, code: 'GEC' });
      await seedReservation({ checkIn: 10, checkOut: 13, code: 'YAKIN' });
      await seedReservation({ checkIn: -5, checkOut: -2, code: 'GECMIS' });

      const page = await service.listUnassignedReservations(hotelId, { page: 1, pageSize: 25 });
      assert.deepEqual(page.items.map((item) => item.confirmationCode), ['YAKIN', 'GEC']);
    });
  });

  describe('oda durumu', () => {
    it('misafir içerideyken kat hizmeti değişir ama oda boş görünmez (canlıda bulunan hata)', async () => {
      await service.applySystemRoomState(hotelId, rooms['101'].id, { occupancy: 'OCCUPIED', housekeepingStatus: 'DIRTY' }, 'Test');
      const room = await roomRow('101');

      const updated = await asUser(() =>
        service.setHousekeepingStatus(hotelId, rooms['101'].id, { status: 'CLEAN', expectedUpdatedAt: room.updatedAt }),
      );
      assert.equal(updated.housekeepingStatus, 'CLEAN');
      assert.equal(updated.occupancy, 'OCCUPIED', 'temizlenen dolu oda dolu kalmalı');
    });

    it('kirli odaya "kontrol edildi" denemez', async () => {
      await prismaUnfiltered.room.update({ where: { id: rooms['101'].id }, data: { housekeepingStatus: 'DIRTY' } });
      const room = await roomRow('101');
      await assert.rejects(
        () =>
          asUser(() =>
            service.setHousekeepingStatus(hotelId, rooms['101'].id, { status: 'INSPECTED', expectedUpdatedAt: room.updatedAt }),
          ),
        (error) => error.code === 'INVALID_TRANSITION',
      );
    });

    it('arızalı odanın kat hizmeti durumu değiştirilebilir (tadilat sonrası temizlik)', async () => {
      await insertBlock({ roomId: rooms['101'].id, start: -1, end: null });
      const room = await roomRow('101');
      const updated = await asUser(() =>
        service.setHousekeepingStatus(hotelId, rooms['101'].id, { status: 'DIRTY', expectedUpdatedAt: room.updatedAt }),
      );
      assert.equal(updated.housekeepingStatus, 'DIRTY');
      assert.equal(updated.condition, 'OUT_OF_ORDER');
    });

    it('bayat sürümle kat hizmeti güncellemesi 409 verir', async () => {
      const room = await roomRow('101');
      await asUser(() =>
        service.setHousekeepingStatus(hotelId, rooms['101'].id, { status: 'DIRTY', expectedUpdatedAt: room.updatedAt }),
      );
      await assert.rejects(
        () =>
          asUser(() =>
            service.setHousekeepingStatus(hotelId, rooms['101'].id, { status: 'CLEANING', expectedUpdatedAt: room.updatedAt }),
          ),
        (error) => error.code === 'STALE_WRITE',
      );
    });

    it('çıkışta oda boş ve kirli olur, iki ayrı event yayınlanır', async () => {
      await service.applySystemRoomState(hotelId, rooms['101'].id, { occupancy: 'OCCUPIED' }, 'Misafir giriş yaptı');
      const result = await service.applySystemRoomState(
        hotelId,
        rooms['101'].id,
        { occupancy: 'VACANT', housekeepingStatus: 'DIRTY' },
        'Misafir çıkış yaptı',
      );

      assert.deepEqual(result.changed.sort(), ['housekeepingStatus', 'occupancy']);
      const row = await roomRow('101');
      assert.equal(row.occupancy, 'VACANT');
      assert.equal(row.housekeepingStatus, 'DIRTY');

      const events = await prismaUnfiltered.eventLog.findMany({ where: { name: 'room.status.changed' } });
      assert.deepEqual(events.map((event) => event.payload.field).sort(), ['housekeeping', 'occupancy', 'occupancy']);
    });

    it('oda listesi bugünkü arıza durumunu verir ve filtreler; ileri tarihli kayıt bugün etkin sayılmaz', async () => {
      await block('101', { start: 0, end: 5 });
      await block('102', { start: 10, end: 12, type: 'OUT_OF_SERVICE' });

      const all = await service.listRooms(hotelId, { page: 1, pageSize: 25 });
      const byNumber = Object.fromEntries(all.items.map((room) => [room.number, room]));
      assert.equal(byNumber['101'].condition, 'OUT_OF_ORDER');
      assert.equal(byNumber['101'].currentBlock.startDate, day(0));
      assert.equal(byNumber['102'].condition, 'IN_SERVICE');
      assert.equal(byNumber['102'].openBlockCount, 1);

      const outOfOrder = await service.listRooms(hotelId, { page: 1, pageSize: 25, condition: 'OUT_OF_ORDER' });
      assert.deepEqual(outOfOrder.items.map((room) => room.number), ['101']);

      const inService = await service.listRooms(hotelId, { page: 1, pageSize: 25, condition: 'IN_SERVICE' });
      assert.deepEqual(inService.items.map((room) => room.number), ['102', '103', '201']);
    });
  });

  describe('oda yaşam döngüsü', () => {
    it('silinen oda numarası tekrar kullanılabilir', async () => {
      await asUser(() => service.deleteRoom(hotelId, rooms['103'].id));
      const recreated = await asUser(() =>
        service.createRoom(hotelId, { number: '103', floor: 1, roomTypeId: stdTypeId, notes: null }),
      );
      assert.equal(recreated.number, '103');
      assert.equal(recreated.housekeepingStatus, 'CLEAN');
      assert.equal(recreated.occupancy, 'VACANT');
    });

    it('aktif rezervasyonu olan oda silinemez', async () => {
      await seedReservation({ roomId: rooms['101'].id });
      await assert.rejects(
        () => asUser(() => service.deleteRoom(hotelId, rooms['101'].id)),
        (error) => error.code === 'IN_USE' && error.details.usage.aktifRezervasyon === 1,
      );
    });

    it('geçmişte arızalı olmuş oda silinebilir (eski kayıtlar engel değil)', async () => {
      await insertBlock({ roomId: rooms['103'].id, start: -30, end: -20 });
      await assert.doesNotReject(() => asUser(() => service.deleteRoom(hotelId, rooms['103'].id)));
    });

    it('açık arıza kayıtları odayla birlikte kapanır', async () => {
      const running = await insertBlock({ roomId: rooms['103'].id, start: -2, end: 10 });
      const upcoming = await block('103', { start: 30, end: 35 });
      await asUser(() => service.deleteRoom(hotelId, rooms['103'].id));

      const endedRow = await prismaUnfiltered.roomBlock.findUnique({ where: { id: running.id } });
      assert.equal(core.toIsoDay(endedRow.endDate), day(0), 'süren kayıt bugün biter');
      const cancelledRow = await prismaUnfiltered.roomBlock.findUnique({ where: { id: upcoming.id } });
      assert.ok(cancelledRow.deletedAt, 'başlamamış kayıt iptal edilir');
    });

    it('odayı silmek overbooking yaratacaksa reddedilir', async () => {
      for (let i = 0; i < 3; i += 1) await seedReservation({ checkIn: 50, checkOut: 52 });
      await assert.rejects(
        () => asUser(() => service.deleteRoom(hotelId, rooms['103'].id)),
        (error) => error.code === 'WOULD_OVERBOOK' && /silmek/.test(error.message),
      );
    });

    it('oda tipini değiştirmek eski tipte overbooking yaratacaksa reddedilir', async () => {
      for (let i = 0; i < 3; i += 1) await seedReservation();
      const room = await roomRow('103');
      await assert.rejects(
        () =>
          asUser(() =>
            service.updateRoom(hotelId, rooms['103'].id, {
              number: '103',
              floor: 1,
              roomTypeId: dlxTypeId,
              notes: null,
              expectedUpdatedAt: room.updatedAt,
            }),
          ),
        (error) => error.code === 'WOULD_OVERBOOK',
      );
    });
  });
});
