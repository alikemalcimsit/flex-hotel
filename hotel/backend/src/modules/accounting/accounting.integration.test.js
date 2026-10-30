import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Ön muhasebe (modül 47) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: ön büro tahsilatının muhasebe aktörüyle (olay → aktör → servis) kasaya / bankaya ve "Acente / cari"nin
 * cariye işlenmesi (acentesiz rezervasyonda cari seçimi zorunlu), dövizli nakdin TRY kasaya çevrilmiş tutarla ve
 * EUR kasaya kendi tutarıyla girmesi, ödeme iptalinin ters kaydı, eşleme yokken manuel görev ve eşitlemeyle
 * tamamlanma, başlangıç gününden önceki belgenin işlenmemesi; etkinlik / restoran tahsilatı, mal kabul (vade),
 * acente primi ve etkinlik bedelinin fark kaydıyla eşitlenmesi; tahsilat / ödeme / virman / giriş-çıkış fişleri,
 * çek / senet yolculuğu (portföy → tahsil / ciro / karşılıksız, verilenin ödenmesi), eşik üstü ödemede dört göz,
 * kasa eksiye düşmez, fiş iptali (ters kayıt, işlem görmüş çekte red); açılış bakiyesi; ekstre (devir, yürüyen
 * bakiye, imleç) ve yaşlandırma (elle hesaplanmış); eşzamanlı yarışlar; izinler ve otel kapsamı.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'mudur@test.local';
const MANAGER2 = 'genelmudur@test.local';
const ACCOUNTING = 'muhasebe@test.local';
const DESK = 'onburo@test.local';
const TC = '10000000146';

/** Geçerli TR IBAN (denetim haneleri hesaplanır): 22 haneli BBAN'dan. @param {string} bban */
function ibanOf(bban) {
  const digits = `${bban}2927` + '00';
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return `TR${String(98 - remainder).padStart(2, '0')}${bban}`;
}

