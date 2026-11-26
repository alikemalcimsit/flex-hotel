import { WEEKDAY_LABELS, addDaysIso, shiftMinutes, timesheetMinutes, weekdayOf } from '@hotelos/hotel-contracts';

/**
 * Hafta ızgarasının saf yardımcıları (modül 52; api bilmez, Node testinde koşar): vardiya ve puantaj ekranlarının
 * hafta gezinmesi, hücre anahtarları, departmana göre gruplama, problem kümeleri ve puantaj satırının gövdesi.
 */

const DAYS_IN_WEEK = 7;
/** Departmanı olmayan personelin grubu. */
export const NO_DEPARTMENT = Object.freeze({ id: '', name: 'Departmansız' });

/** Haftanın yedi günü (pazartesiden). @param {string} weekStart */
export const weekDaysOf = (weekStart) => Array.from({ length: DAYS_IN_WEEK }, (_, index) => addDaysIso(weekStart, index));

/** Haftanın son günü (pazar). @param {string} weekStart */
export const weekEndOf = (weekStart) => addDaysIso(weekStart, DAYS_IN_WEEK - 1);

/** Hafta ileri / geri. @param {string} weekStart @param {number} delta */
export const moveWeek = (weekStart, delta) => addDaysIso(weekStart, delta * DAYS_IN_WEEK);

/** Hücre anahtarı. @param {string} employeeId @param {string} date */
export const cellKey = (employeeId, date) => `${employeeId}|${date}`;

/** Sütun başlığı: kısa gün adı ve "25.11". @param {string} date */
export function dayHeader(date) {
  return { weekday: WEEKDAY_LABELS[weekdayOf(date)].slice(0, 3), dayText: `${date.slice(8, 10)}.${date.slice(5, 7)}` };
}

/** "08:00–16:00". @param {{ startTime: string, endTime: string }} shift */
export const shiftLabel = (shift) => `${shift.startTime}–${shift.endTime}`;

/**
 * Vardiyaları hücreye dağıtır (başlangıç saatine göre sıralı).
 * @param {Array<{ employeeId: string, date: string, startTime: string }>} shifts
 * @returns {Map<string, any[]>}
 */
export function groupShiftsByCell(shifts) {
  const cells = new Map();
  for (const shift of shifts) {
    const key = cellKey(shift.employeeId, shift.date);
    cells.set(key, [...(cells.get(key) ?? []), shift]);
  }
  for (const [key, list] of cells) cells.set(key, [...list].sort((a, b) => a.startTime.localeCompare(b.startTime)));
  return cells;
}

/**
 * Onaylı izin günleri: hücre anahtarı → izin türü (çizelgede "İzinli" görünsün).
 * @param {Array<{ employeeId: string, type: string, startDate: string, endDate: string }>} leaves
 * @param {string[]} days ızgaradaki günler
 * @returns {Map<string, string>}
 */
export function leaveCellsOf(leaves, days) {
  const cells = new Map();
  for (const leave of leaves) {
    for (const date of days) if (date >= leave.startDate && date <= leave.endDate) cells.set(cellKey(leave.employeeId, date), leave.type);
  }
  return cells;
}

/**
 * Personel başına haftalık çalışma dakikası (mola düşülmüş).
 * @param {Array<{ employeeId: string, date: string, startTime: string, endTime: string, breakMinutes?: number, minutes?: number }>} shifts
 * @returns {Map<string, number>}
 */
export function weeklyMinutesOf(shifts) {
  const totals = new Map();
  for (const shift of shifts) totals.set(shift.employeeId, (totals.get(shift.employeeId) ?? 0) + (shift.minutes ?? shiftMinutes(shift)));
  return totals;
}

/**
 * Personeli departmana göre gruplar (departman listesinin sırasıyla; departmansızlar sonda). Boş grup gelmez.
 * @param {Array<{ id: string, department: { id: string, name: string } | null }>} employees
 * @param {Array<{ id: string, name: string }>} departments
 * @returns {Array<{ id: string, name: string, employees: any[] }>}
 */
