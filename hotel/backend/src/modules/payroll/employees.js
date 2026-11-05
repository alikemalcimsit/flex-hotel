import { currentActor } from '@hotelos/core';
import { TERMINATION_REASONS, employeeFullName, maskIdNumber, payrollMonthBounds } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockEmployees } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { writeWithEvents } from '../../lib/write.js';
import { MONTH_DAYS, fromCents, noticePay, noticeWeeks, serviceLength, severancePay, solveMonth, toCents, unusedLeavePay } from './engine.js';
import {
  assertMonthOpen,
  dateOnly,
  day,
  ensureSystemElements,
  iso,
  markRunsStale,
  money,
  nextPayrollSequence,
  parameterSetFor,
  parameterSetOn,
  periodLabel,
  prisma,
  requireEmployee,
} from './shared.js';

/**
 * Personel kartı, departman, teşvik, matrah devri ve işten çıkış (modül 51).
 *
 * Ücret alanları (ücret türü / tutarı, ödeme yöntemi, IBAN, BES) yalnız `withPay` ile okunur ve yazılır; kimlik
 * numarası `withFullId` yoksa maskelidir. Kart değişikliği o aydan itibaren hesaplanmış açık bordroları "yeniden
 * hesaplanmalı" işaretler.
 */

const PAY_FIELDS = Object.freeze(['payBasis', 'salary', 'paymentMethod', 'iban', 'besEnrolled', 'besRate', 'besOptOutOn']);

const LIST_SELECT = Object.freeze({
  id: true,
  code: true,
  firstName: true,
  lastName: true,
  nationality: true,
  nationalId: true,
  position: true,
  hireDate: true,
  terminationDate: true,
  status: true,
  insuranceType: true,
  payBasis: true,
  salary: true,
  paymentMethod: true,
  userId: true,
  department: { select: { id: true, code: true, name: true } },
});

/** @param {any} row @param {{ withPay?: boolean, withFullId?: boolean }} options */
function present(row, { withPay = false, withFullId = false } = {}) {
  const out = {
    id: row.id,
    code: row.code,
    firstName: row.firstName,
    lastName: row.lastName,
    name: employeeFullName(row),
    nationality: row.nationality,
    nationalId: withFullId ? row.nationalId : maskIdNumber(row.nationalId),
    position: row.position,
    hireDate: day(row.hireDate),
    terminationDate: day(row.terminationDate),
    status: row.status,
    insuranceType: row.insuranceType,
    department: row.department,
    userId: row.userId ?? null,
  };
  if (withPay) Object.assign(out, { payBasis: row.payBasis, salary: money(row.salary), paymentMethod: row.paymentMethod });
  return out;
}

/* ═══════════════ Liste ve kart ═══════════════ */

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string, status?: string, departmentId?: string }} query
 * @param {{ withPay?: boolean, withFullId?: boolean }} options
 */
export async function listEmployees(hotelId, query, options = {}) {
  /** @type {any} */
  const where = { hotelId };
  if (query.status) where.status = query.status;
  if (query.departmentId) where.departmentId = query.departmentId;
  const terms = (query.search ?? '').split(/\s+/).filter(Boolean).slice(0, 4);
  if (terms.length > 0) {
    where.AND = terms.map((term) =>
      /^\d{6,}$/.test(term)
        ? { nationalId: term }
        : { OR: [{ firstName: { contains: term, mode: 'insensitive' } }, { lastName: { contains: term, mode: 'insensitive' } }, { code: { equals: term.toUpperCase() } }] },
    );
  }
  const [rows, total] = await prisma.$transaction([
    prisma.employee.findMany({ where, select: LIST_SELECT, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }], ...toSkipTake(query) }),
    prisma.employee.count({ where }),
  ]);
  return buildPage(rows.map((row) => present(row, options)), total, query);
}

