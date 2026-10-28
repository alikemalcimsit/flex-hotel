import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Banket F&B planlaması (modül 43) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: malzeme kartı (harf duyarsız ad, birim ailesi koruması), reçete (maliyet, fire, ara
 * reçete, alerjen, önizleme = kayıt, birim uyumu, döngü, derinlik, eşzamanlı döngü denemesi,
 * kullanılan reçetenin verim birimi, menü ürünü bağı), set menü kataloğu (kişi başı maliyet,
 * seçmelide en pahalı seçenek), etkinlik menüsü (fiyat kalemi ve toplamlar, porsiyon planı,
 * malzeme ve maliyet — elle hesaplanmış sayılarla, servis saati, kesinleştirme / kilit / yeniden
 * açma ve mutfak uyarıları, oturum kayması, kişi değişimi, kalem tablosunun menü kalemini
 * koruması, oturum silme), teklifte menü, aralık ihtiyacı (kesin / olası), satın alma talebi
 * (dağıtım, numara, eksik değişti, eşzamanlı aynı eksik, iptal, iptal edilen etkinlik uyarısı),
 * üretim planı (saatler, istasyon, aralık), hatırlatma işi, izinler ve otel kapsamı.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'banket@test.local';
const DESK = 'onburo@test.local';
const HOUSEKEEPING = 'kat@test.local';
const KITCHEN = 'mutfak@test.local';
const ACCOUNTING = 'muhasebe@test.local';

