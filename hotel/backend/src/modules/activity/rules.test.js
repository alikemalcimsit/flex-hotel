import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildChain, changedValues, groupEntityChains } from './rules.js';

/**
 * İşlem zinciri kuralları: olay → işleyiş → (değişiklik, yeni olay) ağacı,
 * zamana göre sıra, süre, sayımlar ve bozuk kayıtta sonsuz ağaç olmaması.
 * Zincir ekranı "bu rezervasyona ne oldu" sorusunun cevabı; yanlış yere
 * asılan bir adım, yanlış kişiyi sorumlu gösterir.
 */

const T0 = Date.parse('2026-09-25T10:00:00.000Z');
const at = (offsetMs) => new Date(T0 + offsetMs);

const E1 = '00000000-0000-4000-8000-000000000001';
const E2 = '00000000-0000-4000-8000-000000000002';
const E3 = '00000000-0000-4000-8000-000000000003';

/** Personel rezervasyon açar; oda aktörü oda atar; bildirim aktörü onay yollar. */
function reservationChain() {
  return {
    events: [
      { id: E1, name: 'reservation.created', actor: 'resepsiyon@otel.com', occurredAt: at(5), publishedAt: at(6), hop: 0, causationId: null },
      { id: E2, name: 'room.assigned', actor: 'room-worker', occurredAt: at(30), publishedAt: at(31), hop: 1, causationId: E1 },
    ],
    activities: [
      // Satır iş bitince yazılır: oda aktörü 10'da başladı, 40'ta bitti.
      { id: 'a-room', actorName: 'room-worker', eventId: E1, eventName: 'reservation.created', level: 'INFO', message: '204 atandı', durationMs: 30, createdAt: at(40) },
      { id: 'a-notify', actorName: 'notification-worker', eventId: E1, eventName: 'reservation.created', level: 'WARN', message: 'E-posta kanalı kapalı', durationMs: 5, createdAt: at(12) },
    ],
    audits: [
      { id: 'u-create', entity: 'Reservation', entityId: 'r1', action: 'CREATE', actor: 'resepsiyon@otel.com', changedFields: [], createdAt: at(3) },
      { id: 'u-room', entity: 'Reservation', entityId: 'r1', action: 'UPDATE', actor: 'room-worker', changedFields: ['roomId'], createdAt: at(25) },
    ],
  };
}

