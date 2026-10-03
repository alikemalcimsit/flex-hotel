import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Ödeme alma (modül 17) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan, yalnızca veritabanıyla doğrulanabilen davranışlar: ödemenin bakiyeyi
 * folyo kilidi altında düşürmesi ve çift gönderimde tek satır, dövizin günün
 * kuruyla (ve kur değişince yazılmaması), eşik üstü ödemenin onaylanana kadar
 * bakiyeye girmemesi (dört göz), iadenin sınırı ve onayı, ödeme iptalinin
 * iptal kaydıyla işlenmesi, bekleyen ödemenin folyo kapanışını ve çıkışı
 * etkilemesi, ön ödemenin folyo açması, giriş teminatının ödeme olması ve
 * giriş geri alınınca düşmesi, ödemeyle sıfırlanan bitmiş konaklamanın folyosunun
 * kapanması, kasa toplamları ve hareketleri, eşzamanlı ödemelerde tutarlılık,
 * otel sınırı.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const DESK = 'resepsiyon@test.local';
const DESK2 = 'gece@test.local';
const MANAGER = 'mudur@test.local';
const TC = '10000000146';

describe('ödeme alma (entegrasyon)', { skip }, () => {
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let payments;
  /** @type {any} */ let folios;
  /** @type {any} */ let approvals;
  /** @type {any} */ let reservations;
  /** @type {any} */ let frontDesk;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  /** @type {Record<string, any>} */ let types;
  /** @type {Record<string, any>} */ let room;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    payments = await import('./service.js');
    folios = await import('../folios/service.js');
    approvals = await import('../approvals/service.js');
    reservations = await import('../reservations/service.js');
    frontDesk = await import('../front-desk/service.js');
    cache = await import('../../lib/cache.js');
    // Onay kararı → ödeme işlenir / reddedilir (servis dinleyicisi; aktör kaydı gerekmez).
    (await import('./subscribers.js')).registerPaymentSubscribers();
  });

  after(async () => {
    (await import('./subscribers.js')).stopPaymentSubscribers();
    await db?.$disconnect();
  });

  const as = (actor, fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
  const desk = (fn) => as(DESK, fn);
  const manager = (fn) => as(MANAGER, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const day = (offset) => core.toIsoDay(core.addDays(today(), offset));
  const at = (time, offset = 0) => contracts.zonedWallTimeToUtc(`${day(offset)}T${time}`, ZONE);
  const eventsNamed = (name) => db.eventLog.findMany({ where: { hotelId, name }, orderBy: { occurredAt: 'asc' }, select: { payload: true } });
  const money = (value) => core.toMoneyString(String(value));

  async function rejectsWith(promise, code, message) {
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, code, error.message);
      if (message) assert.match(error.message, message);
      return true;
    });
  }

  beforeEach(async () => {
    await resetDatabase(db);
    reservations.clearReservationCache();
    frontDesk.clearFrontDeskCache();
    cache.cache.invalidatePrefix('settings:');
    const hotel = await db.hotel.create({
      data: {
        name: 'Deniz Otel',
        code: `P${randomUUID().slice(0, 5).toUpperCase()}`,
        timezone: ZONE,
        checkInTime: '14:00',
        checkOutTime: '12:00',
        largePaymentThreshold: '50000',
      },
    });
    hotelId = hotel.id;
    await db.user.createMany({
      data: [
        { hotelId, email: DESK, name: 'Resepsiyon', passwordHash: 'x', role: 'FRONT_DESK' },
        { hotelId, email: DESK2, name: 'Gece', passwordHash: 'x', role: 'FRONT_DESK' },
        { hotelId, email: MANAGER, name: 'Müdür', passwordHash: 'x', role: 'MANAGER' },
      ],
    });
    types = {
      std: await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 3, capacityChildren: 1 } }),
    };
    room = {};
    for (const number of ['101', '102']) {
      room[number] = await db.room.create({ data: { hotelId, number, roomTypeId: types.std.id } });
    }
  });

  /** İçerideki konaklama; folyosu açık ve `charges` tutarında harcama işlenmiş. */
  async function seedStay({ status = 'CHECKED_IN', charges = '3000.00', roomNumber = '101' } = {}) {
    const guest = await db.guest.create({ data: { hotelId, firstName: 'Mehmet', lastName: 'Kaya', idType: 'NATIONAL_ID', idNumber: TC, nationality: 'TR' } });
    const stay = await db.reservation.create({
      data: {
        hotelId,
        guestId: guest.id,
        roomTypeId: types.std.id,
        roomId: room[roomNumber].id,
        checkIn: new Date(day(-1)),
        checkOut: new Date(day(1)),
        status,
        checkedInAt: status === 'CONFIRMED' ? null : at('15:00', -1),
        checkedInBy: status === 'CONFIRMED' ? null : DESK,
        checkedOutAt: status === 'CHECKED_OUT' ? at('11:00') : null,
        checkedOutBy: status === 'CHECKED_OUT' ? DESK : null,
        confirmedAt: new Date(),
        totalPrice: '2000.00',
        confirmationCode: `H${randomUUID().slice(0, 7).toUpperCase()}`,
      },
    });
    if (status === 'CONFIRMED') return { stay, folio: null };
    await desk(() => folios.openFolio(hotelId, stay.id, {}));
    const folio = await db.folio.findFirst({ where: { reservationId: stay.id } });
    if (charges) {
      await desk(() =>
        folios.postCharge(
          hotelId,
          folio.id,
          contracts.postChargeSchema.parse({ requestId: randomUUID(), type: 'OTHER', description: 'Hizmet', amount: charges, quantity: 1 }),
        ),
      );
    }
    return { stay, folio };
  }

  const balanceOf = async (folioId) => money((await db.folio.findUnique({ where: { id: folioId } })).balance);

  const receive = (folioId, body, actor = DESK) =>
    as(actor, () => payments.receivePayment(hotelId, folioId, contracts.receivePaymentSchema.parse({ requestId: randomUUID(), method: 'CASH', ...body })));

  const refund = (folioId, body, actor = DESK) =>
    as(actor, () =>
      payments.requestRefund(hotelId, folioId, contracts.refundRequestSchema.parse({ requestId: randomUUID(), method: 'CASH', reason: 'Teminat iadesi', ...body })),
    );

  const setRates = (rates) => manager(() => payments.setTodayRates(hotelId, contracts.exchangeRatesInputSchema.parse({ rates })));

  /** Denormalize toplamlar kalem ve işlenmiş ödemelerle tutarlı mı. */
  async function assertTotalsConsistent(folioId) {
    const folio = await db.folio.findUnique({ where: { id: folioId } });
    const items = await db.folioItem.findMany({ where: { folioId } });
    const posted = await db.payment.findMany({ where: { folioId, status: 'POSTED' } });
    const charges = items.reduce((acc, item) => acc.plus(String(item.total)), core.toDecimal(0));
    const paid = posted.reduce((acc, row) => acc.plus(String(row.folioAmount)), core.toDecimal(0));
    assert.equal(money(folio.paymentsTotal), core.toMoneyString(paid), 'ödenen = Σ işlenmiş ödeme');
    assert.equal(money(folio.balance), core.toMoneyString(charges.minus(paid)), 'bakiye = borç − ödenen');
  }

  describe('tahsilat', () => {
    it('nakit ödeme bakiyeyi düşürür, iz bırakır; aynı istek ikinci kez gelirse tek satır', async () => {
      const { stay, folio } = await seedStay();
      const body = contracts.receivePaymentSchema.parse({ requestId: randomUUID(), method: 'CASH', amount: '1250,50', note: 'Ara ödeme' });
      const first = await desk(() => payments.receivePayment(hotelId, folio.id, body));
      const again = await desk(() => payments.receivePayment(hotelId, folio.id, body));

      assert.equal(first.created, true);
      assert.equal(again.created, false);
      assert.equal(again.payment.id, first.payment.id);
      assert.equal(first.payment.status, 'POSTED');
      assert.equal(first.payment.source, 'DESK');
      assert.equal(first.payment.businessDate, day(0));
      assert.equal(await db.payment.count({ where: { folioId: folio.id } }), 1);
      assert.equal(await balanceOf(folio.id), '1749.50');
      await assertTotalsConsistent(folio.id);

      const [event] = await eventsNamed('payment.received');
      assert.equal(event.payload.reservationId, stay.id);
      assert.equal(event.payload.amount, '1250.50');
      assert.equal(event.payload.stayEnded, false);
      const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'Payment', entityId: first.payment.id } });
      assert.equal(audit.action, 'CREATE');
      assert.equal(audit.actor, DESK);
    });

    it('kart ödemesi referanssız alınmaz; kart dövizle çekilmez; kapalı folyoya ödeme alınmaz', async () => {
      const { folio } = await seedStay();
      assert.equal(contracts.receivePaymentSchema.safeParse({ requestId: randomUUID(), method: 'CARD', amount: '100' }).success, false);
      await rejectsWith(receive(folio.id, { method: 'CARD', amount: '100', currency: 'EUR', reference: 'S-1' }), 'VALIDATION', /yalnızca nakit ya da havaleyle/);

      const checkedOut = await seedStay({ status: 'CHECKED_OUT', charges: null, roomNumber: '102' });
      await desk(() => folios.closeFolio(hotelId, checkedOut.folio.id));
      await rejectsWith(receive(checkedOut.folio.id, { amount: '100' }), 'FOLIO_NOT_OPEN');
    });

    it('döviz: kur yoksa alınmaz; kur değiştiyse yazılmaz; günün kuruyla kuruşa yuvarlanarak işlenir', async () => {
      const { folio } = await seedStay();
      await rejectsWith(receive(folio.id, { amount: '100', currency: 'EUR', expectedRate: '38' }), 'RATE_UNAVAILABLE', /kur girilmemiş/);

      const rates = await setRates([{ currency: 'EUR', rate: '38,123456' }]);
      assert.deepEqual(rates.rates.map((row) => [row.currency, row.rate, row.today]), [['EUR', '38.123456', true]]);
      await rejectsWith(receive(folio.id, { amount: '33.33', currency: 'EUR', expectedRate: '38' }), 'RATE_CHANGED', /38,123456/);
      await rejectsWith(receive(folio.id, { amount: '33.33', currency: 'EUR' }), 'RATE_CHANGED');

      const ok = await receive(folio.id, { amount: '33.33', currency: 'EUR', expectedRate: '38.123456' });
      // 33.33 × 38.123456 = 1270.6547... → 1270.65
      assert.equal(ok.payment.folioAmount, '1270.65');
      assert.equal(ok.payment.exchangeRate, '38.123456');
      assert.equal(await balanceOf(folio.id), '1729.35');

      // Kur sonradan değişse de alınmış ödeme değişmez.
      await setRates([{ currency: 'EUR', rate: '40' }]);
      assert.equal(money((await db.payment.findUnique({ where: { id: ok.payment.id } })).folioAmount), '1270.65');
      await assertTotalsConsistent(folio.id);
      assert.equal((await eventsNamed('exchange_rate.updated')).length, 2);
      await rejectsWith(setRates([{ currency: 'TRY', rate: '1' }]), 'VALIDATION', /kendi para birimi/);
    });
  });

  describe('büyük ödeme (eşik)', () => {
    it('eşik üstü ödeme onaylanana kadar bakiyeye girmez; isteyen onaylayamaz; müdür onaylayınca işlenir', async () => {
      const { folio } = await seedStay({ charges: '80000.00' });
      const result = await receive(folio.id, { amount: '60000' });
      assert.equal(result.payment.status, 'PENDING');
      assert.equal(await balanceOf(folio.id), '80000.00', 'onay bekleyen ödeme bakiyeye girmedi');

      const approval = await db.approval.findUnique({ where: { id: result.payment.approvalId } });
      assert.equal(approval.type, 'LARGE_PAYMENT');
      assert.equal(approval.requestedBy, DESK);
      assert.equal(money(approval.amount), '60000.00');
      assert.equal(approval.data['Onaylanınca bakiye'], '20.000,00 TRY');

      // Bekleyen ödeme varken folyo kapanmaz (bakiye sıfır olsa da: kural kontrolü).
      await rejectsWith(desk(() => approvals.decideApproval(hotelId, approval.id, 'GRANTED')), 'SELF_DECISION');
      await manager(() => approvals.decideApproval(hotelId, approval.id, 'GRANTED'));
      await new Promise((resolve) => setImmediate(resolve));

      const posted = await db.payment.findUnique({ where: { id: result.payment.id } });
      assert.equal(posted.status, 'POSTED');
      assert.ok(posted.postedAt);
      assert.equal(await balanceOf(folio.id), '20000.00');
      const [event] = await eventsNamed('payment.received');
      assert.equal(event.payload.approvalId, approval.id);
      const alert = await db.staffAlert.findFirst({ where: { hotelId, kind: 'APPROVAL_DECIDED', entityId: approval.id } });
      assert.match(alert.title, /Büyük ödeme onaylandı/);
      await assertTotalsConsistent(folio.id);
    });

    it('reddedilen büyük ödeme hiç işlenmez; eşik 0 ise onay yok', async () => {
      const { folio } = await seedStay({ charges: '80000.00' });
      const result = await receive(folio.id, { amount: '50000' });
      await manager(() => approvals.decideApproval(hotelId, result.payment.approvalId, 'DENIED', { note: 'Tutar yanlış' }));
      await new Promise((resolve) => setImmediate(resolve));
      const declined = await db.payment.findUnique({ where: { id: result.payment.id } });
      assert.equal(declined.status, 'DECLINED');
      assert.ok(declined.declinedAt);
      assert.equal(await balanceOf(folio.id), '80000.00');
      assert.equal((await eventsNamed('payment.declined'))[0].payload.outcome, 'DENIED');

      await db.hotel.update({ where: { id: hotelId }, data: { largePaymentThreshold: 0 } });
      cache.cache.invalidatePrefix('settings:');
      assert.equal((await receive(folio.id, { amount: '70000' })).payment.status, 'POSTED');
    });

    it('çıkışta onay bekleyen ödeme borcu kapatmaz (önizlemede ayrıca görünür)', async () => {
      const { stay, folio } = await seedStay({ charges: '60000.00' });
      await receive(folio.id, { amount: '60000' });
      const preview = await frontDesk.getCheckOutPreview(hotelId, stay.id, { now: at('11:00', 1) });
      assert.equal(preview.pendingPayments, '60000.00');
      assert.ok(Number(preview.due) >= 60000, 'bekleyen ödeme ödenecekten düşmedi');
    });
  });

  describe('iade ve ödeme iptali', () => {
    it('iade her zaman onaylı; alınmamış para iade edilmez; iki bekleyen iade aynı parayı iki kez veremez', async () => {
      const { folio } = await seedStay({ charges: '1000.00' });
      await rejectsWith(refund(folio.id, { amount: '100' }), 'VALIDATION', /iade edilecek ödeme yok/);
      await receive(folio.id, { amount: '1500' });
      assert.equal(await balanceOf(folio.id), '-500.00');

      const first = await refund(folio.id, { amount: '500' });
      assert.equal(first.payment.status, 'PENDING');
      assert.equal(first.payment.kind, 'REFUND');
      assert.equal(first.payment.folioAmount, '-500.00');
      await rejectsWith(refund(folio.id, { amount: '1001' }), 'VALIDATION', /en fazla 1\.000,00 TRY/);

      await rejectsWith(desk(() => approvals.decideApproval(hotelId, first.payment.approvalId, 'GRANTED')), 'SELF_DECISION');
      await manager(() => approvals.decideApproval(hotelId, first.payment.approvalId, 'GRANTED'));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(await balanceOf(folio.id), '0.00');
      const [event] = await eventsNamed('payment.refunded');
      assert.equal(event.payload.amount, '-500.00');
      await assertTotalsConsistent(folio.id);
    });

    it('ödeme iptali onaya gider, beklerken folyo kapanmaz; onaylanınca iptal kaydı işlenir, ikinci kez iptal edilmez', async () => {
      const { stay, folio } = await seedStay({ charges: '1000.00', status: 'CHECKED_OUT' });
      const wrong = await receive(folio.id, { amount: '1000' });
      assert.equal(await balanceOf(folio.id), '0.00');

      const { approvalId } = await desk(() => payments.requestPaymentVoid(hotelId, wrong.payment.id, { reason: 'Yanlış folyoya girildi' }));
      await rejectsWith(desk(() => folios.closeFolio(hotelId, folio.id)), 'FOLIO_RULE', /onay bekleyen iptal/);
      await rejectsWith(desk(() => payments.requestPaymentVoid(hotelId, wrong.payment.id, { reason: 'tekrar' })), 'PAYMENT_RULE', /zaten bekliyor/);

      await manager(() => approvals.decideApproval(hotelId, approvalId, 'GRANTED'));
      await new Promise((resolve) => setImmediate(resolve));
      const original = await db.payment.findUnique({ where: { id: wrong.payment.id }, include: { reversal: true } });
      assert.ok(original.voidedAt);
      assert.equal(original.voidedBy, MANAGER);
      assert.equal(original.reversal.kind, 'REVERSAL');
      assert.equal(money(original.reversal.folioAmount), '-1000.00');
      assert.equal(original.reversal.receivedBy, DESK, 'kasa etkisi parayı alanın kasasında');
      assert.equal(await balanceOf(folio.id), '1000.00');
      const [voided] = await eventsNamed('payment.voided');
      assert.equal(voided.payload.stayEnded, true);
      await rejectsWith(desk(() => payments.requestPaymentVoid(hotelId, wrong.payment.id, { reason: 'tekrar' })), 'PAYMENT_RULE', /zaten iptal/);
      await rejectsWith(desk(() => payments.requestPaymentVoid(hotelId, original.reversal.id, { reason: 'tekrar' })), 'PAYMENT_RULE', /İptal kaydı/);
      await assertTotalsConsistent(folio.id);
      assert.equal(stay.status, 'CHECKED_OUT');
    });

    it('iade edilmiş paranın ödemesi iptal edilemez (iade karşılıksız kalırdı)', async () => {
      const { folio } = await seedStay({ charges: '400.00' });
      const paid = await receive(folio.id, { amount: '1000' });
      const back = await refund(folio.id, { amount: '600' });
      await manager(() => approvals.decideApproval(hotelId, back.payment.approvalId, 'GRANTED'));
      await new Promise((resolve) => setImmediate(resolve));
      await rejectsWith(desk(() => payments.requestPaymentVoid(hotelId, paid.payment.id, { reason: 'Yanlış tutar' })), 'PAYMENT_RULE', /iade yapılmış/);
    });
  });

  describe('ön ödeme ve giriş teminatı', () => {
    /** Rezervasyon (modül 4 servisiyle). */
    async function book() {
      const result = await desk(() =>
        reservations.createReservation(hotelId, {
          guestId: null,
          guest: { firstName: 'Ayşe', lastName: 'Yılmaz', phone: `+90532${String(Math.random()).slice(2, 9)}`, email: null, nationality: 'TR' },
          forceNewGuest: true,
          roomTypeId: types.std.id,
          adults: 2,
          children: 0,
          boardType: 'BB',
          checkIn: new Date(day(0)),
          checkOut: new Date(day(2)),
          status: 'CONFIRMED',
          source: 'PHONE',
          notes: null,
          requestId: randomUUID(),
          waitlistId: null,
          roomId: room['101'].id,
          manualTotal: null,
          priceNote: null,
        }),
      );
      return result.reservation;
    }

    const version = async (id) => (await db.reservation.findUnique({ where: { id } })).updatedAt;
    const checkIn = async (reservationId, deposit, time = '16:00') =>
      desk(async () =>
        frontDesk.checkIn(
          hotelId,
          reservationId,
          contracts.checkInSchema.parse({ expectedUpdatedAt: await version(reservationId), guest: { idType: 'NATIONAL_ID', idNumber: TC, nationality: 'TR' }, deposit }),
          { now: at(time) },
        ),
      );

    it('gelmeden önce alınan ödeme folyo açar ve ön ödemedir; girişin geri alınmasını engellemez', async () => {
      const reservation = await book();
      const advance = await desk(() =>
        payments.receiveStayPayment(hotelId, reservation.id, contracts.stayPaymentSchema.parse({ requestId: randomUUID(), method: 'TRANSFER', amount: '1000', reference: 'EFT-77' })),
      );
      assert.equal(advance.payment.source, 'ADVANCE');
      const folio = await db.folio.findFirst({ where: { reservationId: reservation.id } });
      assert.equal(money(folio.balance), '-1000.00');

      await checkIn(reservation.id, { method: 'NONE' });
      await desk(async () =>
        frontDesk.revertCheckIn(hotelId, reservation.id, { expectedUpdatedAt: await version(reservation.id), reason: 'Yanlış misafir' }, { now: at('16:30') }),
      );
      assert.equal((await db.reservation.findUnique({ where: { id: reservation.id } })).status, 'CONFIRMED');
    });

    it('girişte nakit teminat ödeme olur (bir kez); giriş geri alınınca iptal kaydıyla düşer; yeniden girişte yeni teminat', async () => {
      const reservation = await book();
      await checkIn(reservation.id, { method: 'CASH', amount: '500' });
      const first = await as('billing-worker', () => payments.recordCheckInDeposit(hotelId, reservation.id));
      assert.equal(first.status, 'POSTED');
      assert.equal((await as('billing-worker', () => payments.recordCheckInDeposit(hotelId, reservation.id))).skipped, 'Teminat zaten işlenmiş');
      const deposit = await db.payment.findFirst({ where: { reservationId: reservation.id, source: 'CHECK_IN_DEPOSIT' } });
      assert.equal(deposit.receivedBy, DESK, 'kasada parayı alan girişi yapan');
      const stayView = await folios.getStayFolios(hotelId, reservation.id);
      assert.equal(stayView.payments.deposit.recorded, 'POSTED');

      // Teminat girişin kendi işi: geri almayı engellemez, geri alınınca düşer.
      const revertedAt = new Date();
      await desk(async () =>
        frontDesk.revertCheckIn(hotelId, reservation.id, { expectedUpdatedAt: await version(reservation.id), reason: 'Yanlış oda' }, { now: at('16:30') }),
      );
      const reverted = await as('billing-worker', () =>
        payments.reverseCheckInDeposits(hotelId, reservation.id, { reason: 'Yanlış oda', occurredAt: new Date(revertedAt.getTime() + 1000) }),
      );
      assert.deepEqual(reverted, { reversed: 1, withdrawn: 0 });
      const folio = await db.folio.findFirst({ where: { reservationId: reservation.id } });
      assert.equal(money(folio.paymentsTotal), '0.00');

      await checkIn(reservation.id, { method: 'CASH', amount: '700' }, '16:45');
      assert.equal((await as('billing-worker', () => payments.recordCheckInDeposit(hotelId, reservation.id))).status, 'POSTED');
      assert.equal(money((await db.folio.findUnique({ where: { id: folio.id } })).paymentsTotal), '700.00');
      await assertTotalsConsistent(folio.id);
    });

    it('onay bekleyen teminatın isteği giriş geri alınınca geri çekilir; resepsiyonda alınan ödeme geri almayı engeller', async () => {
      const reservation = await book();
      await checkIn(reservation.id, { method: 'CASH', amount: '60000' });
      assert.equal((await as('billing-worker', () => payments.recordCheckInDeposit(hotelId, reservation.id))).status, 'PENDING');
      const deposit = await db.payment.findFirst({ where: { reservationId: reservation.id } });
      assert.equal((await db.approval.findUnique({ where: { id: deposit.approvalId } })).requestedBy, DESK);

      await desk(async () =>
        frontDesk.revertCheckIn(hotelId, reservation.id, { expectedUpdatedAt: await version(reservation.id), reason: 'Yanlış oda' }, { now: at('16:30') }),
      );
      const result = await as('billing-worker', () =>
        payments.reverseCheckInDeposits(hotelId, reservation.id, { reason: 'Yanlış oda', occurredAt: new Date(Date.now() + 1000) }),
      );
      assert.deepEqual(result, { reversed: 0, withdrawn: 1 });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal((await db.approval.findUnique({ where: { id: deposit.approvalId } })).status, 'DENIED');
      assert.equal((await db.payment.findUnique({ where: { id: deposit.id } })).status, 'DECLINED');

      await checkIn(reservation.id, { method: 'NONE' }, '16:45');
      const folio = await db.folio.findFirst({ where: { reservationId: reservation.id, status: 'OPEN' } });
      await receive(folio.id, { amount: '100' });
      await assert.rejects(
        desk(async () =>
          frontDesk.revertCheckIn(hotelId, reservation.id, { expectedUpdatedAt: await version(reservation.id), reason: 'x' }, { now: at('17:00') }),
        ),
        { code: 'FOLIO_ACTIVITY' },
      );
    });

    it('kart provizyonu ödeme değildir', async () => {
      const reservation = await book();
      await checkIn(reservation.id, { method: 'CARD_PREAUTH', amount: '2000', reference: 'PRV-1' });
      const result = await as('billing-worker', () => payments.recordCheckInDeposit(hotelId, reservation.id));
      assert.equal(result.skipped, 'Kart provizyonu ödeme değil');
      assert.equal(await db.payment.count({ where: { reservationId: reservation.id } }), 0);
    });
  });

  describe('birden fazla pencere', () => {
    it('açık folyo birden fazlaysa konaklamaya ödeme folyo seçilmeden alınmaz; çıkışta dengesiz pencereler uyarıda ayrı ayrı yazılır', async () => {
      const { stay, folio } = await seedStay({ charges: '1000.00' });
      const { folioId: companyId } = await desk(() => folios.splitFolio(hotelId, folio.id, { itemIds: [], payerName: 'ABC Ltd.', routeTypes: [] }));
      await desk(() =>
        folios.postCharge(
          hotelId,
          companyId,
          contracts.postChargeSchema.parse({ requestId: randomUUID(), type: 'OTHER', description: 'Toplantı', amount: '500', quantity: 1 }),
        ),
      );
      const stayPay = (body) =>
        desk(() => payments.receiveStayPayment(hotelId, stay.id, contracts.stayPaymentSchema.parse({ requestId: randomUUID(), method: 'CASH', ...body })));
      await rejectsWith(stayPay({ amount: '1500' }), 'FOLIO_REQUIRED', /2 açık folyosu var/);
      assert.equal((await stayPay({ amount: '1500', folioId: folio.id })).payment.folioId, folio.id);

      // Misafir hepsini ana pencereye ödedi: toplam sıfır, pencereler −500 / +500.
      await db.reservation.update({ where: { id: stay.id }, data: { status: 'CHECKED_OUT', checkedOutAt: new Date(), checkedOutBy: DESK } });
      await as('billing-worker', () => folios.settleStayOnCheckOut(hotelId, stay.id, { lateCheckOutFee: null, openBalance: null, eventId: randomUUID() }));
      const alert = await db.staffAlert.findFirst({ where: { hotelId, kind: 'FOLIO_ATTENTION', entityId: stay.id } });
      assert.match(alert.body, /Folyo 1: -500\.00 TRY; Folyo 2 · ABC Ltd\.: 500\.00 TRY\. Toplam sıfır ama pencereler dengesiz/);
    });
  });

  describe('ödemeden sonra kapanış', () => {
    it('çıkmış misafirin folyosu ödemeyle sıfırlanınca kapanır; içeridekinin folyosu açık kalır', async () => {
      const out = await seedStay({ status: 'CHECKED_OUT', charges: '750.00' });
      await receive(out.folio.id, { amount: '750' });
      assert.deepEqual(await as('billing-worker', () => folios.closeFolioIfSettled(hotelId, out.folio.id)), { closed: true });
      assert.equal((await db.folio.findUnique({ where: { id: out.folio.id } })).status, 'CLOSED');
      assert.equal((await eventsNamed('folio.closed')).length, 1);

      const inside = await seedStay({ charges: '750.00', roomNumber: '102' });
      await receive(inside.folio.id, { amount: '750' });
      const result = await as('billing-worker', () => folios.closeFolioIfSettled(hotelId, inside.folio.id));
      assert.equal(result.closed, false);
      assert.match(result.reason, /Konaklama sürüyor/);
    });
  });

  describe('kasa', () => {
    it('günün toplamları yöntem ve döviz bazında; "benim kasam"; onay bekleyenler ayrı; hareketler imleçli', async () => {
      const { folio } = await seedStay({ charges: '200000.00' });
      await setRates([{ currency: 'EUR', rate: '38.5' }]);
      await receive(folio.id, { amount: '2000' });
      await receive(folio.id, { amount: '1000' }, DESK2);
      await receive(folio.id, { amount: '100', currency: 'EUR', expectedRate: '38.5' });
      await receive(folio.id, { method: 'CARD', amount: '4200', reference: 'SLIP-1' });
      await receive(folio.id, { amount: '75000' }); // eşik üstü: bekliyor

      const summary = await desk(() => payments.getCashSummary(hotelId, { mine: false }));
      assert.equal(summary.isToday, true);
      const cash = summary.methods.find((line) => line.method === 'CASH');
      assert.equal(cash.received, '6850.00');
      assert.deepEqual(cash.currencies, [
        { currency: 'EUR', amount: '100.00', folioAmount: '3850.00' },
        { currency: 'TRY', amount: '3000.00', folioAmount: '3000.00' },
      ]);
      assert.equal(summary.total.net, '11050.00');
      assert.equal(summary.pending.count, 1);
      assert.equal(summary.pending.items[0].stay.roomNumber, '101');

      const mine = await as(DESK2, () => payments.getCashSummary(hotelId, { mine: true }));
      assert.equal(mine.total.net, '1000.00');
      assert.equal(mine.pending.count, 0);

      const first = await desk(() => payments.listCashMovements(hotelId, { mine: false, limit: 3 }));
      assert.equal(first.movements.length, 3);
      assert.ok(first.nextCursor);
      const second = await desk(() => payments.listCashMovements(hotelId, { mine: false, limit: 3, cursor: first.nextCursor }));
      const ids = [...first.movements, ...second.movements].map((row) => row.id);
      assert.equal(new Set(ids).size, 4, 'işlenen 4 hareket, tekrar yok; bekleyen listede değil');
      assert.equal(second.nextCursor, null);
      const cards = await desk(() => payments.listCashMovements(hotelId, { mine: false, method: 'CARD', limit: 10 }));
      assert.deepEqual(cards.movements.map((row) => row.reference), ['SLIP-1']);

      await rejectsWith(desk(() => payments.getCashSummary(hotelId, { date: day(1), mine: false })), 'VALIDATION');
    });
  });

  describe('eşzamanlılık ve otel sınırı', () => {
    it('aynı folyoya eşzamanlı 10 ödeme: toplamlar tutarlı; aynı isteğin eşzamanlı iki gönderimi tek satır', async () => {
      const { folio } = await seedStay({ charges: '5000.00' });
      await Promise.all(Array.from({ length: 10 }, (_, index) => receive(folio.id, { amount: String(100 + index) })));
      assert.equal(await balanceOf(folio.id), '3955.00');
      await assertTotalsConsistent(folio.id);

      const body = contracts.receivePaymentSchema.parse({ requestId: randomUUID(), method: 'CASH', amount: '5' });
      const both = await Promise.all([desk(() => payments.receivePayment(hotelId, folio.id, body)), desk(() => payments.receivePayment(hotelId, folio.id, body))]);
      assert.deepEqual(both.map((row) => row.created).sort(), [false, true]);
      assert.equal(await balanceOf(folio.id), '3950.00');
    });

    it('başka otelin folyosuna ödeme alınmaz', async () => {
      const { folio } = await seedStay();
      const other = await db.hotel.create({ data: { name: 'Başka', code: `O${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE } });
      await assert.rejects(
        as(DESK, () => payments.receivePayment(other.id, folio.id, contracts.receivePaymentSchema.parse({ requestId: randomUUID(), method: 'CASH', amount: '10' }))),
        { code: 'NOT_FOUND' },
      );
      await assert.rejects(as(DESK, () => payments.listFolioPayments(other.id, folio.id, { limit: 10 })), { code: 'NOT_FOUND' });
    });
  });
});
