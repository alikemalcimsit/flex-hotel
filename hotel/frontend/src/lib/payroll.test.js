import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePeriod, periodOptions } from './payrollPeriod.js';

describe('bordro dönem seçicisi', () => {
  it('gelecek ay + son 24 ay; yıl dönümünü doğru geçer', () => {
    const options = periodOptions('2026-01-15');
    assert.equal(options.length, 26);
    assert.deepEqual(options[0], { value: '2026-02', label: 'Şubat 2026', year: 2026, month: 2 });
    assert.deepEqual(options[1], { value: '2026-01', label: 'Ocak 2026', year: 2026, month: 1 });
    assert.deepEqual(options[2], { value: '2025-12', label: 'Aralık 2025', year: 2025, month: 12 });
    assert.equal(options.at(-1).value, '2024-01');
    assert.equal(periodOptions('2026-12-31')[0].value, '2027-01');
  });

  it('"2026-03" → yıl ve ay', () => {
    assert.deepEqual(parsePeriod('2026-03'), { year: 2026, month: 3 });
  });
});
