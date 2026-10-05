import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Bütçe (modül 27) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: ilk bütçe (önerilen gider kalemleri), satır kaydı (sürüm, tanınmayan
 * kalem), onay (kilit, boş bütçe), revize (gerekçe, kopya, eski sürüm, tek
 * onaylı), gider kalemleri (tekil ad, arşivde taslaktan düşme), gerçekleşen
 * gider (hücre sürümü, gelecek ay), sapma raporu (folyodan sınıflanan gelir,
 * indirim, vergi hariç, tahsilat, doluluk / ADR hedefleri, oda geliri
 * ayrıştırması, eksik gider, ay içi orantı, otel sınırı), AI yorumu (kapalıyken
 * istenmez; sahte modelle uçtan uca; tek bekleyen istek), MCP aracı, izinler.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MODEL = 'ana-model';
const PRICES = { [MODEL]: { input: '2.5000', cachedInput: '1.2500', output: '10.0000' } };

/** Sahte model: yorum metni sabit, istekler kaydedilir; `gate` verilirse açılana kadar bekler. */
const fakeModel = {
  calls: [],
  /** @type {Promise<void> | null} */
  gate: null,
  async chat(request) {
    this.calls.push(request);
    if (this.gate) await this.gate;
    return { text: '**Eylül** oda geliri planın altında kaldı; doluluk etkisi belirleyici.', toolCalls: [], usage: { inputTokens: 900, cachedInputTokens: 0, outputTokens: 80 } };
  },
};

