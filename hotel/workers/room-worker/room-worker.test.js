import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRoomWorker, roomWorkerManifest } from './index.js';

/**
 * Aktörün karar mantığı: ne zaman oda atar, ne zaman dokunmaz, ne zaman işi
 * personele bırakır. Veritabanı yok — servis sahte, davranış gerçek.
 */

const HOTEL = '11111111-1111-4111-8111-111111111111';
const RESERVATION = '33333333-3333-4333-8333-333333333333';
const ROOM = '55555555-5555-4555-8555-555555555555';

function makeHarness({ service = {}, isEnabled = async () => true } = {}) {
  const calls = { manualTasks: [], activity: [], assigned: [], statuses: [] };

  const worker = createRoomWorker(
    {
      autoAssignRoom: async (hotelId, reservationId) => {
        calls.assigned.push({ hotelId, reservationId });
        return { assigned: true, room: { id: ROOM, number: '101' } };
      },
      applySystemRoomStatus: async (hotelId, roomId, status, reason) => {
        calls.statuses.push({ hotelId, roomId, status, reason });
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

const reservationCreated = (overrides = {}) => ({
  payload: {
    hotelId: HOTEL,
    reservationId: RESERVATION,
    roomTypeId: '44444444-4444-4444-8444-444444444444',
    checkIn: '2026-10-15T00:00:00.000Z',
    checkOut: '2026-10-18T00:00:00.000Z',
    roomId: null,
    ...overrides,
  },
  envelope: { id: 'evt-1', name: 'reservation.created', correlationId: 'zincir', hop: 1 },
});

describe('manifest', () => {
  it('dinlediği ve yayınladığı event\'leri beyan eder', () => {
    assert.deepEqual([...roomWorkerManifest.subscribes], [
      'reservation.created',
      'guest.checked_in',
      'guest.checked_out',
    ]);
    assert.ok(roomWorkerManifest.publishes.includes('room.assigned'));
  });

  it('kapalıyken düşecek görevin modülü okunur bir ad taşır', () => {
    assert.equal(roomWorkerManifest.fallbackModule, 'Oda atama');
  });
});

describe('yeni rezervasyon', () => {
  it('oda atanmamışsa otomatik atar', async () => {
    const { worker, calls } = makeHarness();
    const { payload, envelope } = reservationCreated();

    await worker.handle(payload, envelope);

    assert.deepEqual(calls.assigned, [{ hotelId: HOTEL, reservationId: RESERVATION }]);
    assert.match(calls.activity[0].message, /101 numaralı oda atandı/);
    assert.equal(calls.manualTasks.length, 0);
  });

  it('oda zaten atanmışsa dokunmaz', async () => {
    // Personel bilerek seçmiş olabilir; üzerine yazmak sürpriz olurdu.
    const { worker, calls } = makeHarness();
    const { payload, envelope } = reservationCreated({ roomId: ROOM });

    await worker.handle(payload, envelope);

    assert.equal(calls.assigned.length, 0);
    assert.match(calls.activity[0].message, /zaten atanmış/);
  });

  it('boş oda yoksa tekrar denemeden manuel göreve düşer', async () => {
    let attempts = 0;
    const { worker, calls } = makeHarness({
      service: {
        autoAssignRoom: async () => {
          attempts += 1;
          return { assigned: false, reason: 'Uygun boş oda bulunamadı' };
        },
      },
    });
    const { payload, envelope } = reservationCreated();

    await worker.handle(payload, envelope);

    assert.equal(attempts, 1, 'oda yokluğu beklemekle çözülmez');
    assert.equal(calls.manualTasks.length, 1);
    assert.equal(calls.manualTasks[0].title, 'Rezervasyona oda atanacak');
    assert.match(calls.manualTasks[0].description, /Uygun boş oda bulunamadı/);
  });

  it('aktör kapalıyken görev okunur başlıkla düşer', async () => {
    const { worker, calls } = makeHarness({ isEnabled: async () => false });
    const { payload, envelope } = reservationCreated();

    await worker.handle(payload, envelope);

    assert.equal(calls.assigned.length, 0);
    assert.equal(calls.manualTasks[0].title, 'Rezervasyona oda atanacak');
    assert.equal(calls.manualTasks[0].module, 'Oda atama');
  });
});

describe('misafir giriş-çıkışı', () => {
  it('giriş yapınca oda dolu olur', async () => {
    const { worker, calls } = makeHarness();

    await worker.handle(
      { hotelId: HOTEL, reservationId: RESERVATION, roomId: ROOM },
      { id: 'evt-2', name: 'guest.checked_in', correlationId: 'z', hop: 1 },
    );

    assert.deepEqual(calls.statuses, [
      { hotelId: HOTEL, roomId: ROOM, status: 'OCCUPIED', reason: 'Misafir giriş yaptı' },
    ]);
  });

  it('çıkış yapınca oda kirli olur (boş değil)', async () => {
    // Doğrudan "boş" yapmak, temizlenmemiş odayı satışa açardı.
    const { worker, calls } = makeHarness();

    await worker.handle(
      { hotelId: HOTEL, reservationId: RESERVATION, roomId: ROOM },
      { id: 'evt-3', name: 'guest.checked_out', correlationId: 'z', hop: 1 },
    );

    assert.equal(calls.statuses[0].status, 'DIRTY');
  });

  it('durum güncellemesi başarısız olursa görev düşer', async () => {
    const { worker, calls } = makeHarness({
      service: {
        applySystemRoomStatus: async () => {
          throw new Error('oda bulunamadı');
        },
      },
    });

    await worker.handle(
      { hotelId: HOTEL, reservationId: RESERVATION, roomId: ROOM },
      { id: 'evt-4', name: 'guest.checked_out', correlationId: 'z', hop: 1 },
    );

    assert.equal(calls.manualTasks[0].title, 'Oda "kirli" olarak işaretlenecek');
    assert.equal(calls.activity[0].level, 'ERROR');
  });
});
