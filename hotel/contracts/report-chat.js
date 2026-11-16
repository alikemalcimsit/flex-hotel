import { looksLikeCardNumber } from './front-desk.js';
import { expectedUpdatedAt, isoDayField } from './fields.js';
import { z } from './locale.js';
import { FORECAST_DAYS } from './forecast.js';
import { REPORT_GROUPINGS, shiftDay } from './reports.js';

/**
 * Doğal dil raporlama (modül 24) sözleşmesi.
 *
 * Müdür soruyu yazar ("geçen ayın haftalık doluluğunu göster"); rapor ajanı soruyu bir **rapor tanımına** çevirir:
 * hangi rapor (doluluk, gelir, kırılım, tahmin, bütçe sapması), hangi dönem (göreli: "geçen ay" ya da sabit tarihler),
 * hangi gruplama. Raporu ajan değil **sistem** çalıştırır (MCP rapor araçları); tablodaki her rakam sistemden gelir,
 * model yalnız tanımı, grafik tipini ve kısa yorumu seçer.
 *
 * Kayıtlı rapor bu tanımı saklar: "tekrar çalıştır" AI'sız ve anında çalışır; göreli dönem çalıştırıldığı güne göre
 * yeniden hesaplanır ("geçen ay" her ay kayar).
 */

/* ─────────────── Raporlar ve dönemler ─────────────── */

/** Ajanın seçebildiği raporlar (her biri bir MCP aracına gider). */
export const REPORT_CHAT_REPORTS = Object.freeze(['OCCUPANCY', 'REVENUE', 'REVENUE_BY_ROOM_TYPE', 'REVENUE_BY_SOURCE', 'FORECAST', 'BUDGET_VARIANCE']);
export const REPORT_CHAT_REPORT_LABELS = Object.freeze({
  OCCUPANCY: 'Doluluk',
  REVENUE: 'Oda geliri, ADR, RevPAR',
  REVENUE_BY_ROOM_TYPE: 'Oda tipine göre gelir',
  REVENUE_BY_SOURCE: 'Kaynağa göre gelir',
  FORECAST: 'Doluluk ve gelir tahmini',
  BUDGET_VARIANCE: 'Bütçe sapması',
});

/** Göreli dönemler (çalıştırıldığı güne göre hesaplanır) ve sabit aralık. Haftalar pazartesi başlar. */
export const REPORT_PERIOD_PRESETS = Object.freeze([
  'TODAY',
  'YESTERDAY',
  'THIS_WEEK',
  'LAST_WEEK',
  'THIS_MONTH',
  'LAST_MONTH',
  'NEXT_MONTH',
  'THIS_YEAR',
  'LAST_YEAR',
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'LAST_90_DAYS',
  'NEXT_7_DAYS',
  'NEXT_30_DAYS',
  'NEXT_90_DAYS',
]);
export const REPORT_PERIODS = Object.freeze([...REPORT_PERIOD_PRESETS, 'CUSTOM']);
export const REPORT_PERIOD_LABELS = Object.freeze({
  TODAY: 'Bugün',
  YESTERDAY: 'Dün',
  THIS_WEEK: 'Bu hafta',
  LAST_WEEK: 'Geçen hafta',
  THIS_MONTH: 'Bu ay',
  LAST_MONTH: 'Geçen ay',
  NEXT_MONTH: 'Gelecek ay',
  THIS_YEAR: 'Bu yıl',
  LAST_YEAR: 'Geçen yıl',
  LAST_7_DAYS: 'Son 7 gün',
  LAST_30_DAYS: 'Son 30 gün',
  LAST_90_DAYS: 'Son 90 gün',
  NEXT_7_DAYS: 'Önümüzdeki 7 gün',
  NEXT_30_DAYS: 'Önümüzdeki 30 gün',
  NEXT_90_DAYS: 'Önümüzdeki 90 gün',
  CUSTOM: 'Seçilen tarihler',
});

export const REPORT_CHAT_BUDGET_SCOPES = Object.freeze(['MONTH', 'YTD']);

