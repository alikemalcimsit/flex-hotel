import { toDecimal } from '@hotelos/core';
import {
  FNB_PLANNED_STATUSES,
  FNB_POSSIBLE_STATUSES,
  MAX_EVENT_MENUS,
  MAX_NEEDS_MENUS,
  MAX_PRODUCTION_TASKS,
  MAX_RECIPE_DEPTH,
  MAX_RECIPE_LEAD_MINUTES,
  STOCK_ITEM_GROUPS,
  menuFinalizeDueDay,
  sortAllergens,
  utcToZonedWallTime,
  zonedWallTimeToUtc,
} from '@hotelos/hotel-contracts';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { loadRecipeGraph, moneyText, quantityText, unitCostText } from '../recipes/graph.js';
import { allergenCalculator, costCalculator } from '../recipes/rules.js';
import { demandCalculator } from '../recipes/rules.js';
import { aggregateNeeds, menuDemand, menuPortions, productionTasks } from './fnb-rules.js';
import { hotelContext, iso, loadEventSettings, prisma } from './shared.js';

/**
 * Banket F&B okuma çekirdeği (modül 43): etkinliğin menü sekmesi, servis günü aralığının malzeme
 * ihtiyacı ve mutfak üretim planı. Satın alma talebi de eksiği buradaki hesapla, etkinlikler
 * kilitliyken yeniden bulur.
 *
 * - Menüler (kurslar + yemekler) tek sorguda, reçete grafiği seviye başına tek sorguda, talep
 *   edilmiş miktarlar tek toplama sorgusunda gelir; hesap bellekte (N+1 yok). İhtiyaç / üretim planı /
 *   talep **yalın yükleyiciyle** (başlık + yemekler tek düz sorgu) ve bütün menüler için **tek önbellekli
 *   reçete hesaplayıcısıyla** çalışır; ihtiyaç günü aynı anlar için bir kez biçimlenir (ölçüm notu).
 * - **Aralık etkinlik seçer:** servis günü aralığa düşen menüsü olan etkinliklerin *bütün* menüleri
 *   hesaba girer — talep etkinlik × malzeme düzeyinde izlenir; çok günlü etkinliğin eksiği yarım
 *   hesaplanmasın.
 * - Sınırlar: bir hesaba en fazla `MAX_NEEDS_MENUS` menü, üretim planında `MAX_PRODUCTION_TASKS`
 *   görev; aşılırsa aralık daraltılır (sessizce kesilmez).
 * - Maliyet (KDV hariç, malzemenin güncel birim maliyeti; fazla hazırlık dahil) yalnızca reçete
 *   görme izni olana döner.
 */

const DAY_MS = 86_400_000;
/** Etkinlik ekranında gösterilen son talepler. */
const EVENT_REQUEST_PREVIEW = 20;

const MENU_SELECT = Object.freeze({
  id: true,
  eventId: true,
  sessionId: true,
  sourceMenuId: true,
  name: true,
  serveAt: true,
  guests: true,
  pricePerPerson: true,
  discountPct: true,
  taxCategory: true,
  notes: true,
  sortOrder: true,
  finalizedAt: true,
  finalizedBy: true,
  updatedAt: true,
  event: { select: { id: true, code: true, name: true, status: true, billablePax: true } },
  session: { select: { id: true, title: true, startAt: true, endAt: true, venue: { select: { name: true } } } },
  sourceMenu: { select: { id: true, name: true } },
  item: { select: { id: true, netAmount: true, total: true, billedQuantity: true } },
  courses: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      mode: true,
      dishes: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, recipeId: true, label: true, portionsPerGuest: true, guestCount: true, recipe: { select: { name: true, code: true, station: true, kind: true, isActive: true } } },
      },
    },
  },
});

/** "YYYY-AA-GG" + gün. @param {string} day @param {number} days */
const addDay = (day, days) => new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
/** Otel gününün başlangıç anı. @param {string} day @param {string} timezone */
const dayStart = (day, timezone) => zonedWallTimeToUtc(`${day}T00:00`, timezone);
/** @param {Date} at @param {string} timezone */
const localOf = (at, timezone) => utcToZonedWallTime(at, timezone);

/**
 * Menüleri yükler; sınırı aşarsa durur.
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {Record<string, any>} where
 * @param {number} limit
 */
