import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/**
 * Banket F&B planlaması uçlarının büyük veride süresi (modül 43; ölçüm aracı, üretimde çalışmaz).
 *
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-banquet-fnb.mjs
 *
 * Önce banketin ölçüm verisi kurulmuş olmalı (`perf-banquet.mjs`: ~35.000 etkinlik, ~38.700 oturum). Kurulum (yoksa;
 * tamsa tekrar kurmaz):
 * - 1.500 malzeme kartı (11 grup, alerjenli), 3.000 reçete: 300 temel ara ürün (yalnız malzeme), 300 bileşik ara
 *   ürün (temel ara ürün + malzeme), 2.400 yemek (6–14 malzeme, yarısında bir ara ürün) — zincir yemek → ara → ara.
 * - 60 set menü (4–5 kurs, biri seçmeli).
 * - Opsiyonlu / kesin / gerçekleşmiş her etkinliğe 1–3 menü (4–5 kurs, 8–15 yemek; seçmeli kursta sabit kişiler).
 * - 20.000 satın alma talebi (her biri 8–12 satır, geçmiş ve gelecek etkinliklere; %15 iptal).
 *
 * Ölçülen: reçete listesi / ekranı / önizleme / seçici, malzeme listesi, set menü listesi / ekranı, etkinliğin menü
 * sekmesi, ihtiyaç (7 / 31 gün, olası dahil, malzeme dökümü), üretim planı (1 / 7 gün), talep listesi (ilk sayfa,
 * numara, malzeme adı, etkinlik, derin sayfa) ve ekranı, yazma yolu (menü kaydet / kesinleştir / yeniden aç / kaldır,
 * bir günün et grubundan talep); sonunda sorgu planları.
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 5);
const ACTOR = 'perf-fnb';
const STOCK_COUNT = 1500;
const BASE_PREPS = 300;
const COMPOSITE_PREPS = 300;
const DISHES = 2400;
const CATALOG = 60;
const REQUESTS = 20_000;
const CHUNK = 5000;
const MINUTE_MS = 60_000;

const core = await import('@hotelos/core');
const contracts = await import('@hotelos/hotel-contracts');
const { Prisma } = await import('@prisma/client');
const { prisma } = await import('../src/db.js');
const { resolveHotelId } = await import('../src/lib/tenant.js');
const recipes = await import('../src/modules/recipes/recipes.js');
const stock = await import('../src/modules/recipes/stock-items.js');
const menus = await import('../src/modules/banquet/menus.js');
const eventMenus = await import('../src/modules/banquet/event-menus.js');
const fnb = await import('../src/modules/banquet/fnb-read.js');
const events = await import('../src/modules/banquet/events.js');
const purchasing = await import('../src/modules/purchasing/service.js');

const hotelId = await resolveHotelId();
const hotel = await prisma.hotel.findFirst({ where: { id: hotelId } });
const today = core.toIsoDay(core.calendarDateInTimeZone(hotel.timezone));
const day = (offset) => core.toIsoDay(core.addDays(new Date(`${today}T00:00:00.000Z`), offset));
const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: ACTOR }, fn);
const COST = { withCost: true };

let seed = 43_2026;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (min, max) => min + Math.floor(rand() * (max - min + 1));
const sample = (list, count) => {
  const chosen = new Set();
  while (chosen.size < Math.min(count, list.length)) chosen.add(pick(list));
  return [...chosen];
};
const insert = async (model, rows) => {
  for (let index = 0; index < rows.length; index += CHUNK) await prisma[model].createMany({ data: rows.slice(index, index + CHUNK) });
};

/* ══════════════════ Kurulum ══════════════════ */

const UNIT_BY_GROUP = { MEAT: 'KG', POULTRY: 'KG', SEAFOOD: 'KG', DAIRY: 'KG', PRODUCE: 'KG', DRY_GOODS: 'KG', PANTRY: 'L', BAKERY: 'PIECE', BEVERAGE: 'L', FROZEN: 'KG', OTHER: 'PIECE' };

