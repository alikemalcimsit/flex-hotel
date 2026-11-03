import { randomUUID } from 'node:crypto';
import { currentActor, runWithContext, toDecimal } from '@hotelos/core';
import { APPROVAL_TYPE_LABELS, MISSING_DAY_REASONS, PAYROLL_DEDUCTION_LINE_LABELS, PERMISSIONS, employeeFullName, payrollMonthBounds } from '@hotelos/hotel-contracts';
import { prismaUnfiltered } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockPayrollRuns, lockTreasuryAccounts } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { findActiveStaffByEmail } from '../../lib/staff.js';
import { writeWithEvents } from '../../lib/write.js';
import { assertCashCovers } from '../accounting/shared.js';
import { requestApproval } from '../approvals/service.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { applyDeductions, employmentDays, fromCents, solveMonth, toCents, wageComponents } from './engine.js';
import { dateOnly, day, ensureSystemElements, hotelContext, iso, loadPayrollSettings, markRunsStale, money, monthKey, parameterSetFor, periodLabel, prisma } from './shared.js';

/**
 * Bordro (modül 51): aç → hesapla → onaya gönder → dört gözle onay → öde. Fark bordrosu onaylı ayın düzeltmesidir.
 *
 * Kurallar:
 * - Yıl içi birikmiş gelir vergisi matrahı onaylı bordrolardan gelir: bir ay, yılın önceki aylarının aylık
 *   bordroları onaylanmadan hesaplanamaz ve onaya gidemez.
 * - Hesap motoru saf (`engine.js`); bu dosya girdiyi toplar, sonucu yazar. Hesap tek işlemde, bordronun satır
 *   kilidi altında: eşzamanlı ikinci hesap ya da onaya gönderme sırayı bekler.
 * - Avans ve icra / nafaka kesintisi **onayda** kesinleşir (hesap tekrarlanabilir, kesinti bir kez düşer).
 * - Fark bordrosu: ayın onaylı girdisi + yeni kalemlerle ay baştan hesaplanır, önceki onaylı tutarlar çıkarılır;
 *   fark eksi olabilir. Fark bordrosunda BES / avans / icra kesintisi yapılmaz (yalnız girilen kesinti kalemleri).
 */

const CALCULATE_TIMEOUT_MS = 120_000;
const PAYROLL_APPROVAL_DAYS = 5;
const MONEY_FIELDS = Object.freeze([
  'gross',
  'sgkSubject',
  'pek',
  'employeeSgk',
  'employeeUnemployment',
  'gvBase',
  'gvComputed',
  'minWageGvExemption',
  'gvPayable',
  'dvComputed',
  'minWageDvExemption',
  'dvPayable',
  'minWageBase',
  'net',
  'employerSgk',
  'employerUnemployment',
  'treasuryDiscount',
  'incentiveDiscount',
  'employerCost',
]);

/* ═══════════════ Liste ve ayrıntı ═══════════════ */

/** @param {any} run */
function presentRun(run) {
  return {
    id: run.id,
    year: run.year,
    month: run.month,
    period: periodLabel(run.year, run.month),
    kind: run.kind,
    sequence: run.sequence,
    number: run.number,
    status: run.status,
    stale: run.stale,
    employeeCount: run.employeeCount,
    totals: {
      gross: money(run.grossTotal),
      net: money(run.netTotal),
      deductions: money(run.deductionTotal),
      payable: money(run.payableTotal),
      employeeSgk: money(run.employeeSgkTotal),
      employeeUnemployment: money(run.employeeUnemploymentTotal),
      employerSgk: money(run.employerSgkTotal),
      employerUnemployment: money(run.employerUnemploymentTotal),
      discounts: money(run.discountTotal),
      gv: money(run.gvTotal),
      dv: money(run.dvTotal),
      cost: money(run.costTotal),
      paid: money(run.paidTotal),
    },
    calculatedAt: iso(run.calculatedAt),
    calculatedBy: run.calculatedBy,
    submittedAt: iso(run.submittedAt),
    submittedBy: run.submittedBy,
    approvalId: run.approvalId,
    approvedAt: iso(run.approvedAt),
    approvedBy: run.approvedBy,
    note: run.note,
    createdBy: run.createdBy,
    createdAt: iso(run.createdAt),
    updatedAt: iso(run.updatedAt),
  };
}

/** @param {string} hotelId @param {{ page: number, pageSize: number, year?: number }} query */
export async function listRuns(hotelId, query) {
  const where = { hotelId, ...(query.year ? { year: query.year } : {}) };
  const [rows, total] = await prisma.$transaction([
    prisma.payrollRun.findMany({ where, orderBy: [{ year: 'desc' }, { month: 'desc' }, { kind: 'asc' }, { sequence: 'desc' }], ...toSkipTake(query) }),
    prisma.payrollRun.count({ where }),
  ]);
  return buildPage(rows.map(presentRun), total, query);
}

/**
 * Bordro + parametre seti + ödemeler + departman icmali.
 * @param {string} hotelId @param {string} runId
 */
export async function getRun(hotelId, runId) {
  const run = await prisma.payrollRun.findFirst({ where: { id: runId, hotelId }, include: { payments: { orderBy: { createdAt: 'desc' }, take: 50 } } });
  if (!run) throw new NotFoundError('Bordro bulunamadı');
  const [set, departments, approval] = await Promise.all([
    run.parameterSetId ? prisma.payrollParameterSet.findFirst({ where: { id: run.parameterSetId, hotelId }, select: { id: true, label: true, validFrom: true, verifiedBy: true, verifiedAt: true } }) : parameterSetFor(prisma, hotelId, run.year, run.month),
    prisma.$queryRaw`
      SELECT e."departmentId", d."name", count(*)::int AS "count",
             SUM(e."gross")::text AS "gross", SUM(e."net")::text AS "net", SUM(e."payable")::text AS "payable", SUM(e."employerCost")::text AS "cost"
      FROM "PayrollEntry" e JOIN "Department" d ON d."id" = e."departmentId"
      WHERE e."runId" = ${runId} AND e."hotelId" = ${hotelId}
      GROUP BY e."departmentId", d."name" ORDER BY d."name"`,
    run.approvalId ? prisma.approval.findFirst({ where: { id: run.approvalId, hotelId }, select: { status: true, decidedBy: true, note: true, expiresAt: true } }) : null,
  ]);
  const accounts = run.payments.length ? await prisma.treasuryAccount.findMany({ where: { hotelId, id: { in: [...new Set(run.payments.map((row) => row.treasuryAccountId))] } }, select: { id: true, name: true } }) : [];
  return {
    ...presentRun(run),
    parameterSet: set ? { id: set.id, label: set.label, validFrom: day(set.validFrom), verified: Boolean(set.verifiedAt), verifiedBy: set.verifiedBy } : null,
    approval: approval ? { status: approval.status, decidedBy: approval.decidedBy, note: approval.note, expiresAt: iso(approval.expiresAt) } : null,
    departments: /** @type {any[]} */ (departments).map((row) => ({ departmentId: row.departmentId, name: row.name, count: row.count, gross: money(row.gross), net: money(row.net), payable: money(row.payable), cost: money(row.cost) })),
    payments: run.payments.map((row) => ({ id: row.id, date: day(row.date), method: row.method, amount: money(row.amount), count: row.count, account: accounts.find((account) => account.id === row.treasuryAccountId)?.name ?? '—', createdBy: row.createdBy, createdAt: iso(row.createdAt) })),
  };
}

