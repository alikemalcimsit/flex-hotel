import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Online rezervasyon motoru (modül 32) entegrasyon testleri: anahtar + origin
 * kapısı, kırpılmış teklif (iç kimlik sızmaz, müsaitlik 5'te kırpılır, kişi
 * başı ek yansır), rezervasyon isteği (PENDING, source WIDGET, idempotent),
 * yer yokken sebepli red.
 */

const ZONE = 'Europe/Istanbul';
const ORIGIN = 'https://otel.example';
const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

describe('Online rezervasyon motoru (modül 32)', { skip }, () => {
  let app;
  let db;
  let core;
  let cache;
  let resetDatabase;
  let hotelId;
  let types;
  let key;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    cache = await import('../../lib/cache.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const today = () => core.calendarDateInTimeZone(ZONE);
  const day = (offset) => core.toIsoDay(core.addDays(today(), offset));
  const call = (method, path, payload, headers = {}) =>
    app.inject({ method, url: `/public/booking/${key}${path}`, payload, headers: { origin: ORIGIN, ...headers } });

  beforeEach(async () => {
    await resetDatabase(db);
    cache.cache.clear();
    const hotel = await db.hotel.create({
      data: { name: 'Widget Otel', code: `W${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, phoneCountryCode: '90' },
    });
    hotelId = hotel.id;
    const type = (code, basePrice, capacityAdults = 3, capacityChildren = 2) =>
      db.roomType.create({ data: { hotelId, code, name: `${code} oda`, basePrice, capacityAdults, capacityChildren } });
    types = { std: await type('STD', '1000'), sgl: await type('SGL', '500', 1, 0) };
    for (let index = 0; index < 7; index += 1) {
      await db.room.create({ data: { hotelId, number: `10${index}`, roomTypeId: types.std.id } });
    }
    key = `wc_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    await db.messagingChannel.create({
      data: {
        hotelId,
        channel: 'WEBCHAT',
        publicKey: key,
        enabled: true,
        settings: { allowedOrigins: [ORIGIN], title: 'Widget Otel', accentColor: '#0f766e', bookingEnabled: true },
      },
    });
  });

  const quoteBody = (overrides = {}) => ({
    checkIn: day(10),
    checkOut: day(12),
    adults: 2,
    children: 0,
    boardType: 'BB',
    ...overrides,
  });

  describe('kapı', () => {
    it('izinli olmayan origin 403, kapalı motor 404, bilinmeyen anahtar 404', async () => {
      const wrongOrigin = await call('GET', '/options', undefined, { origin: 'https://baska.example' });
      assert.equal(wrongOrigin.statusCode, 403);

      await db.messagingChannel.updateMany({ where: { hotelId }, data: { settings: { allowedOrigins: [ORIGIN], bookingEnabled: false } } });
      cache.cache.clear();
      const disabled = await call('GET', '/options');
      assert.equal(disabled.statusCode, 404);

      const unknown = await app.inject({ method: 'GET', url: '/public/booking/wc_bilinmeyenanahtar123/options', headers: { origin: ORIGIN } });
      assert.equal(unknown.statusCode, 404);
    });

    it('options: otel, oda tipleri ve pansiyonlar döner (fiyatsız)', async () => {
      const response = await call('GET', '/options');
      assert.equal(response.statusCode, 200);
      const data = response.json().data;
      assert.equal(data.hotel.name, 'Widget Otel');
      assert.equal(data.roomTypes.length, 2);
      assert.ok(data.boardTypes.some((board) => board.value === 'AI'));
      assert.equal(data.widget.title, 'Widget Otel');
    });
  });

  describe('teklif', () => {
    it('kırpılmış teklif: müsaitlik 5te kırpılır, kapasite işaretlenir, iç kimlik sızmaz', async () => {
      const response = await call('POST', '/quote', quoteBody());
      assert.equal(response.statusCode, 200);
      const data = response.json().data;
      assert.equal(data.nights, 2);

      const std = data.roomTypes.find((type) => type.id === types.std.id);
      assert.equal(std.available, 5); // 7 oda → "5+" (gerçek envanter sızmaz)
      assert.equal(std.fits, true);
      assert.equal(std.total, '2000.00');

      const sgl = data.roomTypes.find((type) => type.id === types.sgl.id);
      assert.equal(sgl.fits, false); // 2 yetişkin tek kişiliğe sığmaz

      // İç alanlar yok: promosyon/acente kimliği, gece dökümü, satırlar.
      assert.equal(std.nights, undefined);
      assert.equal(data.agency, undefined);
      assert.equal(data.lines, undefined);
    });

    it('seçimli teklif: fiyat planının kişi başı eki kesin toplama yansır', async () => {
      await db.ratePlan.create({
        data: {
          hotelId,
          roomTypeId: types.std.id,
          name: 'Yaz BB',
          boardType: 'BB',
          startDate: new Date(day(0)),
          endDate: new Date(day(60)),
          price: '2000',
          baseOccupancy: 2,
          extraAdultRate: '500',
          childRate: '200',
        },
      });
      cache.cache.clear();

      const response = await call('POST', '/quote', quoteBody({ adults: 3, children: 1, roomTypeId: types.std.id }));
      const data = response.json().data;
      // Kart taban doluluk fiyatı: 2 gece × 2000 = 4000.
      const std = data.roomTypes.find((type) => type.id === types.std.id);
      assert.equal(std.total, '4000.00');
      // Seçim kişi sayısıyla: her gece 2000 + 500 + 200 = 2700 → 5400.
      assert.equal(data.selection.total, '5400.00');
      assert.equal(data.selection.fits, true);
    });
  });

  describe('rezervasyon isteği', () => {
    const reserveBody = (overrides = {}) => ({
      ...quoteBody(),
      roomTypeId: types.std.id,
      guest: { firstName: 'Web', lastName: 'Misafir', email: 'web@example.com', phone: null },
      notes: 'Pencere kenarı olsun',
      requestId: randomUUID(),
      ...overrides,
    });

    it('PENDING açılır, source WIDGET, onay kodu döner; aynı requestId ikinci rezervasyon açmaz', async () => {
      const body = reserveBody();
      const first = await call('POST', '/reserve', body);
      assert.equal(first.statusCode, 200);
      const data = first.json().data;
      assert.match(data.confirmationCode, /-/);
      assert.equal(data.status, 'PENDING');

      const row = await db.reservation.findFirst({ where: { hotelId, confirmationCode: data.confirmationCode } });
      assert.equal(row.status, 'PENDING');
      assert.equal(row.source, 'WIDGET');
      assert.equal(row.createdBy, 'kanal:WIDGET');

      const again = await call('POST', '/reserve', body);
      assert.equal(again.json().data.confirmationCode, data.confirmationCode);
      assert.equal(await db.reservation.count({ where: { hotelId } }), 1);
    });

    it('yer yokken sebepli 422 döner (onaya gitmez)', async () => {
      // Tek kişilik tipte 0 oda var (hiç oda açılmadı) → yer yok.
      const response = await call('POST', '/reserve', reserveBody({ roomTypeId: types.sgl.id, adults: 1 }));
      assert.equal(response.statusCode, 422);
      assert.match(response.json().error, /yer yok/i);
      assert.equal(await db.reservation.count({ where: { hotelId } }), 0);
    });
  });
});
