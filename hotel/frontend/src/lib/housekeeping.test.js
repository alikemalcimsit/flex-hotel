import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sortForCleaner, suggestAssignments, taskActions } from './housekeeping.js';

describe('görev kartı işlemleri', () => {
  it('bekleyen görev başlatılabilir ve bitirilebilir', () => {
    const actions = taskActions({ status: 'PENDING' });
    assert.equal(actions.canStart, true);
    assert.equal(actions.canComplete, true);
  });

  it('başlamış görev yeniden başlatılamaz ama bitirilebilir', () => {
    const actions = taskActions({ status: 'IN_PROGRESS' });
    assert.equal(actions.canStart, false);
    assert.equal(actions.canComplete, true);
    assert.equal(actions.canReportIssue, true);
  });

  it('kapanmış görevde işlem yok', () => {
    for (const status of ['DONE', 'CANCELLED']) {
      const actions = taskActions({ status });
      assert.deepEqual(Object.values(actions), [false, false, false, false]);
    }
  });
});

describe('görevli sıralaması', () => {
  it('önce yarım iş, sonra acil, sonra oda numarası (sayısal)', () => {
    const sorted = sortForCleaner([
      { status: 'PENDING', priority: 1, room: { number: '110' } },
      { status: 'IN_PROGRESS', priority: 3, room: { number: '205' } },
      { status: 'PENDING', priority: 1, room: { number: '9' } },
      { status: 'DONE', priority: 1, room: { number: '101' } },
    ]);
    assert.deepEqual(
      sorted.map((task) => task.room.number),
      ['205', '9', '110', '101'],
    );
  });

  it('girdiyi değiştirmez', () => {
    const input = [
      { status: 'DONE', priority: 3, room: { number: '1' } },
      { status: 'PENDING', priority: 1, room: { number: '2' } },
    ];
    sortForCleaner(input);
    assert.equal(input[0].status, 'DONE');
  });
});

describe('toplu atama önerisi', () => {
  it('yükü en az olandan başlayarak dengeli dağıtır', () => {
    const tasks = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
    const staff = [
      { id: 'ayse', openTasks: 2 },
      { id: 'fatma', openTasks: 0 },
    ];
    const plan = suggestAssignments(tasks, staff);
    // fatma 0 → t1, fatma 1 → t2, fatma 2 == ayse 2 → ilk eşit (ayse) t3.
    assert.equal(plan.get('t1'), 'fatma');
    assert.equal(plan.get('t2'), 'fatma');
    assert.equal(plan.get('t3'), 'ayse');
  });

  it('personel yoksa boş plan döner', () => {
    assert.equal(suggestAssignments([{ id: 't1' }], []).size, 0);
  });
});