export function groupByDepartment(employees, departments) {
  const known = new Map(departments.map((department) => [department.id, { ...department, employees: [] }]));
  const extra = new Map();
  for (const employee of employees) {
    const department = employee.department ?? NO_DEPARTMENT;
    const group = known.get(department.id) ?? extra.get(department.id) ?? { id: department.id, name: department.name, employees: [] };
    const next = { ...group, employees: [...group.employees, employee] };
    if (known.has(department.id)) known.set(department.id, next);
    else extra.set(department.id, next);
  }
  return [...known.values(), ...extra.values()].filter((group) => group.employees.length > 0);
}

/**
 * Sunucunun problem listesinden hızlı bakılan kümeler: çakışan vardiya kimlikleri, kısa dinlenmeli vardiya kimlikleri,
 * haftalık normu aşan personel kimlikleri.
 * @param {Record<string, { conflicts?: Array<[string, string]>, shortRests?: Array<[string, string]>, weekOverload?: Array<{ weekStart: string, minutes: number }> }> | undefined} problems
 */
export function problemSetsOf(problems = {}) {
  const conflicts = new Set();
  const shortRests = new Set();
  const overloaded = new Set();
  for (const [employeeId, problem] of Object.entries(problems)) {
    for (const pair of problem.conflicts ?? []) pair.forEach((id) => conflicts.add(id));
    for (const pair of problem.shortRests ?? []) pair.forEach((id) => shortRests.add(id));
    if (problem.weekOverload?.length) overloaded.add(employeeId);
  }
  return { conflicts, shortRests, overloaded };
}

/**
 * Puantaj hücresinin kayıt gövdesi (`timesheetInputSchema`): boş saat `null`, mola sayı.
 * @param {string} employeeId @param {string} date
 * @param {{ status: string, clockIn?: string | null, clockOut?: string | null, breakMinutes?: number | string, note?: string | null }} cell
 */
export function timesheetRowOf(employeeId, date, cell) {
  const present = cell.status === 'PRESENT';
  return {
    employeeId,
    date,
    status: cell.status,
    clockIn: present && cell.clockIn ? cell.clockIn : null,
    clockOut: present && cell.clockOut ? cell.clockOut : null,
    breakMinutes: present ? Number(cell.breakMinutes || 0) : 0,
    note: cell.note || null,
  };
}

/**
 * Hücrenin çalışma ve mesai dakikası (taslak için anında; kayıtlı hücrede sunucunun değeri).
 * @param {{ status: string | null, clockIn?: string | null, clockOut?: string | null, breakMinutes?: number | string }} cell
 * @param {number} dailyWorkMinutes
 */
export function cellMinutesOf(cell, dailyWorkMinutes) {
  if (cell.status !== 'PRESENT') return { workedMinutes: 0, overtimeMinutes: 0 };
  return timesheetMinutes({ clockIn: cell.clockIn || null, clockOut: cell.clockOut || null, breakMinutes: Number(cell.breakMinutes || 0), dailyWorkMinutes });
}

/**
 * Taslak hücreleri satırın özetine işler: değişen hücrenin dakikası sunucununkinin yerine geçer.
 * @param {Record<string, any>} cells sunucunun hücreleri (tarih → hücre)
 * @param {Record<string, any>} drafts bu personelin taslakları (tarih → hücre)
 * @param {number} dailyWorkMinutes
 */
export function rowSummaryOf(cells, drafts, dailyWorkMinutes) {
  return Object.entries(cells).reduce(
    (sum, [date, cell]) => {
      const current = drafts[date] ? { ...cell, ...drafts[date] } : cell;
      const minutes = drafts[date] ? cellMinutesOf(current, dailyWorkMinutes) : { workedMinutes: cell.workedMinutes ?? 0, overtimeMinutes: cell.overtimeMinutes ?? 0 };
      return {
        worked: sum.worked + minutes.workedMinutes,
        overtime: sum.overtime + minutes.overtimeMinutes,
        present: sum.present + (current.status === 'PRESENT' ? 1 : 0),
        absent: sum.absent + (current.status === 'ABSENT' ? 1 : 0),
      };
    },
    { worked: 0, overtime: 0, present: 0, absent: 0 },
  );
}
