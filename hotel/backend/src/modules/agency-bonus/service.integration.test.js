import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Acente bonusu (modül 35) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: üretim tanımı (gerçekleşen gece, dönem sınırında bölme, iptal / gelmeyen /
 * başka acente / başka otel / oda tipi süzgeci, folyodaki vergisiz oda geliri, dönem
 * sonra iptal edilen gecenin asıl gününden düşmesi, elle oda indirimi, işlenmemiş gece,
 * ikram gece), eldeki gecelerle tahmin, kural yaşam döngüsü (taslak → yürürlük → iptal,
 * çakışma: servis denetimi ve eşzamanlı yürürlüğe almada veritabanı kısıtı), hak ediş
 * (dönem bitmeden hesap yok, satır dökümü, yeniden hesap, eşzamanlı hesap tek kayıt),
 * onay (dört göz, onay / ret / süre dolumu, bayat hak ediş: kural ya da üretim değişti),
 * prim doğmayan dönem, ödeme (tarih kuralları, geri alma, yeniden açma), kilitli hak
 * edişte kural koruması, ilerleme özeti (sürüm damgasına dokunmaz, kademe uyarısı bir
 * kez), dönem sonu otomatik hesap, liste / rapor / döküm, izinler ve otel kapsamı.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'mudur@test.local';
const MANAGER2 = 'mudur2@test.local';
const ACCOUNTING = 'muhasebe@test.local';
const DESK = 'resepsiyon@test.local';
/** Gece fiyatı (KDV %10 dahil) → vergisiz 1000,00. */
const NIGHTLY = '1100.00';

