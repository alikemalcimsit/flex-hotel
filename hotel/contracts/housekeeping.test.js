import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assignHousekeepingTasksSchema,
  cancelHousekeepingTaskSchema,
  createHousekeepingTaskSchema,
  HOUSEKEEPING_CLEANING_TYPES,
  HOUSEKEEPING_MAX_BULK_ASSIGN,
  HOUSEKEEPING_TASK_TYPES,
  housekeepingInspectionError,
  housekeepingPriorityForRequest,
  housekeepingTaskListQuerySchema,
  housekeepingTaskTransitionError,
  inspectHousekeepingTaskSchema,
  reportHousekeepingIssueSchema,
} from './housekeeping.js';

const ROOM = '55555555-5555-4555-8555-555555555555';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TASK = '33333333-3333-4333-8333-333333333333';

describe('görev durum geçişleri', () => {
  it('bekleyen görev başlatılabilir, bitirilebilir, iptal edilebilir', () => {
    assert.equal(housekeepingTaskTransitionError('PENDING', 'IN_PROGRESS'), null);
    assert.equal(housekeepingTaskTransitionError('PENDING', 'DONE'), null);
    assert.equal(housekeepingTaskTransitionError('PENDING', 'CANCELLED'), null);
  });

  it('başlatılmış görev bırakılabilir (işe devam edilemedi)', () => {
    assert.equal(housekeepingTaskTransitionError('IN_PROGRESS', 'PENDING'), null);
  });

  it('kapanmış görev değişmez', () => {
    assert.match(housekeepingTaskTransitionError('DONE', 'IN_PROGRESS'), /değiştirilemez/);
    assert.match(housekeepingTaskTransitionError('CANCELLED', 'DONE'), /değiştirilemez/);
  });

  it('bilinmeyen durum reddedilir', () => {
    assert.match(housekeepingTaskTransitionError('PENDING', 'YOK'), /Geçersiz/);
  });

  it('aynı duruma geçiş sessizce geçerli sayılır', () => {
    assert.equal(housekeepingTaskTransitionError('PENDING', 'PENDING'), null);
  });
});

describe('kontrol (dört göz)', () => {
  const doneTask = { status: 'DONE', type: 'CHECKOUT_CLEAN', inspectionPassed: null, completedById: USER };

  it('bitmiş temizlik görevi başka görevli tarafından kontrol edilebilir', () => {
    assert.equal(housekeepingInspectionError(doneTask, OTHER), null);
  });

  it('temizliği yapan kendi işini onaylayamaz', () => {
    assert.match(housekeepingInspectionError(doneTask, USER), /dört göz/);
  });

  it('bitmemiş görev kontrol edilemez', () => {
    assert.match(housekeepingInspectionError({ ...doneTask, status: 'IN_PROGRESS' }, OTHER), /bitmiş/);
  });

  it('ikinci kez kontrol edilemez', () => {
    assert.match(housekeepingInspectionError({ ...doneTask, inspectionPassed: true }, OTHER), /zaten/);
  });

  it('misafir isteği görevi kontrol edilmez', () => {
    assert.match(housekeepingInspectionError({ ...doneTask, type: 'GUEST_REQUEST' }, OTHER), /temizlik/);
  });
});

describe('istek önceliği eşlemesi', () => {
  it('acil istek en acil göreve dönüşür', () => {
    assert.equal(housekeepingPriorityForRequest('URGENT'), 1);
    assert.equal(housekeepingPriorityForRequest('HIGH'), 2);
    assert.equal(housekeepingPriorityForRequest('NORMAL'), 3);
    assert.equal(housekeepingPriorityForRequest('LOW'), 4);
  });

  it('bilinmeyen öncelik normale düşer', () => {
    assert.equal(housekeepingPriorityForRequest('BELIRSIZ'), 3);
  });
});

