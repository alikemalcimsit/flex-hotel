import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toDecimal } from '@hotelos/core';
import { aggregateNeeds, menuDemand, menuPortions, productionTasks } from './fnb-rules.js';

/** Düğün menüsünün mutfağı: çorba, kuzu incik (demi-glace), levrek, vejetaryen mantı, büfe salata. */
function graph() {
  const stockItems = new Map(
    [
      { id: 'mercimek', unit: 'KG', unitCost: '62', allergens: [] },
      { id: 'kuzu', unit: 'KG', unitCost: '620', allergens: [] },
      { id: 'kemik', unit: 'KG', unitCost: '45', allergens: [] },
      { id: 'levrek', unit: 'KG', unitCost: '540', allergens: ['FISH'] },
      { id: 'un', unit: 'KG', unitCost: '24', allergens: ['GLUTEN'] },
      { id: 'yesillik', unit: 'KG', unitCost: '90', allergens: [] },
    ].map((item) => [item.id, item]),
  );
  const recipes = new Map(
    [
      { id: 'corba', name: 'Mercimek çorbası', kind: 'DISH', station: 'HOT', yieldQuantity: '50', yieldUnit: 'PORTION', leadMinutes: 120, lines: [{ stockItemId: 'mercimek', quantity: '3', unit: 'KG', wastePct: '0' }] },
      { id: 'demi', name: 'Demi-glace', kind: 'PREP', station: 'HOT', yieldQuantity: '5', yieldUnit: 'L', leadMinutes: 360, lines: [{ stockItemId: 'kemik', quantity: '4', unit: 'KG', wastePct: '0' }] },
      {
        id: 'incik',
        name: 'Kuzu incik',
        kind: 'DISH',
        station: 'HOT',
        yieldQuantity: '10',
        yieldUnit: 'PORTION',
        leadMinutes: 180,
        lines: [
          { stockItemId: 'kuzu', quantity: '3.5', unit: 'KG', wastePct: '10' },
          { subRecipeId: 'demi', quantity: '1', unit: 'L', wastePct: '0' },
        ],
      },
      { id: 'levrek', name: 'Izgara levrek', kind: 'DISH', station: 'HOT', yieldQuantity: '1', yieldUnit: 'PORTION', leadMinutes: 30, lines: [{ stockItemId: 'levrek', quantity: '0.18', unit: 'KG', wastePct: '40' }] },
      { id: 'manti', name: 'Sebzeli mantı', kind: 'DISH', station: 'HOT', yieldQuantity: '10', yieldUnit: 'PORTION', leadMinutes: 240, lines: [{ stockItemId: 'un', quantity: '1', unit: 'KG', wastePct: '0' }] },
      { id: 'salata', name: 'Mevsim salatası', kind: 'DISH', station: 'COLD', yieldQuantity: '10', yieldUnit: 'PORTION', leadMinutes: 90, lines: [{ stockItemId: 'yesillik', quantity: '1.2', unit: 'KG', wastePct: '25' }] },
    ].map((recipe) => [recipe.id, recipe]),
  );
  return { recipes, stockItems };
}

const wedding = {
  guests: null,
  courses: [
    { mode: 'ALL', dishes: [{ recipeId: 'corba', portionsPerGuest: '1', guestCount: null }] },
    {
      mode: 'CHOICE',
      dishes: [
        { recipeId: 'incik', portionsPerGuest: '1', guestCount: null },
        { recipeId: 'levrek', portionsPerGuest: '1', guestCount: 85 },
        { recipeId: 'manti', portionsPerGuest: '1', guestCount: 12 },
      ],
    },
    { mode: 'ALL', dishes: [{ recipeId: 'salata', portionsPerGuest: '0.3', guestCount: null }] },
  ],
};

