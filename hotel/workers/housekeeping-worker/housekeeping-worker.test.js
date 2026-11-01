import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHousekeepingWorker, housekeepingWorkerManifest } from './index.js';

const HOTEL = '11111111-1111-4111-8111-111111111111';
const ROOM = '55555555-5555-4555-8555-555555555555';
const TASK = '33333333-3333-4333-8333-333333333333';
const REQUEST = '44444444-4444-4444-8444-444444444444';

let eventSeq = 0;
function envelope(name, overrides = {}) {
  eventSeq += 1;
  return { id: `evt-${eventSeq}`, name, correlationId: 'corr-1', hop: 1, actor: 'test', ...overrides };
}

function makeHarness({ service = {}, isEnabled = async () => true } = {}) {
  const calls = { manualTasks: [], activity: [], created: [], cancelled: [], states: [], requestsClosed: [] };

  const worker = createHousekeepingWorker(
    {
      createCleaningTask: async (hotelId, input) => {
        calls.created.push({ hotelId, ...input });
        return { created: true, task: { id: TASK, room: { number: '104' } } };
      },
      createRequestTask: async (hotelId, input) => {
        calls.created.push({ hotelId, type: 'GUEST_REQUEST', ...input });
        return { created: true, task: { id: TASK } };
      },
      cancelOpenCheckoutTasks: async (hotelId, roomId, reason) => {
        calls.cancelled.push({ hotelId, roomId, reason });
        return { cancelled: 1 };
      },
      applySystemRoomState: async (hotelId, roomId, state, reason) => {
        calls.states.push({ hotelId, roomId, ...state, reason });
      },
      completeGuestRequest: async (hotelId, requestId, note) => {
        calls.requestsClosed.push({ hotelId, requestId, note });
      },
      ...service,
    },
    {
      isProcessed: async () => false,
      markProcessed: async () => {},
      isEnabled,
      logActivity: async (entry) => calls.activity.push(entry),
      createManualTask: async (task) => calls.manualTasks.push(task),
      sleep: async () => {},
      logger: { warn: () => {}, error: () => {} },
    },
  );

  return { worker, calls };
}

describe('manifest', () => {
  it('dinlediği ve yayınladığı event\'leri beyan eder', () => {
    assert.ok(housekeepingWorkerManifest.subscribes.includes('guest.checked_out'));
    assert.ok(housekeepingWorkerManifest.subscribes.includes('housekeeping.task.completed'));
    assert.ok(housekeepingWorkerManifest.publishes.includes('room.status.changed'));
    assert.equal(housekeepingWorkerManifest.fallbackModule, 'Kat hizmeti');
  });
});

describe('misafir çıkışı', () => {
  it('çıkışta öncelikli çıkış temizliği görevi açılır', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle({ hotelId: HOTEL, roomId: ROOM, reservationId: REQUEST }, envelope('guest.checked_out'));

    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0].type, 'CHECKOUT_CLEAN');
    assert.equal(calls.manualTasks.length, 0);
  });

  it('açık görev zaten varsa ikinci kez açılmaz, hata da sayılmaz', async () => {
    const { worker, calls } = makeHarness({
      service: { createCleaningTask: async () => ({ created: false, task: { id: TASK } }) },
    });
    await worker.handle({ hotelId: HOTEL, roomId: ROOM }, envelope('guest.checked_out'));

    assert.equal(calls.activity.at(-1).level, 'INFO');
    assert.match(calls.activity.at(-1).message, /zaten var/);
  });

  it('çıkış geri alınınca açık çıkış temizliği iptal edilir', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle(
      { hotelId: HOTEL, roomId: ROOM, reason: 'Yanlış misafir' },
      envelope('guest.check_out_reverted'),
    );

    assert.equal(calls.cancelled.length, 1);
    assert.match(calls.cancelled[0].reason, /Yanlış misafir/);
  });
});

describe('arıza kaydı', () => {
  it('süren kaydın bitişinde detaylı temizlik açılır', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle(
      { hotelId: HOTEL, roomId: ROOM, roomNumber: '104', blockId: TASK, mode: 'ENDED' },
      envelope('room.unblocked'),
    );
    assert.equal(calls.created[0]?.type, 'DEEP_CLEAN');
  });

  it('başlamamış kaydın iptali görev üretmez (accepts süzer)', () => {
    const { worker } = makeHarness();
    assert.equal(worker.accepts('room.unblocked', { mode: 'CANCELLED' }), false);
    assert.equal(worker.accepts('room.unblocked', { mode: 'ENDED' }), true);
  });
});

describe('misafir isteği', () => {
  it('kat kategorisindeki istek göreve çevrilir', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle(
      { hotelId: HOTEL, requestId: REQUEST, category: 'HOUSEKEEPING', priority: 'HIGH', roomId: ROOM, conversationId: null },
      envelope('guest.request.created'),
    );
    assert.equal(calls.created[0]?.requestId, REQUEST);
  });

  it('kat-dışı kategori ve odasız istek süzülür', () => {
    const { worker } = makeHarness();
    assert.equal(worker.accepts('guest.request.created', { category: 'MAINTENANCE', roomId: ROOM }), false);
    assert.equal(worker.accepts('guest.request.created', { category: 'HOUSEKEEPING', roomId: null }), false);
    assert.equal(worker.accepts('guest.request.created', { category: 'AMENITY', roomId: ROOM }), true);
  });

  it('aktör kapalıyken istek sessizce atlanır (istek ekranı zaten gösteriyor)', async () => {
    const { worker, calls } = makeHarness({ isEnabled: async () => false });
    await worker.handle(
      { hotelId: HOTEL, requestId: REQUEST, category: 'HOUSEKEEPING', priority: 'NORMAL', roomId: ROOM },
      envelope('guest.request.created'),
    );
    assert.equal(calls.manualTasks.length, 0);
    assert.match(calls.activity.at(-1).message, /atlandı/);
  });
});

