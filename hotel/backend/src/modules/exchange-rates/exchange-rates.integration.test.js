import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Çoklu para birimi (modül 60) — gerçek PostgreSQL; TCMB sahte sağlayıcı (gerçek bir günün bülteni, ağ yok).
 *
 * Sınanan: iş günü kuru = önceki son bülten (tatil / hafta sonu geriye bakılır), kur türü, bültende olmayan döviz atlanır, elle girilen
 * kur ezilmez, aynı kur yeniden yazılmaz, TCMB'ye ulaşılamazsa sonuç ayara yazılır; ayarda otelin para birimi çıkarılır; kullanıcının
 * dil ve gösterim para birimi tercihi; widget'ın döviz listesi; izinler.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';
const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'mudur@test.local';
const DESK = 'onburo@test.local';
const SAMPLE = readFileSync(new URL('./providers/tcmb-sample.xml', import.meta.url), 'utf8');

describe('kurlar ve tercih (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let rates;
  /** @type {any} */ let tcmb;
  /** @type {any} */ let payments;
  /** @type {any} */ let booking;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  /** @type {Map<string, string>} */ let tokens;
  /** @type {string[]} */ let asked;
  /** @type {Set<string>} */ let holidays;
  let failing;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    rates = await import('./service.js');
    tcmb = await import('./providers/tcmb.js');
    payments = await import('../payments/service.js');
    booking = await import('../public-booking/service.js');
    cache = await import('../../lib/cache.js');
    const parsed = tcmb.parseTcmbXml(SAMPLE);
    rates.setRateProvider({
      bulletin: async (day) => {
        asked.push(day);
        if (failing) throw new Error('bağlantı zaman aşımı');
        return holidays.has(day) ? null : { ...parsed, date: day };
      },
    });
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const today = () => core.toIsoDay(core.calendarDateInTimeZone(ZONE));

  beforeEach(async () => {
    await resetDatabase(db);
    cache.cache.invalidatePrefix('settings:');
    tokens = new Map();
    asked = [];
    holidays = new Set();
    failing = false;
    hotelId = (await db.hotel.create({ data: { name: 'Deniz Otel', code: `X${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({ data: [{ hotelId, email: MANAGER, name: 'Müdür', role: 'MANAGER', passwordHash }, { hotelId, email: DESK, name: 'Ön Büro', role: 'FRONT_DESK', passwordHash }] });
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });

  it('TCMB: önceki son bülten, kur türü, bültende olmayan atlanır, elle girilen ezilmez, aynı kur yeniden yazılmaz; ulaşılamazsa ayara yazılır', async () => {
    const saved = await call('PUT', '/exchange-rates/settings', MANAGER, { expectedUpdatedAt: null, autoFetch: true, rateKind: 'FOREX_SELLING', currencies: ['USD', 'EUR', 'TRY', 'XAU'] });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(saved.json().data.settings.currencies, ['USD', 'EUR', 'XAU'], 'otelin para birimi çıkarılır');
    const candidates = contracts.tcmbCandidateDays(today());
    holidays.add(candidates[0]);
    const first = await call('POST', '/exchange-rates/fetch', MANAGER);
    assert.equal(first.statusCode, 200, first.body);
    const result = first.json().data;
    assert.equal(result.ok, true, result.message);
    assert.equal(result.bulletinDate, candidates[1], 'tatil atlanır, bir önceki bülten');
    assert.deepEqual(result.written.sort(), ['EUR', 'USD']);
    assert.deepEqual(result.skipped, ['XAU (bültende yok)']);
    // Çekme sonucu ayarın sürümünü değiştirmez: form açıkken yapılan çekmeden sonra kayıt "bu arada değişti" demez.
    const resaved = await call('PUT', '/exchange-rates/settings', MANAGER, { expectedUpdatedAt: saved.json().data.settings.updatedAt, autoFetch: true, rateKind: 'FOREX_SELLING', currencies: ['USD', 'EUR', 'XAU'] });
    assert.equal(resaved.statusCode, 200, resaved.body);
    const usd = await db.exchangeRate.findFirst({ where: { hotelId, currency: 'USD' } });
    assert.deepEqual([String(usd.rate), usd.source, core.toIsoDay(usd.bulletinDate)], ['50.6441', 'TCMB', candidates[1]], 'döviz satış');
    // Personel EUR'u elle girdi: sonraki çekme ezmez; USD aynı kalırsa yeniden yazılmaz.
    await as(MANAGER, () => payments.setTodayRates(hotelId, { rates: [{ currency: 'EUR', rate: '51.0000' }] }));
    const second = await rates.fetchTcmbRates(hotelId);
    assert.deepEqual([second.written, second.skipped.includes('EUR (elle girilmiş)')], [[], true]);
    assert.equal(String((await db.exchangeRate.findFirst({ where: { hotelId, currency: 'EUR' } })).rate), '51');
    const current = (await call('GET', '/exchange-rates/current', DESK)).json().data;
    assert.deepEqual(current.rates.map((row) => [row.currency, row.source]).sort(), [['EUR', 'MANUAL'], ['USD', 'TCMB']]);
    failing = true;
    const down = await rates.fetchTcmbRates(hotelId);
    assert.equal(down.ok, false);
    const settings = (await call('GET', '/exchange-rates/settings', DESK)).json().data.settings;
    assert.deepEqual([settings.lastFetchOk, /zaman aşımı/.test(settings.lastMessage)], [false, true]);
    assert.equal((await call('POST', '/exchange-rates/fetch', DESK)).statusCode, 403);
  });

  it('kullanıcı tercihi (dil, gösterim para birimi); widget döviz listesi', async () => {
    const me = await call('GET', '/auth/me', DESK);
    assert.deepEqual([me.json().data.user.locale, me.json().data.user.displayCurrency], ['tr', null]);
    const changed = await call('PATCH', '/auth/me/preferences', DESK, { locale: 'en', displayCurrency: 'eur' });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.deepEqual([changed.json().data.user.locale, changed.json().data.user.displayCurrency], ['en', 'EUR']);
    assert.equal((await call('PATCH', '/auth/me/preferences', DESK, { locale: 'de' })).statusCode, 400);
    await as(MANAGER, () => payments.setTodayRates(hotelId, { rates: [{ currency: 'EUR', rate: '50.6441' }] }));
    const options = await booking.publicOptions({ hotelId, settings: {} });
    assert.deepEqual(options.currencies.map((row) => [row.code, row.rate]), [['EUR', '50.644100']]);
  });
});
