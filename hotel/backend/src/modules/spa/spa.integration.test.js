import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Spa ve spor salonu (modül 57) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: tanımlar (sürüm kilidi, ad tekilliği, kullanımdaki kaydın silinmemesi); boş saat hesabı (temizlik arası,
 * çalışma saati, blok) ve yerleştirme (otomatik atama, tercih, seçilen terapist, eşzamanlı iki istek → tek randevu,
 * tekrar gönderim); randevunun yaşam döngüsü (yeniden planlama, tamamlama, odaya yazma ve folyo kalemi, dahil / hariç
 * vergi); iptal ve gelmedi bedeli (süre, oran, silme yetkisi, içerideki misafirde odaya, dışarıdan gelende bakiye);
 * geri alma; spa kasası (ön ödeme, sınırlar, büyük ödeme ve iade onayı, hatalı girişin iptali, kasa ekranında "Spa");
 * grup dersi (tekrar, kontenjan, yedek liste ve asıla geçiş, saat değişimi, iptal, toplu tamamlama); misafir portalı
 * (pencere, sınırlar, anında onay, iptal, sızmayan alanlar); konaklama olayları ve hatırlatma; liste, rapor, izinler
 * ve otel kapsamı.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'mudur@test.local';
const MANAGER2 = 'mudur2@test.local';
const DESK = 'onburo@test.local';
const ACCOUNTANT = 'muhasebe@test.local';
const HOUSEKEEPER = 'kat@test.local';
const OTHER = 'baska@test.local';
const THRESHOLD = '20000.00';
const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '09:00', end: '18:00' }));