describe('işlem zinciri', () => {
  it('olay → işleyiş → (değişiklik, sonraki olay) ağacı; zamana göre sıralı', () => {
    const chain = buildChain(reservationChain());

    assert.deepEqual(
      chain.roots.map((node) => `${node.kind}:${node.id}`),
      ['AUDIT:u-create', `EVENT:${E1}`],
      'personelin değişikliği ve yayınladığı olay kökte',
    );
    const created = chain.roots[1];
    assert.deepEqual(
      created.children.map((node) => node.id),
      ['a-notify', 'a-room'],
      'işleyişler başlangıç anına göre (bildirim 7\'de, oda 10\'da başladı)',
    );
    const room = created.children[1];
    assert.equal(room.startedAt, at(10).toISOString());
    assert.deepEqual(
      room.children.map((node) => `${node.kind}:${node.id}`),
      ['AUDIT:u-room', `EVENT:${E2}`],
      'oda aktörünün yazdığı değişiklik ve yayınladığı olay onun altında',
    );
  });

  it('süre, sayımlar ve aktörler', () => {
    const chain = buildChain(reservationChain());
    assert.equal(chain.startedAt, at(3).toISOString());
    assert.equal(chain.endedAt, at(40).toISOString());
    assert.equal(chain.spanMs, 37);
    assert.deepEqual(chain.counts, { events: 2, handlers: 2, audits: 2, errors: 0, warnings: 1, unpublished: 0 });
    assert.deepEqual(chain.actors, ['notification-worker', 'room-worker']);
  });

  it('başka aktörün yazdığı ya da işleyiş süresi dışındaki değişiklik aktöre asılmaz', () => {
    const input = reservationChain();
    input.audits.push(
      { id: 'u-late', entity: 'Reservation', entityId: 'r1', action: 'UPDATE', actor: 'room-worker', changedFields: ['notes'], createdAt: at(500) },
      { id: 'u-other', entity: 'Room', entityId: 'x', action: 'UPDATE', actor: 'mudur@otel.com', changedFields: ['status'], createdAt: at(20) },
    );
    const chain = buildChain(input);
    const rootIds = chain.roots.map((node) => node.id);
    assert.ok(rootIds.includes('u-late'));
    assert.ok(rootIds.includes('u-other'));
  });

  it('olayını zincirde bulamayan işleyiş ve yayınlayanı işleyiş olmayan olay kaybolmaz', () => {
    const input = reservationChain();
    input.activities.push({ id: 'a-orphan', actorName: 'x-worker', eventId: E3, eventName: 'x', level: 'ERROR', message: 'hata', durationMs: 1, createdAt: at(50) });
    input.events.push({ id: E3, name: 'waitlist.changed', actor: 'reservation-worker', occurredAt: at(45), publishedAt: null, hop: 1, causationId: E1 });
    const chain = buildChain(input);
    // E3'ün sebebi E1 ama E1'i reservation-worker işlememiş: E1'in altına.
    const created = chain.roots.find((node) => node.id === E1);
    assert.ok(created.children.some((node) => node.id === E3));
    // a-orphan E3'ü işledi (E3 zincirde): onun altında; hata sayılır; E3 dağıtılmamış.
    const e3 = created.children.find((node) => node.id === E3);
    assert.deepEqual(e3.children.map((node) => node.id), ['a-orphan']);
    assert.equal(chain.counts.errors, 1);
    assert.equal(chain.counts.unpublished, 1);

    const lonely = buildChain({ events: [], activities: [input.activities[0]], audits: [] });
    assert.deepEqual(lonely.roots.map((node) => node.id), ['a-room'], 'olayı yoksa kökte');
  });

  it('bozuk kayıtta döngü (A\'nın sebebi B, B\'nin sebebi A) sonsuz ağaç yapmaz', () => {
    const chain = buildChain({
      events: [
        { id: E1, name: 'a', actor: 'x', occurredAt: at(0), publishedAt: at(0), hop: 0, causationId: E2 },
        { id: E2, name: 'b', actor: 'x', occurredAt: at(1), publishedAt: at(1), hop: 1, causationId: E1 },
      ],
      activities: [],
      audits: [],
    });
    assert.deepEqual(chain.roots.map((node) => node.id), [E1, E2]);
    assert.doesNotThrow(() => JSON.stringify(chain));
  });

  it('boş zincir', () => {
    const chain = buildChain({ events: [], activities: [], audits: [] });
    assert.equal(chain.startedAt, null);
    assert.equal(chain.spanMs, 0);
    assert.deepEqual(chain.roots, []);
  });
});

describe('değişen değerler', () => {
  it('yalnızca güncellemede, yalnızca değişen alanlar', () => {
    const audit = {
      action: 'UPDATE',
      changedFields: ['roomId', 'status'],
      before: { roomId: null, status: 'CONFIRMED', notes: 'x' },
      after: { roomId: 'room-204', status: 'CHECKED_IN', notes: 'x' },
    };
    assert.deepEqual(changedValues(audit), [
      { field: 'roomId', before: null, after: 'room-204' },
      { field: 'status', before: 'CONFIRMED', after: 'CHECKED_IN' },
    ]);
    assert.deepEqual(changedValues({ ...audit, action: 'CREATE' }), []);
    assert.equal(changedValues(audit, 1).length, 1);
  });
});

describe('kaydın zincirleri', () => {
  it('zincire göre gruplar; en yeni zincir önce; ilk işlem ve başlatan kişi', () => {
    const rows = [
      { correlationId: 'c-create', action: 'CREATE', actor: 'resepsiyon@otel.com', changedFields: [], createdAt: at(0) },
      { correlationId: 'c-create', action: 'UPDATE', actor: 'room-worker', changedFields: ['roomId'], createdAt: at(20) },
      { correlationId: 'c-checkin', action: 'UPDATE', actor: 'onburo@otel.com', changedFields: ['status', 'checkedInAt'], createdAt: at(86_400_000) },
    ];
    const chains = groupEntityChains(rows, 10);
    assert.deepEqual(chains.map((chain) => chain.correlationId), ['c-checkin', 'c-create']);
    assert.equal(chains[1].firstAction, 'CREATE');
    assert.equal(chains[1].actor, 'resepsiyon@otel.com');
    assert.equal(chains[1].changes, 2);
    assert.deepEqual(chains[1].fields, ['roomId']);
    assert.deepEqual(chains[0].fields, ['checkedInAt', 'status']);
    assert.equal(groupEntityChains(rows, 1).length, 1);
  });
});
