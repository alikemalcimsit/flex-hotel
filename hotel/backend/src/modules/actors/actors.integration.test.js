import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';

/**
 * Aktör paneli ve manuel görevler (modül 12) — gerçek PostgreSQL, gerçek
 * HTTP, gerçek aktörler.
 *
 * Gün sonu cümlesinin kanıtı: yönetici oda aktörünü panelden kapatır;
 * resepsiyonun açtığı rezervasyona oda atanmaz, iş "manuel görevler"e düşer
 * ve resepsiyon onu görüp üstlenir, tamamlar. Aktör yeniden açılınca oda
 * yine kendiliğinden atanır. LLM ajanlarının harcaması günlük özetten
 * okunur. Ayrıca izinler, görev kapsamı, yarışlar, imleç ve otel kapsamı.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const CONCIERGE_MODEL = 'big-concierge';
const PRICES = { [CONCIERGE_MODEL]: { input: '2.5000', cachedInput: '1.2500', output: '10.0000' } };

describe('aktör paneli ve manuel görevler (modül 12, entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let llm;
  /** @type {any} */ let aiSettings;
  /** @type {any} */ let tasks;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let otherHotelId;
  let roomType;
  /** @type {Map<string, string>} */
  let tokens;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    delete process.env.OPENAI_API_KEY;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    llm = await import('../concierge/llm.js');
    aiSettings = await import('../concierge/settings.js');
    tasks = await import('../manual-tasks/service.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
    (await import('../../lib/cache.js')).cache.clear();
    tasks.clearManualTaskCache();
    llm.resetSpendCache();
    tokens = new Map();
    const hotel = await db.hotel.create({ data: { name: 'Aktör Otel', code: `ACT-${randomUUID().slice(0, 8)}`, timezone: ZONE } });
    hotelId = hotel.id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka', code: `OTH-${randomUUID().slice(0, 8)}` } })).id;
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: 'admin@test.local', name: 'Yönetici Ada', role: 'ADMIN', passwordHash },
        { hotelId, email: 'mudur@test.local', name: 'Müdür Ece', role: 'MANAGER', passwordHash },
        { hotelId, email: 'resepsiyon@test.local', name: 'Resepsiyon Can', role: 'FRONT_DESK', passwordHash },
        { hotelId, email: 'resepsiyon2@test.local', name: 'Resepsiyon Deniz', role: 'FRONT_DESK', passwordHash },
        { hotelId, email: 'kat@test.local', name: 'Kat Elif', role: 'HOUSEKEEPING', passwordHash },
        { hotelId, email: 'muhasebe@test.local', name: 'Muhasebe Fikret', role: 'ACCOUNTING', passwordHash },
      ],
    });
    roomType = await db.roomType.create({
      data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1500', capacityAdults: 2, capacityChildren: 1 },
    });
    for (const number of ['101', '102', '103']) await db.room.create({ data: { hotelId, number, roomTypeId: roomType.id, floor: 1 } });
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    const token = response.json().data.accessToken;
    tokens.set(email, token);
    return token;
  };
  const call = async (method, url, email = 'admin@test.local', payload = undefined, headers = {}) =>
    app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}`, ...headers } });
  const get = (url, email) => call('GET', url, email);
  const post = (url, email, payload = {}) => call('POST', url, email, payload);
  const day = (offset) => core.addDays(core.calendarDateInTimeZone(ZONE), offset).toISOString().slice(0, 10);

  /** Resepsiyon HTTP ile rezervasyon açar. */
  async function createReservation(correlationId = `test-${randomUUID()}`) {
    const response = await call(
      'POST',
      '/reservations',
      'resepsiyon@test.local',
      {
        guest: { firstName: 'Ayşe', lastName: 'Yılmaz', phone: '+905321110001' },
        roomTypeId: roomType.id,
        adults: 2,
        boardType: 'BB',
        checkIn: day(3),
        checkOut: day(5),
        requestId: randomUUID(),
      },
      { 'x-correlation-id': correlationId },
    );
    assert.equal(response.statusCode, 201, response.body);
    return response.json().data.reservation;
  }

  /** Doğrudan görev (liste, kapsam ve imleç testleri için). */
  const seedTask = (overrides = {}) =>
    db.manualTask.create({
      data: {
        hotelId,
        module: 'Oda atama',
        title: 'Rezervasyona oda atanacak',
        actorName: 'room-worker',
        originalEvent: { id: randomUUID(), name: 'reservation.created', payload: { hotelId, reservationId: randomUUID() } },
        ...overrides,
      },
    });

  it('gün sonu: kapalı aktörün işi manuel göreve düşer, personel tamamlar; açılınca aktör yine çalışır', async () => {
    // Yönetici oda aktörünü gerekçesiyle kapatır.
    const disabled = await post('/actors/room-worker/disable', 'admin@test.local', { note: 'Oda envanteri sayımı' });
    assert.equal(disabled.statusCode, 200, disabled.body);
    const detail = disabled.json().data;
    assert.equal(detail.enabled, false);
    assert.equal(detail.health, 'OFF');
    assert.equal(detail.note, 'Oda envanteri sayımı');
    assert.equal(detail.changedBy, 'admin@test.local');
    assert.equal(detail.changedByLabel, 'Yönetici Ada');

    // Resepsiyon rezervasyon açar: oda atanmaz, iş görev olarak düşer.
    const correlationId = `test-${randomUUID()}`;
    const reservation = await createReservation(correlationId);
    const stored = await db.reservation.findFirst({ where: { id: reservation.id } });
    assert.equal(stored.roomId, null, 'kapalı aktör oda atamadı');

    const list = await get('/manual-tasks', 'resepsiyon@test.local');
    assert.equal(list.statusCode, 200, list.body);
    const [task] = list.json().data.items;
    assert.equal(task.module, 'Oda atama');
    assert.equal(task.status, 'PENDING');
    assert.equal(task.actorName, 'room-worker');
    assert.equal(task.correlationId, correlationId, 'görev işlem zincirine bağlı');
    assert.equal(task.event.name, 'reservation.created');
    assert.equal(task.event.label, 'Rezervasyon açıldı');
    assert.ok(task.links.some((link) => link.kind === 'reservation' && link.id === reservation.id));
    assert.equal(task.canHandle, true);
    assert.equal('payload' in task, false, 'liste olay gövdesi taşımaz');

    // Zil uyarısı göreve götürür.
    const alert = await db.staffAlert.findFirst({ where: { hotelId, kind: 'MANUAL_TASK' } });
    assert.equal(alert.link, `/gorevler?gorev=${task.id}`);
    assert.equal(alert.permission, 'rooms.operate');

    // Panel: aktör kapalı, açık görevi var, akışta "kapatıldı" satırı var.
    const actors = (await get('/actors')).json().data;
    const room = actors.items.find((item) => item.name === 'room-worker');
    assert.equal(room.enabled, false);
    assert.equal(room.openTasks, 1);
    assert.equal(room.title, 'Oda aktörü');
    assert.equal(room.packageName, '@hotelos/room-worker');
    assert.ok(room.stats.warnings >= 1, 'iş personele düştü uyarısı');
    const actorDetail = (await get('/actors/room-worker')).json().data;
    assert.ok(actorDetail.recent.some((row) => row.eventName === 'actor.setting.changed' && row.level === 'WARN'));
    assert.ok(actorDetail.recent.some((row) => /Aktör kapalı; iş personele düştü/.test(row.message)));

    // Resepsiyon görevi üstlenir, odayı elle atar, görevi tamamlar.
    const claimed = await post(`/manual-tasks/${task.id}/claim`, 'resepsiyon@test.local');
    assert.equal(claimed.statusCode, 200, claimed.body);
    assert.equal(claimed.json().data.status, 'IN_PROGRESS');
    assert.equal(claimed.json().data.mine, true);
    assert.equal(claimed.json().data.assignedTo.name, 'Resepsiyon Can');
    const done = await post(`/manual-tasks/${task.id}/complete`, 'resepsiyon@test.local', { note: '101 elle atandı' });
    assert.equal(done.statusCode, 200, done.body);
    assert.equal(done.json().data.status, 'DONE');
    assert.equal(done.json().data.resolvedByLabel, 'Resepsiyon Can');
    assert.equal(done.json().data.resolution, '101 elle atandı');
    assert.ok(done.json().data.closedAt);

    const audits = await db.auditLog.findMany({ where: { hotelId, entity: 'ManualTask', entityId: task.id }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(audits.map((row) => row.actor), ['resepsiyon@test.local', 'resepsiyon@test.local']);
    assert.deepEqual(audits.map((row) => row.after.status), ['IN_PROGRESS', 'DONE']);

    // Yönetici aktörü açar: sonraki rezervasyona oda kendiliğinden atanır.
    const enabled = await post('/actors/room-worker/enable', 'admin@test.local');
    assert.equal(enabled.statusCode, 200, enabled.body);
    assert.equal(enabled.json().data.enabled, true);
    const second = await createReservation();
    assert.ok((await db.reservation.findFirst({ where: { id: second.id } })).roomId, 'açılan aktör odayı atadı');

    const settingAudits = await db.auditLog.findMany({ where: { hotelId, entity: 'ActorSetting' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(settingAudits.map((row) => [row.actor, row.before.enabled, row.after.enabled]), [
      ['admin@test.local', true, false],
      ['admin@test.local', false, true],
    ]);
    const events = await db.eventLog.findMany({ where: { hotelId, name: 'actor.setting.changed' } });
    assert.equal(events.length, 2);
  });

  it('aynı karar iki kez verilirse ikincisi iz bırakmaz; bilinmeyen aktör 404, bozuk ad 400', async () => {
    assert.equal((await post('/actors/room-worker/disable', 'admin@test.local')).statusCode, 200);
    assert.equal((await post('/actors/room-worker/disable', 'admin@test.local')).statusCode, 200);
    assert.equal(await db.auditLog.count({ where: { hotelId, entity: 'ActorSetting' } }), 1);
    assert.equal(await db.actorSetting.count({ where: { hotelId } }), 1);

    // Eşzamanlı iki karar: satır kilidi sırayla işler, sonuç tutarlı.
    const results = await Promise.all([
      post('/actors/reservation-worker/disable', 'admin@test.local'),
      post('/actors/reservation-worker/disable', 'admin@test.local'),
    ]);
    assert.deepEqual(results.map((response) => response.statusCode), [200, 200]);
    assert.equal(await db.auditLog.count({ where: { hotelId, entity: 'ActorSetting' } }), 2);

    assert.equal((await post('/actors/olmayan-aktor/disable', 'admin@test.local')).statusCode, 404);
    assert.equal((await get('/actors/olmayan-aktor')).statusCode, 404);
    const bad = await get('/actors/Bozuk%20Ad');
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().code, 'VALIDATION');
    const longNote = await post('/actors/room-worker/enable', 'admin@test.local', { note: 'x'.repeat(301) });
    assert.equal(longNote.statusCode, 400);

    // Kapatma başka oteli etkilemez.
    assert.equal(await db.actorSetting.count({ where: { hotelId: otherHotelId } }), 0);
  });

  it('izinler: panel yönetime, açma/kapama yöneticiye; görevler işin modülüne', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/actors' })).statusCode, 401);
    assert.equal((await get('/actors', 'resepsiyon@test.local')).statusCode, 403);
    assert.equal((await get('/actors', 'mudur@test.local')).statusCode, 200);
    assert.equal((await post('/actors/room-worker/disable', 'mudur@test.local')).statusCode, 403, 'müdür görür, kapatamaz');

    const roomTask = await seedTask();
    const reservationTask = await seedTask({ module: 'Rezervasyon', title: 'Kanal rezervasyonu elle açılacak', actorName: 'reservation-worker' });
    const unknownTask = await seedTask({ module: 'Yeni modül', title: 'Bilinmeyen modül işi', actorName: null });

    const ids = async (email) => (await get('/manual-tasks', email)).json().data.items.map((item) => item.id).sort();
    assert.deepEqual(await ids('admin@test.local'), [roomTask.id, reservationTask.id, unknownTask.id].sort());
    assert.deepEqual(await ids('resepsiyon@test.local'), [roomTask.id, reservationTask.id].sort(), 'ön büro bilinmeyen modülü görmez');
    assert.deepEqual(await ids('kat@test.local'), [roomTask.id], 'kat hizmetleri yalnızca oda işlerini');
    assert.equal((await get('/manual-tasks', 'muhasebe@test.local')).statusCode, 403);
    assert.equal((await get('/manual-tasks/summary', 'muhasebe@test.local')).statusCode, 403);

    // Modül süzgeci ve tek görev de kapsamla sınırlı.
    assert.equal((await get(`/manual-tasks?module=${encodeURIComponent('Rezervasyon')}`, 'kat@test.local')).statusCode, 403);
    assert.equal((await get(`/manual-tasks/${reservationTask.id}`, 'kat@test.local')).statusCode, 403);
    assert.equal((await post(`/manual-tasks/${reservationTask.id}/complete`, 'kat@test.local')).statusCode, 403);
    assert.equal((await post(`/manual-tasks/${roomTask.id}/complete`, 'kat@test.local')).statusCode, 200);

    // Özet kişinin kapsamıyla.
    const summary = (await get('/manual-tasks/summary', 'resepsiyon@test.local')).json().data;
    assert.equal(summary.open, 1, 'kat görevlisinin kapattığı düştü; bilinmeyen modül sayılmaz');
    assert.deepEqual(summary.byModule.map((entry) => entry.module), ['Rezervasyon']);
    const adminSummary = (await get('/manual-tasks/summary', 'admin@test.local')).json().data;
    assert.equal(adminSummary.open, 2);
  });

  it('yarışlar: aynı görevi ikinci kişi üstlenemez, iki kişi tamamlarsa biri kazanır', async () => {
    const task = await seedTask();
    assert.equal((await post(`/manual-tasks/${task.id}/claim`, 'resepsiyon@test.local')).statusCode, 200);
    const again = await post(`/manual-tasks/${task.id}/claim`, 'resepsiyon@test.local');
    assert.equal(again.statusCode, 200, 'kendi üstlendiğini yeniden üstlenmek sorun değil');

    const stolen = await post(`/manual-tasks/${task.id}/claim`, 'resepsiyon2@test.local');
    assert.equal(stolen.statusCode, 409);
    assert.equal(stolen.json().code, 'TASK_CLAIMED');
    const release = await post(`/manual-tasks/${task.id}/release`, 'resepsiyon2@test.local');
    assert.equal(release.statusCode, 409, 'başkasının görevini bırakamaz');
    assert.equal(await db.auditLog.count({ where: { hotelId, entity: 'ManualTask' } }), 1, 'no-op ve reddedilenler iz bırakmaz');

    // Üstlenen bırakır, görev beklemeye döner.
    const released = await post(`/manual-tasks/${task.id}/release`, 'resepsiyon@test.local');
    assert.equal(released.json().data.status, 'PENDING');
    assert.equal(released.json().data.assignedTo, null);

    // Aynı anda iki "tamamla": biri tamamlar, diğeri "zaten kapatılmış" alır.
    const results = await Promise.all([
      post(`/manual-tasks/${task.id}/complete`, 'resepsiyon@test.local'),
      post(`/manual-tasks/${task.id}/complete`, 'resepsiyon2@test.local'),
    ]);
    assert.deepEqual(results.map((response) => response.statusCode).sort(), [200, 409]);
    assert.equal(results.find((response) => response.statusCode === 409).json().code, 'TASK_CLOSED');

    // Kapanmış görev yeniden açılmaz.
    const reopen = await post(`/manual-tasks/${task.id}/claim`, 'resepsiyon@test.local');
    assert.equal(reopen.statusCode, 409);
    const cancel = await post(`/manual-tasks/${task.id}/cancel`, 'resepsiyon@test.local', { reason: 'geç kaldı' });
    assert.equal(cancel.statusCode, 409);

    // "Gerek kalmadı" gerekçesiz olmaz; başkasının üstlendiği görev için de söylenebilir.
    const other = await seedTask();
    await post(`/manual-tasks/${other.id}/claim`, 'resepsiyon2@test.local');
    const noReason = await post(`/manual-tasks/${other.id}/cancel`, 'resepsiyon@test.local', { reason: '  ' });
    assert.equal(noReason.statusCode, 400);
    const cancelled = await post(`/manual-tasks/${other.id}/cancel`, 'resepsiyon@test.local', { reason: 'Rezervasyon iptal edildi' });
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal(cancelled.json().data.status, 'CANCELLED');
    assert.equal(cancelled.json().data.resolution, 'Rezervasyon iptal edildi');

    // Veritabanı kısıtı: kapanış anı olmadan kapanmış görev yazılamaz.
    await assert.rejects(db.manualTask.update({ where: { id: other.id }, data: { status: 'DONE', closedAt: null } }));
    await assert.rejects(db.manualTask.create({ data: { hotelId, module: 'Oda atama', title: 'x', status: 'IN_PROGRESS' } }));
  });

  it('liste: açıklar en eski önce, kapananlar en yeni kapanan önce; imleç tekrar etmez; otel kapsamı', async () => {
    const base = Date.now() - 60 * 60 * 1000;
    const created = [];
    for (let index = 0; index < 5; index += 1) {
      created.push(await seedTask({ title: `Görev ${index}`, createdAt: new Date(base + index * 1000) }));
    }
    await db.manualTask.create({ data: { hotelId: otherHotelId, module: 'Oda atama', title: 'Başka otelin görevi' } });

    const seen = [];
    let cursor;
    for (let page = 0; page < 5; page += 1) {
      const response = await get(`/manual-tasks?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      assert.equal(response.statusCode, 200, response.body);
      const data = response.json().data;
      seen.push(...data.items.map((item) => item.title));
      cursor = data.nextCursor;
      if (!cursor) break;
    }
    assert.deepEqual(seen, ['Görev 0', 'Görev 1', 'Görev 2', 'Görev 3', 'Görev 4']);

    for (const index of [1, 3]) await post(`/manual-tasks/${created[index].id}/complete`, 'admin@test.local');
    const closed = (await get('/manual-tasks?view=CLOSED')).json().data.items.map((item) => item.title);
    assert.deepEqual(closed, ['Görev 3', 'Görev 1']);
    const open = (await get('/manual-tasks?actor=room-worker')).json().data.items.map((item) => item.title);
    assert.deepEqual(open, ['Görev 0', 'Görev 2', 'Görev 4']);

    const foreign = await db.manualTask.findFirst({ where: { hotelId: otherHotelId } });
    assert.equal((await get(`/manual-tasks/${foreign.id}`)).statusCode, 404);
    assert.equal((await post(`/manual-tasks/${foreign.id}/complete`, 'admin@test.local')).statusCode, 404);
    assert.equal((await get('/manual-tasks?cursor=bozuk')).statusCode, 422);
    assert.equal((await get('/manual-tasks?limit=500')).statusCode, 400);

    // Detay olay gövdesini taşır (işi yapacak kişi için).
    const detail = (await get(`/manual-tasks/${created[0].id}`)).json().data;
    assert.ok(detail.payload?.reservationId);
  });

  it('AI ajanları panelden kapatılınca AI misafire cevap vermez; kurulu olmayan ajan da listede', async () => {
    const list = (await get('/actors')).json().data;
    const concierge = list.items.find((item) => item.name === 'concierge-agent');
    assert.ok(concierge, 'anahtar yokken de ajan listede');
    assert.equal(concierge.registered, false);
    assert.equal(concierge.health, 'UNAVAILABLE');
    assert.match(concierge.unavailableReason, /OPENAI_API_KEY/);
    assert.equal(list.llm.keyConfigured, false);

    assert.equal(await aiSettings.aiAgentsEnabled(hotelId), true);
    const response = await post('/actors/concierge-agent/disable', 'admin@test.local', { note: 'Maliyet incelemesi' });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(await aiSettings.aiAgentsEnabled(hotelId), false, 'önbellek kapatınca hemen silindi');
    const settings = (await get('/ai/settings')).json().data;
    assert.equal(settings.agentsEnabled, false);
  });

  it('LLM kullanımı günlük özete de yazılır; ajan kartı ve kullanım ekranı özetten okur', async () => {
    await db.aiSettings.create({
      data: { hotelId, enabled: true, routerModel: 'mini', conciergeModel: CONCIERGE_MODEL, prices: PRICES, dailyBudgetUsd: '1.00' },
    });
    const usage = { inputTokens: 1000, cachedInputTokens: 200, outputTokens: 100 };
    // 800 taze × 2.5 + 200 önbellekli × 1.25 + 100 çıktı × 10 (1M başına) = 0.00325
    await llm.recordUsage({ hotelId, actorName: 'concierge-agent', model: CONCIERGE_MODEL, usage, conversationId: null });
    await llm.recordUsage({ hotelId, actorName: 'concierge-agent', model: CONCIERGE_MODEL, usage, conversationId: null });

    assert.equal(await db.llmUsage.count({ where: { hotelId } }), 2);
    const [daily] = await db.llmUsageDaily.findMany({ where: { hotelId } });
    assert.equal(daily.calls, 2);
    assert.equal(daily.costUsd.toFixed(6), '0.006500');
    assert.equal(Number(daily.tokensIn), 2000);
    assert.equal(Number(daily.cacheRead), 400);

    const card = await get('/actors/concierge-agent/usage?days=7');
    assert.equal(card.statusCode, 200, card.body);
    const data = card.json().data;
    assert.equal(data.days.length, 7);
    assert.equal(data.today.calls, 2);
    assert.equal(data.today.agentSpentUsd, '0.006500');
    assert.equal(data.today.hotelSpentUsd, '0.006500');
    assert.equal(data.today.budgetUsd, '1');
    assert.equal(data.today.exhausted, false);
    assert.equal(data.total.avgCostPerCallUsd, '0.003250');

    const report = await get('/ai/usage?days=7');
    assert.equal(report.json().data.total.calls, 2);
    assert.equal(report.json().data.today.spentUsd, '0.006500');
    const panel = (await get('/actors')).json().data;
    assert.equal(panel.items.find((item) => item.name === 'concierge-agent').costTodayUsd, '0.006500');
    assert.equal(panel.llm.spentUsd, '0.006500');

    const detail = (await get('/actors/concierge-agent')).json().data;
    assert.equal(detail.llm.model, CONCIERGE_MODEL);
    assert.equal(detail.type, 'agent');

    assert.equal((await get('/actors/room-worker/usage')).statusCode, 404, 'kural tabanlı aktör model kullanmıyor');
    assert.equal((await get('/actors/concierge-agent/usage?days=91')).statusCode, 400);
  });

  it('aktör detayı: "kapatırsam ne olur" bildirgeden', async () => {
    const detail = (await get('/actors/reservation-worker')).json().data;
    assert.equal(detail.fallbackModule, 'Rezervasyon');
    assert.deepEqual(detail.retry, { attempts: 3, backoffMs: 500 });
    assert.deepEqual(detail.subscribes.map((link) => link.event), ['reservation.requested']);
    const created = detail.publishes.find((link) => link.event === 'reservation.created');
    assert.equal(created.label, 'Rezervasyon açıldı');
    assert.ok(created.consumedBy.some((actor) => actor.name === 'room-worker' && actor.title === 'Oda aktörü'));
    assert.ok(detail.downstream.some((actor) => actor.name === 'notification-worker'));
    assert.equal(detail.llm, null);
    assert.deepEqual(detail.requiresApproval, []);
  });
});