/**
 * Kart: kimlik, iş, ücret (izinle), teşvikler, açık avans ve icra / nafaka, çıkış, matrah devirleri.
 * @param {string} hotelId @param {string} employeeId @param {{ withPay?: boolean, withFullId?: boolean }} options
 */
export async function getEmployee(hotelId, employeeId, options = {}) {
  const row = await prisma.employee.findFirst({
    where: { id: employeeId, hotelId },
    include: {
      department: { select: { id: true, code: true, name: true } },
      user: { select: { id: true, name: true, email: true } },
      incentives: { orderBy: { validFrom: 'desc' }, take: 20 },
      termination: true,
      openings: { orderBy: { year: 'desc' }, take: 5 },
    },
  });
  if (!row) throw new NotFoundError('Personel bulunamadı');
  const base = {
    ...present(row, options),
    birthDate: day(row.birthDate),
    phone: row.phone,
    email: row.email,
    address: row.address,
    disabilityDegree: row.disabilityDegree,
    serviceChargePoints: money(row.serviceChargePoints),
    notes: row.notes,
    user: row.user,
    updatedAt: iso(row.updatedAt),
    termination: row.termination
      ? {
          terminationDate: day(row.termination.terminationDate),
          reasonCode: row.termination.reasonCode,
          reasonLabel: TERMINATION_REASONS[row.termination.reasonCode]?.label ?? row.termination.reasonCode,
          severanceEligible: row.termination.severanceEligible,
          noticeMode: row.termination.noticeMode,
          noticeWeeks: row.termination.noticeWeeks,
          unusedLeaveDays: String(row.termination.unusedLeaveDays),
          service: { years: row.termination.serviceYears, months: row.termination.serviceMonths, days: row.termination.serviceDays },
          ...(options.withPay
            ? {
                severanceBase: money(row.termination.severanceBase),
                severanceCeiling: money(row.termination.severanceCeiling),
                severanceAmount: money(row.termination.severanceAmount),
                noticeAmount: money(row.termination.noticeAmount),
                leaveAmount: money(row.termination.leaveAmount),
              }
            : {}),
          overrideReason: row.termination.overrideReason,
        }
      : null,
  };
  if (!options.withPay) return base;
  const [advances, garnishments] = await Promise.all([
    prisma.employeeAdvance.findMany({ where: { hotelId, employeeId }, orderBy: { paidOn: 'desc' }, take: 20 }),
    prisma.garnishment.findMany({ where: { hotelId, employeeId }, orderBy: [{ status: 'asc' }, { notifiedOn: 'asc' }], take: 20 }),
  ]);
  return {
    ...base,
    iban: row.iban,
    besEnrolled: row.besEnrolled,
    besRate: row.besRate === null ? null : String(row.besRate),
    besOptOutOn: day(row.besOptOutOn),
    incentives: row.incentives.map((item) => ({ id: item.id, code: item.code, label: item.label, method: item.method, points: item.points === null ? null : String(item.points), amount: item.amount === null ? null : money(item.amount), validFrom: day(item.validFrom), validTo: day(item.validTo) })),
    openings: row.openings.map((item) => ({ id: item.id, year: item.year, gvCumulative: money(item.gvCumulative), minWageCumulative: money(item.minWageCumulative), note: item.note })),
    advances: advances.map((item) => ({ id: item.id, amount: money(item.amount), installments: item.installments, installmentAmount: money(item.installmentAmount), firstYear: item.firstYear, firstMonth: item.firstMonth, paidOn: day(item.paidOn), deducted: money(item.deducted), status: item.status, note: item.note })),
    garnishments: garnishments.map((item) => ({ id: item.id, type: item.type, fileNumber: item.fileNumber, authority: item.authority, creditor: item.creditor, notifiedOn: day(item.notifiedOn), totalAmount: item.totalAmount === null ? null : money(item.totalAmount), monthlyAmount: item.monthlyAmount === null ? null : money(item.monthlyAmount), rate: item.rate === null ? null : String(item.rate), deducted: money(item.deducted), status: item.status, note: item.note })),
  };
}

