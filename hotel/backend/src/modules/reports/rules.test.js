import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toDecimal } from '@hotelos/core';
import { reportRangeError, reportRangeSchema, shiftDay } from '@hotelos/hotel-contracts';
import { breakdownRows, bucketOf, bucketRows, changePct, dailyTotals, daysBetween, rangeTotals, ratios, sumByKey } from './rules.js';

/**
 * Gelir raporu kuralları (modül 23): yanlış oran ya da kayan karşılaştırma
 * müdürün fiyat kararını doğrudan bozar — saf kurallar burada sabitlenir.
 */

const day = (date, values = {}) => ({
  sold: 0,
  sellable: 10,
  roomRevenue: toDecimal(0),
  discounts: toDecimal(0),
  fees: toDecimal(0),
  cancellations: toDecimal(0),
  onTheBooks: false,
  ...values,
  ...(values.roomRevenue !== undefined ? { roomRevenue: toDecimal(values.roomRevenue) } : {}),
});

describe('aralık ve kovalar', () => {
  it('geçersiz takvim günü, ters aralık ve bir yıldan uzun aralık reddedilir', () => {
    assert.equal(reportRangeError('2026-02-30', '2026-03-01').field, 'from');
    assert.match(reportRangeError('2026-03-02', '2026-03-01').message, /önce olamaz/);
    assert.match(reportRangeError('2025-01-01', '2026-01-02').message, /en fazla 366 gün/);
    assert.equal(reportRangeError('2024-01-01', '2024-12-31'), null, 'artık yıl 366 gün');
    assert.equal(reportRangeSchema.safeParse({ from: '2026-10-01', to: '2026-10-31' }).data.groupBy, 'DAY');
    assert.equal(reportRangeSchema.safeParse({ from: '2026-10-01', to: '2026-09-30' }).success, false);
  });

  it('hafta pazartesi başlar, ay ayın ilk günü', () => {
    assert.equal(bucketOf('2026-10-04', 'WEEK'), '2026-09-28', 'pazar → önceki pazartesi');
    assert.equal(bucketOf('2026-10-05', 'WEEK'), '2026-10-05', 'pazartesi kendisi');
    assert.equal(bucketOf('2026-10-31', 'MONTH'), '2026-10-01');
    assert.equal(bucketOf('2026-10-31', 'DAY'), '2026-10-31');
    assert.deepEqual(daysBetween('2026-02-27', '2026-03-02'), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  });

  it('geçen yıl 364 gün önce: haftanın aynı günü', () => {
    const now = new Date('2026-10-03T00:00:00Z').getUTCDay();
    const before = new Date(`${shiftDay('2026-10-03', -364)}T00:00:00Z`).getUTCDay();
    assert.equal(now, before);
  });
});

describe('oranlar', () => {
  it('doluluk toplamdan (bir ondalık); ADR ve RevPAR kuruşa yuvarlanır; payda sıfırsa tanımsız', () => {
    assert.deepEqual(ratios({ sold: 7, sellable: 9, roomRevenue: toDecimal('6250') }), { occupancyPct: 77.8, adr: '892.86', revpar: '694.44' });
    assert.deepEqual(ratios({ sold: 0, sellable: 0, roomRevenue: toDecimal(0) }), { occupancyPct: null, adr: null, revpar: null });
  });

  it('değişim yüzdesi; önceki sıfır ya da yoksa tanımsız', () => {
    assert.equal(changePct('1100.00', '1000.00'), 10);
    assert.equal(changePct(45, 60), -25);
    assert.equal(changePct('5', '0'), null);
    assert.equal(changePct(null, '10'), null);
  });
});

describe('günlük toplam: gelirin kaynağı', () => {
  const sellable = new Map([
    ['2026-10-02', 10],
    ['2026-10-03', 10],
    ['2026-10-04', 8],
  ]);

  it('geçmiş gün folyodan (net), bugün ve sonrası rezervasyon brütünden dahil vergi ayrılarak', () => {
    const totals = dailyTotals({
      days: ['2026-10-02', '2026-10-03', '2026-10-04'],
      businessDate: '2026-10-03',
      includedTaxRate: '12',
      sellable,
      nights: [
        { day: '2026-10-02', sold: 4, gross: '4480' },
        { day: '2026-10-03', sold: 5, gross: '5600' },
        { day: '2026-10-04', sold: 2, gross: '2240' },
      ],
      posted: [
        { day: '2026-10-02', room: '3900', discounts: '-100', fees: '250', cancellations: '0' },
        // Bugünün gecesi henüz işlenmedi; yine de bir kalem varsa (erken çıkış) eldeki gelire karışmaz.
        { day: '2026-10-03', room: '1000', discounts: '0', fees: '0', cancellations: '0' },
      ],
    });
    const past = totals.get('2026-10-02');
    assert.equal(past.sold, 4);
    assert.equal(past.roomRevenue.toFixed(2), '3900.00', 'folyodan, brüt rezervasyon değil');
    assert.equal(past.fees.toFixed(2), '250.00');
    assert.equal(past.onTheBooks, false);
    const today = totals.get('2026-10-03');
    assert.equal(today.roomRevenue.toFixed(2), '5000.00', '5600 / 1.12');
    assert.equal(today.fees.toFixed(2), '0.00');
    assert.equal(today.onTheBooks, true);
    assert.equal(totals.get('2026-10-04').sellable, 8);
  });
});

describe('kovalar ve geçen yıl', () => {
  // Bu yıl 2026-10-05 (pzt) – 2026-10-18 (paz), geçen yıl 364 gün önce.
  const days = [];
  for (let offset = 0; offset < 14; offset += 1) days.push(shiftDay('2026-10-05', offset));
  const current = new Map(days.map((d, index) => [d, day(d, { sold: index < 7 ? 8 : 5, roomRevenue: index < 7 ? '8000' : '4000' })]));
  const lastYear = new Map(days.map((d) => [shiftDay(d, -364), day(d, { sold: 6, roomRevenue: '5400' })]));

  it('haftalık kova: toplamlardan oran, geçen yılın hizalı haftası ve değişim', () => {
    const rows = bucketRows({ days, groupBy: 'WEEK', current, lastYear });
    assert.equal(rows.length, 2);
    const [first, second] = rows;
    assert.equal(first.key, '2026-10-05');
    assert.equal(first.days, 7);
    assert.equal(first.sold, 56);
    assert.equal(first.sellable, 70);
    assert.equal(first.occupancyPct, 80);
    assert.equal(first.adr, '1000.00');
    assert.equal(first.revpar, '800.00');
    assert.equal(first.lastYear.from, '2025-10-06');
    assert.equal(first.lastYear.occupancyPct, 60);
    assert.equal(first.lastYear.adr, '900.00');
    assert.equal(first.change.occupancyPts, 20);
    assert.equal(first.change.adr, 11.1);
    assert.equal(first.change.revpar, 48.1);
    assert.equal(second.adr, '800.00');
    assert.equal(second.change.roomRevenue, -25.9);
  });

  it('aralık toplamı oranların ortalaması değil, toplamların oranı', () => {
    const total = rangeTotals(days, current, lastYear);
    assert.equal(total.sold, 91);
    assert.equal(total.adr, '923.08', '(56000 + 28000) / 91');
    assert.equal(total.occupancyPct, 65);
    assert.equal(total.lastYear.sold, 84);
  });

  it('eldeki günler kovada sayılır (grafik ve tablo "gerçekleşen / eldeki" ayrımı)', () => {
    const withOtb = new Map([...current].map(([d, value], index) => [d, { ...value, onTheBooks: index >= 10 }]));
    const [, second] = bucketRows({ days, groupBy: 'WEEK', current: withOtb, lastYear });
    assert.equal(second.onTheBooksDays, 4);
  });
});

describe('kırılım', () => {
  it('anahtara göre toplar (geçmiş folyodan, bugün ve sonrası eldeki), paya ve geçen yıla göre sıralar', () => {
    const current = sumByKey({
      businessDate: '2026-10-03',
      includedTaxRate: '0',
      nights: [
        { day: '2026-10-02', key: 'STD', sold: 3, gross: '3000' },
        { day: '2026-10-03', key: 'STD', sold: 2, gross: '2000' },
        { day: '2026-10-03', key: 'SUITE', sold: 1, gross: '3000' },
      ],
      posted: [{ day: '2026-10-02', key: 'STD', room: '2700' }],
    });
    const lastYear = [
      { key: 'STD', sold: 4, roomRevenue: toDecimal('3600') },
      { key: 'FAM', sold: 1, roomRevenue: toDecimal('1400') },
    ];
    const rows = breakdownRows({ current, lastYear, label: (key) => ({ STD: 'Standart', SUITE: 'Suit', FAM: 'Aile' })[key] });
    assert.deepEqual(rows.map((row) => row.key), ['STD', 'SUITE', 'FAM']);
    const [std, suite, fam] = rows;
    assert.equal(std.roomRevenue, '4700.00', '2700 işlenen + 2000 eldeki');
    assert.equal(std.sold, 5);
    assert.equal(std.adr, '940.00');
    assert.equal(std.sharePct, 61);
    assert.equal(std.lastYear.adr, '900.00');
    assert.equal(std.change.roomRevenue, 30.6);
    assert.equal(suite.lastYear.sold, 0);
    assert.equal(suite.change.roomRevenue, null, 'geçen yıl yoktu');
    assert.equal(fam.sold, 0, 'yalnızca geçen yıl satılan tip de görünür');
    assert.equal(fam.adr, null);
    assert.equal(fam.lastYear.sharePct, 28);
  });
});
