import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INVENTORY_CHANGED_EVENTS } from '@hotelos/core';
import { affectedWindow, channelSyncWorkerManifest, createChannelSyncWorker } from './index.js';

/**
 * Kanal aktörü: hangi olay kanalı hangi günler için işaretler, kanalı olmayan
 * otelde iz bırakmaz, kapalıyken gönderim tetikleyicisini atlar ama gelen
 * rezervasyonu personele düşürür.
 */

const HOTEL = '11111111-1111-4111-8111-111111111111';

function makeDeps(overrides = {}) {
  const calls = { processed: [], manualTasks: [], activity: [] };
  return {
    calls,
    deps: {
      isProcessed: async () => false,
      markProcessed: async (actorName, eventId) => calls.processed.push(eventId),
      isEnabled: async () => true,
      logActivity: async (entry) => calls.activity.push(entry),
      createManualTask: async (task) => calls.manualTasks.push(task),
      sleep: async () => {},
      logger: { warn: () => {}, error: () => {} },
      ...overrides,
    },
  };
}

function makeService(overrides = {}) {
  const calls = { dirty: [], full: [], revisions: [], staff: [] };
  return {
    calls,
    service: {
      isSyncTarget: () => true,
      markDirty: async (hotelId, window, reason) => {
        calls.dirty.push({ hotelId, window, reason });
        return { channels: 2 };
      },
      requestFullSync: async (hotelId, reason) => {
        calls.full.push({ hotelId, reason });
        return { channels: 1 };
      },
      processBookingRevision: async (hotelId, revisionId) => {
        calls.revisions.push(revisionId);
        return { message: 'ABC123 açıldı', meta: { reservationIds: ['r1'] } };
      },
      markRevisionForStaff: async (hotelId, revisionId, reason) => {
        calls.staff.push({ revisionId, reason });
      },
      ...overrides,
    },
  };
}

const envelope = (name, id = '22222222-2222-4222-8222-222222222222') => ({ id, name, correlationId: 'z', hop: 0 });

describe('bildirge', () => {
  it('bütün envanter olaylarını, fiyatı, aktör ayarını ve gelen rezervasyonu dinler', () => {
    for (const name of INVENTORY_CHANGED_EVENTS) assert.ok(channelSyncWorkerManifest.subscribes.includes(name), name);
    for (const name of ['rate.changed', 'actor.setting.changed', 'channel.booking.received']) {
      assert.ok(channelSyncWorkerManifest.subscribes.includes(name), name);
    }
    assert.equal(channelSyncWorkerManifest.fallbackModule, 'Kanal rezervasyonu');
  });
});

describe('etkilenen günler', () => {
  it('konaklama olayı: giriş dahil, çıkış hariç', () => {
    assert.deepEqual(affectedWindow('reservation.created', { checkIn: '2027-06-01T00:00:00.000Z', checkOut: '2027-06-04T00:00:00.000Z' }), {
      from: '2027-06-01',
      to: '2027-06-04',
    });
    assert.deepEqual(affectedWindow('reservation.cancelled', { checkIn: '2027-06-01', checkOut: '2027-06-02' }), { from: '2027-06-01', to: '2027-06-02' });
  });

  it('çıkış: çıkış gününden sonrası (erken çıkışın bıraktığı geceler)', () => {
    assert.deepEqual(affectedWindow('guest.checked_out', { checkIn: '2027-06-01', checkOut: '2027-06-03' }), { from: '2027-06-03', to: null });
  });

  it('arıza bloğu: bloğun günleri; süresiz blok ufkun sonuna kadar', () => {
    assert.deepEqual(affectedWindow('room.blocked', { startDate: '2027-06-01', endDate: '2027-06-05' }), { from: '2027-06-01', to: '2027-06-05' });
    assert.deepEqual(affectedWindow('room.blocked', { startDate: '2027-06-01', endDate: null }), { from: '2027-06-01', to: null });
  });

  it('oda atama / kaldırma: rezervasyonun geceleri (servis rezervasyondan okur)', () => {
    assert.deepEqual(affectedWindow('room.assigned', { reservationId: 'r1', roomId: 'x' }), { reservationId: 'r1' });
    assert.deepEqual(affectedWindow('room.unassigned', { reservationId: 'r2', roomId: 'x' }), { reservationId: 'r2' });
  });

  it('düzenleme, envanter: eski hâl bilinmediği için bütün ufuk', () => {
    for (const name of ['reservation.updated', 'inventory.room.updated', 'room.unblocked']) {
      assert.equal(affectedWindow(name, { checkIn: '2027-06-01', checkOut: '2027-06-02' }), null, name);
    }
  });

  it('fiyat: gövdedeki aralık (bitiş dahil → ertesi gün hariç) ya da bütün ufuk', () => {
    assert.deepEqual(affectedWindow('rate.changed', { from: '2027-06-01', to: '2027-06-30' }), { from: '2027-06-01', to: '2027-07-01' });
    assert.deepEqual(affectedWindow('rate.changed', { from: '2027-06-01', to: null }), { from: '2027-06-01', to: null });
    assert.equal(affectedWindow('rate.changed', { from: null, to: null }), null);
  });
});

