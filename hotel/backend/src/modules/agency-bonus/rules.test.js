import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toDecimal } from '@hotelos/core';
import { computeBonus, nextTier, paceOf, productionDrift, reachedTier, scorePct } from './rules.js';

/**
 * Acente primi saf kuralları (modül 35): kademeye ulaşma sınırı, tüm üretime /
 * dilimli hesap (ciro ve gece ölçütü), tavan, yuvarlama, sıfır / eksi ciro,
 * sonraki kademe, puan ve zamana göre ilerleme.
 */

const NIGHT_TIERS = [
  { threshold: '1000', ratePct: '1' },
  { threshold: '2000', ratePct: '2' },
  { threshold: '3000', ratePct: '3' },
];
const REVENUE_TIERS = [
  { threshold: '1000000', ratePct: '1' },
  { threshold: '2000000', ratePct: '2' },
  { threshold: '3000000', ratePct: '3' },
];

describe('kademeye ulaşma', () => {
  it('eşiğe eşit üretim kademeye ulaşır, bir eksiği ulaşmaz', () => {
    assert.equal(reachedTier(NIGHT_TIERS, toDecimal(999)), 0);
    assert.equal(reachedTier(NIGHT_TIERS, toDecimal(1000)), 1);
    assert.equal(reachedTier(NIGHT_TIERS, toDecimal(2999)), 2);
    assert.equal(reachedTier(NIGHT_TIERS, toDecimal(3000)), 3);
    assert.equal(reachedTier(NIGHT_TIERS, toDecimal(99999)), 3);
  });

  it('kuruşlu ciro eşiğinde bir kuruş eksik ulaşmaz', () => {
    const tiers = [{ threshold: '1500000.50', ratePct: '2' }];
    assert.equal(reachedTier(tiers, toDecimal('1500000.49')), 0);
    assert.equal(reachedTier(tiers, toDecimal('1500000.50')), 1);
  });
});

describe('tüm üretime (WHOLE)', () => {
  const base = { metric: 'NIGHTS', mode: 'WHOLE', tiers: NIGHT_TIERS, revenue: '4000000' };

  it('kademeye ulaşmayan acenteye prim çıkmaz', () => {
    const result = computeBonus({ ...base, nights: 999 });
    assert.equal(result.tierIndex, 0);
    assert.equal(result.ratePct, null);
    assert.deepEqual(result.slices, []);
    assert.equal(result.amount, '0.00');
    assert.equal(result.grossAmount, '0.00');
    assert.equal(result.capped, false);
    assert.equal(result.effectiveRatePct, '0.00');
  });

  it('ulaşılan en yüksek kademenin oranı bütün ciroya uygulanır (geriye dönük)', () => {
    assert.equal(computeBonus({ ...base, nights: 1000 }).amount, '40000.00');
    const second = computeBonus({ ...base, nights: 2500 });
    assert.equal(second.tierIndex, 2);
    assert.equal(second.ratePct, '2');
    assert.deepEqual(second.slices, [{ tier: 2, ratePct: '2', from: '2000', to: null, base: '4000000.00', amount: '80000.00' }]);
    assert.equal(second.amount, '80000.00');
    assert.equal(second.effectiveRatePct, '2.00');
    assert.equal(computeBonus({ ...base, nights: 3500 }).amount, '120000.00');
  });

  it('ciro ölçütünde eşik vergisiz oda geliriyle ölçülür', () => {
    const result = computeBonus({ metric: 'REVENUE', mode: 'WHOLE', tiers: REVENUE_TIERS, nights: 10, revenue: '2000000.00' });
    assert.equal(result.achieved, '2000000.00');
    assert.equal(result.tierIndex, 2);
    assert.equal(result.amount, '40000.00');
  });
});

