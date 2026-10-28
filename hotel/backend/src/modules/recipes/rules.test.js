import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toDecimal } from '@hotelos/core';
import { allergenCalculator, allocateRequest, chainAbove, chainBelow, convertQuantity, costCalculator, demandCalculator, expandRecipe, grossQuantity, lineGross, purchaseRounding } from './rules.js';

/** Banket mutfağından gerçekçi bir grafik: kuzu incik (demi-glace ara ürünüyle), pilav, demi-glace (fond ara ürünüyle). */
function kitchen() {
  const stockItems = new Map(
    [
      { id: 'kuzu', name: 'Kuzu incik', unit: 'KG', unitCost: '620', allergens: [] },
      { id: 'sogan', name: 'Kuru soğan', unit: 'KG', unitCost: '18.5', allergens: [] },
      { id: 'tereyag', name: 'Tereyağı', unit: 'KG', unitCost: '410', allergens: ['MILK'] },
      { id: 'kemik', name: 'Dana kemik', unit: 'KG', unitCost: '45', allergens: [] },
      { id: 'sarap', name: 'Kırmızı şarap', unit: 'L', unitCost: '260', allergens: ['SULPHITES'] },
      { id: 'kereviz', name: 'Kereviz', unit: 'KG', unitCost: '0', allergens: ['CELERY'] },
      { id: 'pirinc', name: 'Baldo pirinç', unit: 'KG', unitCost: '78', allergens: [] },
      { id: 'yumurta', name: 'Yumurta', unit: 'PIECE', unitCost: '4.25', allergens: ['EGGS'] },
    ].map((item) => [item.id, item]),
  );
  const recipes = new Map(
    [
      {
        id: 'fond',
        name: 'Esmer fond',
        kind: 'PREP',
        yieldQuantity: '10',
        yieldUnit: 'L',
        leadMinutes: 480,
        lines: [
          { stockItemId: 'kemik', quantity: '6', unit: 'KG', wastePct: '0' },
          { stockItemId: 'kereviz', quantity: '500', unit: 'G', wastePct: '20' },
        ],
      },
      {
        id: 'demi',
        name: 'Demi-glace',
        kind: 'PREP',
        yieldQuantity: '5',
        yieldUnit: 'L',
        leadMinutes: 240,
        lines: [
          { subRecipeId: 'fond', quantity: '8', unit: 'L', wastePct: '0' },
          { stockItemId: 'sarap', quantity: '750', unit: 'ML', wastePct: '0' },
          { stockItemId: 'tereyag', quantity: '100', unit: 'G', wastePct: '0' },
        ],
      },
      {
        id: 'incik',
        name: 'Fırında kuzu incik',
        kind: 'DISH',
        yieldQuantity: '10',
        yieldUnit: 'PORTION',
        leadMinutes: 180,
        lines: [
          { stockItemId: 'kuzu', quantity: '3.5', unit: 'KG', wastePct: '10' },
          { stockItemId: 'sogan', quantity: '400', unit: 'G', wastePct: '20' },
          { subRecipeId: 'demi', quantity: '1', unit: 'L', wastePct: '0' },
          { stockItemId: 'tereyag', quantity: '150', unit: 'G', wastePct: '0' },
        ],
      },
      {
        id: 'pilav',
        name: 'Tereyağlı pilav',
        kind: 'DISH',
        yieldQuantity: '20',
        yieldUnit: 'PORTION',
        leadMinutes: 60,
        lines: [
          { stockItemId: 'pirinc', quantity: '1.6', unit: 'KG', wastePct: '0' },
          { stockItemId: 'tereyag', quantity: '200', unit: 'G', wastePct: '0' },
          { stockItemId: 'yumurta', quantity: '3', unit: 'PIECE', wastePct: '0' },
        ],
      },
    ].map((recipe) => [recipe.id, recipe]),
  );
  return { recipes, stockItems };
}

const text = (value) => toDecimal(value).toString();