export async function loadMenus(client, where, limit) {
  const rows = await client.eventMenu.findMany({ where, orderBy: [{ serveAt: 'asc' }, { id: 'asc' }], take: limit + 1, select: MENU_SELECT });
  if (rows.length > limit) throw new ValidationError(`Bu aralıkta ${limit.toLocaleString('tr-TR')} menüden fazlası var; aralığı daraltın`, { field: 'to' });
  return rows;
}

/** Planlama (ihtiyaç, üretim, talep) için menü başlığı: yemekler ayrı, düz sorguyla gelir. */
const PLAN_MENU_SELECT = Object.freeze({
  id: true,
  eventId: true,
  name: true,
  serveAt: true,
  guests: true,
  notes: true,
  finalizedAt: true,
  event: { select: { id: true, code: true, name: true, status: true, billablePax: true } },
  session: { select: { title: true, venue: { select: { name: true } } } },
});

/**
 * Planlama menüleri (yalın): başlıklar + bütün yemekler tek düz sorguda (kurs sırası ve türüyle). Ekranın menü
 * sekmesi tam yükleyiciyi (`loadMenus`) kullanır; burada yemeğin adı / alerjeni gerekmez.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {Record<string, any>} where
 * @param {number} limit
 */
export async function loadPlanMenus(client, where, limit) {
  const rows = await client.eventMenu.findMany({ where, orderBy: [{ serveAt: 'asc' }, { id: 'asc' }], take: limit + 1, select: PLAN_MENU_SELECT });
  if (rows.length > limit) throw new ValidationError(`Bu aralıkta ${limit.toLocaleString('tr-TR')} menüden fazlası var; aralığı daraltın`, { field: 'to' });
  if (rows.length === 0) return rows;
  const dishes = await client.$queryRaw`
    SELECT d."eventMenuId", d."courseId", c."mode"::text AS "mode", d."recipeId", d."portionsPerGuest"::text AS "portionsPerGuest", d."guestCount"
    FROM "EventMenuDish" d JOIN "EventMenuCourse" c ON c."id" = d."courseId"
    WHERE d."eventMenuId" = ANY(${rows.map((row) => row.id)}::text[])
    ORDER BY d."eventMenuId", c."sortOrder", d."sortOrder"`;
  /** @type {Map<string, Map<string, { mode: string, dishes: any[] }>>} */
  const courses = new Map();
  for (const dish of dishes) {
    if (!courses.has(dish.eventMenuId)) courses.set(dish.eventMenuId, new Map());
    const byCourse = courses.get(dish.eventMenuId);
    if (!byCourse.has(dish.courseId)) byCourse.set(dish.courseId, { mode: dish.mode, dishes: [] });
    byCourse.get(dish.courseId).dishes.push({ recipeId: dish.recipeId, portionsPerGuest: dish.portionsPerGuest, guestCount: dish.guestCount });
  }
  return rows.map((row) => ({ ...row, courses: [...(courses.get(row.id)?.values() ?? [])] }));
}

/**
 * Aralığa servis günü düşen menüsü olan etkinliklerin bütün menüleri.
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId @param {Date} from @param {Date} to @param {string[]} statuses
 */
export async function loadRangeMenus(client, hotelId, from, to, statuses) {
  const events = await client.eventMenu.findMany({
    where: { hotelId, serveAt: { gte: from, lt: to }, event: { status: { in: statuses } } },
    distinct: ['eventId'],
    select: { eventId: true },
  });
  if (events.length === 0) return [];
  return loadPlanMenus(client, { hotelId, eventId: { in: events.map((row) => row.eventId) }, event: { status: { in: statuses } } }, MAX_NEEDS_MENUS);
}

/**
 * Menülerin porsiyon planı ve malzeme talebi (tek grafikle).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId @param {any[]} rows @param {string} overproductionPct
 */
export async function computeMenus(client, hotelId, rows, overproductionPct) {
  const ids = rows.flatMap((row) => row.courses.flatMap((course) => course.dishes.map((dish) => dish.recipeId)));
  const graph = await loadRecipeGraph(client, hotelId, ids);
  const calculator = demandCalculator(graph);
  const plans = rows.map((row) => {
    const plan = menuPortions(
      {
        guests: row.guests,
        courses: row.courses.map((course) => ({
          mode: course.mode,
          dishes: course.dishes.map((dish) => ({ recipeId: dish.recipeId, portionsPerGuest: String(dish.portionsPerGuest), guestCount: dish.guestCount })),
        })),
      },
      row.event.billablePax,
      overproductionPct,
    );
    const demand = menuDemand(
      graph,
      plan.courses.flatMap((course) => course.dishes),
      calculator,
    );
    return { row, plan, demand };
  });
  return { graph, plans };
}

