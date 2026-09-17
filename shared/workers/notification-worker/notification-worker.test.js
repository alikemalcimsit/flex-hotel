import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createNotificationWorker, describeResult, notificationWorkerManifest } from './index.js';

/**
 * Bildirim aktörünün karar mantığı — veritabanısız. Sınanan: doğru olayda
 * doğru tetikleyiciyle kuyruğa yazdırıyor mu, kapalıyken işi personele
 * bırakıyor mu, iş kuralı hatasını boşuna tekrar deniyor mu.
 */

const HOTEL = '11111111-1111-4111-8111-111111111111';
const RESERVATION = '33333333-3333-4333-8333-333333333333';
const ROOM = '55555555-5555-4555-8555-555555555555';

const TRIGGERS = {
  'reservation.created': { trigger: 'RESERVATION_CONFIRMED', label: 'Rezervasyon onayı' },
  'room.assigned': { trigger: 'ROOM_ASSIGNED', label: 'Oda bilgisi' },
};

function makeHarness({ enqueue, isEnabled = async () => true } = {}) {
  const calls = { enqueued: [], manualTasks: [], activity: [], sleeps: 0 };
  const worker = createNotificationWorker(
    {
      triggers: TRIGGERS,
      channelLabels: { EMAIL: 'E-posta', SMS: 'SMS' },
      enqueue:
        enqueue ??
        (async (hotelId, trigger, subject) => {
          calls.enqueued.push({ hotelId, trigger, subject });
          return { queued: [{ channel: 'EMAIL', status: 'PENDING' }], skipped: null, duplicates: 0 };
        }),
    },
    {
      isProcessed: async () => false,
      markProcessed: async () => {},
      isEnabled,
      logActivity: async (entry) => calls.activity.push(entry),
      createManualTask: async (task) => calls.manualTasks.push(task),
      sleep: async () => {
        calls.sleeps += 1;
      },
      logger: { warn: () => {}, error: () => {} },
    },
  );
  return { worker, calls };
}

const envelope = (name, id = 'evt-1') => ({ id, name, correlationId: 'zincir', hop: 1 });

describe('manifest', () => {
  it('eşlemedeki olayları dinler, kuyruk olaylarını yayınlar', () => {
    const manifest = notificationWorkerManifest(TRIGGERS);
    assert.deepEqual([...manifest.subscribes], ['reservation.created', 'room.assigned']);
    assert.ok(manifest.publishes.includes('notification.send.requested'));
    assert.equal(manifest.fallbackModule, 'Bildirim merkezi');
  });

  it('katalogda olmayan olay reddedilir', () => {
    assert.throws(() => notificationWorkerManifest({ 'uydurma.olay': { trigger: 'X', label: 'X' } }), /katalogda olmayan/);
  });
});

describe('olay işleme', () => {
  it('oda atamasında odayı da vererek doğru tetikleyiciyle kuyruğa yazdırır', async () => {
    const { worker, calls } = makeHarness();
    await worker.handle(
      { hotelId: HOTEL, reservationId: RESERVATION, roomId: ROOM, roomNumber: '101', assignedBy: 'manual' },
      envelope('room.assigned'),
    );
    assert.deepEqual(calls.enqueued, [
      { hotelId: HOTEL, trigger: 'ROOM_ASSIGNED', subject: { reservationId: RESERVATION, roomId: ROOM } },
    ]);
    assert.match(calls.activity[0].message, /1 bildirim sıraya alındı \(E-posta\)/);
    assert.equal(calls.manualTasks.length, 0);
  });

  it('kapalıyken kuyruğa yazmaz, işi okunur başlıkla personele bırakır', async () => {
    const { worker, calls } = makeHarness({ isEnabled: async () => false });
    await worker.handle({ hotelId: HOTEL, reservationId: RESERVATION }, envelope('reservation.created'));
    assert.equal(calls.enqueued.length, 0);
    assert.equal(calls.manualTasks[0].title, 'Misafire "Rezervasyon onayı" bildirimini elle gönderin');
    assert.equal(calls.manualTasks[0].module, 'Bildirim merkezi');
  });

  it('iş kuralı hatası (rezervasyon yok) tekrar denenmez', async () => {
    const { worker, calls } = makeHarness({
      enqueue: async () => {
        const error = new Error('Rezervasyon bulunamadı');
        error.statusCode = 404;
        throw error;
      },
    });
    await worker.handle({ hotelId: HOTEL, reservationId: RESERVATION }, envelope('reservation.created'));
    assert.equal(calls.sleeps, 0);
    assert.equal(calls.manualTasks.length, 1);
  });

  it('geçici hata tekrar denenir', async () => {
    let attempts = 0;
    const { worker, calls } = makeHarness({
      enqueue: async () => {
        attempts += 1;
        if (attempts < 2) throw new Error('bağlantı koptu');
        return { queued: [], skipped: 'Açık bildirim kanalı yok', duplicates: 0 };
      },
    });
    await worker.handle({ hotelId: HOTEL, reservationId: RESERVATION }, envelope('reservation.created'));
    assert.equal(attempts, 2);
    assert.equal(calls.manualTasks.length, 0);
    assert.equal(calls.activity[0].message, 'Açık bildirim kanalı yok');
  });
});

describe('sonuç cümlesi', () => {
  it('sıraya alınan, gönderilmeyen, tekrar ve atlanma sebebini birlikte söyler', () => {
    assert.equal(
      describeResult(
        {
          queued: [
            { channel: 'EMAIL', status: 'PENDING' },
            { channel: 'SMS', status: 'CANCELLED' },
          ],
          skipped: 'WhatsApp: etkin şablon yok',
          duplicates: 1,
        },
        { EMAIL: 'E-posta' },
      ),
      '1 bildirim sıraya alındı (E-posta); 1 bildirim gönderilmedi; 1 bildirim zaten sıradaydı; WhatsApp: etkin şablon yok',
    );
    assert.equal(describeResult({ queued: [], skipped: null, duplicates: 0 }), 'Gönderilecek bildirim yok');
  });
});
