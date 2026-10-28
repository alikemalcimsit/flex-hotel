import { Decimal, toDecimal } from '@hotelos/core';
import { FNB_PLANNED_STATUSES, courseGuests, menuGuests, productionGuests, productionPortions } from '@hotelos/hotel-contracts';
import { demandCalculator, purchaseRounding } from '../recipes/rules.js';

/**
 * Banket F&B planlamasının saf kuralları (modül 43; birim testli).
 *
 * - **Porsiyon planı:** menünün kişisi (sabit ya da etkinliğin faturalanacak kişisi), kursların
 *   yemeklere dağılımı (hepsi / seçmeli: sabit sayılar + kalan), hazırlanacak porsiyon
 *   (× kişi başı porsiyon × (1 + fazla hazırlık payı), yukarı).
 * - **Talep:** porsiyonlar reçeteden malzemeye açılır (ara ürünler dahil); her malzeme "servisten
 *   kaç dakika önce" gerektiğiyle — ihtiyaç günü bundan çıkar.
 * - **Üretim görevleri:** yemek servisten `leadMinutes` önce başlar, servis anında hazır; ara ürün
 *   onu kullanan reçetenin başlangıcından kendi süresi kadar önce başlar, o başlangıçta hazır.
 * - **İhtiyaç toplamı:** etkinlik × malzeme düzeyinde yuvarlanır (menü başına yuvarlamak fazla
 *   alım biriktirirdi), talep edilenle karşılaştırılır, eksik çıkar; malzeme düzeyinde toplanır.
 */

const MINUTE_MS = 60_000;

/**
 * @param {{ guests: number | null, courses: Array<{ mode: 'ALL' | 'CHOICE', dishes: Array<{ recipeId: string, portionsPerGuest: string, guestCount: number | null }> }> }} menu
 * @param {number} billablePax etkinliğin faturalanacak kişisi
 * @param {string | number} overproductionPct
 */
export function menuPortions(menu, billablePax, overproductionPct) {
  const guests = menuGuests(menu.guests, billablePax);
  const issues = [];
  const courses = menu.courses.map((course) => {
    const { counts, issue } = courseGuests(course.mode, course.dishes, guests);
    if (issue) issues.push(issue);
    return {
      issue,
      dishes: course.dishes.map((dish, index) => ({
        recipeId: dish.recipeId,
        servedGuests: counts[index],
        portions: productionPortions(counts[index], dish.portionsPerGuest, overproductionPct),
      })),
    };
  });
  return { guests, productionGuests: productionGuests(guests, overproductionPct), courses, issues };
}

/**
 * Menünün yemeklerini malzemeye ve ara ürünlere açar. Aynı yemek menüde iki kursta geçerse
 * porsiyonlar toplanır. Reçetenin birim ihtiyacı `calculator`'dan (bütün menüler tek önbellek paylaşır).
 *
 * @param {{ recipes: Map<string, any>, stockItems: Map<string, any> }} graph
 * @param {Array<{ recipeId: string, portions: number }>} dishes
 * @param {ReturnType<typeof demandCalculator>} [calculator]
 */
export function menuDemand(graph, dishes, calculator = demandCalculator(graph)) {
  /** @type {Map<string, { portions: number, offset: number }>} */
  const dishTasks = new Map();
  /** @type {Map<string, { quantity: Decimal, offset: number }>} */
  const stock = new Map();
  /** @type {Map<string, { quantity: Decimal, offset: number, readyOffset: number, usedBy: Set<string> }>} */
  const preps = new Map();
  for (const dish of dishes) {
    if (dish.portions <= 0) continue;
    const recipe = graph.recipes.get(dish.recipeId);
    if (!recipe) throw new RangeError(`Reçete grafikte yok: ${dish.recipeId}`);
    const task = dishTasks.get(recipe.id);
    if (task) task.portions += dish.portions;
    else dishTasks.set(recipe.id, { portions: dish.portions, offset: recipe.leadMinutes });
    const portions = toDecimal(dish.portions);
    const start = recipe.leadMinutes;
    const unit = calculator(recipe.id);
    for (const [id, entry] of unit.stock) {
      const quantity = entry.perUnit.times(portions);
      const current = stock.get(id);
      if (current) {
        current.quantity = current.quantity.plus(quantity);
        current.offset = Math.max(current.offset, start + entry.offset);
      } else {
        stock.set(id, { quantity, offset: start + entry.offset });
      }
    }
    for (const [id, entry] of unit.preps) {
      const quantity = entry.perUnit.times(portions);
      const current = preps.get(id);
      if (current) {
        current.quantity = current.quantity.plus(quantity);
        current.offset = Math.max(current.offset, start + entry.offset);
        current.readyOffset = Math.max(current.readyOffset, start + entry.readyOffset);
        entry.usedBy.forEach((name) => current.usedBy.add(name));
      } else {
        preps.set(id, { quantity, offset: start + entry.offset, readyOffset: start + entry.readyOffset, usedBy: new Set(entry.usedBy) });
      }
    }
  }
  return { dishes: dishTasks, preps, stock };
}

