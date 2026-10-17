import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  banquetCalendarQuerySchema,
  cancellationFeePct,
  cancellationTierRanges,
  createEventSchema,
  createSessionSchema,
  isWallTime,
  policyTierIssues,
  receiveEventPaymentSchema,
  saveEventItemsSchema,
  updateEventSettingsSchema,
  voidEventPaymentSchema,
} from './banquet.js';

/**
 * Banket sözleşmesi (modül 37): iptal kademeleri (alt sınır, 0 gün zorunlu, okunur
 * aralık), duvar saati, oturum süresi, kalem kuralları, ödeme metninde kart numarası,
 * takvim penceresi.
 */

const tiers = [
  { daysBefore: 90, feePct: '10' },
  { daysBefore: 30, feePct: '50' },
  { daysBefore: 0, feePct: '100' },
];
const issuesOf = (result) => result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);

describe('iptal kademeleri', () => {
  it('eşik alt sınırdır: uyan en büyük eşik', () => {
    assert.equal(cancellationFeePct(tiers, 120), '10');
    assert.equal(cancellationFeePct(tiers, 90), '10');
    assert.equal(cancellationFeePct(tiers, 89), '50');
    assert.equal(cancellationFeePct(tiers, 30), '50');
    assert.equal(cancellationFeePct(tiers, 29), '100');
    assert.equal(cancellationFeePct(tiers, 0), '100');
    assert.equal(cancellationFeePct([], 5), '0');
  });

  it('okunur aralıklar (sözleşme ve politika ekranı aynı metin)', () => {
    assert.deepEqual(
      cancellationTierRanges(tiers).map((tier) => [tier.label, tier.feePct]),
      [
        ['90 gün ve daha fazla kala', '10'],
        ['30–89 gün kala', '50'],
        ['0–29 gün kala', '100'],
      ],
    );
    assert.deepEqual(
      cancellationTierRanges([{ daysBefore: 1, feePct: '50' }, { daysBefore: 0, feePct: '100' }]).map((tier) => tier.label),
      ['1 gün ve daha fazla kala', 'Etkinlik günü'],
    );
    assert.deepEqual(cancellationTierRanges([{ daysBefore: 7, feePct: '50' }, { daysBefore: 6, feePct: '60' }, { daysBefore: 0, feePct: '100' }]).map((tier) => tier.label), [
      '7 gün ve daha fazla kala',
      '6 gün kala',
      '0–5 gün kala',
    ]);
  });

  it('politika: 0 gün zorunlu, tekrar yok, yaklaştıkça bedel azalmaz', () => {
    assert.deepEqual(policyTierIssues(tiers), []);
    assert.deepEqual(policyTierIssues([]), []);
    assert.deepEqual(policyTierIssues([{ daysBefore: 60, feePct: '25' }, { daysBefore: 14, feePct: '100' }]), [
      { index: 1, field: 'daysBefore', message: 'En küçük eşik 0 gün olmalı (etkinliğe az kala yapılan iptal de bir kademeye düşmeli)' },
    ]);
    const shrinking = policyTierIssues([{ daysBefore: 30, feePct: '50' }, { daysBefore: 0, feePct: '40' }]);
    assert.equal(shrinking[0].field, 'feePct');
    assert.equal(policyTierIssues([{ daysBefore: 0, feePct: '50' }, { daysBefore: 0, feePct: '60' }])[0].message, 'Aynı gün iki kez yazılmış');
    const parsed = updateEventSettingsSchema.safeParse({ optionDays: 7, offerValidityDays: 14, depositPct: '30', requireSignedContract: true, cancellationTiers: [{ daysBefore: 14, feePct: '100' }] });
    assert.deepEqual(issuesOf(parsed), [['cancellationTiers.0.daysBefore', 'En küçük eşik 0 gün olmalı (etkinliğe az kala yapılan iptal de bir kademeye düşmeli)']]);
  });
});

