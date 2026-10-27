import { Decimal, toDecimal } from '@hotelos/core';
import { KITCHEN_UNIT_FACTORS, KITCHEN_UNIT_LABELS, MAX_RECIPE_DEPTH, sortAllergens, unitsCompatible } from '@hotelos/hotel-contracts';

/**
 * Reçete hesabının saf kuralları (modül 43; birim testli): birim çevrimi, fire, reçetenin
 * malzemeye açılması (ara reçeteler dahil), maliyet, alerjen, döngü / derinlik, satın alma
 * yuvarlaması ve talebin etkinliklere dağıtımı.
 *
 * Grafik (servis katmanı yükler, burada yalnızca okunur):
 *   recipes:    Map<id, { id, name, kind, yieldQuantity, yieldUnit, leadMinutes, lines: Line[] }>
 *   stockItems: Map<id, { id, name, unit, unitCost, allergens }>
 *   Line:       { stockItemId | subRecipeId, quantity, unit, wastePct }
 * Miktarlar metin ya da Decimal; sonuçlar Decimal (yuvarlama yalnızca en sonda).
 *
 * Zaman: "önce" dakikaları servis anına göredir. Yemek servisten `leadMinutes` önce
 * başlar; ara ürün onu kullanan reçetenin başlangıcından kendi `leadMinutes`'i kadar önce
 * başlar. Malzeme, onu doğrudan kullanan reçetenin başlangıcında mutfakta olmalıdır.
 */

const ZERO = () => new Decimal(0);
const HUNDRED = new Decimal(100);

/**
 * Aynı ailedeki birimler arası çevrim (g ↔ kg, ml ↔ L). Aileler arası çevrim hatadır.
 * @param {string | Decimal} quantity @param {string} from @param {string} to
 */
export function convertQuantity(quantity, from, to) {
  if (!unitsCompatible(from, to)) throw new RangeError(`Birim çevrilemez: ${KITCHEN_UNIT_LABELS[from] ?? from} → ${KITCHEN_UNIT_LABELS[to] ?? to}`);
  return toDecimal(quantity).times(KITCHEN_UNIT_FACTORS[from]).dividedBy(KITCHEN_UNIT_FACTORS[to]);
}

/**
 * Brüt miktar: net / (1 − fire). %20 fireli 800 g net → 1000 g brüt alınır.
 * @param {string | Decimal} net @param {string | Decimal} wastePct
 */
export function grossQuantity(net, wastePct) {
  const waste = toDecimal(wastePct ?? 0);
  if (waste.isNegative() || waste.greaterThanOrEqualTo(HUNDRED)) throw new RangeError('Fire %0 ile %100 arasında olmalı');
  return toDecimal(net).times(HUNDRED).dividedBy(HUNDRED.minus(waste));
}

/**
 * Satırın, kaynağının biriminde brüt miktarı (malzeme → stok birimi, ara reçete → verim birimi).
 * @param {{ quantity: string | Decimal, unit: string, wastePct?: string | Decimal }} line @param {string} sourceUnit
 */
export const lineGross = (line, sourceUnit) => convertQuantity(grossQuantity(line.quantity, line.wastePct ?? 0), line.unit, sourceUnit);

/**
 * Yukarı yuvarlamadan önce atılan ondalık gürültüsü (basamak): 20 anlamlı basamaklı bölmeler
 * "2,00000000000000000001 kg" bırakabilir; doğrudan yukarı yuvarlansa 2,001 kg olurdu.
 */
const NOISE_PLACES = 9;

/**
 * Satın almaya / ekrana giden miktar, yukarı yuvarlanır: kg / L binde bir (gram), g / ml / adet tam sayı.
 * @param {Decimal} quantity @param {string} unit
 */
export function purchaseRounding(quantity, unit) {
  const places = unit === 'KG' || unit === 'L' ? 3 : 0;
  return toDecimal(quantity).toDecimalPlaces(NOISE_PLACES, Decimal.ROUND_HALF_UP).toDecimalPlaces(places, Decimal.ROUND_UP);
}