describe('porsiyon planı', () => {
  it('350 garanti, %5 pay: seçmeli kurs 85 levrek + 12 mantı + 253 kalan; büfe 0,3 porsiyon', () => {
    const plan = menuPortions(wedding, 350, '5');
    assert.equal(plan.guests, 350);
    assert.equal(plan.productionGuests, 368);
    assert.deepEqual(plan.issues, []);
    assert.deepEqual(plan.courses[0].dishes.map((dish) => [dish.servedGuests, dish.portions]), [[350, 368]]);
    // 253 × 1,05 = 265,65 → 266; 85 × 1,05 = 89,25 → 90; 12 × 1,05 = 12,6 → 13.
    assert.deepEqual(plan.courses[1].dishes.map((dish) => [dish.recipeId, dish.servedGuests, dish.portions]), [
      ['incik', 253, 266],
      ['levrek', 85, 90],
      ['manti', 12, 13],
    ]);
    // 350 × 0,3 × 1,05 = 110,25 → 111.
    assert.deepEqual(plan.courses[2].dishes.map((dish) => dish.portions), [111]);
  });

  it('menüde sabit kişi etkinliğin kişisini ezer; sabitler kişiyi aşınca sorun', () => {
    const plan = menuPortions({ ...wedding, guests: 90 }, 350, '0');
    assert.equal(plan.guests, 90);
    assert.equal(plan.courses[1].dishes[0].servedGuests, 0);
    assert.equal(plan.courses[1].dishes[0].portions, 0);
    assert.equal(plan.issues.length, 1);
    assert.match(plan.issues[0], /aşıyor/);
  });
});

describe('menü talebi ve üretim görevleri', () => {
  it('yemekler malzemeye açılır; ara ürün yemeğin başlangıcından önce', () => {
    const g = graph();
    const plan = menuPortions(wedding, 350, '5');
    const demand = menuDemand(g, plan.courses.flatMap((course) => course.dishes));
    assert.equal(demand.dishes.get('incik').portions, 266);
    // Kuzu: 3,5 / 0,9 × 26,6 = 103,444… kg.
    assert.equal(demand.stock.get('kuzu').quantity.toDecimalPlaces(3).toString(), '103.444');
    assert.equal(demand.stock.get('kuzu').offset, 180);
    // Demi: 26,6 L; 180 + 360 = 540 dk önce başlar; kemik 4 / 5 × 26,6 = 21,28 kg.
    assert.equal(demand.preps.get('demi').quantity.toString(), '26.6');
    assert.equal(demand.stock.get('kemik').quantity.toString(), '21.28');
    assert.equal(demand.stock.get('kemik').offset, 540);
    // Levrek: 0,18 / 0,6 × 90 = 27 kg.
    assert.equal(demand.stock.get('levrek').quantity.toString(), '27');
  });

  it('porsiyonu 0 olan yemek görev ve malzeme üretmez; aynı yemek iki kez toplanır', () => {
    const demand = menuDemand(graph(), [
      { recipeId: 'corba', portions: 0 },
      { recipeId: 'salata', portions: 40 },
      { recipeId: 'salata', portions: 20 },
    ]);
    assert.equal(demand.dishes.has('corba'), false);
    assert.equal(demand.stock.has('mercimek'), false);
    assert.equal(demand.dishes.get('salata').portions, 60);
    assert.equal(demand.stock.get('yesillik').quantity.toString(), '9.6');
  });

  it('görevler gerçek anlarla, başlama sırasına göre', () => {
    const g = graph();
    const serveAt = new Date('2026-11-14T17:00:00.000Z'); // 20:00 İstanbul
    const demand = menuDemand(g, [
      { recipeId: 'incik', portions: 266 },
      { recipeId: 'levrek', portions: 90 },
    ]);
    const tasks = productionTasks(g, serveAt, demand);
    assert.deepEqual(
      tasks.map((task) => [task.kind, task.name, task.quantity, task.unit, task.startAt.toISOString(), task.readyAt.toISOString()]),
      [
        ['PREP', 'Demi-glace', '26.6', 'L', '2026-11-14T08:00:00.000Z', '2026-11-14T14:00:00.000Z'],
        ['DISH', 'Kuzu incik', '266', 'PORTION', '2026-11-14T14:00:00.000Z', '2026-11-14T17:00:00.000Z'],
        ['DISH', 'Izgara levrek', '90', 'PORTION', '2026-11-14T16:30:00.000Z', '2026-11-14T17:00:00.000Z'],
      ],
    );
    assert.deepEqual(tasks[0].usedBy, ['Kuzu incik']);
  });
});

