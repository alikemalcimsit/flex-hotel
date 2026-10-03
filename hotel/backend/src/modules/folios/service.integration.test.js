import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Folyo yönetimi (modül 15) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan, yalnızca veritabanıyla doğrulanabilen davranışlar: gece oda
 * ücretinin vergisiyle ve bir kez işlenmesi (tekrar ve eşzamanlı çalışmada
 * da), fiyat değişince fark kalemi, ikram gecenin yeniden işlenmemesi, elle
 * harcamanın çift gönderimi, indirim sınırı, kalem iptalinin onay kuyruğundan
 * (dört göz) geçip ters kayıtla işlenmesi, bölme / aktarma / birleştirme ve
 * yönlendirmenin sonraki kalemleri doğru folyoya düşürmesi, kapatma kuralları,
 * giriş / çıkış / geri almada aktör işleri, gelmedi ücreti, minibar, aynı
 * folyoya eşzamanlı yazımda toplamların tutarlı kalması, liste.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const DESK = 'resepsiyon@test.local';
const MANAGER = 'mudur@test.local';
const TC = '10000000146';

describe('folyo yönetimi (entegrasyon)', { skip }, () => {
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
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
    folios = await import('./service.js');
    approvals = await import('../approvals/service.js');
    reservations = await import('../reservations/service.js');
    frontDesk = await import('../front-desk/service.js');
    cache = await import('../../lib/cache.js');
    // Onay kararı → ters kayıt (servis dinleyicisi; aktör kaydı gerekmez).
    (await import('./subscribers.js')).registerFolioSubscribers();
  });

  after(async () => {
    (await import('./subscribers.js')).stopFolioSubscribers();
    await db?.$disconnect();
  });

  const as = (actor, fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
  const desk = (fn) => as(DESK, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const day = (offset) => core.toIsoDay(core.addDays(today(), offset));
  const at = (time, offset = 0) => contracts.zonedWallTimeToUtc(`${day(offset)}T${time}`, ZONE);
  const eventsNamed = (name) => db.eventLog.findMany({ where: { hotelId, name }, orderBy: { occurredAt: 'asc' }, select: { payload: true } });
  const itemsOf = (reservationId, where = {}) =>
    db.folioItem.findMany({ where: { reservationId, ...where }, orderBy: [{ serviceDate: 'asc' }, { postedAt: 'asc' }] });

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
        code: `F${randomUUID().slice(0, 5).toUpperCase()}`,
        timezone: ZONE,
        checkInTime: '14:00',
        checkOutTime: '12:00',
        earlyCheckInFeeMode: 'FIXED',
        earlyCheckInFeeValue: '300',
        lateCheckOutFeeMode: 'FIXED',
        lateCheckOutFeeValue: '400',
      },
    });
    hotelId = hotel.id;
    await db.user.createMany({
      data: [
        { hotelId, email: DESK, name: 'Resepsiyon', passwordHash: 'x', role: 'FRONT_DESK' },
        { hotelId, email: MANAGER, name: 'Müdür', passwordHash: 'x', role: 'MANAGER' },
      ],
    });
    // Oda: KDV %10 dahil + konaklama vergisi %2 hariç. Minibar: KDV %20 dahil.
    await db.tax.createMany({
      data: [
        { hotelId, name: 'KDV', rate: '10', isIncluded: true, appliesTo: ['ROOM', 'FNB'] },
        { hotelId, name: 'Konaklama vergisi', rate: '2', isIncluded: false, appliesTo: ['ROOM'] },
        { hotelId, name: 'KDV', rate: '20', isIncluded: true, appliesTo: ['MINIBAR'] },
      ],
    });
    types = {
      std: await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 3, capacityChildren: 1 } }),
    };
    room = {};
    for (const number of ['101', '102', '103']) {
      room[number] = await db.room.create({ data: { hotelId, number, roomTypeId: types.std.id } });
    }
  });

  /** İçerideki konaklama (geceleri 1000'er), girişi `checkIn` gün önce. */
  async function seedInHouse({ checkIn = -2, checkOut = 1, roomNumber = '101', firstName = 'Mehmet', nightly = '1000.00' } = {}) {
    const guest = await db.guest.create({ data: { hotelId, firstName, lastName: 'Kaya', idType: 'NATIONAL_ID', idNumber: TC, nationality: 'TR' } });
    const stay = await db.reservation.create({
      data: {
        hotelId,
        guestId: guest.id,
        roomTypeId: types.std.id,
        roomId: room[roomNumber].id,
        checkIn: new Date(day(checkIn)),
        checkOut: new Date(day(checkOut)),
        status: 'CHECKED_IN',
        checkedInAt: at('15:00', checkIn),
        checkedInBy: DESK,
        confirmedAt: new Date(),
        totalPrice: core.toMoneyString(core.toDecimal(nightly).times(checkOut - checkIn)),
        confirmationCode: `H${randomUUID().slice(0, 7).toUpperCase()}`,
      },
    });
    await db.reservationNight.createMany({
      data: core.eachNight(stay.checkIn, stay.checkOut).map((date) => ({ hotelId, reservationId: stay.id, date, amount: nightly })),
    });
    return stay;
  }

  const primaryFolio = async (reservationId) => db.folio.findFirst({ where: { reservationId, status: 'OPEN' }, orderBy: { window: 'asc' } });

  /** Denormalize toplam, kalem ve ödemelerle tutarlı mı (kısıtın ötesinde). */
  async function assertTotalsConsistent(folioId) {
    const folio = await db.folio.findUnique({ where: { id: folioId } });
    const items = await db.folioItem.findMany({ where: { folioId } });
    const payments = await db.payment.findMany({ where: { folioId, status: 'POSTED' } });
    const charges = items.reduce((acc, item) => acc.plus(String(item.total)), core.toDecimal(0));
    const paid = payments.reduce((acc, pay) => acc.plus(String(pay.folioAmount)), core.toDecimal(0));
    assert.equal(core.toMoneyString(String(folio.chargesTotal)), core.toMoneyString(charges), 'borç = Σ kalem');
    assert.equal(core.toMoneyString(String(folio.paymentsTotal)), core.toMoneyString(paid), 'ödenen = Σ ödeme');
    assert.equal(core.toMoneyString(String(folio.balance)), core.toMoneyString(charges.minus(paid)), 'bakiye = borç − ödenen');
  }

  /** Ödeme (modül 17'nin servisiyle: folyo kilidi, toplamların yenilenmesi). */
  async function pay(folioId, amount) {
    const payments = await import('../payments/service.js');
    const body = contracts.receivePaymentSchema.parse({ requestId: randomUUID(), method: 'CASH', amount });
    const result = await desk(() => payments.receivePayment(hotelId, folioId, body));
    assert.equal(result.payment.status, 'POSTED');
  }

  const charge = (folioId, overrides = {}) =>
    desk(() =>
      folios.postCharge(
        hotelId,
        folioId,
        contracts.postChargeSchema.parse({ requestId: randomUUID(), type: 'MINIBAR', description: 'Su', amount: '45.50', quantity: 2, ...overrides }),
      ),
    );

  describe('gece oda ücretleri', () => {
    it('dün geceye kadar her gece vergisiyle bir kez işlenir; folyo yoksa açılır; tekrar ve eşzamanlı çalışma çift yazmaz', async () => {
      const a = await seedInHouse({ checkIn: -2, checkOut: 1, roomNumber: '101' });
      const b = await seedInHouse({ checkIn: -1, checkOut: 2, roomNumber: '102', firstName: 'Ayşe' });

      const status = await folios.getRoomChargeStatus(hotelId);
      assert.deepEqual([status.missingStays, status.missingNights], [2, 3]);

      const summary = await as('billing-worker', () => folios.runRoomCharges(hotelId));
      assert.deepEqual(summary, { night: day(-1), stays: 2, items: 3, total: '3054.54' });

      const aItems = await itemsOf(a.id);
      assert.deepEqual(
        aItems.map((item) => [core.toIsoDay(item.serviceDate), item.type, item.source, String(item.total)]),
        [
          [day(-2), 'ROOM', 'ROOM_NIGHT', '1018.18'],
          [day(-1), 'ROOM', 'ROOM_NIGHT', '1018.18'],
        ],
      );
      // Dahil KDV 90.91 + hariç konaklama vergisi 18.18; net 909.09.
      assert.deepEqual(
        [String(aItems[0].netAmount), String(aItems[0].taxAmount), aItems[0].taxLines.map((line) => line.amount)],
        ['909.09', '109.09', ['90.91', '18.18']],
      );
      assert.equal(aItems[0].postedBy, 'billing-worker');
      const folioA = await primaryFolio(a.id);
      assert.equal(folioA.window, 1);
      await assertTotalsConsistent(folioA.id);

      // Tekrar ve aynı anda iki çalışma: yeni kalem yok.
      await Promise.all([folios.runRoomCharges(hotelId), folios.runRoomCharges(hotelId)]);
      assert.equal(await db.folioItem.count({ where: { hotelId } }), 3);
      assert.equal(await db.folio.count({ where: { hotelId } }), 2, 'konaklama başına bir folyo');

      const run = await db.roomChargeRun.findFirst({ where: { hotelId, night: new Date(day(-1)) } });
      assert.ok(run.completedAt);
      assert.ok((await eventsNamed('folio.room_charges.posted')).length >= 1);
      assert.equal((await eventsNamed('folio.charge.posted')).length, 0, 'toplu çalışma kalem başına haber yaymaz');
      assert.equal((await folios.getRoomChargeStatus(hotelId)).missingNights, 0);
    });

    it('döküm hizmet gününe, aynı gün işlenme sırasına göre; imleçle sayfalanır, iptal edilenler istenirse gizlenir', async () => {
      const stay = await seedInHouse({ checkIn: -3, checkOut: 1 });
      await folios.runRoomCharges(hotelId);
      const folio = await primaryFolio(stay.id);
      const { item: first } = await charge(folio.id, { description: 'Kola' });
      await charge(folio.id, { description: 'Çikolata' });

      const pageOne = await folios.listFolioItems(hotelId, folio.id, { limit: 2, includeVoided: true });
      const pageTwo = await folios.listFolioItems(hotelId, folio.id, { cursor: pageOne.nextCursor, limit: 2, includeVoided: true });
      const pageThree = await folios.listFolioItems(hotelId, folio.id, { cursor: pageTwo.nextCursor, limit: 2, includeVoided: true });
      assert.deepEqual(
        [...pageOne.items, ...pageTwo.items, ...pageThree.items].map((row) => [row.serviceDate, row.description]),
        [
          [day(-3), `Oda ücreti · ${day(-3).split('-').reverse().join('.')} gecesi`],
          [day(-2), `Oda ücreti · ${day(-2).split('-').reverse().join('.')} gecesi`],
          [day(-1), `Oda ücreti · ${day(-1).split('-').reverse().join('.')} gecesi`],
          [day(0), 'Kola'],
          [day(0), 'Çikolata'],
        ],
      );
      assert.equal(pageThree.nextCursor, null);
      await rejectsWith(folios.listFolioItems(hotelId, folio.id, { cursor: 'bozuk', limit: 2, includeVoided: true }), 'VALIDATION');

      const { approvalId } = await desk(() => folios.requestVoid(hotelId, folio.id, first.id, { reason: 'Yanlış' }));
      await as(MANAGER, () => approvals.decideApproval(hotelId, approvalId, 'GRANTED'));
      const visible = await folios.listFolioItems(hotelId, folio.id, { limit: 50, includeVoided: false });
      assert.deepEqual(visible.items.map((row) => row.description).slice(-1), ['Çikolata'], 'iptal edilen ve iptal kaydı gizli');
      const all = await folios.listFolioItems(hotelId, folio.id, { limit: 50, includeVoided: true });
      assert.equal(all.items.length, 6);
    });

    it('bitmemiş gece işlenmez', async () => {
      await rejectsWith(folios.runRoomCharges(hotelId, { night: day(0) }), 'VALIDATION');
    });

    it('fiyat sonradan değişince fark kalemi (artı oda, eksi indirim); ikram (iptal) edilen gece yeniden işlenmez', async () => {
      const stay = await seedInHouse({ checkIn: -3, checkOut: 1 });
      await folios.runRoomCharges(hotelId);
      const nights = await db.reservationNight.findMany({ where: { reservationId: stay.id }, orderBy: { date: 'asc' } });
      await db.reservationNight.update({ where: { id: nights[0].id }, data: { amount: '1200.00' } });
      await db.reservationNight.update({ where: { id: nights[1].id }, data: { amount: '900.00' } });

      // Üçüncü gece ikram: onaylı iptal.
      const third = (await itemsOf(stay.id)).find((item) => core.toIsoDay(item.serviceDate) === day(-1));
      const folio = await primaryFolio(stay.id);
      const { approvalId } = await desk(() => folios.requestVoid(hotelId, folio.id, third.id, { reason: 'İkram gece' }));
      await as(MANAGER, () => approvals.decideApproval(hotelId, approvalId, 'GRANTED'));
      await db.reservationNight.update({ where: { id: nights[2].id }, data: { amount: '1500.00' } });

      await folios.runRoomCharges(hotelId);
      const adjustments = (await itemsOf(stay.id, { source: 'ROOM_NIGHT' })).filter((item) => /düzeltmesi/.test(item.description));
      assert.deepEqual(
        adjustments.map((item) => [core.toIsoDay(item.serviceDate), item.type, String(item.amount), item.sourceKey.endsWith(':1')]),
        [
          [day(-3), 'ROOM', '200', true],
          [day(-2), 'DISCOUNT', '-100', true],
        ],
      );
      await folios.runRoomCharges(hotelId);
      assert.equal((await itemsOf(stay.id, { source: 'ROOM_NIGHT' })).length, 5, 'ikinci çalışma aynı farkı yeniden işlemez');
      await assertTotalsConsistent(folio.id);
    });
  });

  describe('elle harcama ve indirim', () => {
    it('vergi kategorisine göre işlenir; aynı istek ikinci kalem açmaz; kapalı folyoya işlenmez', async () => {
      const stay = await seedInHouse();
      const folio = (await desk(() => folios.openFolio(hotelId, stay.id, {}))).folios[0];
      const requestId = randomUUID();
      const first = await charge(folio.id, { requestId });
      assert.equal(first.created, true);
      assert.deepEqual([first.item.total, first.item.taxAmount, first.item.postedBy], ['91.00', '15.17', DESK]);
      const again = await charge(folio.id, { requestId });
      assert.equal(again.created, false);
      assert.equal(again.item.id, first.item.id);
      assert.equal(await db.folioItem.count({ where: { folioId: folio.id } }), 1);

      const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'FolioItem', entityId: first.item.id } });
      assert.equal(audit.actor, DESK);

      await pay(folio.id, '91.00');
      await desk(() => folios.openFolio(hotelId, stay.id, {}).catch(() => null));
      await desk(() => folios.splitFolio(hotelId, folio.id, { itemIds: [], payerName: null, routeTypes: [] }));
      await desk(() => folios.closeFolio(hotelId, folio.id));
      await rejectsWith(charge(folio.id), 'FOLIO_NOT_OPEN', /kapalı/);
    });

    it('indirim eksi satırdır, seçilen gelirin vergisini düşürür; harcamalardan büyük olamaz', async () => {
      const stay = await seedInHouse();
      await folios.runRoomCharges(hotelId);
      const folio = await primaryFolio(stay.id);
      await rejectsWith(charge(folio.id, { type: 'DISCOUNT', discountCategory: 'ROOM', description: 'Fazla indirim', amount: '5000', quantity: 1 }), 'VALIDATION');
      const { item } = await charge(folio.id, { type: 'DISCOUNT', discountCategory: 'ROOM', description: 'Şikâyet indirimi', amount: '100', quantity: 1 });
      assert.deepEqual([item.amount, item.total, item.taxCategory], ['-100.00', '-101.82', 'ROOM']);
      await assertTotalsConsistent(folio.id);
    });

    it('aynı folyoya eşzamanlı 10 harcama: toplamlar kalemlerle tutarlı', async () => {
      const stay = await seedInHouse();
      const folio = (await desk(() => folios.openFolio(hotelId, stay.id, {}))).folios[0];
      await Promise.all(Array.from({ length: 10 }, () => charge(folio.id)));
      assert.equal(await db.folioItem.count({ where: { folioId: folio.id } }), 10);
      await assertTotalsConsistent(folio.id);
      assert.equal(String((await db.folio.findUnique({ where: { id: folio.id } })).balance), '910');
    });
  });

  describe('kalem iptali (onay kuyruğu)', () => {
    it('isteyen onaylayamaz; başka yetkili onaylayınca ters kayıt işlenir; bekleyen iptal varken folyo kapanmaz', async () => {
      const stay = await seedInHouse();
      const folio = (await desk(() => folios.openFolio(hotelId, stay.id, {}))).folios[0];
      const { item } = await charge(folio.id);
      await pay(folio.id, '91.00');

      const { approvalId } = await desk(() => folios.requestVoid(hotelId, folio.id, item.id, { reason: 'Yanlış odaya işlendi' }));
      const pending = await db.folioItem.findUnique({ where: { id: item.id } });
      assert.ok(pending.voidRequestedAt);
      await rejectsWith(desk(() => folios.requestVoid(hotelId, folio.id, item.id, { reason: 'tekrar' })), 'ITEM_RULE');
      await desk(() => folios.splitFolio(hotelId, folio.id, { itemIds: [], payerName: null, routeTypes: [] }));
      await rejectsWith(desk(() => folios.closeFolio(hotelId, folio.id)), 'FOLIO_RULE', /onay bekleyen/);

      await rejectsWith(desk(() => approvals.decideApproval(hotelId, approvalId, 'GRANTED')), 'SELF_DECISION');
      assert.equal((await db.approval.findUnique({ where: { id: approvalId } })).status, 'PENDING', 'reddedilen karar hiçbir şey yazmaz');
      await as(MANAGER, () => approvals.decideApproval(hotelId, approvalId, 'GRANTED'));

      const original = await db.folioItem.findUnique({ where: { id: item.id }, include: { reversal: true } });
      assert.equal(original.voidedBy, MANAGER);
      assert.equal(original.voidRequestedAt, null);
      assert.deepEqual([String(original.reversal.total), original.reversal.source, original.reversal.postedBy], ['-91', 'REVERSAL', MANAGER]);
      await assertTotalsConsistent(folio.id);
      assert.equal(String((await db.folio.findUnique({ where: { id: folio.id } })).balance), '-91');
      assert.equal((await eventsNamed('folio.item.voided')).length, 1);
      const alert = await db.staffAlert.findFirst({ where: { hotelId, kind: 'APPROVAL_DECIDED' } });
      assert.match(alert.title, /Kalem iptali onaylandı/);
      await rejectsWith(desk(() => folios.requestVoid(hotelId, folio.id, item.id, { reason: 'yine' })), 'ITEM_RULE', /iptal edilmiş/);
    });

    it('reddedilen iptal: kalem olduğu gibi kalır, yeniden istenebilir', async () => {
      const stay = await seedInHouse();
      const folio = (await desk(() => folios.openFolio(hotelId, stay.id, {}))).folios[0];
      const { item } = await charge(folio.id);
      const { approvalId } = await desk(() => folios.requestVoid(hotelId, folio.id, item.id, { reason: 'Misafir itiraz etti' }));
      // İsteyen isteğini reddederek geri çekebilir (dört göz yalnızca onay için).
      await desk(() => approvals.decideApproval(hotelId, approvalId, 'DENIED', { note: 'Vazgeçtim, fiş var' }));

      const row = await db.folioItem.findUnique({ where: { id: item.id } });
      assert.deepEqual([row.voidedAt, row.voidRequestedAt, row.voidReason], [null, null, null]);
      assert.equal(await db.folioItem.count({ where: { folioId: folio.id } }), 1);
      assert.equal((await eventsNamed('folio.item.void_declined'))[0].payload.outcome, 'DENIED');
      await desk(() => folios.requestVoid(hotelId, folio.id, item.id, { reason: 'Yeni belgeyle' }));
    });
  });

  describe('bölme, aktarma, birleştirme, yönlendirme', () => {
    it('bölmede kalem yeni folyoya taşınır ve sonraki tipleri yönlenir; aktarma başka konaklamaya; birleştirmede sonraki geceler hedefe düşer', async () => {
      const a = await seedInHouse({ checkIn: -2, checkOut: 1, roomNumber: '101' });
      const b = await seedInHouse({ checkIn: -2, checkOut: 3, roomNumber: '102', firstName: 'Grup' });
      await folios.runRoomCharges(hotelId);
      const aMain = await primaryFolio(a.id);
      const bMain = await primaryFolio(b.id);
      const { item: minibar } = await charge(aMain.id);

      // Böl: minibar ABC Ltd. folyosuna; sonraki restoran kalemleri de oraya.
      const { folioId: company } = await desk(() =>
        folios.splitFolio(hotelId, aMain.id, { itemIds: [minibar.id], payerName: 'ABC Ltd.', routeTypes: ['FNB'] }),
      );
      const companyFolio = await db.folio.findUnique({ where: { id: company } });
      assert.deepEqual([companyFolio.window, companyFolio.payerName], [2, 'ABC Ltd.']);
      assert.equal((await db.folioItem.findUnique({ where: { id: minibar.id } })).transferredFromFolioId, aMain.id);
      await assertTotalsConsistent(aMain.id);
      await assertTotalsConsistent(company);

      // Aktar: A'nın ilk gecesi B'nin folyosuna (kaynak konaklama kalemde kalır).
      const [firstNight] = await itemsOf(a.id, { source: 'ROOM_NIGHT', folioId: aMain.id });
      await desk(() => folios.transferItems(hotelId, aMain.id, { itemIds: [firstNight.id], targetFolioId: bMain.id }));
      const page = await folios.listFolioItems(hotelId, bMain.id, { limit: 100, includeVoided: true });
      const moved = page.items.find((row) => row.id === firstNight.id);
      assert.equal(moved.origin.roomNumber, '101');
      assert.equal(moved.transferredFrom.window, 1);

      // Birleştir: A'nın ana folyosu B'ninkine (grup hesabı). A'nın oda ücretleri artık B'ye; restoran hâlâ ABC'ye.
      await desk(() => folios.mergeFolios(hotelId, bMain.id, { sourceFolioIds: [aMain.id] }));
      const merged = await db.folio.findUnique({ where: { id: aMain.id } });
      assert.deepEqual([merged.status, merged.mergedIntoId, String(merged.balance)], ['TRANSFERRED', bMain.id, '0']);
      const routes = await db.folioRoute.findMany({ where: { reservationId: a.id }, orderBy: { type: 'asc' } });
      assert.equal(routes.find((route) => route.type === 'ROOM').folioId, bMain.id);
      assert.equal(routes.find((route) => route.type === 'FNB').folioId, company);
      await assertTotalsConsistent(bMain.id);

      // Çıkışta A'nın kalan gecesi (bugün) grup folyosuna düşeceği için misafirin borcu değil.
      const pending = await folios.pendingStayCharges(db, hotelId, a, {
        keptNights: [day(-2), day(-1), day(0)].map((date) => ({ date, amount: '1000.00' })),
        lateFee: null,
      });
      assert.deepEqual([pending.own.length, pending.elsewhere.length, pending.elsewhere[0].folio.id], [0, 1, bMain.id]);

      await rejectsWith(desk(() => folios.transferItems(hotelId, aMain.id, { itemIds: [minibar.id], targetFolioId: bMain.id })), 'FOLIO_NOT_OPEN');
    });

    it('iptal onayı bekleyen ya da iptal edilmiş kalem taşınmaz; hedef kapalıysa aktarılmaz', async () => {
      const stay = await seedInHouse();
      const main = (await desk(() => folios.openFolio(hotelId, stay.id, {}))).folios[0];
      const { item } = await charge(main.id);
      const { folioId: second } = await desk(() => folios.splitFolio(hotelId, main.id, { itemIds: [], payerName: null, routeTypes: [] }));
      await desk(() => folios.requestVoid(hotelId, main.id, item.id, { reason: 'Hatalı' }));
      await rejectsWith(desk(() => folios.transferItems(hotelId, main.id, { itemIds: [item.id], targetFolioId: second })), 'ITEM_RULE');

      const { item: other } = await charge(main.id);
      await desk(() => folios.closeFolio(hotelId, second));
      await rejectsWith(desk(() => folios.transferItems(hotelId, main.id, { itemIds: [other.id], targetFolioId: second })), 'FOLIO_NOT_OPEN');
    });
  });

  describe('kapatma', () => {
    it('bakiye sıfır değilse kapanmaz; içerideki misafirin son açık folyosu kapanmaz; ödenince kapanır, yeniden açılır', async () => {
      const stay = await seedInHouse();
      const main = (await desk(() => folios.openFolio(hotelId, stay.id, {}))).folios[0];
      await charge(main.id);
      await rejectsWith(desk(() => folios.closeFolio(hotelId, main.id)), 'FOLIO_RULE', /son açık/);
      const { folioId: second } = await desk(() => folios.splitFolio(hotelId, main.id, { itemIds: [], payerName: null, routeTypes: [] }));
      await rejectsWith(desk(() => folios.closeFolio(hotelId, main.id)), 'FOLIO_RULE', /Bakiye sıfır değil/);

      await pay(main.id, '91.00');
      await desk(() => folios.closeFolio(hotelId, main.id));
      const [closed] = await eventsNamed('folio.closed');
      assert.deepEqual([closed.payload.folioId, closed.payload.chargesTotal], [main.id, '91.00']);
      await rejectsWith(desk(() => folios.closeFolio(hotelId, second)), 'FOLIO_RULE', /son açık/);

      await as(MANAGER, () => folios.reopenFolio(hotelId, main.id, { reason: 'Geç gelen restoran fişi' }));
      assert.equal((await db.folio.findUnique({ where: { id: main.id } })).status, 'OPEN');
      await rejectsWith(as(MANAGER, () => folios.reopenFolio(hotelId, main.id, { reason: 'tekrar' })), 'FOLIO_RULE');
    });
  });

  describe('giriş / çıkış (aktör işleri)', () => {
    /** Rezervasyon (modül 4 servisiyle). */
    async function book({ checkIn = 0, nights = 2, roomNumber = '103' } = {}) {
      const { reservation } = await desk(() =>
        reservations.createReservation(hotelId, {
          guestId: null,
          guest: { firstName: 'Ece', lastName: 'Yıldız', phone: `+90532${String(Math.random()).slice(2, 9)}`, email: null, nationality: 'TR' },
          forceNewGuest: true,
          roomTypeId: types.std.id,
          adults: 1,
          children: 0,
          boardType: 'BB',
          checkIn: new Date(day(checkIn)),
          checkOut: new Date(day(checkIn + nights)),
          status: 'CONFIRMED',
          source: 'PHONE',
          notes: null,
          requestId: randomUUID(),
          waitlistId: null,
          roomId: room[roomNumber].id,
          manualTotal: null,
          priceNote: null,
        }),
      );
      return reservation;
    }
    const version = async (id) => (await db.reservation.findUnique({ where: { id } })).updatedAt;

    it('girişte folyo açılır, erken giriş ücreti bir kez işlenir; giriş geri alınabilir, ücret ters kayıtla düşer', async () => {
      const reservation = await book();
      await desk(async () =>
        frontDesk.checkIn(
          hotelId,
          reservation.id,
          contracts.checkInSchema.parse({
            expectedUpdatedAt: await version(reservation.id),
            guest: { idType: 'NATIONAL_ID', idNumber: TC, nationality: 'TR' },
            expectedEarlyFee: '300',
          }),
          { now: at('10:00') },
        ),
      );
      const first = await as('billing-worker', () => folios.openStayOnCheckIn(hotelId, reservation.id, { earlyCheckInFee: '300.00', eventId: randomUUID() }));
      // 300 KDV dahil: net 272.73; konaklama vergisi %2 net üzerine 5.45.
      assert.deepEqual(first, { opened: true, feePosted: '305.45' });
      const second = await as('billing-worker', () => folios.openStayOnCheckIn(hotelId, reservation.id, { earlyCheckInFee: '300.00', eventId: randomUUID() }));
      assert.deepEqual(second, { opened: false, feePosted: null });

      // Erken giriş ücreti girişin kendi ücreti: geri almayı engellemez.
      const revertedAt = new Date();
      await desk(async () =>
        frontDesk.revertCheckIn(hotelId, reservation.id, { expectedUpdatedAt: await version(reservation.id), reason: 'Yanlış misafir' }, { now: at('18:00') }),
      );
      assert.deepEqual(await as('billing-worker', () => folios.reverseCheckInFees(hotelId, reservation.id, { reason: 'Yanlış misafir', occurredAt: revertedAt })), { reversed: 1 });
      const folio = await primaryFolio(reservation.id);
      assert.equal(String((await db.folio.findUnique({ where: { id: folio.id } })).balance), '0');
    });

    it('çıkışta kalan geceler ve geç çıkış ücreti işlenir, bakiyesi kapanan folyo kapanır; çıkış geri alınınca açılır, ücret düşer', async () => {
      const stay = await seedInHouse({ checkIn: -2, checkOut: 0 });
      await folios.runRoomCharges(hotelId, { night: day(-2) });
      const folio = await primaryFolio(stay.id);
      // İki gece (biri işlenmiş, biri çıkışta) + geç çıkış 400 (net 363.64 + %2 = 7.27): 1018.18 × 2 + 407.27.
      await pay(folio.id, '2443.63');
      const preview = await frontDesk.getCheckOutPreview(hotelId, stay.id, { now: at('13:00') });
      assert.deepEqual([preview.due, preview.pendingCharges.own.map((line) => line.source)], ['0.00', ['ROOM_NIGHT', 'LATE_CHECK_OUT']]);
      await desk(async () =>
        frontDesk.checkOut(
          hotelId,
          stay.id,
          contracts.checkOutSchema.parse({ expectedUpdatedAt: await version(stay.id), expectedLateFee: '400' }),
          { now: at('13:00') },
        ),
      );

      const settled = await as('billing-worker', () =>
        folios.settleStayOnCheckOut(hotelId, stay.id, { lateCheckOutFee: '400.00', openBalance: null, eventId: randomUUID() }),
      );
      assert.deepEqual(settled, { roomItems: 1, feePosted: '407.27', closed: 1, open: 0 });
      assert.equal((await db.folio.findUnique({ where: { id: folio.id } })).status, 'CLOSED');
      assert.equal((await eventsNamed('folio.closed')).length, 1);

      const revertedAt = new Date();
      await desk(async () =>
        frontDesk.revertCheckOut(hotelId, stay.id, { expectedUpdatedAt: await version(stay.id), reason: 'Misafir kalıyor' }, { now: at('17:00') }),
      );
      const reopened = await as('billing-worker', () =>
        folios.reopenStayOnCheckOutRevert(hotelId, stay.id, { reason: 'Misafir kalıyor', occurredAt: revertedAt }),
      );
      assert.deepEqual(reopened, { reopened: 1, reversed: 1 });
      await assertTotalsConsistent(folio.id);
      assert.equal(String((await db.folio.findUnique({ where: { id: folio.id } })).balance), '-407.27');
    });

    it('gelmedi ücreti folyoya işlenir ("Diğer" vergisi); rezervasyon geri alınınca düşer', async () => {
      const reservation = await book({ checkIn: 0, nights: 2, roomNumber: '103' });
      await desk(async () =>
        reservations.markNoShow(hotelId, reservation.id, { expectedUpdatedAt: await version(reservation.id), waiveFee: false }),
      );
      const posted = await as('billing-worker', () => folios.postReservationFee(hotelId, reservation.id, { kind: 'NO_SHOW', eventId: randomUUID() }));
      assert.deepEqual(posted, { posted: '1000.00' });
      const [fee] = await itemsOf(reservation.id, { source: 'NO_SHOW' });
      assert.deepEqual([fee.type, fee.taxCategory, fee.taxLines.length], ['OTHER', 'OTHER', 0]);

      const reinstatedAt = new Date();
      await desk(async () => reservations.reinstateReservation(hotelId, reservation.id, { expectedUpdatedAt: await version(reservation.id) }));
      assert.deepEqual(await folios.reverseReservationFees(hotelId, reservation.id, { occurredAt: reinstatedAt }), { reversed: 1 });
    });
  });

  describe('dış harcama', () => {
    it('minibar tüketimi odadaki misafirin folyosuna yönlendirmeyle düşer; misafir yoksa iş kuralı hatası', async () => {
      const stay = await seedInHouse({ roomNumber: '101' });
      const result = await as('billing-worker', () =>
        folios.postExternalCharge(
          hotelId,
          { reservationId: null, roomId: room['101'].id, reference: 'MB-1042', items: [{ description: 'Su', unitPrice: '45.50', quantity: 2 }, { description: 'Çikolata', unitPrice: '60', quantity: 1 }] },
          { source: 'MINIBAR', eventId: 'evt-mb' },
        ),
      );
      assert.deepEqual(result, { reservationId: stay.id, items: 2, total: '151.00', late: false });
      // Aynı olay yeniden gelirse ikinci kez yazılmaz.
      await as('billing-worker', () =>
        folios.postExternalCharge(
          hotelId,
          { reservationId: null, roomId: room['101'].id, reference: 'MB-1042', items: [{ description: 'Su', unitPrice: '45.50', quantity: 2 }, { description: 'Çikolata', unitPrice: '60', quantity: 1 }] },
          { source: 'MINIBAR', eventId: 'evt-mb' },
        ),
      );
      assert.equal(await db.folioItem.count({ where: { reservationId: stay.id, source: 'MINIBAR' } }), 2);
      await rejectsWith(
        folios.postExternalCharge(hotelId, { reservationId: null, roomId: room['103'].id, reference: 'MB-7', items: [{ description: 'Su', unitPrice: '45', quantity: 1 }] }, { source: 'MINIBAR', eventId: 'evt-2' }),
        'NO_STAY',
      );
    });
  });

  describe('liste ve zamanlayıcı', () => {
    it('içeridekiler oda sırasıyla, açık bakiye çıkmışlar, arama oda numarası / ödeyen adıyla', async () => {
      const a = await seedInHouse({ roomNumber: '102' });
      const b = await seedInHouse({ roomNumber: '101', firstName: 'Ayşe' });
      await folios.runRoomCharges(hotelId);
      const { folioId } = await desk(async () =>
        folios.splitFolio(hotelId, (await primaryFolio(a.id)).id, { itemIds: [], payerName: 'Delta Turizm', routeTypes: [] }),
      );
      await db.reservation.update({ where: { id: b.id }, data: { status: 'CHECKED_OUT', checkedOutAt: new Date(), checkedOutBy: DESK } });

      const inHouse = await folios.listFolios(hotelId, { view: 'IN_HOUSE', page: 1, pageSize: 20 });
      assert.deepEqual(inHouse.items.map((row) => [row.stay.room.number, row.window]), [['102', 1], ['102', 2]]);
      const openBalance = await folios.listFolios(hotelId, { view: 'OPEN_BALANCE', page: 1, pageSize: 20 });
      assert.deepEqual(openBalance.items.map((row) => row.stay.id), [b.id]);
      const byPayer = await folios.listFolios(hotelId, { view: 'OPEN', search: 'delta', page: 1, pageSize: 20 });
      assert.deepEqual(byPayer.items.map((row) => row.id), [folioId]);
      const byRoom = await folios.listFolios(hotelId, { view: 'OPEN', search: '101', page: 1, pageSize: 20 });
      assert.deepEqual(byRoom.items.map((row) => row.stay.id), [b.id]);
    });

    it('zamanlayıcı gece başına bir kez haber verir', async () => {
      await seedInHouse();
      assert.equal(await folios.scheduleDueRoomCharges(), 1);
      assert.equal(await folios.scheduleDueRoomCharges(), 0);
      const [due] = await eventsNamed('folio.room_charges.due');
      assert.equal(due.payload.night, day(-1));
    });
  });
});
