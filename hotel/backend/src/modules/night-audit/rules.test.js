import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adr, occupancyPct, reconcileCash, revpar } from './rules.js';

describe('night-audit rules', () => {
  describe('occupancyPct', () => {
    it('satılan / satılabilir × 100', () => {
      assert.equal(occupancyPct(30, 40), '75.00');
    });
    it('satılabilir 0 ise 0', () => {
      assert.equal(occupancyPct(5, 0), '0.00');
    });
    it('tam dolu', () => {
      assert.equal(occupancyPct(40, 40), '100.00');
    });
  });

  describe('adr', () => {
    it('oda geliri / satılan', () => {
      assert.equal(adr('30000.00', 30), '1000.00');
    });
    it('satılan 0 ise 0', () => {
      assert.equal(adr('0.00', 0), '0.00');
    });
  });

  describe('revpar', () => {
    it('oda geliri / satılabilir', () => {
      assert.equal(revpar('30000.00', 40), '750.00');
    });
    it('satılabilir 0 ise 0', () => {
      assert.equal(revpar('100.00', 0), '0.00');
    });
  });

  describe('reconcileCash', () => {
    it('yöntem bazında beklenen − sayılan = fark; fazla artı', () => {
      const result = reconcileCash(
        [
          { method: 'CASH', expected: '1000.00' },
          { method: 'CARD', expected: '2000.00' },
        ],
        [
          { method: 'CASH', counted: '1050.00' },
          { method: 'CARD', counted: '2000.00' },
        ],
      );
      const cash = result.counts.find((row) => row.method === 'CASH');
      assert.equal(cash.variance, '50.00');
      assert.equal(result.expectedTotal, '3000.00');
      assert.equal(result.countedTotal, '3050.00');
      assert.equal(result.variance, '50.00');
    });

    it('sayılmayan yöntemi 0 varsayar (eksik = negatif fark)', () => {
      const result = reconcileCash([{ method: 'CASH', expected: '500.00' }], []);
      assert.equal(result.counts[0].counted, '0.00');
      assert.equal(result.counts[0].variance, '-500.00');
      assert.equal(result.variance, '-500.00');
    });

    it('beklenen yoksa sayılan fazlalık olarak görünür', () => {
      const result = reconcileCash([], [{ method: 'CASH', counted: '120.00' }]);
      assert.equal(result.counts[0].expected, '0.00');
      assert.equal(result.variance, '120.00');
    });

    it('hiç hareket yoksa her şey sıfır', () => {
      const result = reconcileCash([], []);
      assert.deepEqual(result.counts, []);
      assert.equal(result.variance, '0.00');
    });
  });
});
