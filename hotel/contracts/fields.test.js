import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from './locale.js';
import { dateField, isoDayField } from './fields.js';

const messageOf = (result) => result.error?.issues[0]?.message;

describe('dateField', () => {
  it('takvimde olmayan günü 3 Mart\'a kaydırmadan reddeder', () => {
    for (const value of [
      '2026-02-31',
      '2026-02-31T10:00:00Z',
      '2026-02-31T10:00:00.000+03:00',
      '2026-02-31 10:00',
      ' 2026-02-31',
      '2026-02-29',
      '2026-04-31',
    ]) {
      const result = dateField.safeParse(value);
      assert.equal(result.success, false, value);
      assert.equal(messageOf(result), 'Geçersiz tarih', value);
    }
  });

  it('gerçek günü UTC gün başına çevirir; artık yılda 29 Şubat geçer', () => {
    assert.equal(dateField.parse('2026-02-28').toISOString(), '2026-02-28T00:00:00.000Z');
    assert.equal(dateField.parse('2028-02-29').toISOString(), '2028-02-29T00:00:00.000Z');
  });

  it('ISO damgası ve Date nesnesi eskisi gibi geçer', () => {
    assert.equal(dateField.parse('2026-10-20T10:00:00Z').toISOString(), '2026-10-20T10:00:00.000Z');
    // Ofsetli damga ofsetle çözülür; yerel gün (20) geçerli olduğu sürece UTC'de güne taşması sorun değil.
    assert.equal(dateField.parse('2026-10-20T01:30:00+03:00').toISOString(), '2026-10-19T22:30:00.000Z');
    const date = new Date('2026-10-20T08:15:00Z');
    assert.equal(dateField.parse(date), date);
  });

  it('boş metin ve çözülemeyen metin ayrı mesajla reddedilir', () => {
    assert.equal(messageOf(dateField.safeParse('')), 'Tarih seçin');
    assert.equal(messageOf(dateField.safeParse('2026-13-01')), 'Geçersiz tarih');
    assert.equal(messageOf(dateField.safeParse('yarın')), 'Geçersiz tarih');
    assert.equal(dateField.safeParse(new Date(Number.NaN)).success, false);
  });

  it('geçersiz gün durdurucudur: dönem denetimi bozuk tarih görmez', () => {
    let periodChecks = 0;
    const schema = z.object({ from: dateField, to: dateField }).superRefine(() => {
      periodChecks += 1;
    });
    const result = schema.safeParse({ from: '2026-02-31', to: '2026-03-05' });
    assert.equal(result.success, false);
    assert.deepEqual(result.error.issues[0].path, ['from']);
    assert.equal(periodChecks, 0);
  });
});

describe('isoDayField', () => {
  it('yalnızca takvimde olan "YYYY-AA-GG" metnini olduğu gibi geçirir', () => {
    assert.equal(isoDayField.parse('2028-02-29'), '2028-02-29');
    assert.equal(messageOf(isoDayField.safeParse('2026-02-29')), 'Tarih geçersiz');
    assert.equal(messageOf(isoDayField.safeParse('2026-02-28T10:00:00Z')), 'Tarih YYYY-AA-GG biçiminde olmalı');
  });
});