describe('birim çevrimi ve fire', () => {
  it('aynı ailede çevirir, aileler arası reddeder', () => {
    assert.equal(text(convertQuantity('750', 'G', 'KG')), '0.75');
    assert.equal(text(convertQuantity('1.25', 'L', 'ML')), '1250');
    assert.equal(text(convertQuantity('3', 'PIECE', 'PIECE')), '3');
    assert.throws(() => convertQuantity('1', 'KG', 'L'), /çevrilemez/);
    assert.throws(() => convertQuantity('1', 'PIECE', 'KG'), /çevrilemez/);
    assert.throws(() => convertQuantity('1', 'PORTION', 'KG'), /çevrilemez/);
  });

  it('brüt = net / (1 − fire)', () => {
    assert.equal(text(grossQuantity('800', '20')), '1000');
    assert.equal(text(grossQuantity('1.5', '0')), '1.5');
    assert.throws(() => grossQuantity('1', '100'), /Fire/);
    assert.throws(() => grossQuantity('1', '-1'), /Fire/);
  });

  it('satırın kaynağın birimindeki brütü: 400 g %20 fireli soğan → 0,5 kg', () => {
    assert.equal(text(lineGross({ quantity: '400', unit: 'G', wastePct: '20' }, 'KG')), '0.5');
  });

  it('satın alma yuvarlaması yukarı: kg / L binde bir, g / ml / adet tam', () => {
    assert.equal(purchaseRounding(toDecimal('1.2341'), 'KG').toString(), '1.235');
    assert.equal(purchaseRounding(toDecimal('1.234'), 'KG').toString(), '1.234');
    assert.equal(purchaseRounding(toDecimal('12.01'), 'G').toString(), '13');
    assert.equal(purchaseRounding(toDecimal('412.5'), 'PIECE').toString(), '413');
    assert.equal(purchaseRounding(toDecimal('40'), 'PIECE').toString(), '40');
  });

  it('bölme gürültüsü bir gram fazla aldırmaz', () => {
    // 20 anlamlı basamaklı bölmenin artığı: 2,00000000000000000001 kg → 2 kg (2,001 değil).
    assert.equal(purchaseRounding(toDecimal('2.00000000000000000001'), 'KG').toString(), '2');
    assert.equal(purchaseRounding(toDecimal(1).dividedBy(3).times(3), 'KG').toString(), '1');
    assert.equal(purchaseRounding(toDecimal('39.99999999999999999999'), 'PIECE').toString(), '40');
    // Gerçek fazla gram yukarı gider.
    assert.equal(purchaseRounding(toDecimal('2.0001'), 'KG').toString(), '2.001');
  });
});

