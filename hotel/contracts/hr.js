import { decimalField, expectedUpdatedAt, isoDayField, paginationQuerySchema } from './fields.js';
import { z } from './locale.js';

/**
 * İK sözleşmeleri (modül 52): izin talebi ve bakiye, vardiya çizelgesi, günlük puantaj ve bordroya aktarım, özlük belgeleri.
 *
 * Kararlar:
 * - **Personel kaydı ortak:** 51'in `Employee` / `Department` kaydı; İK ikinci personel tablosu açmaz. Personel kendi izin
 *   talebini kullanıcı hesabına bağlı personel kartıyla girer (`hr.self`); İK (`hr.manage`) personel adına girer, onaylar, iptal eder.
 * - **Yıllık izin hakkı 4857 sayılı İş Kanunu md. 53'e göre** tamamlanan hizmet yılında doğar: 1–5 yıl 14 gün, 5'ten çok 15'ten az
 *   20 gün, 15 yıl ve üstü 26 gün; 18 yaşından küçük ve 50 yaşından büyük çalışana en az 20 gün. Bakiye = hak + elle düzeltme −
 *   onaylı yıllık izin. İzin süresine rastlayan hafta tatili ve resmî tatil günleri izinden sayılmaz (md. 56).
 * - **Onay:** izin talebi onay kuyruğuna `LEAVE` türüyle düşer (dört göz: isteyen onaylayamaz); İK ayarı onayı kapatırsa İK'nın
 *   girdiği izin doğrudan onaylıdır. Karar personele ve İK'ya zil (`HR`).
 * - **Puantaj günlüktür** (giriş / çıkış / mola); ay sonunda "Bordroya aktar" 51'in aylık puantajına (`PayrollAttendance`, kaynak
 *   `TIMESHEET`) eksik gün, çalışılan gün, fazla çalışma saati, bayram ve hafta tatili çalışmasını yazar; onaylı ay kilitlidir.
 * - **Vardiya** personel × gün × saat aralığıdır (gece vardiyası ertesi güne taşar). Çakışma reddedilir; iki vardiya arası 11 saatten
 *   az dinlenme ve haftalık 45 saat üstü **uyarıdır** (kaydı engellemez — otelcilikte denkleştirme yaygın).
 * - **Belge** dosyası diskte, kaydı veritabanında; süresi dolacak belgeler günlük işle İK'ya hatırlatılır.
 */

/* ─────────────── Sabitler ─────────────── */

/** Prisma `LeaveType` ile birebir. */
export const LEAVE_TYPES = Object.freeze(['ANNUAL', 'SICK', 'UNPAID', 'MATERNITY', 'PATERNITY', 'MARRIAGE', 'BEREAVEMENT', 'ADMINISTRATIVE', 'OTHER']);
export const LEAVE_TYPE_LABELS = Object.freeze({
  ANNUAL: 'Yıllık ücretli izin',
  SICK: 'Rapor (istirahat)',
  UNPAID: 'Ücretsiz izin',
  MATERNITY: 'Doğum izni',
  PATERNITY: 'Babalık izni',
  MARRIAGE: 'Evlilik izni',
  BEREAVEMENT: 'Ölüm (vefat) izni',
  ADMINISTRATIVE: 'İdari izin',
  OTHER: 'Diğer',
});
/** Takvim günüyle sayılan türler (rapor, ücretsiz izin, doğum izni); diğerleri iş günüyle (hafta tatili ve resmî tatil düşülür). */
export const CALENDAR_DAY_LEAVE_TYPES = Object.freeze(['SICK', 'UNPAID', 'MATERNITY', 'OTHER']);
/** Bordroda eksik gün sayılan türler ve SGK eksik gün nedeni (51'in `MISSING_DAY_REASONS` kodları). */
export const MISSING_DAY_LEAVE_TYPES = Object.freeze({ SICK: '01', UNPAID: '21', MATERNITY: '01' });
/** Yasal süreli izinlerin gün sınırı (iş günü): evlilik 3, vefat 3, babalık 5 (md. ek 2). Aşılırsa talep reddedilir. */
export const LEAVE_TYPE_MAX_DAYS = Object.freeze({ MARRIAGE: 3, BEREAVEMENT: 3, PATERNITY: 5 });