/**
 * Bordronun personel satırları (sayfalı; arama, departman, ödenmemiş).
 * @param {string} hotelId @param {string} runId @param {{ page: number, pageSize: number, search?: string, departmentId?: string, unpaid?: boolean }} query
 */
export async function listEntries(hotelId, runId, query) {
  /** @type {any} */
  const where = { hotelId, runId };
  if (query.departmentId) where.departmentId = query.departmentId;
  if (query.unpaid) Object.assign(where, { paymentId: null, payable: { gt: 0 } });
  if (query.search) where.employeeName = { contains: query.search, mode: 'insensitive' };
  const [rows, total] = await prisma.$transaction([
    prisma.payrollEntry.findMany({
      where,
      select: { id: true, employeeId: true, employeeName: true, departmentId: true, payBasis: true, insuranceType: true, sgkDays: true, missingDays: true, gross: true, net: true, deductionTotal: true, payable: true, employerCost: true, gvPayable: true, dvPayable: true, employeeSgk: true, employeeUnemployment: true, paymentMethod: true, paidAt: true, employee: { select: { code: true } } },
      orderBy: [{ employeeName: 'asc' }, { id: 'asc' }],
      ...toSkipTake(query),
    }),
    prisma.payrollEntry.count({ where }),
  ]);
  return buildPage(
    rows.map((row) => ({
      id: row.id,
      employeeId: row.employeeId,
      code: row.employee.code,
      name: row.employeeName,
      departmentId: row.departmentId,
      payBasis: row.payBasis,
      insuranceType: row.insuranceType,
      sgkDays: row.sgkDays,
      missingDays: row.missingDays,
      gross: money(row.gross),
      insurance: money(toDecimal(String(row.employeeSgk)).plus(String(row.employeeUnemployment)).toString()),
      taxes: money(toDecimal(String(row.gvPayable)).plus(String(row.dvPayable)).toString()),
      net: money(row.net),
      deductions: money(row.deductionTotal),
      payable: money(row.payable),
      cost: money(row.employerCost),
      paymentMethod: row.paymentMethod,
      paidAt: iso(row.paidAt),
    })),
    total,
    query,
  );
}

/** Bir satırın ayrıntısı: kalemler, kesintiler ve hesap izi. @param {string} hotelId @param {string} runId @param {string} entryId */
export async function getEntry(hotelId, runId, entryId) {
  const row = await prisma.payrollEntry.findFirst({ where: { id: entryId, runId, hotelId }, include: { lines: { orderBy: { sortOrder: 'asc' } }, employee: { select: { code: true, position: true } } } });
  if (!row) throw new NotFoundError('Bordro satırı bulunamadı');
  return {
    id: row.id,
    employeeId: row.employeeId,
    code: row.employee.code,
    position: row.employee.position,
    name: row.employeeName,
    payBasis: row.payBasis,
    insuranceType: row.insuranceType,
    sgkDays: row.sgkDays,
    workedDays: row.workedDays,
    missingDays: row.missingDays,
    missingReason: row.missingReason,
    missingReasonLabel: row.missingReason ? MISSING_DAY_REASONS[row.missingReason] ?? row.missingReason : null,
    ...Object.fromEntries(MONEY_FIELDS.map((field) => [field, money(row[field])])),
    gvBefore: money(row.gvBefore),
    minWageBefore: money(row.minWageBefore),
    deductionTotal: money(row.deductionTotal),
    payable: money(row.payable),
    incentiveCode: row.incentiveCode,
    paymentMethod: row.paymentMethod,
    paidAt: iso(row.paidAt),
    trace: row.trace,
    lines: row.lines.map((line) => ({ kind: line.kind, code: line.code, label: line.label, amount: money(line.amount), quantity: line.quantity, isNet: line.isNet })),
  };
}

/* ═══════════════ Aç / sil ═══════════════ */

