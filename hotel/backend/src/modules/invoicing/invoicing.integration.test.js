import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Fatura ve e-belge (modül 16 çekirdeği + 49) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: folyo kapanınca taslak (folyo aktörü), alıcının misafirden / cariden gelmesi, eksik alıcıda kesimin
 * durması; kesimde e-Arşiv / e-Fatura ayrımı (test mükellef listesi), numara biçimi ve sırası, UBL belgesi, gönderim
 * → GİB sonucu (tamamlandı / reddedildi), geçici hatada yeniden deneme ve hak bitince "gönderilemedi" + uyarı,
 * tekrar gönderim; faturalı folyonun yeniden açılamaması; iptal (dört göz): e-Fatura portal referansıyla, e-Arşiv
 * entegratörden, GİB'e ulaşmamış yerelde; ön muhasebe bağı (folyo aktarımına numara, serbest faturanın alacağı ve
 * iptalde ters kaydı); etkinlik faturası (kalemler, iptal bedeli eşitliği); kaynak değişince taslağın yenilenmesi;
 * yabancı uyruklu kişi ve yurt dışındaki şirket (2222222222, tür carinin sonraki taslağında); eşzamanlı kesimde
 * boşluksuz sıra, aynı folyoya tek taslak; faturalama başlangıcı (kuyruk, saat dilimi sınırı,
 * taslak uyarısı); izinler ve otel kapsamı; PDF.
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
const COMPANY_VKN = '1234567890';