/** Prisma `LeaveStatus` ile birebir. */
export const LEAVE_STATUSES = Object.freeze(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
export const LEAVE_STATUS_LABELS = Object.freeze({ PENDING: 'Onay bekliyor', APPROVED: 'Onaylandı', REJECTED: 'Reddedildi', CANCELLED: 'İptal edildi' });

/** Prisma `TimesheetStatus` ile birebir. */
export const TIMESHEET_STATUSES = Object.freeze(['PRESENT', 'ABSENT', 'LEAVE', 'REST', 'HOLIDAY']);
export const TIMESHEET_STATUS_LABELS = Object.freeze({ PRESENT: 'Geldi', ABSENT: 'Gelmedi', LEAVE: 'İzinli', REST: 'Hafta tatili', HOLIDAY: 'Resmî tatil' });
/** Elle girilebilen durumlar (izinli günü izin kaydı belirler). */
export const TIMESHEET_MANUAL_STATUSES = Object.freeze(['PRESENT', 'ABSENT', 'REST', 'HOLIDAY']);

/** Prisma `EmployeeDocumentType` ile birebir. */
export const EMPLOYEE_DOCUMENT_TYPES = Object.freeze(['ID_COPY', 'CONTRACT', 'HEALTH_REPORT', 'HYGIENE_CERTIFICATE', 'CRIMINAL_RECORD', 'DIPLOMA', 'CERTIFICATE', 'RESIDENCE_PERMIT', 'WORK_PERMIT', 'SGK_ENTRY', 'OTHER']);
export const EMPLOYEE_DOCUMENT_TYPE_LABELS = Object.freeze({
  ID_COPY: 'Kimlik fotokopisi',
  CONTRACT: 'İş sözleşmesi',
  HEALTH_REPORT: 'Sağlık raporu (işe giriş / periyodik)',
  HYGIENE_CERTIFICATE: 'Hijyen eğitimi belgesi',
  CRIMINAL_RECORD: 'Adli sicil kaydı',
  DIPLOMA: 'Diploma',
  CERTIFICATE: 'Sertifika / eğitim',
  RESIDENCE_PERMIT: 'İkamet izni',
  WORK_PERMIT: 'Çalışma izni',
  SGK_ENTRY: 'SGK işe giriş bildirgesi',
  OTHER: 'Diğer',
});
/** Süresi olan belge türleri (bitiş tarihi beklenir). */
export const EXPIRING_DOCUMENT_TYPES = Object.freeze(['HEALTH_REPORT', 'HYGIENE_CERTIFICATE', 'RESIDENCE_PERMIT', 'WORK_PERMIT', 'CERTIFICATE']);
export const EMPLOYEE_DOCUMENT_CONTENT_TYPES = Object.freeze(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
export const EMPLOYEE_DOCUMENT_MAX_BYTES = 5_000_000;
export const EMPLOYEE_DOCUMENT_BODY_LIMIT = Math.ceil((EMPLOYEE_DOCUMENT_MAX_BYTES * 4) / 3) + 16_384;

export const WEEKDAY_LABELS = Object.freeze(['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']);
export const HR_DEFAULTS = Object.freeze({ weeklyRestDay: 0, dailyWorkMinutes: 450, weeklyWorkMinutes: 2700, leaveApprovalRequired: true, documentReminderDays: 30 });
/** İki vardiya arası en az dinlenme (uyarı eşiği). */
export const MIN_REST_BETWEEN_SHIFTS_MINUTES = 11 * 60;
export const MAX_SHIFT_MINUTES = 16 * 60;
export const MAX_SHIFT_BATCH = 300;
export const MAX_TIMESHEET_BATCH = 400;
export const MAX_LEAVE_DAYS = 365;
export const MAX_HR_TEXT_LENGTH = 300;
export const MAX_PUBLIC_HOLIDAYS = 60;
export const MAX_SCHEDULE_DAYS = 42;
export const HR_PAGE_SIZE = 50;

/**
 * Sabit tarihli ulusal bayram ve genel tatiller (2429 sayılı Kanun). Dinî bayramlar yıla göre değişir; ayarlardan elle eklenir.
 * @param {number} year
 * @returns {Array<{ date: string, name: string }>}
 */
export function fixedPublicHolidays(year) {
  return [
    { date: `${year}-01-01`, name: 'Yılbaşı' },
    { date: `${year}-04-23`, name: 'Ulusal Egemenlik ve Çocuk Bayramı' },
    { date: `${year}-05-01`, name: 'Emek ve Dayanışma Günü' },
    { date: `${year}-05-19`, name: "Atatürk'ü Anma, Gençlik ve Spor Bayramı" },
    { date: `${year}-07-15`, name: 'Demokrasi ve Millî Birlik Günü' },
    { date: `${year}-08-30`, name: 'Zafer Bayramı' },
    { date: `${year}-10-29`, name: 'Cumhuriyet Bayramı' },
  ];
}

/* ─────────────── Saf kurallar: tarih ─────────────── */

const DAY_MS = 86_400_000;
/** @param {string} text */
const dayMs = (text) => Date.parse(`${text}T00:00:00.000Z`);
/** @param {number} ms */
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** "YYYY-AA-GG" + gün. @param {string} text @param {number} days */
export function addDaysIso(text, days) {
  return isoOf(dayMs(text) + days * DAY_MS);
}

/** Haftanın günü (0 Pazar … 6 Cumartesi). @param {string} text */
export const weekdayOf = (text) => new Date(dayMs(text)).getUTCDay();

/** Günün bulunduğu haftanın pazartesisi. @param {string} text */
export function weekStartOf(text) {
  const weekday = weekdayOf(text);
  return addDaysIso(text, weekday === 0 ? -6 : 1 - weekday);
}

/** İki gün arasındaki günler (ikisi de dahil). @param {string} from @param {string} to */
export function dayListBetween(from, to) {
  const days = [];
  for (let ms = dayMs(from); ms <= dayMs(to); ms += DAY_MS) days.push(isoOf(ms));
  return days;
}

/**
 * Tamamlanan yıl (yıl dönümü esası): 2020-03-15 işe giren 2026-03-14'te 5, 2026-03-15'te 6 yıl tamamlamıştır.
 * @param {string} from @param {string} asOf
 */
export function completedYears(from, asOf) {
  if (asOf < from) return 0;
  const a = new Date(dayMs(from));
  const b = new Date(dayMs(asOf));
  let years = b.getUTCFullYear() - a.getUTCFullYear();
  const before = b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate());
  if (before) years -= 1;
  return Math.max(0, years);
}

/* ─────────────── Saf kurallar: izin ─────────────── */

/**
 * Yıllık izin hakkı (iş günü): tamamlanan hizmet yılı ve o yıl dönümündeki yaş.
 * @param {number} serviceYears tamamlanan yıl (≥ 1)
 * @param {number | null} age yıl dönümündeki yaş (doğum tarihi bilinmiyorsa null)
 */
export function annualLeaveEntitlement(serviceYears, age = null) {
  if (serviceYears < 1) return 0;
  const base = serviceYears <= 5 ? 14 : serviceYears < 15 ? 20 : 26;
  if (age !== null && (age < 18 || age > 50)) return Math.max(20, base);
  return base;
}

/**
 * Bir güne kadar doğan yıllık izin hakları: her iş yıl dönümünde bir kayıt.
 * @param {{ hireDate: string, birthDate?: string | null, asOf: string, terminationDate?: string | null }} input
 * @returns {Array<{ serviceYear: number, earnedOn: string, days: number }>}
 */
export function annualLeaveAccruals({ hireDate, birthDate = null, asOf, terminationDate = null }) {
  const until = terminationDate && terminationDate < asOf ? terminationDate : asOf;
  const accruals = [];
  const years = completedYears(hireDate, until);
  for (let year = 1; year <= years; year += 1) {
    const earnedOn = anniversary(hireDate, year);
    const age = birthDate ? completedYears(birthDate, earnedOn) : null;
    accruals.push({ serviceYear: year, earnedOn, days: annualLeaveEntitlement(year, age) });
  }
  return accruals;
}

/** İşe giriş gününün n. yıl dönümü (29 Şubat → 28 Şubat). @param {string} hireDate @param {number} years */
export function anniversary(hireDate, years) {
  const date = new Date(dayMs(hireDate));
  const month = date.getUTCMonth();
  const target = new Date(Date.UTC(date.getUTCFullYear() + years, month, date.getUTCDate()));
  if (target.getUTCMonth() !== month) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

/**
 * İzin gün sayısı: iş günüyle sayılan türlerde hafta tatili ve resmî tatil düşülür; takvim günüyle sayılanlarda düşülmez.
 * @param {{ type: string, startDate: string, endDate: string, weeklyRestDay: number, holidays: Iterable<string> }} input
 */
export function countLeaveDays({ type, startDate, endDate, weeklyRestDay, holidays }) {
  if (endDate < startDate) return 0;
  const all = dayListBetween(startDate, endDate);
  if (CALENDAR_DAY_LEAVE_TYPES.includes(type)) return all.length;
  const off = new Set(holidays);
  return all.filter((day) => weekdayOf(day) !== weeklyRestDay && !off.has(day)).length;
}

/**
 * Yıllık izin bakiyesi: hak + düzeltme − onaylı kullanım (gün, bir ondalık).
 * @param {{ accruals: Array<{ days: number }>, adjustments: Array<{ days: string | number }>, used: Array<{ days: string | number }> }} input
 */
export function annualLeaveBalance({ accruals, adjustments, used }) {
  const tenth = (value) => Math.round(Number(value) * 10);
  const earned = accruals.reduce((sum, row) => sum + tenth(row.days), 0);
  const adjusted = adjustments.reduce((sum, row) => sum + tenth(row.days), 0);
  const spent = used.reduce((sum, row) => sum + tenth(row.days), 0);
  return { earned: earned / 10, adjusted: adjusted / 10, used: spent / 10, balance: (earned + adjusted - spent) / 10 };
}

/** İki tarih aralığı kesişir mi (günler dahil). */
export const rangesOverlap = (a, b) => a.startDate <= b.endDate && b.startDate <= a.endDate;

/* ─────────────── Saf kurallar: vardiya ─────────────── */

/** "HH:MM" → dakika. @param {string} text */
export const minutesOf = (text) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));

