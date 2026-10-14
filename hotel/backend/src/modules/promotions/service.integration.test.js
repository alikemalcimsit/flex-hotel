import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Promosyon ve kupon (modül 31) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: promosyon yaşam döngüsü (taslak → yayında ⇄ durduruldu, silme),
 * kupon üretimi ve kapatma, rezervasyonda tek indirim (en avantajlısı, kupon
 * daha iyi değilse hakkı harcanmaz), kupon kullanım hakkı (iptalde geri açılır,
 * geri almada yeniden sayılır, eşzamanlı istekte tek kullanım), grup, acente ve
 * elle fiyat dışlaması, kanal koşulu, açılıştaki kopya, gelmedi ücreti,
 * düzenlemede yeniden denetim (uzatma, kısaltma, kupon ekleme / kaldırma),
 * erken çıkış, fiyat önizlemesi, kullanım raporu ve izinler.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'mudur@test.local';
const ACCOUNTING = 'muhasebe@test.local';
const DESK = 'resepsiyon@test.local';
const DIRECT = ['UI', 'PHONE', 'EMAIL', 'WEBCHAT', 'WHATSAPP', 'WIDGET'];

describe('promosyon ve kupon (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let promotions;
  /** @type {any} */ let rules;
  /** @type {any} */ let reservations;
  /** @type {any} */ let agencies;
  /** @type {any} */ let frontDesk;
  /** @type {any} */ let concierge;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let otherHotelId;
  /** @type {Record<string, any>} */ let types;
  /** @type {Record<string, any>} */ let rooms;
  /** @type {Map<string, string>} */ let tokens;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    promotions = await import('./service.js');
    rules = await import('./rules.js');
    reservations = await import('../reservations/service.js');
    agencies = await import('../agencies/service.js');
    frontDesk = await import('../front-desk/service.js');
    concierge = await import('../concierge/service.js');
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
  const at = (time, offset = 0) => contracts.zonedWallTimeToUtc(`${D(offset)}T${time}`, ZONE);

  beforeEach(async () => {
    await resetDatabase(db);
    reservations.clearReservationCache();
    frontDesk.clearFrontDeskCache();
    cache.cache.invalidatePrefix('settings:');
    tokens = new Map();
    const hotel = await db.hotel.create({
      data: {
        name: 'Deniz Otel',
        code: `P${randomUUID().slice(0, 5).toUpperCase()}`,
        timezone: ZONE,
        currency: 'TRY',
        checkOutTime: '12:00',
        lateCheckOutFeeMode: 'PERCENT_OF_NIGHT',
        lateCheckOutFeeValue: '50',
      },
    });
    hotelId = hotel.id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka Otel', code: `Q${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;

    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: ACCOUNTING, name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
        { hotelId, email: DESK, name: 'Resepsiyon', role: 'FRONT_DESK', passwordHash },
      ],
    });
    // Resepsiyon rezervasyon açabilsin (varsayılan matriste yalnızca görme var).
    await db.rolePermission.createMany({
      data: ['reservations.view', 'reservations.manage'].map((permission) => ({ hotelId, role: 'FRONT_DESK', permission })),
      skipDuplicates: true,
    });
    const type = (code, basePrice) => db.roomType.create({ data: { hotelId, code, name: `${code} oda`, basePrice, capacityAdults: 3, capacityChildren: 1 } });
    types = { std: await type('STD', '1000'), dlx: await type('DLX', '2000') };
    rooms = {};
    for (const number of ['101', '102', '103', '104', '105', '106']) rooms[number] = await db.room.create({ data: { hotelId, number, roomTypeId: types.std.id } });
    for (const number of ['201', '202']) rooms[number] = await db.room.create({ data: { hotelId, number, roomTypeId: types.dlx.id } });
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

  const promoInput = (overrides = {}) =>
    contracts.createPromotionSchema.parse({
      name: `Promosyon ${randomUUID().slice(0, 6)}`,
      notes: null,
      requiresCoupon: false,
      discountType: 'PERCENT',
      discountValue: '10',
      sources: DIRECT,
      ...overrides,
    });
  const makePromotion = (overrides = {}) => manager(() => promotions.createPromotion(hotelId, promoInput(overrides)));
  const activate = (promotion) => manager(() => promotions.setPromotionStatus(hotelId, promotion.id, { expectedUpdatedAt: new Date(promotion.updatedAt), status: 'ACTIVE' }));
  const livePromotion = async (overrides = {}) => activate(await makePromotion(overrides));
  const makeCoupons = (promotion, input) => manager(() => promotions.createCoupons(hotelId, promotion.id, contracts.createCouponsSchema.parse(input)));
  const customCoupon = async (promotion, code, maxUses = null) => {
    await makeCoupons(promotion, { mode: 'CUSTOM', code, maxUses });
    return db.coupon.findFirst({ where: { hotelId, code } });
  };

  const reservationInput = (overrides = {}) => ({
    guestId: null,
    guest: { firstName: 'Ayşe', lastName: 'Yılmaz', phone: `+90532${String(Math.random()).slice(2, 9)}`, email: null, nationality: 'TR' },
    forceNewGuest: true,
    roomTypeId: types.std.id,
    adults: 2,
    children: 0,
    boardType: 'BB',
    checkIn: date(70),
    checkOut: date(73),
    status: 'CONFIRMED',
    source: 'UI',
    notes: null,
    requestId: randomUUID(),
    waitlistId: null,
    roomId: null,
    manualTotal: null,
    priceNote: null,
    agencyId: null,
    couponCode: null,
    ...overrides,
  });
  const book = async (overrides = {}, options = {}) => (await desk(() => reservations.createReservation(hotelId, reservationInput(overrides), options))).reservation;
  const stay = (checkIn, nights) => ({ checkIn: date(checkIn), checkOut: date(checkIn + nights) });
  const nightsOf = (reservation) => reservation.nightlyRates.map((night) => [night.date, night.amount, night.discount]);
  const version = async (id) => (await db.reservation.findUnique({ where: { id } })).updatedAt;
  const edit = async (reservation, input, options = {}) =>
    desk(async () => reservations.updateReservation(hotelId, reservation.id, { expectedUpdatedAt: await version(reservation.id), ...input }, options));
  const preview = (reservation, input) => desk(() => reservations.previewReservationUpdate(hotelId, reservation.id, input));
  const cancel = async (reservation) =>
    desk(async () => reservations.cancelReservation(hotelId, reservation.id, { expectedUpdatedAt: await version(reservation.id), reason: 'Misafir vazgeçti', waiveFee: true }));
  const used = (couponId) => db.reservation.count({ where: { couponId, status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'] } } });
  const rejectsWith = (promise, code, pattern) =>
    assert.rejects(promise, (error) => {
      assert.equal(error.code, code, error.message);
      if (pattern) assert.match(error.message, pattern);
      return true;
    });
  /** Sezon: bu günlerdeki gecelerin fiyatı çarpanla değişir. */
  const season = async (from, to, multiplier) => {
    await db.season.create({ data: { hotelId, name: `Sezon ${from}`, startDate: date(from), endDate: date(to), multiplier } });
    cache.cache.invalidatePrefix('settings:');
  };

  /* ══════════════════ Promosyon yönetimi ══════════════════ */

  describe('promosyon yönetimi', () => {
    it('taslak açar: ad otel içinde tekil (büyük / küçük harf duyarsız), denetim izi ve olay; bilinmeyen oda tipi reddedilir', async () => {
      const promo = await makePromotion({ name: 'Erken Rezervasyon', minLeadDays: 60, discountValue: '15' });
      assert.equal(promo.status, 'DRAFT');
      assert.equal(promo.label, '%15');
      assert.equal(promo.availability, null);
      assert.deepEqual(promo.blockers, []);
      const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'Promotion', entityId: promo.id } });
      assert.equal(audit.action, 'CREATE');
      assert.equal(audit.actor, MANAGER);
      assert.equal((await db.eventLog.findFirst({ where: { hotelId, name: 'promotion.changed' } })).payload.change, 'CREATED');

      await assert.rejects(makePromotion({ name: 'erken rezervasyon' }), (error) => error.fields?.name && /adla/.test(error.message));
      await assert.rejects(makePromotion({ roomTypeIds: [randomUUID()] }), (error) => Boolean(error.fields?.roomTypeIds));
      await db.promotion.create({ data: { hotelId: otherHotelId, name: 'Erken Rezervasyon', discountType: 'PERCENT', discountValue: '5', sources: ['UI'], createdBy: 'test' } });
      assert.equal((await promotions.listPromotions(hotelId, { page: 1, pageSize: 20 })).meta.total, 1);
    });

    it('yayına alma: satış dönemi geçmişse olmaz; durdurma yalnızca yayındakine; eski sürüm 409', async () => {
      const old = await makePromotion({ bookFrom: D(-30), bookTo: D(-1) });
      await rejectsWith(activate(old), 'PROMOTION_NOT_READY', /Rezervasyon \(satış\) dönemi geçmiş/);
      const draft = await makePromotion();
      await rejectsWith(
        manager(() => promotions.setPromotionStatus(hotelId, draft.id, { expectedUpdatedAt: new Date(draft.updatedAt), status: 'PAUSED' })),
        'INVALID_STATUS',
      );
      const live = await activate(draft);
      assert.equal(live.status, 'ACTIVE');
      assert.equal(live.availability, 'LIVE');
      assert.equal(live.activatedBy, MANAGER);
      await assert.rejects(
        manager(() => promotions.setPromotionStatus(hotelId, draft.id, { expectedUpdatedAt: new Date(draft.updatedAt), status: 'PAUSED' })),
        (error) => error.code === 'STALE_WRITE',
      );
      const paused = await manager(() => promotions.setPromotionStatus(hotelId, live.id, { expectedUpdatedAt: new Date(live.updatedAt), status: 'PAUSED' }));
      assert.equal(paused.status, 'PAUSED');
      const scheduled = await livePromotion({ bookFrom: D(5) });
      assert.equal(scheduled.availability, 'SCHEDULED');
    });

    it('veritabanı kısıtları son savunma: türle uyuşmayan indirim, acente kanalı, taslakta yayın izi', async () => {
      const base = { hotelId, name: 'Kısıt', discountType: 'PERCENT', discountValue: '10', sources: ['UI'], createdBy: 'test' };
      await assert.rejects(db.promotion.create({ data: { ...base, discountValue: '120' } }), /Promotion_discount_valid/);
      await assert.rejects(db.promotion.create({ data: { ...base, discountType: 'FREE_NIGHTS', discountValue: null, stayNights: 3, payNights: 3 } }), /Promotion_discount_valid/);
      await assert.rejects(db.promotion.create({ data: { ...base, sources: ['UI', 'AGENCY'] } }), /Promotion_sources_valid/);
      await assert.rejects(db.promotion.create({ data: { ...base, activatedAt: new Date(), activatedBy: 'x' } }), /Promotion_status_trail/);
      await assert.rejects(db.promotion.create({ data: { ...base, bookFrom: date(5), bookTo: date(1) } }), /Promotion_book_window_valid/);
    });

    it('silme: kullanılmamış promosyon kuponlarıyla silinir; iptal edilmiş rezervasyonda bile kullanıldıysa silinmez', async () => {
      const unused = await makePromotion({ requiresCoupon: true });
      await makeCoupons(unused, { mode: 'GENERATE', count: 3, maxUses: 1 });
      const unusedVersion = (await db.promotion.findUnique({ where: { id: unused.id } })).updatedAt;
      await manager(() => promotions.deletePromotion(hotelId, unused.id, { expectedUpdatedAt: unusedVersion }));
      assert.equal(await db.promotion.count({ where: { id: unused.id } }), 0);
      assert.equal(await db.coupon.count({ where: { promotionId: unused.id } }), 0);

      const usedPromo = await livePromotion();
      const reservation = await book();
      assert.equal(reservation.promotion.id, usedPromo.id);
      await cancel(reservation);
      await rejectsWith(manager(() => promotions.deletePromotion(hotelId, usedPromo.id, { expectedUpdatedAt: new Date(usedPromo.updatedAt) })), 'IN_USE', /1 rezervasyonda/);
    });

    it('kuponu olan promosyon kuponsuz yapılamaz; yayındaki promosyon düzenlenebilir (denetim izinde önce / sonra)', async () => {
      const promo = await livePromotion({ requiresCoupon: true });
      await makeCoupons(promo, { mode: 'CUSTOM', code: 'YAZ2027', maxUses: null });
      const fresh = await db.promotion.findUnique({ where: { id: promo.id } });
      await assert.rejects(
        manager(() => promotions.updatePromotion(hotelId, promo.id, { ...promoInput({ name: promo.name, requiresCoupon: false }), expectedUpdatedAt: fresh.updatedAt })),
        (error) => Boolean(error.fields?.requiresCoupon),
      );
      const updated = await manager(() =>
        promotions.updatePromotion(hotelId, promo.id, { ...promoInput({ name: promo.name, requiresCoupon: true, discountValue: '20' }), expectedUpdatedAt: fresh.updatedAt }),
      );
      assert.equal(updated.discountValue, '20.00');
      assert.equal(updated.status, 'ACTIVE');
      const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'Promotion', entityId: promo.id, action: 'UPDATE', changedFields: { has: 'discountValue' } } });
      assert.ok(audit, 'indirim farkı denetim izinde');
    });
  });

  /* ══════════════════ Kupon ══════════════════ */

  describe('kupon', () => {
    it('toplu üretim: önekli, tekil, biçimli kodlar; üretim başına tek denetim kaydı; dışa aktarma, arama, sayfalama', async () => {
      const promo = await livePromotion({ requiresCoupon: true });
      const batch = await makeCoupons(promo, { mode: 'GENERATE', count: 300, prefix: 'yaz', maxUses: 1 });
      assert.equal(batch.count, 300);
      const codes = (await db.coupon.findMany({ where: { promotionId: promo.id }, select: { code: true, batchId: true, maxUses: true } }));
      assert.equal(new Set(codes.map((row) => row.code)).size, 300);
      assert.ok(codes.every((row) => /^YAZ-[ACDEFHJKMNPQRTUVWXY347]{8}$/.test(row.code) && row.batchId === batch.batchId && row.maxUses === 1));
      assert.equal(await db.auditLog.count({ where: { hotelId, entity: 'Coupon' } }), 1);

      const exported = await promotions.exportCoupons(hotelId, promo.id, batch.batchId);
      assert.equal(exported.items.length, 300);
      const page = await promotions.listCoupons(hotelId, promo.id, { page: 2, pageSize: 50 });
      assert.equal(page.meta.total, 300);
      assert.equal(page.items.length, 50);
      const sample = codes[0].code;
      const found = await promotions.listCoupons(hotelId, promo.id, { page: 1, pageSize: 50, search: sample.slice(-6).toLowerCase() });
      assert.ok(found.items.some((item) => item.code === sample));
      const card = await promotions.getPromotion(hotelId, promo.id);
      assert.deepEqual([card.coupons.total, card.coupons.active, card.coupons.batches.length], [300, 300, 1]);
    });

    it('elle kod: çakışan kod reddedilir (başka otelde aynı kod olur); kendiliğinden uygulanan promosyona kupon üretilmez', async () => {
      const promo = await livePromotion({ requiresCoupon: true });
      await makeCoupons(promo, { mode: 'CUSTOM', code: 'YAZ2027', maxUses: null });
      await assert.rejects(makeCoupons(promo, { mode: 'CUSTOM', code: 'yaz2027', maxUses: 5 }), (error) => Boolean(error.fields?.code));
      const other = await db.promotion.create({ data: { hotelId: otherHotelId, name: 'Başka otelin kuponu', discountType: 'PERCENT', discountValue: '5', sources: ['UI'], requiresCoupon: true, createdBy: 't' } });
      await db.coupon.create({ data: { hotelId: otherHotelId, promotionId: other.id, code: 'YAZ2027', batchId: randomUUID(), createdBy: 't' } });
      const auto = await livePromotion();
      await assert.rejects(makeCoupons(auto, { mode: 'GENERATE', count: 5, maxUses: 1 }), (error) => /kendiliğinden/.test(error.message));
      await assert.rejects(db.coupon.create({ data: { hotelId, promotionId: promo.id, code: 'kucuk', batchId: randomUUID(), createdBy: 't' } }), /Coupon_code_format/);
    });

    it('kapatılan kupon kullanılamaz, yeniden açılınca olur; sürüm kontrolü; promosyonu durdurulan kupon kullanılamaz', async () => {
      const promo = await livePromotion({ requiresCoupon: true, discountValue: '20' });
      const coupon = await customCoupon(promo, 'KIS2027');
      const closed = await manager(() => promotions.setCouponStatus(hotelId, promo.id, coupon.id, { expectedUpdatedAt: coupon.updatedAt, isActive: false }));
      assert.equal(closed.isActive, false);
      await rejectsWith(book({ couponCode: 'KIS2027' }), 'COUPON_DISABLED');
      await assert.rejects(
        manager(() => promotions.setCouponStatus(hotelId, promo.id, coupon.id, { expectedUpdatedAt: coupon.updatedAt, isActive: true })),
        (error) => error.code === 'STALE_WRITE',
      );
      await manager(() => promotions.setCouponStatus(hotelId, promo.id, coupon.id, { expectedUpdatedAt: new Date(closed.updatedAt), isActive: true }));
      assert.equal((await book({ couponCode: 'KIS2027' })).promotion.couponCode, 'KIS2027');

      const fresh = await db.promotion.findUnique({ where: { id: promo.id } });
      await manager(() => promotions.setPromotionStatus(hotelId, promo.id, { expectedUpdatedAt: fresh.updatedAt, status: 'PAUSED' }));
      await rejectsWith(book({ couponCode: 'KIS2027' }), 'COUPON_PROMOTION_INACTIVE');
    });
  });

  /* ══════════════════ Rezervasyonda promosyon ══════════════════ */

  describe('rezervasyonda promosyon', () => {
    it('erken rezervasyon %15: koşul tutunca geceler indirimli, kopya ve satış günü yazılır; tutmayınca liste fiyatı', async () => {
      const promo = await livePromotion({ name: 'Erken Rezervasyon', discountValue: '15', minLeadDays: 60 });
      const early = await book(stay(70, 3));
      assert.equal(early.totalPrice, '2550.00');
      assert.equal(early.discountTotal, '450.00');
      assert.deepEqual(nightsOf(early), [
        [D(70), '850.00', '150.00'],
        [D(71), '850.00', '150.00'],
        [D(72), '850.00', '150.00'],
      ]);
      assert.equal(early.promotion.name, 'Erken Rezervasyon');
      assert.equal(early.promotion.label, '%15');
      assert.equal(early.promotion.bookedOn, D(0));
      const row = await db.reservation.findUnique({ where: { id: early.id } });
      assert.equal(row.promotionId, promo.id);
      assert.equal(row.promotionTerms.minLeadDays, 60);

      const late = await book(stay(30, 3));
      assert.equal(late.totalPrice, '3000.00');
      assert.equal(late.promotion, null);
      assert.equal(late.discountTotal, '0.00');
    });

    it('birden fazla uygun promosyondan en avantajlısı; "3 kal 2 öde" en ucuz geceyi bedava yapar', async () => {
      await season(41, 41, '0.8'); // ikinci gece 800
      await livePromotion({ name: 'Yüzde On', discountValue: '10' });
      const free = await livePromotion({ name: 'Üç Kal İki Öde', discountType: 'FREE_NIGHTS', discountValue: null, stayNights: 3, payNights: 2 });
      const reservation = await book(stay(40, 3));
      assert.equal(reservation.promotion.id, free.id, '800 bedava > %10 (280)');
      assert.deepEqual(nightsOf(reservation), [
        [D(40), '1000.00', '0.00'],
        [D(41), '0.00', '800.00'],
        [D(42), '1000.00', '0.00'],
      ]);
      assert.equal(reservation.totalPrice, '2000.00');

      const two = await book(stay(40, 2));
      assert.equal(two.promotion.name, 'Yüzde On', '2 gecede bedava gece doğmaz');
      assert.equal(two.totalPrice, '1620.00');
    });

    it('kupon daha avantajlıysa uygulanır; değilse otomatik promosyon kalır ve kupon hakkı harcanmaz', async () => {
      await livePromotion({ name: 'Yüzde On', discountValue: '10' });
      const big = await livePromotion({ name: 'Kupon Yirmi', requiresCoupon: true, discountValue: '20' });
      const small = await livePromotion({ name: 'Kupon Beş', requiresCoupon: true, discountValue: '5' });
      const bigCoupon = await customCoupon(big, 'YIRMI20', 1);
      const smallCoupon = await customCoupon(small, 'BES05', 1);

      const withBig = await book({ couponCode: 'YIRMI20' });
      assert.equal(withBig.promotion.couponCode, 'YIRMI20');
      assert.equal(withBig.discountTotal, '600.00');
      assert.equal(await used(bigCoupon.id), 1);

      const withSmall = await book({ couponCode: 'BES05' });
      assert.equal(withSmall.promotion.name, 'Yüzde On');
      assert.equal(withSmall.promotion.couponCode, null);
      assert.equal(await used(smallCoupon.id), 0, 'kullanılmayan kuponun hakkı düşmez');
    });

    it('uymayan ya da bulunmayan kupon yer aranmadan reddedilir', async () => {
      const longStay = await livePromotion({ requiresCoupon: true, minNights: 5 });
      await customCoupon(longStay, 'UZUN5');
      await rejectsWith(book({ couponCode: 'UZUN5' }), 'PROMO_MIN_NIGHTS', /En az 5 gece/);
      await rejectsWith(book({ couponCode: 'YOKBOYLE' }), 'COUPON_NOT_FOUND');
      assert.equal(await db.reservation.count({ where: { hotelId } }), 0);
    });

    it('tek kullanımlık kupon: ikinci kullanım reddedilir; iptal hakkı geri açar; geri alma başkası kullandıysa reddedilir', async () => {
      const promo = await livePromotion({ requiresCoupon: true, discountValue: '25' });
      const coupon = await customCoupon(promo, 'TEK-001', 1);
      const first = await book({ couponCode: 'TEK-001' });
      await rejectsWith(book({ couponCode: 'TEK-001' }), 'COUPON_USED_UP', /1\/1/);

      await cancel(first);
      assert.equal(await used(coupon.id), 0);
      const second = await book({ couponCode: 'TEK-001' });
      assert.equal(second.promotion.couponCode, 'TEK-001');
      await rejectsWith(
        desk(async () => reservations.reinstateReservation(hotelId, first.id, { expectedUpdatedAt: await version(first.id) })),
        'COUPON_USED_UP',
        /iptal geri alınamaz/,
      );

      await cancel(second);
      const back = await desk(async () => reservations.reinstateReservation(hotelId, first.id, { expectedUpdatedAt: await version(first.id) }));
      assert.equal(back.status, 'CONFIRMED');
      assert.equal(back.discountTotal, '750.00', 'fiyat açıldığı günkü haliyle');
      assert.equal(await used(coupon.id), 1);
    });

    it('aynı anda iki rezervasyon tek kullanımlık kuponu isterse yalnızca biri alır (kupon kilidi)', async () => {
      const promo = await livePromotion({ requiresCoupon: true, discountValue: '30' });
      const coupon = await customCoupon(promo, 'YARIS', 1);
      // Farklı oda tipleri: oda tipi kilidi sıraya sokmaz, karar kupon kilidinde.
      const results = await Promise.allSettled([
        book({ couponCode: 'YARIS' }),
        book({ couponCode: 'YARIS', roomTypeId: types.dlx.id }),
        book({ couponCode: 'YARIS', checkIn: date(80), checkOut: date(82) }),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.ok(results.filter((result) => result.status === 'rejected').every((result) => result.reason.code === 'COUPON_USED_UP'));
      assert.equal(await used(coupon.id), 1);
    });

    it('grup: her oda bir kullanım; hak yetmezse grubun hiçbiri açılmaz', async () => {
      const promo = await livePromotion({ requiresCoupon: true, discountValue: '10' });
      await customCoupon(promo, 'GRUP2', 2);
      const group = (couponCode) =>
        desk(() =>
          reservations.createGroupReservation(hotelId, {
            ...reservationInput({ couponCode }),
            groupName: 'Düğün',
            lines: [{ roomTypeId: types.std.id, adults: 2, children: 0, boardType: 'BB', quantity: 3 }],
          }),
        );
      await rejectsWith(group('GRUP2'), 'COUPON_USED_UP', /2 kullanım hakkı kaldı; 3 oda/);
      assert.equal(await db.reservation.count({ where: { hotelId } }), 0);
      const three = await customCoupon(promo, 'GRUP3', 3);
      const result = await group('GRUP3');
      assert.equal(result.reservation.groupMembers.length, 3);
      assert.equal(await used(three.id), 3);
    });

    it('acente satışına ve elle fiyata promosyon uygulanmaz; kupon reddedilir', async () => {
      await livePromotion({ discountValue: '50' });
      const promo = await livePromotion({ requiresCoupon: true, discountValue: '50' });
      await customCoupon(promo, 'ELLI50');
      const agency = await manager(() =>
        agencies.createAgency(hotelId, { code: 'ATLAS', name: 'Atlas Tur', contactName: null, phone: null, email: null, address: null, taxOffice: null, taxNumber: null, commissionPct: '10', paymentTermDays: 0, notes: null }),
      );
      let contract = await manager(() => agencies.createContract(hotelId, agency.id, { name: 'Yıl', startDate: date(0), endDate: date(200), notes: null }));
      contract = await manager(() =>
        agencies.saveContractRates(hotelId, contract.id, {
          expectedUpdatedAt: new Date(contract.updatedAt),
          rates: [{ roomTypeId: types.std.id, boardType: 'BB', startDate: date(0), endDate: date(200), price: '1500' }],
        }),
      );
      await manager(() => agencies.activateContract(hotelId, contract.id, { expectedUpdatedAt: new Date(contract.updatedAt) }));

      const viaAgency = await book({ source: 'AGENCY', agencyId: agency.id });
      assert.equal(viaAgency.totalPrice, '4500.00');
      assert.equal(viaAgency.promotion, null);
      await rejectsWith(book({ source: 'AGENCY', agencyId: agency.id, couponCode: 'ELLI50' }), 'PROMO_AGENCY');

      const manual = await book({ manualTotal: '2000', priceNote: 'Kurumsal' }, { canOverridePrice: true });
      assert.equal(manual.promotion, null);
      assert.equal(manual.totalPrice, '2000.00');

      const http = await call('POST', '/reservations', DESK, {
        ...reservationInput({ source: 'AGENCY', agencyId: agency.id, couponCode: 'ELLI50' }),
        checkIn: D(70),
        checkOut: D(73),
      });
      assert.equal(http.statusCode, 400);
      assert.match(http.json().fields.couponCode, /Acente satışında kupon/);
    });

    it('kanal koşulu: yalnızca WhatsApp promosyonu resepsiyon satışına düşmez, WhatsApp isteğine düşer; AI asistanının fiyatı kanalı bilir', async () => {
      await livePromotion({ name: 'WhatsApp Özel', discountValue: '12', sources: ['WHATSAPP'] });
      assert.equal((await book()).promotion, null);

      const result = await reservations.createFromChannelRequest({
        hotelId,
        requestId: randomUUID(),
        source: 'WHATSAPP',
        guest: { firstName: 'Can', lastName: 'Demir', phone: '+905321112233', email: null, nationality: 'TR' },
        roomTypeId: types.std.id,
        checkIn: D(70),
        checkOut: D(72),
        adults: 2,
        children: 0,
        boardType: 'BB',
        notes: null,
        status: 'PENDING',
        guestId: null,
        couponCode: null,
      });
      assert.equal(result.outcome, 'CREATED');
      const channelBooking = await reservations.getReservation(hotelId, result.reservationId);
      assert.equal(channelBooking.promotion.name, 'WhatsApp Özel');
      assert.equal(channelBooking.totalPrice, '1760.00');

      const conversation = await db.conversation.create({ data: { hotelId, channel: 'WHATSAPP', externalId: '+905320000000', mode: 'MANUAL' } });
      const quote = await concierge.conciergeService.checkAvailability(hotelId, { checkIn: D(70), checkOut: D(72) }, { conversationId: conversation.id });
      assert.equal(quote.roomTypes.find((type) => type.id === types.std.id).total, '1760.00');
      const deskQuote = await concierge.conciergeService.checkAvailability(hotelId, { checkIn: D(70), checkOut: D(72) });
      assert.equal(deskQuote.roomTypes.find((type) => type.id === types.std.id).total, '2000.00');
    });

    it('promosyon sonradan değişse de açılmış rezervasyonun sözü (kopyası) değişmez', async () => {
      const promo = await livePromotion({ discountValue: '15' });
      const reservation = await book(stay(70, 2));
      const fresh = await db.promotion.findUnique({ where: { id: promo.id } });
      await manager(() => promotions.updatePromotion(hotelId, promo.id, { ...promoInput({ name: promo.name, discountValue: '30' }), expectedUpdatedAt: fresh.updatedAt }));
      const longer = await edit(reservation, { checkOut: date(73) });
      assert.deepEqual(
        longer.nightlyRates.map((night) => night.discount),
        ['150.00', '150.00', '150.00'],
        'uzatılan gece de açılıştaki %15 ile',
      );
      assert.equal((await book(stay(70, 1))).discountTotal, '300.00', 'yeni satış %30');
    });

    it('gelmedi ücreti: "3 kal 2 öde"de bedava ilk gece liste fiyatından; koşulsuz yüzdede indirimli gece', async () => {
      await season(0, 0, '0.9'); // bugünün gecesi 900: en ucuz, bedava
      await livePromotion({ discountType: 'FREE_NIGHTS', discountValue: null, stayNights: 3, payNights: 2 });
      const arriving = await book(stay(0, 3));
      assert.equal(arriving.nightlyRates[0].amount, '0.00');
      assert.equal(arriving.noShowPreview.fee, '900.00', 'gelmeyen misafirde bedava gece şartı tutmaz');
      const noShow = await desk(async () => reservations.markNoShow(hotelId, arriving.id, { expectedUpdatedAt: await version(arriving.id), waiveFee: false }));
      assert.equal(noShow.noShowFee, '900.00');

      const percent = await livePromotion({ name: 'Herkese Yirmi', discountValue: '20' });
      const percentStay = await book({ ...stay(0, 2), roomTypeId: types.dlx.id });
      assert.equal(percentStay.promotion.id, percent.id);
      assert.equal(percentStay.noShowPreview.fee, '1440.00', 'koşulsuz %20: ilk gece 1800 − 360');
    });
  });

  /* ══════════════════ Düzenlemede promosyon ══════════════════ */

  describe('düzenlemede promosyon', () => {
    it('uzatma: koşul tutuyorsa indirim yeni gecelere göre (6 gecede 2 bedava); önizleme yazmaz', async () => {
      await livePromotion({ name: 'Üç Kal İki Öde', discountType: 'FREE_NIGHTS', discountValue: null, stayNights: 3, payNights: 2 });
      const reservation = await book(stay(70, 3));
      assert.equal(reservation.discountTotal, '1000.00');
      const before = await version(reservation.id);

      const plan = await preview(reservation, { checkOut: date(76) });
      assert.equal(plan.discount.outcome, 'KEPT');
      assert.deepEqual([plan.before.total, plan.after.total, plan.after.discountTotal], ['2000.00', '4000.00', '2000.00']);
      assert.equal((await version(reservation.id)).getTime(), before.getTime(), 'önizleme yazmaz');

      const extended = await edit(reservation, { checkOut: date(76) });
      assert.equal(extended.totalPrice, '4000.00');
      assert.equal(extended.nightlyRates.filter((night) => night.amount === '0.00').length, 2);
      const event = await db.eventLog.findFirst({ where: { hotelId, name: 'reservation.updated' }, orderBy: { occurredAt: 'desc' } });
      assert.ok(event.payload.changedFields.includes('discountTotal'));
    });

    it('kısaltma şartı bozarsa indirim kalkar ve kupon hakkı geri açılır; önizleme önceden söyler', async () => {
      const promo = await livePromotion({ requiresCoupon: true, discountValue: '20', minNights: 3 });
      const coupon = await customCoupon(promo, 'UCGECE', 1);
      const reservation = await book({ ...stay(70, 4), couponCode: 'UCGECE' });
      assert.equal(reservation.totalPrice, '3200.00');

      const plan = await preview(reservation, { checkOut: date(72) });
      assert.equal(plan.discount.outcome, 'REVOKED');
      assert.match(plan.discount.message, /şartı artık tutmuyor .*En az 3 gece.*indirim kalkar/);
      assert.equal(plan.after.total, '2000.00');
      assert.equal(plan.after.promotion, null);

      const shortened = await edit(reservation, { checkOut: date(72) });
      assert.equal(shortened.totalPrice, '2000.00');
      assert.equal(shortened.promotion, null);
      assert.equal(await used(coupon.id), 0, 'kupon hakkı geri açıldı');
      const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'Reservation', entityId: reservation.id, action: 'UPDATE' }, orderBy: { createdAt: 'desc' } });
      assert.deepEqual([audit.before.couponId, audit.after.couponId, audit.after.discountTotal], [coupon.id, null, '0.00']);
    });

    it('kupon ekleme: daha avantajlıysa yerine geçer, değilse reddedilir; indirimi kaldır', async () => {
      await livePromotion({ name: 'Yüzde On', discountValue: '10' });
      const better = await livePromotion({ name: 'Kupon Yirmi', requiresCoupon: true, discountValue: '20' });
      const worse = await livePromotion({ name: 'Kupon Beş', requiresCoupon: true, discountValue: '5' });
      await customCoupon(better, 'YIRMI', 1);
      await customCoupon(worse, 'BES5', 1);
      const reservation = await book();
      assert.equal(reservation.promotion.name, 'Yüzde On');

      await rejectsWith(edit(reservation, { discount: { mode: 'COUPON', code: 'BES5' } }), 'COUPON_NOT_BETTER', /"Yüzde On" promosyonu daha avantajlı/);
      const plan = await preview(reservation, { discount: { mode: 'COUPON', code: 'YIRMI' } });
      assert.equal(plan.discount.outcome, 'REPLACED');
      const replaced = await edit(reservation, { discount: { mode: 'COUPON', code: 'YIRMI' } });
      assert.deepEqual([replaced.promotion.couponCode, replaced.totalPrice], ['YIRMI', '2400.00']);

      const removed = await edit(replaced, { discount: { mode: 'REMOVE' } });
      assert.deepEqual([removed.promotion, removed.totalPrice, removed.discountTotal], [null, '3000.00', '0.00']);
    });

    it('acente atanınca ya da elle fiyat girilince promosyon kalkar', async () => {
      await livePromotion({ discountValue: '10' });
      const agency = await manager(() =>
        agencies.createAgency(hotelId, { code: 'ROTA', name: 'Rota Tur', contactName: null, phone: null, email: null, address: null, taxOffice: null, taxNumber: null, commissionPct: '10', paymentTermDays: 0, notes: null }),
      );
      let contract = await manager(() => agencies.createContract(hotelId, agency.id, { name: 'Yıl', startDate: date(0), endDate: date(200), notes: null }));
      contract = await manager(() =>
        agencies.saveContractRates(hotelId, contract.id, {
          expectedUpdatedAt: new Date(contract.updatedAt),
          rates: [{ roomTypeId: types.std.id, boardType: 'BB', startDate: date(0), endDate: date(200), price: '1500' }],
        }),
      );
      await manager(() => agencies.activateContract(hotelId, contract.id, { expectedUpdatedAt: new Date(contract.updatedAt) }));

      const reservation = await book();
      const plan = await preview(reservation, { agencyId: agency.id });
      assert.equal(plan.discount.outcome, 'REMOVED');
      const viaAgency = await edit(reservation, { agencyId: agency.id });
      assert.deepEqual([viaAgency.promotion, viaAgency.totalPrice, viaAgency.source], [null, '4500.00', 'AGENCY']);

      const other = await book();
      const manual = await edit(other, { price: { mode: 'MANUAL', total: '2500', note: 'Kurumsal' } }, { canOverridePrice: true });
      assert.deepEqual([manual.promotion, manual.totalPrice, manual.priceMode], [null, '2500.00', 'MANUAL']);
    });

    it('erken çıkış: kalan gecelerle şart bozulursa indirim kalkar (geçmiş gece dahil); ücretler liste fiyatından', async () => {
      // "4 kal 3 öde": en ucuz gece (ilk gece, 900) bedava — misafir 2 gece kalıp ayrılıyor.
      const promo = await livePromotion({ discountType: 'FREE_NIGHTS', discountValue: null, stayNights: 4, payNights: 3 });
      const terms = { ...rules.toTerms(await db.promotion.findUnique({ where: { id: promo.id } })), bookedOn: D(-30) };
      const guest = await db.guest.create({ data: { hotelId, firstName: 'Mehmet', lastName: 'Kaya', idType: 'NATIONAL_ID', idNumber: '10000000146', nationality: 'TR' } });
      const nights = [
        [-2, '0.00', '900.00'],
        [-1, '1000.00', '0.00'],
        [0, '1000.00', '0.00'],
        [1, '1000.00', '0.00'],
      ];
      const seeded = await db.reservation.create({
        data: {
          hotelId,
          guestId: guest.id,
          roomTypeId: types.std.id,
          roomId: rooms['101'].id,
          checkIn: date(-2),
          checkOut: date(2),
          status: 'CHECKED_IN',
          checkedInAt: at('15:00', -2),
          checkedInBy: DESK,
          confirmedAt: new Date(),
          source: 'PHONE',
          totalPrice: '3000.00',
          discountTotal: '900.00',
          promotionId: promo.id,
          promotionTerms: terms,
          confirmationCode: `H${randomUUID().slice(0, 7).toUpperCase()}`,
        },
      });
      await db.reservationNight.createMany({
        data: nights.map(([offset, amount, discount]) => ({ hotelId, reservationId: seeded.id, date: date(offset), amount, discount })),
      });

      const checkout = await frontDesk.getCheckOutPreview(hotelId, seeded.id, { now: at('11:00') });
      assert.deepEqual(checkout.departure.releasedNights, [D(0), D(1)]);
      assert.equal(checkout.departure.totalPrice, '1900.00', 'bedava gece kalan gecelerde: şart bozulunca 900 + 1000');
      assert.equal(checkout.departure.promotion.kept, false);
      assert.match(checkout.departure.promotion.message, /şartı kalan gecelerle tutmuyor/);
      assert.equal(checkout.due, '1900.00');

      const folio = await db.folio.create({ data: { hotelId, reservationId: seeded.id, guestId: guest.id } });
      await db.payment.create({
        data: { hotelId, folioId: folio.id, reservationId: seeded.id, method: 'CARD', amount: '1900.00', folioAmount: '1900.00', businessDate: date(0), postedAt: new Date(), receivedBy: 'test' },
      });
      await as(DESK, async () =>
        frontDesk.checkOut(
          hotelId,
          seeded.id,
          contracts.checkOutSchema.parse({ expectedUpdatedAt: (await db.reservation.findUnique({ where: { id: seeded.id } })).updatedAt, confirmEarlyDeparture: true }),
          { now: at('11:00') },
        ),
      );
      const row = await db.reservation.findUnique({ where: { id: seeded.id }, include: { nights: { orderBy: { date: 'asc' } } } });
      assert.deepEqual(
        [row.totalPrice.toString(), row.discountTotal.toString(), row.promotionId, row.promotionTerms],
        ['1900', '0', null, null],
      );
      assert.deepEqual(row.nights.map((night) => [core.toIsoDay(night.date), night.amount.toString(), night.discount.toString()]), [
        [D(-2), '900', '0'],
        [D(-1), '1000', '0'],
      ]);

      // Geç çıkış ücreti (gecenin %50'si) bedava son gecenin liste fiyatından.
      const lastFree = await db.reservation.create({
        data: {
          hotelId,
          guestId: guest.id,
          roomTypeId: types.std.id,
          roomId: rooms['102'].id,
          checkIn: date(-1),
          checkOut: date(0),
          status: 'CHECKED_IN',
          checkedInAt: at('15:00', -1),
          checkedInBy: DESK,
          confirmedAt: new Date(),
          totalPrice: '0.00',
          discountTotal: '1000.00',
          promotionId: promo.id,
          promotionTerms: terms,
          confirmationCode: `H${randomUUID().slice(0, 7).toUpperCase()}`,
        },
      });
      await db.reservationNight.create({ data: { hotelId, reservationId: lastFree.id, date: date(-1), amount: '0.00', discount: '1000.00' } });
      const late = await frontDesk.getCheckOutPreview(hotelId, lastFree.id, { now: at('13:30') });
      assert.equal(late.lateCheckOut.fee, '500.00');
    });
  });

  /* ══════════════════ Önizleme, rapor, izinler ══════════════════ */

  describe('önizleme, rapor ve izinler', () => {
    it('fiyat önizlemesi: tip kartında indirim ve liste fiyatı; kuponun durumu', async () => {
      await livePromotion({ name: 'Yüzde On', discountValue: '10' });
      const big = await livePromotion({ name: 'Kupon Yirmi', requiresCoupon: true, discountValue: '20', roomTypeIds: [types.std.id] });
      const small = await livePromotion({ name: 'Kupon Beş', requiresCoupon: true, discountValue: '5' });
      await customCoupon(big, 'YIRMI', 2);
      await customCoupon(small, 'BES5');
      const quote = (overrides) =>
        reservations.quoteReservation(hotelId, { checkIn: date(70), checkOut: date(73), lines: [], ...overrides });

      const plain = await quote({ lines: [{ roomTypeId: types.std.id, quantity: 1, adults: 2, children: 0 }] });
      const std = plain.roomTypes.find((type) => type.id === types.std.id);
      assert.deepEqual([std.listTotal, std.total, std.discount.promotion.name, std.discount.amount], ['3000.00', '2700.00', 'Yüzde On', '300.00']);
      assert.equal(plain.total, '2700.00');
      assert.equal(plain.coupon, null);

      const applied = await quote({ couponCode: 'YIRMI', lines: [{ roomTypeId: types.std.id, quantity: 2, adults: 2, children: 0 }] });
      assert.deepEqual([applied.coupon.status, applied.coupon.remainingUses, applied.total], ['APPLIED', 2, '4800.00']);
      const tooMany = await quote({ couponCode: 'YIRMI', lines: [{ roomTypeId: types.std.id, quantity: 3, adults: 2, children: 0 }] });
      assert.equal(tooMany.coupon.status, 'INVALID');
      assert.match(tooMany.coupon.issue.message, /2 kullanım hakkı kaldı; 3 oda/);
      const otherType = await quote({ couponCode: 'YIRMI', lines: [{ roomTypeId: types.dlx.id, quantity: 1, adults: 2, children: 0 }] });
      assert.deepEqual([otherType.coupon.status, otherType.coupon.issue.code], ['NOT_APPLICABLE', 'PROMO_ROOM_TYPE']);
      const notBetter = await quote({ couponCode: 'BES5', lines: [{ roomTypeId: types.std.id, quantity: 1, adults: 2, children: 0 }] });
      assert.equal(notBetter.coupon.status, 'NOT_BETTER');
      const missing = await quote({ couponCode: 'HICYOK' });
      assert.deepEqual([missing.coupon.status, missing.coupon.issue.code], ['INVALID', 'COUPON_NOT_FOUND']);
    });

    it('kullanım raporu: satış ve giriş gününe göre; iptal ayrı; toplamlar; promosyonun rezervasyonları kupona göre süzülür', async () => {
      const auto = await livePromotion({ name: 'Yüzde On', discountValue: '10' });
      const couponPromo = await livePromotion({ name: 'Kupon Yirmi', requiresCoupon: true, discountValue: '20' });
      const coupon = await customCoupon(couponPromo, 'YIRMI');
      await book(stay(70, 3));
      const cancelled = await book(stay(80, 2));
      await cancel(cancelled);
      await book({ ...stay(90, 2), couponCode: 'YIRMI' });

      const booked = await promotions.getPromotionReport(hotelId, { from: date(0), to: date(0), basis: 'BOOKED', page: 1, pageSize: 20 });
      assert.equal(booked.meta.total, 2);
      const byName = Object.fromEntries(booked.items.map((row) => [row.promotion.name, row]));
      assert.deepEqual(
        [byName['Yüzde On'].reservations, byName['Yüzde On'].cancelled, byName['Yüzde On'].nights, byName['Yüzde On'].discountTotal, byName['Yüzde On'].netTotal, byName['Yüzde On'].listTotal],
        [1, 1, 3, '300.00', '2700.00', '3000.00'],
      );
      assert.deepEqual([byName['Kupon Yirmi'].reservations, byName['Kupon Yirmi'].coupons, byName['Kupon Yirmi'].discountTotal], [1, 1, '400.00']);
      assert.deepEqual([booked.totals.reservations, booked.totals.discountTotal, booked.totals.netTotal], [2, '700.00', '4300.00']);
      assert.equal(booked.items[0].promotion.name, 'Kupon Yirmi', 'en çok indirim veren üstte');

      const byStay = await promotions.getPromotionReport(hotelId, { from: date(69), to: date(75), basis: 'STAY', page: 1, pageSize: 20 });
      assert.deepEqual(byStay.items.map((row) => row.promotion.name), ['Yüzde On']);
      const empty = await promotions.getPromotionReport(hotelId, { from: date(-10), to: date(-1), basis: 'BOOKED', page: 1, pageSize: 20 });
      assert.deepEqual([empty.meta.total, empty.totals.reservations], [0, 0]);

      const list = await promotions.listPromotionReservations(hotelId, couponPromo.id, { from: date(0), to: date(0), basis: 'BOOKED', page: 1, pageSize: 20, couponId: coupon.id });
      assert.deepEqual(list.items.map((row) => [row.coupon.code, row.discountTotal, row.listTotal]), [['YIRMI', '400.00', '2000.00']]);
      const autoList = await promotions.listPromotionReservations(hotelId, auto.id, { from: date(0), to: date(0), basis: 'BOOKED', page: 1, pageSize: 20, status: 'CANCELLED' });
      assert.equal(autoList.items.length, 1);
      const listed = await promotions.listPromotions(hotelId, { page: 1, pageSize: 20 });
      const autoRow = listed.items.find((row) => row.id === auto.id);
      assert.deepEqual([autoRow.usage.reservations, autoRow.usage.discountTotal], [1, '300.00'], 'listede iptal sayılmaz');
    });

    it('izinler: resepsiyon promosyonları göremez ama kuponla rezervasyon açar; muhasebe görür, düzenleyemez', async () => {
      const promo = await livePromotion({ requiresCoupon: true, discountValue: '10' });
      await customCoupon(promo, 'IZIN10');
      assert.equal((await call('GET', '/promotions', DESK)).statusCode, 403);
      assert.equal((await call('GET', '/promotions', ACCOUNTING)).statusCode, 200);
      assert.equal((await call('GET', `/promotions/report?from=${D(0)}&to=${D(0)}`, ACCOUNTING)).statusCode, 200);
      assert.equal((await call('POST', `/promotions/${promo.id}/coupons`, ACCOUNTING, { mode: 'GENERATE', count: 2, maxUses: 1 })).statusCode, 403);
      const created = await call('POST', '/promotions', MANAGER, { name: 'HTTP Promosyonu', discountType: 'AMOUNT', discountValue: '250,50', sources: ['UI'] });
      assert.equal(created.statusCode, 201, created.body);
      assert.equal(created.json().data.discountValue, '250.50');
      const invalid = await call('POST', '/promotions', MANAGER, { name: 'Bozuk', discountType: 'FREE_NIGHTS', stayNights: 3, payNights: 3, sources: ['UI'] });
      assert.equal(invalid.statusCode, 400);
      assert.match(invalid.json().fields.payNights, /Ödenen gece/);

      const booking = await call('POST', '/reservations', DESK, { ...reservationInput({ couponCode: 'izin10' }), checkIn: D(70), checkOut: D(73) });
      assert.equal(booking.statusCode, 201, booking.body);
      assert.equal(booking.json().data.reservation.promotion.couponCode, 'IZIN10');
    });
  });
});
