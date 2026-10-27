import { currentActor, toDecimal } from '@hotelos/core';
import { KITCHEN_UNIT_LABELS, MAX_PICKER_RESULTS, MAX_RECIPE_DEPTH, lineUnitError, unitsCompatible } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockRecipeGraph, lockRecipes } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { containsText, searchTokens } from '../../lib/search.js';
import { writeWithEvents } from '../../lib/write.js';
import { chargeLine } from '../folios/rules.js';
import { getActiveTaxes } from '../settings/service.js';
import { iso, loadParents, loadRecipeGraph, moneyText, nameTaken, prisma, quantityText, unitCostText } from './graph.js';
import { allergenCalculator, chainAbove, chainBelow, costCalculator, lineGross } from './rules.js';

/**
 * Reçete (modül 38'in reçete kısmı — modül 43'te kuruldu).
 *
 * - Satır: malzeme ya da ara reçete; net miktar satırın biriminde (malzemenin / ara reçetenin
 *   birimiyle aynı ailede), fire yüzdesiyle brüte çıkar.
 * - Kayıt **reçete grafiği kilidiyle** (otel başına danışma kilidi) yapılır: döngü ve derinlik
 *   kilit altında denetlenir; aynı anda A → B ve B → A ekleyen iki kayıt döngü kuramaz.
 * - Kullanılan reçetenin verim birimi ailesi değişemez (onu L ile kullanan satırlar anlamsızlaşır);
 *   banket menüsünde yemek olarak duran reçete ara ürüne çevrilemez.
 * - Maliyet saklanmaz: malzemenin güncel birim maliyetinden hesaplanır (44 gelince hareketli
 *   ortalama maliyet). Menü ürününe bağlı yemekte gıda maliyeti % = porsiyon maliyeti / KDV
 *   hariç satış fiyatı (vergi folyonun motoruyla).
 */

const LIST_SELECT = Object.freeze({
  id: true,
  code: true,
  name: true,
  kind: true,
  station: true,
  yieldQuantity: true,
  yieldUnit: true,
  leadMinutes: true,
  isActive: true,
  updatedAt: true,
  menuItem: { select: { id: true, code: true, name: true, price: true, taxCategory: true, isActive: true } },
  _count: { select: { lines: true } },
});

/** Bir reçeteye bağlı kaç yerde gösterilecek kullanıcı (ilk N ad). */
const USED_IN_PREVIEW = 20;
/** Önizlemedeki sanal reçetenin kimliği (grafikte gerçek kimliklerle çakışmaz). */
const PREVIEW_ID = '__preview__';

/**
 * Menü ürününün KDV hariç fiyatı, porsiyon maliyeti ve gıda maliyeti yüzdesi.
 * @param {{ price: any, taxCategory: string } | null} menuItem @param {import('@hotelos/core').Decimal} perPortion @param {any[]} taxes
 */
function margin(menuItem, perPortion, taxes) {
  if (!menuItem) return null;
  const net = toDecimal(chargeLine({ amount: String(menuItem.price), quantity: 1, taxCategory: menuItem.taxCategory, taxes }).netAmount);
  return {
    netPrice: moneyText(net),
    margin: moneyText(net.minus(perPortion)),
    foodCostPct: net.isZero() ? null : perPortion.times(100).dividedBy(net).toDecimalPlaces(1).toString(),
  };
}

/** @param {any} row @param {{ cost: Function, allergens: Function, taxes: any[] }} calc */
function toListDto(row, calc) {
  const cost = calc.cost(row.id);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    station: row.station,
    yieldQuantity: quantityText(row.yieldQuantity),
    yieldUnit: row.yieldUnit,
    leadMinutes: row.leadMinutes,
    isActive: row.isActive,
    lineCount: row._count.lines,
    allergens: calc.allergens(row.id),
    cost: { batch: moneyText(cost.batch), perUnit: moneyText(cost.perUnit), missing: cost.missing.size },
    menuItem: row.menuItem
      ? { id: row.menuItem.id, code: row.menuItem.code, name: row.menuItem.name, price: moneyText(row.menuItem.price), isActive: row.menuItem.isActive, ...margin(row.menuItem, cost.perUnit, calc.taxes) }
      : null,
    updatedAt: iso(row.updatedAt),
  };
}

