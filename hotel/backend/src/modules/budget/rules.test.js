import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toDecimal } from '@hotelos/core';
import {
  closedShare,
  daysInMonth,
  emptyMonths,
  periodActual,
  periodMonths,
  periodPlan,
  periodTargets,
  roomRevenueDrivers,
  topVariances,
  varianceOf,
  yearTotal,
} from './rules.js';

/**
 * Bütçenin çekirdeği (modül 27). Yanlış olursa müdür hedefini tutturmuş
 * otele "geride" der ya da açığı göremez: ay içi planın orantılanması,
 * hedeflerin ağırlıklanması ve sapmanın yönü (giderde fazlası kötü) burada.
 */

const months = (values) => [...values, ...Array(12 - values.length).fill(null)];

describe('dönem', () => {
  it('ayın gün sayısı (artık yıl dahil)', () => {
    assert.equal(daysInMonth(2028, 2), 29);
    assert.equal(daysInMonth(2026, 2), 28);
    assert.equal(daysInMonth(2026, 10), 31);
  });

  it('kapanmış gün oranı: geçmiş ay 1, ay içi kapanmış günler (iş günü hariç), gelecek 0', () => {
    assert.equal(closedShare(2026, 9, '2026-10-05'), 1);
    assert.equal(closedShare(2025, 12, '2026-10-05'), 1);
    assert.equal(closedShare(2026, 10, '2026-10-05'), 4 / 31);
    assert.equal(closedShare(2026, 10, '2026-10-01'), 0, 'ayın ilk günü: henüz kapanmış gün yok');
    assert.equal(closedShare(2026, 11, '2026-10-05'), 0);
    assert.equal(closedShare(2027, 1, '2026-10-05'), 0);
  });

  it('dönemin ayları: tek ay ya da yılbaşından; gelecek ay düşer', () => {
    assert.deepEqual(periodMonths({ year: 2026, month: 9, scope: 'MONTH', businessDate: '2026-10-05' }), [{ month: 9, share: 1 }]);
    const ytd = periodMonths({ year: 2026, month: 12, scope: 'YTD', businessDate: '2026-10-05' });
    assert.deepEqual(ytd.map((entry) => entry.month), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(ytd.at(-1).share, 4 / 31);
    assert.deepEqual(periodMonths({ year: 2026, month: 11, scope: 'MONTH', businessDate: '2026-10-05' }), []);
  });
});

describe('plan ve gerçekleşen', () => {
  it('dönem planı: ay içi orantılı; planlanmamış ay sayılmaz; hiç plan yoksa tanımsız', () => {
    const period = [{ month: 9, share: 1 }, { month: 10, share: 0.5 }];
    const plan = months([null, null, null, null, null, null, null, null, '1000', '2000']);
    assert.equal(periodPlan(plan, period).toFixed(2), '2000.00', '1000 + 2000 × 0,5');
    assert.equal(periodPlan(emptyMonths(), period), null);
  });

  it('sistem kaleminde boş ay sıfırdır; elle girilen giderde eksik ay işaretlenir', () => {
    const period = [{ month: 1 }, { month: 2 }];
    assert.deepEqual(
      (({ total, complete }) => ({ total: total.toFixed(2), complete }))(periodActual(new Map([[1, '500']]), period, { manual: false })),
      { total: '500.00', complete: true },
    );
    const partial = periodActual(new Map([[1, '500']]), period, { manual: true });
    assert.equal(partial.total.toFixed(2), '500.00');
    assert.equal(partial.complete, false);
    assert.deepEqual(periodActual(new Map(), period, { manual: true }), { total: null, complete: false }, 'hiç girilmemiş gider: gerçekleşen yok');
  });

  it('doluluk hedefi satılabilir odayla, ADR hedefi planlanan geceyle ağırlıklanır', () => {
    const occupancy = months(['50', '90']);
    const adr = months(['1000', '2000']);
    const sellable = new Map([
      [1, 3100],
      [2, 2800],
    ]);
    const targets = periodTargets({ occupancy, adr, sellable, period: [{ month: 1 }, { month: 2 }] });
    // gece: 1550 + 2520 = 4070; oda: 5900 → %69,0; ADR: (1550×1000 + 2520×2000) / 4070
    assert.equal(targets.nights, 4070);
    assert.equal(targets.occupancyPct, 69);
    assert.equal(targets.adr.toFixed(2), '1619.16');
  });

  it('doluluk hedefi yoksa ADR hedefi ayların düz ortalaması', () => {
    const targets = periodTargets({ occupancy: emptyMonths(), adr: months(['1000', '3000']), sellable: new Map(), period: [{ month: 1 }, { month: 2 }] });
    assert.deepEqual([targets.occupancyPct, targets.adr.toFixed(2), targets.nights], [null, '2000.00', null]);
  });
});

describe('sapma', () => {
  it('gelirde fazlası iyi, giderde fazlası kötü; yüzde plana göre', () => {
    assert.deepEqual(varianceOf({ kind: 'REVENUE', unit: 'MONEY', plan: toDecimal('1000'), actual: toDecimal('1100') }), {
      difference: '100.00',
      differencePct: 10,
      tone: 'GOOD',
    });
    assert.deepEqual(varianceOf({ kind: 'EXPENSE', unit: 'MONEY', plan: toDecimal('1000'), actual: toDecimal('1100') }), {
      difference: '100.00',
      differencePct: 10,
      tone: 'BAD',
    });
    assert.equal(varianceOf({ kind: 'EXPENSE', unit: 'MONEY', plan: toDecimal('1000'), actual: toDecimal('900') }).tone, 'GOOD');
  });

  it('doluluk farkı puan; plan ya da gerçekleşen yoksa sapma yok; sıfır plan yüzdesiz', () => {
    assert.deepEqual(varianceOf({ kind: 'KPI', unit: 'PCT', plan: 70, actual: 64.5 }), { difference: '-5.5', differencePct: null, tone: 'BAD' });
    assert.deepEqual(varianceOf({ kind: 'EXPENSE', unit: 'MONEY', plan: toDecimal('1000'), actual: null }), { difference: null, differencePct: null, tone: 'NEUTRAL' });
    assert.equal(varianceOf({ kind: 'REVENUE', unit: 'MONEY', plan: toDecimal('0'), actual: toDecimal('50') }).differencePct, null);
  });

  it('oda geliri sapması doluluk ve fiyat etkisine ayrılır; plan hedeflerle tutmuyorsa fark ayrıca', () => {
    // Hedef: 4000 gece × 1000 = 4.000.000; gerçek: 3800 gece, 3.990.000 (ADR 1050).
    const drivers = roomRevenueDrivers({
      planRevenue: toDecimal('4100000'),
      actualRevenue: toDecimal('3990000'),
      planNights: 4000,
      planAdr: toDecimal('1000'),
      actualNights: 3800,
    });
    assert.deepEqual(drivers, { occupancyEffect: '-200000.00', rateEffect: '190000.00', planGap: '-100000.00' });
    assert.equal(roomRevenueDrivers({ planRevenue: null, actualRevenue: toDecimal('1'), planNights: null, planAdr: null, actualNights: 1 }), null);
  });

  it('en büyük sapmalar: para kalemleri mutlak farka göre, hedefler hariç', () => {
    const rows = [
      { code: 'A', kind: 'REVENUE', unit: 'MONEY', difference: '-500.00' },
      { code: 'B', kind: 'EXPENSE', unit: 'MONEY', difference: '900.00' },
      { code: 'C', kind: 'KPI', unit: 'MONEY', difference: '5000.00' },
      { code: 'D', kind: 'REVENUE', unit: 'MONEY', difference: '0.00' },
      { code: 'E', kind: 'REVENUE', unit: 'MONEY', difference: null },
    ];
    assert.deepEqual(topVariances(rows, 5).map((row) => row.code), ['B', 'A']);
    assert.equal(yearTotal(months(['1', '2.5'])), '3.50');
    assert.equal(yearTotal(emptyMonths()), null);
  });
});