/** Grafik: çizgi, sütun ya da yalnız tablo. Yatay eksen tablonun ilk sütunu. */
export const REPORT_CHART_TYPES = Object.freeze(['LINE', 'BAR', 'TABLE']);
export const REPORT_CHART_TYPE_LABELS = Object.freeze({ LINE: 'Çizgi', BAR: 'Sütun', TABLE: 'Tablo' });
/** Grafikte en fazla seri. */
export const MAX_REPORT_CHART_SERIES = 3;

/** Prisma `ReportQuestionStatus` ile birebir. */
export const REPORT_QUESTION_STATUSES = Object.freeze(['PENDING', 'READY', 'FAILED']);
export const REPORT_QUESTION_STATUS_LABELS = Object.freeze({ PENDING: 'Hazırlanıyor', READY: 'Hazır', FAILED: 'Cevaplanamadı' });

export const MIN_REPORT_QUESTION_LENGTH = 5;
export const MAX_REPORT_QUESTION_LENGTH = 500;
export const MAX_REPORT_TITLE_LENGTH = 80;
export const MAX_REPORT_COMMENT_LENGTH = 800;
/** Kullanıcının aynı anda en fazla bekleyen sorusu. */
export const MAX_PENDING_REPORT_QUESTIONS = 3;
/** Sohbet ekranında gösterilen son soru sayısı. */
export const REPORT_CHAT_HISTORY = 30;
/** Kişi başı en fazla kayıtlı rapor. */
export const MAX_SAVED_REPORTS_PER_USER = 100;
/** Bekleyen soru bu süreden sonra "zamanında cevaplanmadı" sayılır (ms). */
export const REPORT_QUESTION_TIMEOUT_MS = 3 * 60_000;
/** Manuel görev modülü (ajan kapalıyken soru "rapor talebi" olarak personele düşer). */
export const REPORT_REQUEST_TASK_MODULE = 'Rapor talebi';

/** Gruplama yokken dönem uzunluğuna göre: ≤ 31 gün gün, ≤ 120 gün hafta, üstü ay. */
const AUTO_GROUP_LIMITS = Object.freeze({ DAY: 31, WEEK: 120 });

/* ─────────────── Dönem hesabı ─────────────── */

/** @param {string} day */
const parts = (day) => day.split('-').map(Number);
/** @param {number} year @param {number} month 1–12 @param {number} date */
const iso = (year, month, date) => new Date(Date.UTC(year, month - 1, date)).toISOString().slice(0, 10);
/** @param {string} day */
const mondayOf = (day) => {
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return shiftDay(day, -weekday);
};
/** @param {number} year @param {number} month */
const monthRange = (year, month) => ({ from: iso(year, month, 1), to: iso(year, month + 1, 0) });

/**
 * Göreli dönemin günleri (iş gününe göre).
 * @param {string} preset `REPORT_PERIOD_PRESETS`'ten
 * @param {string} today "YYYY-AA-GG" (otelin iş günü)
 * @returns {{ from: string, to: string }}
 */
export function resolvePeriod(preset, today) {
  const [year, month] = parts(today);
  const ranges = {
    TODAY: () => ({ from: today, to: today }),
    YESTERDAY: () => ({ from: shiftDay(today, -1), to: shiftDay(today, -1) }),
    THIS_WEEK: () => ({ from: mondayOf(today), to: shiftDay(mondayOf(today), 6) }),
    LAST_WEEK: () => ({ from: shiftDay(mondayOf(today), -7), to: shiftDay(mondayOf(today), -1) }),
    THIS_MONTH: () => monthRange(year, month),
    LAST_MONTH: () => monthRange(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1),
    NEXT_MONTH: () => monthRange(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1),
    THIS_YEAR: () => ({ from: iso(year, 1, 1), to: iso(year, 12, 31) }),
    LAST_YEAR: () => ({ from: iso(year - 1, 1, 1), to: iso(year - 1, 12, 31) }),
    LAST_7_DAYS: () => ({ from: shiftDay(today, -6), to: today }),
    LAST_30_DAYS: () => ({ from: shiftDay(today, -29), to: today }),
    LAST_90_DAYS: () => ({ from: shiftDay(today, -89), to: today }),
    NEXT_7_DAYS: () => ({ from: today, to: shiftDay(today, 6) }),
    NEXT_30_DAYS: () => ({ from: today, to: shiftDay(today, 29) }),
    NEXT_90_DAYS: () => ({ from: today, to: shiftDay(today, 89) }),
  };
  const range = ranges[preset];
  if (!range) throw new Error(`Bilinmeyen dönem: ${preset}`);
  return range();
}

