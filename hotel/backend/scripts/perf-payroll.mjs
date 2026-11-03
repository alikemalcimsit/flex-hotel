import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/**
 * Bordronun büyük veride süresi (modül 51; ölçüm aracı, üretimde çalışmaz).
 *
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-payroll.mjs
 *
 * Ölçüm otelinde 2.500 kişilik otelin bir yılı her çalıştırmada baştan kurulur (önceki bordro verisi ve bordro
 * kaynaklı muhasebe kayıtları silinir): 12 departman, 2.500 personel (%20 netten, %3 emekli, %60 BES), 60 icra,
 * 20 nafaka, 120 avans; her ay ~%30 personelde puantaj, ~%25'inde ek ödeme, servis payı. Ocak–Eylül hesaplanıp
 * onaylanır (birikmiş matrah geçmişi).
 *
 * Ölçülen: personel listesi (ilk sayfa, arama, departman, derin sayfa) ve kartı, puantaj sayfası ve 200 satır
 * kaydı, kalem listesi, Ekim bordrosunun hesabı (2.500 kişi, net→brüt çözümü dahil), satır listesi (ilk / derin
 * sayfa, arama, departman), satır ayrıntısı, bordro ve icmal, banka / müşavir dışa aktarımı, bordro PDF'i (2.500
 * satır) ve pusula PDF'i (500 sayfa), onay (kesintilerin kesinleşmesi), banka ödemesi, muhasebe tahakkuku + ödeme
 * kaydı (2.500 personel carisi).
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}
const ROUNDS = Number(process.env.PERF_ROUNDS ?? 3);
const ACTOR = 'perf-payroll@hotel.local';
const APPROVER = 'perf-approver@hotel.local';
const EMPLOYEES = 2500;
const YEAR = 2026;
const MEASURE_MONTH = 10;
const CHUNK = 2000;

const core = await import('@hotelos/core');
const contracts = await import('@hotelos/hotel-contracts');
const { prisma } = await import('../src/db.js');
const { resolveHotelId } = await import('../src/lib/tenant.js');
const employees = await import('../src/modules/payroll/employees.js');
const inputs = await import('../src/modules/payroll/inputs.js');
const runs = await import('../src/modules/payroll/runs.js');
const setup = await import('../src/modules/payroll/setup.js');
const pdf = await import('../src/modules/payroll/pdf.js');
const postings = await import('../src/modules/payroll/postings.js');
const approvals = await import('../src/modules/approvals/service.js');
const { resetPayrollDemo } = await import('./demo-payroll.mjs');

const hotelId = await resolveHotelId();
const as = (who, fn) => core.runWithContext({ correlationId: randomUUID(), actor: who }, fn);
const prep = (fn) => as(ACTOR, fn);
let seed = 51_2500;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];

/* ══════════════════ Kurulum (her çalıştırmada baştan) ══════════════════ */

