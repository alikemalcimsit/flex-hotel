import { toIsoDay } from '@hotelos/core';
import { HR_DEFAULTS, fixedPublicHolidays } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { hotelContext } from '../banquet/shared.js';

/**
 * İK'nın ortak parçaları (modül 52): ayar (varsayılanlarla), resmî tatil kümesi, personel okuma, kullanıcı → personel bağı.
 */

export { prisma, hotelContext };

/** @param {Date | null | undefined} value */
export const day = (value) => (value ? toIsoDay(value) : null);
/** @param {string} text */
export const dateOnly = (text) => new Date(`${text}T00:00:00.000Z`);
/** @param {Date | null | undefined} value */
export const iso = (value) => (value ? value.toISOString() : null);
/** "2026-10-30" → "30.10.2026" @param {string} text */
export const dotted = (text) => text.split('-').reverse().join('.');
/** @param {{ firstName: string, lastName: string }} employee */
export const fullName = (employee) => `${employee.firstName} ${employee.lastName}`;
/** "HH:MM" (UTC saat alanı; puantaj saatleri yerel saat olarak saklanır). @param {Date | null | undefined} value */
export const clock = (value) => (value ? value.toISOString().slice(11, 16) : null);
/** Yerel "HH:MM" → günün o saati (UTC taban; saat dilimi dönüşümü yapılmaz, saat olduğu gibi saklanır). @param {string} dayText @param {string} time */
export const clockOn = (dayText, time) => new Date(`${dayText}T${time}:00.000Z`);

export const EMPLOYEE_SELECT = Object.freeze({ id: true, code: true, firstName: true, lastName: true, status: true, hireDate: true, terminationDate: true, birthDate: true, userId: true, departmentId: true, position: true, department: { select: { id: true, name: true } } });

/** @param {any} row */
export const employeeView = (row) => ({
  id: row.id,
  code: row.code,
  name: fullName(row),
  status: row.status,
  position: row.position,
  hireDate: day(row.hireDate),
  terminationDate: day(row.terminationDate),
  department: row.department ? { id: row.department.id, name: row.department.name } : null,
});

/**
 * İK ayarı (satır yoksa varsayılanlar; resmî tatil listesi boşsa içinde bulunulan ve sonraki yılın sabit tatilleri).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId @param {string} today
 */
export async function loadHrSettings(client, hotelId, today) {
  const row = await client.hrSettings.findUnique({ where: { hotelId } });
  const year = Number(today.slice(0, 4));
  const holidays = row && Array.isArray(row.publicHolidays) && row.publicHolidays.length ? /** @type {Array<{ date: string, name: string }>} */ (row.publicHolidays) : [...fixedPublicHolidays(year), ...fixedPublicHolidays(year + 1)];
  return {
    weeklyRestDay: row?.weeklyRestDay ?? HR_DEFAULTS.weeklyRestDay,
    dailyWorkMinutes: row?.dailyWorkMinutes ?? HR_DEFAULTS.dailyWorkMinutes,
    weeklyWorkMinutes: row?.weeklyWorkMinutes ?? HR_DEFAULTS.weeklyWorkMinutes,
    publicHolidays: [...holidays].sort((a, b) => a.date.localeCompare(b.date)),
    leaveApprovalRequired: row?.leaveApprovalRequired ?? HR_DEFAULTS.leaveApprovalRequired,
    documentReminderDays: row?.documentReminderDays ?? HR_DEFAULTS.documentReminderDays,
    holidaySet: new Set(holidays.map((holiday) => holiday.date)),
    isDefault: !row,
    updatedAt: iso(row?.updatedAt),
    updatedBy: row?.updatedBy ?? null,
  };
}

/** Otel bağlamı + İK ayarı. @param {string} hotelId */
export async function hrContext(hotelId) {
  const context = await hotelContext(hotelId);
  const settings = await loadHrSettings(prisma, hotelId, context.today);
  return { today: context.today, currency: context.currency, timezone: context.timezone, settings };
}

/**
 * Personel kartı (otel kapsamlı); yoksa bulunamadı.
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId @param {string} employeeId
 */
export async function requireEmployee(client, hotelId, employeeId) {
  const row = await client.employee.findFirst({ where: { id: employeeId, hotelId }, select: EMPLOYEE_SELECT });
  if (!row) throw new NotFoundError('Personel bulunamadı');
  return row;
}

/**
 * Oturumdaki kullanıcının personel kartı (`Employee.userId`); bağ yoksa 403 ile anlaşılır ileti.
 * @param {string} hotelId @param {string | null | undefined} userId
 */
export async function requireOwnEmployee(hotelId, userId) {
  const row = userId ? await prisma.employee.findFirst({ where: { hotelId, userId }, select: EMPLOYEE_SELECT }) : null;
  if (!row) throw new ForbiddenError('Kullanıcı hesabınız bir personel kartına bağlı değil; İK personel kartınızda "Kullanıcı hesabı" alanını doldurmalı');
  return row;
}
