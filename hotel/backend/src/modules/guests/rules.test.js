import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import { GUEST_MERGE_SPECIAL_MODELS, GUEST_REASSIGN_MODELS, mergeTags } from './rules.js';

describe('CRM rules', () => {
  it('birleştirme guestId taşıyan her tabloyu taşır (şemadan)', () => {
    const lower = (name) => name[0].toLowerCase() + name.slice(1);
    const withGuest = Prisma.dmmf.datamodel.models.filter((model) => model.fields.some((field) => field.name === 'guestId')).map((model) => lower(model.name));
    assert.deepEqual([...withGuest].sort(), [...GUEST_REASSIGN_MODELS, ...GUEST_MERGE_SPECIAL_MODELS].sort());
  });

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
