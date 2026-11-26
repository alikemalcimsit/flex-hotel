import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Açık API ve webhook (modül 61) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: panel izinleri (müdür görür, yönetici kurar), anahtar bir kez gösterilir ve hiçbir uçtan / denetim
 * kaydından okunamaz; anahtar doğrulama (yok, bozuk, iptal, süresi dolmuş, uygulama kapalı, başka otel), kapsam,
 * uygulama başına hız sınırı ve geçersiz anahtar denemesi sınırı; müsaitlik; rezervasyon açma (Idempotency-Key,
 * tekrar, yer yok, başka adlı misafir kartı sızmaz, işlem kaydında uygulama), değiştirme / iptal (yalnız kendi
 * açtığı, sürüm), değişenler senkronu (imleç), misafir okuma (kimlik yok); webhook: olay → yalnız isteyen aboneliğe
 * teslimat (başka otel yok, tekrar dağıtım tek teslimat), imza doğrulaması, başarısızlıkta yeniden deneme, hak bitince
 * FAILED, ulaşılamayan alıcıda deneme hakkı yanmaz, kendiliğinden kapanma + zil, duraklatılmış abonelik gönderilmez,
 * sır yenileme (iki imza), deneme olayı, yeniden gönderim, temizlik.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const ADMIN = 'yonetici@test.local';
const MANAGER = 'mudur@test.local';
const DESK = 'onburo@test.local';
const ALL_SCOPES = ['availability:read', 'reservations:read', 'reservations:write', 'guests:read'];

