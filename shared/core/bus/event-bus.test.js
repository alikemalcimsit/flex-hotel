import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InMemoryEventBus } from './event-bus.js';
import { runWithContext } from '../correlation.js';

/**
 * Bus'ın sözleşmesi: bilinmeyen event yayınlanamaz, kaydedilemeyen event
 * dağıtılmaz, bir dinleyicinin hatası diğerlerini etkilemez, zincir sonsuza
 * gitmez. Dördü de sessizce bozulabilecek şeyler.
 */

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

const validPayload = {
  hotelId: '11111111-1111-4111-8111-111111111111',
  id: '22222222-2222-4222-8222-222222222222',
  label: 'STD — Standart',
};

describe('katalog denetimi', () => {
  it('bilinmeyen event yayınlanamaz', async () => {
    const bus = new InMemoryEventBus({ logger: silentLogger });
    await assert.rejects(() => bus.publish('uydurma.event', {}), /Bilinmeyen event/);
  });

  it('gövde şemaya uymuyorsa reddedilir', async () => {
    const bus = new InMemoryEventBus({ logger: silentLogger });
    await assert.rejects(() => bus.publish('settings.roomType.created', { hotelId: 'uuid-değil' }), /geçersiz/);
  });

  it('geçerli gövde kabul edilir', async () => {
    const bus = new InMemoryEventBus({ logger: silentLogger });
    const envelope = await bus.publish('settings.roomType.created', validPayload);
    assert.equal(envelope.name, 'settings.roomType.created');
    assert.ok(envelope.id);
  });
});

describe('kalıcılık', () => {
  it('önce kaydeder, sonra dağıtır', async () => {
    const order = [];
    const bus = new InMemoryEventBus({
      logger: silentLogger,
      persist: async () => {
        order.push('persist');
      },
    });
    bus.subscribe('settings.roomType.created', 'test', () => {
      order.push('handler');
    });

    await bus.publish('settings.roomType.created', validPayload);
    assert.deepEqual(order, ['persist', 'handler']);
  });

  it('kaydedilemeyen event dağıtılmaz', async () => {
    let handled = false;
    const bus = new InMemoryEventBus({
      logger: silentLogger,
      persist: async () => {
        throw new Error('disk dolu');
      },
    });
    bus.subscribe('settings.roomType.created', 'test', () => {
      handled = true;
    });

    await assert.rejects(() => bus.publish('settings.roomType.created', validPayload), /disk dolu/);
    assert.equal(handled, false, 'kaydedilemeyen event dinleyiciye ulaşmamalı');
  });
});

describe('dinleyici izolasyonu', () => {
  it('bir dinleyicinin hatası diğerlerini ve yayıncıyı etkilemez', async () => {
    const bus = new InMemoryEventBus({ logger: silentLogger });
    const seen = [];

    bus.subscribe('settings.roomType.created', 'patlayan', () => {
      throw new Error('bilerek patladı');
    });
    bus.subscribe('settings.roomType.created', 'saglam', () => {
      seen.push('saglam');
    });

    await assert.doesNotReject(() => bus.publish('settings.roomType.created', validPayload));
    assert.deepEqual(seen, ['saglam']);
  });
});

describe('zincir bağlamı', () => {
  it('correlationId ve actor bağlamdan alınır', async () => {
    const bus = new InMemoryEventBus({ logger: silentLogger });
    let received;
    bus.subscribe('settings.roomType.created', 'test', (_payload, envelope) => {
      received = envelope;
    });

    const published = await runWithContext({ correlationId: 'zincir-1', actor: 'ui' }, () =>
      bus.publish('settings.roomType.created', validPayload),
    );

    assert.equal(published.correlationId, 'zincir-1');
    assert.equal(published.actor, 'ui');
    assert.equal(received.correlationId, 'zincir-1');
    assert.equal(received.hop, published.hop + 1);
  });

  it('dinleyicinin yayınladığı event zincire bağlanır', async () => {
    // Asıl mesele bu: modül 10'un "zinciri tek tıkla gör" ekranı, ikinci
    // event'in birincisinden doğduğunu buradan anlayacak.
    const bus = new InMemoryEventBus({ logger: silentLogger });
    let followUp;

    bus.subscribe('settings.roomType.created', 'tetikleyen', async () => {
      followUp = await bus.publish('settings.tax.created', { ...validPayload, label: 'KDV' });
    });

    const first = await runWithContext({ correlationId: 'zincir-2', actor: 'ui' }, () =>
      bus.publish('settings.roomType.created', validPayload),
    );

    assert.equal(followUp.correlationId, 'zincir-2', 'aynı zincirde kalmalı');
    assert.equal(followUp.causationId, first.id, 'sebebi ilk event olmalı');
    assert.equal(followUp.actor, 'tetikleyen', 'yayınlayan dinleyici olmalı');
  });

  it('hop sınırını aşan zincir dağıtılmaz', async () => {
    const bus = new InMemoryEventBus({ logger: silentLogger });
    let handled = false;
    bus.subscribe('settings.roomType.created', 'test', () => {
      handled = true;
    });

    await bus.publish('settings.roomType.created', validPayload, { hop: 99 });
    assert.equal(handled, false);
  });
});

describe('abonelik yönetimi', () => {
  it('abonelik iptal edilebilir', async () => {
    const bus = new InMemoryEventBus({ logger: silentLogger });
    let count = 0;
    const unsubscribe = bus.subscribe('settings.roomType.created', 'test', () => {
      count += 1;
    });

    await bus.publish('settings.roomType.created', validPayload);
    unsubscribe();
    await bus.publish('settings.roomType.created', validPayload);

    assert.equal(count, 1);
  });

  it('çoklu abonelik tek çağrıyla kurulur ve iptal edilir', async () => {
    const bus = new InMemoryEventBus({ logger: silentLogger });
    let count = 0;
    const unsubscribe = bus.subscribeMany(
      ['settings.roomType.created', 'settings.tax.created'],
      'test',
      () => {
        count += 1;
      },
    );

    await bus.publish('settings.roomType.created', validPayload);
    await bus.publish('settings.tax.created', { ...validPayload, label: 'KDV' });
    assert.equal(count, 2);

    unsubscribe();
    await bus.publish('settings.tax.created', { ...validPayload, label: 'KDV' });
    assert.equal(count, 2);
  });
});
