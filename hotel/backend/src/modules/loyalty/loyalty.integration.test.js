import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Sadakat (modül 56) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: folyo kapanınca aktör zinciriyle puan (otomatik üyelik, vergi kalemi hariç, seviye çarpanı), yeniden açılınca geri
 * alma ve yeniden kapanınca fark; acente ödemeli folyo kazanmaz; puan kullanma (folyo indirimi, sınırlar, çift gönderim, açık folyo
 * yok) ve indirim iptal edilince iade; seviye yükselişi ve zil; süre dolumu (FIFO lot); elle düzeltme; misafir birleştirme; portal
 * kutusu; izinler.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'mudur@test.local';
const MANAGER2 = 'genelmudur@test.local';
const DESK = 'onburo@test.local';
const HK = 'kat@test.local';
const TC = '10000000146';

describe('sadakat (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let folios;
  /** @type {any} */ let payments;
  /** @type {any} */ let approvals;
  /** @type {any} */ let accounts;
  /** @type {any} */ let earning;
  /** @type {any} */ let redeem;
  /** @type {any} */ let guests;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  /** @type {Map<string, string>} */ let tokens;
  /** @type {any} */ let roomType;
  /** @type {any} */ let room;
  /** @type {any} */ let agency;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    folios = await import('../folios/service.js');
    payments = await import('../payments/service.js');
    approvals = await import('../approvals/service.js');
    accounts = await import('./accounts.js');
    earning = await import('./earning.js');
    redeem = await import('./redeem.js');
    guests = await import('../guests/service.js');
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
  const today = () => core.toIsoDay(core.calendarDateInTimeZone(ZONE));
  const D = (offset) => core.toIsoDay(core.addDays(core.calendarDateInTimeZone(ZONE), offset));

  async function rejectsWith(promise, code, message) {
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, code, `${error.code}: ${error.message}`);
      if (message) assert.match(error.message, message);
      return true;
    });
  }

  const settingsBody = (patch = {}) => ({ expectedUpdatedAt: null, isEnabled: true, programName: 'FlexClub', spendPerPoint: '10', pointValue: '0.5', minRedeemPoints: 100, maxRedeemPct: 50, expiryMonths: 24, autoEnroll: true, excludeLedgerPaid: true, earnOnSpa: true, tiers: contracts.DEFAULT_LOYALTY_TIERS, ...patch });
  const saveSettings = async (patch = {}) => {
    const current = await boss(() => accounts.getLoyaltySettings(hotelId));
    return boss(() => accounts.saveLoyaltySettings(hotelId, contracts.loyaltySettingsSchema.parse({ ...settingsBody(patch), expectedUpdatedAt: current.settings.updatedAt })));
  };

  beforeEach(async () => {
    await resetDatabase(db);
    cache.cache.invalidatePrefix('settings:');
    tokens = new Map();
    hotelId = (await db.hotel.create({ data: { name: 'Büyük Ankara Oteli', code: `A${randomUUID().slice(0, 5).toUpperCase()}`, timezone: ZONE, currency: 'TRY' } })).id;
    const passwordHash = await (await import('bcryptjs')).default.hash(PASSWORD, 4);
    await db.user.createMany({
      data: [
        { hotelId, email: MANAGER, name: 'Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: MANAGER2, name: 'Genel Müdür', role: 'MANAGER', passwordHash },
        { hotelId, email: DESK, name: 'Ön Büro', role: 'FRONT_DESK', passwordHash },
        { hotelId, email: HK, name: 'Kat', role: 'HOUSEKEEPING', passwordHash },
      ],
    });
    await db.tax.create({ data: { hotelId, name: 'Konaklama vergisi', rate: '2', isIncluded: false, appliesTo: ['ROOM'] } });
    roomType = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 3, capacityChildren: 1 } });
    room = await db.room.create({ data: { hotelId, number: '101', roomTypeId: roomType.id } });
    agency = await db.agency.create({ data: { hotelId, code: 'TATIL', name: 'Tatil Acentesi', taxNumber: '1111111111', paymentTermDays: 30, createdBy: MANAGER } });
    await saveSettings();
  });

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });

  /** İçerideki konaklama + açık folyo + `amount` tutarında diğer harcama (vergisiz). */
  async function stay({ guest = null, amount = '2480.00', agencyId = null } = {}) {
    const owner = guest ?? (await db.guest.create({ data: { hotelId, firstName: 'Ayşe', lastName: 'Demir', idType: 'NATIONAL_ID', idNumber: TC, nationality: 'TR' } }));
    const reservation = await db.reservation.create({
      data: { hotelId, guestId: owner.id, roomTypeId: roomType.id, roomId: room.id, agencyId, agencyCommissionPct: agencyId ? '10' : null, source: agencyId ? 'AGENCY' : 'UI', checkIn: new Date(`${D(-1)}T00:00:00.000Z`), checkOut: new Date(`${D(1)}T00:00:00.000Z`), status: 'CHECKED_IN', checkedInAt: new Date(), checkedInBy: DESK, confirmedAt: new Date(), totalPrice: '2000.00', confirmationCode: `H${randomUUID().slice(0, 7).toUpperCase()}` },
    });
    await as(DESK, () => folios.openFolio(hotelId, reservation.id, {}));
    const folio = await db.folio.findFirst({ where: { reservationId: reservation.id } });
    await as(DESK, () => folios.postCharge(hotelId, folio.id, contracts.postChargeSchema.parse({ requestId: randomUUID(), type: 'OTHER', description: 'Hizmet', amount, quantity: 1 })));
    return { guest: owner, reservation, folio };
  }
  const settle = async (folio, method = 'CASH') => {
    const fresh = await db.folio.findUnique({ where: { id: folio.id } });
    const due = core.toMoneyString(core.toDecimal(String(fresh.chargesTotal)).minus(String(fresh.paymentsTotal)));
    if (Number(due) > 0) await as(DESK, () => payments.receivePayment(hotelId, folio.id, contracts.receivePaymentSchema.parse({ requestId: randomUUID(), method, amount: due })));
    await db.reservation.update({ where: { id: folio.reservationId }, data: { status: 'CHECKED_OUT', checkedOutAt: new Date(), checkedOutBy: DESK } });
    const again = await db.folio.findUnique({ where: { id: folio.id } });
    if (again.status === 'OPEN') await as(DESK, () => folios.closeFolio(hotelId, folio.id));
  };
  const accountOf = (guestId) => db.loyaltyAccount.findUnique({ where: { guestId } });

  it('folyo kapanınca puan (otomatik üyelik, aktör); yeniden açılınca geri alma, yeniden kapanınca fark; acente ödemeli folyo kazanmaz', async () => {
    const { guest, folio } = await stay({ amount: '2480.00' });
    await settle(folio);
    let account = await accountOf(guest.id);
    assert.ok(account, 'otomatik üyelik');
    assert.match(account.number, /^SDK-\d{6}$/);
    assert.deepEqual([account.balance, account.lifetimePoints, account.tierCode], [248, 248, 'CLASSIC']);
    const [earn] = await db.loyaltyTransaction.findMany({ where: { accountId: account.id } });
    assert.deepEqual([earn.kind, earn.points, earn.remaining, String(earn.amount)], ['EARN', 248, 248, '2480']);
    assert.ok(earn.expiresOn, 'süreli lot');
    // Aynı kapanış olayı tekrar gelse de yazılmaz.
    await earning.syncFolioPoints(hotelId, folio.id);
    assert.equal((await accountOf(guest.id)).balance, 248);
    // Yeniden aç → geri al; kalem ekle ve kapat → yeni toplamın puanı.
    await as(MANAGER, () => folios.reopenFolio(hotelId, folio.id, { reason: 'Ek harcama' }));
    assert.equal((await accountOf(guest.id)).balance, 0);
    await as(DESK, () => folios.postCharge(hotelId, folio.id, contracts.postChargeSchema.parse({ requestId: randomUUID(), type: 'OTHER', description: 'Ek', amount: '520.00', quantity: 1 })));
    await settle(folio);
    account = await accountOf(guest.id);
    assert.equal(account.balance, 300);
    const kinds = (await db.loyaltyTransaction.findMany({ where: { accountId: account.id }, orderBy: { createdAt: 'asc' } })).map((row) => [row.kind, row.points]);
    assert.deepEqual(kinds, [['EARN', 248], ['EARN_REVERSAL', -248], ['EARN', 300]]);
    // Acente ödemeli folyo kazanmaz.
    const second = await stay({ guest, amount: '1000.00', agencyId: agency.id });
    await settle(second.folio, 'AGENCY');
    assert.equal((await accountOf(guest.id)).balance, 300);
  });

  it('puan kullanma: folyoya indirim, sınırlar, çift gönderim; indirim iptal edilince puan iade; açık folyo yoksa ret', async () => {
    const first = await stay({ amount: '30000.00' });
    await settle(first.folio);
    assert.equal((await accountOf(first.guest.id)).balance, 3000);
    const { reservation, folio } = await stay({ guest: first.guest, amount: '2000.00' });
    const preview = await as(DESK, () => redeem.reservationLoyalty(hotelId, reservation.id));
    assert.deepEqual([preview.account.balance, preview.folios[0].maxPoints, preview.folios[0].maxAmount], [3000, 2000, '1000.00'], 'harcamanın %50si / 0,50');
    await rejectsWith(as(DESK, () => redeem.redeemPoints(hotelId, reservation.id, contracts.loyaltyRedeemSchema.parse({ requestId: randomUUID(), points: 50 }))), 'VALIDATION', /En az 100/);
    await rejectsWith(as(DESK, () => redeem.redeemPoints(hotelId, reservation.id, contracts.loyaltyRedeemSchema.parse({ requestId: randomUUID(), points: 2500 }))), 'LOYALTY_LIMIT');
    const requestId = randomUUID();
    const response = await call('POST', `/loyalty/reservations/${reservation.id}/redeem`, DESK, { requestId, points: 400, category: 'OTHER' });
    assert.equal(response.statusCode, 201, response.body);
    const again = await call('POST', `/loyalty/reservations/${reservation.id}/redeem`, DESK, { requestId, points: 400, category: 'OTHER' });
    assert.equal(again.statusCode, 200);
    const items = await db.folioItem.findMany({ where: { folioId: folio.id, type: 'DISCOUNT' } });
    assert.equal(items.length, 1);
    assert.equal(String(items[0].total), '-200');
    assert.equal((await accountOf(first.guest.id)).balance, 2600);
    const lot = await db.loyaltyTransaction.findFirst({ where: { kind: 'EARN', accountId: (await accountOf(first.guest.id)).id } });
    assert.equal(lot.remaining, 2600, 'FIFO: en eski lottan düştü');
    // İndirim kalemi iptal edilince (dört göz) puan iade.
    await as(DESK, () => folios.requestVoid(hotelId, folio.id, items[0].id, { reason: 'Yanlış' }));
    const pending = await db.folioItem.findUnique({ where: { id: items[0].id } });
    if (pending.voidApprovalId) await as(MANAGER2, () => approvals.decideApproval(hotelId, pending.voidApprovalId, 'GRANTED', { note: 'Tamam' }));
    assert.equal((await accountOf(first.guest.id)).balance, 3000);
    assert.equal((await db.loyaltyTransaction.findFirst({ where: { kind: 'EARN', accountId: (await accountOf(first.guest.id)).id } })).remaining, 3000, 'lot geri doldu');
    // Folyo kapanınca indirimli tutardan kazanır: 2.000 TL (indirim iptal edildi) → 200 × Altın 1,5 = 300.
    await settle(folio);
    const account = await accountOf(first.guest.id);
    assert.equal(account.tierCode, 'GOLD');
    assert.equal(account.balance, 3300);
    // Açık folyo yok.
    await rejectsWith(as(DESK, () => redeem.redeemPoints(hotelId, reservation.id, contracts.loyaltyRedeemSchema.parse({ requestId: randomUUID(), points: 100 }))), 'LOYALTY_NO_OPEN_FOLIO');
  });

  it('seviye yükselişi zil çalar; süre dolumu FIFO lotları düşer; elle düzeltme; misafir birleşince hesaplar birleşir; portal kutusu', async () => {
    const { guest, folio } = await stay({ amount: '12000.00' });
    await settle(folio);
    let account = await accountOf(guest.id);
    assert.deepEqual([account.balance, account.tierCode], [1200, 'SILVER']);
    const alerts = await db.staffAlert.findMany({ where: { hotelId, kind: 'LOYALTY' } });
    assert.equal(alerts.length, 0, 'ilk seviye ataması (null → Gümüş) yükseliş zili değil');
    // Süre dolumu: lotun son günü geçmiş.
    await db.loyaltyTransaction.updateMany({ where: { accountId: account.id, kind: 'EARN' }, data: { expiresOn: new Date(`${D(-1)}T00:00:00.000Z`) } });
    const expired = await accounts.expireAndRefresh(hotelId);
    assert.equal(expired.expired, 1200);
    account = await accountOf(guest.id);
    assert.equal(account.balance, 0);
    // Elle düzeltme: bakiyeden fazla düşülemez.
    await rejectsWith(boss(() => accounts.adjustAccount(hotelId, account.id, contracts.loyaltyAdjustSchema.parse({ points: -5, reason: 'Deneme' }))), 'LOYALTY_BALANCE');
    const adjusted = await boss(() => accounts.adjustAccount(hotelId, account.id, contracts.loyaltyAdjustSchema.parse({ points: 2500, reason: 'Şikâyet telafisi' })));
    assert.equal(adjusted.account.balance, 2500);
    // Yükseliş: yeni kazanma Altın eşiğini geçirir.
    const big = await stay({ guest, amount: '20000.00' });
    await settle(big.folio);
    account = await accountOf(guest.id);
    assert.equal(account.tierCode, 'GOLD');
    assert.ok((await db.staffAlert.findMany({ where: { hotelId, kind: 'LOYALTY' } })).some((row) => /Altın seviyesine yükseldi/.test(row.title)));
    // Birleştirme: ikinci kartın hesabı hedefe aktarılır.
    const twin = await db.guest.create({ data: { hotelId, firstName: 'Ayşe', lastName: 'Demir', email: 'ayse@example.com' } });
    const twinStay = await stay({ guest: twin, amount: '1000.00' });
    await settle(twinStay.folio);
    const before = (await accountOf(guest.id)).balance;
    await as(MANAGER, () => guests.mergeGuests(hotelId, { sourceId: twin.id, targetId: guest.id, keep: {} }));
    const merged = await accountOf(guest.id);
    assert.equal(merged.balance, before + 100);
    assert.equal((await accountOf(twin.id)).status, 'CLOSED');
    // Portal kutusu.
    const { portalLoyalty } = accounts;
    const box = await portalLoyalty(hotelId, guest.id);
    assert.deepEqual([box.programName, box.tier.name, box.balance], ['FlexClub', 'Altın', merged.balance]);
  });

  it('izinler: kat görevlisi göremez; ön büro üye yapar ve kullanır ama ayar / düzeltme yapamaz; otomatik üyelik kapalıysa üye olmayan kazanmaz', async () => {
    await saveSettings({ autoEnroll: false });
    const { guest, folio } = await stay({ amount: '1000.00' });
    await settle(folio);
    assert.equal(await accountOf(guest.id), null);
    assert.equal((await call('GET', `/loyalty/guests/${guest.id}`, HK)).statusCode, 403);
    const card = await call('GET', `/loyalty/guests/${guest.id}`, DESK);
    assert.equal(card.json().data.account, null);
    const noConsent = await call('POST', `/loyalty/guests/${guest.id}/enroll`, DESK, { consent: false });
    assert.equal(noConsent.statusCode, 400);
    const enrolled = await call('POST', `/loyalty/guests/${guest.id}/enroll`, DESK, { consent: true });
    assert.equal(enrolled.statusCode, 201, enrolled.body);
    assert.ok(enrolled.json().data.account.consentAt);
    assert.equal((await call('PUT', '/loyalty/settings', DESK, settingsBody())).statusCode, 403);
    assert.equal((await call('POST', `/loyalty/accounts/${enrolled.json().data.account.id}/adjust`, DESK, { points: 10, reason: 'Olmaz' })).statusCode, 403);
    const list = await call('GET', '/loyalty/accounts?sort=balance', DESK);
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().data.summary.members, 1);
  });
});
