import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toFieldErrors } from './fields.js';
import {
  assignableRoomsQuerySchema,
  blockListQuerySchema,
  blockRoomSchema,
  housekeepingTransitionError,
  roomListQuerySchema,
  setHousekeepingStatusSchema,
} from './rooms.js';

/**
 * Oda sözleşmeleri sunucunun ve panelin ortak kuralı. Buradaki bir hata ya
 * kat şefinin denetimini atlatır ya da "false" gönderen ekranı "true" okur —
 * ikisi de ekranda sessizce yanlış sonuç olarak görünür.
 */

describe('housekeepingTransitionError — kat hizmeti geçişleri', () => {
  it('temiz odayı kontrol edildi yapmaya izin verir', () => {
    assert.equal(housekeepingTransitionError('CLEAN', 'INSPECTED'), null);
  });

  it('kirli odaya "kontrol edildi" denemez (denetim atlanamaz)', () => {
    assert.match(housekeepingTransitionError('DIRTY', 'INSPECTED'), /önce oda temizlenmeli/);
  });

  it('temizlenmekte olan odaya da "kontrol edildi" denemez', () => {
    assert.match(housekeepingTransitionError('CLEANING', 'INSPECTED'), /Temizleniyor/);
  });

  it('oda her durumdan yeniden kirlenebilir', () => {
    for (const from of ['CLEANING', 'CLEAN', 'INSPECTED']) {
      assert.equal(housekeepingTransitionError(from, 'DIRTY'), null, `${from} → DIRTY`);
    }
  });

  it('kirli odayı temizlemeye başlamak ve bitirmek serbest', () => {
    assert.equal(housekeepingTransitionError('DIRTY', 'CLEANING'), null);
    assert.equal(housekeepingTransitionError('CLEANING', 'CLEAN'), null);
    assert.equal(housekeepingTransitionError('DIRTY', 'CLEAN'), null);
  });

  it('aynı durum geçiş sayılmaz', () => {
    assert.equal(housekeepingTransitionError('DIRTY', 'DIRTY'), null);
  });

  it('bilinmeyen hedef durumu reddeder', () => {
    assert.ok(housekeepingTransitionError('CLEAN', 'AVAILABLE'));
  });
});

describe('setHousekeepingStatusSchema', () => {
  it('eski tek listeli durumları (AVAILABLE, OCCUPIED) kabul etmez', () => {
    for (const status of ['AVAILABLE', 'OCCUPIED', 'BLOCKED']) {
      const result = setHousekeepingStatusSchema.safeParse({ status, expectedUpdatedAt: '2026-09-16T10:00:00Z' });
      assert.equal(result.success, false, status);
    }
  });
});

describe('blockRoomSchema', () => {
  const valid = { type: 'OUT_OF_ORDER', startDate: '2026-10-15', endDate: '2026-10-18', reason: 'Su basması' };

  it('tip zorunludur — arızalı ile hizmet dışının etkisi farklı', () => {
    const { type, ...withoutType } = valid;
    const result = blockRoomSchema.safeParse(withoutType);
    assert.equal(result.success, false);
    assert.match(toFieldErrors(result.error).type, /Arızalı \/ Hizmet dışı/);
  });

  it('süresiz blok kabul edilir', () => {
    assert.equal(blockRoomSchema.safeParse({ ...valid, endDate: null }).success, true);
  });

  it('bitiş başlangıçla aynı gün olamaz', () => {
    const result = blockRoomSchema.safeParse({ ...valid, endDate: '2026-10-15' });
    assert.equal(result.success, false);
  });
});

describe('sorgu dizesi ayrıştırma', () => {
  it('"false" metni false okunur (coerce.boolean hatası tekrarlanmasın)', () => {
    assert.equal(assignableRoomsQuerySchema.parse({ includeOtherTypes: 'false' }).includeOtherTypes, false);
    assert.equal(assignableRoomsQuerySchema.parse({ includeOtherTypes: 'true' }).includeOtherTypes, true);
    assert.equal(assignableRoomsQuerySchema.parse({}).includeOtherTypes, false);
  });

  it('anlamsız evet/hayır değerini reddeder', () => {
    assert.equal(assignableRoomsQuerySchema.safeParse({ includeOtherTypes: 'belki' }).success, false);
  });

  it('boş kat filtresi 0 değil "filtre yok" demektir', () => {
    assert.equal(roomListQuerySchema.parse({ floor: '' }).floor, undefined);
    assert.equal(roomListQuerySchema.parse({ floor: '3' }).floor, 3);
  });

  it('eski durum filtresi yerine iki ayrı filtre kullanılır', () => {
    const parsed = roomListQuerySchema.parse({ occupancy: 'OCCUPIED', housekeepingStatus: 'DIRTY' });
    assert.equal(parsed.occupancy, 'OCCUPIED');
    assert.equal(parsed.housekeepingStatus, 'DIRTY');
  });

  it('blok listesi varsayılan olarak sürenleri ve gelecektekileri gösterir', () => {
    assert.equal(blockListQuerySchema.parse({}).scope, 'ACTIVE');
  });
});
