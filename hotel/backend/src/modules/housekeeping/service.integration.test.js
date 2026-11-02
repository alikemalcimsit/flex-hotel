import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Kat hizmetleri servisi — entegrasyon testleri (gerçek PostgreSQL).
 *
 * Buradaki iddialar yalnızca veritabanıyla doğrulanabilir: oda başına tek açık
 * temizlik görevi (kısmi tekil index + servis tekilleştirmesi), sabah
 * üretiminin idempotentliği, sürüm çakışması (STALE_WRITE) ve dört göz kuralı
 * kullanıcı kayıtlarıyla.
 *
 * Çalıştırmak için (boş bir test veritabanı ile):
 *   DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy
 *   TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

describe('kat hizmetleri servisi (entegrasyon)', { skip }, () => {
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  /** @type {any} */ let prismaUnfiltered;
  /** @type {any} */ let service;
  /** @type {any} */ let core;
  let hotelId;
  let roomA;
  let roomB;
  let cleaner;
  let cleanerId;
  let chiefId;

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

    const type = await prismaUnfiltered.roomType.create({
      data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 2, capacityChildren: 1 },
    });
    roomA = await prismaUnfiltered.room.create({
      data: { hotelId, number: '101', floor: 1, roomTypeId: type.id, housekeepingStatus: 'DIRTY' },
    });
    roomB = await prismaUnfiltered.room.create({
      data: { hotelId, number: '201', floor: 2, roomTypeId: type.id, occupancy: 'OCCUPIED' },
    });

    cleaner = await prismaUnfiltered.user.create({
      data: {
        hotelId,
        email: `gorevli-${randomUUID().slice(0, 8)}@hotel.local`,
        passwordHash: 'x',
        name: 'Kat Görevlisi',
        role: 'HOUSEKEEPING',
      },
    });
    cleanerId = cleaner.id;
    const chief = await prismaUnfiltered.user.create({
      data: {
        hotelId,
        email: `sef-${randomUUID().slice(0, 8)}@hotel.local`,
        passwordHash: 'x',
        name: 'Kat Şefi',
        role: 'HOUSEKEEPING',
      },
    });
    chiefId = chief.id;
  });

  /** İşlemi belirli bir personel kimliğiyle çalıştırır (dört göz testleri için). */
  function asStaff(email, fn) {
    return core.runWithContext({ actor: email }, fn);
  }

  it('sistem görevi tekilleştirir: aynı odaya ikinci açık temizlik görevi açılmaz', async () => {
    const first = await service.createSystemCleaningTask(hotelId, { roomId: roomA.id, type: 'CHECKOUT_CLEAN' });
    const second = await service.createSystemCleaningTask(hotelId, { roomId: roomA.id, type: 'DEEP_CLEAN' });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.task.id, first.task.id);

    const open = await prismaUnfiltered.housekeepingTask.count({ where: { hotelId, roomId: roomA.id } });
    assert.equal(open, 1);
  });

  it('elle açılan çift görev DUPLICATE_TASK hatası döner', async () => {
    await service.createTask(hotelId, { roomId: roomA.id, type: 'STAYOVER', priority: 3 });
    await assert.rejects(
      () => service.createTask(hotelId, { roomId: roomA.id, type: 'DEEP_CLEAN', priority: 3 }),
      /açık bir temizlik görevi/,
    );
  });

  it('sabah üretimi: kalan oda görev alır, bugün çıkan almaz; ikinci koşu hiçbir şey üretmez', async () => {
    const today = await core.calendarDateInTimeZone('Europe/Istanbul', new Date());
    await prismaUnfiltered.guest.create({ data: { hotelId, firstName: 'A', lastName: 'B' } });
    const guest = await prismaUnfiltered.guest.findFirst({ where: { hotelId } });
    const type = await prismaUnfiltered.roomType.findFirst({ where: { hotelId } });

    // roomB: içeride, yarından sonra çıkacak → görev almalı.
    await prismaUnfiltered.reservation.create({
      data: {
        hotelId,
        guestId: guest.id,
        roomTypeId: type.id,
        roomId: roomB.id,
        status: 'CHECKED_IN',
        checkedInAt: new Date(),
        checkIn: core.addDays(today, -1),
        checkOut: core.addDays(today, 2),
        adults: 1,
        children: 0,
        totalPrice: '1000',
        confirmationCode: `C-${randomUUID().slice(0, 8)}`,
      },
    });
    // roomA: içeride ama bugün çıkacak → görev almamalı.
    await prismaUnfiltered.reservation.create({
      data: {
        hotelId,
        guestId: guest.id,
        roomTypeId: type.id,
        roomId: roomA.id,
        status: 'CHECKED_IN',
        checkedInAt: new Date(),
        checkIn: core.addDays(today, -2),
        checkOut: today,
        adults: 1,
        children: 0,
        totalPrice: '1000',
        confirmationCode: `C-${randomUUID().slice(0, 8)}`,
      },
    });

    const created = await service.generateStayoverTasks();
    assert.equal(created, 1);

    const tasks = await prismaUnfiltered.housekeepingTask.findMany({ where: { hotelId } });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].roomId, roomB.id);
    assert.equal(tasks[0].type, 'STAYOVER');
    assert.equal(tasks[0].source, 'system');

    const secondRun = await service.generateStayoverTasks();
    assert.equal(secondRun, 0);
  });

  it('başlat → bitir akışı: damgalar ve üstlenen kişi yazılır, olaylar yayınlanır', async () => {
    const task = await service.createTask(hotelId, { roomId: roomA.id, type: 'CHECKOUT_CLEAN', priority: 2 });

    const started = await asStaff(cleaner.email, () =>
      service.startTask(hotelId, task.id, { expectedUpdatedAt: new Date(task.updatedAt) }),
    );
    assert.equal(started.status, 'IN_PROGRESS');
    assert.equal(started.assignedTo.id, cleanerId);
    assert.ok(started.startedAt);

    const completed = await asStaff(cleaner.email, () =>
      service.completeTask(hotelId, task.id, { expectedUpdatedAt: new Date(started.updatedAt), note: 'Tamam' }),
    );
    assert.equal(completed.status, 'DONE');
    assert.equal(completed.completedBy.id, cleanerId);

    const events = await prismaUnfiltered.eventLog.findMany({
      where: { hotelId, name: { in: ['housekeeping.task.started', 'housekeeping.task.completed'] } },
    });
    assert.equal(events.length, 2);
  });

  it('bayat sürümle yazma STALE_WRITE ile reddedilir', async () => {
    const task = await service.createTask(hotelId, { roomId: roomA.id, type: 'DEEP_CLEAN', priority: 3 });
    await assert.rejects(
      () => service.startTask(hotelId, task.id, { expectedUpdatedAt: new Date('2020-01-01T00:00:00Z') }),
      (error) => error.code === 'STALE_WRITE' || /değiştirdi|sürüm/i.test(error.message ?? ''),
    );
  });

  it('dört göz: temizleyen kendi işini onaylayamaz, şef onaylar; ret düzeltme görevi açar', async () => {
    const task = await service.createTask(hotelId, { roomId: roomA.id, type: 'CHECKOUT_CLEAN', priority: 2 });
    const started = await asStaff(cleaner.email, () =>
      service.startTask(hotelId, task.id, { expectedUpdatedAt: new Date(task.updatedAt) }),
    );
    const completed = await asStaff(cleaner.email, () =>
      service.completeTask(hotelId, task.id, { expectedUpdatedAt: new Date(started.updatedAt) }),
    );

    await assert.rejects(
      () =>
        asStaff(cleaner.email, () =>
          service.inspectTask(hotelId, task.id, { expectedUpdatedAt: new Date(completed.updatedAt), passed: true }),
        ),
      /dört göz/,
    );

    const chief = await prismaUnfiltered.user.findFirst({ where: { id: chiefId } });
    const rejected = await asStaff(chief.email, () =>
      service.inspectTask(hotelId, task.id, {
        expectedUpdatedAt: new Date(completed.updatedAt),
        passed: false,
        note: 'Banyo yeniden silinecek',
      }),
    );
    assert.equal(rejected.task.inspection.passed, false);
    assert.ok(rejected.followUpTask);
    assert.equal(rejected.followUpTask.priority, 2);
    assert.match(rejected.followUpTask.notes, /Kontrolden döndü/);

    // Reddedilen görev ikinci kez kontrol edilemez.
    await assert.rejects(
      () =>
        asStaff(chief.email, () =>
          service.inspectTask(hotelId, task.id, {
            expectedUpdatedAt: new Date(rejected.task.updatedAt),
            passed: true,
          }),
        ),
      /zaten kontrol/,
    );
  });

  it('misafir isteği göreve çevrilir; istek başına tek açık görev', async () => {
    const request = await prismaUnfiltered.guestRequest.create({
      data: {
        hotelId,
        roomId: roomA.id,
        category: 'AMENITY',
        title: 'Havlu rica',
        status: 'OPEN',
        priority: 'HIGH',
        source: 'STAFF',
        createdBy: 'test@hotel.local',
        dueAt: new Date(),
      },
    });

    const first = await service.createRequestTask(hotelId, { requestId: request.id, roomId: roomA.id, priority: 'HIGH' });
    const second = await service.createRequestTask(hotelId, { requestId: request.id, roomId: roomA.id, priority: 'HIGH' });

    assert.equal(first.created, true);
    assert.equal(first.task.type, 'GUEST_REQUEST');
    assert.equal(first.task.priority, 2);
    assert.equal(second.created, false);

    // Havlu görevi varken temizlik görevi de açılabilmeli (kısmi index muafiyeti).
    const cleaning = await service.createSystemCleaningTask(hotelId, { roomId: roomA.id, type: 'CHECKOUT_CLEAN' });
    assert.equal(cleaning.created, true);
  });

  it('çıkış geri alınınca açık çıkış temizliği iptal edilir, diğer tipler kalır', async () => {
    await service.createSystemCleaningTask(hotelId, { roomId: roomA.id, type: 'CHECKOUT_CLEAN' });
    const result = await service.cancelOpenCheckoutTasks(hotelId, roomA.id, 'Çıkış geri alındı: yanlış misafir');
    assert.equal(result.cancelled, 1);

    const cancelled = await prismaUnfiltered.housekeepingTask.findFirst({ where: { hotelId, roomId: roomA.id } });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.match(cancelled.cancelReason, /yanlış misafir/);
  });

  it('toplu atama: açık görevler atanır, kapanmış görev listeyi reddettirir', async () => {
    const taskA = await service.createTask(hotelId, { roomId: roomA.id, type: 'STAYOVER', priority: 3 });
    const taskB = await service.createTask(hotelId, { roomId: roomB.id, type: 'STAYOVER', priority: 3 });

    const assigned = await service.assignTasks(hotelId, { taskIds: [taskA.id, taskB.id], assignedToId: cleanerId });
    assert.ok(assigned.every((task) => task.assignedTo?.id === cleanerId));

    await service.cancelTask(hotelId, taskA.id, {
      expectedUpdatedAt: new Date(assigned.find((t) => t.id === taskA.id).updatedAt),
      reason: 'Oda satış dışı',
    });
    await assert.rejects(
      () => service.assignTasks(hotelId, { taskIds: [taskA.id, taskB.id], assignedToId: null }),
      /kapanmış/,
    );

    const staff = await service.housekeepingStaff(hotelId);
    const me = staff.find((user) => user.id === cleanerId);
    assert.equal(me.openTasks, 1);
  });

  it('liste: bugünün görevleri + önceki günden devreden açıklar; filtreler çalışır', async () => {
    const today = await core.calendarDateInTimeZone('Europe/Istanbul', new Date());
    const yesterday = core.addDays(today, -1);

    await service.createTask(hotelId, { roomId: roomA.id, type: 'DEEP_CLEAN', priority: 1 });
    // Dünden kalan açık görev (devreden) — doğrudan tabloya.
    await prismaUnfiltered.housekeepingTask.create({
      data: { hotelId, roomId: roomB.id, type: 'STAYOVER', status: 'PENDING', priority: 3, scheduledFor: yesterday, source: 'system' },
    });

    const page = await service.listTasks(hotelId, { page: 1, pageSize: 10 });
    assert.equal(page.items.length, 2);
    const carried = page.items.find((task) => task.room.id === roomB.id);
    assert.equal(carried.carriedOver, true);

    const filtered = await service.listTasks(hotelId, { page: 1, pageSize: 10, floor: 1 });
    assert.equal(filtered.items.length, 1);
    assert.equal(filtered.items[0].room.number, '101');

    const summary = await service.taskSummary(hotelId);
    assert.equal(summary.open, 2);
  });

  it('kat haritası: kutular kat kat, açık görev ve doluluk işaretli', async () => {
    await service.createSystemCleaningTask(hotelId, { roomId: roomA.id, type: 'CHECKOUT_CLEAN' });
    const map = await service.floorMap(hotelId);

    assert.deepEqual(map.floors.map((floor) => floor.floor), [1, 2]);
    const box = map.floors[0].rooms.find((room) => room.number === '101');
    assert.equal(box.openTask.type, 'CHECKOUT_CLEAN');
    assert.equal(box.housekeepingStatus, 'DIRTY');
  });

  it('kat haritası yalnız bu otelin odalarını gösterir (başka otelin odası karışmaz)', async () => {
    const other = await prismaUnfiltered.hotel.create({ data: { name: 'Başka Otel', code: `OTH-${randomUUID().slice(0, 8)}` } });
    const otherType = await prismaUnfiltered.roomType.create({
      data: { hotelId: other.id, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 2, capacityChildren: 1 },
    });
    await prismaUnfiltered.room.create({ data: { hotelId: other.id, number: '999', floor: 9, roomTypeId: otherType.id } });

    const map = await service.floorMap(hotelId);
    assert.deepEqual(map.floors.map((floor) => floor.floor), [1, 2]);
    assert.equal(map.floors.flatMap((floor) => floor.rooms).some((room) => room.number === '999'), false);
  });

  it('erken çıkış: açık konaklama temizliği çıkış temizliğine yükselir (öncelik 2), ikinci görev açılmaz', async () => {
    const stay = await service.createSystemCleaningTask(hotelId, { roomId: roomB.id, type: 'STAYOVER', priority: 3 });
    assert.equal(stay.created, true);

    const result = await service.createSystemCleaningTask(hotelId, { roomId: roomB.id, type: 'CHECKOUT_CLEAN' });
    assert.deepEqual([result.created, result.upgraded, result.task.id, result.task.type, result.task.priority], [false, true, stay.task.id, 'CHECKOUT_CLEAN', 2]);
    const open = await prismaUnfiltered.housekeepingTask.count({ where: { hotelId, roomId: roomB.id, status: { in: ['PENDING', 'IN_PROGRESS'] } } });
    assert.equal(open, 1);
  });

  it('kuyruk süzgeçleri sunucuda: görevlinin açıkları, sahipsiz havuz, kontrol bekleyenler', async () => {
    const type = await prismaUnfiltered.roomType.findFirst({ where: { hotelId } });
    const roomC = await prismaUnfiltered.room.create({ data: { hotelId, number: '301', floor: 3, roomTypeId: type.id } });
    const mine = await service.createTask(hotelId, { roomId: roomA.id, type: 'STAYOVER', priority: 3, assignedToId: cleanerId });
    const pooled = await service.createTask(hotelId, { roomId: roomB.id, type: 'STAYOVER', priority: 3 });
    const finished = await service.createTask(hotelId, { roomId: roomC.id, type: 'CHECKOUT_CLEAN', priority: 2, assignedToId: cleanerId });
    await asStaff(cleaner.email, () => service.completeTask(hotelId, finished.id, { expectedUpdatedAt: new Date(finished.updatedAt) }));

    const list = (filters) => service.listTasks(hotelId, { page: 1, pageSize: 30, ...filters });
    const ids = (page) => page.items.map((task) => task.id);
    assert.deepEqual(ids(await list({ assignedToId: cleanerId, openOnly: true })), [mine.id]);
    assert.deepEqual(ids(await list({ unassigned: true, openOnly: true })), [pooled.id]);
    const awaiting = await list({ awaitingInspection: true });
    assert.deepEqual([awaiting.meta.total, ...ids(awaiting)], [1, finished.id]);
  });
});
