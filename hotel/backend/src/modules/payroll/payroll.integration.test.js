import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Personel ve bordro (modül 51) — gerçek PostgreSQL gerektirir.
 *
 * Sınanan: hazır yasal setin yüklenmesi ve teyidi (teyitsiz set onaya gidemez), personel kartı (ücret ve kimlik
 * görünürlüğü izne göre), puantaj (eksik gün), ek ödeme (netten prim, yemek), hesap (netten ücretlinin neti hedefi
 * tutar, emeklide işsizlik yok, BES, icra netin dörtte biri, avans taksiti), yıl içi sıra (önceki ay onaylanmadan
 * hesap yok), hesaptan sonra girdi değişince yeniden hesap zorunluluğu, dört göz, onayda kesintilerin kesinleşmesi,
 * muhasebe tahakkuku ve maaş ödemesi (personel carisi kapanır, kalan avans alacak kalır), onaylı ayın kilidi, fark
 * bordrosu (fark tutarı, sonraki ayın yeniden hesaplanması), işten çıkış hakları ve geri alınması, servis payının
 * kuruşu kuruşuna dağıtımı, izinler, otel kapsamı ve eşzamanlı hesap.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const PASSWORD = 'parola-12345';
const MANAGER = 'mudur@test.local';
const MANAGER2 = 'genelmudur@test.local';
const ACCOUNTING = 'muhasebe@test.local';
const DESK = 'onburo@test.local';

/** Geçerli T.C. kimlik no (9 haneden denetim haneleri). @param {string} nine */
function tckn(nine) {
  const digits = [...nine].map(Number);
  const odd = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const even = digits[1] + digits[3] + digits[5] + digits[7];
  digits.push((((odd * 7 - even) % 10) + 10) % 10);
  digits.push(digits.reduce((sum, digit) => sum + digit, 0) % 10);
  return digits.join('');
}

/** Geçerli TR IBAN. @param {string} bban 22 hane */
function ibanOf(bban) {
  let remainder = 0;
  for (const digit of `${bban}292700`) remainder = (remainder * 10 + Number(digit)) % 97;
  return `TR${String(98 - remainder).padStart(2, '0')}${bban}`;
}