/** @param {string} from @param {string} to */
const dayCount = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** Dönem uzunluğuna göre gruplama. @param {string} from @param {string} to */
export function autoGroupBy(from, to) {
  const days = dayCount(from, to);
  if (days <= AUTO_GROUP_LIMITS.DAY) return 'DAY';
  if (days <= AUTO_GROUP_LIMITS.WEEK) return 'WEEK';
  return 'MONTH';
}

const DAY_FORMAT = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DAY_YEAR_FORMAT = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** "1 Eki – 31 Eki 2026". @param {string} from @param {string} to */
export function rangeLabel(from, to) {
  const end = DAY_YEAR_FORMAT.format(new Date(`${to}T00:00:00Z`));
  if (from === to) return end;
  const start = (from.slice(0, 4) === to.slice(0, 4) ? DAY_FORMAT : DAY_YEAR_FORMAT).format(new Date(`${from}T00:00:00Z`));
  return `${start} – ${end}`;
}

/**
 * Rapor tanımını o günün somut araç çağrısına çevirir: hangi MCP aracı, hangi girdi, dönemin okunur adı.
 *
 * - Aralık raporları (doluluk, gelir, kırılımlar): dönem → `from` / `to`; gruplama yoksa uzunluğa göre.
 * - Tahmin: bugünden itibaren gün sayısı (dönem "önümüzdeki 7 / 30 gün" ya da `forecastDays`; en fazla 30).
 * - Bütçe sapması: dönemin ayı (bu ay, geçen ay, seçilen tarihin ayı); "bu yıl" / "geçen yıl" yılbaşından itibaren.
 *
 * @param {ReportSpec} spec doğrulanmış tanım
 * @param {string} today "YYYY-AA-GG"
 * @returns {{ tool: string, input: Record<string, unknown>, periodLabel: string }}
 */
export function resolveReportSpec(spec, today) {
  if (spec.report === 'FORECAST') {
    const presetDays = { NEXT_7_DAYS: 7, NEXT_30_DAYS: 30 }[spec.period];
    const days = Math.min(spec.forecastDays ?? presetDays ?? FORECAST_DAYS, FORECAST_DAYS);
    return { tool: 'get_forecast', input: { days }, periodLabel: `Önümüzdeki ${days} gün (${rangeLabel(today, shiftDay(today, days - 1))})` };
  }
  const range = spec.period === 'CUSTOM' ? { from: spec.from, to: spec.to } : resolvePeriod(spec.period, today);
  const named = spec.period === 'CUSTOM' ? rangeLabel(range.from, range.to) : `${REPORT_PERIOD_LABELS[spec.period]} (${rangeLabel(range.from, range.to)})`;
  if (spec.report === 'BUDGET_VARIANCE') {
    const yearly = spec.period === 'THIS_YEAR' || spec.period === 'LAST_YEAR';
    const [year, month] = parts(yearly ? range.to : range.from);
    const scope = yearly ? 'YTD' : (spec.budgetScope ?? 'MONTH');
    const effectiveMonth = spec.period === 'THIS_YEAR' ? parts(today)[1] : month;
    return { tool: 'explain_variance', input: { year, month: effectiveMonth, scope }, periodLabel: named };
  }
  if (spec.report === 'REVENUE_BY_ROOM_TYPE' || spec.report === 'REVENUE_BY_SOURCE') {
    const report = spec.report === 'REVENUE_BY_ROOM_TYPE' ? 'revenue_by_room_type' : 'revenue_by_source';
    return { tool: 'run_report_query', input: { report, from: range.from, to: range.to, groupBy: 'DAY' }, periodLabel: named };
  }
  const groupBy = spec.groupBy ?? autoGroupBy(range.from, range.to);
  return { tool: spec.report === 'OCCUPANCY' ? 'get_occupancy' : 'get_revenue', input: { from: range.from, to: range.to, groupBy }, periodLabel: named };
}

