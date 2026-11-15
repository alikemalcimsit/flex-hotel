import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyPriceMultiplier, calendarToYieldDays, evaluateDay, evaluateYield, pctToMultiplier } from './yield-rules.js';

/**
 * Yield kuralları (modül 34) — hata payı sıfır olması gerekenler: eşik
 * kararları, ardışık gün birleştirme, çarpan uygulaması ve takvim dönüşümü.
 */

const SETTINGS = { highOccupancyPct: 80, highAdjustmentPct: 10, lowOccupancyPct: 30, lowDaysOut: 7, lowAdjustmentPct: 15 };
const STD = 'type-std';

const day = (date, occupancyPct, daysOut, overrides = {}) => ({
  roomTypeId: STD,
  date,
  occupancyPct,
  sellable: 100,
  sold: Math.round(occupancyPct),
  daysOut,
  lastYearOccupancyPct: null,
  ...overrides,
});

describe('evaluateDay — eşikler', () => {
  it('yüksek doluluk artış önerir, eşik dahil', () => {
    assert.deepEqual(evaluateDay({ occupancyPct: 80, daysOut: 30 }, SETTINGS), { multiplier: '1.100', rule: 'HIGH_OCCUPANCY' });
    assert.deepEqual(evaluateDay({ occupancyPct: 92.4, daysOut: 2 }, SETTINGS), { multiplier: '1.100', rule: 'HIGH_OCCUPANCY' });
  });

  it('düşük doluluk YALNIZ son günlerde indirim önerir', () => {
    assert.deepEqual(evaluateDay({ occupancyPct: 25, daysOut: 7 }, SETTINGS), { multiplier: '0.850', rule: 'LOW_OCCUPANCY_LAST_MINUTE' });
    // 8 gün kala düşük doluluk henüz panik değil.
    assert.equal(evaluateDay({ occupancyPct: 25, daysOut: 8 }, SETTINGS), null);
  });

  it('ara doluluk öneri üretmez', () => {
    assert.equal(evaluateDay({ occupancyPct: 55, daysOut: 3 }, SETTINGS), null);
  });
});

describe('evaluateYield — ardışık gün birleştirme', () => {
  it('aynı çarpanlı ardışık günler tek öneri olur; girdiler gün gün saklanır', () => {
    const suggestions = evaluateYield(
      [day('2027-07-01', 85, 10), day('2027-07-02', 90, 11), day('2027-07-03', 82, 12)],
      SETTINGS,
    );
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].startDate, '2027-07-01');
    assert.equal(suggestions[0].endDate, '2027-07-03');
    assert.equal(suggestions[0].multiplier, '1.100');
    assert.equal(suggestions[0].days.length, 3);
    assert.equal(suggestions[0].days[1].occupancyPct, 90);
    assert.match(suggestions[0].reason, /3 gece/);
    assert.match(suggestions[0].reason, /%85/);
  });

  it('araya kuralsız gün girince ve kural değişince öneri bölünür', () => {
    const suggestions = evaluateYield(
      [
        day('2027-07-01', 85, 1),
        day('2027-07-02', 55, 2), // kural yok → böler
        day('2027-07-03', 20, 3), // düşük doluluk son dakika
        day('2027-07-04', 22, 4),
        day('2027-07-05', 95, 5), // kural değişti → böler
      ],
      SETTINGS,
    );
    assert.deepEqual(
      suggestions.map((s) => [s.startDate, s.endDate, s.rule]),
      [
        ['2027-07-01', '2027-07-01', 'HIGH_OCCUPANCY'],
        ['2027-07-03', '2027-07-04', 'LOW_OCCUPANCY_LAST_MINUTE'],
        ['2027-07-05', '2027-07-05', 'HIGH_OCCUPANCY'],
      ],
    );
  });

  it('ardışık olmayan (atlanmış) aynı kurallı günler ayrı önerilerdir', () => {
    const suggestions = evaluateYield([day('2027-07-01', 85, 1), day('2027-07-03', 85, 3)], SETTINGS);
    assert.equal(suggestions.length, 2);
  });

  it('tipler ayrı değerlendirilir', () => {
    const suggestions = evaluateYield(
      [day('2027-07-01', 85, 1), day('2027-07-01', 85, 1, { roomTypeId: 'type-dlx' })],
      SETTINGS,
    );
    assert.equal(suggestions.length, 2);
  });
});

describe('applyPriceMultiplier — kuruş hassasiyeti', () => {
  it('çarpan kuruşa yuvarlanır, kayan nokta hatası yok', () => {
    assert.equal(applyPriceMultiplier('1000.00', '1.100'), '1100.00');
    assert.equal(applyPriceMultiplier('999.99', '0.850'), '849.99');
    assert.equal(applyPriceMultiplier('0.10', 3), '0.30');
  });
});

describe('pctToMultiplier', () => {
  it('artış ve indirim üç ondalıkla', () => {
    assert.equal(pctToMultiplier(10), '1.100');
    assert.equal(pctToMultiplier(-15), '0.850');
  });
});

describe('calendarToYieldDays — takvim dönüşümü', () => {
  it('satılabilir / satılan / doluluk / kalan gün; arızalı düşülür, geçen yıl eşlenir', () => {
    const calendar = {
      days: ['2027-07-01', '2027-07-02'],
      byRoomType: {
        [STD]: {
          total: 10,
          days: {
            '2027-07-01': { total: 10, outOfOrder: 2, free: 2 }, // satılabilir 8, satılan 6
            '2027-07-02': { total: 10, outOfOrder: 0, free: -1 }, // overbook: satılan = satılabilir
          },
        },
      },
    };
    // 364 gün önce = haftanın aynı günü (forecast kalıbı): 2027-07-01 → 2026-07-02.
    const lastYear = new Map([[`${STD}|2026-07-02`, 4]]);
    const rows = calendarToYieldDays(calendar, { today: '2027-06-30', lastYearByKey: lastYear });
    assert.deepEqual(rows[0], {
      roomTypeId: STD,
      date: '2027-07-01',
      occupancyPct: 75,
      sellable: 8,
      sold: 6,
      daysOut: 1,
      lastYearOccupancyPct: 50, // 4 / 8 satılabilir
    });
    assert.equal(rows[1].occupancyPct, 100);
    assert.equal(rows[1].daysOut, 2);
    assert.equal(rows[1].lastYearOccupancyPct, null); // 2026-07-03 kaydı yok
  });

  it('satılabilir odası olmayan gün atlanır', () => {
    const calendar = { days: ['2027-07-01'], byRoomType: { [STD]: { total: 2, days: { '2027-07-01': { total: 2, outOfOrder: 2, free: 0 } } } } };
    assert.deepEqual(calendarToYieldDays(calendar, { today: '2027-06-30' }), []);
  });
});
