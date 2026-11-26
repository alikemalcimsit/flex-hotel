import { importAmount, importDay, normalizeHeader } from './data-import.js';
import { paginationQuerySchema } from './fields.js';
import { z } from './locale.js';
import { SURVEY_SENTIMENTS, SURVEY_TOPICS } from './surveys.js';

/**
 * Misafir yorumları ve duygu analizi sözleşmeleri (modül 54).
 *
 * Kararlar:
 * - **Yorumlar elle ya da dosyayla gelir:** Google Business Profile API'si OAuth + erişim onayı, Booking.com yorum API'si bağlantı
 *   ortaklığı ister; ikisi de hazır değil. Excel / CSV yüklemesinde Booking ve Google dışa aktarım başlıkları kendiliğinden eşleşir.
 *   Aynı yorum ikinci kez yüklenmez (kaynak + dış kimlik; yoksa kaynak + gün + yazar + metin).
 * - **AI etiketi** (insight-agent): duygu, −100…100 puan, konu (anket konularıyla aynı liste), departman, dil, Türkçe özet ve yorumun
 *   dilinde önerilen cevap. Personel etiketi elle düzeltebilir; cevap kopyalanıp platformda yayınlanır, sistem "cevaplandı" diye işaretler.
 * - **Anomali:** son 7 günde bir konudaki olumsuz yorum ≥ 3 ve önceki 4 haftanın haftalık ortalamasının ≥ 2 katı → müdüre zil.
 */

export const REVIEW_SOURCES = Object.freeze(['GOOGLE', 'BOOKING', 'TRIPADVISOR', 'EXPEDIA', 'AIRBNB', 'OTHER']);
export const REVIEW_SOURCE_LABELS = Object.freeze({ GOOGLE: 'Google', BOOKING: 'Booking.com', TRIPADVISOR: 'Tripadvisor', EXPEDIA: 'Expedia', AIRBNB: 'Airbnb', OTHER: 'Diğer' });
/** Kaynağın puan ölçeği (en yüksek puan). */
export const REVIEW_SOURCE_SCALES = Object.freeze({ GOOGLE: 5, BOOKING: 10, TRIPADVISOR: 5, EXPEDIA: 10, AIRBNB: 5, OTHER: 5 });

export const REVIEW_TOPICS = SURVEY_TOPICS;
export const REVIEW_SENTIMENTS = SURVEY_SENTIMENTS;
export const REVIEW_DEPARTMENTS = Object.freeze(['FRONT_OFFICE', 'HOUSEKEEPING', 'FOOD_BEVERAGE', 'MAINTENANCE', 'SPA', 'MANAGEMENT', 'OTHER']);
export const REVIEW_DEPARTMENT_LABELS = Object.freeze({
  FRONT_OFFICE: 'Ön büro',
  HOUSEKEEPING: 'Kat hizmetleri',
  FOOD_BEVERAGE: 'Yiyecek-içecek',
  MAINTENANCE: 'Teknik servis',
  SPA: 'Spa',
  MANAGEMENT: 'Yönetim',
  OTHER: 'Diğer',
});

export const REVIEW_ANALYSIS_STATUSES = Object.freeze(['PENDING', 'DONE', 'FAILED', 'SKIPPED']);
export const REVIEW_ANALYSIS_STATUS_LABELS = Object.freeze({ PENDING: 'Analiz bekliyor', DONE: 'Analiz edildi', FAILED: 'Analiz edilemedi', SKIPPED: 'Metin yok' });
export const REVIEW_REPLY_STATUSES = Object.freeze(['NONE', 'DRAFT', 'REPLIED', 'NOT_NEEDED']);
export const REVIEW_REPLY_STATUS_LABELS = Object.freeze({ NONE: 'Cevap yok', DRAFT: 'Taslak', REPLIED: 'Cevaplandı', NOT_NEEDED: 'Cevap gerekmiyor' });

export const MAX_REVIEW_TEXT = 6000;
export const MAX_REVIEW_REPLY = 3000;
export const MAX_REVIEW_IMPORT_ROWS = 2000;
/** Anomali: en az bu kadar olumsuz yorum ve tabanın en az bu katı. */
export const REVIEW_ANOMALY_MIN_COUNT = 3;
export const REVIEW_ANOMALY_FACTOR = 2;
export const REVIEW_ANOMALY_BASELINE_WEEKS = 4;

/* ─────────────── Saf kurallar ─────────────── */

/** Puan → 0–100. @param {number | string | null} rating @param {number} scale */
export function reviewRatingPct(rating, scale) {
  const value = Number(rating);
  if (rating === null || rating === '' || !Number.isFinite(value) || !scale) return null;
  return Math.max(0, Math.min(100, Math.round((value / scale) * 100)));
}