/* ─────────────── Şemalar ─────────────── */

/**
 * Rapor tanımı (ajanın "raporu çalıştır" ve "cevabı sun" araçları ile kayıtlı rapor aynı şemayı kullanır).
 * @typedef {z.infer<typeof reportSpecSchema>} ReportSpec
 */
export const reportSpecSchema = z
  .object({
    report: z.enum(REPORT_CHAT_REPORTS, { error: `Rapor şunlardan biri olmalı: ${REPORT_CHAT_REPORTS.join(', ')}` }),
    period: z.enum(REPORT_PERIODS, { error: `Dönem şunlardan biri olmalı: ${REPORT_PERIODS.join(', ')}` }),
    from: isoDayField.nullish().transform((value) => value ?? null),
    to: isoDayField.nullish().transform((value) => value ?? null),
    groupBy: z.enum(REPORT_GROUPINGS).nullish().transform((value) => value ?? null),
    forecastDays: z.number().int().min(1).max(FORECAST_DAYS).nullish().transform((value) => value ?? null),
    budgetScope: z.enum(REPORT_CHAT_BUDGET_SCOPES).nullish().transform((value) => value ?? null),
  })
  .superRefine((value, ctx) => {
    if (value.period === 'CUSTOM' && (!value.from || !value.to)) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'Seçilen tarihlerde başlangıç ve bitiş (from / to) yazılmalı' });
    }
    if (value.period === 'CUSTOM' && value.from && value.to && value.from > value.to) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
    }
  });

export const reportChartSchema = z.object({
  type: z.enum(REPORT_CHART_TYPES),
  /** Tablonun sayısal sütun anahtarları (yatay eksen ilk sütun). */
  series: z.array(z.string().max(40)).max(MAX_REPORT_CHART_SERIES).default([]),
});

const titleField = z
  .string({ error: 'Başlık yazın' })
  .trim()
  .min(1, 'Başlık yazın')
  .max(MAX_REPORT_TITLE_LENGTH, `Başlık en fazla ${MAX_REPORT_TITLE_LENGTH} karakter`)
  .refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz' });

/** Ajanın "cevabı sun" çağrısı. */
export const reportAnswerSchema = z.object({
  title: titleField,
  /** Model uzun yazarsa kırpılır (cevap düşmesin). */
  comment: z.string().trim().transform((value) => value.slice(0, MAX_REPORT_COMMENT_LENGTH)),
  spec: reportSpecSchema,
  chart: reportChartSchema,
});

export const askReportQuestionSchema = z.object({
  question: z
    .string({ error: 'Sorunuzu yazın' })
    .trim()
    .min(MIN_REPORT_QUESTION_LENGTH, `Soru en az ${MIN_REPORT_QUESTION_LENGTH} karakter`)
    .max(MAX_REPORT_QUESTION_LENGTH, `Soru en fazla ${MAX_REPORT_QUESTION_LENGTH} karakter`)
    .refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz' }),
  /** Önceki cevaba devam ("bunu aylık göster"): ajan o raporun tanımını bağlam olarak alır. */
  followUpOfId: z.string().uuid().nullish().transform((value) => value ?? null),
});

export const saveReportSchema = z.object({
  questionId: z.string().uuid('Soru geçersiz'),
  title: titleField,
  shared: z.boolean().default(false),
});

export const updateSavedReportSchema = z.object({
  expectedUpdatedAt,
  title: titleField.optional(),
  shared: z.boolean().optional(),
});

export const SAVED_REPORT_SCOPES = Object.freeze(['MINE', 'SHARED']);
export const SAVED_REPORT_SCOPE_LABELS = Object.freeze({ MINE: 'Benim raporlarım', SHARED: 'Paylaşılanlar' });
export const savedReportListQuerySchema = z.object({ scope: z.enum(SAVED_REPORT_SCOPES).default('MINE') });