describe('görev → oda durumu', () => {
  it('başlayınca oda "Temizleniyor" olur', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle(
      { hotelId: HOTEL, taskId: TASK, roomId: ROOM, roomNumber: '104', type: 'CHECKOUT_CLEAN' },
      envelope('housekeeping.task.started'),
    );
    assert.equal(calls.states[0]?.housekeepingStatus, 'CLEANING');
  });

  it('havlu görevi oda durumuna dokunmaz (accepts süzer)', () => {
    const { worker } = makeHarness();
    assert.equal(worker.accepts('housekeeping.task.started', { type: 'GUEST_REQUEST' }), false);
  });

  it('bitince oda "Temiz" olur, bağlı istek kapanır', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle(
      { hotelId: HOTEL, taskId: TASK, roomId: ROOM, roomNumber: '104', type: 'STAYOVER', guestRequestId: REQUEST },
      envelope('housekeeping.task.completed'),
    );
    assert.equal(calls.states[0]?.housekeepingStatus, 'CLEAN');
    assert.equal(calls.requestsClosed[0]?.requestId, REQUEST);
  });

  it('istek bu arada kapanmışsa iş hata saymaz', async () => {
    const closedError = Object.assign(new Error('Geçiş yok'), { statusCode: 409 });
    const { worker, calls } = makeHarness({
      service: { completeGuestRequest: async () => { throw closedError; } },
    });
    await worker.handle(
      { hotelId: HOTEL, taskId: TASK, roomId: ROOM, roomNumber: '104', type: 'GUEST_REQUEST', guestRequestId: REQUEST },
      envelope('housekeeping.task.completed'),
    );
    assert.equal(calls.manualTasks.length, 0);
    assert.match(calls.activity.at(-1).message, /zaten kapalıydı/);
  });

  it('kontrol geçti: oda "Kontrol edildi"; kaldı: yeniden "Kirli"', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle(
      { hotelId: HOTEL, taskId: TASK, roomId: ROOM, roomNumber: '104', passed: true, note: null },
      envelope('housekeeping.room.inspected'),
    );
    await worker.handle(
      { hotelId: HOTEL, taskId: TASK, roomId: ROOM, roomNumber: '104', passed: false, note: 'Banyo yeniden' },
      envelope('housekeeping.room.inspected'),
    );
    assert.equal(calls.states[0]?.housekeepingStatus, 'INSPECTED');
    assert.equal(calls.states[1]?.housekeepingStatus, 'DIRTY');
    assert.match(calls.states[1]?.reason, /Banyo yeniden/);
  });
});

describe('aktör kapalı ve hata yolları', () => {
  it('kapalıyken çıkış işi manuel göreve düşer', async () => {
    const { worker, calls } = makeHarness({ isEnabled: async () => false });
    await worker.handle({ hotelId: HOTEL, roomId: ROOM }, envelope('guest.checked_out'));

    assert.equal(calls.manualTasks.length, 1);
    assert.equal(calls.manualTasks[0].module, 'Kat hizmeti');
    assert.match(calls.manualTasks[0].title, /Çıkış temizliği/);
  });

  it('iş kuralı hatası (404) beklemeden personele düşer', async () => {
    const notFound = Object.assign(new Error('Oda bulunamadı'), { statusCode: 404 });
    let attempts = 0;
    const { worker, calls } = makeHarness({
      service: {
        createCleaningTask: async () => {
          attempts += 1;
          throw notFound;
        },
      },
    });
    await worker.handle({ hotelId: HOTEL, roomId: ROOM }, envelope('guest.checked_out'));

    assert.equal(attempts, 1);
    assert.equal(calls.manualTasks.length, 1);
  });

  it('aynı olay ikinci kez gelirse işlenmez', async () => {
    const { worker, calls } = makeHarness();
    const env = envelope('guest.checked_out');
    await worker.handle({ hotelId: HOTEL, roomId: ROOM }, env);

    const { worker: worker2, calls: calls2 } = makeHarness();
    // İkinci işleyici "işlenmiş" okur: hiç dokunmaz.
    const seen = new Set([env.id]);
    const worker3 = createHousekeepingWorker(
      { createCleaningTask: async () => { throw new Error('çağrılmamalı'); } },
      {
        isProcessed: async (_name, id) => seen.has(id),
        markProcessed: async () => {},
        isEnabled: async () => true,
        logActivity: async () => {},
        createManualTask: async () => {},
        sleep: async () => {},
        logger: { warn: () => {}, error: () => {} },
      },
    );
    await worker3.handle({ hotelId: HOTEL, roomId: ROOM }, env);
    assert.equal(calls.created.length, 1);
    assert.equal(calls2.created.length, 0);
  });
});
