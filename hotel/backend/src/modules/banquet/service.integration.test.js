import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Banket / etkinlik (modül 37) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: etkinlik yaşam döngüsü (talep → opsiyon → kesin → gerçekleşti; kişi başı
 * fiyat, garanti / gerçekleşen kişi, vergi), sıralı opsiyon (sıra, öndeki düşünce
 * yükselme ve haber, kesin önde), bölünebilir salon (parça / bütün çakışması),
 * kurulum / söküm aralığı, eşzamanlı kesinleştirme (tek kazanan, veritabanı kısıtı),
 * kapasite / düzen / pasif salon, ekipman stoğu (aynı anda en yüksek kullanım, stok
 * düşürme), opsiyon süresi işi (iş günü, son gün hatırlatması bir kez, düşünce
 * sıradakine haber), ödemeler (depozito, eşik üstü dört göz onay, iade sınırı, hatalı
 * girişin iptali, tekrar gönderim, sürüme dokunmama, kasa birleşimi ve imleç), iptal
 * (kesinleşirken kopyalanan kademe, iade uyarısı, bedelli proforma), belgeler (sürüm,
 * kabul, imzasız kesinleşmeme, eşzamanlı üretim, PDF indirme), gecikmiş taksit,
 * izinler ve otel kapsamı.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'satis@test.local';
const MANAGER2 = 'mudur@test.local';
const DESK = 'onburo@test.local';
const HOUSEKEEPING = 'kat@test.local';
const KITCHEN = 'mutfak@test.local';
/** Bu tutar ve üstü tahsilat onaya gider. */
const THRESHOLD = '400000.00';
const TIERS = [
  { daysBefore: 60, feePct: '25' },
  { daysBefore: 14, feePct: '50' },
  { daysBefore: 0, feePct: '100' },
];

