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
 * geri dönmesi, folyo bakiyesi (işlenmemiş geceler dahil — modül 15) ve
 * bakiyeyle çıkış, aynı gün geri alma, listeler ve özet, kimlik numarasının
 * maskelenmesi.
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

  /**
   * Folyo (modül 15'in yazdığı biçimde): istenirse konaklamanın geceleri
   * işlenmiş (gece kalemleri), ek harcamalar ve ödemeler (modül 17'nin yazacağı).
   */
  async function seedFolio(reservation, { nights = false, extras = [], payments = [] } = {}) {
    const folio = await db.folio.create({ data: { hotelId, reservationId: reservation.id, guestId: reservation.guestId } });
    const item = (data) =>
      db.folioItem.create({
        data: {
          hotelId,
          folioId: folio.id,
          reservationId: reservation.id,
          quantity: 1,
          postedBy: 'test',
          serviceDate: new Date(day(0)),
          netAmount: data.amount,
          taxAmount: '0',
          total: data.amount,
          ...data,
        },
      });
    if (nights) {
      for (const night of await db.reservationNight.findMany({ where: { reservationId: reservation.id } })) {
        await item({
          type: 'ROOM',
          source: 'ROOM_NIGHT',
          description: 'Oda ücreti',
          amount: String(night.amount),
          serviceDate: night.date,
          sourceKey: `night:${reservation.id}:${core.toIsoDay(night.date)}`,
        });
      }
    }
    for (const amount of extras) await item({ type: 'MINIBAR', source: 'MANUAL', description: 'Minibar', amount });
    for (const amount of payments) {
      await db.payment.create({
        data: {
          hotelId,
          folioId: folio.id,
          reservationId: reservation.id,
          method: 'CARD',
          amount,
          folioAmount: amount,
          businessDate: new Date(day(0)),
          postedAt: new Date(),
          receivedBy: 'test',
        },
      });
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
    it('folyo yoksa işlenmemiş geceler ödenecek sayılır; ödeme yoksa çıkış olmaz', async () => {
      const stay = await seedInHouse({ checkOutOffset: 0 });
      const preview = await frontDesk.getCheckOutPreview(hotelId, stay.id, { now: at('11:00') });
      assert.equal(preview.folio, null);
      assert.equal(preview.due, '2000.00');
      assert.deepEqual(preview.pendingCharges.own.map((line) => [line.source, line.total]), [['ROOM_NIGHT', '2000.00']]);
      await rejectsWith(doCheckOut(stay.id), 'BALANCE_DUE', { due: '2000.00', balance: '0.00', pending: '2000.00' });
    });

    it('zamanında çıkış: ödeme gecelere yetiyorsa çıkış olur, oda olayı', async () => {
      const stay = await seedInHouse({ checkOutOffset: 0 });
      await seedFolio(stay, { payments: ['2000.00'] });
      const preview = await frontDesk.getCheckOutPreview(hotelId, stay.id, { now: at('11:00') });
      assert.equal(preview.departure.kind, 'ON_TIME');
      assert.equal(preview.due, '0.00');

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
      // Bırakılan geceler ödenecekten düşer: yalnızca kalan tek gece.
      const preview = await frontDesk.getCheckOutPreview(hotelId, stay.id, { now: at('11:00') });
      assert.equal(preview.due, '1000.00');
      await seedFolio(stay, { payments: ['1000.00'] });
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
      await seedFolio(stay, { nights: true, payments: ['2400.00'] });
      await rejectsWith(doCheckOut(stay.id, {}, { now: at('13:30') }), 'FEE_CHANGED', { lateCheckOutFee: '400.00' });
      const preview = await frontDesk.getCheckOutPreview(hotelId, stay.id, { now: at('13:30') });
      assert.deepEqual([preview.due, preview.dueWithoutLateFee], ['0.00', '-400.00']);
      await doCheckOut(stay.id, { expectedLateFee: '400' }, { now: at('13:30') });
      const [event] = await eventsNamed('guest.checked_out');
      assert.equal(event.payload.lateCheckOutFee, '400.00');
    });

    it('bakiye: borç varsa çıkış olmaz; yetkisi olmayan bakiyeyle çıkamaz; yetkili gerekçeyle çıkar, yönetime uyarı düşer', async () => {
      const stay = await seedInHouse({ checkOutOffset: 0 });
      await seedFolio(stay, { nights: true, extras: ['150.00'], payments: ['1500.00'] });

      await rejectsWith(doCheckOut(stay.id), 'BALANCE_DUE', { due: '650.00', balance: '650.00', pending: '0.00' });
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
      await seedFolio(stay, { nights: true, payments: ['2000.00'] });
      await doCheckOut(stay.id);
      assert.equal((await db.reservation.findUnique({ where: { id: stay.id } })).status, 'CHECKED_OUT');

      const late = await seedInHouse({ checkOutOffset: 0, roomId: room[102].id });
      await seedFolio(late, { nights: true, payments: ['2000.00'] });
      await rejectsWith(doCheckOut(late.id, { expectedLateFee: '400' }, { now: at('13:00') }), 'BALANCE_DUE', { due: '400.00', balance: '0.00' });
    });

    it('geç çıkış ücretine oda vergisi eklenir (hariç vergi): ödenecek vergili tutardır', async () => {
      await db.tax.create({ data: { hotelId, name: 'Konaklama vergisi', rate: '2', isIncluded: false, appliesTo: ['ROOM'] } });
      cache.cache.invalidatePrefix('settings:');
      const stay = await seedInHouse({ checkOutOffset: 0 });
      await seedFolio(stay, { nights: true, payments: ['2000.00'] });
      const preview = await frontDesk.getCheckOutPreview(hotelId, stay.id, { now: at('13:00') });
      // 400 + %2 = 408; gece kalemleri testte vergisiz işlendi (kalem, işlendiği andaki dökümü taşır).
      assert.deepEqual(preview.pendingCharges.own.map((line) => [line.source, line.total]), [['LATE_CHECK_OUT', '408.00']]);
      assert.equal(preview.due, '408.00');
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
      await seedFolio(await db.reservation.findUnique({ where: { id: reservation.id } }), { extras: ['100.00'] });
      await assert.rejects(
        as(async () => frontDesk.revertCheckIn(hotelId, reservation.id, { expectedUpdatedAt: await version(reservation.id), reason: 'x' }, { now: AFTERNOON() })),
        { code: 'FOLIO_ACTIVITY' },
      );
    });

    it('çıkış aynı gün geri alınır; oda bu arada başka misafire girişle verildiyse alınmaz', async () => {
      const stay = await seedInHouse({ checkOutOffset: 0 });
      await seedFolio(stay, { payments: ['2000.00'] });
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

      await seedFolio(departing, { payments: ['2400.00'] });
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

  describe('toplu çıkış', () => {
    it('bakiyesi kapalı olan çıkar; borçlu ve sürümü eskimiş olan atlanır, sebebiyle döner', async () => {
      const paid = await seedInHouse({ checkOutOffset: 0, roomId: room[101].id });
      await seedFolio(paid, { payments: ['2000.00'] });
      const owing = await seedInHouse({ checkOutOffset: 0, roomId: room[102].id });
      const result = await as(async () =>
        frontDesk.checkOutBatch(
          hotelId,
          [
            { id: paid.id, expectedUpdatedAt: await version(paid.id) },
            { id: owing.id, expectedUpdatedAt: await version(owing.id) },
            { id: owing.id, expectedUpdatedAt: new Date('2020-01-01T00:00:00Z') },
          ],
          { now: at('11:00') },
        ),
      );
      assert.deepEqual([result.succeeded, result.failed], [1, 2]);
      assert.deepEqual(result.results.map((row) => row.code ?? 'OK'), ['OK', 'BALANCE_DUE', 'STALE_WRITE']);
      assert.equal((await db.reservation.findUnique({ where: { id: paid.id } })).status, 'CHECKED_OUT');
      assert.equal((await db.reservation.findUnique({ where: { id: owing.id } })).status, 'CHECKED_IN');
    });
  });

  /* ══════════════════ Kimlik okuma (modül 59) ══════════════════ */

  describe('kimlik okuma (modül 59)', () => {
    const d = (text) => String(contracts.mrzCheckDigit(text));
    /** Sağlamaları hesaplı kurgusal TC kimlik kartı (TD1). */
    const tcCard = ({ tckn = TC, birth = '900115', name = 'YILMAZ<<AYSE' } = {}) => {
      const doc = 'A01B23456';
      const optional1 = tckn.padEnd(15, '<');
      const line1 = `I<TUR${doc}${d(doc)}${optional1}`;
      const optional2 = '<'.repeat(11);
      const expiry = '310101';
      const composite = d(`${line1.slice(5, 30)}${birth}${d(birth)}${expiry}${d(expiry)}${optional2}`);
      return [line1, `${birth}${d(birth)}F${expiry}${d(expiry)}TUR${optional2}${composite}`, name.padEnd(30, '<')].join('\n');
    };
    /** Kurgusal Alman pasaportu (TD3). */
    const dePassport = ({ doc = 'C01X00T47', birth = '850316', name = 'MUSTERMANN<<ERIKA' } = {}) => {
      const expiry = '330110';
      const personal = '<'.repeat(14);
      const line2 = `${doc}${d(doc)}D<<${birth}${d(birth)}F${expiry}${d(expiry)}${personal}<`;
      const composite = d(`${doc}${d(doc)}${birth}${d(birth)}${expiry}${d(expiry)}${personal}<`);
      return [`P<D<<${name}`.padEnd(44, '<'), `${line2}${composite}`].join('\n');
    };
    const TC_IDENTITY = { idType: 'NATIONAL_ID', idNumber: TC, nationality: 'TR', birthDate: '1990-01-15' };

    it('okunan kimlikle giriş: kart "kimlikten okundu", MRZ metni hiçbir yere yazılmaz', async () => {
      const stay = await book();
      await doCheckIn(stay.id, { guest: { ...TC_IDENTITY, documentRead: { mrz: tcCard(), via: 'STAFF_SCAN' } } });
      const guest = await db.guest.findUnique({ where: { id: stay.guest.id } });
      assert.equal(guest.idReadVia, 'STAFF_SCAN');
      assert.equal(guest.idReadBy, DESK);
      assert.ok(guest.idReadAt);
      assert.equal(core.toIsoDay(guest.birthDate), '1990-01-15');
      const audits = await db.auditLog.findMany({ where: { hotelId } });
      assert.ok(!JSON.stringify(audits).includes('I<TUR'), 'MRZ denetim izine yazılmaz');
      assert.ok(!JSON.stringify(audits).includes(TC), 'TC no denetim izinde açık değil');
    });

    it('okunandan değiştirilmiş kimlik ve sağlaması tutmayan okuma reddedilir', async () => {
      const stay = await book();
      await assert.rejects(
        doCheckIn(stay.id, { guest: { ...TC_IDENTITY, birthDate: '1990-01-16', documentRead: { mrz: tcCard(), via: 'STAFF_SCAN' } } }),
        (error) => error.code === 'VALIDATION' && /değiştirilmiş \(doğum tarihi\)/.test(error.message),
      );
      const broken = tcCard().replace('900115', '900116');
      await assert.rejects(
        doCheckIn(stay.id, { guest: { ...TC_IDENTITY, documentRead: { mrz: broken, via: 'STAFF_SCAN' } } }),
        (error) => error.code === 'VALIDATION' && /doğrulanamadı/.test(error.message),
      );
      assert.equal((await db.reservation.findUnique({ where: { id: stay.id } })).status, 'CONFIRMED', 'giriş yapılmadı');
    });

    it('girişte ad belgedeki gibi düzeltilir (denetim izine eski ad); refakatçi pasaportla okunur', async () => {
      const stay = await book({ guest: { firstName: 'Aise', lastName: 'Yilmas' } });
      await doCheckIn(stay.id, {
        guest: { ...TC_IDENTITY, documentRead: { mrz: tcCard(), via: 'ONLINE_PHOTO' } },
        guestName: { firstName: 'Ayşe', lastName: 'Yılmaz' },
        companions: [{ firstName: 'Erika', lastName: 'Mustermann', idType: 'PASSPORT', idNumber: 'C01X00T47', nationality: 'DE', birthDate: '1985-03-16', documentRead: { mrz: dePassport(), via: 'STAFF_SCAN' } }],
      });
      const guest = await db.guest.findUnique({ where: { id: stay.guest.id } });
      assert.deepEqual([guest.firstName, guest.lastName, guest.idReadVia], ['Ayşe', 'Yılmaz', 'ONLINE_PHOTO']);
      const rename = await db.auditLog.findFirst({ where: { hotelId, entity: 'Guest', entityId: guest.id, action: 'UPDATE' } });
      assert.equal(rename.before.firstName, 'Aise');
      const companion = await db.guest.findFirst({ where: { hotelId, idNumber: 'C01X00T47' } });
      assert.equal(companion.idReadVia, 'STAFF_SCAN');
    });

    it('elle değişen kimlik işareti siler; kimliğe dokunmayan düzenleme korur; aynı belge başka kartta bulunur', async () => {
      const crm = await import('../guests/service.js');
      const stay = await book();
      await doCheckIn(stay.id, { guest: { ...TC_IDENTITY, documentRead: { mrz: tcCard(), via: 'STAFF_SCAN' } } });
      const guestId = stay.guest.id;
      await as(() => crm.updateGuestCard(hotelId, guestId, contracts.guestCardUpdateSchema.parse({ tags: ['VIP'] })));
      assert.ok((await db.guest.findUnique({ where: { id: guestId } })).idReadAt, 'etiket değişikliği işareti silmez');
      await as(() => crm.updateGuestCard(hotelId, guestId, contracts.guestCardUpdateSchema.parse({ idType: 'NATIONAL_ID', idNumber: TC_OTHER, nationality: 'TR', birthDate: '1990-01-15' })));
      const edited = await db.guest.findUnique({ where: { id: guestId } });
      assert.equal(edited.idNumber, TC_OTHER);
      assert.equal(edited.idReadAt, null, 'elle değişen kimlik "okundu" sayılmaz');
      // Kart düzenlemede okuma: okunan kimlikle işaret geri gelir; denetim izinde numara maskeli.
      const card = await as(() => crm.updateGuestCard(hotelId, guestId, contracts.guestCardUpdateSchema.parse({ ...TC_IDENTITY, documentRead: { mrz: tcCard(), via: 'STAFF_SCAN' } })));
      assert.equal(card.idRead.via, 'STAFF_SCAN');
      const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'Guest', entityId: guestId }, orderBy: { createdAt: 'desc' } });
      assert.ok(!JSON.stringify(audit.after).includes(TC));
      // Geçersiz kimlik kartta da reddedilir (eskiden sessizce atlanıyordu).
      assert.throws(() => contracts.guestCardUpdateSchema.parse({ idType: 'NATIONAL_ID', idNumber: '12345678901', nationality: 'TR' }), /TC kimlik numarası geçersiz/);
      // Başka kartta aynı belge.
      const twin = await db.guest.create({ data: { hotelId, firstName: 'Ayşe', lastName: 'Yılmaz', idNumber: TC, nationality: null } });
      const matches = await crm.findIdentityMatches(hotelId, contracts.identityMatchQuerySchema.parse({ idNumber: TC, nationality: 'TR', excludeGuestIds: [guestId] }));
      assert.deepEqual(matches.items.map((row) => row.id), [twin.id]);
      assert.notEqual(matches.items[0].idNumber, TC, 'numara maskeli');
    });

    it('online check-in belgesi: okunan misafirin yazdığıyla karşılaştırılır; değerler değil sonuç saklanır', async () => {
      const portal = await import('../guest-portal/service.js');
      const stay = await book({ checkIn: 1 });
      const online = await db.onlineCheckin.create({
        data: {
          hotelId,
          reservationId: stay.id,
          status: 'SUBMITTED',
          arrivalDate: new Date(day(1)),
          searchText: 'x',
          guest: { idType: 'NATIONAL_ID', idNumber: TC, nationality: 'TR', birthDate: '1990-01-16' },
          companions: [{ firstName: 'Erika', lastName: 'Mustermann', isChild: false, idType: 'PASSPORT', idNumber: 'C01X00T47', nationality: 'DE', birthDate: '1985-03-16' }],
          paymentPreference: 'CARD_AT_DESK',
          language: 'tr',
          consents: {},
          signatureKey: 'x',
          submittedAt: new Date(Date.now() - 60_000),
        },
      });
      const doc = (person) => db.onlineCheckinDocument.create({ data: { hotelId, reservationId: stay.id, onlineCheckinId: online.id, person, contentType: 'image/jpeg', sizeBytes: 1, thumbBytes: 1 } });
      const [primary, companion, unread] = [await doc(0), await doc(1), await doc(1)];
      const first = await as(() => portal.recordDocumentOcr(hotelId, online.id, primary.id, { mrz: tcCard() }));
      assert.deepEqual([first.status, first.mismatch], ['MISMATCH', ['birthDate']]);
      const second = await as(() => portal.recordDocumentOcr(hotelId, online.id, companion.id, { mrz: dePassport() }));
      assert.equal(second.status, 'MATCH');
      const third = await as(() => portal.recordDocumentOcr(hotelId, online.id, unread.id, { mrz: null }));
      assert.equal(third.status, 'UNREADABLE');
      const detail = await portal.getOnlineCheckin(hotelId, online.id);
      assert.deepEqual(detail.documents.map((row) => row.ocr?.status), ['MISMATCH', 'MATCH', 'UNREADABLE']);
      assert.equal((await db.onlineCheckin.findUnique({ where: { id: online.id } })).updatedAt.getTime(), online.updatedAt.getTime(), 'online check-in sürümü ilerlemez');
      // Misafir yeniden gönderince eski okumalar eskir.
      await db.onlineCheckin.update({ where: { id: online.id }, data: { submittedAt: new Date(Date.now() + 60_000) } });
      assert.ok((await portal.getOnlineCheckin(hotelId, online.id)).documents.every((row) => row.ocr === null));
      // Silinmiş belge okunamaz; başka otel göremez.
      await db.onlineCheckinDocument.update({ where: { id: primary.id }, data: { purgedAt: new Date() } });
      await assert.rejects(as(() => portal.recordDocumentOcr(hotelId, online.id, primary.id, { mrz: tcCard() })), (error) => error.code === 'DOCUMENT_PURGED');
      const other = await db.hotel.create({ data: { name: 'Başka', code: `O${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE } });
      await assert.rejects(as(() => portal.recordDocumentOcr(other.id, online.id, companion.id, { mrz: dePassport() })), (error) => error.code === 'NOT_FOUND');
    });

    it('toplu girişte belgesiz kayıtlı refakatçi çocuk sayılır (Ali 30 düzeltmesi)', async () => {
      const stay = await book({ adults: 1, children: 1 });
      const child = await db.guest.create({ data: { hotelId, firstName: 'Can', lastName: 'Yılmaz' } });
      await db.guest.update({ where: { id: stay.guest.id }, data: { idType: 'NATIONAL_ID', idNumber: TC, nationality: 'TR' } });
      await db.reservationGuest.create({ data: { hotelId, reservationId: stay.id, guestId: child.id, isPrimary: false } });
      const result = await as(async () => frontDesk.checkInBatch(hotelId, [{ id: stay.id, expectedUpdatedAt: await version(stay.id) }], { now: AFTERNOON() }));
      assert.equal(result.succeeded, 1, JSON.stringify(result.results));
    });
  });
});
