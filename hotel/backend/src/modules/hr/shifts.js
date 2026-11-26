import { currentActor } from '@hotelos/core';
import { addDaysIso, dayListBetween, shiftMinutes, shiftProblems, shiftsOverlap } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import { EMPLOYEE_SELECT, dateOnly, day, employeeView, fullName, hrContext, prisma } from './shared.js';

/**
 * Vardiya çizelgesi (modül 52): departman × gün × personel. Çakışan vardiya reddedilir; 11 saatten az dinlenme ve
 * haftalık norm aşımı uyarı olarak döner (kayıt yazılır). Hafta kopyalama: kaynak haftanın vardiyaları hedef haftaya
 * aynı gün sırasıyla taşınır; hedefte çakışan atlanır.
 */

const SHIFT_SELECT = Object.freeze({ id: true, employeeId: true, departmentId: true, date: true, startTime: true, endTime: true, breakMinutes: true, note: true, source: true, updatedAt: true });

/** @param {any} row */
const shiftView = (row) => ({ id: row.id, employeeId: row.employeeId, departmentId: row.departmentId, date: day(row.date), startTime: row.startTime, endTime: row.endTime, breakMinutes: row.breakMinutes, minutes: shiftMinutes({ date: /** @type {string} */ (day(row.date)), startTime: row.startTime, endTime: row.endTime, breakMinutes: row.breakMinutes }), note: row.note, source: row.source });

/**
 * Çizelge: aralıktaki vardiyalar, departmanlar ve aktif personel (dönemde çalışan), personel bazında uyarılar,
 * onaylı izin günleri (çizelgede "izinli" görünsün) ve resmî tatiller.
 * @param {string} hotelId @param {{ from: string, to: string, departmentId?: string, employeeId?: string }} query
 */
