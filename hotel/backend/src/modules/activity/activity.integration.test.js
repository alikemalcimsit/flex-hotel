import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';

/**
 * Aktivite akışı ve denetim kaydı (modül 10) — gerçek PostgreSQL, gerçek
 * HTTP, gerçek aktörler.
 *
 * Gün sonu cümlesinin kanıtı: resepsiyon bir rezervasyon açar; oda aktörü
 * oda atar, bildirim aktörü onay bildirimi sıraya koyar. Yönetici o
 * rezervasyonun zincirini tek istekte görür: kim açtı, hangi aktör neyi ne
 * kadar sürede yaptı, kayıt nasıl değişti. Ayrıca süzgeçler, imleç, otel
 * kapsamı, izinler, kişisel veri maskelemesi ve canlı akış haberi.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';

describe('aktivite akışı ve denetim kaydı (modül 10, entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let activity;
  /** @type {any} */ let realtime;
  /** @type {any} */ let stream;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let otherHotelId;
  let roomType;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    delete process.env.OPENAI_API_KEY;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    activity = await import('./service.js');
    realtime = await import('../../lib/realtime.js');
    stream = await import('../../lib/activity-stream.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
    const hotel = await db.hotel.create({ data: { name: 'İzleme Otel', code: `ACT-${randomUUID().slice(0, 8)}`, timezone: ZONE } });
    hotelId = hotel.id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka', code: `OTH-${randomUUID().slice(0, 8)}` } })).id;
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: 'admin@test.local', name: 'Yönetici Ada', role: 'ADMIN', passwordHash },
        { hotelId, email: 'resepsiyon@test.local', name: 'Resepsiyon Can', role: 'FRONT_DESK', passwordHash },
        { hotelId, email: 'mudur@test.local', name: 'Müdür Ece', role: 'MANAGER', passwordHash },
      ],
    });
    roomType = await db.roomType.create({
      data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1500', capacityAdults: 2, capacityChildren: 1 },
    });
    for (const number of ['101', '102']) await db.room.create({ data: { hotelId, number, roomTypeId: roomType.id, floor: 1 } });
  });

  const tokenOf = async (email) => {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().data.accessToken;
  };
  const get = async (url, email = 'admin@test.local') =>
    app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${await tokenOf(email)}` } });
  const day = (offset) => core.addDays(core.calendarDateInTimeZone(ZONE), offset).toISOString().slice(0, 10);

  /** Resepsiyon HTTP ile rezervasyon açar; zincir kimliği istekten gelir. */
  async function createReservationViaHttp(correlationId) {
    const response = await app.inject({
      method: 'POST',
      url: '/reservations',
      headers: { authorization: `Bearer ${await tokenOf('resepsiyon@test.local')}`, 'x-correlation-id': correlationId },
      payload: {
        guest: { firstName: 'Ayşe', lastName: 'Yılmaz', phone: '+905321110001', email: 'ayse@example.com' },
        roomTypeId: roomType.id,
        adults: 2,
        boardType: 'BB',
        checkIn: day(3),
        checkOut: day(5),
        requestId: randomUUID(),
      },
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().data.reservation;
  }

  it('rezervasyonun zinciri tek istekte: kim açtı, hangi aktör ne yaptı, ne kadar sürdü, kayıt nasıl değişti', async () => {
    const correlationId = `test-${randomUUID()}`;
    const reservation = await createReservationViaHttp(correlationId);

    const response = await get(`/activity/chains/${correlationId}`);
    assert.equal(response.statusCode, 200, response.body);
    const chain = response.json().data;

    assert.equal(chain.correlationId, correlationId);
    assert.equal(chain.truncated, false);
    assert.equal(chain.people['resepsiyon@test.local'], 'Resepsiyon Can');
    assert.ok(chain.actors.includes('room-worker'), 'oda aktörü zincirde');
    assert.equal(chain.counts.errors, 0);

    const created = chain.roots.find((node) => node.kind === 'EVENT' && node.name === 'reservation.created');
    assert.ok(created, 'kökte rezervasyon olayı');
    assert.equal(created.actor, 'resepsiyon@test.local');
    assert.equal(created.published, true);
    assert.ok(chain.roots.some((node) => node.kind === 'AUDIT' && node.entity === 'Reservation' && node.action === 'CREATE'));

    const roomHandler = created.children.find((node) => node.kind === 'HANDLER' && node.actorName === 'room-worker');
    assert.ok(roomHandler, 'oda aktörünün işleyişi olayın altında');
    assert.equal(roomHandler.level, 'INFO');
    assert.ok(roomHandler.durationMs >= 0);
    const assigned = roomHandler.children.find((node) => node.kind === 'EVENT' && node.name === 'room.assigned');
    assert.ok(assigned, 'oda aktörünün yayınladığı olay onun altında');
    const roomChange = roomHandler.children.find((node) => node.kind === 'AUDIT' && node.changedFields.includes('roomId'));
    assert.ok(roomChange, 'oda atamasının kayıt değişikliği aktörün altında');
    assert.equal(chain.valuesIncluded, true, 'yöneticinin denetim izni var');
    const roomValue = roomChange.values.find((value) => value.field === 'roomId');
    assert.equal(roomValue.before, null);
    assert.ok(roomValue.after);

    // Olay gövdesinde kişisel veri maskeli (olay listesi ve zincir teknik görünüm).
    const events = await get(`/activity/events?correlationId=${correlationId}`);
    const bodies = JSON.stringify(events.json().data.items.map((item) => item.payload));
    assert.equal(bodies.includes('+905321110001'), false);
    assert.equal(bodies.includes('ayse@example.com'), false);

    // Kaydın bütün zincirleri: "İşlem zinciri" düğmesinin kaynağı.
    const records = await get(`/activity/records/Reservation/${reservation.id}`);
    assert.equal(records.statusCode, 200, records.body);
    const first = records.json().data.chains.find((item) => item.correlationId === correlationId);
    assert.equal(first.firstAction, 'CREATE');
    assert.equal(first.actorLabel, 'Resepsiyon Can');
    assert.ok(first.fields.includes('roomId'));
  });

  it('değişikliklerin eski/yeni değerleri yalnızca denetim izniyle döner', async () => {
    const correlationId = `test-${randomUUID()}`;
    await createReservationViaHttp(correlationId);
    const chain = await activity.getChain(hotelId, correlationId, { includeValues: false });
    const audits = JSON.stringify(chain.roots);
    assert.equal(chain.valuesIncluded, false);
    assert.equal(audits.includes('"values":['), false);
  });

  it('izinler: resepsiyon akışı ve denetimi göremez; müdür görür; token\'sız 401', async () => {
    assert.equal((await get('/activity/feed', 'resepsiyon@test.local')).statusCode, 403);
    assert.equal((await get('/audit', 'resepsiyon@test.local')).statusCode, 403);
    assert.equal((await get('/activity/feed', 'mudur@test.local')).statusCode, 200);
    assert.equal((await get('/audit', 'mudur@test.local')).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/activity/feed' })).statusCode, 401);
  });

  describe('akış süzgeçleri ve sayfalama', () => {
    /** Doğrudan satır (zamanları kontrollü). */
    async function seed() {
      const base = Date.now() - 60_000;
      const rows = [
        ['room-worker', 'reservation.created', 'INFO'],
        ['notification-worker', 'reservation.created', 'WARN'],
        ['room-worker', 'reservation.cancelled', 'INFO'],
        ['reservation-worker', 'reservation.requested', 'ERROR'],
        ['room-worker', 'reservation.created', 'INFO'],
        ['notification-worker', 'guest.checked_in', 'INFO'],
        ['room-worker', 'guest.checked_out', 'WARN'],
      ];
      const ids = [];
      for (const [index, [actorName, eventName, level]] of rows.entries()) {
        const row = await db.activityLog.create({
          data: {
            hotelId,
            actorName,
            eventName,
            level,
            message: `${actorName} ${index}`,
            correlationId: `seed-${index % 2}-00000000`,
            meta: { event: eventName, guestPhone: '+905321110001' },
            durationMs: index,
            createdAt: new Date(base + index * 1000),
          },
        });
        ids.push(row.id);
      }
      // Başka otelin satırı hiçbir yoldan dönmemeli.
      const foreign = await db.activityLog.create({
        data: { hotelId: otherHotelId, actorName: 'room-worker', eventName: 'reservation.created', level: 'ERROR', message: 'başka otel' },
      });
      return { ids, foreignId: foreign.id };
    }

    it('imleçle sayfalanır: tekrar ve kayıp yok, en yeni önce', async () => {
      await seed();
      const seen = [];
      let cursor;
      do {
        const page = await activity.listActivity(hotelId, { limit: 3, ...(cursor ? { cursor } : {}) });
        seen.push(...page.items.map((item) => item.message));
        cursor = page.nextCursor;
      } while (cursor);
      assert.equal(seen.length, 7);
      assert.equal(new Set(seen).size, 7);
      assert.equal(seen[0], 'room-worker 6', 'en yeni önce');
    });

    it('aktör, olay, seviye ("sorunlar" dahil) ve zincir süzgeçleri; meta maskeli', async () => {
      await seed();
      const byActor = await activity.listActivity(hotelId, { actorName: 'room-worker', limit: 50 });
      assert.equal(byActor.items.length, 4);
      const byEvent = await activity.listActivity(hotelId, { eventName: 'reservation.created', limit: 50 });
      assert.equal(byEvent.items.length, 3);
      const problems = await activity.listActivity(hotelId, { level: 'PROBLEMS', limit: 50 });
      assert.deepEqual(problems.items.map((item) => item.level), ['WARN', 'ERROR', 'WARN'], 'iki seviye birleşip zamana göre sıralı');
      const problemsPaged = await activity.listActivity(hotelId, { level: 'PROBLEMS', limit: 2 });
      assert.equal(problemsPaged.items.length, 2);
      const rest = await activity.listActivity(hotelId, { level: 'PROBLEMS', limit: 2, cursor: problemsPaged.nextCursor });
      assert.equal(rest.items.length, 1);
      assert.equal(rest.nextCursor, null);
      const byChain = await activity.listActivity(hotelId, { correlationId: 'seed-1-00000000', limit: 50 });
      assert.equal(byChain.items.length, 3);
      assert.notEqual(byActor.items[0].meta.guestPhone, '+905321110001');
    });

    it('canlı akış kimlikle çeker; başka otelin satırı kimliği bilinse de dönmez; süzgeç uygulanır', async () => {
      const { ids, foreignId } = await seed();
      const live = await activity.listActivity(hotelId, { ids: [ids[6], ids[5], foreignId], limit: 50 });
      assert.deepEqual(live.items.map((item) => item.id), [ids[6], ids[5]]);
      const filtered = await activity.listActivity(hotelId, { ids: [ids[6], ids[5]], level: 'WARN', limit: 50 });
      assert.deepEqual(filtered.items.map((item) => item.id), [ids[6]]);
    });

    it('HTTP: bozuk imleç 422 (liste yenilenmeli), bilinmeyen seviye ve ters tarih aralığı 400', async () => {
      assert.equal((await get('/activity/feed?cursor=bozuk')).statusCode, 422);
      assert.equal((await get('/activity/feed?level=DEBUG')).statusCode, 400);
      assert.equal((await get('/activity/feed?from=2026-09-25&to=2026-09-24')).statusCode, 400);
      const ok = await get('/activity/feed?level=PROBLEMS&limit=5');
      assert.equal(ok.statusCode, 200);
    });
  });

  it('olaylar: dağıtılmamış süzgeci outbox\'ta bekleyenleri gösterir', async () => {
    const stuck = await db.eventLog.create({
      data: {
        hotelId,
        name: 'reservation.created',
        payload: { hotelId, reservationId: randomUUID() },
        correlationId: 'stuck-000000000',
        actor: 'system',
        occurredAt: new Date(Date.now() - 5 * 60_000),
        publishedAt: null,
      },
    });
    await db.eventLog.create({
      data: { hotelId, name: 'room.assigned', payload: { hotelId }, correlationId: 'ok-0000000000', actor: 'room-worker', publishedAt: new Date() },
    });
    const response = await get('/activity/events?unpublished=true');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().data.items.map((item) => item.id), [stuck.id]);
  });

  it('denetim: kişi ve kayıt türü süzgeci, kişinin adı, eski/yeni değer', async () => {
    const correlationId = `test-${randomUUID()}`;
    const reservation = await createReservationViaHttp(correlationId);
    await db.auditLog.create({
      data: {
        hotelId: otherHotelId,
        entity: 'Reservation',
        entityId: reservation.id,
        action: 'UPDATE',
        actor: 'resepsiyon@test.local',
        correlationId: 'foreign-00000000',
      },
    });

    const mine = await get('/audit?actor=Resepsiyon@Test.local');
    assert.equal(mine.statusCode, 200, mine.body);
    const rows = mine.json().data.items;
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((row) => row.actor === 'resepsiyon@test.local'));
    assert.equal(rows[0].actorLabel, 'Resepsiyon Can');
    assert.ok(rows.every((row) => row.correlationId !== 'foreign-00000000'), 'başka otelin kaydı yok');

    const reservationRows = (await get(`/audit?entity=Reservation&entityId=${reservation.id}`)).json().data.items;
    const assignment = reservationRows.find((row) => row.changedFields.includes('roomId'));
    assert.equal(assignment.actor, 'room-worker');
    assert.equal(assignment.actorKind, 'ACTOR');
    assert.equal(assignment.before.roomId ?? null, null);
    assert.ok(assignment.after.roomId);
    assert.equal((await get('/audit?entityId=abc')).statusCode, 400, 'tür olmadan kimlik aranmaz');
  });

  it('zincir bulunamazsa 404; kimlik biçimi bozuksa 400', async () => {
    assert.equal((await get(`/activity/chains/yok-${randomUUID()}`)).statusCode, 404);
    assert.equal((await get('/activity/chains/abc')).statusCode, 400);
    assert.equal((await get(`/activity/records/Reservation/${randomUUID()}`)).statusCode, 404);
  });

  it('aktörün yazdığı satır zincir kimliğini ve olay adını taşır (Activity Feed süzgeci için)', async () => {
    const correlationId = `test-${randomUUID()}`;
    await createReservationViaHttp(correlationId);
    const rows = await db.activityLog.findMany({ where: { hotelId, correlationId } });
    assert.ok(rows.length >= 2);
    assert.ok(rows.every((row) => row.eventName && row.correlationId === correlationId));
  });

  describe('canlı akış haberi (socket köprüsü)', () => {
    /** socket.io'nun kullanılan kısmının sahtesi: oda üyeleri ve yayınlar. */
    function fakeIo(subscribedRooms) {
      const emitted = [];
      return {
        emitted,
        sockets: { adapter: { rooms: new Map(subscribedRooms.map((room) => [room, new Set(['socket-1'])])) } },
        to: (room) => ({ emit: (channel, body) => emitted.push({ room, channel, body }) }),
      };
    }
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    it('haberler toplanır, tek mesajda yalnızca kimlik ve sayı gider; izleyen yoksa hiç gönderilmez', async () => {
      const room = realtime.channelRoom(hotelId, realtime.ACTIVITY_CHANNEL);
      const io = fakeIo([room]);
      const stop = realtime.registerActivityBridge(io, { flushMs: 20 });
      try {
        stream.publishActivity({ id: 'a1', hotelId, level: 'INFO' });
        stream.publishActivity({ id: 'a2', hotelId, level: 'ERROR' });
        stream.publishActivity({ id: 'b1', hotelId: otherHotelId, level: 'WARN' });
        await wait(60);
        assert.equal(io.emitted.length, 1, 'izlenmeyen otele gönderilmez');
        assert.deepEqual(io.emitted[0], {
          room,
          channel: realtime.ACTIVITY_CHANNEL,
          body: { ids: ['a1', 'a2'], count: 2, warnings: 0, errors: 1, overflow: false },
        });
      } finally {
        stop();
      }
    });

    it('çok sayıda satırda kimlik sınırı aşılır: panel listeyi baştan yükler', async () => {
      const room = realtime.channelRoom(hotelId, realtime.ACTIVITY_CHANNEL);
      const io = fakeIo([room]);
      const stop = realtime.registerActivityBridge(io, { flushMs: 20 });
      try {
        for (let index = 0; index < realtime.ACTIVITY_SIGNAL_MAX_IDS + 5; index += 1) {
          stream.publishActivity({ id: `x${index}`, hotelId, level: 'INFO' });
        }
        await wait(60);
        const body = io.emitted[0].body;
        assert.equal(body.ids.length, realtime.ACTIVITY_SIGNAL_MAX_IDS);
        assert.equal(body.count, realtime.ACTIVITY_SIGNAL_MAX_IDS + 5);
        assert.equal(body.overflow, true);
      } finally {
        stop();
      }
    });

    it('kanal abone olunabilir kanallar arasında', () => {
      assert.ok(realtime.SUBSCRIBABLE_CHANNELS.includes(realtime.ACTIVITY_CHANNEL));
    });
  });
});
