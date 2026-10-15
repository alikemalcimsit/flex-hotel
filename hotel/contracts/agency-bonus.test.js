import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_BONUS_PERIOD_DAYS,
  MAX_BONUS_RATE_PCT,
  MAX_BONUS_TIERS,
  agencyBonusListQuerySchema,
  bonusPeriodDays,
  bonusPhase,
  bonusQuantityIssue,
  bonusTierIssues,
  createAgencyBonusRuleSchema,
  markAgencyBonusPaidSchema,
  reopenAgencyBonusSchema,
  updateAgencyBonusRuleSchema,
} from './agency-bonus.js';

/** Acente bonusu sözleşmesi (modül 35): kademe tutarlılığı, dönem, hedef, tavan, ödeme. */

const AGENCY = '7a1d6d8e-4c1f-4f3e-9f50-2b8f0b8d1a11';
const TYPE = '3c9a4b0e-2a6d-4b55-8f1e-5d7c0e9b2f22';

const valid = (overrides = {}) => ({
  agencyId: AGENCY,
  name: 'Yaz 2027 gece primi',
  startDate: '2027-05-01',
  endDate: '2027-10-31',
  metric: 'NIGHTS',
  mode: 'WHOLE',
  target: '2000',
  tiers: [
    { threshold: '1500', ratePct: '1' },
    { threshold: '2000', ratePct: '2' },
  ],
  roomTypeIds: [],
  maxBonus: '',
  notes: '',
  ...overrides,
});

