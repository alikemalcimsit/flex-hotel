import { Decimal, currentActor, toDecimal } from '@hotelos/core';
import { DEFAULT_GARNISHMENT_RATE, MISSING_DAY_REASONS, employeeFullName, payrollMonthBounds } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { lockEmployees, lockPayrollRuns } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { writeWithEvents } from '../../lib/write.js';
import { assertCashCovers, reverseRecords } from '../accounting/shared.js';
import { employmentDays, fromCents, toCents } from './engine.js';
import { postAdvance } from './postings.js';
import { assertMonthOpen, dateOnly, day, ensureSystemElements, markRunsStale, money, periodLabel, prisma, requireEmployee } from './shared.js';

/**
 * Bordronun aylık girdileri (modül 51): puantaj, ek ödeme / kesinti kalemleri, servis payı dağıtımı, avans ve
 * icra / nafaka. Onaydaki / onaylı ayın girdisi değişmez (fark bordrosu); değişiklik ayın hesaplanmış bordrosunu
 * "yeniden hesaplanmalı" işaretler.
 */

/** Ayın personel filtresi (giriş ≤ ay sonu, çıkış yok ya da ≥ ay başı) + arama / departman. */
function monthWhere(hotelId, { year, month, search, departmentId }) {
  const { first, last } = payrollMonthBounds(year, month);
  /** @type {any} */
  const where = { hotelId, hireDate: { lte: dateOnly(last) }, OR: [{ terminationDate: null }, { terminationDate: { gte: dateOnly(first) } }] };
  if (departmentId) where.departmentId = departmentId;
  const terms = (search ?? '').split(/\s+/).filter(Boolean).slice(0, 4);
  if (terms.length) where.AND = terms.map((term) => ({ OR: [{ firstName: { contains: term, mode: 'insensitive' } }, { lastName: { contains: term, mode: 'insensitive' } }, { code: { equals: term.toUpperCase() } }] }));
  return where;
}

/* ═══════════════ Puantaj ═══════════════ */

/**
 * Ayın puantaj tablosu: personel × (ücretli gün, eksik gün + neden, çalışılan gün, fazla çalışma, bayram, hafta tatili).
 * @param {string} hotelId @param {{ year: number, month: number, page: number, pageSize: number, search?: string, departmentId?: string }} query
 */
export async function listAttendance(hotelId, query) {
  const where = monthWhere(hotelId, query);
  const [employees, total] = await prisma.$transaction([
    prisma.employee.findMany({ where, select: { id: true, code: true, firstName: true, lastName: true, hireDate: true, terminationDate: true, department: { select: { name: true } } }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }], ...toSkipTake(query) }),
    prisma.employee.count({ where }),
  ]);
  const rows = await prisma.payrollAttendance.findMany({ where: { hotelId, year: query.year, month: query.month, employeeId: { in: employees.map((row) => row.id) } } });
  const byEmployee = new Map(rows.map((row) => [row.employeeId, row]));
  const items = employees.map((employee) => {
    const row = byEmployee.get(employee.id);
    const paidDays = employmentDays({ year: query.year, month: query.month, hireDate: day(employee.hireDate), terminationDate: day(employee.terminationDate) });
    return {
      employeeId: employee.id,
      code: employee.code,
      name: employeeFullName(employee),
      department: employee.department.name,
      employmentDays: paidDays,
      missingDays: row?.missingDays ?? 0,
      missingReason: row?.missingReason ?? null,
      missingReasonLabel: row?.missingReason ? MISSING_DAY_REASONS[row.missingReason] ?? row.missingReason : null,
      workedDays: row?.workedDays ?? null,
      overtimeHours: row ? String(row.overtimeHours) : '0',
      holidayDays: row ? String(row.holidayDays) : '0',
      weeklyRestDays: row ? String(row.weeklyRestDays) : '0',
      source: row?.source ?? null,
      note: row?.note ?? null,
    };
  });
  return buildPage(items, total, query);
}