if ((await prisma.stockItem.count({ where: { hotelId, createdBy: ACTOR } })) < STOCK_COUNT) {
  const started = performance.now();
  const now = new Date();
  const stockRows = Array.from({ length: STOCK_COUNT }, (_, index) => {
    const group = contracts.STOCK_ITEM_GROUPS[index % contracts.STOCK_ITEM_GROUPS.length];
    return {
      id: randomUUID(),
      hotelId,
      code: `PF-${String(index + 1).padStart(5, '0')}`,
      name: `Ölçüm malzemesi ${String(index + 1).padStart(5, '0')} ${contracts.STOCK_ITEM_GROUP_LABELS[group]}`,
      group,
      unit: UNIT_BY_GROUP[group],
      unitCost: (5 + rand() * 900).toFixed(4),
      costUpdatedAt: now,
      allergens: rand() < 0.25 ? [pick(contracts.ALLERGENS)] : [],
      createdBy: ACTOR,
    };
  });
  await insert('stockItem', stockRows);

  const recipeRows = [];
  const lineRows = [];
  const stockLine = (recipeId, sortOrder) => {
    const item = pick(stockRows);
    return { id: randomUUID(), hotelId, recipeId, sortOrder, stockItemId: item.id, quantity: (0.05 + rand() * 2).toFixed(4), unit: item.unit, wastePct: rand() < 0.4 ? String(between(5, 35)) : '0' };
  };
  const makeRecipe = (index, kind, yieldUnit) => {
    const id = randomUUID();
    recipeRows.push({
      id,
      hotelId,
      code: `PR-${String(index + 1).padStart(5, '0')}`,
      name: `Ölçüm reçetesi ${String(index + 1).padStart(5, '0')} ${kind === 'DISH' ? 'yemek' : 'ara ürün'}`,
      kind,
      station: kind === 'DISH' ? pick(['HOT', 'HOT', 'COLD', 'PASTRY']) : 'HOT',
      yieldQuantity: kind === 'DISH' ? String(between(10, 50)) : String(between(2, 10)),
      yieldUnit,
      leadMinutes: pick([30, 60, 90, 120, 180, 240, 360, 720, 1440]),
      createdBy: ACTOR,
    });
    return id;
  };
  const basePreps = Array.from({ length: BASE_PREPS }, (_, index) => {
    const id = makeRecipe(index, 'PREP', 'L');
    for (let line = 0; line < between(4, 8); line += 1) lineRows.push(stockLine(id, line));
    return id;
  });
  const compositePreps = Array.from({ length: COMPOSITE_PREPS }, (_, index) => {
    const id = makeRecipe(BASE_PREPS + index, 'PREP', 'KG');
    lineRows.push({ id: randomUUID(), hotelId, recipeId: id, sortOrder: 0, subRecipeId: pick(basePreps), quantity: (0.2 + rand() * 2).toFixed(4), unit: 'L', wastePct: '0' });
    for (let line = 1; line < between(3, 6); line += 1) lineRows.push(stockLine(id, line));
    return id;
  });
  const preps = [...basePreps, ...compositePreps];
  const dishes = Array.from({ length: DISHES }, (_, index) => {
    const id = makeRecipe(BASE_PREPS + COMPOSITE_PREPS + index, 'DISH', 'PORTION');
    const count = between(6, 14);
    for (let line = 0; line < count; line += 1) lineRows.push(stockLine(id, line));
    if (rand() < 0.5) {
      const prep = pick(preps);
      lineRows.push({ id: randomUUID(), hotelId, recipeId: id, sortOrder: count, subRecipeId: prep, quantity: (0.1 + rand()).toFixed(4), unit: compositePreps.includes(prep) ? 'KG' : 'L', wastePct: '0' });
    }
    return id;
  });
  await insert('recipe', recipeRows);
  await insert('recipeLine', lineRows);

  const courseRows = [];
  const dishRows = [];
  /** Kurslar: 4–5 kurs, biri seçmeli (2–3 yemek). */
  const coursesFor = (parentKey, parentId, withCounts, guests) => {
    const count = between(4, 5);
    const choiceAt = between(1, count - 1);
    for (let index = 0; index < count; index += 1) {
      const courseId = randomUUID();
      const mode = index === choiceAt ? 'CHOICE' : 'ALL';
      courseRows.push({ id: courseId, hotelId, [parentKey]: parentId, name: `Kurs ${index + 1}`, mode, sortOrder: index });
      const chosen = sample(dishes, mode === 'CHOICE' ? between(2, 3) : between(1, 3));
      chosen.forEach((recipeId, order) => {
        const guestCount = withCounts && mode === 'CHOICE' && order > 0 ? Math.max(1, Math.floor(guests * (0.1 + rand() * 0.2))) : null;
        dishRows.push({ id: randomUUID(), hotelId, courseId, recipeId, portionsPerGuest: mode === 'ALL' && rand() < 0.2 ? '0.5' : '1', sortOrder: order, ...(withCounts ? { eventMenuId: parentId, guestCount } : {}) });
      });
    }
  };

  const catalogRows = Array.from({ length: CATALOG }, (_, index) => {
    const id = randomUUID();
    coursesFor('menuId', id, false, 0);
    return { id, hotelId, code: `PM-${String(index + 1).padStart(3, '0')}`, name: `Ölçüm set menüsü ${index + 1}`, pricePerPerson: String(between(600, 2400)), createdBy: ACTOR };
  });
  await insert('banquetMenu', catalogRows);
  await insert('banquetMenuCourse', courseRows.splice(0));
  await insert('banquetMenuDish', dishRows.splice(0));

  // Etkinlik menüleri: opsiyonlu / kesin / gerçekleşmiş etkinliklerin ilk oturumları.
  const sessions = await prisma.$queryRaw`
    SELECT DISTINCT ON (s."eventId") s."id", s."eventId", s."startAt", s."endAt", s."pax"
    FROM "EventSession" s JOIN "Event" e ON e."id" = s."eventId"
    WHERE s."hotelId" = ${hotelId} AND e."status" IN ('TENTATIVE', 'DEFINITE', 'COMPLETED')
    ORDER BY s."eventId", s."startAt"`;
  const menuRows = [];
  for (const session of sessions) {
    const count = 1 + (rand() < 0.4 ? 1 : 0) + (rand() < 0.15 ? 1 : 0);
    for (let index = 0; index < count; index += 1) {
      const id = randomUUID();
      const serveAt = new Date(Math.min(session.startAt.getTime() + (60 + index * 120) * MINUTE_MS, session.endAt.getTime()));
      const guests = rand() < 0.2 ? session.pax : null;
      coursesFor('eventMenuId', id, true, guests ?? session.pax);
      menuRows.push({ id, hotelId, eventId: session.eventId, sessionId: session.id, sourceMenuId: pick(catalogRows).id, name: `Menü ${index + 1}`, serveAt, guests, pricePerPerson: String(between(600, 2400)), sortOrder: index, createdBy: ACTOR, finalizedAt: rand() < 0.5 ? serveAt : null, finalizedBy: null });
    }
  }
  for (const row of menuRows) if (row.finalizedAt) row.finalizedBy = ACTOR;
  await insert('eventMenu', menuRows);
  await insert('eventMenuCourse', courseRows);
  await insert('eventMenuDish', dishRows);

  const eventIds = sessions.map((session) => session.eventId);
  const requestRows = [];
  const requestLines = [];
  for (let index = 0; index < REQUESTS; index += 1) {
    const id = randomUUID();
    const cancelled = rand() < 0.15;
    const createdAt = new Date(Date.now() - between(0, 700) * 86_400_000);
    const neededBy = new Date(`${core.toIsoDay(new Date(createdAt.getTime() + between(1, 20) * 86_400_000))}T00:00:00.000Z`);
    requestRows.push({
      id,
      hotelId,
      number: `${contracts.PURCHASE_REQUEST_PREFIX}-P${String(index + 1).padStart(6, '0')}`,
      status: cancelled ? 'CANCELLED' : 'OPEN',
      source: 'BANQUET',
      neededBy,
      requestedBy: ACTOR,
      createdAt,
      ...(cancelled ? { cancelledAt: createdAt, cancelledBy: ACTOR, cancelReason: 'Ölçüm iptali' } : {}),
    });
    const eventId = pick(eventIds);
    sample(stockRows, between(8, 12)).forEach((item, order) => {
      requestLines.push({ id: randomUUID(), hotelId, requestId: id, stockItemId: item.id, quantity: (1 + rand() * 40).toFixed(3), unit: item.unit, neededBy, eventId, estimatedUnitCost: item.unitCost, sortOrder: order });
    });
  }
  await insert('purchaseRequest', requestRows);
  await insert('purchaseRequestLine', requestLines);
  for (const table of ['StockItem', 'Recipe', 'RecipeLine', 'BanquetMenu', 'BanquetMenuCourse', 'BanquetMenuDish', 'EventMenu', 'EventMenuCourse', 'EventMenuDish', 'PurchaseRequest', 'PurchaseRequestLine']) {
    await prisma.$executeRawUnsafe(`ANALYZE "${table}"`);
  }
  console.log(
    `Kurulum: ${stockRows.length} malzeme, ${recipeRows.length} reçete (${lineRows.length} satır), ${catalogRows.length} set menü, ${menuRows.length} etkinlik menüsü, ` +
      `${requestRows.length} talep (${requestLines.length} satır) · ${((performance.now() - started) / 1000).toFixed(0)} sn`,
  );
}