/**
 * Vardiyanın zaman penceresi (ms, UTC gün tabanlı): bitiş başlangıçtan küçükse ertesi güne taşar.
 * @param {{ date: string, startTime: string, endTime: string }} shift
 */
export function shiftWindow(shift) {
  const start = dayMs(shift.date) + minutesOf(shift.startTime) * 60_000;
  let end = dayMs(shift.date) + minutesOf(shift.endTime) * 60_000;
  if (end <= start) end += DAY_MS;
  return { start, end };
}

/** Vardiyanın çalışma dakikası (mola düşülmüş). @param {{ date: string, startTime: string, endTime: string, breakMinutes?: number }} shift */
export function shiftMinutes(shift) {
  const { start, end } = shiftWindow(shift);
  return Math.max(0, Math.round((end - start) / 60_000) - (shift.breakMinutes ?? 0));
}

/** @param {{ date: string, startTime: string, endTime: string }} a @param {{ date: string, startTime: string, endTime: string }} b */
export function shiftsOverlap(a, b) {
  const x = shiftWindow(a);
  const y = shiftWindow(b);
  return x.start < y.end && y.start < x.end;
}

/**
 * Aynı personelin vardiyalarında uyarılar: çakışma (hata), 11 saatten az dinlenme ve haftalık norm aşımı (uyarı).
 * @param {Array<{ id?: string | null, date: string, startTime: string, endTime: string, breakMinutes?: number }>} shifts bir personelin vardiyaları
 * @param {{ weeklyWorkMinutes: number }} settings
 * @returns {{ conflicts: Array<[number, number]>, shortRests: Array<[number, number]>, weekOverload: Array<{ weekStart: string, minutes: number }> }}
 */
