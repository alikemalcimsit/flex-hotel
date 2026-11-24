import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { chartData, excelRows, fileSlug, formatCell, isTextAnswer, numericValue, specLabel } from './reportChat.js';

const dataset = {
  columns: [
    { key: 'period', label: 'Dönem', kind: 'text' },
    { key: 'occupancyPct', label: 'Doluluk %', kind: 'percent' },
    { key: 'roomRevenue', label: 'Oda geliri', kind: 'money' },
    { key: 'sold', label: 'Satılan oda', kind: 'number' },
  ],
  rows: [
    { period: '1 Eki – 7 Eki', occupancyPct: 74.23, roomRevenue: '125000.50', sold: 1234 },
    { period: '8 Eki – 14 Eki', occupancyPct: null, roomRevenue: 'x', sold: 980 },
  ],
  summary: [{ label: 'Doluluk', value: 71.5, kind: 'percent' }],
  currency: 'TRY',
  notes: ['Plan taslak bütçeden.'],
};

describe('hücre biçimi', () => {
  test('türüne göre: para, yüzde (tek ondalık), sayı, metin; boş "—"', () => {
    assert.equal(formatCell('125000.5', 'money'), '125.000,50');
    assert.equal(formatCell(74.26, 'percent'), '%74,3');
    assert.match(formatCell('2026-11-16', 'date'), /^16 Kas(ım)? 2026$/, 'tasarımcının tarih sütunu (modül 26)');
    assert.equal(formatCell(-3.14, 'percent'), '%-3,1');
    assert.equal(formatCell(1234, 'number'), '1.234');
    assert.equal(formatCell('Booking.com', 'text'), 'Booking.com');
    for (const kind of ['money', 'percent', 'number', 'text']) {
      assert.equal(formatCell(null, kind), '—');
      assert.equal(formatCell('', kind), '—');
    }
    assert.equal(formatCell('abc', 'number'), '—');
  });

  test('sayıya çevirme: para metni sayı olur, geçersiz değer null', () => {
    assert.equal(numericValue('12500.50'), 12500.5);
    assert.equal(numericValue(0), 0);
    assert.equal(numericValue(null), null);
    assert.equal(numericValue('—'), null);
  });
});

describe('grafik verisi', () => {
  test('seriler sayısal sütunlardan; ilk sütun eksen; boş ve geçersiz değer null kalır', () => {
    const data = chartData(dataset, { type: 'LINE', series: ['occupancyPct', 'roomRevenue', 'period', 'yok', 'occupancyPct'] });
    assert.deepEqual(data.labels, ['1 Eki – 7 Eki', '8 Eki – 14 Eki']);
    assert.deepEqual(
      data.series.map((series) => [series.key, series.values]),
      [
        ['occupancyPct', [74.23, null]],
        ['roomRevenue', [125000.5, null]],
      ],
    );
    assert.equal(data.axisKind, 'number', 'farklı türler: genel sayı ekseni');
    assert.equal(chartData(dataset, { type: 'BAR', series: ['occupancyPct'] }).axisKind, 'percent');
  });

  test('tablo tipi, seçilemeyen seri ya da boş tablo grafik çizdirmez', () => {
    assert.equal(chartData(dataset, { type: 'TABLE', series: ['occupancyPct'] }).series.length, 0);
    assert.equal(chartData(dataset, { type: 'BAR', series: ['period'] }).series.length, 0);
    assert.equal(chartData(null, { type: 'BAR', series: ['sold'] }).series.length, 0);
    assert.equal(chartData(dataset, null).series.length, 0);
  });
});

describe('Excel', () => {
  test('başlık, dönem, sütun başlıkları, sayısal hücre sayı; özet ve not altta', () => {
    const rows = excelRows({ title: 'Ekim doluluğu', periodLabel: 'Geçen ay (1 Eki – 31 Eki 2026)', dataset });
    assert.equal(rows[0][0].value, 'Ekim doluluğu');
    assert.equal(rows[1][0].value, 'Geçen ay (1 Eki – 31 Eki 2026)');
    assert.deepEqual(rows[3].map((cell) => cell.value), ['Dönem', 'Doluluk %', 'Oda geliri', 'Satılan oda']);
    assert.deepEqual(rows[4].map((cell) => cell?.value ?? null), ['1 Eki – 7 Eki', 74.23, 125000.5, 1234]);
    assert.equal(rows[4][2].type, Number);
    assert.deepEqual(rows[5].map((cell) => cell?.value ?? null), ['8 Eki – 14 Eki', null, null, 980]);
    assert.deepEqual(rows.at(-2).map((cell) => cell.value), ['Doluluk', 71.5]);
    assert.equal(rows.at(-1)[0].value, 'Plan taslak bütçeden.');
    assert.equal(fileSlug('Ekim doluluğu — haftalık'), 'ekim-dolulugu-haftalik');
    assert.equal(fileSlug('***'), 'rapor');
  });
});

describe('tanım ve cevap', () => {
  test('tanımın okunur adı; metin cevabı tablosuz hazır cevaptır', () => {
    assert.equal(specLabel({ report: 'OCCUPANCY', period: 'LAST_MONTH' }), 'Doluluk · Geçen ay');
    assert.match(specLabel({ report: 'REVENUE', period: 'CUSTOM', from: '2026-03-01', to: '2026-03-10' }), /^Oda geliri, ADR, RevPAR · .+ – .+$/);
    assert.equal(specLabel(null), '');
    assert.equal(isTextAnswer({ status: 'READY', dataset: null }), true);
    assert.equal(isTextAnswer({ status: 'READY', dataset }), false);
    assert.equal(isTextAnswer({ status: 'PENDING', dataset: null }), false);
  });
});