/* ══════════════════ Ölçüm ══════════════════ */

const results = [];
async function measure(name, fn, rounds = ROUNDS) {
  const times = [];
  let last;
  for (let round = 0; round < rounds; round += 1) {
    const begin = performance.now();
    last = await fn(round);
    times.push(performance.now() - begin);
  }
  const sorted = (rounds > 1 ? times.slice(1) : times).sort((a, b) => a - b);
  results.push({ name, best: sorted[0], median: sorted[Math.floor(sorted.length / 2)], worst: sorted.at(-1) });
  return last;
}

const parse = (schema, input) => contracts[schema].parse(input);
const dish = await prisma.recipe.findFirst({ where: { hotelId, createdBy: ACTOR, kind: 'DISH', lines: { some: { subRecipe: { kind: 'PREP', lines: { some: { subRecipeId: { not: null } } } } } } }, select: { id: true, name: true } });
const dishDetail = await recipes.getRecipe(hotelId, dish.id);
const catalogMenu = await prisma.banquetMenu.findFirst({ where: { hotelId, createdBy: ACTOR }, select: { id: true } });
const busyEvent = await prisma.event.findFirst({
  where: { hotelId, status: 'DEFINITE', firstStartAt: { gt: new Date() }, menus: { some: {} } },
  orderBy: [{ menus: { _count: 'desc' } }],
  select: { id: true },
});
const request = await prisma.purchaseRequest.findFirst({ where: { hotelId, requestedBy: ACTOR }, orderBy: { createdAt: 'desc' }, select: { id: true, number: true } });
const stockName = (await prisma.stockItem.findFirst({ where: { hotelId, createdBy: ACTOR }, select: { name: true } })).name;

