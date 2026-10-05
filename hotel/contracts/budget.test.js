import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BUDGET_SYSTEM_CODES,
  budgetVarianceQuerySchema,
  budgetYearError,
  reviseBudgetSchema,
  saveBudgetLinesSchema,
  saveExpenseActualsSchema,
  varianceTone,
} from './budget.js';

const stamp = '2026-10-05T09:00:00.000Z';
const empty = () => Array.from({ length: 12 }, () => null);

describe('bütçe kuralları', () => {
  it('sapmanın yönü: gelir ve hedefte fazlası iyi, giderde fazlası kötü; sıfır nötr', () => {
    assert.equal(varianceTone('REVENUE', 10), 'GOOD');
    assert.equal(varianceTone('KPI', -1), 'BAD');
    assert.equal(varianceTone('CASH', 5), 'GOOD');
    assert.equal(varianceTone('EXPENSE', 10), 'BAD');
    assert.equal(varianceTone('EXPENSE', -10), 'GOOD');
    assert.equal(varianceTone('REVENUE', 0), 'NEUTRAL');
    assert.equal(varianceTone('REVENUE', Number.NaN), 'NEUTRAL');
  });

  it('yıl: 2000 ve sonrası, en fazla 5 yıl ileri', () => {
    assert.equal(budgetYearError(2026, 2026), null);
    assert.equal(budgetYearError(2031, 2026), null);
    assert.match(budgetYearError(2032, 2026), /5 yıl/);
    assert.match(budgetYearError(1999, 2026), /2000/);
  });

  it('sistem kalemleri sabit ve tekil', () => {
    assert.equal(new Set(BUDGET_SYSTEM_CODES).size, BUDGET_SYSTEM_CODES.length);
    assert.ok(BUDGET_SYSTEM_CODES.includes('ROOM_REVENUE') && BUDGET_SYSTEM_CODES.includes('OCCUPANCY'));
  });
});

describe('bütçe şemaları', () => {
  it('satırlar: boş hücre planlanmadı; para 2 ondalık, doluluk 0–100 bir ondalık; hata ay adıyla', () => {
    const months = empty();
    months[0] = '1500.5';
    months[1] = '';
    const parsed = saveBudgetLinesSchema.parse({ expectedUpdatedAt: stamp, lines: [{ item: 'ROOM_REVENUE', months }] });
    assert.deepEqual(parsed.lines[0].months.slice(0, 3), ['1500.5', null, null]);

    const occupancy = empty();
    occupancy[2] = '100.5';
    const bad = saveBudgetLinesSchema.safeParse({ expectedUpdatedAt: stamp, lines: [{ item: 'OCCUPANCY', months: occupancy }] });
    assert.equal(bad.success, false);
    assert.deepEqual(bad.error.issues[0].path, ['lines', 0, 'months', 2]);
    assert.match(bad.error.issues[0].message, /^Mart:/);

    const money = empty();
    money[0] = '-5';
    assert.equal(saveBudgetLinesSchema.safeParse({ expectedUpdatedAt: stamp, lines: [{ item: 'ADR', months: money }] }).success, false, 'eksi tutar yok');
  });

  it('satırlar: 12 ay zorunlu, aynı kalem iki kez olmaz, sürüm damgası zorunlu', () => {
    assert.equal(saveBudgetLinesSchema.safeParse({ expectedUpdatedAt: stamp, lines: [{ item: 'ROOM_REVENUE', months: [null] }] }).success, false);
    const twice = saveBudgetLinesSchema.safeParse({ expectedUpdatedAt: stamp, lines: [{ item: 'FNB_REVENUE', months: empty() }, { item: 'FNB_REVENUE', months: empty() }] });
    assert.equal(twice.success, false);
    assert.match(twice.error.issues[0].message, /iki kez/);
    assert.equal(saveBudgetLinesSchema.safeParse({ lines: [] }).success, false);
  });

  it('gerçekleşen gider: ay 1–12, boş = sil, en az bir değer; revize gerekçesi 5+ karakter; sapma sorgusu varsayılan ay kapsamı', () => {
    const itemId = '11111111-1111-4111-8111-111111111111';
    assert.equal(saveExpenseActualsSchema.parse({ year: 2026, entries: [{ itemId, month: 9, amount: '' }] }).entries[0].amount, null);
    assert.equal(saveExpenseActualsSchema.safeParse({ year: 2026, entries: [{ itemId, month: 13, amount: '1' }] }).success, false);
    assert.equal(saveExpenseActualsSchema.safeParse({ year: 2026, entries: [] }).success, false);
    assert.equal(reviseBudgetSchema.safeParse({ reason: 'kısa' }).success, false);
    assert.equal(reviseBudgetSchema.parse({ reason: '  Yeni anlaşma  ' }).reason, 'Yeni anlaşma');
    assert.deepEqual(budgetVarianceQuerySchema.parse({ year: '2026', month: '9' }), { year: 2026, month: 9, scope: 'MONTH' });
  });
});
