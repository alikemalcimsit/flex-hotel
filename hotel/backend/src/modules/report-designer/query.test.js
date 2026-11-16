import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reportDesignSchema } from '@hotelos/hotel-contracts';
import { buildDesignQuery, toDataset } from './query.js';

const HOTEL = '11111111-1111-4111-8111-111111111111';
const context = { hotelId: HOTEL, timezone: 'Europe/Istanbul', today: '2026-11-16', limit: 101 };
const build = (design) => buildDesignQuery(reportDesignSchema.parse(design), context);

describe('tasarım sorgusu', () => {
  it('kullanıcının yazdığı hiçbir şey SQL metnine girmez: değerler parametre, sütunlar katalogdan', () => {
    const evil = `x'; DROP TABLE "Guest"; --`;
    const { query } = build({
      source: 'GUESTS',
      columns: ['firstName', 'lastName'],
      filters: [{ column: 'lastName', op: 'CONTAINS', value: evil }, { column: 'email', op: 'EQ', value: evil }],
    });
    assert.doesNotMatch(query.text, /DROP TABLE/);
    assert.ok(query.values.some((value) => String(value).includes('DROP TABLE')), 'değer parametre olarak gider');
    assert.ok(query.values.includes(HOTEL), 'otel koşulu her zaman');
    assert.match(query.text, /g\."hotelId" = \$1 AND g\."deletedAt" IS NULL/);
  });

  it('LIKE jokerleri kaçışlanır (kullanıcının "%"si joker olmaz)', () => {
    const { query } = build({ source: 'GUESTS', columns: ['firstName'], filters: [{ column: 'firstName', op: 'CONTAINS', value: '50%_off' }] });
    assert.ok(query.values.includes('%50\\%\\_off%'));
  });

  it('gruplu: boyutlar + toplamlar, GROUP BY sıra no, sıralama takma adla; göreli dönem o güne göre', () => {
    const { query, outputs } = build({
      source: 'RESERVATIONS',
      grouped: true,
      columns: ['source'],
      aggregates: [{ fn: 'COUNT' }, { fn: 'SUM', column: 'totalPrice' }],
      filters: [{ column: 'checkIn', op: 'PERIOD', period: 'LAST_MONTH' }, { column: 'status', op: 'NOT_IN', values: ['CANCELLED'] }],
      sort: [{ key: 'SUM:totalPrice', dir: 'DESC' }],
    });
    assert.deepEqual(outputs.map((output) => [output.key, output.label, output.kind]), [
      ['source', 'Kaynak', 'text'],
      ['COUNT', 'Adet', 'number'],
      ['SUM:totalPrice', 'Toplam · Tutar', 'money'],
    ]);
    assert.match(query.text, /GROUP BY 1 ORDER BY "a1" DESC NULLS LAST LIMIT/);
    assert.match(query.text, /sum\(r\."totalPrice"\) AS "a1"/);
    assert.ok(query.values.includes('2026-10-01') && query.values.includes('2026-10-31'), 'geçen ay');
    assert.ok(query.values.some((value) => Array.isArray(value) && value[0] === 'CANCELLED'));
  });

  it('kayıt anı otelin saat diliminde güne çevrilir (dilim parametre)', () => {
    const { query } = build({ source: 'RESERVATIONS', columns: ['createdAt'] });
    assert.match(query.text, /AT TIME ZONE 'UTC' AT TIME ZONE \$\d+/);
    assert.ok(query.values.includes('Europe/Istanbul'));
  });

  it('çıktı: durum kodu Türkçe ad, tarih gün, tutar iki basamak, boş null', () => {
    const { outputs } = build({ source: 'RESERVATIONS', columns: ['status', 'checkIn', 'totalPrice', 'agencyName'] });
    const dataset = toDataset([{ c0: 'CHECKED_OUT', c1: new Date('2026-10-05T00:00:00Z'), c2: '1250.5', c3: null }], outputs);
    assert.deepEqual(dataset.rows[0], { status: 'Çıkış yaptı', checkIn: '2026-10-05', totalPrice: '1250.50', agencyName: null });
    assert.deepEqual(dataset.columns.map((column) => column.kind), ['text', 'date', 'money', 'text']);
  });
});