describe('spa ve spor salonu (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let appointments;
  /** @type {any} */ let sessions;
  /** @type {any} */ let jobs;
  /** @type {any} */ let subscribers;
  /** @type {any} */ let approvals;
  /** @type {any} */ let cash;
  /** @type {any} */ let folios;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  /** @type {Map<string, string>} */ let tokens;
  let hotelId;
  let otherHotelId;
  let roomType;
  let rooms;
  let roomIndex;
  /** @type {Record<string, any>} */ let spa;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    appointments = await import('./appointments.js');
    sessions = await import('./sessions.js');
    jobs = await import('./jobs.js');
    subscribers = await import('./subscribers.js');
    approvals = await import('../approvals/service.js');
    cash = await import('../payments/service.js');
    folios = await import('../folios/service.js');
    cache = await import('../../lib/cache.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const D = (offset) => core.toIsoDay(core.addDays(core.calendarDateInTimeZone(ZONE), offset));
  /** Otel saatiyle an. */
  const wall = (day, time) => contracts.zonedWallTimeToUtc(`${day}T${time}`, ZONE);
  const lastEvent = (name) => db.eventLog.findFirst({ where: { hotelId, name }, orderBy: { occurredAt: 'desc' } });
  const userId = async (email) => (await db.user.findFirst({ where: { hotelId, email }, select: { id: true } })).id;

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
  /** Beklenen hata: durum, kod ve (verilirse) mesaj. */
  const fail = (response, status, code, message) => {
    assert.equal(response.statusCode, status, response.body);
    const body = response.json();
    if (code) assert.equal(body.code, code, response.body);
    if (message) assert.match(body.error, message);
    return body;
  };
  async function rejectsWith(promise, code, message) {
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, code, `${error.code}: ${error.message}`);
      if (message) assert.match(error.message, message);
      return true;
    });
  }

  beforeEach(async () => {
    await resetDatabase(db);
    cache.cache.invalidatePrefix('settings:');
    tokens = new Map();
    roomIndex = 0;
    hotelId = (await db.hotel.create({ data: { name: 'Büyük Ankara Oteli', code: `S${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY', phone: '+903120000000', largePaymentThreshold: THRESHOLD } })).id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka Otel', code: `O${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: MANAGER2, name: 'İkinci Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: DESK, name: 'Ön Büro', role: 'FRONT_DESK', passwordHash },
        { hotelId, email: ACCOUNTANT, name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
        { hotelId, email: HOUSEKEEPER, name: 'Kat', role: 'HOUSEKEEPING', passwordHash },
        { hotelId: otherHotelId, email: OTHER, name: 'Başka Müdür', role: 'MANAGER', passwordHash },
      ],
    });
    // Spa KDV %20 dahil: fiyat misafirin ödediği.
    await db.tax.create({ data: { hotelId, name: 'KDV', rate: '20', isIncluded: true, appliesTo: ['SPA'] } });
    roomType = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '3000', capacityAdults: 3, capacityChildren: 2 } });
    rooms = [];
    for (let index = 1; index <= 6; index += 1) rooms.push(await db.room.create({ data: { hotelId, number: `${100 + index}`, roomTypeId: roomType.id } }));
    await db.notificationChannelConfig.create({ data: { hotelId, channel: 'EMAIL', enabled: true, settings: { fromAddress: 'otel@example.com' } } });
    await db.guestPortalSettings.create({ data: { hotelId, publicBaseUrl: 'https://otel.example.com' } });
    spa = await seedSpa();
  });

  /** Odalar, terapistler ve hizmetler (ekranın yaptığı gibi HTTP'den). */
  async function seedSpa() {
    const room = async (name, kind = 'TREATMENT', sortOrder = 0) => json(await call('POST', '/spa/rooms', MANAGER, { name, kind, sortOrder }), 201);
    const therapist = async (name, gender, sortOrder = 0) => json(await call('POST', '/spa/therapists', MANAGER, { name, gender, sortOrder, hours: ALL_WEEK }), 201);
    const service = async (input) => json(await call('POST', '/spa/services', MANAGER, { category: 'MASSAGE', kind: 'PRIVATE', durationMinutes: 60, bufferMinutes: 15, ...input }), 201);
    const r1 = await room('Bakım Odası 1', 'TREATMENT', 1);
    const r2 = await room('Bakım Odası 2', 'TREATMENT', 2);
    const studio = await room('Yoga Stüdyosu', 'STUDIO', 3);
    const elif = await therapist('Elif Kaya', 'FEMALE', 1);
    const murat = await therapist('Murat Demir', 'MALE', 2);
    const deniz = await therapist('Deniz Arslan', null, 3);
    return {
      r1,
      r2,
      studio,
      elif,
      murat,
      deniz,
      massage: await service({ name: 'Aromaterapi Masajı', price: '2500', therapistIds: [elif.id, murat.id], roomIds: [r1.id, r2.id], translations: { en: { name: 'Aromatherapy Massage', description: '' } } }),
      // Tek terapist + tek oda: çakışma sınamaları için.
      hammam: await service({ name: 'Kese Köpük', category: 'HAMMAM', price: '1800', therapistIds: [elif.id], roomIds: [r1.id] }),
      couple: await service({ name: 'Çift Masajı', price: '2400', therapistCount: 2, guestCount: 2, therapistIds: [elif.id, murat.id], roomIds: [r2.id] }),
      yoga: await service({ name: 'Sabah Yogası', category: 'WELLNESS', kind: 'GROUP', durationMinutes: 60, bufferMinutes: 0, price: '400', capacity: 3, therapistIds: [deniz.id], roomIds: [studio.id] }),
    };
  }

  /** Konaklama: içeride (dün girdi, üç gün sonra çıkacak) ya da başka durumda. Her biri ayrı odada. */
  async function seedStay({ status = 'CHECKED_IN', lastName = 'Müller', email = `misafir${roomIndex}@example.com`, nationality = 'DE' } = {}) {
    const guest = await db.guest.create({ data: { hotelId, firstName: 'Anna', lastName, nationality, email, phone: '+905320000000' } });
    const room = rooms[roomIndex++];
    const inHouse = status === 'CHECKED_IN';
    return db.reservation.create({
      data: {
        hotelId,
        guestId: guest.id,
        roomTypeId: roomType.id,
        roomId: room.id,
        checkIn: wall(D(inHouse ? -1 : 1), '14:00'),
        checkOut: wall(D(4), '10:00'),
        status,
        adults: 2,
        children: 0,
        totalPrice: '9000.00',
        confirmationCode: `S${randomUUID().slice(0, 7).toUpperCase()}`,
        confirmedAt: new Date(),
        ...(inHouse ? { checkedInAt: wall(D(-1), '15:00'), checkedInBy: DESK } : {}),
        ...(status === 'CHECKED_OUT' ? { checkIn: wall(D(-3), '14:00'), checkOut: wall(D(-1), '10:00'), checkedInAt: wall(D(-3), '15:00'), checkedInBy: DESK, checkedOutAt: wall(D(-1), '10:00'), checkedOutBy: DESK } : {}),
      },
    });
  }

  /** Randevu açar (HTTP). */
  const book = async (input, email = DESK, status = 201) => {
    const response = await call('POST', '/spa/appointments', email, { requestId: randomUUID(), serviceId: spa.massage.id, startsAt: `${D(1)}T10:00`, ...input });
    return status === 201 ? json(response, 201).appointment : response;
  };
  const detail = async (id, email = MANAGER) => json(await call('GET', `/spa/appointments/${id}`, email));
  const fresh = async (id) => (await detail(id)).appointment;
  const version = (appointment) => new Date(appointment.updatedAt);
  const complete = (appointment, settle, time, day = D(1), email = DESK) =>
    as(email, () => appointments.completeSpaAppointment(hotelId, appointment.id, { expectedUpdatedAt: version(appointment), settle }, { now: wall(day, time) }));
  const close = (appointment, outcome, time, extra = {}, day = D(1), email = MANAGER) =>
    as(email, () => appointments.closeSpaAppointment(hotelId, appointment.id, { expectedUpdatedAt: version(appointment), reason: 'Misafir haber verdi', ...extra }, { outcome, now: wall(day, time) }));
  const pay = async (id, input, email = MANAGER) => call('POST', `/spa/appointments/${id}/payments`, email, { requestId: randomUUID(), kind: 'PAYMENT', method: 'CASH', ...input });
  const slot = (availability, time) => availability.slots.find((item) => item.time === time)?.available;

  /* ══════════════════ Tanımlar ══════════════════ */

  it('tanımlar: sürüm kilidi, ad tekilliği, eksik kadro uyarısı; ileri tarihli işi olan kayıt silinmez; ayar', async () => {
    const setup = json(await call('GET', '/spa/setup', DESK));
    assert.equal(setup.services.length, 4);
    assert.equal(setup.therapists.length, 3);
    assert.deepEqual(setup.services.find((row) => row.id === spa.massage.id).missingTranslations, ['de', 'ru']);
    assert.equal(setup.services.find((row) => row.id === spa.couple.id).staffingIssue, false);

    // Ad büyük / küçük harf ayrımsız tekil; hizmet terapistsiz kaydedilmez (şema).
    fail(await call('POST', '/spa/rooms', MANAGER, { name: 'bakım odası 1', kind: 'TREATMENT' }), 409, 'DUPLICATE', /spa odası zaten var/);
    fail(await call('POST', '/spa/services', MANAGER, { name: 'Sıcak Taş', category: 'MASSAGE', kind: 'PRIVATE', durationMinutes: 75, price: '3000', therapistIds: [], roomIds: [spa.r1.id] }), 400, 'VALIDATION');
    // Başka otelin terapisti seçilemez.
    const foreign = await db.spaTherapist.create({ data: { hotelId: otherHotelId, name: 'Yabancı', createdBy: OTHER } });
    fail(await call('POST', '/spa/services', MANAGER, { name: 'Sıcak Taş', category: 'MASSAGE', kind: 'PRIVATE', durationMinutes: 75, price: '3000', therapistIds: [foreign.id], roomIds: [spa.r1.id] }), 422, 'VALIDATION', /geçersiz/);

    // Sürüm kilidi: aynı sürümle ikinci kayıt bayat.
    const update = { ...spa.murat, hours: ALL_WEEK, serviceIds: [spa.massage.id, spa.couple.id], title: 'Kıdemli masör', expectedUpdatedAt: spa.murat.updatedAt };
    const murat = json(await call('PUT', `/spa/therapists/${spa.murat.id}`, MANAGER, update));
    assert.equal(murat.title, 'Kıdemli masör');
    fail(await call('PUT', `/spa/therapists/${spa.murat.id}`, MANAGER, update), 409, 'STALE_WRITE');

    // Terapist kullanımdan kalkınca çift masajının kadrosu yetmez: ekranda uyarı, boş saat yok.
    json(await call('PUT', `/spa/therapists/${spa.murat.id}`, MANAGER, { ...update, isActive: false, expectedUpdatedAt: murat.updatedAt }));
    const after = json(await call('GET', '/spa/setup', MANAGER));
    assert.equal(after.services.find((row) => row.id === spa.couple.id).staffingIssue, true);
    const empty = json(await call('GET', `/spa/availability?serviceId=${spa.couple.id}&day=${D(1)}`, DESK));
    assert.equal(empty.staffed, false);
    assert.ok(empty.slots.every((item) => !item.available));

    // İleri tarihli randevusu olan terapist / oda / hizmet silinmez; randevu kapanınca silinir.
    const stay = await seedStay();
    const appointment = await book({ serviceId: spa.hammam.id, reservationId: stay.id });
    const elif = after.therapists.find((row) => row.id === spa.elif.id);
    fail(await call('DELETE', `/spa/therapists/${spa.elif.id}?expectedUpdatedAt=${encodeURIComponent(elif.updatedAt)}`, MANAGER), 409, 'IN_USE', /ileri tarihli/);
    fail(await call('DELETE', `/spa/rooms/${spa.r1.id}?expectedUpdatedAt=${encodeURIComponent(spa.r1.updatedAt)}`, MANAGER), 409, 'IN_USE');
    fail(await call('DELETE', `/spa/services/${spa.hammam.id}?expectedUpdatedAt=${encodeURIComponent(spa.hammam.updatedAt)}`, MANAGER), 409, 'IN_USE');
    // Türü randevusu olan hizmette değişmez.
    fail(await call('PUT', `/spa/services/${spa.hammam.id}`, MANAGER, { ...spa.hammam, kind: 'GROUP', capacity: 5, expectedUpdatedAt: spa.hammam.updatedAt }), 422, 'VALIDATION', /türü değiştirilemez/);
    await close(appointment, 'CANCELLED', '06:00');
    json(await call('DELETE', `/spa/services/${spa.hammam.id}?expectedUpdatedAt=${encodeURIComponent(spa.hammam.updatedAt)}`, MANAGER));
    assert.equal(json(await call('GET', '/spa/setup', MANAGER)).services.some((row) => row.id === spa.hammam.id), false);
    // Silinen hizmetin geçmiş randevusu okunur.
    assert.equal((await fresh(appointment.id)).serviceName, 'Kese Köpük');

    // Ayar: ilk kayıt sürümsüz, sonrası sürümle; sınırlar.
    const settings = { openTime: '08:00', closeTime: '22:00', slotMinutes: 30, freeCancelHours: 6, lateCancelFeePct: '40', noShowFeePct: '100', portalEnabled: true, portalLeadMinutes: 60, portalMaxActive: 3, reminderHours: 3 };
    const saved = json(await call('PUT', '/spa/settings', MANAGER, { ...settings, expectedUpdatedAt: null })).settings;
    assert.equal(saved.openTime, '08:00');
    assert.equal(saved.lateCancelFeePct, '40.00');
    fail(await call('PUT', '/spa/settings', MANAGER, { ...settings, expectedUpdatedAt: null }), 409, 'STALE_WRITE');
    json(await call('PUT', '/spa/settings', MANAGER, { ...settings, slotMinutes: 15, expectedUpdatedAt: saved.updatedAt }));
    fail(await call('PUT', '/spa/settings', MANAGER, { ...settings, closeTime: '08:30', expectedUpdatedAt: null }), 400, 'VALIDATION');
    assert.ok((await db.auditLog.count({ where: { hotelId, entity: 'SpaSettings' } })) >= 2);
  });

  /* ══════════════════ Boş saat ve yerleştirme ══════════════════ */

  it('boş saat: temizlik arası ve çalışma saati; otomatik atama boş terapisti ve odayı bulur; dolu saat reddedilir', async () => {
    const stay = await seedStay();
    const first = await book({ serviceId: spa.hammam.id, reservationId: stay.id });
    assert.match(first.code, /^SPA-\d{4}-00001$/);
    assert.deepEqual(first.therapists.map((row) => row.name), ['Elif Kaya']);
    assert.equal(first.room.name, 'Bakım Odası 1');
    assert.equal(first.roomNumber, '101');
    assert.equal(first.customerName, 'Anna Müller');

    // 10:00–11:00 + 15 dk ara: 09:00 (10:15'e kadar sürerdi) ve 11:00 dolu, 11:15 boş; terapist 18:00'de çıkar.
    const hammam = json(await call('GET', `/spa/availability?serviceId=${spa.hammam.id}&day=${D(1)}`, DESK));
    assert.equal(hammam.slots[0].time, '09:00');
    assert.deepEqual(['09:00', '10:00', '11:00', '11:15', '17:00', '17:15', '20:00'].map((time) => slot(hammam, time)), [false, false, false, true, true, false, false]);

    // Masaj: Elif ve odası dolu → Murat ve 2. oda atanır; üçüncü randevu sığmaz.
    const second = await book({ customerName: 'Selin Aksoy', customerPhone: '+90 532 111 22 33' });
    assert.deepEqual([second.therapists[0].name, second.room.name, second.reservationId, second.roomNumber], ['Murat Demir', 'Bakım Odası 2', null, null]);
    fail(await book({ customerName: 'Üçüncü Kişi' }, DESK, 409), 409, 'SPA_SLOT_TAKEN', /uygun terapist yok/);
    // Seçilen terapist dolu / çalışmıyor: alanıyla döner.
    const busy = fail(await book({ customerName: 'Dördüncü Kişi', startsAt: `${D(1)}T10:30`, therapistIds: [spa.elif.id] }, DESK, 409), 409, 'SPA_SLOT_TAKEN', /terapist bu saatte dolu/);
    assert.equal(busy.details?.field ?? 'therapistIds', 'therapistIds');
    // Tercih: erkek terapist isteyen misafire Murat (ikisi de boşken sıra Elif'te olurdu).
    const preferred = await book({ customerName: 'Tercihli Misafir', startsAt: `${D(1)}T13:00`, therapistPreference: 'MALE' });
    assert.equal(preferred.therapists[0].name, 'Murat Demir');
    // Açılıştan önce, kapanışı aşan ve geçmiş gün reddedilir; hizmete uymayan terapist sayısı da.
    fail(await book({ customerName: 'Erken Kuş', startsAt: `${D(1)}T08:00` }, DESK, 422), 422, 'VALIDATION', /arası açık/);
    fail(await book({ customerName: 'Gece Kuşu', startsAt: `${D(1)}T21:30` }, DESK, 422), 422, 'VALIDATION', /kapanıştan önce bitmeli/);
    fail(await book({ customerName: 'Dünkü Misafir', startsAt: `${D(-1)}T10:00` }, DESK, 422), 422, 'VALIDATION', /Geçmiş güne/);
    // Saat ayardaki aralığa (15 dk) oturmalı: ekranın sunmadığı saat API'den de açılmaz.
    fail(await book({ customerName: 'Aradaki Saat', startsAt: `${D(1)}T15:05` }, DESK, 422), 422, 'VALIDATION', /randevu aralığına oturmalı/);
    fail(await book({ customerName: 'İki Terapist', startsAt: `${D(1)}T15:00`, therapistIds: [spa.elif.id, spa.murat.id] }, DESK, 422), 422, 'VALIDATION', /1 terapist seçin/);
    // Kapanmış konaklamaya randevu açılmaz (dışarıdan gelen olarak yazılır).
    const gone = await seedStay({ status: 'CHECKED_OUT' });
    fail(await book({ reservationId: gone.id, startsAt: `${D(1)}T15:00` }, DESK, 422), 422, 'VALIDATION', /kapanmış/);

    // Takvim: günün kayıtları tuttukları terapist ve odayla.
    const calendar = json(await call('GET', `/spa/calendar?day=${D(1)}`, DESK));
    assert.equal(calendar.items.length, 3);
    const item = calendar.items.find((row) => row.id === first.id);
    assert.deepEqual([item.type, item.startMinute, item.endMinute, item.busyMinute, item.therapistIds, item.roomId], ['APPOINTMENT', 600, 660, 675, [spa.elif.id], spa.r1.id]);
    assert.deepEqual(calendar.therapists.find((row) => row.id === spa.elif.id).working, [{ startMinute: 540, endMinute: 1080 }]);
  });

  it('yarış ve tekrar: aynı saate eşzamanlı iki istek tek randevu açar; aynı istek kimliği ikinci randevu açmaz; blok', async () => {
    const stay = await seedStay();
    const two = await Promise.all([1, 2].map((index) => book({ serviceId: spa.hammam.id, customerName: `Yarışan ${index}`, startsAt: `${D(1)}T14:00` }, DESK, 0)));
    assert.deepEqual(two.map((response) => response.statusCode).sort(), [201, 409]);
    assert.equal(await db.spaAppointment.count({ where: { hotelId, status: 'BOOKED' } }), 1);
    assert.equal(await db.spaHold.count({ where: { hotelId, active: true } }), 2, 'bir terapist + bir oda');

    // İki terapistli masajda eşzamanlı iki istek ikisini de açar (otomatik atama diğerine geçer).
    const both = await Promise.all([1, 2].map((index) => book({ customerName: `Paralel ${index}`, startsAt: `${D(1)}T16:00` }, DESK, 0)));
    assert.deepEqual(both.map((response) => response.statusCode), [201, 201]);
    assert.equal(new Set(both.map((response) => response.json().data.appointment.therapists[0].id)).size, 2);

    // Aynı istek kimliği: art arda ve eşzamanlı.
    const requestId = randomUUID();
    const once = await call('POST', '/spa/appointments', DESK, { requestId, serviceId: spa.hammam.id, startsAt: `${D(2)}T10:00`, reservationId: stay.id });
    const twice = await call('POST', '/spa/appointments', DESK, { requestId, serviceId: spa.hammam.id, startsAt: `${D(2)}T10:00`, reservationId: stay.id });
    assert.deepEqual([once.statusCode, twice.statusCode], [201, 200]);
    assert.equal(json(twice).appointment.id, json(once, 201).appointment.id);
    const again = randomUUID();
    const pair = await Promise.all([1, 2].map(() => call('POST', '/spa/appointments', DESK, { requestId: again, serviceId: spa.hammam.id, startsAt: `${D(2)}T13:00`, reservationId: stay.id })));
    assert.deepEqual(pair.map((response) => response.statusCode).sort(), [200, 201]);
    assert.equal(await db.spaAppointment.count({ where: { hotelId, requestKey: `staff:${again}` } }), 1);

    // Blok (izin): o aralıkta randevu verilmez; randevusu olan aralığa blok açılmaz; silinince saat açılır.
    const block = { therapistId: spa.murat.id, startsAt: `${D(3)}T09:00`, endsAt: `${D(3)}T18:00`, reason: 'Yıllık izin' };
    fail(await call('POST', '/spa/blocks', DESK, block), 403);
    const created = json(await call('POST', '/spa/blocks', MANAGER, block), 201);
    assert.equal(created.resourceName, 'Murat Demir');
    const blocked = json(await call('GET', `/spa/availability?serviceId=${spa.massage.id}&day=${D(3)}&therapistId=${spa.murat.id}`, DESK));
    assert.ok(blocked.slots.every((item) => !item.available));
    assert.equal(slot(json(await call('GET', `/spa/availability?serviceId=${spa.massage.id}&day=${D(3)}`, DESK)), '10:00'), true, 'Elif boş');
    fail(await call('POST', '/spa/blocks', MANAGER, { ...block, startsAt: `${D(1)}T15:00`, endsAt: `${D(1)}T17:00` }), 409, 'SPA_BLOCK_CONFLICT', /randevu \/ ders var/);
    fail(await call('POST', '/spa/blocks', MANAGER, block), 409, 'SPA_BLOCK_CONFLICT', /zaten bir blok/);
    assert.equal(json(await call('GET', `/spa/blocks?from=${D(3)}&to=${D(3)}`, DESK)).items.length, 1);
    json(await call('DELETE', `/spa/blocks/${created.id}`, MANAGER));
    assert.equal(slot(json(await call('GET', `/spa/availability?serviceId=${spa.massage.id}&day=${D(3)}&therapistId=${spa.murat.id}`, DESK)), '10:00'), true);
  });

  /* ══════════════════ Yaşam döngüsü ══════════════════ */

  it('oteldeki misafir: yeniden planlama, sürüm kilidi, tamamlama odaya yazar ve folyo kalemi spa olarak işlenir', async () => {
    const stay = await seedStay();
    const booked = await book({ reservationId: stay.id, note: 'Bel bölgesine dikkat' });
    assert.deepEqual([booked.status, booked.price, booked.priceTotal, booked.balance, booked.inHouse], ['BOOKED', '2500.00', '2500.00', '0.00', true]);
    assert.equal(booked.cancelFee.total, '0.00', 'randevuya 4 saatten fazla var');
    // Onay bildirimi misafirin diline ve randevunun bilgisine göre kuyruğa girer.
    const notice = await db.notification.findFirst({ where: { hotelId, reservationId: stay.id, source: 'SPA_BOOKED' } });
    assert.equal(notice.language, 'en');
    assert.match(notice.body, /Aromaterapi Masajı/);
    assert.match(notice.body, /10:00/);

    // Yeniden planlama: aynı terapist ve oda yeni saatte; yeni saatle ikinci bildirim.
    const moved = json(await call('PUT', `/spa/appointments/${booked.id}`, DESK, { expectedUpdatedAt: booked.updatedAt, startsAt: `${D(1)}T11:00` })).appointment;
    assert.deepEqual([moved.time, moved.endTime, moved.therapists[0].id, moved.room.id], ['11:00', '12:00', booked.therapists[0].id, booked.room.id]);
    assert.equal(await db.notification.count({ where: { hotelId, reservationId: stay.id, source: 'SPA_BOOKED' } }), 2);
    fail(await call('PUT', `/spa/appointments/${booked.id}`, DESK, { expectedUpdatedAt: booked.updatedAt, note: 'Bayat' }), 409, 'STALE_WRITE');
    // Terapisti değiştir; dolu saate taşıma reddedilir (randevu yerinde kalır).
    const other = await book({ customerName: 'Başka Misafir', startsAt: `${D(1)}T14:00`, therapistIds: [spa.murat.id] });
    const swapped = json(await call('PUT', `/spa/appointments/${booked.id}`, DESK, { expectedUpdatedAt: moved.updatedAt, therapistIds: [spa.murat.id] })).appointment;
    assert.equal(swapped.therapists[0].name, 'Murat Demir');
    fail(await call('PUT', `/spa/appointments/${booked.id}`, DESK, { expectedUpdatedAt: swapped.updatedAt, startsAt: `${D(1)}T14:30` }), 409, 'SPA_SLOT_TAKEN');
    assert.equal((await fresh(booked.id)).time, '11:00');
    // Konaklamaya bağlı randevuda ad elle değişmez.
    fail(await call('PUT', `/spa/appointments/${booked.id}`, DESK, { expectedUpdatedAt: swapped.updatedAt, customerName: 'Takma Ad' }), 422, 'VALIDATION');

    // Saati gelmeden tamamlanmaz; gelince odaya yazılarak tamamlanır.
    fail(await call('POST', `/spa/appointments/${booked.id}/complete`, DESK, { expectedUpdatedAt: swapped.updatedAt, settle: 'ROOM' }), 409, 'SPA_NOT_STARTED');
    const done = await complete(swapped, 'ROOM', '12:05');
    assert.deepEqual([done.appointment.status, done.appointment.totalDue, done.appointment.roomChargeTotal, done.appointment.balance, done.appointment.completedBy], ['COMPLETED', '2500.00', '2500.00', '0.00', DESK]);
    assert.equal(done.roomCharges[0].roomNumber, '101');

    const event = await lastEvent('spa.charged');
    assert.deepEqual([event.payload.reservationId, event.payload.reference], [stay.id, booked.code]);
    assert.deepEqual(event.payload.items, [{ description: 'Spa · Aromaterapi Masajı', unitPrice: '2500.00', quantity: 1, taxCategory: 'SPA' }]);
    // Folyo aktörünün işi (uygulama içinde zaten çalıştıysa tekrar işleme tek yazar).
    await as('billing-worker', () => folios.postExternalCharge(hotelId, event.payload, { source: 'SPA', eventId: event.id }));
    const items = await db.folioItem.findMany({ where: { hotelId, sourceKey: { startsWith: `evt:${event.id}:` } } });
    assert.deepEqual(items.map((row) => [row.type, row.source, row.taxCategory, String(row.total), String(row.taxAmount)]), [['SPA', 'SPA', 'SPA', '2500', '416.67']]);
    assert.equal((await detail(booked.id)).roomCharges[0].posting.status, 'POSTED');

    // Kapanmış ve odaya yazılmış randevu: tahsilat, ikinci yazma, geri alma ve düzenleme yok.
    fail(await pay(booked.id, { amount: '100' }), 422, 'VALIDATION', /ödenecek bakiyesi yok/);
    const closed = await fresh(booked.id);
    fail(await call('POST', `/spa/appointments/${booked.id}/room-charge`, DESK, { requestId: randomUUID(), expectedUpdatedAt: closed.updatedAt }), 409, 'SPA_ROOM_CHARGE', /zaten yazıldı/);
    fail(await call('POST', `/spa/appointments/${booked.id}/restore`, DESK, { expectedUpdatedAt: closed.updatedAt }), 409, 'SPA_RESTORE', /odaya yazılmış/);
    // Ekran geri alma düğmesini aynı engelle kapatır.
    assert.match((await detail(booked.id)).summary.restoreBlock, /odaya yazılmış/);
    fail(await call('PUT', `/spa/appointments/${booked.id}`, DESK, { expectedUpdatedAt: closed.updatedAt, note: 'Geç not' }), 409, 'SPA_NOT_OPEN');
    // Tamamlanan randevu takvimde kalır (saat kullanıldı); terapist o saatte boş görünmez.
    assert.equal(await db.spaHold.count({ where: { appointmentId: booked.id, active: true } }), 2);
    assert.equal((await fresh(other.id)).status, 'BOOKED');
  });

  it('hariç vergide misafirin ödediği toplam folyodaki toplamla aynıdır; kasada ödenecek denmiş borç sonradan odaya yazılır', async () => {
    await db.tax.deleteMany({ where: { hotelId } });
    await db.tax.create({ data: { hotelId, name: 'VAT', rate: '10', isIncluded: false, appliesTo: ['SPA'] } });
    cache.cache.invalidatePrefix('settings:');
    const stay = await seedStay();
    const booked = await book({ reservationId: stay.id });
    assert.deepEqual([booked.price, booked.priceTotal], ['2500.00', '2750.00']);
    const done = await complete(booked, 'DESK', '11:05');
    assert.deepEqual([done.appointment.amountDue, done.appointment.totalDue, done.appointment.roomChargeTotal, done.appointment.balance], ['2500.00', '2750.00', '0.00', '2750.00']);
    assert.equal(done.summary.payable, '2750.00');

    // Misafir fikir değiştirdi: odaya yazılsın. Aynı istek ikinci kez yazmaz.
    const requestId = randomUUID();
    const charged = json(await call('POST', `/spa/appointments/${booked.id}/room-charge`, DESK, { requestId, expectedUpdatedAt: done.appointment.updatedAt }));
    assert.deepEqual([charged.appointment.roomChargeTotal, charged.appointment.balance], ['2750.00', '0.00']);
    json(await call('POST', `/spa/appointments/${booked.id}/room-charge`, DESK, { requestId, expectedUpdatedAt: done.appointment.updatedAt }));
    assert.equal(await db.spaRoomCharge.count({ where: { appointmentId: booked.id } }), 1);
    const event = await lastEvent('spa.charged');
    assert.equal(event.payload.items[0].unitPrice, '2500.00', 'folyoya esas tutar gider');
    await as('billing-worker', () => folios.postExternalCharge(hotelId, event.payload, { source: 'SPA', eventId: event.id }));
    const [item] = await db.folioItem.findMany({ where: { hotelId, sourceKey: { startsWith: `evt:${event.id}:` } } });
    assert.equal(String(item.total), '2750', 'folyonun toplamı randevunun toplamına eşit');
  });

  /* ══════════════════ İptal, gelmedi, geri alma ══════════════════ */

  it('iptal ve gelmedi: süresinde bedelsiz; geç iptal %50 ve gelmedi %100 odaya yazılır; bedeli yalnız yetkili siler', async () => {
    const stay = await seedStay();
    const at = { startsAt: `${D(1)}T15:00`, reservationId: stay.id };

    // Süresinde iptal (6 saat önce): bedel yok, yer açılır.
    const early = await book(at);
    const freed = await close(early, 'CANCELLED', '09:00');
    assert.deepEqual([freed.appointment.status, freed.appointment.feePct, freed.appointment.totalDue, freed.appointment.balance, freed.appointment.cancelReason], ['CANCELLED', '0.00', '0.00', '0.00', 'Misafir haber verdi']);
    assert.equal(await db.spaHold.count({ where: { appointmentId: early.id, active: true } }), 0);
    assert.equal(await db.spaRoomCharge.count({ where: { hotelId } }), 0);

    // Geç iptal (2 saat önce): %50, içerideki misafirin odasına.
    const late = await book(at);
    assert.equal(late.therapists[0].id, early.therapists[0].id, 'açılan yer yeniden verildi');
    const charged = await close(late, 'CANCELLED', '13:00');
    assert.deepEqual([charged.appointment.feePct, charged.appointment.amountDue, charged.appointment.roomChargeTotal, charged.appointment.balance], ['50.00', '1250.00', '1250.00', '0.00']);
    assert.match((await lastEvent('spa.charged')).payload.items[0].description, /Spa geç iptal bedeli · Aromaterapi Masajı/);

    // Bedeli silmek: ön büronun yetkisi yok; müdür gerekçeyle siler (oran kayıtta kalır, borç doğmaz).
    const waived = await book(at);
    fail(await call('POST', `/spa/appointments/${waived.id}/cancel`, DESK, { expectedUpdatedAt: waived.updatedAt, reason: 'Misafir hastalandı', waiveFee: true, waiveReason: 'Sağlık sorunu' }), 403);
    const forgiven = await close(waived, 'CANCELLED', '14:00', { waiveFee: true, waiveReason: 'Sağlık sorunu, doktor raporu' });
    assert.deepEqual([forgiven.appointment.feePct, forgiven.appointment.amountDue, forgiven.appointment.feeWaivedBy, forgiven.appointment.feeWaiveReason], ['50.00', '0.00', MANAGER, 'Sağlık sorunu, doktor raporu']);
    assert.equal(await db.spaRoomCharge.count({ where: { appointmentId: waived.id } }), 0);

    // Gelmedi: saati gelmeden işaretlenmez; gelince %100 odaya.
    const missed = await book(at);
    fail(await call('POST', `/spa/appointments/${missed.id}/no-show`, DESK, { expectedUpdatedAt: missed.updatedAt, reason: 'Gelmedi' }), 409, 'SPA_NOT_STARTED');
    const noShow = await close(missed, 'NO_SHOW', '15:20');
    assert.deepEqual([noShow.appointment.status, noShow.appointment.feePct, noShow.appointment.roomChargeTotal], ['NO_SHOW', '100.00', '2500.00']);
    assert.match((await lastEvent('spa.charged')).payload.items[0].description, /gelmedi bedeli/);
    // Kapanmış randevu yeniden kapatılamaz.
    await rejectsWith(close(await fresh(missed.id), 'CANCELLED', '15:30'), 'SPA_NOT_OPEN');

    // Dışarıdan gelen gelmedi: borç bakiyede kalır, "açık bakiyeler"de görünür, odaya yazılamaz, kasada kapanır.
    const outsider = await book({ customerName: 'Kerem Aydın', startsAt: `${D(1)}T16:30` });
    const owed = await close(outsider, 'NO_SHOW', '16:45');
    assert.deepEqual([owed.appointment.totalDue, owed.appointment.roomChargeTotal, owed.appointment.balance], ['2500.00', '0.00', '2500.00']);
    const range = `from=${D(0)}&to=${D(2)}`;
    assert.deepEqual(json(await call('GET', `/spa/appointments?${range}&view=OPEN_BALANCE`, ACCOUNTANT)).items.map((row) => row.id), [outsider.id]);
    fail(await call('POST', `/spa/appointments/${outsider.id}/room-charge`, DESK, { requestId: randomUUID(), expectedUpdatedAt: owed.appointment.updatedAt }), 422, 'VALIDATION', /oda hesabı yok/);
    assert.equal(json(await pay(outsider.id, { amount: '2500' }), 201).appointment.balance, '0.00');
    assert.equal(json(await call('GET', `/spa/appointments?${range}&view=OPEN_BALANCE`, ACCOUNTANT)).items.length, 0);

    // İşlem kaydı: bedel, oran ve silme gerekçesi.
    const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'SpaAppointment', entityId: waived.id, action: 'UPDATE' }, orderBy: { createdAt: 'desc' } });
    assert.deepEqual([audit.after.fee, audit.after.waived, audit.after.waiveReason], ['1250.00', true, 'Sağlık sorunu, doktor raporu']);
  });

  it('geri alma: para hareketi yoksa ve yer boşsa randevu yeniden açılır; saat başkasına verildiyse açılmaz', async () => {
    const stay = await seedStay();
    const first = await book({ serviceId: spa.hammam.id, reservationId: stay.id, startsAt: `${D(2)}T10:00` });
    const cancelled = await close(first, 'CANCELLED', '09:00');
    assert.equal(cancelled.summary.restoreBlock, null);
    const restored = json(await call('POST', `/spa/appointments/${first.id}/restore`, DESK, { expectedUpdatedAt: cancelled.appointment.updatedAt })).appointment;
    assert.deepEqual([restored.status, restored.cancelledAt, restored.cancelReason, restored.totalDue], ['BOOKED', null, null, '0.00']);
    assert.equal(await db.spaHold.count({ where: { appointmentId: first.id, active: true } }), 2);

    // Yeniden iptal, saat başkasına verilir: geri alınamaz.
    const again = await close(restored, 'CANCELLED', '09:30');
    const taker = await book({ serviceId: spa.hammam.id, customerName: 'Yerine Gelen', startsAt: `${D(2)}T10:30` });
    fail(await call('POST', `/spa/appointments/${first.id}/restore`, DESK, { expectedUpdatedAt: again.appointment.updatedAt }), 409, 'SPA_SLOT_TAKEN', /başka bir kayda verildi/);
    assert.equal((await fresh(first.id)).status, 'CANCELLED');
    assert.equal((await fresh(taker.id)).status, 'BOOKED');

    // Yanlışlıkla tamamlanan (kasada ödenecek denmiş, ödeme alınmamış) randevu geri alınır.
    const done = await complete(taker, 'DESK', '11:35', D(2));
    const back = json(await call('POST', `/spa/appointments/${taker.id}/restore`, DESK, { expectedUpdatedAt: done.appointment.updatedAt })).appointment;
    assert.deepEqual([back.status, back.completedAt, back.amountDue, back.balance], ['BOOKED', null, '0.00', '0.00']);
    // Ödemesi alınmış tamamlanmış randevu geri alınmaz.
    const paid = await complete(back, 'DESK', '11:40', D(2));
    json(await pay(taker.id, { amount: '1800' }), 201);
    fail(await call('POST', `/spa/appointments/${taker.id}/restore`, DESK, { expectedUpdatedAt: (await fresh(taker.id)).updatedAt }), 409, 'SPA_RESTORE', /ödemesi alınmış/);
    assert.equal(paid.appointment.status, 'COMPLETED');
  });

  /* ══════════════════ Fiyat ve kasa ══════════════════ */

  it('fiyat: elle belirlemek yetkili işi; ikram randevu borçsuz tamamlanır; kasada kapanan randevu sonradan düzeltilir, fazlası iade edilir', async () => {
    const stay = await seedStay();
    const booked = await book({ reservationId: stay.id });
    const body = { expectedUpdatedAt: booked.updatedAt, price: '0', reason: 'Balayı paketine dahil' };
    fail(await call('POST', `/spa/appointments/${booked.id}/price`, DESK, body), 403);
    fail(await call('POST', `/spa/appointments/${booked.id}/price`, MANAGER, { ...body, reason: '' }), 400, 'VALIDATION');
    const priced = json(await call('POST', `/spa/appointments/${booked.id}/price`, MANAGER, body)).appointment;
    assert.deepEqual([priced.listPrice, priced.price, priced.priceTotal, priced.priceReason, priced.priceBy], ['2500.00', '0.00', '0.00', 'Balayı paketine dahil', MANAGER]);
    const done = await complete(priced, 'ROOM', '11:10');
    assert.deepEqual([done.appointment.status, done.appointment.totalDue, done.appointment.balance], ['COMPLETED', '0.00', '0.00']);
    assert.equal(await db.spaRoomCharge.count({ where: { appointmentId: booked.id } }), 0, 'ikramda odaya yazılacak tutar yok');

    // Tamamlanmış, kasada ödenmiş randevu: şikâyet telafisi → borç yeni fiyattan, fazlası iade edilebilir (onaylı).
    const walkIn = await book({ customerName: 'Şikâyetçi Misafir', startsAt: `${D(1)}T14:00` });
    const served = await complete(walkIn, 'DESK', '15:10');
    json(await pay(walkIn.id, { amount: '2500' }), 201);
    const corrected = json(await call('POST', `/spa/appointments/${walkIn.id}/price`, MANAGER, { expectedUpdatedAt: served.appointment.updatedAt, price: '1750', reason: 'Masaj geç başladı' }));
    assert.deepEqual([corrected.appointment.amountDue, corrected.appointment.totalDue, corrected.appointment.paidTotal, corrected.appointment.balance], ['1750.00', '1750.00', '2500.00', '-750.00']);
    assert.equal(corrected.summary.refundable, '750.00');
    fail(await pay(walkIn.id, { kind: 'REFUND', amount: '750.01', note: 'Telafi' }), 422, 'VALIDATION', /En fazla 750\.00/);
    const refunded = json(await pay(walkIn.id, { kind: 'REFUND', amount: '750', note: 'Telafi' }), 201);
    assert.equal(refunded.payments.find((row) => row.kind === 'REFUND').status, 'PENDING', 'iade onaya gider');

    // Odaya yazılmış ücret folyodan düzeltilir; iptal / gelmedi bedeli fiyatla değişmez.
    const roomStay = await seedStay();
    const charged = await complete(await book({ reservationId: roomStay.id, startsAt: `${D(1)}T16:30` }), 'ROOM', '17:40');
    fail(await call('POST', `/spa/appointments/${charged.appointment.id}/price`, MANAGER, { expectedUpdatedAt: charged.appointment.updatedAt, price: '100', reason: 'Düzeltme' }), 409, 'SPA_ROOM_CHARGED');
    const cancelled = await close(await book({ customerName: 'İptal Eden', startsAt: `${D(2)}T10:00` }), 'CANCELLED', '09:00', {}, D(2));
    fail(await call('POST', `/spa/appointments/${cancelled.appointment.id}/price`, MANAGER, { expectedUpdatedAt: cancelled.appointment.updatedAt, price: '100', reason: 'Düzeltme' }), 409, 'SPA_NOT_OPEN');
  });

  it('spa kasası: ön ödeme ve sınırlar, büyük ödeme ve iade dört göz onaylı, hatalı girişin iptali, kasada "Spa" kaynağı', async () => {
    const couple = await book({ serviceId: spa.couple.id, customerName: 'Selin Aksoy', customerPhone: '+90 532 111 22 33', startsAt: `${D(1)}T12:00` });
    assert.deepEqual([couple.guestCount, couple.price, couple.therapists.length, couple.room.name], [2, '4800.00', 2, 'Bakım Odası 2']);

    // Yetki: ön büro tahsilat alamaz; muhasebe görür ama alamaz.
    fail(await pay(couple.id, { amount: '1000' }, DESK), 403);
    fail(await pay(couple.id, { amount: '1000' }, ACCOUNTANT), 403);
    assert.equal((await detail(couple.id, ACCOUNTANT)).appointment.code, couple.code);

    // Ön ödeme: fiyata kadar; kartta slip zorunlu; aynı istek ikinci kez tahsil edilmez.
    const requestId = randomUUID();
    const advance = json(await pay(couple.id, { requestId, amount: '1000' }), 201);
    assert.deepEqual([advance.appointment.paidTotal, advance.summary.payable, advance.payments[0].status], ['1000.00', '3800.00', 'POSTED']);
    assert.equal((await pay(couple.id, { requestId, amount: '1000' })).statusCode, 200);
    assert.equal(await db.spaPayment.count({ where: { appointmentId: couple.id } }), 1);
    const over = fail(await pay(couple.id, { amount: '3800.01' }), 422, 'VALIDATION', /En fazla 3800\.00/);
    assert.ok(over.fields.amount);
    fail(await pay(couple.id, { amount: '500', method: 'CARD' }), 400, 'VALIDATION');

    // Kasada ödeme alınmış randevu odaya yazılmaz; kasada kapanır.
    await rejectsWith(complete(couple, 'ROOM', '13:05'), 'SPA_ROOM_CHARGE', /kasada ödeme alınmış/);
    const done = await complete(await fresh(couple.id), 'DESK', '13:05');
    assert.deepEqual([done.appointment.totalDue, done.appointment.paidTotal, done.appointment.balance], ['4800.00', '1000.00', '3800.00']);
    const settled = json(await pay(couple.id, { amount: '3800', method: 'CARD', reference: 'SLIP-00412' }), 201);
    assert.deepEqual([settled.appointment.paidTotal, settled.appointment.balance], ['4800.00', '0.00']);

    // Hatalı girişin iptali: onaya gider, ikinci istek reddedilir, onaylanınca ters kayıt yazılır.
    const cashRow = settled.payments.find((row) => row.method === 'CASH');
    const voiding = json(await call('POST', `/spa/appointments/${couple.id}/payments/${cashRow.id}/void`, MANAGER, { reason: 'Tutar yanlış girildi' }));
    const pendingVoid = voiding.payments.find((row) => row.id === cashRow.id);
    assert.equal(pendingVoid.voidPending, true);
    fail(await call('POST', `/spa/appointments/${couple.id}/payments/${cashRow.id}/void`, MANAGER, { reason: 'Tekrar istek' }), 409, 'PAYMENT_RULE');
    await rejectsWith(as(MANAGER, () => approvals.decideApproval(hotelId, pendingVoid.voidApprovalId, 'GRANTED')), 'SELF_DECISION');
    await as(MANAGER2, () => approvals.decideApproval(hotelId, pendingVoid.voidApprovalId, 'GRANTED'));
    const reversal = await db.spaPayment.findFirst({ where: { reversalOfId: cashRow.id } });
    assert.deepEqual([reversal.kind, String(reversal.amount), reversal.receivedBy], ['REVERSAL', '-1000', MANAGER]);
    assert.deepEqual([(await fresh(couple.id)).paidTotal, (await fresh(couple.id)).balance], ['3800.00', '1000.00']);

    // Büyük ödeme: eşik üstü onaya gider; onaylanana kadar randevuya girmez.
    const vip = await book({ customerName: 'Büyük Müşteri', startsAt: `${D(1)}T15:00` });
    const priced = json(await call('POST', `/spa/appointments/${vip.id}/price`, MANAGER, { expectedUpdatedAt: vip.updatedAt, price: '30000', reason: 'Özel program' })).appointment;
    const large = json(await pay(vip.id, { amount: '30000' }), 201);
    const pending = large.payments[0];
    assert.deepEqual([pending.status, large.appointment.paidTotal, large.summary.payable], ['PENDING', '0.00', '0.00']);
    await rejectsWith(as(MANAGER, () => approvals.decideApproval(hotelId, pending.approvalId, 'GRANTED')), 'SELF_DECISION');
    await as(MANAGER2, () => approvals.decideApproval(hotelId, pending.approvalId, 'GRANTED', { note: 'Para sayıldı' }));
    assert.equal((await fresh(vip.id)).paidTotal, '30000.00');
    const decided = await db.staffAlert.findFirst({ where: { hotelId, dedupeKey: `approval-decided:${pending.approvalId}` } });
    assert.deepEqual([decided.userId, decided.link], [await userId(MANAGER), `/spa/randevular/${vip.id}`]);
    assert.equal(json(await call('GET', `/spa/payments/${pending.id}/appointment`, MANAGER2)).appointmentId, vip.id);

    // Süresinde iptal: ön ödemenin tamamı iade edilebilir; iade her zaman onaylı; reddedilen işlenmez.
    const cancelled = await close(priced.updatedAt ? await fresh(vip.id) : vip, 'CANCELLED', '09:00');
    assert.deepEqual([cancelled.appointment.totalDue, cancelled.appointment.balance, cancelled.summary.refundable], ['0.00', '-30000.00', '30000.00']);
    fail(await pay(vip.id, { kind: 'REFUND', amount: '30000.01', note: 'İptal iadesi' }), 422, 'VALIDATION', /En fazla 30000\.00/);
    fail(await pay(vip.id, { kind: 'REFUND', amount: '30000' }), 400, 'VALIDATION');
    const refund = json(await pay(vip.id, { kind: 'REFUND', amount: '30000', note: 'İptal iadesi' }), 201);
    const refundRow = refund.payments.find((row) => row.kind === 'REFUND');
    assert.deepEqual([refundRow.status, refundRow.amount, refund.summary.refundable], ['PENDING', '-30000.00', '0.00']);
    await as(MANAGER2, () => approvals.decideApproval(hotelId, refundRow.approvalId, 'DENIED', { note: 'Önce müşteriyle görüşülecek' }));
    assert.equal((await db.spaPayment.findFirst({ where: { id: refundRow.id } })).status, 'DECLINED');
    const second = json(await pay(vip.id, { kind: 'REFUND', amount: '30000', note: 'İptal iadesi' }), 201).payments.find((row) => row.status === 'PENDING');
    await as(MANAGER2, () => approvals.decideApproval(hotelId, second.approvalId, 'GRANTED'));
    assert.deepEqual([(await fresh(vip.id)).paidTotal, (await fresh(vip.id)).balance], ['0.00', '0.00']);

    // Kasa ekranı: "Spa" kaynağının neti ve hareketleri (randevu numarasıyla).
    const summary = await as(MANAGER, () => cash.getCashSummary(hotelId, { mine: false }));
    assert.equal(summary.origins.SPA, '3800.00', '1000 + 3800 − 1000 + 30000 − 30000');
    assert.equal(summary.origins.FOLIO, '0.00');
    const movements = await as(MANAGER, () => cash.listCashMovements(hotelId, { mine: false, origin: 'SPA', limit: 50 }));
    assert.equal(movements.movements.length, 5);
    assert.ok(movements.movements.every((row) => row.origin === 'SPA' && row.spa.code.startsWith('SPA-')));
    assert.equal(json(await call('GET', '/payments/cash/movements?origin=SPA', ACCOUNTANT)).movements.length, 5);
    // Muhasebe aktörünün olayı: işlenen her satır için.
    assert.ok((await db.eventLog.count({ where: { hotelId, name: 'spa.payment.changed' } })) >= 8);
  });

  /* ══════════════════ Grup dersi ══════════════════ */

  it('grup dersi: tekrar çakışan günü atlar; kontenjan, yedek liste ve asıla geçiş; saat değişimi; toplu tamamlama odaya yazar', async () => {
    // Eğitmenin 2. gün izni var: o günün seansı atlanır, diğerleri açılır.
    json(await call('POST', '/spa/blocks', MANAGER, { therapistId: spa.deniz.id, startsAt: `${D(2)}T09:00`, endsAt: `${D(2)}T12:00`, reason: 'Eğitim' }), 201);
    const input = { serviceId: spa.yoga.id, startsAt: `${D(1)}T09:00`, repeat: { weekdays: [1, 2, 3, 4, 5, 6, 7], until: D(3) } };
    fail(await call('POST', '/spa/sessions', DESK, input), 403);
    const opened = json(await call('POST', '/spa/sessions', MANAGER, input), 201);
    assert.deepEqual(opened.created.map((row) => row.day), [D(1), D(3)]);
    assert.deepEqual(opened.skipped.map((row) => row.day), [D(2)]);
    assert.match(opened.skipped[0].message, /uygun terapist yok/);
    // Birebir hizmete seans, grup dersine randevu açılmaz.
    fail(await call('POST', '/spa/sessions', MANAGER, { serviceId: spa.massage.id, startsAt: `${D(1)}T12:00` }), 422, 'VALIDATION', /grup dersi değil/);
    fail(await book({ serviceId: spa.yoga.id, customerName: 'Yanlış Kayıt' }, DESK, 422), 422, 'VALIDATION', /seansına kayıt/);

    const [first, third] = opened.created;
    const list = json(await call('GET', `/spa/sessions?from=${D(0)}&to=${D(5)}`, DESK));
    assert.deepEqual(list.items.map((row) => [row.day, row.time, row.free, row.instructor.name, row.room.name]), [
      [D(1), '09:00', 3, 'Deniz Arslan', 'Yoga Stüdyosu'],
      [D(3), '09:00', 3, 'Deniz Arslan', 'Yoga Stüdyosu'],
    ]);
    // Eğitmen dersteyken birebir randevu alamaz (aynı tutma tablosu).
    assert.equal(await db.spaHold.count({ where: { sessionId: first.id, active: true } }), 2);

    const anna = await seedStay();
    const berta = await seedStay({ lastName: 'Schmidt' });
    const enroll = async (sessionId, body, email = DESK) => call('POST', `/spa/sessions/${sessionId}/enroll`, email, { requestId: randomUUID(), guestCount: 1, ...body });
    const family = json(await enroll(first.id, { reservationId: anna.id, guestCount: 2 }), 201);
    assert.deepEqual([family.waitlisted, family.session.bookedCount, family.session.free], [false, 2, 1]);
    json(await enroll(first.id, { customerName: 'Dış Katılımcı' }), 201);
    // Dolu: yedek istenmediyse reddedilir; istendiyse yedeğe yazılır; aynı konaklama ikinci kez kaydolamaz.
    fail(await enroll(first.id, { reservationId: berta.id }), 409, 'SPA_SESSION_FULL', /Ders dolu/);
    const waiting = json(await enroll(first.id, { reservationId: berta.id, waitlist: true }), 201);
    assert.deepEqual([waiting.waitlisted, waiting.session.bookedCount, waiting.session.waitlistCount], [true, 3, 1]);
    fail(await enroll(first.id, { reservationId: anna.id }), 409, 'SPA_ALREADY_ENROLLED');
    assert.equal(await db.notification.count({ where: { hotelId, reservationId: berta.id, source: 'SPA_BOOKED' } }), 0, 'yedeğe onay gitmez');
    // Yedek kayıttan ödeme alınmaz.
    fail(await pay(waiting.appointmentId, { amount: '400' }), 422, 'VALIDATION', /Yedek listedeki/);

    // Asıl listeden biri iptal eder: yedekteki asıla geçer, spa'ya zil ve misafire onay gider.
    const session = json(await call('GET', `/spa/sessions/${first.id}`, DESK));
    const outsider = session.enrollments.find((row) => row.customerName === 'Dış Katılımcı');
    json(await call('POST', `/spa/appointments/${outsider.id}/cancel`, DESK, { expectedUpdatedAt: outsider.updatedAt, reason: 'Gelemeyecek' }));
    const promoted = await fresh(waiting.appointmentId);
    assert.equal(promoted.status, 'BOOKED');
    assert.equal((await db.staffAlert.findFirst({ where: { hotelId, dedupeKey: `spa-promoted:${waiting.appointmentId}` } })).kind, 'SPA');
    assert.equal(await db.notification.count({ where: { hotelId, reservationId: berta.id, source: 'SPA_BOOKED' } }), 1);
    let current = json(await call('GET', `/spa/sessions/${first.id}`, DESK)).session;
    assert.deepEqual([current.bookedCount, current.waitlistCount], [3, 0]);

    // Seansı düzenle: kontenjan asıl listenin altına inemez; saat değişince kayıtlar da taşınır.
    fail(await call('PUT', `/spa/sessions/${first.id}`, MANAGER, { expectedUpdatedAt: current.updatedAt, capacity: 2 }), 422, 'VALIDATION', /3 kişi var/);
    current = json(await call('PUT', `/spa/sessions/${first.id}`, MANAGER, { expectedUpdatedAt: current.updatedAt, startsAt: `${D(1)}T10:00`, note: 'Bahçede' })).session;
    assert.deepEqual([current.time, current.endTime, current.note], ['10:00', '11:00', 'Bahçede']);
    assert.equal((await fresh(family.appointmentId)).time, '10:00');
    fail(await call('PUT', `/spa/sessions/${first.id}`, MANAGER, { expectedUpdatedAt: opened.created[0].updatedAt ?? new Date(0).toISOString(), note: 'Bayat' }), 409, 'STALE_WRITE');

    // Tamamlama: saati gelmeden olmaz; gelince asıl listedekilerin ücreti odalarına yazılır; yinelenince iş kalmaz.
    fail(await call('POST', `/spa/sessions/${first.id}/complete`, DESK, { expectedUpdatedAt: current.updatedAt }), 409, 'SPA_NOT_STARTED');
    const finished = await as(DESK, () => sessions.completeSpaSession(hotelId, first.id, { expectedUpdatedAt: new Date(current.updatedAt) }, { now: wall(D(1), '11:05') }));
    assert.deepEqual([finished.session.status, finished.completed, finished.charged, finished.pending, finished.failed.length], ['COMPLETED', 2, 2, 0, 0]);
    assert.deepEqual([(await fresh(family.appointmentId)).roomChargeTotal, (await fresh(waiting.appointmentId)).roomChargeTotal], ['800.00', '400.00']);
    const repeat = await as(DESK, () => sessions.completeSpaSession(hotelId, first.id, { expectedUpdatedAt: new Date(0) }, { now: wall(D(1), '11:10') }));
    assert.deepEqual([repeat.completed, repeat.pending], [0, 0]);

    // Seans iptali: kayıtlar bedelsiz kapanır, ön ödemesi olan iade bekler, eğitmen ve salon boşalır.
    const prepaid = json(await enroll(third.id, { customerName: 'Ön Ödemeli Misafir' }), 201);
    json(await pay(prepaid.appointmentId, { amount: '400' }), 201);
    json(await enroll(third.id, { reservationId: anna.id }), 201);
    fail(await call('POST', `/spa/sessions/${third.id}/cancel`, DESK, { expectedUpdatedAt: prepaid.session.updatedAt, reason: 'Eğitmen hasta' }), 403);
    const thirdNow = json(await call('GET', `/spa/sessions/${third.id}`, DESK)).session;
    const cancelled = json(await call('POST', `/spa/sessions/${third.id}/cancel`, MANAGER, { expectedUpdatedAt: thirdNow.updatedAt, reason: 'Eğitmen hasta' }));
    assert.deepEqual([cancelled.session.status, cancelled.closed, cancelled.prepaid, cancelled.session.bookedCount], ['CANCELLED', 2, 1, 0]);
    const refundable = await fresh(prepaid.appointmentId);
    assert.deepEqual([refundable.status, refundable.totalDue, refundable.balance], ['CANCELLED', '0.00', '-400.00']);
    assert.match(refundable.cancelReason, /Seans iptal edildi: Eğitmen hasta/);
    assert.equal(await db.spaHold.count({ where: { sessionId: third.id, active: true } }), 0);
    assert.match((await db.staffAlert.findFirst({ where: { hotelId, dedupeKey: `spa-session-cancelled:${third.id}` } })).body, /2 kayıt bedelsiz kapandı.*1 kaydın ön ödemesi/);
    // İptal edilen seansa kayıt alınmaz.
    fail(await enroll(third.id, { customerName: 'Geç Kalan' }), 409, 'SPA_NOT_OPEN');
  });

  /* ══════════════════ Misafir portalı ══════════════════ */

  it('portal: yalnız konaklama günlerine ve boş saatlere anında randevu; sınırlar; iptal; personel alanları sızmaz', async () => {
    const stay = await seedStay();
    const link = json(await call('POST', `/guest-portal/links/${stay.id}`, DESK));
    const token = link.link.path.split('/').pop();
    const base = `/public/portal/${token}`;

    // Otel açana kadar kapalı.
    assert.equal(json(await open('GET', base)).features.spa, false);
    assert.equal(json(await open('GET', `${base}/spa`)).enabled, false);
    fail(await open('POST', `${base}/spa/appointments`, { requestId: randomUUID(), serviceId: spa.massage.id, day: D(1), time: '10:00' }), 409, 'SPA_PORTAL_CLOSED');
    const settings = { openTime: '09:00', closeTime: '22:00', slotMinutes: 15, freeCancelHours: 4, lateCancelFeePct: '50', noShowFeePct: '100', portalEnabled: true, portalLeadMinutes: 120, portalMaxActive: 2, reminderHours: 2 };
    json(await call('PUT', '/spa/settings', MANAGER, { ...settings, expectedUpdatedAt: null }));

    assert.equal(json(await open('GET', base)).features.spa, true);
    const page = json(await open('GET', `${base}/spa`));
    assert.equal(page.enabled, true);
    assert.deepEqual(page.window, { from: D(0), to: D(4) });
    assert.deepEqual(page.policy, { freeCancelHours: 4, lateCancelFeePct: '50.00', noShowFeePct: '100.00', leadMinutes: 120, maxActive: 2 });
    const massage = page.services.find((row) => row.id === spa.massage.id);
    assert.deepEqual([massage.texts.en.name, massage.texts.ru.name, massage.priceTotal], ['Aromatherapy Massage', 'Aromaterapi Masajı', '2500.00']);
    assert.equal(page.services.find((row) => row.id === spa.couple.id).priceTotal, '4800.00', 'çift masajında iki kişinin toplamı');

    // Boş saatler: yalnız boş olanlar; konaklama dışındaki gün reddedilir.
    await book({ serviceId: spa.hammam.id, customerName: 'Başka Misafir', startsAt: `${D(1)}T10:00` });
    const times = json(await open('GET', `${base}/spa/availability?serviceId=${spa.hammam.id}&day=${D(1)}`)).times;
    assert.ok(!times.includes('10:00') && !times.includes('11:00') && times.includes('11:15'));
    fail(await open('GET', `${base}/spa/availability?serviceId=${spa.hammam.id}&day=${D(6)}`), 422, 'VALIDATION', /konaklama günlerinize/);

    // Randevu anında kesinleşir: kaynak portal, spa'ya zil, misafire onay; aynı istek ikinci randevu açmaz.
    const requestId = randomUUID();
    const body = { requestId, serviceId: spa.massage.id, day: D(1), time: '14:00', gender: 'FEMALE', note: 'Hafif baskı' };
    const booked = json(await open('POST', `${base}/spa/appointments`, body), 201);
    assert.deepEqual([booked.appointment.status, booked.appointment.time, booked.appointment.priceTotal, booked.appointment.canCancel, booked.appointment.cancelFee], ['BOOKED', '14:00', '2500.00', true, null]);
    assert.equal((await open('POST', `${base}/spa/appointments`, body)).statusCode, 200);
    const row = await db.spaAppointment.findFirst({ where: { id: booked.appointment.id }, include: { holds: { include: { therapist: true } } } });
    assert.deepEqual([row.source, row.reservationId, row.roomNumber, row.therapistPreference, row.createdBy], ['PORTAL', stay.id, '101', 'FEMALE', `misafir · ${stay.confirmationCode}`]);
    assert.equal(row.holds.find((hold) => hold.therapistId).therapist.name, 'Elif Kaya', 'kadın terapist tercihi');
    assert.equal((await db.staffAlert.findFirst({ where: { hotelId, dedupeKey: `spa-booked:${row.id}` } })).kind, 'SPA');
    assert.equal(await db.notification.count({ where: { hotelId, reservationId: stay.id, source: 'SPA_BOOKED' } }), 1);
    // Misafire terapistin adı, personel notu ve kim açtığı gitmez.
    assert.deepEqual(Object.keys(booked.appointment).filter((key) => ['therapists', 'note', 'createdBy', 'priceReason', 'customerPhone'].includes(key)), []);

    // Sınırlar: dolu saat, hizmete kapalı portal, en fazla açık randevu.
    fail(await open('POST', `${base}/spa/appointments`, { requestId: randomUUID(), serviceId: spa.hammam.id, day: D(1), time: '10:00' }), 409, 'SPA_SLOT_TAKEN');
    json(await open('POST', `${base}/spa/appointments`, { requestId: randomUUID(), serviceId: spa.massage.id, day: D(2), time: '11:00' }), 201);
    fail(await open('POST', `${base}/spa/appointments`, { requestId: randomUUID(), serviceId: spa.massage.id, day: D(3), time: '11:00' }), 409, 'SPA_PORTAL_LIMIT', /en fazla 2/);

    // Başka konaklamanın bağlantısı bu randevuyu göremez / iptal edemez.
    const stranger = await seedStay({ lastName: 'Weber' });
    const strangerToken = json(await call('POST', `/guest-portal/links/${stranger.id}`, DESK)).link.path.split('/').pop();
    fail(await open('POST', `/public/portal/${strangerToken}/spa/appointments/${row.id}/cancel`), 404);
    assert.equal(json(await open('GET', `/public/portal/${strangerToken}/spa`)).appointments.length, 0);

    // Misafir iptal eder (süresinde: bedelsiz); yer açılır, spa'ya zil düşer.
    const cancelled = json(await open('POST', `${base}/spa/appointments/${row.id}/cancel`));
    assert.deepEqual([cancelled.appointment.status, cancelled.appointment.totalDue, cancelled.appointment.canCancel], ['CANCELLED', '0.00', false]);
    assert.equal((await db.spaAppointment.findFirst({ where: { id: row.id } })).cancelledBy, `misafir · ${stay.confirmationCode}`);
    assert.ok(await db.staffAlert.findFirst({ where: { hotelId, dedupeKey: `spa-cancelled:${row.id}` } }));
    fail(await open('POST', `${base}/spa/appointments/${row.id}/cancel`), 409, 'SPA_NOT_OPEN');

    // Ders: portaldan kayıt; dolu derse yedek; sayfada kayıt durumu.
    const session = json(await call('POST', '/spa/sessions', MANAGER, { serviceId: spa.yoga.id, startsAt: `${D(2)}T09:00`, capacity: 1 }), 201).created[0];
    const enrolled = json(await open('POST', `${base}/spa/sessions/${session.id}/enroll`, { requestId: randomUUID(), guestCount: 1 }), 201);
    assert.deepEqual([enrolled.waitlisted, enrolled.appointment.kind, enrolled.appointment.priceTotal], [false, 'GROUP', '400.00']);
    fail(await open('POST', `/public/portal/${strangerToken}/spa/sessions/${session.id}/enroll`, { requestId: randomUUID(), guestCount: 1 }), 409, 'SPA_SESSION_FULL');
    assert.equal(json(await open('POST', `/public/portal/${strangerToken}/spa/sessions/${session.id}/enroll`, { requestId: randomUUID(), guestCount: 1, waitlist: true }), 201).waitlisted, true);
    const after = json(await open('GET', `${base}/spa`));
    assert.deepEqual(after.sessions.map((item) => [item.id, item.free, item.enrolled]), [[session.id, 0, 'BOOKED']]);
    assert.equal(after.activeCount, 2);

    // Portal kapatılınca randevu alınamaz; mevcut kayıtlar görünür ve iptal edilebilir.
    const saved = json(await call('GET', '/spa/settings', MANAGER)).settings;
    json(await call('PUT', '/spa/settings', MANAGER, { ...settings, portalEnabled: false, expectedUpdatedAt: saved.updatedAt }));
    const closedPage = json(await open('GET', `${base}/spa`));
    assert.deepEqual([closedPage.enabled, closedPage.services.length, closedPage.appointments.length], [false, 0, 3]);
    json(await open('POST', `${base}/spa/appointments/${enrolled.appointment.id}/cancel`));
    // Biçimsiz ve bilinmeyen bağlantı.
    fail(await open('GET', '/public/portal/x/spa'), 400);
    fail(await open('GET', `/public/portal/${randomUUID()}.${'A'.repeat(43)}/spa`), 404);
  });

  /* ══════════════════ Konaklama olayları ve hatırlatma ══════════════════ */

  it('konaklama olayları ve hatırlatma: iptal olan konaklamanın randevuları bedelsiz kapanır; çıkışta açık kayıt zile düşer; hatırlatma bir kez gider', async () => {
    const arriving = await seedStay({ status: 'CONFIRMED', lastName: 'Fischer' });
    const future = await book({ reservationId: arriving.id, startsAt: `${D(2)}T10:00` });
    assert.equal(future.roomNumber, null, 'gelmemiş misafirin odası yazılmaz');
    await db.reservation.update({ where: { id: arriving.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    const released = await subscribers.onStayEvent({ hotelId, reservationId: arriving.id }, { id: randomUUID(), name: 'reservation.cancelled' });
    assert.deepEqual(released, { closed: 1 });
    const closed = await fresh(future.id);
    assert.deepEqual([closed.status, closed.totalDue, closed.cancelReason, closed.cancelledBy], ['CANCELLED', '0.00', 'Konaklama iptal edildi', 'sistem · spa']);
    assert.equal(await db.spaHold.count({ where: { appointmentId: future.id, active: true } }), 0);
    assert.ok(await db.staffAlert.findFirst({ where: { hotelId, dedupeKey: `spa-stay-released:${future.id}` } }));
    // Aynı olay yeniden gelirse dokunulmaz.
    assert.deepEqual(await subscribers.onStayEvent({ hotelId, reservationId: arriving.id }, { id: randomUUID(), name: 'reservation.cancelled' }), { closed: 0 });

    // Çıkış: ödenmemiş spa borcu ve ileri tarihli randevu spa'ya haber verilir (randevulara dokunulmaz).
    const stay = await seedStay();
    const unpaid = await book({ reservationId: stay.id, startsAt: `${D(1)}T10:00` });
    await complete(unpaid, 'DESK', '11:05');
    const upcoming = await book({ reservationId: stay.id, startsAt: `${D(3)}T10:00` });
    await db.reservation.update({ where: { id: stay.id }, data: { status: 'CHECKED_OUT', checkedOutAt: new Date(), checkedOutBy: DESK } });
    assert.deepEqual(await subscribers.onStayEvent({ hotelId, reservationId: stay.id }, { id: randomUUID(), name: 'guest.checked_out' }), { alerted: true });
    const alert = await db.staffAlert.findFirst({ where: { hotelId, dedupeKey: `spa-checkout:${stay.id}` } });
    assert.deepEqual([alert.kind, alert.severity], ['SPA', 'WARNING']);
    assert.match(alert.body, new RegExp(`${unpaid.code} \\(2500\\.00\\).*${upcoming.code}`));
    assert.equal((await fresh(upcoming.id)).status, 'BOOKED');
    // Çıkmış misafire odaya yazılamaz.
    fail(await call('POST', `/spa/appointments/${unpaid.id}/room-charge`, DESK, { requestId: randomUUID(), expectedUpdatedAt: (await fresh(unpaid.id)).updatedAt }), 422, 'VALIDATION', /içeride değil/);

    // Hatırlatma: randevudan 2 saat önce, bir kez; sürümü ilerletmez; son anda alınan randevuya gitmez.
    const guest = await seedStay({ lastName: 'Keller' });
    const reminded = await book({ reservationId: guest.id, startsAt: `${D(1)}T14:00` });
    const lastMinute = await book({ reservationId: guest.id, startsAt: `${D(1)}T16:00` });
    await db.$executeRaw`UPDATE "SpaAppointment" SET "createdAt" = "startsAt" - interval '1 hour' WHERE "id" = ${lastMinute.id}`;
    const remind = (time) => as('sistem · spa', () => jobs.sendDueSpaReminders(hotelId, { now: wall(D(1), time) }));
    assert.equal(await remind('11:30'), 0, 'henüz erken');
    assert.equal(await remind('12:30'), 1);
    assert.equal(await remind('12:40'), 0, 'ikinci kez gitmez');
    assert.equal(await remind('14:30'), 0, 'son anda alınan randevuya hatırlatma yok');
    const sent = await db.notification.findMany({ where: { hotelId, reservationId: guest.id, source: 'SPA_REMINDER' } });
    assert.equal(sent.length, 1);
    assert.match(sent[0].body, /14:00/);
    assert.equal((await fresh(reminded.id)).updatedAt, reminded.updatedAt, 'hatırlatma randevunun sürümünü ilerletmez');
    // Hatırlatma ayarı 0: gönderilmez.
    const other = await book({ reservationId: guest.id, startsAt: `${D(2)}T14:00` });
    await db.spaSettings.create({ data: { hotelId, reminderHours: 0, updatedBy: MANAGER } });
    assert.equal(await as('sistem · spa', () => jobs.sendDueSpaReminders(hotelId, { now: wall(D(2), '13:00') })), 0);
    assert.equal(other.status, 'BOOKED');
  });

  /* ══════════════════ Liste, rapor, izinler ══════════════════ */

  it('liste, rapor ve izinler: süzgeçler ve sayılar; ciro, bedel, terapist payı; yetkisiz ve başka otel erişemez', async () => {
    const stay = await seedStay();
    const done = await book({ reservationId: stay.id, startsAt: `${D(1)}T10:00`, therapistIds: [spa.elif.id] });
    await complete(done, 'ROOM', '11:05');
    const couple = await book({ serviceId: spa.couple.id, customerName: 'Selin Aksoy', startsAt: `${D(1)}T12:00` });
    await complete(couple, 'DESK', '13:05');
    const missed = await book({ customerName: 'Kerem Aydın', startsAt: `${D(1)}T15:00`, therapistIds: [spa.murat.id] });
    await close(missed, 'NO_SHOW', '15:30');
    const cancelled = await book({ customerName: 'Vazgeçen Misafir', startsAt: `${D(1)}T16:30` });
    await close(cancelled, 'CANCELLED', '09:00');
    const open1 = await book({ customerName: 'Yarınki Misafir', startsAt: `${D(2)}T10:00` });

    // Liste: aralık, durum, terapist, hizmet, arama (numara, oda, ad) ve sayfalama.
    const range = `from=${D(0)}&to=${D(3)}`;
    const all = json(await call('GET', `/spa/appointments?${range}`, DESK));
    assert.equal(all.meta.total, 5);
    assert.deepEqual(all.counts, { COMPLETED: 2, NO_SHOW: 1, CANCELLED: 1, BOOKED: 1 });
    assert.deepEqual(all.items.map((row) => row.id), [done.id, couple.id, missed.id, cancelled.id, open1.id], 'başlangıç sırasıyla');
    const ids = async (query) => json(await call('GET', `/spa/appointments?${range}&${query}`, DESK)).items.map((row) => row.id);
    assert.deepEqual(await ids('status=COMPLETED'), [done.id, couple.id]);
    assert.deepEqual(await ids(`serviceId=${spa.couple.id}`), [couple.id]);
    assert.deepEqual(await ids(`therapistId=${spa.elif.id}&status=COMPLETED`), [done.id, couple.id], 'çift masajında iki terapist de');
    assert.deepEqual(await ids(`search=${done.code.toLowerCase()}`), [done.id]);
    assert.deepEqual(await ids('search=101'), [done.id]);
    assert.deepEqual(await ids('search=kerem'), [missed.id]);
    assert.deepEqual(await ids('pageSize=2&page=3'), [open1.id]);
    assert.deepEqual(await ids('view=OPEN_BALANCE'), [couple.id, missed.id]);
    assert.deepEqual(json(await call('GET', `/spa/appointments?from=${D(2)}&to=${D(2)}`, DESK)).items.map((row) => row.id), [open1.id]);
    fail(await call('GET', `/spa/appointments?from=${D(0)}&to=${D(400)}`, DESK), 400, 'VALIDATION');
    assert.deepEqual(json(await call('GET', '/spa/stays?search=101', DESK)).stays.map((row) => [row.id, row.status, row.guestName]), [[stay.id, 'CHECKED_IN', 'Anna Müller']]);
    assert.equal(json(await call('GET', '/spa/stays?search=müller', DESK)).stays.length, 1);

    // Rapor: ciro tamamlananlardan, bedel ayrı; çift masajının cirosu iki terapiste eşit bölünür.
    const report = json(await call('GET', `/spa/report?${range}`, ACCOUNTANT));
    assert.deepEqual(
      [report.totals.appointments, report.totals.completed, report.totals.cancelled, report.totals.noShow, report.totals.booked, report.totals.guests],
      [5, 2, 1, 1, 1, 3],
    );
    assert.deepEqual([report.totals.revenue, report.totals.feeRevenue, report.totals.totalRevenue, report.totals.openBalance], ['7300.00', '2500.00', '9800.00', '7300.00']);
    assert.deepEqual([report.totals.cancellationPct, report.totals.noShowPct, report.totals.portal, report.totals.portalPct], [25, 25, 0, 0]);
    assert.deepEqual(report.services.map((row) => [row.name, row.completed, row.noShow, row.revenue, row.fees]), [
      ['Aromaterapi Masajı', 1, 1, '2500.00', '2500.00'],
      ['Çift Masajı', 1, 0, '4800.00', '0.00'],
    ]);
    const byName = Object.fromEntries(report.therapists.map((row) => [row.name, row]));
    assert.deepEqual([byName['Elif Kaya'].appointments, byName['Elif Kaya'].minutes, byName['Elif Kaya'].revenue], [2, 120, '4900.00']);
    assert.deepEqual([byName['Murat Demir'].appointments, byName['Murat Demir'].revenue], [1, '2400.00']);
    assert.equal(byName['Elif Kaya'].workMinutes, 4 * 540, 'dört gün × 9 saat');
    assert.deepEqual(report.trend, { bucket: 'DAY', points: [{ bucket: D(1), completed: 2, lost: 2, revenue: '9800.00' }, { bucket: D(2), completed: 0, lost: 0, revenue: '0.00' }] });
    assert.deepEqual(report.categories.map((row) => [row.category, row.revenue]), [['MASSAGE', '7300.00']]);

    // İzinler: kat hizmetleri hiçbir şeyi göremez; ön büro rapor görür ama tanım / kasa / fiyat yapamaz.
    for (const url of ['/spa/setup', `/spa/calendar?day=${D(1)}`, `/spa/appointments?${range}`, `/spa/report?${range}`, `/spa/appointments/${done.id}`]) fail(await call('GET', url, HOUSEKEEPER), 403);
    fail(await call('POST', '/spa/rooms', DESK, { name: 'Yeni Oda', kind: 'TREATMENT' }), 403);
    fail(await call('PUT', '/spa/settings', DESK, {}), 403);
    fail(await call('POST', '/spa/appointments', ACCOUNTANT, {}), 403);
    // Oturumsuz istek, gövdesi bozuk olsa da 401 alır (doğrulama ayrıntısı sızmaz).
    fail(await open('POST', '/spa/appointments', {}), 401);
    fail(await open('GET', '/spa/report'), 401);

    // Otel kapsamı: başka otelin müdürü bu otelin kaydını göremez, değiştiremez; kendi listesi boştur.
    fail(await call('GET', `/spa/appointments/${done.id}`, OTHER), 404);
    fail(await call('POST', `/spa/appointments/${open1.id}/cancel`, OTHER, { expectedUpdatedAt: open1.updatedAt, reason: 'Yetkisiz iptal' }), 404);
    fail(await call('PUT', `/spa/rooms/${spa.r1.id}`, OTHER, { name: 'Ele Geçirildi', kind: 'TREATMENT', expectedUpdatedAt: spa.r1.updatedAt }), 404);
    assert.equal(json(await call('GET', `/spa/appointments?${range}`, OTHER)).meta.total, 0);
    assert.equal(json(await call('GET', '/spa/setup', OTHER)).services.length, 0);
    assert.equal(json(await call('GET', `/spa/calendar?day=${D(1)}`, OTHER)).items.length, 0);
    // Başka otelin hizmetiyle / konaklamasıyla randevu açılamaz.
    fail(await call('POST', '/spa/appointments', OTHER, { requestId: randomUUID(), serviceId: spa.massage.id, startsAt: `${D(1)}T17:00`, customerName: 'Sızan Misafir' }), 404);
    assert.equal((await fresh(open1.id)).status, 'BOOKED');
  });
});