describe('personel ve bordro (entegrasyon)', { skip }, () => {
  /** @type {any} */ let app;
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let contracts;
  /** @type {any} */ let employees;
  /** @type {any} */ let inputs;
  /** @type {any} */ let runs;
  /** @type {any} */ let setup;
  /** @type {any} */ let approvals;
  /** @type {any} */ let treasury;
  /** @type {any} */ let cache;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let otherHotelId;
  /** @type {Map<string, string>} */ let tokens;
  /** @type {Record<string, any>} */ let dept;
  /** @type {Record<string, any>} */ let people;
  /** @type {any} */ let bank;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_RATE_LIMIT_MAX = '10000';
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    contracts = await import('@hotelos/hotel-contracts');
    employees = await import('./employees.js');
    inputs = await import('./inputs.js');
    runs = await import('./runs.js');
    setup = await import('./setup.js');
    approvals = await import('../approvals/service.js');
    treasury = await import('../accounting/treasury.js');
    cache = await import('../../lib/cache.js');
    app = await (await import('../../app.js')).buildApp({ logger: false, rateLimitMax: 10_000 });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  const as = (email, fn) => core.runWithContext({ correlationId: randomUUID(), actor: email }, fn);
  const acc = (fn) => as(ACCOUNTING, fn);
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
    await db.accountingSettings.create({ data: { hotelId, startDate: new Date('2026-01-01T00:00:00Z'), paymentApprovalAmount: '50000', updatedBy: 'test' } });
    bank = (await as(MANAGER, () => treasury.createTreasuryAccount(hotelId, contracts.treasuryAccountCreateSchema.parse({ kind: 'BANK', name: 'Ziraat TL', currency: 'TRY', bankName: 'Ziraat Bankası', iban: ibanOf('0001000000000012345678') })))).account;
    await db.treasuryAccount.update({ where: { id: bank.id }, data: { balance: '5000000' } });

    await as(MANAGER, () => setup.loadCatalogSets(hotelId));
    dept = {};
    for (const [code, name] of [['HK', 'Kat hizmetleri'], ['FO', 'Ön büro'], ['FB', 'Yiyecek içecek']]) {
      await as(MANAGER, () => employees.saveDepartment(hotelId, contracts.departmentSchema.parse({ code, name })));
    }
    for (const row of await db.department.findMany({ where: { hotelId } })) dept[row.code] = row;
    const hire = (input) => acc(() => employees.createEmployee(hotelId, contracts.employeeCreateSchema.parse(input), { withPay: true }));
    people = {
      asgari: await hire({ firstName: 'Ali', lastName: 'Asgari', nationalId: tckn('100000001'), departmentId: dept.HK.id, position: 'Kat görevlisi', hireDate: '2024-03-01', payBasis: 'GROSS', salary: '33030.00', paymentMethod: 'BANK', iban: ibanOf('0001000000000000000001'), besEnrolled: true, serviceChargePoints: '2' }),
      net: await hire({ firstName: 'Ayşe', lastName: 'Netten', nationalId: tckn('200000002'), departmentId: dept.FO.id, position: 'Resepsiyonist', hireDate: '2023-06-15', payBasis: 'NET', salary: '50000.00', paymentMethod: 'BANK', iban: ibanOf('0001000000000000000002'), serviceChargePoints: '3' }),
      emekli: await hire({ firstName: 'Cemil', lastName: 'Emekli', nationalId: tckn('300000003'), departmentId: dept.FB.id, position: 'Şef', hireDate: '2022-01-10', payBasis: 'GROSS', salary: '40000.00', insuranceType: 'RETIRED', paymentMethod: 'CASH', serviceChargePoints: '1' }),
      icrali: await hire({ firstName: 'Deniz', lastName: 'Borçlu', nationalId: tckn('400000004'), departmentId: dept.FO.id, position: 'Ön büro müdürü', hireDate: '2020-03-01', payBasis: 'GROSS', salary: '100000.00', disabilityDegree: 2, paymentMethod: 'BANK', iban: ibanOf('0001000000000000000004') }),
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

  const verifyAll = async () => {
    for (const set of (await setup.listParameterSets(hotelId)).items) await as(MANAGER, () => setup.verifyParameterSet(hotelId, set.id, true));
  };
  const element = async (code) => (await db.payElement.findFirst({ where: { hotelId, code } })).id;
  const entryOf = (runId, employeeId) => db.payrollEntry.findFirst({ where: { runId, employeeId }, include: { lines: true } });
  const ledger = async (where) => db.ledgerAccount.findFirst({ where: { hotelId, ...where } });

  /** Ocak girdileri: eksik gün, fazla çalışma, netten prim, yemek, icra, avans (bankadan). */
  async function januaryInputs() {
    await acc(() =>
      inputs.saveAttendance(hotelId, 2026, 1, [
        contracts.attendanceSchema.parse({ employeeId: people.asgari.id, missingDays: 2, missingReason: '21' }),
        contracts.attendanceSchema.parse({ employeeId: people.net.id, missingDays: 0, overtimeHours: '10' }),
      ]),
    );
    await acc(async () => inputs.createItem(hotelId, contracts.payrollItemSchema.parse({ year: 2026, month: 1, employeeId: people.emekli.id, elementId: await element('BONUS'), amount: '5000.00', isNet: true })));
    await acc(async () => inputs.createItem(hotelId, contracts.payrollItemSchema.parse({ year: 2026, month: 1, employeeId: people.asgari.id, elementId: await element('MEAL'), amount: '6600.00' })));
    await acc(() => inputs.createGarnishment(hotelId, people.icrali.id, contracts.garnishmentSchema.parse({ type: 'ICRA', fileNumber: '2025/1234', authority: 'Ankara 5. İcra Dairesi', creditor: 'Banka A.Ş.', notifiedOn: '2025-12-10', totalAmount: '10000.00' })));
    await acc(() => inputs.createAdvance(hotelId, people.icrali.id, contracts.advanceSchema.parse({ amount: '6000.00', paidOn: '2026-01-05', installments: 2, firstYear: 2026, firstMonth: 1, treasuryAccountId: bank.id })));
  }

  async function approve(runId) {
    const run = await acc(() => runs.submitRun(hotelId, runId));
    await as(MANAGER2, () => approvals.decideApproval(hotelId, run.approvalId, 'GRANTED', { note: 'Uygun' }));
    return db.payrollRun.findUnique({ where: { id: runId } });
  }

  it('Ocak: hesap, teyit kapısı, dört göz, kesintilerin kesinleşmesi, muhasebe ve ödeme', async () => {
    await januaryInputs();
    const jan = await acc(() => runs.createRun(hotelId, { year: 2026, month: 1, kind: 'MONTHLY' }));
    await acc(() => runs.calculateRun(hotelId, jan.id));

    // Teyitsiz setle onaya gidilmez
    await rejectsWith(acc(() => runs.submitRun(hotelId, jan.id)), 'PAYROLL_PARAMETERS_UNVERIFIED');
    await verifyAll();

    const asgari = await entryOf(jan.id, people.asgari.id);
    assert.equal(asgari.sgkDays, 28);
    assert.equal(asgari.missingReason, '21');
    assert.equal(money(asgari.gross), '37428.00'); // 33.030 × 28/30 + 6.600 yemek
    const bes = asgari.lines.find((line) => line.code === 'BES');
    assert.equal(money(bes.amount), money((Number(asgari.pek) * 0.03).toFixed(2)));
    assert.equal(money(Number(asgari.net) - Number(asgari.deductionTotal)), money(asgari.payable));

    const net = await entryOf(jan.id, people.net.id);
    const wanted = 50000 + (50000 / 225) * 1.5 * 10;
    assert.ok(Number(net.net) >= Number(wanted.toFixed(2)) && Number(net.net) - wanted < 0.05, `net ${net.net}`);
    assert.ok(net.lines.every((line) => line.kind !== 'EARNING' || line.isNet));

    const emekli = await entryOf(jan.id, people.emekli.id);
    assert.equal(money(emekli.employeeUnemployment), '0.00');
    assert.equal(money(emekli.treasuryDiscount), '0.00');

    const icrali = await entryOf(jan.id, people.icrali.id);
    const icra = icrali.lines.find((line) => line.code === 'ICRA');
    assert.equal(money(icra.amount), money(Math.min(10000, Number(icrali.net) * 0.25).toFixed(2)));
    assert.equal(money(icrali.lines.find((line) => line.code === 'ADVANCE').amount), '3000.00');
    assert.equal(icrali.trace.disabilityDeduction, '7000.00');

    // Dört göz: hazırlayan onaylayamaz
    const submitted = await acc(() => runs.submitRun(hotelId, jan.id));
    await rejectsWith(acc(() => approvals.decideApproval(hotelId, submitted.approvalId, 'GRANTED', {})), 'SELF_DECISION');
    // Onaydaki ayın girdisi değişmez
    await rejectsWith(acc(() => inputs.saveAttendance(hotelId, 2026, 1, [contracts.attendanceSchema.parse({ employeeId: people.asgari.id, missingDays: 0 })])), 'PAYROLL_MONTH_LOCKED');
    await as(MANAGER2, () => approvals.decideApproval(hotelId, submitted.approvalId, 'GRANTED', { note: 'Uygun' }));

    const approved = await db.payrollRun.findUnique({ where: { id: jan.id } });
    assert.equal(approved.status, 'APPROVED');
    const advance = await db.employeeAdvance.findFirst({ where: { employeeId: people.icrali.id } });
    assert.equal(money(advance.deducted), '3000.00');
    assert.equal(advance.status, 'OPEN');
    const garnishment = await db.garnishment.findFirst({ where: { employeeId: people.icrali.id } });
    assert.equal(money(garnishment.deducted), money(icra.amount));

    // Muhasebe: personel carisi (net + avans mahsubu), SGK, vergi, BES, icra carileri
    const icraliAccount = await ledger({ employeeId: people.icrali.id });
    // Avans ödemesi borç (6.000), tahakkuk alacak (ödenecek + 3.000)
    assert.equal(money(icraliAccount.balance), money(6000 - Number(icrali.payable) - 3000));
    const settings = await db.payrollSettings.findFirst({ where: { hotelId } });
    const sgk = await db.ledgerAccount.findUnique({ where: { id: settings.sgkLedgerAccountId } });
    const sgkExpected = (await db.payrollEntry.findMany({ where: { runId: jan.id } })).reduce((acc2, row) => acc2 + Number(row.employeeSgk) + Number(row.employeeUnemployment) + Number(row.employerSgk) + Number(row.employerUnemployment) - Number(row.treasuryDiscount) - Number(row.incentiveDiscount), 0);
    assert.equal(money(sgk.balance), money((-sgkExpected).toFixed(2)));
    assert.ok(settings.taxLedgerAccountId && settings.besLedgerAccountId);
    assert.ok((await db.garnishment.findFirst({ where: { employeeId: people.icrali.id } })).ledgerAccountId);

    // Ödeme: banka; elden olan (emekli) ödenmez
    const before = Number((await db.treasuryAccount.findUnique({ where: { id: bank.id } })).balance);
    await rejectsWith(acc(() => runs.payRun(hotelId, jan.id, { treasuryAccountId: bank.id, date: '2026-01-31', method: 'CASH' })), 'VALIDATION');
    const paid = await acc(() => runs.payRun(hotelId, jan.id, { treasuryAccountId: bank.id, date: '2026-01-31', method: 'BANK' }));
    const bankTotal = Number(asgari.payable) + Number(net.payable) + Number(icrali.payable);
    assert.equal(paid.totals.paid, money(bankTotal.toFixed(2)));
    assert.equal(money(Number((await db.treasuryAccount.findUnique({ where: { id: bank.id } })).balance)), money((before - bankTotal).toFixed(2)));
    assert.equal(money((await ledger({ employeeId: people.asgari.id })).balance), '0.00');
    // Kalan avans (3.000) personelden alacak
    assert.equal(money((await ledger({ employeeId: people.icrali.id })).balance), '3000.00');
    await rejectsWith(acc(() => runs.payRun(hotelId, jan.id, { treasuryAccountId: bank.id, date: '2026-01-31', method: 'BANK' })), 'PAYROLL_NOTHING_TO_PAY');
  });

  it('yıl içi sıra, girdi değişince yeniden hesap, avansın ikinci taksiti, eşzamanlı hesap', async () => {
    await verifyAll();
    await januaryInputs();
    const jan = await acc(() => runs.createRun(hotelId, { year: 2026, month: 1, kind: 'MONTHLY' }));
    const feb = await acc(() => runs.createRun(hotelId, { year: 2026, month: 2, kind: 'MONTHLY' }));
    await rejectsWith(acc(() => runs.calculateRun(hotelId, feb.id)), 'PAYROLL_EARLIER_OPEN', /Ocak 2026/);
    await rejectsWith(acc(() => runs.createRun(hotelId, { year: 2026, month: 1, kind: 'MONTHLY' })), 'DUPLICATE');

    await acc(() => runs.calculateRun(hotelId, jan.id));
    await acc(() => inputs.saveAttendance(hotelId, 2026, 1, [contracts.attendanceSchema.parse({ employeeId: people.asgari.id, missingDays: 1, missingReason: '21' })]));
    assert.equal((await db.payrollRun.findUnique({ where: { id: jan.id } })).stale, true);
    await rejectsWith(acc(() => runs.submitRun(hotelId, jan.id)), 'PAYROLL_STALE');
    await acc(() => runs.calculateRun(hotelId, jan.id));
    const janApproved = await approve(jan.id);
    assert.equal(janApproved.status, 'APPROVED');

    // Eşzamanlı iki hesap: satır kilidi sırayla yürütür, çift satır olmaz
    await Promise.all([acc(() => runs.calculateRun(hotelId, feb.id)), acc(() => runs.calculateRun(hotelId, feb.id))]);
    assert.equal(await db.payrollEntry.count({ where: { runId: feb.id } }), 4);
    const febEntry = await entryOf(feb.id, people.icrali.id);
    assert.equal(money(febEntry.lines.find((line) => line.code === 'ADVANCE').amount), '3000.00');
    // Şubat'ın birikmiş GV matrahı Ocak'ın onaylı matrahıdır
    const janEntry = await entryOf(jan.id, people.icrali.id);
    assert.equal(money(febEntry.gvBefore), money(janEntry.gvBase));
    await approve(feb.id);
    assert.equal((await db.employeeAdvance.findFirst({ where: { employeeId: people.icrali.id } })).status, 'SETTLED');
  });

  it('fark bordrosu: onaylı ayın farkı, sonraki ayın yeniden hesabı', async () => {
    await verifyAll();
    const jan = await acc(() => runs.createRun(hotelId, { year: 2026, month: 1, kind: 'MONTHLY' }));
    await acc(() => runs.calculateRun(hotelId, jan.id));
    await rejectsWith(acc(() => runs.createRun(hotelId, { year: 2026, month: 1, kind: 'SUPPLEMENTARY' })), 'PAYROLL_MONTHLY_NOT_APPROVED');
    await approve(jan.id);
    const feb = await acc(() => runs.createRun(hotelId, { year: 2026, month: 2, kind: 'MONTHLY' }));
    await acc(() => runs.calculateRun(hotelId, feb.id));

    const fark = await acc(() => runs.createRun(hotelId, { year: 2026, month: 1, kind: 'SUPPLEMENTARY' }));
    assert.equal(fark.number, 'B-2026-01-F1');
    await acc(async () => inputs.createItem(hotelId, contracts.payrollItemSchema.parse({ year: 2026, month: 1, runId: fark.id, employeeId: people.asgari.id, elementId: await element('BONUS'), amount: '10000.00' })));
    // Aylık bordroya kalem girilemez (onaylı)
    await rejectsWith(acc(async () => inputs.createItem(hotelId, contracts.payrollItemSchema.parse({ year: 2026, month: 1, employeeId: people.asgari.id, elementId: await element('BONUS'), amount: '1.00' }))), 'PAYROLL_MONTH_LOCKED');
    await acc(() => runs.calculateRun(hotelId, fark.id));
    const delta = await entryOf(fark.id, people.asgari.id);
    assert.equal(money(delta.gross), '10000.00');
    assert.ok(Number(delta.net) > 5000 && Number(delta.net) < 10000, `fark neti ${delta.net}`);
    assert.equal(money(delta.employeeSgk), '1400.00');
    await approve(fark.id);
    assert.equal((await db.payrollRun.findUnique({ where: { id: feb.id } })).stale, true);
  });

  it('işten çıkış: kıdem, ihbar, izin kalemleri; onaylı ayda çıkış yok; geri alma', async () => {
    await verifyAll();
    const preview = await acc(() => employees.previewTermination(hotelId, people.icrali.id, contracts.terminationSchema.parse({ terminationDate: '2026-02-20', reasonCode: '04', severanceEligible: true, noticeMode: 'EMPLOYER_PAYS', unusedLeaveDays: '5' })));
    assert.deepEqual(preview.service, { years: 5, months: 11, days: 20, totalDays: preview.service.totalDays });
    assert.equal(preview.severanceBase, '64948.77');
    assert.equal(preview.noticeWeeks, 8);
    assert.equal(preview.leaveAmount, '16666.67');
    await acc(() => employees.terminateEmployee(hotelId, people.icrali.id, contracts.terminationSchema.parse({ terminationDate: '2026-02-20', reasonCode: '04', severanceEligible: true, noticeMode: 'EMPLOYER_PAYS', unusedLeaveDays: '5' })));
    const items = await db.payrollItem.findMany({ where: { employeeId: people.icrali.id, source: 'TERMINATION' }, include: { element: true } });
    assert.deepEqual(items.map((item) => item.element.code).sort(), ['NOTICE_PAY', 'SEVERANCE_PAY', 'UNUSED_LEAVE']);
    assert.equal(money(items.find((item) => item.element.code === 'SEVERANCE_PAY').amount), preview.severanceAmount);
    // Gerekçesiz varsayılan dışı seçim reddedilir
    assert.equal(contracts.terminationSchema.safeParse({ terminationDate: '2026-02-20', reasonCode: '03', severanceEligible: true, noticeMode: 'NONE' }).success, false);

    await acc(() => employees.reinstateEmployee(hotelId, people.icrali.id));
    assert.equal(await db.payrollItem.count({ where: { employeeId: people.icrali.id, source: 'TERMINATION' } }), 0);

    const jan = await acc(() => runs.createRun(hotelId, { year: 2026, month: 1, kind: 'MONTHLY' }));
    await acc(() => runs.calculateRun(hotelId, jan.id));
    await approve(jan.id);
    await rejectsWith(acc(() => employees.terminateEmployee(hotelId, people.asgari.id, contracts.terminationSchema.parse({ terminationDate: '2026-01-15', reasonCode: '03', severanceEligible: false, noticeMode: 'NONE' }))), 'PAYROLL_MONTH_LOCKED');
  });

  it('servis payı puan ve gün ağırlığıyla kuruşu kuruşuna dağılır', async () => {
    await acc(() => inputs.saveAttendance(hotelId, 2026, 2, [contracts.attendanceSchema.parse({ employeeId: people.asgari.id, missingDays: 3, missingReason: '01' })]));
    const pool = await acc(() => inputs.distributeServiceCharge(hotelId, contracts.serviceChargeSchema.parse({ year: 2026, month: 2, amount: '10000.00', method: 'POINTS', daysWeighted: true })));
    assert.equal(pool.shares.length, 3); // puanı olmayan personel dağıtıma girmez
    assert.equal(money(pool.shares.reduce((sum, share) => sum + Number(share.amount), 0).toFixed(2)), '10000.00');
    const byId = Object.fromEntries(pool.shares.map((share) => [share.employeeId, Number(share.amount)]));
    assert.ok(byId[people.net.id] > byId[people.asgari.id] && byId[people.asgari.id] > byId[people.emekli.id]);
    await acc(() => inputs.undoServiceCharge(hotelId, 2026, 2));
    assert.equal(await db.payrollItem.count({ where: { hotelId, source: 'SERVICE_CHARGE' } }), 0);
  });

  it('izinler ve görünürlük, otel kapsamı, kullanılan kartın silinmemesi', async () => {
    assert.equal((await call('GET', '/payroll/employees', DESK)).statusCode, 403);
    const managerView = (await call('GET', '/payroll/employees?pageSize=10', MANAGER)).json().data.items;
    assert.equal(managerView.length, 4);
    assert.equal(managerView[0].salary, undefined);
    assert.match(managerView[0].nationalId, /•/);
    const accountingView = (await call('GET', '/payroll/employees?pageSize=10', ACCOUNTING)).json().data.items;
    assert.ok(accountingView.every((row) => row.salary && !row.nationalId.includes('•')));
    assert.equal((await call('GET', `/payroll/employees/${people.asgari.id}`, MANAGER)).json().data.iban, undefined);
    assert.equal((await call('POST', '/payroll/runs', MANAGER, { year: 2026, month: 1 })).statusCode, 403);

    const jan = await acc(() => runs.createRun(hotelId, { year: 2026, month: 1, kind: 'MONTHLY' }));
    await rejectsWith(runs.getRun(otherHotelId, jan.id), 'NOT_FOUND');
    await rejectsWith(employees.getEmployee(otherHotelId, people.asgari.id), 'NOT_FOUND');

    // Aynı kişinin ikinci aktif kartı açılmaz
    await rejectsWith(acc(() => employees.createEmployee(hotelId, contracts.employeeCreateSchema.parse({ firstName: 'Ali', lastName: 'Kopya', nationalId: tckn('100000001'), departmentId: dept.HK.id, position: 'x', hireDate: '2026-01-01' }))), 'DUPLICATE');
    // Bordrosu olan kart silinmez; yanlış açılmış kart silinir
    await verifyAll();
    await acc(() => runs.calculateRun(hotelId, jan.id));
    await rejectsWith(acc(() => employees.deleteEmployee(hotelId, people.asgari.id)), 'EMPLOYEE_IN_USE');
    const mistake = await acc(() => employees.createEmployee(hotelId, contracts.employeeCreateSchema.parse({ firstName: 'Yanlış', lastName: 'Kayıt', nationalId: tckn('500000005'), departmentId: dept.HK.id, position: 'x', hireDate: '2026-03-01' })));
    assert.deepEqual(await acc(() => employees.deleteEmployee(hotelId, mistake.id)), { deleted: true });

    const pdf = await call('GET', `/payroll/runs/${jan.id}/pdf?kind=PAYSLIPS`, ACCOUNTING);
    assert.equal(pdf.statusCode, 200, pdf.body.slice(0, 200));
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    const list = await call('GET', `/payroll/runs/${jan.id}/pdf?kind=PAYROLL`, ACCOUNTING);
    assert.equal(list.statusCode, 200);
    const exported = (await call('GET', `/payroll/runs/${jan.id}/export?kind=ACCOUNTANT`, ACCOUNTING)).json().data;
    assert.equal(exported.rows.length, 4);
  });
});
