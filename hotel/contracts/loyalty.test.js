import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_LOYALTY_TIERS, consumeLots, loyaltySettingsSchema, maxRedeemablePoints, normalizeTiers, pointsForSpend, pointsValue, tierFor } from './loyalty.js';

/** Sadakatin saf kuralları (modül 56): puan hesabı, değer, harcama sınırı, FIFO, seviye, ayar şeması. Sayılar elle hesaplandı. */

describe('kazanma ve değer', () => {
  it('harcama / birim × çarpan, aşağı yuvarlanır; sıfır ve eksi harcama puan vermez', () => {
    assert.equal(pointsForSpend({ spend: '2480.00', spendPerPoint: '10' }), 248);
    assert.equal(pointsForSpend({ spend: '2489.99', spendPerPoint: '10' }), 248);
    assert.equal(pointsForSpend({ spend: '2480.00', spendPerPoint: '10', multiplier: '1.25' }), 310);
    assert.equal(pointsForSpend({ spend: '99.99', spendPerPoint: '0.5', multiplier: '1.5' }), 299);
    assert.equal(pointsForSpend({ spend: '0', spendPerPoint: '10' }), 0);
    assert.equal(pointsForSpend({ spend: '-50', spendPerPoint: '10' }), 0);
  });

  it('puan değeri ve folyoda en çok kullanılabilecek puan (bakiye, yüzde sınırı)', () => {
    assert.equal(pointsValue(300, '0.5'), '150.00');
    assert.equal(pointsValue(3, '0.3333'), '1.00');
    assert.equal(maxRedeemablePoints({ balance: 5000, chargesTotal: '2000.00', maxRedeemPct: 50, pointValue: '0.5' }), 2000, '1.000 TL / 0,50');
    assert.equal(maxRedeemablePoints({ balance: 300, chargesTotal: '2000.00', maxRedeemPct: 50, pointValue: '0.5' }), 300, 'bakiye sınırı');
    assert.equal(maxRedeemablePoints({ balance: 300, chargesTotal: '0', maxRedeemPct: 50, pointValue: '0.5' }), 0);
  });
});

describe('FIFO', () => {
  it('eski lottan başlar, eksik kalanı bildirir', () => {
    const lots = [
      { id: 'a', remaining: 100 },
      { id: 'b', remaining: 0 },
      { id: 'c', remaining: 250 },
    ];
    assert.deepEqual(consumeLots(lots, 180), { consumed: [{ lotId: 'a', points: 100 }, { lotId: 'c', points: 80 }], shortfall: 0 });
    assert.deepEqual(consumeLots(lots, 400), { consumed: [{ lotId: 'a', points: 100 }, { lotId: 'c', points: 250 }], shortfall: 50 });
  });
});

describe('seviye', () => {
  it('eşiği geçilen en yüksek seviye; sonraki ve kalan', () => {
    const tiers = normalizeTiers(DEFAULT_LOYALTY_TIERS);
    assert.deepEqual([tierFor(tiers, 0).current.code, tierFor(tiers, 0).next.code, tierFor(tiers, 0).toNext], ['CLASSIC', 'SILVER', 1000]);
    assert.deepEqual([tierFor(tiers, 1000).current.code, tierFor(tiers, 1000).toNext], ['SILVER', 2000]);
    assert.deepEqual([tierFor(tiers, 9999).current.code, tierFor(tiers, 9999).next], ['GOLD', null]);
    assert.equal(normalizeTiers([{ code: 'X', name: 'X', minPoints: 50, multiplier: 1 }])[0].minPoints, 0, 'ilk seviye 0');
    assert.equal(normalizeTiers([]).length, 1);
  });

  it('ayar şeması: tekil kod ve eşik, 0 eşikli seviye zorunlu', () => {
    const base = { isEnabled: true, programName: 'FlexClub', spendPerPoint: '10', pointValue: '0.5', minRedeemPoints: 100, maxRedeemPct: 50, expiryMonths: 24, autoEnroll: true, excludeLedgerPaid: true, earnOnSpa: true };
    assert.equal(loyaltySettingsSchema.safeParse({ ...base, tiers: DEFAULT_LOYALTY_TIERS }).success, true);
    assert.equal(loyaltySettingsSchema.safeParse({ ...base, tiers: [{ code: 'A', name: 'Aa', minPoints: 10, multiplier: '1' }] }).success, false, 'kod 2 karakter ve 0 eşik yok');
    assert.equal(loyaltySettingsSchema.safeParse({ ...base, tiers: [DEFAULT_LOYALTY_TIERS[0], { ...DEFAULT_LOYALTY_TIERS[1], code: 'CLASSIC' }] }).success, false);
  });
});
