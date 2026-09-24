import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MANUAL_TASK_FALLBACK_PERMISSION,
  MANUAL_TASK_KNOWN_MODULES,
  MANUAL_TASK_STATUSES,
  MANUAL_TASK_STATUS_LABELS,
  actorParamSchema,
  actorToggleSchema,
  cancelManualTaskSchema,
  canHandleManualTask,
  completeManualTaskSchema,
  manualTaskActionError,
  manualTaskListQuerySchema,
  manualTaskPermission,
  manualTaskScope,
} from './actors.js';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_VALUES } from './permissions.js';

/**
 * Manuel görev kuralları: yanlış olursa görev yetkisiz kişiye görünür, iki
 * kişi aynı işi yapar ya da kapanmış görev yeniden açılır.
 */

describe('manuel görev kimi ilgilendirir', () => {
  it('modülüne göre izne gider; bilinmeyen modül ayar yönetimine düşer', () => {
    assert.equal(manualTaskPermission('Oda atama'), 'rooms.operate');
    assert.equal(manualTaskPermission('Misafir mesajları'), 'messages.reply');
    assert.equal(manualTaskPermission('Başka'), MANUAL_TASK_FALLBACK_PERMISSION);
  });

  it('yönetici her şeyi görür', () => {
    const scope = manualTaskScope(PERMISSION_VALUES);
    assert.equal(scope.all, true);
    assert.equal(scope.empty, false);
  });

  it('ön büro yalnızca kendi modüllerini görür, bilinmeyen modülü görmez', () => {
    const scope = manualTaskScope(DEFAULT_ROLE_PERMISSIONS.FRONT_DESK);
    assert.equal(scope.all, false);
    assert.equal(scope.others, false);
    assert.deepEqual([...scope.modules].sort(), ['Misafir mesajları', 'Oda atama', 'Rezervasyon']);
  });

  it('muhasebe hiçbir görevi görmez (boş kapsam)', () => {
    const scope = manualTaskScope(DEFAULT_ROLE_PERMISSIONS.ACCOUNTING);
    assert.equal(scope.empty, true);
  });

  it('görevi kapatabilmek aynı izne bağlı', () => {
    assert.equal(canHandleManualTask(['rooms.operate'], 'Oda atama'), true);
    assert.equal(canHandleManualTask(['rooms.operate'], 'Rezervasyon'), false);
    assert.equal(canHandleManualTask([], 'Oda atama'), false);
    assert.equal(canHandleManualTask(null, 'Oda atama'), false);
  });

  it('bilinen her modülün izni katalogda var', () => {
    for (const module of MANUAL_TASK_KNOWN_MODULES) {
      assert.ok(PERMISSION_VALUES.includes(manualTaskPermission(module)), module);
    }
  });

  it('her durumun Türkçe adı var', () => {
    for (const status of MANUAL_TASK_STATUSES) assert.ok(MANUAL_TASK_STATUS_LABELS[status], status);
  });
});

describe('manuel görev işlemleri', () => {
  const me = 'u-me';
  const other = 'u-other';

  it('kapanmış görevde hiçbir işlem yapılamaz', () => {
    for (const status of ['DONE', 'CANCELLED']) {
      for (const action of ['claim', 'release', 'complete', 'cancel']) {
        assert.equal(manualTaskActionError({ status, assignedTo: me }, action, me)?.code, 'TASK_CLOSED', `${status}/${action}`);
      }
    }
  });

  it('başkasının üstlendiği görev üstlenilemez ama tamamlanabilir', () => {
    const task = { status: 'IN_PROGRESS', assignedTo: other };
    assert.equal(manualTaskActionError(task, 'claim', me)?.code, 'TASK_CLAIMED');
    assert.equal(manualTaskActionError(task, 'complete', me), null);
    assert.equal(manualTaskActionError(task, 'cancel', me), null);
  });

  it('kendi üstlendiğini yeniden üstlenmek sorun değil (idempotent)', () => {
    assert.equal(manualTaskActionError({ status: 'IN_PROGRESS', assignedTo: me }, 'claim', me), null);
  });

  it('görevi yalnızca üstlenen bırakır; üstlenilmemiş görev bırakılamaz', () => {
    assert.equal(manualTaskActionError({ status: 'IN_PROGRESS', assignedTo: me }, 'release', me), null);
    assert.equal(manualTaskActionError({ status: 'IN_PROGRESS', assignedTo: other }, 'release', me)?.code, 'TASK_CLAIMED');
    assert.equal(manualTaskActionError({ status: 'PENDING', assignedTo: null }, 'release', me)?.code, 'TASK_NOT_CLAIMED');
    assert.equal(manualTaskActionError({ status: 'IN_PROGRESS', assignedTo: me }, 'release', null)?.code, 'TASK_CLAIMED');
  });

  it('bekleyen görev üstlenilir, tamamlanır, iptal edilir', () => {
    const task = { status: 'PENDING', assignedTo: null };
    for (const action of ['claim', 'complete', 'cancel']) assert.equal(manualTaskActionError(task, action, me), null, action);
  });
});

describe('şemalar', () => {
  it('aktör adı bildirgedeki biçimde olmalı', () => {
    assert.equal(actorParamSchema.safeParse({ name: 'room-worker' }).success, true);
    assert.equal(actorParamSchema.safeParse({ name: 'Room Worker' }).success, false);
    assert.equal(actorParamSchema.safeParse({ name: '../etc' }).success, false);
    assert.equal(actorParamSchema.safeParse({ name: 'a' }).success, false);
  });

  it('gerekçe isteğe bağlı ama sınırlı', () => {
    assert.equal(actorToggleSchema.safeParse({}).success, true);
    assert.equal(actorToggleSchema.safeParse({ note: 'x'.repeat(301) }).success, false);
  });

  it('"gerek kalmadı" gerekçesiz olmaz; tamamlama notu isteğe bağlı', () => {
    assert.equal(cancelManualTaskSchema.safeParse({ reason: '   ' }).success, false);
    assert.equal(cancelManualTaskSchema.safeParse({}).success, false);
    assert.equal(cancelManualTaskSchema.safeParse({ reason: 'Rezervasyon iptal oldu' }).success, true);
    assert.equal(completeManualTaskSchema.safeParse({}).success, true);
    assert.equal(completeManualTaskSchema.safeParse({ note: 'x'.repeat(501) }).success, false);
  });

  it('liste sorgusu varsayılanları ve sınırları', () => {
    const parsed = manualTaskListQuerySchema.parse({});
    assert.equal(parsed.view, 'OPEN');
    assert.equal(parsed.limit, 30);
    assert.equal(manualTaskListQuerySchema.safeParse({ limit: '101' }).success, false);
    assert.equal(manualTaskListQuerySchema.safeParse({ view: 'ALL' }).success, false);
    assert.equal(manualTaskListQuerySchema.safeParse({ actor: 'DROP TABLE' }).success, false);
  });
});