/**
 * İptal edilmemiş taleplerde etkinlik × malzeme talep edilmiş miktar.
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId @param {string[]} eventIds
 * @returns {Promise<Map<string, import('@hotelos/core').Decimal>>}
 */
export async function requestedQuantities(client, hotelId, eventIds) {
  if (eventIds.length === 0) return new Map();
  const rows = await client.$queryRaw`
    SELECT l."eventId", l."stockItemId", SUM(l."quantity")::text AS "quantity"
    FROM "PurchaseRequestLine" l
    JOIN "PurchaseRequest" r ON r."id" = l."requestId"
    WHERE l."hotelId" = ${hotelId} AND l."eventId" = ANY(${eventIds}::text[]) AND r."status" <> 'CANCELLED'
    GROUP BY l."eventId", l."stockItemId"`;
  return new Map(rows.map((row) => [`${row.eventId}|${row.stockItemId}`, toDecimal(row.quantity)]));
}

/**
 * Menülerin malzeme talebi → ihtiyaç girdileri (ihtiyaç günü otelin gününde).
 * @param {Array<{ row: any, demand: any }>} plans @param {string} timezone
 */
export function needEntries(plans, timezone) {
  // Aynı an (servis − süre) çok girdide tekrar eder; saat dilimi biçimlemesi pahalı, bir kez yapılır.
  /** @type {Map<number, string>} */
  const days = new Map();
  const dayOf = (instant) => {
    let text = days.get(instant);
    if (!text) {
      text = localOf(new Date(instant), timezone).slice(0, 10);
      days.set(instant, text);
    }
    return text;
  };
  return plans.flatMap(({ row, demand }) =>
    [...demand.stock].map(([stockItemId, entry]) => ({
      eventId: row.eventId,
      status: row.event.status,
      stockItemId,
      quantity: entry.quantity,
      needDay: dayOf(row.serveAt.getTime() - entry.offset * 60_000),
    })),
  );
}

/**
 * Üretim planı penceresi: bir görev servisten en çok (en uzun hazırlık süresi × derinlik) önce başlar.
 * Sabit üst sınır (3 gün × 4 seviye = 12 gün) yerine otelin gerçek en uzun süresi: 1 günlük plan 12 günlük
 * menü yüklemesin.
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId
 */
async function maxTaskOffsetMinutes(client, hotelId) {
  const [row] = await client.$queryRaw`SELECT COALESCE(MAX("leadMinutes"), 0)::int AS "lead" FROM "Recipe" WHERE "hotelId" = ${hotelId}`;
  return Math.min(row.lead, MAX_RECIPE_LEAD_MINUTES) * MAX_RECIPE_DEPTH;
}

const GROUP_ORDER = new Map(STOCK_ITEM_GROUPS.map((group, index) => [group, index]));

/**
 * Malzeme satırları: grup sırası, sonra ad.
 * @param {Map<string, any>} items aggregateNeeds().items
 * @param {Map<string, any>} stockItems
 * @param {boolean} withCost
 */
function needRows(items, stockItems, withCost) {
  return [...items.values()]
    .map((item) => {
      const stock = stockItems.get(item.stockItemId);
      const all = item.definite.plus(item.tentative);
      return {
        stockItemId: item.stockItemId,
        code: stock.code,
        name: stock.name,
        group: stock.group,
        unit: stock.unit,
        isActive: stock.isActive,
        allergens: stock.allergens,
        needed: all.toString(),
        definite: item.definite.toString(),
        tentative: item.tentative.toString(),
        requested: item.requested.toString(),
        shortfall: item.shortfall.toString(),
        needDay: item.needDay,
        events: item.events.size,
        ...(withCost
          ? { unitCost: unitCostText(stock.unitCost), cost: moneyText(item.definite.times(toDecimal(stock.unitCost))), possibleCost: moneyText(all.times(toDecimal(stock.unitCost))) }
          : {}),
      };
    })
    .sort((a, b) => (GROUP_ORDER.get(a.group) ?? 99) - (GROUP_ORDER.get(b.group) ?? 99) || a.name.localeCompare(b.name, 'tr'));
}