describe('ihtiyaç toplamı', () => {
  const units = new Map([
    ['kuzu', 'KG'],
    ['yumurta', 'PIECE'],
  ]);

  it('etkinlik düzeyinde yuvarlanır, talep edilenle eksik çıkar, opsiyonlu ayrı', () => {
    const entries = [
      // A etkinliği iki menüde kuzu: 50,0004 + 10,0002 → 60,0006 → 60,001 kg (menü başına yuvarlamak 60,002 yapardı).
      { eventId: 'A', status: 'DEFINITE', stockItemId: 'kuzu', quantity: toDecimal('50.0004'), needDay: '2026-11-14' },
      { eventId: 'A', status: 'DEFINITE', stockItemId: 'kuzu', quantity: toDecimal('10.0002'), needDay: '2026-11-13' },
      { eventId: 'B', status: 'DEFINITE', stockItemId: 'kuzu', quantity: toDecimal('20'), needDay: '2026-11-15' },
      { eventId: 'C', status: 'TENTATIVE', stockItemId: 'kuzu', quantity: toDecimal('30'), needDay: '2026-11-12' },
      { eventId: 'B', status: 'DEFINITE', stockItemId: 'yumurta', quantity: toDecimal('412.5'), needDay: '2026-11-15' },
    ];
    const requested = new Map([
      ['A|kuzu', toDecimal('25')],
      ['B|kuzu', toDecimal('30')], // fazlası talep edilmiş: eksik 0, başkasının eksiğini kapatmaz
      ['C|kuzu', toDecimal('5')], // opsiyonlu etkinliğin talebi sayılmaz
    ]);
    const { perEvent, items } = aggregateNeeds(entries, requested, units);
    const a = perEvent.find((row) => row.key === 'A|kuzu');
    assert.equal(a.needed.toString(), '60.001');
    assert.equal(a.shortfall.toString(), '35.001');
    assert.equal(a.needDay, '2026-11-13');
    assert.equal(perEvent.find((row) => row.key === 'B|kuzu').shortfall.toString(), '0');
    assert.equal(perEvent.find((row) => row.key === 'C|kuzu').shortfall.toString(), '0');

    const kuzu = items.get('kuzu');
    assert.equal(kuzu.definite.toString(), '80.001');
    assert.equal(kuzu.tentative.toString(), '30');
    assert.equal(kuzu.requested.toString(), '55');
    assert.equal(kuzu.shortfall.toString(), '35.001');
    assert.equal(kuzu.needDay, '2026-11-13');
    assert.equal(kuzu.events.size, 3);
    assert.equal(items.get('yumurta').definite.toString(), '413');
  });

  it('yalnız opsiyonlu etkinliğin malzemesi: ihtiyaç günü opsiyonlulardan en erken', () => {
    const { items } = aggregateNeeds(
      [
        { eventId: 'C', status: 'TENTATIVE', stockItemId: 'kuzu', quantity: toDecimal('3'), needDay: '2026-11-20' },
        { eventId: 'D', status: 'TENTATIVE', stockItemId: 'kuzu', quantity: toDecimal('3'), needDay: '2026-11-18' },
      ],
      new Map(),
      units,
    );
    assert.equal(items.get('kuzu').needDay, '2026-11-18');
    assert.equal(items.get('kuzu').definite.toString(), '0');
    assert.equal(items.get('kuzu').tentative.toString(), '6');
  });
});