describe('yalnız aşan kısma (EXCESS)', () => {
  it('ciro ölçütü: her kademe kendi dilimine (gelir vergisi dilimi gibi)', () => {
    const middle = computeBonus({ metric: 'REVENUE', mode: 'EXCESS', tiers: REVENUE_TIERS, nights: 100, revenue: '2500000' });
    assert.equal(middle.tierIndex, 2);
    assert.deepEqual(
      middle.slices.map((slice) => [slice.tier, slice.from, slice.to, slice.base, slice.amount]),
      [
        [1, '1000000', '2000000', '1000000.00', '10000.00'],
        [2, '2000000', '3000000', '500000.00', '10000.00'],
      ],
    );
    assert.equal(middle.amount, '20000.00');

    const top = computeBonus({ metric: 'REVENUE', mode: 'EXCESS', tiers: REVENUE_TIERS, nights: 100, revenue: '3500000' });
    assert.deepEqual(top.slices.map((slice) => slice.amount), ['10000.00', '20000.00', '15000.00']);
    assert.equal(top.slices[2].to, null);
    assert.equal(top.amount, '45000.00');
    assert.equal(top.effectiveRatePct, '1.29');
  });

  it('eşiğe tam ulaşan acentenin dilimi boştur (aşan kısım yok)', () => {
    const result = computeBonus({ metric: 'REVENUE', mode: 'EXCESS', tiers: REVENUE_TIERS, nights: 100, revenue: '1000000' });
    assert.equal(result.tierIndex, 1);
    assert.equal(result.slices[0].base, '0.00');
    assert.equal(result.amount, '0.00');
  });

  it('gece ölçütü: dilimdeki gece × dönemin ortalama gece geliri', () => {
    const tiers = [
      { threshold: '1000', ratePct: '2' },
      { threshold: '1500', ratePct: '4' },
    ];
    // 2000 gece, 3.000.000 ciro → ortalama 1500; dilimler 500 + 500 gece.
    const result = computeBonus({ metric: 'NIGHTS', mode: 'EXCESS', tiers, nights: 2000, revenue: '3000000' });
    assert.deepEqual(
      result.slices.map((slice) => [slice.tier, slice.nights, slice.base, slice.amount]),
      [
        [1, 500, '750000.00', '15000.00'],
        [2, 500, '750000.00', '30000.00'],
      ],
    );
    assert.equal(result.amount, '45000.00');
  });

  it('prim yuvarlanmış dilimlerin toplamıdır (döküm toplamı primi tutar)', () => {
    const tiers = [
      { threshold: '1', ratePct: '10' },
      { threshold: '2', ratePct: '10' },
    ];
    // 3 gece, 100 ciro: her dilim 1 gece = 33,333… → 33,33; prim 3,333… → 3,33.
    const result = computeBonus({ metric: 'NIGHTS', mode: 'EXCESS', tiers, nights: 3, revenue: '100' });
    assert.deepEqual(result.slices.map((slice) => [slice.base, slice.amount]), [['33.33', '3.33'], ['33.33', '3.33']]);
    assert.equal(result.amount, '6.66');
    const sum = result.slices.reduce((total, slice) => total.plus(toDecimal(slice.amount)), toDecimal(0));
    assert.equal(sum.toFixed(2), result.amount);
  });

  it('ara adımda yuvarlanmaz: dilim primi yuvarlanmamış matrahtan hesaplanır', () => {
    // Matrah 66,666… (66,67 gösterilir); %1,5'i 0,99999… → 1,00 (66,67 × %1,5 = 1,0001 değil).
    const result = computeBonus({ metric: 'NIGHTS', mode: 'EXCESS', tiers: [{ threshold: '1', ratePct: '1.5' }], nights: 3, revenue: '100.00' });
    assert.equal(result.slices[0].base, '66.67');
    assert.equal(result.amount, '1.00');
  });
});

describe('tavan ve sınır durumları', () => {
  it('tavanı aşan prim tavana iner; brüt prim ayrıca tutulur', () => {
    const result = computeBonus({ metric: 'REVENUE', mode: 'WHOLE', tiers: [{ threshold: '100000', ratePct: '5' }], maxBonus: '30000', nights: 400, revenue: '1000000' });
    assert.equal(result.grossAmount, '50000.00');
    assert.equal(result.amount, '30000.00');
    assert.equal(result.capped, true);
    assert.equal(result.effectiveRatePct, '3.00');
  });

  it('tavanın altındaki prim olduğu gibi ödenir', () => {
    const result = computeBonus({ metric: 'REVENUE', mode: 'WHOLE', tiers: [{ threshold: '100000', ratePct: '5' }], maxBonus: '60000', nights: 400, revenue: '1000000' });
    assert.equal(result.amount, '50000.00');
    assert.equal(result.capped, false);
  });

  it('cirosu olmayan gece hedefine ulaşan acenteye prim çıkmaz, oran hesaplanmaz', () => {
    const result = computeBonus({ metric: 'NIGHTS', mode: 'WHOLE', tiers: NIGHT_TIERS, nights: 1200, revenue: '0' });
    assert.equal(result.tierIndex, 1);
    assert.equal(result.amount, '0.00');
    assert.equal(result.effectiveRatePct, null);
  });

  it('eksi ciro sıfır sayılır; prim eksi olmaz', () => {
    const result = computeBonus({ metric: 'REVENUE', mode: 'EXCESS', tiers: REVENUE_TIERS, nights: 5, revenue: '-2500.00' });
    assert.equal(result.achieved, '0.00');
    assert.equal(result.tierIndex, 0);
    assert.equal(result.amount, '0.00');
  });

  it('geçersiz gece sayısı ve boş kademe reddedilir', () => {
    assert.throws(() => computeBonus({ metric: 'NIGHTS', mode: 'WHOLE', tiers: NIGHT_TIERS, nights: -1, revenue: '0' }), RangeError);
    assert.throws(() => computeBonus({ metric: 'NIGHTS', mode: 'WHOLE', tiers: NIGHT_TIERS, nights: 1.5, revenue: '0' }), RangeError);
    assert.throws(() => computeBonus({ metric: 'NIGHTS', mode: 'WHOLE', tiers: [], nights: 1, revenue: '0' }), RangeError);
  });
});

