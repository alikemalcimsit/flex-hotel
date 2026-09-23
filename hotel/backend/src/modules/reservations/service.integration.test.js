import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Rezervasyon yönetimi (modül 4) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan, yalnızca veritabanıyla doğrulanabilen davranışlar: son odaya aynı
 * anda gelen iki rezervasyondan birinin reddi, aynı isteğin iki kez
 * açılmaması, grubun ya hep ya hiç açılması, misafir eşleştirmesi, düzenlemede
 * anlaşılan fiyatın korunması ve oda atamasının bırakılması, iptal / gelmedi
 * ücretleri, geri almada kapasite denetimi, kapasite aşımının onay kuyruğuna
 * gidip onaylanınca açılması, bekleme listesinin yer açılınca uyarması,
 * liste / arama / sayım ve kanal isteği.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const ADMIN = 'yonetici@test.local';
const DESK = 'resepsiyon@test.local';

describe('rezervasyon yönetimi (entegrasyon)', { skip }, () => {
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let service;
  /** @type {any} */ let waitlist;
  /** @type {any} */ let subscribers;
  /** @type {any} */ let approvals;
  /** @type {any} */ let alerts;
  /** @type {any} */ let cache;
  /** @type {any} */ let contracts;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let hotelCode;
  let users;
  /** @type {Record<string, any>} */ let types;
  /** @type {Record<string, any>} */ let rooms;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    service = await import('./service.js');
    waitlist = await import('./waitlist.js');
    subscribers = await import('./subscribers.js');
    approvals = await import('../approvals/service.js');
    alerts = await import('../notifications/staff-alerts.js');
    cache = await import('../../lib/cache.js');
  });

  after(async () => {
    subscribers.stopReservationSubscribers();
    await db?.$disconnect();
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const day = (offset) => core.toIsoDay(core.addDays(today(), offset));
  const eventNames = async () =>
    (await db.eventLog.findMany({ where: { hotelId }, orderBy: { occurredAt: 'asc' }, select: { name: true } })).map((row) => row.name);

  beforeEach(async () => {
    await resetDatabase(db);
    service.clearReservationCache();
    hotelCode = `R${randomUUID().slice(0, 5).toUpperCase()}`;
    const hotel = await db.hotel.create({
      data: {
        name: 'Deniz Otel',
        code: hotelCode,
        timezone: ZONE,
        phoneCountryCode: '90',
        cancellationPolicyDays: 3,
        cancellationPolicyPenaltyPct: '50',
      },
    });
    hotelId = hotel.id;
    const user = (email, role) =>
      db.user.create({ data: { hotelId, email, name: email.split('@')[0], passwordHash: 'x', role } });
    users = { admin: await user(ADMIN, 'ADMIN'), desk: await user(DESK, 'FRONT_DESK') };

    const type = (code, basePrice, capacityAdults = 2, capacityChildren = 1) =>
      db.roomType.create({ data: { hotelId, code, name: `${code} oda`, basePrice, capacityAdults, capacityChildren } });
    types = { std: await type('STD', '1000'), dlx: await type('DLX', '2000', 3, 2), single: await type('SGL', '500', 1, 0) };
    const room = (number, typeRow) => db.room.create({ data: { hotelId, number, roomTypeId: typeRow.id } });
    rooms = {
      s1: await room('101', types.std),
      s2: await room('102', types.std),
      d1: await room('201', types.dlx),
      g1: await room('301', types.single),
    };
  });

  /** Rezervasyon isteği (tek oda). */
  const input = (overrides = {}) => ({
    guestId: null,
    guest: { firstName: 'Ayşe', lastName: 'Yılmaz', phone: '0532 111 00 01', email: 'ayse@example.com', nationality: 'TR' },
    forceNewGuest: false,
    roomTypeId: types.std.id,
    adults: 2,
    children: 0,
    boardType: 'BB',
    checkIn: new Date(day(10)),
    checkOut: new Date(day(13)),
    status: 'CONFIRMED',
    source: 'PHONE',
    notes: null,
    requestId: randomUUID(),
    waitlistId: null,
    roomId: null,
    manualTotal: null,
    priceNote: null,
    ...overrides,
  });

  const create = (overrides = {}, options = {}) => as(DESK, () => service.createReservation(hotelId, input(overrides), options));

  /** Bir tipi verilen tarihlerde doldurur (oda sayısı kadar rezervasyon). */
  async function fill(typeRow, count, stay = {}) {
    const results = [];
    for (let index = 0; index < count; index += 1) {
      results.push(
        await create({
          roomTypeId: typeRow.id,
          adults: 1,
          guest: { firstName: `Dolu${index}`, lastName: 'Misafir', phone: `+90555000${String(index).padStart(4, '0')}`, email: null },
          ...stay,
        }),
      );
    }
    return results;
  }

  describe('açma', () => {
    it('gece gece fiyat, onay kodu, misafir kartı, denetim izi ve olay', async () => {
      await db.season.create({
        data: { hotelId, name: 'Bayram', startDate: new Date(day(11)), endDate: new Date(day(11)), multiplier: '1.5' },
      });
      cache.invalidateHotelSettings(hotelId);

      const result = await create();
      assert.equal(result.outcome, 'CREATED');
      const reservation = result.reservation;
      assert.match(reservation.confirmationCode, new RegExp(`^${hotelCode}-[A-Z0-9]{6}$`));
      assert.equal(reservation.status, 'CONFIRMED');
      assert.equal(reservation.nights, 3);
      assert.deepEqual(
        reservation.nightlyRates.map((night) => [night.date, night.amount, night.multiplier, night.seasonName]),
        [
          [day(10), '1000.00', '1.000', null],
          [day(11), '1500.00', '1.500', 'Bayram'],
          [day(12), '1000.00', '1.000', null],
        ],
      );
      assert.equal(reservation.totalPrice, '3500.00');
      assert.equal(reservation.priceMode, 'CALCULATED');
      assert.equal(reservation.createdBy, DESK);

      const guest = await db.guest.findFirst({ where: { hotelId } });
      assert.equal(guest.phone, '+905321110001', 'telefon ülke koduyla saklanır');
      const row = await db.reservation.findFirst({ where: { id: reservation.id } });
      assert.ok(row.confirmedAt);
      assert.ok(row.requestId);
      assert.equal(await db.reservationNight.count({ where: { reservationId: reservation.id } }), 3);

      const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'Reservation', entityId: reservation.id } });
      assert.equal(audit.action, 'CREATE');
      assert.equal(audit.actor, DESK);
      assert.deepEqual(await eventNames(), ['reservation.created']);
    });

    it('aynı istek kimliği ikinci rezervasyon açmaz (ardışık ve eşzamanlı)', async () => {
      const requestId = randomUUID();
      const first = await create({ requestId });
      const second = await create({ requestId });
      assert.equal(second.outcome, 'EXISTING');
      assert.equal(second.reservation.id, first.reservation.id);

      const concurrentId = randomUUID();
      const results = await Promise.all([create({ requestId: concurrentId }), create({ requestId: concurrentId })]);
      assert.equal(new Set(results.map((row) => row.reservation.id)).size, 1);
      assert.equal(await db.reservation.count({ where: { hotelId, requestId: concurrentId } }), 1);
    });

    it('son odaya aynı anda gelen iki istekten biri açılır, diğeri "yer yok" alır', async () => {
      const outcomes = await Promise.allSettled([
        create({ roomTypeId: types.single.id, adults: 1 }),
        create({ roomTypeId: types.single.id, adults: 1, guest: { firstName: 'Mehmet', lastName: 'Kaya', phone: '+905551112233', email: null } }),
      ]);
      const created = outcomes.filter((row) => row.status === 'fulfilled');
      const rejected = outcomes.filter((row) => row.status === 'rejected');
      assert.equal(created.length, 1);
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0].reason.code, 'NO_AVAILABILITY');
      assert.equal(rejected[0].reason.details.shortfall[0].roomTypeCode, 'SGL');
      assert.equal(await db.reservation.count({ where: { hotelId, roomTypeId: types.single.id } }), 1);
    });

    it('kapasite, geçmiş tarih ve silinmiş tip reddedilir', async () => {
      await assert.rejects(create({ roomTypeId: types.single.id, adults: 2 }), { code: 'VALIDATION' });
      await assert.rejects(create({ checkIn: new Date(day(-1)), checkOut: new Date(day(2)) }), { code: 'VALIDATION' });
      await assert.rejects(create({ roomTypeId: randomUUID() }), { code: 'VALIDATION' });
      assert.equal(await db.reservation.count({ where: { hotelId } }), 0);
    });

    it('elle fiyat: yetkisiz reddedilir; yetkiliyle geceler eşit bölünür', async () => {
      await assert.rejects(create({ manualTotal: '2000', priceNote: 'Kurumsal anlaşma' }), { code: 'FORBIDDEN' });
      const { reservation } = await create({ manualTotal: '2000', priceNote: 'Kurumsal anlaşma' }, { canOverridePrice: true });
      assert.equal(reservation.totalPrice, '2000.00');
      assert.equal(reservation.priceMode, 'MANUAL');
      const detail = await service.getReservation(hotelId, reservation.id);
      assert.deepEqual(detail.nightlyRates.map((night) => night.amount), ['666.66', '666.66', '666.68']);
      assert.equal(detail.priceNote, 'Kurumsal anlaşma');
    });

    it('oda planından odasıyla açılır; oda doluysa hiçbir şey yazılmaz', async () => {
      const { reservation } = await create({ roomId: rooms.s1.id });
      assert.equal(reservation.room.number, '101');
      const names = await eventNames();
      assert.deepEqual(names, ['reservation.created', 'room.assigned']);

      await assert.rejects(create({ roomId: rooms.s1.id }), { code: 'ROOM_NOT_FREE' });
      assert.equal(await db.reservation.count({ where: { hotelId } }), 1);
    });
  });

  describe('misafir eşleştirme', () => {
    it('aynı telefon + aynı ad: var olan kart; farklı ad: sorulur; onaylanınca yeni kart', async () => {
      const first = await create();
      const at = (offset) => ({ checkIn: new Date(day(offset)), checkOut: new Date(day(offset + 1)) });
      const again = await create({ ...at(40), guest: { firstName: 'AYŞE', lastName: 'yılmaz', phone: '+90 532 111 00 01', email: null } });
      assert.equal(again.reservation.guest.id, first.reservation.guest.id);

      await assert.rejects(
        create({ ...at(42), guest: { firstName: 'Fatma', lastName: 'Yılmaz', phone: '05321110001', email: null } }),
        (error) => {
          assert.equal(error.code, 'GUEST_MATCH');
          assert.equal(error.details.candidates[0].id, first.reservation.guest.id);
          return true;
        },
      );
      const forced = await create({ ...at(44), guest: { firstName: 'Fatma', lastName: 'Yılmaz', phone: '05321110001', email: null }, forceNewGuest: true });
      assert.notEqual(forced.reservation.guest.id, first.reservation.guest.id);

      // E-posta büyük/küçük harf duyarsız eşleşir.
      const byEmail = await create({ ...at(46), guest: { firstName: 'Ayşe', lastName: 'Yılmaz', phone: null, email: 'AYSE@example.com' } });
      assert.equal(byEmail.reservation.guest.id, first.reservation.guest.id);
      assert.equal(await db.guest.count({ where: { hotelId } }), 2);
    });

    it('arama: ad, telefon, e-posta; son konaklama ve sayısı', async () => {
      await create();
      await create({ checkIn: new Date(day(20)), checkOut: new Date(day(22)) });
      const hotel = await db.hotel.findFirst({ where: { id: hotelId } });
      const byName = await service.getReservation(hotelId, (await db.reservation.findFirst({ where: { hotelId } })).id);
      assert.ok(byName);
      const { searchGuests } = await import('./guests.js');
      const [found] = await searchGuests(hotelId, 'ayş yılm', hotel);
      assert.equal(found.name, 'Ayşe Yılmaz');
      assert.equal(found.stayCount, 2);
      assert.equal(found.lastStay.checkIn.slice(0, 10), day(20));
      assert.equal((await searchGuests(hotelId, '0532 111 00 01', hotel)).length, 1);
      assert.equal((await searchGuests(hotelId, 'Ayse@Example.com', hotel)).length, 1);
      assert.equal((await searchGuests(hotelId, 'ay', hotel)).length, 0, 'üç harften kısa kelime aranmaz');
    });
  });

  describe('grup', () => {
    const groupInput = (overrides = {}) => ({
      guestId: null,
      guest: { firstName: 'Can', lastName: 'Demir', phone: '+905551234567', email: null },
      forceNewGuest: false,
      groupName: 'Demir Ailesi',
      checkIn: new Date(day(5)),
      checkOut: new Date(day(7)),
      status: 'CONFIRMED',
      source: 'EMAIL',
      notes: null,
      requestId: randomUUID(),
      waitlistId: null,
      lines: [
        { roomTypeId: types.std.id, adults: 2, children: 0, boardType: 'HB', quantity: 2 },
        { roomTypeId: types.dlx.id, adults: 3, children: 1, boardType: 'HB', quantity: 1 },
      ],
      ...overrides,
    });

    it('bütün odalar tek işlemde açılır; grup kodu, üyeler, grup iptali', async () => {
      const result = await as(DESK, () => service.createGroupReservation(hotelId, groupInput()));
      assert.equal(result.outcome, 'CREATED');
      assert.ok(result.groupId);
      const group = await db.reservationGroup.findFirst({ where: { id: result.groupId } });
      assert.equal(group.name, 'Demir Ailesi');
      const members = await db.reservation.findMany({ where: { hotelId, groupId: result.groupId } });
      assert.equal(members.length, 3);
      assert.equal(new Set(members.map((row) => row.confirmationCode)).size, 3);
      assert.equal(new Set(members.map((row) => row.guestId)).size, 1);
      assert.equal(result.reservation.groupMembers.length, 3);

      const cancelled = await as(DESK, () => service.cancelGroup(hotelId, result.groupId, { reason: 'Grup vazgeçti', waiveFee: false }));
      assert.equal(cancelled.cancelled, 3);
      assert.equal(await db.reservation.count({ where: { hotelId, groupId: result.groupId, status: 'CANCELLED' } }), 3);
    });

    it('bir oda bile sığmazsa hiçbiri açılmaz (ya hep ya hiç)', async () => {
      await assert.rejects(
        as(DESK, () =>
          service.createGroupReservation(
            hotelId,
            groupInput({ lines: [{ roomTypeId: types.std.id, adults: 2, children: 0, boardType: 'BB', quantity: 3 }] }),
          ),
        ),
        { code: 'NO_AVAILABILITY' },
      );
      assert.equal(await db.reservation.count({ where: { hotelId } }), 0);
      assert.equal(await db.reservationGroup.count({ where: { hotelId } }), 0);
      assert.equal(await db.guest.count({ where: { hotelId } }), 0, 'misafir kartı da geri alınır');
    });
  });

  describe('düzenleme', () => {
    it('uzatma: anlaşılan geceler eski fiyatında, yeni gece güncel fiyatla', async () => {
      const { reservation } = await create();
      await db.roomType.update({ where: { id: types.std.id }, data: { basePrice: '1200' } });
      cache.invalidateHotelSettings(hotelId);

      const updated = await as(DESK, () =>
        service.updateReservation(hotelId, reservation.id, { expectedUpdatedAt: new Date(reservation.updatedAt), checkOut: new Date(day(14)) }),
      );
      assert.deepEqual(updated.nightlyRates.map((night) => night.amount), ['1000.00', '1000.00', '1000.00', '1200.00']);
      assert.equal(updated.totalPrice, '4200.00');
      const event = await db.eventLog.findFirst({ where: { hotelId, name: 'reservation.updated' } });
      assert.deepEqual(event.payload.changedFields.sort(), ['checkOut', 'totalPrice'].sort());
    });

    it('tip değişince bütün geceler yeni tipin fiyatıyla; eski sürümle yazma 409', async () => {
      const { reservation } = await create();
      const updated = await as(DESK, () =>
        service.updateReservation(hotelId, reservation.id, { expectedUpdatedAt: new Date(reservation.updatedAt), roomTypeId: types.dlx.id }),
      );
      assert.equal(updated.totalPrice, '6000.00');
      await assert.rejects(
        as(DESK, () => service.updateReservation(hotelId, reservation.id, { expectedUpdatedAt: new Date(reservation.updatedAt), notes: 'x' })),
        { code: 'STALE_WRITE' },
      );
    });

    it('elle fiyatta konaklama değişirse karar istenir; karar verilince uygulanır', async () => {
      const { reservation } = await create({ manualTotal: '2000', priceNote: 'Anlaşma' }, { canOverridePrice: true });
      const version = new Date(reservation.updatedAt);
      await assert.rejects(
        as(DESK, () => service.updateReservation(hotelId, reservation.id, { expectedUpdatedAt: version, checkOut: new Date(day(14)) })),
        { code: 'PRICE_DECISION_REQUIRED' },
      );
      const recalculated = await as(DESK, () =>
        service.updateReservation(hotelId, reservation.id, {
          expectedUpdatedAt: version,
          checkOut: new Date(day(14)),
          price: { mode: 'CALCULATED' },
        }),
      );
      assert.equal(recalculated.priceMode, 'CALCULATED');
      assert.equal(recalculated.totalPrice, '4000.00');
      assert.equal(recalculated.priceNote, null);
    });

    it('değişiklik yoksa yazılmaz: sürüm ilerlemez, denetim izi ve olay yok', async () => {
      const { reservation } = await create({ notes: 'Geç gelecek' });
      const result = await as(DESK, () =>
        service.updateReservation(hotelId, reservation.id, { expectedUpdatedAt: new Date(reservation.updatedAt), notes: 'Geç gelecek', adults: 2 }),
      );
      assert.equal(result.updatedAt, reservation.updatedAt);
      assert.equal(await db.auditLog.count({ where: { hotelId, entity: 'Reservation', action: 'UPDATE' } }), 0);
      assert.equal((await eventNames()).includes('reservation.updated'), false);
    });

    it('atanmış oda yeni tarihlerde doluysa atama kaldırılır (olayla)', async () => {
      const { reservation } = await create({ roomId: rooms.s1.id });
      await create({ roomId: rooms.s1.id, checkIn: new Date(day(13)), checkOut: new Date(day(15)), guest: { firstName: 'Ali', lastName: 'Veli', phone: '+905559998877', email: null } });

      const updated = await as(DESK, () =>
        service.updateReservation(hotelId, reservation.id, { expectedUpdatedAt: new Date(reservation.updatedAt), checkOut: new Date(day(14)) }),
      );
      assert.equal(updated.room, null);
      assert.ok((await eventNames()).includes('room.unassigned'));
    });

    it('içerideki misafir: giriş tarihi değişmez; odası doluysa uzatma reddedilir', async () => {
      const { reservation } = await create({ checkIn: new Date(day(0)), checkOut: new Date(day(2)), roomId: rooms.s1.id });
      await db.reservation.update({ where: { id: reservation.id }, data: { status: 'CHECKED_IN' } });
      const fresh = await service.getReservation(hotelId, reservation.id);
      await assert.rejects(
        as(DESK, () => service.updateReservation(hotelId, reservation.id, { expectedUpdatedAt: new Date(fresh.updatedAt), checkIn: new Date(day(1)) })),
        { code: 'VALIDATION' },
      );
      await create({ roomId: rooms.s1.id, checkIn: new Date(day(2)), checkOut: new Date(day(4)), guest: { firstName: 'Ali', lastName: 'Veli', phone: '+905559998877', email: null } });
      await assert.rejects(
        as(DESK, () => service.updateReservation(hotelId, reservation.id, { expectedUpdatedAt: new Date(fresh.updatedAt), checkOut: new Date(day(3)) })),
        { code: 'ROOM_NOT_FREE' },
      );
      const kept = await db.reservation.findFirst({ where: { id: reservation.id } });
      assert.equal(kept.roomId, rooms.s1.id);
    });

    it('tarih değişikliği kapasiteyi aşarsa reddedilir', async () => {
      const { reservation } = await create({ roomTypeId: types.single.id, adults: 1, checkIn: new Date(day(10)), checkOut: new Date(day(11)) });
      await create({ roomTypeId: types.single.id, adults: 1, checkIn: new Date(day(11)), checkOut: new Date(day(12)), guest: { firstName: 'Ali', lastName: 'Veli', phone: '+905559998877', email: null } });
      await assert.rejects(
        as(DESK, () => service.updateReservation(hotelId, reservation.id, { expectedUpdatedAt: new Date(reservation.updatedAt), checkOut: new Date(day(12)) })),
        { code: 'NO_AVAILABILITY' },
      );
    });
  });

  describe('durum işlemleri', () => {
    it('opsiyonlu rezervasyon onaylanır (olayla); onaylıyı yeniden onaylamak 409', async () => {
      const { reservation } = await create({ status: 'PENDING' });
      assert.equal(reservation.status, 'PENDING');
      const confirmed = await as(DESK, () => service.confirmReservation(hotelId, reservation.id, { expectedUpdatedAt: new Date(reservation.updatedAt) }));
      assert.equal(confirmed.status, 'CONFIRMED');
      assert.ok((await eventNames()).includes('reservation.confirmed'));
      await assert.rejects(
        as(DESK, () => service.confirmReservation(hotelId, reservation.id, { expectedUpdatedAt: new Date(confirmed.updatedAt) })),
        { code: 'INVALID_STATUS' },
      );
    });

    it('iptal: politika süresinde ücretsiz, geç iptalde ceza; vazgeçilebilir; yer serbest kalır', async () => {
      const early = await create({ roomTypeId: types.single.id, adults: 1 });
      const cancelled = await as(DESK, () =>
        service.cancelReservation(hotelId, early.reservation.id, { expectedUpdatedAt: new Date(early.reservation.updatedAt), reason: 'Plan değişti', waiveFee: false }),
      );
      assert.equal(cancelled.status, 'CANCELLED');
      assert.equal(cancelled.cancellationFee, '0.00');
      assert.equal(cancelled.cancelReason, 'Plan değişti');
      // Yer serbest: aynı tarihlere yeni rezervasyon açılır.
      await create({ roomTypeId: types.single.id, adults: 1, guest: { firstName: 'Ali', lastName: 'Veli', phone: '+905559998877', email: null } });

      const late = await create({ checkIn: new Date(day(1)), checkOut: new Date(day(3)) });
      const fee = await as(DESK, () =>
        service.cancelReservation(hotelId, late.reservation.id, { expectedUpdatedAt: new Date(late.reservation.updatedAt), reason: 'Son dakika', waiveFee: false }),
      );
      assert.equal(fee.cancellationFee, '1000.00', '2000 × %50');
      const waived = await create({ checkIn: new Date(day(1)), checkOut: new Date(day(3)), guest: { firstName: 'Ali', lastName: 'Veli', phone: '+905559998877', email: null } });
      const noFee = await as(DESK, () =>
        service.cancelReservation(hotelId, waived.reservation.id, { expectedUpdatedAt: new Date(waived.reservation.updatedAt), reason: 'Hastalık', waiveFee: true }),
      );
      assert.equal(noFee.cancellationFee, '0.00');
      const audit = await db.auditLog.findFirst({ where: { hotelId, entityId: waived.reservation.id, action: 'UPDATE' } });
      assert.equal(audit.after.feeWaived, true);
      assert.equal(audit.after.policyFee, '1000.00');
    });

    it('gelmedi: giriş günü gelmeden olmaz; giriş günü ilk gece ücretiyle', async () => {
      const future = await create();
      await assert.rejects(
        as(DESK, () => service.markNoShow(hotelId, future.reservation.id, { expectedUpdatedAt: new Date(future.reservation.updatedAt), waiveFee: false })),
        { code: 'INVALID_STATUS' },
      );
      const arriving = await create({ checkIn: new Date(day(0)), checkOut: new Date(day(2)) });
      const noShow = await as(DESK, () =>
        service.markNoShow(hotelId, arriving.reservation.id, { expectedUpdatedAt: new Date(arriving.reservation.updatedAt), waiveFee: false }),
      );
      assert.equal(noShow.status, 'NO_SHOW');
      assert.equal(noShow.noShowFee, '1000.00');
      assert.ok((await eventNames()).includes('reservation.no_show'));
    });

    it('geri alma: yer doluysa reddedilir; boşsa onaylı döner, ceza temizlenir', async () => {
      const first = await create({ roomTypeId: types.single.id, adults: 1 });
      const cancelled = await as(DESK, () =>
        service.cancelReservation(hotelId, first.reservation.id, { expectedUpdatedAt: new Date(first.reservation.updatedAt), reason: 'x', waiveFee: false }),
      );
      const taker = await create({ roomTypeId: types.single.id, adults: 1, guest: { firstName: 'Ali', lastName: 'Veli', phone: '+905559998877', email: null } });
      await assert.rejects(
        as(DESK, () => service.reinstateReservation(hotelId, first.reservation.id, { expectedUpdatedAt: new Date(cancelled.updatedAt) })),
        { code: 'NO_AVAILABILITY' },
      );
      await as(DESK, () =>
        service.cancelReservation(hotelId, taker.reservation.id, { expectedUpdatedAt: new Date(taker.reservation.updatedAt), reason: 'y', waiveFee: true }),
      );
      const back = await as(DESK, () => service.reinstateReservation(hotelId, first.reservation.id, { expectedUpdatedAt: new Date(cancelled.updatedAt) }));
      assert.equal(back.status, 'CONFIRMED');
      assert.equal(back.cancelReason, null);
      assert.equal(back.cancellationFee, null);
    });

    it('geçmiş kaydı: işlemler en yeniden, aktörüyle', async () => {
      const { reservation } = await create({ status: 'PENDING' });
      const confirmed = await as(ADMIN, () => service.confirmReservation(hotelId, reservation.id, { expectedUpdatedAt: new Date(reservation.updatedAt) }));
      assert.ok(confirmed);
      const history = await service.getReservationHistory(hotelId, reservation.id);
      assert.deepEqual(history.items.map((row) => [row.action, row.actor]), [
        ['UPDATE', ADMIN],
        ['CREATE', DESK],
      ]);
      assert.equal(history.items[0].after.status, 'CONFIRMED');
    });
  });

  describe('kapasite aşımı onayı (politika: onaya gönder)', () => {
    beforeEach(async () => {
      await db.hotel.update({ where: { id: hotelId }, data: { overbookingPolicy: 'APPROVAL' } });
      cache.invalidateHotelSettings(hotelId);
      subscribers.registerReservationSubscribers();
    });

    it('yer yoksa onaya gider; aynı istek ikinci kez gelirse aynı onay döner; onaylanınca açılır', async () => {
      await fill(types.single, 1);
      const requestId = randomUUID();
      const requested = await create({ roomTypeId: types.single.id, adults: 1, requestId, guest: { firstName: 'Zeynep', lastName: 'Ak', phone: '+905554443322', email: null } });
      assert.equal(requested.outcome, 'APPROVAL_REQUESTED');
      const again = await create({ roomTypeId: types.single.id, adults: 1, requestId, guest: { firstName: 'Zeynep', lastName: 'Ak', phone: '+905554443322', email: null } });
      assert.equal(again.outcome, 'APPROVAL_PENDING');
      assert.equal(again.approvalId, requested.approvalId);

      const approval = await db.approval.findFirst({ where: { id: requested.approvalId } });
      assert.equal(approval.type, 'OVERBOOKING');
      assert.equal(approval.requestedBy, DESK);
      assert.equal(approval.entityId, requestId);
      assert.match(approval.summary, /Zeynep Ak · SGL/);
      assert.equal(await db.reservation.count({ where: { hotelId, requestId } }), 0);

      await as(ADMIN, () => approvals.decideApproval(hotelId, requested.approvalId, 'GRANTED', { note: 'VIP' }));
      const created = await db.reservation.findFirst({ where: { hotelId, requestId } });
      assert.ok(created, 'onaylanınca rezervasyon açıldı');
      assert.equal(created.createdBy, DESK);
      const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'Reservation', entityId: created.id } });
      assert.equal(audit.actor, ADMIN, 'yetkilendiren kişi denetim izinde');

      const deskBell = await as(DESK, () => alerts.listStaffAlerts(hotelId, { limit: 20 }));
      assert.ok(deskBell.items.some((item) => item.kind === 'APPROVAL_DECIDED' && /onaylandı, rezervasyon açıldı/.test(item.title)));
    });

    it('reddedilince açılmaz; isteyene gerekçesiyle haber verilir', async () => {
      await fill(types.single, 1);
      const requested = await create({ roomTypeId: types.single.id, adults: 1, guest: { firstName: 'Zeynep', lastName: 'Ak', phone: '+905554443322', email: null } });
      await as(ADMIN, () => approvals.decideApproval(hotelId, requested.approvalId, 'DENIED', { note: 'Otel dolu' }));
      assert.equal(await db.reservation.count({ where: { hotelId, roomTypeId: types.single.id } }), 1);
      const deskBell = await as(DESK, () => alerts.listStaffAlerts(hotelId, { limit: 20 }));
      const alert = deskBell.items.find((item) => item.kind === 'APPROVAL_DECIDED');
      assert.match(alert.title, /reddedildi/);
      assert.match(alert.body, /Otel dolu/);
    });
  });

  describe('bekleme listesi', () => {
    const entryInput = (overrides = {}) => ({
      guestId: null,
      firstName: 'Deniz',
      lastName: 'Kara',
      phone: '0533 222 33 44',
      email: null,
      roomTypeId: types.single.id,
      adults: 1,
      children: 0,
      boardType: 'BB',
      checkIn: new Date(day(10)),
      checkOut: new Date(day(13)),
      notes: null,
      ...overrides,
    });

    it('yer yokken bekler; iptal olunca "yer açıldı" + zil; yer dolunca geri döner; çevrilince kapanır', async () => {
      const [blocker] = await fill(types.single, 1);
      const entry = await as(DESK, () => waitlist.createWaitlistEntry(hotelId, entryInput()));
      assert.equal(entry.status, 'WAITING');
      assert.equal(entry.phone, '+905332223344');

      await as(DESK, () =>
        service.cancelReservation(hotelId, blocker.reservation.id, { expectedUpdatedAt: new Date(blocker.reservation.updatedAt), reason: 'x', waiveFee: true }),
      );
      assert.deepEqual(await waitlist.refreshWaitlist(hotelId), { opened: 1, closed: 0, expired: 0 });
      assert.equal((await waitlist.getWaitlistEntry(hotelId, entry.id)).status, 'AVAILABLE');
      const deskBell = await as(DESK, () => alerts.listStaffAlerts(hotelId, { limit: 20 }));
      assert.ok(deskBell.items.some((item) => item.kind === 'WAITLIST_AVAILABLE'));
      assert.deepEqual(await waitlist.refreshWaitlist(hotelId), { opened: 0, closed: 0, expired: 0 }, 'ikinci tarama uyarmaz');

      const other = await create({ roomTypeId: types.single.id, adults: 1, guest: { firstName: 'Ali', lastName: 'Veli', phone: '+905559998877', email: null } });
      assert.deepEqual(await waitlist.refreshWaitlist(hotelId), { opened: 0, closed: 1, expired: 0 });
      assert.equal((await waitlist.getWaitlistEntry(hotelId, entry.id)).status, 'WAITING');

      await as(DESK, () =>
        service.cancelReservation(hotelId, other.reservation.id, { expectedUpdatedAt: new Date(other.reservation.updatedAt), reason: 'y', waiveFee: true }),
      );
      await waitlist.refreshWaitlist(hotelId);
      const converted = await create({
        roomTypeId: types.single.id,
        adults: 1,
        waitlistId: entry.id,
        guest: { firstName: 'Deniz', lastName: 'Kara', phone: '0533 222 33 44', email: null },
      });
      const closed = await waitlist.getWaitlistEntry(hotelId, entry.id);
      assert.equal(closed.status, 'CONVERTED');
      assert.equal(closed.reservation.id, converted.reservation.id);
      await assert.rejects(
        create({ roomTypeId: types.std.id, waitlistId: entry.id, guest: { firstName: 'Deniz', lastName: 'Kara', phone: '0533 222 33 44', email: null } }),
        { code: 'WAITLIST_CLOSED' },
      );
    });

    it('girişi geçen kayıt kapanır; kapatılan kayıt yeniden kapatılamaz; liste açıkları gösterir', async () => {
      const entry = await as(DESK, () => waitlist.createWaitlistEntry(hotelId, entryInput({ roomTypeId: types.std.id })));
      await db.waitlistEntry.update({ where: { id: entry.id }, data: { checkIn: new Date(day(-2)), checkOut: new Date(day(-1)) } });
      assert.equal((await waitlist.refreshWaitlist(hotelId)).expired, 1);
      assert.equal((await waitlist.getWaitlistEntry(hotelId, entry.id)).status, 'EXPIRED');

      const open = await as(DESK, () => waitlist.createWaitlistEntry(hotelId, entryInput({ firstName: 'Başka' })));
      const listed = await waitlist.listWaitlist(hotelId, { page: 1, pageSize: 20 });
      assert.deepEqual(listed.items.map((row) => row.id), [open.id]);
      await as(DESK, () => waitlist.closeWaitlistEntry(hotelId, open.id, { reason: 'Vazgeçti' }));
      await assert.rejects(as(DESK, () => waitlist.closeWaitlistEntry(hotelId, open.id, { reason: 'x' })), { code: 'WAITLIST_CLOSED' });
    });
  });

  describe('liste, arama, önizleme', () => {
    it('görünümler, arama (ad, kod, telefon, oda), sayfalama ve otel kapsamı', async () => {
      const arriving = await create({ checkIn: new Date(day(0)), checkOut: new Date(day(2)), roomId: rooms.s1.id });
      const later = await create({ guest: { firstName: 'Mehmet', lastName: 'Kaya', phone: '+905551112233', email: null } });
      await create({ status: 'PENDING', checkIn: new Date(day(30)), checkOut: new Date(day(31)), guest: { firstName: 'Opsiyon', lastName: 'Kişi', phone: '+905550000001', email: null } });

      const list = (query) => service.listReservations(hotelId, { page: 1, pageSize: 25, view: 'ALL', ...query });
      assert.deepEqual((await list({ view: 'ARRIVALS' })).items.map((row) => row.id), [arriving.reservation.id]);
      assert.equal((await list({ view: 'UPCOMING' })).items.length, 2);
      assert.equal((await list({ view: 'PENDING' })).items.length, 1);
      assert.deepEqual((await list({ search: 'mehmet' })).items.map((row) => row.id), [later.reservation.id]);
      assert.deepEqual((await list({ search: later.reservation.confirmationCode.slice(-6) })).items.map((row) => row.id), [later.reservation.id]);
      assert.deepEqual((await list({ search: '0555 111 22 33' })).items.map((row) => row.id), [later.reservation.id]);
      assert.deepEqual((await list({ search: '101' })).items.map((row) => row.id), [arriving.reservation.id]);
      assert.equal((await list({ search: 'yokböyleisim' })).items.length, 0);
      assert.equal((await list({ from: new Date(day(29)), to: new Date(day(30)) })).items.length, 1);

      const paged = await list({ pageSize: 2 });
      assert.equal(paged.items.length, 2);
      assert.equal(paged.meta.total, 3);
      assert.equal(paged.meta.totalCapped, false);
      assert.equal(paged.meta.totalPages, 2);

      const otherHotel = await db.hotel.create({ data: { name: 'Başka', code: `O${randomUUID().slice(0, 5)}`, timezone: ZONE } });
      assert.equal((await service.listReservations(otherHotel.id, { page: 1, pageSize: 25, view: 'ALL' })).items.length, 0);
      await assert.rejects(service.getReservation(otherHotel.id, later.reservation.id), { code: 'NOT_FOUND' });
    });

    it('önizleme: tip başına boş oda ve fiyat, eksik, kendi yeri hariç', async () => {
      const { reservation } = await create({ roomTypeId: types.single.id, adults: 1 });
      const quote = await service.quoteReservation(hotelId, {
        checkIn: new Date(day(10)),
        checkOut: new Date(day(13)),
        lines: [{ roomTypeId: types.single.id, quantity: 1, adults: 1, children: 0 }],
      });
      const single = quote.roomTypes.find((type) => type.id === types.single.id);
      assert.equal(single.available, 0);
      assert.equal(single.total, '1500.00');
      assert.deepEqual(quote.shortages, [{ roomTypeId: types.single.id, requested: 1, available: 0 }]);
      assert.equal(quote.total, '1500.00');
      assert.equal(quote.cancellation.penaltyApplies, false);

      const editing = await service.quoteReservation(hotelId, {
        checkIn: new Date(day(10)),
        checkOut: new Date(day(13)),
        lines: [{ roomTypeId: types.single.id, quantity: 1, adults: 1, children: 0 }],
        excludeReservationId: reservation.id,
      });
      assert.equal(editing.roomTypes.find((type) => type.id === types.single.id).available, 1);
      assert.deepEqual(editing.shortages, []);
    });
  });

  describe('kanal isteği (reservation-worker servisi)', () => {
    const request = (overrides = {}) => ({
      hotelId,
      requestId: `wa-${randomUUID()}`,
      source: 'WHATSAPP',
      guest: { firstName: 'Elif', lastName: 'Demir', phone: '905321110004', email: null, nationality: 'TR' },
      roomTypeId: types.single.id,
      checkIn: `${day(10)}T00:00:00.000Z`,
      checkOut: `${day(12)}T00:00:00.000Z`,
      adults: 1,
      children: 0,
      boardType: null,
      notes: 'WhatsApp üzerinden',
      status: 'PENDING',
      ...overrides,
    });

    it('opsiyonlu açılır; aynı istek ikinci kez gelince ilki döner; yer yoksa gerekçeli ret olayı', async () => {
      const payload = request();
      const first = await service.createFromChannelRequest(payload);
      assert.equal(first.outcome, 'CREATED');
      const row = await db.reservation.findFirst({ where: { id: first.reservationId } });
      assert.equal(row.status, 'PENDING');
      assert.equal(row.source, 'WHATSAPP');
      assert.equal(row.createdBy, 'kanal:WHATSAPP');
      assert.equal(row.boardType, 'BB', 'pansiyon verilmezse otelin varsayılanı');

      assert.equal((await service.createFromChannelRequest(payload)).outcome, 'EXISTING');

      // Politika "onaya gönder" olsa da kanal isteği onaya gitmez.
      await db.hotel.update({ where: { id: hotelId }, data: { overbookingPolicy: 'APPROVAL' } });
      cache.invalidateHotelSettings(hotelId);
      const rejected = await service.createFromChannelRequest(request({ guest: { firstName: 'Can', lastName: 'Ak', phone: '905550001122', email: null, nationality: null } }));
      assert.equal(rejected.outcome, 'REJECTED');
      assert.equal(rejected.code, 'NO_AVAILABILITY');
      assert.equal(await db.approval.count({ where: { hotelId } }), 0);
      const event = await db.eventLog.findFirst({ where: { hotelId, name: 'reservation.rejected' } });
      assert.equal(event.payload.code, 'NO_AVAILABILITY');

      const invalid = await service.createFromChannelRequest(request({ guest: { firstName: 'X', lastName: 'Y', phone: null, email: null, nationality: null } }));
      assert.equal(invalid.outcome, 'REJECTED');
    });
  });

  describe('sözleşme kuralları ile uyum', () => {
    it('detaydaki işlemler durum kuralıyla aynı', async () => {
      const { reservation } = await create({ status: 'PENDING', checkIn: new Date(day(0)), checkOut: new Date(day(1)) });
      const detail = await service.getReservation(hotelId, reservation.id);
      assert.deepEqual(detail.actions, contracts.allowedReservationActions(detail, detail.businessDate));
      assert.deepEqual(detail.actions.sort(), ['cancel', 'confirm', 'edit', 'noShow'].sort());
      assert.equal(detail.cancellationPreview.penaltyApplies, true);
      assert.equal(detail.noShowPreview.fee, '1000.00');
    });
  });
});