describe('açık API ve webhook (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let cache;
  /** @type {any} */ let sender;
  /** @type {any} */ let outbox;
  /** @type {any} */ let auth;
  /** @type {any} */ let signature;
  /** @type {any} */ let contracts;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  /** @type {Map<string, string>} */ let tokens;
  let hotelId;
  let otherHotelId;
  let roomType;
  /** @type {Array<{ url: string, body: string, headers: Record<string, string> }>} */ let sent;
  /** @type {(request: any) => Promise<any>} */ let respond;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    process.env.SETTINGS_SECRET_KEY = randomBytes(32).toString('base64');
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    cache = await import('../../lib/cache.js');
    sender = await import('./sender.js');
    outbox = await import('./outbox.js');
    auth = await import('../public-api/auth.js');
    signature = await import('../../lib/webhook-signature.js');
    contracts = await import('@hotelos/hotel-contracts');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
    sender.setWebhookTransport(async (request) => {
      sent.push(request);
      return respond(request);
    });
  });

  after(async () => {
    sender.setWebhookTransport(null);
    await app?.close();
    await db?.$disconnect();
  });

  const D = (offset) => core.toIsoDay(core.addDays(core.calendarDateInTimeZone(ZONE), offset));
  const quiet = { info() {}, warn() {}, error() {} };

  beforeEach(async () => {
    await resetDatabase(db);
    cache.cache.clear();
    auth.resetApiAuthState();
    tokens = new Map();
    sent = [];
    respond = async () => ({ status: 200, retryAfter: null, body: 'ok', durationMs: 5 });
    hotelId = (await db.hotel.create({ data: { name: 'Büyük Ankara Oteli', code: `A${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY', phone: '+903120000000' } })).id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka Otel', code: `B${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: ADMIN, name: 'Yönetici', role: 'ADMIN', passwordHash },
        { hotelId, email: MANAGER, name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: DESK, name: 'Ön Büro', role: 'FRONT_DESK', passwordHash },
        { hotelId: otherHotelId, email: 'baska@test.local', name: 'Başka Yönetici', role: 'ADMIN', passwordHash },
      ],
    });
    roomType = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '3000', capacityAdults: 3, capacityChildren: 2 } });
    await db.room.createMany({ data: [{ hotelId, number: '101', roomTypeId: roomType.id }] });
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });
  const json = (response, status = 200) => {
    assert.equal(response.statusCode, status, response.body);
    return response.json().data;
  };
  const api = (method, url, key, payload, headers = {}) =>
    app.inject({ method, url, payload, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers } });

  async function newClient(email = ADMIN, body = {}) {
    return json(await call('POST', '/integrations/clients', email, { name: `CRM ${randomUUID().slice(0, 4)}`, ...body }), 201);
  }
  async function newKey(clientId, scopes = ALL_SCOPES, email = ADMIN, extra = {}) {
    return json(await call('POST', `/integrations/clients/${clientId}/keys`, email, { name: 'Sunucu', scopes, ...extra }), 201);
  }
  async function newWebhook(clientId, events, url = 'https://hooks.ornek.com/flex', email = ADMIN) {
    return json(await call('POST', `/integrations/clients/${clientId}/webhooks`, email, { url, events }), 201);
  }
  const reservationBody = (extra = {}) => ({
    guest: { firstName: 'Ayşe', lastName: 'Yılmaz', email: 'ayse@ornek.com' },
    roomTypeId: roomType.id,
    checkIn: D(5),
    checkOut: D(7),
    adults: 2,
    ...extra,
  });
  const book = (key, idempotencyKey = randomUUID(), body = reservationBody()) => api('POST', '/v1/reservations', key, body, { 'idempotency-key': idempotencyKey });

  it('panel: müdür görür ama kuramaz; anahtar ve sır bir kez döner, hiçbir uçtan ve denetim kaydından okunamaz', async () => {
    assert.equal((await call('POST', '/integrations/clients', MANAGER, { name: 'CRM' })).statusCode, 403);
    assert.equal((await call('GET', '/integrations/clients', DESK)).statusCode, 403);
    const client = await newClient(ADMIN, { name: 'Kurumsal CRM' });
    assert.equal((await call('POST', '/integrations/clients', ADMIN, { name: 'kurumsal crm' })).statusCode, 409, 'ad büyük / küçük harf duyarsız tekil');
    assert.equal(json(await call('GET', '/integrations/clients', MANAGER)).length, 1);

    const created = await newKey(client.id);
    assert.match(created.token, /^fhk_[a-z2-7]{12}_[A-Za-z0-9_-]{43}$/);
    assert.equal(created.key.display, `fhk_${created.key.prefix}_…`);
    assert.equal((await call('POST', `/integrations/clients/${client.id}/keys`, ADMIN, { name: 'x', scopes: ['reservations:write'] })).statusCode, 400);

    const webhook = await newWebhook(client.id, ['reservation.created']);
    assert.match(webhook.secret, /^whsec_/);
    const detail = await call('GET', `/integrations/clients/${client.id}`, MANAGER);
    const secretPart = created.token.split('_').pop();
    for (const leak of [secretPart, webhook.secret, 'secretHash', 'secretSealed']) assert.ok(!detail.body.includes(leak), `ayrıntıda ${leak}`);
    const audit = JSON.stringify(await db.auditLog.findMany({ where: { hotelId } }));
    for (const leak of [secretPart, webhook.secret]) assert.ok(!audit.includes(leak), 'denetim kaydında sır');
    const stored = await db.apiKey.findFirst({ where: { id: created.key.id } });
    assert.equal(stored.secretHash, signature.hashApiKey(created.token));
    assert.ok(!JSON.stringify(await db.webhookSubscription.findFirst({ where: { id: webhook.subscription.id } })).includes(webhook.secret), 'sır şifreli saklanır');
    assert.equal((await call('GET', `/integrations/clients/${client.id}`, 'baska@test.local')).statusCode, 404);
  });

  it('anahtar: yok / bozuk / yanlış 401; iptal ve süre dolumu hemen; kapalı uygulama 403; kapsam 403; başka otelin verisi görünmez', async () => {
    const client = await newClient();
    const { token, key } = await newKey(client.id, ['availability:read']);
    assert.equal((await api('GET', '/v1/hotel')).statusCode, 401);
    assert.equal((await api('GET', '/v1/hotel', 'fhk_bozuk')).statusCode, 401);
    assert.equal((await api('GET', '/v1/hotel', `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`)).statusCode, 401);
    const hotel = await api('GET', '/v1/hotel', token);
    assert.equal(hotel.statusCode, 200, hotel.body);
    assert.equal(hotel.json().name, 'Büyük Ankara Oteli');
    assert.equal(hotel.headers['cache-control'], 'no-store');
    assert.ok(hotel.headers['x-ratelimit-limit']);
    assert.equal((await api('GET', '/v1/reservations', token)).json().code, 'SCOPE_REQUIRED');
    assert.equal((await api('POST', '/v1/reservations', token, {})).statusCode, 403, 'kapsamsız istek şemaya varmadan 403');

    const other = await newClient('baska@test.local');
    const otherKey = await newKey(other.id, ALL_SCOPES, 'baska@test.local');
    const mine = await newKey(client.id);
    assert.equal((await book(mine.token)).statusCode, 201);
    const ours = (await api('GET', '/v1/reservations', mine.token)).json().items[0];
    assert.equal((await api('GET', `/v1/reservations/${ours.id}`, otherKey.token)).statusCode, 404);
    assert.equal((await api('GET', '/v1/reservations', otherKey.token)).json().items.length, 0);

    // Kapalı uygulama: önbellek hemen silinir.
    const current = json(await call('GET', `/integrations/clients/${client.id}`, ADMIN));
    json(await call('PATCH', `/integrations/clients/${client.id}`, ADMIN, { expectedUpdatedAt: current.updatedAt, status: 'DISABLED' }));
    const disabled = await api('GET', '/v1/hotel', token);
    assert.deepEqual([disabled.statusCode, disabled.json().code], [403, 'CLIENT_DISABLED']);
    const reopened = json(await call('GET', `/integrations/clients/${client.id}`, ADMIN));
    json(await call('PATCH', `/integrations/clients/${client.id}`, ADMIN, { expectedUpdatedAt: reopened.updatedAt, status: 'ACTIVE' }));
    assert.equal((await api('GET', '/v1/hotel', token)).statusCode, 200);

    json(await call('POST', `/integrations/clients/${client.id}/keys/${key.id}/revoke`, ADMIN));
    assert.match((await api('GET', '/v1/hotel', token)).json().error, /iptal/);
    assert.equal((await call('POST', `/integrations/clients/${client.id}/keys/${key.id}/revoke`, ADMIN)).statusCode, 409);

    const expiring = await newKey(client.id, ['availability:read']);
    await db.apiKey.update({ where: { id: expiring.key.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    cache.cache.clear();
    assert.match((await api('GET', '/v1/hotel', expiring.token)).json().error, /süresi dolmuş/);
  });

  it('hız sınırı: uygulama başına dakikalık sınır 429 + Retry-After; geçersiz anahtar denemesi IP başına kesilir', async () => {
    const client = await newClient(ADMIN, { rateLimitPerMinute: 10 });
    const { token } = await newKey(client.id, ['availability:read']);
    const second = await newKey(client.id, ['availability:read']);
    for (let index = 0; index < 5; index += 1) {
      assert.equal((await api('GET', '/v1/hotel', token)).statusCode, 200);
      assert.equal((await api('GET', '/v1/hotel', second.token)).statusCode, 200);
    }
    const limited = await api('GET', '/v1/hotel', second.token);
    assert.deepEqual([limited.statusCode, limited.json().code], [429, 'RATE_LIMITED'], 'sınır anahtarların toplamı');
    assert.ok(Number(limited.headers['retry-after']) > 0);

    for (let index = 0; index < contracts.API_UNAUTHENTICATED_LIMIT; index += 1) await api('GET', '/v1/hotel', `fhk_${'a'.repeat(12)}_${'B'.repeat(43)}`);
    const blocked = await api('GET', '/v1/hotel', `fhk_${'a'.repeat(12)}_${'C'.repeat(43)}`);
    assert.equal(blocked.statusCode, 429);
    assert.equal((await api('GET', '/v1/openapi.json')).statusCode, 200, 'doküman anahtarsız');
  });

  it('müsaitlik ve rezervasyon: fiyat motordan; Idempotency-Key zorunlu ve tekrar ilkini döner; yer yoksa 409 ayrıntısız; işlem kaydında uygulama', async () => {
    const client = await newClient(ADMIN, { name: 'Seyahat Aracı' });
    const { token } = await newKey(client.id);
    const availability = await api('GET', `/v1/availability?checkIn=${D(5)}&checkOut=${D(7)}&adults=2`, token);
    assert.equal(availability.statusCode, 200, availability.body);
    const row = availability.json().roomTypes.find((type) => type.roomTypeId === roomType.id);
    assert.deepEqual([row.available, row.fits, availability.json().nights], [1, true, 2]);
    assert.ok(Number(row.total) > 0);
    assert.equal(availability.json().roomTypes.length, 1);
    assert.equal((await api('GET', `/v1/availability?checkIn=${D(5)}&checkOut=${D(7)}&adults=9`, token)).json().roomTypes[0].fits, false);
    assert.equal((await api('GET', `/v1/availability?checkIn=${D(-3)}&checkOut=${D(-1)}`, token)).statusCode, 422);

    assert.equal((await api('POST', '/v1/reservations', token, reservationBody())).json().code, 'IDEMPOTENCY_KEY_REQUIRED');
    const idempotency = randomUUID();
    const first = await book(token, idempotency);
    assert.equal(first.statusCode, 201, first.body);
    const reservation = first.json();
    assert.deepEqual([reservation.status, reservation.source, reservation.ownedByClient, reservation.totalPrice], ['PENDING', 'API', true, row.total]);
    const replay = await book(token, idempotency);
    assert.deepEqual([replay.statusCode, replay.json().id], [200, reservation.id]);
    assert.equal(await db.reservation.count({ where: { hotelId } }), 1);

    const full = await book(token, randomUUID(), reservationBody({ guest: { firstName: 'Can', lastName: 'Demir', email: 'can@ornek.com' } }));
    assert.deepEqual([full.statusCode, full.json().code, full.json().details], [409, 'NO_AVAILABILITY', undefined]);

    const stored = await db.reservation.findFirst({ where: { id: reservation.id } });
    assert.equal(stored.apiClientId, client.id);
    const audit = await db.auditLog.findFirst({ where: { entity: 'Reservation', entityId: reservation.id, action: 'CREATE' } });
    assert.match(audit.actor, /^api:Seyahat Aracı \(fhk_[a-z2-7]{12}\)$/);
  });

  it('misafir: aynı iletişimde başka adlı kart varsa yeni kart açılır, eşleşen kart dışarı sızmaz; kimlik hiçbir uçtan dönmez', async () => {
    await db.guest.create({ data: { hotelId, firstName: 'Mehmet', lastName: 'Kaya', email: 'ortak@ornek.com', phone: '+905551112233', idType: 'NATIONAL_ID', idNumber: '10000000146' } });
    const client = await newClient();
    const { token } = await newKey(client.id);
    const created = await book(token, randomUUID(), reservationBody({ guest: { firstName: 'Zeynep', lastName: 'Kaya', email: 'ortak@ornek.com' } }));
    assert.equal(created.statusCode, 201, created.body);
    assert.ok(!created.body.includes('Mehmet'));
    assert.equal(created.json().guest.firstName, 'Zeynep');
    assert.equal(await db.guest.count({ where: { hotelId, email: 'ortak@ornek.com' } }), 2);

    const guests = await api('GET', '/v1/guests?email=ortak@ornek.com', token);
    assert.equal(guests.statusCode, 200, guests.body);
    assert.equal(guests.json().items.length, 2);
    for (const leak of ['idNumber', '10000000146', 'idType', 'birthDate']) assert.ok(!guests.body.includes(leak), leak);
    const readOnly = await newKey(client.id, ['reservations:read']);
    assert.equal((await api('GET', '/v1/guests', readOnly.token)).statusCode, 403);
    const listed = await api('GET', '/v1/reservations', readOnly.token);
    assert.ok(!listed.body.includes('ortak@ornek.com'), 'rezervasyon kapsamı iletişim vermez');
  });

  it('değiştirme / iptal: yalnız kendi açtığı; sürüm denetimi; iptal politikası; personel notu dışarı çıkmaz', async () => {
    const client = await newClient();
    const { token } = await newKey(client.id);
    const other = await newClient();
    const otherKey = await newKey(other.id);
    const mine = (await book(token, randomUUID(), reservationBody({ notes: 'Geç varış' }))).json();
    assert.equal(mine.notes, 'Geç varış');

    const foreign = await api('PATCH', `/v1/reservations/${mine.id}`, otherKey.token, { expectedUpdatedAt: mine.updatedAt, adults: 1 });
    assert.deepEqual([foreign.statusCode, foreign.json().code], [403, 'NOT_OWNER']);
    assert.equal((await api('GET', `/v1/reservations/${mine.id}`, otherKey.token)).json().notes, null, 'başka uygulamanın notu görünmez');

    const updated = await api('PATCH', `/v1/reservations/${mine.id}`, token, { expectedUpdatedAt: mine.updatedAt, checkOut: D(8) });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().checkOut, D(8));
    assert.ok(Number(updated.json().totalPrice) > Number(mine.totalPrice), 'fiyat yeniden hesaplandı');
    const stale = await api('PATCH', `/v1/reservations/${mine.id}`, token, { expectedUpdatedAt: mine.updatedAt, adults: 1 });
    assert.deepEqual([stale.statusCode, stale.json().code], [409, 'STALE_WRITE']);

    const cancelled = await api('POST', `/v1/reservations/${mine.id}/cancel`, token, { expectedUpdatedAt: updated.json().updatedAt, reason: 'Misafir vazgeçti' });
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal(cancelled.json().status, 'CANCELLED');
    assert.ok(cancelled.json().cancellationFee !== undefined);
    const again = await api('POST', `/v1/reservations/${mine.id}/cancel`, token, { expectedUpdatedAt: cancelled.json().updatedAt, reason: 'x' });
    assert.equal(again.statusCode, 409);
  });

  it('senkron: updatedSince eskiden yeniye, imleçle sayfalar; değişen kayıt bir sonraki çekişte gelir', async () => {
    await db.room.createMany({ data: [102, 103, 104, 105].map((number) => ({ hotelId, number: String(number), roomTypeId: roomType.id })) });
    const client = await newClient();
    const { token } = await newKey(client.id);
    const ids = [];
    for (let index = 0; index < 5; index += 1) ids.push((await book(token, randomUUID(), reservationBody({ guest: { firstName: `Misafir${index}`, lastName: 'Test', email: `m${index}@ornek.com` } }))).json().id);
    const since = '2000-01-01T00:00:00.000Z';
    const seen = [];
    let cursor = null;
    do {
      const response = await api('GET', `/v1/reservations?updatedSince=${since}&limit=2${cursor ? `&cursor=${cursor}` : ''}`, token);
      assert.equal(response.statusCode, 200, response.body);
      seen.push(...response.json().items);
      cursor = response.json().nextCursor;
    } while (cursor);
    assert.deepEqual(seen.map((item) => item.id).sort(), [...ids].sort());
    const stamps = seen.map((item) => item.updatedAt);
    assert.deepEqual(stamps, [...stamps].sort());

    const last = stamps.at(-1);
    const target = seen[0];
    await api('PATCH', `/v1/reservations/${target.id}`, token, { expectedUpdatedAt: target.updatedAt, notes: 'değişti' });
    const next = (await api('GET', `/v1/reservations?updatedSince=${last}`, token)).json().items;
    assert.deepEqual(next.map((item) => item.id), [target.id]);
    assert.equal((await api('GET', '/v1/reservations?cursor=bozuk', token)).statusCode, 422);
  });

  it('webhook: olay yalnız isteyen aboneliğe gider, imza doğrulanır; tekrar dağıtım tek teslimat; başka otel almaz', async () => {
    const client = await newClient();
    const { token } = await newKey(client.id);
    const wanted = await newWebhook(client.id, ['reservation.created'], 'https://a.ornek.com/h');
    await newWebhook(client.id, ['payment.received'], 'https://b.ornek.com/h');
    const other = await newClient('baska@test.local');
    await newWebhook(other.id, ['reservation.created'], 'https://c.ornek.com/h', 'baska@test.local');

    const reservation = (await book(token)).json();
    const deliveries = await db.webhookDelivery.findMany({});
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].subscriptionId, wanted.subscription.id);
    assert.equal(deliveries[0].payload.data.reservationId, reservation.id);
    assert.ok(!JSON.stringify(deliveries[0].payload).includes('Ayşe'), 'gövde ince');

    const event = await db.eventLog.findFirst({ where: { name: 'reservation.created', hotelId } });
    assert.equal(await outbox.enqueueWebhookEvent(event.name, event.payload, event), 0, 'aynı olay ikinci kez yazılmaz');

    const round = await sender.runWebhookSenderRound(quiet);
    assert.deepEqual(round, { claimed: 1, sent: 1 });
    const [request] = sent;
    assert.equal(request.url, 'https://a.ornek.com/h');
    assert.equal(request.headers['x-flexhotel-event'], 'reservation.created');
    assert.ok(signature.verifyWebhookSignature(request.headers['x-flexhotel-signature'], request.body, wanted.secret));
    assert.equal(JSON.parse(request.body).id, event.id);
    const delivered = await db.webhookDelivery.findFirst({ where: { id: deliveries[0].id } });
    assert.deepEqual([delivered.status, delivered.attempts, delivered.responseStatus], ['SUCCEEDED', 1, 200]);
    assert.ok((await db.webhookSubscription.findFirst({ where: { id: wanted.subscription.id } })).lastSuccessAt);
  });

  it('webhook: başarısızlıkta artan beklemeyle yeniden dener, hak bitince FAILED; ulaşılamayan alıcıda kalanların hakkı yanmaz; yeniden gönderim', async () => {
    const client = await newClient();
    const webhook = await newWebhook(client.id, ['reservation.created']);
    const { token } = await newKey(client.id);
    await db.room.createMany({ data: [{ hotelId, number: '102', roomTypeId: roomType.id }] });
    await book(token);
    await book(token, randomUUID(), reservationBody({ guest: { firstName: 'Can', lastName: 'Demir', email: 'can@ornek.com' } }));
    assert.equal(await db.webhookDelivery.count({}), 2);

    respond = async () => {
      throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
    };
    await sender.runWebhookSenderRound(quiet);
    const afterRefused = await db.webhookDelivery.findMany({ orderBy: { createdAt: 'asc' } });
    assert.deepEqual(afterRefused.map((row) => [row.status, row.attempts]), [['RETRYING', 1], ['PENDING', 0]], 'ikinci teslimat denenmedi, hakkı yanmadı');
    assert.equal(sent.length, 1);
    assert.match(afterRefused[0].error, /reddedildi/);
    const wait = afterRefused[0].nextAttemptAt.getTime() - afterRefused[0].lastAttemptAt.getTime();
    assert.ok(wait >= 60_000 && wait <= 66_000, String(wait));

    respond = async () => ({ status: 500, retryAfter: null, body: 'x'.repeat(5000), durationMs: 3 });
    const target = afterRefused[0];
    await db.webhookDelivery.update({ where: { id: target.id }, data: { attempts: contracts.WEBHOOK_MAX_ATTEMPTS - 1, nextAttemptAt: new Date(Date.now() - 1000) } });
    await db.webhookDelivery.update({ where: { id: afterRefused[1].id }, data: { nextAttemptAt: new Date(Date.now() + 3_600_000) } });
    await sender.runWebhookSenderRound(quiet);
    const failed = await db.webhookDelivery.findFirst({ where: { id: target.id } });
    assert.deepEqual([failed.status, failed.attempts, failed.responseStatus, failed.nextAttemptAt], ['FAILED', contracts.WEBHOOK_MAX_ATTEMPTS, 500, null]);
    assert.equal(failed.responseBody.length, contracts.WEBHOOK_RESPONSE_EXCERPT_LENGTH);
    assert.ok(Array.isArray(failed.attemptLog) && failed.attemptLog.length === 2);

    respond = async () => ({ status: 204, retryAfter: null, body: '', durationMs: 3 });
    const redelivered = json(await call('POST', `/integrations/deliveries/${target.id}/redeliver`, ADMIN));
    assert.deepEqual([redelivered.status, redelivered.attempts], ['PENDING', 0]);
    assert.equal((await call('POST', `/integrations/deliveries/${target.id}/redeliver`, ADMIN)).statusCode, 409);
    assert.equal((await call('POST', `/integrations/deliveries/${target.id}/redeliver`, MANAGER)).statusCode, 403);
    await sender.runWebhookSenderRound(quiet);
    assert.equal((await db.webhookDelivery.findFirst({ where: { id: target.id } })).status, 'SUCCEEDED');
    assert.equal((await db.webhookSubscription.findFirst({ where: { id: webhook.subscription.id } })).consecutiveFailures, 0);

    const log = json(await call('GET', `/integrations/deliveries?status=SUCCEEDED&limit=1`, MANAGER));
    assert.equal(log.items.length, 1);
    const detail = json(await call('GET', `/integrations/deliveries/${target.id}`, MANAGER));
    assert.equal(detail.payload.type, 'reservation.created');
  });

  it('webhook: uzun süre başarısız abonelik kendiliğinden kapanır, zil çalar; duraklatılmış gönderilmez; açınca sayaç sıfırlanır', async () => {
    const client = await newClient();
    const webhook = await newWebhook(client.id, ['reservation.created']);
    const { token } = await newKey(client.id);
    await book(token);
    await db.webhookSubscription.update({
      where: { id: webhook.subscription.id },
      data: { consecutiveFailures: contracts.WEBHOOK_DISABLE_AFTER_FAILURES - 1, failingSince: new Date(Date.now() - (contracts.WEBHOOK_DISABLE_AFTER_HOURS + 1) * 3_600_000) },
    });
    respond = async () => ({ status: 503, retryAfter: '600', body: '', durationMs: 2 });
    await sender.runWebhookSenderRound(quiet);
    const disabled = await db.webhookSubscription.findFirst({ where: { id: webhook.subscription.id } });
    assert.equal(disabled.status, 'DISABLED');
    assert.match(disabled.disabledReason, /503/);
    const alert = await db.staffAlert.findFirst({ where: { hotelId, kind: 'INTEGRATION' } });
    assert.ok(alert);
    assert.equal(alert.permission, 'integrations.manage');
    const delivery = await db.webhookDelivery.findFirst({});
    assert.equal(delivery.status, 'RETRYING');
    assert.ok(delivery.nextAttemptAt.getTime() - delivery.lastAttemptAt.getTime() >= 600_000, 'Retry-After çizelgeden uzun: ona uyuldu');

    sent = [];
    await db.webhookDelivery.update({ where: { id: delivery.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await sender.runWebhookSenderRound(quiet);
    assert.equal(sent.length, 0, 'kapalı abonelik gönderilmez');
    await db.webhookDelivery.update({ where: { id: delivery.id }, data: { nextAttemptAt: new Date(Date.now() + 6 * 3_600_000) } });

    const current = json(await call('GET', `/integrations/clients/${client.id}`, ADMIN)).subscriptions[0];
    const reopened = json(await call('PATCH', `/integrations/clients/${client.id}/webhooks/${webhook.subscription.id}`, ADMIN, { expectedUpdatedAt: current.updatedAt, status: 'ACTIVE' }));
    assert.deepEqual([reopened.status, reopened.consecutiveFailures, reopened.disabledReason], ['ACTIVE', 0, null]);
    respond = async () => ({ status: 200, retryAfter: null, body: '', durationMs: 2 });
    await sender.runWebhookSenderRound(quiet);
    assert.equal(sent.length, 1, 'açılınca bekleyen (geri çekilmesi saatlerce ileride olsa da) hemen gitti');

    const paused = json(await call('PATCH', `/integrations/clients/${client.id}/webhooks/${webhook.subscription.id}`, ADMIN, { expectedUpdatedAt: reopened.updatedAt, status: 'PAUSED' }));
    assert.equal(paused.status, 'PAUSED');
    await db.room.createMany({ data: [{ hotelId, number: '102', roomTypeId: roomType.id }] });
    await book(token, randomUUID(), reservationBody({ guest: { firstName: 'Can', lastName: 'Demir', email: 'can@ornek.com' } }));
    assert.equal(await db.webhookDelivery.count({}), 1, 'duraklatılmış aboneliğe yeni olay yazılmaz');
    assert.equal((await call('POST', `/integrations/clients/${client.id}/webhooks/${webhook.subscription.id}/test`, ADMIN)).statusCode, 409);
  });

  it('webhook: sır yenilenince geçişte iki imza; deneme olayı; silinince bekleyenler kapanır; temizlik eski teslimatı siler', async () => {
    const client = await newClient();
    const webhook = await newWebhook(client.id, ['reservation.created']);
    const current = json(await call('GET', `/integrations/clients/${client.id}`, ADMIN)).subscriptions[0];
    const rotated = json(await call('POST', `/integrations/clients/${client.id}/webhooks/${webhook.subscription.id}/rotate-secret`, ADMIN, { expectedUpdatedAt: current.updatedAt }));
    assert.notEqual(rotated.secret, webhook.secret);
    assert.ok(rotated.subscription.previousSecretValidUntil);

    const test = json(await call('POST', `/integrations/clients/${client.id}/webhooks/${webhook.subscription.id}/test`, ADMIN));
    assert.equal(test.eventType, 'webhook.test');
    await sender.runWebhookSenderRound(quiet);
    const [request] = sent;
    assert.equal(request.headers['x-flexhotel-signature'].split(',').length, 3);
    assert.ok(signature.verifyWebhookSignature(request.headers['x-flexhotel-signature'], request.body, rotated.secret));
    assert.ok(signature.verifyWebhookSignature(request.headers['x-flexhotel-signature'], request.body, webhook.secret));
    assert.equal(JSON.parse(request.body).data.subscriptionId, webhook.subscription.id);

    const { token } = await newKey(client.id);
    await book(token);
    const pending = await db.webhookDelivery.findFirst({ where: { eventType: 'reservation.created' } });
    assert.equal(pending.status, 'PENDING');
    const latest = json(await call('GET', `/integrations/clients/${client.id}`, ADMIN)).subscriptions[0];
    assert.equal((await call('DELETE', `/integrations/clients/${client.id}/webhooks/${webhook.subscription.id}`, ADMIN, { expectedUpdatedAt: webhook.subscription.updatedAt })).statusCode, 409, 'eski sürüm');
    json(await call('DELETE', `/integrations/clients/${client.id}/webhooks/${webhook.subscription.id}`, ADMIN, { expectedUpdatedAt: latest.updatedAt }));
    assert.equal((await db.webhookDelivery.findFirst({ where: { id: pending.id } })).status, 'FAILED');

    await db.webhookDelivery.updateMany({ data: { createdAt: new Date(Date.now() - (contracts.WEBHOOK_DELIVERY_RETENTION_DAYS + 1) * 86_400_000) } });
    assert.equal(await sender.purgeWebhookDeliveries(), 2);
  });

  it('kendi kayıtları: anahtar ve abonelik sınırı kilit altında; uygulama silinince anahtarlar ve abonelikler kapanır', async () => {
    const client = await newClient();
    const results = await Promise.all(Array.from({ length: contracts.MAX_ACTIVE_API_KEYS_PER_CLIENT + 3 }, () => call('POST', `/integrations/clients/${client.id}/keys`, ADMIN, { name: 'k', scopes: ['availability:read'] })));
    assert.equal(results.filter((response) => response.statusCode === 201).length, contracts.MAX_ACTIVE_API_KEYS_PER_CLIENT);
    assert.ok(results.filter((response) => response.statusCode !== 201).every((response) => response.json().code === 'LIMIT_REACHED'));
    const token = results.find((response) => response.statusCode === 201).json().data.token;
    assert.equal((await api('GET', '/v1/hotel', token)).statusCode, 200);
    await newWebhook(client.id, ['reservation.created']);
    assert.equal((await call('POST', `/integrations/clients/${client.id}/webhooks`, ADMIN, { url: 'https://hooks.ornek.com/flex', events: ['guest.updated'] })).json().code, 'DUPLICATE_URL');
    assert.equal((await call('POST', `/integrations/clients/${client.id}/webhooks`, ADMIN, { url: 'https://10.0.0.5/h', events: ['guest.updated'] })).statusCode, 400);

    const current = json(await call('GET', `/integrations/clients/${client.id}`, ADMIN));
    json(await call('DELETE', `/integrations/clients/${client.id}`, ADMIN, { expectedUpdatedAt: current.updatedAt }));
    assert.equal((await api('GET', '/v1/hotel', token)).statusCode, 401);
    assert.equal(await db.apiKey.count({ where: { clientId: client.id, revokedAt: null } }), 0);
    assert.equal(json(await call('GET', '/integrations/clients', ADMIN)).length, 0);
    await newClient(ADMIN, { name: current.name });
  });
});