await measure('reçete listesi (ilk sayfa, maliyetli)', () => recipes.listRecipes(hotelId, parse('recipeListQuerySchema', {})));
await measure('reçete listesi (ara ürünler)', () => recipes.listRecipes(hotelId, parse('recipeListQuerySchema', { kind: 'PREP' })));
await measure('reçete listesi (arama)', () => recipes.listRecipes(hotelId, parse('recipeListQuerySchema', { search: '01234' })));
await measure('reçete ekranı (3 seviye)', () => recipes.getRecipe(hotelId, dish.id));
await measure('reçete önizlemesi (kaydetmeden)', () =>
  recipes.previewRecipe(hotelId, parse('recipePreviewSchema', { recipeId: dish.id, kind: 'DISH', yieldQuantity: dishDetail.yieldQuantity, yieldUnit: 'PORTION', lines: dishDetail.lines.map((line) => ({ stockItemId: line.stockItemId, subRecipeId: line.subRecipeId, quantity: line.quantity, unit: line.unit, wastePct: line.wastePct })) })),
);
await measure('reçete seçici (yemek, arama)', () => recipes.pickRecipes(hotelId, parse('recipePickerQuerySchema', { kind: 'DISH', search: 'yemek' }), COST));
await measure('malzeme listesi (arama)', () => stock.listStockItems(hotelId, parse('stockItemListQuerySchema', { search: stockName.split(' ')[2] })));
await measure('set menü listesi (maliyetli)', () => menus.listMenus(hotelId, parse('banquetMenuListQuerySchema', {}), COST));
await measure('set menü ekranı', () => menus.getMenu(hotelId, catalogMenu.id, COST));
await measure('etkinliğin menü sekmesi', () => fnb.getEventFnb(hotelId, busyEvent.id, COST));
await measure('ihtiyaç (7 gün)', () => fnb.getNeeds(hotelId, { from: today, to: day(6), includeTentative: false }, COST));
const month = await measure('ihtiyaç (31 gün, olası dahil)', () => fnb.getNeeds(hotelId, { from: today, to: day(30), includeTentative: true }, COST));
await measure('ihtiyaç (31 gün, malzeme dökümü)', () => fnb.getNeeds(hotelId, { from: today, to: day(30), includeTentative: true, stockItemId: month.items[0].stockItemId }, COST));
await measure('üretim planı (1 gün)', () => fnb.getProductionPlan(hotelId, { from: day(1), to: day(1), includeTentative: false }));
const week = await measure('üretim planı (7 gün)', () => fnb.getProductionPlan(hotelId, { from: today, to: day(6), includeTentative: true }));
await measure('talepler (ilk sayfa)', () => purchasing.listRequests(hotelId, parse('purchaseRequestListQuerySchema', {})));
await measure('talepler (açık)', () => purchasing.listRequests(hotelId, parse('purchaseRequestListQuerySchema', { status: 'OPEN' })));
await measure('talepler (numara)', () => purchasing.listRequests(hotelId, parse('purchaseRequestListQuerySchema', { search: request.number.slice(-5) })));
await measure('talepler (malzeme adı)', () => purchasing.listRequests(hotelId, parse('purchaseRequestListQuerySchema', { search: stockName.split(' ')[2] })));
await measure('talepler (etkinlik)', () => purchasing.listRequests(hotelId, parse('purchaseRequestListQuerySchema', { eventId: busyEvent.id })));
await measure('talepler (derin sayfa 700)', () => purchasing.listRequests(hotelId, parse('purchaseRequestListQuerySchema', { page: 700 })));
await measure('talep ekranı', () => purchasing.getRequest(hotelId, request.id));

