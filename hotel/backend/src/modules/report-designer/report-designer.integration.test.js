import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Rapor tasarımcısı (modül 26) entegrasyon testleri: kataloğun her sütunu gerçek veritabanında çalışır; filtre,
 * gruplama, toplam ve sıralama doğru sonuç verir; kaynağın yetkisi denetlenir; kayıt / paylaşım / çalıştırma /
 * sahiplik.
 */

const ZONE = 'Europe/Istanbul';
const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

describe('Rapor tasarımcısı (modül 26)', { skip }, () => {
  let db;
  let core;
  let contracts;
  let designer;
  let resetDatabase;
  let hotelId;
  let ALL;
  let ACCOUNTING;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    designer = await import('./service.js');
    ALL = contracts.DEFAULT_ROLE_PERMISSIONS.ADMIN;
    ACCOUNTING = contracts.DEFAULT_ROLE_PERMISSIONS.ACCOUNTING;
  });

  after(async () => {
    await db?.$disconnect();
  });

  const as = (actor, fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
  const rejects = (promise, code) => assert.rejects(promise, (error) => error.code === code || assert.fail(`${error.code}: ${error.message}`));
  const run = (design, permissions = ALL) => as('mudur@hotel.local', () => designer.runDesign(hotelId, permissions, { design: contracts.reportDesignSchema.parse(design), preview: false }));
  const day = (offset) => core.toIsoDay(core.addDays(core.calendarDateInTimeZone(ZONE), offset));

  beforeEach(async () => {
    await resetDatabase(db);
    (await import('../../lib/cache.js')).cache.clear();
    const hotel = await db.hotel.create({ data: { name: 'Tasarım Otel', code: `T${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, phoneCountryCode: '90' } });
    hotelId = hotel.id;
    const type = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 2, capacityChildren: 1 } });
    const ayse = await db.guest.create({ data: { hotelId, firstName: 'Ayşe', lastName: 'Kaya', email: 'ayse@example.com', nationality: 'TR', tags: ['VIP'] } });
    const john = await db.guest.create({ data: { hotelId, firstName: 'John', lastName: 'Smith', nationality: 'GB' } });
    const reservation = (guest, { source, status, totalPrice, offset }) =>
      db.reservation.create({
        data: {
          hotelId,
          guestId: guest.id,
          roomTypeId: type.id,
          checkIn: new Date(`${day(offset)}T00:00:00Z`),
          checkOut: new Date(`${day(offset + 2)}T00:00:00Z`),
          adults: 2,
          children: 0,
          status,
          source,
          totalPrice,
          currency: 'TRY',
          confirmationCode: `C${randomUUID().slice(0, 7).toUpperCase()}`,
          createdBy: 'test',
        },
      });
    await reservation(ayse, { source: 'PHONE', status: 'CONFIRMED', totalPrice: '2000', offset: 5 });
    await reservation(ayse, { source: 'PHONE', status: 'CONFIRMED', totalPrice: '3000.50', offset: 10 });
    await reservation(john, { source: 'OTA', status: 'CANCELLED', totalPrice: '1500', offset: 7 });
  });

  it('kataloğun her kaynağının her sütunu çalışır (gruplu ve gruplamasız)', async () => {
    for (const source of contracts.DESIGNER_SOURCES) {
      const columns = contracts.DESIGNER_COLUMNS[source];
      const plain = await run({ source, columns: columns.map((column) => column.key) });
      assert.deepEqual(plain.dataset.columns.map((column) => column.key), columns.map((column) => column.key), source);
      const numeric = columns.filter((column) => contracts.DESIGNER_NUMERIC_TYPES.includes(column.type)).slice(0, 2);
      const grouped = await run({
        source,
        grouped: true,
        columns: [columns.find((column) => column.type === 'enum' || column.type === 'text').key],
        aggregates: [{ fn: 'COUNT' }, ...numeric.map((column) => ({ fn: 'SUM', column: column.key })), ...numeric.slice(0, 1).map((column) => ({ fn: 'AVG', column: column.key }))],
      });
      assert.ok(grouped.dataset.columns.length >= 2, source);
    }
  });

  it('filtre + gruplama + toplam + sıralama doğru; durum adı Türkçe; satır sınırı kesildi işareti', async () => {
    const grouped = await run({
      source: 'RESERVATIONS',
      grouped: true,
      columns: ['source'],
      aggregates: [{ fn: 'COUNT' }, { fn: 'SUM', column: 'totalPrice' }, { fn: 'SUM', column: 'nights' }],
      filters: [{ column: 'status', op: 'NOT_IN', values: ['CANCELLED'] }],
      sort: [{ key: 'SUM:totalPrice', dir: 'DESC' }],
    });
    assert.deepEqual(grouped.dataset.rows, [{ source: 'Telefon', COUNT: 2, 'SUM:totalPrice': '5000.50', 'SUM:nights': 4 }]);

    const plain = await run({
      source: 'RESERVATIONS',
      columns: ['guestName', 'status', 'totalPrice', 'checkIn'],
      filters: [{ column: 'checkIn', op: 'BETWEEN', value: day(6), valueTo: day(30) }, { column: 'guestName', op: 'NOT_EMPTY' }],
      sort: [{ key: 'totalPrice', dir: 'ASC' }],
    });
    assert.deepEqual(plain.dataset.rows.map((row) => [row.guestName, row.status, row.totalPrice]), [
      ['John Smith', 'İptal', '1500.00'],
      ['Ayşe Kaya', 'Onaylı', '3000.50'],
    ]);
    assert.equal(plain.dataset.rows[0].checkIn, day(7));

    const limited = await run({ source: 'RESERVATIONS', columns: ['confirmationCode'], limit: 2 });
    assert.deepEqual([limited.rowCount, limited.truncated], [2, true]);

    const guests = await run({ source: 'GUESTS', columns: ['firstName', 'tags', 'stayCount'], filters: [{ column: 'email', op: 'NOT_EMPTY' }] });
    assert.deepEqual(guests.dataset.rows, [{ firstName: 'Ayşe', tags: 'VIP', stayCount: 0 }]);
  });

  it('kaynağın yetkisi: muhasebe misafir / rezervasyon kaynağını göremez, ödemeleri görür', async () => {
    await rejects(run({ source: 'GUESTS', columns: ['firstName'] }, ACCOUNTING), 'FORBIDDEN');
    await rejects(run({ source: 'RESERVATIONS', columns: ['confirmationCode'] }, ACCOUNTING), 'FORBIDDEN');
    const payments = await run({ source: 'PAYMENTS', columns: ['amount'] }, ACCOUNTING);
    assert.deepEqual(payments.dataset.rows, []);
  });

  it('kaydet, paylaş, çalıştır; başkasınınkini değiştiremez; paylaşılan misafir raporu yetkisize kapalı', async () => {
    const design = { source: 'GUESTS', columns: ['firstName', 'lastName'], sort: [{ key: 'firstName', dir: 'ASC' }] };
    const saved = await as('mudur@hotel.local', () => designer.createDefinition(hotelId, ALL, { title: 'Misafir listesi', shared: false, design: contracts.reportDesignSchema.parse(design) }));
    assert.equal((await as('muhasebe@hotel.local', () => designer.listDefinitions(hotelId, ACCOUNTING, { scope: 'SHARED' }))).items.length, 0);
    const shared = await as('mudur@hotel.local', () => designer.updateDefinition(hotelId, ALL, saved.id, { expectedUpdatedAt: new Date(saved.updatedAt), shared: true }));
    const seen = await as('muhasebe@hotel.local', () => designer.listDefinitions(hotelId, ACCOUNTING, { scope: 'SHARED' }));
    assert.deepEqual(seen.items.map((item) => [item.title, item.isMine, item.allowed]), [['Misafir listesi', false, false]]);
    await rejects(as('muhasebe@hotel.local', () => designer.runDefinition(hotelId, ACCOUNTING, saved.id)), 'FORBIDDEN');
    await rejects(as('muhasebe@hotel.local', () => designer.deleteDefinition(hotelId, saved.id)), 'FORBIDDEN');

    const result = await as('resepsiyon@hotel.local', () => designer.runDefinition(hotelId, contracts.DEFAULT_ROLE_PERMISSIONS.FRONT_DESK, saved.id));
    assert.deepEqual(result.dataset.rows.map((row) => row.firstName), ['Ayşe', 'John']);
    assert.equal(result.report.isMine, false);
    await rejects(as('mudur@hotel.local', () => designer.updateDefinition(hotelId, ALL, saved.id, { expectedUpdatedAt: new Date(saved.updatedAt), title: 'Eski' })), 'STALE_WRITE');
    await as('mudur@hotel.local', () => designer.deleteDefinition(hotelId, shared.id));
    assert.equal(await db.reportDefinition.count({ where: { hotelId } }), 0);
  });
});
