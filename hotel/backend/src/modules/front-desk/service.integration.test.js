import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Check-in / check-out (modül 6) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan, yalnızca veritabanıyla doğrulanabilen davranışlar: girişin odayı
 * aynı işlemde vermesi, odada hâlâ misafir varken ya da oda kirliyken girişin
 * durması, kimlik politikası ve refakatçinin belgesinden tanınması, aynı
 * konaklamaya aynı anda iki giriş, otel saatine göre erken giriş / geç çıkış
 * ücreti ve "görülen tutar" koruması, erken ayrılışta gecelerin ve envanterin
 * geri dönmesi, folyo bakiyesi ve bakiyeyle çıkış, aynı gün geri alma, listeler
 * ve özet, kimlik numarasının maskelenmesi.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const DESK = 'resepsiyon@test.local';
const TC = '10000000146';
const TC_OTHER = '10000000078';

describe('check-in / check-out (entegrasyon)', { skip }, () => {
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let reservations;
  /** @type {any} */ let rooms;
  /** @type {any} */ let frontDesk;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  /** @type {Record<string, any>} */ let types;
  /** @type {Record<string, any>} */ let room;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    reservations = await import('../reservations/service.js');
    rooms = await import('../rooms/service.js');
    frontDesk = await import('./service.js');
    cache = await import('../../lib/cache.js');
  });

  after(async () => {
    await db?.$disconnect();
  });

  const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: DESK }, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const day = (offset) => core.toIsoDay(core.addDays(today(), offset));
  /** Otelin saatiyle bugün (ya da `offset` gün sonra) SS:DD. */
  const at = (time, offset = 0) => contracts.zonedWallTimeToUtc(`${day(offset)}T${time}`, ZONE);
  const MORNING = () => at('09:00');
  const AFTERNOON = () => at('16:00');
  const eventsNamed = async (name) =>
    db.eventLog.findMany({ where: { hotelId, name }, orderBy: { occurredAt: 'asc' }, select: { payload: true } });

  beforeEach(async () => {
    await resetDatabase(db);
    reservations.clearReservationCache();
    frontDesk.clearFrontDeskCache();
    cache.cache.invalidatePrefix('settings:');
    const hotel = await db.hotel.create({
      data: {
        name: 'Deniz Otel',
        code: `F${randomUUID().slice(0, 5).toUpperCase()}`,
        timezone: ZONE,
        phoneCountryCode: '90',
        checkInTime: '14:00',
        checkOutTime: '12:00',
        earlyCheckInFeeMode: 'PERCENT_OF_NIGHT',
        earlyCheckInFeeValue: '50',
        lateCheckOutFeeMode: 'FIXED',
        lateCheckOutFeeValue: '400',
      },
    });
    hotelId = hotel.id;
    await db.user.create({ data: { hotelId, email: DESK, name: 'Resepsiyon', passwordHash: 'x', role: 'FRONT_DESK' } });
    types = {
      std: await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 3, capacityChildren: 1 } }),
    };
    room = {
      101: await db.room.create({ data: { hotelId, number: '101', roomTypeId: types.std.id } }),
      102: await db.room.create({ data: { hotelId, number: '102', roomTypeId: types.std.id } }),
    };
  });

  /** Rezervasyon (modül 4 servisiyle: geceler ve fiyat gerçek). */
  async function book({ checkIn = 0, nights = 2, roomId = room[101].id, adults = 2, children = 0, guest = {} } = {}) {
    const result = await as(() =>
      reservations.createReservation(hotelId, {
        guestId: null,
        guest: { firstName: 'Ayşe', lastName: 'Yılmaz', phone: `+90532${String(Math.random()).slice(2, 9)}`, email: null, nationality: 'TR', ...guest },
        forceNewGuest: true,
        roomTypeId: types.std.id,
        adults,
        children,
        boardType: 'BB',
        checkIn: new Date(day(checkIn)),
        checkOut: new Date(day(checkIn + nights)),
        status: 'CONFIRMED',
        source: 'PHONE',
        notes: null,
        requestId: randomUUID(),
        waitlistId: null,
        roomId,
        manualTotal: null,
        priceNote: null,
      }),
    );
    return result.reservation;
  }

  const version = async (id) => (await db.reservation.findUnique({ where: { id } })).updatedAt;

  /** Hata kodu ve detayın verilen alanları (detayın tamamı değil). */
  async function rejectsWith(promise, code, details = {}) {
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, code, error.message);
      for (const [key, value] of Object.entries(details)) assert.deepEqual(error.details?.[key], value, key);
      return true;
    });
  }

  const checkInInput = async (reservationId, overrides = {}) =>
    contracts.checkInSchema.parse({
      expectedUpdatedAt: await version(reservationId),
      guest: { idType: 'NATIONAL_ID', idNumber: TC, nationality: 'TR' },
      ...overrides,
    });

  const doCheckIn = async (reservationId, overrides = {}, now = AFTERNOON()) =>
    as(async () => frontDesk.checkIn(hotelId, reservationId, await checkInInput(reservationId, overrides), { now }));

  const doCheckOut = async (reservationId, overrides = {}, options = {}) =>
    as(async () =>
      frontDesk.checkOut(
        hotelId,
        reservationId,
        contracts.checkOutSchema.parse({ expectedUpdatedAt: await version(reservationId), ...overrides }),
        { now: at('11:00'), ...options },
      ),
    );

  /** Konaklamayı içeride hâline getirir (dünden beri, çıkışı `checkOut` gün sonra). */
  async function seedInHouse({ checkInOffset = -1, checkOutOffset = 1, roomId = room[101].id, totalPrice = '2000.00' } = {}) {
    const guest = await db.guest.create({ data: { hotelId, firstName: 'Mehmet', lastName: 'Kaya', idType: 'NATIONAL_ID', idNumber: TC_OTHER, nationality: 'TR' } });
    const stay = await db.reservation.create({
      data: {
        hotelId,
        guestId: guest.id,
        roomTypeId: types.std.id,
        roomId,
        checkIn: new Date(day(checkInOffset)),
        checkOut: new Date(day(checkOutOffset)),
        status: 'CHECKED_IN',
        checkedInAt: at('15:00', checkInOffset),
        checkedInBy: DESK,
        confirmedAt: new Date(),
        totalPrice,
        confirmationCode: `H${randomUUID().slice(0, 7).toUpperCase()}`,
      },
    });
    const nights = core.eachNight(stay.checkIn, stay.checkOut);
    await db.reservationNight.createMany({
      data: nights.map((date) => ({ hotelId, reservationId: stay.id, date, amount: core.toMoneyString(core.toDecimal(totalPrice).dividedBy(nights.length)) })),
    });
    return stay;
  }

  /** Folyo: kalemler ve ödemeler. */
  async function seedFolio(reservation, { charges = [], payments = [] } = {}) {
    const folio = await db.folio.create({ data: { hotelId, reservationId: reservation.id, guestId: reservation.guestId } });
    for (const amount of charges) {
      await db.folioItem.create({ data: { hotelId, folioId: folio.id, type: 'ROOM', description: 'Oda', amount, postedBy: 'test' } });
    }
    for (const amount of payments) {
      await db.payment.create({ data: { hotelId, folioId: folio.id, method: 'CARD', amount, receivedBy: 'test' } });
    }
    return folio;
  }

  describe('giriş', () => {
    it('misafir içeride: zaman ve personel, kimlik, sahibi bağlantısı, olay; denetim izinde kimlik maskeli', async () => {
      const reservation = await book();
      const result = await doCheckIn(reservation.id, { vehiclePlate: '34 abc 123', deposit: { method: 'CASH', amount: '500' } });

      assert.equal(result.status, 'CHECKED_IN');
      assert.equal(result.checkedInBy, DESK);
      const row = await db.reservation.findUnique({ where: { id: reservation.id }, include: { guest: true, reservationGuests: true } });
      assert.equal(row.vehiclePlate, '34 ABC 123');
      assert.equal(row.depositMethod, 'CASH');
      assert.equal(row.depositAmount.toString(), '500');
      assert.equal(row.guest.idNumber, TC);
      assert.equal(row.guest.idType, 'NATIONAL_ID');
      assert.deepEqual(row.reservationGuests.map((link) => [link.guestId, link.isPrimary]), [[row.guestId, true]]);

      const [event] = await eventsNamed('guest.checked_in');
      assert.equal(event.payload.roomId, room[101].id);
      assert.equal(event.payload.guestId, row.guestId);
      assert.deepEqual(event.payload.deposit, { method: 'CASH', amount: '500.00', reference: null });
      assert.equal(event.payload.earlyCheckInFee, null);

      const audit = await db.auditLog.findFirst({ where: { hotelId, entityId: reservation.id }, orderBy: { createdAt: 'desc' } });
      assert.equal(audit.after.guestIdentity.idNumber, '100••••••46');
      assert.ok(!JSON.stringify(audit.after).includes(TC), 'tam kimlik numarası denetim izine yazılmamalı');
    });

    it('giriş günü gelmemiş rezervasyona giriş olmaz', async () => {
      const reservation = await book({ checkIn: 2 });
      await assert.rejects(doCheckIn(reservation.id), { code: 'INVALID_STATUS', message: /Giriş günü gelmedi/ });
    });

    it('odası verilmemişse oda seçilmeden olmaz; seçilirse oda aynı işlemde verilir', async () => {
      const reservation = await book({ roomId: null });
      await assert.rejects(doCheckIn(reservation.id), { code: 'VALIDATION', message: /oda verilmemiş/ });

      const result = await doCheckIn(reservation.id, { roomId: room[102].id });
      assert.equal(result.status, 'CHECKED_IN');
      assert.equal(result.room.number, '102');
      assert.equal((await eventsNamed('room.assigned')).length, 1);
      assert.equal((await eventsNamed('guest.checked_in'))[0].payload.roomId, room[102].id);
    });

    it('kirli oda: personel onaylamadan giriş olmaz, onaylarsa olur (denetim izine yazılır)', async () => {
      const reservation = await book();
      await db.room.update({ where: { id: room[101].id }, data: { housekeepingStatus: 'DIRTY' } });
      await assert.rejects(doCheckIn(reservation.id), { code: 'ROOM_NOT_READY' });
      await doCheckIn(reservation.id, { acceptRoomNotReady: true });
      const audit = await db.auditLog.findFirst({ where: { hotelId, entityId: reservation.id }, orderBy: { createdAt: 'desc' } });
      assert.equal(audit.after.roomNotReadyAccepted, true);
    });

    it('odada önceki misafir hâlâ içerideyse giriş olmaz', async () => {
      await seedInHouse({ checkInOffset: -2, checkOutOffset: 0 });
      const reservation = await book();
      await assert.rejects(doCheckIn(reservation.id), { code: 'ROOM_OCCUPIED', message: /Mehmet Kaya/ });
    });

    it('aynı rezervasyona aynı anda iki giriş: biri olur, oda bir kez dolar', async () => {
      const reservation = await book();
      const input = await checkInInput(reservation.id);
      const results = await Promise.allSettled([
        as(() => frontDesk.checkIn(hotelId, reservation.id, input, { now: AFTERNOON() })),
        as(() => frontDesk.checkIn(hotelId, reservation.id, input, { now: AFTERNOON() })),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const failure = results.find((r) => r.status === 'rejected');
      assert.ok(['STALE_WRITE', 'INVALID_STATUS'].includes(failure.reason.code), failure.reason.code);
      assert.equal((await eventsNamed('guest.checked_in')).length, 1);
    });

    it('kimlik politikası "bütün yetişkinler": eksik yetişkin reddedilir; refakatçi belgesinden tanınır', async () => {
      await db.hotel.update({ where: { id: hotelId }, data: { checkInIdentityPolicy: 'ALL_ADULTS' } });
      cache.cache.invalidatePrefix('settings:');
      const reservation = await book({ adults: 2, children: 1 });
      await assert.rejects(doCheckIn(reservation.id), { code: 'VALIDATION', message: /1 yetişkinin kimliği eksik/ });

      // Belge numarası başka bir adla kayıtlı: yanlış yazılmış olabilir.
      const known = await db.guest.create({
        data: { hotelId, firstName: 'Can', lastName: 'Demir', idType: 'NATIONAL_ID', idNumber: TC_OTHER, nationality: 'TR', birthDate: new Date('1985-04-12') },
      });
      const companion = (firstName, lastName) => ({ firstName, lastName, idType: 'NATIONAL_ID', idNumber: TC_OTHER, nationality: 'TR' });
      await assert.rejects(doCheckIn(reservation.id, { companions: [companion('Ali', 'Veli')] }), { code: 'COMPANION_ID_MISMATCH' });

      await doCheckIn(reservation.id, { companions: [companion('Can', 'Demir'), { firstName: 'Ece', lastName: 'Yılmaz', isChild: true }] });
      const links = await db.reservationGuest.findMany({ where: { reservationId: reservation.id }, orderBy: { isPrimary: 'desc' } });
      assert.equal(links.length, 3);
      assert.ok(links.some((link) => link.guestId === known.id && !link.isPrimary), 'kayıtlı kart yeniden kullanılmalı');
      assert.equal(await db.guest.count({ where: { hotelId, idNumber: TC_OTHER } }), 1);
      // Formda boş bırakılan doğum tarihi kayıtlı olanı silmez.
      assert.equal(core.toIsoDay((await db.guest.findUnique({ where: { id: known.id } })).birthDate), '1985-04-12');
    });

    it('erken giriş: otelin saatiyle 14:00 öncesi ilk gecenin %50\'si; görülen tutar tutmazsa yazılmaz; uygulanmayabilir', async () => {
      const reservation = await book();
      await rejectsWith(doCheckIn(reservation.id, {}, MORNING()), 'FEE_CHANGED', { earlyCheckInFee: '500.00' });

      const preview = await frontDesk.getCheckInPreview(hotelId, reservation.id, { now: MORNING() });
      assert.deepEqual([preview.earlyCheckIn.applies, preview.earlyCheckIn.fee], [true, '500.00']);

      await doCheckIn(reservation.id, { expectedEarlyFee: '500' }, MORNING());
      const [event] = await eventsNamed('guest.checked_in');
      assert.equal(event.payload.earlyCheckInFee, '500.00');
      assert.equal((await db.reservation.findUnique({ where: { id: reservation.id } })).earlyCheckInFee.toString(), '500');
    });

    it('erken giriş ücreti uygulanmazsa sıfır yazılmaz, denetim izinde "uygulanmadı"', async () => {
      const reservation = await book();
      await doCheckIn(reservation.id, { waiveEarlyFee: true }, MORNING());
      const row = await db.reservation.findUnique({ where: { id: reservation.id } });
      assert.equal(row.earlyCheckInFee, null);
      const audit = await db.auditLog.findFirst({ where: { hotelId, entityId: reservation.id }, orderBy: { createdAt: 'desc' } });
      assert.equal(audit.after.earlyFeeWaived, true);
      assert.equal(audit.after.earlyCheckInPolicyFee, '500.00');
    });
  });

  describe('çıkış', () => {
    it('zamanında çıkış: oda olayı, bakiye bilinmiyor (folyo yok) ama çıkış olur', async () => {
      const stay = await seedInHouse({ checkOutOffset: 0 });
      const preview = await frontDesk.getCheckOutPreview(hotelId, stay.id, { now: at('11:00') });
      assert.equal(preview.departure.kind, 'ON_TIME');
      assert.equal(preview.folio, null);
      assert.equal(preview.due, null);

      const result = await doCheckOut(stay.id);
      assert.equal(result.status, 'CHECKED_OUT');
      const [event] = await eventsNamed('guest.checked_out');
      assert.deepEqual(
        [event.payload.roomId, event.payload.earlyDeparture, event.payload.lateCheckOutFee, event.payload.openBalance],
        [room[101].id, false, null, null],
      );
    });

    it('erken ayrılış: onaysız olmaz; onayla bugünden sonraki geceler bırakılır, fiyat düşer, oda satışa döner', async () => {
      const stay = await seedInHouse({ checkInOffset: -1, checkOutOffset: 3, totalPrice: '4000.00' });
      const busy = await rooms.checkAvailability(hotelId, { checkIn: new Date(day(1)), checkOut: new Date(day(2)), roomTypeId: types.std.id });

      await rejectsWith(doCheckOut(stay.id), 'EARLY_DEPARTURE', { releasedNights: [day(0), day(1), day(2)], totalPrice: '1000.00' });
      await doCheckOut(stay.id, { confirmEarlyDeparture: true });

      const row = await db.reservation.findUnique({ where: { id: stay.id }, include: { nights: true } });
      assert.equal(core.toIsoDay(row.checkOut), day(0));
      assert.equal(row.totalPrice.toString(), '1000');
      assert.equal(row.nights.length, 1);
      const free = await rooms.checkAvailability(hotelId, { checkIn: new Date(day(1)), checkOut: new Date(day(2)), roomTypeId: types.std.id });
      assert.equal(free, busy + 1, 'bırakılan gece satışa dönmeli');
      const [event] = await eventsNamed('guest.checked_out');
      assert.equal(event.payload.earlyDeparture, true);
    });

    it('geç çıkış: 12:00 sonrası sabit ücret; görülen tutar yoksa FEE_CHANGED; önceden ücret yok', async () => {
      const stay = await seedInHouse({ checkOutOffset: 0 });
      await rejectsWith(doCheckOut(stay.id, {}, { now: at('13:30') }), 'FEE_CHANGED', { lateCheckOutFee: '400.00' });
      await doCheckOut(stay.id, { expectedLateFee: '400' }, { now: at('13:30') });
      const [event] = await eventsNamed('guest.checked_out');
      assert.equal(event.payload.lateCheckOutFee, '400.00');
    });

    it('bakiye: borç varsa çıkış olmaz; yetkisi olmayan bakiyeyle çıkamaz; yetkili gerekçeyle çıkar, yönetime uyarı düşer', async () => {
      const stay = await seedInHouse({ checkOutOffset: 0 });
      await seedFolio(stay, { charges: ['2000.00', '150.00'], payments: ['1500.00'] });

      await rejectsWith(doCheckOut(stay.id), 'BALANCE_DUE', { due: '650.00', balance: '650.00' });
      await assert.rejects(
        doCheckOut(stay.id, { allowOpenBalance: true, openBalanceReason: 'Şirket ay sonunda ödeyecek' }),
        { code: 'FORBIDDEN' },
      );
      await doCheckOut(stay.id, { allowOpenBalance: true, openBalanceReason: 'Şirket ay sonunda ödeyecek' }, { canAllowOpenBalance: true });

      const row = await db.reservation.findUnique({ where: { id: stay.id } });
      assert.equal(row.checkoutOpenBalance.toString(), '650');
      assert.equal(row.openBalanceReason, 'Şirket ay sonunda ödeyecek');
      const alert = await db.staffAlert.findFirst({ where: { hotelId, kind: 'CHECKOUT_OPEN_BALANCE' } });
      assert.equal(alert.permission, 'stays.checkout_open_balance');
      assert.match(alert.body, /650\.00/);
      const [event] = await eventsNamed('guest.checked_out');
      assert.equal(event.payload.openBalance, '650.00');
    });

    it('bakiye kapanmışsa (ödeme = kalem) çıkış olur; geç çıkış ücreti bakiyeye eklenir', async () => {
      const stay = await seedInHouse({ checkOutOffset: 0 });
      await seedFolio(stay, { charges: ['2000.00'], payments: ['2000.00'] });
      await doCheckOut(stay.id);
      assert.equal((await db.reservation.findUnique({ where: { id: stay.id } })).status, 'CHECKED_OUT');

      const late = await seedInHouse({ checkOutOffset: 0, roomId: room[102].id });
      await seedFolio(late, { charges: ['2000.00'], payments: ['2000.00'] });
      await rejectsWith(doCheckOut(late.id, { expectedLateFee: '400' }, { now: at('13:00') }), 'BALANCE_DUE', { due: '400.00', balance: '0.00' });
    });
  });

  describe('geri alma', () => {
    it('giriş aynı gün geri alınır: onaylıya döner, oda boşalır (olay); ertesi gün alınmaz', async () => {
      const reservation = await book();
      await doCheckIn(reservation.id);
      const revert = async (now) =>
        as(async () =>
          frontDesk.revertCheckIn(hotelId, reservation.id, { expectedUpdatedAt: await version(reservation.id), reason: 'Yanlış misafir' }, { now }),
        );

      await assert.rejects(revert(at('10:00', 1)), { code: 'REVERT_WINDOW_CLOSED' });
      const result = await revert(at('18:00'));
      assert.equal(result.status, 'CONFIRMED');
      assert.equal(result.checkedInAt, null);
      const [event] = await eventsNamed('guest.check_in_reverted');
      assert.equal(event.payload.reason, 'Yanlış misafir');
      // Yeniden giriş aynı odaya yapılabilir.
      assert.equal((await doCheckIn(reservation.id)).status, 'CHECKED_IN');
    });

    it('folyoda hareket varsa giriş geri alınmaz', async () => {
      const reservation = await book();
      await doCheckIn(reservation.id);
      await seedFolio(await db.reservation.findUnique({ where: { id: reservation.id } }), { charges: ['100.00'] });
      await assert.rejects(
        as(async () => frontDesk.revertCheckIn(hotelId, reservation.id, { expectedUpdatedAt: await version(reservation.id), reason: 'x' }, { now: AFTERNOON() })),
        { code: 'FOLIO_ACTIVITY' },
      );
    });

    it('çıkış aynı gün geri alınır; oda bu arada başka misafire girişle verildiyse alınmaz', async () => {
      const stay = await seedInHouse({ checkOutOffset: 0 });
      await doCheckOut(stay.id);
      const next = await book({ checkIn: 0, nights: 1 });
      await doCheckIn(next.id);

      const revert = async () =>
        as(async () => frontDesk.revertCheckOut(hotelId, stay.id, { expectedUpdatedAt: await version(stay.id), reason: 'Misafir çıkmamış' }, { now: at('17:00') }));
      await assert.rejects(revert(), { code: 'ROOM_OCCUPIED' });

      await as(async () => frontDesk.revertCheckIn(hotelId, next.id, { expectedUpdatedAt: await version(next.id), reason: 'Yanlış oda' }, { now: at('17:00') }));
      const result = await revert();
      assert.equal(result.status, 'CHECKED_IN');
      assert.equal(result.checkedOutAt, null);
      assert.equal((await eventsNamed('guest.check_out_reverted')).length, 1);
    });
  });

  describe('listeler ve özet', () => {
    it('gelecekler (geç gelen üstte, oda hazırlığı), bugün girenler, gidecekler (gecikmiş), konaklayanlar, özet', async () => {
      const late = await seedInHouse({ checkInOffset: -3, checkOutOffset: -1 }); // çıkışı dün: gecikmiş
      const departing = await seedInHouse({ checkInOffset: -1, checkOutOffset: 0, roomId: room[102].id });
      const lateArrival = await db.reservation.create({
        data: {
          hotelId,
          guestId: departing.guestId,
          roomTypeId: types.std.id,
          checkIn: new Date(day(-1)),
          checkOut: new Date(day(2)),
          status: 'CONFIRMED',
          totalPrice: '3000',
          confirmationCode: `L${randomUUID().slice(0, 7).toUpperCase()}`,
        },
      });
      const arriving = await book({ roomId: null, checkIn: 0, nights: 1, guest: { firstName: 'Zeynep', lastName: 'Ak' } });

      const arrivals = await frontDesk.listArrivals(hotelId, { view: 'EXPECTED', page: 1, pageSize: 20 }, { now: AFTERNOON() });
      assert.deepEqual(arrivals.items.map((row) => row.id), [lateArrival.id, arriving.id]);
      assert.equal(arrivals.items[0].lateArrival, true);
      assert.equal(arrivals.items[1].roomState, null);

      const search = await frontDesk.listArrivals(hotelId, { view: 'EXPECTED', search: 'zeynep', page: 1, pageSize: 20 }, { now: AFTERNOON() });
      assert.deepEqual(search.items.map((row) => row.id), [arriving.id]);

      const departures = await frontDesk.listDepartures(hotelId, { view: 'EXPECTED', page: 1, pageSize: 20 }, { now: AFTERNOON() });
      assert.deepEqual(departures.items.map((row) => row.id), [late.id, departing.id]);
      assert.equal(departures.items[0].overdue, true);
      assert.equal(departures.items[1].departsToday, true);
      assert.equal(departures.items[0].guest.idMasked, '100••••••78');
      assert.ok(!JSON.stringify(departures).includes(TC_OTHER), 'listede tam kimlik numarası olmamalı');

      await doCheckOut(departing.id, { expectedLateFee: '400' }, { now: AFTERNOON() });
      const checkedOut = await frontDesk.listDepartures(hotelId, { view: 'CHECKED_OUT', page: 1, pageSize: 20 }, { now: AFTERNOON() });
      assert.deepEqual(checkedOut.items.map((row) => [row.id, row.canRevertCheckOut]), [[departing.id, true]]);

      const inHouse = await frontDesk.listInHouse(hotelId, { sort: 'CHECK_OUT_ASC', page: 1, pageSize: 20 }, { now: AFTERNOON() });
      assert.deepEqual(inHouse.items.map((row) => row.id), [late.id]);

      frontDesk.clearFrontDeskCache();
      const summary = await frontDesk.getFrontDeskSummary(hotelId, { now: AFTERNOON() });
      assert.deepEqual(summary.arrivals, { expected: 2, unassigned: 2, checkedIn: 0 });
      assert.deepEqual(summary.departures, { expected: 1, overdue: 1, checkedOut: 1 });
      assert.equal(summary.inHouse, 1);
    });
  });
});