/**
 * Reçeteyi malzemeye açar: `amount` (reçetenin verim biriminde) için gereken brüt malzeme ve
 * ara ürünler; her biri "servisten kaç dakika önce" gerektiğiyle. Aynı malzeme / ara ürün
 * birden çok yerden gelirse miktarlar toplanır, gerekme anı en erkeni (en büyük dakika) olur.
 *
 * @param {{ recipes: Map<string, any>, stockItems: Map<string, any> }} graph
 * @param {string} recipeId
 * @param {Decimal | string} amount
 * @param {number} startOffset bu reçetenin servisten kaç dakika önce başladığı
 * @param {{ stock: Map<string, { quantity: Decimal, offset: number }>, preps: Map<string, { quantity: Decimal, offset: number, readyOffset: number, usedBy: Set<string> }> }} [into]
 * @param {number} [depth]
 */
export function expandRecipe(graph, recipeId, amount, startOffset, into = { stock: new Map(), preps: new Map() }, depth = 1) {
  const recipe = graph.recipes.get(recipeId);
  if (!recipe) throw new RangeError(`Reçete grafikte yok: ${recipeId}`);
  if (depth > MAX_RECIPE_DEPTH) throw new RangeError(`Reçete ${MAX_RECIPE_DEPTH} seviyeden derin (döngü olabilir): ${recipe.name}`);
  const scale = toDecimal(amount).dividedBy(toDecimal(recipe.yieldQuantity));
  for (const line of recipe.lines) {
    if (line.stockItemId) {
      const item = graph.stockItems.get(line.stockItemId);
      if (!item) throw new RangeError(`Malzeme grafikte yok: ${line.stockItemId}`);
      const quantity = lineGross(line, item.unit).times(scale);
      const entry = into.stock.get(item.id);
      if (entry) {
        entry.quantity = entry.quantity.plus(quantity);
        entry.offset = Math.max(entry.offset, startOffset);
      } else {
        into.stock.set(item.id, { quantity, offset: startOffset });
      }
      continue;
    }
    const sub = graph.recipes.get(line.subRecipeId);
    if (!sub) throw new RangeError(`Ara reçete grafikte yok: ${line.subRecipeId}`);
    const quantity = lineGross(line, sub.yieldUnit).times(scale);
    const subStart = startOffset + sub.leadMinutes;
    const entry = into.preps.get(sub.id);
    if (entry) {
      entry.quantity = entry.quantity.plus(quantity);
      entry.offset = Math.max(entry.offset, subStart);
      entry.readyOffset = Math.max(entry.readyOffset, startOffset);
      entry.usedBy.add(recipe.id);
    } else {
      into.preps.set(sub.id, { quantity, offset: subStart, readyOffset: startOffset, usedBy: new Set([recipe.id]) });
    }
    expandRecipe(graph, sub.id, quantity, subStart, into, depth + 1);
  }
  return into;
}

/**
 * Reçetenin **bir verim biriminin** ihtiyacı (önbellekli): `expandRecipe`'in aynısı, ama her reçete
 * grafikte bir kez açılır; menülerde yemek başına yalnızca ölçeklenir. Dakikalar reçetenin kendi
 * başlangıcına göredir (doğrudan malzeme 0, ara ürün kendi süresi kadar önce…). Ölçüm: 31 günlük
 * ihtiyaçta 9.500 yemeğin her birini baştan açmak yerine 2.800 reçete bir kez açıldı.
 *
 * @param {{ recipes: Map<string, any>, stockItems: Map<string, any> }} graph
 * @returns {(recipeId: string) => { stock: Map<string, { perUnit: Decimal, offset: number }>, preps: Map<string, { perUnit: Decimal, offset: number, readyOffset: number, usedBy: Set<string> }> }}
 */
