import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFloorMap, buildStayoverPlan, isCleaningTask, summarizeTasks } from './rules.js';

const DAY = new Date('2026-10-28T00:00:00Z');
const TOMORROW = new Date('2026-10-29T00:00:00Z');
const NEXT_WEEK = new Date('2026-11-04T00:00:00Z');

describe('sabah STAYOVER planı', () => {
  it('içeride kalan oda görev alır, bugün çıkacak almaz', () => {
    const plan = buildStayoverPlan({
      businessDate: DAY,
      stays: [
        { roomId: 'r-kalan', checkOut: NEXT_WEEK },
        { roomId: 'r-cikan', checkOut: DAY },
      ],
      skipRoomIds: [],
    });
    assert.deepEqual(plan, ['r-kalan']);
  });

  it('bugün görevi ya da açık görevi olan oda atlanır (idempotent üretim)', () => {
    const plan = buildStayoverPlan({
      businessDate: DAY,
      stays: [
        { roomId: 'r-gorevli', checkOut: TOMORROW },
        { roomId: 'r-temiz', checkOut: TOMORROW },
      ],
      skipRoomIds: ['r-gorevli'],
    });
    assert.deepEqual(plan, ['r-temiz']);
  });

  it('odasız konaklama ve aynı odanın ikinci konaklaması tek görev üretir', () => {
    const plan = buildStayoverPlan({
      businessDate: DAY,
      stays: [
        { roomId: null, checkOut: TOMORROW },
        { roomId: 'r-1', checkOut: TOMORROW },
        { roomId: 'r-1', checkOut: NEXT_WEEK },
      ],
      skipRoomIds: [],
    });
    assert.deepEqual(plan, ['r-1']);
  });
});

describe('kat haritası', () => {
  const rooms = [
    { id: 'a', number: '201', floor: 2, occupancy: 'OCCUPIED', housekeepingStatus: 'DIRTY' },
    { id: 'b', number: '101', floor: 1, occupancy: 'VACANT', housekeepingStatus: 'CLEAN' },
    { id: 'c', number: '102', floor: 1, occupancy: 'VACANT', housekeepingStatus: 'INSPECTED' },
  ];

  it('katlara göre gruplar, kat ve oda numarasına göre sıralar', () => {
    const map = buildFloorMap(rooms, new Map(), new Set(), new Set(), new Set());
    assert.deepEqual(map.map((f) => f.floor), [1, 2]);
    assert.deepEqual(map[0].rooms.map((r) => r.number), ['101', '102']);
  });

  it('oda numarası sayısal sıralanır (9 < 10)', () => {
    const map = buildFloorMap(
      [
        { id: 'x', number: '10', floor: 1, occupancy: 'VACANT', housekeepingStatus: 'CLEAN' },
        { id: 'y', number: '9', floor: 1, occupancy: 'VACANT', housekeepingStatus: 'CLEAN' },
      ],
      new Map(),
      new Set(),
      new Set(),
      new Set(),
    );
    assert.deepEqual(map[0].rooms.map((r) => r.number), ['9', '10']);
  });

  it('açık görev, giriş / çıkış ve arıza işaretleri kutuya iliştirilir', () => {
    const openTask = { id: 't1', type: 'CHECKOUT_CLEAN', status: 'PENDING', priority: 2, assignedTo: null, issue: false };
    const map = buildFloorMap(rooms, new Map([['a', openTask]]), new Set(['b']), new Set(['a']), new Set(['c']));
    const byId = new Map(map.flatMap((f) => f.rooms).map((r) => [r.id, r]));

    assert.equal(byId.get('a').openTask.id, 't1');
    assert.equal(byId.get('a').departureToday, true);
    assert.equal(byId.get('b').arrivalToday, true);
    assert.equal(byId.get('c').blocked, true);
    assert.equal(byId.get('b').openTask, null);
  });
});

describe('temizlik tipi ayrımı', () => {
  it('temizlik görevleri odayı sürer, misafir isteği sürmez', () => {
    assert.equal(isCleaningTask('CHECKOUT_CLEAN'), true);
    assert.equal(isCleaningTask('STAYOVER'), true);
    assert.equal(isCleaningTask('DEEP_CLEAN'), true);
    assert.equal(isCleaningTask('GUEST_REQUEST'), false);
  });
});

describe('günlük özet', () => {
  it('grup sayılarını kartlara çevirir', () => {
    const summary = summarizeTasks(
      [
        { status: 'PENDING', _count: { _all: 5 } },
        { status: 'IN_PROGRESS', _count: { _all: 2 } },
        { status: 'DONE', _count: { _all: 7 } },
      ],
      { awaitingInspection: 3, issues: 1 },
    );
    assert.equal(summary.pending, 5);
    assert.equal(summary.open, 7);
    assert.equal(summary.done, 7);
    assert.equal(summary.awaitingInspection, 3);
    assert.equal(summary.issues, 1);
  });

  it('boş grup sıfırlarla döner', () => {
    const summary = summarizeTasks([]);
    assert.equal(summary.open, 0);
    assert.equal(summary.awaitingInspection, 0);
  });
});