/**
 * Menünün üretim görevleri (yemekler ve ara ürünler), gerçek anlarla.
 *
 * @param {{ recipes: Map<string, any> }} graph
 * @param {Date} serveAt
 * @param {ReturnType<typeof menuDemand>} demand
 */
export function productionTasks(graph, serveAt, demand) {
  const at = (offset) => new Date(serveAt.getTime() - offset * MINUTE_MS);
  const tasks = [];
  for (const [recipeId, entry] of demand.dishes) {
    const recipe = graph.recipes.get(recipeId);
    tasks.push({ kind: 'DISH', recipeId, name: recipe.name, station: recipe.station, quantity: String(entry.portions), unit: 'PORTION', startAt: at(entry.offset), readyAt: serveAt, usedBy: [] });
  }
  for (const [recipeId, entry] of demand.preps) {
    const recipe = graph.recipes.get(recipeId);
    tasks.push({
      kind: recipe.kind === 'DISH' ? 'DISH' : 'PREP',
      recipeId,
      name: recipe.name,
      station: recipe.station,
      quantity: purchaseRounding(entry.quantity, recipe.yieldUnit === 'PORTION' ? 'PIECE' : recipe.yieldUnit).toString(),
      unit: recipe.yieldUnit,
      startAt: at(entry.offset),
      readyAt: at(entry.readyOffset),
      usedBy: [...entry.usedBy].map((id) => graph.recipes.get(id)?.name).filter(Boolean),
    });
  }
  return tasks.sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.name.localeCompare(b.name, 'tr'));
}

/**
 * İhtiyaçları etkinlik × malzeme düzeyinde toplar; talep edilenle karşılaştırır.
 *
 * @param {Array<{ eventId: string, status: string, stockItemId: string, quantity: Decimal, needDay: string }>} entries menü başına ham miktarlar
 * @param {Map<string, Decimal | string>} requested `${eventId}|${stockItemId}` → talep edilmiş (iptal edilmemiş) miktar
 * @param {Map<string, string>} units malzeme → stok birimi
 */
export function aggregateNeeds(entries, requested, units) {
  /** @type {Map<string, { eventId: string, status: string, stockItemId: string, raw: Decimal, needDay: string }>} */
  const byEvent = new Map();
  for (const entry of entries) {
    const key = `${entry.eventId}|${entry.stockItemId}`;
    const current = byEvent.get(key);
    if (current) {
      current.raw = current.raw.plus(entry.quantity);
      if (entry.needDay < current.needDay) current.needDay = entry.needDay;
    } else {
      byEvent.set(key, { eventId: entry.eventId, status: entry.status, stockItemId: entry.stockItemId, raw: toDecimal(entry.quantity), needDay: entry.needDay });
    }
  }

  const perEvent = [];
  /** @type {Map<string, { stockItemId: string, definite: Decimal, tentative: Decimal, requested: Decimal, shortfall: Decimal, needDay: string | null, events: Set<string> }>} */
  const items = new Map();
  for (const [key, entry] of byEvent) {
    const planned = FNB_PLANNED_STATUSES.includes(entry.status);
    const needed = purchaseRounding(entry.raw, units.get(entry.stockItemId));
    const asked = planned ? toDecimal(requested.get(key) ?? 0) : toDecimal(0);
    const shortfall = planned ? Decimal.max(needed.minus(asked), 0) : toDecimal(0);
    perEvent.push({ key, eventId: entry.eventId, stockItemId: entry.stockItemId, status: entry.status, planned, needed, requested: asked, shortfall, needDay: entry.needDay });

    let item = items.get(entry.stockItemId);
    if (!item) {
      item = { stockItemId: entry.stockItemId, definite: toDecimal(0), tentative: toDecimal(0), requested: toDecimal(0), shortfall: toDecimal(0), needDay: null, events: new Set() };
      items.set(entry.stockItemId, item);
    }
    if (planned) {
      item.definite = item.definite.plus(needed);
      item.requested = item.requested.plus(asked);
      item.shortfall = item.shortfall.plus(shortfall);
      if (!item.needDay || entry.needDay < item.needDay) item.needDay = entry.needDay;
    } else {
      item.tentative = item.tentative.plus(needed);
    }
    item.events.add(entry.eventId);
  }
  // Yalnızca opsiyonlu etkinlikten gelen malzemenin ihtiyaç günü de görünsün.
  for (const row of perEvent) {
    const item = items.get(row.stockItemId);
    if (!item.needDay) item.needDay = row.needDay;
    else if (!row.planned && item.definite.isZero() && row.needDay < item.needDay) item.needDay = row.needDay;
  }
  return { perEvent, items };
}