/**
 * Puantaj satırlarını yazar (en fazla 200). Eksik gün ücretli günü, çalışılan gün kalan ücretli günü aşamaz.
 * @param {string} hotelId @param {number} year @param {number} month @param {any[]} rows
 */
export async function saveAttendance(hotelId, year, month, rows) {
  const ids = [...new Set(rows.map((row) => row.employeeId))];
  if (ids.length !== rows.length) throw new ValidationError('Aynı personel iki kez girilmiş');
  await writeWithEvents(async (tx, stage) => {
    await assertMonthOpen(tx, hotelId, year, month);
    const employees = await tx.employee.findMany({ where: { hotelId, id: { in: ids } }, select: { id: true, firstName: true, lastName: true, hireDate: true, terminationDate: true } });
    const byId = new Map(employees.map((row) => [row.id, row]));
    const actor = currentActor();
    for (const row of rows) {
      const employee = byId.get(row.employeeId);
      if (!employee) throw new NotFoundError('Personel bulunamadı');
      const paidDays = employmentDays({ year, month, hireDate: day(employee.hireDate), terminationDate: day(employee.terminationDate) });
      if (paidDays === 0) throw new ValidationError(`${employeeFullName(employee)} ${periodLabel(year, month)} döneminde çalışmıyor`);
      if (row.missingDays > paidDays) throw new ValidationError(`${employeeFullName(employee)}: eksik gün ücretli günü (${paidDays}) aşamaz`);
      if (row.workedDays !== null && row.workedDays !== undefined && row.workedDays > paidDays - row.missingDays) throw new ValidationError(`${employeeFullName(employee)}: çalışılan gün en fazla ${paidDays - row.missingDays}`);
      const data = { missingDays: row.missingDays, missingReason: row.missingDays > 0 ? row.missingReason : null, workedDays: row.workedDays ?? null, overtimeHours: row.overtimeHours, holidayDays: row.holidayDays, weeklyRestDays: row.weeklyRestDays, note: row.note ?? null, source: 'MANUAL', updatedBy: actor };
      await tx.payrollAttendance.upsert({ where: { employeeId_year_month: { employeeId: row.employeeId, year, month } }, create: { hotelId, employeeId: row.employeeId, year, month, ...data }, update: data });
    }
    await recordAudit(tx, { hotelId, entity: 'PayrollAttendance', entityId: `${year}-${String(month).padStart(2, '0')}`, action: 'UPDATE', after: { year, month, employees: rows.length } });
    await markRunsStale(tx, hotelId, { year, month });
    await stage('payroll.settings.changed', { hotelId, area: 'ATTENDANCE' });
  });
  return { saved: rows.length };
}

/* ═══════════════ Ek ödeme / kesinti ═══════════════ */

/**
 * Ayın kalemleri (aylık bordroya ya da bir fark bordrosuna).
 * @param {string} hotelId @param {{ year: number, month: number, page: number, pageSize: number, runId?: string, search?: string }} query
 */