// Yazma yolu: 15 yemekli menü kaydet → kesinleştir → yeniden aç → kaldır.
const target = await events.getEvent(hotelId, busyEvent.id);
const writeDishes = (await prisma.recipe.findMany({ where: { hotelId, createdBy: ACTOR, kind: 'DISH' }, take: 15, select: { id: true } })).map((row) => row.id);
await measure(
  'menü kaydet → kesinleştir → yeniden aç → kaldır',
  async () => {
    let current = await events.getEvent(hotelId, target.id);
    const session = current.sessions[0];
    let view = await as(() =>
      eventMenus.saveEventMenu(
        hotelId,
        target.id,
        null,
        parse('saveEventMenuSchema', {
          expectedUpdatedAt: current.updatedAt,
          sessionId: session.id,
          name: 'Ölçüm menüsü',
          serveAt: session.startLocal,
          pricePerPerson: '1500',
          courses: [
            { name: 'Başlangıç', mode: 'ALL', dishes: writeDishes.slice(0, 5).map((recipeId) => ({ recipeId })) },
            { name: 'Ana', mode: 'CHOICE', dishes: writeDishes.slice(5, 8).map((recipeId, index) => ({ recipeId, guestCount: index ? 10 : null })) },
            { name: 'Tatlı', mode: 'ALL', dishes: writeDishes.slice(8, 15).map((recipeId) => ({ recipeId, portionsPerGuest: '0.5' })) },
          ],
        }),
        COST,
      ),
    );
    const menuId = view.menus.find((menu) => menu.name === 'Ölçüm menüsü').id;
    current = await events.getEvent(hotelId, target.id);
    view = await as(() => eventMenus.finalizeEventMenu(hotelId, target.id, menuId, { expectedUpdatedAt: new Date(current.updatedAt) }, COST));
    current = await events.getEvent(hotelId, target.id);
    await as(() => eventMenus.reopenEventMenu(hotelId, target.id, menuId, { expectedUpdatedAt: new Date(current.updatedAt), reason: 'Ölçüm turu' }, COST));
    current = await events.getEvent(hotelId, target.id);
    return as(() => eventMenus.deleteEventMenu(hotelId, target.id, menuId, { expectedUpdatedAt: new Date(current.updatedAt) }, COST));
  },
  4,
);