/** @param {string} hotelId @param {{ year: number, month: number, kind: 'MONTHLY' | 'SUPPLEMENTARY', note?: string | null }} input */
export async function createRun(hotelId, input) {
  try {
    const id = await writeWithEvents(async (tx, stage) => {
      let sequence = 1;
      if (input.kind === 'SUPPLEMENTARY') {
        const monthly = await tx.payrollRun.findFirst({ where: { hotelId, year: input.year, month: input.month, kind: 'MONTHLY' }, select: { status: true } });
        if (monthly?.status !== 'APPROVED') throw new ConflictError('Fark bordrosu, ayın aylık bordrosu onaylandıktan sonra açılır', 'PAYROLL_MONTHLY_NOT_APPROVED');
        const later = await tx.payrollRun.findFirst({ where: { hotelId, kind: 'MONTHLY', status: { in: ['PENDING_APPROVAL', 'APPROVED'] }, OR: [{ year: { gt: input.year } }, { year: input.year, month: { gt: input.month } }] }, select: { year: true, month: true } });
        if (later && later.year === input.year) throw new ConflictError(`${periodLabel(later.year, later.month)} bordrosu onayda / onaylı; ${periodLabel(input.year, input.month)} farkı cari ayda "Geçmiş dönem farkı" kalemiyle verilir`, 'PAYROLL_LATER_APPROVED');
        const open = await tx.payrollRun.findFirst({ where: { hotelId, year: input.year, month: input.month, kind: 'SUPPLEMENTARY', status: { in: ['DRAFT', 'CALCULATED', 'PENDING_APPROVAL'] } }, select: { number: true } });
        if (open) throw new ConflictError(`${open.number} fark bordrosu açık; önce onu sonuçlandırın`, 'PAYROLL_SUPPLEMENTARY_OPEN');
        const last = await tx.payrollRun.findFirst({ where: { hotelId, year: input.year, month: input.month, kind: 'SUPPLEMENTARY' }, orderBy: { sequence: 'desc' }, select: { sequence: true } });
        sequence = (last?.sequence ?? 0) + 1;
      }
      const number = `B-${input.year}-${String(input.month).padStart(2, '0')}${input.kind === 'SUPPLEMENTARY' ? `-F${sequence}` : ''}`;
      const created = await tx.payrollRun.create({ data: { hotelId, year: input.year, month: input.month, kind: input.kind, sequence, number, note: input.note ?? null, createdBy: currentActor() } });
      await ensureSystemElements(tx, hotelId);
      await recordAudit(tx, { hotelId, entity: 'PayrollRun', entityId: created.id, action: 'CREATE', after: { number, kind: input.kind } });
      await stage('payroll.run.changed', { hotelId, runId: created.id, year: input.year, month: input.month, change: 'CREATED' });
      return created.id;
    });
    return getRun(hotelId, id);
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu ayın aylık bordrosu zaten açılmış' });
  }
}

/** Taslak / hesaplanmış bordroyu siler (fark bordrosunun kalemleri de). @param {string} hotelId @param {string} runId */
export async function deleteRun(hotelId, runId) {
  await writeWithEvents(async (tx, stage) => {
    await lockPayrollRuns(tx, hotelId, [runId]);
    const run = await tx.payrollRun.findFirst({ where: { id: runId, hotelId } });
    if (!run) throw new NotFoundError('Bordro bulunamadı');
    if (run.status !== 'DRAFT' && run.status !== 'CALCULATED') throw new ConflictError('Onaydaki ya da onaylı bordro silinmez', 'PAYROLL_RUN_LOCKED');
    await tx.payrollItem.deleteMany({ where: { hotelId, runId } });
    await tx.payrollRun.delete({ where: { id: runId } });
    await recordAudit(tx, { hotelId, entity: 'PayrollRun', entityId: runId, action: 'DELETE', before: { number: run.number, status: run.status } });
    await stage('payroll.run.changed', { hotelId, runId, year: run.year, month: run.month, change: 'DELETED' });
  });
  return { deleted: true };
}

/* ═══════════════ Hesap ═══════════════ */

/**
 * Yılın önceki aylarında onaylanmamış aylık bordro var mı (birikmiş matrah eksik olur).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {number} year @param {number} month
 */
async function assertEarlierApproved(tx, hotelId, year, month) {
  const blocking = await tx.payrollRun.findFirst({ where: { hotelId, year, month: { lt: month }, kind: 'MONTHLY', status: { not: 'APPROVED' } }, orderBy: { month: 'asc' }, select: { month: true } });
  if (blocking) throw new ConflictError(`Önce ${periodLabel(year, blocking.month)} bordrosu onaylanmalı (yıl içi birikmiş vergi matrahı ondan gelir)`, 'PAYROLL_EARLIER_OPEN');
}

/**
 * Bordroyu hesaplar ve sonucu yazar (eski sonuç silinir).
 * @param {string} hotelId @param {string} runId
 */
export async function calculateRun(hotelId, runId) {
  await writeWithEvents(
    async (tx, stage) => {
      await lockPayrollRuns(tx, hotelId, [runId]);
      const run = await tx.payrollRun.findFirst({ where: { id: runId, hotelId } });
      if (!run) throw new NotFoundError('Bordro bulunamadı');
      if (run.status !== 'DRAFT' && run.status !== 'CALCULATED') throw new ConflictError('Onaydaki ya da onaylı bordro yeniden hesaplanmaz', 'PAYROLL_RUN_LOCKED');
      await assertEarlierApproved(tx, hotelId, run.year, run.month);
      const set = await parameterSetFor(tx, hotelId, run.year, run.month);
      if (!set) throw new ValidationError(`${periodLabel(run.year, run.month)} için yasal parametre seti yok: Bordro → Ayarlar → Yasal parametreler`, { code: 'PAYROLL_PARAMETERS_MISSING' });
      const computed = run.kind === 'MONTHLY' ? await computeMonthly(tx, hotelId, run, set) : await computeSupplementary(tx, hotelId, run, set);
      await tx.payrollEntry.deleteMany({ where: { runId } });
      if (computed.entries.length) {
        await tx.payrollEntry.createMany({ data: computed.entries });
        await tx.payrollLine.createMany({ data: computed.lines });
      }
      const sum = (field) => computed.entries.reduce((acc, entry) => acc.plus(String(entry[field])), toDecimal('0')).toFixed(2);
      const totals = {
        employeeCount: computed.entries.length,
        grossTotal: sum('gross'),
        netTotal: sum('net'),
        deductionTotal: sum('deductionTotal'),
        payableTotal: sum('payable'),
        employeeSgkTotal: sum('employeeSgk'),
        employeeUnemploymentTotal: sum('employeeUnemployment'),
        employerSgkTotal: sum('employerSgk'),
        employerUnemploymentTotal: sum('employerUnemployment'),
        discountTotal: toDecimal(sum('treasuryDiscount')).plus(sum('incentiveDiscount')).toFixed(2),
        gvTotal: sum('gvPayable'),
        dvTotal: sum('dvPayable'),
        costTotal: sum('employerCost'),
      };
      await tx.payrollRun.update({ where: { id: runId }, data: { ...totals, status: 'CALCULATED', stale: false, parameterSetId: set.id, calculatedAt: new Date(), calculatedBy: currentActor() } });
      await recordAudit(tx, { hotelId, entity: 'PayrollRun', entityId: runId, action: 'UPDATE', before: { status: run.status }, after: { status: 'CALCULATED', parameterSet: set.label, employees: totals.employeeCount, net: totals.netTotal, cost: totals.costTotal } });
      await stage('payroll.run.changed', { hotelId, runId, year: run.year, month: run.month, change: 'CALCULATED' });
    },
    { timeout: CALCULATE_TIMEOUT_MS },
  );
  return getRun(hotelId, runId);
}

