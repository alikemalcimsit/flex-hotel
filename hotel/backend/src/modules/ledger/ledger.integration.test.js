import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Genel muhasebe (modül 48) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: Tek Düzen hesap planının ilk kullanımda yüklenmesi (kasa / banka alt hesapları, varsayılan kurallar, alt
 * hesabı olan ana hesap satır almaz); ön muhasebe kayıtlarının aktör zinciriyle (ödeme → 47 → `accounting.posted` →
 * 48) yevmiye fişine dönmesi (nakit tahsilat, acente aktarımı, döviz kasası kur çevrimi, tahsilat fişi + çek,
 * mal kabul KDV ayrımı, fiş iptalinin ters kaydı, çek tahsili); günlük gelir fişi ve farkla düzeltme; elle fiş
 * (denge, çift gönderim, ana hesap reddi) ve iptali; mizan devir / dönem / kapanış ve ağaç toplamı; hesap ekstresi
 * yürüyen bakiye; kural değişikliği ve varsayılana dönüş; eksik kural → manuel görev → eşitleme; dönem kilidi; izinler.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'mudur@test.local';
const ACCOUNTING = 'muhasebe@test.local';
const DESK = 'onburo@test.local';
const TC = '10000000146';

describe('genel muhasebe (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let treasury;
  /** @type {any} */ let vouchers;
  /** @type {any} */ let instruments;
  /** @type {any} */ let postings;
  /** @type {any} */ let payments;
  /** @type {any} */ let folios;
  /** @type {any} */ let chart;
  /** @type {any} */ let journals;
  /** @type {any} */ let journalize;
  /** @type {any} */ let settings;
  /** @type {any} */ let trial;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
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
    treasury = await import('../accounting/treasury.js');
    vouchers = await import('../accounting/vouchers.js');
    instruments = await import('../accounting/instruments.js');
    postings = await import('../accounting/postings.js');
    payments = await import('../payments/service.js');
    folios = await import('../folios/service.js');
    chart = await import('./chart.js');
    journals = await import('./journals.js');
    journalize = await import('./journalize.js');
    settings = await import('./settings.js');
    trial = await import('./trial-balance.js');
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
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: ACCOUNTING, name: 'Muhasebe', role: 'ACCOUNTING', passwordHash },
        { hotelId, email: DESK, name: 'Ön Büro', role: 'FRONT_DESK', passwordHash },
      ],
    });
    await db.tax.create({ data: { hotelId, name: 'KDV %10', rate: '10', isIncluded: true, appliesTo: ['ROOM', 'FNB', 'MINIBAR', 'OTHER'] } });
    agency = await db.agency.create({ data: { hotelId, code: 'TATIL', name: 'Tatil Acentesi', taxNumber: '1111111111', paymentTermDays: 30, createdBy: MANAGER } });
    roomType = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 3, capacityChildren: 1 } });
    room = await db.room.create({ data: { hotelId, number: '101', roomTypeId: roomType.id } });
    const newTreasury = (input) => boss(() => treasury.createTreasuryAccount(hotelId, contracts.treasuryAccountCreateSchema.parse(input)));
    kasa = { try: (await newTreasury({ kind: 'CASH', name: 'Ön büro kasası', currency: 'TRY' })).account, eur: (await newTreasury({ kind: 'CASH', name: 'Döviz kasası', currency: 'EUR' })).account };
    banka = { try: (await newTreasury({ kind: 'BANK', name: 'Ziraat TL', currency: 'TRY', bankName: 'Ziraat Bankası' })).account };
    const current = await boss(() => treasury.getSettings(hotelId));
    await boss(() =>
      treasury.saveMappings(
        hotelId,
        contracts.treasuryMappingSchema.parse({
          expectedUpdatedAt: current.mappingUpdatedAt,
          rows: [
            { channel: 'FRONT_DESK', method: 'CASH', currency: '', treasuryAccountId: kasa.try.id },
            { channel: 'FRONT_DESK', method: 'CASH', currency: 'EUR', treasuryAccountId: kasa.eur.id },
            { channel: 'FRONT_DESK', method: 'CARD', currency: '', treasuryAccountId: banka.try.id },
          ],
        }),
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

  /* ── Yardımcılar ── */

  const accountByCode = async (code) => db.glAccount.findFirst({ where: { hotelId, code } });
  const journalsOf = (source) => db.journalEntry.findMany({ where: { hotelId, ...(source ? { source } : {}) }, include: { lines: { include: { account: true }, orderBy: { sortOrder: 'asc' } } }, orderBy: { createdAt: 'asc' } });
  /** Fişin satırları "kod:borç/alacak" biçiminde (okunur karşılaştırma). @param {any} entry */
  const picture = (entry) => entry.lines.map((line) => `${line.account.code}:${money(line.debit)}/${money(line.credit)}`).sort();

  const newCompany = async (name = 'Demir Holding A.Ş.') => {
    const accounts = await import('../accounting/accounts.js');
    return (await as(ACCOUNTING, () => accounts.createAccount(hotelId, contracts.ledgerAccountCreateSchema.parse({ type: 'COMPANY', name, taxNumber: '2222222222', paymentTermDays: 15 })))).account;
  };
  const voucher = (input, email = ACCOUNTING) => as(email, () => vouchers.createVoucher(hotelId, contracts.voucherCreateSchema.parse({ requestId: randomUUID(), date: D(0), description: 'Test fişi', ...input })));

  /** İçerideki konaklama, folyosu açık, `charges` tutarında harcama (KDV %10 dahil). */
  async function seedStay({ agencyId = agency.id, charges = '2200.00' } = {}) {
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
    if (charges) await as(DESK, () => folios.postCharge(hotelId, folio.id, contracts.postChargeSchema.parse({ requestId: randomUUID(), type: 'OTHER', description: 'Hizmet', amount: charges, quantity: 1 })));
    return { stay, folio };
  }
  const pay = (folioId, body, email = DESK) => as(email, () => payments.receivePayment(hotelId, folioId, contracts.receivePaymentSchema.parse({ requestId: randomUUID(), method: 'CASH', ...body })));

  /* ═══════════════ Hesap planı ═══════════════ */

  describe('hesap planı', () => {
    it('ilk kullanımda Tek Düzen + otel alt hesapları + kasa / banka alt hesapları + varsayılan kurallar yüklenir; alt hesabı olan ana hesap satır almaz', async () => {
      const list = await as(ACCOUNTING, () => chart.listChart(hotelId, {}));
      assert.ok(list.accounts.length > 300, `yalnız ${list.accounts.length} hesap`);
      assert.ok(list.seededAt);
      const codes = new Map(list.accounts.map((row) => [row.code, row]));
      assert.equal(codes.get('100').isPostable, false, 'kasa alt hesapları var');
      assert.equal(codes.get('100.01').name, 'Ön büro kasası (TRY)');
      assert.equal(codes.get('100.02').name, 'Döviz kasası (EUR)');
      assert.equal(codes.get('102.01').name, 'Ziraat TL (TRY)');
      assert.equal(codes.get('120').isPostable, false);
      assert.equal(codes.get('120.01').isPostable, true);
      assert.equal(codes.get('600.01').department, 'ROOMS');
      assert.equal(codes.get('770').isPostable, true);
      assert.deepEqual([codes.get('1').depth, codes.get('10').depth, codes.get('100').depth, codes.get('100.01').depth], [0, 1, 2, 3]);
      // Sıra: 1, 10, 100, 100.01, 100.02, 101, 102, 102.01 …
      assert.deepEqual(list.accounts.slice(0, 8).map((row) => row.code), ['1', '10', '100', '100.01', '100.02', '101', '102', '102.01']);
      const rules = await as(ACCOUNTING, () => settings.getRules(hotelId));
      const treasuryRules = rules.rules.filter((rule) => rule.source === 'TREASURY');
      assert.equal(treasuryRules.length, 3);
      assert.ok(rules.rules.find((rule) => rule.source === 'REVENUE' && rule.key === 'ROOM' && rule.account.code === '600.01' && rule.isDefault));
      // Yeniden yükleme bir şey eklemez.
      const again = await boss(() => chart.seedChart(hotelId));
      assert.deepEqual(again, { created: 0, rules: 0 });
    });

    it('hesap açma: kod üst hesabı belirler, üst yoksa reddedilir, satırı olan hesaba alt hesap açılamaz; seçici ve düzenleme', async () => {
      await as(ACCOUNTING, () => chart.listChart(hotelId, {}));
      const created = await boss(() => chart.createAccount(hotelId, contracts.glAccountCreateSchema.parse({ code: '770.01', name: 'Elektrik', department: 'UNDISTRIBUTED' })));
      assert.equal(created.account.class, 'COST');
      assert.equal(created.account.depth, 3);
      assert.equal((await accountByCode('770')).isPostable, false, 'alt hesap açılınca ana hesap satır almaz');
      await rejectsWith(boss(() => chart.createAccount(hotelId, contracts.glAccountCreateSchema.parse({ code: '855.01', name: 'Yok', department: null }))), 'VALIDATION', /Üst hesap yok/);
      await rejectsWith(boss(() => chart.createAccount(hotelId, contracts.glAccountCreateSchema.parse({ code: '770.01', name: 'Tekrar', department: null }))), 'DUPLICATE', /zaten var/);
      // Satırı olan hesaba alt hesap açılamaz.
      const kasaHesabi = await accountByCode('100.01');
      const elektrik = await accountByCode('770.01');
      await as(ACCOUNTING, () => journals.createManualJournal(hotelId, contracts.journalCreateSchema.parse({ requestId: randomUUID(), date: D(0), description: 'Elektrik faturası', lines: [{ accountId: elektrik.id, debit: '500.00' }, { accountId: kasaHesabi.id, credit: '500.00' }] })));
      await rejectsWith(boss(() => chart.createAccount(hotelId, contracts.glAccountCreateSchema.parse({ code: '770.01.1', name: 'Alt', department: null }))), 'GL_PARENT_HAS_LINES');
      const picked = await as(ACCOUNTING, () => chart.pickAccounts(hotelId, { search: '77' }));
      assert.ok(picked.items.every((item) => item.code.startsWith('77')));
      assert.ok(!picked.items.some((item) => item.code === '770'), 'ana hesap seçiciye gelmez');
      const popular = await as(ACCOUNTING, () => chart.pickAccounts(hotelId, {}));
      assert.equal(popular.items[0].code, '100.01', 'boş aramada en çok kullanılan önce');
      const updated = await boss(() => chart.updateAccount(hotelId, elektrik.id, contracts.glAccountUpdateSchema.parse({ expectedUpdatedAt: created.account.updatedAt, name: 'Elektrik ve su', department: 'UNDISTRIBUTED', isActive: true })));
      assert.equal(updated.account.name, 'Elektrik ve su');
      await rejectsWith(boss(() => chart.updateAccount(hotelId, elektrik.id, contracts.glAccountUpdateSchema.parse({ expectedUpdatedAt: created.account.updatedAt, name: 'Eski', department: null, isActive: true }))), 'STALE_WRITE');
    });
  });

  /* ═══════════════ Otomatik fişler ═══════════════ */

  describe('otomatik fişler (aktör zinciri)', () => {
    it('nakit tahsilat kasa / misafir hesabı; acente aktarımı acente / misafir; döviz kasası folyo karşılığıyla; kayıtlar fişe bağlanır', async () => {
      await boss(() => payments.setTodayRates(hotelId, contracts.exchangeRatesInputSchema.parse({ rates: [{ currency: 'EUR', rate: '36.5' }] })));
      const { folio } = await seedStay();
      await pay(folio.id, { method: 'CASH', amount: '1000' });
      await pay(folio.id, { method: 'AGENCY', amount: '4000' });
      await pay(folio.id, { method: 'CASH', amount: '50', currency: 'EUR', expectedRate: '36.5' });
      const entries = await journalsOf();
      assert.deepEqual(entries.map((entry) => entry.source), ['FOLIO_PAYMENT', 'FOLIO_TRANSFER', 'FOLIO_PAYMENT']);
      assert.deepEqual(picture(entries[0]), ['100.01:1000.00/0.00', '120.01:0.00/1000.00']);
      assert.deepEqual(picture(entries[1]), ['120.01:0.00/4000.00', '120.02:4000.00/0.00']);
      assert.deepEqual(picture(entries[2]), ['100.02:1825.00/0.00', '120.01:0.00/1825.00'], 'EUR kasa hareketi folyo karşılığıyla (TRY)');
      assert.match(entries[0].number, /^YEV-\d{4}-00001$/);
      assert.equal(entries[0].type, 'AUTO');
      assert.equal(entries[0].createdBy, 'accounting-worker');
      assert.match(entries[0].description, /Ön büro tahsilatı · Folyo tahsilatı · 101 · Ayşe Demir · Nakit/);
      const movements = await db.treasuryMovement.findMany({ where: { hotelId } });
      assert.ok(movements.every((row) => row.journalEntryId), 'her kasa hareketi fişe bağlı');
      const transfer = await db.ledgerEntry.findFirst({ where: { hotelId, sourceType: 'FOLIO_TRANSFER' } });
      assert.equal(transfer.journalEntryId, entries[1].id);
      assert.equal(entries[1].lines.find((line) => line.account.code === '120.02').ledgerAccountId, transfer.accountId, 'cari izi satırda');
      // Aynı kaynağa ikinci çağrı yeni fiş yazmaz.
      const again = await journalize.journalizeSource(hotelId, transfer.sourceId);
      assert.equal(again.posted, false);
      assert.equal((await journalsOf()).length, 3);
    });

    it('tahsilat fişi (nakit + çek) ve iptali; çek tahsili; carisiz çıkış fişinde seçilen karşı hesap', async () => {
      await as(ACCOUNTING, () => chart.listChart(hotelId, {}));
      const demir = await newCompany();
      const tahsilat = await voucher({
        type: 'COLLECTION',
        ledgerAccountId: demir.id,
        lines: [
          { kind: 'TREASURY', amount: '3000', treasuryAccountId: kasa.try.id },
          { kind: 'CHEQUE_IN', amount: '5000', instrumentKind: 'CHEQUE', number: '1000123', bankName: 'Garanti BBVA', drawer: 'Demir Holding', dueDate: D(30) },
        ],
      });
      let entries = await journalsOf('VOUCHER');
      assert.equal(entries.length, 1);
      assert.deepEqual(picture(entries[0]), ['100.01:3000.00/0.00', '101:5000.00/0.00', '120.03:0.00/8000.00']);
      assert.equal(entries[0].sourceId, tahsilat.voucher.id);
      // Çek tahsile verilir (kayıt yok, fiş yok), sonra tahsil edilir: banka / alınan çekler.
      const cheque = await db.instrument.findFirst({ where: { hotelId, number: '1000123' } });
      const act = async (instrument, action, extra = {}) => {
        const current = await db.instrument.findUnique({ where: { id: instrument.id } });
        return as(ACCOUNTING, () => instruments.applyInstrumentAction(hotelId, instrument.id, contracts.instrumentActionSchema.parse({ expectedUpdatedAt: current.updatedAt, action, date: D(0), ...extra })));
      };
      await act(cheque, 'DEPOSIT', { treasuryAccountId: banka.try.id });
      assert.equal((await journalsOf('INSTRUMENT')).length, 0, 'tahsile vermek para hareketi değil');
      await act(cheque, 'COLLECT');
      const [collected] = await journalsOf('INSTRUMENT');
      assert.deepEqual(picture(collected), ['101:0.00/5000.00', '102.01:5000.00/0.00']);
      // Carisiz çıkış: fişte seçilen masraf hesabı karşı hesap olur; seçilmezse kural (770).
      const elektrik = (await boss(() => chart.createAccount(hotelId, contracts.glAccountCreateSchema.parse({ code: '770.01', name: 'Elektrik', department: null })))).account;
      const cikis = await voucher({ type: 'TREASURY_OUT', treasuryAccountId: kasa.try.id, amount: '750', glAccountId: elektrik.id, description: 'Elektrik faturası' });
      assert.equal(cikis.voucher.glAccount.code, '770.01');
      const giris = await voucher({ type: 'TREASURY_IN', treasuryAccountId: kasa.try.id, amount: '120', description: 'Banka faizi' });
      entries = await journalsOf('VOUCHER');
      assert.deepEqual(picture(entries[1]), ['100.01:0.00/750.00', '770.01:750.00/0.00']);
      assert.deepEqual(picture(entries[2]), ['100.01:120.00/0.00', '649:0.00/120.00']);
      // Fiş iptali: ters kayıtlar ayrı fiş (ters kayıt), orijinal fiş dokunulmaz.
      await boss(() => vouchers.voidVoucher(hotelId, giris.voucher.id, { reason: 'Yanlış hesap' }));
      entries = await journalsOf('VOUCHER');
      assert.equal(entries.length, 4);
      assert.deepEqual(picture(entries[3]), ['100.01:0.00/120.00', '649:120.00/0.00']);
      assert.match(entries[3].description, /ters kayıt/);
      assert.equal(entries[2].status, 'POSTED', 'ön muhasebe iptali yevmiye fişini iptal etmez; ters fiş yazar');
      await rejectsWith(voucher({ type: 'TREASURY_OUT', treasuryAccountId: kasa.try.id, amount: '10', glAccountId: (await accountByCode('770')).id }), 'VALIDATION', /satır alamaz/);
    });

    it('mal kabul: tedarikçi carisi alacak, stok + oran bazında indirilecek KDV borç', async () => {
      const supplier = await db.supplier.create({ data: { hotelId, name: 'Anadolu Süt', paymentTermDays: 45, createdBy: MANAGER } });
      const warehouse = await db.warehouse.create({ data: { hotelId, code: 'ANA', name: 'Ana depo', createdBy: MANAGER } });
      const order = await db.purchaseOrder.create({
        data: { hotelId, number: 'SAS-2026-0001', supplierId: supplier.id, status: 'RECEIVED', expectedOn: new Date(`${D(0)}T00:00:00.000Z`), paymentTermDays: 45, currency: 'TRY', netTotal: '10000', taxTotal: '1300', grandTotal: '11300', createdBy: MANAGER },
      });
      const receipt = await db.goodsReceipt.create({
        data: { hotelId, number: 'MKB-2026-0001', orderId: order.id, supplierId: supplier.id, warehouseId: warehouse.id, waybillNumber: 'IRS-77', receivedOn: new Date(`${D(0)}T00:00:00.000Z`), netTotal: '10000', taxTotal: '1300', grandTotal: '11300', receivedBy: MANAGER },
      });
      const item = await db.stockItem.create({ data: { hotelId, code: 'SUT', name: 'Süt', group: 'DAIRY', unit: 'L', createdBy: MANAGER } });
      const orderLine = await db.purchaseOrderLine.create({ data: { hotelId, orderId: order.id, stockItemId: item.id, quantity: '100', unit: 'L', unitPrice: '100', taxRatePct: '10', netAmount: '10000', taxAmount: '1300', total: '11300', sortOrder: 1 } });
      await db.goodsReceiptLine.createMany({
        data: [
          { hotelId, receiptId: receipt.id, orderLineId: orderLine.id, stockItemId: item.id, quantity: '70', unitPrice: '100', taxRatePct: '10', netAmount: '7000', taxAmount: '700', total: '7700' },
          { hotelId, receiptId: receipt.id, orderLineId: orderLine.id, stockItemId: item.id, quantity: '30', unitPrice: '100', taxRatePct: '20', netAmount: '3000', taxAmount: '600', total: '3600' },
        ],
      });
      await as(ACCOUNTING, () => postings.syncGoodsReceipt(hotelId, receipt.id));
      const [entry] = await journalsOf('GOODS_RECEIPT');
      assert.deepEqual(picture(entry), ['150:10000.00/0.00', '191:1300.00/0.00', '320:0.00/11300.00'], 'oran bazında kural yok → hepsi 191');
      // Oran bazında KDV hesabı açılıp kural verilince ayrışır (yeni mal kabulde).
      const kdv20 = (await boss(() => chart.createAccount(hotelId, contracts.glAccountCreateSchema.parse({ code: '192.20', name: 'İndirilecek KDV %20', department: null })))).account;
      const kdv10 = (await boss(() => chart.createAccount(hotelId, contracts.glAccountCreateSchema.parse({ code: '192.10', name: 'İndirilecek KDV %10', department: null })))).account;
      await boss(() => settings.saveRules(hotelId, contracts.journalRulesSchema.parse({ rows: [{ source: 'VAT_INPUT', key: '20', accountId: kdv20.id }, { source: 'VAT_INPUT', key: '', accountId: kdv10.id }] })));
      const receipt2 = await db.goodsReceipt.create({
        data: { hotelId, number: 'MKB-2026-0002', orderId: order.id, supplierId: supplier.id, warehouseId: warehouse.id, waybillNumber: 'IRS-78', receivedOn: new Date(`${D(0)}T00:00:00.000Z`), netTotal: '10000', taxTotal: '1300', grandTotal: '11300', receivedBy: MANAGER },
      });
      await db.goodsReceiptLine.createMany({
        data: [
          { hotelId, receiptId: receipt2.id, orderLineId: orderLine.id, stockItemId: item.id, quantity: '70', unitPrice: '100', taxRatePct: '10', netAmount: '7000', taxAmount: '700', total: '7700' },
          { hotelId, receiptId: receipt2.id, orderLineId: orderLine.id, stockItemId: item.id, quantity: '30', unitPrice: '100', taxRatePct: '20', netAmount: '3000', taxAmount: '600', total: '3600' },
        ],
      });
      await as(ACCOUNTING, () => postings.syncGoodsReceipt(hotelId, receipt2.id));
      const [, second] = await journalsOf('GOODS_RECEIPT');
      assert.deepEqual(picture(second), ['150:10000.00/0.00', '192.10:700.00/0.00', '192.20:600.00/0.00', '320:0.00/11300.00']);
    });

    it('etkinlik bedeli: gerçekleşme ve iptal farkı ayrı fişler (anahtar çakışmaz); bordro yükümlülük carisine ödeme tahakkuk hesabını kapatır; aynı hesaba eşlenen iki kasa arası virman iz bırakır', async () => {
      await as(ACCOUNTING, () => chart.listChart(hotelId, {}));
      const client = await db.eventClient.create({ data: { hotelId, type: 'COMPANY', name: 'Yıldız Kongre Ltd.', taxNumber: '3333333333', createdBy: MANAGER } });
      const event = await db.event.create({
        data: { hotelId, code: 'ETK-2026-0001', name: 'Bayi toplantısı', type: 'MEETING', clientId: client.id, ownerEmail: MANAGER, expectedPax: 100, currency: 'TRY', createdBy: MANAGER, status: 'COMPLETED', grandTotal: '120000', netTotal: '120000', taxTotal: '0', definiteAt: new Date(), definiteBy: MANAGER, completedAt: new Date(), completedBy: MANAGER, actualPax: 100 },
      });
      await as(ACCOUNTING, () => postings.syncEventCharge(hotelId, event.id));
      await db.event.update({ where: { id: event.id }, data: { status: 'CANCELLED', cancellationFee: '20000', cancelledAt: new Date(), cancelledBy: MANAGER, cancelReason: 'Müşteri vazgeçti', completedAt: null, completedBy: null } });
      await as(ACCOUNTING, () => postings.syncEventCharge(hotelId, event.id));
      const charges = await journalsOf('EVENT_CHARGE');
      assert.equal(charges.length, 2, 'gerçekleşme ve iptal farkı ayrı fiş');
      assert.deepEqual(picture(charges[0]), ['120.03:120000.00/0.00', '600.06:0.00/120000.00']);
      assert.deepEqual(picture(charges[1]), ['120.03:0.00/100000.00', '600.06:100000.00/0.00']);
      assert.notEqual(charges[0].sourceKey, charges[1].sourceKey);
      assert.equal((await db.ledgerEntry.count({ where: { hotelId, sourceType: 'EVENT_CHARGE', journalEntryId: null } })), 0);

      // Bordro ayarındaki SGK carisine ödeme: 361 borç (136 değil).
      const accounts = await import('../accounting/accounts.js');
      const sgk = (await as(ACCOUNTING, () => accounts.createAccount(hotelId, contracts.ledgerAccountCreateSchema.parse({ type: 'OTHER', name: 'SGK (prim borcu)', paymentTermDays: 0 })))).account;
      await db.payrollSettings.create({ data: { hotelId, sgkLedgerAccountId: sgk.id } });
      await voucher({ type: 'TREASURY_IN', treasuryAccountId: kasa.try.id, amount: '5000', description: 'Açılış nakdi' });
      await voucher({ type: 'PAYMENT', ledgerAccountId: sgk.id, lines: [{ kind: 'TREASURY', amount: '1000', treasuryAccountId: kasa.try.id }] });
      const vouchersPosted = await journalsOf('VOUCHER');
      assert.deepEqual(picture(vouchersPosted[1]), ['100.01:0.00/1000.00', '361:1000.00/0.00']);

      // İki kasa aynı yevmiye hesabına eşlenince virman sıfırlanır: borç ve alacak aynı hesapta ayrı satır (iz kalır).
      const kasaHesabi = await accountByCode('100.01');
      await boss(() => settings.saveRules(hotelId, contracts.journalRulesSchema.parse({ rows: [{ source: 'TREASURY', key: banka.try.id, accountId: kasaHesabi.id }] })));
      await voucher({ type: 'TRANSFER', treasuryAccountId: kasa.try.id, targetTreasuryAccountId: banka.try.id, amount: '300', description: 'Bankaya yatırma' });
      const transfer = (await journalsOf('VOUCHER')).at(-1);
      assert.deepEqual(picture(transfer), ['100.01:0.00/300.00', '100.01:300.00/0.00']);
      assert.equal(money(transfer.total), '300.00');
    });

    it('günlük gelir fişi: folyo kalemleri tür ve KDV oranıyla; yeniden çalıştırma yalnız farkı yazar', async () => {
      const { folio } = await seedStay({ charges: '2200.00' });
      const first = await as(ACCOUNTING, () => journalize.journalizeDay(hotelId, D(0)));
      assert.equal(first.posted, true);
      let entries = await journalsOf('DAILY_REVENUE');
      assert.deepEqual(picture(entries[0]), ['120.01:2200.00/0.00', '391:0.00/200.00', '600.09:0.00/2000.00']);
      assert.equal(entries[0].sourceId, D(0));
      const same = await as(ACCOUNTING, () => journalize.journalizeDay(hotelId, D(0)));
      assert.equal(same.posted, false, 'değişiklik yok → fiş yok');
      // Yeni kalem (minibar): yalnız fark fişi.
      await as(DESK, () => folios.postCharge(hotelId, folio.id, contracts.postChargeSchema.parse({ requestId: randomUUID(), type: 'MINIBAR', description: 'Minibar', amount: '1100.00', quantity: 1 })));
      const correction = await as(ACCOUNTING, () => journalize.journalizeDay(hotelId, D(0)));
      assert.equal(correction.posted, true);
      entries = await journalsOf('DAILY_REVENUE');
      assert.equal(entries.length, 2);
      assert.deepEqual(picture(entries[1]), ['120.01:1100.00/0.00', '391:0.00/100.00', '600.03:0.00/1000.00']);
      assert.match(entries[1].description, /düzeltme/);
      // Mizanda misafir hesabı: tahsilat yoksa 3.300 borç kalanı; gelir 3.000; KDV 300.
      const mizan = await as(ACCOUNTING, () => trial.trialBalance(hotelId, { from: D(-30), to: D(0) }));
      const row = (code) => mizan.rows.find((item) => item.code === code);
      assert.equal(row('120.01').closing, '3300.00');
      assert.equal(row('600').closing, '-3000.00', 'üst hesap alt hesapların toplamı');
      assert.equal(row('6').closing, '-3000.00');
      assert.equal(row('391').closing, '-300.00');
      assert.equal(mizan.balanced, true);
      assert.equal(mizan.totals.debit, mizan.totals.credit);
    });

    it('kural eksik / hesap pasifse iş "Ön muhasebe" görevine düşer; düzeltilip eşitlenince fişlenir; eşitleme kapanmış günün gelir fişini de yazar', async () => {
      await as(ACCOUNTING, () => chart.listChart(hotelId, {}));
      const guest = await accountByCode('120.01');
      await boss(() => chart.updateAccount(hotelId, guest.id, contracts.glAccountUpdateSchema.parse({ expectedUpdatedAt: guest.updatedAt, name: guest.name, department: null, isActive: false })));
      const { folio } = await seedStay();
      await pay(folio.id, { method: 'CASH', amount: '1000' });
      assert.equal((await journalsOf()).length, 0, 'pasif hesaba fiş yazılmaz');
      const tasks = await db.manualTask.findMany({ where: { hotelId, module: 'Ön muhasebe' } });
      assert.equal(tasks.length, 1);
      assert.match(tasks[0].title, /yevmiye fişine çevrilecek/);
      assert.match(tasks[0].description, /pasif/);
      const movement = await db.treasuryMovement.findFirst({ where: { hotelId } });
      assert.equal(movement.journalEntryId, null);
      // Kapanmış gün: gelir fişi eşitlemede yazılır.
      await db.nightAudit.create({ data: { hotelId, date: new Date(`${D(0)}T00:00:00.000Z`), status: 'CLOSED', startedBy: MANAGER, closedAt: new Date(), closedBy: MANAGER } });
      const fresh = await accountByCode('120.01');
      await boss(() => chart.updateAccount(hotelId, guest.id, contracts.glAccountUpdateSchema.parse({ expectedUpdatedAt: fresh.updatedAt, name: guest.name, department: null, isActive: true })));
      const report = await as(ACCOUNTING, () => journalize.syncJournals(hotelId, { from: D(-1), to: D(0) }));
      assert.deepEqual([report.posted, report.failed, report.remaining], [2, 0, 0], JSON.stringify(report.errors));
      const entries = await journalsOf();
      assert.deepEqual(entries.map((entry) => entry.source).sort(), ['DAILY_REVENUE', 'FOLIO_PAYMENT']);
      const again = await as(ACCOUNTING, () => journalize.syncJournals(hotelId, { from: D(-1), to: D(0) }));
      assert.deepEqual([again.posted, again.skipped], [0, 1], 'gelir fişi güncel: atlanır');
    });
  });

  /* ═══════════════ Elle fiş, iptal, ekstre, kilit ═══════════════ */

  describe('elle fiş, iptal, ekstre, dönem kilidi', () => {
    it('API: dengeli fiş 201, aynı istek 200; dengesiz / ana hesap reddedilir; iptal ters kayıt yazar; ekstre yürüyen bakiye', async () => {
      await as(ACCOUNTING, () => chart.listChart(hotelId, {}));
      const kasaHesabi = await accountByCode('100.01');
      const gider = await accountByCode('770');
      const requestId = randomUUID();
      const body = { requestId, date: D(0), description: 'Kırtasiye alımı', reference: 'FİŞ-1', lines: [{ accountId: gider.id, debit: '250.00', description: 'Kalem, kağıt' }, { accountId: kasaHesabi.id, credit: '250.00' }] };
      const created = await call('POST', '/ledger/journals', ACCOUNTING, body);
      assert.equal(created.statusCode, 201, created.body);
      assert.equal(created.json().data.entry.type, 'MANUAL');
      assert.equal(created.json().data.entry.total, '250.00');
      const twice = await call('POST', '/ledger/journals', ACCOUNTING, body);
      assert.equal(twice.statusCode, 200);
      assert.equal(twice.json().data.created, false);
      const unbalanced = await call('POST', '/ledger/journals', ACCOUNTING, { ...body, requestId: randomUUID(), lines: [{ accountId: gider.id, debit: '250.00' }, { accountId: kasaHesabi.id, credit: '200.00' }] });
      assert.equal(unbalanced.statusCode, 400);
      assert.match(unbalanced.body, /eşit olmalı/);
      const parent = await call('POST', '/ledger/journals', ACCOUNTING, { ...body, requestId: randomUUID(), lines: [{ accountId: (await accountByCode('100')).id, debit: '250.00' }, { accountId: kasaHesabi.id, credit: '250.00' }] });
      assert.equal(parent.statusCode, 409, parent.body);
      // İkinci fiş ve ekstre.
      await call('POST', '/ledger/journals', ACCOUNTING, { requestId: randomUUID(), date: D(0), description: 'Kasa fazlası', lines: [{ accountId: kasaHesabi.id, debit: '1000.00' }, { accountId: (await accountByCode('679')).id, credit: '1000.00' }] });
      const statement = await call('GET', `/ledger/chart/${kasaHesabi.id}/lines?from=${D(-7)}&to=${D(0)}&limit=1`, ACCOUNTING);
      assert.equal(statement.statusCode, 200, statement.body);
      const page1 = statement.json().data;
      assert.deepEqual([page1.opening, page1.items.length, page1.items[0].balance], ['0.00', 1, '-250.00']);
      assert.ok(page1.nextCursor);
      const page2 = (await call('GET', `/ledger/chart/${kasaHesabi.id}/lines?from=${D(-7)}&to=${D(0)}&limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`, ACCOUNTING)).json().data;
      assert.deepEqual([page2.items[0].balance, page2.nextCursor, page2.totals.closing], ['750.00', null, '750.00']);
      // Üst hesap ekstresi alt hesapların satırlarını içerir.
      const kasaUst = (await call('GET', `/ledger/chart/${(await accountByCode('100')).id}/lines?from=${D(-7)}&to=${D(0)}`, ACCOUNTING)).json().data;
      assert.equal(kasaUst.items.length, 2);
      // İptal.
      const entryId = created.json().data.entry.id;
      const detail = (await call('GET', `/ledger/journals/${entryId}`, ACCOUNTING)).json().data;
      const voided = await call('POST', `/ledger/journals/${entryId}/void`, MANAGER, { expectedUpdatedAt: detail.entry.updatedAt, reason: 'Yanlış hesap' });
      assert.equal(voided.statusCode, 200, voided.body);
      assert.equal(voided.json().data.entry.status, 'VOIDED');
      assert.equal(voided.json().data.reversal.source, 'REVERSAL');
      const reversal = await db.journalEntry.findUnique({ where: { id: voided.json().data.reversal.id }, include: { lines: { include: { account: true } } } });
      assert.deepEqual(picture(reversal), ['100.01:250.00/0.00', '770:0.00/250.00']);
      const again = await call('POST', `/ledger/journals/${entryId}/void`, MANAGER, { expectedUpdatedAt: voided.json().data.entry.updatedAt, reason: 'İkinci' });
      assert.equal(again.statusCode, 409);
      const reversalVoid = await call('POST', `/ledger/journals/${reversal.id}/void`, MANAGER, { expectedUpdatedAt: reversal.updatedAt.toISOString(), reason: 'Olmaz' });
      assert.equal(reversalVoid.statusCode, 409);
      // Liste süzgeçleri.
      const list = (await call('GET', `/ledger/journals?status=VOIDED`, ACCOUNTING)).json().data;
      assert.equal(list.items.length, 1);
      const byAccount = (await call('GET', `/ledger/journals?accountId=${gider.id}`, ACCOUNTING)).json().data;
      assert.equal(byAccount.items.length, 2, 'asıl ve ters kayıt');
    });

    it('dönem kilidi: kilitli güne elle fiş ve iptal reddedilir; otomatik fiş kilit sonrası güne düşer; kilit bugünden sonra olamaz', async () => {
      await as(ACCOUNTING, () => chart.listChart(hotelId, {}));
      const accounting = await boss(() => treasury.getSettings(hotelId));
      await boss(() => treasury.saveSettings(hotelId, contracts.accountingSettingsSchema.parse({ expectedUpdatedAt: accounting.settings.updatedAt, startDate: D(-10), paymentApprovalAmount: '50000' })));
      const kasaHesabi = await accountByCode('100.01');
      const gider = await accountByCode('770');
      const before = await as(ACCOUNTING, () => journals.createManualJournal(hotelId, contracts.journalCreateSchema.parse({ requestId: randomUUID(), date: D(-2), description: 'Eski fiş', lines: [{ accountId: gider.id, debit: '10.00' }, { accountId: kasaHesabi.id, credit: '10.00' }] })));
      const current = await as(ACCOUNTING, () => settings.getLedgerSettings(hotelId));
      await rejectsWith(boss(() => settings.saveLedgerSettings(hotelId, contracts.ledgerSettingsSchema.parse({ expectedUpdatedAt: current.settings.updatedAt, glLockedThrough: D(0) }))), 'VALIDATION', /dünü/);
      const locked = await boss(() => settings.saveLedgerSettings(hotelId, contracts.ledgerSettingsSchema.parse({ expectedUpdatedAt: current.settings.updatedAt, glLockedThrough: D(-1) })));
      assert.equal(locked.settings.glLockedThrough, D(-1));
      await rejectsWith(
        as(ACCOUNTING, () => journals.createManualJournal(hotelId, contracts.journalCreateSchema.parse({ requestId: randomUUID(), date: D(-1), description: 'Kilitli', lines: [{ accountId: gider.id, debit: '10.00' }, { accountId: kasaHesabi.id, credit: '10.00' }] }))),
        'VALIDATION',
        /kilitli/,
      );
      await rejectsWith(boss(() => journals.voidJournal(hotelId, before.entry.id, { expectedUpdatedAt: new Date(before.entry.updatedAt), reason: 'Olmaz' })), 'JOURNAL_PERIOD_LOCKED');
      // Kilitli güne ait ön muhasebe kaydı: fiş kilit sonrası ilk güne (bugün) yazılır, açıklamada not.
      const { folio } = await seedStay();
      const { payment } = await pay(folio.id, { method: 'CASH', amount: '300' });
      await db.payment.update({ where: { id: payment.id }, data: { businessDate: new Date(`${D(-3)}T00:00:00.000Z`) } });
      await db.treasuryMovement.deleteMany({ where: { hotelId, sourceKey: `PAYMENT:${payment.id}` } });
      await db.journalEntry.deleteMany({ where: { hotelId, source: 'FOLIO_PAYMENT' } });
      await db.treasuryAccount.update({ where: { id: kasa.try.id }, data: { balance: '0' } });
      await as(ACCOUNTING, () => postings.syncFolioPayment(hotelId, payment.id));
      const [entry] = await journalsOf('FOLIO_PAYMENT');
      assert.equal(core.toIsoDay(entry.date), D(0));
      assert.match(entry.description, /kilitli dönem/);
    });
  });

  /* ═══════════════ İzinler ═══════════════ */

  describe('izinler', () => {
    it('ön büro göremez; muhasebe görür, elle fiş girer ve kuralları düzenler; mizan ve ayar uçları', async () => {
      const forbidden = await call('GET', '/ledger/chart', DESK);
      assert.equal(forbidden.statusCode, 403);
      const chartResponse = await call('GET', '/ledger/chart?postable=true', ACCOUNTING);
      assert.equal(chartResponse.statusCode, 200, chartResponse.body);
      assert.ok(chartResponse.json().data.accounts.every((row) => row.isPostable));
      const picker = await call('GET', '/ledger/chart/picker?search=600', ACCOUNTING);
      assert.equal(picker.statusCode, 200);
      const rules = await call('GET', '/ledger/rules', ACCOUNTING);
      assert.equal(rules.statusCode, 200, rules.body);
      const spa = rules.json().data.rules.find((rule) => rule.source === 'REVENUE' && rule.key === 'SPA');
      const other = await db.glAccount.findFirst({ where: { hotelId, code: '600.09' } });
      const saved = await call('PUT', '/ledger/rules', ACCOUNTING, { rows: [{ source: 'REVENUE', key: 'SPA', accountId: other.id }] });
      assert.equal(saved.statusCode, 200, saved.body);
      const changed = saved.json().data.rules.find((rule) => rule.source === 'REVENUE' && rule.key === 'SPA');
      assert.deepEqual([changed.account.code, changed.isDefault, spa.account.code], ['600.09', false, '600.05']);
      const reverted = await call('PUT', '/ledger/rules', ACCOUNTING, { rows: [{ source: 'REVENUE', key: 'SPA', accountId: null }] });
      assert.equal(reverted.json().data.rules.find((rule) => rule.source === 'REVENUE' && rule.key === 'SPA').isDefault, true);
      const badRule = await call('PUT', '/ledger/rules', ACCOUNTING, { rows: [{ source: 'REVENUE', key: 'SPA', accountId: (await db.glAccount.findFirst({ where: { hotelId, code: '600' } })).id }] });
      assert.equal(badRule.statusCode, 422, badRule.body);
      const mizan = await call('GET', `/ledger/trial-balance?from=${D(-30)}&to=${D(0)}&onlyActive=true`, ACCOUNTING);
      assert.equal(mizan.statusCode, 200, mizan.body);
      assert.equal(mizan.json().data.balanced, true);
      const settingsResponse = await call('GET', '/ledger/settings', MANAGER);
      assert.equal(settingsResponse.statusCode, 200);
      assert.deepEqual(settingsResponse.json().data.unposted, { ledgerEntries: 0, treasuryMovements: 0 });
      const sync = await call('POST', '/ledger/sync', DESK, { from: D(-1), to: D(0) });
      assert.equal(sync.statusCode, 403);
    });
  });
});
