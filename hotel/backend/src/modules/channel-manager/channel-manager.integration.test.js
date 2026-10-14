import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Kanal yönetimi (modül 33) — gerçek PostgreSQL gerektirir.
 *
 * Channex, belgelenmiş uçlarını taklit eden bir test sunucusuyla (`globalThis.fetch`)
 * sınanır: mülk, oda tipi / fiyat planı listesi, müsaitlik ve fiyat gönderimi,
 * revizyon akışı ve teyit, webhook. iCal takvimi okuma da sahte `fetch` ve ad
 * çözücüyle sınanır.
 *
 * Sınanan: kanal açma (bağlantı denetimi, sırrın dönmemesi), eşleştirme ve senkrona
 * alma eksikleri, tam eşitleme (iki çağrı, fiyat farkı), fark gönderimi (rezervasyon,
 * stop-sale, taban fiyat), hata / hız sınırı / anahtar hatası, aktör kapalıyken,
 * OTA rezervasyonu (açma, OTA tutarı, pansiyon, overbooking uyarısı, değişiklik,
 * eski revizyon, iptal, eşleşmeyen plan, para birimi farkı), webhook sırrı, iCal
 * dışa ve içe aktarma (iptal, boş takvim koruması, özel ağ), izinler.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'mudur@test.local';
const DESK = 'resepsiyon@test.local';
const ACCOUNTING = 'muhasebe@test.local';
const PROPERTY = '3f2a9c1e-8b4d-4e7a-9f10-2c5d6e7f8a9b';
const API_KEY = 'channex-test-anahtari-1234567890';
const CHANNEX = 'https://staging.channex.io/api/v1';

/**
 * Channex'in belgelenmiş uçlarını taklit eden test sunucusu.
 * `failures`: sıradaki çağrılara dönecek hata durumları (ör. [500]).
 */
function fakeChannex() {
  const state = {
    currency: 'TRY',
    calls: [],
    failures: [],
    feed: [],
    acked: [],
    webhooks: [],
    roomTypes: [
      { id: 'cx-rt-std', title: 'Standard Double', property_id: PROPERTY, default_occupancy: 3 },
      { id: 'cx-rt-dlx', title: 'Deluxe Sea', property_id: PROPERTY, default_occupancy: 3 },
    ],
    ratePlans: [
      { id: 'cx-rp-std-bar', title: 'BAR', room_type_id: 'cx-rt-std', property_id: PROPERTY, sell_mode: 'per_room' },
      { id: 'cx-rp-std-bb', title: 'Bed & Breakfast', room_type_id: 'cx-rt-std', property_id: PROPERTY, sell_mode: 'per_room' },
      { id: 'cx-rp-dlx-bb', title: 'Bed & Breakfast', room_type_id: 'cx-rt-dlx', property_id: PROPERTY, sell_mode: 'per_room' },
    ],
  };
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: new Map(), text: async () => JSON.stringify(body) });
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    const path = url.pathname.replace('/api/v1', '');
    state.calls.push({ method, path, query: Object.fromEntries(url.searchParams), body, key: init.headers?.['user-api-key'] });
    if (init.headers?.['user-api-key'] !== API_KEY) return json(401, { errors: { code: 'unauthorized', title: 'Unauthorized' } });
    const failure = state.failures.shift();
    if (failure) return json(failure, { errors: { code: 'error', title: `HTTP ${failure}` } });
    if (method === 'GET' && path === `/properties/${PROPERTY}`) return json(200, { data: { id: PROPERTY, attributes: { title: 'Deniz Otel', currency: state.currency, timezone: ZONE } } });
    if (method === 'GET' && path.startsWith('/properties/')) return json(404, { errors: { code: 'not_found', title: 'Not Found' } });
    if (method === 'GET' && path === '/room_types/options') return json(200, { data: state.roomTypes.map((row) => ({ id: row.id, type: 'room_type', attributes: row })) });
    if (method === 'GET' && path === '/rate_plans/options') return json(200, { data: state.ratePlans.map((row) => ({ id: row.id, type: 'rate_plan', attributes: row })) });
    if (method === 'POST' && (path === '/availability' || path === '/restrictions')) return json(200, { data: [{ id: randomUUID(), type: 'task' }], meta: { message: 'Success', warnings: [] } });
    if (method === 'GET' && path === '/booking_revisions/feed') {
      const pending = state.feed.filter((row) => !state.acked.includes(row.id));
      return json(200, { data: pending.map((row) => ({ id: row.id, type: 'booking_revision', attributes: row })), meta: { total: pending.length, page: 1, limit: 100 } });
    }
    const ack = /^\/booking_revisions\/([^/]+)\/ack$/.exec(path);
    if (method === 'POST' && ack) {
      state.acked.push(ack[1]);
      return json(200, { meta: { message: 'Success' } });
    }
    if (method === 'POST' && path === '/webhooks') {
      const id = randomUUID();
      state.webhooks.push({ id, ...body.webhook });
      return json(201, { data: { id, type: 'webhook' } });
    }
    if (method === 'DELETE' && path.startsWith('/webhooks/')) return json(200, { meta: { message: 'Success' } });
    return json(404, { errors: { code: 'not_found', title: `Bilinmeyen uç ${method} ${path}` } });
  };
  return { state, fetchImpl, ari: (path) => state.calls.filter((call) => call.method === 'POST' && call.path === path) };
}

