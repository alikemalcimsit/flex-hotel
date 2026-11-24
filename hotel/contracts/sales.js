import { z } from './locale.js';
import { BOARD_TYPES } from './constants.js';
import { dateField, expectedUpdatedAt, listQuerySchema } from './fields.js';

/**
 * Satış CRM sözleşmeleri (modül 36): fırsat (Lead), arama kaydı (CallLog) ve
 * teklif (Quote). Teklifin fiyatı **hazırlandığı anda kilitlenir** (gece gece
 * anlık görüntü): araya giren fiyat değişikliği müşteriye verilen sözü bozmaz.
 * Arama kaydı FlexAI 2.0'a hazır: kanal (PERSONEL / SESLİ AI), kayıt referansı
 * ve özet — 101 sesli santral buraya yazacak.
 */

const uuid = (message) => z.string().uuid({ message });

export const LEAD_STATUSES = Object.freeze(['NEW', 'QUOTED', 'WAITING', 'WON', 'LOST']);
export const LEAD_STATUS_LABELS = Object.freeze({
  NEW: 'Yeni',
  QUOTED: 'Teklif verildi',
  WAITING: 'Bekliyor',
  WON: 'Kazanıldı',
  LOST: 'Kaybedildi',
});
/** Pano sütun sırası. */
export const LEAD_BOARD_ORDER = LEAD_STATUSES;
/** Açık (sonuçlanmamış) fırsat durumları. */
export const LEAD_OPEN_STATUSES = Object.freeze(['NEW', 'QUOTED', 'WAITING']);

export const LEAD_SOURCES = Object.freeze(['PHONE', 'EMAIL', 'WALK_IN', 'WEB', 'OTHER']);
export const LEAD_SOURCE_LABELS = Object.freeze({
  PHONE: 'Telefon',
  EMAIL: 'E-posta',
  WALK_IN: 'Resepsiyon',
  WEB: 'Web',
  OTHER: 'Diğer',
});

export const CALL_CHANNELS = Object.freeze(['STAFF', 'VOICE_AI']);
export const CALL_CHANNEL_LABELS = Object.freeze({ STAFF: 'Personel', VOICE_AI: 'Sesli AI' });

export const CALL_DIRECTIONS = Object.freeze(['INBOUND', 'OUTBOUND']);
export const CALL_DIRECTION_LABELS = Object.freeze({ INBOUND: 'Gelen', OUTBOUND: 'Giden' });

export const CALL_OUTCOMES = Object.freeze(['INFO', 'QUOTE_REQUESTED', 'FOLLOW_UP', 'NO_ANSWER', 'NOT_INTERESTED', 'OTHER']);
export const CALL_OUTCOME_LABELS = Object.freeze({
  INFO: 'Bilgi verildi',
  QUOTE_REQUESTED: 'Teklif istedi',
  FOLLOW_UP: 'Tekrar aranacak',
  NO_ANSWER: 'Ulaşılamadı',
  NOT_INTERESTED: 'İlgilenmedi',
  OTHER: 'Diğer',
});

