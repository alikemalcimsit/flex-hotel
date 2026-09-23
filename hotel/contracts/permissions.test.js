import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  PERMISSION_VALUES,
  ROLES,
  ROLE_LABELS,
  defaultPermissionsForRole,
} from './permissions.js';

/**
 * İzin kataloğu sunucu ve tarayıcının tek kaynağı. Bir izin etiketsiz kalırsa
 * ya da gruplardan düşerse matris ekranı sessizce eksik render eder; ADMIN
 * varsayılanı eksik olursa yönetici kendi ekranından kilitlenebilir.
 */
describe('izin kataloğu', () => {
  it('her iznin Türkçe etiketi var', () => {
    for (const permission of PERMISSION_VALUES) {
      assert.ok(PERMISSION_LABELS[permission], `etiket eksik: ${permission}`);
    }
  });

  it('her rolün Türkçe etiketi var', () => {
    for (const role of ROLES) assert.ok(ROLE_LABELS[role], `rol etiketi eksik: ${role}`);
  });

  it('PERMISSION_GROUPS tüm izinleri tam bir kez içerir', () => {
    const grouped = PERMISSION_GROUPS.flatMap((group) => group.permissions);
    assert.equal(grouped.length, PERMISSION_VALUES.length, 'gruplarda tekrar ya da eksik izin var');
    assert.deepEqual([...grouped].sort(), [...PERMISSION_VALUES].sort());
  });

  it('ADMIN varsayılanı tüm izinleri kapsar', () => {
    assert.deepEqual([...DEFAULT_ROLE_PERMISSIONS.ADMIN].sort(), [...PERMISSION_VALUES].sort());
  });

  it('defaultPermissionsForRole bilinmeyen rolde boş döner', () => {
    assert.deepEqual(defaultPermissionsForRole('YOK'), []);
    assert.deepEqual(defaultPermissionsForRole(undefined), []);
  });

  it('kat görevlisi istek izinleri alır ama mesaj/kullanıcı izni almaz', () => {
    const housekeeping = defaultPermissionsForRole('HOUSEKEEPING');
    assert.ok(housekeeping.includes(PERMISSIONS.REQUESTS_MANAGE));
    assert.ok(!housekeeping.includes(PERMISSIONS.MESSAGES_REPLY));
    assert.ok(!housekeeping.includes(PERMISSIONS.USERS_MANAGE));
  });

  it('yalnızca ADMIN varsayılanı kullanıcı/rol yönetimi izni taşır', () => {
    for (const role of ROLES) {
      if (role === 'ADMIN') continue;
      assert.ok(!defaultPermissionsForRole(role).includes(PERMISSIONS.ROLES_MANAGE), `${role} roles.manage almamalı`);
    }
  });
});