describe('işleyiş', () => {
  it('envanter olayı senkrondaki kanalları işaretler', async () => {
    const { calls, service } = makeService();
    const { deps, calls: depCalls } = makeDeps();
    const worker = createChannelSyncWorker(service, deps);
    await worker.handle({ hotelId: HOTEL, checkIn: '2027-06-01', checkOut: '2027-06-03' }, envelope('reservation.created'));
    assert.deepEqual(calls.dirty, [{ hotelId: HOTEL, window: { from: '2027-06-01', to: '2027-06-03' }, reason: 'reservation.created' }]);
    assert.match(depCalls.activity[0].message, /2 kanal güncellenecek/);
  });

  it('kanalı olmayan otelin olayı kabul edilmez (sıraya girmez, iz bırakmaz)', () => {
    const { service } = makeService({ isSyncTarget: (hotelId) => hotelId !== HOTEL });
    const worker = createChannelSyncWorker(service, makeDeps().deps);
    assert.equal(worker.accepts('reservation.created', { hotelId: HOTEL }), false);
    assert.equal(worker.accepts('channel.booking.received', { hotelId: HOTEL }), true, 'gelen rezervasyon her zaman');
  });

  it('aktör ayarı olayı yalnızca bu aktör açıldığında: tam eşitleme ister', async () => {
    const { calls, service } = makeService();
    const worker = createChannelSyncWorker(service, makeDeps().deps);
    assert.equal(worker.accepts('actor.setting.changed', { hotelId: HOTEL, actorName: 'room-worker', enabled: true }), false);
    assert.equal(worker.accepts('actor.setting.changed', { hotelId: HOTEL, actorName: 'channel-sync-worker', enabled: false }), false);
    assert.equal(worker.accepts('actor.setting.changed', { hotelId: HOTEL, actorName: 'channel-sync-worker', enabled: true }), true);
    await worker.handle({ hotelId: HOTEL, actorName: 'channel-sync-worker', enabled: true }, envelope('actor.setting.changed'));
    assert.equal(calls.full.length, 1);
  });

  it('kapalıyken gönderim tetikleyicisi görev açmadan atlanır', async () => {
    const { calls, service } = makeService();
    const { deps, calls: depCalls } = makeDeps({ isEnabled: async () => false });
    const worker = createChannelSyncWorker(service, deps);
    await worker.handle({ hotelId: HOTEL, roomTypeIds: [], from: null, to: null, reason: 'Sezon' }, envelope('rate.changed'));
    assert.equal(calls.dirty.length, 0);
    assert.equal(depCalls.manualTasks.length, 0);
    assert.equal(depCalls.processed.length, 1);
  });

  it('kapalıyken gelen rezervasyon resepsiyona görev olarak düşer', async () => {
    const { calls, service } = makeService();
    const { deps, calls: depCalls } = makeDeps({ isEnabled: async () => false });
    const worker = createChannelSyncWorker(service, deps);
    await worker.handle(
      { hotelId: HOTEL, channelId: 'c', bookingId: 'b', revisionId: 'r' },
      envelope('channel.booking.received'),
    );
    assert.equal(calls.revisions.length, 0);
    assert.equal(depCalls.manualTasks.length, 1);
    assert.equal(depCalls.manualTasks[0].module, 'Kanal rezervasyonu');
    assert.match(depCalls.manualTasks[0].title, /elle işlenecek/);
    assert.deepEqual(calls.staff, [{ revisionId: 'r', reason: 'Aktör kapalı' }], 'kanal kaydı "elle işlenmeli" olur');
  });

  it('gönderim tetikleyicisi personele düşerse kanal kaydına dokunulmaz', async () => {
    const { calls, service } = makeService({
      markDirty: async () => {
        throw Object.assign(new Error('kalıcı'), { retryable: false });
      },
    });
    const worker = createChannelSyncWorker(service, makeDeps().deps);
    await worker.handle({ hotelId: HOTEL, checkIn: '2027-06-01', checkOut: '2027-06-02' }, envelope('reservation.created'));
    assert.equal(calls.staff.length, 0);
  });

  it('işlenemeyen rezervasyon (kalıcı hata) yeniden denenmeden göreve düşer', async () => {
    let attempts = 0;
    const { service } = makeService({
      processBookingRevision: async () => {
        attempts += 1;
        const error = new Error('Booking.com 123 · Jane Doe: oda tipi eşleşmemiş');
        error.retryable = false;
        throw error;
      },
    });
    const { deps, calls: depCalls } = makeDeps();
    const worker = createChannelSyncWorker(service, deps);
    await worker.handle({ hotelId: HOTEL, channelId: 'c', bookingId: 'b', revisionId: 'r' }, envelope('channel.booking.received'));
    assert.equal(attempts, 1);
    assert.equal(depCalls.manualTasks.length, 1);
    assert.match(depCalls.manualTasks[0].description, /oda tipi eşleşmemiş/);
  });
});
