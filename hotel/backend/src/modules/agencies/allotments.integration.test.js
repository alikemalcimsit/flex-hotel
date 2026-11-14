import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Allotment & grup (modül 30) entegrasyon testleri: kota CRUD + çakışma,
 * müsaitlik guard'ının kotayı düşmesi (genel satış engellenir, acente kendi
 * kotasını kullanır, taşma genel havuzdan, release sonrası serbest), kullanım
 * tablosu, satır misafirli grup (rooming list çekirdeği) ve toplu check-in.
 */

const ZONE = 'Europe/Istanbul';
const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

describe('Allotment & grup (modül 30)', { skip }, () => {
  let db;
  let core;
  let cache;
  let allotments;
  let reservations;
  let groups;
  let frontDesk;
  let resetDatabase;
  let hotelId;
  let types;
  let agency;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    cache = await import('../../lib/cache.js');
    allotments = await import('./allotments.js');
    reservations = await import('../reservations/service.js');
    groups = await import('../reservations/groups.js');
    frontDesk = await import('../front-desk/service.js');
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
      data: { name: 'Kota Otel', code: `A${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, phoneCountryCode: '90' },
    });
    hotelId = hotel.id;
    const type = (code, basePrice) =>
      db.roomType.create({ data: { hotelId, code, name: `${code} oda`, basePrice, capacityAdults: 3, capacityChildren: 2 } });
    types = { std: await type('STD', '1000') };
    await db.room.create({ data: { hotelId, number: '101', roomTypeId: types.std.id } });
    await db.room.create({ data: { hotelId, number: '102', roomTypeId: types.std.id } });

    // Acente + satıştaki kontrat (acente satışı kontrat fiyatı ister — modül 29).
    agency = await db.agency.create({
      data: { hotelId, code: 'TUI', name: 'TUI Tur', commissionPct: '10', createdBy: 'test' },
    });
    const contract = await db.contract.create({
      data: {
        hotelId,
        agencyId: agency.id,
        name: '2027 Yaz',
        startDate: new Date(day(0)),
        endDate: new Date(day(120)),
        status: 'ACTIVE',
        currency: 'TRY',
        createdBy: 'test',
        activatedAt: new Date(),
        activatedBy: 'test',
      },
    });
    await db.contractRate.create({
      data: {
        hotelId,
        contractId: contract.id,
        roomTypeId: types.std.id,
        boardType: 'BB',
        startDate: new Date(day(0)),
        endDate: new Date(day(120)),
        price: '800',
      },
    });
  });

  const allotmentInput = (overrides = {}) => ({
    roomTypeId: types.std.id,
    startDate: new Date(day(5)),
    endDate: new Date(day(30)),
    quantity: 1,
    releaseDays: 0,
    notes: null,
    ...overrides,
  });

  const reservationInput = (overrides = {}) => ({
    guestId: null,
    guest: { firstName: 'Ayşe', lastName: 'Yılmaz', phone: `+90555${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, email: null, nationality: 'TR' },
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
    agencyId: null,
    ...overrides,
  });

  describe('kota yönetimi', () => {
    it('kota açılır, listelenir; aynı acente + tipte çakışan dönem reddedilir', async () => {
      const created = await as(() => allotments.createAllotment(hotelId, agency.id, allotmentInput()));
      assert.equal(created.quantity, 1);
      assert.equal(created.roomTypeCode, 'STD');

      await assert.rejects(
        as(() => allotments.createAllotment(hotelId, agency.id, allotmentInput({ startDate: new Date(day(20)), endDate: new Date(day(40)) }))),
        /çakışıyor/,
      );

      const list = await allotments.listAllotments(hotelId, agency.id, { page: 1, pageSize: 20 });
      assert.equal(list.items.length, 1);
    });
  });

  describe('müsaitlik guard\'ı', () => {
    it('tutulan kota genel satışa kapalı; acente kendi kotasını kullanır; dolunca genel havuzdan taşar', async () => {
      // 2 fiziksel oda, 1'i acenteye tutulu → genel satışa 1 oda.
      await as(() => allotments.createAllotment(hotelId, agency.id, allotmentInput()));

      const first = await as(() => reservations.createReservation(hotelId, reservationInput()));
      assert.equal(first.outcome, 'CREATED');

      // İkinci genel satış: fiziksel oda var ama kotada → reddedilir, mesaj kotayı söyler.
      await assert.rejects(as(() => reservations.createReservation(hotelId, reservationInput())), /kotasında tutulu/);

      // Acente kendi kotasından satar.
      const agencySale = await as(() => reservations.createReservation(hotelId, reservationInput({ agencyId: agency.id, source: 'AGENCY' })));
      assert.equal(agencySale.outcome, 'CREATED');

      // Kota dolu + otel dolu: acente de genel havuzdan taşamaz (fiziksel yer yok).
      await assert.rejects(
        as(() => reservations.createReservation(hotelId, reservationInput({ agencyId: agency.id, source: 'AGENCY' }))),
        /yer yok/,
      );
    });

    it('kota taşması genel havuzdan devam eder (kota garanti, tavan değil)', async () => {
      await as(() => allotments.createAllotment(hotelId, agency.id, allotmentInput({ quantity: 1 })));
      // Acente kotası 1; iki acente satışı da açılır (ikincisi genel havuzdan).
      const a = await as(() => reservations.createReservation(hotelId, reservationInput({ agencyId: agency.id, source: 'AGENCY' })));
      const b = await as(() => reservations.createReservation(hotelId, reservationInput({ agencyId: agency.id, source: 'AGENCY' })));
      assert.equal(a.outcome, 'CREATED');
      assert.equal(b.outcome, 'CREATED');
      // Otel fiziksel dolu: genel satış yer bulamaz.
      await assert.rejects(as(() => reservations.createReservation(hotelId, reservationInput())), /yer yok/);
    });

    it('release edilen kota genel satışa açıktır', async () => {
      // Konaklama 3 gün sonra; release 10 gün → release tarihi geçti, kota serbest.
      await as(() => allotments.createAllotment(hotelId, agency.id, allotmentInput({ startDate: new Date(day(1)), endDate: new Date(day(8)), releaseDays: 10 })));
      const stay = { checkIn: new Date(day(3)), checkOut: new Date(day(5)) };
      const first = await as(() => reservations.createReservation(hotelId, reservationInput(stay)));
      const second = await as(() => reservations.createReservation(hotelId, reservationInput(stay)));
      assert.equal(first.outcome, 'CREATED');
      assert.equal(second.outcome, 'CREATED');
    });

    it('kullanım tablosu verilen / kullanılan / kalanı gün gün gösterir', async () => {
      const created = await as(() => allotments.createAllotment(hotelId, agency.id, allotmentInput({ quantity: 2 })));
      await as(() => reservations.createReservation(hotelId, reservationInput({ agencyId: agency.id, source: 'AGENCY' })));

      const usage = await allotments.getAllotmentUsage(hotelId, created.id);
      const byDay = new Map(usage.days.map((row) => [row.day, row]));
      assert.deepEqual(byDay.get(day(10)), { day: day(10), given: 2, used: 1, remaining: 1, released: false });
      assert.deepEqual(byDay.get(day(11)), { day: day(11), given: 2, used: 1, remaining: 1, released: false });
      assert.equal(byDay.get(day(12)).used, 0); // çıkış günü gece değil
      assert.equal(usage.summary.usedNights, 2);
    });
  });

  describe('grup dosyası ve rooming list çekirdeği', () => {
    const groupInput = (lines) => ({
      guestId: null,
      guest: { firstName: 'Lider', lastName: 'Kaya', phone: '+905551112233', email: null, nationality: 'TR' },
      forceNewGuest: false,
      groupName: 'Tur Grubu',
      lines,
      checkIn: new Date(day(10)),
      checkOut: new Date(day(12)),
      status: 'CONFIRMED',
      source: 'AGENCY',
      agencyId: agency.id,
      notes: null,
      requestId: randomUUID(),
      couponCode: null,
    });

    it('satır misafirli grup: her oda kendi kartına açılır (iletişimsiz kart), grup dosyası özetler', async () => {
      const result = await as(() =>
        reservations.createGroupReservation(
          hotelId,
          groupInput([
            { roomTypeId: types.std.id, adults: 2, children: 0, boardType: 'BB', quantity: 1, guest: { firstName: 'Ali', lastName: 'Veli', phone: null, email: null, nationality: null } },
            { roomTypeId: types.std.id, adults: 1, children: 0, boardType: 'BB', quantity: 1, guest: { firstName: 'Fatma', lastName: 'Demir', phone: null, email: null, nationality: null } },
          ]),
        ),
      );
      assert.equal(result.outcome, 'CREATED');

      const file = await groups.getGroupFile(hotelId, result.groupId);
      assert.equal(file.summary.rooms, 2);
      assert.deepEqual(file.reservations.map((row) => row.guest.name).sort(), ['Ali Veli', 'Fatma Demir']);
      // Satır misafirleri ayrı kartlardır ve lider karta bağlanmamıştır.
      const guestIds = new Set((await db.reservation.findMany({ where: { groupId: result.groupId }, select: { guestId: true } })).map((row) => row.guestId));
      assert.equal(guestIds.size, 2);
      // Kontrat fiyatı uygulanmış (acente grubu): 2 gece × 800.
      assert.equal(file.reservations[0].totalPrice, '1600.00');

      const list = await groups.listGroups(hotelId, { page: 1, pageSize: 20, search: 'Tur' });
      assert.equal(list.items.length, 1);
      assert.equal(list.items[0].rooms, 2);
    });

    it('toplu check-in: odası atanan girer, atanmayan sebebiyle atlanır', async () => {
      const result = await as(() =>
        reservations.createGroupReservation(
          hotelId,
          groupInput([
            { roomTypeId: types.std.id, adults: 1, children: 0, boardType: 'BB', quantity: 2, guest: null },
          ]),
        ),
      );
      // Girişler bugüne çekilir (check-in bugün ister).
      await db.reservation.updateMany({ where: { groupId: result.groupId }, data: { checkIn: new Date(day(0)) } });
      const rows = await db.reservation.findMany({ where: { groupId: result.groupId }, orderBy: { createdAt: 'asc' } });
      const room = await db.room.findFirst({ where: { hotelId, number: '101' } });
      await db.reservation.update({ where: { id: rows[0].id }, data: { roomId: room.id } });
      const fresh = await db.reservation.findMany({ where: { groupId: result.groupId }, orderBy: { createdAt: 'asc' } });

      const batch = await as(() =>
        frontDesk.checkInBatch(hotelId, fresh.map((row) => ({ id: row.id, expectedUpdatedAt: row.updatedAt }))),
      );
      assert.equal(batch.succeeded, 1);
      assert.equal(batch.failed, 1);
      const failed = batch.results.find((row) => !row.ok);
      assert.match(failed.message, /oda/i);

      const checkedIn = await db.reservation.findFirst({ where: { id: fresh[0].id } });
      assert.equal(checkedIn.status, 'CHECKED_IN');
    });
  });
});
