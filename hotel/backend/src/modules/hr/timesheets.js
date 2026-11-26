import { currentActor } from '@hotelos/core';
import { addDaysIso, dayListBetween, monthlyAttendance, payrollPeriodLabel, timesheetMinutes, weekdayOf } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { writeWithEvents } from '../../lib/write.js';
import { employmentDays } from '../payroll/engine.js';
import { assertMonthOpen, markRunsStale } from '../payroll/shared.js';
import { EMPLOYEE_SELECT, clock, clockOn, dateOnly, day, employeeView, fullName, hrContext, prisma } from './shared.js';

/**
 * Günlük puantaj (modül 52): personel × gün ızgarası (geldi / gelmedi / izinli / hafta tatili / resmî tatil, giriş-çıkış,
 * mola, çalışılan ve norm üstü dakika). İzinli günler onaylı izinden gelir (elle yazılamaz); hafta tatili ve resmî tatil
 * kayıt yoksa varsayılan görünür. "Bordroya aktar" ayın özetini 51'in `PayrollAttendance` satırına (kaynak TIMESHEET) yazar.
 */

const SELECT = Object.freeze({ id: true, employeeId: true, date: true, status: true, clockIn: true, clockOut: true, breakMinutes: true, workedMinutes: true, overtimeMinutes: true, leaveId: true, source: true, note: true, updatedBy: true, updatedAt: true });

/**
 * @param {string} hotelId
 * @param {{ from: string, to: string, page: number, pageSize: number, departmentId?: string, employeeId?: string, search?: string }} query
 */
export async function listTimesheets(hotelId, query) {
  const context = await hrContext(hotelId);
  const days = dayListBetween(query.from, query.to);
  const where = {
    hotelId,
    hireDate: { lte: dateOnly(query.to) },
    OR: [{ terminationDate: null }, { terminationDate: { gte: dateOnly(query.from) } }],
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.employeeId ? { id: query.employeeId } : {}),
    ...(query.search ? { AND: [{ OR: [{ firstName: { contains: query.search, mode: 'insensitive' } }, { lastName: { contains: query.search, mode: 'insensitive' } }, { code: { contains: query.search, mode: 'insensitive' } }] }] } : {}),
  };
  const [employees, total] = await Promise.all([prisma.employee.findMany({ where, select: EMPLOYEE_SELECT, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], ...toSkipTake(query) }), prisma.employee.count({ where })]);
  const ids = employees.map((row) => row.id);
  const [rows, leaves] = await Promise.all([
    prisma.timesheet.findMany({ where: { hotelId, employeeId: { in: ids }, date: { gte: dateOnly(query.from), lte: dateOnly(query.to) } }, select: SELECT }),
    prisma.leave.findMany({ where: { hotelId, employeeId: { in: ids }, status: 'APPROVED', startDate: { lte: dateOnly(query.to) }, endDate: { gte: dateOnly(query.from) } }, select: { id: true, employeeId: true, type: true, startDate: true, endDate: true } }),
  ]);
  const byKey = new Map(rows.map((row) => [`${row.employeeId}|${day(row.date)}`, row]));
  const items = employees.map((employee) => {
    const hire = /** @type {string} */ (day(employee.hireDate));
    const leaveDay = day(employee.terminationDate);
    const cells = {};
    for (const date of days) {
      if (date < hire || (leaveDay && date > leaveDay)) {
        cells[date] = { status: null, outside: true };
        continue;
      }
      const row = byKey.get(`${employee.id}|${date}`);
      const leave = leaves.find((item) => item.employeeId === employee.id && /** @type {string} */ (day(item.startDate)) <= date && /** @type {string} */ (day(item.endDate)) >= date);
      if (row) {
        cells[date] = { id: row.id, status: row.status, clockIn: clock(row.clockIn), clockOut: clock(row.clockOut), breakMinutes: row.breakMinutes, workedMinutes: row.workedMinutes, overtimeMinutes: row.overtimeMinutes, note: row.note, source: row.source, leaveType: leave?.type ?? null, saved: true };
      } else {
        const status = leave ? 'LEAVE' : context.settings.holidaySet.has(date) ? 'HOLIDAY' : weekdayOf(date) === context.settings.weeklyRestDay ? 'REST' : null;
        cells[date] = { status, leaveType: leave?.type ?? null, saved: false, clockIn: null, clockOut: null, breakMinutes: 0, workedMinutes: 0, overtimeMinutes: 0, note: null };
      }
    }
    const summary = Object.values(cells).reduce((acc, cell) => ({ worked: acc.worked + (cell.workedMinutes ?? 0), overtime: acc.overtime + (cell.overtimeMinutes ?? 0), present: acc.present + (cell.status === 'PRESENT' ? 1 : 0), absent: acc.absent + (cell.status === 'ABSENT' ? 1 : 0) }), { worked: 0, overtime: 0, present: 0, absent: 0 });
    return { employee: employeeView(employee), cells, summary };
  });
  return {
    ...buildPage(items, total, query),
    from: query.from,
    to: query.to,
    days: days.map((date) => ({ date, holiday: context.settings.publicHolidays.find((holiday) => holiday.date === date)?.name ?? null, rest: weekdayOf(date) === context.settings.weeklyRestDay })),
    settings: { dailyWorkMinutes: context.settings.dailyWorkMinutes, weeklyRestDay: context.settings.weeklyRestDay },
  };
}

