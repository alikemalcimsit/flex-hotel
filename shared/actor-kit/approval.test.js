import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { requireApproval } from './approval.js';
import { BaseWorker } from './base-worker.js';
import { defineActor } from './manifest.js';

/**
 * Onay akışının sözleşmesi (modül 11): onaya giden iş ne işlenmiş sayılır ne
 * manuel göreve düşer; onay verilince aynı olayla devam eder; beyan edilmemiş
 * ya da bağlı olmayan onay isteği hata gibi ele alınır (iş kaybolmaz).
 */

const manifest = defineActor({
  name: 'refund-worker',
  description: 'Test: para iadesi',
  subscribes: ['reservation.created'],
  requiresApproval: ['refund'],
  retry: { attempts: 3, backoffMs: 0 },
});

const HOTEL = '11111111-1111-4111-8111-111111111111';

const envelope = (overrides = {}) => ({
  id: '22222222-2222-4222-8222-222222222222',
  name: 'reservation.created',
  correlationId: 'zincir-1',
  causationId: null,
  hop: 1,
  actor: 'system',
  occurredAt: '2026-09-17T10:00:00.000Z',
  ...overrides,
});

const payload = () => ({
  hotelId: HOTEL,
  reservationId: '33333333-3333-4333-8333-333333333333',
  roomTypeId: '44444444-4444-4444-8444-444444444444',
  checkIn: '2026-10-15T00:00:00.000Z',
  checkOut: '2026-10-18T00:00:00.000Z',
  roomId: null,
});

function makeDeps(overrides = {}) {
  const calls = { processed: [], manualTasks: [], activity: [], approvals: [] };
  return {
    calls,
    deps: {
      isProcessed: async () => false,
      markProcessed: async (actorName, eventId) => {
        calls.processed.push({ actorName, eventId });
      },
      isEnabled: async () => true,
      logActivity: async (entry) => {
        calls.activity.push(entry);
      },
      createManualTask: async (task) => {
        calls.manualTasks.push(task);
      },
      requestApproval: async (request) => {
        calls.approvals.push(request);
        return { approvalId: 'onay-1', created: true };
      },
      sleep: async () => {},
      logger: { warn: () => {}, error: () => {} },
      ...overrides,
    },
  };
}

const refundRequest = {
  action: 'refund',
  type: 'REFUND',
  summary: '1.250,00 TL iade',
  reason: 'İptal cezasız',
  data: { amount: '1250.00' },
  amount: '1250.00',
  currency: 'TRY',
  entityType: 'Reservation',
  entityId: '33333333-3333-4333-8333-333333333333',
  expiresInMs: 60_000,
};

describe('onaya gönderme', () => {
  it('onay ister; olay işlenmiş sayılmaz, manuel görev açılmaz, yeniden denenmez', async () => {
    const { calls, deps } = makeDeps();
    let handlerCalls = 0;
    const worker = new BaseWorker(
      manifest,
      {
        'reservation.created': async (_payload, _envelope, ctx) => {
          handlerCalls += 1;
          ctx.requireApproval(refundRequest);
        },
      },
      deps,
    );

    await worker.handle(payload(), envelope());

    assert.equal(handlerCalls, 1);
    assert.equal(calls.processed.length, 0);
    assert.equal(calls.manualTasks.length, 0);
    assert.equal(calls.approvals.length, 1);
    const request = calls.approvals[0];
    assert.equal(request.actorName, 'refund-worker');
    assert.equal(request.hotelId, HOTEL);
    assert.equal(request.action, 'refund');
    assert.equal(request.type, 'REFUND');
    assert.equal(request.amount, '1250.00');
    assert.equal(request.expiresInMs, 60_000);
    // Zarf olduğu gibi taşınır: devamda aynı kimlik ve zincir.
    assert.equal(request.event.id, envelope().id);
    assert.equal(request.event.name, 'reservation.created');
    assert.equal(request.event.correlationId, 'zincir-1');
    assert.deepEqual(request.event.payload, payload());

    assert.equal(calls.activity.length, 1);
    assert.equal(calls.activity[0].level, 'INFO');
    assert.match(calls.activity[0].message, /^Onaya gönderildi/);
    assert.equal(calls.activity[0].meta.approvalId, 'onay-1');
  });

  it('`requireApproval` yardımcısı fırlatılarak da istenir', async () => {
    const { calls, deps } = makeDeps();
    const worker = new BaseWorker(
      manifest,
      {
        'reservation.created': async () => {
          throw requireApproval(refundRequest);
        },
      },
      deps,
    );
    await worker.handle(payload(), envelope());
    assert.equal(calls.approvals.length, 1);
    assert.equal(calls.manualTasks.length, 0);
  });

  it('olay yeniden dağıtılınca isteyen taraf tekilleştirir; ikinci kayıt izde görünür', async () => {
    const { calls, deps } = makeDeps({
      requestApproval: async () => ({ approvalId: 'onay-1', created: false }),
    });
    const worker = new BaseWorker(
      manifest,
      { 'reservation.created': async (_p, _e, ctx) => ctx.requireApproval(refundRequest) },
      deps,
    );
    await worker.handle(payload(), envelope());
    assert.match(calls.activity[0].message, /^Onay zaten bekleniyor/);
    assert.equal(calls.processed.length, 0);
  });

  it('bildirgede beyan edilmemiş iş için onay istemek hata: manuel görev, işlenmiş işareti', async () => {
    const { calls, deps } = makeDeps();
    const worker = new BaseWorker(
      manifest,
      { 'reservation.created': async (_p, _e, ctx) => ctx.requireApproval({ ...refundRequest, action: 'gizli' }) },
      deps,
    );
    await worker.handle(payload(), envelope());
    assert.equal(calls.approvals.length, 0);
    assert.equal(calls.manualTasks.length, 1);
    assert.match(calls.manualTasks[0].description, /beyan etmediği/);
    assert.equal(calls.processed.length, 1);
    assert.equal(calls.activity[0].level, 'ERROR');
  });

  it('onay akışı bağlı değilse iş kaybolmaz: manuel görev', async () => {
    const { calls, deps } = makeDeps({ requestApproval: undefined });
    const worker = new BaseWorker(
      manifest,
      { 'reservation.created': async (_p, _e, ctx) => ctx.requireApproval(refundRequest) },
      deps,
    );
    await worker.handle(payload(), envelope());
    assert.equal(calls.manualTasks.length, 1);
    assert.match(calls.manualTasks[0].description, /bağlı değil/);
  });

  it('onay isteği yazılamazsa (altyapı hatası) iş manuel göreve düşer', async () => {
    const { calls, deps } = makeDeps({
      requestApproval: async () => {
        throw new Error('veritabanı yok');
      },
    });
    const worker = new BaseWorker(
      manifest,
      { 'reservation.created': async (_p, _e, ctx) => ctx.requireApproval(refundRequest) },
      deps,
    );
    await worker.handle(payload(), envelope());
    assert.equal(calls.manualTasks.length, 1);
    assert.equal(calls.processed.length, 1);
  });
});

