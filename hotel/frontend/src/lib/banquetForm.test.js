import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSessionSchema, createVenueSchema, saveEventItemsSchema, updateEventSchema } from '@hotelos/hotel-contracts';
import {
  changeItemRow,
  eventFormOf,
  eventPayloadOf,
  hundredthsText,
  itemErrorsByRow,
  itemRowOf,
  itemsPayloadOf,
  linePreview,
  newItemRow,
  planTotal,
  previewTotal,
  sessionFormOf,
  sessionPayloadOf,
  toHundredths,
  venueFormOf,
  venueLayouts,
  venuePayloadOf,
} from './banquetForm.js';

/** Banket formları (modül 37): kalem önizlemesi (tam sayı kuruş), oturum duvar saati, gövdeler şemadan geçer. */

const VERSION = '2026-10-17T10:00:00.000Z';
const UUID = '7a1d6d8e-4c1f-4f3e-9f50-2b8f0b8d1a11';

describe('kalem önizlemesi', () => {
  it('kuruş hassasiyeti: kayan nokta hatası yok, yarım kuruş sıfırdan uzağa', () => {
    assert.equal(toHundredths('1250,5'), 125050n);
    assert.equal(toHundredths('abc'), null);
    assert.equal(hundredthsText(-5n), '-0.05');
    assert.equal(linePreview({ perPerson: false, quantity: '3', unitPrice: '0.10', discountPct: '0' }, 0), '0.30');
    // 1500 × 280 kişi
    assert.equal(linePreview({ perPerson: true, quantity: '1', unitPrice: '1500', discountPct: '0' }, 280), '420000.00');
    // 33,33 × 1 × %10 indirim = 29,997 → 30,00
    assert.equal(linePreview({ perPerson: false, quantity: '1', unitPrice: '33.33', discountPct: '10' }, 0), '30.00');
    // 0,05 × 0,5 = 0,025 → 0,03
    assert.equal(linePreview({ perPerson: false, quantity: '0.5', unitPrice: '0.05', discountPct: '' }, 0), '0.03');
    assert.equal(linePreview({ perPerson: false, quantity: '', unitPrice: '10', discountPct: '0' }, 0), null);
    assert.equal(linePreview({ perPerson: false, quantity: '1', unitPrice: '10', discountPct: '101' }, 0), null);
    assert.equal(previewTotal(['0.10', '0.20', null]), '0.30');
  });
});

describe('formlar → gövde (sözleşmenin şeması kabul eder)', () => {
  it('etkinlik dosyası', () => {
    const form = eventFormOf({ name: 'Gala', type: 'GALA', client: { id: UUID, name: 'Öztürk' }, ownerEmail: 'a@b.co', expectedPax: 300, guaranteedPax: null, notes: null });
    assert.equal(form.guaranteedPax, '');
    const body = eventPayloadOf(form, VERSION);
    const parsed = updateEventSchema.parse(body);
    assert.equal(parsed.guaranteedPax, null);
    assert.equal(parsed.expectedPax, 300);
    assert.equal(eventPayloadOf({ ...form, client: null }).clientId, '');
  });

  it('oturum: gece yarısını aşan, boş hazırlık süresi salonun varsayılanı', () => {
    const form = { ...sessionFormOf(null, { day: '2026-11-20' }), title: 'Gala yemeği', venueId: UUID, layout: 'BANQUET', pax: '280', startTime: '19:30', endDate: '2026-11-21', endTime: '01:00' };
    const body = sessionPayloadOf(form, VERSION);
    assert.equal(body.startAt, '2026-11-20T19:30');
    assert.equal(body.endAt, '2026-11-21T01:00');
    assert.equal(body.setupMinutes, null);
    assert.equal(createSessionSchema.safeParse(body).success, true);
    const back = sessionFormOf({ title: 'X', venueId: UUID, layout: 'BANQUET', pax: 10, startLocal: '2026-11-20T19:30', endLocal: '2026-11-21T01:00', setupMinutes: 45, teardownMinutes: 30, notes: null }, { day: '' });
    assert.deepEqual([back.startDate, back.startTime, back.endDate, back.endTime, back.setupMinutes], ['2026-11-20', '19:30', '2026-11-21', '01:00', '45']);
    assert.deepEqual(venueLayouts({ capacities: [{ layout: 'BANQUET', capacity: 1 }, { layout: 'THEATER', capacity: 2 }] }), ['THEATER', 'BANQUET']);
  });

  it('kalemler: türe bağlı alanlar, kişi başında miktar yok sayılır, hata satıra düşer', () => {
    let row = newItemRow('FNB');
    assert.deepEqual([row.perPerson, row.unit, row.taxCategory], [true, 'PERSON', 'FNB']);
    row = changeItemRow(row, 'category', 'EQUIPMENT');
    assert.deepEqual([row.perPerson, row.unit, row.taxCategory], [false, 'PIECE', 'OTHER']);
    row = changeItemRow({ ...row, equipmentId: UUID, sessionId: UUID }, 'category', 'SERVICE');
    assert.equal(row.equipmentId, '');
    const menu = { ...newItemRow('FNB'), description: 'Menü', unitPrice: '1500', quantity: '7' };
    const body = itemsPayloadOf([menu, { ...row, description: 'Dekor', unitPrice: '2500', discountPct: '' }], VERSION);
    assert.equal(body.items[0].quantity, '1');
    assert.equal(body.items[1].discountPct, '0');
    assert.equal(saveEventItemsSchema.safeParse(body).success, true);
    const errors = itemErrorsByRow({ 'items.1.unitPrice': 'Fiyat geçersiz', expectedUpdatedAt: 'Eski' }, [menu, row]);
    assert.deepEqual(errors, { [row.key]: { unitPrice: 'Fiyat geçersiz' }, _: { expectedUpdatedAt: 'Eski' } });
    const saved = itemRowOf({ category: 'VENUE', description: 'Salon', sessionId: null, equipmentId: null, perPerson: false, quantity: '1', unit: 'DAY', unitPrice: '80000.00', discountPct: '0', taxCategory: 'OTHER' });
    assert.equal(saved.sessionId, '');
  });

  it('ödeme planı toplamı ve salon formu', () => {
    assert.equal(planTotal([{ amount: '150900' }, { amount: '352100,5' }, { amount: 'x' }]), '503000.50');
    const venue = { code: 'BALO', name: 'Balo', description: null, parentId: null, areaSqm: null, hourlyRate: null, halfDayRate: null, dayRate: '80000.00', setupMinutes: 60, teardownMinutes: 60, status: 'ACTIVE', capacities: [{ layout: 'BANQUET', capacity: 400 }] };
    const form = venueFormOf(venue);
    form.capacities.push({ layout: 'THEATER', capacity: '' });
    const body = venuePayloadOf(form);
    assert.equal(body.capacities.length, 1);
    assert.equal(body.parentId, null);
    assert.equal(createVenueSchema.safeParse(body).success, true);
    assert.equal(venuePayloadOf(form, VERSION).status, 'ACTIVE');
  });
});