describe('ön muhasebe (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let accounts;
  /** @type {any} */ let treasury;
  /** @type {any} */ let vouchers;
  /** @type {any} */ let instruments;
  /** @type {any} */ let postings;
  /** @type {any} */ let payments;
  /** @type {any} */ let folios;
  /** @type {any} */ let approvals;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let otherHotelId;
  /** @type {Map<string, string>} */ let tokens;
  /** @type {Record<string, any>} */ let kasa;
  /** @type {Record<string, any>} */ let banka;
  /** @type {any} */ let agency;
  /** @type {any} */ let roomType;
  /** @type {any} */ let room;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    accounts = await import('./accounts.js');
    treasury = await import('./treasury.js');
    vouchers = await import('./vouchers.js');
    instruments = await import('./instruments.js');
    postings = await import('./postings.js');
    payments = await import('../payments/service.js');
    folios = await import('../folios/service.js');
    approvals = await import('../approvals/service.js');
    cache = await import('../../lib/cache.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const boss = (fn) => as(MANAGER, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const D = (offset) => core.toIsoDay(core.addDays(today(), offset));
  const money = (value) => core.toMoneyString(String(value));

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
    hotelId = (await db.hotel.create({ data: { name: 'Büyük Ankara Oteli', code: `A${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    otherHotelId = (await db.hotel.create({ data: { name: 'Başka Otel', code: `O${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: MANAGER2, name: 'Genel Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: ACCOUNTING, name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
        { hotelId, email: DESK, name: 'Ön Büro', role: 'FRONT_DESK', passwordHash },
      ],
    });
    agency = await db.agency.create({ data: { hotelId, code: 'TATIL', name: 'Tatil Acentesi', taxNumber: '1111111111', paymentTermDays: 30, createdBy: MANAGER } });
    roomType = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 3, capacityChildren: 1 } });
    room = await db.room.create({ data: { hotelId, number: '101', roomTypeId: roomType.id } });
    const newTreasury = (input) => boss(() => treasury.createTreasuryAccount(hotelId, contracts.treasuryAccountCreateSchema.parse(input)));
    kasa = { try: (await newTreasury({ kind: 'CASH', name: 'Ön büro kasası', currency: 'TRY' })).account, eur: (await newTreasury({ kind: 'CASH', name: 'Döviz kasası EUR', currency: 'EUR' })).account };
    banka = {
      try: (await newTreasury({ kind: 'BANK', name: 'Ziraat TL', currency: 'TRY', bankName: 'Ziraat Bankası', branch: 'Kızılay', iban: ibanOf('0001000000000012345678') })).account,
      ikinci: (await newTreasury({ kind: 'BANK', name: 'İş Bankası TL', currency: 'TRY', bankName: 'İş Bankası', iban: ibanOf('0006400000000098765432') })).account,
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

  /* ── Yardımcılar ── */

  const ledgerBalance = async (id) => money((await db.ledgerAccount.findUnique({ where: { id } })).balance);
  const treasuryBalance = async (id) => money((await db.treasuryAccount.findUnique({ where: { id } })).balance);
  const movementsOf = (treasuryAccountId) => db.treasuryMovement.findMany({ where: { treasuryAccountId }, orderBy: { createdAt: 'asc' } });
  const entriesOf = (accountId) => db.ledgerEntry.findMany({ where: { accountId }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] });

  async function mapping(rows) {
    const current = await boss(() => treasury.getSettings(hotelId));
    return boss(() => treasury.saveMappings(hotelId, contracts.treasuryMappingSchema.parse({ expectedUpdatedAt: current.mappingUpdatedAt, rows })));
  }
  const frontDeskMapping = () =>
    mapping([
      { channel: 'FRONT_DESK', method: 'CASH', currency: '', treasuryAccountId: kasa.try.id },
      { channel: 'FRONT_DESK', method: 'CASH', currency: 'EUR', treasuryAccountId: kasa.eur.id },
      { channel: 'FRONT_DESK', method: 'CARD', currency: '', treasuryAccountId: banka.try.id },
      { channel: 'BANQUET', method: 'TRANSFER', currency: '', treasuryAccountId: banka.try.id },
      { channel: 'POS', method: 'CASH', currency: '', treasuryAccountId: kasa.try.id },
    ]);

  const company = (name = 'Demir Holding A.Ş.', extra = {}) =>
    as(ACCOUNTING, () => accounts.createAccount(hotelId, contracts.ledgerAccountCreateSchema.parse({ type: 'COMPANY', name, taxNumber: '2222222222', paymentTermDays: 15, ...extra })));

  const voucher = (input, email = ACCOUNTING) =>
    as(email, () => vouchers.createVoucher(hotelId, contracts.voucherCreateSchema.parse({ requestId: randomUUID(), date: D(0), description: 'Test fişi', ...input })));
  const opening = (input) => boss(() => vouchers.createOpening(hotelId, contracts.openingBalanceSchema.parse({ requestId: randomUUID(), ...input })));

  /** İçerideki konaklama, folyosu açık, `charges` tutarında harcama. */
  async function seedStay({ agencyId = agency.id, charges = '20000.00' } = {}) {
    const guest = await db.guest.create({ data: { hotelId, firstName: 'Ayşe', lastName: 'Demir', idType: 'NATIONAL_ID', idNumber: TC, nationality: 'TR' } });
    const stay = await db.reservation.create({
      data: {
        hotelId,
        guestId: guest.id,
        roomTypeId: roomType.id,
        roomId: room.id,
        agencyId,
        agencyCommissionPct: agencyId ? '10' : null,
        source: agencyId ? 'AGENCY' : 'UI',
        checkIn: new Date(`${D(-1)}T00:00:00.000Z`),
        checkOut: new Date(`${D(1)}T00:00:00.000Z`),
        status: 'CHECKED_IN',
        checkedInAt: new Date(),
        checkedInBy: DESK,
        confirmedAt: new Date(),
        totalPrice: '2000.00',
        confirmationCode: `H${randomUUID().slice(0, 7).toUpperCase()}`,
      },
    });
    await as(DESK, () => folios.openFolio(hotelId, stay.id, {}));
    const folio = await db.folio.findFirst({ where: { reservationId: stay.id } });
    await as(DESK, () => folios.postCharge(hotelId, folio.id, contracts.postChargeSchema.parse({ requestId: randomUUID(), type: 'OTHER', description: 'Hizmet', amount: charges, quantity: 1 })));
    return { stay, folio };
  }
  const pay = (folioId, body, email = DESK) =>
    as(email, () => payments.receivePayment(hotelId, folioId, contracts.receivePaymentSchema.parse({ requestId: randomUUID(), method: 'CASH', ...body })));

  /* ═══════════════ Otomatik kayıtlar ═══════════════ */

  describe('ön büro tahsilatı (aktör üzerinden)', () => {
    it('nakit kasaya, kart bankaya, "Acente / cari" acentenin carisine vadeli; açıklamada oda ve misafir', async () => {
      await frontDeskMapping();
      const { folio } = await seedStay();
      await pay(folio.id, { method: 'CASH', amount: '1000' });
      await pay(folio.id, { method: 'CARD', amount: '2500', reference: 'SLIP-1' });
      await pay(folio.id, { method: 'AGENCY', amount: '4000' });
      assert.equal(await treasuryBalance(kasa.try.id), '1000.00');
      assert.equal(await treasuryBalance(banka.try.id), '2500.00');
      const [cash] = await movementsOf(kasa.try.id);
      assert.match(cash.description, /Folyo tahsilatı · 101 · Ayşe Demir · Nakit/);
      assert.equal(cash.sourceType, 'FOLIO_PAYMENT');
      const account = await db.ledgerAccount.findFirst({ where: { agencyId: agency.id } });
      assert.equal(account.type, 'AGENCY');
      assert.match(account.code, /^ACN-\d{4}$/);
      assert.equal(await ledgerBalance(account.id), '4000.00');
      const [entry] = await entriesOf(account.id);
      assert.equal(money(entry.debit), '4000.00');
      assert.equal(core.toIsoDay(entry.dueDate), D(30), 'vade = belge günü + acentenin vadesi');
      // Aktörün izi: işlenen tahsilat okunur yazılır.
      const activity = await db.activityLog.findMany({ where: { hotelId, actorName: 'accounting-worker' }, orderBy: { createdAt: 'asc' } });
      assert.ok(activity.length >= 3);
      assert.ok(activity.some((row) => /Ön büro kasası/.test(row.message)));
    });

    it('acentesiz rezervasyonda "Acente / cari" cari seçimi ister; seçilen cariye yazılır, iptali ters kayıtla düşer', async () => {
      await frontDeskMapping();
      const { folio } = await seedStay({ agencyId: null });
      await rejectsWith(pay(folio.id, { method: 'AGENCY', amount: '1000' }), 'VALIDATION', /Cari hesap seçin/);
      const demir = (await company()).account;
      const { payment } = await pay(folio.id, { method: 'AGENCY', amount: '1500', ledgerAccountId: demir.id });
      assert.equal(payment.ledgerAccount.id, demir.id);
      assert.equal(await ledgerBalance(demir.id), '1500.00');
      // Hatalı giriş iptali: onay (dört göz) → iptal kaydı → cari ters kayıt.
      await as(DESK, () => payments.requestPaymentVoid(hotelId, payment.id, { reason: 'Yanlış cari' }));
      const pendingVoid = await db.payment.findUnique({ where: { id: payment.id } });
      await as(MANAGER2, () => approvals.decideApproval(hotelId, pendingVoid.voidApprovalId, 'GRANTED', { note: 'Tamam' }));
      assert.equal(await ledgerBalance(demir.id), '0.00');
      const entries = await entriesOf(demir.id);
      assert.equal(entries.length, 2);
      assert.equal(money(entries[1].credit), '1500.00');
    });

    it('dövizli nakit: TRY kasaya çevrilmiş tutar + kaynak döviz; EUR eşlemesi varsa EUR kasaya kendi tutarı', async () => {
      await boss(() => payments.setTodayRates(hotelId, contracts.exchangeRatesInputSchema.parse({ rates: [{ currency: 'EUR', rate: '36.5' }] })));
      await mapping([{ channel: 'FRONT_DESK', method: 'CASH', currency: '', treasuryAccountId: kasa.try.id }]);
      const { folio } = await seedStay();
      await pay(folio.id, { method: 'CASH', amount: '100', currency: 'EUR', expectedRate: '36.5' });
      const [tl] = await movementsOf(kasa.try.id);
      assert.deepEqual([money(tl.amount), money(tl.originalAmount), tl.originalCurrency, String(tl.exchangeRate)], ['3650.00', '100.00', 'EUR', '36.5']);
      await frontDeskMapping();
      await pay(folio.id, { method: 'CASH', amount: '50', currency: 'EUR', expectedRate: '36.5' });
      assert.equal(await treasuryBalance(kasa.eur.id), '50.00');
      const [eur] = await movementsOf(kasa.eur.id);
      assert.equal(eur.originalCurrency, null);
    });

    it('eşleme yoksa iş "Ön muhasebe" görevine düşer; eşleme girilip eşitlenince işlenir (tekrar eşitleme bir şey yazmaz)', async () => {
      const { folio } = await seedStay();
      await pay(folio.id, { method: 'CASH', amount: '700' });
      assert.equal(await treasuryBalance(kasa.try.id), '0.00');
      const tasks = await db.manualTask.findMany({ where: { hotelId, module: 'Ön muhasebe' } });
      assert.equal(tasks.length, 1);
      assert.match(tasks[0].title, /Folyo tahsilatı muhasebeye işlenecek/);
      await frontDeskMapping();
      const report = await as(ACCOUNTING, () => postings.syncPeriod(hotelId, { from: D(0), to: D(0) }));
      assert.equal(report.posted, 1);
      assert.equal(report.failed, 0);
      assert.equal(await treasuryBalance(kasa.try.id), '700.00');
      const again = await as(ACCOUNTING, () => postings.syncPeriod(hotelId, { from: D(0), to: D(0) }));
      assert.equal(again.posted, 0);
      assert.equal((await movementsOf(kasa.try.id)).length, 1);
    });

    it('süre sınırına takılan eşitleme kalanı kesin sayar; yeniden çalışınca kaldığı yerden sürer', async () => {
      const { folio } = await seedStay();
      await pay(folio.id, { method: 'CASH', amount: '100' });
      await pay(folio.id, { method: 'CASH', amount: '200' });
      assert.equal(await treasuryBalance(kasa.try.id), '0.00', 'eşleme yokken işlenmez');
      const unmapped = await as(ACCOUNTING, () => postings.syncPeriod(hotelId, { from: D(0), to: D(0) }));
      assert.deepEqual([unmapped.failed, unmapped.errors.length, unmapped.errors[0].count], [2, 1, 2], 'aynı eksik eşleme tek satırda sayılır');
      await frontDeskMapping();
      const stopped = await as(ACCOUNTING, () => postings.syncPeriod(hotelId, { from: D(0), to: D(0) }, { budgetMs: 0 }));
      assert.deepEqual([stopped.posted, stopped.skipped, stopped.failed, stopped.remaining], [0, 0, 0, 2]);
      assert.equal(await treasuryBalance(kasa.try.id), '0.00');
      const resumed = await as(ACCOUNTING, () => postings.syncPeriod(hotelId, { from: D(0), to: D(0) }));
      assert.deepEqual([resumed.posted, resumed.failed, resumed.remaining], [2, 0, 0]);
      assert.equal(await treasuryBalance(kasa.try.id), '300.00');
    });

    it('başlangıç gününden önceki belge işlenmez; başlangıç geri alınınca eşitlemeyle işlenir; ileri alınamaz', async () => {
      await frontDeskMapping();
      const { folio } = await seedStay();
      const { payment } = await pay(folio.id, { method: 'CASH', amount: '300' });
      await db.payment.update({ where: { id: payment.id }, data: { businessDate: new Date(`${D(-5)}T00:00:00.000Z`) } });
      await db.treasuryMovement.deleteMany({ where: { sourceKey: `PAYMENT:${payment.id}` } });
      await db.treasuryAccount.update({ where: { id: kasa.try.id }, data: { balance: '0' } });
      const skipped = await postings.syncFolioPayment(hotelId, payment.id);
      assert.match(skipped.skipped, /başlangıç gününden önce/);
      const settings = await boss(() => treasury.getSettings(hotelId));
      await boss(() => treasury.saveSettings(hotelId, contracts.accountingSettingsSchema.parse({ expectedUpdatedAt: settings.settings.updatedAt, startDate: D(-10), paymentApprovalAmount: '50000' })));
      const report = await as(ACCOUNTING, () => postings.syncPeriod(hotelId, { from: D(-10), to: D(0) }));
      assert.equal(report.posted, 1);
      assert.equal(await treasuryBalance(kasa.try.id), '300.00');
      const fresh = await boss(() => treasury.getSettings(hotelId));
      await rejectsWith(
        boss(() => treasury.saveSettings(hotelId, contracts.accountingSettingsSchema.parse({ expectedUpdatedAt: fresh.settings.updatedAt, startDate: D(0), paymentApprovalAmount: '50000' }))),
        'START_DATE_HAS_ENTRIES',
      );
    });

    it('eşlemede para birimi tutmayan hesap reddedilir', async () => {
      await rejectsWith(mapping([{ channel: 'FRONT_DESK', method: 'CASH', currency: '', treasuryAccountId: kasa.eur.id }]), 'VALIDATION', /EUR hesabı; TRY tahsilatı için TRY hesabı/);
      // Restoran havale almaz: şema reddeder.
      const invalid = contracts.treasuryMappingSchema.safeParse({ expectedUpdatedAt: null, rows: [{ channel: 'POS', method: 'TRANSFER', currency: '', treasuryAccountId: banka.try.id }] });
      assert.equal(invalid.success, false);
      assert.match(invalid.error.issues[0].message, /bu yöntemle tahsilat almaz/);
    });
  });

  describe('etkinlik, restoran, mal kabul, prim, etkinlik bedeli', () => {
    async function eventFixture({ status = 'COMPLETED', grandTotal = '120000.00' } = {}) {
      const client = await db.eventClient.create({ data: { hotelId, type: 'COMPANY', name: 'Yıldız Kongre Ltd.', taxNumber: '3333333333', createdBy: MANAGER } });
      const event = await db.event.create({
        data: { hotelId, code: `ETK-2026-${randomUUID().slice(0, 4)}`, name: 'Bayi toplantısı', type: 'MEETING', clientId: client.id, ownerEmail: MANAGER, expectedPax: 100, currency: 'TRY', createdBy: MANAGER, status, grandTotal, netTotal: grandTotal, taxTotal: '0', definiteAt: new Date(), definiteBy: MANAGER, ...(status === 'COMPLETED' ? { completedAt: new Date(), completedBy: MANAGER, actualPax: 100 } : {}) },
      });
      return { client, event };
    }

    it('etkinlik tahsilatı bankaya ve müşteri carisinden düşer; gerçekleşen etkinlik bedeli cariye; tutar düzeltilince fark kaydı', async () => {
      await frontDeskMapping();
      const { client, event } = await eventFixture();
      const payment = await db.eventPayment.create({
        data: { hotelId, eventId: event.id, method: 'TRANSFER', amount: '30000.00', currency: 'TRY', businessDate: new Date(`${D(0)}T00:00:00.000Z`), reference: 'DKT-9', receivedBy: MANAGER, postedAt: new Date() },
      });
      await postings.syncEventPayment(hotelId, payment.id);
      await postings.syncEventCharge(hotelId, event.id);
      const account = await db.ledgerAccount.findFirst({ where: { eventClientId: client.id } });
      assert.equal(account.type, 'COMPANY');
      assert.equal(await ledgerBalance(account.id), '90000.00', '120.000 bedel − 30.000 tahsilat');
      assert.equal(await treasuryBalance(banka.try.id), '30000.00');
      await postings.syncEventCharge(hotelId, event.id);
      assert.equal((await entriesOf(account.id)).length, 2, 'ikinci eşitleme yazmaz');
      // İptal bedeline dönüş (ör. veri düzeltmesi): fark kaydı.
      await db.event.update({ where: { id: event.id }, data: { status: 'CANCELLED', completedAt: null, completedBy: null, cancellationFee: '20000.00', cancelledAt: new Date(), cancelledBy: MANAGER, cancelReason: 'Müşteri vazgeçti' } });
      await postings.syncEventCharge(hotelId, event.id);
      assert.equal(await ledgerBalance(account.id), '-10000.00', '20.000 iptal bedeli − 30.000 tahsilat: müşteriye 10.000 borçluyuz');
      const corrections = (await entriesOf(account.id)).filter((entry) => entry.sourceType === 'EVENT_CHARGE');
      assert.deepEqual(corrections.map((entry) => [money(entry.debit), money(entry.credit)]), [['120000.00', '0.00'], ['0.00', '100000.00']]);
    });

    it('restoran nakit tahsilatı restoran eşlemesiyle kasaya; iptal kaydı ters', async () => {
      await frontDeskMapping();
      const outlet = await db.posOutlet.create({ data: { hotelId, code: 'ANA', name: 'Ana restoran', createdBy: MANAGER } });
      const shift = await db.posShift.create({ data: { hotelId, waiterEmail: DESK, openingFloat: '0', businessDate: new Date(`${D(0)}T00:00:00.000Z`) } });
      const check = await db.posCheck.create({ data: { hotelId, outletId: outlet.id, number: 'ADS-0042', waiterEmail: DESK, shiftId: shift.id, openedBy: DESK } });
      const base = { hotelId, checkId: check.id, shiftId: shift.id, method: 'CASH', currency: 'TRY', businessDate: new Date(`${D(0)}T00:00:00.000Z`), receivedBy: DESK, postedAt: new Date() };
      const paid = await db.posPayment.create({ data: { ...base, amount: '850.00' } });
      await postings.syncPosPayment(hotelId, paid.id);
      await db.posPayment.create({ data: { ...base, kind: 'REVERSAL', amount: '-850.00', reversalOfId: paid.id } });
      await postings.syncPosPayment(hotelId, paid.id);
      const rows = await movementsOf(kasa.try.id);
      assert.deepEqual(rows.map((row) => money(row.amount)), ['850.00', '-850.00']);
      assert.match(rows[0].description, /Ana restoran ADS-0042 · Nakit/);
    });

    it('mal kabul tedarikçi carisine vadeli borcumuz; prim onaylanınca acente carisine alacak, yeniden açılınca geri', async () => {
      const supplier = await db.supplier.create({ data: { hotelId, name: 'Anadolu Süt', paymentTermDays: 45, createdBy: MANAGER } });
      const warehouse = await db.warehouse.create({ data: { hotelId, code: 'ANA', name: 'Ana depo', createdBy: MANAGER } });
      const order = await db.purchaseOrder.create({
        data: { hotelId, number: 'SAS-2026-0001', supplierId: supplier.id, status: 'RECEIVED', expectedOn: new Date(`${D(0)}T00:00:00.000Z`), paymentTermDays: 45, currency: 'TRY', netTotal: '10000', taxTotal: '1000', grandTotal: '11000', createdBy: MANAGER },
      });
      const receipt = await db.goodsReceipt.create({
        data: { hotelId, number: 'MKB-2026-0001', orderId: order.id, supplierId: supplier.id, warehouseId: warehouse.id, waybillNumber: 'IRS-77', receivedOn: new Date(`${D(0)}T00:00:00.000Z`), netTotal: '10000', taxTotal: '1000', grandTotal: '11000', receivedBy: MANAGER },
      });
      await postings.syncGoodsReceipt(hotelId, receipt.id);
      const supplierAccount = await db.ledgerAccount.findFirst({ where: { supplierId: supplier.id } });
      assert.equal(await ledgerBalance(supplierAccount.id), '-11000.00');
      const [entry] = await entriesOf(supplierAccount.id);
      assert.equal(core.toIsoDay(entry.dueDate), D(45));
      assert.equal(entry.reference, 'IRS-77');

      const rule = await db.agencyBonusRule.create({
        data: { hotelId, agencyId: agency.id, name: 'Yaz hedefi', startDate: new Date(`${D(-60)}T00:00:00.000Z`), endDate: new Date(`${D(-1)}T00:00:00.000Z`), metric: 'REVENUE', mode: 'WHOLE', target: '100000', tiers: [{ threshold: '100', ratePct: '5' }], currency: 'TRY', createdBy: MANAGER },
      });
      const bonus = await db.agencyBonus.create({
        data: {
          hotelId, ruleId: rule.id, agencyId: agency.id, status: 'APPROVED', periodStart: rule.startDate, periodEnd: rule.endDate, metric: 'REVENUE', mode: 'WHOLE', target: '100000', tiers: [], currency: 'TRY',
          ruleUpdatedAt: new Date(), nights: 10, revenue: '120000', scorePct: '120', tierIndex: 1, grossAmount: '6000', amount: '6000', slices: [], reservationCount: 4, calculatedAt: new Date(), calculatedBy: MANAGER, approvedAt: new Date(), approvedBy: MANAGER2,
        },
      });
      await postings.syncAgencyBonus(hotelId, bonus.id);
      const agencyAccount = await db.ledgerAccount.findFirst({ where: { agencyId: agency.id } });
      assert.equal(await ledgerBalance(agencyAccount.id), '-6000.00');
      await db.agencyBonus.update({ where: { id: bonus.id }, data: { status: 'DRAFT', approvedAt: null, approvedBy: null } });
      await postings.syncAgencyBonus(hotelId, bonus.id);
      assert.equal(await ledgerBalance(agencyAccount.id), '0.00');
      assert.match((await entriesOf(agencyAccount.id))[1].description, /düzeltme/);
    });

    it('eşzamanlı aynı belge iki kez yazılmaz (ödeme, etkinlik bedeli)', async () => {
      // Eşleme yokken alınan ödeme aktörde işlenemez; eşleme girilince dört eşitleme yarışır.
      const { folio } = await seedStay();
      const { payment } = await pay(folio.id, { method: 'CASH', amount: '1234.50' });
      await frontDeskMapping();
      await Promise.all([1, 2, 3, 4].map(() => postings.syncFolioPayment(hotelId, payment.id)));
      assert.equal((await db.treasuryMovement.findMany({ where: { sourceKey: `PAYMENT:${payment.id}` } })).length, 1);
      assert.equal(await treasuryBalance(kasa.try.id), '1234.50');
      const { event, client } = await eventFixture({ grandTotal: '5000.00' });
      await Promise.all([1, 2, 3].map(() => postings.syncEventCharge(hotelId, event.id)));
      const account = await db.ledgerAccount.findFirst({ where: { eventClientId: client.id } });
      assert.equal(await ledgerBalance(account.id), '5000.00');
    });
  });

  /* ═══════════════ Fişler ve çek / senet ═══════════════ */

  describe('fişler', () => {
    it('açılış, tahsilat (nakit + çek), ödeme (ciro + nakit), virman; kasa eksiye düşmez; hesap başına tek açılış', async () => {
      const demir = (await company()).account;
      const supplier = await db.supplier.create({ data: { hotelId, name: 'Ankara Kasabı', paymentTermDays: 30, createdBy: MANAGER } });
      const kasap = (await as(ACCOUNTING, () => accounts.linkAccount(hotelId, contracts.ledgerAccountLinkSchema.parse({ supplierId: supplier.id })))).account;
      await opening({ ledgerAccountId: demir.id, side: 'DEBIT', amount: '10000', dueDate: D(-40) });
      await opening({ ledgerAccountId: kasap.id, side: 'CREDIT', amount: '20000' });
      await opening({ treasuryAccountId: kasa.try.id, amount: '2000' });
      await rejectsWith(opening({ treasuryAccountId: kasa.try.id, amount: '1' }), 'OPENING_EXISTS');
      assert.equal(await ledgerBalance(demir.id), '10000.00');
      const settings = await boss(() => treasury.getSettings(hotelId));
      const [open] = await entriesOf(demir.id);
      assert.equal(core.toIsoDay(open.date), D(-1), 'açılış başlangıç gününden bir gün önce');
      assert.equal(settings.settings.startDate, D(0));

      const tahsilat = await voucher({
        type: 'COLLECTION',
        ledgerAccountId: demir.id,
        lines: [
          { kind: 'TREASURY', amount: '3000', treasuryAccountId: kasa.try.id },
          { kind: 'CHEQUE_IN', amount: '5000', instrumentKind: 'CHEQUE', number: '1000123', bankName: 'Garanti BBVA', drawer: 'Demir Holding', dueDate: D(30) },
        ],
      });
      assert.match(tahsilat.voucher.number, /^TAH-\d{4}-00001$/);
      assert.equal(await ledgerBalance(demir.id), '2000.00');
      assert.equal(await treasuryBalance(kasa.try.id), '5000.00');
      const cheque = await db.instrument.findFirst({ where: { hotelId, number: '1000123' } });
      assert.equal(cheque.status, 'PORTFOLIO');
      await rejectsWith(
        voucher({ type: 'COLLECTION', ledgerAccountId: demir.id, lines: [{ kind: 'CHEQUE_IN', amount: '1', instrumentKind: 'CHEQUE', number: '1000123', bankName: 'Garanti BBVA', dueDate: D(30) }] }),
        'VOUCHER_NOT_POSTABLE',
        /zaten kayıtlı/,
      );

      const odeme = await voucher({ type: 'PAYMENT', ledgerAccountId: kasap.id, lines: [{ kind: 'ENDORSE', amount: '5000', instrumentId: cheque.id }, { kind: 'TREASURY', amount: '1000', treasuryAccountId: kasa.try.id }] });
      assert.equal(odeme.voucher.status, 'POSTED');
      assert.equal(await ledgerBalance(kasap.id), '-14000.00');
      assert.equal(await treasuryBalance(kasa.try.id), '4000.00');
      assert.equal((await db.instrument.findUnique({ where: { id: cheque.id } })).status, 'ENDORSED');
      await rejectsWith(voucher({ type: 'PAYMENT', ledgerAccountId: kasap.id, lines: [{ kind: 'TREASURY', amount: '4000.01', treasuryAccountId: kasa.try.id }] }), 'VOUCHER_NOT_POSTABLE', /yeterli bakiye yok/);

      await voucher({ type: 'TRANSFER', treasuryAccountId: kasa.try.id, targetTreasuryAccountId: banka.try.id, amount: '1500' });
      assert.deepEqual([await treasuryBalance(kasa.try.id), await treasuryBalance(banka.try.id)], ['2500.00', '1500.00']);
      await rejectsWith(voucher({ type: 'TRANSFER', treasuryAccountId: kasa.try.id, targetTreasuryAccountId: kasa.eur.id, amount: '10' }), 'VOUCHER_NOT_POSTABLE', /Farklı para birimli/);
      await rejectsWith(voucher({ type: 'TREASURY_OUT', treasuryAccountId: kasa.try.id, amount: '2500.01' }), 'VOUCHER_NOT_POSTABLE', /yeterli bakiye yok/);

      // Tahsilat fişinin çeki ciro edildi: fiş iptal edilemez. Basit giriş fişi iptali ters kayıtla.
      await rejectsWith(boss(() => vouchers.voidVoucher(hotelId, tahsilat.voucher.id, { reason: 'Deneme iptal' })), 'INSTRUMENT_PROGRESSED');
      const giris = await voucher({ type: 'TREASURY_IN', treasuryAccountId: banka.try.id, amount: '250', description: 'Banka faizi' });
      const voided = await boss(() => vouchers.voidVoucher(hotelId, giris.voucher.id, { reason: 'Yanlış hesap' }));
      assert.equal(voided.voucher.status, 'VOIDED');
      assert.equal(await treasuryBalance(banka.try.id), '1500.00');
      await rejectsWith(boss(() => vouchers.voidVoucher(hotelId, giris.voucher.id, { reason: 'İkinci kez' })), 'VOUCHER_STATUS');
    });

    it('eşik üstü ödeme fişi dört gözle: isteyen onaylayamaz; onayda işlenir, retde hiç işlenmez; onay anında kasa yetmezse işlenmez', async () => {
      const kasap = (await company('Kasap Ltd.')).account;
      await opening({ treasuryAccountId: banka.try.id, amount: '100000' });
      await opening({ treasuryAccountId: kasa.try.id, amount: '20000' });
      const settings = await boss(() => treasury.getSettings(hotelId));
      await boss(() => treasury.saveSettings(hotelId, contracts.accountingSettingsSchema.parse({ expectedUpdatedAt: settings.settings.updatedAt, startDate: D(0), paymentApprovalAmount: '10000' })));
      const big = await voucher({ type: 'PAYMENT', ledgerAccountId: kasap.id, lines: [{ kind: 'TREASURY', amount: '12000', treasuryAccountId: banka.try.id }] }, MANAGER);
      assert.equal(big.voucher.status, 'PENDING_APPROVAL');
      assert.equal(await treasuryBalance(banka.try.id), '100000.00', 'onay beklerken hiçbir şey yazılmaz');
      await rejectsWith(boss(() => approvals.decideApproval(hotelId, big.voucher.approvalId, 'GRANTED', { note: 'Kendime' })), 'SELF_DECISION');
      await as(MANAGER2, () => approvals.decideApproval(hotelId, big.voucher.approvalId, 'GRANTED', { note: 'Uygun' }));
      const posted = await as(ACCOUNTING, () => vouchers.getVoucher(hotelId, big.voucher.id));
      assert.equal(posted.voucher.status, 'POSTED');
      assert.equal(posted.voucher.approvedBy, MANAGER2);
      assert.equal(await treasuryBalance(banka.try.id), '88000.00');
      assert.equal(await ledgerBalance(kasap.id), '12000.00');

      const denied = await voucher({ type: 'PAYMENT', ledgerAccountId: kasap.id, lines: [{ kind: 'TREASURY', amount: '15000', treasuryAccountId: banka.try.id }] }, MANAGER);
      await as(MANAGER2, () => approvals.decideApproval(hotelId, denied.voucher.approvalId, 'DENIED', { note: 'Fatura gelmedi' }));
      assert.equal((await db.accountingVoucher.findUnique({ where: { id: denied.voucher.id } })).status, 'DECLINED');
      assert.equal(await treasuryBalance(banka.try.id), '88000.00');

      // Onay beklerken kasa harcandı: onaylansa da işlenmez, isteyene sebep gider.
      const cash = await voucher({ type: 'PAYMENT', ledgerAccountId: kasap.id, lines: [{ kind: 'TREASURY', amount: '18000', treasuryAccountId: kasa.try.id }] }, MANAGER);
      await voucher({ type: 'TREASURY_OUT', treasuryAccountId: kasa.try.id, amount: '5000', description: 'Masraf' });
      await as(MANAGER2, () => approvals.decideApproval(hotelId, cash.voucher.approvalId, 'GRANTED', { note: 'Uygun' }));
      assert.equal((await db.accountingVoucher.findUnique({ where: { id: cash.voucher.id } })).status, 'DECLINED');
      assert.equal(await treasuryBalance(kasa.try.id), '15000.00');
      const alert = await db.staffAlert.findFirst({ where: { hotelId, entityId: cash.voucher.approvalId } });
      assert.match(alert.body, /yeterli bakiye yok/);
    });

    it('aynı istek kimliği tek fiş; eşzamanlı iki kasa çıkışından biri geçer; aynı çek iki fişte ciro edilemez', async () => {
      const demir = (await company()).account;
      await opening({ treasuryAccountId: kasa.try.id, amount: '1000' });
      const requestId = randomUUID();
      const body = { requestId, type: 'TREASURY_IN', treasuryAccountId: kasa.try.id, amount: '10', date: D(0), description: 'Çift tıklama' };
      const both = await Promise.all([1, 2].map(() => as(ACCOUNTING, () => vouchers.createVoucher(hotelId, contracts.voucherCreateSchema.parse(body)))));
      assert.equal(both[0].voucher.id, both[1].voucher.id);
      assert.equal(await treasuryBalance(kasa.try.id), '1010.00');

      const results = await Promise.allSettled([1, 2].map(() => voucher({ type: 'TREASURY_OUT', treasuryAccountId: kasa.try.id, amount: '700' })));
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.match(results.find((result) => result.status === 'rejected').reason.message, /yeterli bakiye yok/);
      assert.equal(await treasuryBalance(kasa.try.id), '310.00');

      await voucher({ type: 'COLLECTION', ledgerAccountId: demir.id, lines: [{ kind: 'CHEQUE_IN', amount: '2000', instrumentKind: 'NOTE', number: 'SNT-1', dueDate: D(60) }] });
      const note = await db.instrument.findFirst({ where: { hotelId, number: 'SNT-1' } });
      const s1 = (await company('Sebzeci')).account;
      const s2 = (await company('Balıkçı')).account;
      const race = await Promise.allSettled([s1, s2].map((account) => voucher({ type: 'PAYMENT', ledgerAccountId: account.id, lines: [{ kind: 'ENDORSE', amount: '2000', instrumentId: note.id }] })));
      assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal((await db.instrument.findUnique({ where: { id: note.id } })).status, 'ENDORSED');
    });
  });

  describe('çek / senet', () => {
    it('alınan: tahsile ver → tahsil (banka girer); karşılıksız müşteriyi yeniden borçlandırır; ciro edilen dönerse tedarikçiye borcumuz geri doğar', async () => {
      const demir = (await company()).account;
      const tedarik = (await company('Tedarik A.Ş.')).account;
      await voucher({
        type: 'COLLECTION',
        ledgerAccountId: demir.id,
        lines: [
          { kind: 'CHEQUE_IN', amount: '4000', instrumentKind: 'CHEQUE', number: 'A-1', bankName: 'Akbank', dueDate: D(10) },
          { kind: 'CHEQUE_IN', amount: '3000', instrumentKind: 'CHEQUE', number: 'A-2', bankName: 'Akbank', dueDate: D(20) },
          { kind: 'CHEQUE_IN', amount: '2000', instrumentKind: 'CHEQUE', number: 'A-3', bankName: 'Akbank', dueDate: D(-3) },
        ],
      });
      assert.equal(await ledgerBalance(demir.id), '-9000.00');
      const [a1, a2, a3] = await Promise.all(['A-1', 'A-2', 'A-3'].map((number) => db.instrument.findFirst({ where: { hotelId, number } })));
      const act = (instrument, action, extra = {}) =>
        as(ACCOUNTING, async () => {
          const current = await db.instrument.findUnique({ where: { id: instrument.id } });
          return instruments.applyInstrumentAction(hotelId, instrument.id, contracts.instrumentActionSchema.parse({ expectedUpdatedAt: current.updatedAt, action, date: D(0), ...extra }));
        });
      await rejectsWith(act(a1, 'DEPOSIT', { treasuryAccountId: kasa.try.id }), 'VALIDATION', /yalnız banka/);
      await act(a1, 'DEPOSIT', { treasuryAccountId: banka.try.id });
      assert.equal(await treasuryBalance(banka.try.id), '0.00', 'tahsile vermek para girmesi değildir');
      const collected = await act(a1, 'COLLECT');
      assert.equal(collected.instrument.status, 'COLLECTED');
      assert.equal(await treasuryBalance(banka.try.id), '4000.00');
      await act(a2, 'BOUNCE', { note: 'Karşılıksız' });
      assert.equal(await ledgerBalance(demir.id), '-6000.00');
      await voucher({ type: 'PAYMENT', ledgerAccountId: tedarik.id, lines: [{ kind: 'ENDORSE', amount: '2000', instrumentId: a3.id }] });
      assert.equal(await ledgerBalance(tedarik.id), '2000.00');
      await act(a3, 'BOUNCE');
      assert.deepEqual([await ledgerBalance(tedarik.id), await ledgerBalance(demir.id)], ['0.00', '-4000.00']);
      const detail = await as(ACCOUNTING, () => instruments.getInstrument(hotelId, a3.id));
      assert.deepEqual(detail.movements.map((movement) => movement.action), ['RECEIVE', 'ENDORSE', 'BOUNCE']);
      await rejectsWith(act(a1, 'BOUNCE'), 'INSTRUMENT_ACTION');
      const list = await as(ACCOUNTING, () => instruments.listInstruments(hotelId, contracts.instrumentListQuerySchema.parse({ status: 'OPEN' })));
      assert.equal(list.meta.total, 0);
    });

    it('verilen çek "ödenecek" olur, vadesinde bankadan ödenir; kartın sürüm damgası eski ekranı durdurur', async () => {
      const tedarik = (await company('Tedarik A.Ş.')).account;
      await opening({ treasuryAccountId: banka.try.id, amount: '50000' });
      await rejectsWith(
        voucher({ type: 'PAYMENT', ledgerAccountId: tedarik.id, lines: [{ kind: 'CHEQUE_OUT', amount: '8000', instrumentKind: 'CHEQUE', number: 'Z-77', bankName: 'Ziraat', dueDate: D(-1), treasuryAccountId: banka.try.id }] }),
        'VALIDATION',
        /fiş gününden önce/,
      );
      await voucher({ type: 'PAYMENT', ledgerAccountId: tedarik.id, lines: [{ kind: 'CHEQUE_OUT', amount: '8000', instrumentKind: 'CHEQUE', number: 'Z-77', bankName: 'Ziraat', dueDate: D(15), treasuryAccountId: banka.try.id }] });
      const issued = await db.instrument.findFirst({ where: { hotelId, number: 'Z-77' } });
      assert.equal(issued.status, 'OUTSTANDING');
      assert.equal(await treasuryBalance(banka.try.id), '50000.00', 'çek verildiğinde banka henüz çıkmaz');
      const stale = issued.updatedAt;
      await as(ACCOUNTING, () => instruments.applyInstrumentAction(hotelId, issued.id, contracts.instrumentActionSchema.parse({ expectedUpdatedAt: stale, action: 'PAY', date: D(0) })));
      assert.equal(await treasuryBalance(banka.try.id), '42000.00');
      await rejectsWith(as(ACCOUNTING, () => instruments.applyInstrumentAction(hotelId, issued.id, contracts.instrumentActionSchema.parse({ expectedUpdatedAt: stale, action: 'PAY', date: D(0) }))), 'INSTRUMENT_ACTION');
    });
  });

  /* ═══════════════ Ekstre, yaşlandırma, liste ═══════════════ */

  describe('ekstre ve yaşlandırma', () => {
    it('devir, yürüyen bakiye ve imleçli sayfa; FIFO yaşlandırma elle hesaplanmış dilimlerle', async () => {
      const demir = (await company()).account;
      const settings = await boss(() => treasury.getSettings(hotelId));
      await boss(() => treasury.saveSettings(hotelId, contracts.accountingSettingsSchema.parse({ expectedUpdatedAt: settings.settings.updatedAt, startDate: D(-100), paymentApprovalAmount: '50000' })));
      await opening({ ledgerAccountId: demir.id, side: 'DEBIT', amount: '1000', dueDate: D(-100) });
      await opening({ treasuryAccountId: kasa.try.id, amount: '100' });
      // Borçlar: 100 gün önce vadeli 1.000 (açılış), 45 gün önce vadeli 2.000, 10 gün sonra vadeli 3.000; tahsilat 1.500.
      const { postLedger } = await import('./shared.js');
      await db.$transaction((tx) => as(ACCOUNTING, () => postLedger(tx, { hotelId, accountId: demir.id, date: D(-60), dueDate: D(-45), debit: '2000', description: 'Kongre bedeli', sourceType: 'VOUCHER', sourceId: randomUUID(), sourceKey: `TEST:${randomUUID()}` })));
      await db.$transaction((tx) => as(ACCOUNTING, () => postLedger(tx, { hotelId, accountId: demir.id, date: D(-5), dueDate: D(10), debit: '3000', description: 'Toplantı bedeli', sourceType: 'VOUCHER', sourceId: randomUUID(), sourceKey: `TEST:${randomUUID()}` })));
      await voucher({ type: 'COLLECTION', ledgerAccountId: demir.id, date: D(-2), lines: [{ kind: 'TREASURY', amount: '1500', treasuryAccountId: kasa.try.id }] });
      assert.equal(await ledgerBalance(demir.id), '4500.00');
      const card = await as(ACCOUNTING, () => accounts.getAccount(hotelId, demir.id));
      // FIFO: 4.500 = 3.000 (vadesi gelmemiş) + 1.500 / 2.000'lik (45 gün gecikmiş → 31–60).
      assert.deepEqual(card.aging.buckets, { NOT_DUE: '3000.00', D30: '0.00', D60: '1500.00', D90: '0.00', D90_PLUS: '0.00' });
      assert.equal(card.aging.overdue, '1500.00');

      const statement = (query) => as(ACCOUNTING, () => accounts.getStatement(hotelId, demir.id, contracts.statementQuerySchema.parse(query)));
      const full = await statement({ from: D(-30), to: D(0) });
      assert.equal(full.opening, '3000.00', 'devir: açılış 1.000 + 2.000');
      assert.deepEqual(full.items.map((row) => row.balance), ['6000.00', '4500.00']);
      assert.equal(full.closing, '4500.00');
      const first = await statement({ from: D(-200), to: D(0), limit: 2 });
      assert.equal(first.items.length, 2);
      assert.ok(first.nextCursor);
      assert.deepEqual(first.items.map((row) => row.balance), ['1000.00', '3000.00']);
      const second = await statement({ from: D(-200), to: D(0), limit: 2, cursor: first.nextCursor });
      assert.deepEqual(second.items.map((row) => row.balance), ['6000.00', '4500.00'], 'ikinci sayfa ilk sayfanın bakiyesinden yürür');
      assert.equal(second.nextCursor, null);
      assert.equal(second.items.at(-1).balance, full.closing);
      assert.deepEqual([second.opening, second.totals, second.closing], [null, null, null], 'devir ve toplamlar yalnız ilk sayfada');

      // Kasa: açılış 100 + tahsilat 1.500; imleçli ikinci sayfa ilk sayfanın bakiyesinden yürür.
      const movements = (query) => as(ACCOUNTING, () => treasury.listMovements(hotelId, kasa.try.id, contracts.treasuryMovementsQuerySchema.parse(query)));
      const page1 = await movements({ from: D(-200), to: D(0), limit: 1 });
      assert.deepEqual([page1.items.map((row) => row.balance), page1.closing, page1.totals.count], [['100.00'], '1600.00', 2]);
      const page2 = await movements({ from: D(-200), to: D(0), limit: 1, cursor: page1.nextCursor });
      assert.deepEqual([page2.items.map((row) => row.balance), page2.totals, page2.nextCursor], [['1600.00'], null, null]);

      const report = await as(ACCOUNTING, () => accounts.agingReport(hotelId, contracts.agingQuerySchema.parse({ side: 'DEBIT' })));
      assert.equal(report.items.length, 1);
      assert.deepEqual(report.items[0].buckets, card.aging.buckets);
      assert.equal(report.totals.open, '4500.00');
      const beyond = await as(ACCOUNTING, () => accounts.agingReport(hotelId, contracts.agingQuerySchema.parse({ side: 'DEBIT', page: 3 })));
      assert.deepEqual([beyond.items.length, beyond.meta.total, beyond.totals.open], [0, 1, '4500.00'], 'sayfa aralık dışındayken de toplam doğru');
      const payable = await as(ACCOUNTING, () => accounts.agingReport(hotelId, contracts.agingQuerySchema.parse({ side: 'CREDIT' })));
      assert.deepEqual([payable.items.length, payable.totals.open], [0, '0.00']);

      const list = await as(ACCOUNTING, () => accounts.listAccounts(hotelId, contracts.ledgerAccountListQuerySchema.parse({ balance: 'DEBIT', sort: 'balance' })));
      assert.equal(list.items[0].id, demir.id);
      assert.equal(list.totals.receivable, '4500.00');
    });
  });

  /* ═══════════════ İzinler ve otel kapsamı ═══════════════ */

  describe('izinler ve otel kapsamı', () => {
    it('ön büro muhasebeyi göremez ama cari seçiciyi kullanır; muhasebe fiş girer, iptal edemez; başka otelin hesabı yok', async () => {
      const demir = (await company()).account;
      assert.equal((await call('GET', '/accounting/accounts', DESK)).statusCode, 403);
      const picker = await call('GET', '/accounting/accounts/picker?search=Demir', DESK);
      assert.equal(picker.statusCode, 200, picker.body);
      assert.equal(picker.json().data[0].id, demir.id);
      const created = await call('POST', '/accounting/vouchers', ACCOUNTING, { requestId: randomUUID(), type: 'TREASURY_IN', treasuryAccountId: kasa.try.id, amount: '100', date: D(0), description: 'Kasa girişi' });
      assert.equal(created.statusCode, 201, created.body);
      const voidAttempt = await call('POST', `/accounting/vouchers/${created.json().data.voucher.id}/void`, ACCOUNTING, { reason: 'Muhasebe iptal edemez' });
      assert.equal(voidAttempt.statusCode, 403);
      assert.equal((await call('POST', '/accounting/treasury', ACCOUNTING, { kind: 'CASH', name: 'Yeni kasa', currency: 'TRY' })).statusCode, 403);
      const badIban = await call('POST', '/accounting/treasury', MANAGER, { kind: 'BANK', name: 'Hatalı', currency: 'TRY', bankName: 'X', iban: 'TR000001000000000012345678' });
      assert.equal(badIban.statusCode, 400);

      const foreign = await db.ledgerAccount.create({ data: { hotelId: otherHotelId, code: 'SRK-0001', name: 'Başka otelin carisi', type: 'COMPANY', createdBy: MANAGER } });
      assert.equal((await call('GET', `/accounting/accounts/${foreign.id}`, ACCOUNTING)).statusCode, 404);
      await rejectsWith(voucher({ type: 'COLLECTION', ledgerAccountId: foreign.id, lines: [{ kind: 'TREASURY', amount: '1', treasuryAccountId: kasa.try.id }] }), 'VOUCHER_NOT_POSTABLE', /Cari bulunamadı/);
      const foreignKasa = await db.treasuryAccount.create({ data: { hotelId: otherHotelId, kind: 'CASH', code: 'KSA-0001', name: 'Başka kasa', currency: 'TRY', createdBy: MANAGER } });
      await rejectsWith(voucher({ type: 'TREASURY_IN', treasuryAccountId: foreignKasa.id, amount: '1' }), 'VOUCHER_NOT_POSTABLE', /bulunamadı/);
    });

    it('bakiyesi olan cari ve kasa kullanımdan kaldırılamaz; hareket görmüş kasanın para birimi değişmez', async () => {
      const demir = (await company()).account;
      await opening({ ledgerAccountId: demir.id, side: 'DEBIT', amount: '10' });
      const card = await as(ACCOUNTING, () => accounts.getAccount(hotelId, demir.id));
      await rejectsWith(
        as(ACCOUNTING, () => accounts.updateAccount(hotelId, demir.id, contracts.ledgerAccountUpdateSchema.parse({ expectedUpdatedAt: card.account.updatedAt, name: demir.name, isActive: false }))),
        'ACCOUNT_HAS_BALANCE',
      );
      await opening({ treasuryAccountId: kasa.try.id, amount: '5' });
      const kasaCard = await boss(() => treasury.getTreasuryAccount(hotelId, kasa.try.id));
      await rejectsWith(
        boss(() => treasury.updateTreasuryAccount(hotelId, kasa.try.id, contracts.treasuryAccountUpdateSchema.parse({ expectedUpdatedAt: kasaCard.account.updatedAt, kind: 'CASH', name: 'Ön büro kasası', currency: 'EUR' }))),
        'TREASURY_LOCKED_FIELDS',
      );
    });
  });
});