export function shiftProblems(shifts, settings) {
  const sorted = shifts.map((shift, index) => ({ index, ...shift, ...shiftWindow(shift) })).sort((a, b) => a.start - b.start);
  const conflicts = [];
  const shortRests = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (current.start < previous.end) conflicts.push([previous.index, current.index]);
    else if (current.start - previous.end < MIN_REST_BETWEEN_SHIFTS_MINUTES * 60_000) shortRests.push([previous.index, current.index]);
  }
  const weeks = new Map();
  for (const shift of shifts) {
    const weekStart = weekStartOf(shift.date);
    weeks.set(weekStart, (weeks.get(weekStart) ?? 0) + shiftMinutes(shift));
  }
  const weekOverload = [...weeks].filter(([, minutes]) => minutes > settings.weeklyWorkMinutes).map(([weekStart, minutes]) => ({ weekStart, minutes }));
  return { conflicts, shortRests, weekOverload };
}

/* ─────────────── Saf kurallar: puantaj ─────────────── */

/**
 * Günlük çalışma: çıkış − giriş − mola; gece çıkışı ertesi güne taşar. Norm üstü dakika fazla çalışmadır.
 * @param {{ clockIn?: string | null, clockOut?: string | null, breakMinutes?: number, dailyWorkMinutes: number }} input "HH:MM"
 * @returns {{ workedMinutes: number, overtimeMinutes: number }}
 */