/**
 * Reçete listesi (maliyet / kâr marjı tablosu): sayfa reçetelerinin grafiği tek seferde yüklenir.
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string, kind?: string, station?: string, active?: boolean, linked?: boolean }} query
 */
export async function listRecipes(hotelId, query) {
  /** @type {Record<string, any>} */
  const where = { hotelId };
  if (query.kind) where.kind = query.kind;
  if (query.station) where.station = query.station;
  if (query.active !== undefined) where.isActive = query.active;
  if (query.linked) where.menuItemId = { not: null };
  const tokens = searchTokens(query.search);
  if (tokens.length) where.AND = tokens.map((token) => ({ OR: [{ name: containsText(token) }, { code: containsText(token) }] }));
  const [rows, total, taxes] = await Promise.all([
    prisma.recipe.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...toSkipTake(query), select: LIST_SELECT }),
    prisma.recipe.count({ where }),
    getActiveTaxes(hotelId),
  ]);
  const graph = await loadRecipeGraph(prisma, hotelId, rows.map((row) => row.id));
  const calc = { cost: costCalculator(graph), allergens: allergenCalculator(graph), taxes };
  return buildPage(
    rows.map((row) => toListDto(row, calc)),
    total,
    query,
  );
}

/**
 * Reçete ekranı: satırlar (kaynak, brüt, maliyet), maliyet, alerjenler, kullanıldığı yerler.
 * @param {string} hotelId @param {string} recipeId
 */
export async function getRecipe(hotelId, recipeId) {
  const row = await prisma.recipe.findFirst({
    where: { id: recipeId, hotelId },
    select: {
      ...LIST_SELECT,
      method: true,
      createdBy: true,
      createdAt: true,
      lines: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          stockItemId: true,
          subRecipeId: true,
          quantity: true,
          unit: true,
          wastePct: true,
          note: true,
          stockItem: { select: { id: true, code: true, name: true, unit: true, unitCost: true, isActive: true, allergens: true } },
          subRecipe: { select: { id: true, code: true, name: true, kind: true, yieldUnit: true, yieldQuantity: true, isActive: true } },
        },
      },
    },
  });
  if (!row) throw new NotFoundError('Reçete bulunamadı');
  const now = new Date();
  const [graph, taxes, parents, parentCount, catalogDishes, upcomingDishes] = await Promise.all([
    loadRecipeGraph(prisma, hotelId, [recipeId]),
    getActiveTaxes(hotelId),
    prisma.recipeLine.findMany({
      where: { hotelId, subRecipeId: recipeId },
      distinct: ['recipeId'],
      orderBy: { recipeId: 'asc' },
      take: USED_IN_PREVIEW,
      select: { recipe: { select: { id: true, name: true, kind: true } } },
    }),
    prisma.recipeLine.findMany({ where: { hotelId, subRecipeId: recipeId }, distinct: ['recipeId'], select: { recipeId: true } }).then((rows) => rows.length),
    prisma.banquetMenuDish.count({ where: { hotelId, recipeId } }),
    prisma.eventMenuDish.count({ where: { hotelId, recipeId, eventMenu: { serveAt: { gte: now }, event: { status: { in: ['TENTATIVE', 'DEFINITE'] } } } } }),
  ]);
  const cost = costCalculator(graph);
  const calc = { cost, allergens: allergenCalculator(graph), taxes };
  const total = cost(recipeId);
  return {
    ...toListDto(row, calc),
    method: row.method,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    lines: row.lines.map((line, index) => {
      const source = line.stockItem
        ? { kind: 'STOCK', id: line.stockItem.id, code: line.stockItem.code, name: line.stockItem.name, unit: line.stockItem.unit, unitCost: unitCostText(line.stockItem.unitCost), isActive: line.stockItem.isActive, allergens: line.stockItem.allergens }
        : { kind: 'RECIPE', id: line.subRecipe.id, code: line.subRecipe.code, name: line.subRecipe.name, recipeKind: line.subRecipe.kind, unit: line.subRecipe.yieldUnit, unitCost: moneyText(cost(line.subRecipe.id).perUnit), isActive: line.subRecipe.isActive };
      return {
        id: line.id,
        stockItemId: line.stockItemId,
        subRecipeId: line.subRecipeId,
        quantity: quantityText(line.quantity),
        unit: line.unit,
        wastePct: quantityText(line.wastePct),
        note: line.note,
        source,
        gross: lineGross({ quantity: String(line.quantity), unit: line.unit, wastePct: String(line.wastePct) }, source.unit).toDecimalPlaces(4).toString(),
        cost: moneyText(total.lines[index]),
        missingCost: line.stockItem ? toDecimal(String(line.stockItem.unitCost)).isZero() : cost(line.subRecipe.id).missing.size > 0,
      };
    }),
    usedIn: {
      recipes: parents.map((entry) => entry.recipe),
      recipeCount: parentCount,
      banquetMenuDishes: catalogDishes,
      upcomingEventDishes: upcomingDishes,
    },
  };
}