const started = performance.now();
console.log('Kurulum: önceki bordro verisi siliniyor…');
await prisma.$transaction(
  async (tx) => {
    await tx.$executeRaw`DELETE FROM "LedgerEntry" WHERE "hotelId" = ${hotelId} AND "sourceType" IN ('PAYROLL', 'PAYROLL_PAYMENT', 'EMPLOYEE_ADVANCE')`;
    await tx.$executeRaw`DELETE FROM "TreasuryMovement" WHERE "hotelId" = ${hotelId} AND "sourceType" IN ('PAYROLL_PAYMENT', 'EMPLOYEE_ADVANCE')`;
    await tx.$executeRaw`DELETE FROM "LedgerAccount" WHERE "hotelId" = ${hotelId} AND "employeeId" IS NOT NULL`;
    await resetPayrollDemo(tx, hotelId);
  },
  { timeout: 300_000 },
);
for (const email of [ACTOR, APPROVER]) {
  if (!(await prisma.user.findFirst({ where: { email } }))) await prisma.user.create({ data: { hotelId, email, name: email, role: 'ADMIN', passwordHash: 'x' } });
}
await as(APPROVER, () => setup.loadCatalogSets(hotelId));
for (const set of (await setup.listParameterSets(hotelId)).items) await as(APPROVER, () => setup.verifyParameterSet(hotelId, set.id, true));
const departmentCodes = ['ONB', 'KAT', 'MTF', 'SRV', 'TKN', 'MHS', 'GVN', 'STS', 'SPA', 'ANM', 'BNK', 'IKD'];
for (const code of departmentCodes) await prep(() => employees.saveDepartment(hotelId, contracts.departmentSchema.parse({ code, name: `Departman ${code}` })));
const departments = await prisma.department.findMany({ where: { hotelId } });
const first = ['Ahmet', 'Ayşe', 'Mehmet', 'Fatma', 'Mustafa', 'Emine', 'Ali', 'Zeynep', 'Hasan', 'Elif', 'Murat', 'Esra', 'Emre', 'Derya', 'Kemal', 'Gizem'];
const last = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Öztürk', 'Aydın', 'Arslan', 'Doğan', 'Kılıç', 'Koç', 'Kurt', 'Polat', 'Güneş', 'Aksoy'];
const rows = Array.from({ length: EMPLOYEES }, (_, index) => {
  const net = rand() < 0.2;
  return {
    hotelId,
    code: `P-${String(index + 1).padStart(5, '0')}`,
    firstName: pick(first),
    lastName: `${pick(last)}${index % 7 === 0 ? 'oğlu' : ''}`,
    nationality: 'TR',
    nationalId: String(10_000_000_000 + index * 13),
    departmentId: pick(departments).id,
    position: 'Personel',
    hireDate: new Date(`${2014 + Math.floor(rand() * 12)}-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}T00:00:00Z`),
    payBasis: net ? 'NET' : 'GROSS',
    salary: net ? String(28_076 + Math.floor(rand() * 60_000)) : String(33_030 + Math.floor(rand() * 120_000)),
    insuranceType: rand() < 0.03 ? 'RETIRED' : 'NORMAL',
    disabilityDegree: rand() < 0.01 ? 2 : null,
    paymentMethod: rand() < 0.04 ? 'CASH' : 'BANK',
    iban: 'TR330006100519786457841326',
    besEnrolled: rand() < 0.6,
    serviceChargePoints: String(1 + Math.floor(rand() * 3)),
    createdBy: ACTOR,
  };
});
for (let index = 0; index < rows.length; index += CHUNK) await prisma.employee.createMany({ data: rows.slice(index, index + CHUNK) });
await prisma.employee.updateMany({ where: { hotelId, insuranceType: 'RETIRED' }, data: { besEnrolled: false } });
const people = await prisma.employee.findMany({ where: { hotelId }, select: { id: true }, orderBy: { code: 'asc' } });
for (const person of people.slice(0, 60)) await prep(() => inputs.createGarnishment(hotelId, person.id, contracts.garnishmentSchema.parse({ type: 'ICRA', fileNumber: `2026/${person.id.slice(0, 4)}`, authority: 'Ankara İcra', creditor: 'Banka', notifiedOn: '2026-01-05', totalAmount: '60000.00' })));
for (const person of people.slice(60, 80)) await prep(() => inputs.createGarnishment(hotelId, person.id, contracts.garnishmentSchema.parse({ type: 'NAFAKA', fileNumber: `2025/${person.id.slice(0, 4)}`, authority: 'Aile Mahkemesi', creditor: 'Alacaklı', notifiedOn: '2025-12-01', monthlyAmount: '3500.00' })));
for (const person of people.slice(80, 200)) await prep(() => inputs.createAdvance(hotelId, person.id, contracts.advanceSchema.parse({ amount: '9000.00', paidOn: '2026-02-03', installments: 6, firstYear: 2026, firstMonth: 2 })));
await setup.listPayElements(hotelId);
const bonus = await prisma.payElement.findFirst({ where: { hotelId, code: 'BONUS' } });

/** Bir ayın girdileri: puantaj ve kalemler (toplu), servis payı. */
async function monthInputs(month) {
  const attendance = people.filter(() => rand() < 0.3).map((person) => ({ hotelId, employeeId: person.id, year: YEAR, month, missingDays: rand() < 0.3 ? 2 : 0, missingReason: null, overtimeHours: String(Math.floor(rand() * 20)), holidayDays: '0', weeklyRestDays: '0', updatedBy: ACTOR }));
  for (const row of attendance) if (row.missingDays) row.missingReason = '01';
  await prisma.payrollAttendance.createMany({ data: attendance });
  const items = people.filter(() => rand() < 0.25).map((person) => ({ hotelId, employeeId: person.id, year: YEAR, month, elementId: bonus.id, amount: String(1000 + Math.floor(rand() * 9000)), isNet: rand() < 0.3, createdBy: ACTOR }));
  await prisma.payrollItem.createMany({ data: items });
  await prep(() => inputs.distributeServiceCharge(hotelId, contracts.serviceChargeSchema.parse({ year: YEAR, month, amount: '1500000.00', method: 'POINTS', daysWeighted: true })));
}

async function approve(runId) {
  const submitted = await prep(() => runs.submitRun(hotelId, runId));
  await as(APPROVER, () => approvals.decideApproval(hotelId, submitted.approvalId, 'GRANTED', { note: 'perf' }));
  await runs.onPayrollApprovalDecision({ hotelId, approvalId: submitted.approvalId, type: 'PAYROLL', decidedBy: APPROVER }, { id: randomUUID(), name: 'approval.granted', correlationId: randomUUID() });
}

for (let month = 1; month < MEASURE_MONTH; month += 1) {
  await monthInputs(month);
  const run = await prep(() => runs.createRun(hotelId, { year: YEAR, month, kind: 'MONTHLY' }));
  const at = performance.now();
  await prep(() => runs.calculateRun(hotelId, run.id));
  const calcMs = performance.now() - at;
  await approve(run.id);
  console.log(`  ${contracts.payrollPeriodLabel(YEAR, month)}: hesap ${Math.round(calcMs)} ms, onaylandı`);
}
await monthInputs(MEASURE_MONTH);
console.log(`Kurulum ${Math.round((performance.now() - started) / 1000)} sn`);

