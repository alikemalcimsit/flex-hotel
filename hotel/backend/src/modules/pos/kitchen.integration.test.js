import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Mutfak ekranı / KDS (modül 40) entegrasyon testleri: pano (NONE ve iptal
 * düşer, istasyon süzgeci, kapanan adisyon kaybolur), yalnız-ileri geçişler +
 * olay, garsona "hazır" zili (adisyon başına tek uyarı), oda servisi turu
 * (SERVED yasak, RoomServiceOrder damgalı ve yalnız-ileri senkron; son tur
 * hazır olmadan sipariş hazır olmaz).
 */

const ZONE = 'Europe/Istanbul';
const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

describe('Mutfak ekranı / KDS (modül 40)', { skip }, () => {
  let db;
  let core;
  let kitchen;
  let resetDatabase;
  let hotelId;
  let outlet;
  let table;
  let shift;
  let items;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    kitchen = await import('./kitchen.js');
  });

  after(async () => {
    await db?.$disconnect();
  });

  const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: 'mutfak@hotel.local' }, fn);

  beforeEach(async () => {
    await resetDatabase(db);
    const hotel = await db.hotel.create({
      data: { name: 'KDS Otel', code: `K${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, phoneCountryCode: '90' },
    });
    hotelId = hotel.id;
    outlet = await db.posOutlet.create({ data: { hotelId, code: 'REST', name: 'Restoran', createdBy: 'test' } });
    table = await db.posTable.create({ data: { hotelId, outletId: outlet.id, name: 'Masa 5' } });
    shift = await db.posShift.create({
      data: { hotelId, waiterEmail: 'garson@hotel.local', outletId: outlet.id, openingFloat: '0', businessDate: new Date() },
    });
    const category = await db.menuCategory.create({ data: { hotelId, name: 'Ana Yemek', createdBy: 'test' } });
    const item = (name, station) =>
      db.menuItem.create({ data: { hotelId, categoryId: category.id, name, price: '100', station, createdBy: 'test' } });
    items = { kofte: await item('Köfte', 'HOT'), salata: await item('Salata', 'COLD'), tepsi: await item('Tepsi ücreti', 'NONE') };
  });

  /** Açık adisyon + tur + kalemler (doğrudan M39 modeli). */
  async function seedRound({ lines, checkOverrides = {}, orderOverrides = {} }) {
    const check = await db.posCheck.create({
      data: {
        hotelId,
        outletId: outlet.id,
        tableId: table.id,
        number: `A-${randomUUID().slice(0, 4)}`,
        waiterEmail: 'garson@hotel.local',
        shiftId: shift.id,
        openedBy: 'garson@hotel.local',
        ...checkOverrides,
      },
    });
    const order = await addRound(check, { lines, seq: 1, ...orderOverrides });
    return { check, order };
  }

  /** Adisyona tur ekler (kalemleriyle). */
  async function addRound(check, { lines, seq, ...orderOverrides }) {
    const order = await db.posOrder.create({
      data: { hotelId, checkId: check.id, outletId: outlet.id, seq, sourceKey: `pos:${randomUUID()}`, sentBy: 'garson@hotel.local', ...orderOverrides },
    });
    for (const [index, line] of lines.entries()) {
      await db.posOrderLine.create({
        data: {
          hotelId,
          checkId: check.id,
          orderId: order.id,
          menuItemId: line.item.id,
          name: line.item.name,
          station: line.item.station,
          taxCategory: 'FNB',
          unitPrice: '100',
          quantity: line.quantity,
          voidedQuantity: line.voided ?? 0,
          note: line.note ?? null,
          sortOrder: index,
        },
      });
    }
    return order;
  }

  describe('pano', () => {
    it('kalemler istasyonuyla listelenir; NONE ve tamamen iptal düşer; iptal kalanı azaltır', async () => {
      const { order } = await seedRound({
        lines: [
          { item: items.kofte, quantity: 3, voided: 1, note: 'az pişmiş' },
          { item: items.salata, quantity: 2, voided: 2 }, // tamamen iptal
          { item: items.tepsi, quantity: 1 }, // sistem kalemi
        ],
      });
      const board = await kitchen.listKitchenBoard(hotelId, {});
      assert.equal(board.length, 1);
      assert.equal(board[0].orderId, order.id);
      assert.equal(board[0].tableName, 'Masa 5');
      assert.deepEqual(board[0].lines, [{ id: board[0].lines[0].id, name: 'Köfte', quantity: 2, station: 'HOT', note: 'az pişmiş' }]);
    });

    it('istasyon süzgeci kalemleri daraltır; görünür kalemi kalmayan tur gizlenir; kapanan adisyon panodan düşer', async () => {
      await seedRound({ lines: [{ item: items.kofte, quantity: 1 }] });
      const { check } = await seedRound({ lines: [{ item: items.salata, quantity: 1 }] });

      const bar = await kitchen.listKitchenBoard(hotelId, { station: 'COLD' });
      assert.equal(bar.length, 1);
      assert.equal(bar[0].lines[0].name, 'Salata');

      await db.posCheck.update({ where: { id: check.id }, data: { status: 'CLOSED', closedAt: new Date(), closedBy: 'test', businessDate: new Date() } });
      const fresh = await kitchen.listKitchenBoard(hotelId, {});
      assert.equal(fresh.length, 1);
      assert.equal(fresh[0].lines[0].name, 'Köfte');
    });

    it('tamamen iptal edilen tur panoda görünmez (M41 devri)', async () => {
      await seedRound({ lines: [{ item: items.kofte, quantity: 2, voided: 2 }] });
      assert.deepEqual(await kitchen.listKitchenBoard(hotelId, {}), []);
    });
  });

  describe('durum ilerletme', () => {
    it('yalnız ileri: NEW→PREPARING→READY→SERVED; geri dönüş reddedilir; olay yayınlanır', async () => {
      const { order } = await seedRound({ lines: [{ item: items.kofte, quantity: 1 }] });

      const step1 = await as(() => kitchen.advanceKitchenOrder(hotelId, order.id, { status: 'PREPARING', expectedUpdatedAt: order.updatedAt }));
      assert.equal(step1.status, 'PREPARING');
      const step2 = await as(() => kitchen.advanceKitchenOrder(hotelId, order.id, { status: 'READY', expectedUpdatedAt: new Date(step1.updatedAt) }));
      assert.equal(step2.status, 'READY');

      await assert.rejects(
        as(() => kitchen.advanceKitchenOrder(hotelId, order.id, { status: 'PREPARING', expectedUpdatedAt: new Date(step2.updatedAt) })),
        /geri dönülmez/,
      );

      const step3 = await as(() => kitchen.advanceKitchenOrder(hotelId, order.id, { status: 'SERVED', expectedUpdatedAt: new Date(step2.updatedAt) }));
      assert.equal(step3.status, 'SERVED');
      assert.deepEqual(await kitchen.listKitchenBoard(hotelId, {}), []); // servis edilen panodan düşer

      const events = await db.eventLog.findMany({ where: { hotelId, name: 'fnb.order.status_changed' }, orderBy: { occurredAt: 'asc' } });
      assert.equal(events.length, 3);
      assert.equal(events[0].payload.status, 'PREPARING');
      assert.equal(events[0].payload.tableName, 'Masa 5');
    });

    it('hazır, adisyonun garsonunun ziline düşer; aynı adisyonun turları tek uyarıda toplanır', async () => {
      const waiter = await db.user.create({ data: { hotelId, email: 'garson@hotel.local', passwordHash: 'x', name: 'Garson', role: 'FRONT_DESK' } });
      const { check, order } = await seedRound({ lines: [{ item: items.kofte, quantity: 1 }] });
      const second = await addRound(check, { lines: [{ item: items.salata, quantity: 1 }], seq: 2 });

      await as(() => kitchen.advanceKitchenOrder(hotelId, order.id, { status: 'PREPARING', expectedUpdatedAt: order.updatedAt }));
      assert.equal(await db.staffAlert.count({ where: { hotelId } }), 0); // yalnız "hazır" zil çaldırır

      await as(() => kitchen.advanceKitchenOrder(hotelId, second.id, { status: 'READY', expectedUpdatedAt: second.updatedAt }));
      const [alert] = await db.staffAlert.findMany({ where: { hotelId } });
      assert.equal(alert.userId, waiter.id);
      assert.equal(alert.kind, 'POS');
      assert.equal(alert.title, 'Masa 5 · 2. tur hazır');
      assert.equal(alert.link, `/pos/adisyon/${check.id}`);

      const fresh = await db.posOrder.findFirst({ where: { id: order.id } });
      await as(() => kitchen.advanceKitchenOrder(hotelId, order.id, { status: 'READY', expectedUpdatedAt: fresh.updatedAt }));
      const alerts = await db.staffAlert.findMany({ where: { hotelId } });
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].count, 2);
      assert.equal(alerts[0].title, 'Masa 5 · 1. tur hazır');
    });

    it('bayat sürümle ilerletme reddedilir (iki tablet aynı kartta)', async () => {
      const { order } = await seedRound({ lines: [{ item: items.kofte, quantity: 1 }] });
      await as(() => kitchen.advanceKitchenOrder(hotelId, order.id, { status: 'PREPARING', expectedUpdatedAt: order.updatedAt }));
      await assert.rejects(
        as(() => kitchen.advanceKitchenOrder(hotelId, order.id, { status: 'READY', expectedUpdatedAt: order.updatedAt })),
        (error) => error.code === 'STALE_WRITE',
      );
    });

    it('kapanan adisyonun turu ilerletilemez', async () => {
      const { check, order } = await seedRound({ lines: [{ item: items.kofte, quantity: 1 }] });
      await db.posCheck.update({ where: { id: check.id }, data: { status: 'CLOSED', closedAt: new Date(), closedBy: 'test', businessDate: new Date() } });
      await assert.rejects(
        as(() => kitchen.advanceKitchenOrder(hotelId, order.id, { status: 'PREPARING', expectedUpdatedAt: order.updatedAt })),
        /Adisyon kapanmış/,
      );
    });
  });

  describe('oda servisi turu (M41 birlikte çalışma)', () => {
    async function seedRoomServiceRound() {
      const guest = await db.guest.create({ data: { hotelId, firstName: 'Oda', lastName: 'Misafiri', phone: '+905551110099' } });
      const roomType = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'STD', basePrice: '1000' } });
      const room = await db.room.create({ data: { hotelId, number: '412', roomTypeId: roomType.id } });
      const reservation = await db.reservation.create({
        data: {
          hotelId,
          guestId: guest.id,
          roomTypeId: roomType.id,
          roomId: room.id,
          checkIn: new Date(),
          checkOut: new Date(Date.now() + 86_400_000),
          adults: 1,
          status: 'CHECKED_IN',
          source: 'PHONE',
          totalPrice: '1000',
          confirmationCode: `RS-${randomUUID().slice(0, 6)}`,
          checkedInAt: new Date(),
        },
      });
      const { check, order } = await seedRound({ lines: [{ item: items.kofte, quantity: 1 }], checkOverrides: { tableId: null } });
      const rs = await db.roomServiceOrder.create({
        data: {
          hotelId,
          outletId: outlet.id,
          number: `OS-${randomUUID().slice(0, 6)}`,
          checkId: check.id,
          reservationId: reservation.id,
          roomId: room.id,
          roomNumber: '412',
          guestName: 'Oda Misafiri',
          source: 'STAFF',
          status: 'RECEIVED',
          receivedAt: new Date(),
          deliverAt: new Date('2027-07-01T07:30:00.000Z'),
          dueAt: new Date('2027-07-01T07:30:00.000Z'),
          items: [{ name: 'Köfte', quantity: 1, station: 'HOT' }],
          itemsTotal: '100',
          sourceKey: `rs-test:${randomUUID()}`,
          createdBy: 'test',
        },
      });
      return { check, order, rs };
    }

    it('kartta oda + teslim anı görünür; SERVED reddedilir; READY RoomServiceOrder\'ı damgasıyla yalnız-ileri senkronlar', async () => {
      const { order, rs } = await seedRoomServiceRound();

      const board = await kitchen.listKitchenBoard(hotelId, {});
      assert.equal(board[0].roomService.roomNumber, '412');
      assert.match(board[0].roomService.deliverAt, /07:30/);

      const preparing = await as(() => kitchen.advanceKitchenOrder(hotelId, order.id, { status: 'PREPARING', expectedUpdatedAt: order.updatedAt }));
      const afterPreparing = await db.roomServiceOrder.findFirst({ where: { id: rs.id } });
      assert.equal(afterPreparing.status, 'PREPARING');
      assert.ok(afterPreparing.preparingAt);

      const ready = await as(() => kitchen.advanceKitchenOrder(hotelId, order.id, { status: 'READY', expectedUpdatedAt: new Date(preparing.updatedAt) }));
      assert.equal(ready.status, 'READY');
      const afterReady = await db.roomServiceOrder.findFirst({ where: { id: rs.id } });
      assert.equal(afterReady.status, 'READY');
      assert.ok(afterReady.readyAt);
      assert.equal(await db.staffAlert.count({ where: { hotelId } }), 0); // oda servisinde zil teslim panosunun işi
      const changes = await db.eventLog.findMany({ where: { hotelId, name: 'pos.room_service.changed' }, orderBy: { occurredAt: 'asc' } });
      assert.deepEqual(changes.map((event) => event.payload.status), ['PREPARING', 'READY']);

      await assert.rejects(
        as(() => kitchen.advanceKitchenOrder(hotelId, order.id, { status: 'SERVED', expectedUpdatedAt: new Date(ready.updatedAt) })),
        /oda servisi panosundan/i,
      );

      // Teslim yolculuğu başladıysa (ON_THE_WAY) KDS'nin senkronu dokunmaz.
      await db.roomServiceOrder.update({ where: { id: rs.id }, data: { status: 'ON_THE_WAY', dispatchedAt: new Date(), runnerEmail: 'garson@hotel.local' } });
      const again = await db.posOrder.update({ where: { id: order.id }, data: { status: 'PREPARING' } }); // sahte geri durum (senkron denemesi için)
      await as(() => kitchen.advanceKitchenOrder(hotelId, order.id, { status: 'READY', expectedUpdatedAt: again.updatedAt }));
      assert.equal((await db.roomServiceOrder.findFirst({ where: { id: rs.id } })).status, 'ON_THE_WAY');
    });

    it('ikinci tur mutfaktayken ilk turun hazırı siparişi hazıra almaz; son tur alır', async () => {
      const { check, order, rs } = await seedRoomServiceRound();
      const second = await addRound(check, { lines: [{ item: items.salata, quantity: 1 }], seq: 2 });
      const voidedOnly = await addRound(check, { lines: [{ item: items.kofte, quantity: 1, voided: 1 }], seq: 3 }); // tamamen iptal: beklenmez

      await as(() => kitchen.advanceKitchenOrder(hotelId, order.id, { status: 'READY', expectedUpdatedAt: order.updatedAt }));
      assert.equal((await db.roomServiceOrder.findFirst({ where: { id: rs.id } })).status, 'RECEIVED');

      await as(() => kitchen.advanceKitchenOrder(hotelId, second.id, { status: 'READY', expectedUpdatedAt: second.updatedAt }));
      assert.equal((await db.roomServiceOrder.findFirst({ where: { id: rs.id } })).status, 'READY');
      assert.equal((await db.posOrder.findFirst({ where: { id: voidedOnly.id } })).status, 'NEW');
    });
  });
});