/**
 * Menünün maliyeti (fazla hazırlık dahil, üretim miktarlarıyla) ve eksik birim maliyetleri.
 * @param {any} demand @param {Map<string, any>} stockItems
 */
function demandCost(demand, stockItems) {
  let total = toDecimal(0);
  let missing = 0;
  for (const [id, entry] of demand.stock) {
    const unitCost = toDecimal(stockItems.get(id).unitCost);
    if (unitCost.isZero()) missing += 1;
    total = total.plus(entry.quantity.times(unitCost));
  }
  return { total, missing };
}

/**
 * Etkinliğin menü sekmesi: menüler (porsiyon planı, alerjen, maliyet), malzeme ihtiyacı
 * (etkinlik kesinse eksik ve talep), etkinliğin satın alma talepleri.
 *
 * @param {string} hotelId @param {string} eventId @param {{ withCost: boolean }} options
 */
export async function getEventFnb(hotelId, eventId, { withCost }) {
  const [{ timezone }, settings, event] = await Promise.all([
    hotelContext(hotelId),
    loadEventSettings(prisma, hotelId),
    prisma.event.findFirst({
      where: { id: eventId, hotelId },
      select: { id: true, code: true, name: true, status: true, billablePax: true, guaranteedPax: true, expectedPax: true, currency: true, firstStartAt: true, updatedAt: true },
    }),
  ]);
  if (!event) throw new NotFoundError('Etkinlik bulunamadı');
  const rows = await loadMenus(prisma, { hotelId, eventId }, MAX_EVENT_MENUS);
  const [{ graph, plans }, requested, requests] = await Promise.all([
    computeMenus(prisma, hotelId, rows, settings.overproductionPct),
    requestedQuantities(prisma, hotelId, [eventId]),
    prisma.purchaseRequest.findMany({
      where: { hotelId, lines: { some: { eventId } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: EVENT_REQUEST_PREVIEW,
      select: { id: true, number: true, status: true, neededBy: true, requestedBy: true, createdAt: true, _count: { select: { lines: { where: { eventId } } } } },
    }),
  ]);
  const cost = withCost ? costCalculator(graph) : null;
  const allergens = allergenCalculator(graph);
  const { items } = aggregateNeeds(needEntries(plans, timezone), requested, new Map([...graph.stockItems.values()].map((item) => [item.id, item.unit])));

  let totalCost = toDecimal(0);
  let totalNet = toDecimal(0);
  const menus = plans.map(({ row, plan, demand }) => {
    const menuAllergens = new Set();
    const courses = row.courses.map((course, i) => ({
      id: course.id,
      name: course.name,
      mode: course.mode,
      issue: plan.courses[i].issue,
      dishes: course.dishes.map((dish, j) => {
        const dishAllergens = allergens(dish.recipeId);
        dishAllergens.forEach((allergen) => menuAllergens.add(allergen));
        return {
          id: dish.id,
          recipeId: dish.recipeId,
          recipe: dish.recipe,
          label: dish.label,
          portionsPerGuest: quantityText(dish.portionsPerGuest),
          guestCount: dish.guestCount,
          servedGuests: plan.courses[i].dishes[j].servedGuests,
          portions: plan.courses[i].dishes[j].portions,
          allergens: dishAllergens,
          ...(cost ? { costPerPortion: moneyText(cost(dish.recipeId).perUnit) } : {}),
        };
      }),
    }));
    const net = toDecimal(String(row.item?.netAmount ?? 0));
    let costView = {};
    if (cost) {
      const { total, missing } = demandCost(demand, graph.stockItems);
      totalCost = totalCost.plus(total);
      totalNet = totalNet.plus(net);
      costView = {
        cost: {
          total: moneyText(total),
          perGuest: plan.guests ? moneyText(total.dividedBy(plan.guests)) : '0.00',
          foodCostPct: net.isZero() ? null : total.times(100).dividedBy(net).toDecimalPlaces(1).toString(),
          missing,
        },
      };
    }
    return {
      id: row.id,
      name: row.name,
      sourceMenu: row.sourceMenu,
      session: { id: row.session.id, title: row.session.title, startLocal: localOf(row.session.startAt, timezone), endLocal: localOf(row.session.endAt, timezone), venueName: row.session.venue.name },
      serveAt: iso(row.serveAt),
      serveLocal: localOf(row.serveAt, timezone),
      guests: plan.guests,
      guestsFixed: row.guests,
      productionGuests: plan.productionGuests,
      pricePerPerson: moneyText(row.pricePerPerson),
      discountPct: quantityText(row.discountPct),
      taxCategory: row.taxCategory,
      notes: row.notes,
      sortOrder: row.sortOrder,
      finalizedAt: iso(row.finalizedAt),
      finalizedBy: row.finalizedBy,
      updatedAt: iso(row.updatedAt),
      item: row.item ? { id: row.item.id, netAmount: moneyText(row.item.netAmount), total: moneyText(row.item.total), billedQuantity: quantityText(row.item.billedQuantity) } : null,
      courses,
      allergens: sortAllergens(menuAllergens),
      issues: plan.issues,
      ...costView,
    };
  });

  const firstDay = event.firstStartAt ? localOf(event.firstStartAt, timezone).slice(0, 10) : null;
  return {
    event: { id: event.id, code: event.code, name: event.name, status: event.status, billablePax: event.billablePax, guaranteedPax: event.guaranteedPax, expectedPax: event.expectedPax, currency: event.currency, updatedAt: iso(event.updatedAt) },
    overproductionPct: settings.overproductionPct,
    finalizeDueDay: menus.some((menu) => !menu.finalizedAt) ? menuFinalizeDueDay(firstDay, settings.menuFinalizeDays) : null,
    planned: FNB_PLANNED_STATUSES.includes(event.status),
    menus,
    needs: needRows(items, graph.stockItems, withCost),
    ...(withCost ? { totals: { cost: moneyText(totalCost), netRevenue: moneyText(totalNet), foodCostPct: totalNet.isZero() ? null : totalCost.times(100).dividedBy(totalNet).toDecimalPlaces(1).toString() } } : {}),
    requests: requests.map((request) => ({
      id: request.id,
      number: request.number,
      status: request.status,
      neededBy: request.neededBy.toISOString().slice(0, 10),
      requestedBy: request.requestedBy,
      createdAt: iso(request.createdAt),
      lines: request._count.lines,
    })),
    timezone,
  };
}

/**
 * Servis günü aralığının malzeme ihtiyacı (kesin; istenirse opsiyonlu ayrı sütunda). `stockItemId`
 * verilirse o malzemenin etkinlik dökümü de döner.
 *
 * @param {string} hotelId
 * @param {{ from: string, to: string, includeTentative: boolean, stockItemId?: string }} query
 * @param {{ withCost: boolean }} options
 */
export async function getNeeds(hotelId, query, { withCost }) {
  const [{ timezone }, settings] = await Promise.all([hotelContext(hotelId), loadEventSettings(prisma, hotelId)]);
  const statuses = [...FNB_PLANNED_STATUSES, ...(query.includeTentative ? FNB_POSSIBLE_STATUSES : [])];
  const rows = await loadRangeMenus(prisma, hotelId, dayStart(query.from, timezone), dayStart(addDay(query.to, 1), timezone), statuses);
  const plannedEventIds = [...new Set(rows.filter((row) => FNB_PLANNED_STATUSES.includes(row.event.status)).map((row) => row.eventId))];
  const [{ graph, plans }, requested] = await Promise.all([computeMenus(prisma, hotelId, rows, settings.overproductionPct), requestedQuantities(prisma, hotelId, plannedEventIds)]);
  const { perEvent, items } = aggregateNeeds(needEntries(plans, timezone), requested, new Map([...graph.stockItems.values()].map((item) => [item.id, item.unit])));
  const result = {
    from: query.from,
    to: query.to,
    includeTentative: query.includeTentative,
    overproductionPct: settings.overproductionPct,
    menus: rows.length,
    events: new Set(rows.map((row) => row.eventId)).size,
    items: needRows(items, graph.stockItems, withCost),
    ...(withCost
      ? { totals: { cost: moneyText([...items.values()].reduce((total, item) => total.plus(item.definite.times(toDecimal(graph.stockItems.get(item.stockItemId).unitCost))), toDecimal(0))) } }
      : {}),
  };
  if (!query.stockItemId) return result;

  const events = new Map(rows.map((row) => [row.eventId, row.event]));
  const firstServe = new Map();
  for (const row of rows) if (!firstServe.has(row.eventId)) firstServe.set(row.eventId, localOf(row.serveAt, timezone));
  return {
    ...result,
    breakdown: perEvent
      .filter((row) => row.stockItemId === query.stockItemId)
      .map((row) => ({
        eventId: row.eventId,
        code: events.get(row.eventId).code,
        name: events.get(row.eventId).name,
        status: row.status,
        firstServeLocal: firstServe.get(row.eventId),
        needed: row.needed.toString(),
        requested: row.requested.toString(),
        shortfall: row.shortfall.toString(),
        needDay: row.needDay,
      }))
      .sort((a, b) => a.needDay.localeCompare(b.needDay) || a.code.localeCompare(b.code)),
  };
}

/**
 * Mutfak üretim planı: hazırlığı aralıkta başlayan görevler (yemekler ve ara ürünler), otelin
 * gününe ve saatine göre. Ara ürünü başka günün yemeği için olsa da başladığı güne düşer.
 *
 * @param {string} hotelId
 * @param {{ from: string, to: string, includeTentative: boolean, station?: string }} query
 */
export async function getProductionPlan(hotelId, query) {
  const [{ timezone }, settings, maxOffset] = await Promise.all([hotelContext(hotelId), loadEventSettings(prisma, hotelId), maxTaskOffsetMinutes(prisma, hotelId)]);
  const statuses = [...FNB_PLANNED_STATUSES, ...(query.includeTentative ? FNB_POSSIBLE_STATUSES : [])];
  const from = dayStart(query.from, timezone);
  const to = dayStart(addDay(query.to, 1), timezone);
  const rows = await loadPlanMenus(
    prisma,
    { hotelId, serveAt: { gte: from, lt: new Date(to.getTime() + maxOffset * 60_000) }, event: { status: { in: statuses } } },
    MAX_NEEDS_MENUS,
  );
  const { graph, plans } = await computeMenus(prisma, hotelId, rows, settings.overproductionPct);

  const tasks = [];
  for (const { row, demand, plan } of plans) {
    for (const task of productionTasks(graph, row.serveAt, demand)) {
      if (task.startAt < from || task.startAt >= to) continue;
      if (query.station && task.station !== query.station) continue;
      tasks.push({
        key: `${row.id}:${task.recipeId}`,
        kind: task.kind,
        recipeId: task.recipeId,
        name: task.name,
        station: task.station,
        quantity: task.quantity,
        unit: task.unit,
        startAt: iso(task.startAt),
        startLocal: localOf(task.startAt, timezone),
        readyLocal: localOf(task.readyAt, timezone),
        serveLocal: localOf(row.serveAt, timezone),
        usedBy: task.usedBy,
        event: { id: row.event.id, code: row.event.code, name: row.event.name, status: row.event.status },
        menu: { id: row.id, name: row.name, finalized: Boolean(row.finalizedAt), guests: plan.guests, notes: row.notes },
        venueName: row.session.venue.name,
        sessionTitle: row.session.title,
      });
      if (tasks.length > MAX_PRODUCTION_TASKS) throw new ValidationError(`Bu aralıkta ${MAX_PRODUCTION_TASKS.toLocaleString('tr-TR')} görevden fazlası var; aralığı ya da istasyonu daraltın`, { field: 'to' });
    }
  }
  tasks.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.station.localeCompare(b.station) || a.name.localeCompare(b.name, 'tr'));

  /** @type {Map<string, Map<string, any[]>>} */
  const days = new Map();
  for (const task of tasks) {
    const day = task.startLocal.slice(0, 10);
    const hour = `${task.startLocal.slice(11, 13)}:00`;
    if (!days.has(day)) days.set(day, new Map());
    const hours = days.get(day);
    if (!hours.has(hour)) hours.set(hour, []);
    hours.get(hour).push(task);
  }
  return {
    from: query.from,
    to: query.to,
    timezone,
    includeTentative: query.includeTentative,
    counts: { tasks: tasks.length, menus: new Set(tasks.map((task) => task.menu.id)).size, events: new Set(tasks.map((task) => task.event.id)).size },
    unfinalized: new Set(tasks.filter((task) => !task.menu.finalized).map((task) => task.menu.id)).size,
    days: [...days].map(([day, hours]) => ({ day, hours: [...hours].map(([hour, list]) => ({ hour, tasks: list })) })),
  };
}