describe('oturum ve takvim', () => {
  const session = { expectedUpdatedAt: new Date().toISOString(), title: 'Gala yemeği', venueId: randomUUID(), layout: 'BANQUET', pax: 300 };

  it('duvar saati: taşan gün / saat geçersiz', () => {
    assert.equal(isWallTime('2026-11-20T19:00'), true);
    assert.equal(isWallTime('2026-02-31T19:00'), false);
    assert.equal(isWallTime('2026-11-20T25:00'), false);
    assert.equal(isWallTime('2026-11-20 19:00'), false);
  });

  it('bitiş başlangıçtan sonra, en fazla 72 saat; gece yarısını aşan oturum geçerli', () => {
    assert.equal(createSessionSchema.safeParse({ ...session, startAt: '2026-11-20T19:30', endAt: '2026-11-21T01:00' }).success, true);
    assert.deepEqual(issuesOf(createSessionSchema.safeParse({ ...session, startAt: '2026-11-20T19:30', endAt: '2026-11-20T19:30' })), [['endAt', 'Bitiş başlangıçtan sonra olmalı']]);
    assert.deepEqual(issuesOf(createSessionSchema.safeParse({ ...session, startAt: '2026-11-20T08:00', endAt: '2026-11-23T08:01' })), [['endAt', 'Oturum en fazla 72 saat sürebilir']]);
    assert.equal(createSessionSchema.safeParse({ ...session, startAt: '', endAt: '2026-11-20T10:00' }).success, false);
  });

  it('takvim penceresi en fazla 31 gün', () => {
    assert.equal(banquetCalendarQuerySchema.safeParse({ from: '2026-11-01', to: '2026-12-01' }).success, true);
    assert.equal(banquetCalendarQuerySchema.safeParse({ from: '2026-11-01', to: '2026-12-02' }).success, false);
    assert.equal(banquetCalendarQuerySchema.safeParse({ from: '2026-11-10', to: '2026-11-09' }).success, false);
  });

  it('garanti kişi boşsa garanti yok (sıfır değil)', () => {
    const base = { name: 'Yıl sonu galası', type: 'GALA', clientId: randomUUID(), expectedPax: 300 };
    assert.equal(createEventSchema.parse({ ...base, guaranteedPax: '' }).guaranteedPax, null);
    assert.equal(createEventSchema.parse({ ...base, guaranteedPax: '280' }).guaranteedPax, 280);
    assert.equal(createEventSchema.safeParse({ ...base, guaranteedPax: '0' }).success, false);
  });
});

describe('kalem ve ödeme', () => {
  const item = { category: 'FNB', description: 'Gala menüsü', quantity: '1', unit: 'PERSON', perPerson: true, unitPrice: '1500', taxCategory: 'FNB' };

  it('ekipman kalemi ekipman ve oturum ister, adedi tam sayı; kişi başı kalemin birimi kişi', () => {
    const at = (overrides) => saveEventItemsSchema.safeParse({ expectedUpdatedAt: new Date().toISOString(), items: [{ ...item, ...overrides }] });
    assert.equal(at({}).success, true);
    assert.deepEqual(issuesOf(at({ unit: 'PIECE' })), [['items.0.unit', 'Kişi başı kalemin birimi kişidir']]);
    const equipment = at({ category: 'EQUIPMENT', perPerson: false, unit: 'PIECE', quantity: '1.5', equipmentId: randomUUID() });
    assert.deepEqual(issuesOf(equipment).map(([path]) => path).sort(), ['items.0.quantity', 'items.0.sessionId']);
    assert.deepEqual(issuesOf(at({ category: 'EQUIPMENT', perPerson: false, unit: 'PIECE' })), [['items.0.equipmentId', 'Ekipman seçin']]);
    assert.equal(at({ quantity: '1,25', perPerson: false, unit: 'HOUR' }).data.items[0].quantity, '1.25');
  });

  it('ödeme referansına / notuna kart numarası yazılmaz; nakit dışında referans zorunlu', () => {
    const base = { requestId: randomUUID(), kind: 'PAYMENT', amount: '30000' };
    assert.deepEqual(issuesOf(receiveEventPaymentSchema.safeParse({ ...base, method: 'CARD', reference: '4111 1111 1111 1111' })), [
      ['reference', 'Kart numarası yazılamaz; slip ya da provizyon numarasını yazın'],
    ]);
    assert.deepEqual(issuesOf(receiveEventPaymentSchema.safeParse({ ...base, method: 'CASH', note: 'kart 4111111111111111' })), [['note', 'Kart numarası yazılamaz']]);
    assert.equal(issuesOf(receiveEventPaymentSchema.safeParse({ ...base, method: 'TRANSFER' }))[0][0], 'reference');
    assert.equal(receiveEventPaymentSchema.parse({ ...base, method: 'CASH', reference: '  ' }).reference, null);
    assert.equal(receiveEventPaymentSchema.safeParse({ ...base, method: 'AGENCY', reference: 'X1' }).success, false);
    assert.equal(voidEventPaymentSchema.safeParse({ reason: 'Çift giriş 4111111111111111' }).success, false);
  });
});