/**
 * Toplu yazım (en fazla 400 satır). İzinli gün yazılamaz; kilitli bordro ayına yazılamaz.
 * @param {string} hotelId @param {{ rows: Array<{ employeeId: string, date: string, status: string, clockIn: string | null, clockOut: string | null, breakMinutes: number, note: string | null }> }} input
 */
export async function saveTimesheets(hotelId, input) {
  const context = await hrContext(hotelId);
  const keys = new Set(input.rows.map((row) => `${row.employeeId}|${row.date}`));
  if (keys.size !== input.rows.length) throw new ValidationError('Aynı personel ve gün iki kez');
  const actor = currentActor();
  const months = [...new Set(input.rows.map((row) => row.date.slice(0, 7)))];
  const employeeIds = [...new Set(input.rows.map((row) => row.employeeId))];
  await writeWithEvents(async (tx, stage) => {
    for (const month of months) await assertMonthOpen(tx, hotelId, Number(month.slice(0, 4)), Number(month.slice(5, 7)));
    const employees = new Map((await tx.employee.findMany({ where: { hotelId, id: { in: employeeIds } }, select: EMPLOYEE_SELECT })).map((row) => [row.id, row]));
    const from = input.rows.reduce((min, row) => (row.date < min ? row.date : min), input.rows[0].date);
    const to = input.rows.reduce((max, row) => (row.date > max ? row.date : max), input.rows[0].date);
    const leaves = await tx.leave.findMany({ where: { hotelId, employeeId: { in: employeeIds }, status: 'APPROVED', startDate: { lte: dateOnly(to) }, endDate: { gte: dateOnly(from) } }, select: { employeeId: true, startDate: true, endDate: true } });
    for (const row of input.rows) {
      const employee = employees.get(row.employeeId);
      if (!employee) throw new NotFoundError('Personel bulunamadı');
      const hire = /** @type {string} */ (day(employee.hireDate));
      const leaveDay = day(employee.terminationDate);
      if (row.date < hire || (leaveDay && row.date > leaveDay)) throw new ValidationError(`${fullName(employee)} ${row.date} gününde çalışmıyor`);
      if (row.date > context.today) throw new ValidationError('İleri tarihe puantaj girilmez', { fields: { date: 'İleri tarih' } });
      const onLeave = leaves.some((leave) => leave.employeeId === row.employeeId && /** @type {string} */ (day(leave.startDate)) <= row.date && /** @type {string} */ (day(leave.endDate)) >= row.date);
      if (onLeave) throw new ConflictError(`${fullName(employee)} ${row.date} gününde onaylı izinli; izni iptal etmeden puantaj girilemez`, 'TIMESHEET_ON_LEAVE');
      const minutes = row.status === 'PRESENT' ? timesheetMinutes({ clockIn: row.clockIn, clockOut: row.clockOut, breakMinutes: row.breakMinutes, dailyWorkMinutes: context.settings.dailyWorkMinutes }) : { workedMinutes: 0, overtimeMinutes: 0 };
      const data = {
        status: /** @type {any} */ (row.status),
        clockIn: row.status === 'PRESENT' && row.clockIn ? clockOn(row.date, row.clockIn) : null,
        // Gece çıkışı (çıkış ≤ giriş) ertesi günün saatidir.
        clockOut: row.status === 'PRESENT' && row.clockOut ? clockOn(row.clockIn && row.clockOut <= row.clockIn ? addDaysIso(row.date, 1) : row.date, row.clockOut) : null,
        breakMinutes: row.status === 'PRESENT' ? row.breakMinutes : 0,
        ...minutes,
        leaveId: null,
        source: 'MANUAL',
        note: row.note,
        updatedBy: actor,
      };
      await tx.timesheet.upsert({ where: { employeeId_date: { employeeId: row.employeeId, date: dateOnly(row.date) } }, create: { hotelId, employeeId: row.employeeId, date: dateOnly(row.date), ...data }, update: data });
    }
    await recordAudit(tx, { hotelId, entity: 'Timesheet', entityId: `${from}..${to}`, action: 'UPDATE', after: { rows: input.rows.length, employees: employeeIds.length } });
    await stage('hr.changed', { hotelId, area: 'TIMESHEETS' });
  });
  return { saved: input.rows.length };
}