/**
 * Ortak girdiler: kalem kataloğu, teşvikler, ayarlar.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {any} run
 */
async function commonInputs(tx, hotelId, run) {
  const { first, last } = payrollMonthBounds(run.year, run.month);
  await ensureSystemElements(tx, hotelId);
  const [elements, settings, incentives] = await Promise.all([
    tx.payElement.findMany({ where: { hotelId }, select: { id: true, code: true, name: true, kind: true, sgk: true, gv: true, dv: true, exemption: true } }),
    loadPayrollSettings(tx, hotelId),
    tx.employeeIncentive.findMany({ where: { hotelId, validFrom: { lte: dateOnly(last) }, OR: [{ validTo: null }, { validTo: { gte: dateOnly(first) } }] }, orderBy: { validFrom: 'asc' } }),
  ]);
  const byCode = new Map(elements.map((element) => [element.code, element]));
  const byId = new Map(elements.map((element) => [element.id, element]));
  const incentiveOf = new Map();
  for (const incentive of incentives) if (!incentiveOf.has(incentive.employeeId)) incentiveOf.set(incentive.employeeId, incentive);
  return { first, last, byCode, byId, settings, incentiveOf };
}

/** Kalemin motor girdisi. @param {any} element @param {number} cents @param {boolean} isNet */
const earningOf = (element, cents, isNet, key = element.code) => ({
  key,
  label: element.name,
  ...(isNet ? { netTarget: cents } : { amount: cents }),
  sgk: element.sgk,
  gv: element.gv,
  dv: element.dv,
  exemption: element.exemption === 'NONE' ? null : element.exemption,
  wage: element.code !== 'SEVERANCE_PAY',
  isNet,
});

/** @param {any} incentive */
const incentiveInput = (incentive) => (incentive ? { method: incentive.method, points: incentive.points === null ? null : String(incentive.points), amount: incentive.amount === null ? null : toCents(String(incentive.amount)), code: incentive.code } : null);

/**
 * Satırı ve kalemlerini yazılacak biçime çevirir.
 * @param {{ hotelId: string, runId: string, employee: any, days: number, workedDays: number, missingDays: number, missingReason: string | null, result: any, earnings: any[], deductions: Array<{ key: string, refId: string | null, amount: number }>, incentive: any, trace: any, override?: Record<string, number> }} input
 */
function entryRows({ hotelId, runId, employee, days, workedDays, missingDays, missingReason, result, earnings, deductions, incentive, trace, override = {} }) {
  const id = randomUUID();
  const values = { ...result, ...override };
  const deductionTotal = deductions.reduce((acc, line) => acc + line.amount, 0);
  const entry = {
    id,
    hotelId,
    runId,
    employeeId: employee.id,
    departmentId: employee.departmentId,
    employeeName: employeeFullName(employee),
    payBasis: employee.payBasis,
    insuranceType: employee.insuranceType,
    sgkDays: days,
    workedDays,
    missingDays,
    missingReason,
    ...Object.fromEntries(MONEY_FIELDS.map((field) => [field, fromCents(values[field])])),
    gvBefore: fromCents(values.gvBefore),
    minWageBefore: fromCents(values.minWageBefore),
    deductionTotal: fromCents(deductionTotal),
    payable: fromCents(values.net - deductionTotal),
    incentiveCode: incentive?.code ?? null,
    paymentMethod: employee.paymentMethod,
    iban: employee.iban,
    trace,
  };
  let order = 0;
  const lines = [
    ...earnings.filter((item) => item.amount !== 0).map((item) => ({ id: randomUUID(), hotelId, entryId: id, kind: 'EARNING', code: item.key, label: item.label, amount: fromCents(item.amount), quantity: item.quantity ?? null, isNet: Boolean(item.isNet), refId: item.refId ?? null, sortOrder: order++ })),
    ...deductions.filter((line) => line.amount !== 0).map((line) => ({ id: randomUUID(), hotelId, entryId: id, kind: 'DEDUCTION', code: line.key, label: line.label ?? PAYROLL_DEDUCTION_LINE_LABELS[line.key] ?? line.key, amount: fromCents(line.amount), quantity: null, isNet: true, refId: line.refId ?? null, sortOrder: order++ })),
  ];
  return { entry, lines };
}

/**
 * Aylık bordro: ayda çalışan herkes.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {any} run @param {any} set
 */
