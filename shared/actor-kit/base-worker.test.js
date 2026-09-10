import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BaseWorker } from './base-worker.js';
import { defineActor } from './manifest.js';

/**
 * Aktör tabanının sözleşmesi: aynı işi iki kez yapma, kapalıyken işi kaybetme,
 * geçici hatada pes etme, hiçbir durumda yayıncıyı patlatma.
 *
 * Dördü de sessizce bozulabilir — oda iki kez atanır, rezervasyon odasız kalır
 * ya da ayar kaydetme ekranı alakasız bir aktör yüzünden hata verir.
 */

const manifest = defineActor({
  name: 'test-worker',
  description: 'Test aktörü',
  subscribes: ['reservation.created'],
  publishes: ['room.assigned'],
  retry: { attempts: 3, backoffMs: 0 },
});

const HOTEL = '11111111-1111-4111-8111-111111111111';

const envelope = (overrides = {}) => ({
  id: '22222222-2222-4222-8222-222222222222',
  name: 'reservation.created',
  correlationId: 'zincir-1',
  hop: 1,
  ...overrides,
});

const payload = (overrides = {}) => ({
  hotelId: HOTEL,
  reservationId: '33333333-3333-4333-8333-333333333333',
  roomTypeId: '44444444-4444-4444-8444-444444444444',
  checkIn: '2026-10-15T00:00:00.000Z',
  checkOut: '2026-10-18T00:00:00.000Z',
  roomId: null,
  ...overrides,
});

/** İzlenebilir sahte bağımlılıklar. */
function makeDeps(overrides = {}) {
  const calls = { processed: [], manualTasks: [], activity: [] };
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
      sleep: async () => {},
      logger: { warn: () => {}, error: () => {} },
      ...overrides,
    },
  };
}

describe('manifest doğrulaması', () => {
  it('katalogda olmayan event reddedilir', () => {
    assert.throws(
      () => defineActor({ name: 'x', description: 'y', subscribes: ['uydurma.event'] }),
      /katalogda olmayan/,
    );
  });

  it('açıklamasız aktör reddedilir', () => {
    assert.throws(() => defineActor({ name: 'x' }), /açıklaması olmalı/);
  });

  it('beyan edilmemiş event için işleyici yazılamaz', () => {
    const { deps } = makeDeps();
    assert.throws(
      () => new BaseWorker(manifest, { 'guest.checked_out': async () => {} }, deps),
      /beyan etmemiş/,
    );
  });
});

describe('normal işleyiş', () => {
  it('işleyiciyi çağırır ve event\'i işlenmiş olarak işaretler', async () => {
    const { calls, deps } = makeDeps();
    let seen = null;
    const worker = new BaseWorker(manifest, { 'reservation.created': async (p) => { seen = p; } }, deps);

    await worker.handle(payload(), envelope());

    assert.equal(seen.reservationId, payload().reservationId);
    assert.equal(calls.processed.length, 1);
    assert.equal(calls.manualTasks.length, 0);
  });

  it('süre ve sonucu aktivite kaydına yazar', async () => {
    const { calls, deps } = makeDeps();
    const worker = new BaseWorker(
      manifest,
      { 'reservation.created': async () => ({ message: '101 atandı', meta: { roomNumber: '101' } }) },
      deps,
    );

    await worker.handle(payload(), envelope());

    assert.equal(calls.activity.length, 1);
    assert.equal(calls.activity[0].level, 'INFO');
    assert.equal(calls.activity[0].message, '101 atandı');
    assert.equal(calls.activity[0].meta.roomNumber, '101');
    assert.ok(typeof calls.activity[0].durationMs === 'number');
  });

  it('dinlemediği event\'i görmezden gelir', async () => {
    const { calls, deps } = makeDeps();
    const worker = new BaseWorker(manifest, { 'reservation.created': async () => {} }, deps);

    await worker.handle(payload(), envelope({ name: 'guest.checked_out' }));

    assert.equal(calls.processed.length, 0);
    assert.equal(calls.activity.length, 0);
  });
});

describe('idempotency', () => {
  it('daha önce işlenmiş event tekrar işlenmez', async () => {
    const { calls, deps } = makeDeps({ isProcessed: async () => true });
    let ran = false;
    const worker = new BaseWorker(manifest, { 'reservation.created': async () => { ran = true; } }, deps);

    await worker.handle(payload(), envelope());

    assert.equal(ran, false, 'aynı event ikinci kez oda atamamalı');
    assert.equal(calls.manualTasks.length, 0);
    assert.equal(calls.activity.length, 0);
  });
});

