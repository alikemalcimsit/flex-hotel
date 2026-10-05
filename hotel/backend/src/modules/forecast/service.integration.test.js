import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Doluluk ve gelir tahmini (modül 25) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: geçen yılın aynı gün kala pickup'ı ("o gün kala eldeki" —
 * sonradan açılan ve sonradan iptal edilen rezervasyon), geçen yıl yokken son
 * haftalar, sistemde kayıt yokken tahmin = eldeki, gelir tahmini (dahil vergi
 * ayrılmış eldeki ADR), kritik günler (düşük, yüksek, fazla satış), eşik
 * ayarı (izin, doğrulama, denetim kaydı, önbelleğin olayla tazelenmesi),
 * okuma izni, MCP aracı, otel sınırı.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

describe('tahmin (modül 25, entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let forecast;
  /** @type {any} */ let mcp;
  /** @type {any} */ let mcpServer;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let otherHotelId;
  let roomTypeId;
  let otherRoomTypeId;
  let rooms;
  /** @type {Date} */ let NOW;
  let B;
  /** @type {Map<string, string>} */ let tokens;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    forecast = await import('./service.js');
    mcp = await import('../reports/mcp.js');
    mcpServer = await import('@hotelos/mcp-server');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const dayDate = (offset) => new Date(`${contracts.shiftDay(B, offset)}T00:00:00.000Z`);
  const ago = (days) => new Date(NOW.getTime() - days * DAY_MS);

  beforeEach(async () => {
    await resetDatabase(db);
    (await import('../../lib/cache.js')).cache.clear();
    forecast.clearForecastCache();
    tokens = new Map();
    NOW = new Date();
    B = core.toIsoDay(core.calendarDateInTimeZone(ZONE, NOW));

    const hotel = await db.hotel.create({ data: { name: 'Tahmin Otel', code: `F${randomUUID().slice(0, 6)}`, timezone: ZONE, currency: 'TRY' } });
    hotelId = hotel.id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka', code: `G${randomUUID().slice(0, 6)}`, timezone: ZONE, currency: 'TRY' } })).id;
    await db.tax.create({ data: { hotelId, name: 'KDV', rate: '10', isIncluded: true, appliesTo: ['ROOM'] } });
    roomTypeId = (await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 2 } })).id;
    otherRoomTypeId = (await db.roomType.create({ data: { hotelId: otherHotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 2 } })).id;
    rooms = [];
    for (let number = 101; number <= 110; number += 1) {
      rooms.push(await db.room.create({ data: { hotelId, number: String(number), roomTypeId } }));
    }
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: 'mudur@test.local', name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: 'muhasebe@test.local', name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
        { hotelId, email: 'resepsiyon@test.local', name: 'Resepsiyon', role: 'FRONT_DESK', passwordHash },
      ],
    });
  });

  /**
   * Odasız konaklama (çift satış kısıtına takılmaz) — tek gece, gece fiyatı 1100 (%10 dahil vergi: net 1000).
   * @param {{ offset: number, status?: string, createdAt?: Date, cancelledAt?: Date | null, noShowAt?: Date | null, hotel?: string, currency?: string }} options
   */
  async function stay({ offset, status = 'CONFIRMED', createdAt = new Date(), cancelledAt = null, noShowAt = null, hotel = hotelId, currency = 'TRY' }) {
    const guest = await db.guest.create({ data: { hotelId: hotel, firstName: 'Misafir', lastName: randomUUID().slice(0, 6) } });
    const reservation = await db.reservation.create({
      data: {
        hotelId: hotel,
        guestId: guest.id,
        roomTypeId: hotel === hotelId ? roomTypeId : otherRoomTypeId,
        checkIn: dayDate(offset),
        checkOut: dayDate(offset + 1),
        status,
        totalPrice: '1100',
        currency,
        confirmationCode: `F-${randomUUID().slice(0, 10)}`,
        createdAt,
        cancelledAt,
        noShowAt,
        ...(status === 'CHECKED_OUT' ? { checkedInAt: dayDate(offset), checkedInBy: 'test', checkedOutAt: dayDate(offset + 1), checkedOutBy: 'test' } : {}),
      },
    });
    await db.reservationNight.create({ data: { hotelId: hotel, reservationId: reservation.id, date: dayDate(offset), amount: '1100' } });
    return reservation;
  }

  /** `count` adet aynı konaklama. */
  async function stays(count, options) {
    for (let index = 0; index < count; index += 1) await stay(options);
  }

  const run = (days = 30) => forecast.getForecast(hotelId, { days }, { now: NOW });
  const rowOf = (result, offset) => result.rows.find((row) => row.date === contracts.shiftDay(B, offset));

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) =>
    app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });

  it('geçen yılın aynı gün kala pickup’ı: sonradan açılan eklenir, sonradan iptal edilen düşer; gelir eldeki ADR ile', async () => {
    // 10 gün sonrası için geçen yılın üç karşılık günü (364 gün ± 1 hafta), her birinde "o gün kala":
    // 3 konaklama elde + 1 elde ama sonradan iptal; sonradan 2 konaklama daha açıldı → elde 4, gerçekleşen 5 → +%10.
    for (const delta of [371, 364, 357]) {
      const offset = 10 - delta;
      const asOf = ago(delta);
      await stays(3, { offset, status: 'CHECKED_OUT', createdAt: new Date(asOf.getTime() - 5 * DAY_MS) });
      await stays(2, { offset, status: 'CHECKED_OUT', createdAt: new Date(asOf.getTime() + 2 * DAY_MS) });
      await stay({ offset, status: 'CANCELLED', createdAt: new Date(asOf.getTime() - 5 * DAY_MS), cancelledAt: new Date(asOf.getTime() + DAY_MS) });
    }
    await stays(3, { offset: 10, createdAt: ago(1) });
    // Başka para birimindeki geçen yıl satışı pickup'a karışmaz (eldeki de saymaz).
    await stay({ offset: 10 - 364, status: 'CHECKED_OUT', createdAt: new Date(ago(364).getTime() + DAY_MS), currency: 'EUR' });
    // Başka otelin aynı günü sayılmaz.
    await stays(4, { offset: 10, hotel: otherHotelId, createdAt: ago(1) });

    const result = await run();
    assert.equal(result.days, 30);
    assert.equal(result.rows.length, 30);
    assert.equal(result.rows[0].date, B);
    const row = rowOf(result, 10);
    assert.equal(row.lead, 10);
    assert.equal(row.basis, 'LAST_YEAR');
    assert.equal(row.samples, 3);
    assert.deepEqual(row.onBooks, { sold: 3, occupancyPct: 30, revenue: '3000.00' });
    assert.deepEqual(row.forecast, { nights: 4, pickup: 1, occupancyPct: 40, revenue: '4000.00' });
    assert.equal(row.lastYear.date, contracts.shiftDay(B, 10 - 364));
    assert.equal(row.lastYear.sold, 5, 'geçen yılın aynı günü gerçekleşen');
    assert.equal(result.basisCounts.LAST_YEAR, 30, 'geçen yılın kaydı olan otelde her gün geçen yıldan');
    assert.equal(rowOf(result, 5).alert, 'LOW', 'tahmini olan günde düşük doluluk işaretlenir');
    assert.equal(rowOf(result, 10).alert, null, '%40 eşiklerin arasında');
    assert.equal(result.settings.lowPct, 30);
    assert.equal(result.settings.highPct, 95);
  });

  it('geçen yıl yoksa son haftaların aynı günleri; sistemde kayıt olmayan an karşılaştırılmaz', async () => {
    // Otelin ilk kaydı 29 gün önce: 3 gün sonrası için 7, 14, 21, 28 gün önceki aynı günler (4 örnek).
    for (const week of [1, 2, 3, 4]) {
      const delta = week * 7;
      const asOf = ago(delta);
      await stays(2, { offset: 3 - delta, status: 'CHECKED_OUT', createdAt: new Date(asOf.getTime() - DAY_MS) });
      await stay({ offset: 3 - delta, status: 'CHECKED_OUT', createdAt: new Date(asOf.getTime() + HOUR_MS) });
    }
    await stays(5, { offset: 3, createdAt: ago(0.5) });

    const row = rowOf(await run(), 3);
    assert.equal(row.basis, 'RECENT');
    assert.equal(row.samples, 4, '35 gün önceki an sistemden eski: sayılmaz');
    assert.deepEqual(row.forecast, { nights: 6, pickup: 1, occupancyPct: 60, revenue: '6000.00' });
  });

  it('karşılaştırma verisi yoksa tahmin = eldeki; kritik günler: yüksek ve fazla satış (düşük tahmin ister); pencere toplamı', async () => {
    await stays(10, { offset: 1 });
    await stays(2, { offset: 2 });
    await stays(5, { offset: 3 });
    await stays(10, { offset: 4 });
    // 4. gece bir oda arızalı: 10 satış 9 satılabilir odaya.
    await db.roomBlock.create({ data: { hotelId, roomId: rooms[0].id, type: 'OUT_OF_ORDER', startDate: dayDate(4), endDate: dayDate(5), reason: 'Su kaçağı', createdBy: 'test' } });

    const result = await run(7);
    assert.equal(result.basisCounts.NONE, 7);
    for (const row of result.rows) assert.equal(row.forecast.nights, row.onBooks.sold, `${row.date}: tahmin eldekiyle aynı`);
    assert.deepEqual(
      result.rows.map((row) => [row.onBooks.sold, row.sellable, row.alert]),
      [
        [0, 10, null],
        [10, 10, 'HIGH'],
        [2, 10, null],
        [5, 10, null],
        [10, 9, 'OVERBOOKED'],
        [0, 10, null],
        [0, 10, null],
      ],
    );
    assert.deepEqual(
      result.alerts.map((alert) => [alert.date, alert.alert]),
      result.rows.filter((row) => row.alert).map((row) => [row.date, row.alert]),
    );
    assert.equal(result.totals.onBooks.sold, 27);
    assert.equal(result.totals.sellable, 69);
    assert.equal(result.totals.forecast.revenue, '27000.00');
    assert.equal(result.totals.forecast.adr, '1000.00');
  });

  it('eşik ayarı: müdür değiştirir (denetim kaydı, doğrulama), tahmin yeni eşikle işaretlenir; okuma ve yazma izinleri', async () => {
    await stays(10, { offset: 2 });

    const first = await call('GET', '/forecast?days=3', 'mudur@test.local');
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().data.rows[2].alert, 'HIGH', '%100 > %95');

    assert.equal((await call('GET', '/forecast', 'resepsiyon@test.local')).statusCode, 403, 'resepsiyon geliri görmez');
    assert.equal((await call('PUT', '/forecast/settings', 'muhasebe@test.local', { expectedUpdatedAt: first.json().data.settings.updatedAt, lowPct: 10, highPct: 99 })).statusCode, 403);

    const stamp = first.json().data.settings.updatedAt;
    const invalid = await call('PUT', '/forecast/settings', 'mudur@test.local', { expectedUpdatedAt: stamp, lowPct: 92, highPct: 95 });
    assert.ok(invalid.statusCode >= 400 && invalid.statusCode < 500, invalid.body);
    assert.match(invalid.body, /en az 5 puan/);
    assert.equal((await call('GET', '/forecast?days=31', 'mudur@test.local')).statusCode, 400);

    const saved = await call('PUT', '/forecast/settings', 'mudur@test.local', { expectedUpdatedAt: stamp, lowPct: 10, highPct: 99 });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().data.lowPct, 10);
    assert.equal(saved.json().data.highPct, 99);
    assert.notEqual(saved.json().data.updatedAt, stamp, 'sürüm ilerler');

    // Aynı anda açılmış ikinci pencere eski sürümle kaydedemez (ilk kaydı sessizce ezmez).
    const stale = await call('PUT', '/forecast/settings', 'mudur@test.local', { expectedUpdatedAt: stamp, lowPct: 20, highPct: 90 });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(stale.json().code, 'STALE_WRITE');
    const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'Hotel', action: 'UPDATE' }, orderBy: { createdAt: 'desc' } });
    assert.deepEqual([...audit.changedFields].sort(), ['forecastHighOccupancyPct', 'forecastLowOccupancyPct']);

    // Önbellek ayar olayıyla tazelenir (temizlemeden).
    const next = (await call('GET', '/forecast?days=3', 'mudur@test.local')).json().data;
    assert.deepEqual([next.settings.lowPct, next.settings.highPct], [10, 99]);
    assert.equal(next.rows[2].alert, 'HIGH', '%100 > %99');

    // Yüksek eşik %100 olunca tam dolu gün artık kritik değil (önbellek yine olayla tazelenir).
    const third = await call('PUT', '/forecast/settings', 'mudur@test.local', { expectedUpdatedAt: saved.json().data.updatedAt, lowPct: 10, highPct: 100 });
    assert.equal(third.statusCode, 200, third.body);
    assert.equal((await call('GET', '/forecast?days=3', 'mudur@test.local')).json().data.rows[2].alert, null);
  });

  it('MCP get_forecast: ekranla aynı rakamlar, otele bağlı, hatalı girdi araç hatası', async () => {
    await stays(4, { offset: 2 });
    const { client, close } = await mcpServer.connectInProcess(mcp.createReportingMcpServer({ hotelId }));
    try {
      const { tools } = await client.listTools();
      assert.ok(tools.some((tool) => tool.name === 'get_forecast'));
      const result = await client.callTool({ name: 'get_forecast', arguments: { days: 5 } });
      assert.equal(result.isError, undefined, JSON.stringify(result.content));
      const direct = await forecast.getForecast(hotelId, { days: 5 });
      assert.deepEqual(
        result.structuredContent.rows.map((row) => [row.date, row.onBooks.sold, row.forecast.nights, row.alert]),
        direct.rows.map((row) => [row.date, row.onBooks.sold, row.forecast.nights, row.alert]),
      );
      const invalid = await client.callTool({ name: 'get_forecast', arguments: { days: 90 } });
      assert.equal(invalid.isError, true);
      assert.match(invalid.content[0].text, /En fazla 30 gün/);
    } finally {
      await close();
    }
  });
});