async function computeMonthly(tx, hotelId, run, set) {
  const params = set.values;
  const common = await commonInputs(tx, hotelId, run);
  const employees = await tx.employee.findMany({
    where: { hotelId, hireDate: { lte: dateOnly(common.last) }, OR: [{ terminationDate: null }, { terminationDate: { gte: dateOnly(common.first) } }] },
    select: { id: true, firstName: true, lastName: true, departmentId: true, hireDate: true, terminationDate: true, payBasis: true, salary: true, insuranceType: true, disabilityDegree: true, paymentMethod: true, iban: true, besEnrolled: true, besRate: true, besOptOutOn: true },
    orderBy: { id: 'asc' },
  });
  if (employees.length === 0) throw new ValidationError(`${periodLabel(run.year, run.month)} döneminde çalışan personel yok`);
  const ids = employees.map((employee) => employee.id);
  const [attendance, items, prior, openings, advances, garnishments] = await Promise.all([
    tx.payrollAttendance.findMany({ where: { hotelId, year: run.year, month: run.month } }),
    tx.payrollItem.findMany({ where: { hotelId, year: run.year, month: run.month, runId: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    tx.$queryRaw`
      SELECT e."employeeId", SUM(e."gvBase")::text AS "gv", SUM(e."minWageBase")::text AS "mw"
      FROM "PayrollEntry" e JOIN "PayrollRun" r ON r."id" = e."runId"
      WHERE r."hotelId" = ${hotelId} AND r."year" = ${run.year} AND r."month" < ${run.month} AND r."status" = 'APPROVED'
      GROUP BY e."employeeId"`,
    tx.payrollOpening.findMany({ where: { hotelId, year: run.year } }),
    tx.employeeAdvance.findMany({ where: { hotelId, status: 'OPEN', employeeId: { in: ids } }, orderBy: [{ paidOn: 'asc' }, { id: 'asc' }] }),
    tx.garnishment.findMany({ where: { hotelId, status: 'ACTIVE', employeeId: { in: ids }, notifiedOn: { lte: dateOnly(common.last) } }, orderBy: [{ notifiedOn: 'asc' }, { id: 'asc' }] }),
  ]);
  const attendanceOf = new Map(attendance.map((row) => [row.employeeId, row]));
  const priorOf = new Map(/** @type {any[]} */ (prior).map((row) => [row.employeeId, row]));
  const openingOf = new Map(openings.map((row) => [row.employeeId, row]));
  const group = (rows) => rows.reduce((map, row) => map.set(row.employeeId, [...(map.get(row.employeeId) ?? []), row]), new Map());
  const itemsOf = group(items);
  const advancesOf = group(advances);
  const garnishmentsOf = group(garnishments);
  const treasuryPoints = common.settings.treasuryDiscount ? params.treasuryPoints[common.settings.sector] ?? null : null;
  const current = monthKey(run.year, run.month);

  const entries = [];
  const lines = [];
  for (const employee of employees) {
    const employment = employmentDays({ year: run.year, month: run.month, hireDate: day(employee.hireDate), terminationDate: day(employee.terminationDate) });
    if (employment === 0) continue;
    const attend = attendanceOf.get(employee.id);
    const missing = Math.min(attend?.missingDays ?? 0, employment);
    const days = employment - missing;
    const workedDays = Math.min(attend?.workedDays ?? days, days);
    const isNet = employee.payBasis === 'NET';
    /** @type {any[]} */
    const earnings = wageComponents({ salary: toCents(String(employee.salary)), payBasis: employee.payBasis, days, overtimeHours: attend ? String(attend.overtimeHours) : 0, holidayDays: attend ? String(attend.holidayDays) : 0, weeklyRestDays: attend ? String(attend.weeklyRestDays) : 0 })
      .filter((line) => line.value > 0)
      .map((line) => ({ ...earningOf(common.byCode.get(line.key), line.value, isNet), quantity: line.quantity }));
    const others = [];
    for (const item of itemsOf.get(employee.id) ?? []) {
      const element = common.byId.get(item.elementId);
      const cents = toCents(String(item.amount));
      if (element.kind === 'EARNING') earnings.push({ ...earningOf(element, cents, item.isNet), refId: item.id });
      else others.push({ key: element.code, label: element.name, amount: cents, id: item.id });
    }
    const opening = openingOf.get(employee.id);
    const before = priorOf.get(employee.id);
    const gvBefore = toCents(before?.gv ?? '0') + toCents(opening ? String(opening.gvCumulative) : '0');
    const minWageBefore = toCents(before?.mw ?? '0') + toCents(opening ? String(opening.minWageCumulative) : '0');
    const incentive = incentiveInput(common.incentiveOf.get(employee.id));
    const { result, earnings: resolved } = solveMonth({ params, insurance: employee.insuranceType, sgkDays: days, workedDays, earnings, gvBefore, minWageBefore, disabilityDegree: employee.disabilityDegree, treasuryPoints, incentive });

    const besActive = employee.besEnrolled && !(employee.besOptOutOn && day(employee.besOptOutOn) <= common.last);
    const advanceDue = (advancesOf.get(employee.id) ?? [])
      .filter((advance) => monthKey(advance.firstYear, advance.firstMonth) <= current)
      .map((advance) => ({ id: advance.id, due: Math.min(toCents(String(advance.installmentAmount)), toCents(String(advance.amount)) - toCents(String(advance.deducted))) }));
    const garnishmentList = (garnishmentsOf.get(employee.id) ?? []).map((item) => ({ id: item.id, type: item.type, monthly: item.monthlyAmount === null ? null : toCents(String(item.monthlyAmount)), rate: item.rate === null ? null : String(item.rate), remaining: item.totalAmount === null ? null : toCents(String(item.totalAmount)) - toCents(String(item.deducted)) }));
    const deducted = applyDeductions({ net: result.net, pek: result.pek, besRate: besActive ? String(employee.besRate ?? params.besRate) : null, garnishments: garnishmentList, advances: advanceDue, others });
    const deductionLines = deducted.lines.map((line) => ({ key: line.key, refId: line.refId, amount: line.amount, label: others.find((other) => other.id === line.refId)?.label }));
    const trace = {
      parameterSet: set.label,
      employmentDays: employment,
      sgkMealExempt: fromCents(result.sgkMealExempt),
      pekAtFloor: result.pekAtFloor,
      pekAtCeiling: result.pekAtCeiling,
      mealGvExempt: fromCents(result.mealGvExempt),
      transportGvExempt: fromCents(result.transportGvExempt),
      disabilityDeduction: fromCents(result.disabilityDeduction),
      gvAfter: fromCents(result.gvAfter),
      minWageAfter: fromCents(result.minWageAfter),
      treasuryPoints: incentive ? null : treasuryPoints,
      incentive: incentive ? { code: incentive.code, method: incentive.method } : null,
      shortfall: deducted.lines.filter((line) => line.amount < line.wanted).map((line) => ({ key: line.key, wanted: fromCents(line.wanted), taken: fromCents(line.amount) })),
    };
    const rows = entryRows({ hotelId, runId: run.id, employee, days, workedDays, missingDays: missing, missingReason: missing > 0 ? attend?.missingReason ?? null : null, result, earnings: resolved, deductions: deductionLines, incentive, trace });
    entries.push(rows.entry);
    lines.push(...rows.lines);
  }
  return { entries, lines };
}

/**
 * Fark bordrosu: kalem eklenen personelin ayı (onaylı girdi + yeni kalemler) yeniden hesaplanır, önceki onaylı
 * tutarlar çıkarılır.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {any} run @param {any} set
 */
async function computeSupplementary(tx, hotelId, run, set) {
  const params = set.values;
  const common = await commonInputs(tx, hotelId, run);
  const items = await tx.payrollItem.findMany({ where: { hotelId, runId: run.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (items.length === 0) throw new ValidationError('Fark bordrosuna kalem eklenmemiş');
  const ids = [...new Set(items.map((item) => item.employeeId))];
  const [employees, approved] = await Promise.all([
    tx.employee.findMany({ where: { hotelId, id: { in: ids } }, select: { id: true, firstName: true, lastName: true, departmentId: true, payBasis: true, insuranceType: true, disabilityDegree: true, paymentMethod: true, iban: true } }),
    tx.payrollEntry.findMany({ where: { hotelId, employeeId: { in: ids }, run: { year: run.year, month: run.month, status: 'APPROVED' } }, include: { lines: { where: { kind: 'EARNING' } }, run: { select: { kind: true } } } }),
  ]);
  const treasuryPoints = common.settings.treasuryDiscount ? params.treasuryPoints[common.settings.sector] ?? null : null;
  const entries = [];
  const lines = [];
  for (const employee of employees) {
    const previous = approved.filter((entry) => entry.employeeId === employee.id);
    const monthly = previous.find((entry) => entry.run.kind === 'MONTHLY');
    if (!monthly) throw new ValidationError(`${employeeFullName(employee)} bu ayın onaylı aylık bordrosunda yok; farkı kendi aylık bordrosuyla verilir`);
    // Ayın onaylı kazançları sabit brüt olarak (net anlaşmalılar da artık brüt tutarıyla)
    const base = previous.flatMap((entry) => entry.lines).map((line) => ({ key: line.code, label: line.label, amount: toCents(String(line.amount)), sgk: true, gv: true, dv: true, exemption: null, wage: line.code !== 'SEVERANCE_PAY' }));
    for (const item of base) {
      const element = common.byCode.get(item.key);
      if (element) Object.assign(item, { sgk: element.sgk, gv: element.gv, dv: element.dv, exemption: element.exemption === 'NONE' ? null : element.exemption });
    }
    const added = [];
    const others = [];
    for (const item of items.filter((row) => row.employeeId === employee.id)) {
      const element = common.byId.get(item.elementId);
      const cents = toCents(String(item.amount));
      if (element.kind === 'EARNING') added.push({ ...earningOf(element, cents, item.isNet), refId: item.id });
      else others.push({ key: element.code, label: element.name, amount: cents, id: item.id });
    }
    const incentive = incentiveInput(common.incentiveOf.get(employee.id));
    const input = { params, insurance: employee.insuranceType, sgkDays: monthly.sgkDays, workedDays: monthly.workedDays, gvBefore: toCents(String(monthly.gvBefore)), minWageBefore: toCents(String(monthly.minWageBefore)), disabilityDegree: employee.disabilityDegree, treasuryPoints, incentive };
    const { result, earnings: resolved } = solveMonth({ ...input, earnings: [...base, ...added] });
    const totalBefore = (field) => previous.reduce((acc, entry) => acc + toCents(String(entry[field])), 0);
    const delta = Object.fromEntries(MONEY_FIELDS.map((field) => [field, result[field] - totalBefore(field)]));
    delta.gvBefore = toCents(String(monthly.gvBefore));
    delta.minWageBefore = toCents(String(monthly.minWageBefore));
    const deducted = applyDeductions({ net: Math.max(0, delta.net), pek: 0, others });
    const newEarnings = resolved.slice(base.length);
    const trace = { parameterSet: set.label, supplementary: true, monthTotalNet: fromCents(result.net), previousNet: fromCents(totalBefore('net')) };
    const rows = entryRows({ hotelId, runId: run.id, employee, days: monthly.sgkDays, workedDays: monthly.workedDays, missingDays: monthly.missingDays, missingReason: monthly.missingReason, result: delta, earnings: newEarnings, deductions: deducted.lines.map((line) => ({ key: line.key, refId: line.refId, amount: line.amount, label: others.find((other) => other.id === line.refId)?.label })), incentive, trace });
    // Fark eksi olabilir: ödenecek = net farkı − kesinti (eksi ise personel borçlu kalır, ödenmez)
    rows.entry.payable = fromCents(delta.net - deducted.deducted);
    entries.push(rows.entry);
    lines.push(...rows.lines);
  }
  return { entries, lines };
}

/* ═══════════════ Onay ═══════════════ */

/** @param {string} hotelId @param {string} runId */
export async function submitRun(hotelId, runId) {
  const context = await hotelContext(hotelId);
  await writeWithEvents(async (tx, stage) => {
    await lockPayrollRuns(tx, hotelId, [runId]);
    const run = await tx.payrollRun.findFirst({ where: { id: runId, hotelId } });
    if (!run) throw new NotFoundError('Bordro bulunamadı');
    if (run.status !== 'CALCULATED') throw new ConflictError('Önce bordroyu hesaplayın', 'PAYROLL_NOT_CALCULATED');
    if (run.stale) throw new ConflictError('Hesaptan sonra girdi değişti; yeniden hesaplayın', 'PAYROLL_STALE');
    if (run.employeeCount === 0) throw new ValidationError('Bordroda personel yok');
    await assertEarlierApproved(tx, hotelId, run.year, run.month);
    const set = await tx.payrollParameterSet.findFirst({ where: { id: run.parameterSetId ?? '', hotelId } });
    if (!set?.verifiedAt) throw new ConflictError(`Bordro "${set?.label ?? '—'}" yasal parametre setiyle hesaplandı ve set henüz teyit edilmedi: Ayarlar → Yasal parametreler → Teyit et`, 'PAYROLL_PARAMETERS_UNVERIFIED');
    const actor = currentActor();
    const { approvalId } = await requestApproval(tx, stage, {
      hotelId,
      type: 'PAYROLL',
      summary: `${run.number} ${periodLabel(run.year, run.month)} bordrosu: ${run.employeeCount} personel, ödenecek ${money(run.payableTotal)} ${context.currency}`.slice(0, 200),
      reason: 'Bordro dört gözle onaylanır: hazırlayan onaylayamaz',
      amount: money(run.payableTotal),
      currency: context.currency,
      data: {
        Dönem: periodLabel(run.year, run.month),
        Tür: run.kind === 'MONTHLY' ? 'Aylık bordro' : 'Fark bordrosu',
        Personel: String(run.employeeCount),
        'Brüt toplam': money(run.grossTotal),
        'Net toplam': money(run.netTotal),
        'Kesintiler (BES, icra, avans…)': money(run.deductionTotal),
        'Ödenecek': money(run.payableTotal),
        'SGK (işçi + işveren − indirim)': toDecimal(String(run.employeeSgkTotal)).plus(String(run.employeeUnemploymentTotal)).plus(String(run.employerSgkTotal)).plus(String(run.employerUnemploymentTotal)).minus(String(run.discountTotal)).toFixed(2),
        'Gelir + damga vergisi': toDecimal(String(run.gvTotal)).plus(String(run.dvTotal)).toFixed(2),
        'İşveren maliyeti': money(run.costTotal),
        'Parametre seti': `${set.label} (teyit: ${set.verifiedBy})`,
        Hazırlayan: actor,
      },
      entityType: 'PayrollRun',
      entityId: runId,
      requestedBy: actor,
      expiresInMs: PAYROLL_APPROVAL_DAYS * 86_400_000,
    });
    await tx.payrollRun.update({ where: { id: runId }, data: { status: 'PENDING_APPROVAL', submittedAt: new Date(), submittedBy: actor, approvalId } });
    await recordAudit(tx, { hotelId, entity: 'PayrollRun', entityId: runId, action: 'UPDATE', before: { status: 'CALCULATED' }, after: { status: 'PENDING_APPROVAL', approvalId } });
    await stage('payroll.run.changed', { hotelId, runId, year: run.year, month: run.month, change: 'SUBMITTED' });
  });
  return getRun(hotelId, runId);
}

/**
 * Onay kuyruğunun kararı: onaylandıysa bordro kilitlenir, avans ve icra / nafaka kesintileri kesinleşir, muhasebe
 * aktörüne iş olayı gider; reddedildi / süresi dolduysa bordro hesaplanmış duruma döner.
 * @param {{ hotelId: string, approvalId: string, type: string }} payload @param {{ name: string }} envelope
 */
export async function applyPayrollDecision(payload, envelope) {
  if (payload.type !== 'PAYROLL') return { handled: false };
  const hotelId = payload.hotelId;
  const approval = await prismaUnfiltered.approval.findFirst({ where: { id: payload.approvalId, hotelId }, select: { id: true, type: true, entityId: true, requestedBy: true, decidedBy: true, note: true, summary: true } });
  if (!approval?.entityId) return { handled: false };
  const granted = envelope.name === 'approval.granted';
  const outcome = await writeWithEvents(async (tx, stage) => {
    await lockPayrollRuns(tx, hotelId, [approval.entityId]);
    const run = await tx.payrollRun.findFirst({ where: { id: approval.entityId, hotelId } });
    if (!run || run.status !== 'PENDING_APPROVAL' || run.approvalId !== approval.id) return { stale: true };
    if (granted) {
      await tx.$executeRaw`
        UPDATE "EmployeeAdvance" a SET "deducted" = a."deducted" + s."amount",
          "status" = CASE WHEN a."deducted" + s."amount" >= a."amount" THEN 'SETTLED'::"AdvanceStatus" ELSE a."status" END, "updatedAt" = now()
        FROM (SELECT l."refId", SUM(l."amount") AS "amount" FROM "PayrollLine" l JOIN "PayrollEntry" e ON e."id" = l."entryId"
              WHERE e."runId" = ${run.id} AND l."code" = 'ADVANCE' AND l."refId" IS NOT NULL GROUP BY l."refId") s
        WHERE a."id" = s."refId" AND a."hotelId" = ${hotelId}`;
      await tx.$executeRaw`
        UPDATE "Garnishment" g SET "deducted" = g."deducted" + s."amount",
          "status" = CASE WHEN g."totalAmount" IS NOT NULL AND g."deducted" + s."amount" >= g."totalAmount" THEN 'COMPLETED'::"GarnishmentStatus" ELSE g."status" END, "updatedAt" = now()
        FROM (SELECT l."refId", SUM(l."amount") AS "amount" FROM "PayrollLine" l JOIN "PayrollEntry" e ON e."id" = l."entryId"
              WHERE e."runId" = ${run.id} AND l."code" IN ('ICRA', 'NAFAKA') AND l."refId" IS NOT NULL GROUP BY l."refId") s
        WHERE g."id" = s."refId" AND g."hotelId" = ${hotelId}`;
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: approval.decidedBy } });
      await recordAudit(tx, { hotelId, entity: 'PayrollRun', entityId: run.id, action: 'UPDATE', before: { status: 'PENDING_APPROVAL' }, after: { status: 'APPROVED', approvedBy: approval.decidedBy, approvalId: approval.id } });
      if (run.kind === 'SUPPLEMENTARY') await markRunsStale(tx, hotelId, run.month === 12 ? { fromYear: run.year + 1, fromMonth: 1 } : { fromYear: run.year, fromMonth: run.month + 1 });
      await stage('payroll.run.approved', { hotelId, runId: run.id, year: run.year, month: run.month, kind: run.kind });
      await stage('payroll.run.changed', { hotelId, runId: run.id, year: run.year, month: run.month, change: 'APPROVED' });
      return { applied: true, run };
    }
    await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'CALCULATED', approvalId: null, submittedAt: null, submittedBy: null } });
    await recordAudit(tx, { hotelId, entity: 'PayrollRun', entityId: run.id, action: 'UPDATE', before: { status: 'PENDING_APPROVAL' }, after: { status: 'CALCULATED', outcome: envelope.name, note: approval.note } });
    await stage('payroll.run.changed', { hotelId, runId: run.id, year: run.year, month: run.month, change: 'DECLINED' });
    return { applied: false, run };
  });
  if (!outcome.stale) await alertRequester(hotelId, approval, envelope.name, outcome.run);
  return { handled: true, applied: Boolean(outcome.applied) };
}