// Bir günün et grubunun eksiği talebe (kilit altında yeniden hesap + dağıtım).
const tomorrowNeeds = await fnb.getNeeds(hotelId, { from: day(1), to: day(1), includeTentative: false }, COST);
const meat = tomorrowNeeds.items.filter((row) => row.group === 'MEAT' && Number(row.shortfall) > 0).slice(0, 40);
if (meat.length) {
  await measure(
    `talep aç (yarın, et grubu ${meat.length} malzeme)`,
    () => as(() => purchasing.createFromBanquet(hotelId, parse('createBanquetPurchaseRequestSchema', { from: day(1), to: day(1), lines: meat.map((row) => ({ stockItemId: row.stockItemId, quantity: row.shortfall, expectedShortfall: row.shortfall })) }))),
    1,
  );
}

/* ══════════════════ Plan ══════════════════ */

const plans = {};
const capture = async (name, sql) => {
  const explained = await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
  plans[name] = explained.map((row) => row['QUERY PLAN']).filter((text) => /Index|Execution Time|Seq Scan|Bitmap/.test(text));
};
await capture(
  'aralığın menüleri (31 gün)',
  Prisma.sql`SELECT DISTINCT m."eventId" FROM "EventMenu" m JOIN "Event" e ON e."id" = m."eventId" WHERE m."hotelId" = ${hotelId} AND m."serveAt" >= ${`${today}T00:00:00Z`}::timestamp AND m."serveAt" < ${`${day(31)}T00:00:00Z`}::timestamp AND e."status" IN ('DEFINITE', 'TENTATIVE')`,
);
const monthEvents = (await prisma.eventMenu.findMany({ where: { hotelId, serveAt: { gte: new Date(`${today}T00:00:00Z`), lt: new Date(`${day(31)}T00:00:00Z`) } }, distinct: ['eventId'], select: { eventId: true } })).map((row) => row.eventId);
await capture(
  'talep edilmiş miktarlar (31 günün etkinlikleri)',
  Prisma.sql`SELECT l."eventId", l."stockItemId", SUM(l."quantity") FROM "PurchaseRequestLine" l JOIN "PurchaseRequest" r ON r."id" = l."requestId" WHERE l."hotelId" = ${hotelId} AND l."eventId" = ANY(${monthEvents}::text[]) AND r."status" <> 'CANCELLED' GROUP BY 1, 2`,
);
await capture('talepler (ilk sayfa)', Prisma.sql`SELECT "id" FROM "PurchaseRequest" WHERE "hotelId" = ${hotelId} ORDER BY "createdAt" DESC, "id" DESC LIMIT 25`);
await capture('reçete grafiği (seviye)', Prisma.sql`SELECT "recipeId", "stockItemId", "subRecipeId" FROM "RecipeLine" WHERE "recipeId" = ANY(${writeDishes}::text[]) ORDER BY "recipeId", "sortOrder"`);

const pad = (text, width) => String(text).padEnd(width);
console.log(`\nÖlçüm ayrıntısı: 31 günde ${month.events} etkinlik / ${month.menus} menü / ${month.items.length} malzeme · 7 günlük planda ${week.counts.tasks} görev`);
console.log(`\n${pad('ölçüm', 52)}${pad('en iyi', 10)}${pad('ortanca', 10)}en kötü`);
for (const row of results) console.log(`${pad(row.name, 52)}${pad(`${row.best.toFixed(0)} ms`, 10)}${pad(`${row.median.toFixed(0)} ms`, 10)}${row.worst.toFixed(0)} ms`);
for (const [name, lines] of Object.entries(plans)) {
  console.log(`\nPlan — ${name}:`);
  for (const line of lines) console.log(`  ${line.trim()}`);
}
await prisma.$disconnect();
