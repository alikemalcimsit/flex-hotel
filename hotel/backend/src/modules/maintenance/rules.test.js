import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodePhoto, isPlanDue, photoKeys } from './rules.js';

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

describe('maintenance rules', () => {
  describe('isPlanDue', () => {
    it('hiç üretilmemişse (lastRunOn yok) vadesi gelmiştir', () => {
      assert.equal(isPlanDue({ lastRunOn: null, intervalDays: 30, active: true }, day('2026-11-10')), true);
    });

    it('periyot dolmadıysa vadesi gelmemiştir', () => {
      assert.equal(isPlanDue({ lastRunOn: day('2026-11-01'), intervalDays: 30, active: true }, day('2026-11-10')), false);
    });

    it('periyot (gün) dolduysa vadesi gelmiştir', () => {
      assert.equal(isPlanDue({ lastRunOn: day('2026-10-01'), intervalDays: 30, active: true }, day('2026-11-10')), true);
    });

    it('tam periyot gününde vadesi gelmiştir', () => {
      assert.equal(isPlanDue({ lastRunOn: day('2026-10-11'), intervalDays: 30, active: true }, day('2026-11-10')), true);
    });

    it('pasif plan asla vadesi gelmez', () => {
      assert.equal(isPlanDue({ lastRunOn: null, intervalDays: 1, active: false }, day('2026-11-10')), false);
    });
  });

  describe('decodePhoto', () => {
    it('bozuk base64 hata döner', () => {
      const result = decodePhoto({ contentType: 'image/jpeg', image: '!!!not base64!!!', thumbnail: 'AAAA' });
      assert.ok('error' in result);
    });

    it('boş veri hata döner', () => {
      const result = decodePhoto({ contentType: 'image/jpeg', image: '', thumbnail: '' });
      assert.ok('error' in result);
    });
  });

  describe('photoKeys', () => {
    it('otel klasörü + uzantı üretir', () => {
      const keys = photoKeys({ id: 'abc', hotelId: 'h1', contentType: 'image/webp' });
      assert.equal(keys.full, 'maintenance/h1/abc.webp');
      assert.equal(keys.thumb, 'maintenance/h1/abc.thumb.webp');
    });

    it('bilinmeyen tür hata atar', () => {
      assert.throws(() => photoKeys({ id: 'x', hotelId: 'h', contentType: 'image/gif' }));
    });
  });
});