/** @param {string} hotelId @param {any} approval @param {string} outcome @param {any} run */
async function alertRequester(hotelId, approval, outcome, run) {
  const staff = approval.requestedBy?.includes('@') ? await findActiveStaffByEmail(prismaUnfiltered, hotelId, approval.requestedBy.toLowerCase()) : null;
  const label = APPROVAL_TYPE_LABELS.PAYROLL;
  const granted = outcome === 'approval.granted';
  await writeWithEvents((tx, stage) =>
    raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'APPROVAL_DECIDED',
      severity: granted ? 'INFO' : 'WARNING',
      title: `${label} ${granted ? 'verildi' : outcome === 'approval.denied' ? 'reddedildi' : 'süresi doldu'}: ${run.number}`.slice(0, 200),
      body: granted ? 'Bordro kilitlendi; muhasebe kayıtları yazılıyor, ödeme yapılabilir.' : `${approval.note ?? ''} Bordro hesaplanmış duruma döndü; düzeltip yeniden gönderin.`.trim(),
      link: `/bordro/${run.id}`,
      userId: staff?.id ?? null,
      permission: staff ? null : PERMISSIONS.PAYROLL_MANAGE,
      entityType: 'Approval',
      entityId: approval.id,
      dedupeKey: `approval-decided:${approval.id}`,
    }),
  );
}

