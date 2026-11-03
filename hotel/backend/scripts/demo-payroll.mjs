import { randomUUID } from 'node:crypto';

/**
 * Demo personel ve bordro (modül 51; `demo-data.mjs` çağırır, ön muhasebe demosundan sonra).
 *
 * 8 departman, 46 personel (geçerli T.C. kimlik ve IBAN; brüt ve netten ücretli, iki emekli, bir engelli, BES
 * katılımcıları ve cayan, teşvikli yeni işe girenler, sezonluk girişler). Yasal setler yüklenip yönetici adına teyit
 * edilir. Yılın geçmiş ayları sırayla: puantaj (rapor / ücretsiz izin, sezonda fazla mesai, bayram çalışması),
 * bayram ikramiyeleri, servis payı, avans, icra ve nafaka, iki işten çıkış (istifa; kıdemli fesih); her ay
 * muhasebeci hesaplayıp onaya gönderir, yönetici onaylar, banka ve kasadan ödenir. Geçen ayın onaylı bordrosuna
 * bir fark bordrosu; içinde bulunulan ayın bordrosu hesaplanmış bekler. Muhasebe kayıtları eşitlemeyle yazılır.
 */

const APPROVER = 'admin@hotel.local';

const DEPARTMENTS = Object.freeze([
  { code: 'ONB', name: 'Ön büro', points: '2' },
  { code: 'KAT', name: 'Kat hizmetleri', points: '1' },
  { code: 'MTF', name: 'Mutfak', points: '2' },
  { code: 'SRV', name: 'Restoran ve bar', points: '3' },
  { code: 'TKN', name: 'Teknik servis', points: '1' },
  { code: 'MHS', name: 'Muhasebe ve İK', points: '0' },
  { code: 'GVN', name: 'Güvenlik', points: '1' },
  { code: 'STS', name: 'Satış ve rezervasyon', points: '1' },
]);

/** Görev × kişi × ücret (2026; asgari ücret brüt 33.030). basis NET → netten anlaşma. */
const ROSTER = Object.freeze([
  ['ONB', 'Ön büro müdürü', 1, 'GROSS', '78000'],
  ['ONB', 'Resepsiyon şefi', 1, 'NET', '42000'],
  ['ONB', 'Resepsiyonist', 4, 'GROSS', '36500'],
  ['ONB', 'Bellboy', 2, 'GROSS', '33030'],
  ['KAT', 'Kat hizmetleri müdürü', 1, 'NET', '40000'],
  ['KAT', 'Kat şefi', 1, 'GROSS', '38000'],
  ['KAT', 'Kat görevlisi', 7, 'GROSS', '33030'],
  ['KAT', 'Çamaşırhane görevlisi', 2, 'GROSS', '33030'],
  ['MTF', 'Aşçıbaşı', 1, 'NET', '65000'],
  ['MTF', 'Aşçı', 3, 'NET', '36000'],
  ['MTF', 'Komi', 2, 'GROSS', '33030'],
  ['MTF', 'Bulaşıkçı', 2, 'GROSS', '33030'],
  ['SRV', 'Restoran şefi', 1, 'GROSS', '45000'],
  ['SRV', 'Garson', 5, 'GROSS', '33500'],
  ['SRV', 'Barmen', 2, 'GROSS', '35000'],
  ['TKN', 'Teknik şef', 1, 'GROSS', '52000'],
  ['TKN', 'Teknisyen', 2, 'GROSS', '37000'],
  ['MHS', 'Muhasebe müdürü', 1, 'GROSS', '82000'],
  ['MHS', 'Muhasebe uzmanı', 1, 'GROSS', '46000'],
  ['MHS', 'İK uzmanı', 1, 'GROSS', '44000'],
  ['GVN', 'Güvenlik görevlisi', 3, 'GROSS', '34500'],
  ['STS', 'Satış müdürü', 1, 'NET', '58000'],
]);