describe('banket F&B planlaması (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let setup;
  /** @type {any} */ let events;
  /** @type {any} */ let documents;
  /** @type {any} */ let jobs;
  /** @type {any} */ let stock;
  /** @type {any} */ let recipes;
  /** @type {any} */ let menus;
  /** @type {any} */ let eventMenus;
  /** @type {any} */ let fnb;
  /** @type {any} */ let purchasing;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let storageDir;
  let previousStorage;
  let hotelId;
  let otherHotelId;
  /** @type {any} */ let ballroom;
  /** @type {any} */ let client;
  /** @type {Record<string, any>} */ let item;
  /** @type {Record<string, any>} */ let recipe;
  /** @type {any} */ let catalog;
  /** @type {Map<string, string>} */ let tokens;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    previousStorage = process.env.FILE_STORAGE_DIR;
    storageDir = await mkdtemp(path.join(tmpdir(), 'hotelos-fnb-'));
    process.env.FILE_STORAGE_DIR = storageDir;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    setup = await import('./setup.js');
    events = await import('./events.js');
    documents = await import('./documents.js');
    jobs = await import('./jobs.js');
    stock = await import('../recipes/stock-items.js');
    recipes = await import('../recipes/recipes.js');
    menus = await import('./menus.js');
    eventMenus = await import('./event-menus.js');
    fnb = await import('./fnb-read.js');
    purchasing = await import('../purchasing/service.js');
    cache = await import('../../lib/cache.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
    await rm(storageDir, { recursive: true, force: true });
    if (previousStorage === undefined) delete process.env.FILE_STORAGE_DIR;
    else process.env.FILE_STORAGE_DIR = previousStorage;
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const boss = (fn) => as(MANAGER, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const D = (offset) => core.toIsoDay(core.addDays(today(), offset));
  const wall = (offset, time) => `${D(offset)}T${time}`;
  const COST = { withCost: true };

  async function rejectsWith(promise, code, message) {
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, code, `${error.code}: ${error.message}`);
      if (message) assert.match(error.message, message);
      return true;
    });
  }

  const newStock = (input) => boss(() => stock.createStockItem(hotelId, contracts.createStockItemSchema.parse(input)));
  const newRecipe = (input) => boss(() => recipes.createRecipe(hotelId, contracts.createRecipeSchema.parse(input)));
  const editRecipe = (current, changes) =>
    boss(() =>
      recipes.updateRecipe(
        hotelId,
        current.id,
        contracts.updateRecipeSchema.parse({
          expectedUpdatedAt: current.updatedAt,
          name: current.name,
          code: current.code,
          kind: current.kind,
          station: current.station,
          menuItemId: current.menuItem?.id ?? null,
          yieldQuantity: current.yieldQuantity,
          yieldUnit: current.yieldUnit,
          leadMinutes: current.leadMinutes,
          isActive: current.isActive,
          lines: current.lines.map((line) => ({ stockItemId: line.stockItemId, subRecipeId: line.subRecipeId, quantity: line.quantity, unit: line.unit, wastePct: line.wastePct })),
          ...changes,
        }),
      ),
    );
  const S = (stockItemId, quantity, unit, wastePct = '0') => ({ stockItemId, quantity, unit, wastePct });
  const R = (subRecipeId, quantity, unit) => ({ subRecipeId, quantity, unit });

  beforeEach(async () => {
    await resetDatabase(db);
    cache.cache.invalidatePrefix('settings:');
    tokens = new Map();
    const hotel = await db.hotel.create({ data: { name: 'Büyük Ankara Oteli', code: `F${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } });
    hotelId = hotel.id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka Otel', code: `O${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Banket Müdürü', role: 'MANAGER', passwordHash },
        { hotelId, email: DESK, name: 'Ön Büro', role: 'FRONT_DESK', passwordHash },
        { hotelId, email: HOUSEKEEPING, name: 'Kat', role: 'HOUSEKEEPING', passwordHash },
        { hotelId, email: KITCHEN, name: 'Mutfak Şefi', role: 'FNB', passwordHash },
        { hotelId, email: ACCOUNTING, name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
      ],
    });
    // Yiyecek KDV %10 dahil, salon KDV %20 dahil.
    await db.tax.createMany({
      data: [
        { hotelId, name: 'KDV', rate: '10', isIncluded: true, appliesTo: ['FNB'] },
        { hotelId, name: 'KDV', rate: '20', isIncluded: true, appliesTo: ['OTHER'] },
      ],
    });
    ballroom = await boss(() => setup.createVenue(hotelId, contracts.createVenueSchema.parse({ code: 'BALO', name: 'Büyük Balo Salonu', capacities: [{ layout: 'BANQUET', capacity: 600 }] })));
    client = await boss(() => setup.createClient(hotelId, contracts.createEventClientSchema.parse({ type: 'PERSON', name: 'Yılmaz Ailesi' })));
    await boss(() =>
      setup.updateSettings(
        hotelId,
        contracts.updateEventSettingsSchema.parse({ optionDays: 7, offerValidityDays: 14, depositPct: '30', requireSignedContract: false, cancellationTiers: [{ daysBefore: 0, feePct: '100' }], overproductionPct: '5', menuFinalizeDays: 7 }),
      ),
    );

    item = {
      kuzu: await newStock({ code: 'ET-001', name: 'Kuzu incik', group: 'MEAT', unit: 'KG', unitCost: '620' }),
      kemik: await newStock({ name: 'Dana kemik', group: 'MEAT', unit: 'KG', unitCost: '45' }),
      tereyag: await newStock({ name: 'Tereyağı', group: 'DAIRY', unit: 'KG', unitCost: '410', allergens: ['MILK'] }),
      sarap: await newStock({ name: 'Kırmızı şarap', group: 'BEVERAGE', unit: 'L', unitCost: '260', allergens: ['SULPHITES'] }),
      levrek: await newStock({ name: 'Levrek', group: 'SEAFOOD', unit: 'KG', unitCost: '540', allergens: ['FISH'] }),
      un: await newStock({ name: 'Un', group: 'DRY_GOODS', unit: 'KG', unitCost: '24', allergens: ['GLUTEN'] }),
      yumurta: await newStock({ name: 'Yumurta', group: 'DAIRY', unit: 'PIECE', unitCost: '4.25', allergens: ['EGGS'] }),
      mercimek: await newStock({ name: 'Kırmızı mercimek', group: 'DRY_GOODS', unit: 'KG', unitCost: '62' }),
      yesillik: await newStock({ name: 'Mevsim yeşillik', group: 'PRODUCE', unit: 'KG', unitCost: '90' }),
    };
    const demi = await newRecipe({ name: 'Demi-glace', kind: 'PREP', yieldQuantity: '5', yieldUnit: 'L', leadMinutes: 360, lines: [S(item.kemik.id, '4', 'KG'), S(item.sarap.id, '750', 'ML'), S(item.tereyag.id, '100', 'G')] });
    recipe = {
      demi,
      incik: await newRecipe({ name: 'Fırında kuzu incik', kind: 'DISH', yieldQuantity: '10', yieldUnit: 'PORTION', leadMinutes: 180, lines: [S(item.kuzu.id, '3.5', 'KG', '10'), R(demi.id, '1', 'L'), S(item.tereyag.id, '150', 'G')] }),
      levrek: await newRecipe({ name: 'Izgara levrek', kind: 'DISH', yieldQuantity: '1', yieldUnit: 'PORTION', leadMinutes: 30, lines: [S(item.levrek.id, '0.18', 'KG', '40')] }),
      manti: await newRecipe({ name: 'Sebzeli mantı', kind: 'DISH', yieldQuantity: '10', yieldUnit: 'PORTION', leadMinutes: 240, lines: [S(item.un.id, '1', 'KG'), S(item.yumurta.id, '3', 'PIECE')] }),
      corba: await newRecipe({ name: 'Mercimek çorbası', kind: 'DISH', yieldQuantity: '50', yieldUnit: 'PORTION', leadMinutes: 120, lines: [S(item.mercimek.id, '3', 'KG'), S(item.tereyag.id, '250', 'G')] }),
      salata: await newRecipe({ name: 'Mevsim salatası', kind: 'DISH', station: 'COLD', yieldQuantity: '10', yieldUnit: 'PORTION', leadMinutes: 90, lines: [S(item.yesillik.id, '1.2', 'KG', '25')] }),
    };
    catalog = await boss(() =>
      menus.createMenu(
        hotelId,
        contracts.createBanquetMenuSchema.parse({
          code: 'DUGUN-A',
          name: 'Düğün menüsü A',
          pricePerPerson: '1450',
          minGuests: 100,
          courses: [
            { name: 'Çorba', mode: 'ALL', dishes: [{ recipeId: recipe.corba.id }] },
            { name: 'Ana yemek', mode: 'CHOICE', dishes: [{ recipeId: recipe.incik.id }, { recipeId: recipe.levrek.id }, { recipeId: recipe.manti.id }] },
            { name: 'Büfe', mode: 'ALL', dishes: [{ recipeId: recipe.salata.id, portionsPerGuest: '0.3' }] },
          ],
        }),
        COST,
      ),
    );
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });

  /* ── Etkinlik yardımcıları ── */

  /** Kesin düğün: oturum gün `day` 19:00–23:30, garanti `pax`. Menü eklemek için önce talep hâlinde döner. */
  async function newWedding({ day = 30, pax = 350, name = 'Yılmaz düğünü' } = {}) {
    let event = await boss(() => events.createEvent(hotelId, contracts.createEventSchema.parse({ name, type: 'WEDDING', clientId: client.id, expectedPax: pax, guaranteedPax: pax })));
    event = await boss(() =>
      events.saveSession(
        hotelId,
        event.id,
        null,
        contracts.createSessionSchema.parse({ expectedUpdatedAt: event.updatedAt, title: 'Düğün yemeği', venueId: ballroom.id, layout: 'BANQUET', pax, startAt: wall(day, '19:00'), endAt: wall(day, '23:30') }),
      ),
    );
    return event;
  }

  /** Katalogdan etkinlik menüsü (seçmeli: 85 levrek, 12 mantı, kalanı incik). */
  const weddingMenu = (event, overrides = {}) =>
    contracts.saveEventMenuSchema.parse({
      expectedUpdatedAt: event.updatedAt,
      sessionId: event.sessions[0].id,
      sourceMenuId: catalog.id,
      name: catalog.name,
      serveAt: `${event.sessions[0].startLocal.slice(0, 10)}T20:00`,
      pricePerPerson: catalog.pricePerPerson,
      courses: [
        { name: 'Çorba', mode: 'ALL', dishes: [{ recipeId: recipe.corba.id }] },
        { name: 'Ana yemek', mode: 'CHOICE', dishes: [{ recipeId: recipe.incik.id }, { recipeId: recipe.levrek.id, guestCount: 85 }, { recipeId: recipe.manti.id, guestCount: 12 }] },
        { name: 'Büfe', mode: 'ALL', dishes: [{ recipeId: recipe.salata.id, portionsPerGuest: '0.3' }] },
      ],
      ...overrides,
    });

  const addMenu = (event, overrides) => boss(() => eventMenus.saveEventMenu(hotelId, event.id, null, weddingMenu(event, overrides), COST));
  const reload = (event) => events.getEvent(hotelId, event.id);
  const confirm = async (event) => {
    let current = await reload(event);
    // Opsiyon en geç ilk oturum günü.
    const firstDay = current.sessions[0].startLocal.slice(0, 10);
    current = await boss(() => events.setTentative(hotelId, current.id, contracts.tentativeEventSchema.parse({ expectedUpdatedAt: current.updatedAt, optionUntil: firstDay < D(7) ? firstDay : D(7) })));
    return boss(() => events.confirmEvent(hotelId, current.id, { expectedUpdatedAt: new Date(current.updatedAt) }));
  };
  const kitchenAlerts = (dedupePrefix) => db.staffAlert.findMany({ where: { hotelId, permission: contracts.PERMISSIONS.PURCHASING_REQUEST, dedupeKey: { startsWith: dedupePrefix } } });
  const need = (view, stockItemId) => view.needs?.find((row) => row.stockItemId === stockItemId) ?? view.items?.find((row) => row.stockItemId === stockItemId);

  /* ══════════════════ Reçete ve malzeme ══════════════════ */

  it('malzeme kartı: harf duyarsız tekil ad (joker karakter yanıltmaz), birim ailesi koruması', async () => {
    await rejectsWith(newStock({ name: 'KUZU İNCİK', group: 'MEAT', unit: 'KG', unitCost: '1' }), 'VALIDATION', /zaten var/);
    await rejectsWith(newStock({ name: 'Başka', code: 'et-001', group: 'MEAT', unit: 'KG', unitCost: '1' }), 'DUPLICATE');
    // "%" adlı kart ILIKE'ta her adla eşleşirdi; lower() eşitliğinde yalnız kendisiyle.
    await newStock({ name: '%_', group: 'OTHER', unit: 'PIECE', unitCost: '0' });
    await newStock({ name: 'Taze kekik', group: 'PRODUCE', unit: 'G', unitCost: '0.35' });

    const update = (current, changes) =>
      boss(() => stock.updateStockItem(hotelId, current.id, contracts.updateStockItemSchema.parse({ expectedUpdatedAt: current.updatedAt, ...current, ...changes })));
    // Kuzu reçetede kg ile: L olamaz, g olabilir (satırlar kendi biriminde kalır).
    await rejectsWith(update(item.kuzu, { unit: 'L' }), 'UNIT_IN_USE');
    const grams = await update(item.kuzu, { unit: 'G', unitCost: '0.62' });
    assert.equal(grams.unit, 'G');
    assert.ok(grams.costUpdatedAt > item.kuzu.costUpdatedAt);
    await rejectsWith(update(item.kuzu, { name: 'Kuzu' }), 'STALE_WRITE');
    // Gram maliyetiyle reçete maliyeti aynı (3,888… kg = 3888,8… g × 0,62).
    const incik = await recipes.getRecipe(hotelId, recipe.incik.id);
    assert.equal(incik.lines[0].cost, recipe.incik.lines[0].cost);
  });

  it('reçete: fire, ara reçete, maliyet, alerjen; önizleme kaydedilenle aynı', async () => {
    const incik = await recipes.getRecipe(hotelId, recipe.incik.id);
    // Kuzu 3,5 kg %10 fire → 3,8889 kg × 620 = 2411,11; demi 1 L × (kemik 180 + şarap 195 + tereyağı 41) / 5 L = 83,20;
    // tereyağı 0,15 × 410 = 61,50.
    assert.deepEqual(
      incik.lines.map((line) => [line.source.name, line.gross, line.cost]),
      [
        ['Kuzu incik', '3.8889', '2411.11'],
        ['Demi-glace', '1', '83.20'],
        ['Tereyağı', '0.15', '61.50'],
      ],
    );
    assert.equal(incik.cost.batch, '2555.81');
    assert.equal(incik.cost.perUnit, '255.58');
    assert.deepEqual(incik.allergens, ['MILK', 'SULPHITES']);
    const demi = await recipes.getRecipe(hotelId, recipe.demi.id);
    assert.deepEqual(demi.usedIn.recipes.map((row) => row.name), ['Fırında kuzu incik']);

    const preview = await recipes.previewRecipe(
      hotelId,
      contracts.recipePreviewSchema.parse({ recipeId: incik.id, kind: 'DISH', yieldQuantity: '10', yieldUnit: 'PORTION', lines: incik.lines.map((line) => ({ stockItemId: line.stockItemId, subRecipeId: line.subRecipeId, quantity: line.quantity, unit: line.unit, wastePct: line.wastePct })) }),
    );
    assert.equal(preview.batch, incik.cost.batch);
    assert.deepEqual(preview.lines.map((line) => line.cost), ['2411.11', '83.20', '61.50']);

    // Birim uyumu: demi L verir, kg ile kullanılamaz.
    await rejectsWith(editRecipe(incik, { lines: [S(item.kuzu.id, '3.5', 'KG'), R(recipe.demi.id, '1', 'KG')] }), 'VALIDATION');
    // Ara ürün menü ürününe bağlanmaz; yemek ara ürüne çevrilemez (banket menüsünde).
    await rejectsWith(editRecipe(incik, { kind: 'PREP', yieldUnit: 'KG' }), 'RECIPE_IN_USE');
    // Kullanılan ara ürünün verim ailesi değişemez.
    await rejectsWith(editRecipe(demi, { yieldUnit: 'KG' }), 'RECIPE_IN_USE');
  });

  it('reçete: döngü, derinlik ve eşzamanlı döngü denemesi', async () => {
    const demi = await recipes.getRecipe(hotelId, recipe.demi.id);
    await rejectsWith(editRecipe(demi, { lines: [...demi.lines.map((line) => S(line.stockItemId, line.quantity, line.unit)), R(recipe.incik.id, '1', 'PORTION')] }), 'VALIDATION', /Döngü/);

    // Derinlik: incik → demi → fond → kemik suyu; dördüncü seviyenin altına beşinci eklenemez.
    const p3 = await newRecipe({ name: 'Kemik suyu', kind: 'PREP', yieldQuantity: '10', yieldUnit: 'L', lines: [S(item.kemik.id, '5', 'KG')] });
    const p2 = await newRecipe({ name: 'Esmer fond', kind: 'PREP', yieldQuantity: '10', yieldUnit: 'L', lines: [R(p3.id, '8', 'L')] });
    const demiWithFond = await editRecipe(demi, { lines: [R(p2.id, '6', 'L'), S(item.sarap.id, '750', 'ML')] });
    assert.equal(demiWithFond.lines.length, 2);
    const p4 = await newRecipe({ name: 'Kemik', kind: 'PREP', yieldQuantity: '1', yieldUnit: 'KG', lines: [S(item.kemik.id, '1', 'KG')] });
    await rejectsWith(editRecipe(await recipes.getRecipe(hotelId, p3.id), { lines: [R(p4.id, '1', 'KG')] }), 'VALIDATION', /en fazla 4 seviye/);

    // Aynı anda A'ya B, B'ye A: grafik kilidi sayesinde biri döngü hatası alır.
    const a = await newRecipe({ name: 'Sos A', kind: 'PREP', yieldQuantity: '1', yieldUnit: 'L', lines: [S(item.sarap.id, '1', 'L')] });
    const b = await newRecipe({ name: 'Sos B', kind: 'PREP', yieldQuantity: '1', yieldUnit: 'L', lines: [S(item.sarap.id, '1', 'L')] });
    const results = await Promise.allSettled([
      editRecipe(a, { lines: [S(item.sarap.id, '1', 'L'), R(b.id, '0.1', 'L')] }),
      editRecipe(b, { lines: [S(item.sarap.id, '1', 'L'), R(a.id, '0.1', 'L')] }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
    assert.match(results.find((result) => result.status === 'rejected').reason.message, /Döngü/);
  });

  it('reçete: pasif malzeme yeni satıra seçilmez, var olan satırda kalır; menü ürünü tek reçeteye', async () => {
    const off = await boss(() => stock.updateStockItem(hotelId, item.un.id, contracts.updateStockItemSchema.parse({ ...item.un, expectedUpdatedAt: item.un.updatedAt, isActive: false })));
    assert.equal(off.isActive, false);
    const manti = await recipes.getRecipe(hotelId, recipe.manti.id);
    const kept = await editRecipe(manti, { leadMinutes: 200 });
    assert.equal(kept.lines[0].source.isActive, false);
    await rejectsWith(newRecipe({ name: 'Erişte', kind: 'DISH', yieldQuantity: '10', yieldUnit: 'PORTION', lines: [S(item.un.id, '1', 'KG')] }), 'VALIDATION', /pasif/);

    const category = await db.menuCategory.create({ data: { hotelId, name: 'Ana yemekler', createdBy: MANAGER } });
    const product = await db.menuItem.create({ data: { hotelId, categoryId: category.id, name: 'Kuzu incik (restoran)', price: '880', taxCategory: 'FNB', createdBy: MANAGER } });
    const linked = await editRecipe(await recipes.getRecipe(hotelId, recipe.incik.id), { menuItemId: product.id });
    // 880 KDV %10 dahil → net 800; porsiyon 255,58 → %31,9; kâr 544,42.
    assert.equal(linked.menuItem.netPrice, '800.00');
    assert.equal(linked.menuItem.foodCostPct, '31.9');
    assert.equal(linked.menuItem.margin, '544.42');
    await rejectsWith(editRecipe(await recipes.getRecipe(hotelId, recipe.levrek.id), { menuItemId: product.id }), 'VALIDATION', /bağlı/);
    const list = await recipes.listRecipes(hotelId, { page: 1, pageSize: 50, linked: true });
    assert.deepEqual(list.items.map((row) => row.name), ['Fırında kuzu incik']);
  });

  /* ══════════════════ Set menü ══════════════════ */

  it('set menü: kişi başı maliyet (seçmelide en pahalı seçenek), ara ürün menüye girmez, sürüm', async () => {
    // Çorba (186 + 102,5) / 50 = 5,77; ana yemek en pahalı seçenek: incik 255,58 (levrek 162, mantı 3,68);
    // büfe 0,3 × 14,40 = 4,32 → 265,67.
    assert.equal(catalog.cost.perGuest, '265.67');
    // 1450 KDV %10 dahil → 1318,18; 265,67 / 1318,18 = %20,2.
    assert.equal(catalog.netPricePerPerson, '1318.18');
    assert.equal(catalog.cost.foodCostPct, '20.2');
    assert.deepEqual(catalog.allergens, ['GLUTEN', 'EGGS', 'FISH', 'MILK', 'SULPHITES']);

    const input = (changes) => contracts.updateBanquetMenuSchema.parse({ expectedUpdatedAt: catalog.updatedAt, ...catalog, courses: catalog.courses.map((course) => ({ ...course, dishes: course.dishes.map((dish) => ({ recipeId: dish.recipeId, portionsPerGuest: dish.portionsPerGuest })) })), ...changes });
    await rejectsWith(boss(() => menus.updateMenu(hotelId, catalog.id, input({ courses: [{ name: 'Sos', mode: 'ALL', dishes: [{ recipeId: recipe.demi.id }] }] }), COST)), 'VALIDATION', /ara ürün/);
    const cheaper = await boss(() => menus.updateMenu(hotelId, catalog.id, input({ pricePerPerson: '1300' }), COST));
    assert.equal(cheaper.pricePerPerson, '1300.00');
    await rejectsWith(boss(() => menus.updateMenu(hotelId, catalog.id, input({ pricePerPerson: '1200' }), COST)), 'STALE_WRITE');
    await rejectsWith(boss(() => menus.createMenu(hotelId, contracts.createBanquetMenuSchema.parse({ name: 'düğün MENÜSÜ a', pricePerPerson: '1', courses: [{ name: 'X1', mode: 'ALL', dishes: [{ recipeId: recipe.corba.id }] }] }), COST)), 'VALIDATION', /zaten var/);
  });

  /* ══════════════════ Etkinlik menüsü ══════════════════ */

  it('etkinlik menüsü: fiyat kalemi, porsiyon planı, malzeme ve maliyet (elle hesaplanmış)', async () => {
    const event = await newWedding();
    const view = await addMenu(event);
    const [menu] = view.menus;
    // 350 garanti, %5 pay: hazırlık 368; seçmeli 253 incik (kalan) / 85 levrek / 12 mantı.
    assert.equal(menu.guests, 350);
    assert.equal(menu.productionGuests, 368);
    assert.deepEqual(
      menu.courses.flatMap((course) => course.dishes.map((dish) => [dish.recipe.name, dish.servedGuests, dish.portions])),
      [
        ['Mercimek çorbası', 350, 368],
        ['Fırında kuzu incik', 253, 266],
        ['Izgara levrek', 85, 90],
        ['Sebzeli mantı', 12, 13],
        ['Mevsim salatası', 350, 111],
      ],
    );
    assert.deepEqual(menu.issues, []);
    assert.deepEqual(menu.allergens, ['GLUTEN', 'EGGS', 'FISH', 'MILK', 'SULPHITES']);

    // Malzeme: kuzu 3,8889 × 26,6 = 103,445 kg; tereyağı 1,84 + 3,99 + 0,532 = 6,362; yumurta 3,9 → 4. Dosya henüz kesin
    // değil: hepsi "olası", eksik ve talep yok.
    assert.equal(view.planned, false);
    const expected = { kuzu: '103.445', kemik: '21.28', sarap: '3.99', tereyag: '6.362', levrek: '27', un: '1.3', yumurta: '4', mercimek: '22.08', yesillik: '17.76' };
    for (const [key, quantity] of Object.entries(expected)) {
      assert.equal(need(view, item[key].id).needed, quantity, key);
      assert.equal(need(view, item[key].id).definite, '0', key);
      assert.equal(need(view, item[key].id).shortfall, '0', key);
    }
    assert.equal(need(view, item.kuzu.id).needDay, D(30));
    // Maliyet (üretim miktarıyla): 86.334,11; gelir 350 × 1450 = 507.500 brüt → 461.363,64 net → %18,7.
    assert.equal(menu.cost.total, '86334.11');
    assert.equal(menu.cost.foodCostPct, '18.7');
    assert.equal(view.totals.netRevenue, '461363.64');

    // Menü dosyanın kişi başı kalemini üretti.
    const file = await reload(event);
    const menuItem = file.items.find((row) => row.eventMenuId === menu.id);
    assert.equal(menuItem.perPerson, true);
    assert.equal(menuItem.billedQuantity, '350');
    assert.equal(menuItem.total, '507500.00');
    assert.equal(file.grandTotal, '507500.00');

    // Kalem tablosu menü kalemini korur (yalnız serbest kalemler yazılır).
    const withRent = await boss(() =>
      events.saveItems(
        hotelId,
        event.id,
        contracts.saveEventItemsSchema.parse({ expectedUpdatedAt: file.updatedAt, items: [{ category: 'VENUE', description: 'Salon kirası', quantity: '1', unit: 'DAY', unitPrice: '60000', taxCategory: 'OTHER' }] }),
      ),
    );
    assert.equal(withRent.items.length, 2);
    assert.equal(withRent.items[0].eventMenuId, menu.id);
    assert.equal(withRent.grandTotal, '567500.00');

    // Sabit kişili öğün: kalem kişi başı değil, o kadar kişi.
    const fixed = await boss(() => eventMenus.saveEventMenu(hotelId, event.id, menu.id, weddingMenu(withRent, { guests: 120, courses: [{ name: 'Çorba', mode: 'ALL', dishes: [{ recipeId: recipe.corba.id }] }] }), COST));
    assert.equal(fixed.menus[0].guests, 120);
    const fixedItem = (await reload(event)).items.find((row) => row.eventMenuId === menu.id);
    assert.equal(fixedItem.perPerson, false);
    assert.equal(fixedItem.billedQuantity, '120');
  });

  it('etkinlik menüsü: servis saati, oturum, otel kapsamı, sürüm', async () => {
    const event = await newWedding();
    await rejectsWith(addMenu(event, { serveAt: wall(30, '18:59') }), 'VALIDATION', /oturumun içinde/);
    const other = await newWedding({ name: 'Başka düğün' });
    await rejectsWith(addMenu(event, { sessionId: other.sessions[0].id }), 'VALIDATION', /bu etkinliğin değil/);
    const foreign = await db.recipe.create({ data: { hotelId: otherHotelId, name: 'Başka otelin yemeği', kind: 'DISH', yieldQuantity: '1', yieldUnit: 'PORTION', createdBy: 'x' } });
    await rejectsWith(addMenu(event, { courses: [{ name: 'Ana', mode: 'ALL', dishes: [{ recipeId: foreign.id }] }] }), 'VALIDATION', /düzeltilmesi gereken yemekler/);
    await addMenu(event);
    await rejectsWith(addMenu(event), 'STALE_WRITE');
  });

  it('kesinleştirme: yalnız kesin etkinlikte, kesin menü kilitli, gerekçeyle yeniden açılır; mutfağa haber', async () => {
    let event = await newWedding();
    let view = await addMenu(event);
    const menuId = view.menus[0].id;
    const finalize = async () => {
      const current = await reload(event);
      return boss(() => eventMenus.finalizeEventMenu(hotelId, event.id, menuId, { expectedUpdatedAt: new Date(current.updatedAt) }, COST));
    };
    await rejectsWith(finalize(), 'EVENT_STATUS');
    event = await confirm(event);
    view = await finalize();
    assert.ok(view.menus[0].finalizedAt);
    assert.equal(view.menus[0].finalizedBy, MANAGER);
    assert.equal((await kitchenAlerts('banquet-menu-final:')).length, 1);

    const current = await reload(event);
    await rejectsWith(boss(() => eventMenus.saveEventMenu(hotelId, event.id, menuId, weddingMenu(current), COST)), 'MENU_FINALIZED');
    await rejectsWith(boss(() => eventMenus.deleteEventMenu(hotelId, event.id, menuId, { expectedUpdatedAt: new Date(current.updatedAt) }, COST)), 'MENU_FINALIZED');
    await rejectsWith(boss(() => events.deleteSession(hotelId, event.id, event.sessions[0].id, { expectedUpdatedAt: new Date(current.updatedAt) })), 'SESSION_IN_USE');

    // Oturum bir saat ileri: kesin menünün servisi de kayar, mutfağa haber.
    const moved = await boss(() =>
      events.saveSession(
        hotelId,
        event.id,
        event.sessions[0].id,
        contracts.updateSessionSchema.parse({ expectedUpdatedAt: current.updatedAt, title: 'Düğün yemeği', venueId: ballroom.id, layout: 'BANQUET', pax: 350, startAt: wall(30, '20:00'), endAt: wall(31, '00:30') }),
      ),
    );
    view = await fnb.getEventFnb(hotelId, event.id, COST);
    assert.equal(view.menus[0].serveLocal, wall(30, '21:00'));
    assert.equal((await kitchenAlerts('banquet-menu-time:')).length, 1);

    // Garanti değişti: kişiyi izleyen kesin menü var → mutfağa haber, porsiyonlar yeni kişiyle.
    const raised = await boss(() =>
      events.updateEvent(hotelId, event.id, contracts.updateEventSchema.parse({ expectedUpdatedAt: moved.updatedAt, name: event.name, type: 'WEDDING', clientId: client.id, expectedPax: 380, guaranteedPax: 380 })),
    );
    assert.equal((await kitchenAlerts('banquet-menu-pax:')).length, 1);
    assert.equal((await fnb.getEventFnb(hotelId, event.id, COST)).menus[0].guests, 380);

    view = await boss(() => eventMenus.reopenEventMenu(hotelId, event.id, menuId, { expectedUpdatedAt: new Date(raised.updatedAt), reason: 'Müşteri balığı değiştirdi' }, COST));
    assert.equal(view.menus[0].finalizedAt, null);
    const reopened = await kitchenAlerts('banquet-menu-reopen:');
    assert.equal(reopened.length, 1);
    assert.match(reopened[0].body, /balığı değiştirdi/);
    const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'EventMenu', entityId: menuId, action: 'UPDATE' }, orderBy: { createdAt: 'desc' } });
    assert.equal(audit.after.reason, 'Müşteri balığı değiştirdi');

    // Seçmeli sabitler kişiyi aşarsa kesinleşmez.
    const latest = await reload(event);
    await boss(() =>
      eventMenus.saveEventMenu(
        hotelId,
        event.id,
        menuId,
        weddingMenu(latest, {
          serveAt: wall(30, '21:00'),
          guests: 50,
          courses: [{ name: 'Ana', mode: 'CHOICE', dishes: [{ recipeId: recipe.incik.id }, { recipeId: recipe.levrek.id, guestCount: 60 }] }],
        }),
        COST,
      ),
    );
    await rejectsWith(finalize(), 'VALIDATION', /aşıyor/);

    // Kesin olmayan menü kaldırılır, kalemi gider.
    const before = await reload(event);
    view = await boss(() => eventMenus.deleteEventMenu(hotelId, event.id, menuId, { expectedUpdatedAt: new Date(before.updatedAt) }, COST));
    assert.equal(view.menus.length, 0);
    assert.equal((await reload(event)).items.length, 0);
  });

  it('teklif belgesinde menünün içeriği ve alerjenleri', async () => {
    const event = await newWedding();
    await addMenu(event);
    const current = await reload(event);
    const document = await boss(() => documents.issueDocument(hotelId, event.id, { expectedUpdatedAt: new Date(current.updatedAt), kind: 'OFFER', note: null }));
    const row = await db.eventDocument.findFirst({ where: { id: document.id } });
    const [menu] = row.snapshot.menus;
    assert.equal(menu.guests, 350);
    assert.equal(menu.courses[1].mode, 'CHOICE');
    assert.deepEqual(menu.courses[1].dishes.map((dish) => [dish.name, dish.guestCount]), [
      ['Fırında kuzu incik', null],
      ['Izgara levrek', 85],
      ['Sebzeli mantı', 12],
    ]);
    assert.deepEqual(menu.courses[1].dishes[1].allergens, ['FISH']);
    assert.ok(row.fileSize > 1000);
  });

  /* ══════════════════ İhtiyaç ve satın alma ══════════════════ */

  /** İki kesin düğün (30. ve 31. gün) ve bir opsiyonlu (30. gün); B yalnız incik. */
  async function plannedWeek() {
    const a = await newWedding({ name: 'A düğünü' });
    await addMenu(a);
    const b = await newWedding({ day: 31, pax: 200, name: 'B düğünü' });
    await addMenu(b, { courses: [{ name: 'Ana', mode: 'ALL', dishes: [{ recipeId: recipe.incik.id }] }] });
    const c = await newWedding({ pax: 100, name: 'C nişanı' });
    await addMenu(c, { courses: [{ name: 'Ana', mode: 'ALL', dishes: [{ recipeId: recipe.incik.id }] }] });
    // Önce A ve B kesinleşir (C önce opsiyona girseydi aynı salonda 1. opsiyon o olurdu).
    const confirmedA = await confirm(a);
    const confirmedB = await confirm(b);
    const tentativeC = await reload(c);
    await boss(() => events.setTentative(hotelId, c.id, contracts.tentativeEventSchema.parse({ expectedUpdatedAt: tentativeC.updatedAt, optionUntil: D(7) })));
    return { a: confirmedA, b: confirmedB, c };
  }

  it('aralık ihtiyacı: kesin / olası ayrı, etkinlik dökümü; maliyet yalnız izinliye', async () => {
    const { a, b, c } = await plannedWeek();
    const needs = await fnb.getNeeds(hotelId, { from: D(30), to: D(31), includeTentative: true, stockItemId: item.kuzu.id }, COST);
    assert.equal(needs.events, 3);
    // A 103,445 + B 3,8889 × 21 = 81,667 → 185,112 kesin; C 3,8889 × 10,5 = 40,834 olası.
    const kuzu = need(needs, item.kuzu.id);
    assert.equal(kuzu.definite, '185.112');
    assert.equal(kuzu.tentative, '40.834');
    assert.equal(kuzu.shortfall, '185.112');
    assert.equal(kuzu.cost, '114769.44');
    // Döküm ihtiyaç gününe, sonra dosya numarasına göre: A (30), C (30), B (31).
    assert.deepEqual(
      needs.breakdown.map((row) => [row.eventId, row.needed, row.shortfall]),
      [
        [a.id, '103.445', '103.445'],
        [c.id, '40.834', '0'],
        [b.id, '81.667', '81.667'],
      ],
    );
    const definiteOnly = await fnb.getNeeds(hotelId, { from: D(30), to: D(31), includeTentative: false }, { withCost: false });
    assert.equal(need(definiteOnly, item.kuzu.id).tentative, '0');
    assert.equal(need(definiteOnly, item.kuzu.id).cost, undefined);
    assert.equal(definiteOnly.totals, undefined);
    assert.ok(b);
  });

  it('satın alma talebi: dağıtım, numara, eksik değişti, eşzamanlı aynı eksik, iptal', async () => {
    const { a, b } = await plannedWeek();
    const request = (input) => as(KITCHEN, () => purchasing.createFromBanquet(hotelId, contracts.createBanquetPurchaseRequestSchema.parse(input)));
    // Kuzu eksiği 185,112; 190 talep → fazlası en erken ihtiyaca (A).
    const created = await request({ from: D(30), to: D(31), lines: [{ stockItemId: item.kuzu.id, quantity: '190', expectedShortfall: '185.112' }], note: 'Hafta sonu düğünleri' });
    assert.match(created.number, new RegExp(`^STR-${D(0).slice(0, 4)}-0001$`));
    assert.equal(created.status, 'OPEN');
    assert.equal(created.neededBy, D(30));
    assert.equal(created.requestedBy, KITCHEN);
    const [kuzu] = created.items;
    assert.equal(kuzu.quantity, '190');
    assert.deepEqual(
      kuzu.events.map((row) => [row.eventId, row.quantity]),
      [
        [a.id, '108.333'],
        [b.id, '81.667'],
      ],
    );
    assert.equal(kuzu.cost, '117800.00');
    let needs = await fnb.getNeeds(hotelId, { from: D(30), to: D(31), includeTentative: false }, COST);
    assert.equal(need(needs, item.kuzu.id).shortfall, '0');
    assert.equal(need(needs, item.kuzu.id).requested, '190');

    // Ekranın gördüğü eksik eskidiyse talep açılmaz.
    await rejectsWith(request({ eventId: a.id, lines: [{ stockItemId: item.kuzu.id, quantity: '10', expectedShortfall: '103.445' }] }), 'NEEDS_CHANGED');
    // Menüde olmayan malzeme.
    await rejectsWith(request({ eventId: b.id, lines: [{ stockItemId: item.levrek.id, quantity: '1', expectedShortfall: '0' }] }), 'VALIDATION');

    // Aynı eksiği iki kişi aynı anda: etkinlik kilidi sayesinde biri NEEDS_CHANGED.
    const levrek = need(needs, item.levrek.id).shortfall;
    assert.equal(levrek, '27');
    const race = await Promise.allSettled([
      request({ eventId: a.id, lines: [{ stockItemId: item.levrek.id, quantity: '27', expectedShortfall: '27' }] }),
      as(MANAGER, () => purchasing.createFromBanquet(hotelId, contracts.createBanquetPurchaseRequestSchema.parse({ eventId: a.id, lines: [{ stockItemId: item.levrek.id, quantity: '27', expectedShortfall: '27' }] }))),
    ]);
    assert.deepEqual(race.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
    assert.equal(race.find((result) => result.status === 'rejected').reason.code, 'NEEDS_CHANGED');
    assert.equal(await db.purchaseRequestLine.count({ where: { hotelId, stockItemId: item.levrek.id } }), 1);

    // İptal: eksik geri gelir; iptal edilmiş iptal edilmez.
    const cancelled = await as(KITCHEN, () => purchasing.cancelRequest(hotelId, created.id, { expectedUpdatedAt: new Date(created.updatedAt), reason: 'Tedarikçi değişti' }));
    assert.equal(cancelled.status, 'CANCELLED');
    await rejectsWith(as(KITCHEN, () => purchasing.cancelRequest(hotelId, created.id, { expectedUpdatedAt: new Date(cancelled.updatedAt), reason: 'Tekrar iptal' })), 'REQUEST_STATUS');
    needs = await fnb.getNeeds(hotelId, { from: D(30), to: D(31), includeTentative: false }, COST);
    assert.equal(need(needs, item.kuzu.id).shortfall, '185.112');

    // Liste: arama (numara / malzeme adı), etkinlik süzgeci, toplamlar.
    const list = await purchasing.listRequests(hotelId, { page: 1, pageSize: 20, search: 'levrek' });
    assert.equal(list.meta.total, 1);
    assert.equal(list.items[0].estimatedTotal, '14580.00');
    assert.equal((await purchasing.listRequests(hotelId, { page: 1, pageSize: 20, eventId: b.id })).meta.total, 1);

    // Kesin etkinlik iptal edilince açık talebi olan mutfağa haber.
    const fileA = await reload(a);
    await boss(() => events.cancelEvent(hotelId, a.id, { expectedUpdatedAt: new Date(fileA.updatedAt), reason: 'Düğün ertelendi' }));
    const alert = await kitchenAlerts('banquet-menu-cancelled:');
    assert.equal(alert.length, 1);
    assert.match(alert[0].body, /STR-/);
    // Opsiyonlu etkinlikten talep açılmaz.
    const tentative = await db.event.findFirst({ where: { hotelId, status: 'TENTATIVE' } });
    await rejectsWith(request({ eventId: tentative.id, lines: [{ stockItemId: item.kuzu.id, quantity: '1', expectedShortfall: '0' }] }), 'NO_NEEDS');
  });

  /* ══════════════════ Üretim planı ══════════════════ */

  it('üretim planı: servisten geriye sayılan saatler, ara ürün, istasyon, opsiyonlu süzgeci', async () => {
    await plannedWeek();
    const plan = await fnb.getProductionPlan(hotelId, { from: D(30), to: D(30), includeTentative: false });
    const day = plan.days.find((entry) => entry.day === D(30));
    const tasks = day.hours.flatMap((hour) => hour.tasks).filter((task) => task.event.name === 'A düğünü');
    assert.deepEqual(
      tasks.map((task) => [task.startLocal.slice(11), task.kind, task.name, task.quantity, task.unit]),
      [
        ['11:00', 'PREP', 'Demi-glace', '26.6', 'L'],
        ['16:00', 'DISH', 'Sebzeli mantı', '13', 'PORTION'],
        ['17:00', 'DISH', 'Fırında kuzu incik', '266', 'PORTION'],
        ['18:00', 'DISH', 'Mercimek çorbası', '368', 'PORTION'],
        ['18:30', 'DISH', 'Mevsim salatası', '111', 'PORTION'],
        ['19:30', 'DISH', 'Izgara levrek', '90', 'PORTION'],
      ],
    );
    assert.equal(tasks[0].readyLocal, wall(30, '17:00'));
    assert.deepEqual(tasks[0].usedBy, ['Fırında kuzu incik']);
    assert.equal(plan.unfinalized, 1);
    // B düğününün (31. gün) demi-glace'ı 31. gün 11:00'de; 30. günün planında yok, opsiyonlu C yok.
    assert.equal(day.hours.flatMap((hour) => hour.tasks).some((task) => task.event.name !== 'A düğünü'), false);
    const cold = await fnb.getProductionPlan(hotelId, { from: D(30), to: D(31), includeTentative: true, station: 'COLD' });
    assert.deepEqual(
      cold.days.flatMap((entry) => entry.hours.flatMap((hour) => hour.tasks)).map((task) => [task.name, task.event.name]),
      [['Mevsim salatası', 'A düğünü']],
    );
    const withTentative = await fnb.getProductionPlan(hotelId, { from: D(30), to: D(30), includeTentative: true });
    assert.equal(withTentative.counts.events, 2);
    const tooLong = await call('GET', `/banquet/fnb/production?from=${D(30)}&to=${D(37)}`, MANAGER);
    assert.equal(tooLong.statusCode, 400);
  });

  /* ══════════════════ İş, izinler, kapsam ══════════════════ */

  it('hatırlatma: kesinleşmemiş menü politikadaki gün kala sorumluya bir kez', async () => {
    let event = await newWedding({ day: 3 });
    await addMenu(event);
    event = await confirm(event);
    const first = await core.runWithContext({ correlationId: randomUUID(), actor: 'system' }, () => jobs.sweepHotel(hotelId, { warn: () => {} }));
    assert.equal(first.menuFinalize, 1);
    const second = await core.runWithContext({ correlationId: randomUUID(), actor: 'system' }, () => jobs.sweepHotel(hotelId, { warn: () => {} }));
    assert.equal(second.menuFinalize, 0);
    const far = await newWedding({ day: 30, name: 'Uzak düğün' });
    await addMenu(far);
    await confirm(far);
    const third = await core.runWithContext({ correlationId: randomUUID(), actor: 'system' }, () => jobs.sweepHotel(hotelId, { warn: () => {} }));
    assert.equal(third.menuFinalize, 0);
  });

  it('izinler: maliyet yalnız reçete görme izniyle, yazmalar rol matrisine göre; otel kapsamı', async () => {
    const event = await newWedding();
    await addMenu(event);
    const deskView = await call('GET', `/banquet/events/${event.id}/fnb`, DESK);
    assert.equal(deskView.statusCode, 200);
    assert.equal(deskView.json().data.menus[0].cost, undefined);
    assert.equal(deskView.json().data.totals, undefined);
    assert.equal(deskView.json().data.needs[0].cost, undefined);
    const bossView = await call('GET', `/banquet/events/${event.id}/fnb`, MANAGER);
    assert.equal(bossView.json().data.menus[0].cost.total, '86334.11');

    assert.equal((await call('GET', '/recipes?page=1&pageSize=10', KITCHEN)).statusCode, 200);
    assert.equal((await call('GET', '/recipes?page=1&pageSize=10', ACCOUNTING)).statusCode, 200);
    assert.equal((await call('GET', '/recipes?page=1&pageSize=10', HOUSEKEEPING)).statusCode, 403);
    assert.equal((await call('GET', '/recipes/picker', DESK)).statusCode, 403);
    const picker = await call('GET', '/recipes/picker?kind=DISH&search=kuzu', KITCHEN);
    assert.equal(picker.json().data[0].costPerUnit, '255.58');
    assert.equal((await call('POST', '/recipes/stock-items', KITCHEN, { name: 'Tuz', group: 'PANTRY', unit: 'KG', unitCost: '8' })).statusCode, 403);
    assert.equal((await call('POST', '/purchasing/requests/banquet', DESK, { eventId: event.id, lines: [{ stockItemId: item.kuzu.id, quantity: '1', expectedShortfall: '0' }] })).statusCode, 403);
    assert.equal((await call('GET', '/purchasing/requests?page=1&pageSize=10', ACCOUNTING)).statusCode, 200);
    assert.equal((await call('GET', '/purchasing/requests?page=1&pageSize=10', DESK)).statusCode, 403);
    // Gövde geçerli (doğrulama izinden önce koşar): reddeden izin denetimi.
    const current = await reload(event);
    assert.equal((await call('POST', `/banquet/events/${event.id}/menus`, KITCHEN, JSON.parse(JSON.stringify(weddingMenu(current))))).statusCode, 403);

    // Başka otelin kaydı yok sayılır.
    const foreign = await db.recipe.create({ data: { hotelId: otherHotelId, name: 'Yabancı', kind: 'DISH', yieldQuantity: '1', yieldUnit: 'PORTION', createdBy: 'x' } });
    assert.equal((await call('GET', `/recipes/${foreign.id}`, MANAGER)).statusCode, 404);
    const foreignStock = await db.stockItem.create({ data: { hotelId: otherHotelId, name: 'Yabancı malzeme', group: 'OTHER', unit: 'KG', createdBy: 'x' } });
    await rejectsWith(newRecipe({ name: 'Karışık', kind: 'DISH', yieldQuantity: '1', yieldUnit: 'PORTION', lines: [S(foreignStock.id, '1', 'KG')] }), 'VALIDATION');
    const http = await call('GET', `/banquet/fnb/needs?from=${D(30)}&to=${D(30)}`, MANAGER);
    assert.equal(http.statusCode, 200);
    assert.equal(http.json().data.events, 0, 'kesinleşmemiş etkinlik ihtiyaçta yok');
  });
});