export async function listShifts(hotelId, query) {
  const context = await hrContext(hotelId);
  const employeeWhere = {
    hotelId,
    hireDate: { lte: dateOnly(query.to) },
    OR: [{ terminationDate: null }, { terminationDate: { gte: dateOnly(query.from) } }],
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.employeeId ? { id: query.employeeId } : {}),
  };
  const [departments, employees, shifts, leaves] = await Promise.all([
    prisma.department.findMany({ where: { hotelId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.employee.findMany({ where: employeeWhere, select: EMPLOYEE_SELECT, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
    prisma.shift.findMany({
      where: { hotelId, date: { gte: dateOnly(addDaysIso(query.from, -1)), lte: dateOnly(query.to) }, ...(query.departmentId ? { departmentId: query.departmentId } : {}), ...(query.employeeId ? { employeeId: query.employeeId } : {}) },
      select: SHIFT_SELECT,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    }),
    prisma.leave.findMany({
      where: { hotelId, status: 'APPROVED', startDate: { lte: dateOnly(query.to) }, endDate: { gte: dateOnly(query.from) }, ...(query.employeeId ? { employeeId: query.employeeId } : {}) },
      select: { employeeId: true, type: true, startDate: true, endDate: true },
    }),
  ]);
  const inRange = shifts.filter((row) => /** @type {string} */ (day(row.date)) >= query.from);
  const byEmployee = new Map();
  for (const row of shifts) {
    const list = byEmployee.get(row.employeeId) ?? [];
    list.push({ id: row.id, date: /** @type {string} */ (day(row.date)), startTime: row.startTime, endTime: row.endTime, breakMinutes: row.breakMinutes });
    byEmployee.set(row.employeeId, list);
  }
  const problems = {};
  for (const [employeeId, list] of byEmployee) {
    const found = shiftProblems(list, { weeklyWorkMinutes: context.settings.weeklyWorkMinutes });
    const byId = (pairs) => pairs.map(([a, b]) => [list[a].id, list[b].id]);
    if (found.conflicts.length || found.shortRests.length || found.weekOverload.length) problems[employeeId] = { conflicts: byId(found.conflicts), shortRests: byId(found.shortRests), weekOverload: found.weekOverload };
  }
  return {
    from: query.from,
    to: query.to,
    days: dayListBetween(query.from, query.to).map((date) => ({ date, holiday: context.settings.publicHolidays.find((holiday) => holiday.date === date)?.name ?? null, rest: new Date(`${date}T00:00:00.000Z`).getUTCDay() === context.settings.weeklyRestDay })),
    departments,
    employees: employees.map(employeeView),
    shifts: inRange.map(shiftView),
    leaves: leaves.map((row) => ({ employeeId: row.employeeId, type: row.type, startDate: day(row.startDate), endDate: day(row.endDate) })),
    problems,
    settings: { weeklyWorkMinutes: context.settings.weeklyWorkMinutes, dailyWorkMinutes: context.settings.dailyWorkMinutes, weeklyRestDay: context.settings.weeklyRestDay },
  };
}

/**
 * Toplu yazım: eklenen / değişen vardiyalar ve silinenler. Personel aktif ve o gün çalışıyor olmalı; aynı personelde
 * çakışma hata. Uyarılar (dinlenme, haftalık saat) sonuçta döner.
 * @param {string} hotelId @param {{ upserts: Array<any>, deletes: string[] }} input
 */
export async function saveShifts(hotelId, input) {
  const context = await hrContext(hotelId);
  const actor = currentActor();
  const employeeIds = [...new Set(input.upserts.map((row) => row.employeeId))];
  const result = await writeWithEvents(async (tx, stage) => {
    if (input.deletes.length) {
      const removed = await tx.shift.deleteMany({ where: { hotelId, id: { in: input.deletes } } });
      if (removed.count !== input.deletes.length) throw new NotFoundError('Silinecek vardiya bulunamadı (bu arada değişmiş olabilir)');
    }
    const employees = employeeIds.length ? await tx.employee.findMany({ where: { hotelId, id: { in: employeeIds } }, select: EMPLOYEE_SELECT }) : [];
    const byId = new Map(employees.map((row) => [row.id, row]));
    const departments = new Set((await tx.department.findMany({ where: { hotelId, isActive: true }, select: { id: true } })).map((row) => row.id));
    // Personel satırları kilitlenir: eşzamanlı iki çizelge yazımı aynı kişiye çakışan vardiya yazamasın.
    if (employeeIds.length) await tx.$executeRaw`SELECT "id" FROM "Employee" WHERE "id" = ANY(${[...employeeIds].sort()}::text[]) AND "hotelId" = ${hotelId} ORDER BY "id" FOR UPDATE`;
    const saved = [];
    for (const row of input.upserts) {
      const employee = byId.get(row.employeeId);
      if (!employee) throw new NotFoundError('Personel bulunamadı');
      if (!departments.has(row.departmentId)) throw new ValidationError('Departman bulunamadı ya da pasif', { fields: { departmentId: 'Geçersiz departman' } });
      const hire = /** @type {string} */ (day(employee.hireDate));
      const leave = day(employee.terminationDate);
      if (row.date < hire || (leave && row.date > leave)) throw new ValidationError(`${fullName(employee)} ${row.date} gününde çalışmıyor`, { fields: { date: 'Çalışma dönemi dışında' } });
      const others = await tx.shift.findMany({ where: { employeeId: row.employeeId, date: { gte: dateOnly(addDaysIso(row.date, -1)), lte: dateOnly(addDaysIso(row.date, 1)) }, ...(row.id ? { id: { not: row.id } } : {}) }, select: { id: true, date: true, startTime: true, endTime: true } });
      const clash = others.find((other) => shiftsOverlap({ date: /** @type {string} */ (day(other.date)), startTime: other.startTime, endTime: other.endTime }, row));
      if (clash) throw new ConflictError(`${fullName(employee)}: ${day(clash.date)} ${clash.startTime}–${clash.endTime} vardiyasıyla çakışıyor`, 'SHIFT_OVERLAP');
      const data = { hotelId, employeeId: row.employeeId, departmentId: row.departmentId, date: dateOnly(row.date), startTime: row.startTime, endTime: row.endTime, breakMinutes: row.breakMinutes, note: row.note, source: 'MANUAL' };
      if (row.id && !(await tx.shift.findFirst({ where: { id: row.id, hotelId }, select: { id: true } }))) throw new NotFoundError('Düzenlenecek vardiya bulunamadı');
      const written = row.id ? await tx.shift.update({ where: { id: row.id }, data, select: SHIFT_SELECT }) : await tx.shift.create({ data: { ...data, createdBy: actor }, select: SHIFT_SELECT });
      saved.push(written);
    }
    await recordAudit(tx, { hotelId, entity: 'Shift', entityId: `${input.upserts[0]?.date ?? 'batch'}`, action: 'UPDATE', after: { upserts: input.upserts.length, deletes: input.deletes.length } });
    await stage('hr.changed', { hotelId, area: 'SHIFTS' });
    return saved;
  });
  // Uyarılar kayıt sonrası, etkilenen personelin iki haftalık penceresinde.
  const warnings = {};
  for (const employeeId of employeeIds) {
    const dates = input.upserts.filter((row) => row.employeeId === employeeId).map((row) => row.date).sort();
    const list = await prisma.shift.findMany({ where: { employeeId, date: { gte: dateOnly(addDaysIso(dates[0], -7)), lte: dateOnly(addDaysIso(dates.at(-1), 7)) } }, select: { id: true, date: true, startTime: true, endTime: true, breakMinutes: true } });
    const found = shiftProblems(list.map((row) => ({ ...row, date: /** @type {string} */ (day(row.date)) })), { weeklyWorkMinutes: context.settings.weeklyWorkMinutes });
    if (found.shortRests.length || found.weekOverload.length) warnings[employeeId] = { shortRests: found.shortRests.map(([a, b]) => [list[a].id, list[b].id]), weekOverload: found.weekOverload };
  }
  return { saved: result.map(shiftView), deleted: input.deletes.length, warnings };
}

/**
 * Haftayı kopyala: kaynak haftanın (pazartesi başlangıç) vardiyaları hedef haftaya; çakışan ya da çalışmayan personelinki atlanır.
 * @param {string} hotelId @param {{ fromWeekStart: string, toWeekStart: string, departmentId?: string }} input
 */
export async function copyWeek(hotelId, input) {
  const offset = Math.round((Date.parse(`${input.toWeekStart}T00:00:00.000Z`) - Date.parse(`${input.fromWeekStart}T00:00:00.000Z`)) / 86_400_000);
  const source = await prisma.shift.findMany({
    where: { hotelId, date: { gte: dateOnly(input.fromWeekStart), lte: dateOnly(addDaysIso(input.fromWeekStart, 6)) }, ...(input.departmentId ? { departmentId: input.departmentId } : {}) },
    select: SHIFT_SELECT,
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });
  if (source.length === 0) return { copied: 0, skipped: 0 };
  const actor = currentActor();
  return writeWithEvents(async (tx, stage) => {
    const employeeIds = [...new Set(source.map((row) => row.employeeId))].sort();
    await tx.$executeRaw`SELECT "id" FROM "Employee" WHERE "id" = ANY(${employeeIds}::text[]) AND "hotelId" = ${hotelId} ORDER BY "id" FOR UPDATE`;
    const activeDepartments = new Set((await tx.department.findMany({ where: { hotelId, isActive: true }, select: { id: true } })).map((row) => row.id));
    const employees = new Map((await tx.employee.findMany({ where: { hotelId, id: { in: [...new Set(source.map((row) => row.employeeId))] } }, select: { id: true, hireDate: true, terminationDate: true, status: true } })).map((row) => [row.id, row]));
    const existing = await tx.shift.findMany({ where: { hotelId, date: { gte: dateOnly(addDaysIso(input.toWeekStart, -1)), lte: dateOnly(addDaysIso(input.toWeekStart, 7)) } }, select: { employeeId: true, date: true, startTime: true, endTime: true } });
    let copied = 0;
    let skipped = 0;
    const planned = [];
    for (const row of source) {
      const target = addDaysIso(/** @type {string} */ (day(row.date)), offset);
      const employee = employees.get(row.employeeId);
      const leave = day(employee?.terminationDate);
      const candidate = { date: target, startTime: row.startTime, endTime: row.endTime };
      const clash = [...existing.filter((other) => other.employeeId === row.employeeId).map((other) => ({ ...other, date: /** @type {string} */ (day(other.date)) })), ...planned.filter((other) => other.employeeId === row.employeeId)].some((other) => shiftsOverlap(other, candidate));
      if (!employee || employee.status !== 'ACTIVE' || !activeDepartments.has(row.departmentId) || target < /** @type {string} */ (day(employee.hireDate)) || (leave && target > leave) || clash) {
        skipped += 1;
        continue;
      }
      planned.push({ employeeId: row.employeeId, ...candidate });
      await tx.shift.create({ data: { hotelId, employeeId: row.employeeId, departmentId: row.departmentId, date: dateOnly(target), startTime: row.startTime, endTime: row.endTime, breakMinutes: row.breakMinutes, note: row.note, source: 'MANUAL', createdBy: actor } });
      copied += 1;
    }
    await recordAudit(tx, { hotelId, entity: 'Shift', entityId: input.toWeekStart, action: 'CREATE', after: { copiedFrom: input.fromWeekStart, copied, skipped } });
    if (copied) await stage('hr.changed', { hotelId, area: 'SHIFTS' });
    return { copied, skipped };
  });
}