export const QUOTE_STATUSES = Object.freeze(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']);
export const QUOTE_STATUS_LABELS = Object.freeze({
  DRAFT: 'Taslak',
  SENT: 'Gönderildi',
  ACCEPTED: 'Kabul edildi',
  REJECTED: 'Reddedildi',
  EXPIRED: 'Süresi doldu',
});

export const MAX_LEAD_NAME = 150;
export const MAX_LEAD_COMPANY = 150;
export const MAX_LEAD_NOTES = 2000;
export const MAX_CALL_SUMMARY = 1000;
export const MAX_QUOTE_NOTES = 1000;
export const MAX_LOST_REASON = 300;
/** Teklif geçerliliği en fazla (gün). */
export const MAX_QUOTE_VALIDITY_DAYS = 60;

/* ─────────────── Fırsat (Lead) ─────────────── */

const phoneField = z
  .string()
  .trim()
  .max(40, 'Telefon en fazla 40 karakter')
  .refine((value) => value === '' || /^\+?[\d\s()-]{7,}$/.test(value), { message: 'Telefon geçersiz' })
  .transform((value) => value || null)
  .nullish();

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(200, 'E-posta en fazla 200 karakter')
  .refine((value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value), { message: 'E-posta geçersiz' })
  .transform((value) => value || null)
  .nullish();

const trimmedOptional = (max, label) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter`)
    .transform((value) => value || null)
    .nullish();

const leadBase = z.object({
  name: z.string({ error: 'Ad zorunlu' }).trim().min(2, 'Ad en az 2 karakter').max(MAX_LEAD_NAME, `Ad en fazla ${MAX_LEAD_NAME} karakter`),
  company: trimmedOptional(MAX_LEAD_COMPANY, 'Firma'),
  phone: phoneField,
  email: emailField,
  source: z.enum(LEAD_SOURCES, { error: 'Geçersiz kaynak' }).default('PHONE'),
  /** Mevcut misafir kartına bağ (M22; isteğe bağlı). */
  guestId: uuid('Geçersiz misafir').nullish(),
  /** İstenen konaklama (teklif formunu önceden doldurur; hepsi isteğe bağlı). */
  checkIn: dateField.nullish(),
  checkOut: dateField.nullish(),
  roomTypeId: uuid('Geçersiz oda tipi').nullish(),
  adults: z.coerce.number().int().min(1, 'En az 1 yetişkin').max(20, 'En fazla 20 yetişkin').nullish(),
  children: z.coerce.number().int().min(0, 'Çocuk negatif olamaz').max(20, 'En fazla 20 çocuk').nullish(),
  notes: trimmedOptional(MAX_LEAD_NOTES, 'Not'),
  /** Takip tarihi: "bugün aranacaklar" bu alandan beslenir. */
  followUpAt: dateField.nullish(),
});

/** Fırsatın kişisi en az bir kanaldan ulaşılabilir olmalı. */
function refineLeadContact(value, ctx) {
  if (!value.phone && !value.email) {
    ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Telefon ya da e-posta girin (müşteriye dönülecek)' });
  }
  if (value.checkIn && value.checkOut && value.checkOut <= value.checkIn) {
    ctx.addIssue({ code: 'custom', path: ['checkOut'], message: 'Çıkış tarihi girişten sonra olmalı' });
  }
}

export const createLeadSchema = leadBase.superRefine(refineLeadContact);
export const updateLeadSchema = leadBase.extend({ expectedUpdatedAt }).superRefine(refineLeadContact);

/** Pano durum geçişi: WON yalnız teklif kabulüyle (sunucu reddeder); LOST sebep ister. */
export const leadStatusSchema = z
  .object({
    status: z.enum(LEAD_STATUSES, { error: 'Geçersiz durum' }),
    lostReason: trimmedOptional(MAX_LOST_REASON, 'Kayıp sebebi'),
    expectedUpdatedAt,
  })
  .superRefine((value, ctx) => {
    if (value.status === 'LOST' && !value.lostReason) {
      ctx.addIssue({ code: 'custom', path: ['lostReason'], message: 'Kaybedilen fırsat için sebep yazın (raporlar buna dayanır)' });
    }
  });

export const leadListQuerySchema = listQuerySchema.extend({
  status: z.enum(LEAD_STATUSES, { error: 'Geçersiz durum' }).optional(),
  source: z.enum(LEAD_SOURCES, { error: 'Geçersiz kaynak' }).optional(),
  /** Yalnız takibi bugüne/geçmişe düşenler ("bugün aranacaklar"). */
  dueOnly: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((value) => value === true || value === 'true' || value === '1')
    .optional(),
});

export const leadParamSchema = z.object({ leadId: uuid('Geçersiz fırsat') });

/* ─────────────── Arama kaydı (CallLog) ─────────────── */

export const createCallLogSchema = z.object({
  channel: z.enum(CALL_CHANNELS, { error: 'Geçersiz kanal' }).default('STAFF'),
  direction: z.enum(CALL_DIRECTIONS, { error: 'Geçersiz yön' }).default('INBOUND'),
  phone: phoneField,
  outcome: z.enum(CALL_OUTCOMES, { error: 'Geçersiz sonuç' }),
  summary: z
    .string({ error: 'Özet zorunlu' })
    .trim()
    .min(3, 'Özet en az 3 karakter')
    .max(MAX_CALL_SUMMARY, `Özet en fazla ${MAX_CALL_SUMMARY} karakter`),
  /** Sesli AI kaydının referansı (101 sesli santral; FlexAI 2.0). */
  recordingRef: trimmedOptional(200, 'Kayıt referansı'),
  /** Sonuç "tekrar aranacak"sa fırsatın takip tarihi de güncellenir. */
  followUpAt: dateField.nullish(),
});

/* ─────────────── Teklif (Quote) ─────────────── */

const quoteBase = z.object({
  checkIn: dateField,
  checkOut: dateField,
  roomTypeId: uuid('Oda tipi seçin'),
  boardType: z.enum(BOARD_TYPES, { error: 'Geçersiz pansiyon tipi' }),
  adults: z.coerce.number().int().min(1, 'En az 1 yetişkin').max(20, 'En fazla 20 yetişkin'),
  children: z.coerce.number().int().min(0, 'Çocuk negatif olamaz').max(20, 'En fazla 20 çocuk').default(0),
  /** Teklifin son geçerlilik günü (dahil). */
  validUntil: dateField,
  notes: trimmedOptional(MAX_QUOTE_NOTES, 'Not'),
});

function refineQuote(value, ctx) {
  if (value.checkOut <= value.checkIn) {
    ctx.addIssue({ code: 'custom', path: ['checkOut'], message: 'Çıkış tarihi girişten sonra olmalı' });
  }
  const validityDays = Math.round((value.validUntil.getTime() - Date.now()) / 86_400_000);
  if (validityDays > MAX_QUOTE_VALIDITY_DAYS) {
    ctx.addIssue({ code: 'custom', path: ['validUntil'], message: `Teklif en fazla ${MAX_QUOTE_VALIDITY_DAYS} gün geçerli olabilir` });
  }
}

export const createQuoteSchema = quoteBase.superRefine(refineQuote);
export const updateQuoteSchema = quoteBase.extend({ expectedUpdatedAt }).superRefine(refineQuote);

export const quoteParamSchema = z.object({ quoteId: uuid('Geçersiz teklif') });
export const quoteVersionSchema = z.object({ expectedUpdatedAt });
export const rejectQuoteSchema = z.object({
  expectedUpdatedAt,
  reason: trimmedOptional(MAX_LOST_REASON, 'Sebep'),
});