/**
 * Ayın puantajını bordroya aktarır: dönemde çalışan her personel için günlük puantaj + onaylı izinlerden 51'in satırı
 * (kaynak TIMESHEET). Onaylı / onaydaki ay reddedilir; hesaplanmış bordro bayatlar.
 * @param {string} hotelId @param {{ year: number, month: number, departmentId?: string | null }} input
 */
export async function exportToPayroll(hotelId, input) {
  const context = await hrContext(hotelId);
  const first = `${input.year}-${String(input.month).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(input.year, input.month, 0)).toISOString().slice(0, 10);
  const employees = await prisma.employee.findMany({
    where: { hotelId, hireDate: { lte: dateOnly(last) }, OR: [{ terminationDate: null }, { terminationDate: { gte: dateOnly(first) } }], ...(input.departmentId ? { departmentId: input.departmentId } : {}) },
    select: EMPLOYEE_SELECT,
  });
  if (employees.length === 0) return { exported: 0, skipped: 0, period: payrollPeriodLabel(input.year, input.month), rows: [] };
  const ids = employees.map((row) => row.id);
  const [timesheets, leaves] = await Promise.all([
    prisma.timesheet.findMany({ where: { hotelId, employeeId: { in: ids }, date: { gte: dateOnly(first), lte: dateOnly(last) } }, select: { employeeId: true, date: true, status: true, overtimeMinutes: true } }),
    prisma.leave.findMany({ where: { hotelId, employeeId: { in: ids }, status: 'APPROVED', startDate: { lte: dateOnly(last) }, endDate: { gte: dateOnly(first) } }, select: { employeeId: true, type: true, startDate: true, endDate: true } }),
  ]);
  const actor = currentActor();
  return writeWithEvents(async (tx, stage) => {
    await assertMonthOpen(tx, hotelId, input.year, input.month);
    let exported = 0;
    let skipped = 0;
    const details = [];
    for (const employee of employees) {
      const paidDays = employmentDays({ year: input.year, month: input.month, hireDate: /** @type {string} */ (day(employee.hireDate)), terminationDate: day(employee.terminationDate) });
      if (paidDays === 0) {
        skipped += 1;
        continue;
      }
      const summary = monthlyAttendance({
        year: input.year,
        month: input.month,
        weeklyRestDay: context.settings.weeklyRestDay,
        holidays: context.settings.holidaySet,
        timesheets: timesheets.filter((row) => row.employeeId === employee.id).map((row) => ({ date: /** @type {string} */ (day(row.date)), status: row.status, overtimeMinutes: row.overtimeMinutes })),
        leaves: leaves.filter((row) => row.employeeId === employee.id).map((row) => ({ type: row.type, startDate: /** @type {string} */ (day(row.startDate)), endDate: /** @type {string} */ (day(row.endDate)) })),
      });
      const missingDays = Math.min(summary.missingDays, paidDays);
      const workedDays = Math.min(summary.workedDays, paidDays - missingDays);
      const data = { missingDays, missingReason: missingDays > 0 ? summary.missingReason : null, // Ayda puantaj kaydı varsa "hiç gelmedi" 0'dır; kayıt yoksa boş (ücretli gün).
        workedDays: workedDays > 0 ? workedDays : summary.hasRecords ? 0 : null, overtimeHours: summary.overtimeHours, holidayDays: summary.holidayDays, weeklyRestDays: summary.weeklyRestDays, source: 'TIMESHEET', note: `İK puantajından (${context.today})`, updatedBy: actor };
      await tx.payrollAttendance.upsert({ where: { employeeId_year_month: { employeeId: employee.id, year: input.year, month: input.month } }, create: { hotelId, employeeId: employee.id, year: input.year, month: input.month, ...data }, update: data });
      exported += 1;
      details.push({ employee: employeeView(employee), ...data });
    }
    await recordAudit(tx, { hotelId, entity: 'PayrollAttendance', entityId: `${input.year}-${String(input.month).padStart(2, '0')}`, action: 'UPDATE', after: { source: 'TIMESHEET', exported, skipped } });
    await markRunsStale(tx, hotelId, { year: input.year, month: input.month });
    await stage('payroll.settings.changed', { hotelId, area: 'ATTENDANCE' });
    await stage('hr.changed', { hotelId, area: 'ATTENDANCE_EXPORT' });
    return { exported, skipped, period: payrollPeriodLabel(input.year, input.month), rows: details.slice(0, 200) };
  });
}
