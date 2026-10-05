import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Gelir raporları (modül 23) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: satılan gece (sayılan durumlar; iptal ve bırakılan gece yok),
 * satılabilir oda (arıza düşer), geçmiş günün gelirinin folyodan sınıflanması
 * (gece ücreti, fiyat düşüşü indirimi, elle oda indirimi, iptal kaydı iptal
 * gününe, erken giriş ücreti, gelmeme ücreti, F&B gelir değil), gelecek günün
 * eldeki gelirinden dahil vergi ayrılması, başka para birimi, geçen yıl (364
 * gün), haftalık kova, oda tipi / kaynak kırılımı, otel sınırı, salt okunur
 * işlem, en ileri tarih, MCP araçları (aynı rakamlar, hatalı girdi).
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';

describe('gelir raporları (entegrasyon)', { skip }, () => {
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let service;
  /** @type {any} */ let queries;
  /** @type {any} */ let mcp;
  /** @type {any} */ let stats;
  /** @type {any} */ let mcpServer;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let otherHotelId;
  let types;
  let rooms;
  let B;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    service = await import('./service.js');
    queries = await import('./queries.js');
    mcp = await import('./mcp.js');
    stats = await import('./stats.js');
    mcpServer = await import('@hotelos/mcp-server');
    cache = await import('../../lib/cache.js');
  });

  after(async () => {
    await db?.$disconnect();
  });

  const shift = (offset) => contracts.shiftDay(B, offset);
  const dayDate = (offset) => new Date(`${shift(offset)}T00:00:00.000Z`);

  beforeEach(async () => {
    await resetDatabase(db);
    service.clearReportCache();
    cache.cache.invalidatePrefix('settings:');
    B = core.toIsoDay(core.calendarDateInTimeZone(ZONE));
    const hotel = await db.hotel.create({ data: { name: 'Deniz Otel', code: `R${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } });
    hotelId = hotel.id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka', code: `S${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    // Oda fiyatına %10 dahil vergi (eldeki gelirden ayrılır); F&B vergisi oda oranına karışmaz.
    await db.tax.createMany({
      data: [
        { hotelId, name: 'KDV', rate: '10', isIncluded: true, appliesTo: ['ROOM'] },
        { hotelId, name: 'KDV', rate: '20', isIncluded: true, appliesTo: ['FNB'] },
      ],
    });
    types = {
      STD: await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 2, capacityChildren: 0 } }),
      SUITE: await db.roomType.create({ data: { hotelId, code: 'SUI', name: 'Suit', basePrice: '3000', capacityAdults: 2, capacityChildren: 0 } }),
    };
    rooms = [];
    for (let index = 1; index <= 10; index += 1) {
      const type = index <= 8 ? types.STD : types.SUITE;
      rooms.push(await db.room.create({ data: { hotelId, number: String(100 + index), roomTypeId: type.id } }));
    }
  });

  /**
   * Konaklama + geceleri (+ istenirse folyo).
   * @param {{ type?: any, room?: number, status?: string, nights: Array<[number, string]>, source?: string, currency?: string, hotel?: string }} options
   */
  async function stay({ type = types.STD, room = 0, status = 'CHECKED_OUT', nights, source = 'UI', currency = 'TRY', hotel = hotelId }) {
    const guest = await db.guest.create({ data: { hotelId: hotel, firstName: 'Ayşe', lastName: 'Kaya' } });
    const first = Math.min(...nights.map(([offset]) => offset));
    const last = Math.max(...nights.map(([offset]) => offset));
    const reservation = await db.reservation.create({
      data: {
        hotelId: hotel,
        guestId: guest.id,
        roomTypeId: type.id,
        roomId: hotel === hotelId ? rooms[room].id : null,
        checkIn: dayDate(first),
        checkOut: dayDate(last + 1),
        status,
        source,
        currency,
        confirmedAt: new Date(),
        totalPrice: '1',
        confirmationCode: `R${randomUUID().slice(0, 7).toUpperCase()}`,
        ...(status === 'CHECKED_OUT' ? { checkedInAt: dayDate(first), checkedInBy: 'test', checkedOutAt: dayDate(last + 1), checkedOutBy: 'test' } : {}),
        ...(status === 'CHECKED_IN' ? { checkedInAt: dayDate(first), checkedInBy: 'test' } : {}),
      },
    });
    await db.reservationNight.createMany({
      data: nights.map(([offset, amount]) => ({ hotelId: hotel, reservationId: reservation.id, date: dayDate(offset), amount })),
    });
    const folio = await db.folio.create({ data: { hotelId: hotel, reservationId: reservation.id, guestId: guest.id, currency } });
    return { reservation, folio };
  }

  /**
   * Folyo kalemi (net + vergi = toplam).
   * @param {{ folio: any, reservation: any }} target
   * @param {{ offset: number, type?: string, source?: string, net: string, tax?: string, taxCategory?: string | null, reversalOf?: any }} item
   */
  function post(target, { offset, type = 'ROOM', source = 'ROOM_NIGHT', net, tax = '0', taxCategory = 'ROOM', reversalOf = null }) {
    const total = core.toMoneyString(core.toDecimal(net).plus(core.toDecimal(tax)));
    return db.folioItem.create({
      data: {
        hotelId: target.reservation.hotelId,
        folioId: target.folio.id,
        reservationId: target.reservation.id,
        type,
        source: reversalOf ? 'REVERSAL' : source,
        description: 'test',
        amount: total,
        quantity: 1,
        taxCategory,
        netAmount: net,
        taxAmount: tax,
        total,
        serviceDate: dayDate(offset),
        postedBy: 'test',
        reversalOfId: reversalOf?.id ?? null,
      },
    });
  }

  const report = (query) => service.getRevenueReport(hotelId, { groupBy: 'DAY', ...query });
  const dayRow = (result, offset) => result.buckets.find((row) => row.key === shift(offset));

  it('geçmiş gün: satılan gece ve folyodan sınıflanan gerçekleşen gelir; ADR / RevPAR toplamdan', async () => {
    const a = await stay({ room: 0, nights: [[-3, '1100'], [-2, '1100']] });
    const b = await stay({ room: 1, type: types.SUITE, nights: [[-3, '3300']], source: 'OTA' });
    // İptal edilen konaklama sayılmaz; çıkmış konaklamanın iş günü ve sonrası gecesi de sayılmaz.
    await stay({ room: 2, status: 'CANCELLED', nights: [[-3, '1100']] });
    await stay({ room: 3, nights: [[-1, '1100'], [0, '1100']] });

    await post(a, { offset: -3, net: '1000', tax: '100' });
    await post(a, { offset: -3, type: 'DISCOUNT', net: '-100', tax: '-10' }); // fiyat düştü: gece düzeltmesi
    const night2 = await post(a, { offset: -2, net: '1000', tax: '100' });
    await post(a, { offset: -1, net: '-1000', tax: '-100', reversalOf: night2 }); // -2 gecesi -1'de iptal edildi
    await post(a, { offset: -3, source: 'EARLY_CHECK_IN', net: '200', tax: '20' });
    await post(b, { offset: -3, net: '3000', tax: '300' });
    await post(b, { offset: -3, type: 'DISCOUNT', source: 'MANUAL', net: '-300', tax: '-30' }); // elle oda indirimi
    await post(b, { offset: -3, type: 'FNB', source: 'MANUAL', net: '500', tax: '100', taxCategory: 'FNB' }); // oda geliri değil
    await post(b, { offset: -3, source: 'NO_SHOW', net: '700', tax: '70' });

    const result = await report({ from: shift(-3), to: shift(-1) });
    const first = dayRow(result, -3);
    assert.equal(first.sold, 2);
    assert.equal(first.sellable, 10);
    assert.equal(first.roomRevenue, '3600.00', '1000 − 100 + 3000 − 300');
    assert.equal(first.discounts, '-400.00');
    assert.equal(first.fees, '200.00');
    assert.equal(first.cancellations, '700.00');
    assert.equal(first.totalRevenue, '4500.00');
    assert.equal(first.adr, '1800.00');
    assert.equal(first.revpar, '360.00');
    assert.equal(first.occupancyPct, 20);
    assert.equal(first.onTheBooksDays, 0);

    assert.equal(dayRow(result, -2).roomRevenue, '1000.00');
    assert.equal(dayRow(result, -1).roomRevenue, '-1000.00', 'iptal kaydı iptal edildiği güne düşer');
    assert.equal(dayRow(result, -1).sold, 1, 'çıkmış konaklamanın geçmiş gecesi sayılır');
    assert.equal(result.totals.sold, 4);
    assert.equal(result.totals.roomRevenue, '3600.00');
    assert.equal(result.totals.adr, '900.00');
  });

  it('bugün ve sonrası: eldeki rezervasyon geliri, dahil vergi ayrılarak; arızalı oda satılabilirden düşer', async () => {
    await stay({ room: 0, status: 'CONFIRMED', nights: [[1, '1100'], [2, '1100']] });
    await stay({ room: 1, status: 'PENDING', nights: [[1, '2200']] });
    await stay({ room: 2, status: 'CHECKED_IN', nights: [[-1, '1100'], [0, '1100']] });
    await db.roomBlock.create({ data: { hotelId, roomId: rooms[9].id, type: 'OUT_OF_ORDER', startDate: dayDate(1), endDate: dayDate(2), reason: 'Su kaçağı', createdBy: 'test' } });
    await db.roomBlock.create({ data: { hotelId, roomId: rooms[8].id, type: 'OUT_OF_SERVICE', startDate: dayDate(1), endDate: dayDate(2), reason: 'Boya', createdBy: 'test' } });

    const result = await report({ from: shift(0), to: shift(2) });
    const today = dayRow(result, 0);
    assert.equal(today.sold, 1);
    assert.equal(today.roomRevenue, '1000.00', '1100 / 1.10');
    assert.equal(today.onTheBooksDays, 1);
    const tomorrow = dayRow(result, 1);
    assert.equal(tomorrow.sold, 2);
    assert.equal(tomorrow.sellable, 9, 'yalnızca arızalı (envanterden düşen) oda düşer');
    assert.equal(tomorrow.roomRevenue, '3000.00');
    assert.equal(tomorrow.adr, '1500.00');
    assert.equal(dayRow(result, 2).sellable, 10, 'arıza bitiş günü dahil değil');
    assert.equal(result.includedTaxRate, '10');
  });

  it('gelmeyen misafirin geçmiş gecesi satılmış sayılmaz (özet de); silinen oda silindiği güne kadar satılabilir', async () => {
    // Hiç gelmedi, "gelmedi" de işaretlenmedi: geçmiş geceleri boş kaldı, bugünden sonrası hâlâ eldeki.
    await stay({ room: 0, status: 'CONFIRMED', nights: [[-2, '1100'], [-1, '1100'], [0, '1100'], [1, '1100']] });
    const live = await report({ from: shift(-2), to: shift(1) });
    assert.deepEqual([-2, -1, 0, 1].map((offset) => dayRow(live, offset).sold), [0, 0, 1, 1]);
    assert.equal(dayRow(live, 0).roomRevenue, '1000.00');

    // Aynı kural özette (kapanmış gün).
    await stay({ room: 1, status: 'CONFIRMED', nights: [[-40, '1100']] });
    await stay({ room: 2, nights: [[-40, '1100']] });
    await stats.refreshHotelStats(hotelId);
    service.clearReportCache();
    assert.equal(await db.revenueStatDay.count({ where: { hotelId, day: dayDate(-40) } }), 1, 'gün özetten okunuyor');
    assert.equal(dayRow(await report({ from: shift(-40), to: shift(-40) }), -40).sold, 1);

    // 101 numaralı oda -7 gecesi arızalıydı; -5 günü öğleden sonra silindi.
    await db.roomBlock.create({ data: { hotelId, roomId: rooms[9].id, type: 'OUT_OF_ORDER', startDate: dayDate(-7), endDate: dayDate(-6), reason: 'Su kaçağı', createdBy: 'test' } });
    await db.room.update({ where: { id: rooms[9].id }, data: { deletedAt: new Date(dayDate(-5).getTime() + 14 * 3_600_000) } });
    service.clearReportCache();
    const removed = await report({ from: shift(-7), to: shift(-4) });
    assert.deepEqual([-7, -6, -5, -4].map((offset) => dayRow(removed, offset).sellable), [9, 10, 9, 9]);
  });

  it('süre sınırını aşan rapor sorgusu anlamlı hatayla döner (503, aralığı daraltın)', async () => {
    await assert.rejects(
      queries.readOnly((tx) => tx.$queryRaw`SELECT pg_sleep(1)`, { timeoutMs: 50 }),
      (error) => error instanceof queries.ReportTimeoutError && error.statusCode === 503 && /Daha kısa/.test(error.message),
    );
  });

  it('geçen yıl haftanın aynı günü (364 gün); haftalık kova; kırılımlar geçen yılla', async () => {
    const now = await stay({ room: 0, nights: [[-7, '1100']], source: 'OTA' });
    await post(now, { offset: -7, net: '1200', tax: '120' });
    const suite = await stay({ room: 8, type: types.SUITE, nights: [[-7, '3300']], source: 'PHONE' });
    await post(suite, { offset: -7, net: '3000', tax: '300' });
    const ly = await stay({ room: 0, nights: [[-7 - 364, '1100']], source: 'OTA' });
    await post(ly, { offset: -7 - 364, net: '1000', tax: '100' });
    const lyOther = await stay({ room: 1, nights: [[-7 - 364, '1100']], source: 'UI' });
    await post(lyOther, { offset: -7 - 364, net: '1000', tax: '100' });

    const result = await report({ from: shift(-7), to: shift(-7), groupBy: 'DAY' });
    const row = dayRow(result, -7);
    assert.equal(row.lastYear.from, shift(-7 - 364));
    assert.equal(row.lastYear.sold, 2);
    assert.equal(row.lastYear.roomRevenue, '2000.00');
    assert.equal(row.change.roomRevenue, 110);
    assert.equal(row.change.adr, 110);

    const types_ = result.breakdowns.roomType;
    assert.deepEqual(types_.map((entry) => [entry.label, entry.roomRevenue, entry.lastYear.roomRevenue]), [
      ['Suit (SUI)', '3000.00', '0.00'],
      ['Standart (STD)', '1200.00', '2000.00'],
    ]);
    const sources = result.breakdowns.source;
    assert.deepEqual(sources.map((entry) => entry.key), ['PHONE', 'OTA', 'UI'], 'yalnızca geçen yıl satan kaynak da görünür');
    assert.equal(sources.find((entry) => entry.key === 'OTA').change.roomRevenue, 20);
    assert.equal(sources.find((entry) => entry.key === 'PHONE').label, 'Telefon');

    const weekly = await report({ from: shift(-13), to: shift(0), groupBy: 'WEEK' });
    assert.ok(weekly.buckets.length >= 2 && weekly.buckets.length <= 3);
    assert.equal(weekly.buckets.reduce((total, bucket) => total + bucket.days, 0), 14);
    assert.equal(weekly.totals.sold, 2);
  });

  it('başka para birimi karışmaz (sayısı bildirilir); başka otelin verisi görünmez', async () => {
    await stay({ room: 0, status: 'CONFIRMED', nights: [[1, '100']], currency: 'EUR' });
    await stay({ status: 'CONFIRMED', nights: [[1, '9999']], hotel: otherHotelId });
    const result = await report({ from: shift(1), to: shift(1) });
    assert.equal(result.totals.sold, 0);
    assert.equal(result.totals.roomRevenue, '0.00');
    assert.equal(result.otherCurrencyNights, 1);
  });

  it('en ileri tarih sınırı; sorgular salt okunur işlemde (yazma reddedilir)', async () => {
    await assert.rejects(report({ from: shift(700), to: shift(740) }), (error) => error.code === 'VALIDATION' && /en fazla/.test(error.message));
    await assert.rejects(
      queries.readOnly((tx) => tx.$executeRaw`INSERT INTO "Hotel" ("id", "name", "code", "updatedAt") VALUES (${randomUUID()}, 'x', 'XRO', now())`),
      /read-only transaction/,
    );
    assert.equal(await db.hotel.count({ where: { code: 'XRO' } }), 0);
  });

  it('kapanmış gün özeti: canlıyla aynı rakam; rapor özeti okur; tur eksik günü doldurur, değişeni onarır', async () => {
    const old = await stay({ room: 0, nights: [[-40, '1100'], [-39, '1100']], source: 'OTA' });
    await post(old, { offset: -40, net: '1000', tax: '100' });
    await post(old, { offset: -39, net: '1000', tax: '100' });
    await post(old, { offset: -39, source: 'LATE_CHECK_OUT', net: '300', tax: '30' });
    const recent = await stay({ room: 1, nights: [[-3, '2200']] });
    await post(recent, { offset: -3, net: '2000', tax: '200' });
    const query = { from: shift(-45), to: shift(-1), groupBy: 'WEEK' };

    const live = await report(query);
    const tour = await stats.refreshHotelStats(hotelId);
    assert.ok(tour.rolling > 0, 'kayan pencere hesaplandı');
    const marked = await db.revenueStatDay.count({ where: { hotelId } });
    assert.ok(marked >= 40 - stats.REPORT_LIVE_DAYS, 'kapanmış günler işaretlendi');
    assert.equal(await db.revenueStatDay.count({ where: { hotelId, day: { gte: dayDate(-stats.REPORT_LIVE_DAYS) } } }), 0, 'son günler özetlenmez');

    service.clearReportCache();
    const fromStats = await report(query);
    assert.deepEqual(fromStats.totals, live.totals, 'özet ile canlı aynı');
    assert.deepEqual(fromStats.buckets, live.buckets);
    assert.deepEqual(fromStats.breakdowns, live.breakdowns);

    // Özeti çıkmış eski güne sonradan kalem işlenirse rapor özeti okur (değişmez) — onarma turu yakalar.
    await post(old, { offset: -40, type: 'DISCOUNT', source: 'MANUAL', net: '-200', tax: '-20' });
    service.clearReportCache();
    assert.equal(live.totals.roomRevenue, '4000.00');
    assert.equal((await report(query)).totals.roomRevenue, '4000.00', 'rapor özetten okudu');
    await stats.rebuildStats(hotelId, shift(-45), shift(-30), { businessDate: B });
    service.clearReportCache();
    assert.equal((await report(query)).totals.roomRevenue, '3800.00', '1000 + 1000 − 200 (eski, onarıldı) + 2000 (son günler canlı)');

    // Özeti silinen gün canlı okunur (rapor her zaman doğru).
    await db.revenueStatDay.deleteMany({ where: { hotelId } });
    await db.revenueDayStat.deleteMany({ where: { hotelId } });
    service.clearReportCache();
    assert.equal((await report(query)).totals.roomRevenue, '3800.00');

    // Kapanmamış güne özet yazılmaz.
    await assert.rejects(stats.rebuildStats(hotelId, shift(-10), shift(-5), { businessDate: B }), /kapanmış/);
  });

  it('MCP araçları: otele bağlı, ekranla aynı rakamlar, hatalı girdi araç hatası', async () => {
    const a = await stay({ room: 0, nights: [[-2, '1100']], source: 'OTA' });
    await post(a, { offset: -2, net: '1000', tax: '100' });
    await stay({ status: 'CONFIRMED', nights: [[-2, '9999']], hotel: otherHotelId });

    const { client, close } = await mcpServer.connectInProcess(mcp.createReportingMcpServer({ hotelId, logger: { error() {} } }));
    try {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((tool) => tool.name).sort(), ['get_forecast', 'get_occupancy', 'get_revenue', 'run_report_query']);
      assert.ok(tools.every((tool) => tool.annotations.readOnlyHint === true));
      assert.ok(!('hotelId' in tools[0].inputSchema.properties), 'otel parametresi yok');

      const occupancy = await client.callTool({ name: 'get_occupancy', arguments: { from: shift(-2), to: shift(-2) } });
      assert.equal(occupancy.structuredContent.totals.sold, 1);
      assert.equal(occupancy.structuredContent.totals.occupancyPct, 10);

      const revenue = await client.callTool({ name: 'run_report_query', arguments: { report: 'revenue_by_source', from: shift(-2), to: shift(-2) } });
      assert.equal(revenue.structuredContent.rows[0].key, 'OTA');
      assert.equal(revenue.structuredContent.rows[0].roomRevenue, '1000.00');

      const bad = await client.callTool({ name: 'get_revenue', arguments: { from: shift(0), to: shift(-5) } });
      assert.equal(bad.isError, true);
      assert.match(bad.content[0].text, /önce olamaz/);
      const unknown = await client.callTool({ name: 'run_report_query', arguments: { report: 'drop_table', from: shift(0), to: shift(0) } });
      assert.equal(unknown.isError, true);
    } finally {
      await close();
    }
  });
});
