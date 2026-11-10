import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Teknik servis / arıza-bakım (modül 20) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: bilet açma, odayı arızaya alma (RoomBlock) ve çözümde kaldırma,
 * dolu odada kapatmanın reddi, kat görevlisi bildiriminden bilet (idempotent),
 * misafir isteğiyle durum senkronu, yaşam döngüsü ve periyodik plandan üretim.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const TECH = 'teknisyen@test.local';

describe('teknik servis (entegrasyon)', { skip }, () => {
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let maintenance;
  /** @type {any} */ let rooms;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let techUserId;
  /** @type {Record<string, any>} */ let room;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    maintenance = await import('./service.js');
    rooms = await import('../rooms/service.js');
    cache = await import('../../lib/cache.js');
  });

  after(async () => {
    await db?.$disconnect();
  });

  const as = (actor, fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const day = (offset) => core.toIsoDay(core.addDays(today(), offset));
  const eventsNamed = (name) => db.eventLog.findMany({ where: { hotelId, name }, orderBy: { occurredAt: 'asc' }, select: { payload: true } });

  beforeEach(async () => {
    await resetDatabase(db);
    cache.cache.invalidatePrefix('settings:');
    cache.cache.invalidatePrefix('business-date:');
    (await import('../../lib/staff.js')).clearStaffCache();
    const hotel = await db.hotel.create({ data: { name: 'Teknik Otel', code: `T${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE } });
    hotelId = hotel.id;
    const tech = await db.user.create({ data: { hotelId, email: TECH, name: 'Teknisyen', passwordHash: 'x', role: 'HOUSEKEEPING' } });
    techUserId = tech.id;
    const std = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 2 } });
    room = {};
    for (const number of ['101', '102']) {
      room[number] = await db.room.create({ data: { hotelId, number, roomTypeId: std.id } });
    }
  });

  it('bilet açılır: PENDING, olay ve personel uyarısı', async () => {
    const ticket = await as(TECH, () => maintenance.createTicket(hotelId, { roomId: room['101'].id, category: 'HVAC', title: 'Klima bozuk', description: 'Soğutmuyor', priority: 2 }));
    assert.equal(ticket.status, 'PENDING');
    assert.equal(ticket.roomNumber, '101');
    assert.equal((await eventsNamed('maintenance.ticket.created')).length, 1);
    const alerts = await db.staffAlert.findMany({ where: { hotelId, kind: 'MAINTENANCE' } });
    assert.equal(alerts.length, 1);
  });

  it('odayı arızaya alır ve çözümde arıza kaydını kaldırır', async () => {
    const ticket = await as(TECH, () =>
      maintenance.createTicket(hotelId, { roomId: room['101'].id, category: 'PLUMBING', title: 'Su basması', description: 'Banyo', priority: 1, closeRoom: { type: 'OUT_OF_ORDER' } }),
    );
    assert.ok(ticket.roomBlockId, 'arıza kaydı açılmalı');
    const block = await db.roomBlock.findFirst({ where: { id: ticket.roomBlockId } });
    assert.equal(block.type, 'OUT_OF_ORDER');

    const resolved = await as(TECH, () => maintenance.resolveTicket(hotelId, ticket.id, { resolutionNote: 'Tamir edildi' }));
    assert.equal(resolved.status, 'DONE');
    // Arıza kaydı kaldırıldı: aynı gün açılıp kapandığı için iptal (deletedAt);
    // önceki günden süren kayıt olsaydı sonlandırılır (endDate). İkisi de "oda serbest".
    const after = await db.roomBlock.findFirst({ where: { id: ticket.roomBlockId } });
    assert.ok(after.endDate || after.deletedAt, 'arıza kaydı kaldırılmalı');
    // Oda yeniden satılabilir: açık (süren) arıza kaydı kalmadı.
    const live = await db.roomBlock.findFirst({ where: { roomId: room['101'].id, deletedAt: null, endDate: null } });
    assert.equal(live, null, 'odada açık arıza kaydı kalmamalı');
  });

  it('dolu odayı kapatmak reddedilir (misafiri taşı)', async () => {
    const guest = await db.guest.create({ data: { hotelId, firstName: 'A', lastName: 'B', idType: 'NATIONAL_ID', idNumber: '10000000146', nationality: 'TR' } });
    await db.reservation.create({
      data: {
        hotelId, guestId: guest.id, roomTypeId: (await db.roomType.findFirst({ where: { hotelId } })).id, roomId: room['101'].id,
        checkIn: new Date(day(0)), checkOut: new Date(day(3)), status: 'CONFIRMED', confirmedAt: new Date(),
        totalPrice: '3000.00', confirmationCode: `H${randomUUID().slice(0, 7).toUpperCase()}`,
      },
    });
    await assert.rejects(
      as(TECH, () => maintenance.createTicket(hotelId, { roomId: room['101'].id, title: 'Boya', description: 'x', closeRoom: { type: 'OUT_OF_ORDER' } })),
      (error) => error.code === 'HAS_RESERVATIONS' || error.code === 'WOULD_OVERBOOK',
    );
    // Bilet açılmadı.
    assert.equal(await db.maintenanceTicket.count({ where: { hotelId } }), 0);
  });

  it('kat görevlisi bildiriminden bilet açılır (idempotent)', async () => {
    const payload = { hotelId, taskId: randomUUID(), roomId: room['102'].id, roomNumber: '102', note: 'Duş başlığı kırık' };
    const subscribers = await import('../housekeeping/subscribers.js');
    await subscribers.onHousekeepingIssue(payload);
    await subscribers.onHousekeepingIssue(payload); // ikinci kez
    const tickets = await db.maintenanceTicket.findMany({ where: { hotelId, housekeepingTaskId: payload.taskId } });
    assert.equal(tickets.length, 1, 'aynı görevden tek bilet');
    assert.equal(tickets[0].source, 'housekeeping');
  });

  it('misafir isteğine bağlı bilet isteğin durumunu sürükler', async () => {
    const request = await db.guestRequest.create({
      data: { hotelId, roomId: room['101'].id, category: 'MAINTENANCE', title: 'Klima çalışmıyor', status: 'OPEN', dueAt: new Date(), createdBy: TECH },
    });
    const ticket = await as(TECH, () => maintenance.createTicket(hotelId, { roomId: room['101'].id, title: 'Klima', description: 'Bakılacak', guestRequestId: request.id }));
    assert.equal((await db.guestRequest.findUnique({ where: { id: request.id } })).status, 'IN_PROGRESS');

    await as(TECH, () => maintenance.resolveTicket(hotelId, ticket.id, {}));
    assert.equal((await db.guestRequest.findUnique({ where: { id: request.id } })).status, 'DONE');
  });

  it('atama → başlat → çöz yaşam döngüsü', async () => {
    const ticket = await as(TECH, () => maintenance.createTicket(hotelId, { roomId: room['101'].id, title: 'Priz', description: 'x' }));
    await as(TECH, () => maintenance.assignTicket(hotelId, ticket.id, { assignedTo: techUserId }));
    const started = await as(TECH, () => maintenance.startTicket(hotelId, ticket.id));
    assert.equal(started.status, 'IN_PROGRESS');
    assert.ok(started.startedAt);
    const done = await as(TECH, () => maintenance.resolveTicket(hotelId, ticket.id, {}));
    assert.equal(done.status, 'DONE');
    // Kapanmış bilete işlem yapılamaz.
    await assert.rejects(as(TECH, () => maintenance.startTicket(hotelId, ticket.id)), (e) => e.code === 'TICKET_CLOSED');
  });

  it('atanmamış bileti başlatan teknisyen üstlenir (userId; MINE görünümünde çıkar)', async () => {
    const ticket = await as(TECH, () => maintenance.createTicket(hotelId, { roomId: room['101'].id, title: 'Musluk', description: 'damlıyor' }));
    assert.equal(ticket.assignedTo, null);
    const started = await as(TECH, () => maintenance.startTicket(hotelId, ticket.id));
    assert.equal(started.status, 'IN_PROGRESS');
    assert.equal(started.assignedTo, techUserId, 'başlatan teknisyene userId ile atanmalı');
    const mine = await as(TECH, () => maintenance.listTickets(hotelId, { view: 'MINE', page: 1, pageSize: 20 }));
    assert.ok(mine.items.some((t) => t.id === ticket.id), 'bilet "bana atananlar"da görünmeli');
  });

  it('periyodik plandan bilet üretir (tekrar üretmez)', async () => {
    await as(TECH, () => maintenance.createPlan(hotelId, { title: 'Aylık klima bakımı', category: 'HVAC', roomId: room['101'].id, intervalDays: 30, checklist: ['Filtre temizliği', 'Gaz kontrolü'] }));
    const created = await as('sistem:teknik-servis', () => maintenance.generateDuePlanTickets());
    assert.equal(created, 1);
    const tickets = await db.maintenanceTicket.findMany({ where: { hotelId, source: 'plan' } });
    assert.equal(tickets.length, 1);
    assert.match(tickets[0].description, /Filtre temizliği/);
    // İkinci tur: açık bilet duruyor, yeni üretmez.
    const again = await as('sistem:teknik-servis', () => maintenance.generateDuePlanTickets());
    assert.equal(again, 0);
  });
});