const issuesOf = (schema, input) => {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe('kademe tutarlılığı', () => {
  it('eşikler kesin artan, oranlar azalmaz', () => {
    assert.deepEqual(bonusTierIssues([{ threshold: '10', ratePct: '1' }, { threshold: '20', ratePct: '1' }], 'NIGHTS'), []);
    const issues = bonusTierIssues(
      [
        { threshold: '20', ratePct: '2' },
        { threshold: '20', ratePct: '3' },
        { threshold: '30', ratePct: '1' },
      ],
      'NIGHTS',
    );
    assert.deepEqual(
      issues.map((issue) => [issue.index, issue.field]),
      [
        [1, 'threshold'],
        [2, 'ratePct'],
      ],
    );
  });

  it('gece eşiği tam sayı, ciro eşiği kuruşlu tutar', () => {
    assert.equal(bonusQuantityIssue('NIGHTS', '12.5'), 'Gece sayısı tam sayı olmalı');
    assert.equal(bonusQuantityIssue('NIGHTS', '0'), 'En az 1 gece olmalı');
    assert.equal(bonusQuantityIssue('NIGHTS', '1200'), null);
    assert.equal(bonusQuantityIssue('REVENUE', '1500000.25'), null);
    assert.match(bonusQuantityIssue('REVENUE', '1500000.255'), /2 ondalık/);
    assert.match(bonusQuantityIssue('REVENUE', '0'), /0'dan büyük/);
    assert.match(bonusQuantityIssue('REVENUE', '20000000000'), /çok yüksek/);
  });
});

describe('kural şeması', () => {
  it('geçerli kural; virgüllü oran ve tutar kabul edilir, boş tavan = tavansız', () => {
    const parsed = createAgencyBonusRuleSchema.parse(
      valid({ metric: 'REVENUE', target: '2.000.000'.replace(/\./g, ''), tiers: [{ threshold: '1500000,50', ratePct: '1,5' }], maxBonus: '' }),
    );
    assert.equal(parsed.tiers[0].threshold, '1500000.5');
    assert.equal(parsed.tiers[0].ratePct, '1.5');
    assert.equal(parsed.maxBonus, null);
    assert.deepEqual(parsed.roomTypeIds, []);
  });

  it('dönem: bitiş başlangıçtan önce olamaz, en fazla iki yıl', () => {
    assert.match(issuesOf(createAgencyBonusRuleSchema, valid({ endDate: '2027-04-30' })).join(), /endDate: Bitiş/);
    assert.equal(bonusPeriodDays('2027-01-01', '2028-12-31'), MAX_BONUS_PERIOD_DAYS);
    assert.deepEqual(issuesOf(createAgencyBonusRuleSchema, valid({ startDate: '2027-01-01', endDate: '2028-12-31' })), []);
    assert.match(issuesOf(createAgencyBonusRuleSchema, valid({ startDate: '2027-01-01', endDate: '2029-01-01' })).join(), /en fazla 731 gün/);
  });

  it('hedef ve eşik ölçüte uygun olmalı; hata ilgili hücreye bağlanır', () => {
    const issues = issuesOf(createAgencyBonusRuleSchema, valid({ target: '1500.5', tiers: [{ threshold: '10.5', ratePct: '1' }] }));
    assert.ok(issues.some((issue) => issue.startsWith('target: Hedef: gece sayısı tam sayı')));
    assert.ok(issues.some((issue) => issue.startsWith('tiers.0.threshold: Gece sayısı tam sayı')));
  });

  it('oran sıfırdan büyük, üst sınırın altında; kademe sayısı sınırlı', () => {
    assert.match(issuesOf(createAgencyBonusRuleSchema, valid({ tiers: [{ threshold: '10', ratePct: '0' }] })).join(), /0'dan büyük/);
    assert.match(issuesOf(createAgencyBonusRuleSchema, valid({ tiers: [{ threshold: '10', ratePct: String(MAX_BONUS_RATE_PCT + 1) }] })).join(), /en fazla %50/);
    const many = Array.from({ length: MAX_BONUS_TIERS + 1 }, (_, index) => ({ threshold: String(index + 1), ratePct: '1' }));
    assert.match(issuesOf(createAgencyBonusRuleSchema, valid({ tiers: many })).join(), /En fazla 10 kademe/);
    assert.match(issuesOf(createAgencyBonusRuleSchema, valid({ tiers: [] })).join(), /En az bir kademe/);
  });

  it('oda tipi süzgeci tekrarsız; tavan pozitif', () => {
    assert.match(issuesOf(createAgencyBonusRuleSchema, valid({ roomTypeIds: [TYPE, TYPE] })).join(), /iki kez/);
    assert.match(issuesOf(createAgencyBonusRuleSchema, valid({ maxBonus: '0' })).join(), /0'dan büyük/);
    assert.equal(createAgencyBonusRuleSchema.parse(valid({ maxBonus: '25000,5' })).maxBonus, '25000.5');
  });

  it('boş ya da bozuk tarih çökmeden alan hatası olur (dönem denetimi çalışmaz)', () => {
    const empty = issuesOf(createAgencyBonusRuleSchema, valid({ startDate: '', endDate: '' }));
    assert.deepEqual(empty.filter((issue) => /Date/.test(issue)), ['startDate: Tarih seçin', 'endDate: Tarih seçin']);
    assert.deepEqual(issuesOf(createAgencyBonusRuleSchema, valid({ endDate: '2027-13-45' })), ['endDate: Geçersiz tarih']);
    assert.deepEqual(issuesOf(agencyBonusListQuerySchema, { from: 'abc', to: '2027-01-01' }), ['from: Geçersiz tarih']);
  });

  it('güncellemede acente gönderilmez, sürüm zorunlu', () => {
    const { agencyId, ...rest } = valid();
    assert.match(issuesOf(updateAgencyBonusRuleSchema, rest).join(), /expectedUpdatedAt/);
    assert.ok(updateAgencyBonusRuleSchema.safeParse({ ...rest, expectedUpdatedAt: new Date().toISOString() }).success);
  });
});

describe('evre ve rapor süzgeci', () => {
  it('iş gününe göre başlamadı / sürüyor / bitti', () => {
    const period = { startDate: '2027-05-01', endDate: '2027-10-31' };
    assert.equal(bonusPhase(period, '2027-04-30'), 'UPCOMING');
    assert.equal(bonusPhase(period, '2027-05-01'), 'RUNNING');
    assert.equal(bonusPhase(period, '2027-10-31'), 'RUNNING');
    assert.equal(bonusPhase(period, '2027-11-01'), 'ENDED');
  });

  it('rapor dönemi ters ya da uzun olamaz', () => {
    assert.match(issuesOf(agencyBonusListQuerySchema, { from: '2027-05-01', to: '2027-04-01' }).join(), /Bitiş/);
    assert.match(issuesOf(agencyBonusListQuerySchema, { from: '2020-01-01', to: '2027-04-01' }).join(), /en fazla 1100/);
  });
});

describe('ödeme ve yeniden açma', () => {
  it('belge numarası ve gerekçe zorunlu', () => {
    const version = new Date().toISOString();
    assert.match(issuesOf(markAgencyBonusPaidSchema, { expectedUpdatedAt: version, paidAt: '2027-11-15', paymentRef: ' ' }).join(), /en az 2/);
    assert.ok(markAgencyBonusPaidSchema.safeParse({ expectedUpdatedAt: version, paidAt: '2027-11-15', paymentRef: 'DK-2027-118' }).success);
    assert.match(issuesOf(reopenAgencyBonusSchema, { expectedUpdatedAt: version, reason: 'yok' }).join(), /en az 5/);
  });
});
