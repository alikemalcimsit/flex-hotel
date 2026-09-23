import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createReservationWorker, reservationWorkerManifest } from './index.js';

/**
 * Aktörün sözleşmesi: isteği servise verir; ret bir sonuçtur (manuel görev
 * değil), beklenmeyen hata yeniden denenir ve iş kaybolmaz.
 */

const HOTEL = '11111111-1111-4111-8111-111111111111';

const requested = (overrides = {}) => ({
  payload: {
    hotelId: HOTEL,
    requestId: 'wa-123',
    source: 'WHATSAPP',
    guest: { firstName: 'Ayşe', lastName: 'Yılmaz', phone: '+905321110001', email: null, nationality: 'TR' },
    roomTypeId: '44444444-4444-4444-8444-444444444444',
    checkIn: '2026-10-15T00:00:00.000Z',
    checkOut: '2026-10-18T00:00:00.000Z',
    adults: 2,
    children: 0,
    boardType: null,
    notes: null,
    status: 'PENDING',
    ...overrides,
  },
  envelope: { id: '22222222-2222-4222-8222-222222222222', name: 'reservation.requested', correlationId: 'z', hop: 0 },
});

function harness(service, { isEnabled = async () => true } = {}) {
  const calls = { manualTasks: [], activity: [], processed: [] };
  const worker = createReservationWorker(service, {
    isProcessed: async () => false,
    markProcessed: async (_actor, eventId) => calls.processed.push(eventId),
    isEnabled,
    logActivity: async (entry) => calls.activity.push(entry),
    createManualTask: async (task) => calls.manualTasks.push(task),
    sleep: async () => {},
    logger: { warn: () => {}, error: () => {} },
  });
  return { worker, calls };
}

describe('reservation-worker', () => {
  it('bildirge: kanal isteğini dinler, açılışı ve reddi yayınlar', () => {
    assert.deepEqual(reservationWorkerManifest.subscribes, ['reservation.requested']);
    assert.deepEqual(reservationWorkerManifest.publishes, ['reservation.created', 'reservation.rejected']);
    assert.equal(reservationWorkerManifest.fallbackModule, 'Rezervasyon');
  });

  it('açılan rezervasyon izde onay koduyla görünür', async () => {
    const seen = [];
    const { worker, calls } = harness({
      createFromChannelRequest: async (payload) => {
        seen.push(payload);
        return { outcome: 'CREATED', reservationId: 'r1', confirmationCode: 'DEMO-KQXN7A' };
      },
    });
    const { payload, envelope } = requested();
    await worker.handle(payload, envelope);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].requestId, 'wa-123');
    assert.equal(calls.activity[0].message, 'DEMO-KQXN7A numaralı rezervasyon açıldı');
    assert.equal(calls.manualTasks.length, 0);
    assert.deepEqual(calls.processed, [envelope.id]);
  });

  it('ret bir sonuçtur: manuel görev açılmaz, yeniden denenmez', async () => {
    let attempts = 0;
    const { worker, calls } = harness({
      createFromChannelRequest: async () => {
        attempts += 1;
        return { outcome: 'REJECTED', code: 'NO_AVAILABILITY', reason: 'Yer yok' };
      },
    });
    const { payload, envelope } = requested();
    await worker.handle(payload, envelope);
    assert.equal(attempts, 1);
    assert.equal(calls.manualTasks.length, 0);
    assert.match(calls.activity[0].message, /İstek karşılanamadı: Yer yok/);
    assert.equal(calls.activity[0].meta.code, 'NO_AVAILABILITY');
  });

  it('beklenmeyen hata yeniden denenir; olmazsa okunur başlıklı manuel görev', async () => {
    let attempts = 0;
    const { worker, calls } = harness({
      createFromChannelRequest: async () => {
        attempts += 1;
        throw new Error('veritabanı yok');
      },
    });
    const { payload, envelope } = requested();
    await worker.handle(payload, envelope);
    assert.equal(attempts, 3);
    assert.equal(calls.manualTasks.length, 1);
    assert.equal(calls.manualTasks[0].title, 'WhatsApp rezervasyon isteği elle açılacak: Ayşe Yılmaz, 15.10.2026 – 18.10.2026');
    assert.equal(calls.manualTasks[0].module, 'Rezervasyon');
  });

  it('aktör kapalıysa istek personele düşer, servis çağrılmaz', async () => {
    let called = false;
    const { worker, calls } = harness(
      {
        createFromChannelRequest: async () => {
          called = true;
          return { outcome: 'CREATED' };
        },
      },
      { isEnabled: async () => false },
    );
    const { payload, envelope } = requested();
    await worker.handle(payload, envelope);
    assert.equal(called, false);
    assert.equal(calls.manualTasks.length, 1);
  });

  it('aynı istek ikinci kez gelirse servis ilkini döndürür; iz bunu söyler', async () => {
    const { worker, calls } = harness({
      createFromChannelRequest: async () => ({ outcome: 'EXISTING', reservationId: 'r1', confirmationCode: 'DEMO-KQXN7A' }),
    });
    const { payload, envelope } = requested();
    await worker.handle(payload, envelope);
    assert.match(calls.activity[0].message, /daha önce işlenmiş \(DEMO-KQXN7A\)/);
  });
});