describe('aktör kapalıyken', () => {
  it('iş kaybolmaz, manuel göreve düşer', async () => {
    const { calls, deps } = makeDeps({ isEnabled: async () => false });
    let ran = false;
    const worker = new BaseWorker(manifest, { 'reservation.created': async () => { ran = true; } }, deps);

    await worker.handle(payload(), envelope());

    assert.equal(ran, false);
    assert.equal(calls.manualTasks.length, 1);
    assert.equal(calls.manualTasks[0].hotelId, HOTEL);
    assert.match(calls.manualTasks[0].description, /Aktör kapalı/);
    assert.equal(calls.manualTasks[0].originalEvent.name, 'reservation.created');
  });

  it('kapalıyken de event işlenmiş sayılır (tekrar tekrar görev üretmesin)', async () => {
    const { calls, deps } = makeDeps({ isEnabled: async () => false });
    const worker = new BaseWorker(manifest, { 'reservation.created': async () => {} }, deps);

    await worker.handle(payload(), envelope());

    assert.equal(calls.processed.length, 1);
  });
});

describe('hata ve yeniden deneme', () => {
  it('geçici hatada yeniden dener ve başarılı olursa görev üretmez', async () => {
    const { calls, deps } = makeDeps();
    let attempts = 0;
    const worker = new BaseWorker(
      manifest,
      {
        'reservation.created': async () => {
          attempts += 1;
          if (attempts < 3) throw new Error('veritabanı bir an cevap vermedi');
          return { message: 'sonunda oldu' };
        },
      },
      deps,
    );

    await worker.handle(payload(), envelope());

    assert.equal(attempts, 3);
    assert.equal(calls.manualTasks.length, 0);
    assert.equal(calls.activity[0].level, 'INFO');
  });

  it('denemeler tükenince manuel göreve düşer ve hata kaydedilir', async () => {
    const { calls, deps } = makeDeps();
    let attempts = 0;
    const worker = new BaseWorker(
      manifest,
      {
        'reservation.created': async () => {
          attempts += 1;
          throw new Error('kalıcı arıza');
        },
      },
      deps,
    );

    await worker.handle(payload(), envelope());

    assert.equal(attempts, 3, 'manifest\'teki deneme sayısı kadar denenmeli');
    assert.equal(calls.manualTasks.length, 1);
    assert.equal(calls.activity[0].level, 'ERROR');
    assert.match(calls.activity[0].message, /kalıcı arıza/);
  });

  it('retryable=false olan hata tekrar denenmez', async () => {
    // "Boş oda yok" geçici bir arıza değil; beklemek bir şeyi değiştirmez.
    const { calls, deps } = makeDeps();
    let attempts = 0;
    const worker = new BaseWorker(
      manifest,
      {
        'reservation.created': async () => {
          attempts += 1;
          const error = new Error('Uygun boş oda bulunamadı');
          error.retryable = false;
          throw error;
        },
      },
      deps,
    );

    await worker.handle(payload(), envelope());

    assert.equal(attempts, 1, 'boşuna beklememeli');
    assert.equal(calls.manualTasks.length, 1);
  });

  it('hiçbir durumda dışarı hata fırlatmaz', async () => {
    // Bir aktörün patlaması, ayar kaydeden kullanıcının işlemini bozmamalı.
    const { deps } = makeDeps({
      logActivity: async () => {
        throw new Error('log da patladı');
      },
      createManualTask: async () => {
        throw new Error('görev de oluşmadı');
      },
    });
    const worker = new BaseWorker(
      manifest,
      { 'reservation.created': async () => { throw new Error('asıl hata'); } },
      deps,
    );

    await assert.doesNotReject(() => worker.handle(payload(), envelope()));
  });
});

describe('bus bağlantısı', () => {
  it('yalnızca işleyicisi olan event\'lere abone olur', () => {
    const { deps } = makeDeps();
    const subscribed = [];
    const fakeBus = {
      subscribe: (eventName) => {
        subscribed.push(eventName);
        return () => {};
      },
    };

    const multiManifest = defineActor({
      name: 'multi',
      description: 'çoklu',
      subscribes: ['reservation.created', 'guest.checked_out'],
    });
    const worker = new BaseWorker(multiManifest, { 'reservation.created': async () => {} }, deps);
    worker.bind(fakeBus);

    assert.deepEqual(subscribed, ['reservation.created']);
  });

  it('bind geri döndürdüğü fonksiyonla abonelikleri kaldırır', () => {
    const { deps } = makeDeps();
    let unsubscribed = 0;
    const fakeBus = { subscribe: () => () => { unsubscribed += 1; } };

    const worker = new BaseWorker(manifest, { 'reservation.created': async () => {} }, deps);
    const unbind = worker.bind(fakeBus);
    unbind();

    assert.equal(unsubscribed, 1);
  });
});