/* ══════════════════ Ölçüm ══════════════════ */

async function measure(name, fn, rounds = ROUNDS) {
  const times = [];
  let result;
  for (let round = 0; round < rounds; round += 1) {
    const at = performance.now();
    result = await fn();
    times.push(performance.now() - at);
  }
  times.sort((a, b) => a - b);
  console.log(`${name.padEnd(58)} medyan ${String(Math.round(times[Math.floor(times.length / 2)])).padStart(6)} ms   en kötü ${String(Math.round(times.at(-1))).padStart(6)} ms`);
  return result;
}

const page = (extra = {}) => ({ page: 1, pageSize: 25, ...extra });
const someone = people[1234].id;
await measure('Personel listesi, ilk sayfa', () => employees.listEmployees(hotelId, page(), { withPay: true, withFullId: true }));
await measure('Personel listesi, arama "Aydın"', () => employees.listEmployees(hotelId, page({ search: 'Aydın' }), { withPay: true }));
await measure('Personel listesi, departman', () => employees.listEmployees(hotelId, page({ departmentId: departments[3].id }), { withPay: true }));
await measure('Personel listesi, derin sayfa (90.)', () => employees.listEmployees(hotelId, { page: 90, pageSize: 25 }, { withPay: true }));
await measure('Personel kartı', () => employees.getEmployee(hotelId, someone, { withPay: true, withFullId: true }));
await measure('Puantaj sayfası (50 satır)', () => inputs.listAttendance(hotelId, { year: YEAR, month: MEASURE_MONTH, page: 1, pageSize: 50 }));
const batch = people.slice(500, 700).map((person) => contracts.attendanceSchema.parse({ employeeId: person.id, missingDays: 0, overtimeHours: '4' }));
await measure('Puantaj kaydı (200 satır)', () => prep(() => inputs.saveAttendance(hotelId, YEAR, MEASURE_MONTH, batch)));
await measure('Kalem listesi', () => inputs.listItems(hotelId, { year: YEAR, month: MEASURE_MONTH, page: 1, pageSize: 20 }));
const october = await prep(() => runs.createRun(hotelId, { year: YEAR, month: MEASURE_MONTH, kind: 'MONTHLY' }));
await measure(`Ekim bordrosunun hesabı (${EMPLOYEES} personel)`, () => prep(() => runs.calculateRun(hotelId, october.id)));
await measure('Satır listesi, ilk sayfa', () => runs.listEntries(hotelId, october.id, { page: 1, pageSize: 50 }));
await measure('Satır listesi, derin sayfa (50.)', () => runs.listEntries(hotelId, october.id, { page: 50, pageSize: 50 }));
await measure('Satır listesi, arama', () => runs.listEntries(hotelId, october.id, { page: 1, pageSize: 50, search: 'Yılmaz' }));
await measure('Satır listesi, departman', () => runs.listEntries(hotelId, october.id, { page: 1, pageSize: 50, departmentId: departments[0].id }));
const entry = await prisma.payrollEntry.findFirst({ where: { runId: october.id }, select: { id: true } });
await measure('Satır ayrıntısı', () => runs.getEntry(hotelId, october.id, entry.id));
await measure('Bordro + icmal', () => runs.getRun(hotelId, october.id));
await measure('Dışa aktarım: banka', () => runs.exportRows(hotelId, october.id, 'BANK'));
await measure('Dışa aktarım: müşavir', () => runs.exportRows(hotelId, october.id, 'ACCOUNTANT'));
await measure(`Bordro PDF (${EMPLOYEES} satır)`, () => pdf.renderPayrollPdf(hotelId, october.id, { kind: 'PAYROLL', page: 1 }), 1);
await measure('Pusula PDF (500 sayfa)', () => pdf.renderPayrollPdf(hotelId, october.id, { kind: 'PAYSLIPS', page: 1 }), 1);
await measure('Onay (kesintilerin kesinleşmesi dahil)', () => approve(october.id), 1);
let bank = await prisma.treasuryAccount.findFirst({ where: { hotelId, kind: 'BANK', currency: 'TRY', isActive: true } });
if (!bank) bank = await prisma.treasuryAccount.create({ data: { hotelId, code: 'BNK-PERF', kind: 'BANK', name: 'Perf banka', currency: 'TRY', createdBy: ACTOR } });
await measure('Banka ödemesi (~2.400 satır)', () => prep(() => runs.payRun(hotelId, october.id, { treasuryAccountId: bank.id, date: '2026-11-02', method: 'BANK' })), 1);
await measure('Muhasebe: tahakkuk + ödeme (2.500 cari)', () => prep(() => postings.syncPayrollRun(hotelId, october.id)), 1);
await measure('Muhasebe: tekrar çağrı (yazacak bir şey yok)', () => prep(() => postings.syncPayrollRun(hotelId, october.id)));
await prisma.$disconnect();