describe('reçetenin malzemeye açılması', () => {
  it('312 porsiyon kuzu incik: fire, ara ürün zinciri ve gerekme anları', () => {
    const graph = kitchen();
    // Yemek servisten 180 dk önce başlar; demi-glace onun 240 dk öncesinde (420), fond demi'nin 480 dk öncesinde (900).
    const { stock, preps } = expandRecipe(graph, 'incik', '312', 180);
    // Kuzu: 3,5 kg net %10 fire → 3,888… kg brüt / 10 porsiyon × 312.
    assert.equal(stock.get('kuzu').quantity.toDecimalPlaces(4).toString(), '121.3333');
    assert.equal(stock.get('kuzu').offset, 180);
    assert.equal(text(stock.get('sogan').quantity), '15.6');
    // Demi-glace: 1 L / 10 porsiyon × 312 = 31,2 L; 420 dk önce başlar, yemeğin başlangıcında (180) hazır.
    assert.equal(text(preps.get('demi').quantity), '31.2');
    assert.equal(preps.get('demi').offset, 420);
    assert.equal(preps.get('demi').readyOffset, 180);
    // Fond: demi'nin 8 L / 5 L verimi × 31,2 L = 49,92 L; 900 dk önce.
    assert.equal(text(preps.get('fond').quantity), '49.92');
    assert.equal(preps.get('fond').offset, 900);
    // Kemik fondtan: 6 kg / 10 L × 49,92 L = 29,952 kg; gerektiği an fondun başlangıcı.
    assert.equal(text(stock.get('kemik').quantity), '29.952');
    assert.equal(stock.get('kemik').offset, 900);
    // Kereviz 500 g %20 fire = 0,625 kg / 10 L × 49,92 = 3,12 kg.
    assert.equal(text(stock.get('kereviz').quantity), '3.12');
    // Şarap: 750 ml / 5 L × 31,2 = 4,68 L.
    assert.equal(text(stock.get('sarap').quantity), '4.68');
    // Tereyağı iki yerden: yemekte 0,15 kg × 31,2 = 4,68 + demi'de 0,1 × 6,24 = 0,624 → 5,304 kg; en erken gerekme 420.
    assert.equal(text(stock.get('tereyag').quantity), '5.304');
    assert.equal(stock.get('tereyag').offset, 420);
  });

  it('iki yemek aynı ara ürünü / malzemeyi kullanınca toplanır', () => {
    const graph = kitchen();
    const into = expandRecipe(graph, 'incik', '10', 180);
    expandRecipe(graph, 'pilav', '20', 60, into);
    // Yemekte 0,15 kg + demi'de 0,1 kg × (1 L / 5 L) = 0,02 kg + pilavda 0,2 kg.
    assert.equal(text(into.stock.get('tereyag').quantity), '0.37');
    assert.equal(text(into.stock.get('yumurta').quantity), '3');
  });

  it('önbellekli birim ihtiyacı açılımla birebir aynı (miktar, gerekme anı, hazır olma, kullanan)', () => {
    const graph = kitchen();
    const calculate = demandCalculator(graph);
    for (const [recipeId, amount, start] of [
      ['incik', '312', 180],
      ['pilav', '47', 60],
      ['demi', '7.5', 420],
    ]) {
      const expanded = expandRecipe(graph, recipeId, amount, start);
      const unit = calculate(recipeId);
      assert.deepEqual([...unit.stock.keys()].sort(), [...expanded.stock.keys()].sort(), recipeId);
      for (const [id, entry] of unit.stock) {
        assert.equal(entry.perUnit.times(amount).toDecimalPlaces(12).toString(), expanded.stock.get(id).quantity.toDecimalPlaces(12).toString(), `${recipeId}/${id}`);
        assert.equal(start + entry.offset, expanded.stock.get(id).offset, `${recipeId}/${id} anı`);
      }
      assert.deepEqual([...unit.preps.keys()].sort(), [...expanded.preps.keys()].sort(), recipeId);
      for (const [id, entry] of unit.preps) {
        const expected = expanded.preps.get(id);
        assert.equal(entry.perUnit.times(amount).toDecimalPlaces(12).toString(), expected.quantity.toDecimalPlaces(12).toString());
        assert.equal(start + entry.offset, expected.offset);
        assert.equal(start + entry.readyOffset, expected.readyOffset);
        assert.deepEqual([...entry.usedBy].sort(), [...expected.usedBy].sort());
      }
    }
    // Aynı reçete ikinci kez sorulunca yeniden hesaplanmaz.
    assert.equal(calculate('incik'), calculate('incik'));
  });

  it('grafikte olmayan reçete / malzeme ve aşırı derinlik hata verir', () => {
    const graph = kitchen();
    assert.throws(() => expandRecipe(graph, 'yok', '1', 0), /grafikte yok/);
    graph.recipes.get('fond').lines.push({ subRecipeId: 'incik', quantity: '1', unit: 'PORTION', wastePct: '0' });
    assert.throws(() => expandRecipe(graph, 'incik', '1', 0), /seviyeden derin/);
  });
});