describe('acente bonusu (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let rules;
  /** @type {any} */ let settlement;
  /** @type {any} */ let progress;
  /** @type {any} */ let jobs;
  /** @type {any} */ let approvals;
  /** @type {any} */ let folios;
  /** @type {any} */ let posting;
  /** @type {any} */ let write;
  /** @type {any} */ let cache;
  /** @type {any} */ let contracts;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let otherHotelId;
  /** @type {Record<string, any>} */ let types;
  /** @type {Record<string, any>} */ let agency;
  /** @type {Map<string, string>} */ let tokens;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    rules = await import('./service.js');
    settlement = await import('./settlement.js');
    progress = await import('./progress.js');
    jobs = await import('./jobs.js');
    approvals = await import('../approvals/service.js');
    folios = await import('../folios/service.js');
    posting = await import('../folios/posting.js');
    write = await import('../../lib/write.js');
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
  const manager2 = (fn) => as(MANAGER2, fn);
  const accounting = (fn) => as(ACCOUNTING, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const D = (offset) => core.toIsoDay(core.addDays(today(), offset));
  const date = (offset) => new Date(D(offset));
  const at = (offset, time = '15:00') => contracts.zonedWallTimeToUtc(`${D(offset)}T${time}`, ZONE);
  const eventsNamed = async (name) => (await db.eventLog.findMany({ where: { hotelId, name }, orderBy: { occurredAt: 'asc' }, select: { payload: true } })).map((row) => row.payload);

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
    const hotel = await db.hotel.create({ data: { name: 'Deniz Otel', code: `P${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } });
    hotelId = hotel.id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka Otel', code: `Q${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: MANAGER2, name: 'Genel Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: ACCOUNTING, name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
        { hotelId, email: DESK, name: 'Resepsiyon', role: 'FRONT_DESK', passwordHash },
      ],
    });
    // Oda: KDV %10 dahil (vergisiz = 1100 / 1,1 = 1000) + konaklama vergisi %2 hariç (vergisiz tutarı değiştirmez).
    await db.tax.createMany({
      data: [
        { hotelId, name: 'KDV', rate: '10', isIncluded: true, appliesTo: ['ROOM'] },
        { hotelId, name: 'Konaklama vergisi', rate: '2', isIncluded: false, appliesTo: ['ROOM'] },
      ],
    });
    const type = (code, hotel = hotelId) => db.roomType.create({ data: { hotelId: hotel, code, name: `${code} oda`, basePrice: '1000', capacityAdults: 2, capacityChildren: 1 } });
    types = { std: await type('STD'), dlx: await type('DLX'), foreign: await type('XXX', otherHotelId) };
    const makeAgency = (code, name, hotel = hotelId) =>
      db.agency.create({ data: { hotelId: hotel, code, name, commissionPct: '10', paymentTermDays: 30, createdBy: MANAGER } });
    agency = { a: await makeAgency('ATLAS', 'Atlas Turizm'), b: await makeAgency('BORA', 'Bora Seyahat'), foreign: await makeAgency('ATLAS', 'Atlas Turizm', otherHotelId) };
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });

  /* ── Üretim kurulumu ── */

  /**
   * Acente konaklaması (doğrudan veri; fiyat geceleri `nightly`). Konaklamış olanlar önce
   * içeride açılır, `postNights()` gece ücretlerini **folyo servisiyle** işler (gerçek vergi
   * hesabı), sonra istenen son duruma (çıkış) geçer.
   */
  const pending = [];
  async function seedStay({ ag = agency.a, type = types.std, checkIn, checkOut, status = 'CHECKED_OUT', nightly = NIGHTLY, hotel = hotelId, post = true } = {}) {
    const guest = await db.guest.create({ data: { hotelId: hotel, firstName: 'Misafir', lastName: randomUUID().slice(0, 6) } });
    const stayed = status === 'CHECKED_OUT' || status === 'CHECKED_IN';
    const initial = stayed && post ? 'CHECKED_IN' : status;
    const nights = checkOut - checkIn;
    const row = await db.reservation.create({
      data: {
        hotelId: hotel,
        guestId: guest.id,
        roomTypeId: type.id,
        checkIn: date(checkIn),
        checkOut: date(checkOut),
        status: initial,
        source: 'AGENCY',
        agencyId: ag.id,
        agencyCommissionPct: '10',
        totalPrice: core.toMoneyString(core.toDecimal(nightly).times(nights)),
        confirmationCode: `B${randomUUID().slice(0, 7).toUpperCase()}`,
        confirmedAt: new Date(),
        ...(initial === 'CHECKED_IN' || initial === 'CHECKED_OUT' ? { checkedInAt: at(checkIn), checkedInBy: DESK } : {}),
        ...(initial === 'CHECKED_OUT' ? { checkedOutAt: at(checkOut, '11:00'), checkedOutBy: DESK } : {}),
        ...(initial === 'CANCELLED' ? { cancelledAt: new Date(), cancelledBy: DESK, cancelReason: 'Test' } : {}),
        ...(initial === 'NO_SHOW' ? { noShowAt: new Date() } : {}),
      },
    });
    await db.reservationNight.createMany({
      data: core.eachNight(row.checkIn, row.checkOut).map((night) => ({ hotelId: hotel, reservationId: row.id, date: night, amount: nightly })),
    });
    if (stayed && post) pending.push({ id: row.id, status, checkOut });
    return row;
  }

  /** Bekleyen konaklamaların geçmiş gecelerini folyoya işler, sonra çıkışları yapar. */
  async function postNights() {
    if (pending.length === 0) return;
    await as('gece-isi', () => folios.runRoomCharges(hotelId));
    for (const stay of pending.splice(0)) {
      if (stay.status === 'CHECKED_OUT') {
        await db.reservation.update({ where: { id: stay.id }, data: { status: 'CHECKED_OUT', checkedOutAt: at(stay.checkOut, '11:00'), checkedOutBy: DESK } });
      }
    }
  }

  const ruleInput = (overrides = {}) => ({
    agencyId: agency.a.id,
    name: 'Yaz gece primi',
    startDate: date(-30),
    endDate: date(-11),
    metric: 'NIGHTS',
    mode: 'WHOLE',
    target: '10',
    tiers: [
      { threshold: '5', ratePct: '1' },
      { threshold: '10', ratePct: '2' },
      { threshold: '20', ratePct: '3' },
    ],
    roomTypeIds: [],
    maxBonus: null,
    notes: null,
    ...overrides,
  });
  const parse = (schema, input) => contracts[schema].parse(input);
  const createRule = (overrides = {}) => manager(() => rules.createRule(hotelId, parse('createAgencyBonusRuleSchema', ruleInput(overrides))));
  const version = (row) => new Date(row.updatedAt);
  async function activeRule(overrides = {}) {
    const draft = await createRule(overrides);
    return manager(() => rules.activateRule(hotelId, draft.id, { expectedUpdatedAt: version(draft) }));
  }

  /** Dönemi biten kural için klasik üretim: 11 gece, 11.000,00 vergisiz ciro (+ gürültü). */
  async function seedClassicProduction() {
    await seedStay({ checkIn: -35, checkOut: -28 }); // dönem sınırı: 30 ve 29. geceler (2)
    await seedStay({ checkIn: -20, checkOut: -15 }); // 5
    await seedStay({ checkIn: -12, checkOut: -8 }); // dönem sınırı: 12 ve 11. geceler (2)
    await seedStay({ type: types.dlx, checkIn: -26, checkOut: -24 }); // 2 (oda tipi süzgeci yoksa sayılır)
    await seedStay({ checkIn: -25, checkOut: -22, status: 'CANCELLED' });
    await seedStay({ checkIn: -18, checkOut: -16, status: 'NO_SHOW' });
    await seedStay({ ag: agency.b, checkIn: -20, checkOut: -18 });
    await postNights();
  }

  /* ══════════════════ Üretim tanımı ══════════════════ */

  describe('üretim tanımı', () => {
    it('gerçekleşen gece dönem sınırında bölünür; iptal, gelmeyen ve başka acente sayılmaz; ciro folyodaki vergisiz oda geliri', async () => {
      await seedClassicProduction();
      // Başka otelde aynı acente kimliğiyle yazılmış kayıt (yabancı anahtar otel bilmez): sayılmaz.
      await seedStay({ hotel: otherHotelId, type: types.foreign, checkIn: -20, checkOut: -15, post: false });
      const rule = await activeRule();
      const detail = await manager(() => rules.getRule(hotelId, rule.id));
      assert.equal(detail.phase, 'ENDED');
      assert.deepEqual([detail.live.realized.nights, detail.live.realized.revenue], [11, '11000.00']);
      assert.equal(detail.live.realized.scorePct, '110.00');
      assert.equal(detail.live.earned.tierIndex, 2);
      assert.equal(detail.live.earned.amount, '220.00', '11.000 × %2 (tüm üretime)');
      assert.deepEqual([detail.live.onBooks.nights, detail.live.onBooks.revenue], [0, '0.00'], 'biten dönemde eldeki yok');
      assert.deepEqual(
        detail.live.months.map((month) => month.nights).reduce((total, value) => total + value, 0),
        11,
        'aylık kırılım toplamı tutar',
      );
    });

    it('oda tipi süzgeci yalnızca seçilen tipleri sayar', async () => {
      await seedClassicProduction();
      const rule = await activeRule({ roomTypeIds: [types.dlx.id] });
      const detail = await manager(() => rules.getRule(hotelId, rule.id));
      assert.deepEqual([detail.live.realized.nights, detail.live.realized.revenue], [2, '2000.00']);
      assert.deepEqual(detail.roomTypes.map((type) => type.code), ['DLX']);
    });

    it('dönem bittikten sonra iptal edilen gece asıl gününden düşer; elle oda indirimi ciroyu azaltır', async () => {
      const stay = await seedStay({ checkIn: -20, checkOut: -15 });
      await postNights();
      const rule = await activeRule();
      const night = await db.folioItem.findFirst({ where: { reservationId: stay.id, source: 'ROOM_NIGHT', serviceDate: new Date(D(-19)) } });
      // Ters kayıt bugünün gününe yazılır (dönem dışı); üretim tanımı onu asıl geceye bağlar.
      await as(MANAGER, () =>
        write.writeWithEvents((tx, stage) => posting.reverseItems(tx, stage, { hotelId, itemIds: [night.id], reason: 'Test iptali', serviceDate: D(0) })),
      );
      const folio = await db.folio.findFirst({ where: { reservationId: stay.id } });
      await db.folioItem.create({
        data: {
          hotelId,
          folioId: folio.id,
          reservationId: stay.id,
          type: 'DISCOUNT',
          source: 'MANUAL',
          description: 'Oda indirimi',
          amount: '-110.00',
          taxCategory: 'ROOM',
          netAmount: '-100.00',
          taxAmount: '-10.00',
          total: '-110.00',
          serviceDate: new Date(D(-17)),
          postedBy: MANAGER,
        },
      });
      const detail = await manager(() => rules.getRule(hotelId, rule.id));
      assert.deepEqual([detail.live.realized.nights, detail.live.realized.revenue], [5, '3900.00'], '5 gece; 5000 − 1000 (iptal) − 100 (indirim)');
    });

    it('sürmekte olan dönem: bugünün gecesi gerçekleşmiş sayılmaz; eldeki geceler vergisiz tahmine girer', async () => {
      await seedStay({ checkIn: -3, checkOut: 2, status: 'CHECKED_IN' }); // -3, -2, -1 gerçekleşti; 0 ve 1 eldeki
      await seedStay({ checkIn: 3, checkOut: 6, status: 'CONFIRMED' }); // 3 eldeki
      await seedStay({ checkIn: 4, checkOut: 5, status: 'CANCELLED' });
      await postNights();
      const rule = await activeRule({ startDate: date(-5), endDate: date(10), target: '8', tiers: [{ threshold: '4', ratePct: '1' }, { threshold: '8', ratePct: '2' }] });
      const { live } = await manager(() => rules.getRule(hotelId, rule.id));
      assert.equal(live.phase, 'RUNNING');
      assert.deepEqual([live.realized.nights, live.realized.revenue], [3, '3000.00']);
      assert.deepEqual([live.onBooks.nights, live.onBooks.revenue], [5, '5000.00'], 'eldeki brüt 5500 → vergisiz 5000');
      assert.deepEqual([live.projected.nights, live.projected.revenue], [8, '8000.00']);
      assert.equal(live.earned.tierIndex, 0);
      assert.equal(live.forecast.tierIndex, 2);
      assert.equal(live.forecast.amount, '160.00');
      assert.deepEqual(live.nextTier, { tier: 1, threshold: '4', ratePct: '1', remaining: '1' });
      // 16 günlük dönemin 5 günü geçti: beklenti 8 × 5/16 = 2,5 → 3 gece (yuvarlanır); 3 ≥ 2,5 önünde.
      assert.equal(live.pace.elapsedDays, 5);
      assert.equal(live.pace.pace, 'AHEAD');
    });

    it('işlenmemiş gece hak edişte uyarı olur; ikram (sıfır) gece uyarı sayılmaz', async () => {
      await seedStay({ checkIn: -20, checkOut: -18 });
      await postNights();
      await seedStay({ checkIn: -14, checkOut: -13, post: false }); // çıkmış ama ücreti işlenmemiş
      await seedStay({ checkIn: -16, checkOut: -15, nightly: '0', post: false });
      const rule = await activeRule();
      const bonus = await manager(() => settlement.calculateBonus(hotelId, rule.id));
      assert.equal(bonus.nights, 4);
      assert.equal(bonus.revenue, '2000.00');
      assert.equal(bonus.missingPostings, 1);
      assert.equal(bonus.reservationCount, 3);
    });
  });

  /* ══════════════════ Kural yaşam döngüsü ══════════════════ */

  describe('kural', () => {
    it('taslak → yürürlük → iptal; denetim izi ve olaylar', async () => {
      const draft = await createRule();
      assert.equal(draft.status, 'DRAFT');
      assert.equal(draft.currency, 'TRY');
      const active = await manager(() => rules.activateRule(hotelId, draft.id, { expectedUpdatedAt: version(draft) }));
      assert.equal(active.status, 'ACTIVE');
      assert.equal(active.activatedBy, MANAGER);
      await rejectsWith(manager(() => rules.deleteRule(hotelId, active.id, { expectedUpdatedAt: version(active) })), 'RULE_NOT_DRAFT');
      const cancelled = await manager(() => rules.cancelRule(hotelId, active.id, { expectedUpdatedAt: version(active), reason: 'Sözleşme feshedildi' }));
      assert.equal(cancelled.status, 'CANCELLED');
      assert.equal(cancelled.cancelReason, 'Sözleşme feshedildi');
      await rejectsWith(manager(() => rules.updateRule(hotelId, active.id, { ...parse('updateAgencyBonusRuleSchema', { ...ruleInput(), agencyId: undefined, expectedUpdatedAt: cancelled.updatedAt }) })), 'RULE_CANCELLED');

      const audits = await db.auditLog.findMany({ where: { hotelId, entity: 'AgencyBonusRule', entityId: draft.id }, orderBy: { createdAt: 'asc' } });
      assert.deepEqual(audits.map((row) => row.action), ['CREATE', 'UPDATE', 'UPDATE']);
      assert.deepEqual((await eventsNamed('agency.bonus.rule.changed')).map((payload) => payload.change), ['CREATED', 'ACTIVATED', 'CANCELLED']);
    });

    it('taslak silinir; başka otelin acentesi ve oda tipi reddedilir; eski sürümle güncelleme 409', async () => {
      const draft = await createRule();
      await manager(() => rules.deleteRule(hotelId, draft.id, { expectedUpdatedAt: version(draft) }));
      assert.equal(await db.agencyBonusRule.count({ where: { hotelId } }), 0);

      await rejectsWith(createRule({ agencyId: agency.foreign.id }), 'VALIDATION', /Acente bulunamadı/);
      await rejectsWith(createRule({ roomTypeIds: [types.foreign.id] }), 'VALIDATION', /Oda tipi bulunamadı/);

      const rule = await createRule();
      const input = { ...ruleInput({ name: 'Yeni ad' }), expectedUpdatedAt: rule.updatedAt };
      delete input.agencyId;
      const updated = await manager(() => rules.updateRule(hotelId, rule.id, parse('updateAgencyBonusRuleSchema', input)));
      assert.equal(updated.name, 'Yeni ad');
      await rejectsWith(manager(() => rules.updateRule(hotelId, rule.id, parse('updateAgencyBonusRuleSchema', input))), 'STALE_WRITE');
    });

    it('aynı acentenin aynı ölçütte çakışan iki yürürlükteki kuralı olamaz; farklı ölçüt olabilir', async () => {
      await activeRule();
      const overlapping = await createRule({ name: 'Çakışan', startDate: date(-15), endDate: date(5) });
      await rejectsWith(manager(() => rules.activateRule(hotelId, overlapping.id, { expectedUpdatedAt: version(overlapping) })), 'BONUS_RULE_OVERLAP', /Yaz gece primi/);
      const revenue = await createRule({ name: 'Yıllık ciro', metric: 'REVENUE', target: '100000', tiers: [{ threshold: '50000', ratePct: '1' }], startDate: date(-60), endDate: date(60) });
      const active = await manager(() => rules.activateRule(hotelId, revenue.id, { expectedUpdatedAt: version(revenue) }));
      assert.equal(active.status, 'ACTIVE');
      // Başka acente aynı dönemde serbest.
      await activeRule({ agencyId: agency.b.id });
    });

    it('eşzamanlı yürürlüğe almada veritabanı kısıtı ikinciyi reddeder (anlamlı mesajla)', async () => {
      const first = await createRule({ name: 'Bir' });
      const second = await createRule({ name: 'İki', startDate: date(-20), endDate: date(-5) });
      const results = await Promise.allSettled([
        manager(() => rules.activateRule(hotelId, first.id, { expectedUpdatedAt: version(first) })),
        manager(() => rules.activateRule(hotelId, second.id, { expectedUpdatedAt: version(second) })),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const failure = results.find((result) => result.status === 'rejected');
      assert.equal(failure.reason.code, 'BONUS_RULE_OVERLAP');
      assert.equal(await db.agencyBonusRule.count({ where: { hotelId, status: 'ACTIVE' } }), 1);
    });
  });

  /* ══════════════════ Hak ediş ══════════════════ */

  describe('hak ediş', () => {
    it('dönem bitmeden hesaplanmaz; biten dönemde satır dökümüyle dondurulur', async () => {
      const running = await activeRule({ agencyId: agency.b.id, startDate: date(-5), endDate: date(5) });
      await rejectsWith(manager(() => settlement.calculateBonus(hotelId, running.id)), 'PERIOD_NOT_ENDED');
      // Dönemin son gecesi dün: bugün iş günü → dönem bitti.
      await seedClassicProduction();
      const rule = await activeRule({ agencyId: agency.a.id, startDate: date(-30), endDate: date(-1), name: 'Biten' });
      const bonus = await manager(() => settlement.calculateBonus(hotelId, rule.id));
      assert.equal(bonus.status, 'DRAFT');
      assert.equal(bonus.calculatedBy, MANAGER);
      // Dönem dün bitti: 12–9. geceler de içeride (4) → 13 gece.
      assert.deepEqual([bonus.nights, bonus.revenue, bonus.tierIndex, bonus.amount], [13, '13000.00', 2, '260.00']);
      assert.equal(bonus.reservationCount, 4);
      assert.deepEqual(bonus.slices, [{ tier: 2, ratePct: '2', from: '10', to: null, base: '13000.00', amount: '260.00' }]);
      assert.equal(bonus.drift, null);
      const lines = await db.agencyBonusLine.findMany({ where: { bonusId: bonus.id } });
      assert.equal(lines.reduce((total, line) => total + line.nights, 0), 13);
      assert.equal(lines.reduce((total, line) => total.plus(String(line.revenue)), core.toDecimal(0)).toFixed(2), '13000.00');
    });

    it('yeniden hesap aynı kaydı günceller; eşzamanlı iki hesap tek hak ediş ve çiftsiz döküm bırakır', async () => {
      await seedClassicProduction();
      const rule = await activeRule();
      const [left, right] = await Promise.all([
        manager(() => settlement.calculateBonus(hotelId, rule.id)),
        manager(() => settlement.calculateBonus(hotelId, rule.id)),
      ]);
      assert.equal(left.id, right.id);
      assert.equal(await db.agencyBonus.count({ where: { ruleId: rule.id } }), 1);
      assert.equal(await db.agencyBonusLine.count({ where: { bonusId: left.id } }), 4);
      const changes = (await eventsNamed('agency.bonus.changed')).map((payload) => payload.change).sort();
      assert.deepEqual(changes, ['CALCULATED', 'RECALCULATED']);
    });

    it('kural ya da üretim hesaptan sonra değişirse onaya gönderilemez; yeniden hesapla düzelir', async () => {
      await seedClassicProduction();
      const rule = await activeRule();
      let bonus = await manager(() => settlement.calculateBonus(hotelId, rule.id));

      // Geç gelen düzeltme: dönemin içinde bir konaklama daha işlendi.
      await seedStay({ checkIn: -14, checkOut: -13 });
      await postNights();
      const viewed = await manager(() => settlement.getBonus(hotelId, bonus.id));
      assert.deepEqual(viewed.drift, { nights: 1, revenue: '1000.00' });
      assert.equal(viewed.currentAmount, '240.00');
      await rejectsWith(manager(() => settlement.submitBonus(hotelId, bonus.id, { expectedUpdatedAt: version(bonus) })), 'BONUS_STALE', /\+1 gece/);
      bonus = await manager(() => settlement.calculateBonus(hotelId, rule.id));
      assert.equal(bonus.nights, 12);

      // Kural değişti (oran): hak ediş bayat.
      const current = await db.agencyBonusRule.findUnique({ where: { id: rule.id } });
      const input = { ...ruleInput({ tiers: [{ threshold: '5', ratePct: '1.5' }, { threshold: '10', ratePct: '2.5' }] }), expectedUpdatedAt: current.updatedAt };
      delete input.agencyId;
      await manager(() => rules.updateRule(hotelId, rule.id, parse('updateAgencyBonusRuleSchema', input)));
      const stale = await manager(() => settlement.getBonus(hotelId, bonus.id));
      assert.equal(stale.ruleChanged, true);
      await rejectsWith(manager(() => settlement.submitBonus(hotelId, bonus.id, { expectedUpdatedAt: version(stale) })), 'BONUS_STALE', /Kural hesaptan sonra değişti/);
      bonus = await manager(() => settlement.calculateBonus(hotelId, rule.id));
      assert.equal(bonus.ruleChanged, false);
      assert.equal(bonus.amount, '300.00', '12.000 × %2,5');
    });

    it('dönem uzatılıp yeniden sürerse hesaplanmış hak ediş silinir (dönem bitince yeniden hesaplanır)', async () => {
      await seedClassicProduction();
      const rule = await activeRule();
      const bonus = await manager(() => settlement.calculateBonus(hotelId, rule.id));
      const current = await db.agencyBonusRule.findUnique({ where: { id: rule.id } });
      const input = { ...ruleInput({ endDate: date(10) }), expectedUpdatedAt: current.updatedAt };
      delete input.agencyId;
      const updated = await manager(() => rules.updateRule(hotelId, rule.id, parse('updateAgencyBonusRuleSchema', input)));
      assert.equal(updated.phase, 'RUNNING');
      assert.equal(updated.bonus, null);
      assert.equal(await db.agencyBonusLine.count({ where: { bonusId: bonus.id } }), 0, 'döküm hak edişle gider');
      const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'AgencyBonus', entityId: bonus.id, action: 'DELETE' } });
      assert.match(JSON.stringify(audit.after), /dönemi uzatıldı/);
      await rejectsWith(manager(() => settlement.calculateBonus(hotelId, rule.id)), 'PERIOD_NOT_ENDED');
    });

    it('onay: dört göz, onaylanınca kilit; kural ve hak ediş korunur; gönderene zil', async () => {
      await seedClassicProduction();
      const rule = await activeRule();
      const bonus = await manager(() => settlement.calculateBonus(hotelId, rule.id));
      const submitted = await manager(() => settlement.submitBonus(hotelId, bonus.id, { expectedUpdatedAt: version(bonus), note: 'Sezon kapanışı' }));
      assert.equal(submitted.status, 'PENDING_APPROVAL');
      assert.equal(submitted.submittedBy, MANAGER);
      const approval = await db.approval.findUnique({ where: { id: submitted.approvalId } });
      assert.deepEqual([approval.type, String(approval.amount), approval.entityType, approval.entityId, approval.requestedBy], ['AGENCY_BONUS', '220', 'AgencyBonus', bonus.id, MANAGER]);
      assert.equal(approval.data['Prim'], '220,00 TRY');
      assert.ok(approval.expiresAt.getTime() - Date.now() > 6 * 86_400_000, 'onay bir hafta bekler');

      await rejectsWith(manager(() => approvals.decideApproval(hotelId, approval.id, 'GRANTED')), 'SELF_DECISION');
      await rejectsWith(manager(() => settlement.calculateBonus(hotelId, rule.id)), 'BONUS_LOCKED');
      const ruleNow = await db.agencyBonusRule.findUnique({ where: { id: rule.id } });
      await rejectsWith(manager(() => rules.cancelRule(hotelId, rule.id, { expectedUpdatedAt: ruleNow.updatedAt, reason: 'Vazgeçildi' })), 'BONUS_LOCKED');

      await manager2(() => approvals.decideApproval(hotelId, approval.id, 'GRANTED', { note: 'Uygun' }));
      const approved = await manager(() => settlement.getBonus(hotelId, bonus.id));
      assert.equal(approved.status, 'APPROVED');
      assert.equal(approved.approvedBy, MANAGER2);
      assert.equal(approved.decisionNote, 'Uygun');
      const submitter = await db.user.findFirst({ where: { email: MANAGER } });
      const alert = await db.staffAlert.findFirst({ where: { hotelId, kind: 'APPROVAL_DECIDED', entityId: bonus.id } });
      assert.equal(alert.userId, submitter.id);
      assert.match(alert.title, /onaylandı: Atlas Turizm/);

      const input = { ...ruleInput(), expectedUpdatedAt: ruleNow.updatedAt };
      delete input.agencyId;
      await rejectsWith(manager(() => rules.updateRule(hotelId, rule.id, parse('updateAgencyBonusRuleSchema', input))), 'BONUS_LOCKED');
      assert.deepEqual((await eventsNamed('agency.bonus.changed')).map((payload) => payload.change), ['CALCULATED', 'SUBMITTED', 'APPROVED']);
    });

    it('ret ve süre dolumu hak edişi "hesaplandı"ya döndürür; aynı karar iki kez uygulanmaz', async () => {
      await seedClassicProduction();
      const rule = await activeRule();
      let bonus = await manager(() => settlement.calculateBonus(hotelId, rule.id));
      bonus = await manager(() => settlement.submitBonus(hotelId, bonus.id, { expectedUpdatedAt: version(bonus) }));
      const firstApproval = bonus.approvalId;
      await manager2(() => approvals.decideApproval(hotelId, firstApproval, 'DENIED', { note: 'Kademe oranı yanlış' }));
      bonus = await manager(() => settlement.getBonus(hotelId, bonus.id));
      assert.equal(bonus.status, 'DRAFT');
      assert.equal(bonus.approvalId, null);
      assert.equal(bonus.decisionNote, `Reddedildi (${MANAGER2}): Kademe oranı yanlış`);
      // Aynı haber yeniden gelirse (outbox): değişiklik yok.
      const replay = await settlement.applyBonusDecision({ hotelId, approvalId: firstApproval, type: 'AGENCY_BONUS' }, { name: 'approval.denied' });
      assert.equal(replay.stale, true);

      bonus = await manager(() => settlement.submitBonus(hotelId, bonus.id, { expectedUpdatedAt: version(bonus) }));
      await approvals.expireApprovals(new Date(Date.now() + 8 * 86_400_000));
      bonus = await manager(() => settlement.getBonus(hotelId, bonus.id));
      assert.equal(bonus.status, 'DRAFT');
      assert.match(bonus.decisionNote, /süresi doldu/);
      assert.deepEqual(
        (await eventsNamed('agency.bonus.changed')).map((payload) => payload.change),
        ['CALCULATED', 'SUBMITTED', 'REJECTED', 'SUBMITTED', 'EXPIRED'],
      );
    });

    it('prim doğmayan dönem onay kuyruğuna gitmeden kapanır; ödemesi olmaz', async () => {
      await seedStay({ checkIn: -20, checkOut: -17 });
      await postNights();
      const rule = await activeRule();
      let bonus = await manager(() => settlement.calculateBonus(hotelId, rule.id));
      assert.deepEqual([bonus.nights, bonus.tierIndex, bonus.amount], [3, 0, '0.00']);
      bonus = await manager(() => settlement.submitBonus(hotelId, bonus.id, { expectedUpdatedAt: version(bonus) }));
      assert.equal(bonus.status, 'APPROVED');
      assert.equal(bonus.approvalId, null);
      assert.match(bonus.decisionNote, /Prim doğmadı/);
      assert.equal(await db.approval.count({ where: { hotelId } }), 0);
      const summary = await manager(() => rules.getBonusSummary(hotelId));
      assert.deepEqual(summary.bonuses.approvedUnpaid, { count: 0, amount: '0.00' }, 'prim doğmayan hak ediş "ödenecek" sayılmaz');
      await rejectsWith(
        accounting(() => settlement.markBonusPaid(hotelId, bonus.id, { expectedUpdatedAt: version(bonus), paidAt: date(0), paymentRef: 'DK-1' })),
        'BONUS_ZERO',
      );
    });

    it('ödeme: tarih kuralları, geri alma, yeniden açma (sürüm artar)', async () => {
      await seedClassicProduction();
      const rule = await activeRule();
      let bonus = await manager(() => settlement.calculateBonus(hotelId, rule.id));
      bonus = await manager(() => settlement.submitBonus(hotelId, bonus.id, { expectedUpdatedAt: version(bonus) }));
      await manager2(() => approvals.decideApproval(hotelId, bonus.approvalId, 'GRANTED'));
      bonus = await manager(() => settlement.getBonus(hotelId, bonus.id));

      await rejectsWith(accounting(() => settlement.markBonusPaid(hotelId, bonus.id, { expectedUpdatedAt: version(bonus), paidAt: date(1), paymentRef: 'DK-77' })), 'VALIDATION', /ileri/);
      await rejectsWith(accounting(() => settlement.markBonusPaid(hotelId, bonus.id, { expectedUpdatedAt: version(bonus), paidAt: date(-2), paymentRef: 'DK-77' })), 'VALIDATION', /onay gününden önce/);
      bonus = await accounting(() => settlement.markBonusPaid(hotelId, bonus.id, { expectedUpdatedAt: version(bonus), paidAt: date(0), paymentRef: 'DK-77', note: 'Havale' }));
      assert.deepEqual([bonus.status, bonus.paidAt, bonus.paidBy, bonus.paymentRef], ['PAID', D(0), ACCOUNTING, 'DK-77']);

      await rejectsWith(manager(() => settlement.reopenBonus(hotelId, bonus.id, { expectedUpdatedAt: version(bonus), reason: 'Yanlış dönem' })), 'BONUS_PAID');
      bonus = await accounting(() => settlement.revertBonusPayment(hotelId, bonus.id, { expectedUpdatedAt: version(bonus), reason: 'Yanlış hak edişe işlendi' }));
      assert.deepEqual([bonus.status, bonus.paidAt, bonus.paymentRef], ['APPROVED', null, null]);
      bonus = await manager(() => settlement.reopenBonus(hotelId, bonus.id, { expectedUpdatedAt: version(bonus), reason: 'Acente itiraz etti' }));
      assert.deepEqual([bonus.status, bonus.revision, bonus.reopenReason, bonus.approvedBy], ['DRAFT', 2, 'Acente itiraz etti', null]);
      await rejectsWith(manager(() => settlement.reopenBonus(hotelId, bonus.id, { expectedUpdatedAt: new Date(0), reason: 'Eski sürüm' })), 'STALE_WRITE');
      const audits = await db.auditLog.count({ where: { hotelId, entity: 'AgencyBonus', entityId: bonus.id } });
      assert.equal(audits, 6, 'hesap, gönderim, onay, ödeme, geri alma, yeniden açma');
    });

    it('dilimli hesap ve tavan hak edişe yazılır', async () => {
      await seedClassicProduction();
      const rule = await activeRule({
        metric: 'REVENUE',
        mode: 'EXCESS',
        target: '8000',
        tiers: [{ threshold: '5000', ratePct: '2' }, { threshold: '10000', ratePct: '5' }],
        maxBonus: '120',
      });
      const bonus = await manager(() => settlement.calculateBonus(hotelId, rule.id));
      // 11.000: 5.000 × %2 = 100 + 1.000 × %5 = 50 → 150; tavan 120.
      assert.deepEqual(bonus.slices.map((slice) => slice.amount), ['100.00', '50.00']);
      assert.deepEqual([bonus.grossAmount, bonus.amount, bonus.capped], ['150.00', '120.00', true]);
      assert.equal(bonus.scorePct, '137.50');
    });
  });

  /* ══════════════════ İlerleme özeti ve zamanlanmış iş ══════════════════ */

  describe('ilerleme ve dönem sonu', () => {
    it('özet sürüm damgasına dokunmaz; kademe yükselince bir kez uyarı düşer', async () => {
      await seedStay({ checkIn: -8, checkOut: -2 }); // 6 gece
      await postNights();
      const rule = await activeRule({ startDate: date(-10), endDate: date(20) });
      // Yürürlüğe alma özeti uyarısız yazdı.
      let row = await db.agencyBonusRule.findUnique({ where: { id: rule.id } });
      assert.deepEqual([row.progressNights, String(row.progressRevenue), row.reachedTier], [6, '6000', 1]);
      assert.equal(await db.staffAlert.count({ where: { hotelId, kind: 'AGENCY_BONUS' } }), 0, 'yürürlüğe almada uyarı yok');

      await seedStay({ checkIn: -2, checkOut: 0 }); // +2 → 8 gece (kademe değişmez)
      await seedStay({ checkIn: -5, checkOut: -3 }); // +2 → 10 gece: 2. kademe
      await postNights();
      const versionBefore = (await db.agencyBonusRule.findUnique({ where: { id: rule.id } })).updatedAt;
      const summary = await progress.refreshProgress(hotelId);
      assert.deepEqual(summary, { rules: 1, changed: 1, tierUps: 1 });
      row = await db.agencyBonusRule.findUnique({ where: { id: rule.id } });
      assert.deepEqual([row.progressNights, String(row.progressScore), row.reachedTier], [10, '100', 2]);
      assert.equal(row.updatedAt.getTime(), versionBefore.getTime(), 'sürüm damgası değişmez (form 409 almaz)');
      const alerts = await db.staffAlert.findMany({ where: { hotelId, kind: 'AGENCY_BONUS' } });
      assert.equal(alerts.length, 1);
      assert.match(alerts[0].title, /Atlas Turizm 2\. prim kademesine ulaştı/);
      assert.equal(alerts[0].permission, 'agency_bonus.view');
      assert.deepEqual(await eventsNamed('agency.bonus.tier_reached'), [{ hotelId, ruleId: rule.id, agencyId: agency.a.id, tier: 2 }]);

      // Tekrar: değişiklik yok, ikinci uyarı yok.
      assert.deepEqual(await progress.refreshProgress(hotelId), { rules: 1, changed: 0, tierUps: 0 });
      assert.equal(await db.staffAlert.count({ where: { hotelId, kind: 'AGENCY_BONUS' } }), 1);
    });

    it('dönemi biten kuralın hak edişi otomatik hesaplanır; yetkiliye uyarı; ikinci tur dokunmaz', async () => {
      await seedClassicProduction();
      const rule = await activeRule();
      await activeRule({ agencyId: agency.b.id, startDate: date(-5), endDate: date(5), name: 'Sürüyor' });
      const ticks = await jobs.runAgencyBonusTick({ info: () => {}, warn: (...args) => assert.fail(JSON.stringify(args)) });
      assert.equal(ticks, 1, 'bir otel');
      const bonus = await db.agencyBonus.findFirst({ where: { ruleId: rule.id } });
      assert.deepEqual([bonus.status, bonus.calculatedBy, String(bonus.amount)], ['DRAFT', 'system', '220']);
      assert.equal(await db.agencyBonus.count({ where: { hotelId } }), 1, 'süren kural hesaplanmaz');
      const alert = await db.staffAlert.findFirst({ where: { hotelId, kind: 'AGENCY_BONUS', entityId: bonus.id } });
      assert.match(alert.title, /Dönem bitti: Atlas Turizm/);
      assert.equal(alert.permission, 'agency_bonus.manage');

      const before = await db.agencyBonus.findFirst({ where: { ruleId: rule.id } });
      await jobs.runAgencyBonusTick({ info: () => {}, warn: () => {} });
      const after = await db.agencyBonus.findFirst({ where: { ruleId: rule.id } });
      assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), 'var olan hak edişe dokunulmaz');
    });

    it('kademe uyarısı onaya giden kuralda tazelenmez (dönem kapandı)', async () => {
      await seedClassicProduction();
      const rule = await activeRule();
      let bonus = await manager(() => settlement.calculateBonus(hotelId, rule.id));
      bonus = await manager(() => settlement.submitBonus(hotelId, bonus.id, { expectedUpdatedAt: version(bonus) }));
      const summary = await progress.refreshProgress(hotelId);
      assert.equal(summary.rules, 0);
    });
  });

  /* ══════════════════ Liste, rapor, döküm, önizleme ══════════════════ */

  describe('liste ve rapor', () => {
    it('kural listesi: evre, arama, hedefe ulaşma sırası; özet başlığı', async () => {
      await seedClassicProduction();
      await activeRule();
      await activeRule({ agencyId: agency.b.id, name: 'Bora yaz' });
      await createRule({ name: 'Gelecek sezon', startDate: date(30), endDate: date(90) });
      await progress.refreshProgress(hotelId);

      const ended = await manager(() => rules.listRules(hotelId, parse('agencyBonusRuleListQuerySchema', { phase: 'ENDED', sort: 'SCORE_DESC' })));
      assert.deepEqual(ended.items.map((item) => [item.agency.code, item.progress.scorePct]), [['ATLAS', '110.00'], ['BORA', '20.00']]);
      assert.equal(ended.meta.total, 2);
      const upcoming = await manager(() => rules.listRules(hotelId, parse('agencyBonusRuleListQuerySchema', { phase: 'UPCOMING' })));
      assert.deepEqual(upcoming.items.map((item) => item.name), ['Gelecek sezon']);
      const search = await manager(() => rules.listRules(hotelId, parse('agencyBonusRuleListQuerySchema', { search: 'bora' })));
      assert.deepEqual(search.items.map((item) => item.name), ['Bora yaz']);

      const summary = await manager(() => rules.getBonusSummary(hotelId));
      assert.deepEqual(summary.rules, { running: 0, upcoming: 0, behind: 0, awaitingSettlement: 2 });
    });

    it('hak ediş raporu durum kırılımıyla; döküm aranır, sıralanır, Excel için tamamı', async () => {
      await seedClassicProduction();
      const ruleA = await activeRule();
      const ruleB = await activeRule({ agencyId: agency.b.id, name: 'Bora yaz', tiers: [{ threshold: '1', ratePct: '1' }] });
      const bonusA = await manager(() => settlement.calculateBonus(hotelId, ruleA.id));
      await manager(() => settlement.calculateBonus(hotelId, ruleB.id));
      await manager(() => settlement.submitBonus(hotelId, bonusA.id, { expectedUpdatedAt: version(bonusA) }));

      const report = await accounting(() => settlement.listBonuses(hotelId, parse('agencyBonusListQuerySchema', {})));
      assert.equal(report.meta.total, 2);
      assert.deepEqual(
        report.totals.map((row) => [row.status, row.count, row.amount]).sort(),
        [['DRAFT', 1, '20.00'], ['PENDING_APPROVAL', 1, '220.00']],
      );
      const pendingOnly = await accounting(() => settlement.listBonuses(hotelId, parse('agencyBonusListQuerySchema', { status: 'PENDING_APPROVAL' })));
      assert.deepEqual(pendingOnly.items.map((item) => item.agency.code), ['ATLAS']);
      assert.equal(pendingOnly.totals.length, 2, 'kırılım durum süzgecinden bağımsız');

      const lines = await accounting(() => settlement.listBonusLines(hotelId, bonusA.id, parse('agencyBonusLinesQuerySchema', { sort: 'NIGHTS_DESC' })));
      assert.deepEqual(lines.items.map((line) => line.nights), [5, 2, 2, 2]);
      const code = lines.items[0].confirmationCode;
      const found = await accounting(() => settlement.listBonusLines(hotelId, bonusA.id, parse('agencyBonusLinesQuerySchema', { search: code })));
      assert.deepEqual([found.meta.total, found.items[0].confirmationCode], [1, code]);
      const exported = await accounting(() => settlement.exportBonusLines(hotelId, bonusA.id, { part: 1 }));
      assert.deepEqual([exported.items.length, exported.parts, exported.total], [4, 1, 4]);
      await rejectsWith(accounting(() => settlement.exportBonusLines(hotelId, bonusA.id, { part: 2 })), 'VALIDATION', /1 parça/);
    });

    it('önizleme kaydetmeden aynı hesabı verir', async () => {
      await seedClassicProduction();
      const preview = await manager(() => rules.previewRule(hotelId, parse('previewAgencyBonusRuleSchema', ruleInput())));
      assert.deepEqual([preview.realized.nights, preview.earned.amount], [11, '220.00']);
      assert.equal(await db.agencyBonusRule.count({ where: { hotelId } }), 0);
      await rejectsWith(manager(() => rules.previewRule(hotelId, parse('previewAgencyBonusRuleSchema', ruleInput({ agencyId: agency.foreign.id })))), 'VALIDATION');
    });
  });

  /* ══════════════════ HTTP: izin, doğrulama, otel kapsamı ══════════════════ */

  describe('HTTP', () => {
    it('resepsiyon göremez; muhasebe görür ve öder ama kural yazamaz; geçersiz kademe 400', async () => {
      assert.equal((await call('GET', '/agency-bonus/rules', DESK)).statusCode, 403);
      assert.equal((await call('GET', '/agency-bonus/rules', ACCOUNTING)).statusCode, 200);
      assert.equal((await call('GET', '/agency-bonus/summary', ACCOUNTING)).statusCode, 200);
      const body = { ...ruleInput(), startDate: D(-30), endDate: D(-11) };
      assert.equal((await call('POST', '/agency-bonus/rules', ACCOUNTING, body)).statusCode, 403);
      const bad = await call('POST', '/agency-bonus/rules', MANAGER, { ...body, tiers: [{ threshold: '10', ratePct: '2' }, { threshold: '5', ratePct: '1' }] });
      assert.equal(bad.statusCode, 400);
      assert.match(bad.body, /bir önceki kademeden/);
      const created = await call('POST', '/agency-bonus/rules', MANAGER, body);
      assert.equal(created.statusCode, 201, created.body);
      const ruleId = created.json().data.id;
      assert.equal((await call('POST', `/agency-bonus/rules/${ruleId}/settle`, ACCOUNTING)).statusCode, 403);
      assert.equal((await call('GET', `/agency-bonus/rules/${ruleId}`, ACCOUNTING)).statusCode, 200);
    });

    it('bozuk ya da boş tarih 500 değil 400 döner (dönem denetimi çökmez)', async () => {
      const badQuery = await call('GET', '/agency-bonus/settlements?from=abc&to=2027-01-01', ACCOUNTING);
      assert.equal(badQuery.statusCode, 400, badQuery.body);
      assert.match(badQuery.body, /Geçersiz tarih/);
      const body = { ...ruleInput(), startDate: '', endDate: '' };
      const emptyDates = await call('POST', '/agency-bonus/rules', MANAGER, body);
      assert.equal(emptyDates.statusCode, 400, emptyDates.body);
      assert.match(emptyDates.body, /Tarih seçin/);
    });

    it('başka otelin kuralı ve hak edişi görünmez', async () => {
      await seedClassicProduction();
      const rule = await activeRule();
      const bonus = await manager(() => settlement.calculateBonus(hotelId, rule.id));
      await rejectsWith(manager(() => rules.getRule(otherHotelId, rule.id)), 'NOT_FOUND');
      await rejectsWith(manager(() => settlement.getBonus(otherHotelId, bonus.id)), 'NOT_FOUND');
      await rejectsWith(manager(() => settlement.listBonusLines(otherHotelId, bonus.id, parse('agencyBonusLinesQuerySchema', {}))), 'NOT_FOUND');
      await rejectsWith(manager(() => settlement.calculateBonus(otherHotelId, rule.id)), 'NOT_FOUND');
    });
  });
});