/** Dinleyici girişi: kararı verenin bağlamında. @param {any} payload @param {any} envelope */
export function onPayrollApprovalDecision(payload, envelope) {
  if (payload?.type !== 'PAYROLL') return Promise.resolve({ handled: false });
  return runWithContext({ correlationId: envelope.correlationId, causationId: envelope.id, actor: payload.decidedBy ?? 'system' }, () => applyPayrollDecision(payload, envelope));
}

/* ═══════════════ Ödeme ve dışa aktarım ═══════════════ */

/**
 * Onaylı bordronun ödenmemiş satırlarını öder (yöntemi seçilenle aynı olanlar; isteğe bağlı personel listesi).
 * Muhasebe kaydı aktörde (kasa / banka çıkışı, personel carisi kapanır).
 * @param {string} hotelId @param {string} runId @param {{ treasuryAccountId: string, date: string, method: 'BANK' | 'CASH', employeeIds?: string[] }} input
 */
export async function payRun(hotelId, runId, input) {
  const context = await hotelContext(hotelId);
  await writeWithEvents(async (tx, stage) => {
    await lockPayrollRuns(tx, hotelId, [runId]);
    const run = await tx.payrollRun.findFirst({ where: { id: runId, hotelId } });
    if (!run) throw new NotFoundError('Bordro bulunamadı');
    if (run.status !== 'APPROVED') throw new ConflictError('Yalnız onaylı bordro ödenir', 'PAYROLL_NOT_APPROVED');
    if (input.date > context.today) throw new ValidationError('Ödeme günü bugünden sonra olamaz');
    const account = await tx.treasuryAccount.findFirst({ where: { id: input.treasuryAccountId, hotelId }, select: { id: true, kind: true, isActive: true, currency: true, name: true } });
    if (!account?.isActive) throw new ValidationError('Kasa / banka hesabı kullanımda değil');
    if (account.currency !== context.currency) throw new ValidationError(`Maaş ${context.currency} hesabından ödenir`);
    if (input.method === 'BANK' && account.kind !== 'BANK') throw new ValidationError('Banka ödemesi banka hesabından yapılır');
    if (input.method === 'CASH' && account.kind !== 'CASH') throw new ValidationError('Elden ödeme kasadan yapılır');
    const entries = await tx.payrollEntry.findMany({ where: { hotelId, runId, paymentId: null, payable: { gt: 0 }, paymentMethod: input.method, ...(input.employeeIds?.length ? { employeeId: { in: input.employeeIds } } : {}) }, select: { id: true, payable: true, iban: true, employeeName: true } });
    if (entries.length === 0) throw new ConflictError('Ödenecek satır yok (hepsi ödenmiş ya da yöntem farklı)', 'PAYROLL_NOTHING_TO_PAY');
    if (input.method === 'BANK') {
      const missing = entries.filter((entry) => !entry.iban);
      if (missing.length) throw new ValidationError(`IBAN'ı olmayan personel: ${missing.slice(0, 5).map((entry) => entry.employeeName).join(', ')}${missing.length > 5 ? '…' : ''}`);
    }
    const amount = entries.reduce((acc, entry) => acc.plus(String(entry.payable)), toDecimal('0')).toFixed(2);
    await lockTreasuryAccounts(tx, hotelId, [account.id]);
    await assertCashCovers(tx, hotelId, account.id, amount);
    const payment = await tx.payrollPayment.create({ data: { hotelId, runId, date: dateOnly(input.date), method: input.method, treasuryAccountId: account.id, amount, count: entries.length, createdBy: currentActor() } });
    await tx.payrollEntry.updateMany({ where: { id: { in: entries.map((entry) => entry.id) } }, data: { paymentId: payment.id, paidAt: new Date() } });
    await tx.payrollRun.update({ where: { id: runId }, data: { paidTotal: toDecimal(String(run.paidTotal)).plus(amount).toFixed(2) } });
    await recordAudit(tx, { hotelId, entity: 'PayrollRun', entityId: runId, action: 'UPDATE', after: { payment: payment.id, date: input.date, method: input.method, account: account.name, amount, count: entries.length } });
    await stage('payroll.run.changed', { hotelId, runId, year: run.year, month: run.month, change: 'PAID' });
  }, { timeout: CALCULATE_TIMEOUT_MS });
  return getRun(hotelId, runId);
}