/* ═══════════════ Ekle / düzenle / sil ═══════════════ */

/** Yazılacak alanlar (ücret alanları yalnız izinle). @param {any} input @param {boolean} withPay */
function writableFields(input, withPay) {
  const data = {
    firstName: input.firstName,
    lastName: input.lastName,
    nationality: input.nationality,
    nationalId: input.nationalId,
    birthDate: input.birthDate ? dateOnly(input.birthDate) : null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    address: input.address ?? null,
    departmentId: input.departmentId,
    position: input.position,
    hireDate: dateOnly(input.hireDate),
    insuranceType: input.insuranceType,
    disabilityDegree: input.disabilityDegree ?? null,
    serviceChargePoints: input.serviceChargePoints ?? '0',
    userId: input.userId ?? null,
    notes: input.notes ?? null,
  };
  if (withPay) {
    if (input.payBasis !== undefined) data.payBasis = input.payBasis;
    if (input.salary !== undefined) data.salary = input.salary;
    if (input.paymentMethod !== undefined) data.paymentMethod = input.paymentMethod;
    if (input.iban !== undefined) data.iban = input.iban;
    if (input.besEnrolled !== undefined) data.besEnrolled = input.besEnrolled;
    if (input.besRate !== undefined) data.besRate = input.besRate;
    if (input.besOptOutOn !== undefined) data.besOptOutOn = input.besOptOutOn ? dateOnly(input.besOptOutOn) : null;
  }
  return data;
}

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {any} input */
async function assertReferences(tx, hotelId, input) {
  const department = await tx.department.findFirst({ where: { id: input.departmentId, hotelId }, select: { isActive: true } });
  if (!department) throw new ValidationError('Departman bulunamadı', { fields: { departmentId: 'Departman seçin' } });
  if (input.userId) {
    const user = await tx.user.findFirst({ where: { id: input.userId, hotelId }, select: { id: true } });
    if (!user) throw new ValidationError('Kullanıcı bulunamadı', { fields: { userId: 'Kullanıcı bu otelde değil' } });
  }
}

/** Denetim izine yazılacak özet (ücret ve IBAN maskeli değil ama kimlik maskeli). @param {any} row */
const auditView = (row) => ({ code: row.code, name: employeeFullName(row), nationalId: maskIdNumber(row.nationalId), departmentId: row.departmentId, position: row.position, hireDate: day(row.hireDate), insuranceType: row.insuranceType, payBasis: row.payBasis, salary: money(row.salary), paymentMethod: row.paymentMethod, besEnrolled: row.besEnrolled });

/** @param {string} hotelId @param {any} input @param {{ withPay?: boolean }} options */
export async function createEmployee(hotelId, input, { withPay = false } = {}) {
  try {
    const id = await writeWithEvents(async (tx, stage) => {
      await assertReferences(tx, hotelId, input);
      const code = `P-${String(await nextPayrollSequence(tx, hotelId, 'EMPLOYEE')).padStart(4, '0')}`;
      const created = await tx.employee.create({ data: { hotelId, code, createdBy: currentActor(), ...writableFields(input, withPay) } });
      await recordAudit(tx, { hotelId, entity: 'Employee', entityId: created.id, action: 'CREATE', after: auditView(created) });
      await stage('employee.changed', { hotelId, employeeId: created.id, change: 'CREATED' });
      return created.id;
    });
    return getEmployee(hotelId, id, { withPay, withFullId: true });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kimlik numarasıyla çalışan (çıkışı yapılmamış) bir personel var' });
  }
}