describe('fatura ve e-belge (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let invoices;
  /** @type {any} */ let settings;
  /** @type {any} */ let dispatcher;
  /** @type {any} */ let folios;
  /** @type {any} */ let folioRules;
  /** @type {any} */ let payments;
  /** @type {any} */ let approvals;
  /** @type {any} */ let accounts;
  /** @type {any} */ let postings;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let otherHotelId;
  /** @type {Map<string, string>} */ let tokens;
  /** @type {Record<string, any>} */ let tax;
  /** @type {any} */ let roomType;
  /** @type {any} */ let room;
  /** @type {any} */ let company;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    invoices = await import('./invoices.js');
    settings = await import('./settings.js');
    dispatcher = await import('./dispatcher.js');
    folios = await import('../folios/service.js');
    folioRules = await import('../folios/rules.js');
    payments = await import('../payments/service.js');
    approvals = await import('../approvals/service.js');
    accounts = await import('../accounting/accounts.js');
    postings = await import('../accounting/postings.js');
    cache = await import('../../lib/cache.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    dispatcher?.stopEdocDispatcher();
    await app?.close();
    await db?.$disconnect();
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const boss = (fn) => as(MANAGER, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const D = (offset) => core.toIsoDay(core.addDays(today(), offset));
  const money = (value) => core.toMoneyString(String(value));
  const year = () => D(0).slice(0, 4);

  async function rejectsWith(promise, code, message) {
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, code, `${error.code}: ${error.message}`);
      if (message) assert.match(error.message, message);
      return true;
    });
  }

  const ADDRESS = { street: 'Atatürk Bulvarı 10', district: 'Çankaya', city: 'Ankara', country: 'Türkiye' };

  beforeEach(async () => {
    dispatcher.stopEdocDispatcher();
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
    // Oda: KDV %10 + konaklama vergisi %2 dahil; minibar ve diğer: KDV %20 dahil.
    tax = {
      kdv10: await db.tax.create({ data: { hotelId, name: 'KDV %10', rate: '10', isIncluded: true, appliesTo: ['ROOM', 'FNB'] } }),
      kv: await db.tax.create({ data: { hotelId, name: 'Konaklama vergisi', rate: '2', isIncluded: true, appliesTo: ['ROOM'] } }),
      kdv20: await db.tax.create({ data: { hotelId, name: 'KDV %20', rate: '20', isIncluded: true, appliesTo: ['MINIBAR', 'OTHER', 'SPA', 'LAUNDRY'] } }),
    };
    roomType = await db.roomType.create({ data: { hotelId, code: 'STD', name: 'Standart', basePrice: '1000', capacityAdults: 3, capacityChildren: 1 } });
    room = await db.room.create({ data: { hotelId, number: '204', roomTypeId: roomType.id } });
    await saveSettings();
    company = await as(ACCOUNTING, () => accounts.createAccount(hotelId, contracts.ledgerAccountCreateSchema.parse({ type: 'COMPANY', name: 'Demir Holding A.Ş.', taxNumber: COMPANY_VKN, taxOffice: 'Kavaklıdere', paymentTermDays: 30 })));
  });

  async function saveSettings(extra = {}) {
    const current = await settings.getInvoiceSettings(hotelId);
    return boss(() =>
      settings.saveInvoiceSettings(
        hotelId,
        contracts.invoiceSettingsSchema.parse({
          expectedUpdatedAt: current.settings?.updatedAt ?? null,
          legalName: 'Büyük Ankara Turizm A.Ş.',
          taxNumber: '9876543217',
          taxOffice: 'Çankaya',
          street: 'Kızılay Meydanı 1',
          district: 'Çankaya',
          city: 'Ankara',
          eFaturaPrefix: 'FTR',
          eArsivPrefix: 'EAR',
          provider: 'TEST',
          environment: 'TEST',
          startDate: D(-30),
          taxCodes: [
            { taxId: tax.kdv10.id, code: '0015' },
            { taxId: tax.kv.id, code: '0059' },
            { taxId: tax.kdv20.id, code: '0015' },
          ],
          ...extra,
        }),
      ),
    );
  }

  const tokenOf = async (email) => {
    if (tokens.has(email)) return tokens.get(email);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
    assert.equal(response.statusCode, 200, response.body);
    tokens.set(email, response.json().data.accessToken);
    return tokens.get(email);
  };
  const call = async (method, url, email, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${await tokenOf(email)}` } });

  /* ── Yardımcılar ── */

  const taxSettings = () => Object.values(tax).map((row) => ({ id: row.id, name: row.name, rate: String(row.rate), isIncluded: row.isIncluded, appliesTo: row.appliesTo }));

  /**
   * İçerideki konaklama; folyoda iki gece (1.120 dahil: net 1.000, KDV 100, KV 20) ve minibar 240 → toplam 2.480.
   * @param {{ guest?: object }} [options]
   */
  async function stayWithCharges({ guest = { firstName: 'Ayşe', lastName: 'Demir', idType: 'NATIONAL_ID', idNumber: TC, nationality: 'TR' } } = {}) {
    const guestRow = await db.guest.create({ data: { hotelId, ...guest } });
    const stay = await db.reservation.create({
      data: {
        hotelId,
        guestId: guestRow.id,
        roomTypeId: roomType.id,
        roomId: room.id,
        source: 'UI',
        checkIn: new Date(`${D(-2)}T00:00:00.000Z`),
        checkOut: new Date(`${D(0)}T00:00:00.000Z`),
        status: 'CHECKED_IN',
        checkedInAt: new Date(),
        checkedInBy: DESK,
        confirmedAt: new Date(),
        totalPrice: '2240.00',
        confirmationCode: `H${randomUUID().slice(0, 7).toUpperCase()}`,
      },
    });
    await as(DESK, () => folios.openFolio(hotelId, stay.id, {}));
    const folio = await db.folio.findFirst({ where: { reservationId: stay.id } });
    for (const offset of [-2, -1]) {
      const line = folioRules.chargeLine({ amount: '1120', quantity: 1, taxCategory: 'ROOM', taxes: taxSettings() });
      await db.folioItem.create({
        data: {
          hotelId,
          folioId: folio.id,
          reservationId: stay.id,
          type: 'ROOM',
          source: 'ROOM_NIGHT',
          description: 'Oda ücreti',
          amount: line.amount,
          quantity: 1,
          taxCategory: 'ROOM',
          netAmount: line.netAmount,
          taxAmount: line.taxAmount,
          total: line.total,
          taxLines: line.taxLines,
          serviceDate: new Date(`${D(offset)}T00:00:00.000Z`),
          sourceKey: `NIGHT:${stay.id}:${offset}`,
          postedBy: 'system',
        },
      });
    }
    await as(DESK, () => folios.postCharge(hotelId, folio.id, contracts.postChargeSchema.parse({ requestId: randomUUID(), type: 'MINIBAR', description: 'Minibar', amount: '240', quantity: 1 })));
    return { stay, folio, guest: guestRow };
  }

  /** Bakiyeyi kapat, çıkışı yaz, folyoyu kapat (folyo aktörü taslağı açar). */
  async function settleAndClose({ stay, folio }, payment = { method: 'CASH' }) {
    await as(DESK, () => payments.receivePayment(hotelId, folio.id, contracts.receivePaymentSchema.parse({ requestId: randomUUID(), amount: '2480', ...payment })));
    await db.reservation.update({ where: { id: stay.id }, data: { status: 'CHECKED_OUT', checkedOutAt: new Date(), checkedOutBy: DESK } });
    const current = await db.folio.findUnique({ where: { id: folio.id } });
    if (current.status === 'OPEN') await as(DESK, () => folios.closeFolio(hotelId, folio.id));
    return db.invoice.findFirst({ where: { folioId: folio.id, status: 'DRAFT' } });
  }

  const detail = (invoiceId) => invoices.getInvoice(hotelId, invoiceId);
  /** Taslağın alıcısını tamamla (adres) ve kes; gönderici tetiklemesini durdurur (test turları elle). */
  async function completeAndIssue(invoiceId, buyerPatch = {}, email = DESK) {
    const current = await detail(invoiceId);
    await as(email, () => invoices.updateDraft(hotelId, invoiceId, contracts.invoiceDraftUpdateSchema.parse({ expectedUpdatedAt: current.invoice.updatedAt, buyer: { ...current.invoice.buyer, ...ADDRESS, ...buyerPatch } })));
    const fresh = await detail(invoiceId);
    const issued = await as(email, () => invoices.issueInvoice(hotelId, invoiceId, { expectedUpdatedAt: fresh.invoice.updatedAt }));
    dispatcher.stopEdocDispatcher();
    return issued;
  }
  const later = (seconds = 120) => new Date(Date.now() + seconds * 1000);
  const testTaxpayer = (input) => boss(() => settings.createTestTaxpayer(hotelId, contracts.testTaxpayerSchema.parse({ taxNumber: COMPANY_VKN, title: 'Demir Holding A.Ş.', alias: 'urn:mail:defaultpk@demir.com.tr', ...input })));
  const invoiceAlerts = () => db.staffAlert.findMany({ where: { hotelId, kind: 'INVOICE' } });

  /* ═══════════════ Folyo → taslak → kesim → GİB ═══════════════ */

  describe('folyo faturası', () => {
    it('folyo kapanınca taslak açılır (misafir alıcı); adres eksikken kesilmez; kesimde e-Arşiv, numara, UBL; gönderim → GİB tamamlandı; PDF', async () => {
      const stay = await stayWithCharges();
      const draft = await settleAndClose(stay);
      assert.ok(draft, 'folyo aktörü taslağı açmalı');
      let view = await detail(draft.id);
      assert.equal(view.invoice.buyer.type, 'PERSON');
      assert.equal(view.invoice.buyer.taxNumber, TC);
      assert.deepEqual(
        view.lines.map((line) => [line.description, line.net, line.taxAmount, line.total]),
        [
          [`Konaklama (${D(-2).split('-').reverse().join('.')} – ${D(-1).split('-').reverse().join('.')})`, '2000.00', '240.00', '2240.00'],
          [`Minibar (${D(0).split('-').reverse().join('.')})`, '200.00', '40.00', '240.00'],
        ],
      );
      assert.equal(view.invoice.total, '2480.00', 'folyo toplamıyla aynı');
      assert.ok(view.issueProblems.some((problem) => /İlçe/.test(problem)));

      await rejectsWith(as(DESK, () => invoices.issueInvoice(hotelId, draft.id, { expectedUpdatedAt: view.invoice.updatedAt })), 'VALIDATION', /İlçe zorunlu/);

      view = await completeAndIssue(draft.id);
      assert.equal(view.invoice.status, 'ISSUED');
      assert.equal(view.invoice.documentType, 'E_ARSIV');
      assert.equal(view.invoice.number, `EAR${year()}000000001`);
      assert.equal(view.invoice.edocState, 'QUEUED');
      assert.deepEqual(
        view.invoice.taxes.map((row) => [row.code, row.rate, row.base, row.amount]),
        [
          ['0015', '20', '200.00', '40.00'],
          ['0015', '10', '2000.00', '200.00'],
          ['0059', '2', '2000.00', '40.00'],
        ],
      );
      const document = await db.invoiceDocument.findUnique({ where: { invoiceId: draft.id } });
      assert.match(document.xml, new RegExp(`<cbc:UUID>${view.invoice.uuid}</cbc:UUID>`));
      assert.match(document.xml, /<cbc:ProfileID>EARSIVFATURA<\/cbc:ProfileID>/);

      assert.equal(await dispatcher.dispatchDueEdocs(), 1);
      assert.equal((await detail(draft.id)).invoice.edocState, 'SENT');
      await dispatcher.pollEdocStatuses(undefined, later());
      assert.equal((await detail(draft.id)).invoice.edocState, 'SENT', 'ilk sorguda GİB işliyor');
      await dispatcher.pollEdocStatuses(undefined, later(240));
      view = await detail(draft.id);
      assert.equal(view.invoice.edocState, 'DELIVERED');
      assert.deepEqual(view.logs.map((log) => log.kind).reverse(), ['CREATED', 'UPDATED', 'ISSUED', 'QUEUED', 'SENT', 'DELIVERED']);

      const pdf = await call('GET', `/invoices/${draft.id}/pdf`, DESK);
      assert.equal(pdf.statusCode, 200);
      assert.equal(pdf.headers['content-type'], 'application/pdf');
      assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');

      // Faturalı folyo açılmaz.
      await rejectsWith(boss(() => folios.reopenFolio(hotelId, stay.folio.id, { reason: 'Geç minibar' })), 'FOLIO_INVOICED');
    });

    it('cariye aktarılan folyo: alıcı cari; kayıtlı mükellefe e-Fatura (posta kutusu); numara cari harekete bağlanır, iptalde çözülür', async () => {
      await testTaxpayer({});
      const stay = await stayWithCharges();
      const draft = await settleAndClose(stay, { method: 'AGENCY', ledgerAccountId: company.account.id });
      const view = await detail(draft.id);
      assert.equal(view.invoice.buyer.type, 'COMPANY');
      assert.equal(view.invoice.buyer.taxNumber, COMPANY_VKN);
      assert.equal(view.invoice.ledgerAccountId, company.account.id);

      const issued = await completeAndIssue(draft.id);
      assert.equal(issued.invoice.documentType, 'E_FATURA');
      assert.equal(issued.invoice.number, `FTR${year()}000000001`);
      assert.equal(issued.invoice.receiverAlias, 'urn:mail:defaultpk@demir.com.tr');
      const transfer = await db.ledgerEntry.findFirst({ where: { accountId: company.account.id, sourceType: 'FOLIO_TRANSFER' } });
      assert.equal(transfer.invoiceNumber, issued.invoice.number, 'muhasebe aktörü numarayı bağlar');
      assert.equal(money((await db.ledgerAccount.findUnique({ where: { id: company.account.id } })).balance), '2480.00', 'ikinci alacak yazılmaz');

      await dispatcher.dispatchDueEdocs();
      await dispatcher.pollEdocStatuses(undefined, later());
      await dispatcher.pollEdocStatuses(undefined, later(240));
      assert.equal((await detail(draft.id)).invoice.edocState, 'DELIVERED');

      // GİB'e ulaşmış e-Fatura: portal referansı zorunlu; isteyen onaylayamaz; başka yönetici onaylar.
      await rejectsWith(as(ACCOUNTING, () => invoices.requestCancel(hotelId, draft.id, { reason: 'Yanlış alıcı ünvanı' })), 'VALIDATION', /portal/);
      const pending = await as(ACCOUNTING, () => invoices.requestCancel(hotelId, draft.id, { reason: 'Yanlış alıcı ünvanı', portalReference: 'GIB-IPTAL-2026-77' }));
      assert.equal(pending.invoice.status, 'CANCEL_PENDING');
      await rejectsWith(as(ACCOUNTING, () => approvals.decideApproval(hotelId, pending.invoice.cancelApprovalId, 'GRANTED', { note: 'Kendim' })), 'SELF_DECISION');
      await as(MANAGER2, () => approvals.decideApproval(hotelId, pending.invoice.cancelApprovalId, 'GRANTED', { note: 'Tamam' }));
      const cancelled = await detail(draft.id);
      assert.deepEqual([cancelled.invoice.status, cancelled.invoice.cancelMethod, cancelled.invoice.edocState], ['CANCELLED', 'PORTAL', 'CANCELLED']);
      assert.equal((await db.ledgerEntry.findUnique({ where: { id: transfer.id } })).invoiceNumber, null, 'bağ çözüldü');

      // Folyo yeniden faturalanabilir: yeni taslak, yeni numara.
      const copy = await as(DESK, () => invoices.copyInvoice(hotelId, draft.id));
      const reissued = await completeAndIssue(copy.invoiceId);
      assert.equal(reissued.invoice.number, `FTR${year()}000000002`);
    });

    it('e-Arşiv: GİB\'e ulaşmadan iptal yerelde (gönderim durur); ulaştıktan sonra entegratörden; ret kararında fatura kesilmiş kalır', async () => {
      const first = await settleAndClose(await stayWithCharges());
      await completeAndIssue(first.id);
      const pending = await as(ACCOUNTING, () => invoices.requestCancel(hotelId, first.id, { reason: 'Mükerrer kesim' }));
      assert.equal(await dispatcher.dispatchDueEdocs(), 0, 'iptal onayı bekleyen fatura gönderilmez');
      await as(MANAGER2, () => approvals.decideApproval(hotelId, pending.invoice.cancelApprovalId, 'GRANTED', {}));
      assert.deepEqual([(await detail(first.id)).invoice.cancelMethod, (await detail(first.id)).invoice.edocState], ['LOCAL', 'CANCELLED']);

      const second = await settleAndClose(await stayWithCharges({ guest: { firstName: 'Mehmet', lastName: 'Kaya', idType: 'NATIONAL_ID', idNumber: TC } }));
      await completeAndIssue(second.id);
      await dispatcher.dispatchDueEdocs();
      const denied = await as(ACCOUNTING, () => invoices.requestCancel(hotelId, second.id, { reason: 'Misafir şirkete istedi' }));
      await as(MANAGER2, () => approvals.decideApproval(hotelId, denied.invoice.cancelApprovalId, 'DENIED', { note: 'Önce şirket bilgisi gelsin' }));
      assert.equal((await detail(second.id)).invoice.status, 'ISSUED');
      const again = await as(ACCOUNTING, () => invoices.requestCancel(hotelId, second.id, { reason: 'Misafir şirkete istedi' }));
      await as(MANAGER2, () => approvals.decideApproval(hotelId, again.invoice.cancelApprovalId, 'GRANTED', {}));
      const view = await detail(second.id);
      assert.deepEqual([view.invoice.status, view.invoice.cancelMethod], ['CANCELLED', 'INTEGRATOR']);
      assert.equal(view.logs[0].code, 'T-CANCELLED');
      // İptalden sonra folyo yeniden açılabilir (taslak yok, fatura iptal).
      const { folioId } = await db.invoice.findUnique({ where: { id: second.id } });
      await boss(() => folios.reopenFolio(hotelId, folioId, { reason: 'Geç harcama' }));
    });

    it('yabancı uyruklu misafir: pasaport ve uyrukla e-Arşiv; UBL kimliği 11111111111', async () => {
      const draft = await settleAndClose(await stayWithCharges({ guest: { firstName: 'Hans', lastName: 'Müller', idType: 'PASSPORT', idNumber: 'C01X00T47', nationality: 'DE' } }));
      const view = await detail(draft.id);
      assert.deepEqual([view.invoice.buyer.type, view.invoice.buyer.nationality, view.invoice.buyer.passportNo], ['FOREIGN', 'DE', 'C01X00T47']);
      const issued = await completeAndIssue(draft.id, { district: 'Mitte', city: 'Berlin', country: 'Almanya' });
      assert.equal(issued.invoice.documentType, 'E_ARSIV');
      const document = await db.invoiceDocument.findUnique({ where: { invoiceId: draft.id } });
      assert.match(document.xml, /<cbc:ID schemeID="TCKN">11111111111<\/cbc:ID>/);
      assert.match(document.xml, /<cbc:NationalityID>DE<\/cbc:NationalityID>/);
    });

    it('yurt dışındaki şirket (tur operatörü): VKN yerine 2222222222, e-Arşiv; tür aynı carinin sonraki taslağında hatırlanır', async () => {
      const operator = await as(ACCOUNTING, () => accounts.createAccount(hotelId, contracts.ledgerAccountCreateSchema.parse({ type: 'COMPANY', name: 'Sunway Reisen GmbH', paymentTermDays: 30 })));
      const draft = await settleAndClose(await stayWithCharges(), { method: 'AGENCY', ledgerAccountId: operator.account.id });
      const view = await detail(draft.id);
      assert.equal(view.invoice.buyer.type, 'COMPANY');
      assert.ok(view.issueProblems.some((problem) => /Vergi no/.test(problem)), 'Türk VKN yok: şirket olarak kesilemez');
      const foreign = { type: 'FOREIGN_COMPANY', taxOffice: null, foreignTaxId: 'DE298765431', street: 'Hohenzollernring 12', district: 'Innenstadt', city: 'Köln', country: 'Almanya' };
      const issued = await completeAndIssue(draft.id, foreign);
      assert.equal(issued.invoice.documentType, 'E_ARSIV');
      const row = await db.invoice.findUnique({ where: { id: draft.id } });
      assert.deepEqual([row.buyerType, row.buyerName, row.buyerTaxNumber], ['FOREIGN_COMPANY', 'Sunway Reisen GmbH', null]);
      const document = await db.invoiceDocument.findUnique({ where: { invoiceId: draft.id } });
      assert.match(document.xml, /<cbc:ID schemeID="VKN">2222222222<\/cbc:ID>/);
      assert.match(document.xml, /Ülke: Almanya · Vergi no: DE298765431/);

      // Aynı carinin sonraki folyosu: tür, ülke ve vergi no önceki faturadan; kesime hazır.
      const next = await settleAndClose(await stayWithCharges(), { method: 'AGENCY', ledgerAccountId: operator.account.id });
      const nextView = await detail(next.id);
      assert.deepEqual([nextView.invoice.buyer.type, nextView.invoice.buyer.country, nextView.invoice.buyer.foreignTaxId], ['FOREIGN_COMPANY', 'Almanya', 'DE298765431']);
      assert.deepEqual(nextView.issueProblems, []);
    });
  });

  /* ═══════════════ Gönderim hataları ═══════════════ */

  describe('gönderim hataları', () => {
    it('geçici hata: artan aralıkla yeniden; hak bitince "gönderilemedi" ve uyarı; tekrar gönderimle yeniden sıraya', async () => {
      await testTaxpayer({ behavior: 'UNAVAILABLE' });
      const draft = await settleAndClose(await stayWithCharges(), { method: 'AGENCY', ledgerAccountId: company.account.id });
      await completeAndIssue(draft.id);
      await dispatcher.dispatchDueEdocs();
      let row = await db.invoice.findUnique({ where: { id: draft.id } });
      assert.deepEqual([row.edocState, row.edocAttempts], ['QUEUED', 1]);
      assert.ok(row.edocNextAttemptAt > new Date(Date.now() + 50_000), 'bir dakika sonra yeniden');
      // Hakkın sonuna getir.
      await db.invoice.update({ where: { id: draft.id }, data: { edocAttempts: contracts.EDOC_RETRY_DELAYS_MS.length, edocNextAttemptAt: new Date(Date.now() - 1000) } });
      await dispatcher.dispatchDueEdocs();
      row = await db.invoice.findUnique({ where: { id: draft.id } });
      assert.equal(row.edocState, 'FAILED');
      assert.equal((await invoiceAlerts()).length, 1);
      await as(DESK, () => invoices.resendInvoice(hotelId, draft.id));
      dispatcher.stopEdocDispatcher();
      row = await db.invoice.findUnique({ where: { id: draft.id } });
      assert.deepEqual([row.edocState, row.edocAttempts], ['QUEUED', 0]);
      await rejectsWith(as(DESK, () => invoices.resendInvoice(hotelId, draft.id)), 'EDOC_NOT_RESENDABLE');
    });

    it('GİB reddi: entegratör aldı, durum sorgusunda reddedildi; uyarı açılır', async () => {
      await testTaxpayer({ behavior: 'NO_MAILBOX' });
      const draft = await settleAndClose(await stayWithCharges(), { method: 'AGENCY', ledgerAccountId: company.account.id });
      await completeAndIssue(draft.id);
      await dispatcher.dispatchDueEdocs();
      await dispatcher.pollEdocStatuses(undefined, later());
      await dispatcher.pollEdocStatuses(undefined, later(240));
      const view = await detail(draft.id);
      assert.deepEqual([view.invoice.edocState, view.invoice.edocStatusCode], ['REJECTED', 'T-NO-MAILBOX']);
      assert.match((await invoiceAlerts())[0].title, /reddedildi/);
    });
  });

  /* ═══════════════ Serbest ve etkinlik faturası ═══════════════ */

  describe('serbest ve etkinlik faturası', () => {
    it('serbest fatura cariye vadeli alacak yazar; iptal (GİB\'e ulaşmadan) fatura tarihli ters kayıtla düşer', async () => {
      const created = await as(ACCOUNTING, () =>
        invoices.createDraft(
          hotelId,
          contracts.invoiceDraftCreateSchema.parse({
            source: 'MANUAL',
            ledgerAccountId: company.account.id,
            lines: [{ description: 'Toplantı salonu kirası', quantity: '2', unitCode: 'DAY', unitAmount: '6000', taxCategory: 'OTHER' }],
          }),
        ),
      );
      const issued = await completeAndIssue(created.invoiceId, {}, ACCOUNTING);
      assert.deepEqual([issued.lines[0].quantity, issued.lines[0].unitCode, issued.lines[0].unitPrice, issued.invoice.netTotal, issued.invoice.total], ['2', 'DAY', '5000.00', '10000.00', '12000.00']);
      const entry = await db.ledgerEntry.findFirst({ where: { accountId: company.account.id, sourceType: 'INVOICE' } });
      assert.deepEqual([money(entry.debit), entry.invoiceNumber, core.toIsoDay(entry.dueDate)], ['12000.00', issued.invoice.number, D(30)]);

      const pending = await as(ACCOUNTING, () => invoices.requestCancel(hotelId, created.invoiceId, { reason: 'Tutar yanlış girildi' }));
      await as(MANAGER2, () => approvals.decideApproval(hotelId, pending.invoice.cancelApprovalId, 'GRANTED', {}));
      assert.equal(money((await db.ledgerAccount.findUnique({ where: { id: company.account.id } })).balance), '0.00');
      const reversal = await db.ledgerEntry.findFirst({ where: { reversalOfId: entry.id } });
      assert.equal(core.toIsoDay(reversal.date), core.toIsoDay(entry.date), 'fatura tarihli');
    });

    it('şahıs carisine fatura: alıcı kişi (ad soyad ayrılır, TC kimlik no karttan), şirket değil', async () => {
      const person = await as(ACCOUNTING, () => accounts.createAccount(hotelId, contracts.ledgerAccountCreateSchema.parse({ type: 'PERSON', name: 'Elif Nur Yılmaz', taxNumber: TC, paymentTermDays: 0 })));
      const created = await as(ACCOUNTING, () =>
        invoices.createDraft(hotelId, contracts.invoiceDraftCreateSchema.parse({ source: 'MANUAL', ledgerAccountId: person.account.id, lines: [{ description: 'Salon kirası', quantity: '1', unitAmount: '1000', taxCategory: 'OTHER' }] })),
      );
      const view = await detail(created.invoiceId);
      assert.deepEqual([view.invoice.buyer.type, view.invoice.buyer.firstName, view.invoice.buyer.lastName, view.invoice.buyer.taxNumber], ['PERSON', 'Elif Nur', 'Yılmaz', TC]);
      assert.equal(view.invoice.buyer.name ?? null, null);
    });

    it('gerçekleşmiş etkinlik: kalemler miktar ve birimiyle; numara etkinlik bedeline bağlanır. İptal bedeli faturası bedele eşit olmalı', async () => {
      const client = await db.eventClient.create({ data: { hotelId, type: 'COMPANY', name: 'Kaya Kongre Ltd.', taxNumber: '4730012344', taxOffice: 'Maltepe', createdBy: MANAGER } });
      const itemTax = (rateTax, net, amount) => [{ taxId: rateTax.id, name: rateTax.name, rate: String(rateTax.rate), included: true, amount }];
      const baseEvent = { hotelId, type: 'CONFERENCE', clientId: client.id, ownerEmail: MANAGER, expectedPax: 120, currency: 'TRY', createdBy: MANAGER, definiteAt: new Date(), definiteBy: MANAGER, firstStartAt: new Date(`${D(-3)}T07:00:00.000Z`), lastEndAt: new Date(`${D(-3)}T15:00:00.000Z`) };
      const event = await db.event.create({
        data: { ...baseEvent, code: 'ETK-1', name: 'Bayi toplantısı', status: 'COMPLETED', completedAt: new Date(), completedBy: MANAGER, actualPax: 120, netTotal: '64000', taxTotal: '7400', grandTotal: '71400' },
      });
      await db.eventItem.createMany({
        data: [
          { hotelId, eventId: event.id, category: 'FNB', description: 'Gala menüsü', quantity: '120', billedQuantity: '120', unit: 'PERSON', unitPrice: '495', taxCategory: 'FNB', netAmount: '54000', taxAmount: '5400', total: '59400', taxLines: itemTax(tax.kdv10, '54000', '5400.00'), sortOrder: 1, perPerson: true },
          { hotelId, eventId: event.id, category: 'VENUE', description: 'Balo salonu', quantity: '1', billedQuantity: '1', unit: 'DAY', unitPrice: '12000', taxCategory: 'OTHER', netAmount: '10000', taxAmount: '2000', total: '12000', taxLines: itemTax(tax.kdv20, '10000', '2000.00'), sortOrder: 2 },
        ],
      });
      await as('system', () => postings.syncEventCharge(hotelId, event.id));
      const created = await as(ACCOUNTING, () => invoices.createDraft(hotelId, { source: 'EVENT', eventId: event.id }));
      const draft = await detail(created.invoiceId);
      assert.deepEqual(
        draft.lines.map((line) => [line.description, line.quantity, line.unitCode, line.unitPrice, line.net]),
        [
          ['Gala menüsü', '120', 'C62', '450.00', '54000.00'],
          ['Balo salonu', '1', 'DAY', '10000.00', '10000.00'],
        ],
      );
      assert.equal(draft.linesEditable, false);
      const issued = await completeAndIssue(created.invoiceId, {}, ACCOUNTING);
      assert.equal(issued.invoice.total, '71400.00');
      const charge = await db.ledgerEntry.findFirst({ where: { sourceType: 'EVENT_CHARGE', sourceId: event.id } });
      assert.equal(charge.invoiceNumber, issued.invoice.number);

      // İptal bedeli: tek satır, düzenlenebilir; toplam bedele eşit değilse kesilmez.
      const cancelled = await db.event.create({
        data: { ...baseEvent, code: 'ETK-2', name: 'Lansman', status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: MANAGER, cancelReason: 'Müşteri iptal etti', cancellationFee: '5000', netTotal: '0', taxTotal: '0', grandTotal: '0' },
      });
      const feeDraft = await as(ACCOUNTING, () => invoices.createDraft(hotelId, { source: 'EVENT', eventId: cancelled.id }));
      let view = await detail(feeDraft.invoiceId);
      assert.equal(view.linesEditable, true);
      assert.equal(view.invoice.total, '5000.00');
      await as(ACCOUNTING, () =>
        invoices.updateDraft(hotelId, feeDraft.invoiceId, contracts.invoiceDraftUpdateSchema.parse({ expectedUpdatedAt: view.invoice.updatedAt, buyer: { ...view.invoice.buyer, ...ADDRESS }, lines: [{ description: 'İptal bedeli', quantity: '1', unitAmount: '4000', taxCategory: 'OTHER' }] })),
      );
      view = await detail(feeDraft.invoiceId);
      assert.ok(view.issueProblems.some((problem) => /iptal bedeliyle/.test(problem)));
      await rejectsWith(as(ACCOUNTING, () => invoices.issueInvoice(hotelId, feeDraft.invoiceId, { expectedUpdatedAt: view.invoice.updatedAt })), 'INVOICE_LINES', /tutmuyor/);
    });
  });

  /* ═══════════════ Tutarlılık ve eşzamanlılık ═══════════════ */

  describe('tutarlılık ve eşzamanlılık', () => {
    it('kaynak taslaktan sonra değişirse taslak yenilenir, kesim durur; eski sürümle düzenleme reddedilir', async () => {
      const draft = await settleAndClose(await stayWithCharges());
      const view = await detail(draft.id);
      await as(DESK, () => invoices.updateDraft(hotelId, draft.id, contracts.invoiceDraftUpdateSchema.parse({ expectedUpdatedAt: view.invoice.updatedAt, buyer: { ...view.invoice.buyer, ...ADDRESS } })));
      await rejectsWith(as(DESK, () => invoices.updateDraft(hotelId, draft.id, contracts.invoiceDraftUpdateSchema.parse({ expectedUpdatedAt: view.invoice.updatedAt, buyer: view.invoice.buyer }))), 'STALE_WRITE');
      await db.invoice.update({ where: { id: draft.id }, data: { total: '2400.00', netTotal: '2160.00', grossTotal: '2160.00', taxTotal: '240.00' } });
      const fresh = await detail(draft.id);
      await rejectsWith(as(DESK, () => invoices.issueInvoice(hotelId, draft.id, { expectedUpdatedAt: fresh.invoice.updatedAt })), 'INVOICE_SOURCE_CHANGED');
      assert.equal((await detail(draft.id)).invoice.total, '2480.00', 'taslak kaynaktan yenilendi');
      assert.equal((await detail(draft.id)).invoice.status, 'DRAFT');
    });

    it('eşzamanlı 8 kesim boşluksuz sıra alır; aynı folyoya eşzamanlı iki taslak tek taslaktır', async () => {
      const drafts = [];
      for (let index = 0; index < 8; index += 1) {
        const draft = await settleAndClose(await stayWithCharges({ guest: { firstName: `Misafir${index}`, lastName: 'Test', idType: 'NATIONAL_ID', idNumber: TC } }));
        const view = await detail(draft.id);
        await as(DESK, () => invoices.updateDraft(hotelId, draft.id, contracts.invoiceDraftUpdateSchema.parse({ expectedUpdatedAt: view.invoice.updatedAt, buyer: { ...view.invoice.buyer, ...ADDRESS } })));
        drafts.push((await detail(draft.id)).invoice);
      }
      await Promise.all(drafts.map((draft) => as(DESK, () => invoices.issueInvoice(hotelId, draft.id, { expectedUpdatedAt: draft.updatedAt }))));
      dispatcher.stopEdocDispatcher();
      const numbers = (await db.invoice.findMany({ where: { hotelId, status: 'ISSUED' }, select: { number: true } })).map((row) => Number(row.number.slice(7))).sort((a, b) => a - b);
      assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8]);

      const stay = await stayWithCharges();
      await boss(() => saveSettings({ autoDraft: false }));
      await settleAndClose(stay);
      const results = await Promise.all([1, 2, 3].map(() => as(DESK, () => invoices.createDraft(hotelId, { source: 'FOLIO', folioId: stay.folio.id }))));
      assert.equal(new Set(results.map((result) => result.invoiceId)).size, 1);
      assert.equal(results.filter((result) => result.created).length, 1);
    });
  });

  /* ═══════════════ Faturalama başlangıcı ═══════════════ */

  describe('faturalama başlangıcı', () => {
    it('ayar yokken kuyruk boş; başlangıçtan (otelin gece yarısı) önce kapanan folyo listelenmez, taslağı uyarır; başlangıç bugünden sonra olamaz', async () => {
      const queue = async () => invoices.listInvoiceables(hotelId, contracts.invoiceableQuerySchema.parse({ kind: 'FOLIO', days: 30 }));
      const stay = await stayWithCharges();
      const draft = await settleAndClose(stay);
      assert.deepEqual((await queue()).items.map((row) => row.id), [stay.folio.id]);

      // Başlangıç dünün yerel gece yarısı: bir dakika önce kapanan dışarıda, bir dakika sonra kapanan içeride.
      const midnight = contracts.zonedWallTimeToUtc(`${D(-1)}T00:00`, ZONE);
      await boss(() => saveSettings({ startDate: D(-1) }));
      await db.folio.update({ where: { id: stay.folio.id }, data: { closedAt: new Date(midnight.getTime() - 60_000) } });
      const before = await queue();
      assert.equal(before.items.length, 0);
      assert.equal(before.startDate, D(-1));
      assert.equal((await detail(draft.id)).beforeStart, D(-1), 'taslak, önceki sistemde faturalanmış olabileceğini söyler');
      await db.folio.update({ where: { id: stay.folio.id }, data: { closedAt: new Date(midnight.getTime() + 60_000) } });
      assert.deepEqual((await queue()).items.map((row) => row.id), [stay.folio.id]);
      assert.equal((await detail(draft.id)).beforeStart, null);

      await rejectsWith(boss(() => saveSettings({ startDate: D(1) })), 'VALIDATION', /bugünden sonra/);
      const audit = await db.auditLog.findFirst({ where: { hotelId, entity: 'InvoiceSettings', action: 'UPDATE' }, orderBy: { createdAt: 'desc' } });
      assert.equal(audit.after.startDate, D(-1));

      // Ayar silinirse (kurulmamış otel) kuyruk boş ve ekran "faturalama başlamadı" der.
      await db.invoiceSettings.delete({ where: { hotelId } });
      const empty = await queue();
      assert.equal(empty.items.length, 0);
      assert.equal(empty.startDate, null);
    });
  });

  /* ═══════════════ İzinler ve otel kapsamı ═══════════════ */

  describe('izinler ve otel kapsamı', () => {
    it('ön büro folyo faturası keser ama serbest fatura açamaz, iptal isteyemez, ayarı değiştiremez; başka otelin faturası yok', async () => {
      const draft = await settleAndClose(await stayWithCharges());
      assert.equal((await call('GET', '/invoices/invoiceables?kind=FOLIO&days=30', DESK)).statusCode, 200);
      const manual = await call('POST', '/invoices', DESK, { source: 'MANUAL', ledgerAccountId: company.account.id, lines: [{ description: 'Salon', quantity: '1', unitAmount: '100', taxCategory: 'OTHER' }] });
      assert.equal(manual.statusCode, 403);
      await completeAndIssue(draft.id);
      assert.equal((await call('POST', `/invoices/${draft.id}/cancel`, DESK, { reason: 'Yanlış kesim' })).statusCode, 403);
      const current = await settings.getInvoiceSettings(hotelId);
      assert.equal((await call('PUT', '/invoices/settings', DESK, { ...current.settings, expectedUpdatedAt: current.settings.updatedAt, taxCodes: [] })).statusCode, 403);
      const listed = await call('GET', '/invoices?search=EAR', ACCOUNTING);
      assert.equal(listed.json().data.items.length, 1);
      // Başka otelin taslağı: bu otelin kullanıcısı göremez, silemez, kesemez.
      const foreign = await db.invoice.create({ data: { hotelId: otherHotelId, source: 'MANUAL', ledgerAccountId: company.account.id, currency: 'TRY', createdBy: 'x' } });
      assert.equal((await call('GET', `/invoices/${foreign.id}`, ACCOUNTING)).statusCode, 404);
      assert.equal((await call('DELETE', `/invoices/${foreign.id}`, ACCOUNTING)).statusCode, 404);
      assert.equal((await call('POST', `/invoices/${foreign.id}/issue`, ACCOUNTING, { expectedUpdatedAt: foreign.updatedAt.toISOString() })).statusCode, 404);
      assert.equal((await call('GET', `/invoices/${randomUUID()}`, ACCOUNTING)).statusCode, 404);
    });
  });
});
