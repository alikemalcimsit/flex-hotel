import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HOTEL_COPY_GROUPS,
  HOTEL_COPY_GROUP_HINTS,
  HOTEL_COPY_GROUP_LABELS,
  chainHotelCreateSchema,
  chainReportQuerySchema,
  hotelAttachError,
  membershipChangeError,
  roleInHotel,
} from './chain.js';
import { PERMISSIONS } from './permissions.js';

const MANAGER_PERMS = [PERMISSIONS.USERS_MANAGE, PERMISSIONS.USERS_VIEW];
const base = {
  actorId: 'actor',
  actorRole: 'ADMIN',
  actorPermissions: MANAGER_PERMS,
  targetUserId: 'target',
  targetHomeHotelId: 'home',
  hotelId: 'other',
  currentRole: null,
  nextRole: 'FRONT_DESK',
};

describe('zincir sözleşmeleri', () => {
  it('roleInHotel: ana otelde kaydın rolü, diğerinde erişimin rolü, yoksa null', () => {
    const user = { hotelId: 'a', role: 'FRONT_DESK' };
    const memberships = [{ hotelId: 'b', role: 'MANAGER' }];
    assert.equal(roleInHotel(user, memberships, 'a'), 'FRONT_DESK');
    assert.equal(roleInHotel(user, memberships, 'b'), 'MANAGER');
    assert.equal(roleInHotel(user, memberships, 'c'), null);
  });

  describe('membershipChangeError', () => {
    it('yöneticinin kullanıcı yönetme izniyle erişim verilir', () => {
      assert.equal(membershipChangeError(base), null);
      assert.equal(membershipChangeError({ ...base, nextRole: 'ADMIN' }), null);
    });

    it('kendi erişimini değiştiremez', () => {
      assert.match(membershipChangeError({ ...base, targetUserId: 'actor' }), /Kendi otel erişiminizi/);
    });

    it('ana otel erişimle verilmez', () => {
      assert.match(membershipChangeError({ ...base, targetHomeHotelId: 'other' }), /ana oteli/);
    });

    it('hedef otelde rolü ya da kullanıcı yönetme izni olmayan veremez', () => {
      assert.match(membershipChangeError({ ...base, actorRole: null }), /yetkiniz yok/);
      assert.match(membershipChangeError({ ...base, actorRole: 'MANAGER', actorPermissions: [PERMISSIONS.USERS_VIEW] }), /yetkiniz yok/);
    });

    it('yönetici rolünü yalnız yönetici verir ya da yöneticinin erişimini kaldırır', () => {
      const manager = { ...base, actorRole: 'MANAGER' };
      assert.equal(membershipChangeError(manager), null);
      assert.match(membershipChangeError({ ...manager, nextRole: 'ADMIN' }), /Yönetici erişimini/);
      assert.match(membershipChangeError({ ...manager, currentRole: 'ADMIN', nextRole: null }), /Yönetici erişimini/);
      assert.match(membershipChangeError({ ...manager, currentRole: 'ADMIN', nextRole: 'FRONT_DESK' }), /Yönetici erişimini/);
    });
  });

  it('hotelAttachError: zincir yetkisi ve otelde yöneticilik ister', () => {
    assert.equal(hotelAttachError({ roleInHotel: 'ADMIN', canManageChain: true }), null);
    assert.match(hotelAttachError({ roleInHotel: 'ADMIN', canManageChain: false }), /Zinciri yönetme/);
    assert.match(hotelAttachError({ roleInHotel: 'MANAGER', canManageChain: true }), /yalnız o otelin yöneticisi/);
    assert.match(hotelAttachError({ roleInHotel: null, canManageChain: true }), /yalnız o otelin yöneticisi/);
  });

  it('her kopya grubunun etiketi ve açıklaması var', () => {
    for (const group of HOTEL_COPY_GROUPS) {
      assert.ok(HOTEL_COPY_GROUP_LABELS[group], group);
      assert.ok(HOTEL_COPY_GROUP_HINTS[group], group);
    }
  });

  describe('chainHotelCreateSchema', () => {
    const valid = { name: 'Flex Ankara', code: 'ank-01', timezone: 'Europe/Istanbul', currency: 'try', sourceHotelId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' };

    it('kod ve para birimi büyük harfe çevrilir; kopya grupları varsayılan hepsi, tekrar atılır', () => {
      const parsed = chainHotelCreateSchema.parse(valid);
      assert.equal(parsed.code, 'ANK-01');
      assert.equal(parsed.currency, 'TRY');
      assert.deepEqual(parsed.copy, [...HOTEL_COPY_GROUPS]);
      assert.deepEqual(chainHotelCreateSchema.parse({ ...valid, copy: ['TAXES', 'TAXES'] }).copy, ['TAXES']);
      assert.deepEqual(chainHotelCreateSchema.parse({ ...valid, copy: [] }).copy, []);
    });

    it('bozuk kod, para birimi, e-posta ve bilinmeyen grup reddedilir', () => {
      for (const bad of [{ code: 'A' }, { code: 'ANK 01' }, { code: '-ANK' }, { currency: 'TL' }, { email: 'x' }, { copy: ['ROOMS'] }, { sourceHotelId: 'x' }]) {
        assert.equal(chainHotelCreateSchema.safeParse({ ...valid, ...bad }).success, false, JSON.stringify(bad));
      }
    });
  });

  it('chainReportQuerySchema: rapor aralığı kuralı (en fazla 366 gün, bitiş başlangıçtan sonra)', () => {
    assert.equal(chainReportQuerySchema.safeParse({ from: '2026-01-01', to: '2026-12-31' }).success, true);
    assert.equal(chainReportQuerySchema.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success, false);
    assert.equal(chainReportQuerySchema.safeParse({ from: '2025-01-01', to: '2026-12-31' }).success, false);
    assert.equal(chainReportQuerySchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success, false);
  });
});