/**
 * Satırları doğrular: kaynak otelde var, (yeni satırda) aktif, birim kaynağın ailesinde; ara
 * reçete kendisi değil. Hatalar satır alanlarına bağlanır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {Array<{ stockItemId?: string | null, subRecipeId?: string | null, unit: string }>} lines
 * @param {{ recipeId: string | null, previous: Set<string>, allowInactive?: boolean }} options
 */
async function resolveLines(client, hotelId, lines, { recipeId, previous, allowInactive = false }) {
  const stockIds = [...new Set(lines.map((line) => line.stockItemId).filter(Boolean))];
  const subIds = [...new Set(lines.map((line) => line.subRecipeId).filter(Boolean))];
  const [stockRows, subRows] = await Promise.all([
    stockIds.length ? client.stockItem.findMany({ where: { hotelId, id: { in: stockIds } }, select: { id: true, name: true, unit: true, isActive: true } }) : [],
    subIds.length ? client.recipe.findMany({ where: { hotelId, id: { in: subIds } }, select: { id: true, name: true, kind: true, yieldUnit: true, isActive: true } }) : [],
  ]);
  const stock = new Map(stockRows.map((row) => [row.id, row]));
  const subs = new Map(subRows.map((row) => [row.id, row]));
  /** @type {Record<string, string>} */
  const fields = {};
  lines.forEach((line, index) => {
    if (line.stockItemId) {
      const item = stock.get(line.stockItemId);
      if (!item) fields[`lines.${index}.stockItemId`] = 'Malzeme bulunamadı';
      else if (!item.isActive && !allowInactive && !previous.has(item.id)) fields[`lines.${index}.stockItemId`] = `${item.name} pasif; yeni satıra seçilmez`;
      else {
        const error = lineUnitError(line.unit, item.unit);
        if (error) fields[`lines.${index}.unit`] = error;
      }
      return;
    }
    const sub = subs.get(line.subRecipeId);
    if (!sub) fields[`lines.${index}.subRecipeId`] = 'Ara reçete bulunamadı';
    else if (sub.id === recipeId) fields[`lines.${index}.subRecipeId`] = 'Reçete kendini içeremez';
    else if (!sub.isActive && !allowInactive && !previous.has(sub.id)) fields[`lines.${index}.subRecipeId`] = `${sub.name} pasif; yeni satıra seçilmez`;
    else {
      const error = lineUnitError(line.unit, sub.yieldUnit);
      if (error) fields[`lines.${index}.unit`] = error;
    }
  });
  const messages = Object.values(fields);
  if (messages.length) throw new ValidationError(`Satırlarda düzeltilmesi gereken alanlar var: ${messages[0]}${messages.length > 1 ? ` (+${messages.length - 1})` : ''}`, { fields });
  return { stockIds, subIds };
}

/**
 * Döngü ve derinlik: ara reçetelerin altında kaydedilen reçete çıkarsa döngü; yukarı (onu
 * kullananlar) + aşağı (ara reçeteleri) zincir `MAX_RECIPE_DEPTH`'i aşamaz.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {string | null} recipeId
 * @param {string[]} subIds
 */
