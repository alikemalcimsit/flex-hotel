import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EVENT_CATALOG } from '@hotelos/core';
import { EVENT_LABELS } from '@hotelos/hotel-contracts';
import { summarizeAgentUsage } from '../concierge/llm.js';
import { actorHealth, actorImpact, buildActorRows, taskLinks } from './rules.js';

/**
 * Aktör paneli kuralları: yanlış olursa yönetici "kapatırsam ne durur"
 * sorusuna yanlış cevap alır, kapalı aktörü açık sanır ya da AI
 * harcamasını eksik görür.
 */

const manifest = (name, overrides = {}) => ({
  name,
  title: overrides.title ?? name,
  type: 'worker',
  packageName: null,
  description: `${name} açıklaması`,
  subscribes: [],
  publishes: [],
  background: null,
  ...overrides,
});

const room = manifest('room-worker', {
  title: 'Oda aktörü',
  subscribes: ['reservation.created', 'guest.checked_in'],
  publishes: ['room.assigned', 'room.status.changed'],
});
const reservation = manifest('reservation-worker', {
  title: 'Rezervasyon aktörü',
  subscribes: ['reservation.requested'],
  publishes: ['reservation.created', 'reservation.rejected'],
});
const concierge = manifest('concierge-agent', {
  title: 'Concierge ajanı',
  type: 'agent',
  subscribes: ['guest.intent.detected', 'reservation.created', 'reservation.rejected'],
  publishes: ['reservation.requested'],
  background: { maxConcurrent: 16, maxQueued: 1000, onOverflow: 'fallback' },
});
const notifier = manifest('notification-worker', { subscribes: ['room.assigned'] });
const all = [room, reservation, concierge, notifier];

describe('aktörün sağlık durumu', () => {
  it('kurulu olmayan ve kapalı aktör sayaçtan önce gelir', () => {
    assert.equal(actorHealth({ registered: false, enabled: true, runs: 5, warnings: 0, errors: 3 }), 'UNAVAILABLE');
    assert.equal(actorHealth({ registered: true, enabled: false, runs: 5, warnings: 0, errors: 3 }), 'OFF');
  });

  it('hata uyarıdan, uyarı sorunsuzdan önce gelir; hiç iş yoksa boşta', () => {
    assert.equal(actorHealth({ registered: true, enabled: true, runs: 9, warnings: 2, errors: 1 }), 'ERROR');
    assert.equal(actorHealth({ registered: true, enabled: true, runs: 9, warnings: 2, errors: 0 }), 'WARN');
    assert.equal(actorHealth({ registered: true, enabled: true, runs: 9, warnings: 0, errors: 0 }), 'OK');
    assert.equal(actorHealth({ registered: true, enabled: true, runs: 0, warnings: 0, errors: 0 }), 'IDLE');
  });
});

describe('"kapatırsam ne olur"', () => {
  it('yayınladığı olayı dinleyen aktörler zinciri kesilenlerdir', () => {
    const impact = actorImpact(reservation, all);
    assert.deepEqual(impact.downstream, ['concierge-agent', 'room-worker']);
    const created = impact.publishes.find((link) => link.event === 'reservation.created');
    assert.deepEqual(created.consumedBy, ['room-worker', 'concierge-agent']);
    const rejected = impact.publishes.find((link) => link.event === 'reservation.rejected');
    assert.deepEqual(rejected.consumedBy, ['concierge-agent']);
  });

  it('dinlediği olayı hangi aktörün yayınladığını gösterir; kendini saymaz', () => {
    const impact = actorImpact(room, all);
    const created = impact.subscribes.find((link) => link.event === 'reservation.created');
    assert.deepEqual(created.publishedBy, ['reservation-worker']);
    const checkedIn = impact.subscribes.find((link) => link.event === 'guest.checked_in');
    assert.deepEqual(checkedIn.publishedBy, [], 'servisten gelen olayın aktör yayıncısı yok');
    assert.deepEqual(impact.downstream, ['notification-worker']);
  });

  it('kimse dinlemiyorsa zincir kesilmez', () => {
    const impact = actorImpact(notifier, all);
    assert.deepEqual(impact.downstream, []);
    assert.deepEqual(impact.publishes, []);
  });
});

