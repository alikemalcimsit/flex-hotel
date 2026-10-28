import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compatibleUnits,
  courseGuests,
  createBanquetPurchaseRequestSchema,
  createRecipeSchema,
  fnbNeedsQuerySchema,
  leadText,
  lineUnitError,
  menuFinalizeDueDay,
  menuGuests,
  productionGuests,
  productionPlanQuerySchema,
  productionPortions,
  saveEventMenuSchema,
  serveTimeError,
  sortAllergens,
  unitsCompatible,
  updateEventSettingsSchema,
  yieldUnitError,
} from './index.js';

describe('mutfak birimleri', () => {
  it('aileler: kütle, hacim, adet, porsiyon', () => {
    assert.equal(unitsCompatible('KG', 'G'), true);
    assert.equal(unitsCompatible('ML', 'L'), true);
    assert.equal(unitsCompatible('KG', 'L'), false);
    assert.equal(unitsCompatible('PIECE', 'PORTION'), false);
    assert.deepEqual(compatibleUnits('KG'), ['KG', 'G']);
    assert.deepEqual(compatibleUnits('PORTION'), ['PORTION']);
    assert.equal(lineUnitError('G', 'KG'), null);
    assert.match(lineUnitError('ML', 'KG'), /çevrilemez/);
  });

  it('reçete türü ↔ verim birimi', () => {
    assert.equal(yieldUnitError('DISH', 'PORTION'), null);
    assert.ok(yieldUnitError('DISH', 'KG'));
    assert.equal(yieldUnitError('PREP', 'L'), null);
    assert.ok(yieldUnitError('PREP', 'PORTION'));
    assert.ok(yieldUnitError('PREP', 'G'), 'ara ürün verimi g değil kg yazılır');
  });

  it('alerjen sırası sabit; hazırlık süresi metni', () => {
    assert.deepEqual(sortAllergens(['SULPHITES', 'GLUTEN', 'MILK', 'GLUTEN']), ['GLUTEN', 'MILK', 'SULPHITES']);
    assert.equal(leadText(0), 'servisle birlikte');
    assert.equal(leadText(90), '1 sa 30 dk');
    assert.equal(leadText(1500), '1 gün 1 sa');
  });
});

describe('porsiyon ve kişi (tam sayı aritmetiği)', () => {
  it('menünün kişisi: sabit yoksa faturalanacak kişi', () => {
    assert.equal(menuGuests(null, 350), 350);
    assert.equal(menuGuests(undefined, 350), 350);
    assert.equal(menuGuests(120, 350), 120);
  });

  it('hazırlanacak kişi yukarı yuvarlanır; tam bölünende fazla porsiyon çıkmaz', () => {
    assert.equal(productionGuests(350, '5'), 368); // 367,5
    assert.equal(productionGuests(400, '5'), 420); // tam
    assert.equal(productionGuests(350, '0'), 350);
    assert.equal(productionGuests(1, '30'), 2); // 1,3
  });

  it('kayan nokta hatası yok: 0,3 × 350 × 1,00 = 105 (106 değil)', () => {
    assert.equal(productionPortions(350, '0.3', '0'), 105);
    assert.equal(productionPortions(350, '0.3', '5'), 111); // 110,25
    assert.equal(productionPortions(1000, '0.001', '0'), 1);
    assert.equal(productionPortions(10_000, '10', '30'), 130_000);
    assert.equal(productionPortions(0, '1', '5'), 0);
  });

  it('kurs dağılımı: hepsi, seçmeli (kalan), seçmeli (kalan yok)', () => {
    assert.deepEqual(courseGuests('ALL', [{}, {}], 200), { counts: [200, 200], issue: null });
    assert.deepEqual(courseGuests('CHOICE', [{ guestCount: null }, { guestCount: 30 }, { guestCount: 5 }], 200), { counts: [165, 30, 5], issue: null });
    const over = courseGuests('CHOICE', [{ guestCount: null }, { guestCount: 150 }, { guestCount: 80 }], 200);
    assert.deepEqual(over.counts, [0, 150, 80]);
    assert.match(over.issue, /aşıyor/);
    assert.deepEqual(courseGuests('CHOICE', [{ guestCount: 120 }, { guestCount: 80 }], 200), { counts: [120, 80], issue: null });
    assert.match(courseGuests('CHOICE', [{ guestCount: 120 }, { guestCount: 70 }], 200).issue, /tutmuyor/);
  });

  it('servis saati oturumun içinde; kesinleştirme son günü', () => {
    const session = { startLocal: '2026-11-14T19:00', endLocal: '2026-11-15T01:00' };
    assert.equal(serveTimeError('2026-11-14T20:30', session), null);
    assert.equal(serveTimeError('2026-11-15T01:00', session), null);
    assert.ok(serveTimeError('2026-11-14T18:59', session));
    assert.ok(serveTimeError('bozuk', session));
    assert.equal(menuFinalizeDueDay('2026-11-14', 7), '2026-11-07');
    assert.equal(menuFinalizeDueDay('2026-03-02', 2), '2026-02-28');
    assert.equal(menuFinalizeDueDay('2026-11-14', 0), null);
    assert.equal(menuFinalizeDueDay(null, 7), null);
  });
});

