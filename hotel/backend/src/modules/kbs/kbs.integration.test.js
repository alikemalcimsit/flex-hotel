import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * KBS (modül 58) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: girişte KBS zorunlu alanları; aktör zinciriyle kişi başına giriş bildirimi (belgesiz çocuk hariç), gönderici ve test
 * sağlayıcısı (referans), mutabakat; oda değişikliği ve çıkış bildirimi (girişe bağlı); geçici hata → yeniden deneme → hak bitince
 * gönderilemedi + zil → tekrar gönder; kalıcı hata → elle bildirildi → bağlı çıkış gider; giriş geri alma; gönderimde eksik alan;
 * gecikme zili; ayar (hazır olmayan sağlayıcı, parola gizli); izinler.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'mudur@test.local';
const DESK = 'onburo@test.local';
const HK = 'kat@test.local';
const TC = '10000000146';
const FOREIGN = { idType: 'PASSPORT', idNumber: 'C01X00T47', nationality: 'DE' };

describe('KBS (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let reservations;
  /** @type {any} */ let rooms;
  /** @type {any} */ let frontDesk;
  /** @type {any} */ let kbs;
  /** @type {any} */ let dispatcher;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  /** @type {Map<string, string>} */ let tokens;
  /** @type {any} */ let roomType;
  /** @type {Record<string, any>} */ let room;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    process.env.SETTINGS_SECRET_KEY ??= Buffer.alloc(32, 7).toString('base64');
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    reservations = await import('../reservations/service.js');
    rooms = await import('../rooms/service.js');
    frontDesk = await import('../front-desk/service.js');
    kbs = await import('./service.js');
    dispatcher = await import('./dispatcher.js');
    cache = await import('../../lib/cache.js');
    dispatcher.setKbsAutoKick(false);
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const day = (offset) => core.toIsoDay(core.addDays(core.calendarDateInTimeZone(ZONE), offset));
  const at = (time, offset = 0) => contracts.zonedWallTimeToUtc(`${day(offset)}T${time}`, ZONE);

  async function rejectsWith(promise, code, message) {
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, code, `${error.code}: ${error.message}`);
      if (message) assert.match(error.message, message);
      return true;
    });
  }

  const settingsBody = (patch = {}) => ({ expectedUpdatedAt: null, isEnabled: true, provider: 'TEST', facilityCode: '06-0001', username: 'deniz-otel', password: 'gizli-parola', testBehavior: 'ACCEPT', ...patch });
  const saveSettings = async (patch = {}) => {
    const current = await kbs.getKbsSettings(hotelId);
    return as(MANAGER, () => kbs.saveKbsSettings(hotelId, contracts.kbsSettingsSchema.parse({ ...settingsBody(patch), expectedUpdatedAt: current.settings.updatedAt })));
  };

  beforeEach(async () => {
    await resetDatabase(db);
    reservations.clearReservationCache();
    frontDesk.clearFrontDeskCache();
    cache.cache.invalidatePrefix('settings:');
    tokens = new Map();
    hotelId = (await db.hotel.create({ data: { name: 'Deniz Otel', code: `K${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, phoneCountryCode: '90', checkInTime: '14:00', checkOutTime: '12:00' } })).id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: DESK, name: 'Ön Büro', role: 'FRONT_DESK', passwordHash },
        { hotelId, email: HK, name: 'Kat', role: 'HOUSEKEEPING', passwordHash },
      ],
    });
    roomType = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 3, capacityChildren: 1 } });
    room = {
      101: await db.room.create({ data: { hotelId, number: '101', roomTypeId: roomType.id, housekeepingStatus: 'CLEAN' } }),
      102: await db.room.create({ data: { hotelId, number: '102', roomTypeId: roomType.id, housekeepingStatus: 'CLEAN' } }),
      103: await db.room.create({ data: { hotelId, number: '103', roomTypeId: roomType.id, housekeepingStatus: 'CLEAN' } }),
    };
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });

  /** Bugün başlayan bir gecelik konaklama (giriş 15:00; çıkış aynı gün erken ayrılış olarak). */
  async function book({ adults = 2, children = 0, guest = {}, roomId = room[101].id } = {}) {
    const result = await as(DESK, () =>
      reservations.createReservation(hotelId, {
        guestId: null,
        guest: { firstName: 'Anna', lastName: 'Schmidt', phone: `+90532${String(Math.random()).slice(2, 9)}`, email: null, nationality: 'DE', ...guest },
        forceNewGuest: true,
        roomTypeId: roomType.id,
        adults,
        children,
        boardType: 'BB',
        checkIn: new Date(day(0)),
        checkOut: new Date(day(1)),
        status: 'CONFIRMED',
        source: 'PHONE',
        notes: null,
        requestId: randomUUID(),
        waitlistId: null,
        roomId,
        manualTotal: null,
        priceNote: null,
      }),
    );
    return result.reservation;
  }
  const version = async (id) => (await db.reservation.findUnique({ where: { id } })).updatedAt;
  const checkIn = async (reservationId, body = {}, time = '15:00') =>
    as(DESK, async () => frontDesk.checkIn(hotelId, reservationId, contracts.checkInSchema.parse({ expectedUpdatedAt: await version(reservationId), guest: { ...FOREIGN, gender: 'FEMALE', birthDate: '1990-04-12' }, waiveEarlyFee: true, ...body }), { now: at(time) }));
  const notifications = (where = {}) => db.kbsNotification.findMany({ where: { hotelId, ...where }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

  it('girişte zorunlu alan; kişi başına giriş bildirimi (belgesiz çocuk hariç), gönderim, mutabakat; oda değişikliği ve çıkış girişe bağlı', async () => {
    // Kapalıyken bildirim açılmaz.
    const off = await book({ adults: 1, guest: { firstName: 'Ali', lastName: 'Kaya', nationality: 'TR' } });
    await as(DESK, async () => frontDesk.checkIn(hotelId, off.id, contracts.checkInSchema.parse({ expectedUpdatedAt: await version(off.id), guest: { idType: 'NATIONAL_ID', idNumber: TC, nationality: 'TR' }, waiveEarlyFee: true, roomId: room[102].id }), { now: at('15:00') }));
    assert.equal((await notifications()).length, 0);

    await saveSettings();
    const stay = await book({ adults: 2, children: 1 });
    const companions = [
      { firstName: 'Max', lastName: 'Schmidt', ...{ idType: 'PASSPORT', idNumber: 'C01X00T55', nationality: 'DE' }, gender: 'MALE', birthDate: '1988-02-01' },
      { firstName: 'Mia', lastName: 'Schmidt', isChild: true },
    ];
    // Yabancı misafirin cinsiyeti / doğum tarihi eksik: giriş olmaz, alan alan söylenir.
    await assert.rejects(
      as(DESK, async () => frontDesk.checkIn(hotelId, stay.id, contracts.checkInSchema.parse({ expectedUpdatedAt: await version(stay.id), guest: FOREIGN, companions, waiveEarlyFee: true }), { now: at('15:00') })),
      (error) => {
        assert.equal(error.code, 'VALIDATION');
        assert.match(error.message, /KBS bildirimi için eksik bilgi — Anna Schmidt: Cinsiyet, Doğum tarihi/);
        assert.deepEqual(Object.keys(error.fields).sort(), ['guest.birthDate', 'guest.gender']);
        return true;
      },
    );
    const preview = await frontDesk.getCheckInPreview(hotelId, stay.id, { now: at('15:00') });
    assert.deepEqual([preview.kbs.isEnabled, preview.kbs.requireGender, preview.kbs.citizenIdOnly], [true, true, true]);
    await checkIn(stay.id, { companions });
    let rows = await notifications({ reservationId: stay.id });
    assert.deepEqual(rows.map((row) => [row.kind, row.state, row.roomNumber, row.guestName]), [['CHECK_IN', 'PENDING', '101', 'Anna Schmidt'], ['CHECK_IN', 'PENDING', '101', 'Max Schmidt']]);
    assert.match(rows[0].documentMasked, /^C01•+47$/);
    const guest = await db.guest.findUnique({ where: { id: rows[0].guestId } });
    assert.deepEqual([guest.gender, core.toIsoDay(guest.birthDate)], ['FEMALE', '1990-04-12'], 'ek alanlar karta yazıldı');

    let summary = await kbs.kbsSummary(hotelId);
    assert.deepEqual([summary.pending, summary.inHouse.persons, summary.inHouse.reported, summary.inHouse.withoutDocument], [2, 3, 0, 1], 'TC misafir (KBS kapalıyken girdi) + 2 belgeli kişi; belgesiz çocuk ayrı');
    assert.equal(await dispatcher.dispatchDueKbs(), 2);
    rows = await notifications({ reservationId: stay.id });
    assert.ok(rows.every((row) => row.state === 'SENT' && /^TKBS-/.test(row.providerRef)));
    summary = await kbs.kbsSummary(hotelId);
    assert.equal(summary.inHouse.reported, 2);
    assert.deepEqual(summary.inHouse.missing.map((row) => [row.guestName, row.reason]), [['Ali Kaya', 'Bildirim açılmamış']]);
    // Mutabakattan bildirim aç: KBS kapalıyken giren misafir.
    const opened = await call('POST', `/kbs/reservations/${off.id}/enqueue`, DESK);
    assert.equal(opened.statusCode, 200, opened.body);
    assert.equal(opened.json().data.created, true);
    assert.equal((await notifications({ reservationId: off.id })).length, 1);
    assert.equal((await call('POST', `/kbs/reservations/${off.id}/enqueue`, DESK)).json().data.created, false, 'açık olanı yeniden açmaz');

    // Oda değişikliği: içerideki iki kişi için (101 → 103).
    await as(DESK, () => rooms.changeRoom(hotelId, stay.id, room[103].id, { reason: 'Klima arızası' }));
    rows = await notifications({ reservationId: stay.id, kind: 'ROOM_CHANGE' });
    assert.equal(rows.length, 2);
    assert.deepEqual([rows[0].previousRoomNumber, rows[0].state], ['101', 'PENDING']);
    assert.equal(await dispatcher.dispatchDueKbs(), 3, 'iki oda değişikliği + mutabakattan açılan giriş');

    // Çıkış: girişe (son halkaya) bağlı çıkış bildirimi.
    await as(DESK, async () => frontDesk.checkOut(hotelId, stay.id, contracts.checkOutSchema.parse({ expectedUpdatedAt: await version(stay.id), confirmEarlyDeparture: true, allowOpenBalance: true, openBalanceReason: 'Şirket ödeyecek' }), { now: at('17:00'), canAllowOpenBalance: true }));
    rows = await notifications({ reservationId: stay.id, kind: 'CHECK_OUT' });
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.dependsOnId && row.roomNumber === '103'), 'son bildirilen odadan');
    assert.equal(await dispatcher.dispatchDueKbs(), 2);
    assert.ok((await notifications({ reservationId: stay.id })).every((row) => row.state === 'SENT'));
  });

  it('geçici hata yeniden denenir, hak bitince gönderilemedi + zil, tekrar gönder; kalıcı hata → elle bildirildi → bağlı çıkış gider', async () => {
    await saveSettings({ testBehavior: 'UNAVAILABLE' });
    const stay = await book({ adults: 1 });
    await checkIn(stay.id);
    await dispatcher.dispatchDueKbs();
    let [row] = await notifications();
    assert.deepEqual([row.state, row.attempts, row.lastCode], ['PENDING', 1, 'T-UNAVAILABLE']);
    assert.ok(row.nextAttemptAt > new Date(), 'sıradaki deneme ileride');
    assert.equal(await dispatcher.dispatchDueKbs(), 0, 'zamanı gelmeden denenmez');
    await db.kbsNotification.update({ where: { id: row.id }, data: { attempts: contracts.KBS_RETRY_DELAYS_MS.length, nextAttemptAt: new Date(Date.now() - 1000) } });
    await dispatcher.dispatchDueKbs();
    [row] = await notifications();
    assert.equal(row.state, 'FAILED');
    assert.ok((await db.staffAlert.findMany({ where: { hotelId, kind: 'KBS' } })).some((alert) => /gönderilemedi: Anna Schmidt/.test(alert.title)));
    // Tekrar gönder (ön büro): servis düzelince gider.
    await saveSettings({ testBehavior: 'ACCEPT', password: null });
    const retried = await call('POST', `/kbs/notifications/${row.id}/retry`, DESK);
    assert.equal(retried.statusCode, 200, retried.body);
    await dispatcher.dispatchDueKbs();
    assert.equal((await db.kbsNotification.findUnique({ where: { id: row.id } })).state, 'SENT');

    // Kalıcı hata: ikinci konaklama.
    await saveSettings({ testBehavior: 'REJECT' });
    const second = await book({ adults: 1, guest: { firstName: 'Lena', lastName: 'Weber' }, roomId: room[102].id });
    await checkIn(second.id, { guest: { idType: 'PASSPORT', idNumber: 'C01X00T63', nationality: 'DE', gender: 'FEMALE', birthDate: '1992-07-07' } });
    await dispatcher.dispatchDueKbs();
    const [failed] = await notifications({ reservationId: second.id });
    assert.deepEqual([failed.state, failed.lastCode, failed.attempts], ['FAILED', 'T-REJECTED', 1], 'kalıcı hata yeniden denenmez');
    // Çıkış bildirimi bağlı olduğu giriş bildirilmeden gitmez.
    await as(DESK, async () => frontDesk.checkOut(hotelId, second.id, contracts.checkOutSchema.parse({ expectedUpdatedAt: await version(second.id), confirmEarlyDeparture: true, allowOpenBalance: true, openBalanceReason: 'Şirket ödeyecek' }), { now: at('17:00'), canAllowOpenBalance: true }));
    await saveSettings({ testBehavior: 'ACCEPT' });
    assert.equal(await dispatcher.dispatchDueKbs(), 0);
    const tooShort = await call('POST', `/kbs/notifications/${failed.id}/manual`, DESK, { note: 'x' });
    assert.equal(tooShort.statusCode, 400);
    const manual = await call('POST', `/kbs/notifications/${failed.id}/manual`, DESK, { note: 'KBS ekranından elle girildi, ref 778812' });
    assert.equal(manual.statusCode, 200, manual.body);
    assert.equal(manual.json().data.notification.state, 'MANUAL');
    assert.equal(await dispatcher.dispatchDueKbs(), 1, 'bağlı çıkış artık gider');
    const again = await call('POST', `/kbs/notifications/${failed.id}/retry`, DESK);
    assert.equal(again.statusCode, 409, 'elle bildirilen tekrar gönderilmez');
  });

  it('giriş geri alınınca bekleyen iptal, gönderilmiş çıkışla kapanır; gönderimde eksik alan; gecikme zili', async () => {
    await saveSettings();
    const stay = await book({ adults: 1 });
    await checkIn(stay.id);
    await as(DESK, async () => frontDesk.revertCheckIn(hotelId, stay.id, { expectedUpdatedAt: await version(stay.id), reason: 'Yanlış misafir' }, { now: at('15:30') }));
    let rows = await notifications();
    assert.deepEqual(rows.map((row) => [row.kind, row.state]), [['CHECK_IN', 'CANCELLED']]);
    // Yeniden giriş + gönderim + geri alma → çıkışla kapatılır.
    await checkIn(stay.id, {}, '16:00');
    await dispatcher.dispatchDueKbs();
    await as(DESK, async () => frontDesk.revertCheckIn(hotelId, stay.id, { expectedUpdatedAt: await version(stay.id), reason: 'Yine yanlış' }, { now: at('16:30') }));
    rows = await notifications({ state: { not: 'CANCELLED' } });
    assert.deepEqual(rows.map((row) => [row.kind, row.state]), [['CHECK_IN', 'SENT'], ['CHECK_OUT', 'PENDING']]);
    assert.match(rows[1].lastMessage, /Giriş geri alındı/);

    // Gönderim anında eksik alan: kart sonradan bozuldu.
    await checkIn(stay.id, {}, '17:00');
    const [fresh] = await notifications({ state: 'PENDING', kind: 'CHECK_IN' });
    await db.guest.update({ where: { id: fresh.guestId }, data: { gender: null } });
    await dispatcher.dispatchDueKbs();
    const broken = await db.kbsNotification.findUnique({ where: { id: fresh.id } });
    assert.deepEqual([broken.state, broken.lastCode], ['FAILED', 'MISSING_FIELDS']);
    assert.match(broken.lastMessage, /Cinsiyet/);
    // Gecikme zili (bir kez).
    await db.kbsNotification.update({ where: { id: fresh.id }, data: { createdAt: new Date(Date.now() - 3 * 3_600_000) } });
    assert.equal(await dispatcher.alertLateKbs(), 1);
    assert.equal(await dispatcher.alertLateKbs(), 0);
    assert.ok((await db.staffAlert.findMany({ where: { hotelId, kind: 'KBS', severity: 'CRITICAL' } })).some((alert) => /gecikti/.test(alert.title)));
  });

  it('KBS açıkken her yetişkin istenir; sıra atlatan elle işaretleme reddedilir; KBS kapatılsa da bildirilmiş girişin çıkışı yazılır', async () => {
    await saveSettings({ testBehavior: 'REJECT' });
    const stay = await book({ adults: 2 });
    await rejectsWith(checkIn(stay.id), 'VALIDATION', /yetişkin/i);
    await checkIn(stay.id, { companions: [{ firstName: 'Max', lastName: 'Schmidt', idType: 'PASSPORT', idNumber: 'C01X00T55', nationality: 'DE', gender: 'MALE', birthDate: '1988-02-01' }] });
    await dispatcher.dispatchDueKbs();
    const [anna, max] = await notifications({ reservationId: stay.id });
    assert.deepEqual([anna.state, max.state], ['FAILED', 'FAILED']);
    await as(DESK, () => rooms.changeRoom(hotelId, stay.id, room[103].id, { reason: 'Gürültü' }));
    const [move] = await notifications({ reservationId: stay.id, kind: 'ROOM_CHANGE', guestId: anna.guestId });
    const skipped = await call('POST', `/kbs/notifications/${move.id}/manual`, DESK, { note: 'Elle bildirdim sanıyordum' });
    assert.equal(skipped.statusCode, 409);
    assert.match(skipped.body, /Önce bağlı olduğu bildirim/);
    // Girişler elle bildirildi; sonra KBS kapatıldı, misafirler çıktı → çıkış yine yazılır (açılınca gider).
    for (const row of [anna, max]) assert.equal((await call('POST', `/kbs/notifications/${row.id}/manual`, DESK, { note: 'KBS ekranından elle girildi' })).statusCode, 200);
    await saveSettings({ isEnabled: false, testBehavior: 'ACCEPT' });
    await as(DESK, async () => frontDesk.checkOut(hotelId, stay.id, contracts.checkOutSchema.parse({ expectedUpdatedAt: await version(stay.id), confirmEarlyDeparture: true, allowOpenBalance: true, openBalanceReason: 'Şirket ödeyecek' }), { now: at('17:00'), canAllowOpenBalance: true }));
    assert.equal((await notifications({ reservationId: stay.id, kind: 'CHECK_OUT' })).length, 2);
    assert.equal(await dispatcher.dispatchDueKbs(), 0, 'kapalıyken gönderilmez');
    await saveSettings({ testBehavior: 'ACCEPT' });
    assert.equal(await dispatcher.dispatchDueKbs(), 4, 'oda değişiklikleri ve çıkışlar sırayla');
  });

  it('ayar: hazır olmayan sağlayıcı açılamaz, parola dönmez; izinler', async () => {
    const egm = await call('PUT', '/kbs/settings', MANAGER, settingsBody({ provider: 'EGM' }));
    assert.equal(egm.statusCode, 400);
    assert.match(egm.body, /henüz kurulmadı/);
    const saved = await call('PUT', '/kbs/settings', MANAGER, settingsBody());
    assert.equal(saved.statusCode, 200, saved.body);
    const view = saved.json().data;
    assert.equal(view.settings.hasPassword, true);
    assert.ok(!JSON.stringify(view).includes('gizli-parola') && !('passwordSealed' in view.settings));
    assert.deepEqual(view.providers.map((row) => [row.code, row.ready]), [['TEST', true], ['EGM', false], ['JANDARMA', false]]);
    const tested = await call('POST', '/kbs/settings/test', MANAGER);
    assert.equal(tested.json().data.ok, true);
    assert.equal((await call('GET', '/kbs/summary', HK)).statusCode, 403);
    assert.equal((await call('GET', '/kbs/summary', DESK)).statusCode, 200);
    assert.equal((await call('PUT', '/kbs/settings', DESK, settingsBody())).statusCode, 403);
    assert.equal((await call('POST', '/kbs/settings/test', DESK)).statusCode, 403);
    const list = await call('GET', '/kbs/notifications?open=true', DESK);
    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.json().data.items, []);
  });
});
