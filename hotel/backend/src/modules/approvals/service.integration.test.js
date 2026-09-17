import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Onay kuyruğu (modül 11) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan, yalnızca veritabanıyla doğrulanabilen davranışlar: aktörün onay
 * isteğinin bir kez açılması (olay yeniden gelse de), onaylanınca aktörün
 * aynı olayla **bir kez** devam etmesi (haber tekrar gelse de), iki
 * yöneticinin aynı anda karar verememesi, ret ve süre dolumunda olayın
 * aktör için kapanması, kayıtlı olmayan aktörün işinin kaybolmaması,
 * imleçli liste ve sürüm anahtarlı özet.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ADMIN = 'yonetici@test.local';
const DESK = 'resepsiyon@test.local';
const ACTOR = 'refund-test-worker';

describe('onay kuyruğu (entegrasyon)', { skip }, () => {
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let kit;
  /** @type {any} */ let service;
  /** @type {any} */ let subscribers;
  /** @type {any} */ let alerts;
  /** @type {any} */ let events;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  /** @type {any} */ let worker;
  let hotelId;
  /** @type {Array<{ approval: object, payload: object }>} */
  let done;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    kit = await import('@hotelos/actor-kit');
    service = await import('./service.js');
    subscribers = await import('./subscribers.js');
    alerts = await import('../notifications/staff-alerts.js');
    events = await import('../../lib/events.js');
    const actors = await import('../../lib/actors.js');
    subscribers.registerApprovalSubscribers();

    // Gerçek veritabanına bağlı sahte aktör: iade ister, onay gelince yapar.
    const manifest = kit.defineActor({
      name: ACTOR,
      description: 'Test: iade aktörü',
      subscribes: ['reservation.created'],
      requiresApproval: ['refund'],
      retry: { attempts: 2, backoffMs: 0 },
    });
    const deps = {
      isProcessed: async (actorName, eventId) =>
        Boolean(await db.processedEvent.findFirst({ where: { actorName, eventId }, select: { id: true } })),
      markProcessed: async (actorName, eventId, hotel) => {
        try {
          await db.processedEvent.create({ data: { actorName, eventId, hotelId: hotel } });
        } catch (error) {
          if (error?.code !== 'P2002') throw error;
        }
      },
      isEnabled: async () => true,
      logActivity: async (entry) => {
        await db.activityLog.create({ data: entry });
      },
      createManualTask: (task) => actors.createManualTaskForActor(task),
      requestApproval: (request) => service.requestApprovalStandalone(request),
      sleep: async () => {},
      logger: { warn() {}, error() {} },
    };
    worker = new kit.BaseWorker(
      manifest,
      {
        'reservation.created': async (payload, _envelope, ctx) => {
          if (!ctx.approval) {
            ctx.requireApproval({
              action: 'refund',
              type: 'REFUND',
              summary: `İade: ${payload.reservationId.slice(0, 8)}`,
              reason: 'İptal cezasız dönemde',
              data: { reservationId: payload.reservationId, nights: 3 },
              amount: '1250.00',
              currency: 'TRY',
              entityType: 'Reservation',
              entityId: payload.reservationId,
              expiresInMs: 60 * 60_000,
            });
          }
          done.push({ approval: ctx.approval, payload });
          return { message: 'İade yapıldı', meta: { amount: '1250.00' } };
        },
      },
      deps,
    );
    if (!kit.actorRegistry.get(ACTOR)) kit.actorRegistry.register(worker);
  });

  after(async () => {
    subscribers.stopApprovalSubscribers();
    await db?.$disconnect();
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);

  beforeEach(async () => {
    await resetDatabase(db);
    service.clearApprovalCache();
    done = [];
    const hotel = await db.hotel.create({ data: { name: 'Deniz Otel', code: `APR-${randomUUID().slice(0, 8)}` } });
    hotelId = hotel.id;
    const user = (email, role) =>
      db.user.create({ data: { hotelId, email, name: email.split('@')[0], passwordHash: 'x', role } });
    await user(ADMIN, 'ADMIN');
    await user(DESK, 'FRONT_DESK');
  });

  /** Aktörü bir rezervasyon olayıyla çalıştırır; zarfı döndürür. */
  async function triggerActor(overrides = {}) {
    const payload = {
      hotelId,
      reservationId: randomUUID(),
      roomTypeId: randomUUID(),
      checkIn: '2026-10-15T00:00:00.000Z',
      checkOut: '2026-10-18T00:00:00.000Z',
      roomId: null,
      ...overrides,
    };
    const envelope = events.eventBus.createEnvelope('reservation.created', payload, { actor: 'system' });
    await worker.handle(payload, envelope);
    return { payload, envelope };
  }

  const pendingOf = () => db.approval.findMany({ where: { hotelId, status: 'PENDING' } });
  const processed = (eventId) => db.processedEvent.findFirst({ where: { actorName: ACTOR, eventId } });
  const eventNames = async () =>
    (await db.eventLog.findMany({ where: { hotelId }, select: { name: true } })).map((row) => row.name);

  describe('istek', () => {
    it('aktör onay ister: onay, bekleyen iş, zil uyarısı ve olay; işlenmiş sayılmaz', async () => {
      const { envelope } = await triggerActor();

      const [approval] = await pendingOf();
      assert.ok(approval);
      assert.equal(approval.type, 'REFUND');
      assert.equal(approval.actorName, ACTOR);
      assert.equal(approval.action, 'refund');
      assert.equal(approval.requestedBy, ACTOR);
      assert.equal(String(approval.amount), '1250');
      assert.equal(approval.currency, 'TRY');
      assert.ok(approval.expiresAt > new Date(Date.now() + 59 * 60_000));

      const action = await db.pendingAction.findFirst({ where: { approvalId: approval.id } });
      assert.equal(action.actorName, ACTOR);
      assert.equal(action.eventId, envelope.id);
      assert.equal(action.resumeEvent.name, 'reservation.created');
      assert.equal(action.resumeEvent.correlationId, envelope.correlationId);
      assert.equal(action.resumedAt, null);

      assert.equal(await processed(envelope.id), null, 'onay beklerken olay işlenmiş değil');
      assert.equal(done.length, 0);

      const names = await eventNames();
      assert.ok(names.includes('approval.requested'));
      assert.ok(names.includes('staff.alert.raised'));

      const alert = await db.staffAlert.findFirst({ where: { hotelId, kind: 'APPROVAL_REQUESTED' } });
      assert.equal(alert.permission, 'approvals.decide');
      assert.equal(alert.link, `/onaylar/bekleyen?onay=${approval.id}`);
      assert.match(alert.title, /^Onay bekliyor: İade/);
      assert.match(alert.body, /Para iadesi · 1250/);

      // Yönetici zilinde görünür, resepsiyonda görünmez.
      const adminBell = await as(ADMIN, () => alerts.listStaffAlerts(hotelId, { limit: 10 }));
      assert.equal(adminBell.items.length, 1);
      const deskBell = await as(DESK, () => alerts.listStaffAlerts(hotelId, { limit: 10 }));
      assert.equal(deskBell.items.length, 0);

      const activity = await db.activityLog.findMany({ where: { hotelId, actorName: ACTOR } });
      assert.equal(activity.length, 1);
      assert.match(activity[0].message, /^Onaya gönderildi/);
      assert.equal(activity[0].meta.approvalId, approval.id);

      const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'Approval', entityId: approval.id } });
      assert.equal(audit.action, 'CREATE');
    });

    it('aynı olay yeniden dağıtılınca ikinci onay açılmaz', async () => {
      const { payload, envelope } = await triggerActor();
      await worker.handle(payload, envelope);
      await worker.handle(payload, envelope);

      assert.equal((await pendingOf()).length, 1);
      assert.equal(await db.pendingAction.count({ where: { hotelId } }), 1);
      assert.equal(await db.staffAlert.count({ where: { hotelId } }), 1);
      const activity = await db.activityLog.findMany({ where: { hotelId, actorName: ACTOR }, orderBy: { createdAt: 'asc' } });
      assert.equal(activity.length, 3);
      assert.match(activity[1].message, /^Onay zaten bekleniyor/);
    });

    it('aynı olay için eşzamanlı iki istek: tek onay, ikisi de aynı kimliği alır', async () => {
      const eventId = randomUUID();
      const request = () =>
        service.requestApprovalStandalone({
          hotelId,
          type: 'OTHER',
          summary: 'Yarış',
          actorName: ACTOR,
          action: 'refund',
          event: { id: eventId, name: 'reservation.created', payload: { hotelId } },
        });
      const results = await Promise.all([request(), request()]);
      assert.equal(new Set(results.map((row) => row.approvalId)).size, 1);
      assert.equal(results.filter((row) => row.created).length, 1);
      assert.equal(await db.approval.count({ where: { hotelId } }), 1);
    });

    it('geçersiz istek reddedilir: bilinmeyen tür, aktörsüz olay, kısa süre', async () => {
      const base = { hotelId, type: 'REFUND', summary: 'x' };
      await assert.rejects(service.requestApprovalStandalone({ ...base, type: 'UYDURMA' }), { code: 'VALIDATION' });
      await assert.rejects(
        service.requestApprovalStandalone({ ...base, event: { id: randomUUID(), name: 'reservation.created', payload: {} } }),
        /aktörü olmalı/,
      );
      await assert.rejects(service.requestApprovalStandalone({ ...base, expiresInMs: 5 }), { code: 'VALIDATION' });
      assert.equal(await db.approval.count({ where: { hotelId } }), 0);
    });

    it('servis isteği: süre verilmezse bir gün, `null` ise süresiz; isteyen bağlamdaki kişi', async () => {
      const defaulted = await as(ADMIN, () =>
        service.requestApprovalStandalone({ hotelId, type: 'BULK_PRICE_CHANGE', summary: 'Kış fiyatları %10' }),
      );
      const endless = await service.requestApprovalStandalone({
        hotelId,
        type: 'OTHER',
        summary: 'Süresiz',
        expiresInMs: null,
      });
      const rows = await db.approval.findMany({ where: { id: { in: [defaulted.approvalId, endless.approvalId] } } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const dayLater = Date.now() + 24 * 60 * 60_000;
      assert.ok(Math.abs(byId.get(defaulted.approvalId).expiresAt.getTime() - dayLater) < 5_000);
      assert.equal(byId.get(defaulted.approvalId).requestedBy, ADMIN);
      assert.equal(byId.get(endless.approvalId).expiresAt, null);
    });
  });

  describe('karar', () => {
    it('onay: karar yazılır, aktör aynı olayla bir kez devam eder; haber tekrar gelse de', async () => {
      const { envelope } = await triggerActor();
      const [approval] = await pendingOf();

      const decided = await as(ADMIN, () => service.decideApproval(hotelId, approval.id, 'GRANTED', { note: 'Olur' }));
      assert.equal(decided.status, 'GRANTED');
      assert.equal(decided.decidedBy, ADMIN);
      assert.equal(decided.note, 'Olur');

      assert.equal(done.length, 1, 'aktör onaydan sonra işi yaptı');
      assert.equal(done[0].approval.id, approval.id);
      assert.equal(done[0].approval.status, 'GRANTED');
      assert.equal(done[0].payload.hotelId, hotelId);
      assert.ok(await processed(envelope.id), 'iş bitince olay işlenmiş');

      const action = await db.pendingAction.findFirst({ where: { approvalId: approval.id } });
      assert.ok(action.resumedAt);

      const activity = await db.activityLog.findMany({ where: { hotelId, actorName: ACTOR }, orderBy: { createdAt: 'asc' } });
      assert.equal(activity.at(-1).message, 'İade yapıldı');
      assert.equal(activity.at(-1).meta.approvalId, approval.id);

      const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'Approval', entityId: approval.id, action: 'UPDATE' } });
      assert.equal(audit.actor, ADMIN);
      assert.ok(audit.changedFields.includes('status'));

      // Outbox tekrarı: aynı "onaylandı" haberi ikinci kez dağıtılır.
      const granted = await db.eventLog.findFirst({ where: { hotelId, name: 'approval.granted' } });
      await events.eventBus.dispatch({
        id: granted.id,
        name: granted.name,
        version: granted.version,
        payload: granted.payload,
        correlationId: granted.correlationId,
        causationId: granted.causationId,
        hop: granted.hop,
        actor: granted.actor,
        occurredAt: granted.occurredAt,
      });
      assert.equal(done.length, 1, 'devam bir kez yapılır');
    });

    it('iki yönetici aynı anda: biri kazanır, diğeri "zaten karara bağlanmış" alır', async () => {
      await triggerActor();
      const [approval] = await pendingOf();

      const outcomes = await Promise.allSettled([
        as(ADMIN, () => service.decideApproval(hotelId, approval.id, 'GRANTED', {})),
        as(ADMIN, () => service.decideApproval(hotelId, approval.id, 'DENIED', { note: 'Hayır' })),
      ]);
      const fulfilled = outcomes.filter((row) => row.status === 'fulfilled');
      const rejected = outcomes.filter((row) => row.status === 'rejected');
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0].reason.code, 'NOT_PENDING');

      const row = await db.approval.findFirst({ where: { id: approval.id } });
      assert.equal(row.status, fulfilled[0].value.status);
      assert.equal(done.length, row.status === 'GRANTED' ? 1 : 0);
      assert.equal(await db.eventLog.count({ where: { hotelId, name: { in: ['approval.granted', 'approval.denied'] } } }), 1);
    });

    it('ret: gerekçe zorunlu; aktör devam etmez, olay o aktör için kapanır', async () => {
      const { envelope } = await triggerActor();
      const [approval] = await pendingOf();

      const denied = await as(ADMIN, () => service.decideApproval(hotelId, approval.id, 'DENIED', { note: 'Bütçe yok' }));
      assert.equal(denied.status, 'DENIED');
      assert.equal(done.length, 0);
      assert.ok(await processed(envelope.id), 'reddedilen olay bir daha ele alınmaz');

      const activity = await db.activityLog.findFirst({ where: { hotelId, actorName: ACTOR, level: 'WARN' } });
      assert.match(activity.message, /^Onay reddedildi \(yonetici@test.local\)/);
      assert.ok((await eventNames()).includes('approval.denied'));

      await assert.rejects(
        as(ADMIN, () => service.decideApproval(hotelId, approval.id, 'GRANTED', {})),
        { code: 'NOT_PENDING' },
      );
      await assert.rejects(service.decideApproval(hotelId, randomUUID(), 'GRANTED', {}), { code: 'NOT_FOUND' });
    });

    it('süresi geçmiş onaya karar verilemez; o anda düşürülür', async () => {
      const { envelope } = await triggerActor();
      const [approval] = await pendingOf();
      await db.approval.update({ where: { id: approval.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

      await assert.rejects(
        as(ADMIN, () => service.decideApproval(hotelId, approval.id, 'GRANTED', {})),
        { code: 'NOT_PENDING' },
      );
      const row = await db.approval.findFirst({ where: { id: approval.id } });
      assert.equal(row.status, 'EXPIRED');
      assert.ok(row.decidedAt);
      assert.equal(done.length, 0);
      assert.ok(await processed(envelope.id));
    });

    it('kayıtlı olmayan aktörün onaylanan işi kaybolmaz: manuel görev, olay kapanır', async () => {
      const eventId = randomUUID();
      const { approvalId } = await service.requestApprovalStandalone({
        hotelId,
        type: 'OTHER',
        summary: 'Hayalet iş',
        actorName: 'ghost-worker',
        action: 'x',
        event: { id: eventId, name: 'reservation.created', payload: { hotelId, reservationId: randomUUID() } },
      });
      await as(ADMIN, () => service.decideApproval(hotelId, approvalId, 'GRANTED', {}));

      const task = await db.manualTask.findFirst({ where: { hotelId } });
      assert.equal(task.module, 'Onay kuyruğu');
      assert.match(task.title, /Hayalet iş/);
      assert.equal(task.originalEvent.id, eventId);
      assert.ok(await db.processedEvent.findFirst({ where: { actorName: 'ghost-worker', eventId } }));
      const action = await db.pendingAction.findFirst({ where: { approvalId } });
      assert.ok(action.resumedAt, 'iş üstlenildi; yeniden denenmez');
    });
  });

  describe('süre dolumu', () => {
    it('tarayıcı süresi dolanları düşürür: olay, aktör işi kapanır, zile uyarı; süresiz olan kalır', async () => {
      const { envelope } = await triggerActor();
      const [approval] = await pendingOf();
      await db.approval.update({ where: { id: approval.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
      const endless = await service.requestApprovalStandalone({ hotelId, type: 'OTHER', summary: 'Süresiz', expiresInMs: null });
      const later = await service.requestApprovalStandalone({ hotelId, type: 'OTHER', summary: 'Sonra', expiresInMs: 60 * 60_000 });

      assert.equal(await service.expireApprovals(), 1);
      assert.equal(await service.expireApprovals(), 0, 'ikinci tur aynı onayı almaz');

      const rows = await db.approval.findMany({ where: { hotelId } });
      const status = Object.fromEntries(rows.map((row) => [row.id, row.status]));
      assert.equal(status[approval.id], 'EXPIRED');
      assert.equal(status[endless.approvalId], 'PENDING');
      assert.equal(status[later.approvalId], 'PENDING');

      assert.ok(await processed(envelope.id));
      assert.equal(done.length, 0);
      assert.ok((await eventNames()).includes('approval.expired'));
      const alert = await db.staffAlert.findFirst({ where: { hotelId, dedupeKey: `approval-expired:${approval.id}` } });
      assert.match(alert.title, /^Süresi doldu, yapılmadı/);
      assert.equal(alert.link, `/onaylar/gecmis?onay=${approval.id}`);
      const activity = await db.activityLog.findFirst({ where: { hotelId, actorName: ACTOR, level: 'WARN' } });
      assert.match(activity.message, /^Onay süresi doldu/);
    });
  });

  describe('liste ve özet', () => {
    const create = (summary, extra = {}) =>
      service.requestApprovalStandalone({ hotelId, type: 'OTHER', summary, ...extra }).then((row) => row.approvalId);

    it('bekleyenler eskiden yeniye imleçle; atlamadan, tekrarlamadan', async () => {
      const ids = [];
      for (let index = 0; index < 5; index += 1) ids.push(await create(`İş ${index}`));

      const seen = [];
      let cursor;
      do {
        const page = await service.listApprovals(hotelId, { view: 'PENDING', limit: 2, cursor });
        seen.push(...page.items.map((row) => row.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      assert.deepEqual(seen, ids, 'en uzun bekleyen en üstte');

      const page = await service.listApprovals(hotelId, { view: 'PENDING', limit: 10 });
      assert.equal(page.items[0].summary, 'İş 0');
      assert.equal(page.items[0].minutesLeft > 1400, true, 'varsayılan süre bir gün');
      assert.equal(page.items[0].expiringSoon, false);
      assert.equal('data' in page.items[0], false, 'liste veriyi taşımaz');
    });

    it('geçmiş yeni karar önce; durum ve tür süzgeci; detay veriyi ve bekleyen işi taşır', async () => {
      const granted = await create('Onaylanan', { type: 'REFUND', data: { reservationId: 'r-1' }, amount: 100, currency: 'TRY' });
      const denied = await create('Reddedilen');
      const expired = await create('Süresi dolan');
      await as(ADMIN, () => service.decideApproval(hotelId, granted, 'GRANTED', {}));
      await as(ADMIN, () => service.decideApproval(hotelId, denied, 'DENIED', { note: 'Hayır' }));
      await db.approval.update({ where: { id: expired }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await service.expireApprovals();

      const history = await service.listApprovals(hotelId, { view: 'HISTORY', limit: 10 });
      assert.deepEqual(history.items.map((row) => row.id), [expired, denied, granted]);
      const onlyDenied = await service.listApprovals(hotelId, { view: 'HISTORY', status: 'DENIED', limit: 10 });
      assert.deepEqual(onlyDenied.items.map((row) => row.id), [denied]);
      const refunds = await service.listApprovals(hotelId, { view: 'HISTORY', type: 'REFUND', limit: 10 });
      assert.deepEqual(refunds.items.map((row) => row.id), [granted]);
      assert.equal((await service.listApprovals(hotelId, { view: 'PENDING', limit: 10 })).items.length, 0);

      const detail = await service.getApproval(hotelId, granted);
      assert.deepEqual(detail.data, { reservationId: 'r-1' });
      assert.equal(detail.amount, '100');
      assert.equal(detail.typeLabel, 'Para iadesi');
      assert.equal(detail.pendingAction, null);
      await assert.rejects(service.getApproval(hotelId, randomUUID()), { code: 'NOT_FOUND' });

      await triggerActor();
      const [actorApproval] = await pendingOf();
      const actorDetail = await service.getApproval(hotelId, actorApproval.id);
      assert.equal(actorDetail.pendingAction.actorName, ACTOR);
      assert.equal(actorDetail.pendingAction.eventName, 'reservation.created');
    });

    it('arama: özetle (üç harften kısa süzmez), kimlikle', async () => {
      const iade = await create('Kış iadesi');
      await create('Fiyat değişimi');
      const search = (text) => service.listApprovals(hotelId, { view: 'PENDING', limit: 10, search: text });
      assert.deepEqual((await search('iade')).items.map((row) => row.id), [iade]);
      assert.deepEqual((await search('İADE')).items.map((row) => row.id), [iade]);
      assert.equal((await search('xy')).items.length, 2);
      assert.deepEqual((await search(iade)).items.map((row) => row.id), [iade]);
    });

    it('özet sürümle tazelenir: karar verilince bekleyen sayısı hemen düşer', async () => {
      const soon = await create('Yaklaşan', { expiresInMs: 30 * 60_000 });
      await create('Uzak');
      const first = await service.getApprovalSummary(hotelId);
      assert.equal(first.pending, 2);
      assert.equal(first.expiringSoon, 1);
      assert.ok(first.oldestPendingAt);

      await as(ADMIN, () => service.decideApproval(hotelId, soon, 'GRANTED', {}));
      const second = await service.getApprovalSummary(hotelId);
      assert.equal(second.pending, 1);
      assert.equal(second.expiringSoon, 0);
      assert.ok(service.approvalCacheStats().misses >= 2);
    });

    it('otel kapsamı: başka otelin onayı görünmez, karar verilemez', async () => {
      const other = await db.hotel.create({ data: { name: 'Başka', code: `APR-${randomUUID().slice(0, 8)}` } });
      const foreign = await service.requestApprovalStandalone({ hotelId: other.id, type: 'OTHER', summary: 'Yabancı' });
      assert.equal((await service.listApprovals(hotelId, { view: 'PENDING', limit: 10 })).items.length, 0);
      await assert.rejects(service.getApproval(hotelId, foreign.approvalId), { code: 'NOT_FOUND' });
      await assert.rejects(
        as(ADMIN, () => service.decideApproval(hotelId, foreign.approvalId, 'GRANTED', {})),
        { code: 'NOT_FOUND' },
      );
    });
  });
});
