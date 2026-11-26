import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pointsText, pointsTone, signedPoints, tierProgress, tierTone } from './loyaltyFormat.js';

describe('sadakat yazımı', () => {
  it('puan metni binlik ayraçlı', () => {
    assert.equal(pointsText(1250), '1.250 puan');
    assert.equal(pointsText(0), '0 puan');
    assert.equal(pointsText(null), '0 puan');
  });

  it('işaretli puan ve rengi', () => {
    assert.equal(signedPoints(120), '+120');
    assert.equal(signedPoints(-1500), '−1.500');
    assert.equal(signedPoints(0), '0');
    assert.equal(pointsTone(5), 'text-success-ink');
    assert.equal(pointsTone(-5), 'text-sec-strong');
  });

  it('seviye tonu listedeki sıraya, yoksa bilinen koda göre', () => {
    const tiers = [{ code: 'B', minPoints: 500 }, { code: 'A', minPoints: 0 }];
    assert.equal(tierTone('A', tiers), 'neutral');
    assert.equal(tierTone('B', tiers), 'sky');
    assert.equal(tierTone('GOLD'), 'warning');
    assert.equal(tierTone('XYZ'), 'info');
    assert.equal(tierTone(null), 'neutral');
  });

  it('ilerleme yüzdesi', () => {
    assert.equal(tierProgress(500, 500, 0), 50);
    assert.equal(tierProgress(1200, 1800, 1000), 10);
    assert.equal(tierProgress(4000, 0), 100);
  });
});
