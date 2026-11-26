import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Sanal POS (modül 50) — gerçek PostgreSQL gerektirir. Sağlayıcı: Test ortamı (taklit ödeme sayfası; dışarı çıkmaz).
 *
 * Sınanan: ayar (iyzico anahtarsız açılamaz, anahtar dönmez); link oluştur / gönder; misafirin ödemesi uçtan uca (başlat → taklit
 * sayfa → sağlayıcı geri dönüşü form POST → sonucu sunucu sorar → folyoya VIRTUAL_POS, büyük ödeme onayına gitmez, tekrar gelen
 * geri dönüş ikinci ödeme açmaz); kart reddi ve yeniden deneme; yarıda bırakılan ödemenin kurtarılması; süre dolumu; karta iade
 * dört gözle (fazla iade reddi, kendi isteğini onaylayamama, onayla eksi ödeme); portaldan ödeme; widget ön ödemesi; izinler.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'mudur@test.local';
const MANAGER2 = 'genelmudur@test.local';
const DESK = 'onburo@test.local';
const ACCOUNTING = 'muhasebe@test.local';
const HK = 'kat@test.local';
const API = 'https://otel.example.com/api';
const PORTAL = 'https://otel.example.com';

describe('sanal POS (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let reservations;
  /** @type {any} */ let approvals;
  /** @type {any} */ let jobs;
  /** @type {any} */ let integrations;
  /** @type {any} */ let portalLinks;
  /** @type {any} */ let notifications;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  /** @type {Map<string, string>} */ let tokens;
  /** @type {any} */ let roomType;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    process.env.SETTINGS_SECRET_KEY ??= Buffer.alloc(32, 7).toString('base64');
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    reservations = await import('../reservations/service.js');
    approvals = await import('../approvals/service.js');
    jobs = await import('./jobs.js');
    integrations = await import('./integrations.js');
    portalLinks = await import('../guest-portal/links.js');
    notifications = await import('../notifications/service.js');
    cache = await import('../../lib/cache.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const day = (offset) => core.toIsoDay(core.addDays(core.calendarDateInTimeZone(ZONE), offset));

  beforeEach(async () => {
    await resetDatabase(db);
    reservations.clearReservationCache();
    cache.cache.invalidatePrefix('settings:');
    tokens = new Map();
    hotelId = (await db.hotel.create({ data: { name: 'Deniz Otel', code: `P${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, phoneCountryCode: '90', email: 'rezervasyon@otel.example.com' } })).id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: MANAGER2, name: 'Genel Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: DESK, name: 'Ön Büro', role: 'FRONT_DESK', passwordHash },
        { hotelId, email: ACCOUNTING, name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
        { hotelId, email: HK, name: 'Kat', role: 'HOUSEKEEPING', passwordHash },
      ],
    });
    roomType = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 3, capacityChildren: 1 } });
    await db.room.create({ data: { hotelId, number: '101', roomTypeId: roomType.id } });
    await db.guestPortalSettings.create({ data: { hotelId, enabled: true, inviteDaysBefore: 3, checkinOpenDays: 7, documentRetentionDays: 7, publicBaseUrl: PORTAL, texts: {} } });
    await saveSettings();
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });
  const settingsBody = (patch = {}) => ({ expectedUpdatedAt: null, isEnabled: true, provider: 'TEST', environment: 'SANDBOX', apiPublicUrl: API, testBehavior: 'APPROVE', ...patch });
  async function saveSettings(patch = {}) {
    const current = await db.paymentGatewaySettings.findUnique({ where: { hotelId } });
    const response = await call('PUT', '/payment-gateway/settings', MANAGER, { ...settingsBody(patch), expectedUpdatedAt: current?.updatedAt ?? null });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().data;
  }

  async function book() {
    const result = await as(DESK, () =>
      reservations.createReservation(hotelId, {
        guestId: null,
        guest: { firstName: 'Anna', lastName: 'Schmidt', phone: '+905321112233', email: 'anna@example.com', nationality: 'DE' },
        forceNewGuest: true,
        roomTypeId: roomType.id,
        adults: 2,
        children: 0,
        boardType: 'BB',
        checkIn: new Date(day(3)),
        checkOut: new Date(day(5)),
        status: 'CONFIRMED',
        source: 'PHONE',
        notes: null,
        requestId: randomUUID(),
        waitlistId: null,
        roomId: null,
        manualTotal: null,
        priceNote: null,
      }),
    );
    return result.reservation;
  }
  const createLink = async (reservationId, body = {}, email = DESK) => {
    const response = await call('POST', `/payment-gateway/reservations/${reservationId}/links`, email, { requestId: randomUUID(), amount: '1000.00', purpose: 'PREPAYMENT', ...body });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().data.link;
  };
  /** Misafir: başlat → taklit sayfa → geri dönüş. */
  async function guestPays(code, { outcome = 'pay' } = {}) {
    const started = await app.inject({ method: 'POST', url: `/public/pay/${code}/start`, payload: {} });
    assert.equal(started.statusCode, 200, started.body);
    const redirect = new URL(started.json().data.redirectUrl);
    assert.equal(redirect.pathname, `/api/public/pay/${code}/test-checkout`);
    const token = redirect.searchParams.get('token');
    const page = await app.inject({ method: 'GET', url: `/public/pay/${code}/test-checkout?token=${token}` });
    assert.match(page.body, /Test ortamı — gerçek ödeme alınmaz/);
    if (outcome === 'leave') return { token };
    const callback = await app.inject({ method: 'POST', url: `/public/pay/${code}/callback`, payload: `token=${token}&testOutcome=pay`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(callback.statusCode, 303);
    return { token, location: callback.headers.location };
  }
  const linkRow = (id) => db.paymentLink.findUnique({ where: { id } });

  it('ayar: iyzico anahtarsız açılmaz, anahtar dönmez; link oluştur, gönder; misafir öder → folyoya sanal POS (onaysız), tekrar gelen geri dönüş tek ödeme', async () => {
    const noKeys = await call('PUT', '/payment-gateway/settings', MANAGER, { ...settingsBody({ provider: 'IYZICO' }), expectedUpdatedAt: (await db.paymentGatewaySettings.findUnique({ where: { hotelId } })).updatedAt });
    assert.equal(noKeys.statusCode, 422);
    const withKeys = await saveSettings({ provider: 'IYZICO', apiKey: 'sandbox-abc', secretKey: 'sandbox-gizli' });
    assert.equal(withKeys.settings.hasCredentials, true);
    assert.ok(!JSON.stringify(withKeys).includes('sandbox-gizli'));
    await saveSettings();

    await as(MANAGER, () => notifications.ensureDefaultTemplates(hotelId, db));
    await db.notificationChannelConfig.create({ data: { hotelId, channel: 'EMAIL', enabled: true, settings: { fromAddress: 'otel@example.com' } } });
    const stay = await book();
    const summary = (await call('GET', `/payment-gateway/reservations/${stay.id}`, DESK)).json().data;
    assert.deepEqual([summary.suggested.amount, summary.suggested.purpose, summary.canLink], ['2000.00', 'PREPAYMENT', true], 'folyo yokken konaklama tutarı');
    const link = await createLink(stay.id);
    assert.match(link.url, /^https:\/\/otel\.example\.com\/misafir\/o\/[A-Za-z0-9_-]{32}$/);
    const sent = await call('POST', `/payment-gateway/links/${link.id}/send`, DESK);
    assert.equal(sent.statusCode, 200, sent.body);
    assert.deepEqual(sent.json().data.link.sentVia, ['EMAIL']);
    const mail = await db.notification.findFirst({ where: { hotelId, source: 'PAYMENT_LINK' } });
    assert.match(mail.body, /1\.000,00 TL/);
    assert.ok(mail.body.includes(link.url));

    const view = await app.inject({ method: 'GET', url: `/public/pay/${link.code}` });
    assert.deepEqual([view.json().data.canPay, view.json().data.guest.name, view.json().data.testMode], [true, 'Anna S.', true]);
    const { location, token } = await guestPays(link.code);
    assert.equal(location, `${link.url}?sonuc=odendi`);
    const paid = await linkRow(link.id);
    assert.deepEqual([paid.status, paid.cardLast4, String(paid.paidAmount), paid.attempts], ['PAID', '0008', '1000', 1]);
    const payment = await db.payment.findUnique({ where: { id: paid.paymentId } });
    assert.deepEqual([payment.method, payment.status, String(payment.amount), payment.receivedBy], ['VIRTUAL_POS', 'POSTED', '1000', 'payment-gateway']);
    // Geri dönüş ikinci kez (tarayıcı yeniledi) → tek ödeme.
    const again = await app.inject({ method: 'POST', url: `/public/pay/${link.code}/callback`, payload: `token=${token}&testOutcome=pay`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(again.statusCode, 303);
    assert.equal(await db.payment.count({ where: { hotelId, method: 'VIRTUAL_POS' } }), 1);
    assert.ok((await db.staffAlert.findMany({ where: { hotelId, kind: 'PAYMENT_GATEWAY' } })).some((row) => /Online ödeme alındı: 1000\.00/.test(row.title)));
    const restart = await app.inject({ method: 'POST', url: `/public/pay/${link.code}/start`, payload: {} });
    assert.equal(restart.statusCode, 409);
    assert.match(restart.body, /zaten yapıldı/);

    // Sahte geri dönüş: tarayıcının uydurduğu test token'ı ödeme yazmaz.
    const forged = await createLink(stay.id, { amount: '200.00' });
    const fake = await app.inject({ method: 'POST', url: `/public/pay/${forged.code}/callback`, payload: 'token=test_aaaaaaaaaaaaaaaaaaaaaaaa&testOutcome=pay', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(fake.headers.location, `${forged.url}?sonuc=basarisiz`);
    assert.equal((await linkRow(forged.id)).status, 'OPEN');
    assert.equal(await db.payment.count({ where: { hotelId, method: 'VIRTUAL_POS' } }), 1);

    // Test ortamında para gerçek değil: büyük ödeme eşiğindeki tutar onaya gider (TEST seçip "ödendi" dört gözü atlatmasın).
    await db.hotel.update({ where: { id: hotelId }, data: { largePaymentThreshold: '150' } });
    cache.cache.invalidatePrefix('settings:');
    await guestPays(forged.code);
    const pending = await db.payment.findUnique({ where: { id: (await linkRow(forged.id)).paymentId } });
    assert.deepEqual([pending.status, String(pending.amount)], ['PENDING', '200'], 'test ödemesi eşik üstünde onaya gider');
  });

  it('ödeme alındı ama folyoya yazılamadı: link yeniden ödenmez, kritik zil, iş sonra yazar', async () => {
    const stay = await book();
    const link = await createLink(stay.id, { amount: '400.00' });
    const started = await app.inject({ method: 'POST', url: `/public/pay/${link.code}/start`, payload: {} });
    const token = new URL(started.json().data.redirectUrl).searchParams.get('token');
    // Misafir öderken konaklama iptal edildi: folyo açılamaz.
    await db.reservation.update({ where: { id: stay.id }, data: { status: 'CANCELLED' } });
    const callback = await app.inject({ method: 'POST', url: `/public/pay/${link.code}/callback`, payload: `token=${token}&testOutcome=pay`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(callback.headers.location, `${link.url}?sonuc=odendi`);
    let row = await linkRow(link.id);
    assert.deepEqual([row.status, row.paymentId, row.failureCode], ['PAID', null, 'NOT_POSTED']);
    assert.ok((await db.staffAlert.findMany({ where: { hotelId, kind: 'PAYMENT_GATEWAY', severity: 'CRITICAL' } })).some((alert) => /folyoya yazılamadı/.test(alert.title)));
    assert.equal((await app.inject({ method: 'POST', url: `/public/pay/${link.code}/start`, payload: {} })).statusCode, 409, 'yeniden ödenmez');
    await db.reservation.update({ where: { id: stay.id }, data: { status: 'CONFIRMED' } });
    const checkout = await import('./checkout.js');
    assert.equal(await checkout.postPendingPaidLinks(), 1);
    row = await linkRow(link.id);
    assert.ok(row.paymentId);
    assert.equal(row.failureCode, null);
    assert.equal(String((await db.payment.findUnique({ where: { id: row.paymentId } })).amount), '400');
  });

  it('kart reddi → link yine ödenebilir, ikinci deneme başarılı; yarıda bırakılan ödeme kurtarılır; süre dolumu', async () => {
    await saveSettings({ testBehavior: 'DECLINE' });
    const stay = await book();
    const link = await createLink(stay.id, { amount: '750.00' });
    const declined = await guestPays(link.code);
    assert.equal(declined.location, `${link.url}?sonuc=basarisiz`);
    let row = await linkRow(link.id);
    assert.deepEqual([row.status, row.failureCode], ['OPEN', 'T-DECLINED']);
    assert.match((await app.inject({ method: 'GET', url: `/public/pay/${link.code}` })).json().data.link.lastError, /Kart reddedildi/);
    await saveSettings({ testBehavior: 'APPROVE' });
    await guestPays(link.code);
    row = await linkRow(link.id);
    assert.deepEqual([row.status, row.attempts], ['PAID', 2]);

    // Yarıda bırakıldı: geri dönüş hiç gelmedi → 10 dakika sonra iş sağlayıcıya sorar, link yeniden ödenebilir.
    const left = await createLink(stay.id, { amount: '100.00' });
    await guestPays(left.code, { outcome: 'leave' });
    assert.equal((await linkRow(left.id)).status, 'PROCESSING');
    await db.paymentLink.update({ where: { id: left.id }, data: { startedAt: new Date(Date.now() - 11 * 60_000) } });
    assert.equal(await jobs.recoverStaleLinks(), 1);
    row = await linkRow(left.id);
    assert.deepEqual([row.status, row.failureCode], ['OPEN', 'T-ABANDONED']);

    // Süre dolumu.
    await db.paymentLink.update({ where: { id: left.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await app.inject({ method: 'POST', url: `/public/pay/${left.code}/start`, payload: {} });
    assert.equal(expired.statusCode, 409);
    assert.equal((await linkRow(left.id)).status, 'EXPIRED');
    const other = await createLink(stay.id, { amount: '50.00' });
    await db.paymentLink.update({ where: { id: other.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await jobs.expireLinks(), 1);
    assert.equal((await call('POST', `/payment-gateway/links/${other.id}/cancel`, DESK)).statusCode, 409, 'süresi dolmuş iptal edilmez');
  });

  it('karta iade dört gözle: fazla iade reddi, kendi isteğini onaylayamaz, onaylanınca eksi sanal POS ödemesi', async () => {
    const stay = await book();
    const link = await createLink(stay.id);
    await guestPays(link.code);
    const tooMuch = await call('POST', `/payment-gateway/links/${link.id}/refund`, DESK, { requestId: randomUUID(), amount: '1200.00', reason: 'Fazla' });
    assert.equal(tooMuch.statusCode, 422);
    assert.match(tooMuch.body, /En çok 1000\.00/);
    const requested = await call('POST', `/payment-gateway/links/${link.id}/refund`, DESK, { requestId: randomUUID(), amount: '300.00', reason: 'Erken ayrılış' });
    assert.equal(requested.statusCode, 201, requested.body);
    const refund = await db.gatewayRefund.findFirst({ where: { linkId: link.id } });
    assert.equal(refund.status, 'PENDING_APPROVAL');
    const second = await call('POST', `/payment-gateway/links/${link.id}/refund`, DESK, { requestId: randomUUID(), amount: '800.00', reason: 'Fazla' });
    assert.equal(second.statusCode, 422, 'onay bekleyen iade düşülür');
    await assert.rejects(as(DESK, () => approvals.decideApproval(hotelId, refund.approvalId, 'GRANTED', { note: 'Tamam' })));
    await as(MANAGER2, () => approvals.decideApproval(hotelId, refund.approvalId, 'GRANTED', { note: 'Uygun' }));
    const done = await db.gatewayRefund.findUnique({ where: { id: refund.id } });
    assert.equal(done.status, 'DONE');
    assert.equal(done.failureMessage, null, done.failureMessage);
    assert.match(done.providerRefundId, /^TEST-RF-/);
    const negative = await db.payment.findUnique({ where: { id: done.paymentId } });
    assert.deepEqual([negative.kind, negative.method, String(negative.amount), negative.status], ['REFUND', 'VIRTUAL_POS', '-300', 'POSTED']);
    assert.equal(String((await linkRow(link.id)).refundedAmount), '300');
  });

  it('portaldan kartla ödeme (aynı tutarda link yeniden kullanılır); widget ön ödemesi; izinler', async () => {
    const stay = await book();
    const portal = await as(DESK, () => portalLinks.issuePortalLink(hotelId, stay.id));
    const token = portal.link.path.split('/').pop();
    const overview = await app.inject({ method: 'GET', url: `/public/portal/${token}` });
    assert.equal(overview.json().data.features.payOnline, true);
    const first = await app.inject({ method: 'POST', url: `/public/portal/${token}/pay` });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().data.amount, '2000.00');
    const second = await app.inject({ method: 'POST', url: `/public/portal/${token}/pay` });
    assert.equal(second.json().data.code, first.json().data.code);
    assert.equal((await db.paymentLink.findFirst({ where: { code: first.json().data.code } })).origin, 'PORTAL');

    await saveSettings({ widgetPrepayment: 'FIRST_NIGHT' });
    const widget = await integrations.widgetPrepaymentLink(hotelId, stay.id);
    assert.equal(widget.amount, '1000.00');
    assert.match(widget.url, /\/misafir\/o\//);

    assert.equal((await call('GET', '/payment-gateway/links', HK)).statusCode, 403);
    assert.equal((await call('GET', '/payment-gateway/links', ACCOUNTING)).statusCode, 200);
    assert.equal((await call('POST', `/payment-gateway/reservations/${stay.id}/links`, ACCOUNTING, { requestId: randomUUID(), amount: '10.00' })).statusCode, 403);
    assert.equal((await call('PUT', '/payment-gateway/settings', DESK, settingsBody())).statusCode, 403);
    const list = (await call('GET', '/payment-gateway/links', DESK)).json().data;
    assert.equal(list.summary.open, 2);
  });
});