/** @param {string} hotelId @param {string} employeeId @param {any} input @param {{ withPay?: boolean }} options */
export async function updateEmployee(hotelId, employeeId, input, { withPay = false } = {}) {
  try {
    await writeWithEvents(async (tx, stage) => {
      await lockEmployees(tx, hotelId, [employeeId]);
      const before = await tx.employee.findFirst({ where: { id: employeeId, hotelId } });
      if (!before) throw new NotFoundError('Personel bulunamadı');
      if (before.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) throw new StaleWriteError('Kart bu arada değişti; yenileyip tekrar deneyin');
      await assertReferences(tx, hotelId, input);
      if (day(before.hireDate) !== input.hireDate) {
        const approved = await tx.payrollEntry.findFirst({ where: { hotelId, employeeId, run: { status: 'APPROVED' } }, select: { id: true } });
        if (approved) throw new ConflictError('Onaylı bordrosu olan personelin işe giriş tarihi değişmez', 'EMPLOYEE_HIRE_DATE_LOCKED');
        if (before.terminationDate && input.hireDate > day(before.terminationDate)) throw new ValidationError('İşe giriş çıkıştan sonra olamaz');
      }
      const after = await tx.employee.update({ where: { id: employeeId }, data: writableFields(input, withPay) });
      await recordAudit(tx, { hotelId, entity: 'Employee', entityId: employeeId, action: 'UPDATE', before: auditView(before), after: auditView(after) });
      const from = new Date(Math.min(before.hireDate.getTime(), after.hireDate.getTime()));
      await markRunsStale(tx, hotelId, { fromYear: from.getUTCFullYear(), fromMonth: from.getUTCMonth() + 1 });
      await stage('employee.changed', { hotelId, employeeId, change: 'UPDATED' });
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kimlik numarasıyla çalışan (çıkışı yapılmamış) bir personel var' });
  }
  return getEmployee(hotelId, employeeId, { withPay, withFullId: true });
}

/**
 * Yalnız hiç bordroya, avansa, icraya, kaleme girmemiş kart silinir (yanlış açılmış kart); diğerinin çıkışı yapılır.
 * @param {string} hotelId @param {string} employeeId
 */
export async function deleteEmployee(hotelId, employeeId) {
  await writeWithEvents(async (tx, stage) => {
    await lockEmployees(tx, hotelId, [employeeId]);
    const row = await tx.employee.findFirst({ where: { id: employeeId, hotelId }, select: { id: true, code: true, firstName: true, lastName: true, nationalId: true, _count: { select: { entries: true, advances: true, garnishments: true, items: true } } } });
    if (!row) throw new NotFoundError('Personel bulunamadı');
    const used = row._count.entries + row._count.advances + row._count.garnishments + row._count.items;
    const ledger = await tx.ledgerAccount.findFirst({ where: { hotelId, employeeId }, select: { id: true } });
    if (used > 0 || ledger) throw new ConflictError('Bordrosu, avansı, kesintisi ya da carisi olan personel silinmez; işten çıkışını yapın', 'EMPLOYEE_IN_USE');
    await tx.employee.delete({ where: { id: employeeId } });
    await recordAudit(tx, { hotelId, entity: 'Employee', entityId: employeeId, action: 'DELETE', before: { code: row.code, name: employeeFullName(row), nationalId: maskIdNumber(row.nationalId) } });
    await stage('employee.changed', { hotelId, employeeId, change: 'DELETED' });
  });
  return { deleted: true };
}

/* ═══════════════ Departman ═══════════════ */

/** @param {string} hotelId */
export async function listDepartments(hotelId) {
  const rows = await prisma.department.findMany({ where: { hotelId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }], take: 200, include: { _count: { select: { employees: true } } } });
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, isActive: row.isActive, employeeCount: row._count.employees }));
}