export function demandCalculator(graph) {
  const memo = new Map();
  /** @param {string} recipeId @param {number} depth */
  const visit = (recipeId, depth) => {
    const cached = memo.get(recipeId);
    if (cached) return cached;
    const recipe = graph.recipes.get(recipeId);
    if (!recipe) throw new RangeError(`Reçete grafikte yok: ${recipeId}`);
    if (depth > MAX_RECIPE_DEPTH) throw new RangeError(`Reçete ${MAX_RECIPE_DEPTH} seviyeden derin (döngü olabilir): ${recipe.name}`);
    const yieldQuantity = toDecimal(recipe.yieldQuantity);
    const stock = new Map();
    const preps = new Map();
    const addStock = (id, perUnit, offset) => {
      const entry = stock.get(id);
      if (entry) {
        entry.perUnit = entry.perUnit.plus(perUnit);
        entry.offset = Math.max(entry.offset, offset);
      } else {
        stock.set(id, { perUnit, offset });
      }
    };
    const addPrep = (id, perUnit, offset, readyOffset, usedBy) => {
      const entry = preps.get(id);
      if (entry) {
        entry.perUnit = entry.perUnit.plus(perUnit);
        entry.offset = Math.max(entry.offset, offset);
        entry.readyOffset = Math.max(entry.readyOffset, readyOffset);
        usedBy.forEach((name) => entry.usedBy.add(name));
      } else {
        preps.set(id, { perUnit, offset, readyOffset, usedBy: new Set(usedBy) });
      }
    };
    for (const line of recipe.lines) {
      if (line.stockItemId) {
        const item = graph.stockItems.get(line.stockItemId);
        if (!item) throw new RangeError(`Malzeme grafikte yok: ${line.stockItemId}`);
        addStock(item.id, lineGross(line, item.unit).dividedBy(yieldQuantity), 0);
        continue;
      }
      const sub = graph.recipes.get(line.subRecipeId);
      if (!sub) throw new RangeError(`Ara reçete grafikte yok: ${line.subRecipeId}`);
      const share = lineGross(line, sub.yieldUnit).dividedBy(yieldQuantity);
      addPrep(sub.id, share, sub.leadMinutes, 0, [recipe.id]);
      const below = visit(sub.id, depth + 1);
      for (const [id, entry] of below.stock) addStock(id, entry.perUnit.times(share), sub.leadMinutes + entry.offset);
      for (const [id, entry] of below.preps) addPrep(id, entry.perUnit.times(share), sub.leadMinutes + entry.offset, sub.leadMinutes + entry.readyOffset, entry.usedBy);
    }
    const result = { stock, preps };
    memo.set(recipeId, result);
    return result;
  };
  return (recipeId) => visit(recipeId, 1);
}

/**
 * Reçete maliyeti (KDV hariç, güncel birim maliyetle): bir partinin maliyeti, verim birimi
 * başına maliyet, satır maliyetleri, birim maliyeti girilmemiş malzemeler. Önbellekli
 * (aynı grafikte bir reçete bir kez hesaplanır).
 *
 * @param {{ recipes: Map<string, any>, stockItems: Map<string, any> }} graph
 */
export function costCalculator(graph) {
  /** @type {Map<string, { batch: Decimal, perUnit: Decimal, lines: Decimal[], missing: Set<string> }>} */
  const memo = new Map();
  /** @param {string} recipeId @param {Set<string>} path */
  const visit = (recipeId, path) => {
    const cached = memo.get(recipeId);
    if (cached) return cached;
    const recipe = graph.recipes.get(recipeId);
    if (!recipe) throw new RangeError(`Reçete grafikte yok: ${recipeId}`);
    if (path.has(recipeId)) throw new RangeError(`Reçetede döngü: ${recipe.name}`);
    const nextPath = new Set(path).add(recipeId);
    const missing = new Set();
    const lines = recipe.lines.map((line) => {
      if (line.stockItemId) {
        const item = graph.stockItems.get(line.stockItemId);
        if (!item) throw new RangeError(`Malzeme grafikte yok: ${line.stockItemId}`);
        if (toDecimal(item.unitCost).isZero()) missing.add(item.id);
        return lineGross(line, item.unit).times(toDecimal(item.unitCost));
      }
      const sub = graph.recipes.get(line.subRecipeId);
      if (!sub) throw new RangeError(`Ara reçete grafikte yok: ${line.subRecipeId}`);
      const subCost = visit(sub.id, nextPath);
      subCost.missing.forEach((id) => missing.add(id));
      return lineGross(line, sub.yieldUnit).times(subCost.perUnit);
    });
    const batch = lines.reduce((total, cost) => total.plus(cost), ZERO());
    const result = { batch, perUnit: batch.dividedBy(toDecimal(recipe.yieldQuantity)), lines, missing };
    memo.set(recipeId, result);
    return result;
  };
  return (/** @type {string} */ recipeId) => visit(recipeId, new Set());
}