describe('panel listesi', () => {
  const catalog = [
    { manifest: concierge, registered: false, unavailableReason: 'anahtar yok', backlog: null },
    { manifest: room, registered: true, unavailableReason: null, backlog: null },
    { manifest: reservation, registered: true, unavailableReason: null, backlog: null },
  ];
  const empty = { settings: new Map(), stats: new Map(), problems: new Map(), openTasks: new Map(), costToday: new Map() };

  it('ayar satırı yoksa aktör açıktır; kural tabanlılar önce, sonra ajanlar (Türkçe sırayla)', () => {
    const rows = buildActorRows(catalog, empty);
    assert.deepEqual(rows.map((row) => row.name), ['room-worker', 'reservation-worker', 'concierge-agent']);
    assert.ok(rows.every((row) => row.enabled));
    assert.equal(rows[0].health, 'IDLE');
    assert.equal(rows[2].health, 'UNAVAILABLE');
    assert.equal(rows[2].unavailableReason, 'anahtar yok');
  });

  it('kapalı aktör, kim / neden kapattı ve sayaçlar satıra geçer', () => {
    const at = new Date('2026-09-24T10:00:00Z');
    const rows = buildActorRows(catalog, {
      settings: new Map([['room-worker', { enabled: false, note: 'Bakım', updatedBy: 'mudur@otel.com', updatedAt: at }]]),
      stats: new Map([['room-worker', { runs: 12, lastAt: at, lastLevel: 'WARN', lastMessage: 'Aktör kapalı' }]]),
      problems: new Map([['room-worker', { warnings: 3, errors: 0 }]]),
      openTasks: new Map([['room-worker', 3]]),
      costToday: new Map([['concierge-agent', '1.250000']]),
    });
    const roomRow = rows.find((row) => row.name === 'room-worker');
    assert.equal(roomRow.enabled, false);
    assert.equal(roomRow.health, 'OFF');
    assert.equal(roomRow.changedBy, 'mudur@otel.com');
    assert.equal(roomRow.changedAt, at.toISOString());
    assert.equal(roomRow.note, 'Bakım');
    assert.deepEqual(roomRow.stats, { runs: 12, warnings: 3, errors: 0, lastAt: at.toISOString(), lastLevel: 'WARN', lastMessage: 'Aktör kapalı' });
    assert.equal(roomRow.openTasks, 3);
    assert.equal(roomRow.costTodayUsd, null, 'kural tabanlı aktörün model harcaması yok');
    const agentRow = rows.find((row) => row.name === 'concierge-agent');
    assert.equal(agentRow.costTodayUsd, '1.250000');
    assert.deepEqual(agentRow.backlog, { running: 0, queued: 0 }, 'arka plan aktörünün sırası hep görünür');
    assert.equal(roomRow.backlog, null);
  });
});

describe('görevin bağlı kayıtları', () => {
  it('rezervasyon, oda ve konuşma bağlantıları gövdeden çıkar', () => {
    const links = taskLinks({
      name: 'reservation.created',
      payload: { hotelId: 'h', reservationId: 'r-1', roomId: 'o-1', conversationId: 'c-1' },
    });
    assert.deepEqual(links, [
      { kind: 'reservation', id: 'r-1' },
      { kind: 'conversation', id: 'c-1' },
      { kind: 'room', id: 'o-1' },
    ]);
  });

  it('kanal rezervasyon isteğinin numarası misafir isteği sanılmaz', () => {
    assert.deepEqual(taskLinks({ name: 'reservation.requested', payload: { requestId: 'wa-123' } }), []);
    assert.deepEqual(taskLinks({ name: 'guest.request.created', payload: { requestId: 'q-1' } }), [{ kind: 'request', id: 'q-1' }]);
  });

  it('bozuk ya da boş gövde bağlantı üretmez', () => {
    assert.deepEqual(taskLinks(null), []);
    assert.deepEqual(taskLinks({ name: 'x', payload: null }), []);
    assert.deepEqual(taskLinks({ name: 'x', payload: { reservationId: 42, roomId: '' } }), []);
  });
});

describe('olay adları', () => {
  it('katalogdaki her olayın Türkçe adı var, fazlası yok', () => {
    const catalog = Object.keys(EVENT_CATALOG).sort();
    const labelled = Object.keys(EVENT_LABELS).sort();
    assert.deepEqual(catalog.filter((name) => !EVENT_LABELS[name]), [], 'adı eksik olay');
    assert.deepEqual(labelled.filter((name) => !EVENT_CATALOG[name]), [], 'katalogda olmayan ad');
  });
});

describe('ajanın kullanım özeti', () => {
  const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

  it('eksik günler sıfırla dolar, tutarlar kuruş kaybetmeden toplanır', () => {
    const summary = summarizeAgentUsage(
      [
        { date: day('2026-09-22'), model: 'gpt-mini', calls: 3, tokensIn: 1000n, tokensOut: 200n, cacheRead: 0n, costUsd: '0.100001' },
        { date: day('2026-09-24'), model: 'gpt-mini', calls: 2, tokensIn: 500n, tokensOut: 100n, cacheRead: 50n, costUsd: '0.200002' },
        { date: day('2026-09-24'), model: 'gpt-big', calls: 1, tokensIn: 100n, tokensOut: 100n, cacheRead: 0n, costUsd: '0.700000' },
      ],
      { from: day('2026-09-21'), today: day('2026-09-24'), hotelSpentToday: '1.500000', budgetUsd: '2.00' },
    );
    assert.deepEqual(summary.days.map((entry) => entry.date), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']);
    assert.deepEqual(summary.days.map((entry) => entry.calls), [0, 3, 0, 3]);
    assert.equal(summary.days[3].costUsd, '0.900002');
    assert.equal(summary.days[3].tokensIn, 600);
    assert.equal(summary.total.calls, 6);
    assert.equal(summary.total.costUsd, '1.000003');
    assert.equal(summary.total.avgCostPerCallUsd, '0.166667');
    assert.deepEqual(summary.byModel.map((entry) => entry.model), ['gpt-mini', 'gpt-big'], 'en çok çağrılan önce');
    assert.equal(summary.today.agentSpentUsd, '0.900002');
    assert.equal(summary.today.hotelSpentUsd, '1.500000');
    assert.equal(summary.today.exhausted, false);
  });

  it('bütçe otel geneli: ajan az harcasa da otel bütçeyi doldurduysa tükenmiştir', () => {
    const summary = summarizeAgentUsage([], {
      from: day('2026-09-24'),
      today: day('2026-09-24'),
      hotelSpentToday: '5.000000',
      budgetUsd: '5.00',
    });
    assert.equal(summary.today.agentSpentUsd, '0.000000');
    assert.equal(summary.today.exhausted, true);
    assert.equal(summary.total.avgCostPerCallUsd, '0.000000', 'çağrı yoksa sıfıra bölünmez');
  });
});