/** @param {string} hotelId @param {any} input @param {string | null} departmentId */
export async function saveDepartment(hotelId, input, departmentId = null) {
  try {
    await writeWithEvents(async (tx, stage) => {
      if (departmentId) {
        const before = await tx.department.findFirst({ where: { id: departmentId, hotelId } });
        if (!before) throw new NotFoundError('Departman bulunamadı');
        await tx.department.update({ where: { id: departmentId }, data: input });
        await recordAudit(tx, { hotelId, entity: 'Department', entityId: departmentId, action: 'UPDATE', before: { code: before.code, name: before.name, isActive: before.isActive }, after: input });
      } else {
        const created = await tx.department.create({ data: { hotelId, ...input } });
        await recordAudit(tx, { hotelId, entity: 'Department', entityId: created.id, action: 'CREATE', after: input });
      }
      await stage('payroll.settings.changed', { hotelId, area: 'DEPARTMENT' });
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu departman kodu kullanılıyor' });
  }
  return listDepartments(hotelId);
}

/* ═══════════════ Teşvik ve matrah devri ═══════════════ */

/** @param {string} hotelId @param {string} employeeId @param {any} input */
export async function addIncentive(hotelId, employeeId, input) {
  await writeWithEvents(async (tx, stage) => {
    await requireEmployee(tx, hotelId, employeeId);
    const overlap = await tx.employeeIncentive.findFirst({
      where: { employeeId, validFrom: { lte: dateOnly(input.validTo ?? '9999-12-31') }, OR: [{ validTo: null }, { validTo: { gte: dateOnly(input.validFrom) } }] },
      select: { code: true },
    });
    if (overlap) throw new ConflictError(`Bu tarihlerde ${overlap.code} teşviki var; bir ayda tek teşvik uygulanır`, 'INCENTIVE_OVERLAP');
    const created = await tx.employeeIncentive.create({
      data: { hotelId, employeeId, code: input.code, label: input.label, method: input.method, points: input.points ?? null, amount: input.amount ?? null, validFrom: dateOnly(input.validFrom), validTo: input.validTo ? dateOnly(input.validTo) : null, createdBy: currentActor() },
    });
    await recordAudit(tx, { hotelId, entity: 'EmployeeIncentive', entityId: created.id, action: 'CREATE', after: { employeeId, ...input } });
    const from = new Date(`${input.validFrom}T00:00:00Z`);
    await markRunsStale(tx, hotelId, { fromYear: from.getUTCFullYear(), fromMonth: from.getUTCMonth() + 1 });
    await stage('payroll.settings.changed', { hotelId, area: 'INCENTIVE' });
  });
  return getEmployee(hotelId, employeeId, { withPay: true, withFullId: true });
}

/** @param {string} hotelId @param {string} employeeId @param {string} incentiveId */
export async function removeIncentive(hotelId, employeeId, incentiveId) {
  await writeWithEvents(async (tx, stage) => {
    const row = await tx.employeeIncentive.findFirst({ where: { id: incentiveId, employeeId, hotelId } });
    if (!row) throw new NotFoundError('Teşvik bulunamadı');
    const used = await tx.payrollEntry.findFirst({ where: { hotelId, employeeId, incentiveCode: row.code, run: { status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } }, select: { id: true } });
    if (used) throw new ConflictError('Onaylı / onaydaki bordroda uygulanmış teşvik silinmez; bitiş tarihi verin', 'INCENTIVE_IN_USE');
    await tx.employeeIncentive.delete({ where: { id: incentiveId } });
    await recordAudit(tx, { hotelId, entity: 'EmployeeIncentive', entityId: incentiveId, action: 'DELETE', before: { employeeId, code: row.code, validFrom: day(row.validFrom) } });
    await markRunsStale(tx, hotelId, { fromYear: row.validFrom.getUTCFullYear(), fromMonth: row.validFrom.getUTCMonth() + 1 });
    await stage('payroll.settings.changed', { hotelId, area: 'INCENTIVE' });
  });
  return getEmployee(hotelId, employeeId, { withPay: true, withFullId: true });
}

/**
 * Yıl içi matrah devri (sisteme yıl ortasında geçiş): o yılın ilk bordrosu onaylanmadan girilir.
 * @param {string} hotelId @param {any} input
 */
export async function saveOpening(hotelId, input) {
  await writeWithEvents(async (tx, stage) => {
    await requireEmployee(tx, hotelId, input.employeeId);
    const approved = await tx.payrollEntry.findFirst({ where: { hotelId, employeeId: input.employeeId, run: { year: input.year, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } }, select: { id: true } });
    if (approved) throw new ConflictError(`${input.year} yılında onaylı / onaydaki bordrosu olan personelin devri değişmez`, 'OPENING_LOCKED');
    await tx.payrollOpening.upsert({
      where: { employeeId_year: { employeeId: input.employeeId, year: input.year } },
      create: { hotelId, employeeId: input.employeeId, year: input.year, gvCumulative: input.gvCumulative, minWageCumulative: input.minWageCumulative, note: input.note ?? null, createdBy: currentActor() },
      update: { gvCumulative: input.gvCumulative, minWageCumulative: input.minWageCumulative, note: input.note ?? null },
    });
    await recordAudit(tx, { hotelId, entity: 'PayrollOpening', entityId: input.employeeId, action: 'UPDATE', after: input });
    await markRunsStale(tx, hotelId, { fromYear: input.year, fromMonth: 1 });
    await stage('payroll.settings.changed', { hotelId, area: 'OPENING' });
  });
  return getEmployee(hotelId, input.employeeId, { withPay: true, withFullId: true });
}

/* ═══════════════ İşten çıkış ═══════════════ */

/**
 * Netten ücretlinin brüt karşılığı (çıkış ayının parametreleriyle, yıl başı varsayımıyla): kıdem / ihbar / izin
 * hesabının varsayılan dayanağı. Ekran "giydirilmiş brüt"ü (yemek, yol, düzenli prim dahil) ayrıca girebilir.
 * @param {any} employee @param {any} params
 */
function grossEquivalent(employee, params) {
  const salary = toCents(employee.salary);
  if (employee.payBasis === 'GROSS') return salary;
  const { earnings } = solveMonth({ params, insurance: employee.insuranceType, sgkDays: MONTH_DAYS, workedDays: MONTH_DAYS, gvBefore: 0, minWageBefore: 0, earnings: [{ key: 'BASE_SALARY', netTarget: salary, sgk: true, gv: true, dv: true }] });
  return earnings[0].amount;
}

/**
 * Çıkış haklarını hesaplar (kaydetmeden): ekran önizler, `terminateEmployee` aynı hesabı yazar.
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId @param {any} employee @param {any} input
 */
async function computeTermination(client, hotelId, employee, input) {
  const hireDate = day(employee.hireDate);
  if (input.terminationDate < hireDate) throw new ValidationError('Çıkış işe girişten önce olamaz', { fields: { terminationDate: 'İşe giriş gününden önce' } });
  const year = Number(input.terminationDate.slice(0, 4));
  const month = Number(input.terminationDate.slice(5, 7));
  const [monthSet, daySet] = await Promise.all([parameterSetFor(client, hotelId, year, month), parameterSetOn(client, hotelId, input.terminationDate)]);
  if (!monthSet || !daySet) throw new ValidationError(`${periodLabel(year, month)} için yasal parametre seti yok: Bordro → Ayarlar → Yasal parametreler`, { code: 'PAYROLL_PARAMETERS_MISSING' });
  const service = serviceLength(hireDate, input.terminationDate);
  const grossSalary = grossEquivalent(employee, monthSet.values);
  const base = input.severanceBase ? toCents(input.severanceBase) : grossSalary;
  const ceiling = toCents(daySet.values.severanceCeiling);
  const severance = input.severanceEligible ? severancePay({ monthlyBase: base, ceiling, ...service }) : { base: Math.min(base, ceiling), amount: 0, eligibleByService: service.years >= 1 };
  const weeks = noticeWeeks(service);
  const notice = input.noticeMode === 'NONE' ? 0 : noticePay(base, weeks);
  const leave = unusedLeavePay(grossSalary, input.unusedLeaveDays ?? '0');
  return { year, month, service, weeks, base, ceiling, severance, notice, leave, grossSalary };
}

/** @param {string} hotelId @param {string} employeeId @param {any} input */
export async function previewTermination(hotelId, employeeId, input) {
  const employee = await requireEmployee(prisma, hotelId, employeeId, { id: true, hireDate: true, salary: true, payBasis: true, insuranceType: true, status: true });
  const result = await computeTermination(prisma, hotelId, employee, input);
  return {
    service: result.service,
    noticeWeeks: result.weeks,
    grossSalary: fromCents(result.grossSalary),
    severanceBase: fromCents(result.severance.base),
    severanceCeiling: fromCents(result.ceiling),
    severanceAmount: fromCents(result.severance.amount),
    severanceEligibleByService: result.severance.eligibleByService,
    noticeAmount: fromCents(result.notice),
    noticeMode: input.noticeMode,
    leaveAmount: fromCents(result.leave),
  };
}

/**
 * İşten çıkış: kart kapanır, haklar çıkış ayının kalemlerine yazılır (kıdem, ihbar ödemesi ya da kesintisi, izin).
 * Ayın bordrosu onaydaysa / onaylıysa yapılmaz.
 * @param {string} hotelId @param {string} employeeId @param {any} input
 */
export async function terminateEmployee(hotelId, employeeId, input) {
  await writeWithEvents(async (tx, stage) => {
    await lockEmployees(tx, hotelId, [employeeId]);
    const employee = await requireEmployee(tx, hotelId, employeeId, { id: true, hireDate: true, salary: true, payBasis: true, insuranceType: true, status: true, terminationDate: true, firstName: true, lastName: true });
    if (employee.status === 'TERMINATED') throw new ConflictError('Bu personelin çıkışı zaten yapılmış', 'EMPLOYEE_TERMINATED');
    const result = await computeTermination(tx, hotelId, employee, input);
    await assertMonthOpen(tx, hotelId, result.year, result.month);
    const later = await tx.payrollEntry.findFirst({ where: { hotelId, employeeId, run: { status: 'APPROVED', OR: [{ year: { gt: result.year } }, { year: result.year, month: { gt: result.month } }] } }, select: { id: true } });
    if (later) throw new ConflictError('Çıkış tarihinden sonraki bir ayın onaylı bordrosu var; çıkış o aydan önce olamaz', 'TERMINATION_AFTER_APPROVED');
    const actor = currentActor();
    const termination = await tx.employeeTermination.create({
      data: {
        hotelId,
        employeeId,
        terminationDate: dateOnly(input.terminationDate),
        reasonCode: input.reasonCode,
        severanceEligible: input.severanceEligible,
        noticeMode: input.noticeMode,
        noticeWeeks: result.weeks,
        unusedLeaveDays: input.unusedLeaveDays ?? '0',
        severanceBase: fromCents(result.severance.base),
        severanceCeiling: fromCents(result.ceiling),
        serviceYears: result.service.years,
        serviceMonths: result.service.months,
        serviceDays: result.service.days,
        severanceAmount: fromCents(result.severance.amount),
        noticeAmount: fromCents(result.notice),
        leaveAmount: fromCents(result.leave),
        overrideReason: input.overrideReason ?? null,
        createdBy: actor,
      },
    });
    await ensureSystemElements(tx, hotelId);
    const elements = await tx.payElement.findMany({ where: { hotelId, code: { in: ['SEVERANCE_PAY', 'NOTICE_PAY', 'NOTICE_DEDUCTION', 'UNUSED_LEAVE'] } }, select: { id: true, code: true } });
    const elementId = (code) => elements.find((element) => element.code === code).id;
    const items = [
      result.severance.amount > 0 ? { code: 'SEVERANCE_PAY', amount: result.severance.amount } : null,
      result.notice > 0 ? { code: input.noticeMode === 'EMPLOYEE_PAYS' ? 'NOTICE_DEDUCTION' : 'NOTICE_PAY', amount: result.notice } : null,
      result.leave > 0 ? { code: 'UNUSED_LEAVE', amount: result.leave } : null,
    ].filter(Boolean);
    if (items.length > 0) {
      await tx.payrollItem.createMany({
        data: items.map((item) => ({ hotelId, employeeId, year: result.year, month: result.month, elementId: elementId(item.code), amount: fromCents(item.amount), source: 'TERMINATION', sourceId: termination.id, createdBy: actor })),
      });
    }
    await tx.employee.update({ where: { id: employeeId }, data: { status: 'TERMINATED', terminationDate: dateOnly(input.terminationDate) } });
    await recordAudit(tx, {
      hotelId,
      entity: 'Employee',
      entityId: employeeId,
      action: 'UPDATE',
      before: { status: employee.status, terminationDate: null },
      after: { status: 'TERMINATED', terminationDate: input.terminationDate, reasonCode: input.reasonCode, severanceEligible: input.severanceEligible, noticeMode: input.noticeMode, severance: fromCents(result.severance.amount), notice: fromCents(result.notice), leave: fromCents(result.leave), overrideReason: input.overrideReason ?? null },
    });
    await markRunsStale(tx, hotelId, { fromYear: result.year, fromMonth: result.month });
    await stage('employee.changed', { hotelId, employeeId, change: 'TERMINATED' });
  });
  return getEmployee(hotelId, employeeId, { withPay: true, withFullId: true });
}

/**
 * Çıkışı geri alır (yanlış girildiyse): haklar silinir, kart yeniden çalışıyor olur. Çıkış ayının bordrosu
 * onaydaysa / onaylıysa yapılmaz.
 * @param {string} hotelId @param {string} employeeId
 */
export async function reinstateEmployee(hotelId, employeeId) {
  try {
    await writeWithEvents(async (tx, stage) => {
      await lockEmployees(tx, hotelId, [employeeId]);
      const termination = await tx.employeeTermination.findFirst({ where: { employeeId, hotelId } });
      if (!termination) throw new ConflictError('Bu personelin çıkışı yok', 'EMPLOYEE_NOT_TERMINATED');
      const year = termination.terminationDate.getUTCFullYear();
      const month = termination.terminationDate.getUTCMonth() + 1;
      await assertMonthOpen(tx, hotelId, year, month);
      await tx.payrollItem.deleteMany({ where: { hotelId, source: 'TERMINATION', sourceId: termination.id } });
      await tx.employeeTermination.delete({ where: { id: termination.id } });
      await tx.employee.update({ where: { id: employeeId }, data: { status: 'ACTIVE', terminationDate: null } });
      await recordAudit(tx, { hotelId, entity: 'Employee', entityId: employeeId, action: 'UPDATE', before: { status: 'TERMINATED', terminationDate: day(termination.terminationDate) }, after: { status: 'ACTIVE', terminationDate: null } });
      await markRunsStale(tx, hotelId, { fromYear: year, fromMonth: month });
      await stage('employee.changed', { hotelId, employeeId, change: 'REINSTATED' });
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kimlik numarasıyla çalışan başka bir kayıt var; önce onun çıkışını yapın' });
  }
  return getEmployee(hotelId, employeeId, { withPay: true, withFullId: true });
}

/**
 * Bir ayda bordroya girecek personel (işe giriş ≤ ay sonu, çıkış yok ya da ≥ ay başı).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId @param {number} year @param {number} month
 */
export function employeesInMonth(client, hotelId, year, month, select) {
  const { first, last } = payrollMonthBounds(year, month);
  return client.employee.findMany({
    where: { hotelId, hireDate: { lte: dateOnly(last) }, OR: [{ terminationDate: null }, { terminationDate: { gte: dateOnly(first) } }] },
    select,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
  });
}
