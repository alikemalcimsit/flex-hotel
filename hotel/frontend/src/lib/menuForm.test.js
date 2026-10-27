import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { saveEventMenuSchema, updateBanquetMenuSchema } from '@hotelos/hotel-contracts';
import { catalogFormOf, catalogPayloadOf, coursePreview, dishOf, eventMenuFormOf, eventMenuFromCatalog, eventMenuPayloadOf, moveItem } from './menuForm.js';
import { foodCostTone, pctText, quantityText } from './kitchenFormat.js';
import { needsListHtml, productionPlanHtml, purchaseRequestHtml } from './kitchenPrint.js';

const R1 = '0b6f3f7e-9a43-4b8e-9a43-4b8e9a434b8e';
const R2 = '1c7f4f8e-9a43-4b8e-9a43-4b8e9a434b8e';
const SESSION = '2d8f5f9e-9a43-4b8e-9a43-4b8e9a434b8e';

const catalog = {
  id: '3e9f6fae-9a43-4b8e-9a43-4b8e9a434b8e',
  code: 'DUGUN-A',
  name: 'Düğün menüsü A',
  description: null,
  pricePerPerson: '1450.00',
  taxCategory: 'FNB',
  minGuests: 100,
  isActive: true,
  updatedAt: '2026-10-27T10:00:00.000Z',
  courses: [
    { name: 'Ana yemek', mode: 'CHOICE', dishes: [{ recipeId: R1, recipe: { name: 'Kuzu incik' }, label: null, portionsPerGuest: '1' }, { recipeId: R2, recipe: { name: 'Levrek' }, label: 'Izgara levrek, roka', portionsPerGuest: '1' }] },
  ],
};

describe('menü formu', () => {
  it('katalog: kayıt → form → gövde şemadan geçer; seçmelide kişi yok', () => {
    const form = catalogFormOf(catalog);
    assert.equal(form.minGuests, '100');
    const body = catalogPayloadOf(form, catalog.updatedAt);
    assert.equal(body.courses[0].dishes[0].guestCount, undefined);
    assert.equal(body.courses[0].dishes[1].label, 'Izgara levrek, roka');
    assert.equal(updateBanquetMenuSchema.safeParse(body).success, true);
    assert.deepEqual(catalogFormOf(null).courses.map((course) => course.name), ['Çorba', 'Ana yemek', 'Tatlı']);
  });

  it('etkinlik: katalogdan kopya, servis oturum başında; boş kişi = kalan', () => {
    const form = eventMenuFromCatalog({ id: SESSION, startLocal: '2026-11-14T19:00' }, catalog);
    assert.equal(form.serveAt, '2026-11-14T19:00');
    assert.equal(form.sourceMenuId, catalog.id);
    form.courses[0].dishes[1].guestCount = ' 85 ';
    const body = eventMenuPayloadOf(form, '2026-10-27T10:00:00.000Z');
    assert.deepEqual(body.courses[0].dishes.map((dish) => dish.guestCount), [null, '85']);
    assert.equal(body.guests, null);
    const parsed = saveEventMenuSchema.safeParse(body);
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    assert.equal(parsed.data.courses[0].dishes[1].guestCount, 85);
  });

  it('kayıtlı etkinlik menüsü → form (sabit kişi, kişi sayıları metin)', () => {
    const form = eventMenuFormOf({
      session: { id: SESSION },
      sourceMenu: null,
      name: 'Gala',
      serveLocal: '2026-11-14T20:00',
      guestsFixed: 120,
      pricePerPerson: '900.00',
      discountPct: '5',
      taxCategory: 'FNB',
      notes: null,
      courses: [{ name: 'Ana', mode: 'CHOICE', dishes: [{ recipeId: R1, recipe: { name: 'Kuzu' }, label: null, portionsPerGuest: '1', guestCount: null }, { recipeId: R2, recipe: { name: 'Levrek' }, label: null, portionsPerGuest: '1', guestCount: 40 }] }],
    });
    assert.equal(form.guests, '120');
    assert.deepEqual(form.courses[0].dishes.map((dish) => dish.guestCount), ['', '40']);
  });

  it('seçmeli önizlemesi: kalan, aşım, geçersiz metin', () => {
    const course = { mode: 'CHOICE', dishes: [{ guestCount: '' }, { guestCount: '85' }, { guestCount: '12' }] };
    assert.deepEqual(coursePreview(course, 350), { counts: [253, 85, 12], issue: null });
    assert.match(coursePreview(course, 90).issue, /aşıyor/);
    assert.deepEqual(coursePreview({ mode: 'CHOICE', dishes: [{ guestCount: '' }, { guestCount: 'abc' }] }, 10).counts, [10, 0]);
    assert.deepEqual(coursePreview({ mode: 'ALL', dishes: [{ guestCount: '' }] }, 10).counts, [10]);
  });

  it('sıralama ve seçiciden satır', () => {
    assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
    assert.deepEqual(moveItem(['a', 'b'], 0, -1), ['a', 'b']);
    const dish = dishOf({ id: R1, name: 'Kuzu', allergens: ['MILK'] });
    assert.equal(dish.portionsPerGuest, '1');
    assert.notEqual(dish.key, dishOf({ id: R1, name: 'Kuzu' }).key);
  });
});