/**
 * Dosya çıktıları için satırlar (dosyayı ekran üretir): banka toplu ödeme listesi ya da müşavir aktarımı (MUHSGK /
 * aylık prim bildirgesi alanları).
 * @param {string} hotelId @param {string} runId @param {'BANK' | 'ACCOUNTANT'} kind
 */
export async function exportRows(hotelId, runId, kind) {
  const run = await prisma.payrollRun.findFirst({ where: { id: runId, hotelId }, select: { number: true, year: true, month: true, status: true } });
  if (!run) throw new NotFoundError('Bordro bulunamadı');
  const where = kind === 'BANK' ? { hotelId, runId, paymentMethod: 'BANK', payable: { gt: 0 } } : { hotelId, runId };
  const rows = await prisma.payrollEntry.findMany({ where, include: { employee: { select: { code: true, nationalId: true, firstName: true, lastName: true } } }, orderBy: [{ employeeName: 'asc' }, { id: 'asc' }], take: 20_000 });
  const description = `${periodLabel(run.year, run.month)} maaş`;
  if (kind === 'BANK') return { run: { number: run.number, status: run.status }, rows: rows.map((row) => ({ code: row.employee.code, name: row.employeeName, iban: row.iban, amount: money(row.payable), description })) };
  return {
    run: { number: run.number, status: run.status },
    rows: rows.map((row) => ({
      code: row.employee.code,
      nationalId: row.employee.nationalId,
      firstName: row.employee.firstName,
      lastName: row.employee.lastName,
      insuranceType: row.insuranceType,
      sgkDays: row.sgkDays,
      missingDays: row.missingDays,
      missingReason: row.missingReason,
      incentiveCode: row.incentiveCode,
      ...Object.fromEntries(MONEY_FIELDS.map((field) => [field, money(row[field])])),
      deductionTotal: money(row.deductionTotal),
      payable: money(row.payable),
    })),
  };
}