describe('onaydan sonra devam', () => {
  const approval = { id: 'onay-1', status: 'GRANTED', note: 'Olur', decidedBy: 'mudur@test.local' };

  it('işleyici onayı görür, iş biter, olay işlenmiş olur', async () => {
    const { calls, deps } = makeDeps();
    let seen = null;
    const worker = new BaseWorker(
      manifest,
      {
        'reservation.created': async (_p, _e, ctx) => {
          if (!ctx.approval) ctx.requireApproval(refundRequest);
          seen = ctx.approval;
          return { message: 'İade yapıldı', meta: { amount: '1250.00' } };
        },
      },
      deps,
    );

    await worker.handle(payload(), envelope(), { approval });

    assert.equal(seen, approval);
    assert.equal(calls.approvals.length, 0);
    assert.deepEqual(calls.processed, [{ actorName: 'refund-worker', eventId: envelope().id }]);
    assert.equal(calls.activity[0].level, 'INFO');
    assert.equal(calls.activity[0].message, 'İade yapıldı');
    assert.equal(calls.activity[0].meta.approvalId, 'onay-1');
  });

  it('aktör bu arada kapatılmış olsa da onaylanan iş yapılır', async () => {
    const { calls, deps } = makeDeps({ isEnabled: async () => false });
    let ran = false;
    const worker = new BaseWorker(
      manifest,
      {
        'reservation.created': async () => {
          ran = true;
        },
      },
      deps,
    );
    await worker.handle(payload(), envelope(), { approval });
    assert.equal(ran, true);
    assert.equal(calls.manualTasks.length, 0);
  });

  it('onaydan sonra yeniden onay istemek hata: ikinci onay açılmaz, manuel görev', async () => {
    const { calls, deps } = makeDeps();
    const worker = new BaseWorker(
      manifest,
      { 'reservation.created': async (_p, _e, ctx) => ctx.requireApproval(refundRequest) },
      deps,
    );
    await worker.handle(payload(), envelope(), { approval });
    assert.equal(calls.approvals.length, 0);
    assert.equal(calls.manualTasks.length, 1);
    assert.match(calls.manualTasks[0].description, /yeniden onay istedi/);
    assert.equal(calls.processed.length, 1);
  });

  it('devam çağrısında geçici hata yine yeniden denenir', async () => {
    const { calls, deps } = makeDeps();
    let attempts = 0;
    const worker = new BaseWorker(
      manifest,
      {
        'reservation.created': async () => {
          attempts += 1;
          if (attempts < 2) throw new Error('geçici');
        },
      },
      deps,
    );
    await worker.handle(payload(), envelope(), { approval });
    assert.equal(attempts, 2);
    assert.equal(calls.manualTasks.length, 0);
    assert.equal(calls.processed.length, 1);
  });
});

describe('bildirge', () => {
  it('onay gerektiren iş adı boş olamaz', () => {
    assert.throws(
      () => defineActor({ name: 'x', description: 'y', requiresApproval: [''] }),
      /boş olamaz/,
    );
  });
});
