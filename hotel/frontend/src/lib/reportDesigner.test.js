import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reportDesignSchema } from '@hotelos/hotel-contracts';
import { aggregateLabel, defaultFilter, designPayload, designReducer, designSummary, designerChart, emptyDesign, groupDesignErrors, sortOptions, withOperator } from './reportDesigner.js';

/** Eylemleri sırayla uygular. */
const apply = (design, ...actions) => actions.reduce(designReducer, design);

describe('rapor tasarımcısı (modül 26)', () => {
  it('sütun ekle / çıkar / taşı; kaynak değişince tasarım sıfırlanır (satır sınırı kalır)', () => {
    let design = apply(emptyDesign('RESERVATIONS'), { type: 'TOGGLE_COLUMN', key: 'source' }, { type: 'TOGGLE_COLUMN', key: 'totalPrice' }, { type: 'TOGGLE_COLUMN', key: 'checkIn' });
    design = designReducer(design, { type: 'MOVE_COLUMN', from: 2, to: 0 });
    assert.deepEqual(design.columns, ['checkIn', 'source', 'totalPrice']);
    assert.deepEqual(designReducer(design, { type: 'MOVE_COLUMN', from: 0, to: 5 }).columns, design.columns, 'sınır dışı taşıma yok sayılır');
    design = designReducer(design, { type: 'SET_LIMIT', limit: 250 });
    const switched = designReducer(design, { type: 'SET_SOURCE', source: 'GUESTS' });
    assert.deepEqual([switched.source, switched.columns, switched.limit], ['GUESTS', [], 250]);
    assert.equal(designReducer(design, { type: 'SET_SOURCE', source: 'RESERVATIONS' }), design, 'aynı kaynak değişmez');
  });

  it('gruplama ilk açılışta adet ekler; toplam sütunu sayısaldır; sıralama artık olmayan anahtardan temizlenir', () => {
    let design = apply(emptyDesign('RESERVATIONS'), { type: 'TOGGLE_COLUMN', key: 'source' }, { type: 'SET_GROUPED', grouped: true }, { type: 'ADD_AGGREGATE' });
    assert.deepEqual(design.aggregates, [{ fn: 'COUNT', column: null }, { fn: 'SUM', column: 'nights' }]);
    design = designReducer(design, { type: 'UPDATE_AGGREGATE', index: 1, patch: { column: 'totalPrice' } });
    assert.deepEqual(sortOptions(design).map((option) => option.value), ['source', 'COUNT', 'SUM:totalPrice']);
    design = apply(design, { type: 'ADD_SORT' }, { type: 'UPDATE_SORT', index: 0, patch: { key: 'SUM:totalPrice', dir: 'DESC' } });
    assert.equal(aggregateLabel('RESERVATIONS', design.aggregates[1]), 'Toplam · Tutar');
    design = designReducer(design, { type: 'REMOVE_AGGREGATE', index: 1 });
    assert.deepEqual(design.sort, [], 'kaldırılan toplamın sıralaması düşer');
    assert.equal(reportDesignSchema.safeParse(designPayload(design)).success, true);
  });

  it('filtre: türe göre varsayılan; işleç değişince ilgisiz değerler temizlenir; boş metin null gider', () => {
    assert.deepEqual(defaultFilter({ key: 'checkIn', type: 'date' }), { column: 'checkIn', op: 'PERIOD', value: null, valueTo: null, values: [], period: 'THIS_MONTH' });
    assert.equal(defaultFilter({ key: 'status', type: 'enum' }).op, 'IN');
    const between = withOperator(defaultFilter({ key: 'checkIn', type: 'date' }), 'BETWEEN');
    assert.deepEqual([between.period, between.value, between.valueTo], [null, '', '']);
    let design = apply(emptyDesign('RESERVATIONS'), { type: 'TOGGLE_COLUMN', key: 'confirmationCode' }, { type: 'ADD_FILTER' });
    assert.equal(design.filters[0].column, 'confirmationCode');
    design = apply(design, { type: 'SET_FILTER_COLUMN', index: 0, column: 'totalPrice' }, { type: 'UPDATE_FILTER', index: 0, patch: { value: '' } });
    assert.equal(designPayload(design).filters[0].value, null);
    design = designReducer(design, { type: 'UPDATE_FILTER', index: 0, patch: { value: '1500' } });
    assert.equal(reportDesignSchema.safeParse(designPayload(design)).success, true);
  });

  it('özet, gruplu tablonun grafiği ve hataların bölümlere dağılımı', () => {
    const design = { ...emptyDesign('RESERVATIONS'), columns: ['source'], grouped: true, aggregates: [{ fn: 'COUNT', column: null }], filters: [defaultFilter({ key: 'checkIn', type: 'date' })] };
    assert.equal(designSummary(design), 'Rezervasyonlar · 1 sütun · 1 filtre · gruplu (1 toplam)');
    const dataset = { columns: [{ key: 'source', kind: 'text' }, { key: 'COUNT', kind: 'number' }], rows: [{ source: 'Telefon', COUNT: 3 }, { source: 'Web', COUNT: 5 }] };
    assert.deepEqual(designerChart(design, dataset), { type: 'BAR', series: ['COUNT'] });
    assert.deepEqual(designerChart({ ...design, grouped: false }, dataset), { type: 'TABLE', series: [] });
    assert.deepEqual(groupDesignErrors({ columns: 'En az bir sütun', 'filters.1': 'Değer yazın', 'aggregates.0.column': 'Sayı olmalı' }), {
      source: [],
      columns: ['En az bir sütun'],
      aggregates: ['Sayı olmalı'],
      filters: ['Değer yazın'],
      sort: [],
      limit: [],
    });
  });
});