export function timesheetMinutes({ clockIn, clockOut, breakMinutes = 0, dailyWorkMinutes }) {
  if (!clockIn || !clockOut) return { workedMinutes: 0, overtimeMinutes: 0 };
  let span = minutesOf(clockOut) - minutesOf(clockIn);
  if (span === 0) return { workedMinutes: 0, overtimeMinutes: 0 };
  if (span < 0) span += 24 * 60;
  const workedMinutes = Math.max(0, span - breakMinutes);
  return { workedMinutes, overtimeMinutes: Math.max(0, workedMinutes - dailyWorkMinutes) };
}

/**
 * Ayın bordro puantajı (51'in satırı): günlük puantaj + onaylı izinlerden.
 * - Eksik gün: gelmedi + rapor / ücretsiz / doğum izni günleri (ayın içinde kalan, takvim günü); 30'u aşamaz.
 * - Eksik gün nedeni: tek tür ise onun kodu (rapor 01, ücretsiz 21, devamsızlık 15), karışıksa 12.
 * - Çalışılan gün: "Geldi" günleri; bayram çalışması: resmî tatilde geldi; hafta tatili çalışması: hafta tatilinde geldi.
 * - Fazla çalışma: norm üstü dakikaların saati (iki ondalık).
 * @param {{
 *   year: number, month: number, weeklyRestDay: number, holidays: Iterable<string>,
 *   timesheets: Array<{ date: string, status: string, overtimeMinutes: number }>,
 *   leaves: Array<{ type: string, startDate: string, endDate: string }>,
 * }} input
 */
export function monthlyAttendance({ year, month, weeklyRestDay, holidays, timesheets, leaves }) {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = isoOf(Date.UTC(year, month, 0));
  const off = new Set(holidays);
  // İzin günündeki puantaj satırı sayılmaz (eksik gün izinden gelir; iki kez sayılmasın).
  const leaveDays = new Set();
  for (const leave of leaves) for (const date of dayListBetween(leave.startDate < first ? first : leave.startDate, leave.endDate > last ? last : leave.endDate)) leaveDays.add(date);
  let hasRecords = false;
  let workedDays = 0;
  let absentDays = 0;
  let holidayDays = 0;
  let weeklyRestDays = 0;
  let overtimeMinutes = 0;
  for (const row of timesheets) {
    if (row.date < first || row.date > last) continue;
    hasRecords = true;
    if (leaveDays.has(row.date)) continue;
    if (row.status === 'PRESENT') {
      workedDays += 1;
      if (off.has(row.date)) holidayDays += 1;
      else if (weekdayOf(row.date) === weeklyRestDay) weeklyRestDays += 1;
      overtimeMinutes += row.overtimeMinutes ?? 0;
    } else if (row.status === 'ABSENT') absentDays += 1;
  }
  const byReason = new Map();
  for (const leave of leaves) {
    const code = MISSING_DAY_LEAVE_TYPES[leave.type];
    if (!code) continue;
    const from = leave.startDate < first ? first : leave.startDate;
    const to = leave.endDate > last ? last : leave.endDate;
    if (to < from) continue;
    byReason.set(code, (byReason.get(code) ?? 0) + dayListBetween(from, to).length);
  }
  if (absentDays > 0) byReason.set('15', (byReason.get('15') ?? 0) + absentDays);
  const missingDays = Math.min(30, [...byReason.values()].reduce((sum, days) => sum + days, 0));
  const missingReason = missingDays === 0 ? null : byReason.size === 1 ? [...byReason.keys()][0] : '12';
  return {
    missingDays,
    missingReason,
    workedDays: Math.min(30, workedDays),
    overtimeHours: (Math.round((overtimeMinutes / 60) * 100) / 100).toFixed(2),
    holidayDays: String(holidayDays),
    weeklyRestDays: String(weeklyRestDays),
    hasRecords,
  };
}