const FIRST = ['Ahmet', 'Ayşe', 'Mehmet', 'Fatma', 'Mustafa', 'Emine', 'Ali', 'Hatice', 'Hüseyin', 'Zeynep', 'Hasan', 'Elif', 'İbrahim', 'Merve', 'Murat', 'Esra', 'Ömer', 'Büşra', 'Yusuf', 'Seda', 'Emre', 'Gamze', 'Burak', 'Derya', 'Serkan', 'Özlem', 'Kemal', 'Tuğba', 'Cem', 'Gizem'];
const LAST = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Yıldırım', 'Öztürk', 'Aydın', 'Özdemir', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin', 'Kara', 'Koç', 'Kurt', 'Özkan', 'Şimşek', 'Polat', 'Korkmaz', 'Erdoğan', 'Güneş', 'Aksoy'];
const BANKS = ['00010', '00012', '00015', '00046', '00062', '00064', '00067'];

/** Sezon katsayısı (servis payı, fazla mesai). */
const SEASON = [0.55, 0.55, 0.7, 0.85, 1, 1.25, 1.5, 1.55, 1.2, 0.95, 0.7, 0.65];
/** Ulusal bayram / genel tatil günleri (ay → gün sayısı, 2026). */
const HOLIDAYS = { 1: 1, 3: 2.5, 4: 1, 5: 5, 7: 1, 8: 1, 10: 1.5 };

export async function resetPayrollDemo(tx, hotelId) {
  const run = (sql) => tx.$executeRawUnsafe(sql, hotelId);
  const approvals = `SELECT "id" FROM "Approval" WHERE "hotelId" = $1 AND "entityType" = 'PayrollRun'`;
  await run(`DELETE FROM "StaffAlert" WHERE "hotelId" = $1 AND "entityType" = 'Approval' AND "entityId" IN (${approvals})`);
  await run(`DELETE FROM "PendingAction" WHERE "approvalId" IN (${approvals})`);
  await run(`DELETE FROM "Approval" WHERE "id" IN (${approvals})`);
  for (const table of ['PayrollPayment', 'PayrollRun', 'PayrollItem', 'PayrollAttendance', 'ServiceChargePool', 'PayrollOpening', 'EmployeeTermination', 'EmployeeIncentive', 'EmployeeAdvance', 'Garnishment', 'Employee', 'Department', 'PayElement', 'PayrollParameterSet', 'PayrollSettings', 'PayrollSequence']) {
    await run(`DELETE FROM "${table}" WHERE "hotelId" = $1`);
  }
}

/** Geçerli T.C. kimlik no. @param {() => number} rand */
function tckn(rand) {
  const digits = [1 + Math.floor(rand() * 9), ...Array.from({ length: 8 }, () => Math.floor(rand() * 10))];
  const odd = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const even = digits[1] + digits[3] + digits[5] + digits[7];
  digits.push((((odd * 7 - even) % 10) + 10) % 10);
  digits.push(digits.reduce((sum, digit) => sum + digit, 0) % 10);
  return digits.join('');
}

/** Geçerli TR IBAN (banka kodu + rastgele hesap). @param {() => number} rand */
function iban(rand) {
  const bban = `${BANKS[Math.floor(rand() * BANKS.length)]}0${Array.from({ length: 16 }, () => Math.floor(rand() * 10)).join('')}`;
  let remainder = 0;
  for (const digit of `${bban}292700`) remainder = (remainder * 10 + Number(digit)) % 97;
  return `TR${String(98 - remainder).padStart(2, '0')}${bban}`;
}

/**
 * @param {{ prisma: any, core: any, contracts: any, hotelId: string, today: string, actor: string }} input
 */
