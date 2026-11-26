import { addDaysIso, weekStartOf } from '@hotelos/hotel-contracts';
import { LEAVE_SELECT, balanceOf, leaveView } from './leaves.js';
import { dateOnly, day, employeeView, hrContext, prisma, requireOwnEmployee } from './shared.js';

/**
 * Personelin kendi İK sayfası (modül 52, `hr.self`): kartı, yıllık izin bakiyesi, izinleri, bu ve gelecek haftanın
 * vardiyaları, bu ayın puantaj özeti. Kullanıcı hesabı bir personel kartına bağlı olmalı.
 * @param {string} hotelId @param {string | null | undefined} userId
 */
export async function getMyHr(hotelId, userId) {
  const context = await hrContext(hotelId);
  const employee = await requireOwnEmployee(hotelId, userId);
  const weekStart = weekStartOf(context.today);
  const monthStart = `${context.today.slice(0, 7)}-01`;
  const [balance, leaves, shifts, timesheets] = await Promise.all([
    balanceOf(prisma, employee, context.today),
    prisma.leave.findMany({ where: { employeeId: employee.id }, orderBy: [{ startDate: 'desc' }], take: 50, select: LEAVE_SELECT }),
    prisma.shift.findMany({ where: { employeeId: employee.id, date: { gte: dateOnly(weekStart), lte: dateOnly(addDaysIso(weekStart, 13)) } }, orderBy: [{ date: 'asc' }, { startTime: 'asc' }], select: { id: true, date: true, startTime: true, endTime: true, breakMinutes: true, note: true, department: { select: { name: true } } } }),
    prisma.timesheet.findMany({ where: { employeeId: employee.id, date: { gte: dateOnly(monthStart), lte: dateOnly(context.today) } }, select: { status: true, workedMinutes: true, overtimeMinutes: true } }),
  ]);
  const pending = leaves.filter((row) => row.type === 'ANNUAL' && row.status === 'PENDING').reduce((sum, row) => sum + Number(row.days), 0);
  return {
    employee: employeeView(employee),
    today: context.today,
    balance: { ...balance, pendingDays: pending, available: Math.round((balance.balance - pending) * 10) / 10 },
    leaves: leaves.map(leaveView),
    shifts: shifts.map((row) => ({ id: row.id, date: day(row.date), startTime: row.startTime, endTime: row.endTime, breakMinutes: row.breakMinutes, note: row.note, department: row.department.name })),
    month: {
      from: monthStart,
      presentDays: timesheets.filter((row) => row.status === 'PRESENT').length,
      absentDays: timesheets.filter((row) => row.status === 'ABSENT').length,
      workedMinutes: timesheets.reduce((sum, row) => sum + row.workedMinutes, 0),
      overtimeMinutes: timesheets.reduce((sum, row) => sum + row.overtimeMinutes, 0),
    },
    settings: { weeklyRestDay: context.settings.weeklyRestDay, leaveApprovalRequired: context.settings.leaveApprovalRequired, publicHolidays: context.settings.publicHolidays },
  };
}
