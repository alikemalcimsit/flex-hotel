import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAgencyBonusRuleSchema, updateAgencyBonusRuleSchema } from '@hotelos/hotel-contracts';
import { EMPTY_BONUS_FORM, addTier, describeTiers, formOf, payloadOf, previewPayloadOf, removeTier, tierErrorsByRow } from './agencyBonusForm.js';

/** Acente prim kuralı formu (modül 35): kural ↔ form, gövde, önizleme, kademe cümleleri. */

const AGENCY = { id: '7a1d6d8e-4c1f-4f3e-9f50-2b8f0b8d1a11', code: 'ATLAS', name: 'Atlas Turizm' };

const RULE = {
  id: 'r1',
  agency: { ...AGENCY, status: 'ACTIVE' },
  name: 'Yaz ciro primi',
  startDate: '2027-05-01',
  endDate: '2027-10-31',
  metric: 'REVENUE',
  mode: 'EXCESS',
  target: '2000000.00',
  tiers: [
    { threshold: '1500000.50', ratePct: '1.5' },
    { threshold: '2500000', ratePct: '3' },
  ],
  roomTypeIds: ['3c9a4b0e-2a6d-4b55-8f1e-5d7c0e9b2f22'],
  maxBonus: '50000.00',
  notes: null,
  updatedAt: '2027-04-01T10:00:00.000Z',
};

describe('kural ↔ form', () => {
  it('sunucu kuralı Türkçe yazımlı forma döner, gövde sözleşmeden geçer', () => {
    const form = formOf(RULE);
    assert.equal(form.target, '2000000');
    assert.deepEqual(form.tiers, [{ threshold: '1500000,5', ratePct: '1,5' }, { threshold: '2500000', ratePct: '3' }]);
    assert.equal(form.maxBonus, '50000');
    const payload = payloadOf(form, RULE.updatedAt);
    assert.equal(payload.agencyId, undefined, 'düzenlemede acente gitmez');
    const parsed = updateAgencyBonusRuleSchema.parse(payload);
    assert.deepEqual(parsed.tiers, [{ threshold: '1500000.5', ratePct: '1.5' }, { threshold: '2500000', ratePct: '3' }]);
    assert.equal(parsed.maxBonus, '50000');
  });

  it('yeni kural: seçili acente ve boş tavan (tavansız)', () => {
    const form = { ...formOf(null, { agency: AGENCY }), name: 'Kış gece primi', startDate: '2027-11-01', endDate: '2028-03-31', target: '800', tiers: [{ threshold: '600', ratePct: '1' }] };
    const payload = payloadOf(form);
    assert.equal(payload.agencyId, AGENCY.id);
    assert.equal(payload.maxBonus, null);
    assert.ok(createAgencyBonusRuleSchema.safeParse(payload).success);
  });
});

describe('önizleme gövdesi', () => {
  it('eksik formda önizleme yok; boş kademe satırı atlanır', () => {
    assert.equal(previewPayloadOf(EMPTY_BONUS_FORM), null);
    const base = { ...formOf(null, { agency: AGENCY }), startDate: '2027-05-01', endDate: '2027-10-31', target: '1000' };
    assert.equal(previewPayloadOf(base), null, 'dolu kademe yok');
    assert.equal(previewPayloadOf({ ...base, endDate: '2027-04-01', tiers: [{ threshold: '10', ratePct: '1' }] }), null, 'ters dönem');
    const preview = previewPayloadOf({ ...base, tiers: [{ threshold: '500', ratePct: '1' }, { threshold: '', ratePct: '' }] });
    assert.deepEqual(preview.tiers, [{ threshold: '500', ratePct: '1' }]);
    assert.equal(preview.agencyId, AGENCY.id);
  });
});

describe('kademe satırları', () => {
  it('ekleme üst sınırda durur, silme son satırı bırakır', () => {
    let tiers = [{ threshold: '1', ratePct: '1' }];
    for (let index = 0; index < 20; index += 1) tiers = addTier(tiers);
    assert.equal(tiers.length, 10);
    assert.equal(removeTier([{ threshold: '1', ratePct: '1' }], 0).length, 1);
    assert.deepEqual(removeTier([{ threshold: '1', ratePct: '1' }, { threshold: '2', ratePct: '2' }], 0), [{ threshold: '2', ratePct: '2' }]);
  });

  it('doğrulama hataları satırlara dağılır', () => {
    const rows = tierErrorsByRow({ 'tiers.1.threshold': 'Eşik küçük', 'tiers.1.ratePct': 'Oran düşük', target: 'Hedef yok' });
    assert.deepEqual([...rows.entries()], [[1, { threshold: 'Eşik küçük', ratePct: 'Oran düşük' }]]);
  });
});

describe('kademe cümleleri', () => {
  it('tüm üretime', () => {
    const text = describeTiers({ metric: 'NIGHTS', mode: 'WHOLE', tiers: [{ threshold: '1500', ratePct: '1' }, { threshold: '2000', ratePct: '2,5' }], maxBonus: null }, 'TRY');
    assert.deepEqual(text.lines, ['1.500 gece ve üstü → bütün ciroya %1', '2.000 gece ve üstü → bütün ciroya %2,5']);
    assert.equal(text.headline, 'Tüm üretime (geriye dönük)');
  });

  it('dilimli ve tavan', () => {
    const text = describeTiers(RULE, 'TRY');
    assert.deepEqual(text.lines, [
      '1.500.000,5 TRY – 2.500.000 TRY arası → bu dilime %1,5',
      '2.500.000 TRY üstü → aşan kısma %3',
      'Prim en fazla 50.000 TRY (tavan)',
    ]);
  });
});
