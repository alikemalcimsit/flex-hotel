import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createReservationWorker, reservationWorkerManifest } from './index.js';

/**
 * Aktörün karar mantığı: talebi açar, yer yoksa reddeder, iş kuralı hatasında
 * personele bırakır. Veritabanı yok — servis sahte, davranış gerçek.
 */

const HOTEL = '11111111-1111-4111-8111-111111111111';
const ROOM_TYPE = '44444444-4444-4444-8444-444444444444';

function makeHarness({ service = {}, isEnabled = async () => true } = {}) {
  const calls = { manualTasks: [], activity: [] };
  const worker = createReservationWorker(
    {
      requestReservation: async () => ({ created: { id: 'res-1', confirmationCode: 'ABCDEF1234' } }),
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

const requested = (overrides = {}) => ({
  payload: {
    hotelId: HOTEL,
    requestId: '22222222-2222-4222-8222-222222222222',
    source: 'WEBCHAT',
    roomTypeId: ROOM_TYPE,
    checkIn: '2027-05-01T00:00:00.000Z',
    checkOut: '2027-05-04T00:00:00.000Z',
    adults: 2,
    children: 0,
    boardType: 'BB',
    guest: { name: 'Chat Misafir', phone: null, email: null },
    ...overrides,
  },
  envelope: { id: 'evt-1', name: 'reservation.requested', correlationId: 'zincir', hop: 1 },
});

describe('manifest', () => {
  it('reservation.requested dinler, created/rejected yayınlar', () => {
    assert.deepEqual([...reservationWorkerManifest.subscribes], ['reservation.requested']);
    assert.deepEqual([...reservationWorkerManifest.publishes], ['reservation.created', 'reservation.rejected']);
    assert.equal(reservationWorkerManifest.fallbackModule, 'Rezervasyon işleme');
  });
});

describe('rezervasyon talebi', () => {
  it('yer varsa açar ve manuel görev açmaz', async () => {
    const { worker, calls } = makeHarness();
    const { payload, envelope } = requested();

    await worker.handle(payload, envelope);

    assert.equal(calls.manualTasks.length, 0);
    assert.match(calls.activity[0].message, /ABCDEF1234/);
  });

  it('yer yoksa reddeder (manuel görev değil — geçerli sonuç)', async () => {
    const { worker, calls } = makeHarness({
      service: { requestReservation: async () => ({ rejected: true, reason: 'Seçilen oda tipi bu tarihlerde dolu.' }) },
    });
    const { payload, envelope } = requested();

    await worker.handle(payload, envelope);

    assert.equal(calls.manualTasks.length, 0, 'reddetme bir hata değil, personele iş düşmez');
    assert.match(calls.activity[0].message, /reddedildi/);
  });

  it('iş kuralı hatası (4xx) tekrar denenmeden manuel göreve düşer', async () => {
    let attempts = 0;
    const { worker, calls } = makeHarness({
      service: {
        requestReservation: async () => {
          attempts += 1;
          const error = new Error('Oda tipi bulunamadı');
          error.statusCode = 422;
          throw error;
        },
      },
    });
    const { payload, envelope } = requested();

    await worker.handle(payload, envelope);

    assert.equal(attempts, 1, 'geçersiz talep beklemekle geçerli olmaz');
    assert.equal(calls.manualTasks.length, 1);
    assert.equal(calls.manualTasks[0].title, 'Gelen rezervasyon talebi elle işlenecek');
  });

  it('aktör kapalıyken talep manuel göreve düşer', async () => {
    const { worker, calls } = makeHarness({ isEnabled: async () => false });
    const { payload, envelope } = requested();

    await worker.handle(payload, envelope);

    assert.equal(calls.manualTasks[0].module, 'Rezervasyon işleme');
  });
});