describe('maliyet ve alerjen', () => {
  it('parti ve porsiyon maliyeti açılımla tutarlı', () => {
    const graph = kitchen();
    const cost = costCalculator(graph);
    const incik = cost('incik');
    // Açılımdaki malzemeler × birim maliyet = parti maliyeti (10 porsiyon).
    const { stock } = expandRecipe(graph, 'incik', '10', 0);
    let expanded = toDecimal(0);
    for (const [id, entry] of stock) expanded = expanded.plus(entry.quantity.times(toDecimal(graph.stockItems.get(id).unitCost)));
    assert.equal(incik.batch.toDecimalPlaces(6).toString(), expanded.toDecimalPlaces(6).toString());
    assert.equal(incik.perUnit.toDecimalPlaces(6).toString(), incik.batch.dividedBy(10).toDecimalPlaces(6).toString());
    // Kuzu satırı: 3,888… kg × 620.
    assert.equal(incik.lines[0].toDecimalPlaces(2).toString(), '2411.11');
    // Kerevizin birim maliyeti girilmemiş: alt reçeteden yukarı taşınır.
    assert.deepEqual([...incik.missing], ['kereviz']);
    assert.deepEqual([...cost('pilav').missing], []);
  });

  it('alerjenler ara reçetelerden toplanır, sabit sırayla', () => {
    const allergens = allergenCalculator(kitchen());
    assert.deepEqual(allergens('incik'), ['MILK', 'CELERY', 'SULPHITES']);
    assert.deepEqual(allergens('pilav'), ['EGGS', 'MILK']);
    assert.deepEqual(allergens('fond'), ['CELERY']);
  });

  it('döngülü grafikte maliyet hesabı durur', () => {
    const graph = kitchen();
    graph.recipes.get('fond').lines.push({ subRecipeId: 'demi', quantity: '1', unit: 'L', wastePct: '0' });
    assert.throws(() => costCalculator(graph)('incik'), /döngü/);
  });
});

describe('döngü ve derinlik', () => {
  const edges = new Map([
    ['incik', ['demi']],
    ['demi', ['fond']],
    ['fond', []],
    ['pilav', []],
  ]);
  const parents = new Map([
    ['demi', ['incik']],
    ['fond', ['demi']],
  ]);

  it('aşağı zincir: düğüm dahil reçete sayısı', () => {
    assert.deepEqual(chainBelow(edges, 'incik'), { depth: 3, cycle: false });
    assert.deepEqual(chainBelow(edges, 'pilav'), { depth: 1, cycle: false });
  });

  it('kaydedilen reçete ara reçetesinin altında çıkarsa döngü', () => {
    // fond'a demi eklenmek isteniyor: demi'nin altında fond var → döngü.
    assert.equal(chainBelow(edges, 'demi', 'fond').cycle, true);
    assert.equal(chainBelow(edges, 'pilav', 'fond').cycle, false);
  });

  it('yukarı zincir: onu kullananlar', () => {
    assert.equal(chainAbove(parents, 'fond'), 3);
    assert.equal(chainAbove(parents, 'incik'), 1);
  });
});

describe('talebin etkinliklere dağıtımı', () => {
  const entries = [
    { key: 'B', shortfall: '30', needBy: '2026-11-12' },
    { key: 'A', shortfall: '20', needBy: '2026-11-10' },
    { key: 'C', shortfall: '10', needBy: '2026-11-12' },
  ];
  const view = (rows) => rows.map((row) => [row.key, row.quantity.toString()]);

  it('tam eksik kadar: her etkinlik kendi eksiğini alır, erken ihtiyaç önce', () => {
    assert.deepEqual(view(allocateRequest('60', entries)), [['A', '20'], ['B', '30'], ['C', '10']]);
  });

  it('fazlası (ambalaj yuvarlaması) en erken ihtiyaca', () => {
    assert.deepEqual(view(allocateRequest('65.5', entries)), [['A', '25.5'], ['B', '30'], ['C', '10']]);
  });

  it('az talep: geç ihtiyaç eksik kalır (aynı günde kimlik sırası)', () => {
    assert.deepEqual(view(allocateRequest('35', entries)), [['A', '20'], ['B', '15']]);
  });

  it('eksiği olmayan malzeme: tümü en erken ihtiyaca; ihtiyaç yoksa satır yok', () => {
    const covered = entries.map((entry) => ({ ...entry, shortfall: '0' }));
    assert.deepEqual(view(allocateRequest('5', covered)), [['A', '5']]);
    assert.deepEqual(allocateRequest('5', []), []);
  });
});
