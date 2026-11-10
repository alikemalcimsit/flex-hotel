import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeTags } from './rules.js';

describe('CRM rules', () => {
  describe('mergeTags', () => {
    it('iki listeyi birleştirir, sıra korunur', () => {
      assert.deepEqual(mergeTags(['VIP', 'Sadık'], ['Kurumsal']), ['VIP', 'Sadık', 'Kurumsal']);
    });

    it('tekrarları (büyük/küçük harf duyarsız) atar', () => {
      assert.deepEqual(mergeTags(['VIP'], ['vip', 'Sorunlu']), ['VIP', 'Sorunlu']);
    });

    it('boş / undefined listelerle çalışır', () => {
      assert.deepEqual(mergeTags(), []);
      assert.deepEqual(mergeTags(['A'], []), ['A']);
      assert.deepEqual(mergeTags([], ['B']), ['B']);
    });

    it('boş etiketleri atar', () => {
      assert.deepEqual(mergeTags(['  ', 'VIP'], ['']), ['VIP']);
    });
  });
});
