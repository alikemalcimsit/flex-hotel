import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyReceipts, movingAverageCost, stockValue } from './rules.js';

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