/* ─────────────── Şemalar ─────────────── */

const uuid = (message) => z.string().uuid({ message });
const text = (max, label, min = 1) =>
  z
    .string({ error: `${label} zorunlu` })
    .trim()
    .min(min, `${label} en az ${min} karakter`)
    .max(max, `${label} en fazla ${max} karakter`);
const optionalText = (max, label) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter`)
    .nullish()
    .transform((value) => (value ? value : null));
const timeField = (label) => z.string({ error: `${label} zorunlu` }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, `${label} "SS:DD" biçiminde olmalı`);
const optionalTime = (label) =>
  z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, `${label} "SS:DD" biçiminde olmalı`)
    .nullish()
    .transform((value) => value || null);
const periodFields = { from: isoDayField.optional(), to: isoDayField.optional() };
const refinePeriod = (value, ctx) => {
  if (value.from && value.to && value.from > value.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
};

/** İzin talebi: personel kendi adına (`employeeId` boş) ya da İK personel adına. */
export const leaveCreateSchema = z
  .object({
    employeeId: uuid('Personel seçin').nullish().transform((value) => value ?? null),
    type: z.enum(LEAVE_TYPES, { error: 'İzin türü seçin' }),
    startDate: isoDayField,
    endDate: isoDayField,
    reason: optionalText(MAX_HR_TEXT_LENGTH, 'Açıklama'),
  })
  .superRefine((value, ctx) => {
    if (value.endDate < value.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Bitiş başlangıçtan önce olamaz' });
    if (dayListBetween(value.startDate, value.endDate).length > MAX_LEAVE_DAYS) ctx.addIssue({ code: 'custom', path: ['endDate'], message: `İzin en fazla ${MAX_LEAVE_DAYS} gün` });
  });

export const leaveCancelSchema = z.object({ reason: text(MAX_HR_TEXT_LENGTH, 'İptal sebebi', 3) });
export const leaveParamSchema = z.object({ leaveId: uuid('Geçersiz izin') });

export const leaveListQuerySchema = paginationQuerySchema
  .extend({
    ...periodFields,
    status: z.enum(LEAVE_STATUSES).optional(),
    type: z.enum(LEAVE_TYPES).optional(),
    employeeId: uuid('Geçersiz personel').optional(),
    departmentId: uuid('Geçersiz departman').optional(),
    search: z.string().trim().max(80).optional(),
  })
  .superRefine(refinePeriod);

/** Elle bakiye düzeltmesi: artı (devir, ek izin) ya da eksi (kesinti); yarım gün olabilir. */
export const leaveAdjustmentSchema = z.object({
  employeeId: uuid('Personel seçin'),
  days: z
    .string({ error: 'Gün zorunlu' })
    .trim()
    .regex(/^-?\d{1,3}(\.\d)?$/, 'Gün en fazla bir ondalıklı sayı olmalı (eksi olabilir)')
    .refine((value) => Number(value) !== 0 && Math.abs(Number(value)) <= MAX_LEAVE_DAYS, 'Gün sıfır olamaz, 365\'i aşamaz'),
  effectiveOn: isoDayField,
  reason: text(MAX_HR_TEXT_LENGTH, 'Gerekçe', 3),
});

export const leaveBalanceAsOfSchema = z.object({ asOf: isoDayField.optional() });

export const leaveBalanceQuerySchema = paginationQuerySchema.extend({
  asOf: isoDayField.optional(),
  departmentId: uuid('Geçersiz departman').optional(),
  search: z.string().trim().max(80).optional(),
});

/* Vardiya */

export const shiftInputSchema = z
  .object({
    id: uuid('Geçersiz vardiya').nullish().transform((value) => value ?? null),
    employeeId: uuid('Personel seçin'),
    departmentId: uuid('Departman seçin'),
    date: isoDayField,
    startTime: timeField('Başlangıç'),
    endTime: timeField('Bitiş'),
    breakMinutes: z.coerce.number().int().min(0, 'Mola eksi olamaz').max(480, 'Mola en fazla 8 saat').default(0),
    note: optionalText(MAX_HR_TEXT_LENGTH, 'Not'),
  })
  .superRefine((value, ctx) => {
    const minutes = shiftMinutes(value);
    if (minutes <= 0) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Vardiya süresi sıfır olamaz (mola süreden uzun)' });
    if (minutes > MAX_SHIFT_MINUTES) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Vardiya en fazla 16 saat' });
  });

/** Toplu çizelge yazımı: eklenen / değişen vardiyalar ve silinenler tek kayıt. */
export const shiftBatchSchema = z
  .object({
    upserts: z.array(shiftInputSchema).max(MAX_SHIFT_BATCH, `Bir seferde en fazla ${MAX_SHIFT_BATCH} vardiya`).default([]),
    deletes: z.array(uuid('Geçersiz vardiya')).max(MAX_SHIFT_BATCH).default([]),
  })
  .refine((value) => value.upserts.length + value.deletes.length > 0, 'Değişiklik yok');

export const shiftListQuerySchema = z
  .object({ from: isoDayField, to: isoDayField, departmentId: uuid('Geçersiz departman').optional(), employeeId: uuid('Geçersiz personel').optional() })
  .superRefine((value, ctx) => {
    refinePeriod(value, ctx);
    if (dayListBetween(value.from, value.to).length > MAX_SCHEDULE_DAYS) ctx.addIssue({ code: 'custom', path: ['to'], message: `En fazla ${MAX_SCHEDULE_DAYS} gün` });
  });

/** Geçen haftanın çizelgesini başka haftaya kopyala (hedef haftadaki mevcut vardiyalar korunur; çakışanlar atlanır). */
export const shiftCopyWeekSchema = z
  .object({ fromWeekStart: isoDayField, toWeekStart: isoDayField, departmentId: uuid('Geçersiz departman').optional() })
  .refine((value) => value.fromWeekStart !== value.toWeekStart, { message: 'Kaynak ve hedef hafta aynı', path: ['toWeekStart'] });

/* Puantaj */

export const timesheetInputSchema = z
  .object({
    employeeId: uuid('Personel seçin'),
    date: isoDayField,
    status: z.enum(TIMESHEET_MANUAL_STATUSES, { error: 'Durum seçin' }),
    clockIn: optionalTime('Giriş'),
    clockOut: optionalTime('Çıkış'),
    breakMinutes: z.coerce.number().int().min(0).max(480, 'Mola en fazla 8 saat').default(0),
    note: optionalText(MAX_HR_TEXT_LENGTH, 'Not'),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'PRESENT' && Boolean(value.clockIn) !== Boolean(value.clockOut)) ctx.addIssue({ code: 'custom', path: ['clockOut'], message: 'Giriş ve çıkış birlikte girilir' });
    if (value.status !== 'PRESENT' && (value.clockIn || value.clockOut)) ctx.addIssue({ code: 'custom', path: ['clockIn'], message: 'Yalnız "Geldi" gününde saat girilir' });
    if (value.clockIn && value.clockOut) {
      if (value.clockIn === value.clockOut) ctx.addIssue({ code: 'custom', path: ['clockOut'], message: 'Giriş ve çıkış aynı olamaz' });
      else if (timesheetMinutes({ clockIn: value.clockIn, clockOut: value.clockOut, breakMinutes: value.breakMinutes, dailyWorkMinutes: 0 }).workedMinutes > MAX_SHIFT_MINUTES) ctx.addIssue({ code: 'custom', path: ['clockOut'], message: 'Günlük çalışma en fazla 16 saat' });
    }
  });

export const timesheetBatchSchema = z.object({ rows: z.array(timesheetInputSchema).min(1, 'Satır yok').max(MAX_TIMESHEET_BATCH, `Bir seferde en fazla ${MAX_TIMESHEET_BATCH} satır`) });

export const timesheetListQuerySchema = paginationQuerySchema
  .extend({ from: isoDayField, to: isoDayField, departmentId: uuid('Geçersiz departman').optional(), employeeId: uuid('Geçersiz personel').optional(), search: z.string().trim().max(80).optional() })
  .superRefine((value, ctx) => {
    refinePeriod(value, ctx);
    if (dayListBetween(value.from, value.to).length > MAX_SCHEDULE_DAYS) ctx.addIssue({ code: 'custom', path: ['to'], message: `En fazla ${MAX_SCHEDULE_DAYS} gün` });
  });

/** Ayın puantajını bordroya aktar (51 `PayrollAttendance`, kaynak TIMESHEET). */
export const timesheetExportSchema = z.object({
  year: z.coerce.number().int().min(2024).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  departmentId: uuid('Geçersiz departman').optional().nullable(),
});

/* Belge */

const base64Field = (label, maxBytes) => z.string({ error: `${label} zorunlu` }).min(1, `${label} zorunlu`).max(Math.ceil((maxBytes * 4) / 3) + 4, `${label} çok büyük (en fazla ${Math.floor(maxBytes / 1_000_000)} MB)`);

export const employeeDocumentSchema = z
  .object({
    type: z.enum(EMPLOYEE_DOCUMENT_TYPES, { error: 'Belge türü seçin' }),
    title: text(120, 'Belge adı', 2),
    issuedOn: isoDayField.nullish().transform((value) => value ?? null),
    expiresOn: isoDayField.nullish().transform((value) => value ?? null),
    note: optionalText(MAX_HR_TEXT_LENGTH, 'Not'),
    file: z
      .object({
        name: text(160, 'Dosya adı'),
        contentType: z.enum(EMPLOYEE_DOCUMENT_CONTENT_TYPES, { error: 'Dosya PDF, JPEG, PNG ya da WebP olmalı' }),
        data: base64Field('Dosya', EMPLOYEE_DOCUMENT_MAX_BYTES),
      })
      .nullish()
      .transform((value) => value ?? null),
  })
  .superRefine((value, ctx) => {
    if (value.issuedOn && value.expiresOn && value.expiresOn < value.issuedOn) ctx.addIssue({ code: 'custom', path: ['expiresOn'], message: 'Bitiş düzenleme tarihinden önce olamaz' });
  });

export const employeeDocumentParamSchema = z.object({ documentId: uuid('Geçersiz belge') });
export const employeeDocumentListQuerySchema = paginationQuerySchema.extend({
  employeeId: uuid('Geçersiz personel').optional(),
  type: z.enum(EMPLOYEE_DOCUMENT_TYPES).optional(),
  /** Yalnız bu kadar gün içinde süresi dolacak / dolmuş belgeler. */
  expiringWithin: z.coerce.number().int().min(0).max(365).optional(),
  search: z.string().trim().max(80).optional(),
});

/* Ayar */

export const hrSettingsSchema = z
  .object({
    expectedUpdatedAt: z.union([expectedUpdatedAt, z.null()]).default(null),
    weeklyRestDay: z.coerce.number().int().min(0).max(6),
    dailyWorkMinutes: z.coerce.number().int().min(60, 'En az 1 saat').max(720, 'En fazla 12 saat'),
    weeklyWorkMinutes: z.coerce.number().int().min(60).max(4320),
    publicHolidays: z
      .array(z.object({ date: isoDayField, name: text(80, 'Tatil adı', 2) }))
      .max(MAX_PUBLIC_HOLIDAYS, `En fazla ${MAX_PUBLIC_HOLIDAYS} tatil`)
      .default([]),
    leaveApprovalRequired: z.boolean().default(true),
    documentReminderDays: z.coerce.number().int().min(0).max(365),
  })
  .superRefine((value, ctx) => {
    const dates = value.publicHolidays.map((holiday) => holiday.date);
    if (new Set(dates).size !== dates.length) ctx.addIssue({ code: 'custom', path: ['publicHolidays'], message: 'Aynı tarih iki kez' });
  });

export const hrEmployeeParamSchema = z.object({ employeeId: uuid('Geçersiz personel') });