/** Metnin karşılaştırma için sadeleşmiş hâli. @param {string | null | undefined} text */
const canonical = (text) => String(text ?? '').toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();

/**
 * Aynı yorumun ikinci kez girilmemesi için anahtar (sunucu özetini alır). Dış kimlik varsa yalnız o.
 * Dış kimlik yoksa puan da anahtardadır: metinsiz iki anonim yorum (5 ve 1 puan) ayrı kalır. Sunucu metni özetler (uzunluk sınırı yok).
 * @param {{ source: string, externalId?: string | null, reviewedAt: string, authorName?: string | null, text?: string | null, title?: string | null, rating?: number | null }} review
 */
export function reviewDedupeBasis(review) {
  if (review.externalId) return `${review.source}|id|${String(review.externalId).trim()}`;
  return `${review.source}|${review.reviewedAt}|${review.rating ?? ''}|${canonical(review.authorName)}|${canonical(review.title)}|${canonical(review.text)}`;
}

/** "YYYY-AA-GG" gerçek bir takvim günü mü (30 Şubat değil)? @param {string} text */
export function isRealDay(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/** Google dışa aktarımındaki yıldız sözcükleri. */
const STAR_WORDS = Object.freeze({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 });

/**
 * Puan hücresi → kaynağın ölçeğinde sayı: "8,4", "4/5" (paydaya göre ölçeğe çevrilir), "FIVE"; okunamazsa NaN, boşsa null.
 * @param {string} raw @param {number} scale
 */
export function readRating(raw, scale) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const word = STAR_WORDS[text.toUpperCase()];
  if (word) return (word / 5) * scale;
  const fraction = /^(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)$/.exec(text);
  if (fraction) {
    const value = Number(fraction[1].replace(',', '.'));
    const over = Number(fraction[2].replace(',', '.'));
    return over > 0 ? (value / over) * scale : Number.NaN;
  }
  return Number(importAmount(text));
}