describe('kanal yönetimi (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let service;
  /** @type {any} */ let sync;
  /** @type {any} */ let bookings;
  /** @type {any} */ let ical;
  /** @type {any} */ let reservations;
  /** @type {any} */ let settings;
  /** @type {any} */ let actors;
  /** @type {any} */ let cache;
  /** @type {any} */ let worker;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  /** @type {ReturnType<typeof fakeChannex>} */ let channex;
  let originalFetch;
  let hotelId;
  /** @type {Record<string, any>} */ let types;
  /** @type {Map<string, string>} */ let tokens;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    process.env.SETTINGS_SECRET_KEY = randomBytes(32).toString('base64');
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    worker = await import('@hotelos/channel-sync-worker');
    service = await import('./service.js');
    sync = await import('./sync.js');
    bookings = await import('./bookings.js');
    ical = await import('./ical.js');
    reservations = await import('../reservations/service.js');
    settings = await import('../settings/service.js');
    actors = await import('../actors/service.js');
    cache = await import('../../lib/cache.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
    originalFetch = globalThis.fetch;
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    await app?.close();
    await db?.$disconnect();
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const manager = (fn) => as(MANAGER, fn);
  const desk = (fn) => as(DESK, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const D = (offset) => core.toIsoDay(core.addDays(today(), offset));
  const date = (offset) => new Date(D(offset));
  const later = (seconds) => new Date(Date.now() + seconds * 1000);

  beforeEach(async () => {
    await resetDatabase(db);
    reservations.clearReservationCache();
    cache.cache.invalidatePrefix('settings:');
    ical.forgetIcalExports();
    channex = fakeChannex();
    globalThis.fetch = channex.fetchImpl;
    tokens = new Map();
    ticks = 0;
    const hotel = await db.hotel.create({
      data: { name: 'Deniz Otel', code: `C${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY', defaultBoardType: 'RO' },
    });
    hotelId = hotel.id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: DESK, name: 'Resepsiyon', role: 'FRONT_DESK', passwordHash },
        { hotelId, email: ACCOUNTING, name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
      ],
    });
    const type = (code, basePrice) => db.roomType.create({ data: { hotelId, code, name: `${code} oda`, basePrice, capacityAdults: 3, capacityChildren: 1 } });
    types = { std: await type('STD', '1000'), dlx: await type('DLX', '2000') };
    for (const number of ['101', '102', '103']) await db.room.create({ data: { hotelId, number, roomTypeId: types.std.id } });
    await db.room.create({ data: { hotelId, number: '201', roomTypeId: types.dlx.id } });
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });

  /* ── Kurulum yardımcıları ── */

  const createChannex = (overrides = {}) =>
    manager(() =>
      service.createChannel(
        hotelId,
        contracts.createChannelSchema.parse({ type: 'CHANNEX', name: 'Channex', environment: 'STAGING', propertyId: PROPERTY, apiKey: API_KEY, priceMarkupPercent: '15', ...overrides }),
      ),
    );
  const mapChannex = (channel) =>
    manager(() =>
      service.saveChannelMappings(
        hotelId,
        channel.id,
        contracts.saveChannelMappingsSchema.parse({
          expectedUpdatedAt: channel.updatedAt,
          rooms: [
            {
              roomTypeId: types.std.id,
              externalRoomTypeId: 'cx-rt-std',
              externalName: 'Standard Double',
              rates: [
                { externalRatePlanId: 'cx-rp-std-bar', externalName: 'BAR', boardType: 'RO' },
                { externalRatePlanId: 'cx-rp-std-bb', externalName: 'B&B', boardType: 'BB' },
              ],
            },
            { roomTypeId: types.dlx.id, externalRoomTypeId: 'cx-rt-dlx', externalName: 'Deluxe Sea', rates: [{ externalRatePlanId: 'cx-rp-dlx-bb', boardType: 'BB' }] },
          ],
        }),
      ),
    );
  const activate = (channel) => manager(() => service.setChannelStatus(hotelId, channel.id, { expectedUpdatedAt: new Date(channel.updatedAt), status: 'ACTIVE' }));
  /** Senkrondaki, eşleşmiş ve ilk tam eşitlemesi yapılmış Channex kanalı. */
  const liveChannex = async () => {
    const channel = await activate(await mapChannex(await createChannex()));
    await sync.runChannexSyncTick();
    channex.state.calls.length = 0;
    return channel;
  };
  /** Fark gönderiminin en kısa aralığını beklemeden bir tur (her tur bir aralık ileride). */
  let ticks = 0;
  const tick = () => {
    ticks += 1;
    return sync.runChannexSyncTick({ now: later((sync.MIN_DELTA_INTERVAL_MS / 1000 + 1) * ticks) });
  };
  const stateOf = (channelId) => db.channelState.findUnique({ where: { channelId } });
  /**
   * Arka planda başlatılan akış okumasının (webhook, elle senkron) bitmesini bekler:
   * okuma sonunda kanalın "son okuma" zamanı yazılır. Bitmeden sonraki testin veritabanı
   * temizliği başlarsa kilitler çakışır.
   */
  const pollFinished = async (channelId, since) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = await stateOf(channelId);
      if (state?.lastBookingPollAt && state.lastBookingPollAt >= since) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('akış okuması bitmedi');
  };
  const book = async (overrides = {}) =>
    (
      await desk(() =>
        reservations.createReservation(hotelId, {
          guestId: null,
          guest: { firstName: 'Ayşe', lastName: 'Yılmaz', phone: `+90532${String(Math.random()).slice(2, 9)}`, email: null, nationality: 'TR' },
          forceNewGuest: true,
          roomTypeId: types.std.id,
          adults: 2,
          children: 0,
          boardType: 'BB',
          checkIn: date(10),
          checkOut: date(12),
          status: 'CONFIRMED',
          source: 'UI',
          notes: null,
          requestId: randomUUID(),
          waitlistId: null,
          roomId: null,
          manualTotal: null,
          priceNote: null,
          agencyId: null,
          couponCode: null,
          ...overrides,
        }),
      )
    ).reservation;

  /** Channex revizyonu (belgedeki biçim). */
  const revision = (overrides = {}) => ({
    id: randomUUID(),
    booking_id: 'BOOK-1',
    status: 'new',
    ota_name: 'Booking.com',
    ota_reservation_code: '4455667788',
    inserted_at: new Date().toISOString().replace('Z', ''),
    arrival_date: D(20),
    departure_date: D(23),
    amount: '3600.00',
    currency: 'TRY',
    payment_collect: 'ota',
    customer: { name: 'Jane', surname: 'Doe', mail: 'jane@example.com', phone: '+31612345678', country: 'NL' },
    rooms: [
      { room_type_id: 'cx-rt-std', rate_plan_id: 'cx-rp-std-bb', checkin_date: D(20), checkout_date: D(23), amount: '3600.00', occupancy: { adults: 2, children: 0, infants: 0 } },
    ],
    ...overrides,
  });
  const receive = async (channel, ...revisions) => {
    channex.state.feed.push(...revisions);
    return bookings.pollChannexBookings(channel.id);
  };
  const otaReservations = (channelId) =>
    db.reservation.findMany({ where: { hotelId, channelBooking: { channelId } }, include: { nights: true }, orderBy: [{ channelRoomIndex: 'asc' }, { createdAt: 'asc' }] });

  /* ══════════════════ Kanal ve bağlantı ══════════════════ */

  describe('kanal açma ve bağlantı', () => {
    it('Channex bağlantısı denetlenir; mülkün adı ve para birimi okunur; anahtar hiçbir cevapta dönmez', async () => {
      const channel = await createChannex();
      assert.equal(channel.status, 'DRAFT');
      assert.equal(channel.externalName, 'Deniz Otel');
      assert.equal(channel.externalCurrency, 'TRY');
      assert.equal(channel.hasApiKey, true);
      assert.equal(channel.priceMarkupPercent, '15.00');
      assert.equal(channel.horizonDays, contracts.CHANNEX_HORIZON_DAYS);
      const response = await call('GET', `/channel-manager/${channel.id}`, MANAGER);
      assert.equal(response.statusCode, 200);
      assert.ok(!response.body.includes(API_KEY), 'API anahtarı cevapta yok');
      const stored = await db.channel.findUnique({ where: { id: channel.id } });
      assert.ok(!stored.apiKey.includes(API_KEY) && stored.apiKey.startsWith('v1:'), 'veritabanında şifreli');
    });

    it('yanlış anahtar ve yanlış mülk alanıyla reddedilir; aynı ad ve aynı mülk ikinci kez bağlanmaz', async () => {
      await assert.rejects(createChannex({ apiKey: 'yanlis-anahtar-1234567890' }), (error) => Boolean(error.fields?.apiKey));
      await assert.rejects(createChannex({ propertyId: randomUUID() }), (error) => Boolean(error.fields?.propertyId));
      await createChannex();
      await assert.rejects(createChannex(), (error) => error.code === 'DUPLICATE');
      await assert.rejects(createChannex({ name: 'Channex 2' }), /başka bir kanala bağlı/);
    });

    it('senkrona alma eksikleri: eşleşme yok, fiyat planı yok, para birimi farklı', async () => {
      const channel = await createChannex();
      await assert.rejects(activate(channel), (error) => error.code === 'CHANNEL_NOT_READY' && /En az bir oda tipi/.test(error.message));
      const mapped = await mapChannex(channel);
      assert.deepEqual(mapped.readiness.blockers, []);
      assert.ok(mapped.readiness.warnings.some((warning) => /Webhook kurulmadı/.test(warning)));

      channex.state.currency = 'EUR';
      const reverified = await manager(() =>
        service.updateChannel(hotelId, channel.id, contracts.updateChannelSchema.parse({ expectedUpdatedAt: mapped.updatedAt, name: 'Channex', horizonDays: 500, apiKey: API_KEY })),
      );
      assert.ok(reverified.readiness.blockers.some((blocker) => /para birimi \(EUR\)/.test(blocker)));
      await assert.rejects(activate(reverified), (error) => error.code === 'CHANNEL_NOT_READY');
    });

    it('eşleştirme kaydı sürümü ilerletir; aynı kanal fiyat planı iki satırda eşleşemez', async () => {
      const channel = await createChannex();
      await mapChannex(channel);
      await assert.rejects(mapChannex(channel), (error) => error.code === 'STALE_WRITE');
      assert.throws(
        () =>
          contracts.saveChannelMappingsSchema.parse({
            expectedUpdatedAt: channel.updatedAt,
            rooms: [
              { roomTypeId: types.std.id, externalRoomTypeId: 'a', rates: [{ externalRatePlanId: 'p', boardType: 'RO' }] },
              { roomTypeId: types.dlx.id, externalRoomTypeId: 'b', rates: [{ externalRatePlanId: 'p', boardType: 'BB' }] },
            ],
          }),
        /başka bir satırda da eşleşmiş/,
      );
    });

    it('kanala eşleşmiş oda tipi silinmez', async () => {
      await mapChannex(await createChannex());
      await assert.rejects(manager(() => settings.deleteRoomType(hotelId, types.dlx.id)), (error) => error.details?.usage?.kanalEslesmesi === 1);
    });
  });

  /* ══════════════════ Gönderim ══════════════════ */

  describe('gönderim', () => {
    it('senkrona alınınca tam eşitleme: iki çağrı, 500 gün, fiyat farkıyla; ikinci turda bir şey gitmez', async () => {
      const channel = await activate(await mapChannex(await createChannex()));
      await sync.runChannexSyncTick();
      const [availability] = channex.ari('/availability');
      const [restrictions] = channex.ari('/restrictions');
      assert.equal(channex.ari('/availability').length, 1);
      assert.equal(channex.ari('/restrictions').length, 1);
      const std = availability.body.values.filter((value) => value.room_type_id === 'cx-rt-std');
      assert.equal(std[0].date_from, D(0));
      assert.equal(std.at(-1).date_to, D(499), '500 gün (bugün dahil)');
      assert.ok(std.every((value) => value.availability === 3));
      const bar = restrictions.body.values.filter((value) => value.rate_plan_id === 'cx-rp-std-bar');
      assert.deepEqual([bar[0].rate, bar[0].stop_sell], ['1150.00', false], '1000 + %15');
      assert.ok(restrictions.body.values.some((value) => value.rate_plan_id === 'cx-rp-dlx-bb' && value.rate === '2300.00'));

      const log = await db.channelSyncLog.findFirst({ where: { channelId: channel.id, kind: 'FULL' } });
      assert.equal(log.status, 'SUCCESS');
      assert.equal(log.externalIds.length, 2, 'Channex görev kimlikleri');
      assert.equal((await stateOf(channel.id)).fullSyncRequestedAt, null);

      channex.state.calls.length = 0;
      await tick();
      assert.equal(channex.state.calls.length, 0, 'değişiklik yoksa çağrı yok');
    });

    it('rezervasyon yalnızca değişen günlerin müsaitliğini gönderir (fiyat gitmez)', async () => {
      const channel = await liveChannex();
      await book({ checkIn: date(10), checkOut: date(12) });
      const state = await stateOf(channel.id);
      assert.equal(core.toIsoDay(state.dirtyFrom), D(10));
      assert.equal(core.toIsoDay(state.dirtyTo), D(11));
      await tick();
      const calls = channex.ari('/availability');
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].body.values, [{ property_id: PROPERTY, room_type_id: 'cx-rt-std', date_from: D(10), date_to: D(11), availability: 2 }]);
      assert.equal(channex.ari('/restrictions').length, 0);
      assert.equal((await stateOf(channel.id)).dirtyFrom, null);
      const log = await db.channelSyncLog.findFirst({ where: { channelId: channel.id, kind: 'DELTA' } });
      assert.match(log.summary, /müsaitlik: 1 oda tipi, 2 gün/);
    });

    it('stop-sale yalnızca o tipin fiyat planlarına "satışa kapalı" gider; kaldırılınca açılır', async () => {
      const channel = await liveChannex();
      const withSale = await manager(() =>
        service.addChannelStopSale(hotelId, channel.id, contracts.addChannelStopSaleSchema.parse({ roomTypeIds: [types.dlx.id], startDate: D(30), endDate: D(32), reason: 'Bakım' })),
      );
      await tick();
      const [restrictions] = channex.ari('/restrictions');
      assert.deepEqual(
        restrictions.body.values.map((value) => [value.rate_plan_id, value.date_from, value.date_to, value.stop_sell]),
        [['cx-rp-dlx-bb', D(30), D(32), true]],
      );
      channex.state.calls.length = 0;
      await manager(() => service.removeChannelStopSale(hotelId, channel.id, withSale.stopSales[0].id));
      await tick();
      assert.equal(channex.ari('/restrictions')[0].body.values[0].stop_sell, false);
    });

    it('taban fiyat değişince (rate.changed) yalnızca fiyat gider', async () => {
      const channel = await liveChannex();
      const type = (await settings.getActiveRoomTypes(hotelId)).find((row) => row.id === types.std.id);
      await manager(() =>
        settings.updateRoomType(hotelId, types.std.id, { expectedUpdatedAt: new Date(type.updatedAt), code: 'STD', name: 'STD oda', basePrice: '1200', capacityAdults: 3, capacityChildren: 1, description: null }),
      );
      cache.cache.invalidatePrefix('settings:');
      await tick();
      assert.equal(channex.ari('/availability').length, 0);
      const values = channex.ari('/restrictions')[0].body.values;
      assert.ok(values.every((value) => value.rate_plan_id.startsWith('cx-rp-std')));
      assert.equal(values[0].rate, '1380.00', '1200 + %15');
      const event = await db.eventLog.findFirst({ where: { hotelId, name: 'rate.changed' } });
      assert.match(event.payload.reason, /Taban fiyat/);
      assert.ok(channel);
    });

    it('geçici hata: pencere geri işaretlenir, kanal bekletilir, sonra gönderilir; art arda hatada uyarı', async () => {
      const channel = await liveChannex();
      await book();
      channex.state.failures.push(500);
      assert.deepEqual(await tick(), [{ channelId: channel.id, outcome: 'FAILED' }]);
      let state = await stateOf(channel.id);
      assert.equal(core.toIsoDay(state.dirtyFrom), D(10), 'gönderilemeyen pencere kaybolmaz');
      assert.ok(state.pausedUntil > new Date());
      assert.equal(state.failureCount, 1);
      assert.equal((await db.channelSyncLog.findFirst({ where: { channelId: channel.id, status: 'FAILED' } })).details.error.status, 500);
      // Bekleme bitmeden gönderilmez.
      assert.deepEqual(await tick(), []);
      // Bekleme bitince gönderilir; hata sayacı sıfırlanır.
      await sync.runChannexSyncTick({ now: new Date(state.pausedUntil.getTime() + 1000) });
      state = await stateOf(channel.id);
      assert.equal(state.failureCount, 0);
      assert.equal(state.dirtyFrom, null);
      assert.equal(state.lastSyncStatus, 'SUCCESS');
    });

    it('hız sınırı (429) bir dakika bekletir; anahtar hatası yöneticiye kritik uyarı', async () => {
      const channel = await liveChannex();
      await book();
      channex.state.failures.push(429);
      await tick();
      const state = await stateOf(channel.id);
      const pause = state.pausedUntil.getTime() - Date.now();
      assert.ok(pause > 40_000 && pause <= 75_000, `yaklaşık bir dakika (${pause} ms)`);

      await db.channelState.update({ where: { channelId: channel.id }, data: { pausedUntil: null } });
      await db.channel.update({ where: { id: channel.id }, data: { apiKey: (await import('../../lib/secret-box.js')).sealSecret('baska-anahtar-123456789') } });
      await tick();
      const alert = await db.staffAlert.findFirst({ where: { hotelId, kind: 'CHANNEL_SYNC' } });
      assert.equal(alert.severity, 'CRITICAL');
      assert.equal(alert.permission, 'channel_manager.manage');
      assert.match(alert.body, /API anahtarını kontrol edin/);
    });

    it('aktör kapalıyken gönderim yok ve görev açılmaz; açılınca tam eşitleme istenir', async () => {
      const channel = await liveChannex();
      await actors.setActorEnabled(hotelId, 'channel-sync-worker', false);
      await book();
      assert.equal((await stateOf(channel.id)).dirtyFrom, null, 'kapalı aktör işaretlemez');
      await tick();
      assert.equal(channex.state.calls.length, 0);
      assert.equal(await db.manualTask.count({ where: { hotelId } }), 0, 'gönderim tetikleyicisi göreve düşmez');
      await actors.setActorEnabled(hotelId, 'channel-sync-worker', true);
      assert.ok((await stateOf(channel.id)).fullSyncRequestedAt, 'açılınca tam eşitleme istendi');
      await sync.runChannexSyncTick();
      assert.equal(channex.ari('/availability')[0].body.values.find((value) => value.date_from <= D(10) && value.date_to >= D(10) && value.room_type_id === 'cx-rt-std').availability, 2);
    });

    it('elle tam eşitleme: hemen istenir; az önce yapıldıysa beklenir', async () => {
      const channel = await liveChannex();
      await assert.rejects(manager(() => service.requestManualSync(hotelId, channel.id)), (error) => error.code === 'SYNC_TOO_SOON');
      await db.channelState.update({ where: { channelId: channel.id }, data: { lastFullSyncAt: new Date(Date.now() - 10 * 60_000) } });
      const requestedAt = new Date();
      const response = await call('POST', `/channel-manager/${channel.id}/sync`, MANAGER);
      assert.equal(response.statusCode, 202, response.body);
      await pollFinished(channel.id, requestedAt);
      const state = await stateOf(channel.id);
      assert.equal(state.fullSyncTrigger, 'MANUAL');
      await sync.runChannexSyncTick();
      const log = await db.channelSyncLog.findFirst({ where: { channelId: channel.id, kind: 'FULL', trigger: 'MANUAL' } });
      assert.equal(log.details.reason, 'Elle istendi');
    });
  });

  /* ══════════════════ OTA rezervasyonu ══════════════════ */

  describe('OTA rezervasyonu', () => {
    it('yeni: onaylı, OTA tutarıyla, fiyat planının pansiyonuyla açılır; revizyon saklanır ve teyit edilir', async () => {
      const channel = await liveChannex();
      const first = revision();
      const result = await receive(channel, first);
      assert.equal(result.received, 1);
      assert.deepEqual(channex.state.acked, [first.id]);
      const [row] = await otaReservations(channel.id);
      assert.equal(row.status, 'CONFIRMED');
      assert.equal(row.source, 'OTA');
      assert.equal(row.boardType, 'BB');
      assert.equal(row.priceMode, 'MANUAL');
      assert.equal(String(row.totalPrice), '3600');
      assert.match(row.priceNote, /Booking\.com tutarı \(4455667788\)/);
      assert.match(row.notes, /Ödemeyi kanal aldı/);
      assert.equal(row.createdBy, 'kanal:Channex');
      const booking = await db.channelBooking.findFirst({ where: { channelId: channel.id } });
      assert.equal(booking.state, 'PROCESSED');
      assert.equal(booking.guestName, 'Jane Doe');
      const guest = await db.guest.findUnique({ where: { id: row.guestId } });
      assert.deepEqual([guest.firstName, guest.lastName, guest.nationality], ['Jane', 'Doe', 'NL']);

      // Aynı revizyon akışta yeniden görünürse ikinci kez açılmaz (yine teyit edilir).
      channex.state.acked.length = 0;
      const again = await bookings.pollChannexBookings(channel.id);
      assert.deepEqual([again.received, again.duplicates], [0, 1]);
      assert.equal((await otaReservations(channel.id)).length, 1);
      // OTA rezervasyonu da müsaitliği değiştirir → kanala fark gider.
      assert.ok((await stateOf(channel.id)).dirtyFrom);
    });

    it('yer yoksa reddedilmez: kapasite aşılarak açılır, resepsiyona kritik uyarı', async () => {
      const channel = await liveChannex();
      await book({ roomTypeId: types.dlx.id, checkIn: date(20), checkOut: date(23) });
      await receive(channel, revision({ rooms: [{ room_type_id: 'cx-rt-dlx', rate_plan_id: 'cx-rp-dlx-bb', checkin_date: D(20), checkout_date: D(23), amount: '7000.00', occupancy: { adults: 2 } }] }));
      const [row] = await otaReservations(channel.id);
      assert.equal(row.roomTypeId, types.dlx.id);
      const alert = await db.staffAlert.findFirst({ where: { hotelId, kind: 'CHANNEL_BOOKING' } });
      assert.equal(alert.severity, 'CRITICAL');
      assert.equal(alert.permission, 'reservations.manage');
      assert.equal(alert.link, `/rezervasyonlar/${row.id}`);
    });

    it('değişiklik: tarih ve tutar güncellenir; eski revizyon yenisinin üstüne yazılmaz', async () => {
      const channel = await liveChannex();
      const created = new Date(Date.now() - 60_000);
      await receive(channel, revision({ inserted_at: created.toISOString().replace('Z', '') }));
      const modified = revision({
        status: 'modified',
        inserted_at: new Date().toISOString().replace('Z', ''),
        departure_date: D(24),
        amount: '4800.00',
        rooms: [{ room_type_id: 'cx-rt-std', rate_plan_id: 'cx-rp-std-bar', checkin_date: D(20), checkout_date: D(24), amount: '4800.00', occupancy: { adults: 2 } }],
      });
      await receive(channel, modified);
      let [row] = await otaReservations(channel.id);
      assert.equal(core.toIsoDay(row.checkOut), D(24));
      assert.equal(String(row.totalPrice), '4800');
      assert.equal(row.boardType, 'RO', 'BAR planı oda + kahvaltısız eşleşmişti');
      assert.equal(row.nights.length, 4);

      // Ağda gecikmiş eski bir revizyon: atlanır.
      const stale = revision({ status: 'modified', inserted_at: new Date(Date.now() - 30_000).toISOString().replace('Z', ''), departure_date: D(22), rooms: [{ room_type_id: 'cx-rt-std', rate_plan_id: 'cx-rp-std-bb', checkin_date: D(20), checkout_date: D(22), amount: '2400.00', occupancy: { adults: 2 } }] });
      await receive(channel, stale);
      [row] = await otaReservations(channel.id);
      assert.equal(core.toIsoDay(row.checkOut), D(24), 'eski revizyon uygulanmadı');
      assert.equal((await db.channelBookingRevision.findFirst({ where: { externalRevisionId: stale.id } })).outcome, 'SUPERSEDED');
    });

    it('iptal: rezervasyon cezasız iptal edilir, iptal eden kanal; kanal rezervasyonu iptal', async () => {
      const channel = await liveChannex();
      await receive(channel, revision());
      await receive(channel, revision({ status: 'cancelled', rooms: [] }));
      const [row] = await otaReservations(channel.id);
      assert.equal(row.status, 'CANCELLED');
      assert.equal(String(row.cancellationFee), '0');
      assert.equal(row.cancelledBy, 'kanal:Channex');
      assert.equal((await db.channelBooking.findFirst({ where: { channelId: channel.id } })).status, 'CANCELLED');
    });

    it('çok odalı rezervasyon: her oda ayrı; odası azalınca fazlası iptal', async () => {
      const channel = await liveChannex();
      const room = (plan, amount) => ({ room_type_id: 'cx-rt-std', rate_plan_id: plan, checkin_date: D(20), checkout_date: D(23), amount, occupancy: { adults: 2 } });
      await receive(channel, revision({ inserted_at: new Date(Date.now() - 60_000).toISOString().replace('Z', ''), rooms: [room('cx-rp-std-bb', '3600.00'), room('cx-rp-std-bar', '3000.00')] }));
      let rows = await otaReservations(channel.id);
      assert.deepEqual(rows.map((row) => [row.channelRoomIndex, row.boardType, String(row.totalPrice)]), [[0, 'BB', '3600'], [1, 'RO', '3000']]);
      await receive(channel, revision({ status: 'modified', rooms: [room('cx-rp-std-bb', '3600.00')] }));
      rows = await otaReservations(channel.id);
      assert.deepEqual(rows.map((row) => [row.channelRoomIndex, row.status]), [[0, 'CONFIRMED'], [1, 'CANCELLED']]);
    });

    it('eşleşmeyen fiyat planı: elle işlenmeli, resepsiyona görev; müdür notla kapatır', async () => {
      const channel = await liveChannex();
      await receive(channel, revision({ rooms: [{ room_type_id: 'cx-rt-x', rate_plan_id: 'cx-rp-x', checkin_date: D(20), checkout_date: D(23), amount: '100', occupancy: { adults: 1 } }] }));
      const booking = await db.channelBooking.findFirst({ where: { channelId: channel.id } });
      assert.equal(booking.state, 'ATTENTION');
      assert.match(booking.stateReason, /eşleşmemiş/);
      const task = await db.manualTask.findFirst({ where: { hotelId } });
      assert.equal(task.module, 'Kanal rezervasyonu');
      assert.match(task.description, /Booking\.com 4455667788 · Jane Doe/);
      assert.equal((await otaReservations(channel.id)).length, 0);

      const denied = await call('POST', `/channel-manager/${channel.id}/bookings/${booking.id}/resolve`, DESK, { note: 'Elle açıldı' });
      assert.equal(denied.statusCode, 403);
      const resolved = await call('POST', `/channel-manager/${channel.id}/bookings/${booking.id}/resolve`, MANAGER, { note: 'Rezervasyon elle açıldı: ABC123' });
      assert.equal(resolved.statusCode, 200, resolved.body);
      const after = await db.channelBooking.findUnique({ where: { id: booking.id } });
      assert.deepEqual([after.state, after.resolvedBy, after.resolutionNote], ['PROCESSED', MANAGER, 'Rezervasyon elle açıldı: ABC123']);
    });

    it('para birimi farklıysa sistem fiyatı ve "doğrulanmalı"', async () => {
      const channel = await liveChannex();
      await receive(channel, revision({ currency: 'EUR', amount: '100.00', rooms: [{ room_type_id: 'cx-rt-std', rate_plan_id: 'cx-rp-std-bb', checkin_date: D(20), checkout_date: D(22), amount: '100.00', occupancy: { adults: 2 } }] }));
      const [row] = await otaReservations(channel.id);
      assert.equal(row.priceMode, 'CALCULATED');
      assert.equal(String(row.totalPrice), '2000');
      const booking = await db.channelBooking.findFirst({ where: { channelId: channel.id } });
      assert.equal(booking.state, 'REVIEW');
      assert.match(booking.stateReason, /100\.00 EUR/);
    });

    it('aktör kapalıyken gelen rezervasyon: görev açılır, kanal kaydı "elle işlenmeli" olur', async () => {
      const channel = await liveChannex();
      await actors.setActorEnabled(hotelId, 'channel-sync-worker', false);
      await receive(channel, revision());
      assert.equal((await otaReservations(channel.id)).length, 0);
      const booking = await db.channelBooking.findFirst({ where: { channelId: channel.id } });
      assert.equal(booking.state, 'ATTENTION');
      assert.match(booking.stateReason, /Aktör kapalı/);
      assert.equal(await db.manualTask.count({ where: { hotelId, module: 'Kanal rezervasyonu' } }), 1);
      assert.deepEqual(channex.state.acked.length, 1, 'yine de teyit edildi (kayıt bizde)');
    });

    it('içerideki misafirin değişikliği / iptali elle işlenir', async () => {
      const channel = await liveChannex();
      await receive(channel, revision({ inserted_at: new Date(Date.now() - 60_000).toISOString().replace('Z', '') }));
      const [row] = await otaReservations(channel.id);
      await db.reservation.update({ where: { id: row.id }, data: { status: 'CHECKED_IN', checkedInAt: new Date() } });
      await receive(channel, revision({ status: 'cancelled', rooms: [] }));
      const booking = await db.channelBooking.findFirst({ where: { channelId: channel.id } });
      assert.equal(booking.state, 'ATTENTION');
      assert.match(booking.stateReason, /misafir içeride/);
      assert.equal((await db.reservation.findUnique({ where: { id: row.id } })).status, 'CHECKED_IN');
    });
  });

  /* ══════════════════ Webhook ══════════════════ */

  describe('webhook', () => {
    it('kurulum sırrı başlıkta gönderir; yanlış sır 401, doğru sır akışı okutur', async () => {
      const channel = await liveChannex();
      const card = await service.getChannel(hotelId, channel.id);
      const set = await call('POST', `/channel-manager/${channel.id}/webhook`, MANAGER, { expectedUpdatedAt: card.updatedAt, callbackBaseUrl: 'https://otel.example.com/api' });
      assert.equal(set.statusCode, 200, set.body);
      const [hook] = channex.state.webhooks;
      assert.equal(hook.callback_url, `https://otel.example.com/api/webhooks/channex/${channel.id}`);
      assert.equal(hook.event_mask, 'booking');
      const secret = hook.headers[worker.CHANNEX_WEBHOOK_SECRET_HEADER];
      assert.ok(secret.length >= 30);
      assert.ok(!set.body.includes(secret), 'sır cevapta yok');

      const wrong = await app.inject({ method: 'POST', url: `/webhooks/channex/${channel.id}`, headers: { [worker.CHANNEX_WEBHOOK_SECRET_HEADER]: 'yanlis' }, payload: { event: 'booking' } });
      assert.equal(wrong.statusCode, 401);
      channex.state.feed.push(revision());
      const notifiedAt = new Date();
      const right = await app.inject({ method: 'POST', url: `/webhooks/channex/${channel.id}`, headers: { [worker.CHANNEX_WEBHOOK_SECRET_HEADER]: secret }, payload: { event: 'booking' } });
      assert.equal(right.statusCode, 200);
      await pollFinished(channel.id, notifiedAt);
      assert.equal(await db.channelBooking.count({ where: { channelId: channel.id } }), 1);
      assert.equal((await db.channelSyncLog.findFirst({ where: { channelId: channel.id, kind: 'BOOKINGS' } })).trigger, 'WEBHOOK');
    });
  });

  /* ══════════════════ iCal ══════════════════ */

  describe('iCal', () => {
    const publicResolve = async () => [{ address: '93.184.216.34' }];
    const calendar = (...events) =>
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        ...events.flatMap((event) => [
          'BEGIN:VEVENT',
          `UID:${event.uid}`,
          `DTSTART;VALUE=DATE:${event.start.replace(/-/g, '')}`,
          `DTEND;VALUE=DATE:${event.end.replace(/-/g, '')}`,
          `SUMMARY:${event.summary ?? 'Reserved'}`,
          'DESCRIPTION:https://www.airbnb.com/hosting/reservations/details/HMTEST123',
          'END:VEVENT',
        ]),
        'END:VCALENDAR',
      ].join('\r\n');
    const calendarFetch = (text) => async () => ({ ok: true, status: 200, headers: new Map(), text: async () => text });
    const liveIcal = async (importUrl = 'https://www.airbnb.com/calendar/ical/1.ics?s=gizli') => {
      const channel = await manager(() => service.createChannel(hotelId, contracts.createChannelSchema.parse({ type: 'ICAL', name: 'Airbnb', provider: 'AIRBNB' })));
      const mapped = await manager(() =>
        service.saveChannelMappings(hotelId, channel.id, contracts.saveChannelMappingsSchema.parse({ expectedUpdatedAt: channel.updatedAt, rooms: [{ roomTypeId: types.dlx.id, icalImportUrl: importUrl }] })),
      );
      return activate(mapped);
    };

    it('dışa aktarma: dolu ve stop-sale günleri; senkronda değilse ya da belirteç yanlışsa yok', async () => {
      const channel = await liveIcal();
      await book({ roomTypeId: types.dlx.id, checkIn: date(5), checkOut: date(8) });
      ical.forgetIcalExports();
      const path = channel.rooms[0].exportPath;
      assert.match(path, /^\/channel-ical\/[A-Za-z0-9_-]+\.ics$/);
      const response = await app.inject({ method: 'GET', url: path });
      assert.equal(response.statusCode, 200);
      assert.match(response.headers['content-type'], /text\/calendar/);
      const { events } = worker.parseIcal(response.body);
      assert.deepEqual(events.map((event) => [event.start, event.end]), [[D(5), D(8)]]);
      assert.ok(events.every((event) => worker.classifyIcalEvent(event, 'AIRBNB') === 'OURS'));
      assert.ok((await db.channelRoomMapping.findFirst({ where: { channelId: channel.id } })).lastExportAt);

      // Stop-sale takvimde dolu görünür; iCal'e gönderim olmadığı için "gönderilecek değişiklik" işaretlenmez.
      const withSale = await manager(() =>
        service.addChannelStopSale(hotelId, channel.id, contracts.addChannelStopSaleSchema.parse({ roomTypeIds: [], startDate: D(20), endDate: D(21) })),
      );
      assert.equal(withSale.sync.pending, false);
      assert.equal((await stateOf(channel.id)).dirtyFrom, null);
      const closed = worker.parseIcal((await app.inject({ method: 'GET', url: path })).body).events.map((event) => [event.start, event.end]);
      assert.deepEqual(closed, [[D(5), D(8)], [D(20), D(22)]]);

      const paused = await manager(() => service.setChannelStatus(hotelId, channel.id, { expectedUpdatedAt: new Date(withSale.updatedAt), status: 'PAUSED' }));
      assert.equal((await app.inject({ method: 'GET', url: path })).statusCode, 404);
      assert.equal((await app.inject({ method: 'GET', url: '/channel-ical/olmayan-belirtec-1234567890.ics' })).statusCode, 404);
      assert.ok(paused);
    });

    it('içe aktarma: kayıt rezervasyon açar (doğrulanmalı), kapatma açmaz, takvimden kalkan iptal edilir', async () => {
      const channel = await liveIcal();
      const reserved = { uid: 'r1@airbnb.com', start: D(15), end: D(18) };
      const closed = { uid: 'c1@airbnb.com', start: D(40), end: D(42), summary: 'Airbnb (Not available)' };
      await ical.importIcalChannel(channel.id, { fetchImpl: calendarFetch(calendar(reserved, closed)), resolve: publicResolve });
      let [row] = await otaReservations(channel.id);
      assert.equal((await otaReservations(channel.id)).length, 1, 'kapatma rezervasyon açmaz');
      assert.equal(row.status, 'CONFIRMED');
      assert.equal(row.roomTypeId, types.dlx.id);
      assert.equal(row.priceMode, 'CALCULATED');
      const booking = await db.channelBooking.findFirst({ where: { channelId: channel.id } });
      assert.equal(booking.state, 'REVIEW');
      assert.equal(booking.externalCode, 'HMTEST123');
      const guest = await db.guest.findUnique({ where: { id: row.guestId } });
      assert.deepEqual([guest.firstName, guest.lastName], ['Airbnb', 'misafiri HMTEST123']);

      // Aynı takvim yeniden okunursa bir şey değişmez.
      const again = await ical.importIcalChannel(channel.id, { fetchImpl: calendarFetch(calendar(reserved, closed)), resolve: publicResolve });
      assert.equal(again.changes, 0);

      // Tarih değişti → güncellenir.
      await ical.importIcalChannel(channel.id, { fetchImpl: calendarFetch(calendar({ ...reserved, end: D(19) }, closed)), resolve: publicResolve });
      [row] = await otaReservations(channel.id);
      assert.equal(core.toIsoDay(row.checkOut), D(19));

      // Takvimden kalktı (başka kayıt kaldı) → iptal.
      await ical.importIcalChannel(channel.id, { fetchImpl: calendarFetch(calendar(closed)), resolve: publicResolve });
      [row] = await otaReservations(channel.id);
      assert.equal(row.status, 'CANCELLED');
      assert.match(row.cancelReason, /Kanal iptali/);

      // Aynı kayıt aynı tarihlerle takvimde yeniden göründü → yeniden açılır.
      await ical.importIcalChannel(channel.id, { fetchImpl: calendarFetch(calendar({ ...reserved, end: D(19) }, closed)), resolve: publicResolve });
      const rows = await otaReservations(channel.id);
      assert.deepEqual(rows.map((entry) => entry.status), ['CANCELLED', 'CONFIRMED']);
      assert.equal((await db.channelBooking.findFirst({ where: { channelId: channel.id } })).status, 'ACTIVE');
    });

    it('takvim birden boş gelirse toplu iptal yapılmaz, uyarı düşer', async () => {
      const channel = await liveIcal();
      const events = [
        { uid: 'a@airbnb.com', start: D(15), end: D(17) },
        { uid: 'b@airbnb.com', start: D(20), end: D(22) },
      ];
      await ical.importIcalChannel(channel.id, { fetchImpl: calendarFetch(calendar(...events)), resolve: publicResolve });
      assert.equal((await otaReservations(channel.id)).length, 2);
      await ical.importIcalChannel(channel.id, { fetchImpl: calendarFetch(calendar()), resolve: publicResolve });
      assert.ok((await otaReservations(channel.id)).every((row) => row.status === 'CONFIRMED'), 'iptal edilmedi');
      const log = await db.channelSyncLog.findFirst({ where: { channelId: channel.id, kind: 'ICAL_IMPORT' }, orderBy: { createdAt: 'desc' } });
      assert.equal(log.status, 'PARTIAL');
      assert.ok(await db.staffAlert.findFirst({ where: { hotelId, kind: 'CHANNEL_SYNC', title: { contains: 'takvim boş geldi' } } }));
    });

    it('özel ağa çözülen adres okunmaz; hata eşleşmeye ve loga yazılır', async () => {
      const channel = await liveIcal();
      let fetched = false;
      await ical.importIcalChannel(channel.id, {
        fetchImpl: async () => {
          fetched = true;
          throw new Error('çağrılmamalı');
        },
        resolve: async () => [{ address: '10.0.0.5' }],
      });
      assert.equal(fetched, false);
      const mapping = await db.channelRoomMapping.findFirst({ where: { channelId: channel.id } });
      assert.match(mapping.lastImportError, /özel ağa/);
      assert.equal((await db.channelSyncLog.findFirst({ where: { channelId: channel.id, kind: 'ICAL_IMPORT' } })).status, 'FAILED');
      assert.equal(ical.isPrivateAddress('::ffff:127.0.0.1'), true);
      assert.equal(ical.isPrivateAddress('172.20.1.1'), true);
      assert.equal(ical.isPrivateAddress('8.8.8.8'), false);
    });

    it('takvimden gelmiş geçerli rezervasyonu olan eşleşme kaldırılamaz', async () => {
      const channel = await liveIcal();
      await ical.importIcalChannel(channel.id, { fetchImpl: calendarFetch(calendar({ uid: 'a@airbnb.com', start: D(15), end: D(17) })), resolve: publicResolve });
      const card = await service.getChannel(hotelId, channel.id);
      await assert.rejects(
        manager(() => service.saveChannelMappings(hotelId, channel.id, { expectedUpdatedAt: new Date(card.updatedAt), rooms: [] })),
        (error) => error.code === 'MAPPING_IN_USE',
      );
    });
  });

  /* ══════════════════ İzinler ve listeler ══════════════════ */

  describe('izinler ve listeler', () => {
    it('kanal ekranı müdürün; resepsiyon ve muhasebe göremez', async () => {
      await createChannex();
      assert.equal((await call('GET', '/channel-manager', MANAGER)).statusCode, 200);
      assert.equal((await call('GET', '/channel-manager', DESK)).statusCode, 403);
      assert.equal((await call('GET', '/channel-manager', ACCOUNTING)).statusCode, 403);
      const created = await call('POST', '/channel-manager', DESK, { type: 'ICAL', name: 'Airbnb', provider: 'AIRBNB' });
      assert.equal(created.statusCode, 403);
    });

    it('liste: eşleşme ve dikkat sayıları; log ve kanal rezervasyonları sayfalı, süzgeçli', async () => {
      const channel = await liveChannex();
      await receive(channel, revision(), revision({ booking_id: 'BOOK-2', ota_reservation_code: '999', rooms: [{ room_type_id: 'x', rate_plan_id: 'y', checkin_date: D(30), checkout_date: D(31), amount: '10', occupancy: { adults: 1 } }] }));
      const list = (await call('GET', '/channel-manager?page=1&pageSize=10', MANAGER)).json().data;
      assert.equal(list.items[0].mappedRoomTypes, 2);
      assert.deepEqual(list.items[0].bookings, { attention: 1, review: 0 });

      const attention = (await call('GET', `/channel-manager/${channel.id}/bookings?state=ATTENTION`, MANAGER)).json().data;
      assert.equal(attention.meta.total, 1);
      assert.equal(attention.items[0].externalCode, '999');
      const search = (await call('GET', `/channel-manager/${channel.id}/bookings?search=4455`, MANAGER)).json().data;
      assert.equal(search.meta.total, 1);
      assert.equal(search.items[0].reservations.length, 1);

      const logs = (await call('GET', `/channel-manager/${channel.id}/logs?kind=BOOKINGS&pageSize=5`, MANAGER)).json().data;
      assert.equal(logs.items[0].kind, 'BOOKINGS');
      const detail = (await call('GET', `/channel-manager/${channel.id}/logs/${logs.items[0].id}`, MANAGER)).json().data;
      assert.deepEqual(detail.details.counts, { NEW: 2, MODIFIED: 0, CANCELLED: 0 });
      const bad = await call('GET', `/channel-manager/${channel.id}/logs?from=${D(5)}&to=${D(1)}`, MANAGER);
      assert.equal(bad.statusCode, 400);
    });

    it('kanal silme: senkrondayken reddedilir, durdurulunca yumuşak silinir (rezervasyon bağları kalır)', async () => {
      const channel = await liveChannex();
      await receive(channel, revision());
      let card = await service.getChannel(hotelId, channel.id);
      await assert.rejects(manager(() => service.deleteChannel(hotelId, channel.id, { expectedUpdatedAt: new Date(card.updatedAt) })), (error) => error.code === 'CHANNEL_ACTIVE');
      card = await manager(() => service.setChannelStatus(hotelId, channel.id, { expectedUpdatedAt: new Date(card.updatedAt), status: 'PAUSED' }));
      await manager(() => service.deleteChannel(hotelId, channel.id, { expectedUpdatedAt: new Date(card.updatedAt) }));
      assert.equal((await call('GET', `/channel-manager/${channel.id}`, MANAGER)).statusCode, 404);
      const [row] = await otaReservations(channel.id);
      const detail = await reservations.getReservation(hotelId, row.id);
      assert.equal(detail.channel.channelName, 'Channex');
      assert.equal(detail.channel.externalCode, '4455667788');
    });
  });
});
