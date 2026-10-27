import { currentActor, toDecimal } from '@hotelos/core';
import { sortAllergens } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockBanquetMenus } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { containsText, searchTokens } from '../../lib/search.js';
import { writeWithEvents } from '../../lib/write.js';
import { chargeLine } from '../folios/rules.js';
import { loadRecipeGraph, moneyText, nameTaken, quantityText } from '../recipes/graph.js';
import { allergenCalculator, costCalculator } from '../recipes/rules.js';
import { getActiveTaxes } from '../settings/service.js';
import { COURSES_SELECT, assertDishes, coursesSummary, writeCourses } from './fnb-shared.js';
import { iso, prisma } from './shared.js';

/**
 * Set menü kataloğu (modül 43): kurslar, yemekler (yemek reçeteleri), kişi başı fiyat (vergi
 * dahil), en az kişi. Etkinliğe seçilince kopyası alınır — katalog sonradan değişse de
 * etkinlik bozulmaz. Silinmez, pasife alınır (pasif menü etkinliğe seçilmez).
 *
 * Kişi başı maliyet (reçete görme izni olana): "hepsi" kurslarında yemeklerin toplamı,
 * "seçmeli" kurslarda **en pahalı seçenek** (fiyat kararı en kötü durumla verilir);
 * fazla hazırlık payı hariç. Gıda maliyeti % = kişi başı maliyet / KDV hariç kişi başı fiyat.
 */

const MENU_SELECT = Object.freeze({
  id: true,
  code: true,
  name: true,
  description: true,
  pricePerPerson: true,
  taxCategory: true,
  minGuests: true,
  isActive: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  courses: COURSES_SELECT,
});

/**
 * Menünün kişi başı maliyeti ve alerjenleri.
 * @param {any} menu @param {{ cost: Function | null, allergens: Function }} calc
 */
function menuCost(menu, calc) {
  const allergens = new Set();
  let perGuest = toDecimal(0);
  let missing = 0;
  for (const course of menu.courses) {
    let courseCost = toDecimal(0);
    for (const dish of course.dishes) {
      calc.allergens(dish.recipeId).forEach((allergen) => allergens.add(allergen));
      if (!calc.cost) continue;
      const cost = calc.cost(dish.recipeId);
      missing += cost.missing.size;
      const dishCost = cost.perUnit.times(toDecimal(String(dish.portionsPerGuest)));
      courseCost = course.mode === 'CHOICE' ? (dishCost.greaterThan(courseCost) ? dishCost : courseCost) : courseCost.plus(dishCost);
    }
    perGuest = perGuest.plus(courseCost);
  }
  return { allergens: sortAllergens(allergens), perGuest, missing };
}

/** @param {any} row @param {{ cost: Function | null, allergens: Function, taxes: any[] }} calc @param {{ full: boolean }} options */
function toMenuDto(row, calc, { full }) {
  const { allergens, perGuest, missing } = menuCost(row, calc);
  const net = toDecimal(chargeLine({ amount: String(row.pricePerPerson), quantity: 1, taxCategory: row.taxCategory, taxes: calc.taxes }).netAmount);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    pricePerPerson: moneyText(row.pricePerPerson),
    netPricePerPerson: moneyText(net),
    taxCategory: row.taxCategory,
    minGuests: row.minGuests,
    isActive: row.isActive,
    courseCount: row.courses.length,
    dishCount: row.courses.reduce((total, course) => total + course.dishes.length, 0),
    allergens,
    ...(calc.cost
      ? { cost: { perGuest: moneyText(perGuest), foodCostPct: net.isZero() ? null : perGuest.times(100).dividedBy(net).toDecimalPlaces(1).toString(), missing } }
      : {}),
    ...(full
      ? {
          courses: row.courses.map((course) => ({
            id: course.id,
            name: course.name,
            mode: course.mode,
            dishes: course.dishes.map((dish) => ({
              id: dish.id,
              recipeId: dish.recipeId,
              recipe: dish.recipe,
              label: dish.label,
              portionsPerGuest: quantityText(dish.portionsPerGuest),
              allergens: calc.allergens(dish.recipeId),
              ...(calc.cost ? { costPerPortion: moneyText(calc.cost(dish.recipeId).perUnit) } : {}),
            })),
          })),
          createdBy: row.createdBy,
          createdAt: iso(row.createdAt),
        }
      : {}),
    updatedAt: iso(row.updatedAt),
  };
}

