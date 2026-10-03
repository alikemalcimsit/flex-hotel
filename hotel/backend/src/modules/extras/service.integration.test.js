import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Minibar ve çamaşırhane (modül 19) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: fiyat listesi (kod tekilliği, sürüm, silinen kodun yeniden
 * kullanımı), oda araması (içerideki, çıkan, taşınan misafir), fişin olayla
 * folyoya gitmesi ve vergisi (aktörün yapacağı işi servisle çalıştırarak),
 * çift gönderim, bu arada değişen misafir, geç kalem (açık / kapalı folyo),
 * kayıp, çamaşır siparişinin tutarı / ekspresi / sayım düzeltmesi / durum
 * geçişleri, teslimde ücret, iptalde ücret yok, aynı siparişin eşzamanlı iki
 * teslimi, çıkış uyarısı, günlük rapor, otel sınırı.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const KAT = 'kat@test.local';
const DESK = 'resepsiyon@test.local';
const TC = '10000000146';

describe('minibar ve çamaşırhane (entegrasyon)', { skip }, () => {
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let catalog;
  /** @type {any} */ let minibar;
  /** @type {any} */ let laundry;
  /** @type {any} */ let report;
  /** @type {any} */ let folios;
  /** @type {any} */ let frontDesk;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  /** @type {Record<string, any>} */ let room;
  let roomType;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    catalog = await import('./catalog.js');
    minibar = await import('./minibar.js');
    laundry = await import('./laundry.js');
    report = await import('./report.js');
    folios = await import('../folios/service.js');
    frontDesk = await import('../front-desk/service.js');
    cache = await import('../../lib/cache.js');
  });

  after(async () => {
    await db?.$disconnect();
  });

  const as = (actor, fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
  const kat = (fn) => as(KAT, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const day = (offset) => core.toIsoDay(core.addDays(today(), offset));
  const at = (time, offset = 0) => contracts.zonedWallTimeToUtc(`${day(offset)}T${time}`, ZONE);
  const lastEvent = (name) => db.eventLog.findFirst({ where: { hotelId, name }, orderBy: { occurredAt: 'desc' } });
  const money = (value) => core.toMoneyString(String(value));

  async function rejectsWith(promise, code, message) {
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, code, error.message);
      if (message) assert.match(error.message, message);
      return true;
    });
  }

  beforeEach(async () => {
    await resetDatabase(db);
    frontDesk.clearFrontDeskCache();
    cache.cache.invalidatePrefix('settings:');
    const hotel = await db.hotel.create({
      data: { name: 'Deniz Otel', code: `X${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, checkInTime: '14:00', checkOutTime: '12:00', laundryExpressPct: '50' },
    });
    hotelId = hotel.id;
    await db.user.createMany({
      data: [
        { hotelId, email: KAT, name: 'Kat', passwordHash: 'x', role: 'HOUSEKEEPING' },
        { hotelId, email: DESK, name: 'Resepsiyon', passwordHash: 'x', role: 'FRONT_DESK' },
      ],
    });
    // Minibar: KDV %20 dahil; çamaşırhane: KDV %20 hariç (folyoda eklenir).
    await db.tax.createMany({
      data: [
        { hotelId, name: 'KDV', rate: '20', isIncluded: true, appliesTo: ['MINIBAR'] },
        { hotelId, name: 'KDV', rate: '20', isIncluded: false, appliesTo: ['LAUNDRY'] },
      ],
    });
    roomType = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 2, capacityChildren: 0 } });
    room = {};
    for (const number of ['101', '102', '103']) room[number] = await db.room.create({ data: { hotelId, number, roomTypeId: roomType.id } });
  });

  async function seedStay({ roomNumber = '101', status = 'CHECKED_IN', checkedOutAt = null } = {}) {
    const guest = await db.guest.create({ data: { hotelId, firstName: 'Ayşe', lastName: 'Kaya', idType: 'NATIONAL_ID', idNumber: TC, nationality: 'TR' } });
    return db.reservation.create({
      data: {
        hotelId,
        guestId: guest.id,
        roomTypeId: roomType.id,
        roomId: room[roomNumber].id,
        checkIn: new Date(day(-2)),
        checkOut: new Date(day(1)),
        status,
        checkedInAt: at('15:00', -2),
        checkedInBy: DESK,
        checkedOutAt,
        checkedOutBy: checkedOutAt ? DESK : null,
        confirmedAt: new Date(),
        totalPrice: '3000.00',
        confirmationCode: `H${randomUUID().slice(0, 7).toUpperCase()}`,
      },
    });
  }

  const addMinibar = (overrides = {}) =>
    as('mudur@test.local', () =>
      catalog.createCatalogItem('MINIBAR', hotelId, contracts.minibarItemInputSchema.parse({ code: 'SU', name: 'Su 0,5 L', category: 'DRINK', price: '45', ...overrides })),
    );
  const addLaundry = (overrides = {}) =>
    as('mudur@test.local', () =>
      catalog.createCatalogItem('LAUNDRY', hotelId, contracts.laundryItemInputSchema.parse({ code: 'GOMLEK', name: 'Gömlek', service: 'WASH', price: '120', ...overrides })),
    );

  const record = (body) =>
    kat(() => minibar.recordConsumption(hotelId, contracts.minibarConsumptionSchema.parse({ requestId: randomUUID(), ...body })));

  /** Folyo aktörünün yapacağı işi servisle yapar (olay → kalem). */
  async function runWorker(eventName, source) {
    const event = await lastEvent(eventName);
    return as('billing-worker', () => folios.postExternalCharge(hotelId, event.payload, { source, eventId: event.id }));
  }

  describe('fiyat listesi', () => {
    it('kod tekil (silinmemişler arasında); sürüm eskiyse yazılmaz; silinen kod yeniden kullanılır', async () => {
      const water = await addMinibar();
      await rejectsWith(addMinibar({ name: 'Başka su' }), 'DUPLICATE', /SU kodu kullanılıyor/);
      const stale = new Date(new Date(water.updatedAt).getTime() - 1000);
      await rejectsWith(
        as('mudur@test.local', () =>
          catalog.updateCatalogItem('MINIBAR', hotelId, water.id, contracts.updateMinibarItemSchema.parse({ code: 'SU', name: 'Su', category: 'DRINK', price: '50', expectedUpdatedAt: stale })),
        ),
        'STALE_WRITE',
      );
      await as('mudur@test.local', () => catalog.deleteCatalogItem('MINIBAR', hotelId, water.id));
      const again = await addMinibar({ price: '50' });
      assert.notEqual(again.id, water.id);
      assert.deepEqual((await catalog.activeCatalog('MINIBAR', hotelId)).map((item) => item.price), ['50.00']);
      const audit = await db.auditLog.count({ where: { hotelId, entity: 'MinibarItem' } });
      assert.equal(audit, 3);
    });
  });

  describe('minibar', () => {
    it('oda araması: içerideki misafir, bugün çıkan ve başka odaya taşınan misafir (geç kalem), son sayımlar', async () => {
      const inHouse = await seedStay();
      const left = await seedStay({ status: 'CHECKED_OUT', checkedOutAt: new Date(Date.now() - 3 * 3600_000) });
      const oldLeft = await seedStay({ status: 'CHECKED_OUT', checkedOutAt: new Date(Date.now() - 30 * 3600_000) });
      const moved = await seedStay({ roomNumber: '102' });
      await db.roomStaySegment.create({
        data: { hotelId, reservationId: moved.id, roomId: room['101'].id, startDate: new Date(day(-2)), endDate: new Date(day(0)), movedBy: DESK },
      });
      const view = await kat(() => minibar.lookupRoom(hotelId, { number: '101' }));
      assert.equal(view.inHouse.id, inHouse.id);
      assert.deepEqual(new Set(view.late.map((stay) => stay.id)), new Set([left.id, moved.id]));
      assert.equal(view.late.find((stay) => stay.id === moved.id).reason, 'MOVED');
      assert.ok(!view.late.some((stay) => stay.id === oldLeft.id), '24 saatten eski çıkış geç kalem değil');
      await rejectsWith(kat(() => minibar.lookupRoom(hotelId, { number: '999' })), 'NOT_FOUND');
    });

    it('fiş olayla folyoya gider (minibar vergisiyle); aynı istek ikinci kez gelirse tek fiş; durum "işlendi"', async () => {
      const stay = await seedStay();
      const water = await addMinibar();
      const beer = await addMinibar({ code: 'BIRA', name: 'Bira', category: 'ALCOHOL', price: '215' });
      const body = contracts.minibarConsumptionSchema.parse({
        requestId: randomUUID(),
        roomId: room['101'].id,
        chargeTo: 'IN_HOUSE',
        reservationId: stay.id,
        lines: [
          { itemId: water.id, quantity: 2 },
          { itemId: beer.id, quantity: 1 },
        ],
      });
      const first = await kat(() => minibar.recordConsumption(hotelId, body));
      const again = await kat(() => minibar.recordConsumption(hotelId, body));
      assert.equal(first.created, true);
      assert.equal(again.created, false);
      assert.equal(again.consumption.id, first.consumption.id);
      assert.equal(first.consumption.totalAmount, '305.00');
      assert.equal(first.consumption.posting.status, 'PENDING');
      assert.match(first.consumption.reference, /^MB-[A-Z0-9]{6}$/);

      const posted = await runWorker('minibar.consumed', 'MINIBAR');
      assert.equal(posted.items, 2);
      const items = await db.folioItem.findMany({ where: { reservationId: stay.id }, orderBy: { description: 'asc' } });
      assert.deepEqual(
        items.map((item) => [item.type, item.description, item.quantity, money(item.total), money(item.taxAmount)]),
        [
          ['MINIBAR', `Bira (${first.consumption.reference})`, 1, '215.00', '35.83'],
          ['MINIBAR', `Su 0,5 L (${first.consumption.reference})`, 2, '90.00', '15.00'],
        ],
      );
      // Olay ikinci kez gelse de (aktör tekrar denedi) kalem tek.
      await runWorker('minibar.consumed', 'MINIBAR');
      assert.equal(await db.folioItem.count({ where: { reservationId: stay.id } }), 2);

      const list = await kat(() => minibar.listConsumptions(hotelId, { limit: 10 }));
      assert.equal(list.consumptions[0].posting.status, 'POSTED');
      assert.equal(await db.minibarConsumption.count(), 1);
    });

    it('bu arada misafir çıktıysa "odadaki misafire" fiş yazılmaz; geç kalem açık folyoya, kapalı folyoda iş görevine', async () => {
      const stay = await seedStay();
      const water = await addMinibar();
      await folios.openFolio(hotelId, stay.id, {});
      await db.reservation.update({ where: { id: stay.id }, data: { status: 'CHECKED_OUT', checkedOutAt: new Date(), checkedOutBy: DESK } });
      const lines = [{ itemId: water.id, quantity: 1 }];
      await rejectsWith(record({ roomId: room['101'].id, chargeTo: 'IN_HOUSE', reservationId: stay.id, lines }), 'STAY_CHANGED', /konaklayan misafir yok/);

      await record({ roomId: room['101'].id, chargeTo: 'LATE', reservationId: stay.id, lines });
      const late = await runWorker('minibar.consumed', 'MINIBAR');
      assert.equal(late.late, true);
      assert.equal(await db.folioItem.count({ where: { reservationId: stay.id, source: 'MINIBAR' } }), 1);

      // Folyo ödenip kapandıysa yeni folyo açılmaz: iş kuralı hatası (aktörde görev olur).
      await db.folio.updateMany({ where: { reservationId: stay.id }, data: { status: 'CLOSED', closedAt: new Date(), closedBy: DESK } });
      await record({ roomId: room['101'].id, chargeTo: 'LATE', reservationId: stay.id, lines });
      await rejectsWith(runWorker('minibar.consumed', 'MINIBAR'), 'FOLIO_CLOSED');
      assert.equal(await db.folio.count({ where: { reservationId: stay.id } }), 1, 'çıkmış misafire yeni folyo açılmadı');
    });

    it('kayıp folyoya gitmez (olay yok), gerekçesiyle durur; satıştan kalkan ürün yazılamaz', async () => {
      const water = await addMinibar();
      const result = await record({ roomId: room['103'].id, chargeTo: 'NONE', lossReason: 'Boş odada eksik bulundu', lines: [{ itemId: water.id, quantity: 1 }] });
      assert.equal(result.consumption.posting.status, 'LOSS');
      assert.equal(await db.eventLog.count({ where: { hotelId, name: 'minibar.consumed' } }), 0);
      await as('mudur@test.local', () =>
        catalog.updateCatalogItem('MINIBAR', hotelId, water.id, contracts.updateMinibarItemSchema.parse({ ...water, active: false, expectedUpdatedAt: water.updatedAt })),
      );
      await rejectsWith(record({ roomId: room['103'].id, chargeTo: 'NONE', lossReason: 'x eksik', lines: [{ itemId: water.id, quantity: 1 }] }), 'VALIDATION', /satıştan kalkmış/);
    });
  });

  describe('çamaşırhane', () => {
    const order = (stay, lines, overrides = {}) =>
      as(DESK, () =>
        laundry.createLaundryOrder(
          hotelId,
          contracts.laundryOrderSchema.parse({
            requestId: randomUUID(),
            roomId: stay.roomId,
            reservationId: stay.id,
            dueAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
            lines,
            ...overrides,
          }),
        ),
      );
    const move = (current, status, reason) =>
      as(KAT, () => laundry.changeLaundryStatus(hotelId, current.id, contracts.laundryStatusSchema.parse({ expectedUpdatedAt: current.updatedAt, status, reason })));

    it('ekspres sipariş tutarı; sayımda eski fiyat korunur; ileri durumlar; teslimde ücret (ekspres farkı ayrı satır, vergi eklenir)', async () => {
      const stay = await seedStay();
      const shirt = await addLaundry();
      const suit = await addLaundry({ code: 'TAKIM', name: 'Takım elbise', service: 'DRY_CLEAN', price: '400' });
      const created = (await order(stay, [{ itemId: shirt.id, quantity: 2 }], { express: true })).order;
      assert.deepEqual([created.subtotal, created.surcharge, created.total, created.expressPct], ['240.00', '120.00', '360.00', '50']);
      assert.match(created.reference, /^LND-/);

      // Fiyat değişti; sayımda gömlek eski fiyatla, takım güncel fiyatla.
      await as('mudur@test.local', () =>
        catalog.updateCatalogItem('LAUNDRY', hotelId, shirt.id, contracts.updateLaundryItemSchema.parse({ ...shirt, price: '150', expectedUpdatedAt: shirt.updatedAt })),
      );
      const recounted = await as(KAT, () =>
        laundry.updateLaundryLines(
          hotelId,
          created.id,
          contracts.laundryLinesSchema.parse({ expectedUpdatedAt: created.updatedAt, lines: [{ itemId: shirt.id, quantity: 3 }, { itemId: suit.id, quantity: 1 }] }),
        ),
      );
      assert.deepEqual([recounted.subtotal, recounted.surcharge, recounted.total, recounted.itemCount], ['760.00', '380.00', '1140.00', 4]);
      await rejectsWith(
        as(KAT, () => laundry.updateLaundryLines(hotelId, created.id, contracts.laundryLinesSchema.parse({ expectedUpdatedAt: created.updatedAt, lines: [{ itemId: shirt.id, quantity: 1 }] }))),
        'STALE_WRITE',
      );

      const ready = await move(recounted, 'READY');
      await rejectsWith(move(ready, 'IN_PROCESS'), 'LAUNDRY_RULE', /geri alınamaz/);
      await rejectsWith(
        as(KAT, () => laundry.updateLaundryLines(hotelId, created.id, contracts.laundryLinesSchema.parse({ expectedUpdatedAt: ready.updatedAt, lines: [{ itemId: shirt.id, quantity: 1 }] }))),
        'LAUNDRY_RULE',
      );
      const delivered = await move(ready, 'DELIVERED');
      assert.equal(delivered.status, 'DELIVERED');
      assert.equal(delivered.posting.status, 'PENDING');

      const posted = await runWorker('laundry.charged', 'LAUNDRY');
      assert.equal(posted.items, 3);
      const items = await db.folioItem.findMany({ where: { reservationId: stay.id }, orderBy: { description: 'asc' } });
      assert.deepEqual(
        items.map((item) => [item.type, item.description.replace(/ \(LND-\w+\)$/, ''), item.quantity, money(item.total)]),
        [
          ['LAUNDRY', 'Ekspres farkı (%50)', 1, '456.00'],
          ['LAUNDRY', 'Gömlek — Yıkama + ütü', 3, '432.00'],
          ['LAUNDRY', 'Takım elbise — Kuru temizleme', 1, '480.00'],
        ],
      );
      assert.equal((await laundry.getLaundryOrder(hotelId, created.id)).posting.status, 'POSTED');
    });

    it('iptal gerekçeli ve ücretsiz; misafir odada değilse sipariş alınmaz; teslim zamanı geçmiş olamaz', async () => {
      const stay = await seedStay();
      const shirt = await addLaundry();
      const created = (await order(stay, [{ itemId: shirt.id, quantity: 1 }])).order;
      const cancelled = await move(created, 'CANCELLED', 'Misafir vazgeçti');
      assert.equal(cancelled.cancelReason, 'Misafir vazgeçti');
      assert.equal(await db.eventLog.count({ where: { hotelId, name: 'laundry.charged' } }), 0);
      await rejectsWith(move(cancelled, 'DELIVERED'), 'LAUNDRY_RULE', /İptal edilmiş/);

      const other = await seedStay({ roomNumber: '102' });
      await rejectsWith(order({ ...other, roomId: room['101'].id }, [{ itemId: shirt.id, quantity: 1 }]), 'STAY_CHANGED');
      await rejectsWith(order(stay, [{ itemId: shirt.id, quantity: 1 }], { dueAt: new Date(Date.now() - 60_000).toISOString() }), 'VALIDATION', /şimdiden sonra/);
    });

    it('aynı siparişin eşzamanlı iki teslimi: ücret bir kez', async () => {
      const stay = await seedStay();
      const shirt = await addLaundry();
      const created = (await order(stay, [{ itemId: shirt.id, quantity: 1 }])).order;
      const results = await Promise.allSettled([move(created, 'DELIVERED'), move(created, 'DELIVERED')]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'STALE_WRITE');
      assert.equal(await db.eventLog.count({ where: { hotelId, name: 'laundry.charged' } }), 1);
    });

    it('pano: açık / geciken / teslim; oda no ve sipariş no ile arama; çıkış penceresi teslim edilmemişi uyarır', async () => {
      const stay = await seedStay();
      const shirt = await addLaundry();
      const late = (await order(stay, [{ itemId: shirt.id, quantity: 1 }])).order;
      await db.laundryOrder.update({ where: { id: late.id }, data: { dueAt: new Date(Date.now() - 3600_000) } });
      const fresh = (await order(stay, [{ itemId: shirt.id, quantity: 2 }])).order;

      const open = await laundry.listLaundryOrders(hotelId, { view: 'OPEN', page: 1, pageSize: 10 });
      assert.deepEqual(open.items.map((row) => row.id), [late.id, fresh.id], 'teslim zamanı sırasıyla');
      assert.equal(open.items[0].overdue, true);
      const overdue = await laundry.listLaundryOrders(hotelId, { view: 'OVERDUE', page: 1, pageSize: 10 });
      assert.deepEqual(overdue.items.map((row) => row.id), [late.id]);
      const byRoom = await laundry.listLaundryOrders(hotelId, { view: 'OPEN', search: '101', page: 1, pageSize: 10 });
      assert.equal(byRoom.meta.total, 2);
      const byReference = await laundry.listLaundryOrders(hotelId, { view: 'OPEN', search: fresh.reference.slice(4), page: 1, pageSize: 10 });
      assert.deepEqual(byReference.items.map((row) => row.id), [fresh.id]);

      const preview = await frontDesk.getCheckOutPreview(hotelId, stay.id, { now: at('11:00', 1) });
      assert.deepEqual(preview.openLaundry.map((row) => row.reference).sort(), [late.reference, fresh.reference].sort());
    });
  });

  describe('günlük rapor ve otel sınırı', () => {
    it('minibar yazılan / kayıp ve ürün kırılımı; çamaşır alınan / teslim / geciken', async () => {
      const stay = await seedStay();
      const water = await addMinibar();
      const shirt = await addLaundry();
      await record({ roomId: room['101'].id, chargeTo: 'IN_HOUSE', reservationId: stay.id, lines: [{ itemId: water.id, quantity: 3 }] });
      await record({ roomId: room['103'].id, chargeTo: 'NONE', lossReason: 'Boş odada eksik', lines: [{ itemId: water.id, quantity: 1 }] });
      const created = (
        await as(DESK, () =>
          laundry.createLaundryOrder(
            hotelId,
            contracts.laundryOrderSchema.parse({ requestId: randomUUID(), roomId: stay.roomId, reservationId: stay.id, dueAt: new Date(Date.now() + 3600_000).toISOString(), lines: [{ itemId: shirt.id, quantity: 2 }] }),
          ),
        )
      ).order;
      await as(KAT, () => laundry.changeLaundryStatus(hotelId, created.id, contracts.laundryStatusSchema.parse({ expectedUpdatedAt: created.updatedAt, status: 'DELIVERED' })));

      const result = await report.getExtrasReport(hotelId, {});
      assert.equal(result.minibar.chargedAmount, '135.00');
      assert.equal(result.minibar.lossAmount, '45.00');
      assert.deepEqual(result.minibar.items.map((row) => [row.name, row.quantity, row.lossQuantity]), [['Su 0,5 L', 3, 1]]);
      assert.equal(result.minibar.staff[0].staff, KAT);
      assert.equal(result.laundry.received.orders, 1);
      assert.equal(result.laundry.delivered.amount, '240.00');
      assert.deepEqual(result.laundry.delivered.byService, [{ service: 'WASH', quantity: 2, amount: '240.00' }]);
      assert.equal(result.laundry.openNow, 0);
      await rejectsWith(report.getExtrasReport(hotelId, { date: day(1) }), 'VALIDATION');
    });

    it('başka otelin odası, siparişi ve ürünü bulunmaz', async () => {
      const stay = await seedStay();
      const shirt = await addLaundry();
      const other = await db.hotel.create({ data: { name: 'Başka', code: `O${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE } });
      await rejectsWith(kat(() => minibar.lookupRoom(other.id, { number: '101' })), 'NOT_FOUND');
      const created = (
        await as(DESK, () =>
          laundry.createLaundryOrder(
            hotelId,
            contracts.laundryOrderSchema.parse({ requestId: randomUUID(), roomId: stay.roomId, reservationId: stay.id, dueAt: new Date(Date.now() + 3600_000).toISOString(), lines: [{ itemId: shirt.id, quantity: 1 }] }),
          ),
        )
      ).order;
      await rejectsWith(laundry.getLaundryOrder(other.id, created.id), 'NOT_FOUND');
      await rejectsWith(
        as(KAT, () => laundry.changeLaundryStatus(other.id, created.id, contracts.laundryStatusSchema.parse({ expectedUpdatedAt: created.updatedAt, status: 'READY' }))),
        'NOT_FOUND',
      );
      assert.deepEqual(await catalog.activeCatalog('LAUNDRY', other.id), []);
    });
  });
});