async function assertGraph(client, hotelId, recipeId, subIds) {
  if (subIds.length === 0) return;
  const graph = await loadRecipeGraph(client, hotelId, subIds, { stopAt: recipeId });
  /** @type {Map<string, string[]>} */
  const edges = new Map();
  for (const node of graph.recipes.values()) edges.set(node.id, node.id === recipeId ? [] : node.lines.map((line) => line.subRecipeId).filter(Boolean));
  let below = 0;
  for (const subId of subIds) {
    const { depth, cycle } = chainBelow(edges, subId, recipeId ?? undefined);
    if (cycle) throw new ValidationError(`Döngü: "${graph.recipes.get(subId)?.name}" bu reçeteyi (doğrudan ya da dolaylı) içeriyor`, { field: 'lines' });
    below = Math.max(below, depth);
  }
  const above = recipeId ? chainAbove(await loadParents(client, hotelId, recipeId), recipeId) : 1;
  if (above + below > MAX_RECIPE_DEPTH) {
    throw new ValidationError(`İç içe reçete en fazla ${MAX_RECIPE_DEPTH} seviye olur; bu kayıtla ${above + below} seviye oluyor`, { field: 'lines' });
  }
}

/**
 * Menü ürünü otelde, sistem ürünü değil, başka reçeteye bağlı değil.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string | null | undefined} menuItemId @param {string | null} recipeId
 */
async function assertMenuItem(tx, hotelId, menuItemId, recipeId) {
  if (!menuItemId) return;
  const item = await tx.menuItem.findFirst({ where: { id: menuItemId, hotelId }, select: { system: true, recipe: { select: { id: true, name: true } } } });
  if (!item || item.system) throw new ValidationError('Menü ürünü bulunamadı', { field: 'menuItemId' });
  if (item.recipe && item.recipe.id !== recipeId) throw new ValidationError(`Bu ürün "${item.recipe.name}" reçetesine bağlı`, { field: 'menuItemId' });
}

/**
 * Var olan reçetenin değişimi onu kullananları bozuyor mu? Verim birimi ailesi değişirse onu
 * kullanan satırlar; yemek → ara ürün olursa banket menüleri.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {any} before @param {any} input
 */
async function assertUsagesKept(tx, hotelId, before, input) {
  if (before.yieldUnit !== input.yieldUnit) {
    const usages = await tx.recipeLine.findMany({ where: { hotelId, subRecipeId: before.id }, select: { unit: true, recipe: { select: { name: true } } } });
    const broken = usages.filter((usage) => !unitsCompatible(usage.unit, input.yieldUnit));
    if (broken.length) {
      const names = [...new Set(broken.map((usage) => usage.recipe.name))].slice(0, 5).join(', ');
      throw new ConflictError(
        `Bu reçete ${KITCHEN_UNIT_LABELS[before.yieldUnit]} ile kullanılıyor (${names}); verim birimi ${KITCHEN_UNIT_LABELS[input.yieldUnit]} olamaz. Önce o reçetelerin satırlarını değiştirin.`,
        'RECIPE_IN_USE',
      );
    }
  }
  if (before.kind === 'DISH' && input.kind === 'PREP') {
    const [catalog, events] = await Promise.all([tx.banquetMenuDish.count({ where: { hotelId, recipeId: before.id } }), tx.eventMenuDish.count({ where: { hotelId, recipeId: before.id } })]);
    if (catalog + events > 0) throw new ConflictError('Bu yemek banket menülerinde kullanılıyor; ara ürüne çevrilemez', 'RECIPE_IN_USE');
  }
}

/** Denetim izinin satır özeti (ilk 40 satır). @param {Array<any>} lines */
const linesSummary = (lines) => lines.slice(0, 40).map((line) => `${line.stockItemId ? 'M' : 'R'}:${line.stockItemId ?? line.subRecipeId} ${quantityText(line.quantity)} ${line.unit}${Number(line.wastePct) ? ` %${quantityText(line.wastePct)}` : ''}`);

/**
 * @param {string} hotelId
 * @param {string | null} recipeId
 * @param {any} input `createRecipeSchema` / `updateRecipeSchema`
 */