describe('sonraki kademe ve puan', () => {
  it('sonraki kademeye kalan gece / tutar', () => {
    assert.deepEqual(nextTier(NIGHT_TIERS, toDecimal(1200), 'NIGHTS'), { tier: 2, threshold: '2000', ratePct: '2', remaining: '800' });
    assert.deepEqual(nextTier(NIGHT_TIERS, toDecimal(0), 'NIGHTS'), { tier: 1, threshold: '1000', ratePct: '1', remaining: '1000' });
    assert.equal(nextTier(NIGHT_TIERS, toDecimal(3000), 'NIGHTS'), null);
    assert.equal(nextTier(REVENUE_TIERS, toDecimal('1999999.99'), 'REVENUE').remaining, '0.01');
  });

  it('puan: gerçekleşen / hedef, yüzün üstüne çıkabilir', () => {
    assert.equal(scorePct(toDecimal(1250), '1000'), '125.00');
    assert.equal(scorePct(toDecimal(1), '3'), '33.33');
    assert.equal(scorePct(toDecimal(5), '0'), '0.00');
  });
});

describe('zamana göre ilerleme', () => {
  const period = { startDate: '2027-01-01', endDate: '2027-01-10', target: '1000', metric: 'NIGHTS' };

  it('dönem başlamadıysa ya da ilk gün bitmediyse beklenti yok', () => {
    assert.deepEqual(paceOf({ ...period, businessDate: '2026-12-25', achieved: toDecimal(0) }), {
      totalDays: 10,
      elapsedDays: 0,
      expected: '0',
      pace: null,
      paceRatioPct: null,
    });
    assert.equal(paceOf({ ...period, businessDate: '2027-01-01', achieved: toDecimal(0) }).pace, null);
  });

  it('doğrusal beklentiye göre önünde / yakın / gerisinde', () => {
    // İş günü 6 Ocak: 1–5 Ocak geceleri geçti (5/10) → beklenti 500 gece.
    const at = (achieved) => paceOf({ ...period, businessDate: '2027-01-06', achieved: toDecimal(achieved) });
    assert.equal(at(500).expected, '500');
    assert.equal(at(500).pace, 'AHEAD');
    assert.equal(at(460).pace, 'NEAR');
    assert.equal(at(450).pace, 'NEAR');
    assert.equal(at(449).pace, 'BEHIND');
    assert.equal(at(449).paceRatioPct, '89.80');
  });

  it('dönem bittiyse beklenti hedefin tamamı', () => {
    const result = paceOf({ ...period, businessDate: '2027-02-01', achieved: toDecimal(1000) });
    assert.equal(result.elapsedDays, 10);
    assert.equal(result.expected, '1000');
    assert.equal(result.pace, 'AHEAD');
  });

  it('ciro ölçütünde beklenti kuruşlu', () => {
    const result = paceOf({ startDate: '2027-01-01', endDate: '2027-01-10', target: '1000000', metric: 'REVENUE', businessDate: '2027-01-04', achieved: toDecimal('250000') });
    assert.equal(result.expected, '300000.00');
    assert.equal(result.pace, 'BEHIND');
  });
});

describe('hesaptan sonra değişen üretim', () => {
  it('fark yoksa yok, varsa bugün − hesap', () => {
    assert.equal(productionDrift({ nights: 10, revenue: '1000.00' }, { nights: 10, revenue: '1000' }), null);
    assert.deepEqual(productionDrift({ nights: 10, revenue: '1000.00' }, { nights: 12, revenue: '850.00' }), { nights: 2, revenue: '-150.00' });
  });
});
