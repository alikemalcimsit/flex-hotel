import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDataset, chartFor, compactForModel, periodName } from './datasets.js';

const period = (from, to, occupancyPct, lastYearPct) => ({
  from,
  to,
  days: 7,
  onTheBooksDays: 0,
  sold: 70,
  sellable: 98,
  occupancyPct,
  lastYear: { from, to, sold: 60, sellable: 98, occupancyPct: lastYearPct },
  change: { occupancyPts: lastYearPct === null ? null : Math.round((occupancyPct - lastYearPct) * 10) / 10, sold: 16.7 },
});

const occupancyData = {
  from: '2026-10-01',
  to: '2026-10-31',
  groupBy: 'WEEK',
  totals: { sold: 300, sellable: 434, occupancyPct: 69.1, lastYear: { occupancyPct: 61.2 }, change: { occupancyPts: 7.9 } },
  periods: [period('2026-10-01', '2026-10-04', 71.4, 60), period('2026-10-05', '2026-10-11', 65.3, null)],
};

describe('rapor tabloları', () => {
  it('dönem adı: gün, hafta, ay', () => {
    assert.equal(periodName({ from: '2026-11-16', to: '2026-11-16' }, 'DAY'), '16 Kas');
    assert.equal(periodName({ from: '2026-11-16', to: '2026-11-22' }, 'WEEK'), '16 Kas – 22 Kas');
    assert.equal(periodName({ from: '2026-11-30', to: '2026-11-30' }, 'WEEK'), '30 Kas');
    assert.equal(periodName({ from: '2026-11-01', to: '2026-11-30' }, 'MONTH'), 'Kasım 2026');
  });

  it('doluluk: dönem satırları, geçen yıl, özet; rakamlar araçtan olduğu gibi', () => {
    const dataset = buildDataset('get_occupancy', occupancyData);
    assert.deepEqual(dataset.columns.map((col) => col.key), ['period', 'occupancyPct', 'lastYearOccupancyPct', 'occupancyChangePts', 'sold', 'sellable']);
    assert.deepEqual(dataset.rows[0], { period: '1 Eki – 4 Eki', occupancyPct: 71.4, lastYearOccupancyPct: 60, occupancyChangePts: 11.4, sold: 70, sellable: 98 });
    assert.equal(dataset.rows[1].lastYearOccupancyPct, null);
    assert.deepEqual(dataset.summary[0], { label: 'Doluluk', value: 69.1, kind: 'percent' });
  });

  it('grafik: geçerli sayısal seriler kalır; geçersiz seçimde raporun varsayılanı; tek satırda çizgi sütun olur', () => {
    const dataset = buildDataset('get_occupancy', occupancyData);
    assert.deepEqual(chartFor('get_occupancy', dataset, { type: 'BAR', series: ['sold', 'period', 'yok', 'sold'] }), { type: 'BAR', series: ['sold'] });
    assert.deepEqual(chartFor('get_occupancy', dataset, { type: 'LINE', series: ['yok'] }), { type: 'LINE', series: ['occupancyPct', 'lastYearOccupancyPct'] });
    assert.deepEqual(chartFor('get_occupancy', dataset, null), { type: 'LINE', series: ['occupancyPct', 'lastYearOccupancyPct'] });
    assert.deepEqual(chartFor('get_occupancy', dataset, { type: 'TABLE', series: ['sold'] }), { type: 'TABLE', series: [] });
    const single = { ...dataset, rows: dataset.rows.slice(0, 1) };
    assert.equal(chartFor('get_occupancy', single, { type: 'LINE', series: ['sold'] }).type, 'BAR');
  });

  it('bütçe sapması: toplamlar önde, en büyük sapmalar ardından; notlar taşınır', () => {
    const money = (plan, actual) => ({ plan, actual, difference: String(Number(actual) - Number(plan)), differencePct: 10, tone: 'GOOD' });
    const dataset = buildDataset('explain_variance', {
      currency: 'TRY',
      totals: { revenue: money('100', '110'), expense: money('50', '55'), gop: money('50', '55') },
      topVariances: [{ item: 'ROOM_REVENUE', label: 'Oda geliri', ...money('80', '90') }],
      notes: ['Plan taslak.'],
    });
    assert.deepEqual(dataset.rows.map((row) => row.item), ['Toplam gelir', 'Toplam gider', 'Brüt faaliyet kârı', 'Oda geliri']);
    assert.deepEqual(dataset.notes, ['Plan taslak.']);
  });

  it('modele giden özet: sütunlar bir kez, satırlar dizi; çok satırda baştan ve sondan', () => {
    const dataset = buildDataset('get_occupancy', { ...occupancyData, periods: Array.from({ length: 10 }, (_, index) => period(`2026-10-${String(index + 1).padStart(2, '0')}`, `2026-10-${String(index + 1).padStart(2, '0')}`, index, null)) });
    const compact = compactForModel(dataset, 4);
    assert.equal(compact.rows.length, 4);
    assert.equal(compact.omittedRows, 6);
    assert.deepEqual(compact.rows.map((row) => row[1]), [0, 1, 8, 9]);
    assert.equal(compact.columns[1], 'occupancyPct (Doluluk %)');
  });
});