/** Saatli ISO değeri ("…T22:30:00Z", "+03:00") otelin saat diliminde güne çevirir. @param {string} text @param {string} timeZone */
function zonedDay(text, timeZone) {
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** "YYYY-AA-GG" gününün haftasının pazartesisi. @param {string} day */
export function reviewWeekStart(day) {
  const date = new Date(`${day}T00:00:00.000Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Olumsuz konu artışları.
 * @param {Record<string, number>} current son 7 günün konu başına olumsuz sayısı
 * @param {Record<string, number[]>} previous önceki haftaların konu başına olumsuz sayıları (en çok 4)
 * @returns {Array<{ topic: string, count: number, baseline: number, factor: number }>} artanlar, büyükten küçüğe
 */
export function detectReviewAnomalies(current, previous) {
  return Object.entries(current)
    .map(([topic, count]) => {
      const weeks = previous[topic] ?? [];
      const baseline = weeks.length ? weeks.reduce((sum, value) => sum + value, 0) / REVIEW_ANOMALY_BASELINE_WEEKS : 0;
      const factor = count / Math.max(1, baseline);
      return { topic, count, baseline: Math.round(baseline * 10) / 10, factor: Math.round(factor * 10) / 10 };
    })
    .filter((row) => row.topic !== 'OTHER' && row.count >= REVIEW_ANOMALY_MIN_COUNT && row.factor >= REVIEW_ANOMALY_FACTOR)
    .sort((a, b) => b.factor - a.factor || b.count - a.count);
}

/* ─────────────── İçe aktarma (Excel / CSV) ─────────────── */

/** Alanlar ve başlık eş anlamlıları (Booking ve Google dışa aktarımları dahil). */
export const REVIEW_IMPORT_FIELDS = Object.freeze([
  { key: 'reviewedAt', label: 'Tarih', required: true, hint: 'GG.AA.YYYY ya da YYYY-AA-GG', aliases: ['tarih', 'yorum tarihi', 'değerlendirme tarihi', 'review date', 'date', 'create time', 'created', 'published date', 'reviewdate'] },
  { key: 'rating', label: 'Puan', hint: 'Kaynağın ölçeğinde (Booking 10, Google 5)', aliases: ['puan', 'genel puan', 'skor', 'review score', 'score', 'rating', 'star rating', 'stars', 'overall rating', 'overall'] },
  { key: 'text', label: 'Yorum', aliases: ['yorum', 'yorum metni', 'metin', 'comment', 'review', 'review text', 'text', 'content'] },
  { key: 'positive', label: 'Olumlu yorum', hint: 'Booking: "Positive review"', aliases: ['olumlu', 'olumlu yorum', 'beğenilen', 'positive review', 'positive', 'liked', 'pros'] },
  { key: 'negative', label: 'Olumsuz yorum', hint: 'Booking: "Negative review"', aliases: ['olumsuz', 'olumsuz yorum', 'beğenilmeyen', 'negative review', 'negative', 'disliked', 'cons'] },
  { key: 'title', label: 'Başlık', aliases: ['başlık', 'yorum başlığı', 'review title', 'title', 'headline'] },
  { key: 'authorName', label: 'Yazan', aliases: ['yazan', 'misafir', 'misafir adı', 'ad', 'guest name', 'guest', 'reviewer', 'reviewer name', 'author', 'name'] },
  { key: 'externalId', label: 'Yorum no', hint: 'Platformdaki kimlik (varsa)', aliases: ['yorum no', 'yorum id', 'review id', 'reviewid', 'id', 'review number'] },
  { key: 'language', label: 'Dil', hint: 'tr, en, de…', aliases: ['dil', 'language', 'lang'] },
  { key: 'url', label: 'Bağlantı', aliases: ['bağlantı', 'link', 'url', 'review url'] },
  { key: 'existingReply', label: 'Otelin cevabı', hint: 'Platformda zaten verilmişse', aliases: ['otel cevabı', 'otelin cevabı', 'cevap', 'property reply', 'reply', 'response', 'owner response', 'management response'] },
]);

/** @param {unknown[]} headers @returns {Record<string, number | null>} */
export function suggestReviewMapping(headers) {
  const normalized = headers.map(normalizeHeader);
  const used = new Set();
  return Object.fromEntries(
    REVIEW_IMPORT_FIELDS.map((field) => {
      const names = [field.label, ...field.aliases].map(normalizeHeader);
      const index = normalized.findIndex((header, position) => !used.has(position) && names.includes(header));
      if (index >= 0) used.add(index);
      return [field.key, index >= 0 ? index : null];
    }),
  );
}

const cell = z.union([z.string(), z.number()]).nullish().transform((value) => (value == null ? '' : String(value).trim()));
const text = (max, label) => cell.refine((value) => value.length <= max, { message: `${label} en fazla ${max} karakter` }).transform((value) => value || null);

/** Dosya satırı (alan anahtarlarıyla) — ham. */
export const reviewImportRowSchema = z.object({
  reviewedAt: cell,
  rating: cell,
  text: text(MAX_REVIEW_TEXT, 'Yorum'),
  positive: text(MAX_REVIEW_TEXT, 'Olumlu yorum'),
  negative: text(MAX_REVIEW_TEXT, 'Olumsuz yorum'),
  title: text(300, 'Başlık'),
  authorName: text(120, 'Yazan'),
  externalId: text(120, 'Yorum no'),
  language: text(10, 'Dil'),
  url: text(500, 'Bağlantı'),
  existingReply: text(MAX_REVIEW_REPLY, 'Otelin cevabı'),
});

/** Excel'in seri gün sayısı (1900 tabanlı) → "YYYY-AA-GG". @param {string} value */
function excelSerialDay(value) {
  if (!/^\d{5}(\.\d+)?$/.test(value)) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(value)) * 86_400_000);
  return date.toISOString().slice(0, 10);
}

/**
 * Satırı okur: tarih (yerel, ISO, Excel seri sayısı, ISO saatli), puan (ölçek içinde), metin (yoksa olumlu / olumsuz birleşir).
 * @param {Record<string, unknown>} raw alan anahtarlı satır
 * @param {{ source: string, scale: number, today: string, timeZone?: string }} context `today`: otelin takvim günü
 * @returns {{ ok: true, value: any } | { ok: false, errors: string[] }}
 */
export function parseReviewImportRow(raw, { source, scale, today, timeZone = 'Europe/Istanbul' }) {
  const parsed = reviewImportRowSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) };
  const row = parsed.data;
  const errors = [];
  const timed = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(row.reviewedAt);
  const dayText = timed
    ? zonedDay(row.reviewedAt, timeZone)
    : /^\d{4}-\d{2}-\d{2}/.test(row.reviewedAt)
      ? row.reviewedAt.slice(0, 10)
      : (excelSerialDay(row.reviewedAt) ?? importDay(row.reviewedAt.split(/[ T]/)[0]));
  const reviewedAt = dayText && isRealDay(dayText) ? dayText : null;
  if (!reviewedAt) errors.push('Tarih okunamadı (GG.AA.YYYY ya da YYYY-AA-GG)');
  else if (reviewedAt > today) errors.push('Tarih gelecekte olamaz');
  let rating = null;
  if (row.rating) {
    const value = readRating(row.rating, scale);
    if (value === null || !Number.isFinite(value) || value < 0 || value > scale) errors.push(`Puan 0–${scale} arasında olmalı`);
    else rating = Math.round(value * 10) / 10;
  }
  const parts = [row.positive && `Olumlu: ${row.positive}`, row.negative && `Olumsuz: ${row.negative}`].filter(Boolean);
  const body = row.text ?? (parts.length ? parts.join('\n') : null);
  if (!body && !row.rating) errors.push('Yorum metni ya da puan olmalı');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      source,
      reviewedAt,
      rating,
      ratingScale: scale,
      text: body ? body.slice(0, MAX_REVIEW_TEXT) : null,
      title: row.title,
      authorName: row.authorName,
      externalId: row.externalId,
      // Yalnız ISO kodu ("tr", "en-GB"); "German" gibi adlar boş kalır, dili AI bulur.
      language: row.language && /^[a-z]{2}([-_][a-z0-9]+)?$/i.test(row.language) ? row.language.slice(0, 2).toLowerCase() : null,
      url: row.url && /^https?:\/\//.test(row.url) ? row.url : null,
      existingReply: row.existingReply,
    },
  };
}

/* ─────────────── Şemalar ─────────────── */

const optional = (max) => z.string().trim().max(max, `En fazla ${max} karakter`).transform((value) => value || null).nullish();

export const reviewCreateSchema = z
  .object({
    source: z.enum(REVIEW_SOURCES, { error: 'Kaynak seçin' }),
    reviewedAt: z.string().refine(isRealDay, { message: 'Geçerli bir tarih girin (YYYY-AA-GG)' }),
    rating: z.number().min(0).max(10).nullish(),
    text: optional(MAX_REVIEW_TEXT),
    title: optional(300),
    authorName: optional(120),
    externalId: optional(120),
    language: z.string().trim().regex(/^[a-z]{2}$/, 'Dil iki harf (tr, en…)').nullish(),
    url: z.string().trim().max(500).refine((value) => /^https?:\/\/[^\s]+$/i.test(value), { message: 'Bağlantı http(s):// ile başlamalı' }).nullish(),
    existingReply: optional(MAX_REVIEW_REPLY),
  })
  .superRefine((value, ctx) => {
    if (!value.text && (value.rating === null || value.rating === undefined)) ctx.addIssue({ code: 'custom', path: ['text'], message: 'Yorum metni ya da puan girin' });
    if (value.rating !== null && value.rating !== undefined && value.rating > REVIEW_SOURCE_SCALES[value.source]) ctx.addIssue({ code: 'custom', path: ['rating'], message: `${REVIEW_SOURCE_LABELS[value.source]} puanı en çok ${REVIEW_SOURCE_SCALES[value.source]}` });
  });

/** Personelin etiket düzeltmesi (AI etiketinin yerine geçer). */
export const reviewTagSchema = z.object({
  sentiment: z.enum(REVIEW_SENTIMENTS, { error: 'Duygu seçin' }),
  topics: z.array(z.enum(REVIEW_TOPICS)).max(5).default([]),
  departments: z.array(z.enum(REVIEW_DEPARTMENTS)).max(4).default([]),
});

export const reviewReplySchema = z.object({
  status: z.enum(['DRAFT', 'REPLIED', 'NOT_NEEDED']),
  replyText: z.string().trim().max(MAX_REVIEW_REPLY, `En fazla ${MAX_REVIEW_REPLY} karakter`).transform((value) => value || null).nullish(),
}).superRefine((value, ctx) => {
  if (value.status !== 'NOT_NEEDED' && !value.replyText) ctx.addIssue({ code: 'custom', path: ['replyText'], message: 'Cevap metnini yazın' });
});

export const reviewImportSchema = z.object({
  requestId: z.string().uuid({ message: 'Geçersiz istek kimliği' }),
  dryRun: z.boolean().default(true),
  source: z.enum(REVIEW_SOURCES, { error: 'Kaynak seçin' }),
  /** Boşsa kaynağın ölçeği. */
  ratingScale: z.number().int().min(1).max(100).nullish(),
  fileName: z.string().trim().max(200).nullish(),
  rows: z.array(z.record(z.string(), z.unknown())).min(1, 'Dosyada satır yok').max(MAX_REVIEW_IMPORT_ROWS, `Bir seferde en fazla ${MAX_REVIEW_IMPORT_ROWS} satır`),
});

export const reviewListQuerySchema = paginationQuerySchema.extend({
  source: z.enum(REVIEW_SOURCES).optional(),
  sentiment: z.enum(REVIEW_SENTIMENTS).optional(),
  topic: z.enum(REVIEW_TOPICS).optional(),
  department: z.enum(REVIEW_DEPARTMENTS).optional(),
  replyStatus: z.enum(REVIEW_REPLY_STATUSES).optional(),
  analysisStatus: z.enum(REVIEW_ANALYSIS_STATUSES).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(['recent', 'lowest', 'highest']).default('recent'),
});

export const reviewTrendQuerySchema = z.object({
  weeks: z.coerce.number().int().min(4).max(52).default(12),
  source: z.enum(REVIEW_SOURCES).optional(),
});

export const reviewParamsSchema = z.object({ reviewId: z.string().uuid({ message: 'Geçersiz yorum' }) });
