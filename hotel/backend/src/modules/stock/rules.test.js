import assert from 'node:assert/strict';
import { toDecimal } from '@hotelos/core';
import { describe, it } from 'node:test';
import { applyDelta, applyReceipts, countDifference, movingAverageCost, saleDeltas, saleRequirements, stockValue } from './rules.js';

describe('movingAverageCost', () => {
  it('elde stok yoksa alış fiyatı', () => {
    assert.equal(movingAverageCost({ onHand: '0', unitCost: '999', quantity: '10', price: '42.5' }).toString(), '42.5');
  });

  it('eldeki ve gelenin ağırlıklı ortalaması', () => {
    // 10 kg × 100 + 30 kg × 120 = 4600 → 40 kg → 115
    assert.equal(movingAverageCost({ onHand: '10', unitCost: '100', quantity: '30', price: '120' }).toString(), '115');
  });

  it('4 basamağa yuvarlanır (yarım yukarı)', () => {
    // (3 × 10 + 7 × 11) / 10 = 10.7; (1 × 1 + 2 × 2) / 3 = 1.66666… → 1.6667
    assert.equal(movingAverageCost({ onHand: '1', unitCost: '1', quantity: '2', price: '2' }).toFixed(4), '1.6667');
  });

  it('eksi stokta eski maliyet karışmaz, alış fiyatı', () => {
    assert.equal(movingAverageCost({ onHand: '-4', unitCost: '50', quantity: '10', price: '60' }).toString(), '60');
  });

  it('ondalık miktarlar (kg binde bir)', () => {
    // 2.345 × 210.5 + 0.655 × 199.9 = 493.6225 + 130.9345 = 624.557 → 3 → 208.1857
    assert.equal(movingAverageCost({ onHand: '2.345', unitCost: '210.5', quantity: '0.655', price: '199.9' }).toFixed(4), '208.1857');
  });

  it('0 ya da eksi giriş hata', () => {
    assert.throws(() => movingAverageCost({ onHand: '1', unitCost: '1', quantity: '0', price: '1' }), RangeError);
    assert.throws(() => movingAverageCost({ onHand: '1', unitCost: '1', quantity: '-1', price: '1' }), RangeError);
  });
});

describe('applyReceipts', () => {
  it('aynı belgedeki girişler sırayla işlenir', () => {
    const result = applyReceipts({ onHand: '10', unitCost: '100' }, [
      { quantity: '10', price: '120' }, // 20 kg → 110
      { quantity: '20', price: '90' }, // 40 kg → (20 × 110 + 20 × 90) / 40 = 100
    ]);
    assert.deepEqual(
      result.steps.map((step) => [step.onHandAfter.toString(), step.avgCostAfter.toString()]),
      [
        ['20', '110'],
        ['40', '100'],
      ],
    );
    assert.equal(result.onHand.toString(), '40');
    assert.equal(result.unitCost.toString(), '100');
  });

  it('ilk girişte maliyet alış fiyatı olur, sonrakiler ortalamaya girer', () => {
    const result = applyReceipts({ onHand: '0', unitCost: '75' }, [
      { quantity: '5', price: '80' },
      { quantity: '5', price: '90' },
    ]);
    assert.equal(result.steps[0].avgCostAfter.toString(), '80');
    assert.equal(result.unitCost.toString(), '85');
  });
});

describe('stockValue', () => {
  it('mevcut × maliyet, kuruşa yuvarlı', () => {
    assert.equal(stockValue('2.345', '208.1857').toFixed(2), '488.20');
  });

  it('eksi ya da 0 mevcut 0 değer', () => {
    assert.equal(stockValue('-3', '10').toString(), '0');
    assert.equal(stockValue('0', '10').toString(), '0');
  });
});

describe('applyDelta — giriş dışı hareket', () => {
  it('miktarı işaretli ekler, birim maliyeti değiştirmez, tutarı o anki ortalamayla yazar', () => {
    const out = applyDelta({ onHand: '10', unitCost: '42.5' }, '-2.5');
    assert.equal(out.onHand.toString(), '7.5');
    assert.equal(out.unitCost.toString(), '42.5');
    assert.equal(out.totalCost.toFixed(2), '-106.25');
    const back = applyDelta({ onHand: '7.5', unitCost: '42.5' }, '0.5');
    assert.equal(back.onHand.toString(), '8');
    assert.equal(back.totalCost.toFixed(2), '21.25');
  });
  it('eksiye inebilir (satış düşümü) ve sıfır miktarı reddeder', () => {
    assert.equal(applyDelta({ onHand: '1', unitCost: '3' }, '-4').onHand.toString(), '-3');
    assert.throws(() => applyDelta({ onHand: '1', unitCost: '3' }, '0'), RangeError);
  });
});

describe('countDifference — sayım farkı', () => {
  it('sayılan − mevcut; sayılmayan ve sıfır fark hareket üretmez', () => {
    assert.equal(countDifference('9.5', '10').toString(), '-0.5');
    assert.equal(countDifference('12', '10').toString(), '2');
    assert.equal(countDifference(null, '10'), null);
    assert.equal(countDifference('', '10'), null);
    assert.equal(countDifference('10', '10.000'), null);
  });
});

describe('saleRequirements / saleDeltas — reçeteden düşüm', () => {
  const recipes = new Map([
    ['m1', { recipeId: 'r1', perUnit: new Map([['dana', toDecimal('0.2')], ['yumurta', toDecimal('2')]]) }],
    ['m2', { recipeId: 'r2', perUnit: new Map([['dana', toDecimal('0.05')]]) }],
  ]);
  it('satılan + ikram + zayi çarpanıyla, ürün × malzeme anahtarında toplar; reçetesizi atlar', () => {
    const { required, skipped } = saleRequirements(
      [
        { menuItemId: 'm1', name: 'Köfte', sold: 3, comped: 1, wasted: 1 },
        { menuItemId: 'm2', name: 'Çorba', sold: 2, comped: 0, wasted: 0 },
        { menuItemId: 'm3', name: 'Kola', sold: 4, comped: 0, wasted: 0 },
        { menuItemId: 'm1', name: 'Köfte (0)', sold: 0, comped: 0, wasted: 0 },
      ],
      recipes,
    );
    assert.deepEqual([...required].map(([key, value]) => [key, value.toString()]), [
      ['m1:dana', '1'],
      ['m1:yumurta', '10'],
      ['m2:dana', '0.1'],
    ]);
    assert.deepEqual(skipped, ['Kola']);
  });
  it('yeniden yayında yalnız farkı yazar: tüketim artınca eksi, azalınca artı; aynıysa hareket yok', () => {
    const required = new Map([['m1:dana', toDecimal('0.6')], ['m1:yumurta', toDecimal('6')]]);
    const consumed = new Map([['m1:dana', toDecimal('1')], ['m1:yumurta', toDecimal('6')], ['m2:dana', toDecimal('0.1')]]);
    assert.deepEqual(
      saleDeltas(required, consumed).map((delta) => [delta.menuItemId, delta.stockItemId, delta.quantity.toString()]),
      [
        ['m1', 'dana', '0.4'],
        ['m2', 'dana', '0.1'],
      ],
    );
    assert.deepEqual(saleDeltas(new Map([['m1:dana', toDecimal('2')]]), new Map()).map((delta) => delta.quantity.toString()), ['-2']);
    assert.deepEqual(saleDeltas(required, required), []);
  });
});