/** Menülerin yemek reçetelerinin grafiği ve hesaplayıcılar. @param {string} hotelId @param {any[]} rows @param {boolean} withCost */
async function calculators(hotelId, rows, withCost) {
  const ids = rows.flatMap((row) => row.courses.flatMap((course) => course.dishes.map((dish) => dish.recipeId)));
  const [graph, taxes] = await Promise.all([loadRecipeGraph(prisma, hotelId, ids), getActiveTaxes(hotelId)]);
  return { cost: withCost ? costCalculator(graph) : null, allergens: allergenCalculator(graph), taxes };
}

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string, active?: boolean }} query
 * @param {{ withCost: boolean }} options
 */
export async function listMenus(hotelId, query, { withCost }) {
  /** @type {Record<string, any>} */
  const where = { hotelId };
  if (query.active !== undefined) where.isActive = query.active;
  const tokens = searchTokens(query.search);
  if (tokens.length) where.AND = tokens.map((token) => ({ OR: [{ name: containsText(token) }, { code: containsText(token) }] }));
  const [rows, total] = await Promise.all([
    prisma.banquetMenu.findMany({ where, orderBy: [{ isActive: 'desc' }, { name: 'asc' }, { id: 'asc' }], ...toSkipTake(query), select: MENU_SELECT }),
    prisma.banquetMenu.count({ where }),
  ]);
  const calc = await calculators(hotelId, rows, withCost);
  return buildPage(
    rows.map((row) => toMenuDto(row, calc, { full: false })),
    total,
    query,
  );
}

/** @param {string} hotelId @param {string} menuId @param {{ withCost: boolean }} options */
export async function getMenu(hotelId, menuId, { withCost }) {
  const row = await prisma.banquetMenu.findFirst({ where: { id: menuId, hotelId }, select: MENU_SELECT });
  if (!row) throw new NotFoundError('Set menü bulunamadı');
  return toMenuDto(row, await calculators(hotelId, [row], withCost), { full: true });
}

/**
 * @param {string} hotelId
 * @param {string | null} menuId
 * @param {any} input `createBanquetMenuSchema` / `updateBanquetMenuSchema`
 * @param {{ withCost: boolean }} options
 */
async function writeMenu(hotelId, menuId, input, options) {
  const actor = currentActor();
  const { expectedUpdatedAt, courses, ...fields } = input;
  try {
    const id = await writeWithEvents(async (tx, stage) => {
      let before = null;
      if (menuId) {
        if (!(await lockBanquetMenus(tx, hotelId, [menuId])).has(menuId)) throw new NotFoundError('Set menü bulunamadı');
        before = await tx.banquetMenu.findFirst({ where: { id: menuId, hotelId }, select: MENU_SELECT });
        if (before.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
      }
      if ((!before || before.name.toLowerCase() !== fields.name.toLowerCase()) && (await nameTaken(tx, 'BanquetMenu', hotelId, fields.name, menuId))) {
        throw new ValidationError('Bu adla bir set menü zaten var', { field: 'name' });
      }
      if (fields.code && (await tx.banquetMenu.findFirst({ where: { hotelId, code: fields.code, NOT: menuId ? { id: menuId } : undefined }, select: { id: true } }))) {
        throw new ValidationError('Bu kodlu bir set menü zaten var', { field: 'code' });
      }
      const previous = new Set((before?.courses ?? []).flatMap((course) => course.dishes.map((dish) => dish.recipeId)));
      await assertDishes(tx, hotelId, courses, previous);
      const row = menuId
        ? await tx.banquetMenu.update({ where: { id: menuId }, data: fields, select: { id: true } })
        : await tx.banquetMenu.create({ data: { hotelId, ...fields, createdBy: actor }, select: { id: true } });
      if (menuId) await tx.banquetMenuCourse.deleteMany({ where: { menuId } });
      await writeCourses(tx, { hotelId, kind: 'CATALOG', parentId: row.id, courses });
      const view = (value, list) => ({
        code: value.code,
        name: value.name,
        pricePerPerson: moneyText(value.pricePerPerson),
        taxCategory: value.taxCategory,
        minGuests: value.minGuests ?? null,
        isActive: value.isActive ?? true,
        courses: coursesSummary(list),
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'BanquetMenu',
        entityId: row.id,
        action: before ? 'UPDATE' : 'CREATE',
        before: before ? view(before, before.courses) : null,
        after: view(fields, courses),
      });
      await stage('banquet.menu.changed', { hotelId, menuId: row.id, change: before ? 'UPDATED' : 'CREATED' });
      return row.id;
    });
    return getMenu(hotelId, id, options);
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu ad ya da kodla bir set menü zaten var' });
  }
}

/** @param {string} hotelId @param {any} input @param {{ withCost: boolean }} options */
export const createMenu = (hotelId, input, options) => writeMenu(hotelId, null, input, options);

/** @param {string} hotelId @param {string} menuId @param {any} input @param {{ withCost: boolean }} options */
export const updateMenu = (hotelId, menuId, input, options) => writeMenu(hotelId, menuId, input, options);