async function writeRecipe(hotelId, recipeId, input) {
  const actor = currentActor();
  const { expectedUpdatedAt, lines, ...fields } = input;
  try {
    const id = await writeWithEvents(async (tx, stage) => {
      await lockRecipeGraph(tx, hotelId);
      let before = null;
      if (recipeId) {
        if (!(await lockRecipes(tx, hotelId, [recipeId])).has(recipeId)) throw new NotFoundError('Reçete bulunamadı');
        before = await tx.recipe.findFirst({
          where: { id: recipeId, hotelId },
          select: { id: true, code: true, name: true, kind: true, station: true, menuItemId: true, yieldQuantity: true, yieldUnit: true, leadMinutes: true, isActive: true, updatedAt: true, lines: { orderBy: { sortOrder: 'asc' }, select: { stockItemId: true, subRecipeId: true, quantity: true, unit: true, wastePct: true } } },
        });
        if (before.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
      }
      if ((!before || before.name.toLowerCase() !== fields.name.toLowerCase()) && (await nameTaken(tx, 'Recipe', hotelId, fields.name, recipeId))) {
        throw new ValidationError('Bu adla bir reçete zaten var', { field: 'name' });
      }
      if (fields.code && (await tx.recipe.findFirst({ where: { hotelId, code: fields.code, NOT: recipeId ? { id: recipeId } : undefined }, select: { id: true } }))) {
        throw new ValidationError('Bu kodlu bir reçete zaten var', { field: 'code' });
      }
      const menuItemId = fields.kind === 'DISH' ? fields.menuItemId ?? null : null;
      await assertMenuItem(tx, hotelId, menuItemId, recipeId);
      const previous = new Set((before?.lines ?? []).flatMap((line) => [line.stockItemId, line.subRecipeId]).filter(Boolean));
      const { subIds } = await resolveLines(tx, hotelId, lines, { recipeId, previous });
      await assertGraph(tx, hotelId, recipeId, subIds);
      if (before) await assertUsagesKept(tx, hotelId, before, fields);

      const data = { ...fields, menuItemId };
      const row = recipeId
        ? await tx.recipe.update({ where: { id: recipeId }, data, select: { id: true } })
        : await tx.recipe.create({ data: { hotelId, ...data, createdBy: actor }, select: { id: true } });
      if (recipeId) await tx.recipeLine.deleteMany({ where: { recipeId } });
      await tx.recipeLine.createMany({
        data: lines.map((line, index) => ({
          hotelId,
          recipeId: row.id,
          sortOrder: index,
          stockItemId: line.stockItemId ?? null,
          subRecipeId: line.subRecipeId ?? null,
          quantity: line.quantity,
          unit: line.unit,
          wastePct: line.wastePct,
          note: line.note ?? null,
        })),
      });
      const view = (value) => ({
        code: value.code,
        name: value.name,
        kind: value.kind,
        station: value.station,
        menuItemId: value.menuItemId,
        yield: `${quantityText(value.yieldQuantity)} ${value.yieldUnit}`,
        leadMinutes: value.leadMinutes,
        isActive: value.isActive ?? true,
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'Recipe',
        entityId: row.id,
        action: before ? 'UPDATE' : 'CREATE',
        before: before ? { ...view(before), lines: linesSummary(before.lines) } : null,
        after: { ...view(data), lines: linesSummary(lines) },
      });
      await stage('recipe.changed', { hotelId, recipeId: row.id, change: before ? 'UPDATED' : 'CREATED' });
      return row.id;
    });
    return getRecipe(hotelId, id);
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu reçete (ad, kod ya da menü ürünü) zaten var' });
  }
}

/** @param {string} hotelId @param {any} input */
export const createRecipe = (hotelId, input) => writeRecipe(hotelId, null, input);

/** @param {string} hotelId @param {string} recipeId @param {any} input */
export const updateRecipe = (hotelId, recipeId, input) => writeRecipe(hotelId, recipeId, input);

/**
 * Kaydetmeden maliyet önizlemesi: satırların brütü ve maliyeti, parti / birim maliyeti,
 * alerjenler; satır ve döngü hataları kayıttakiyle aynı. Pasif kaynak önizlemede engel değil.
 *
 * @param {string} hotelId
 * @param {any} input `recipePreviewSchema`
 */
export async function previewRecipe(hotelId, input) {
  const recipeId = input.recipeId ?? null;
  const { stockIds, subIds } = await resolveLines(prisma, hotelId, input.lines, { recipeId, previous: new Set(), allowInactive: true });
  await assertGraph(prisma, hotelId, recipeId, subIds);
  const graph = await loadRecipeGraph(prisma, hotelId, subIds, { stockItemIds: stockIds, stopAt: recipeId });
  graph.recipes.set(PREVIEW_ID, { id: PREVIEW_ID, name: 'Önizleme', kind: input.kind, yieldQuantity: input.yieldQuantity, yieldUnit: input.yieldUnit, leadMinutes: 0, lines: input.lines });
  const cost = costCalculator(graph);
  const total = cost(PREVIEW_ID);
  return {
    batch: moneyText(total.batch),
    perUnit: moneyText(total.perUnit),
    missing: total.missing.size,
    allergens: allergenCalculator(graph)(PREVIEW_ID),
    lines: input.lines.map((line, index) => {
      const sourceUnit = line.stockItemId ? graph.stockItems.get(line.stockItemId).unit : graph.recipes.get(line.subRecipeId).yieldUnit;
      return { gross: lineGross(line, sourceUnit).toDecimalPlaces(4).toString(), sourceUnit, cost: moneyText(total.lines[index]) };
    }),
  };
}

/**
 * Reçete seçici (reçete satırı, set menü, etkinlik menüsü): aktif reçeteler, ad / koda göre.
 * Maliyet yalnızca reçete görme izni olana.
 *
 * @param {string} hotelId
 * @param {{ search?: string, kind?: string, exclude?: string }} query
 * @param {{ withCost: boolean }} options
 */
export async function pickRecipes(hotelId, query, { withCost }) {
  /** @type {Record<string, any>} */
  const where = { hotelId, isActive: true };
  if (query.kind) where.kind = query.kind;
  if (query.exclude) where.id = { not: query.exclude };
  const tokens = searchTokens(query.search);
  if (tokens.length) where.AND = tokens.map((token) => ({ OR: [{ name: containsText(token) }, { code: containsText(token) }] }));
  const rows = await prisma.recipe.findMany({
    where,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: MAX_PICKER_RESULTS,
    select: { id: true, code: true, name: true, kind: true, station: true, yieldQuantity: true, yieldUnit: true, leadMinutes: true },
  });
  const graph = await loadRecipeGraph(prisma, hotelId, rows.map((row) => row.id));
  const cost = withCost ? costCalculator(graph) : null;
  const allergens = allergenCalculator(graph);
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    station: row.station,
    yieldQuantity: quantityText(row.yieldQuantity),
    yieldUnit: row.yieldUnit,
    leadMinutes: row.leadMinutes,
    allergens: allergens(row.id),
    ...(cost ? { costPerUnit: moneyText(cost(row.id).perUnit) } : {}),
  }));
}

/**
 * Reçeteye bağlanabilecek restoran ürünleri: aktif, sistem ürünü değil, reçetesi yok (ya da bu reçete).
 * @param {string} hotelId @param {{ search?: string, recipeId?: string }} query
 */
export async function pickMenuItems(hotelId, query) {
  /** @type {Record<string, any>} */
  const where = { hotelId, isActive: true, system: null, OR: [{ recipe: { is: null } }, ...(query.recipeId ? [{ recipe: { is: { id: query.recipeId } } }] : [])] };
  const tokens = searchTokens(query.search);
  if (tokens.length) where.AND = tokens.map((token) => ({ OR: [{ name: containsText(token) }, { code: containsText(token) }] }));
  const rows = await prisma.menuItem.findMany({
    where,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: MAX_PICKER_RESULTS,
    select: { id: true, code: true, name: true, price: true, category: { select: { name: true } } },
  });
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, price: moneyText(row.price), category: row.category.name }));
}