describe('mutfak biçimleri ve çıktılar', () => {
  it('miktar, yüzde, gıda maliyeti tonu', () => {
    assert.equal(quantityText('103.445', 'KG'), '103,445 kg');
    assert.equal(quantityText('4', 'PIECE'), '4 adet');
    assert.equal(quantityText(null, 'KG'), '—');
    assert.equal(pctText('18.7'), '%18,7');
    assert.equal(foodCostTone('18.7'), 'success');
    assert.equal(foodCostTone('31'), 'warning');
    assert.equal(foodCostTone('40'), 'danger');
    assert.equal(foodCostTone(null), 'neutral');
  });

  it('üretim planı: kaçışlama, taslak menü işareti, boş gün', () => {
    const task = {
      startLocal: '2026-11-14T11:00',
      readyLocal: '2026-11-14T17:00',
      serveLocal: '2026-11-14T20:00',
      station: 'HOT',
      kind: 'PREP',
      name: 'Demi <glace>',
      quantity: '26.6',
      unit: 'L',
      usedBy: ['Kuzu incik'],
      event: { code: 'ETK-2026-0001', name: 'Yılmaz & Kaya' },
      menu: { finalized: false, guests: 350, notes: '12 vejetaryen' },
      venueName: 'Balo',
    };
    const html = productionPlanHtml({ from: '2026-11-14', to: '2026-11-14', days: [{ day: '2026-11-14', hours: [{ hour: '11:00', tasks: [task] }] }] }, { hotelName: 'Otel' });
    assert.match(html, /Demi &lt;glace&gt;/);
    assert.match(html, /Yılmaz &amp; Kaya/);
    assert.match(html, /taslak menü/);
    assert.match(html, /26,6 L/);
    assert.match(productionPlanHtml({ from: '2026-11-14', to: '2026-11-15', days: [] }, { hotelName: 'Otel', stationLabel: 'Soğuk mutfak' }), /hazırlık görevi yok/);
  });

  it('ihtiyaç listesi gruba göre; talep çıktısında not kaçışlanır', () => {
    const needs = {
      from: '2026-11-14',
      to: '2026-11-15',
      events: 2,
      menus: 2,
      overproductionPct: '5.00',
      includeTentative: false,
      items: [
        { group: 'MEAT', name: 'Kuzu', code: null, unit: 'KG', definite: '185.112', tentative: '0', requested: '0', shortfall: '185.112', needDay: '2026-11-14' },
        { group: 'PRODUCE', name: 'Roka', code: 'S-1', unit: 'KG', definite: '3', tentative: '0', requested: '3', shortfall: '0', needDay: '2026-11-14' },
      ],
    };
    const html = needsListHtml(needs, { hotelName: 'Otel' });
    assert.ok(html.indexOf('Kırmızı et') < html.indexOf('Sebze ve meyve'));
    assert.match(html, /185,112 kg/);
    const request = purchaseRequestHtml(
      { number: 'STR-2026-0001', status: 'OPEN', neededBy: '2026-11-14', requestedBy: 'sef@otel', note: '<b>acil</b>', estimatedTotal: '117800', items: [{ name: 'Kuzu', code: null, group: 'MEAT', unit: 'KG', quantity: '190', unitCost: '620.0000', cost: '117800.00', neededBy: '2026-11-14', events: [{ code: 'ETK-1', quantity: '108.333', neededBy: '2026-11-14' }] }] },
      { hotelName: 'Otel' },
    );
    assert.match(request, /&lt;b&gt;acil&lt;\/b&gt;/);
    assert.match(request, /117\.800,00/);
  });
});