describe('şemalar', () => {
  const recipeId = '0b6f3f7e-9a43-4b8e-9a43-4b8e9a434b8e';
  const otherId = '1c7f4f8e-9a43-4b8e-9a43-4b8e9a434b8e';
  const sessionId = '2d8f5f9e-9a43-4b8e-9a43-4b8e9a434b8e';
  const menu = (courses) => ({
    expectedUpdatedAt: new Date().toISOString(),
    sessionId,
    name: 'Düğün menüsü',
    serveAt: '2026-11-14T20:00',
    pricePerPerson: '1450',
    courses,
  });

  it('etkinlik menüsü: seçmeli kursta tek "kalan", hepside kişi yok, aynı yemek iki kez yok', () => {
    const okay = saveEventMenuSchema.safeParse(
      menu([
        { name: 'Ana yemek', mode: 'CHOICE', dishes: [{ recipeId }, { recipeId: otherId, guestCount: 40 }] },
        { name: 'Çorba', mode: 'ALL', dishes: [{ recipeId, portionsPerGuest: '1,5' }] },
      ]),
    );
    assert.equal(okay.success, true, JSON.stringify(okay.error?.issues));
    assert.equal(okay.data.courses[1].dishes[0].portionsPerGuest, '1.5');
    assert.equal(okay.data.guests, null);
    assert.equal(okay.data.discountPct, '0');

    const twoRemainders = saveEventMenuSchema.safeParse(menu([{ name: 'Ana', mode: 'CHOICE', dishes: [{ recipeId }, { recipeId: otherId }] }]));
    assert.equal(twoRemainders.success, false);
    const countInAll = saveEventMenuSchema.safeParse(menu([{ name: 'Meze', mode: 'ALL', dishes: [{ recipeId, guestCount: 10 }] }]));
    assert.equal(countInAll.success, false);
    const duplicate = saveEventMenuSchema.safeParse(menu([{ name: 'Meze', mode: 'ALL', dishes: [{ recipeId }, { recipeId }] }]));
    assert.equal(duplicate.success, false);
    const lonelyChoice = saveEventMenuSchema.safeParse(menu([{ name: 'Ana', mode: 'CHOICE', dishes: [{ recipeId }] }]));
    assert.equal(lonelyChoice.success, false);
    const badTime = saveEventMenuSchema.safeParse({ ...menu([{ name: 'Meze', mode: 'ALL', dishes: [{ recipeId }] }]), serveAt: '2026-02-30T20:00' });
    assert.equal(badTime.success, false);
  });

  it('reçete: yemek porsiyon verir, ara ürün menüye bağlanmaz, satırın tek kaynağı olur', () => {
    const line = { stockItemId: recipeId, quantity: '0,25', unit: 'KG' };
    const dish = createRecipeSchema.safeParse({ name: 'Kuzu incik', kind: 'DISH', yieldQuantity: '10', yieldUnit: 'PORTION', lines: [line] });
    assert.equal(dish.success, true, JSON.stringify(dish.error?.issues));
    assert.equal(dish.data.lines[0].quantity, '0.25');
    assert.equal(dish.data.lines[0].wastePct, '0');
    assert.equal(createRecipeSchema.safeParse({ name: 'Demi', kind: 'PREP', yieldQuantity: '5', yieldUnit: 'PORTION', lines: [line] }).success, false);
    assert.equal(createRecipeSchema.safeParse({ name: 'Demi', kind: 'PREP', yieldQuantity: '5', yieldUnit: 'L', menuItemId: otherId, lines: [line] }).success, false);
    assert.equal(createRecipeSchema.safeParse({ name: 'X', kind: 'DISH', yieldQuantity: '1', yieldUnit: 'PORTION', lines: [{ ...line, subRecipeId: otherId }] }).success, false);
    assert.equal(createRecipeSchema.safeParse({ name: 'Xy', kind: 'DISH', yieldQuantity: '1', yieldUnit: 'PORTION', lines: [{ ...line, wastePct: '95' }] }).success, false);
  });

  it('aralıklar: ihtiyaç ≤ 31 gün, üretim ≤ 7 gün, takvimde olmayan gün yok', () => {
    assert.equal(fnbNeedsQuerySchema.safeParse({ from: '2026-11-01', to: '2026-12-01' }).success, true);
    assert.equal(fnbNeedsQuerySchema.safeParse({ from: '2026-11-01', to: '2026-12-02' }).success, false);
    assert.equal(fnbNeedsQuerySchema.safeParse({ from: '2026-11-02', to: '2026-11-01' }).success, false);
    assert.equal(productionPlanQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-07' }).success, true);
    assert.equal(productionPlanQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-08' }).success, false);
    assert.equal(productionPlanQuerySchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success, false);
  });

  it('satın alma talebi: etkinlik ya da aralık; aynı malzeme iki kez yok', () => {
    const line = { stockItemId: recipeId, quantity: '12,5', expectedShortfall: '12.5' };
    assert.equal(createBanquetPurchaseRequestSchema.safeParse({ eventId: otherId, lines: [line] }).success, true);
    assert.equal(createBanquetPurchaseRequestSchema.safeParse({ from: '2026-11-01', to: '2026-11-07', lines: [line] }).success, true);
    assert.equal(createBanquetPurchaseRequestSchema.safeParse({ lines: [line] }).success, false);
    assert.equal(createBanquetPurchaseRequestSchema.safeParse({ eventId: otherId, from: '2026-11-01', lines: [line] }).success, false);
    assert.equal(createBanquetPurchaseRequestSchema.safeParse({ eventId: otherId, lines: [line, line] }).success, false);
    assert.equal(createBanquetPurchaseRequestSchema.safeParse({ eventId: otherId, lines: [{ ...line, quantity: '0' }] }).success, false);
  });

  it('banket politikası: yeni alanlar gönderilmezse kayıtlı değer korunur, sınırlar', () => {
    const base = { optionDays: 7, offerValidityDays: 14, depositPct: '30', requireSignedContract: true, cancellationTiers: [{ daysBefore: 0, feePct: '100' }] };
    const old = updateEventSettingsSchema.safeParse(base);
    assert.equal(old.success, true);
    assert.equal(old.data.overproductionPct, undefined);
    assert.equal(updateEventSettingsSchema.safeParse({ ...base, overproductionPct: '5', menuFinalizeDays: 7 }).success, true);
    assert.equal(updateEventSettingsSchema.safeParse({ ...base, overproductionPct: '31' }).success, false);
    assert.equal(updateEventSettingsSchema.safeParse({ ...base, menuFinalizeDays: 61 }).success, false);
  });
});