export async function listItems(hotelId, query) {
  /** @type {any} */
  const where = { hotelId, year: query.year, month: query.month, runId: query.runId ?? null };
  if (query.search) where.employee = { OR: [{ firstName: { contains: query.search, mode: 'insensitive' } }, { lastName: { contains: query.search, mode: 'insensitive' } }] };
  const [rows, total] = await prisma.$transaction([
    prisma.payrollItem.findMany({ where, include: { employee: { select: { code: true, firstName: true, lastName: true } }, element: { select: { code: true, name: true, kind: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...toSkipTake(query) }),
    prisma.payrollItem.count({ where }),
  ]);
  return buildPage(
    rows.map((row) => ({ id: row.id, employeeId: row.employeeId, employee: `${row.employee.code} · ${employeeFullName(row.employee)}`, element: row.element, amount: money(row.amount), isNet: row.isNet, source: row.source, note: row.note, createdBy: row.createdBy, createdAt: row.createdAt.toISOString() })),
    total,
    query,
  );
}

/**
 * Kalemin gideceği bordro düzenlenebilir mi: fark bordrosu için o bordro (aynı ay, taslak / hesaplanmış); aylık için ay açık.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {{ year: number, month: number, runId?: string | null }} input
 */
async function assertItemTarget(tx, hotelId, input) {
  if (!input.runId) return assertMonthOpen(tx, hotelId, input.year, input.month);
  await lockPayrollRuns(tx, hotelId, [input.runId]);
  const run = await tx.payrollRun.findFirst({ where: { id: input.runId, hotelId }, select: { kind: true, year: true, month: true, status: true } });
  if (!run || run.kind !== 'SUPPLEMENTARY' || run.year !== input.year || run.month !== input.month) throw new ValidationError('Kalem bu ayın fark bordrosuna eklenebilir');
  if (run.status !== 'DRAFT' && run.status !== 'CALCULATED') throw new ConflictError('Fark bordrosu onayda ya da onaylı; kalem değişmez', 'PAYROLL_RUN_LOCKED');
}

/** @param {string} hotelId @param {any} input */
export async function createItem(hotelId, input) {
  await writeWithEvents(async (tx, stage) => {
    await assertItemTarget(tx, hotelId, input);
    const employee = await requireEmployee(tx, hotelId, input.employeeId);
    if (employmentDays({ year: input.year, month: input.month, hireDate: day(employee.hireDate), terminationDate: day(employee.terminationDate) }) === 0) {
      throw new ValidationError(`${employeeFullName(employee)} ${periodLabel(input.year, input.month)} döneminde çalışmıyor`);
    }
    await ensureSystemElements(tx, hotelId);
    const element = await tx.payElement.findFirst({ where: { id: input.elementId, hotelId }, select: { code: true, name: true, kind: true, isActive: true, system: true } });
    if (!element?.isActive) throw new ValidationError('Kalem bulunamadı ya da kullanımda değil');
    const manualSystem = ['BONUS', 'MEAL', 'TRANSPORT', 'RETRO_PAY', 'OTHER_EARNING', 'OTHER_DEDUCTION'];
    if (element.system && !manualSystem.includes(element.code)) throw new ValidationError(`${element.name} elle girilmez (ücret, puantaj, çıkış ya da servis payından gelir)`);
    if (element.kind === 'DEDUCTION' && input.isNet === false) input.isNet = true; // kesinti hep netten
    const created = await tx.payrollItem.create({ data: { hotelId, employeeId: input.employeeId, year: input.year, month: input.month, runId: input.runId ?? null, elementId: input.elementId, amount: input.amount, isNet: input.isNet, note: input.note ?? null, createdBy: currentActor() } });
    await recordAudit(tx, { hotelId, entity: 'PayrollItem', entityId: created.id, action: 'CREATE', after: { employeeId: input.employeeId, element: element.code, amount: input.amount, isNet: input.isNet, year: input.year, month: input.month, runId: input.runId ?? null } });
    if (input.runId) await tx.payrollRun.update({ where: { id: input.runId }, data: { stale: true } });
    else await markRunsStale(tx, hotelId, { year: input.year, month: input.month });
    await stage('payroll.settings.changed', { hotelId, area: 'ITEM' });
  });
  return { created: true };
}

/** Elle girilmiş kalemi siler (çıkış ve servis payı kalemleri kendi akışlarından). @param {string} hotelId @param {string} itemId */
export async function deleteItem(hotelId, itemId) {
  await writeWithEvents(async (tx, stage) => {
    const item = await tx.payrollItem.findFirst({ where: { id: itemId, hotelId } });
    if (!item) throw new NotFoundError('Kalem bulunamadı');
    if (item.source !== 'MANUAL') throw new ConflictError(item.source === 'TERMINATION' ? 'Çıkış kalemi çıkış geri alınarak silinir' : 'Servis payı kalemi dağıtım geri alınarak silinir', 'PAYROLL_ITEM_SOURCE');
    await assertItemTarget(tx, hotelId, item);
    await tx.payrollItem.delete({ where: { id: itemId } });
    await recordAudit(tx, { hotelId, entity: 'PayrollItem', entityId: itemId, action: 'DELETE', before: { employeeId: item.employeeId, amount: money(item.amount), year: item.year, month: item.month } });
    if (item.runId) await tx.payrollRun.update({ where: { id: item.runId }, data: { stale: true } });
    else await markRunsStale(tx, hotelId, { year: item.year, month: item.month });
    await stage('payroll.settings.changed', { hotelId, area: 'ITEM' });
  });
  return { deleted: true };
}

/* ═══════════════ Servis payı ═══════════════ */

/** @param {string} hotelId @param {number} year @param {number} month */
export async function getServiceCharge(hotelId, year, month) {
  const pool = await prisma.serviceChargePool.findFirst({ where: { hotelId, year, month } });
  if (!pool) return null;
  const shares = await prisma.payrollItem.findMany({ where: { hotelId, source: 'SERVICE_CHARGE', sourceId: pool.id }, include: { employee: { select: { code: true, firstName: true, lastName: true } } }, orderBy: { amount: 'desc' }, take: 500 });
  return {
    id: pool.id,
    year,
    month,
    amount: money(pool.amount),
    method: pool.method,
    daysWeighted: pool.daysWeighted,
    departmentIds: pool.departmentIds,
    status: pool.status,
    distributedAt: pool.distributedAt?.toISOString() ?? null,
    note: pool.note,
    shares: shares.map((row) => ({ employeeId: row.employeeId, employee: `${row.employee.code} · ${employeeFullName(row.employee)}`, amount: money(row.amount) })),
  };
}

/**
 * Havuzu kaydeder ve dağıtır: ağırlık = (puan usulünde personelin puanı, eşitte 1) × (gün ağırlıklıysa ücretli
 * gün − eksik gün). Kuruş artığı en büyük ağırlıktan başlayarak dağıtılır (toplam havuza kuruşu kuruşuna eşit).
 * Önceki dağıtım silinip yeniden yazılır.
 * @param {string} hotelId @param {any} input
 */
export async function distributeServiceCharge(hotelId, input) {
  await writeWithEvents(async (tx, stage) => {
    await assertMonthOpen(tx, hotelId, input.year, input.month);
    const { first, last } = payrollMonthBounds(input.year, input.month);
    const employees = await tx.employee.findMany({
      where: { hotelId, hireDate: { lte: dateOnly(last) }, OR: [{ terminationDate: null }, { terminationDate: { gte: dateOnly(first) } }], ...(input.departmentIds.length ? { departmentId: { in: input.departmentIds } } : {}) },
      select: { id: true, hireDate: true, terminationDate: true, serviceChargePoints: true },
      orderBy: { id: 'asc' },
    });
    const attendance = new Map((await tx.payrollAttendance.findMany({ where: { hotelId, year: input.year, month: input.month }, select: { employeeId: true, missingDays: true } })).map((row) => [row.employeeId, row.missingDays]));
    const weights = employees
      .map((employee) => {
        const days = Math.max(0, employmentDays({ year: input.year, month: input.month, hireDate: day(employee.hireDate), terminationDate: day(employee.terminationDate) }) - (attendance.get(employee.id) ?? 0));
        const points = input.method === 'POINTS' ? toDecimal(String(employee.serviceChargePoints)) : toDecimal('1');
        return { id: employee.id, weight: points.mul(input.daysWeighted ? days : days > 0 ? 1 : 0) };
      })
      .filter((row) => row.weight.greaterThan(0));
    if (weights.length === 0) throw new ValidationError(input.method === 'POINTS' ? 'Puanı ve çalışılan günü olan personel yok (personel kartında servis payı puanı)' : 'Bu dönemde dağıtılacak personel yok');
    const total = toCents(input.amount);
    const sum = weights.reduce((acc, row) => acc.plus(row.weight), toDecimal('0'));
    const shares = weights.map((row) => ({ id: row.id, weight: row.weight, cents: Math.floor(row.weight.mul(total).div(sum).toNumber()) }));
    let rest = total - shares.reduce((acc, row) => acc + row.cents, 0);
    for (const share of [...shares].sort((a, b) => b.weight.comparedTo(a.weight) || a.id.localeCompare(b.id))) {
      if (rest <= 0) break;
      share.cents += 1;
      rest -= 1;
    }
    const pool = await tx.serviceChargePool.upsert({
      where: { hotelId_year_month: { hotelId, year: input.year, month: input.month } },
      create: { hotelId, year: input.year, month: input.month, amount: input.amount, method: input.method, daysWeighted: input.daysWeighted, departmentIds: input.departmentIds, note: input.note ?? null, status: 'DISTRIBUTED', distributedAt: new Date(), createdBy: currentActor() },
      update: { amount: input.amount, method: input.method, daysWeighted: input.daysWeighted, departmentIds: input.departmentIds, note: input.note ?? null, status: 'DISTRIBUTED', distributedAt: new Date() },
    });
    await tx.payrollItem.deleteMany({ where: { hotelId, source: 'SERVICE_CHARGE', sourceId: pool.id } });
    await ensureSystemElements(tx, hotelId);
    const element = await tx.payElement.findFirst({ where: { hotelId, code: 'SERVICE_CHARGE' }, select: { id: true } });
    const actor = currentActor();
    await tx.payrollItem.createMany({ data: shares.filter((share) => share.cents > 0).map((share) => ({ hotelId, employeeId: share.id, year: input.year, month: input.month, elementId: element.id, amount: fromCents(share.cents), source: 'SERVICE_CHARGE', sourceId: pool.id, createdBy: actor })) });
    await recordAudit(tx, { hotelId, entity: 'ServiceChargePool', entityId: pool.id, action: 'UPDATE', after: { year: input.year, month: input.month, amount: input.amount, method: input.method, daysWeighted: input.daysWeighted, employees: shares.length } });
    await markRunsStale(tx, hotelId, { year: input.year, month: input.month });
    await stage('payroll.settings.changed', { hotelId, area: 'SERVICE_CHARGE' });
  });
  return getServiceCharge(hotelId, input.year, input.month);
}

/** Dağıtımı geri alır (kalemler silinir, havuz taslak). @param {string} hotelId @param {number} year @param {number} month */
export async function undoServiceCharge(hotelId, year, month) {
  await writeWithEvents(async (tx, stage) => {
    await assertMonthOpen(tx, hotelId, year, month);
    const pool = await tx.serviceChargePool.findFirst({ where: { hotelId, year, month } });
    if (!pool) throw new NotFoundError('Bu ayın servis payı yok');
    await tx.payrollItem.deleteMany({ where: { hotelId, source: 'SERVICE_CHARGE', sourceId: pool.id } });
    await tx.serviceChargePool.update({ where: { id: pool.id }, data: { status: 'DRAFT', distributedAt: null } });
    await recordAudit(tx, { hotelId, entity: 'ServiceChargePool', entityId: pool.id, action: 'UPDATE', before: { status: pool.status }, after: { status: 'DRAFT' } });
    await markRunsStale(tx, hotelId, { year, month });
    await stage('payroll.settings.changed', { hotelId, area: 'SERVICE_CHARGE' });
  });
  return getServiceCharge(hotelId, year, month);
}

/* ═══════════════ Avans ═══════════════ */

/**
 * Avans: taksit tutarı = tutar / taksit (son taksit kalanı alır). Ödeme hesabı verildiyse kasadan / bankadan
 * çıkış ve personel carisine borç aynı işlemde yazılır (muhasebe başladıysa).
 * @param {string} hotelId @param {string} employeeId @param {any} input
 */
export async function createAdvance(hotelId, employeeId, input) {
  await writeWithEvents(async (tx, stage) => {
    await lockEmployees(tx, hotelId, [employeeId]);
    const employee = await requireEmployee(tx, hotelId, employeeId);
    if (employee.status !== 'ACTIVE') throw new ConflictError('Ayrılmış personele avans verilmez', 'EMPLOYEE_TERMINATED');
    if (input.paidOn < day(employee.hireDate)) throw new ValidationError('Avans işe girişten önce olamaz');
    if (input.firstYear * 12 + input.firstMonth < Number(input.paidOn.slice(0, 4)) * 12 + Number(input.paidOn.slice(5, 7))) throw new ValidationError('İlk mahsup ayı ödeme ayından önce olamaz');
    if (input.treasuryAccountId) {
      const account = await tx.treasuryAccount.findFirst({ where: { id: input.treasuryAccountId, hotelId }, select: { isActive: true } });
      if (!account?.isActive) throw new ValidationError('Kasa / banka hesabı kullanımda değil');
      await assertCashCovers(tx, hotelId, input.treasuryAccountId, input.amount);
    }
    const installment = toDecimal(input.amount).div(input.installments).toDecimalPlaces(2, Decimal.ROUND_UP);
    const advance = await tx.employeeAdvance.create({
      data: { hotelId, employeeId, amount: input.amount, installments: input.installments, installmentAmount: installment.toFixed(2), firstYear: input.firstYear, firstMonth: input.firstMonth, paidOn: dateOnly(input.paidOn), treasuryAccountId: input.treasuryAccountId ?? null, note: input.note ?? null, createdBy: currentActor() },
    });
    if (input.treasuryAccountId) await postAdvance(tx, stage, { hotelId, advanceId: advance.id, employeeId, treasuryAccountId: input.treasuryAccountId, amount: money(input.amount), paidOn: input.paidOn, employeeName: employeeFullName(employee) });
    await recordAudit(tx, { hotelId, entity: 'EmployeeAdvance', entityId: advance.id, action: 'CREATE', after: { employeeId, amount: input.amount, installments: input.installments, firstMonth: `${input.firstYear}-${input.firstMonth}`, treasuryAccountId: input.treasuryAccountId ?? null } });
    await markRunsStale(tx, hotelId, { fromYear: input.firstYear, fromMonth: input.firstMonth });
    await stage('payroll.settings.changed', { hotelId, area: 'ADVANCE' });
  });
  return { created: true };
}

/** Henüz mahsup edilmemiş avansı iptal eder; muhasebe kaydı varsa ters kayıtla düşülür. @param {string} hotelId @param {string} advanceId @param {string} reason */
export async function cancelAdvance(hotelId, advanceId, reason) {
  await writeWithEvents(async (tx, stage) => {
    const advance = await tx.employeeAdvance.findFirst({ where: { id: advanceId, hotelId } });
    if (!advance) throw new NotFoundError('Avans bulunamadı');
    if (advance.status !== 'OPEN' || toDecimal(String(advance.deducted)).greaterThan(0)) throw new ConflictError('Mahsup başlamış avans iptal edilmez', 'ADVANCE_IN_USE');
    const pending = await tx.payrollLine.findFirst({ where: { hotelId, refId: advanceId, entry: { run: { status: 'PENDING_APPROVAL' } } }, select: { id: true } });
    if (pending) throw new ConflictError('Avans onaydaki bir bordroda mahsup ediliyor', 'ADVANCE_IN_USE');
    const [entries, movements] = await Promise.all([
      tx.ledgerEntry.findMany({ where: { hotelId, sourceKey: `EMPLOYEE_ADVANCE:${advanceId}` }, select: { id: true } }),
      tx.treasuryMovement.findMany({ where: { hotelId, sourceKey: `EMPLOYEE_ADVANCE:${advanceId}` }, select: { id: true } }),
    ]);
    if (entries.length || movements.length) await reverseRecords(tx, hotelId, { ledgerEntryIds: entries.map((row) => row.id), treasuryMovementIds: movements.map((row) => row.id), date: day(advance.paidOn), note: `Avans iptali: ${reason}` });
    await tx.employeeAdvance.update({ where: { id: advanceId }, data: { status: 'CANCELLED' } });
    await recordAudit(tx, { hotelId, entity: 'EmployeeAdvance', entityId: advanceId, action: 'UPDATE', before: { status: 'OPEN' }, after: { status: 'CANCELLED', reason } });
    await markRunsStale(tx, hotelId, { fromYear: advance.firstYear, fromMonth: advance.firstMonth });
    await stage('payroll.settings.changed', { hotelId, area: 'ADVANCE' });
  });
  return { cancelled: true };
}

/* ═══════════════ İcra / nafaka ═══════════════ */

/** @param {string} hotelId @param {string} employeeId @param {any} input */
export async function createGarnishment(hotelId, employeeId, input) {
  await writeWithEvents(async (tx, stage) => {
    await requireEmployee(tx, hotelId, employeeId);
    if (input.ledgerAccountId) {
      const account = await tx.ledgerAccount.findFirst({ where: { id: input.ledgerAccountId, hotelId }, select: { id: true } });
      if (!account) throw new ValidationError('Cari bulunamadı');
    }
    const created = await tx.garnishment.create({
      data: {
        hotelId,
        employeeId,
        type: input.type,
        fileNumber: input.fileNumber,
        authority: input.authority,
        creditor: input.creditor,
        notifiedOn: dateOnly(input.notifiedOn),
        totalAmount: input.type === 'ICRA' ? input.totalAmount : null,
        monthlyAmount: input.type === 'NAFAKA' ? input.monthlyAmount : null,
        rate: input.type === 'ICRA' ? (input.rate ?? DEFAULT_GARNISHMENT_RATE) : null,
        ledgerAccountId: input.ledgerAccountId ?? null,
        note: input.note ?? null,
        createdBy: currentActor(),
      },
    });
    await recordAudit(tx, { hotelId, entity: 'Garnishment', entityId: created.id, action: 'CREATE', after: { employeeId, type: input.type, fileNumber: input.fileNumber, totalAmount: input.totalAmount ?? null, monthlyAmount: input.monthlyAmount ?? null } });
    await markRunsStale(tx, hotelId, { fromYear: Number(input.notifiedOn.slice(0, 4)), fromMonth: Number(input.notifiedOn.slice(5, 7)) });
    await stage('payroll.settings.changed', { hotelId, area: 'GARNISHMENT' });
  });
  return { created: true };
}

/** Dosyayı kapatır (feragat / tahsil / mahkeme kararı); kesilen tutar korunur. @param {string} hotelId @param {string} garnishmentId @param {string} reason */
export async function cancelGarnishment(hotelId, garnishmentId, reason) {
  await writeWithEvents(async (tx, stage) => {
    const row = await tx.garnishment.findFirst({ where: { id: garnishmentId, hotelId } });
    if (!row) throw new NotFoundError('Kayıt bulunamadı');
    if (row.status !== 'ACTIVE') throw new ConflictError('Kayıt zaten kapalı', 'GARNISHMENT_CLOSED');
    const pending = await tx.payrollLine.findFirst({ where: { hotelId, refId: garnishmentId, entry: { run: { status: 'PENDING_APPROVAL' } } }, select: { id: true } });
    if (pending) throw new ConflictError('Bu kesinti onaydaki bir bordroda; onay sonuçlanınca kapatın', 'GARNISHMENT_IN_USE');
    await tx.garnishment.update({ where: { id: garnishmentId }, data: { status: 'CANCELLED', note: [row.note, `Kapatıldı: ${reason}`].filter(Boolean).join(' · ').slice(0, 300) } });
    await recordAudit(tx, { hotelId, entity: 'Garnishment', entityId: garnishmentId, action: 'UPDATE', before: { status: 'ACTIVE' }, after: { status: 'CANCELLED', reason } });
    await markRunsStale(tx, hotelId, { fromYear: 2000, fromMonth: 1 });
    await stage('payroll.settings.changed', { hotelId, area: 'GARNISHMENT' });
  });
  return { cancelled: true };
}