describe('görev oluşturma şeması', () => {
  it('oda ve varsayılanlarla geçer', () => {
    const parsed = createHousekeepingTaskSchema.parse({ roomId: ROOM });
    assert.equal(parsed.type, 'STAYOVER');
    assert.equal(parsed.priority, 3);
  });

  it('misafir isteği tipi elle açılamaz', () => {
    const result = createHousekeepingTaskSchema.safeParse({ roomId: ROOM, type: 'GUEST_REQUEST' });
    assert.equal(result.success, false);
  });

  it('takvimde olmayan gün reddedilir', () => {
    const result = createHousekeepingTaskSchema.safeParse({ roomId: ROOM, scheduledFor: '2026-02-31' });
    assert.equal(result.success, false);
  });

  it('öncelik 1-5 dışına çıkamaz', () => {
    assert.equal(createHousekeepingTaskSchema.safeParse({ roomId: ROOM, priority: 0 }).success, false);
    assert.equal(createHousekeepingTaskSchema.safeParse({ roomId: ROOM, priority: 6 }).success, false);
  });
});

describe('toplu atama şeması', () => {
  it('görev listesi ve görevliyle geçer; null atamayı kaldırır', () => {
    assert.equal(assignHousekeepingTasksSchema.safeParse({ taskIds: [TASK], assignedToId: USER }).success, true);
    assert.equal(assignHousekeepingTasksSchema.safeParse({ taskIds: [TASK], assignedToId: null }).success, true);
  });

  it('boş liste ve limit üstü reddedilir', () => {
    assert.equal(assignHousekeepingTasksSchema.safeParse({ taskIds: [], assignedToId: USER }).success, false);
    const tooMany = Array.from({ length: HOUSEKEEPING_MAX_BULK_ASSIGN + 1 }, () => TASK);
    assert.equal(assignHousekeepingTasksSchema.safeParse({ taskIds: tooMany, assignedToId: USER }).success, false);
  });
});

describe('sorun ve kontrol şemaları', () => {
  const version = { expectedUpdatedAt: '2026-10-28T08:00:00.000Z' };

  it('sorun bildirirken not zorunlu', () => {
    assert.equal(reportHousekeepingIssueSchema.safeParse({ ...version, note: '' }).success, false);
    assert.equal(reportHousekeepingIssueSchema.safeParse({ ...version, note: 'Duş başlığı kırık' }).success, true);
  });

  it('kontrol reddinde sebep zorunlu, onayda değil', () => {
    assert.equal(inspectHousekeepingTaskSchema.safeParse({ ...version, passed: false }).success, false);
    assert.equal(inspectHousekeepingTaskSchema.safeParse({ ...version, passed: false, note: 'Banyo yeniden' }).success, true);
    assert.equal(inspectHousekeepingTaskSchema.safeParse({ ...version, passed: true }).success, true);
  });

  it('iptalde sebep zorunlu', () => {
    assert.equal(cancelHousekeepingTaskSchema.safeParse({ ...version, reason: '' }).success, false);
  });
});

describe('liste sorgusu', () => {
  it('filtreler ayrıştırılır', () => {
    const parsed = housekeepingTaskListQuerySchema.parse({
      date: '2026-10-28',
      status: 'PENDING',
      floor: '3',
      onlyIssues: 'true',
    });
    assert.equal(parsed.floor, 3);
    assert.equal(parsed.onlyIssues, true);
  });

  it('geçersiz durum reddedilir', () => {
    assert.equal(housekeepingTaskListQuerySchema.safeParse({ status: 'YANLIS' }).success, false);
  });
});

describe('tip sabitleri', () => {
  it('temizlik tipleri görev tiplerinin alt kümesi', () => {
    for (const type of HOUSEKEEPING_CLEANING_TYPES) assert.ok(HOUSEKEEPING_TASK_TYPES.includes(type));
    assert.ok(!HOUSEKEEPING_CLEANING_TYPES.includes('GUEST_REQUEST'));
  });
});
