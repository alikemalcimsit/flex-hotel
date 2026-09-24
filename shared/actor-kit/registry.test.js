import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BaseWorker } from './base-worker.js';
import { defineActor } from './manifest.js';
import { ActorRegistry } from './registry.js';

/**
 * Kayıt defterinin "hepsi bitti mi" beklemesi: testler ve düzgün kapanış buna
 * güvenir. Zincirleme iş (bir aktörün işi bitince diğerine düşen iş) de
 * beklenmeli; yoksa test sonucu yarım işe bakar, kapanış yarım işi keser.
 */

const HOTEL = '11111111-1111-4111-8111-111111111111';

const deps = {
  isProcessed: async () => false,
  markProcessed: async () => {},
  isEnabled: async () => true,
  logActivity: async () => {},
  createManualTask: async () => {},
  sleep: async () => {},
};

/** Dağıtırken dinleyicinin dönüşünü bekleyen küçük bus. */
function makeBus() {
  const handlers = new Map();
  let seq = 0;
  return {
    subscribe(name, _subscriber, handler) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(handler);
      return () => {};
    },
    async publish(name, payload) {
      seq += 1;
      const envelope = { id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, name, correlationId: 'z', hop: 0 };
      for (const handler of handlers.get(name) ?? []) await handler(payload, envelope);
    },
  };
}

const background = { maxConcurrent: 2, maxQueued: 10 };
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('ActorRegistry.idle', () => {
  it('zincirleme arka plan işini de bekler (ilk aktörün işi ikinciye iş düşürür)', async () => {
    const bus = makeBus();
    const done = [];
    const first = new BaseWorker(
      defineActor({ name: 'ilk', description: 'ilk', subscribes: ['guest.message.received'], publishes: ['guest.intent.detected'], background }),
      {
        'guest.message.received': async (payload) => {
          await tick();
          await bus.publish('guest.intent.detected', { ...payload, intent: 'OTHER' });
          done.push('ilk');
        },
      },
      deps,
    );
    const second = new BaseWorker(
      defineActor({ name: 'ikinci', description: 'ikinci', subscribes: ['guest.intent.detected'], background }),
      {
        'guest.intent.detected': async () => {
          await tick();
          await tick();
          done.push('ikinci');
        },
      },
      deps,
    );
    const registry = new ActorRegistry();
    registry.register(first).register(second);
    registry.bindAll(bus);

    await bus.publish('guest.message.received', { hotelId: HOTEL });
    assert.equal(await registry.idle(), true);
    assert.deepEqual(done, ['ilk', 'ikinci']);
  });

  it('süre dolarsa beklemeyi bırakır ve false döner', async () => {
    const bus = makeBus();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const slow = new BaseWorker(
      defineActor({ name: 'yavas', description: 'yavaş', subscribes: ['guest.message.received'], background }),
      { 'guest.message.received': () => gate },
      deps,
    );
    const registry = new ActorRegistry();
    registry.register(slow);
    registry.bindAll(bus);
    await bus.publish('guest.message.received', { hotelId: HOTEL });

    assert.equal(await registry.idle(20), false);
    release();
    assert.equal(await registry.idle(), true);
  });
});