describe('bütçe (modül 27, entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let budget;
  /** @type {any} */ let variance;
  /** @type {any} */ let rules;
  /** @type {any} */ let actors;
  /** @type {any} */ let mcp;
  /** @type {any} */ let mcpServer;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let otherHotelId;
  let roomTypeId;
  let B;
  let Y;
  let PM;
  /** @type {Map<string, string>} */ let tokens;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    delete process.env.OPENAI_API_KEY;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    budget = await import('./service.js');
    variance = await import('./variance.js');
    rules = await import('./rules.js');
    actors = await import('../../lib/actors.js');
    mcp = await import('../reports/mcp.js');
    mcpServer = await import('@hotelos/mcp-server');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await actors.actorRegistry?.idle();
    await app?.close();
    await db?.$disconnect();
  });

  const as = (actor, fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
  const manager = (fn) => as('mudur@test.local', fn);
  const dayDate = (iso) => new Date(`${iso}T00:00:00.000Z`);
  /** Geçen ayın gün sayısı ve günü. */
  const pmDay = (day) => `${Y}-${String(PM).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  beforeEach(async () => {
    await resetDatabase(db);
    (await import('../../lib/cache.js')).cache.clear();
    variance.clearBudgetCache();
    (await import('../reports/service.js')).clearReportCache();
    tokens = new Map();
    fakeModel.calls = [];
    B = core.toIsoDay(core.calendarDateInTimeZone(ZONE));
    const month = Number(B.slice(5, 7));
    PM = month === 1 ? 12 : month - 1;
    Y = month === 1 ? Number(B.slice(0, 4)) - 1 : Number(B.slice(0, 4));

    hotelId = (await db.hotel.create({ data: { name: 'Bütçe Otel', code: `B${randomUUID().slice(0, 6)}`, timezone: ZONE, currency: 'TRY' } })).id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka', code: `C${randomUUID().slice(0, 6)}`, timezone: ZONE, currency: 'TRY' } })).id;
    roomTypeId = (await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 2 } })).id;
    for (let number = 101; number <= 110; number += 1) await db.room.create({ data: { hotelId, number: String(number), roomTypeId } });
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: 'mudur@test.local', name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: 'muhasebe@test.local', name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
        { hotelId, email: 'resepsiyon@test.local', name: 'Resepsiyon', role: 'FRONT_DESK', passwordHash },
      ],
    });
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });

  /** Çıkmış konaklama + folyo; geceler verilen günlerde. */
  async function stay({ hotel = hotelId, nights, status = 'CHECKED_OUT' }) {
    const typeId = hotel === hotelId ? roomTypeId : (await db.roomType.create({ data: { hotelId: hotel, code: `T${randomUUID().slice(0, 4)}`, name: 'T', basePrice: '1', capacityAdults: 2 } })).id;
    const guest = await db.guest.create({ data: { hotelId: hotel, firstName: 'Ayşe', lastName: 'Kaya' } });
    const reservation = await db.reservation.create({
      data: {
        hotelId: hotel,
        guestId: guest.id,
        roomTypeId: typeId,
        checkIn: dayDate(nights[0]),
        checkOut: dayDate(contracts.shiftDay(nights.at(-1), 1)),
        status,
        currency: 'TRY',
        totalPrice: '1',
        confirmationCode: `B-${randomUUID().slice(0, 8)}`,
        ...(status === 'CHECKED_OUT' ? { checkedInAt: dayDate(nights[0]), checkedInBy: 'test', checkedOutAt: dayDate(nights.at(-1)), checkedOutBy: 'test' } : {}),
      },
    });
    if (status !== 'NO_SHOW') {
      await db.reservationNight.createMany({ data: nights.map((night) => ({ hotelId: hotel, reservationId: reservation.id, date: dayDate(night), amount: '1100' })) });
    }
    const folio = await db.folio.create({ data: { hotelId: hotel, reservationId: reservation.id, guestId: guest.id, currency: 'TRY' } });
    return { reservation, folio };
  }

  function post(target, { day, type = 'ROOM', source = 'ROOM_NIGHT', net, taxCategory = 'ROOM' }) {
    return db.folioItem.create({
      data: {
        hotelId: target.reservation.hotelId,
        folioId: target.folio.id,
        reservationId: target.reservation.id,
        type,
        source,
        description: 'test',
        amount: net,
        quantity: 1,
        taxCategory,
        netAmount: net,
        taxAmount: '0',
        total: net,
        serviceDate: dayDate(day),
        postedBy: 'test',
      },
    });
  }

  /** Ödeme satırı (iade / bekleyen satır onay kaydı ister — veritabanı kuralı). */
  async function pay(target, { day, amount, kind = 'PAYMENT', status = 'POSTED', reversalOf = null }) {
    const needsApproval = kind === 'REFUND' || status === 'PENDING';
    const approval = needsApproval
      ? await db.approval.create({ data: { hotelId: target.reservation.hotelId, type: 'LARGE_PAYMENT', summary: 'test', requestedBy: 'test' } })
      : null;
    return db.payment.create({
      data: {
        hotelId: target.reservation.hotelId,
        folioId: target.folio.id,
        reservationId: target.reservation.id,
        kind,
        status,
        method: 'CASH',
        amount,
        currency: 'TRY',
        folioAmount: amount,
        businessDate: dayDate(day),
        receivedBy: 'test',
        approvalId: approval?.id ?? null,
        reversalOfId: reversalOf?.id ?? null,
        ...(status === 'POSTED' ? { postedAt: new Date() } : {}),
      },
    });
  }

  /** Geçen ayın gerçekleşenleri (bkz. dosya başı). */
  async function seedActuals() {
    const a = await stay({ nights: [pmDay(10), pmDay(11)] });
    await post(a, { day: pmDay(10), net: '1000' });
    await post(a, { day: pmDay(11), net: '1000' });
    await post(a, { day: pmDay(10), type: 'FNB', source: 'FNB_ORDER', net: '300', taxCategory: 'FNB' });
    await post(a, { day: pmDay(11), type: 'DISCOUNT', source: 'MANUAL', net: '-50', taxCategory: 'FNB' }); // restoran indirimi
    await post(a, { day: pmDay(10), type: 'MINIBAR', source: 'MINIBAR', net: '80', taxCategory: 'MINIBAR' });
    await post(a, { day: pmDay(11), type: 'LAUNDRY', source: 'LAUNDRY', net: '40', taxCategory: 'LAUNDRY' });
    await post(a, { day: pmDay(11), type: 'SPA', source: 'MANUAL', net: '100', taxCategory: 'SPA' }); // diğer
    await post(a, { day: pmDay(11), type: 'TAX', source: 'MANUAL', net: '999', taxCategory: null }); // vergi kalemi gelir değil
    await post(a, { day: pmDay(10), source: 'EARLY_CHECK_IN', net: '200' });
    const noShow = await stay({ nights: [pmDay(12)], status: 'NO_SHOW' });
    await post(noShow, { day: pmDay(12), source: 'NO_SHOW', net: '150' });
    await pay(a, { day: pmDay(11), amount: '2500' });
    await pay(a, { day: pmDay(11), amount: '-100', kind: 'REFUND' }); // onaylı iade düşer
    const voided = await pay(a, { day: pmDay(11), amount: '300' });
    await pay(a, { day: pmDay(12), amount: '-300', kind: 'REVERSAL', reversalOf: voided }); // iptal edilen ödeme net sıfır
    await pay(a, { day: pmDay(11), amount: '999', status: 'PENDING' }); // onay bekleyen sayılmaz
    // Başka otelin geliri sayılmaz.
    const other = await stay({ hotel: otherHotelId, nights: [pmDay(10)] });
    await post(other, { day: pmDay(10), type: 'FNB', source: 'FNB_ORDER', net: '7777', taxCategory: 'FNB' });
  }

  const months = (entries) => {
    const result = Array.from({ length: 12 }, () => null);
    for (const [month, value] of Object.entries(entries)) result[Number(month) - 1] = value;
    return result;
  };

  async function draftWithPlan() {
    const year = await manager(() => budget.createBudget(hotelId, { year: Y }));
    const expenses = year.items.filter((item) => !item.system);
    const personnel = expenses.find((item) => item.label === 'Personel');
    const energy = expenses.find((item) => item.label.startsWith('Enerji'));
    const saved = await manager(() =>
      budget.saveBudgetLines(hotelId, year.draft.id, {
        expectedUpdatedAt: new Date(year.draft.updatedAt),
        lines: [
          { item: 'ROOM_REVENUE', months: months({ [PM]: '2500' }) },
          { item: 'FNB_REVENUE', months: months({ [PM]: '200' }) },
          { item: 'OCCUPANCY', months: months({ [PM]: '1' }) },
          { item: 'ADR', months: months({ [PM]: '1100' }) },
          { item: personnel.item, months: months({ [PM]: '1000' }) },
          { item: energy.item, months: months({ [PM]: '500' }) },
        ],
      }),
    );
    return { saved, personnel, energy };
  }

  it('ilk bütçe: taslak + önerilen gider kalemleri; ikinci açılış ve aralık dışı yıl reddedilir', async () => {
    const year = await manager(() => budget.createBudget(hotelId, { year: Y }));
    assert.equal(year.draft.version, 1);
    assert.equal(year.draft.status, 'DRAFT');
    assert.equal(year.approved, null);
    assert.deepEqual(year.items.filter((item) => !item.system).map((item) => item.label), [...contracts.BUDGET_DEFAULT_EXPENSES]);
    await assert.rejects(manager(() => budget.createBudget(hotelId, { year: Y })), (error) => error.code === 'BUDGET_EXISTS');
    await assert.rejects(manager(() => budget.createBudget(hotelId, { year: Number(B.slice(0, 4)) + 10 })), (error) => error.code === 'VALIDATION');
    assert.equal(await db.auditLog.count({ where: { hotelId, entity: 'Budget' } }), 1);
  });

  it('satırlar: kayıt, tanınmayan kalem, eski sürüm; onay kilitler; boş bütçe onaylanmaz', async () => {
    const { saved, personnel } = await draftWithPlan();
    const room = saved.draft.lines.find((line) => line.item === 'ROOM_REVENUE');
    assert.equal(room.months[PM - 1], '2500');
    assert.equal(room.total, '2500.00');
    assert.equal(saved.draft.lines.find((line) => line.item === 'OCCUPANCY').total, null, 'yüzde kalemin yıllık toplamı yok');

    await assert.rejects(
      manager(() => budget.saveBudgetLines(hotelId, saved.draft.id, { expectedUpdatedAt: new Date(saved.draft.updatedAt), lines: [{ item: 'SPA_UNKNOWN', months: months({}) }] })),
      (error) => error.code === 'VALIDATION',
    );
    const stale = new Date(new Date(saved.draft.updatedAt).getTime() - 1000);
    await assert.rejects(manager(() => budget.saveBudgetLines(hotelId, saved.draft.id, { expectedUpdatedAt: stale, lines: [] })), (error) => error.code === 'STALE_WRITE');

    const approved = await manager(() => budget.approveBudget(hotelId, saved.draft.id, { expectedUpdatedAt: new Date(saved.draft.updatedAt) }));
    assert.equal(approved.draft, null);
    assert.equal(approved.approved.status, 'APPROVED');
    assert.equal(approved.approved.approvedBy, 'mudur@test.local');
    await assert.rejects(
      manager(() => budget.saveBudgetLines(hotelId, saved.draft.id, { expectedUpdatedAt: new Date(approved.approved.updatedAt), lines: [] })),
      (error) => error.code === 'BUDGET_LOCKED',
    );
    assert.ok(personnel);

    const nextYear = await manager(() => budget.createBudget(hotelId, { year: Y + 1 }));
    await assert.rejects(manager(() => budget.approveBudget(hotelId, nextYear.draft.id, { expectedUpdatedAt: new Date(nextYear.draft.updatedAt) })), /Boş bütçe/);
  });

  it('revize: gerekçe zorunlu, onaylı satırlar kopyalanır, onaylanınca önceki eski sürüm olur; yılın tek onaylısı', async () => {
    const { saved } = await draftWithPlan();
    await manager(() => budget.approveBudget(hotelId, saved.draft.id, { expectedUpdatedAt: new Date(saved.draft.updatedAt) }));
    await assert.rejects(manager(() => budget.reviseBudget(hotelId, Y, { reason: 'kısa' })), (error) => error.code === 'VALIDATION');
    const revised = await manager(() => budget.reviseBudget(hotelId, Y, { reason: 'Yeni kanal anlaşması geliri artırdı' }));
    assert.equal(revised.draft.version, 2);
    assert.equal(revised.approved.version, 1, 'revize onaylanana kadar eski onaylı geçerli');
    assert.deepEqual(revised.draft.lines.map((line) => line.item).sort(), revised.approved.lines.map((line) => line.item).sort());
    await assert.rejects(manager(() => budget.reviseBudget(hotelId, Y, { reason: 'İkinci revize denemesi' })), (error) => error.code === 'BUDGET_DRAFT_EXISTS');

    const done = await manager(() => budget.approveBudget(hotelId, revised.draft.id, { expectedUpdatedAt: new Date(revised.draft.updatedAt) }));
    assert.equal(done.approved.version, 2);
    assert.deepEqual(done.versions.map((row) => [row.version, row.status]), [[2, 'APPROVED'], [1, 'SUPERSEDED']]);
    assert.equal(await db.budget.count({ where: { hotelId, year: Y, status: 'APPROVED' } }), 1);
  });

  it('gider kalemi: tekil ad (harf büyüklüğü fark etmez), ad değişimi sürümlü, arşivlenen taslaktan düşer', async () => {
    const { saved, energy } = await draftWithPlan();
    await assert.rejects(manager(() => budget.addExpenseItem(hotelId, { label: 'personel' })), (error) => error.code === 'DUPLICATE');
    const list = await manager(() => budget.addExpenseItem(hotelId, { label: 'Güvenlik' }));
    const security = list.find((item) => item.label === 'Güvenlik');
    await assert.rejects(manager(() => budget.renameExpenseItem(hotelId, security.item, { label: 'Güvenlik hizmeti', expectedUpdatedAt: new Date(Date.parse(security.updatedAt) - 1000) })), (error) => error.code === 'STALE_WRITE');
    await manager(() => budget.renameExpenseItem(hotelId, security.item, { label: 'Güvenlik hizmeti', expectedUpdatedAt: new Date(security.updatedAt) }));

    await manager(() => budget.archiveExpenseItem(hotelId, energy.item));
    const year = await budget.getBudgetYear(hotelId, Y);
    assert.equal(year.draft.lines.some((line) => line.item === energy.item), false, 'arşivlenen kalemin taslak satırı silindi');
    assert.notEqual(year.draft.updatedAt, saved.draft.updatedAt, 'taslağın sürümü ilerledi');
  });

  it('gerçekleşen gider: kaydet, sil, eski hücre sürümü ve gelecek ay reddedilir', async () => {
    const { personnel } = await draftWithPlan();
    const saved = await manager(() => budget.saveExpenseActuals(hotelId, { year: Y, entries: [{ itemId: personnel.item, month: PM, amount: '1200', expectedUpdatedAt: null }] }));
    const entry = saved.entries.find((row) => row.itemId === personnel.item && row.month === PM);
    assert.equal(entry.amount, '1200');
    await assert.rejects(
      manager(() => budget.saveExpenseActuals(hotelId, { year: Y, entries: [{ itemId: personnel.item, month: PM, amount: '1300', expectedUpdatedAt: null }] })),
      (error) => error.code === 'STALE_WRITE',
    );
    await assert.rejects(
      manager(() => budget.saveExpenseActuals(hotelId, { year: Y + 2, entries: [{ itemId: personnel.item, month: 1, amount: '1', expectedUpdatedAt: null }] })),
      /Gelecek ay/,
    );
    const cleared = await manager(() => budget.saveExpenseActuals(hotelId, { year: Y, entries: [{ itemId: personnel.item, month: PM, amount: null, expectedUpdatedAt: new Date(entry.updatedAt) }] }));
    assert.equal(cleared.entries.length, 0);
  });

  it('sapma raporu: folyodan sınıflanan gelir, tahsilat, hedefler, oda geliri ayrıştırması, eksik gider; otel sınırı', async () => {
    await seedActuals();
    const { personnel } = await draftWithPlan();
    await manager(() => budget.saveExpenseActuals(hotelId, { year: Y, entries: [{ itemId: personnel.item, month: PM, amount: '1200', expectedUpdatedAt: null }] }));

    const report = await variance.getVarianceReport(hotelId, { year: Y, month: PM, scope: 'MONTH' });
    assert.equal(report.basis.status, 'DRAFT', 'onaylı yokken taslağa göre (işaretli)');
    const row = (item) => report.rows.find((entry) => entry.item === item);
    assert.deepEqual(
      ['ROOM_REVENUE', 'FNB_REVENUE', 'MINIBAR_REVENUE', 'LAUNDRY_REVENUE', 'FEE_REVENUE', 'CANCELLATION_REVENUE', 'OTHER_REVENUE', 'COLLECTIONS'].map((item) => [item, row(item).actual]),
      [
        ['ROOM_REVENUE', '2000.00'],
        ['FNB_REVENUE', '250.00'],
        ['MINIBAR_REVENUE', '80.00'],
        ['LAUNDRY_REVENUE', '40.00'],
        ['FEE_REVENUE', '200.00'],
        ['CANCELLATION_REVENUE', '150.00'],
        ['OTHER_REVENUE', '100.00'],
        ['COLLECTIONS', '2400.00'],
      ],
    );
    assert.deepEqual([row('ROOM_REVENUE').difference, row('ROOM_REVENUE').differencePct, row('ROOM_REVENUE').tone], ['-500.00', -20, 'BAD']);
    assert.deepEqual([row('FNB_REVENUE').difference, row('FNB_REVENUE').tone], ['50.00', 'GOOD']);
    assert.deepEqual([row(personnel.item).difference, row(personnel.item).tone], ['200.00', 'BAD'], 'giderde fazlası kötü');

    const sellable = 10 * rules.daysInMonth(Y, PM);
    assert.equal(row('OCCUPANCY').actual, Math.round((2 / sellable) * 1000) / 10);
    assert.equal(row('OCCUPANCY').plan, 1);
    assert.equal(row('ADR').actual, '1000.00');
    assert.equal(row('ADR').plan, '1100.00');

    assert.equal(report.totals.revenue.plan, '2700.00');
    assert.equal(report.totals.revenue.actual, '2820.00');
    assert.equal(report.totals.expense.plan, '1500.00');
    assert.equal(report.totals.expense.actual, '1200.00');
    assert.equal(report.totals.expense.complete, false, 'enerji gerçekleşeni girilmedi');
    assert.equal(report.totals.gop.actual, '1620.00');

    const planNights = sellable / 100;
    assert.deepEqual(report.drivers.room, {
      occupancyEffect: core.toMoneyString(core.toDecimal(1100).times(2 - planNights)),
      rateEffect: '-200.00',
      planGap: core.toMoneyString(core.toDecimal(1100).times(planNights).minus(2500)),
    });

    // Rapor ile bütçe aynı ayın oda gelirini aynı gösterir.
    const revenueReport = await (await import('../reports/service.js')).getRevenueReport(hotelId, { from: pmDay(1), to: pmDay(rules.daysInMonth(Y, PM)), groupBy: 'MONTH' });
    assert.equal(revenueReport.totals.roomRevenue, row('ROOM_REVENUE').actual);

    const ytd = await variance.getVarianceReport(hotelId, { year: Y, month: PM, scope: 'YTD' });
    assert.equal(ytd.rows.find((entry) => entry.item === 'ROOM_REVENUE').actual, '2000.00');
    assert.equal(ytd.period.months.length, PM);
  });

  it('içinde bulunulan ay: plan kapanmış gün oranında; gelecek ay dönem dışı', async () => {
    const year = Number(B.slice(0, 4));
    const month = Number(B.slice(5, 7));
    const draft = await manager(() => budget.createBudget(hotelId, { year }));
    await manager(() => budget.saveBudgetLines(hotelId, draft.draft.id, { expectedUpdatedAt: new Date(draft.draft.updatedAt), lines: [{ item: 'ROOM_REVENUE', months: months({ [month]: '3100' }) }] }));
    const report = await variance.getVarianceReport(hotelId, { year, month, scope: 'MONTH' });
    const share = (Number(B.slice(8, 10)) - 1) / rules.daysInMonth(year, month);
    if (share === 0) {
      assert.deepEqual(report.period.months, [], 'ayın ilk günü: kapanmış gün yok');
    } else {
      assert.equal(report.period.partial.month, month);
      assert.equal(report.rows.find((row) => row.item === 'ROOM_REVENUE').plan, core.toMoneyString(core.toDecimal(3100).times(share)));
    }
    if (month < 12) {
      const future = await variance.getVarianceReport(hotelId, { year, month: month + 1, scope: 'MONTH' });
      assert.deepEqual(future.period.months, []);
      assert.equal(future.rows.find((row) => row.item === 'ROOM_REVENUE').plan, null);
    }
  });

  it('AI yorumu: ajan yokken istenmez; sahte modelle yazılır (kişisel veri yok); aynı dönem için tek bekleyen istek', async () => {
    await seedActuals();
    await draftWithPlan();
    const query = { year: Y, month: PM, scope: 'MONTH' };
    await assert.rejects(manager(() => variance.requestCommentary(hotelId, query)), (error) => error.code === 'AI_UNAVAILABLE');

    assert.equal(actors.registerAiAgents({ client: fakeModel }), true);
    await db.aiSettings.create({ data: { hotelId, enabled: true, conciergeModel: MODEL, routerModel: MODEL, prices: PRICES, dailyBudgetUsd: '5' } });
    (await import('../../lib/cache.js')).cache.clear();

    // Kapanmış günü olmayan dönem yorumlanmaz (boşuna model maliyeti).
    const nextYear = Number(B.slice(0, 4)) + 1;
    await manager(() => budget.createBudget(hotelId, { year: nextYear }));
    await assert.rejects(manager(() => variance.requestCommentary(hotelId, { year: nextYear, month: 1, scope: 'MONTH' })), (error) => error.code === 'VALIDATION');

    // Model cevap verene kadar istek bekler: bu sırada ikinci istek aynı kaydı döndürür.
    let open;
    fakeModel.gate = new Promise((resolve) => {
      open = resolve;
    });
    const first = await manager(() => variance.requestCommentary(hotelId, query));
    assert.equal(first.available, true);
    assert.equal(first.commentary.status, 'PENDING');
    const again = await manager(() => variance.requestCommentary(hotelId, query));
    assert.equal(again.commentary.id, first.commentary.id, 'bekleyen istek varken ikinci istek açılmaz');
    open();
    fakeModel.gate = null;

    await actors.actorRegistry.idle();
    const done = await variance.getCommentary(hotelId, query);
    assert.equal(done.commentary.status, 'READY');
    assert.equal(done.commentary.text, 'Eylül oda geliri planın altında kaldı; doluluk etkisi belirleyici.', 'markdown ayıklandı');
    assert.equal(done.commentary.model, MODEL);
    const input = JSON.parse(fakeModel.calls.at(-1).messages[1].content);
    assert.equal(input.topVariances[0].item, 'ROOM_REVENUE');
    assert.doesNotMatch(JSON.stringify(input), /Ayşe|Kaya/, 'misafir bilgisi modele gitmez');
    assert.equal(await db.llmUsage.count({ where: { hotelId, actorName: 'budget-agent' } }), 1);
  });

  it('MCP explain_variance ve izinler (resepsiyon görmez, muhasebe onaylayamaz)', async () => {
    await seedActuals();
    const { saved } = await draftWithPlan();
    const { client, close } = await mcpServer.connectInProcess(mcp.createReportingMcpServer({ hotelId }));
    try {
      const result = await client.callTool({ name: 'explain_variance', arguments: { year: Y, month: PM, scope: 'MONTH' } });
      assert.equal(result.isError, undefined, JSON.stringify(result.content));
      assert.equal(result.structuredContent.topVariances[0].item, 'ROOM_REVENUE');
      assert.ok(result.structuredContent.notes.some((note) => /taslak/.test(note)));
    } finally {
      await close();
    }

    assert.equal((await call('GET', `/budgets/${Y}`, 'resepsiyon@test.local')).statusCode, 403);
    assert.equal((await call('GET', `/budgets/${Y}`, 'muhasebe@test.local')).statusCode, 200);
    const denied = await call('POST', `/budgets/versions/${saved.draft.id}/approve`, 'muhasebe@test.local', { expectedUpdatedAt: saved.draft.updatedAt });
    assert.equal(denied.statusCode, 403);
    const varianceResponse = await call('GET', `/budgets/${Y}/variance?month=${PM}&scope=YTD`, 'muhasebe@test.local');
    assert.equal(varianceResponse.statusCode, 200, varianceResponse.body);
    assert.equal(varianceResponse.json().data.scope, 'YTD');
    assert.equal((await call('GET', `/budgets/${Y}/variance?month=13`, 'muhasebe@test.local')).statusCode, 400);
  });
});
