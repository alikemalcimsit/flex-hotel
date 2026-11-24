import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { askReportQuestionSchema, autoGroupBy, rangeLabel, reportAnswerSchema, reportSpecSchema, resolvePeriod, resolveReportSpec } from './report-chat.js';

const TODAY = '2026-11-16'; // pazartesi
const spec = (overrides) => reportSpecSchema.parse({ report: 'OCCUPANCY', period: 'LAST_MONTH', ...overrides });

describe('göreli dönem', () => {
  test('haftalar pazartesi başlar; aylar takvim ayıdır; yıl dönümü doğru', () => {
    assert.deepEqual(resolvePeriod('THIS_WEEK', '2026-11-19'), { from: '2026-11-16', to: '2026-11-22' });
    assert.deepEqual(resolvePeriod('LAST_WEEK', TODAY), { from: '2026-11-09', to: '2026-11-15' });
    assert.deepEqual(resolvePeriod('LAST_MONTH', TODAY), { from: '2026-10-01', to: '2026-10-31' });
    assert.deepEqual(resolvePeriod('LAST_MONTH', '2026-01-05'), { from: '2025-12-01', to: '2025-12-31' });
    assert.deepEqual(resolvePeriod('NEXT_MONTH', '2026-12-20'), { from: '2027-01-01', to: '2027-01-31' });
    assert.deepEqual(resolvePeriod('THIS_MONTH', '2028-02-10'), { from: '2028-02-01', to: '2028-02-29' });
    assert.deepEqual(resolvePeriod('LAST_7_DAYS', TODAY), { from: '2026-11-10', to: TODAY });
    assert.deepEqual(resolvePeriod('NEXT_30_DAYS', TODAY), { from: TODAY, to: '2026-12-15' });
  });

  test('gruplama dönem uzunluğundan: ≤ 31 gün gün, ≤ 120 gün hafta, üstü ay', () => {
    assert.equal(autoGroupBy('2026-10-01', '2026-10-31'), 'DAY');
    assert.equal(autoGroupBy('2026-08-01', '2026-10-31'), 'WEEK');
    assert.equal(autoGroupBy('2026-01-01', '2026-12-31'), 'MONTH');
    assert.equal(rangeLabel('2026-10-01', '2026-10-31'), '1 Eki – 31 Eki 2026');
    assert.equal(rangeLabel('2025-12-29', '2026-01-04'), '29 Ara 2025 – 4 Oca 2026');
  });
});

describe('rapor tanımı → araç çağrısı', () => {
  test('"geçen ayın haftalık doluluğu" → get_occupancy, geçen ayın günleri, haftalık', () => {
    const resolved = resolveReportSpec(spec({ groupBy: 'WEEK' }), TODAY);
    assert.deepEqual(resolved, { tool: 'get_occupancy', input: { from: '2026-10-01', to: '2026-10-31', groupBy: 'WEEK' }, periodLabel: 'Geçen ay (1 Eki – 31 Eki 2026)' });
    // Kayıtlı rapor bir ay sonra çalışınca dönem kayar.
    assert.equal(resolveReportSpec(spec({ groupBy: 'WEEK' }), '2026-12-03').input.from, '2026-11-01');
  });

  test('kırılım, tahmin ve bütçe sapması kendi araçlarına gider', () => {
    assert.deepEqual(resolveReportSpec(spec({ report: 'REVENUE_BY_SOURCE', period: 'THIS_YEAR' }), TODAY).input, { report: 'revenue_by_source', from: '2026-01-01', to: '2026-12-31', groupBy: 'DAY' });
    assert.deepEqual(resolveReportSpec(spec({ report: 'FORECAST', period: 'NEXT_7_DAYS' }), TODAY).input, { days: 7 });
    assert.deepEqual(resolveReportSpec(spec({ report: 'FORECAST', period: 'NEXT_90_DAYS' }), TODAY).input, { days: 30 });
    assert.deepEqual(resolveReportSpec(spec({ report: 'BUDGET_VARIANCE', period: 'LAST_MONTH' }), TODAY).input, { year: 2026, month: 10, scope: 'MONTH' });
    assert.deepEqual(resolveReportSpec(spec({ report: 'BUDGET_VARIANCE', period: 'THIS_YEAR' }), TODAY).input, { year: 2026, month: 11, scope: 'YTD' });
    assert.deepEqual(resolveReportSpec(spec({ report: 'BUDGET_VARIANCE', period: 'LAST_YEAR' }), TODAY).input, { year: 2025, month: 12, scope: 'YTD' });
    assert.equal(resolveReportSpec(spec({ report: 'REVENUE', period: 'CUSTOM', from: '2026-03-01', to: '2026-03-10' }), TODAY).periodLabel, '1 Mar – 10 Mar 2026');
  });

  test('şemalar: sabit aralık tarih ister; boş alanlar null olur; soru sınırlı', () => {
    assert.equal(reportSpecSchema.safeParse({ report: 'REVENUE', period: 'CUSTOM' }).success, false);
    assert.equal(reportSpecSchema.safeParse({ report: 'REVENUE', period: 'CUSTOM', from: '2026-03-10', to: '2026-03-01' }).success, false);
    assert.equal(reportSpecSchema.safeParse({ report: 'SALES', period: 'TODAY' }).success, false);
    assert.deepEqual(spec({}), { report: 'OCCUPANCY', period: 'LAST_MONTH', from: null, to: null, groupBy: null, forecastDays: null, budgetScope: null });
    const answer = reportAnswerSchema.parse({ title: 'Ekim doluluğu', comment: 'x'.repeat(2000), spec: { report: 'OCCUPANCY', period: 'LAST_MONTH' }, chart: { type: 'LINE', series: ['occupancyPct'] } });
    assert.equal(answer.comment.length, 800);
    assert.equal(askReportQuestionSchema.safeParse({ question: 'ok' }).success, false);
    assert.equal(askReportQuestionSchema.parse({ question: 'Geçen ayın doluluğu' }).followUpOfId, null);
  });
});