/**
 * Reçetenin alerjenleri: satırlarındaki malzemelerin ve ara reçetelerin birleşimi (önbellekli).
 * @param {{ recipes: Map<string, any>, stockItems: Map<string, any> }} graph
 */
export function allergenCalculator(graph) {
  /** @type {Map<string, string[]>} */
  const memo = new Map();
  /** @param {string} recipeId @param {number} depth */
  const visit = (recipeId, depth) => {
    const cached = memo.get(recipeId);
    if (cached) return cached;
    if (depth > MAX_RECIPE_DEPTH) throw new RangeError('Reçete çok derin (döngü olabilir)');
    const recipe = graph.recipes.get(recipeId);
    const found = new Set();
    for (const line of recipe?.lines ?? []) {
      if (line.stockItemId) graph.stockItems.get(line.stockItemId)?.allergens?.forEach((allergen) => found.add(allergen));
      else visit(line.subRecipeId, depth + 1).forEach((allergen) => found.add(allergen));
    }
    const result = sortAllergens(found);
    memo.set(recipeId, result);
    return result;
  };
  return (/** @type {string} */ recipeId) => visit(recipeId, 1);
}

/**
 * Bir düğümden aşağı en uzun zincir (düğüm dahil, reçete sayısı) ve döngü. `edges`: reçete →
 * ara reçeteleri. `forbidden` zincirde görülürse döngü kurulmuştur.
 *
 * @param {Map<string, Iterable<string>>} edges
 * @param {string} startId
 * @param {string} [forbidden] kaydedilen reçete: ara reçetelerinden birinin altında çıkarsa döngü
 * @returns {{ depth: number, cycle: boolean }}
 */
export function chainBelow(edges, startId, forbidden) {
  /** @type {Map<string, number>} */
  const memo = new Map();
  let cycle = false;
  /** @param {string} id @param {Set<string>} path */
  const visit = (id, path) => {
    if (id === forbidden || path.has(id)) {
      cycle = true;
      return 0;
    }
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const nextPath = new Set(path).add(id);
    let deepest = 0;
    for (const child of edges.get(id) ?? []) deepest = Math.max(deepest, visit(child, nextPath));
    const depth = 1 + deepest;
    memo.set(id, depth);
    return depth;
  };
  const depth = visit(startId, new Set());
  return { depth, cycle };
}

/**
 * Bir düğümden yukarı en uzun zincir (düğüm dahil): onu ara reçete olarak kullananlar.
 * @param {Map<string, Iterable<string>>} parents reçete → onu kullanan reçeteler
 * @param {string} startId
 */
export function chainAbove(parents, startId) {
  /** @type {Map<string, number>} */
  const memo = new Map();
  /** @param {string} id @param {Set<string>} path */
  const visit = (id, path) => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (path.has(id)) return 0;
    const nextPath = new Set(path).add(id);
    let highest = 0;
    for (const parent of parents.get(id) ?? []) highest = Math.max(highest, visit(parent, nextPath));
    memo.set(id, 1 + highest);
    return 1 + highest;
  };
  return visit(startId, new Set());
}

/**
 * Talep edilen miktarı etkinliklerin eksiklerine dağıtır: ihtiyaç günü erken olan önce; eksikten
 * fazlası (ambalaj yuvarlaması) en erken ihtiyaca eklenir; az talep edildiyse geç ihtiyaçlar eksik
 * kalır. Eksiği olmayan malzeme talep edilirse tümü en erken ihtiyaca yazılır.
 *
 * @param {Decimal | string} quantity
 * @param {Array<{ key: string, shortfall: Decimal | string, needBy: string }>} entries
 * @returns {Array<{ key: string, quantity: Decimal }>}
 */
export function allocateRequest(quantity, entries) {
  if (entries.length === 0) return [];
  const ordered = [...entries].sort((a, b) => (a.needBy === b.needBy ? a.key.localeCompare(b.key) : a.needBy < b.needBy ? -1 : 1));
  let remaining = toDecimal(quantity);
  const result = ordered.map((entry) => {
    const share = Decimal.min(remaining, toDecimal(entry.shortfall));
    remaining = remaining.minus(share);
    return { key: entry.key, quantity: share };
  });
  if (remaining.greaterThan(0)) result[0].quantity = result[0].quantity.plus(remaining);
  return result.filter((entry) => entry.quantity.greaterThan(0));
}
