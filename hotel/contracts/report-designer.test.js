import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { aggregateKey, designerColumn, reportDesignSchema } from './report-designer.js';

const paths = (design) => reportDesignSchema.safeParse(design).error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) ?? [];

describe('rapor tasarımı', () => {
  test('yalnız katalogdaki sütunlar; gruplamasızda en az bir sütun', () => {
    assert.deepEqual(paths({ source: 'RESERVATIONS', columns: ['confirmationCode', 'totalPrice'] }), []);
    assert.match(paths({ source: 'RESERVATIONS', columns: ['passwordHash'] })[0], /Bilinmeyen sütun/);
    assert.match(paths({ source: 'GUESTS', columns: [] })[0], /En az bir sütun/);
    assert.match(paths({ source: 'GUESTS', columns: ['phone', 'phone'] })[0], /iki kez/);
    assert.equal(designerColumn('GUESTS', 'idNumber'), null, 'belge no tasarımcıda yok (kişisel veri)');
  });

  test('gruplu: toplam şart; toplam / ortalama yalnız sayı ve tutar sütununa', () => {
    const grouped = { source: 'RESERVATIONS', grouped: true, columns: ['source'] };
    assert.match(paths(grouped)[0], /en az bir toplam/);
    assert.deepEqual(paths({ ...grouped, aggregates: [{ fn: 'COUNT' }, { fn: 'SUM', column: 'totalPrice' }] }), []);
    assert.match(paths({ ...grouped, aggregates: [{ fn: 'SUM', column: 'guestName' }] })[0], /yalnız sayı/);
    assert.equal(aggregateKey({ fn: 'SUM', column: 'totalPrice' }), 'SUM:totalPrice');
    assert.deepEqual(paths({ ...grouped, aggregates: [{ fn: 'COUNT' }], sort: [{ key: 'COUNT', dir: 'DESC' }] }), []);
    assert.match(paths({ ...grouped, aggregates: [{ fn: 'COUNT' }], sort: [{ key: 'totalPrice' }] })[0], /Sıralama/);
  });

  test('filtre işleci sütun türüne uymalı; değerler türüne göre denetlenir', () => {
    const base = { source: 'RESERVATIONS', columns: ['confirmationCode'] };
    assert.deepEqual(paths({ ...base, filters: [{ column: 'checkIn', op: 'PERIOD', period: 'LAST_MONTH' }] }), []);
    assert.deepEqual(paths({ ...base, filters: [{ column: 'status', op: 'IN', values: ['CONFIRMED', 'CHECKED_IN'] }] }), []);
    assert.match(paths({ ...base, filters: [{ column: 'status', op: 'IN', values: ['HACK'] }] })[0], /seçeneği geçersiz/);
    assert.match(paths({ ...base, filters: [{ column: 'status', op: 'CONTAINS', value: 'x' }] })[0], /kullanılamaz/);
    assert.match(paths({ ...base, filters: [{ column: 'checkIn', op: 'BETWEEN', value: '2026-01-01', valueTo: '31.01.2026' }] })[0], /tarihi geçersiz/);
    assert.match(paths({ ...base, filters: [{ column: 'totalPrice', op: 'GTE', value: 'çok' }] })[0], /sayı olmalı/);
    assert.deepEqual(paths({ ...base, filters: [{ column: 'totalPrice', op: 'BETWEEN', value: '1000', valueTo: 5000 }] }), []);
    assert.deepEqual(paths({ ...base, filters: [{ column: 'cancelledAt', op: 'NOT_EMPTY' }] }), []);
  });
});
