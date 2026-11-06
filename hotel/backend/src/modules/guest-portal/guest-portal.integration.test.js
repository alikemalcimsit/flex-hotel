import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Misafir portalı ve online check-in (modül 53) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: bağlantı (ver, imza, yenile / iptal, başka otel), misafir ana sayfası (kısa ad, pencere), online check-in
 * (fotoğraf yükleme, zorunlu fotoğraf, kişi sayısı, gönderim, resepsiyon zili, işlem kaydında kimlik numarası yok,
 * misafire maskeli özet, personele tam ayrıntı ve belge), düzeltme isteği → yeniden gönderim (eski fotoğraf ve imza
 * silinir), onay (sürüm), giriş olayıyla tamamlanma ve geri alma, pencere (henüz değil, iptal), folyo / istek / oda
 * servisi, davet (otomatik bir kez, elle, sıklık), KVKK silmesi (süre dolan ve bağlanmamış fotoğraflar), ayarlar,
 * izinler ve eşzamanlı gönderim.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'mudur@test.local';
const DESK = 'onburo@test.local';
const HOUSEKEEPER = 'kat@test.local';
const BASE = 'https://otel.example.com';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString('base64');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 3)]).toString('base64');

describe('misafir portalı ve online check-in (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let service;
  /** @type {any} */ let documents;
  /** @type {any} */ let invites;
  /** @type {any} */ let notifications;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  /** @type {Map<string, string>} */ let tokens;
  let storageDir;
  let previousStorage;
  let hotelId;
  let otherHotelId;
  let roomType;
  let room;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    storageDir = await mkdtemp(path.join(tmpdir(), 'hotelos-portal-'));
    previousStorage = process.env.FILE_STORAGE_DIR;
    process.env.FILE_STORAGE_DIR = storageDir;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    service = await import('./service.js');
    documents = await import('./documents.js');
    invites = await import('./invites.js');
    notifications = await import('../notifications/service.js');
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
  const D = (offset) => core.toIsoDay(core.addDays(core.calendarDateInTimeZone(ZONE), offset));
  const at = (day, time) => new Date(`${day}T${time}:00.000Z`);

  beforeEach(async () => {
    await resetDatabase(db);
    cache.cache.invalidatePrefix('settings:');
    tokens = new Map();
    hotelId = (await db.hotel.create({ data: { name: 'Büyük Ankara Oteli', code: `G${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY', phone: '+903120000000' } })).id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka Otel', code: `O${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: DESK, name: 'Ön Büro', role: 'FRONT_DESK', passwordHash },
        { hotelId, email: HOUSEKEEPER, name: 'Kat', role: 'HOUSEKEEPING', passwordHash },
        { hotelId: otherHotelId, email: 'baska@test.local', name: 'Başka Müdür', role: 'MANAGER', passwordHash },
      ],
    });
    roomType = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '3000', capacityAdults: 3, capacityChildren: 2 } });
    room = await db.room.create({ data: { hotelId, number: '101', roomTypeId: roomType.id } });
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });
  const open = (method, url, payload) => app.inject({ method, url, payload });
  const json = (response, status = 200) => {
    assert.equal(response.statusCode, status, response.body);
    return response.json().data;
  };

  async function seedReservation({ checkIn = 2, checkOut = 4, status = 'CONFIRMED', adults = 2, children = 1, nationality = 'DE', roomId = null } = {}) {
    const guest = await db.guest.create({ data: { hotelId, firstName: 'Anna', lastName: 'Müller', nationality, email: 'anna@example.com' } });
    return db.reservation.create({
      data: {
        hotelId,
        guestId: guest.id,
        roomTypeId: roomType.id,
        roomId,
        checkIn: at(D(checkIn), '11:00'),
        checkOut: at(D(checkOut), '09:00'),
        status,
        adults,
        children,
        totalPrice: '6000.00',
        confirmationCode: `P${randomUUID().slice(0, 7).toUpperCase()}`,
        ...(status === 'CHECKED_IN' ? { checkedInAt: new Date(), checkedInBy: DESK } : {}),
      },
    });
  }
  const issue = async (reservationId) => json(await call('POST', `/guest-portal/links/${reservationId}`, DESK));
  const tokenFrom = (link) => link.link.path.split('/').pop();
  const upload = async (token) => json(await open('POST', `/public/portal/${token}/check-in/photos`, { contentType: 'image/jpeg', image: JPEG, thumbnail: JPEG }), 201).id;
  const submission = (photos, extra = {}) => ({
    primary: { identity: { idType: 'PASSPORT', idNumber: 'C01X00T47', nationality: 'DE', birthDate: '1985-04-12' }, documentIds: photos.primary },
    companions: [
      { person: { firstName: 'Lukas', lastName: 'Müller', idType: 'PASSPORT', idNumber: 'C01X00T55', nationality: 'DE', birthDate: '1983-01-02' }, documentIds: photos.second },
      { person: { firstName: 'Mia', lastName: 'Müller', isChild: true }, documentIds: [] },
    ],
    vehiclePlate: 'm ab 1234',
    arrivalTime: '16:30',
    paymentPreference: 'CARD_AT_DESK',
    consents: { privacy: true, rules: true, documentPhotos: true, marketing: false },
    signature: { contentType: 'image/png', image: PNG },
    language: 'de',
    ...extra,
  });
  const storagePath = (key) => path.join(storageDir, ...key.split('/'));

  it('bağlantı: personel verir; misafir oturumsuz açar (kısa ad, pencere); imza bozuksa 404; yenilenince eski kapanır; başka otel göremez', async () => {
    const reservation = await seedReservation();
    const link = await issue(reservation.id);
    assert.match(link.link.path, /^\/misafir\/p\/[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    const token = tokenFrom(link);
    const overview = json(await open('GET', `/public/portal/${token}`));
    assert.equal(overview.guestName, 'Anna M.');
    assert.equal(overview.language, 'de');
    assert.equal(overview.reservation.roomNumber, null);
    assert.deepEqual([overview.checkin.open, overview.checkin.status], [true, null]);
    assert.equal(overview.features.digitalKey, false);
    assert.match(overview.welcome.de, /online/i);
    assert.equal((await open('GET', `/public/portal/${token}`)).headers['cache-control'], 'no-store');
    assert.equal((await open('GET', `/public/portal/${token.slice(0, -2)}xx`)).statusCode, 404);

    const renewed = await issue(reservation.id);
    assert.notEqual(tokenFrom(renewed), token);
    assert.equal((await open('GET', `/public/portal/${token}`)).json().code, 'LINK_EXPIRED');
    assert.equal((await call('GET', `/guest-portal/links/${reservation.id}`, 'baska@test.local')).statusCode, 404);
    assert.equal(await db.guestPortalLink.count({ where: { reservationId: reservation.id, revokedAt: null } }), 1);
  });

  it('online check-in: fotoğraf zorunlu, kişi sayısı aşılmaz; gönderim zile düşer, işlem kaydında kimlik no yok; misafire maskeli, personele tam', async () => {
    const reservation = await seedReservation();
    const token = tokenFrom(await issue(reservation.id));
    const missing = await open('POST', `/public/portal/${token}/check-in`, submission({ primary: [], second: [] }));
    assert.equal(missing.statusCode, 400, missing.body);

    const photos = { primary: [await upload(token)], second: [await upload(token)] };
    const extraAdult = submission(photos, {
      companions: [
        { person: { firstName: 'Lukas', lastName: 'Müller', idType: 'PASSPORT', idNumber: 'C01X00T55', nationality: 'DE', birthDate: '1983-01-02' }, documentIds: photos.second },
        { person: { firstName: 'Paul', lastName: 'Müller', idType: 'PASSPORT', idNumber: 'C01X00T63', nationality: 'DE', birthDate: '1990-01-02' }, documentIds: [await upload(token)] },
      ],
    });
    assert.equal((await open('POST', `/public/portal/${token}/check-in`, extraAdult)).json().code, 'PARTY_MISMATCH');

    const form = json(await open('POST', `/public/portal/${token}/check-in`, submission(photos)));
    assert.equal(form.submission.status, 'SUBMITTED');
    assert.equal(form.submission.people[0].idNumber, 'C01••••47');
    assert.deepEqual(form.submission.people.map((person) => person.photos), [1, 1, 0]);
    assert.equal(form.submission.vehiclePlate, 'M AB 1234');

    const alert = await db.staffAlert.findFirst({ where: { hotelId, kind: 'ONLINE_CHECKIN' } });
    assert.match(alert.title, new RegExp(reservation.confirmationCode));
    const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'OnlineCheckin' } });
    assert.ok(!JSON.stringify(audit).includes('C01X00T47'), 'işlem kaydına belge numarası yazılmaz');

    const list = json(await call('GET', '/guest-portal/online-checkins?page=1&pageSize=25', DESK));
    assert.deepEqual([list.meta.total, list.meta.counts.SUBMITTED, list.items[0].people, list.items[0].photoCount], [1, 1, 3, 2]);
    // Arama: onay kodu, rezervasyon sahibi ve refakatçi adı; % ve _ joker değil.
    for (const term of [reservation.confirmationCode.slice(2, 7).toLowerCase(), 'müll', 'lukas']) {
      assert.equal(json(await call('GET', `/guest-portal/online-checkins?page=1&pageSize=25&search=${encodeURIComponent(term)}`, DESK)).meta.total, 1, term);
    }
    assert.equal(json(await call('GET', '/guest-portal/online-checkins?page=1&pageSize=25&search=%25', DESK)).meta.total, 0);
    const detail = json(await call('GET', `/guest-portal/online-checkins/${list.items[0].id}`, DESK));
    assert.equal(detail.guest.idNumber, 'C01X00T47');
    assert.equal(detail.checkInValues.companions[0].firstName, 'Lukas');
    assert.equal(detail.checkInValues.vehiclePlate, 'M AB 1234');
    const doc = await call('GET', `/guest-portal/online-checkins/${detail.id}/documents/${detail.documents[0].id}?size=thumb`, DESK);
    assert.deepEqual([doc.statusCode, doc.headers['content-type'], doc.headers['cache-control']], [200, 'image/jpeg', 'private, no-store']);
    assert.equal((await call('GET', `/guest-portal/online-checkins/${detail.id}/signature`, DESK)).headers['content-type'], 'image/png');
    assert.equal((await call('GET', `/guest-portal/online-checkins/${detail.id}/documents/${detail.documents[0].id}`, HOUSEKEEPER)).statusCode, 403);
    assert.equal((await call('GET', '/guest-portal/online-checkins', HOUSEKEEPER)).statusCode, 403);
    // Kullanılmayan (fazla kişiye yüklenen) fotoğraf bağlanmadı.
    assert.equal(await db.onlineCheckinDocument.count({ where: { reservationId: reservation.id, onlineCheckinId: null } }), 1);
  });

  it('düzeltme isteği → misafir görür, yeniden gönderir (eski fotoğraf ve imza silinir); eski sürümle onay reddedilir; onay', async () => {
    const reservation = await seedReservation();
    const token = tokenFrom(await issue(reservation.id));
    const first = { primary: [await upload(token)], second: [await upload(token)] };
    json(await open('POST', `/public/portal/${token}/check-in`, submission(first)));
    const row = await db.onlineCheckin.findUnique({ where: { reservationId: reservation.id } });
    const oldSignature = row.signatureKey;

    const rejected = json(await call('POST', `/guest-portal/online-checkins/${row.id}/reject`, DESK, { expectedUpdatedAt: row.updatedAt.toISOString(), reason: 'Pasaport fotoğrafı bulanık' }));
    assert.equal(rejected.status, 'REJECTED');
    const overview = json(await open('GET', `/public/portal/${token}`));
    assert.deepEqual([overview.checkin.status, overview.checkin.rejectReason, overview.checkin.open], ['REJECTED', 'Pasaport fotoğrafı bulanık', true]);

    const second = { primary: [await upload(token)], second: first.second };
    json(await open('POST', `/public/portal/${token}/check-in`, submission(second)));
    const resubmitted = await db.onlineCheckin.findUnique({ where: { reservationId: reservation.id } });
    assert.deepEqual([resubmitted.status, resubmitted.submitCount, resubmitted.rejectReason], ['SUBMITTED', 2, null]);
    const replaced = await db.onlineCheckinDocument.findUnique({ where: { id: first.primary[0] } });
    assert.ok(replaced.purgedAt, 'değiştirilen fotoğraf işaretlendi');
    assert.equal(existsSync(storagePath(`online-checkin/${hotelId}/${first.primary[0]}.jpg`)), false);
    assert.equal(existsSync(storagePath(oldSignature)), false);
    assert.equal(existsSync(storagePath(resubmitted.signatureKey)), true);

    const stale = await call('POST', `/guest-portal/online-checkins/${row.id}/approve`, DESK, { expectedUpdatedAt: row.updatedAt.toISOString() });
    assert.equal(stale.json().code, 'STALE_WRITE');
    const approved = json(await call('POST', `/guest-portal/online-checkins/${row.id}/approve`, DESK, { expectedUpdatedAt: resubmitted.updatedAt.toISOString() }));
    assert.deepEqual([approved.status, approved.reviewedBy], ['APPROVED', DESK]);

    // Rezervasyonun giriş günü değişince (modül 4) liste süzgeci yeni günle çalışır.
    assert.equal(core.toIsoDay(resubmitted.arrivalDate), D(2));
    await service.syncArrivalDate({ hotelId, reservationId: reservation.id, checkIn: D(3) });
    const moved = json(await call('GET', `/guest-portal/online-checkins?page=1&pageSize=25&from=${D(3)}&to=${D(3)}`, DESK));
    assert.deepEqual([moved.meta.total, moved.items[0].id], [1, row.id]);
    assert.equal(json(await call('GET', `/guest-portal/online-checkins?page=1&pageSize=25&to=${D(2)}`, DESK)).meta.total, 0);
  });

  it('giriş olayı kaydı tamamlar (pencere kapanır); giriş geri alınırsa onaylıya döner', async () => {
    const reservation = await seedReservation();
    const token = tokenFrom(await issue(reservation.id));
    json(await open('POST', `/public/portal/${token}/check-in`, submission({ primary: [await upload(token)], second: [await upload(token)] })));
    await db.reservation.update({ where: { id: reservation.id }, data: { status: 'CHECKED_IN', roomId: room.id, checkedInAt: new Date(), checkedInBy: DESK } });
    await as(DESK, () => service.onStayCheckInChanged({ hotelId, reservationId: reservation.id }, 'COMPLETED'));
    assert.equal((await db.onlineCheckin.findUnique({ where: { reservationId: reservation.id } })).status, 'COMPLETED');
    const overview = json(await open('GET', `/public/portal/${token}`));
    assert.deepEqual([overview.checkin.open, overview.checkin.reason, overview.reservation.roomNumber, overview.features.checkin], [false, 'COMPLETED', '101', false]);
    const late = await open('POST', `/public/portal/${token}/check-in/photos`, { contentType: 'image/jpeg', image: JPEG, thumbnail: JPEG });
    assert.equal(late.json().code, 'CHECKIN_COMPLETED');
    await as(DESK, () => service.onStayCheckInChanged({ hotelId, reservationId: reservation.id }, 'REVERTED'));
    assert.equal((await db.onlineCheckin.findUnique({ where: { reservationId: reservation.id } })).status, 'APPROVED');
  });

  it('pencere: henüz açılmadı / iptal edilen rezervasyonda portal kapalı', async () => {
    const far = await seedReservation({ checkIn: 12, checkOut: 14 });
    const farToken = tokenFrom(await issue(far.id));
    const overview = json(await open('GET', `/public/portal/${farToken}`));
    assert.deepEqual([overview.checkin.open, overview.checkin.reason, overview.checkin.opensOn], [false, 'NOT_YET', D(5)]);
    assert.equal((await open('POST', `/public/portal/${farToken}/check-in/photos`, { contentType: 'image/jpeg', image: JPEG, thumbnail: JPEG })).json().code, 'CHECKIN_NOT_YET');
    await db.reservation.update({ where: { id: far.id }, data: { status: 'CANCELLED' } });
    assert.equal((await open('GET', `/public/portal/${farToken}`)).json().code, 'PORTAL_CLOSED');
    assert.equal((await call('POST', `/guest-portal/links/${far.id}`, DESK)).json().code, 'PORTAL_CLOSED');
  });

  it('içeride: folyo (iptal kalem yok, acente penceresi gizli, ödeme folyo tutarıyla), istek (tekrar gönderim tek istek, kaynak portal), oda servisi bağlantısı', async () => {
    const stay = await seedReservation({ checkIn: -1, checkOut: 2, status: 'CHECKED_IN', roomId: room.id });
    const token = tokenFrom(await issue(stay.id));
    const folio = await db.folio.create({ data: { hotelId, reservationId: stay.id, guestId: stay.guestId, chargesTotal: '3000', paymentsTotal: '1000', balance: '2000' } });
    const agency = await db.folio.create({ data: { hotelId, reservationId: stay.id, guestId: stay.guestId, window: 2, payerName: 'Örnek Tur A.Ş.', chargesTotal: '1800', balance: '1800' } });
    const item = (description, extra = {}) =>
      db.folioItem.create({ data: { hotelId, folioId: folio.id, reservationId: stay.id, type: 'ROOM', source: 'MANUAL', description, quantity: 1, amount: '3000', netAmount: '3000', taxAmount: '0', total: '3000', serviceDate: new Date(`${D(-1)}T00:00:00Z`), postedBy: 'test', ...extra } });
    await item('Oda ücreti');
    await item('İptal edilen', { voidedAt: new Date(), voidedBy: 'test' });
    await item('Acente kontrat fiyatı', { folioId: agency.id, amount: '1800', netAmount: '1800', total: '1800' });
    const payment = (data) =>
      db.payment.create({ data: { hotelId, folioId: folio.id, reservationId: stay.id, method: 'CASH', businessDate: new Date(`${D(0)}T00:00:00Z`), receivedBy: 'test', postedAt: new Date(), ...data } });
    const euro = await payment({ amount: '40', currency: 'EUR', exchangeRate: '25', folioAmount: '1000', receivedAt: new Date(Date.now() - 60_000) });
    await payment({ kind: 'REVERSAL', reversalOfId: euro.id, amount: '-40', currency: 'EUR', exchangeRate: '25', folioAmount: '-1000', receivedAt: new Date() });
    const view = json(await open('GET', `/public/portal/${token}/folio`));
    assert.deepEqual([view.folios.length, view.folios[0].items.length, view.folios[0].balance, view.otherPayerAccounts], [1, 1, '2000.00', 1]);
    assert.ok(!JSON.stringify(view).includes('Acente') && !JSON.stringify(view).includes('Örnek Tur'), 'acentenin penceresi, adı ve fiyatı misafire gitmez');
    assert.deepEqual(
      view.folios[0].payments.map((row) => [row.kind, row.folioAmount, row.amount, row.currency]),
      [
        ['PAYMENT', '1000.00', '40.00', 'EUR'],
        ['REVERSAL', '-1000.00', '-40.00', 'EUR'],
      ],
    );

    const body = { category: 'AMENITY', description: 'Fazladan iki yastık rica ederim' };
    json(await open('POST', `/public/portal/${token}/requests`, body), 201);
    const again = json(await open('POST', `/public/portal/${token}/requests`, body), 201);
    assert.equal(again.requests.length, 1);
    const created = await db.guestRequest.findFirst({ where: { hotelId, reservationId: stay.id } });
    assert.deepEqual([created.source, created.roomId, created.title], ['PORTAL', room.id, 'Fazladan iki yastık rica ederim']);

    await db.posSettings.upsert({ where: { hotelId }, create: { hotelId, guestOrderingEnabled: true }, update: { guestOrderingEnabled: true } });
    const roomService = json(await open('POST', `/public/portal/${token}/room-service`));
    assert.match(roomService.path, /^\/misafir\/oda-servisi\//);
    assert.equal(json(await open('POST', `/public/portal/${token}/room-service`)).path, roomService.path);
  });

  it('davet: girişe 3 gün kala bir kez otomatik; uzaktaki gelmez; elle gönderim ve sıklık sınırı', async () => {
    await as(MANAGER, () => notifications.ensureDefaultTemplates(hotelId, db));
    await db.notificationChannelConfig.create({ data: { hotelId, channel: 'EMAIL', enabled: true, settings: { fromAddress: 'otel@example.com' } } });
    const near = await seedReservation({ checkIn: 3, checkOut: 5 });
    const far = await seedReservation({ checkIn: 5, checkOut: 6 });
    const settings = { hotelId, enabled: true, inviteDaysBefore: 3, checkinOpenDays: 7, documentRetentionDays: 7, publicBaseUrl: BASE, texts: {} };
    await db.guestPortalSettings.create({ data: settings });

    // Kurulmuş otelde yeni tetikleyicinin şablonu yoksa ilk davet varsayılanları yükler.
    await db.notificationTemplate.deleteMany({ where: { hotelId, key: 'CHECKIN_INVITE' } });
    assert.equal(await as('sistem', () => invites.inviteUpcomingArrivals(hotelId, settings)), 1);
    assert.ok((await db.notificationTemplate.count({ where: { hotelId, key: 'CHECKIN_INVITE' } })) > 0);
    const sent = await db.notification.findFirst({ where: { hotelId, reservationId: near.id, source: 'CHECKIN_INVITE' } });
    assert.match(sent.body, new RegExp(`${BASE}/misafir/p/[0-9a-f-]{36}\\.`));
    assert.equal(await as('sistem', () => invites.inviteUpcomingArrivals(hotelId, settings)), 0);
    assert.equal(await db.notification.count({ where: { hotelId, reservationId: far.id } }), 0);

    await db.guestPortalLink.updateMany({ where: { reservationId: near.id }, data: { invitedAt: new Date(Date.now() - 3_600_000) } });
    const manual = json(await call('POST', `/guest-portal/links/${near.id}/invite`, DESK));
    assert.equal(manual.result.queued, 1);
    assert.equal(await db.notification.count({ where: { hotelId, reservationId: near.id, source: 'CHECKIN_INVITE' } }), 2);
    assert.equal((await call('POST', `/guest-portal/links/${near.id}/invite`, DESK)).json().code, 'INVITE_TOO_SOON');

    // İletişimsiz misafire davet harcanmaz: e-posta sonradan eklenince otomatik tur gönderir. Elle denemede de bağlantı
    // "davet gitti" sayılmaz.
    const silent = await seedReservation({ checkIn: 2, checkOut: 4 });
    await db.guest.update({ where: { id: silent.guestId }, data: { email: null } });
    assert.equal(await as('sistem', () => invites.inviteUpcomingArrivals(hotelId, settings)), 0);
    const tried = json(await call('POST', `/guest-portal/links/${silent.id}/invite`, DESK));
    assert.deepEqual([tried.result.queued, tried.link.invitedAt], [0, null]);
    await db.guest.update({ where: { id: silent.guestId }, data: { email: 'gec@example.com' } });
    assert.equal(await as('sistem', () => invites.inviteUpcomingArrivals(hotelId, settings)), 1);
    assert.equal(await db.notification.count({ where: { hotelId, reservationId: silent.id, source: 'CHECKIN_INVITE' } }), 1);

    // Personelin iptal ettiği bağlantıya ("misafir istemiyor") otomatik tur yeni bağlantı açıp davet göndermez.
    const declined = await seedReservation({ checkIn: 1, checkOut: 3 });
    await issue(declined.id);
    assert.equal((await call('DELETE', `/guest-portal/links/${declined.id}`, DESK)).statusCode, 200);
    assert.equal(await as('sistem', () => invites.inviteUpcomingArrivals(hotelId, settings)), 0);
    assert.equal(await db.guestPortalLink.count({ where: { reservationId: declined.id, revokedAt: null } }), 0);
    assert.equal(await db.notification.count({ where: { hotelId, reservationId: declined.id } }), 0);

    // Davetin gidebileceği açık kanal yoksa tur başlamaz; davet harcanmaz.
    const waiting = await seedReservation({ checkIn: 1, checkOut: 2 });
    await db.notificationChannelConfig.updateMany({ where: { hotelId }, data: { enabled: false } });
    assert.equal(await as('sistem', () => invites.inviteUpcomingArrivals(hotelId, settings)), 0);
    assert.equal(await db.guestPortalLink.count({ where: { reservationId: waiting.id } }), 0);
  });

  it('KVKK: çıkıştan süre dolunca belgeler ve 48 saati geçen bağlanmamış yükleme silinir; personele "silindi"', async () => {
    const reservation = await seedReservation();
    const token = tokenFrom(await issue(reservation.id));
    const photos = { primary: [await upload(token)], second: [await upload(token)] };
    json(await open('POST', `/public/portal/${token}/check-in`, submission(photos)));
    const orphan = await upload(token);
    await db.onlineCheckinDocument.update({ where: { id: orphan }, data: { createdAt: new Date(Date.now() - 49 * 3_600_000) } });
    assert.equal((await documents.purgeExpiredDocuments()).purged, 1);
    assert.equal(existsSync(storagePath(`online-checkin/${hotelId}/${orphan}.jpg`)), false);

    await db.reservation.update({ where: { id: reservation.id }, data: { status: 'CHECKED_OUT', checkIn: at(D(-12), '11:00'), checkOut: at(D(-9), '09:00'), roomId: room.id, checkedInAt: new Date(), checkedInBy: DESK, checkedOutAt: new Date(), checkedOutBy: DESK } });
    assert.equal((await documents.purgeExpiredDocuments()).purged, 2);
    const row = await db.onlineCheckin.findUnique({ where: { reservationId: reservation.id } });
    assert.ok(row.documentsPurgedAt);
    assert.deepEqual([row.guest.idNumber, row.guest.birthDate, row.guest.lastName, row.companions[0].idNumber], [null, null, 'Müller', null], 'kimlik kopyası temizlendi, ad kaldı');
    const doc = await call('GET', `/guest-portal/online-checkins/${row.id}/documents/${photos.primary[0]}`, DESK);
    assert.equal(doc.json().code, 'DOCUMENT_PURGED');
    assert.equal((await documents.purgeExpiredDocuments()).purged, 0);

    // Kapatılmamış (gelmedi işaretlenmemiş) rezervasyonun belgeleri de çıkış gününden süre dolunca silinir.
    const stale = await seedReservation({ adults: 1, children: 0 });
    const staleToken = tokenFrom(await issue(stale.id));
    json(await open('POST', `/public/portal/${staleToken}/check-in`, submission({ primary: [await upload(staleToken)] }, { companions: [] })));
    await db.reservation.update({ where: { id: stale.id }, data: { checkIn: at(D(-14), '11:00'), checkOut: at(D(-10), '09:00') } });
    assert.equal((await documents.purgeExpiredDocuments()).purged, 1);
    assert.ok((await db.onlineCheckin.findUnique({ where: { reservationId: stale.id } })).documentsPurgedAt);
  });

  it('ayarlar: adres biçimi, sürüm kilidi, eksik dil uyarısı; ön büro ayar değiştiremez', async () => {
    const empty = json(await call('GET', '/guest-portal/settings', MANAGER));
    assert.deepEqual([empty.enabled, empty.inviteDaysBefore, empty.publicBaseUrl, empty.updatedAt], [true, 3, null, null]);
    const texts = { tr: { houseRules: 'Evcil hayvan kabul edilmez.' }, en: {}, de: {}, ru: {} };
    const body = { enabled: true, inviteDaysBefore: 2, checkinOpenDays: 5, documentRetentionDays: 10, publicBaseUrl: 'http://otel.example.com', texts };
    assert.equal((await call('PUT', '/guest-portal/settings', MANAGER, body)).statusCode, 400);
    const saved = json(await call('PUT', '/guest-portal/settings', MANAGER, { ...body, publicBaseUrl: `${BASE}/` }));
    assert.equal(saved.publicBaseUrl, BASE);
    assert.deepEqual(saved.missingTexts.map((row) => row.language), ['en', 'de', 'ru']);
    assert.equal((await call('PUT', '/guest-portal/settings', MANAGER, { ...body, publicBaseUrl: BASE })).json().code, 'STALE_WRITE');
    assert.equal((await call('PUT', '/guest-portal/settings', DESK, { ...body, publicBaseUrl: BASE, expectedUpdatedAt: saved.updatedAt })).statusCode, 403);
  });

  it('eşzamanlı iki gönderim: biri yazar, diğeri "başka sekmeden gönderildi"', async () => {
    const reservation = await seedReservation();
    const token = tokenFrom(await issue(reservation.id));
    const photos = { primary: [await upload(token)], second: [await upload(token)] };
    const results = await Promise.all([open('POST', `/public/portal/${token}/check-in`, submission(photos)), open('POST', `/public/portal/${token}/check-in`, submission(photos))]);
    const codes = results.map((response) => (response.statusCode === 200 ? 'OK' : response.json().code)).sort();
    assert.deepEqual(codes, ['OK', 'STALE_WRITE']);
    assert.equal((await db.onlineCheckin.findUnique({ where: { reservationId: reservation.id } })).submitCount, 1);
  });
});
