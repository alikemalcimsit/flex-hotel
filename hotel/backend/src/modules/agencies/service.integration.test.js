import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Acente ve kontrat (modül 29) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: acente kartı (tekil kod / ad, sürüm, pasif), kontrat yaşam döngüsü
 * (taslak → satışta → sonlandı, çakışma, dönem dışı fiyat, boş kontrat),
 * stop-sale, rezervasyonun kontrat fiyatını alması (pansiyon, iki kontrata
 * yayılan konaklama, elle fiyat, grup), reddedilen satışlar (stop-sale, fiyatsız
 * gece, pasif acente, kontratsız gün), düzenlemede yeniden fiyatlama (uzatma,
 * pansiyon, acente atama / kaldırma, içerideki misafir, eski gecenin fiyatı),
 * iptal geri alma, komisyonun açılıştaki oranı, önizleme, cari özeti, izinler,
 * kilit düzeni (stop-sale yazılırken gelen rezervasyon) ve ayar korumaları.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'mudur@test.local';
const ACCOUNTING = 'muhasebe@test.local';
const DESK = 'resepsiyon@test.local';

describe('acente ve kontrat (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let agencies;
  /** @type {any} */ let reservations;
  /** @type {any} */ let settings;
  /** @type {any} */ let locks;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let otherHotelId;
  /** @type {Record<string, any>} */ let types;
  /** @type {Map<string, string>} */ let tokens;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    agencies = await import('./service.js');
    reservations = await import('../reservations/service.js');
    settings = await import('../settings/service.js');
    locks = await import('../../lib/locks.js');
    cache = await import('../../lib/cache.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const manager = (fn) => as(MANAGER, fn);
  const desk = (fn) => as(DESK, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const D = (offset) => core.toIsoDay(core.addDays(today(), offset));
  const date = (offset) => new Date(D(offset));
  const eventNames = async () => (await db.eventLog.findMany({ where: { hotelId }, orderBy: { occurredAt: 'asc' }, select: { name: true } })).map((row) => row.name);

  beforeEach(async () => {
    await resetDatabase(db);
    cache.invalidateHotelSettings?.(hotelId);
    tokens = new Map();
    const hotel = await db.hotel.create({ data: { name: 'Deniz Otel', code: `A${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } });
    hotelId = hotel.id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka Otel', code: `B${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    cache.invalidateHotelSettings?.(hotelId);

    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: ACCOUNTING, name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
        { hotelId, email: DESK, name: 'Resepsiyon', role: 'FRONT_DESK', passwordHash },
      ],
    });
    const type = (code, basePrice, capacityAdults = 2) => db.roomType.create({ data: { hotelId, code, name: `${code} oda`, basePrice, capacityAdults, capacityChildren: 1 } });
    types = { std: await type('STD', '1000'), dlx: await type('DLX', '2000', 3) };
    for (let number = 101; number <= 105; number += 1) await db.room.create({ data: { hotelId, number: String(number), roomTypeId: types.std.id } });
    for (let number = 201; number <= 203; number += 1) await db.room.create({ data: { hotelId, number: String(number), roomTypeId: types.dlx.id } });
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

  const agencyInput = (overrides = {}) => ({
    code: `AG${randomUUID().slice(0, 4).toUpperCase()}`,
    name: `Acente ${randomUUID().slice(0, 6)}`,
    contactName: 'Yetkili Kişi',
    phone: null,
    email: null,
    address: null,
    taxOffice: null,
    taxNumber: null,
    commissionPct: '10',
    paymentTermDays: 30,
    notes: null,
    ...overrides,
  });
  const makeAgency = (overrides = {}) => manager(() => agencies.createAgency(hotelId, agencyInput(overrides)));

  /** Fiyat satırı: oda tipi anahtarı, pansiyon, gün aralığı (bugüne göre), fiyat. */
  const rate = (typeKey, boardType, start, end, price) => ({ roomTypeId: types[typeKey].id, boardType, startDate: date(start), endDate: date(end), price });

  /** Taslak aç, fiyatları kaydet, satışa aç. */
  async function liveContract(agency, { name = 'Yaz', start = 0, end = 200, rates, stopSales = [] } = {}) {
    const defaultRates = [
      rate('std', 'BB', 0, 99, '1800'),
      rate('std', 'BB', 100, 200, '2100'),
      rate('std', 'AI', 0, 200, '2600'),
      rate('dlx', 'BB', 0, 200, '3000'),
    ];
    let detail = await manager(() => agencies.createContract(hotelId, agency.id, { name, startDate: date(start), endDate: date(end), notes: null }));
    detail = await manager(() => agencies.saveContractRates(hotelId, detail.id, { expectedUpdatedAt: new Date(detail.updatedAt), rates: rates ?? defaultRates }));
    detail = await manager(() => agencies.activateContract(hotelId, detail.id, { expectedUpdatedAt: new Date(detail.updatedAt) }));
    for (const stop of stopSales) detail = await manager(() => agencies.addStopSale(hotelId, detail.id, stop));
    return detail;
  }

  const reservationInput = (overrides = {}) => ({
    guestId: null,
    guest: { firstName: 'Ayşe', lastName: 'Yılmaz', phone: '0532 111 00 01', email: 'ayse@example.com', nationality: 'TR' },
    forceNewGuest: false,
    roomTypeId: types.std.id,
    adults: 2,
    children: 0,
    boardType: 'BB',
    checkIn: date(10),
    checkOut: date(13),
    status: 'CONFIRMED',
    source: 'AGENCY',
    notes: null,
    requestId: randomUUID(),
    waitlistId: null,
    roomId: null,
    manualTotal: null,
    priceNote: null,
    agencyId: null,
    ...overrides,
  });
  const book = (agency, overrides = {}, options = {}) => desk(() => reservations.createReservation(hotelId, reservationInput({ agencyId: agency?.id ?? null, ...overrides }), options));
  const nightsOf = (reservation) => reservation.nightlyRates.map((night) => [night.date, night.amount]);
  const rejectsWith = (promise, code, pattern) =>
    assert.rejects(promise, (error) => {
      assert.equal(error.code, code, error.message);
      if (pattern) assert.match(error.message, pattern);
      return true;
    });

  /* ══════════════════ Acente kartı ══════════════════ */

  describe('acente kartı', () => {
    it('açar: sürüm, denetim izi, olay; kod büyük harf, komisyon ve vade saklanır', async () => {
      const agency = await makeAgency({ code: 'TUI', name: 'TUI Türkiye', commissionPct: '12.5', paymentTermDays: 45 });
      assert.equal(agency.code, 'TUI');
      assert.equal(agency.commissionPct, '12.50');
      assert.equal(agency.paymentTermDays, 45);
      assert.equal(agency.status, 'ACTIVE');
      assert.deepEqual(agency.contracts, []);
      const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'Agency', entityId: agency.id } });
      assert.equal(audit.action, 'CREATE');
      assert.equal(audit.actor, MANAGER);
      assert.deepEqual(await eventNames(), ['agency.changed']);
    });

    it('kod ve ad otel içinde tekil (ad büyük / küçük harf duyarsız); başka otelde aynı kod olur', async () => {
      await makeAgency({ code: 'TUI', name: 'TUI Türkiye' });
      await assert.rejects(makeAgency({ code: 'TUI', name: 'Başka Ad' }), (error) => error.fields?.code && /koda/.test(error.message));
      await assert.rejects(makeAgency({ code: 'XYZ', name: 'tui türkiye' }), (error) => error.fields?.name && /adla/.test(error.message));
      await db.agency.create({ data: { hotelId: otherHotelId, code: 'TUI', name: 'TUI Türkiye', createdBy: 'test' } });
      assert.equal((await agencies.listAgencies(hotelId, { page: 1, pageSize: 20 })).items.length, 1);
    });

    it('veritabanı kısıtı yarışta da tekilliği korur (eşzamanlı aynı kod)', async () => {
      const results = await Promise.allSettled([makeAgency({ code: 'RACE', name: 'Yarış Bir' }), makeAgency({ code: 'RACE', name: 'Yarış İki' })]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(await db.agency.count({ where: { hotelId, code: 'RACE' } }), 1);
    });

    it('güncelleme sürümlü: eski sürüm 409; komisyon değişir; denetim izi önce / sonra', async () => {
      const agency = await makeAgency({ commissionPct: '10' });
      const input = { ...agencyInput({ code: agency.code, name: agency.name, commissionPct: '15' }), expectedUpdatedAt: new Date(agency.updatedAt) };
      const updated = await manager(() => agencies.updateAgency(hotelId, agency.id, input));
      assert.equal(updated.commissionPct, '15.00');
      await rejectsWith(manager(() => agencies.updateAgency(hotelId, agency.id, input)), 'STALE_WRITE');
      const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'Agency', entityId: agency.id, action: 'UPDATE' } });
      assert.deepEqual(audit.changedFields, ['commissionPct']);
    });

    it('pasife alma / yeniden aktif etme; aynı durum yazılmaz', async () => {
      const agency = await makeAgency();
      const passive = await manager(() => agencies.setAgencyStatus(hotelId, agency.id, { expectedUpdatedAt: new Date(agency.updatedAt), status: 'PASSIVE' }));
      assert.equal(passive.status, 'PASSIVE');
      const same = await manager(() => agencies.setAgencyStatus(hotelId, agency.id, { expectedUpdatedAt: new Date(passive.updatedAt), status: 'PASSIVE' }));
      assert.equal(same.updatedAt, passive.updatedAt, 'değişmeyen durum sürümü ilerletmez');
      assert.equal(await db.auditLog.count({ where: { hotelId, entity: 'Agency', action: 'UPDATE' } }), 1);
      await rejectsWith(manager(() => agencies.setAgencyStatus(hotelId, agency.id, { expectedUpdatedAt: new Date(agency.updatedAt), status: 'ACTIVE' })), 'STALE_WRITE');
    });

    it('liste: arama (ad / kod / yetkili), durum süzgeci, sayfalama, sıralı; seçici yalnız aktif ve sınırlı alan döner', async () => {
      const first = await makeAgency({ code: 'AAA', name: 'Anadolu Turizm', contactName: 'Mehmet Bey' });
      await makeAgency({ code: 'BBB', name: 'Boğaz Seyahat' });
      await makeAgency({ code: 'CCC', name: 'Cumhuriyet Tur' });
      await manager(() => agencies.setAgencyStatus(hotelId, first.id, { expectedUpdatedAt: new Date(first.updatedAt), status: 'PASSIVE' }));

      const all = await agencies.listAgencies(hotelId, { page: 1, pageSize: 2 });
      assert.deepEqual(all.items.map((item) => item.code), ['AAA', 'BBB'], 'ada göre sıralı');
      assert.deepEqual([all.meta.total, all.meta.totalPages], [3, 2]);
      assert.deepEqual((await agencies.listAgencies(hotelId, { page: 2, pageSize: 2 })).items.map((item) => item.code), ['CCC']);
      assert.deepEqual((await agencies.listAgencies(hotelId, { page: 1, pageSize: 20, status: 'PASSIVE' })).items.map((item) => item.code), ['AAA']);
      assert.deepEqual((await agencies.listAgencies(hotelId, { page: 1, pageSize: 20, search: 'mehmet' })).items.map((item) => item.code), ['AAA'], 'yetkili adıyla');
      assert.deepEqual((await agencies.listAgencies(hotelId, { page: 1, pageSize: 20, search: 'bbb' })).items.map((item) => item.code), ['BBB'], 'kodla, büyük / küçük harf duyarsız');

      const options = await agencies.searchAgencyOptions(hotelId, { q: 'tur' });
      assert.deepEqual(options.items.map((item) => item.code), ['CCC'], 'pasif acente seçicide yok');
      assert.deepEqual(Object.keys(options.items[0]).sort(), ['code', 'id', 'name', 'status'], 'komisyon / vergi bilgisi dönmez');
      assert.equal((await agencies.searchAgencyOptions(hotelId, { id: first.id })).items.length, 1, 'seçili acente kimliğiyle gelir (pasif de)');
    });

    it('başka otelin acentesi görünmez ve değiştirilemez', async () => {
      const foreign = await db.agency.create({ data: { hotelId: otherHotelId, code: 'YAB', name: 'Yabancı', createdBy: 'test' } });
      await rejectsWith(agencies.getAgency(hotelId, foreign.id), 'NOT_FOUND');
      await rejectsWith(manager(() => agencies.setAgencyStatus(hotelId, foreign.id, { expectedUpdatedAt: new Date(), status: 'PASSIVE' })), 'NOT_FOUND');
      await rejectsWith(manager(() => agencies.createContract(hotelId, foreign.id, { name: 'X1', startDate: date(0), endDate: date(10) })), 'NOT_FOUND');
      assert.equal((await agencies.searchAgencyOptions(hotelId, { id: foreign.id })).items.length, 0);
      await rejectsWith(agencies.getAgencySummary(hotelId, foreign.id, {}), 'NOT_FOUND');
    });
  });

  /* ══════════════════ Kontrat ══════════════════ */

  describe('kontrat yaşam döngüsü', () => {
    it('taslak → fiyat → satışa aç → sonlandır; her adım denetim izi ve olay bırakır', async () => {
      const agency = await makeAgency();
      let detail = await manager(() => agencies.createContract(hotelId, agency.id, { name: 'Yaz 2027', startDate: date(0), endDate: date(100), notes: null }));
      assert.equal(detail.status, 'DRAFT');
      assert.equal(detail.currency, 'TRY');
      assert.match(detail.blockers.join(' '), /en az bir fiyat/);

      detail = await manager(() => agencies.saveContractRates(hotelId, detail.id, { expectedUpdatedAt: new Date(detail.updatedAt), rates: [rate('std', 'BB', 0, 100, '1800')] }));
      assert.deepEqual(detail.blockers, []);
      assert.equal(detail.rates.length, 1);
      assert.equal(detail.rates[0].price, '1800.00');

      detail = await manager(() => agencies.activateContract(hotelId, detail.id, { expectedUpdatedAt: new Date(detail.updatedAt) }));
      assert.equal(detail.status, 'ACTIVE');
      assert.ok(detail.activatedAt);

      detail = await manager(() => agencies.endContract(hotelId, detail.id, { expectedUpdatedAt: new Date(detail.updatedAt), reason: 'Acente ile anlaşma bitti' }));
      assert.equal(detail.status, 'ENDED');
      assert.equal(detail.endReason, 'Acente ile anlaşma bitti');

      assert.deepEqual(await eventNames(), ['agency.changed', 'agency.contract.changed', 'agency.contract.changed', 'agency.contract.changed', 'agency.contract.changed']);
      const audits = await db.auditLog.findMany({ where: { hotelId, entity: { in: ['Contract', 'ContractRate'] } }, orderBy: { createdAt: 'asc' } });
      assert.deepEqual(audits.map((row) => [row.entity, row.action]), [['Contract', 'CREATE'], ['ContractRate', 'UPDATE'], ['Contract', 'UPDATE'], ['Contract', 'UPDATE']]);
    });

    it('fiyat kaydı: dönem dışı, çakışan, bilinmeyen oda tipi, eski sürüm reddedilir; satıştaki kontrat boşaltılamaz', async () => {
      const agency = await makeAgency();
      const draft = await manager(() => agencies.createContract(hotelId, agency.id, { name: 'Yaz', startDate: date(10), endDate: date(60), notes: null }));
      const save = (rates, version = draft.updatedAt) => manager(() => agencies.saveContractRates(hotelId, draft.id, { expectedUpdatedAt: new Date(version), rates }));

      await assert.rejects(save([rate('std', 'BB', 5, 30, '100')]), (error) => error.fields?.['rates.0.startDate'] && /başlangıcından/.test(error.message));
      await assert.rejects(save([rate('std', 'BB', 10, 70, '100')]), (error) => /bitişinden/.test(error.message));
      await assert.rejects(save([rate('std', 'BB', 10, 30, '100'), rate('std', 'BB', 30, 40, '110')]), (error) => /çakışıyor/.test(error.message));
      await assert.rejects(save([{ ...rate('std', 'BB', 10, 30, '100'), roomTypeId: randomUUID() }]), (error) => /oda tipi/.test(error.message));
      await rejectsWith(save([rate('std', 'BB', 10, 30, '100')], new Date(Date.parse(draft.updatedAt) - 5000)), 'STALE_WRITE');
      assert.equal(await db.contractRate.count({ where: { contractId: draft.id } }), 0, 'reddedilen kayıt satır bırakmaz');

      const saved = await save([rate('std', 'BB', 10, 30, '100'), rate('std', 'AI', 10, 30, '150'), rate('std', 'BB', 31, 60, '120')]);
      assert.equal(saved.rates.length, 3);
      const live = await manager(() => agencies.activateContract(hotelId, saved.id, { expectedUpdatedAt: new Date(saved.updatedAt) }));
      await rejectsWith(manager(() => agencies.saveContractRates(hotelId, live.id, { expectedUpdatedAt: new Date(live.updatedAt), rates: [] })), 'VALIDATION', /en az bir fiyat/);
    });

    it('fiyat kaydı tümünü değiştirir; değişmeyen tablo sürümü ilerletmez; fark denetim izine yazılır', async () => {
      const agency = await makeAgency();
      const live = await liveContract(agency, { rates: [rate('std', 'BB', 0, 100, '1800'), rate('dlx', 'BB', 0, 100, '3000')] });
      const same = await manager(() =>
        agencies.saveContractRates(hotelId, live.id, { expectedUpdatedAt: new Date(live.updatedAt), rates: [rate('std', 'BB', 0, 100, '1800'), rate('dlx', 'BB', 0, 100, '3000')] }),
      );
      assert.equal(same.updatedAt, live.updatedAt, 'aynı tablo: yazılmaz');

      const changed = await manager(() =>
        agencies.saveContractRates(hotelId, live.id, { expectedUpdatedAt: new Date(live.updatedAt), rates: [rate('std', 'BB', 0, 100, '1900'), rate('std', 'AI', 0, 100, '2500')] }),
      );
      assert.deepEqual(changed.rates.map((row) => [row.boardType, row.price]).sort(), [['AI', '2500.00'], ['BB', '1900.00']]);
      const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'ContractRate', entityId: live.id }, orderBy: { createdAt: 'desc' } });
      assert.deepEqual(audit.after.changed, [`STD BB ${D(0)}..${D(100)}: 1800.00 → 1900.00`]);
      assert.deepEqual(audit.after.added, [`STD AI ${D(0)}..${D(100)} = 2500.00`]);
      assert.deepEqual(audit.after.removed, [`DLX BB ${D(0)}..${D(100)} = 3000.00`]);
      assert.equal(audit.before.rateCount, 2);
    });

    it('aynı acentenin aynı günü kapsayan ikinci satıştaki kontratı olmaz; taslaklar çakışabilir; bitişik dönem olur', async () => {
      const agency = await makeAgency();
      const first = await liveContract(agency, { name: 'Birinci', start: 0, end: 99, rates: [rate('std', 'BB', 0, 99, '1800')] });
      const overlapping = await manager(() => agencies.createContract(hotelId, agency.id, { name: 'Çakışan', startDate: date(50), endDate: date(150), notes: null }));
      const withRate = await manager(() => agencies.saveContractRates(hotelId, overlapping.id, { expectedUpdatedAt: new Date(overlapping.updatedAt), rates: [rate('std', 'BB', 50, 150, '1')] }));
      assert.match(withRate.blockers.join(' '), /"Birinci" kontratı bu tarihlerde satışta/);
      await rejectsWith(manager(() => agencies.activateContract(hotelId, withRate.id, { expectedUpdatedAt: new Date(withRate.updatedAt) })), 'CONTRACT_OVERLAP');

      // Bitişik dönem (ertesi gün başlayan) sorunsuz.
      const adjacent = await manager(() => agencies.createContract(hotelId, agency.id, { name: 'Bitişik', startDate: date(100), endDate: date(150), notes: null }));
      const adjacentRated = await manager(() => agencies.saveContractRates(hotelId, adjacent.id, { expectedUpdatedAt: new Date(adjacent.updatedAt), rates: [rate('std', 'BB', 100, 150, '2000')] }));
      const activated = await manager(() => agencies.activateContract(hotelId, adjacentRated.id, { expectedUpdatedAt: new Date(adjacentRated.updatedAt) }));
      assert.equal(activated.status, 'ACTIVE');

      // Başka acentenin aynı dönemi çakışma sayılmaz.
      const other = await makeAgency();
      assert.equal((await liveContract(other, { name: 'Diğer', start: 0, end: 99, rates: [rate('std', 'BB', 0, 99, '1700')] })).status, 'ACTIVE');

      // Satıştaki kontratın dönemi uzatılıp çakıştırılamaz.
      await rejectsWith(
        manager(() => agencies.updateContract(hotelId, first.id, { expectedUpdatedAt: new Date(first.updatedAt), name: 'Birinci', startDate: date(0), endDate: date(120), notes: null })),
        'CONTRACT_OVERLAP',
      );
    });

    it('eşzamanlı iki çakışan taslak aynı anda satışa açılırsa yalnız biri açılır', async () => {
      const agency = await makeAgency();
      const make = async (name) => {
        const draft = await manager(() => agencies.createContract(hotelId, agency.id, { name: `Kontrat ${name}`, startDate: date(0), endDate: date(50), notes: null }));
        return manager(() => agencies.saveContractRates(hotelId, draft.id, { expectedUpdatedAt: new Date(draft.updatedAt), rates: [rate('std', 'BB', 0, 50, '1000')] }));
      };
      const [a, b] = [await make('A'), await make('B')];
      const results = await Promise.allSettled([
        manager(() => agencies.activateContract(hotelId, a.id, { expectedUpdatedAt: new Date(a.updatedAt) })),
        manager(() => agencies.activateContract(hotelId, b.id, { expectedUpdatedAt: new Date(b.updatedAt) })),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(await db.contract.count({ where: { agencyId: agency.id, status: 'ACTIVE' } }), 1);
    });

    it('dönem değişikliği: fiyat ve stop-sale yeni dönemin içinde kalmalı; sonlandırılmış kontrat düzenlenmez', async () => {
      const agency = await makeAgency();
      const live = await liveContract(agency, { start: 0, end: 100, rates: [rate('std', 'BB', 0, 100, '1800')], stopSales: [{ roomTypeId: null, startDate: date(90), endDate: date(95), reason: null }] });
      const shrink = (end, detail = live) => manager(() => agencies.updateContract(hotelId, live.id, { expectedUpdatedAt: new Date(detail.updatedAt), name: live.name, startDate: date(0), endDate: date(end), notes: null }));
      await assert.rejects(shrink(50), (error) => /dışında kalan 1 fiyat satırı ve 1 stop-sale/.test(error.message));
      const widened = await shrink(150);
      assert.equal(widened.endDate, D(150));
      const ended = await manager(() => agencies.endContract(hotelId, live.id, { expectedUpdatedAt: new Date(widened.updatedAt), reason: 'Sezon kapandı' }));
      await rejectsWith(shrink(120, ended), 'CONTRACT_ENDED');
      await rejectsWith(manager(() => agencies.saveContractRates(hotelId, live.id, { expectedUpdatedAt: new Date(ended.updatedAt), rates: [] })), 'CONTRACT_ENDED');
      await rejectsWith(manager(() => agencies.addStopSale(hotelId, live.id, { roomTypeId: null, startDate: date(1), endDate: date(2) })), 'CONTRACT_ENDED');
    });

    it('satışa açma engelleri: pasif acente, para birimi, geçmiş dönem; yalnız taslak açılır, yalnız taslak silinir', async () => {
      const agency = await makeAgency();
      const draft = await manager(() => agencies.createContract(hotelId, agency.id, { name: 'Kış', startDate: date(0), endDate: date(100), notes: null }));
      const rated = await manager(() => agencies.saveContractRates(hotelId, draft.id, { expectedUpdatedAt: new Date(draft.updatedAt), rates: [rate('std', 'BB', 0, 100, '1000')] }));

      const eur = await db.contract.update({ where: { id: draft.id }, data: { currency: 'EUR' } });
      await assert.rejects(manager(() => agencies.activateContract(hotelId, draft.id, { expectedUpdatedAt: eur.updatedAt })), (error) => /para birimi \(EUR\)/.test(error.message));
      await db.contract.update({ where: { id: draft.id }, data: { currency: 'TRY' } });

      const passive = await manager(() => agencies.setAgencyStatus(hotelId, agency.id, { expectedUpdatedAt: new Date(agency.updatedAt), status: 'PASSIVE' }));
      const fresh = await db.contract.findFirst({ where: { id: draft.id } });
      await assert.rejects(manager(() => agencies.activateContract(hotelId, draft.id, { expectedUpdatedAt: fresh.updatedAt })), (error) => /Pasif acente/.test(error.message));
      await manager(() => agencies.setAgencyStatus(hotelId, agency.id, { expectedUpdatedAt: new Date(passive.updatedAt), status: 'ACTIVE' }));

      await db.contract.update({ where: { id: draft.id }, data: { startDate: date(-30), endDate: date(-1) } });
      const past = await db.contract.findFirst({ where: { id: draft.id } });
      await assert.rejects(manager(() => agencies.activateContract(hotelId, draft.id, { expectedUpdatedAt: past.updatedAt })), (error) => /geçmiş/.test(error.message));
      await db.contract.update({ where: { id: draft.id }, data: { startDate: date(0), endDate: date(100) } });

      const ready = await db.contract.findFirst({ where: { id: draft.id } });
      const live = await manager(() => agencies.activateContract(hotelId, draft.id, { expectedUpdatedAt: ready.updatedAt }));
      await rejectsWith(manager(() => agencies.activateContract(hotelId, draft.id, { expectedUpdatedAt: new Date(live.updatedAt) })), 'INVALID_STATUS');
      await rejectsWith(manager(() => agencies.deleteContract(hotelId, draft.id, { expectedUpdatedAt: new Date(live.updatedAt) })), 'INVALID_STATUS');
      await rejectsWith(manager(() => agencies.endContract(hotelId, rated.id, { expectedUpdatedAt: new Date() })), 'STALE_WRITE');

      const another = await manager(() => agencies.createContract(hotelId, agency.id, { name: 'Silinecek', startDate: date(300), endDate: date(310), notes: null }));
      const removed = await manager(() => agencies.deleteContract(hotelId, another.id, { expectedUpdatedAt: new Date(another.updatedAt) }));
      assert.deepEqual(removed, { id: another.id, deleted: true });
      await rejectsWith(agencies.getContract(hotelId, another.id), 'NOT_FOUND');
    });
  });

  /* ══════════════════ Stop-sale ══════════════════ */

  describe('stop-sale', () => {
    it('ekler / kaldırır; kontrat dışı, çakışan ve tür başına tekrar; mevcut rezervasyon sayısı bilgi olarak döner', async () => {
      const agency = await makeAgency();
      const live = await liveContract(agency, { start: 0, end: 100, rates: [rate('std', 'BB', 0, 100, '1800'), rate('dlx', 'BB', 0, 100, '3000')] });
      await book(agency, { checkIn: date(20), checkOut: date(23) });

      // Saatli giriş / çıkış: son stop-sale gününde giren sayılır, başlangıç gününde çıkan sayılmaz.
      const guest = await db.guest.create({ data: { hotelId, firstName: 'Saatli', lastName: 'Misafir' } });
      const timed = (code, from, to) =>
        db.reservation.create({
          data: {
            hotelId, guestId: guest.id, roomTypeId: types.std.id, status: 'CONFIRMED', source: 'AGENCY', agencyId: agency.id, agencyCommissionPct: '10', totalPrice: '1',
            checkIn: new Date(`${D(from)}T11:00:00.000Z`), checkOut: new Date(`${D(to)}T09:00:00.000Z`), confirmationCode: code,
          },
        });
      await timed('T-LASTDAY', 25, 27);
      await timed('T-LEAVES', 19, 21);

      const added = await manager(() => agencies.addStopSale(hotelId, live.id, { roomTypeId: null, startDate: date(21), endDate: date(25), reason: 'Bakım' }));
      assert.equal(added.stopSales.length, 1);
      assert.equal(added.existingReservations, 2, 'D20–D23 ve son gün giren D25–D27 sayılır; başlangıç günü çıkan D19–D21 sayılmaz');
      assert.equal(await db.reservation.count({ where: { hotelId, status: 'CONFIRMED' } }), 3, 'açılmış rezervasyon iptal edilmez, yalnız sayılır');

      await assert.rejects(manager(() => agencies.addStopSale(hotelId, live.id, { roomTypeId: null, startDate: date(24), endDate: date(30) })), (error) => error.code === 'STOP_SALE_OVERLAP');
      // Belirli tip, "tüm tipler" kaydıyla aynı kapsam değildir.
      const typed = await manager(() => agencies.addStopSale(hotelId, live.id, { roomTypeId: types.dlx.id, startDate: date(24), endDate: date(30) }));
      assert.equal(typed.stopSales.length, 2);
      assert.equal(typed.existingReservations, 0, 'başka tipte rezervasyon yok');
      await assert.rejects(manager(() => agencies.addStopSale(hotelId, live.id, { roomTypeId: null, startDate: date(-5), endDate: date(2) })), (error) => /kontrat dönemi içinde/.test(error.message));
      await assert.rejects(manager(() => agencies.addStopSale(hotelId, live.id, { roomTypeId: randomUUID(), startDate: date(40), endDate: date(41) })), (error) => /Oda tipi/.test(error.message));

      const removed = await manager(() => agencies.removeStopSale(hotelId, live.id, added.stopSales[0].id));
      assert.equal(removed.stopSales.length, 1);
      await rejectsWith(manager(() => agencies.removeStopSale(hotelId, live.id, added.stopSales[0].id)), 'NOT_FOUND');
      assert.deepEqual((await eventNames()).filter((name) => name === 'agency.stop_sale.changed').length, 3);
    });

    it('bir kontratta stop-sale sayısı sınırlıdır', async () => {
      const agency = await makeAgency();
      const live = await liveContract(agency, { start: 0, end: 600 });
      const limit = (await import('@hotelos/hotel-contracts')).MAX_CONTRACT_STOP_SALES;
      await db.contractStopSale.createMany({
        data: Array.from({ length: limit }, (_, index) => ({ hotelId, contractId: live.id, roomTypeId: null, startDate: date(index), endDate: date(index), createdBy: 'test' })),
      });
      await assert.rejects(manager(() => agencies.addStopSale(hotelId, live.id, { roomTypeId: null, startDate: date(550), endDate: date(551) })), (error) => /en fazla/.test(error.message));
    });
  });

  /* ══════════════════ Rezervasyon fiyatı ══════════════════ */

  describe('acente rezervasyonu: kontrat fiyatı', () => {
    it('geceler kontrat fiyatından, kaynak "Acente", komisyon açılıştaki oran; sistem fiyatı değişmez', async () => {
      const agency = await makeAgency({ commissionPct: '12.5' });
      await liveContract(agency);
      const result = await book(agency);
      const reservation = result.reservation;
      assert.equal(result.outcome, 'CREATED');
      assert.deepEqual(nightsOf(reservation), [[D(10), '1800.00'], [D(11), '1800.00'], [D(12), '1800.00']]);
      assert.equal(reservation.totalPrice, '5400.00');
      assert.equal(reservation.priceMode, 'CALCULATED');
      assert.equal(reservation.source, 'AGENCY');
      assert.deepEqual(reservation.agency, { id: agency.id, code: agency.code, name: agency.name });
      assert.deepEqual(reservation.nightlyRates.map((night) => [night.baseRate, night.multiplier, night.seasonName]), Array(3).fill(['1800.00', null, 'Yaz']));
      const row = await db.reservation.findFirst({ where: { id: reservation.id } });
      assert.equal(String(row.agencyCommissionPct), '12.5');
      assert.equal(row.agencyId, agency.id);
      const event = await db.eventLog.findFirst({ where: { hotelId, name: 'reservation.created' } });
      assert.equal(event.payload.agencyId, agency.id);

      // Acentesiz rezervasyon eskisi gibi: oda tipinin taban fiyatı.
      const plain = await book(null, { source: 'PHONE', checkIn: date(10), checkOut: date(12) });
      assert.equal(plain.reservation.totalPrice, '2000.00');
      assert.equal(plain.reservation.agency, null);
    });

    it('pansiyon ve oda tipine göre fiyat; kontrat içindeki dönem geçişi geceye uygulanır', async () => {
      const agency = await makeAgency();
      await liveContract(agency);
      const ai = await book(agency, { boardType: 'AI', checkIn: date(20), checkOut: date(22) });
      assert.deepEqual(nightsOf(ai.reservation), [[D(20), '2600.00'], [D(21), '2600.00']]);
      const dlx = await book(agency, { roomTypeId: types.dlx.id, adults: 3, checkIn: date(20), checkOut: date(21) });
      assert.equal(dlx.reservation.totalPrice, '3000.00');
      const crossing = await book(agency, { checkIn: date(98), checkOut: date(102) });
      assert.deepEqual(nightsOf(crossing.reservation), [[D(98), '1800.00'], [D(99), '1800.00'], [D(100), '2100.00'], [D(101), '2100.00']]);
    });

    it('iki ayrı kontrata yayılan konaklama: her gece kendi kontratından, gece dökümünde kontrat adı', async () => {
      const agency = await makeAgency();
      await liveContract(agency, { name: 'Yaz', start: 0, end: 99, rates: [rate('std', 'BB', 0, 99, '1800')] });
      await liveContract(agency, { name: 'Kış', start: 100, end: 200, rates: [rate('std', 'BB', 100, 200, '1200')] });
      const result = await book(agency, { checkIn: date(98), checkOut: date(102) });
      assert.deepEqual(result.reservation.nightlyRates.map((night) => [night.date, night.amount, night.seasonName]), [
        [D(98), '1800.00', 'Yaz'],
        [D(99), '1800.00', 'Yaz'],
        [D(100), '1200.00', 'Kış'],
        [D(101), '1200.00', 'Kış'],
      ]);
    });

    it('reddedilen satışlar: kontratsız gün, fiyatsız pansiyon, stop-sale, pasif acente, bilinmeyen acente (rezervasyon açılmaz)', async () => {
      const agency = await makeAgency();
      await liveContract(agency, {
        start: 0,
        end: 100,
        rates: [rate('std', 'BB', 0, 100, '1800')],
        stopSales: [{ roomTypeId: null, startDate: date(40), endDate: date(41), reason: 'Dolu' }, { roomTypeId: types.std.id, startDate: date(50), endDate: date(50), reason: null }],
      });
      const count = () => db.reservation.count({ where: { hotelId } });

      await rejectsWith(book(agency, { checkIn: date(150), checkOut: date(152) }), 'AGENCY_NO_CONTRACT', /satıştaki kontratı yok/);
      await rejectsWith(book(agency, { boardType: 'HB' }), 'AGENCY_NO_RATE', /STD oda \/ HB — Yarım pansiyon fiyatı yok/);
      await rejectsWith(book(agency, { roomTypeId: types.dlx.id, adults: 3 }), 'AGENCY_NO_RATE');
      await rejectsWith(book(agency, { checkIn: date(39), checkOut: date(43) }), 'AGENCY_STOP_SALE', new RegExp(`${D(40).split('-').reverse().join('\\.')} – ${D(41).split('-').reverse().join('\\.')} gecelerinde .* için stop-sale var`));
      await rejectsWith(book(agency, { checkIn: date(50), checkOut: date(51) }), 'AGENCY_STOP_SALE');
      // Konaklama kontratın son gününü aşıyor: aşan gece kontratsız.
      await rejectsWith(book(agency, { checkIn: date(99), checkOut: date(103) }), 'AGENCY_NO_CONTRACT');
      assert.equal(await count(), 0, 'reddedilen satış hiçbir şey yazmaz');

      const passive = await manager(() => agencies.setAgencyStatus(hotelId, agency.id, { expectedUpdatedAt: new Date(agency.updatedAt), status: 'PASSIVE' }));
      await rejectsWith(book(agency), 'AGENCY_PASSIVE');
      assert.equal(passive.status, 'PASSIVE');
      await rejectsWith(book({ id: randomUUID() }), 'AGENCY_NOT_FOUND');
      await rejectsWith(book({ id: (await db.agency.create({ data: { hotelId: otherHotelId, code: 'OTH', name: 'Başka otel acentesi', createdBy: 't' } })).id }), 'AGENCY_NOT_FOUND');
      assert.equal(await count(), 0);
    });

    it('elle fiyat: kontrat / pansiyon fiyatı yokluğunu aşar, stop-sale\'i aşmaz; yetki gerekir', async () => {
      const agency = await makeAgency();
      await liveContract(agency, { start: 0, end: 100, rates: [rate('std', 'BB', 0, 100, '1800')], stopSales: [{ roomTypeId: null, startDate: date(40), endDate: date(41), reason: null }] });
      const manual = { manualTotal: '4000', priceNote: 'Özel anlaşma' };

      const ok = await book(agency, { boardType: 'HB', ...manual }, { canOverridePrice: true });
      assert.equal(ok.reservation.totalPrice, '4000.00');
      assert.equal(ok.reservation.priceMode, 'MANUAL');
      assert.equal(ok.reservation.source, 'AGENCY');
      const outside = await book(agency, { checkIn: date(150), checkOut: date(151), ...manual }, { canOverridePrice: true });
      assert.equal(outside.reservation.totalPrice, '4000.00', 'kontrat dışı gün elle fiyatla açılır');

      await rejectsWith(book(agency, { checkIn: date(40), checkOut: date(42), ...manual }, { canOverridePrice: true }), 'AGENCY_STOP_SALE');
      await assert.rejects(book(agency, { boardType: 'HB', ...manual }), (error) => error.statusCode === 403, 'yetkisiz elle fiyat');
    });

    it('grup: her oda satırı kendi tip ve pansiyonunun kontrat fiyatını alır; biri satılamıyorsa hiçbiri açılmaz', async () => {
      const agency = await makeAgency();
      await liveContract(agency);
      const group = (lines, overrides = {}) =>
        desk(() =>
          reservations.createGroupReservation(
            hotelId,
            {
              ...reservationInput({ agencyId: agency.id, ...overrides }),
              groupName: 'Almanya grubu',
              lines: lines.map((line) => ({ adults: 2, children: 0, quantity: 1, ...line })),
            },
            {},
          ),
        );

      const result = await group([
        { roomTypeId: types.std.id, boardType: 'BB', quantity: 2 },
        { roomTypeId: types.std.id, boardType: 'AI', quantity: 1 },
        { roomTypeId: types.dlx.id, boardType: 'BB', quantity: 1 },
      ]);
      assert.equal(result.outcome, 'CREATED');
      const rows = await db.reservation.findMany({ where: { hotelId, groupId: result.groupId }, orderBy: [{ roomTypeId: 'asc' }, { boardType: 'asc' }] });
      assert.equal(rows.length, 4);
      assert.ok(rows.every((row) => row.agencyId === agency.id && row.source === 'AGENCY'));
      assert.deepEqual(rows.map((row) => `${row.boardType}:${String(row.totalPrice)}`).sort(), ['AI:7800', 'BB:5400', 'BB:5400', 'BB:9000']);

      const before = await db.reservation.count({ where: { hotelId } });
      await rejectsWith(group([{ roomTypeId: types.std.id, boardType: 'BB', quantity: 1 }, { roomTypeId: types.std.id, boardType: 'HB', quantity: 1 }], { requestId: randomUUID() }), 'AGENCY_NO_RATE');
      assert.equal(await db.reservation.count({ where: { hotelId } }), before, 'grup ya hep ya hiç');
      assert.equal(await db.reservationGroup.count({ where: { hotelId } }), 1);
    });

    it('komisyon açılıştaki oranla kalır: kart sonradan değişse de rezervasyon etkilenmez', async () => {
      const agency = await makeAgency({ commissionPct: '10' });
      await liveContract(agency);
      const first = await book(agency, { checkIn: date(10), checkOut: date(11) });
      await manager(() =>
        agencies.updateAgency(hotelId, agency.id, { ...agencyInput({ code: agency.code, name: agency.name, commissionPct: '20' }), expectedUpdatedAt: new Date(agency.updatedAt) }),
      );
      const second = await book(agency, { checkIn: date(20), checkOut: date(21) });
      const rows = await db.reservation.findMany({ where: { id: { in: [first.reservation.id, second.reservation.id] } }, orderBy: { checkIn: 'asc' } });
      assert.deepEqual(rows.map((row) => String(row.agencyCommissionPct)), ['10', '20']);
    });

    it('kontrat fiyatı sonradan değişince açılmış rezervasyonun gece fiyatı açıldığı günkü kalır', async () => {
      const agency = await makeAgency();
      const live = await liveContract(agency, { rates: [rate('std', 'BB', 0, 200, '1800')] });
      const before = await book(agency);
      await manager(() => agencies.saveContractRates(hotelId, live.id, { expectedUpdatedAt: new Date(live.updatedAt), rates: [rate('std', 'BB', 0, 200, '2500')] }));
      const stored = await reservations.getReservation(hotelId, before.reservation.id);
      assert.equal(stored.totalPrice, '5400.00');
      const after = await book(agency, { checkIn: date(30), checkOut: date(31) });
      assert.equal(after.reservation.totalPrice, '2500.00', 'yeni rezervasyon yeni fiyatı alır');
    });
  });

  /* ══════════════════ Düzenleme ══════════════════ */

  describe('acente rezervasyonu: düzenleme', () => {
    const update = (id, version, changes) => desk(() => reservations.updateReservation(hotelId, id, { expectedUpdatedAt: new Date(version), ...changes }, { canOverridePrice: true }));

    it('uzatma yalnız yeni geceyi kontrat fiyatından yazar; eski geceler fiyatını korur', async () => {
      const agency = await makeAgency();
      const live = await liveContract(agency, { rates: [rate('std', 'BB', 0, 200, '1800')] });
      const booked = (await book(agency)).reservation;
      // Fiyat düşer, uzatma yeni fiyatla; eski üç gece 1800 kalır.
      await manager(() => agencies.saveContractRates(hotelId, live.id, { expectedUpdatedAt: new Date(live.updatedAt), rates: [rate('std', 'BB', 0, 200, '1500')] }));
      const extended = await update(booked.id, booked.updatedAt, { checkOut: date(14) });
      assert.deepEqual(nightsOf(extended), [[D(10), '1800.00'], [D(11), '1800.00'], [D(12), '1800.00'], [D(13), '1500.00']]);
      assert.equal(extended.totalPrice, '6900.00');
    });

    it('uzatma stop-sale gecesine denk gelirse reddedilir; eski geceler stop-sale\'den etkilenmez', async () => {
      const agency = await makeAgency();
      const live = await liveContract(agency);
      const booked = (await book(agency)).reservation;
      await manager(() => agencies.addStopSale(hotelId, live.id, { roomTypeId: null, startDate: date(11), endDate: date(14) }));
      // Mevcut geceler (11, 12) stop-sale içinde ama rezervasyon zaten açık: yalnız not değişikliği sorunsuz.
      const noted = await update(booked.id, booked.updatedAt, { notes: 'Geç gelecek' });
      assert.equal(noted.notes, 'Geç gelecek');
      await rejectsWith(update(noted.id, noted.updatedAt, { checkOut: date(14) }), 'AGENCY_STOP_SALE', new RegExp(D(13).split('-').reverse().join('\\.')));
      // Kısaltma yeni satış değildir.
      const shortened = await update(noted.id, noted.updatedAt, { checkOut: date(12) });
      assert.equal(shortened.nights, 2);
    });

    it('pansiyon değişince bütün geceler yeni pansiyonun kontrat fiyatıyla; fiyatsız pansiyon reddedilir', async () => {
      const agency = await makeAgency();
      await liveContract(agency);
      const booked = (await book(agency)).reservation;
      const ai = await update(booked.id, booked.updatedAt, { boardType: 'AI' });
      assert.deepEqual(nightsOf(ai), [[D(10), '2600.00'], [D(11), '2600.00'], [D(12), '2600.00']]);
      await rejectsWith(update(ai.id, ai.updatedAt, { boardType: 'FB' }), 'AGENCY_NO_RATE', /FB — Tam pansiyon fiyatı yok/);
      // Acentesiz rezervasyonda pansiyon değişimi fiyatı etkilemez (eski davranış).
      const plain = (await book(null, { source: 'PHONE', checkIn: date(30), checkOut: date(32) })).reservation;
      const plainAi = await update(plain.id, plain.updatedAt, { boardType: 'AI' });
      assert.equal(plainAi.totalPrice, '2000.00');
    });

    it('acente atama: geceler kontrat fiyatıyla yeniden hesaplanır, kaynak Acente olur, komisyon kopyalanır; kaldırınca sistem fiyatı ve kaynak geri döner', async () => {
      const agency = await makeAgency({ commissionPct: '8' });
      await liveContract(agency);
      const plain = (await book(null, { source: 'PHONE' })).reservation;
      assert.equal(plain.totalPrice, '3000.00');

      const attached = await update(plain.id, plain.updatedAt, { agencyId: agency.id });
      assert.equal(attached.totalPrice, '5400.00');
      assert.equal(attached.source, 'AGENCY');
      assert.equal(attached.agency.id, agency.id);
      assert.equal(String((await db.reservation.findFirst({ where: { id: plain.id } })).agencyCommissionPct), '8');

      const detached = await update(attached.id, attached.updatedAt, { agencyId: null });
      assert.equal(detached.totalPrice, '3000.00');
      assert.equal(detached.agency, null);
      assert.equal(detached.source, 'UI');
      assert.equal((await db.reservation.findFirst({ where: { id: plain.id } })).agencyCommissionPct, null);
      const audits = await db.auditLog.findMany({ where: { hotelId, entity: 'Reservation', entityId: plain.id, action: 'UPDATE' }, orderBy: { createdAt: 'asc' } });
      // Oda aktörü rezervasyon açılınca oda da atayabilir (ayrı denetim satırı): yalnız acente değişimleri sayılır.
      assert.equal(audits.filter((row) => row.changedFields.includes('agencyId')).length, 2);
    });

    it('acente değiştirme yeni acentenin kontratına bakar: stop-sale ve fiyatsız gece reddedilir; pasif acente atanamaz', async () => {
      const first = await makeAgency();
      const second = await makeAgency();
      await liveContract(first);
      await liveContract(second, { rates: [rate('std', 'BB', 0, 200, '1600')], stopSales: [{ roomTypeId: null, startDate: date(11), endDate: date(11), reason: null }] });
      const booked = (await book(first)).reservation;
      await rejectsWith(update(booked.id, booked.updatedAt, { agencyId: second.id }), 'AGENCY_STOP_SALE');
      const third = await makeAgency();
      await rejectsWith(update(booked.id, booked.updatedAt, { agencyId: third.id }), 'AGENCY_NO_CONTRACT');
      const passive = await makeAgency();
      await liveContract(passive);
      await manager(() => agencies.setAgencyStatus(hotelId, passive.id, { expectedUpdatedAt: new Date(passive.updatedAt), status: 'PASSIVE' }));
      await rejectsWith(update(booked.id, booked.updatedAt, { agencyId: passive.id }), 'AGENCY_PASSIVE');
      assert.equal((await reservations.getReservation(hotelId, booked.id)).totalPrice, '5400.00', 'reddedilen değişiklik fiyatı bozmaz');
    });

    it('elle fiyatlı rezervasyona acente atanınca fiyat kalır (stop-sale yine denetlenir); tarih değişimi karar ister', async () => {
      const agency = await makeAgency();
      const live = await liveContract(agency);
      const plain = (await book(null, { source: 'PHONE', manualTotal: '4444', priceNote: 'Anlaşmalı' }, { canOverridePrice: true })).reservation;
      const attached = await update(plain.id, plain.updatedAt, { agencyId: agency.id });
      assert.equal(attached.totalPrice, '4444.00');
      assert.equal(attached.priceMode, 'MANUAL');
      await rejectsWith(update(attached.id, attached.updatedAt, { checkOut: date(14) }), 'PRICE_DECISION_REQUIRED');
      await manager(() => agencies.addStopSale(hotelId, live.id, { roomTypeId: null, startDate: date(10), endDate: date(10) }));
      const other = (await book(null, { source: 'PHONE', manualTotal: '1000', priceNote: 'x', checkIn: date(10), checkOut: date(11) }, { canOverridePrice: true })).reservation;
      await rejectsWith(update(other.id, other.updatedAt, { agencyId: agency.id }), 'AGENCY_STOP_SALE');
    });

    it('içerideki misafirde acente değişmez; uzatma yeni geceyi kontrattan yazar', async () => {
      const agency = await makeAgency();
      await liveContract(agency, { start: -5, end: 200, rates: [rate('std', 'BB', -5, 200, '1800')] });
      const stay = await db.reservation.create({
        data: {
          hotelId,
          guestId: (await db.guest.create({ data: { hotelId, firstName: 'İç', lastName: 'Erdeki' } })).id,
          roomTypeId: types.std.id,
          roomId: (await db.room.findFirst({ where: { hotelId, number: '101' } })).id,
          checkIn: date(-1),
          checkOut: date(2),
          status: 'CHECKED_IN',
          checkedInAt: new Date(),
          checkedInBy: 'test',
          source: 'AGENCY',
          agencyId: agency.id,
          agencyCommissionPct: '10',
          totalPrice: '5400',
          confirmationCode: `T-${randomUUID().slice(0, 8)}`,
        },
      });
      await db.reservationNight.createMany({ data: [-1, 0, 1].map((offset) => ({ hotelId, reservationId: stay.id, date: date(offset), amount: '1800' })) });

      const other = await makeAgency();
      await liveContract(other);
      await assert.rejects(update(stay.id, stay.updatedAt, { agencyId: other.id }), (error) => /içeride; acente değiştirilemez/.test(error.message));
      await assert.rejects(update(stay.id, stay.updatedAt, { agencyId: null }), (error) => /içeride/.test(error.message));
      const extended = await update(stay.id, stay.updatedAt, { checkOut: date(3) });
      assert.equal(extended.nights, 4);
      assert.equal(extended.totalPrice, '7200.00');
    });
  });

  /* ══════════════════ İptal geri alma ══════════════════ */

  describe('iptal geri alma', () => {
    it('stop-sale eklendiyse ya da acente pasifse geri alınmaz; fiyat açıldığı günkü kalır', async () => {
      const agency = await makeAgency();
      const live = await liveContract(agency);
      const booked = (await book(agency)).reservation;
      const cancelled = await desk(() => reservations.cancelReservation(hotelId, booked.id, { expectedUpdatedAt: new Date(booked.updatedAt), reason: 'Vazgeçti', waiveFee: true }));
      assert.equal(cancelled.status, 'CANCELLED');

      const stop = await manager(() => agencies.addStopSale(hotelId, live.id, { roomTypeId: null, startDate: date(11), endDate: date(11) }));
      await rejectsWith(desk(() => reservations.reinstateReservation(hotelId, booked.id, { expectedUpdatedAt: new Date(cancelled.updatedAt) })), 'AGENCY_STOP_SALE');
      await manager(() => agencies.removeStopSale(hotelId, live.id, stop.stopSales[0].id));

      const current = await agencies.getAgency(hotelId, agency.id);
      const passive = await manager(() => agencies.setAgencyStatus(hotelId, agency.id, { expectedUpdatedAt: new Date(current.updatedAt), status: 'PASSIVE' }));
      await rejectsWith(desk(() => reservations.reinstateReservation(hotelId, booked.id, { expectedUpdatedAt: new Date(cancelled.updatedAt) })), 'AGENCY_PASSIVE');
      await manager(() => agencies.setAgencyStatus(hotelId, agency.id, { expectedUpdatedAt: new Date(passive.updatedAt), status: 'ACTIVE' }));

      const restored = await desk(() => reservations.reinstateReservation(hotelId, booked.id, { expectedUpdatedAt: new Date(cancelled.updatedAt) }));
      assert.equal(restored.status, 'CONFIRMED');
      assert.equal(restored.totalPrice, '5400.00');
    });
  });

  /* ══════════════════ Önizleme ══════════════════ */

  describe('fiyat önizlemesi', () => {
    const quote = (overrides = {}) =>
      desk(() =>
        reservations.quoteReservation(hotelId, {
          checkIn: date(10),
          checkOut: date(13),
          lines: [{ roomTypeId: types.std.id, quantity: 2, adults: 2, children: 0 }],
          excludeReservationId: null,
          ...overrides,
        }),
      );

    it('acente kontrat fiyatıyla gelir; fiyatı olmayan tip işaretlenir, toplam yalnız satılabilir satırlardan', async () => {
      const agency = await makeAgency();
      await liveContract(agency, { rates: [rate('std', 'BB', 0, 200, '1800'), rate('std', 'AI', 0, 200, '2600')] });
      const result = await quote({
        agencyId: agency.id,
        boardType: 'BB',
        lines: [
          { roomTypeId: types.std.id, quantity: 2, adults: 2, children: 0 },
          { roomTypeId: types.std.id, quantity: 1, adults: 2, children: 0, boardType: 'AI' },
          { roomTypeId: types.dlx.id, quantity: 1, adults: 2, children: 0 },
        ],
      });
      const std = result.roomTypes.find((type) => type.id === types.std.id);
      const dlx = result.roomTypes.find((type) => type.id === types.dlx.id);
      assert.equal(std.total, '5400.00');
      assert.deepEqual(std.agency, { sellable: true, issue: null });
      assert.equal(dlx.total, null);
      assert.equal(dlx.agency.sellable, false);
      assert.equal(dlx.agency.issue.code, 'AGENCY_NO_RATE');
      assert.deepEqual(result.lines.map((line) => [line.unitTotal, line.total]), [['5400.00', '10800.00'], ['7800.00', '7800.00'], [null, '0.00']]);
      assert.equal(result.total, '18600.00');
      assert.equal(result.nights, 3);
      assert.deepEqual(result.agency, { id: agency.id, code: agency.code, name: agency.name, issue: null });
    });

    it('stop-sale ve pasif acente önizlemede sebebiyle görünür; acentesiz önizleme eski şekil', async () => {
      const agency = await makeAgency();
      await liveContract(agency, { stopSales: [{ roomTypeId: types.std.id, startDate: date(11), endDate: date(11), reason: null }] });
      const stopped = await quote({ agencyId: agency.id });
      assert.equal(stopped.roomTypes.find((type) => type.id === types.std.id).agency.issue.code, 'AGENCY_STOP_SALE');
      assert.equal(stopped.roomTypes.find((type) => type.id === types.dlx.id).agency.sellable, true);

      const current = await agencies.getAgency(hotelId, agency.id);
      await manager(() => agencies.setAgencyStatus(hotelId, agency.id, { expectedUpdatedAt: new Date(current.updatedAt), status: 'PASSIVE' }));
      assert.equal((await quote({ agencyId: agency.id })).agency.issue.code, 'AGENCY_PASSIVE');

      const plain = await quote({});
      assert.equal(plain.agency, null);
      assert.equal(plain.roomTypes[0].agency, undefined);
      assert.equal(plain.roomTypes.find((type) => type.id === types.std.id).total, '3000.00');
      await rejectsWith(quote({ agencyId: randomUUID() }), 'AGENCY_NOT_FOUND');
    });
  });

  /* ══════════════════ Kilit düzeni ══════════════════ */

  describe('eşzamanlılık', () => {
    it('stop-sale yazan işlem acenteyi tutarken gelen rezervasyon bekler ve yeni stop-sale\'i görüp reddedilir', async () => {
      const agency = await makeAgency();
      const live = await liveContract(agency);
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      let locked;
      const lockTaken = new Promise((resolve) => {
        locked = resolve;
      });
      // Kontrat yazan işlem: acenteyi özel kilitler, stop-sale yazar, bir süre commit etmez.
      const writer = db.$transaction(async (tx) => {
        await locks.lockAgencies(tx, hotelId, [agency.id]);
        await tx.contractStopSale.create({ data: { hotelId, contractId: live.id, roomTypeId: null, startDate: date(10), endDate: date(12), createdBy: 'test' } });
        locked();
        await held;
      });
      await lockTaken;

      const startedAt = Date.now();
      const booking = book(agency).then(
        () => ({ ok: true }),
        (error) => ({ ok: false, code: error.code }),
      );
      await delay(400);
      release();
      await writer;
      const outcome = await booking;
      assert.deepEqual(outcome, { ok: false, code: 'AGENCY_STOP_SALE' });
      assert.ok(Date.now() - startedAt >= 350, 'rezervasyon kilidi bekledi');
      assert.equal(await db.reservation.count({ where: { hotelId } }), 0);
    });

    it('aynı acenteye eşzamanlı rezervasyonlar birbirini beklemez ve hepsi kontrat fiyatını alır', async () => {
      const agency = await makeAgency();
      await liveContract(agency);
      const results = await Promise.all(
        [20, 22, 24, 26].map((start, index) => book(agency, { checkIn: date(start), checkOut: date(start + 2), guest: { firstName: `Misafir${index}`, lastName: 'Test', phone: `+9055500000${index}`, email: null } })),
      );
      assert.deepEqual(results.map((result) => result.reservation.totalPrice), Array(4).fill('3600.00'));
    });
  });

  /* ══════════════════ Cari özeti ══════════════════ */

  describe('cari özeti ve acente rezervasyonları', () => {
    let agency;

    /** Doğrudan kayıt: geçmiş konaklamalar servisten açılamaz. */
    async function seedReservation({ status, start, nights, total, pct = '10', code, fee = null, agencyId = agency.id, payment = null }) {
      const guest = await db.guest.create({ data: { hotelId, firstName: `Misafir ${code}`, lastName: 'Cari' } });
      const stayed = status === 'CHECKED_OUT';
      const row = await db.reservation.create({
        data: {
          hotelId,
          guestId: guest.id,
          roomTypeId: types.std.id,
          checkIn: date(start),
          checkOut: date(start + nights),
          status,
          source: agencyId ? 'AGENCY' : 'PHONE',
          agencyId,
          agencyCommissionPct: agencyId ? pct : null,
          totalPrice: total,
          cancellationFee: fee,
          confirmationCode: code,
          ...(stayed ? { checkedInAt: date(start), checkedInBy: 't', checkedOutAt: date(start + nights), checkedOutBy: 't' } : {}),
          ...(status === 'CANCELLED' ? { cancelledAt: new Date(), cancelledBy: 't', cancelReason: 'x' } : {}),
        },
      });
      if (payment) {
        const folio = await db.folio.create({ data: { hotelId, reservationId: row.id, guestId: guest.id, currency: 'TRY' } });
        await db.payment.create({
          data: { hotelId, folioId: folio.id, reservationId: row.id, method: payment.method ?? 'AGENCY', amount: payment.amount, currency: 'TRY', folioAmount: payment.amount, businessDate: date(start + nights), receivedBy: 't', postedAt: new Date(), status: 'POSTED' },
        });
      }
      return row;
    }

    beforeEach(async () => {
      agency = await makeAgency({ paymentTermDays: 30, commissionPct: '10' });
      await seedReservation({ code: 'C-R1', status: 'CHECKED_OUT', start: -20, nights: 3, total: '6000', payment: { amount: '6000' } });
      await seedReservation({ code: 'C-R6', status: 'CHECKED_OUT', start: -60, nights: 3, total: '3000', payment: { amount: '3000' } });
      await seedReservation({ code: 'C-R2', status: 'CONFIRMED', start: 10, nights: 2, total: '4000', pct: '12.5' });
      await seedReservation({ code: 'C-R3', status: 'CANCELLED', start: 5, nights: 2, total: '3000', fee: '1500' });
      await seedReservation({ code: 'C-R5', status: 'CHECKED_OUT', start: -400, nights: 2, total: '9999', payment: { amount: '9999' } });
      // Nakit ödeme cariye aktarılan sayılmaz; acentesiz ve başka acenteli rezervasyon özete girmez.
      await seedReservation({ code: 'C-R7', status: 'CHECKED_OUT', start: -30, nights: 1, total: '1000', payment: { amount: '1000', method: 'CASH' } });
      await seedReservation({ code: 'C-X1', status: 'CONFIRMED', start: 12, nights: 1, total: '777', agencyId: null });
      const other = await makeAgency();
      await seedReservation({ code: 'C-X2', status: 'CONFIRMED', start: 12, nights: 1, total: '888', agencyId: other.id });
    });

    it('dönemdeki satış, komisyon (açılıştaki oranla), net ve cariye aktarılan / vadesi gelen', async () => {
      const summary = await agencies.getAgencySummary(hotelId, agency.id, { from: date(-100), to: date(100) });
      assert.equal(summary.currency, 'TRY');
      assert.deepEqual(summary.period, { from: D(-100), to: D(100) });
      // C-R1 6000 (%10) + C-R6 3000 (%10) + C-R2 4000 (%12,5) + C-R7 1000 (%10); iptal ve dönem dışı hariç.
      assert.deepEqual(summary.sold, { reservations: 4, nights: 9, total: '14000.00', commission: '1500.00', net: '12500.00' });
      const cancelled = summary.byStatus.find((row) => row.status === 'CANCELLED');
      assert.deepEqual([cancelled.reservations, cancelled.cancellationFees], [1, '1500.00']);
      assert.equal(summary.fees.cancellation, '1500.00');
      // 6000 (çıkış −17, vade 30 gün → +13: vadesi gelmedi) + 3000 (çıkış −57 → vade −27: geldi).
      assert.deepEqual(summary.account, { transferred: '9000.00', dueNow: '3000.00', notDue: '6000.00' });
      assert.deepEqual(summary.agency, { id: agency.id, code: agency.code, name: agency.name, status: 'ACTIVE', commissionPct: '10.00', paymentTermDays: 30 });
    });

    it('dönem dar tutulunca yalnız o girişler; dönem verilmezse bu yıl', async () => {
      const narrow = await agencies.getAgencySummary(hotelId, agency.id, { from: date(0), to: date(30) });
      assert.deepEqual([narrow.sold.reservations, narrow.sold.total], [1, '4000.00']);
      assert.deepEqual(narrow.account, { transferred: '0.00', dueNow: '0.00', notDue: '0.00' });
      const defaults = await agencies.getAgencySummary(hotelId, agency.id, {});
      assert.equal(defaults.period.from, `${today().getUTCFullYear()}-01-01`);
      assert.equal(defaults.period.to, `${today().getUTCFullYear()}-12-31`);
    });

    it('rezervasyon listesi: sayfalı, en yeni giriş önce; komisyon, vade; süzgeç ve arama; başka acente görünmez', async () => {
      const page = await agencies.listAgencyReservations(hotelId, agency.id, { page: 1, pageSize: 3, from: date(-100), to: date(100) });
      assert.deepEqual(page.items.map((item) => item.confirmationCode), ['C-R2', 'C-R3', 'C-R1']);
      assert.deepEqual([page.meta.total, page.meta.totalPages, page.meta.totalCapped], [5, 2, false], 'C-R5 dönem dışı');
      const first = page.items[0];
      assert.deepEqual([first.totalPrice, first.commission, first.nights, first.dueDate, first.guestName], ['4000.00', '500.00', 2, D(42), 'Misafir C-R2 Cari']);
      const second = await agencies.listAgencyReservations(hotelId, agency.id, { page: 2, pageSize: 3, from: date(-100), to: date(100) });
      assert.deepEqual(second.items.map((item) => item.confirmationCode), ['C-R7', 'C-R6']);
      assert.deepEqual((await agencies.listAgencyReservations(hotelId, agency.id, { page: 1, pageSize: 20, status: 'CANCELLED' })).items.map((item) => item.confirmationCode), ['C-R3']);
      assert.deepEqual((await agencies.listAgencyReservations(hotelId, agency.id, { page: 1, pageSize: 20, search: 'C-R6' })).items.map((item) => item.confirmationCode), ['C-R6']);
      assert.equal((await agencies.listAgencyReservations(hotelId, agency.id, { page: 1, pageSize: 20, search: 'C-X' })).items.length, 0, 'acentesiz / başka acentenin kaydı görünmez');
    });
  });

  /* ══════════════════ İzinler ══════════════════ */

  describe('izinler (HTTP)', () => {
    it('resepsiyon seçiciyi kullanır ama acente kartını, kontratı, özeti göremez; muhasebe görür ama düzenleyemez; müdür hepsini yapar', async () => {
      const created = await call('POST', '/agencies', MANAGER, agencyInput({ code: 'HTT', name: 'Http Acente' }));
      assert.equal(created.statusCode, 201, created.body);
      const agencyId = created.json().data.id;

      assert.equal((await call('GET', '/agencies/options?q=http', DESK)).statusCode, 200);
      const options = (await call('GET', '/agencies/options?q=http', DESK)).json().data.items;
      assert.deepEqual(Object.keys(options[0]).sort(), ['code', 'id', 'name', 'status']);
      for (const [method, url, payload] of [
        ['GET', '/agencies', undefined],
        ['GET', `/agencies/${agencyId}`, undefined],
        ['GET', `/agencies/${agencyId}/summary`, undefined],
        ['GET', `/agencies/${agencyId}/reservations`, undefined],
        ['POST', '/agencies', agencyInput()],
        ['POST', `/agencies/${agencyId}/contracts`, { name: 'Yaz', startDate: D(0), endDate: D(10) }],
      ]) {
        assert.equal((await call(method, url, DESK, payload)).statusCode, 403, `${method} ${url}`);
      }

      assert.equal((await call('GET', '/agencies', ACCOUNTING)).statusCode, 200);
      assert.equal((await call('GET', `/agencies/${agencyId}/summary?from=${D(-10)}&to=${D(10)}`, ACCOUNTING)).statusCode, 200);
      assert.equal((await call('GET', `/agencies/${agencyId}/reservations`, ACCOUNTING)).statusCode, 200, 'muhasebe rezervasyon listesi iznine ihtiyaç duymaz');
      assert.equal((await call('POST', '/agencies', ACCOUNTING, agencyInput())).statusCode, 403);
      assert.equal((await call('PATCH', `/agencies/${agencyId}`, ACCOUNTING, { ...agencyInput({ code: 'HTT', name: 'Http Acente' }), expectedUpdatedAt: new Date() })).statusCode, 403);

      const contract = await call('POST', `/agencies/${agencyId}/contracts`, MANAGER, { name: 'Yaz', startDate: D(0), endDate: D(10) });
      assert.equal(contract.statusCode, 201, contract.body);
      assert.equal((await call('GET', `/agencies/contracts/${contract.json().data.id}`, ACCOUNTING)).statusCode, 200);
      assert.equal((await call('PUT', `/agencies/contracts/${contract.json().data.id}/rates`, ACCOUNTING, { expectedUpdatedAt: new Date(), rates: [] })).statusCode, 403);
    });

    it('geçersiz girdi 400 alan hatalarıyla; kaynak "Acente" iken acentesiz rezervasyon reddedilir; bozuk kimlik 422', async () => {
      const bad = await call('POST', '/agencies', MANAGER, { code: 'x', name: '', commissionPct: '150' });
      assert.equal(bad.statusCode, 400);
      assert.ok(bad.json().fields.code && bad.json().fields.name && bad.json().fields.commissionPct, bad.body);
      assert.equal((await call('GET', '/agencies/degil-bir-kimlik', MANAGER)).statusCode, 400);
      const noAgency = await call('POST', '/reservations', DESK, {
        guest: { firstName: 'A', lastName: 'B', phone: '05321110002' },
        roomTypeId: types.std.id,
        adults: 2,
        boardType: 'BB',
        checkIn: D(10),
        checkOut: D(12),
        source: 'AGENCY',
        requestId: randomUUID(),
      });
      assert.equal(noAgency.statusCode, 400);
      assert.match(noAgency.json().fields.agencyId, /acenteyi seçin/);
    });

    it('uçtan uca: kontrat aç, fiyat gir, satışa aç, acente adına rezervasyon (HTTP) ve stop-sale reddi', async () => {
      const agencyId = (await call('POST', '/agencies', MANAGER, agencyInput({ code: 'E2E', name: 'Uçtan Uca' }))).json().data.id;
      let contract = (await call('POST', `/agencies/${agencyId}/contracts`, MANAGER, { name: 'Yaz', startDate: D(0), endDate: D(100) })).json().data;
      contract = (
        await call('PUT', `/agencies/contracts/${contract.id}/rates`, MANAGER, {
          expectedUpdatedAt: contract.updatedAt,
          rates: [{ roomTypeId: types.std.id, boardType: 'BB', startDate: D(0), endDate: D(100), price: '1250,50' }],
        })
      ).json().data;
      contract = (await call('POST', `/agencies/contracts/${contract.id}/activate`, MANAGER, { expectedUpdatedAt: contract.updatedAt })).json().data;
      assert.equal(contract.status, 'ACTIVE');

      const reserve = (extra = {}) =>
        call('POST', '/reservations', DESK, {
          guest: { firstName: 'Ali', lastName: 'Veli', phone: '05321110003' },
          roomTypeId: types.std.id,
          adults: 2,
          boardType: 'BB',
          checkIn: D(10),
          checkOut: D(12),
          source: 'AGENCY',
          agencyId,
          requestId: randomUUID(),
          ...extra,
        });
      const ok = await reserve();
      assert.equal(ok.statusCode, 201, ok.body);
      assert.equal(ok.json().data.reservation.totalPrice, '2501.00');

      const stop = await call('POST', `/agencies/contracts/${contract.id}/stop-sales`, MANAGER, { startDate: D(20), endDate: D(22), reason: 'Dolu' });
      assert.equal(stop.statusCode, 201, stop.body);
      const refused = await reserve({ checkIn: D(21), checkOut: D(23), guest: { firstName: 'Can', lastName: 'Er', phone: '05321110004' } });
      assert.equal(refused.statusCode, 422);
      assert.equal(refused.json().code, 'AGENCY_STOP_SALE');
      assert.match(refused.json().fields.agencyId, /stop-sale var/);
    });
  });

  /* ══════════════════ Ayar korumaları ══════════════════ */

  describe('ayar korumaları', () => {
    it('kontrat fiyatı taşıyan oda tipi silinemez; kontratı olan otelin para birimi değişmez', async () => {
      const agency = await makeAgency();
      await liveContract(agency);
      await assert.rejects(manager(() => settings.deleteRoomType(hotelId, types.dlx.id)), (error) => {
        assert.equal(error.code, 'IN_USE');
        assert.equal(error.details.usage.kontratFiyati, 1);
        return true;
      });
      const hotel = await settings.getHotelSettings(hotelId);
      await assert.rejects(
        manager(() =>
          settings.updateHotel(hotelId, {
            expectedUpdatedAt: new Date(hotel.updatedAt),
            name: hotel.name,
            address: null,
            phone: null,
            email: null,
            logoUrl: null,
            currency: 'EUR',
            timezone: hotel.timezone,
            checkInTime: hotel.checkInTime,
            checkOutTime: hotel.checkOutTime,
          }),
        ),
        (error) => error.code === 'CURRENCY_LOCKED' && error.details.usage.kontrat === 1,
      );
    });
  });
});