export async function seedPayrollDemo({ prisma, core, contracts, hotelId, today, actor }) {
  const employees = await import('../src/modules/payroll/employees.js');
  const inputs = await import('../src/modules/payroll/inputs.js');
  const runs = await import('../src/modules/payroll/runs.js');
  const setup = await import('../src/modules/payroll/setup.js');
  const approvals = await import('../src/modules/approvals/service.js');
  const accountingPostings = await import('../src/modules/accounting/postings.js');
  const as = (who, fn) => core.runWithContext({ correlationId: randomUUID(), actor: who }, fn);
  const prep = (fn) => as(actor, fn);
  const boss = (fn) => as(APPROVER, fn);
  let seed = 51_2026;
  const rand = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const year = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  const approverExists = await prisma.user.findFirst({ where: { hotelId, email: APPROVER, isActive: true }, select: { id: true } });
  const summary = { employees: 0, runs: 0, approved: 0, paid: 0, terminated: 0, supplementary: 0, posted: 0 };

  // ── Ayarlar: yasal setler (teyitli), işyeri, departmanlar ──
  await boss(() => setup.loadCatalogSets(hotelId));
  for (const set of (await setup.listParameterSets(hotelId)).items) await boss(() => setup.verifyParameterSet(hotelId, set.id, true));
  await boss(() => setup.savePayrollSettings(hotelId, contracts.payrollSettingsSchema.parse({ workplaceName: 'Demo Otel Turizm ve Ticaret A.Ş.', sgkWorkplaceNo: '2 5510 01 01 1234567 006 06 41 000', taxOffice: 'Çankaya', taxNumber: '9876543217', sector: 'GENERAL', treasuryDiscount: true })));
  for (const department of DEPARTMENTS) await boss(() => employees.saveDepartment(hotelId, contracts.departmentSchema.parse({ code: department.code, name: department.name })));
  const departmentOf = Object.fromEntries((await prisma.department.findMany({ where: { hotelId } })).map((row) => [row.code, row]));

  // ── Personel ──
  const people = [];
  const usedNames = new Set();
  let index = 0;
  for (const [code, position, count, basis, salary] of ROSTER) {
    for (let n = 0; n < count; n += 1) {
      let name;
      do name = [pick(FIRST), pick(LAST)];
      while (usedNames.has(name.join(' ')));
      usedNames.add(name.join(' '));
      index += 1;
      // Çoğu eski; birkaçı bu yıl sezona girdi (yarım ay), ikisi teşvikli yeni işe giriş.
      const seasonal = code !== 'MHS' && index % 9 === 0;
      const hireDate = seasonal ? `${year}-0${3 + (index % 4)}-${index % 2 ? '16' : '01'}` : `${2015 + Math.floor(rand() * 10)}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 27)).padStart(2, '0')}`;
      const retired = index === 17 || index === 33;
      const cash = code === 'GVN' && n === 0;
      const input = {
        firstName: name[0],
        lastName: name[1],
        nationality: 'TR',
        nationalId: tckn(rand),
        birthDate: `${retired ? 1962 : 1975 + Math.floor(rand() * 28)}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 27)).padStart(2, '0')}`,
        phone: `+90532${String(1_000_000 + Math.floor(rand() * 8_999_999))}`,
        departmentId: departmentOf[code].id,
        position,
        hireDate,
        insuranceType: retired ? 'RETIRED' : 'NORMAL',
        disabilityDegree: index === 23 ? 3 : null,
        serviceChargePoints: DEPARTMENTS.find((row) => row.code === code).points,
        payBasis: basis,
        salary,
        paymentMethod: cash ? 'CASH' : 'BANK',
        iban: cash ? null : iban(rand),
        besEnrolled: !retired && rand() < 0.62,
        besOptOutOn: null,
      };
      if (input.besEnrolled && index % 11 === 0) input.besOptOutOn = `${year}-03-20`;
      const created = await prep(() => employees.createEmployee(hotelId, contracts.employeeCreateSchema.parse(input), { withPay: true }));
      people.push({ ...created, dept: code, hireDate, seasonal });
    }
  }
  summary.employees = people.length;

  // Teşvik: yılın sezonluk girişlerinden ikisi (asgari ücret üzerinden işveren payı, 12 ay)
  for (const person of people.filter((row) => row.seasonal).slice(0, 2)) {
    await prep(() => employees.addIncentive(hotelId, person.id, contracts.incentiveSchema.parse({ code: '7103', label: 'İlave istihdam teşviki', method: 'MIN_WAGE_EMPLOYER_SHARE', validFrom: person.hireDate, validTo: null })));
  }
  const bankAccount = await prisma.treasuryAccount.findFirst({ where: { hotelId, kind: 'BANK', currency: 'TRY', isActive: true }, orderBy: { createdAt: 'asc' } });
  const cashAccount = await prisma.treasuryAccount.findFirst({ where: { hotelId, kind: 'CASH', currency: 'TRY', isActive: true }, orderBy: { createdAt: 'asc' } });

  // Kesintiler: nafaka (yıl başından), icra (Mart tebliği), iki avans
  const regulars = people.filter((row) => !row.seasonal && row.dept !== 'MHS');
  const nafakaOf = regulars[5];
  const icraOf = regulars[12];
  await prep(() => inputs.createGarnishment(hotelId, nafakaOf.id, contracts.garnishmentSchema.parse({ type: 'NAFAKA', fileNumber: `${year - 1}/482 Esas`, authority: 'Ankara 7. Aile Mahkemesi', creditor: 'Nafaka alacaklısı', notifiedOn: `${year - 1}-12-04`, monthlyAmount: '4000.00' })));
  await prep(() => inputs.createGarnishment(hotelId, icraOf.id, contracts.garnishmentSchema.parse({ type: 'ICRA', fileNumber: `${year}/3318`, authority: 'Ankara 12. İcra Dairesi', creditor: 'Tüketici Finansman A.Ş.', notifiedOn: `${year}-03-10`, totalAmount: '27500.00' })));
  const advances = [
    { who: regulars[2], month: 2, amount: '6000.00', installments: 3 },
    { who: regulars[20], month: 7, amount: '10000.00', installments: 2 },
  ];
  const leavers = { 6: { who: regulars[8], reasonCode: '03', severanceEligible: false, noticeMode: 'NONE', unusedLeaveDays: '3', date: `${year}-06-30` }, 9: { who: regulars[15], reasonCode: '04', severanceEligible: true, noticeMode: 'EMPLOYER_PAYS', unusedLeaveDays: '6', date: `${year}-09-15` } };
  const elementOf = Object.fromEntries((await prisma.payElement.findMany({ where: { hotelId } })).map((row) => [row.code, row.id]));

  /** Bir ayı ödeme gününde öder (banka + kasa); ödeme günü bugünü aşmaz. */
  async function pay(runId, month) {
    const next = month === 12 ? `${year + 1}-01-03` : `${year}-${String(month + 1).padStart(2, '0')}-03`;
    const date = next > today ? today : next;
    for (const [method, account] of [['BANK', bankAccount], ['CASH', cashAccount]]) {
      if (!account) continue;
      try {
        await prep(() => runs.payRun(hotelId, runId, { treasuryAccountId: account.id, date, method }));
        summary.paid += 1;
      } catch (error) {
        if (error.code !== 'PAYROLL_NOTHING_TO_PAY') throw error;
      }
    }
  }

  /** Hesapla → onaya gönder → yönetici onayı (karar dinleyicisini doğrudan çağırır). */
  async function approve(runId) {
    await prep(() => runs.calculateRun(hotelId, runId));
    if (!approverExists) return false;
    const submitted = await prep(() => runs.submitRun(hotelId, runId));
    await boss(() => approvals.decideApproval(hotelId, submitted.approvalId, 'GRANTED', { note: 'Uygun' }));
    await runs.onPayrollApprovalDecision({ hotelId, approvalId: submitted.approvalId, type: 'PAYROLL', decidedBy: APPROVER }, { id: randomUUID(), name: 'approval.granted', correlationId: randomUUID() });
    summary.approved += 1;
    return true;
  }

  for (let month = 1; month <= currentMonth; month += 1) {
    const gone = new Set(Object.entries(leavers).filter(([at]) => Number(at) < month).map(([, row]) => row.who.id));
    const active = people.filter((person) => !gone.has(person.id) && person.hireDate <= `${year}-${String(month).padStart(2, '0')}-28`);
    // Puantaj: rapor / ücretsiz izin, sezonda fazla mesai, bayram ve hafta tatili çalışması
    const rows = [];
    for (const person of active) {
      const sick = rand() < 0.07;
      const unpaid = !sick && rand() < 0.04;
      const operations = ['ONB', 'KAT', 'MTF', 'SRV', 'GVN'].includes(person.dept);
      const overtime = ['MTF', 'SRV', 'KAT'].includes(person.dept) && SEASON[month - 1] >= 1 ? Math.round(rand() * 18 * SEASON[month - 1]) : 0;
      const holiday = operations && HOLIDAYS[month] && rand() < 0.6 ? Math.min(HOLIDAYS[month], 1 + Math.floor(rand() * 2)) : 0;
      if (!sick && !unpaid && !overtime && !holiday) continue;
      rows.push(contracts.attendanceSchema.parse({ employeeId: person.id, missingDays: sick ? 2 + Math.floor(rand() * 2) : unpaid ? 1 + Math.floor(rand() * 2) : 0, missingReason: sick ? '01' : unpaid ? '21' : null, overtimeHours: String(overtime), holidayDays: String(holiday), weeklyRestDays: SEASON[month - 1] > 1.3 && rand() < 0.25 ? '1' : '0' }));
    }
    if (rows.length) await prep(() => inputs.saveAttendance(hotelId, year, month, rows));

    // Bayram ikramiyesi (net), yaz performans primi (brüt)
    if (month === 3 || month === 5) {
      for (const person of active.filter((row) => row.dept !== 'MHS')) {
        await prep(() => inputs.createItem(hotelId, contracts.payrollItemSchema.parse({ year, month, employeeId: person.id, elementId: elementOf.BONUS, amount: '3000.00', isNet: true, note: month === 3 ? 'Ramazan Bayramı ikramiyesi' : 'Kurban Bayramı ikramiyesi' })));
      }
    }
    if (month === 8) {
      for (const person of active.filter((row) => /müdür|şef|Aşçıbaşı/i.test(row.position))) {
        await prep(() => inputs.createItem(hotelId, contracts.payrollItemSchema.parse({ year, month, employeeId: person.id, elementId: elementOf.BONUS, amount: '15000.00', note: 'Sezon performans primi' })));
      }
    }
    // Avans
    for (const advance of advances.filter((row) => row.month === month)) {
      await prep(() => inputs.createAdvance(hotelId, advance.who.id, contracts.advanceSchema.parse({ amount: advance.amount, paidOn: `${year}-${String(month).padStart(2, '0')}-05`, installments: advance.installments, firstYear: year, firstMonth: month, treasuryAccountId: bankAccount?.id ?? null, note: 'Maaş avansı' })));
    }
    // İşten çıkış
    const leaver = leavers[month];
    if (leaver) {
      await prep(() => employees.terminateEmployee(hotelId, leaver.who.id, contracts.terminationSchema.parse({ terminationDate: leaver.date, reasonCode: leaver.reasonCode, severanceEligible: leaver.severanceEligible, noticeMode: leaver.noticeMode, unusedLeaveDays: leaver.unusedLeaveDays })));
      summary.terminated += 1;
    }
    // Servis payı (sezona göre)
    await prep(() => inputs.distributeServiceCharge(hotelId, contracts.serviceChargeSchema.parse({ year, month, amount: String(Math.round(64_000 * SEASON[month - 1])), method: 'POINTS', daysWeighted: true })));

    const run = await prep(() => runs.createRun(hotelId, { year, month, kind: 'MONTHLY' }));
    summary.runs += 1;
    if (month === currentMonth) {
      await prep(() => runs.calculateRun(hotelId, run.id));
      break;
    }
    if (await approve(run.id)) await pay(run.id, month);

    // Geçen ayın fark bordrosu: geç bildirilen fazla mesai farkı (içinde bulunulan aydan önce, onaylı ayın düzeltmesi)
    if (month === currentMonth - 1) {
      const supplementary = await prep(() => runs.createRun(hotelId, { year, month, kind: 'SUPPLEMENTARY', note: 'Geç bildirilen fazla mesai farkı' }));
      for (const person of active.filter((row) => row.dept === 'MTF').slice(0, 2)) {
        await prep(() => inputs.createItem(hotelId, contracts.payrollItemSchema.parse({ year, month, runId: supplementary.id, employeeId: person.id, elementId: elementOf.RETRO_PAY, amount: '2400.00', note: 'Banket fazla mesaisi (geç bildirildi)' })));
      }
      summary.runs += 1;
      summary.supplementary += 1;
      if (await approve(supplementary.id)) await pay(supplementary.id, month);
    }
  }

  // Muhasebe kayıtları (aktör betikte çalışmaz): eşitleme süre bütçeli, kalan bitene kadar
  const settings = await prisma.accountingSettings.findFirst({ where: { hotelId }, select: { startDate: true } });
  if (settings) {
    for (let round = 0; round < 20; round += 1) {
      const report = await prep(() => accountingPostings.syncPeriod(hotelId, { from: core.toIsoDay(settings.startDate), to: today }));
      summary.posted += report.posted;
      if (report.remaining === 0) break;
    }
  }
  return summary;
}