describe('banket / etkinlik (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let setup;
  /** @type {any} */ let events;
  /** @type {any} */ let payments;
  /** @type {any} */ let documents;
  /** @type {any} */ let jobs;
  /** @type {any} */ let approvals;
  /** @type {any} */ let cash;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let storageDir;
  let previousStorage;
  let hotelId;
  let otherHotelId;
  /** @type {Record<string, any>} */ let venue;
  /** @type {any} */ let projector;
  /** @type {any} */ let client;
  /** @type {Map<string, string>} */ let tokens;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    previousStorage = process.env.FILE_STORAGE_DIR;
    storageDir = await mkdtemp(path.join(tmpdir(), 'hotelos-banket-'));
    process.env.FILE_STORAGE_DIR = storageDir;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    setup = await import('./setup.js');
    events = await import('./events.js');
    payments = await import('./payments.js');
    documents = await import('./documents.js');
    jobs = await import('./jobs.js');
    approvals = await import('../approvals/service.js');
    cash = await import('../payments/service.js');
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
  const sales = (fn) => as(MANAGER, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const D = (offset) => core.toIsoDay(core.addDays(today(), offset));
  const wall = (offset, time) => `${D(offset)}T${time}`;
  const version = (dto) => new Date(dto.updatedAt);

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
    const hotel = await db.hotel.create({
      data: { name: 'Büyük Ankara Oteli', code: `B${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY', largePaymentThreshold: THRESHOLD },
    });
    hotelId = hotel.id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka Otel', code: `O${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Satış Müdürü', role: 'MANAGER', passwordHash },
        { hotelId, email: MANAGER2, name: 'Genel Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: DESK, name: 'Ön Büro', role: 'FRONT_DESK', passwordHash },
        { hotelId, email: HOUSEKEEPING, name: 'Kat', role: 'HOUSEKEEPING', passwordHash },
        { hotelId, email: KITCHEN, name: 'Mutfak', role: 'FNB', passwordHash },
      ],
    });
    // Yiyecek KDV %10 dahil, salon / ekipman KDV %20 dahil.
    await db.tax.createMany({
      data: [
        { hotelId, name: 'KDV', rate: '10', isIncluded: true, appliesTo: ['FNB'] },
        { hotelId, name: 'KDV', rate: '20', isIncluded: true, appliesTo: ['OTHER'] },
      ],
    });
    const makeVenue = (input) => sales(() => setup.createVenue(hotelId, contracts.createVenueSchema.parse(input)));
    const ballroom = await makeVenue({ code: 'BALO', name: 'Büyük Balo Salonu', dayRate: '80000', capacities: [{ layout: 'BANQUET', capacity: 400 }, { layout: 'THEATER', capacity: 600 }] });
    venue = {
      ballroom,
      partA: await makeVenue({ code: 'BALO-A', name: 'Balo A', parentId: ballroom.id, capacities: [{ layout: 'BANQUET', capacity: 200 }] }),
      partB: await makeVenue({ code: 'BALO-B', name: 'Balo B', parentId: ballroom.id, capacities: [{ layout: 'BANQUET', capacity: 200 }] }),
      meeting: await makeVenue({
        code: 'TOPL',
        name: 'Toplantı Odası',
        hourlyRate: '2000',
        setupMinutes: 30,
        teardownMinutes: 30,
        capacities: [{ layout: 'BOARDROOM', capacity: 20 }, { layout: 'THEATER', capacity: 60 }],
      }),
    };
    projector = await sales(() => setup.createEquipment(hotelId, contracts.createEquipmentSchema.parse({ code: 'PROJ', name: 'Projeksiyon', unitPrice: '1500', stockQuantity: 2 })));
    client = await sales(() => setup.createClient(hotelId, contracts.createEventClientSchema.parse({ type: 'COMPANY', name: 'Öztürk İnşaat A.Ş.', contactName: 'Şule Çağlar' })));
    await sales(() =>
      setup.updateSettings(
        hotelId,
        contracts.updateEventSettingsSchema.parse({ optionDays: 7, offerValidityDays: 14, depositPct: '30', requireSignedContract: false, cancellationTiers: TIERS }),
      ),
    );
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });

  /* ── Kurulum yardımcıları (servis, şemadan geçirilmiş girdiyle) ── */

  const newEvent = (overrides = {}, owner = MANAGER) =>
    as(owner, () =>
      events.createEvent(hotelId, contracts.createEventSchema.parse({ name: 'Yıl sonu galası', type: 'GALA', clientId: client.id, expectedPax: 300, ...overrides })),
    );

  /** @param {any} event @param {{ venueId?: string, day?: number, start?: string, end?: string, pax?: number, layout?: string, title?: string }} [options] */
  const addSession = (event, { venueId = venue.ballroom.id, day = 30, start = '19:00', end = '23:30', pax = 280, layout = 'BANQUET', title = 'Gala yemeği' } = {}) =>
    sales(() =>
      events.saveSession(
        hotelId,
        event.id,
        null,
        contracts.createSessionSchema.parse({ expectedUpdatedAt: event.updatedAt, title, venueId, layout, pax, startAt: wall(day, start), endAt: wall(day, end) }),
      ),
    );

  const saveItems = (event, items) => sales(() => events.saveItems(hotelId, event.id, contracts.saveEventItemsSchema.parse({ expectedUpdatedAt: event.updatedAt, items })));

  const menu = (unitPrice = '1500') => ({ category: 'FNB', description: 'Gala menüsü', perPerson: true, quantity: '1', unit: 'PERSON', unitPrice, taxCategory: 'FNB' });
  const rental = { category: 'VENUE', description: 'Salon kirası', perPerson: false, quantity: '1', unit: 'DAY', unitPrice: '80000', taxCategory: 'OTHER' };
  const projectors = (sessionId, quantity = '2') => ({
    category: 'EQUIPMENT',
    description: 'Projeksiyon',
    perPerson: false,
    quantity,
    unit: 'PIECE',
    unitPrice: '1500',
    taxCategory: 'OTHER',
    equipmentId: projector.id,
    sessionId,
  });

  /** Oturum + kalem: menü (kişi başı) ve salon kirası. */
  async function pricedEvent(overrides = {}, sessionOptions = {}, owner = MANAGER) {
    let event = await newEvent(overrides, owner);
    event = await addSession(event, sessionOptions);
    return saveItems(event, [menu(), rental]);
  }

  const tentative = (event, optionUntil = D(7), owner = MANAGER) =>
    as(owner, () => events.setTentative(hotelId, event.id, contracts.tentativeEventSchema.parse({ expectedUpdatedAt: event.updatedAt, optionUntil })));
  const confirm = (event, owner = MANAGER) => as(owner, () => events.confirmEvent(hotelId, event.id, { expectedUpdatedAt: version(event) }));
  const reload = (event) => events.getEvent(hotelId, event.id);
  const alerts = (where = {}) => db.staffAlert.findMany({ where: { hotelId, kind: 'BANQUET', ...where }, orderBy: { createdAt: 'asc' } });
  const userId = async (email) => (await db.user.findFirst({ where: { hotelId, email }, select: { id: true } })).id;

  /** Etkinliği geçmişe taşır (gerçekleşti testi): oturum, tutma ve aralık aynı kaymayla. */
  async function shiftToPast(event, days) {
    const shift = days * 86_400_000;
    for (const session of await db.eventSession.findMany({ where: { eventId: event.id } })) {
      await db.eventSession.update({ where: { id: session.id }, data: { startAt: new Date(session.startAt.getTime() - shift), endAt: new Date(session.endAt.getTime() - shift) } });
    }
    for (const hold of await db.eventVenueHold.findMany({ where: { eventId: event.id } })) {
      await db.eventVenueHold.update({ where: { id: hold.id }, data: { startAt: new Date(hold.startAt.getTime() - shift), endAt: new Date(hold.endAt.getTime() - shift) } });
    }
    const row = await db.event.findFirst({ where: { id: event.id } });
    await db.event.update({ where: { id: event.id }, data: { firstStartAt: new Date(row.firstStartAt.getTime() - shift), lastEndAt: new Date(row.lastEndAt.getTime() - shift) } });
    return reload(event);
  }

  /* ══════════════════ Yaşam döngüsü ══════════════════ */

  it('talep → opsiyon → kesin → gerçekleşti: kişi başı fiyat, vergi dökümü, kesin kişiyle son toplam', async () => {
    let event = await newEvent({ guaranteedPax: 280 });
    assert.equal(event.status, 'INQUIRY');
    assert.match(event.code, new RegExp(`^ETK-${D(0).slice(0, 4)}-0001$`));
    event = await addSession(event);
    const session = event.sessions[0];
    assert.equal(session.startLocal, wall(30, '19:00'));
    event = await saveItems(event, [menu(), rental, projectors(session.id)]);

    // 280 × 1500 (KDV %10 dahil) + 80 000 + 2 × 1500 (KDV %20 dahil).
    assert.equal(event.billablePax, 280);
    assert.equal(event.grandTotal, '503000.00');
    assert.equal(event.taxTotal, '52015.15');
    assert.equal(event.items[0].billedQuantity, '280');
    assert.deepEqual(event.equipmentShortages, []);

    await rejectsWith(tentative(event, D(31)), 'VALIDATION', /ilk oturum günü/);
    await rejectsWith(tentative(event, D(-1)), 'VALIDATION', /geçmiş/);
    event = await tentative(event, D(7));
    assert.equal(event.status, 'TENTATIVE');
    assert.equal(event.optionUntil, D(7));
    assert.equal(event.optionRank, 1);
    // Bütün salon satıldı: tutmalar atomik parçalarda, kurulum / söküm (60 dk) dahil.
    const holds = await db.eventVenueHold.findMany({ where: { eventId: event.id }, orderBy: { venueId: 'asc' } });
    assert.deepEqual(holds.map((hold) => hold.venueId).sort(), [venue.partA.id, venue.partB.id].sort());
    assert.equal(holds[0].startAt.toISOString(), new Date(new Date(session.startAt).getTime() - 3_600_000).toISOString());
    assert.equal(holds[0].endAt.toISOString(), new Date(new Date(session.endAt).getTime() + 3_600_000).toISOString());

    event = await confirm(event);
    assert.equal(event.status, 'DEFINITE');
    assert.equal(event.optionUntil, null);
    assert.equal(event.cancellationTiersSnapshot, true);
    assert.deepEqual((await db.eventVenueHold.findMany({ where: { eventId: event.id } })).map((hold) => hold.status), ['DEFINITE', 'DEFINITE']);

    await rejectsWith(as(MANAGER, () => events.completeEvent(hotelId, event.id, { expectedUpdatedAt: version(event), actualPax: 300 })), 'EVENT_NOT_OVER');
    event = await shiftToPast(event, 40);
    event = await sales(() => events.completeEvent(hotelId, event.id, { expectedUpdatedAt: version(event), actualPax: 320 }));
    assert.equal(event.status, 'COMPLETED');
    // Gerçekleşen garantiyi aştı: 320 kişi faturalanır.
    assert.equal(event.billablePax, 320);
    assert.equal(event.grandTotal, '563000.00');
    assert.equal(event.invoiceReady, true);
    assert.equal(event.proformaIssued, false);
    // Denetim izi: dosya (aç, opsiyon, kesin, gerçekleşti), oturum ve kalem tablosu ayrı kayıt türlerinde.
    const trail = await db.auditLog.groupBy({ by: ['entity'], where: { hotelId, entity: { in: ['Event', 'EventSession', 'EventItem'] } }, _count: { _all: true } });
    assert.deepEqual(Object.fromEntries(trail.map((row) => [row.entity, row._count._all])), { Event: 4, EventSession: 1, EventItem: 1 });
  });

  it('gerçekleşen kişi garantinin altındaysa garanti faturalanır', async () => {
    let event = await pricedEvent({ guaranteedPax: 280 });
    event = await confirm(event);
    event = await shiftToPast(event, 40);
    event = await sales(() => events.completeEvent(hotelId, event.id, { expectedUpdatedAt: version(event), actualPax: 250 }));
    assert.equal(event.billablePax, 280);
    assert.equal(event.grandTotal, '500000.00');
  });

  /* ══════════════════ Sıralı opsiyon ══════════════════ */

  it('sıralı opsiyon: önde opsiyon varken kesinleşmez; öndeki düşünce sıradaki 1. olur ve haber alır', async () => {
    let first = await tentative(await pricedEvent({ name: 'Düğün Yılmaz' }));
    let second = await tentative(await pricedEvent({ name: 'Nişan Kaya' }, {}, MANAGER2), D(7), MANAGER2);
    assert.equal(first.optionRank, 1);
    assert.equal(second.optionRank, 2);
    assert.deepEqual(second.blockingEvents.map((entry) => entry.id), [first.id]);
    await rejectsWith(confirm(second, MANAGER2), 'OPTION_RANK', /2\. opsiyon/);

    const calendar = await events.getCalendar(hotelId, contracts.banquetCalendarQuerySchema.parse({ from: D(29), to: D(31) }));
    const ranks = calendar.holds.filter((hold) => hold.venueId === venue.partA.id).map((hold) => [hold.event.name, hold.rank]);
    assert.deepEqual(ranks.sort(), [['Düğün Yılmaz', 1], ['Nişan Kaya', 2]]);

    first = await sales(() => events.releaseOption(hotelId, first.id, { expectedUpdatedAt: version(first), reason: 'Müşteri tarih değiştirdi' }));
    assert.equal(first.status, 'INQUIRY');
    second = await reload(second);
    assert.equal(second.optionRank, 1);
    const promoted = await alerts({ dedupeKey: `banquet-promoted:${second.id}` });
    assert.equal(promoted.length, 1);
    assert.equal(promoted[0].userId, await userId(MANAGER2));

    // Bırakan yeniden opsiyonlarsa sıranın sonuna geçer; kesinleşen önde kalır.
    first = await tentative(first);
    assert.equal(first.optionRank, 2);
    second = await confirm(second, MANAGER2);
    assert.equal(second.status, 'DEFINITE');
    const blocked = await alerts({ dedupeKey: `banquet-blocked:${first.id}:${second.id}` });
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].userId, await userId(MANAGER));
    await rejectsWith(confirm(await reload(first)), 'OPTION_RANK', /kesin/);
  });

  it('bölünebilir salon: parça kesinken bütün kesinleşmez; iki parça aynı saatte ayrı ayrı kesinleşir', async () => {
    const onA = await confirm(await pricedEvent({ name: 'A toplantısı', expectedPax: 150 }, { venueId: venue.partA.id, pax: 150 }));
    const onB = await confirm(await pricedEvent({ name: 'B toplantısı', expectedPax: 150 }, { venueId: venue.partB.id, pax: 150 }));
    assert.equal(onA.status, 'DEFINITE');
    assert.equal(onB.status, 'DEFINITE');
    await rejectsWith(confirm(await pricedEvent({ name: 'Bütün gala' })), 'OPTION_RANK');
    // Talepten doğrudan kesine denenip reddedilen dosya tutma bırakmaz.
    assert.equal(await db.eventVenueHold.count({ where: { event: { name: 'Bütün gala' } } }), 0);
    const otherDay = await confirm(await pricedEvent({ name: 'Başka gün' }, { day: 31 }));
    assert.equal(otherDay.status, 'DEFINITE');
  });

  it('kurulum / söküm salonu doldurur: arka arkaya oturumlar ancak hazırlık süresi kadar arayla', async () => {
    const at = { venueId: venue.meeting.id, layout: 'BOARDROOM', pax: 12, day: 20 };
    const morning = await confirm(await pricedEvent({ expectedPax: 12 }, { ...at, start: '10:00', end: '12:00' }));
    // 30 dk söküm 12:30'a, 30 dk kurulum 11:45'ten: çakışır.
    await rejectsWith(confirm(await pricedEvent({ name: 'Öğle', expectedPax: 12 }, { ...at, start: '12:15', end: '14:00' })), 'OPTION_RANK');
    // 13:00 oturumunun kurulumu 12:30'da başlar: yarı açık aralık, çakışmaz.
    const afternoon = await confirm(await pricedEvent({ name: 'Öğleden sonra', expectedPax: 12 }, { ...at, start: '13:00', end: '15:00' }));
    assert.equal(afternoon.status, 'DEFINITE');
    // Kesin etkinliğin oturumu başka kesin etkinliğin saatine taşınamaz.
    await rejectsWith(
      sales(() =>
        events.saveSession(
          hotelId,
          morning.id,
          morning.sessions[0].id,
          contracts.updateSessionSchema.parse({ expectedUpdatedAt: morning.updatedAt, title: 'Sabah', ...at, startAt: wall(20, '13:30'), endAt: wall(20, '14:30') }),
        ),
      ),
      'VENUE_TAKEN',
    );
  });

  it('aynı etkinliğin arka arkaya oturumları aynı salonda hazırlık süreleri üst üste binse de kesinleşir', async () => {
    const at = { venueId: venue.meeting.id, layout: 'BOARDROOM', pax: 12, day: 25 };
    // Sabah 09–12 (söküm 12:30'a), öğleden sonra 12:15–17 (kurulum 11:45'ten): kendi tutmaları çakışmaz.
    let event = await pricedEvent({ name: 'Eğitim günü', expectedPax: 12 }, { ...at, title: 'Sabah', start: '09:00', end: '12:00' });
    event = await addSession(event, { ...at, title: 'Öğleden sonra', start: '12:15', end: '17:00' });
    event = await confirm(event);
    assert.equal(event.status, 'DEFINITE');
    assert.equal(await db.eventVenueHold.count({ where: { eventId: event.id, status: 'DEFINITE' } }), 2);
    // Başka etkinlik aradaki boşluğa giremez (iki tarafın hazırlık süresi dolu).
    await rejectsWith(confirm(await pricedEvent({ name: 'Ara toplantı', expectedPax: 12 }, { ...at, start: '12:00', end: '12:10' })), 'OPTION_RANK');
    // Veritabanı kısıtı da yalnızca farklı etkinlikleri ayırır.
    const other = await pricedEvent({ name: 'Zorla', expectedPax: 12 }, { ...at, start: '10:00', end: '11:00' });
    const session = (await reload(other)).sessions[0];
    await assert.rejects(
      db.eventVenueHold.create({
        data: { hotelId, eventId: other.id, sessionId: session.id, venueId: venue.meeting.id, startAt: new Date(session.startAt), endAt: new Date(session.endAt), status: 'DEFINITE', heldAt: new Date() },
      }),
      /EventVenueHold_no_double_definite|exclusion/i,
    );
  });

  it('eşzamanlı kesinleştirme: aynı salona aynı anda dört istek, yalnızca biri kesinleşir', async () => {
    const candidates = [];
    for (let index = 0; index < 4; index += 1) candidates.push(await pricedEvent({ name: `Aday ${index + 1}` }, { day: 45 }));
    const results = await Promise.allSettled(candidates.map((event) => confirm(event)));
    const won = results.filter((result) => result.status === 'fulfilled');
    assert.equal(won.length, 1, JSON.stringify(results.map((result) => result.reason?.code ?? 'OK')));
    for (const result of results.filter((entry) => entry.status === 'rejected')) assert.ok(['OPTION_RANK', 'VENUE_TAKEN'].includes(result.reason.code), result.reason.message);
    assert.equal(await db.event.count({ where: { hotelId, status: 'DEFINITE' } }), 1);
    // Kaybedenler talepte kaldı, yarım tutma yok.
    assert.equal(await db.eventVenueHold.count({ where: { hotelId } }), 2);
    assert.equal(await db.eventVenueHold.count({ where: { hotelId, status: 'DEFINITE' } }), 2);
  });

  it('kapasite, düzen ve pasif salon (alan hatası formun alanına bağlanır)', async () => {
    const event = await newEvent();
    const response = await call('POST', `/banquet/events/${event.id}/sessions`, MANAGER, {
      expectedUpdatedAt: event.updatedAt,
      title: 'Gala',
      venueId: venue.ballroom.id,
      layout: 'BANQUET',
      pax: 450,
      startAt: wall(30, '19:00'),
      endAt: wall(30, '23:00'),
    });
    assert.equal(response.statusCode, 422, response.body);
    assert.equal(response.json().fields.pax, 'Kapasite 400 kişi');
    await rejectsWith(addSession(event, { layout: 'CLASSROOM' }), 'VALIDATION', /düzeni tanımlı değil/);
    await rejectsWith(addSession(event, { day: -1 }), 'VALIDATION', /Geçmiş/);

    let meeting = await newEvent({ expectedPax: 12 });
    meeting = await addSession(meeting, { venueId: venue.meeting.id, layout: 'BOARDROOM', pax: 12 });
    const room = (await setup.listVenues(hotelId)).items.find((entry) => entry.id === venue.meeting.id);
    await sales(() =>
      setup.updateVenue(hotelId, room.id, contracts.updateVenueSchema.parse({ ...room, expectedUpdatedAt: room.updatedAt, parentId: null, status: 'PASSIVE', capacities: room.capacities })),
    );
    await rejectsWith(tentative(meeting), 'SESSION_UNFIT', /pasif/);
  });

  it('ekipman stoğu: kesin etkinliklerde aynı anda stoktan fazlası ayrılamaz; stok ayrımın altına düşmez', async () => {
    // Projeksiyon stoğu 2.
    let first = await addSession(await newEvent({ expectedPax: 150 }), { venueId: venue.partA.id, pax: 150, day: 50, start: '10:00', end: '12:00' });
    first = await confirm(await saveItems(first, [menu(), projectors(first.sessions[0].id, '2')]));
    let overlapping = await addSession(await newEvent({ name: 'Sunum', expectedPax: 12 }), { venueId: venue.meeting.id, layout: 'BOARDROOM', pax: 12, day: 50, start: '11:00', end: '13:00' });
    overlapping = await saveItems(overlapping, [projectors(overlapping.sessions[0].id, '1')]);
    assert.deepEqual(overlapping.equipmentShortages.map((entry) => [entry.name, entry.peak, entry.stock]), [['Projeksiyon', 3, 2]]);
    await rejectsWith(confirm(overlapping), 'EQUIPMENT_STOCK', /aynı anda 3 adet gerekli, stok 2/);

    // İlk etkinliğin sökümü 13:00'te biter; 14:00 oturumunun kurulumu 13:30'da başlar.
    let later = await addSession(await newEvent({ name: 'Eğitim', expectedPax: 12 }), { venueId: venue.meeting.id, layout: 'BOARDROOM', pax: 12, day: 50, start: '14:00', end: '16:00' });
    later = await confirm(await saveItems(later, [projectors(later.sessions[0].id, '2')]));
    assert.equal(later.status, 'DEFINITE');

    const equipment = (await setup.listEquipment(hotelId, { page: 1, pageSize: 20 })).items[0];
    const update = (stockQuantity) =>
      sales(() => setup.updateEquipment(hotelId, projector.id, contracts.updateEquipmentSchema.parse({ ...equipment, expectedUpdatedAt: equipment.updatedAt, stockQuantity })));
    await rejectsWith(update(1), 'VALIDATION', /aynı anda 2 adet/);
    await update(3);
    overlapping = await confirm(await reload(overlapping));
    assert.equal(overlapping.status, 'DEFINITE');
    // Kesin etkinlikte kalem artışı da stoğa takılır (2 + 1 + 1 > 3).
    first = await reload(first);
    await rejectsWith(saveItems(first, [menu(), projectors(first.sessions[0].id, '3')]), 'EQUIPMENT_STOCK');
  });

  /* ══════════════════ Zamanlanmış iş ══════════════════ */

  it('opsiyon süresi: son günü bir kez hatırlatılır, iş günü geçince düşer ve sıradakine haber gider', async () => {
    let first = await tentative(await pricedEvent({ name: 'Kına gecesi' }), D(0));
    const second = await tentative(await pricedEvent({ name: 'Sünnet' }, {}, MANAGER2), D(5), MANAGER2);
    const logger = { info() {}, warn() {} };

    const firstRun = await core.runWithContext({ correlationId: randomUUID(), actor: 'system' }, () => jobs.sweepHotel(hotelId, logger));
    assert.equal(firstRun.lastDay, 1);
    assert.equal(firstRun.expired, 0);
    const secondRun = await core.runWithContext({ correlationId: randomUUID(), actor: 'system' }, () => jobs.sweepHotel(hotelId, logger));
    assert.equal(secondRun.lastDay, 0);
    const reminders = await alerts({ dedupeKey: `banquet-option-last-day:${first.id}:${D(0)}` });
    assert.equal(reminders.length, 1);
    assert.equal(reminders[0].count, 1);

    // İş listeyi okuduktan sonra uzatılan opsiyon düşmez (kilit altında yeniden bakılır).
    const skipped = await core.runWithContext({ correlationId: randomUUID(), actor: 'system' }, () =>
      events.releaseOption(hotelId, first.id, { expectedUpdatedAt: null, reason: 'süre' }, { expiredBefore: D(0) }),
    );
    assert.equal(skipped.skipped, true);

    await db.event.update({ where: { id: first.id }, data: { optionUntil: new Date(`${D(-1)}T00:00:00.000Z`) } });
    const thirdRun = await core.runWithContext({ correlationId: randomUUID(), actor: 'system' }, () => jobs.sweepHotel(hotelId, logger));
    assert.equal(thirdRun.expired, 1);
    first = await reload(first);
    assert.equal(first.status, 'INQUIRY');
    assert.equal(await db.eventVenueHold.count({ where: { eventId: first.id } }), 0);
    assert.equal((await alerts({ dedupeKey: `banquet-option-expired:${first.id}:${D(-1)}` })).length, 1);
    assert.equal((await reload(second)).optionRank, 1);
    assert.equal((await alerts({ dedupeKey: `banquet-promoted:${second.id}` }))[0].userId, await userId(MANAGER2));
  });

  it('gecikmiş taksit: özet panelinde ve günde bir kez sorumluya', async () => {
    let event = await confirm(await pricedEvent());
    event = await sales(() =>
      events.saveInstallments(
        hotelId,
        event.id,
        contracts.saveInstallmentsSchema.parse({
          expectedUpdatedAt: event.updatedAt,
          installments: [
            { label: 'Depozito', dueDate: D(-2), amount: '50000' },
            { label: 'Kalan', dueDate: D(20), amount: '453000' },
          ],
        }),
      ),
    );
    await as(DESK, () => payments.receiveEventPayment(hotelId, event.id, contracts.receiveEventPaymentSchema.parse({ requestId: randomUUID(), kind: 'PAYMENT', method: 'CASH', amount: '30000' })));
    event = await reload(event);
    assert.deepEqual(event.installments.map((row) => [row.label, row.paid, row.status]), [
      ['Depozito', '30000.00', 'OVERDUE'],
      ['Kalan', '0.00', 'DUE'],
    ]);
    const summary = await events.getBanquetSummary(hotelId);
    assert.deepEqual(summary.overdue, { events: 1, amount: '20000.00', truncated: false });
    assert.equal(summary.open.definite, 1);
    const logger = { info() {}, warn() {} };
    for (let run = 0; run < 2; run += 1) await core.runWithContext({ correlationId: randomUUID(), actor: 'system' }, () => jobs.sweepHotel(hotelId, logger));
    const overdue = await alerts({ dedupeKey: `banquet-overdue:${event.id}:${D(0)}` });
    assert.equal(overdue.length, 1);
    assert.match(overdue[0].body, /20000\.00 TRY/);
  });

  /* ══════════════════ Ödemeler ══════════════════ */

  it('ödemeler: depozito, eşik üstü dört göz onay, iade sınırı, hatalı girişin iptali, tekrar gönderim, kasa', async () => {
    let event = await confirm(await pricedEvent());
    const url = `/banquet/events/${event.id}/payments`;
    const deposit = { requestId: randomUUID(), kind: 'PAYMENT', method: 'CARD', amount: '30000', reference: 'SLIP-1001' };
    const first = await call('POST', url, DESK, deposit);
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(first.json().data.payment.status, 'POSTED');
    const again = await call('POST', url, DESK, deposit);
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().data.created, false);
    assert.equal(await db.eventPayment.count({ where: { eventId: event.id } }), 1);
    // Tahsilat sürüm damgasını ilerletmez: açık kalem formu kaydedebilir.
    assert.equal((await reload(event)).updatedAt, event.updatedAt);
    assert.equal((await reload(event)).paidTotal, '30000.00');

    const large = await call('POST', url, DESK, { requestId: randomUUID(), kind: 'PAYMENT', method: 'TRANSFER', amount: '450000', reference: 'DEKONT-77' });
    assert.equal(large.statusCode, 201, large.body);
    const pending = large.json().data.payment;
    assert.equal(pending.status, 'PENDING');
    assert.equal((await reload(event)).paidTotal, '30000.00');
    await rejectsWith(as(DESK, () => approvals.decideApproval(hotelId, pending.approvalId, 'GRANTED')), 'SELF_DECISION');
    await as(MANAGER2, () => approvals.decideApproval(hotelId, pending.approvalId, 'GRANTED', { note: 'Dekont görüldü' }));
    assert.equal((await db.eventPayment.findFirst({ where: { id: pending.id } })).status, 'POSTED');
    event = await reload(event);
    assert.equal(event.paidTotal, '480000.00');
    const decided = await db.staffAlert.findFirst({ where: { hotelId, dedupeKey: `approval-decided:${pending.approvalId}` } });
    assert.equal(decided.userId, await userId(DESK));
    assert.match(decided.link, new RegExp(`/etkinlikler/${event.id}`));

    const refundTooMuch = await call('POST', url, DESK, { requestId: randomUUID(), kind: 'REFUND', method: 'TRANSFER', amount: '480000.01', reference: 'IADE-1' });
    assert.equal(refundTooMuch.statusCode, 422);
    assert.match(refundTooMuch.json().error, /En fazla 480000\.00/);
    assert.ok(refundTooMuch.json().fields.amount);
    const refund = (await call('POST', url, DESK, { requestId: randomUUID(), kind: 'REFUND', method: 'TRANSFER', amount: '10000', reference: 'IADE-2' })).json().data.payment;
    assert.equal(refund.status, 'PENDING');
    assert.equal(refund.amount, '-10000.00');
    let list = (await call('GET', url, KITCHEN)).json().data;
    assert.equal(list.summary.refundable, '470000.00');
    await as(MANAGER2, () => approvals.decideApproval(hotelId, refund.approvalId, 'DENIED', { note: 'Müşteri vazgeçti' }));
    assert.equal((await db.eventPayment.findFirst({ where: { id: refund.id } })).status, 'DECLINED');

    const card = first.json().data.payment;
    const voidRequest = await call('POST', `${url}/${card.id}/void`, DESK, { reason: 'Slip iki kez girildi' });
    assert.equal(voidRequest.statusCode, 200, voidRequest.body);
    assert.equal(voidRequest.json().data.payment.voidPending, true);
    const second = await call('POST', `${url}/${card.id}/void`, DESK, { reason: 'Tekrar' });
    assert.equal(second.statusCode, 409);
    await as(MANAGER2, () => approvals.decideApproval(hotelId, voidRequest.json().data.approvalId, 'GRANTED'));
    const reversal = await db.eventPayment.findFirst({ where: { reversalOfId: card.id } });
    assert.equal(reversal.kind, 'REVERSAL');
    assert.equal(String(reversal.amount), '-30000');
    assert.equal(reversal.receivedBy, DESK);
    assert.equal((await reload(event)).paidTotal, '450000.00');
    const voidReversal = await call('POST', `${url}/${reversal.id}/void`, DESK, { reason: 'Olmaz' });
    assert.equal(voidReversal.statusCode, 409);
    assert.match(voidReversal.json().error, /İptal kaydı/);

    // Kasa: etkinlik ödemeleri "Etkinlik" kaynağıyla aynı kasada.
    const summary = await as(DESK, () => cash.getCashSummary(hotelId, { mine: false }));
    const byMethod = Object.fromEntries(summary.methods.map((line) => [line.method, line]));
    assert.equal(byMethod.CARD.received, '30000.00');
    assert.equal(byMethod.CARD.voided, '-30000.00');
    assert.equal(byMethod.TRANSFER.net, '450000.00');
    assert.equal(summary.origins.EVENT, '450000.00');
    assert.equal(summary.origins.FOLIO, '0.00');
    assert.equal(summary.pending.count, 0);
    const seen = [];
    let cursor;
    do {
      const page = await as(DESK, () => cash.listCashMovements(hotelId, { mine: false, limit: 1, cursor }));
      seen.push(...page.movements.map((row) => [row.origin, row.kind, row.event.code]));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.equal(seen.length, 3);
    assert.deepEqual(new Set(seen.map((row) => row[1])), new Set(['PAYMENT', 'REVERSAL']));
    assert.ok(seen.every((row) => row[0] === 'EVENT' && row[2] === event.code));
    assert.equal((await as(DESK, () => cash.listCashMovements(hotelId, { mine: false, limit: 10, origin: 'FOLIO' }))).movements.length, 0);
    list = (await call('GET', `${url}?limit=2`, KITCHEN)).json().data;
    assert.equal(list.payments.length, 2);
    assert.ok(list.nextCursor);
  });

  it('iptal: bedel kesinleşirken kopyalanan kademeden; fazla ödemeye iade uyarısı; bedelli proforma; kayba tahsilat yok', async () => {
    let event = await confirm(await pricedEvent());
    await as(DESK, () => payments.receiveEventPayment(hotelId, event.id, contracts.receiveEventPaymentSchema.parse({ requestId: randomUUID(), kind: 'PAYMENT', method: 'CASH', amount: '300000' })));
    // Politika sonradan sertleşir: kesin etkinlik kendi kopyasıyla iptal olur.
    await sales(async () => {
      const current = await setup.getSettings(hotelId);
      return setup.updateSettings(hotelId, contracts.updateEventSettingsSchema.parse({ ...current, expectedUpdatedAt: current.updatedAt, cancellationTiers: [{ daysBefore: 0, feePct: '100' }] }));
    });
    event = await reload(event);
    // 300 kişi × 1500 + 80 000 = 530 000; 30 gün kala "14 gün ve üstü" kademesi %50.
    assert.deepEqual(event.cancellationPreview, { feePct: '50', fee: '265000.00' });
    event = await sales(() => events.cancelEvent(hotelId, event.id, { expectedUpdatedAt: version(event), reason: 'Şirket etkinliği erteledi' }));
    assert.equal(event.status, 'CANCELLED');
    assert.equal(event.cancellationFee, '265000.00');
    assert.equal(event.amountDue, '265000.00');
    assert.equal(event.balance, '-35000.00');
    assert.equal(await db.eventVenueHold.count({ where: { eventId: event.id } }), 0);
    const refundAlert = await alerts({ dedupeKey: `banquet-refund:${event.id}` });
    assert.match(refundAlert[0].body, /35000\.00 TRY iade/);

    const extra = contracts.receiveEventPaymentSchema.parse({ requestId: randomUUID(), kind: 'PAYMENT', method: 'CASH', amount: '1' });
    await rejectsWith(as(DESK, () => payments.receiveEventPayment(hotelId, event.id, extra)), 'VALIDATION', /iptal bedeli kalmadı/);
    const proforma = await sales(() => documents.issueDocument(hotelId, event.id, { expectedUpdatedAt: version(event), kind: 'PROFORMA', note: null }));
    assert.match(proforma.number, /^PRF-\d{4}-0001$/);
    assert.equal(proforma.grandTotal, '265000.00');
    const snapshot = (await db.eventDocument.findFirst({ where: { id: proforma.id } })).snapshot;
    assert.equal(snapshot.cancellation.feePct, '50');
    assert.equal(snapshot.balance, '-35000.00');
    assert.equal((await reload(event)).proformaIssued, true);
    // İptal bedelini karşılayan para iade edilmez: yalnızca 35.000 fazla.
    const refund = (amount) =>
      as(DESK, () =>
        payments.receiveEventPayment(hotelId, event.id, contracts.receiveEventPaymentSchema.parse({ requestId: randomUUID(), kind: 'REFUND', method: 'TRANSFER', amount, reference: 'IADE-9' })),
      );
    await rejectsWith(refund('35000.01'), 'VALIDATION', /borcun üstündeki fazla/);
    assert.equal((await refund('35000')).payment.status, 'PENDING');
    assert.equal((await reload(event)).paymentSummary.refundable, '0.00');

    const lost = await sales(async () => {
      const draft = await newEvent({ name: 'Kaybedilen' });
      return events.loseEvent(hotelId, draft.id, { expectedUpdatedAt: version(draft), reason: 'Rakip otel seçildi' });
    });
    assert.equal(lost.status, 'LOST');
    await rejectsWith(as(DESK, () => payments.receiveEventPayment(hotelId, lost.id, { ...extra, requestId: randomUUID() })), 'VALIDATION', /Kaybedilen/);
  });

  /* ══════════════════ Belgeler ══════════════════ */

  it('belgeler: teklif sürümleri, kabul, imzasız sözleşmeyle kesinleşmeme, değişiklik eki, PDF ve izin', async () => {
    await sales(async () => {
      const current = await setup.getSettings(hotelId);
      return setup.updateSettings(hotelId, contracts.updateEventSettingsSchema.parse({ ...current, expectedUpdatedAt: current.updatedAt, requireSignedContract: true }));
    });
    let event = await pricedEvent({}, { day: 10 });
    const issue = (kind, target = event) => sales(() => documents.issueDocument(hotelId, target.id, { expectedUpdatedAt: version(target), kind, note: null }));

    const offer1 = await issue('OFFER');
    assert.match(offer1.number, /^TKL-\d{4}-0001$/);
    assert.equal(offer1.version, 1);
    // Geçerlilik politikadan (14 gün) ama etkinliğin ilk gününü (10. gün) geçmez.
    assert.equal(offer1.validUntil, D(10));
    const offer2 = await issue('OFFER');
    assert.equal(offer2.number, `${offer1.number}/2`);
    assert.equal((await db.eventDocument.findFirst({ where: { id: offer1.id } })).status, 'SUPERSEDED');
    const decide = (document, decision, date) => sales(() => documents.decideDocument(hotelId, event.id, document.id, { decision, ...(date ? { date: new Date(date) } : {}) }));
    await rejectsWith(decide(offer1, 'ACCEPTED'), 'DOCUMENT_RULE', /yeni sürümü/);
    await rejectsWith(decide(offer2, 'ACCEPTED', D(1)), 'VALIDATION', /ileri/);
    assert.equal((await decide(offer2, 'ACCEPTED')).status, 'ACCEPTED');

    const contract = await issue('CONTRACT');
    assert.match(contract.number, /^SZL-\d{4}-0001$/);
    await rejectsWith(confirm(await reload(event)), 'CONTRACT_REQUIRED');
    await rejectsWith(decide(contract, 'ACCEPTED'), 'DOCUMENT_RULE', /imzalandı/);
    assert.equal((await decide(contract, 'SIGNED')).status, 'SIGNED');
    event = await confirm(await reload(event));
    assert.equal(event.status, 'DEFINITE');
    assert.equal(event.contractSigned, true);

    await rejectsWith(issue('OFFER'), 'DOCUMENT_RULE', /sözleşme sürümü/);
    await rejectsWith(issue('PROFORMA'), 'DOCUMENT_RULE', /gerçekleşince/);
    // Kesin etkinlikte değişiklik eki: yeni sürüm imza bekler, etkinlik kesin kalır.
    const amendment = await issue('CONTRACT');
    assert.equal(amendment.number, `${contract.number}/2`);
    event = await reload(event);
    assert.equal(event.status, 'DEFINITE');
    assert.equal(event.contractSigned, false);

    // Ekran eski dosyayı görüyorsa belge üretilmez.
    const stale = { ...event };
    event = await saveItems(event, [menu('1600'), rental]);
    await rejectsWith(issue('CONTRACT', stale), 'STALE_WRITE');

    // Aynı anda iki teklif: sırayla iki sürüm, tek güncel.
    const other = await pricedEvent({ name: 'Paralel teklif' }, { day: 12 });
    const [a, b] = await Promise.all([issue('OFFER', other), issue('OFFER', other)]);
    assert.deepEqual([a.version, b.version].sort(), [1, 2]);
    assert.equal(await db.eventDocument.count({ where: { eventId: other.id, kind: 'OFFER', status: { not: 'SUPERSEDED' } } }), 1);

    const file = await call('GET', `/banquet/events/${event.id}/documents/${amendment.id}/file`, KITCHEN);
    assert.equal(file.statusCode, 200);
    assert.equal(file.headers['content-type'], 'application/pdf');
    assert.match(file.headers['content-disposition'], /filename="Sozlesme-SZL-\d{4}-0001-2\.pdf"/);
    assert.equal(file.rawPayload.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.equal((await call('GET', `/banquet/events/${event.id}/documents/${amendment.id}/file`, HOUSEKEEPING)).statusCode, 403);
  });

  /* ══════════════════ Sürüm, izin, otel kapsamı ══════════════════ */

  it('sürüm: eski formla yazılamaz; ödeme planı sürümü ilerletir', async () => {
    const event = await pricedEvent();
    const update = (target) =>
      sales(() =>
        events.updateEvent(
          hotelId,
          event.id,
          contracts.updateEventSchema.parse({ expectedUpdatedAt: target.updatedAt, name: 'Yeni ad', type: 'GALA', clientId: client.id, expectedPax: 300 }),
        ),
      );
    const planned = await sales(() =>
      events.saveInstallments(hotelId, event.id, contracts.saveInstallmentsSchema.parse({ expectedUpdatedAt: event.updatedAt, installments: [{ label: 'Depozito', dueDate: D(1), amount: '1000' }] })),
    );
    await rejectsWith(update(event), 'STALE_WRITE');
    assert.equal((await update(planned)).name, 'Yeni ad');
    const suggestion = await events.suggestPlan(hotelId, event.id);
    assert.deepEqual(suggestion.installments.map((row) => row.amount), ['159000.00', '371000.00']);
  });

  it('izinler ve otel kapsamı', async () => {
    const event = await pricedEvent();
    assert.equal((await call('GET', '/banquet/events', HOUSEKEEPING)).statusCode, 403);
    const list = await call('GET', '/banquet/events?status=INQUIRY', KITCHEN);
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().data.items.length, 1);
    const payload = { name: 'Toplantı', type: 'MEETING', clientId: client.id, expectedPax: 10 };
    assert.equal((await call('POST', '/banquet/events', KITCHEN, payload)).statusCode, 403);
    assert.equal((await call('POST', '/banquet/events', DESK, payload)).statusCode, 403);
    assert.equal((await call('POST', '/banquet/events', MANAGER, payload)).statusCode, 201);
    assert.equal((await call('POST', '/banquet/equipment', DESK, { code: 'MIK', name: 'Mikrofon', unitPrice: '100', stockQuantity: 4 })).statusCode, 403);
    assert.equal((await call('PUT', '/banquet/settings', MANAGER, { optionDays: 7, offerValidityDays: 14, depositPct: '30', requireSignedContract: false, cancellationTiers: [] })).statusCode, 409);

    // Başka otelin dosyası, salonu, müşterisi görünmez ve kullanılamaz.
    const foreignClient = await db.eventClient.create({ data: { hotelId: otherHotelId, type: 'PERSON', name: 'Yabancı', createdBy: 'x' } });
    const foreign = await db.event.create({
      data: { hotelId: otherHotelId, code: 'ETK-2026-0001', name: 'Yabancı etkinlik', type: 'GALA', clientId: foreignClient.id, ownerEmail: 'x@y.z', expectedPax: 10, currency: 'TRY', createdBy: 'x' },
    });
    const foreignVenue = await db.venue.create({ data: { hotelId: otherHotelId, code: 'X', name: 'Yabancı salon', createdBy: 'x', capacities: { create: [{ layout: 'BANQUET', capacity: 100 }] } } });
    assert.equal((await call('GET', `/banquet/events/${foreign.id}`, MANAGER)).statusCode, 404);
    assert.equal((await call('GET', `/banquet/events/${foreign.id}/payments`, MANAGER)).statusCode, 404);
    const pay = await call('POST', `/banquet/events/${foreign.id}/payments`, DESK, { requestId: randomUUID(), kind: 'PAYMENT', method: 'CASH', amount: '100' });
    assert.equal(pay.statusCode, 404);
    await rejectsWith(addSession(await reload(event), { venueId: foreignVenue.id, pax: 50 }), 'VALIDATION', /Salon bulunamadı/);
    const otherHotelClient = await call('POST', '/banquet/events', MANAGER, { ...payload, clientId: foreignClient.id });
    assert.equal(otherHotelClient.statusCode, 422);
    assert.equal((await call('GET', `/banquet/clients/${foreignClient.id}`, MANAGER)).statusCode, 404);
  });
});
