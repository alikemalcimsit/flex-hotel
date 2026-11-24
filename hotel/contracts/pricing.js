import { z } from './locale.js';
import { BOARD_TYPES } from './constants.js';
import { decimalField, dateField, expectedUpdatedAt, listQuerySchema, queryBoolean } from './fields.js';

/**
 * Modül 28: Paket / pansiyon tipleri sözleşmeleri.
 *
 * Fiyat planı (`RatePlan`): oda tipi × pansiyon × tarih aralığında sabit gecelik
 * fiyat; sezon çarpanının yerine geçer. Paket (`Package`): oda + ek hizmet
 * (SPA, transfer, ...) demeti; seçildiğinde pansiyon paketten gelir ve oda gece
 * fiyatı paketin gecelik fiyatından hesaplanır.
 */

const uuid = (message) => z.string().uuid({ message });

export const MAX_RATE_PLAN_NAME = 100;
export const MAX_PACKAGE_NAME = 120;
export const MAX_PACKAGE_DESCRIPTION = 2000;
export const MAX_PACKAGE_COMPONENTS = 20;
export const MAX_PACKAGE_COMPONENT_LABEL = 100;
export const MAX_PACKAGE_COMPONENT_NOTE = 200;
export const MIN_BASE_OCCUPANCY = 1;
export const MAX_BASE_OCCUPANCY = 20;
export const MIN_RATE_PLAN_STAY = 1;
export const MAX_RATE_PLAN_STAY = 365;

/* ─────────────── Fiyat planları ─────────────── */

const boardField = z.enum(BOARD_TYPES, { error: 'Geçersiz pansiyon tipi' });

const ratePlanBase = z.object({
  roomTypeId: uuid('Oda tipi seçin'),
  name: z
    .string({ error: 'Plan adı zorunlu' })
    .trim()
    .min(1, 'Plan adı zorunlu')
    .max(MAX_RATE_PLAN_NAME, `Plan adı en fazla ${MAX_RATE_PLAN_NAME} karakter`),
  boardType: boardField,
  startDate: dateField,
  endDate: dateField,
  price: decimalField({ scale: 2, min: 0.01, max: 100_000_000, label: 'Gecelik fiyat' }),
  // `baseOccupancy` kişi fiyata dahil; fazlası `extraAdultRate` / `childRate` ile eklenir.
  baseOccupancy: z.coerce
    .number({ error: 'Dahil kişi sayısı sayı olmalı' })
    .int('Dahil kişi sayısı tam sayı olmalı')
    .min(MIN_BASE_OCCUPANCY, `En az ${MIN_BASE_OCCUPANCY} kişi fiyata dahil olmalı`)
    .max(MAX_BASE_OCCUPANCY, `Dahil kişi sayısı en fazla ${MAX_BASE_OCCUPANCY} olabilir`)
    .default(2),
  extraAdultRate: decimalField({ scale: 2, min: 0, max: 100_000_000, label: 'Kişi başı ek (yetişkin)' }).default('0'),
  childRate: decimalField({ scale: 2, min: 0, max: 100_000_000, label: 'Çocuk başı ek' }).default('0'),
  minStay: z
    .union([z.coerce.number().int(), z.null()])
    .optional()
    .transform((value) => (value === undefined || value === null || Number.isNaN(value) ? null : value))
    .refine((value) => value === null || (value >= MIN_RATE_PLAN_STAY && value <= MAX_RATE_PLAN_STAY), {
      message: `En az konaklama ${MIN_RATE_PLAN_STAY} ile ${MAX_RATE_PLAN_STAY} gece arasında olmalı`,
    }),
  isActive: queryBoolean.default(true),
});

const ratePlanRange = /** @type {const} */ ([
  (value) => value.endDate >= value.startDate,
  { path: ['endDate'], message: 'Plan bitiş tarihi başlangıç tarihinden önce olamaz' },
]);

export const ratePlanInputSchema = ratePlanBase.refine(...ratePlanRange);
export const updateRatePlanSchema = ratePlanBase.extend({ expectedUpdatedAt }).refine(...ratePlanRange);

export const ratePlanListQuerySchema = listQuerySchema.extend({
  roomTypeId: uuid('Geçersiz oda tipi').optional(),
  boardType: boardField.optional(),
  active: queryBoolean.optional(),
});

/* ─────────────── Paketler ─────────────── */

export const packageComponentSchema = z.object({
  label: z
    .string({ error: 'Bileşen adı zorunlu' })
    .trim()
    .min(1, 'Bileşen adı zorunlu')
    .max(MAX_PACKAGE_COMPONENT_LABEL, `Bileşen adı en fazla ${MAX_PACKAGE_COMPONENT_LABEL} karakter`),
  note: z
    .string()
    .trim()
    .max(MAX_PACKAGE_COMPONENT_NOTE, `Bileşen notu en fazla ${MAX_PACKAGE_COMPONENT_NOTE} karakter`)
    .optional()
    .nullable(),
});

const packageBase = z.object({
  code: z
    .string({ error: 'Kod zorunlu' })
    .trim()
    .toUpperCase()
    .min(2, 'Kod en az 2 karakter')
    .max(20, 'Kod en fazla 20 karakter')
    .regex(/^[A-Z0-9][A-Z0-9._-]+$/, 'Kod harf/rakam ile başlamalı; yalnızca harf, rakam, . _ - içerebilir'),
  name: z
    .string({ error: 'Paket adı zorunlu' })
    .trim()
    .min(2, 'Paket adı en az 2 karakter')
    .max(MAX_PACKAGE_NAME, `Paket adı en fazla ${MAX_PACKAGE_NAME} karakter`),
  description: z.string().trim().max(MAX_PACKAGE_DESCRIPTION, `Açıklama en fazla ${MAX_PACKAGE_DESCRIPTION} karakter`).optional().nullable(),
  boardType: boardField,
  nightlyPrice: decimalField({ scale: 2, min: 0.01, max: 100_000_000, label: 'Gecelik paket fiyatı' }),
  components: z
    .array(packageComponentSchema)
    .max(MAX_PACKAGE_COMPONENTS, `En fazla ${MAX_PACKAGE_COMPONENTS} bileşen eklenebilir`)
    .default([]),
  isActive: queryBoolean.default(true),
});

export const packageInputSchema = packageBase;
export const updatePackageSchema = packageBase.extend({ expectedUpdatedAt });

export const packageListQuerySchema = listQuerySchema.extend({
  boardType: boardField.optional(),
  active: queryBoolean.optional(),
});

/* ═══════════════ Modül 34: Dinamik fiyat / yield ═══════════════ */

/** Çarpan emniyet aralığı: bir onay fiyatı yarıdan aşağı indiremez, 3 katına çıkaramaz. */
export const PRICE_MULTIPLIER_MIN = 0.5;
export const PRICE_MULTIPLIER_MAX = 3;
/** Öneri ufku üst sınırı (gün). */
export const YIELD_MAX_HORIZON_DAYS = 90;

export const PRICE_SUGGESTION_SOURCES = Object.freeze(['RULE', 'AGENT']);
export const PRICE_SUGGESTION_SOURCE_LABELS = Object.freeze({
  RULE: 'Yield kuralı',
  AGENT: 'Fiyat ajanı (AI)',
});

export const PRICE_SUGGESTION_STATUSES = Object.freeze(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']);
export const PRICE_SUGGESTION_STATUS_LABELS = Object.freeze({
  PENDING: 'Onay bekliyor',
  APPROVED: 'Onaylandı',
  REJECTED: 'Reddedildi',
  EXPIRED: 'Süresi doldu',
});

/**
 * Yield kuralları (otel ayarı, `Hotel.settings.yield`):
 * - Doluluk ≥ `highOccupancyPct` → fiyat +`highAdjustmentPct`%.
 * - Doluluk ≤ `lowOccupancyPct` VE girişe ≤ `lowDaysOut` gün → fiyat −`lowAdjustmentPct`%.
 * Kapalıyken öneri üretilmez (fiyat ajanı ayrı; aktör panelinden yönetilir).
 */
const yieldSettingsBase = z.object({
  enabled: z.boolean().default(false),
  horizonDays: z.coerce
    .number({ error: 'Ufuk sayı olmalı' })
    .int('Ufuk tam sayı olmalı')
    .min(1, 'Ufuk en az 1 gün')
    .max(YIELD_MAX_HORIZON_DAYS, `Ufuk en fazla ${YIELD_MAX_HORIZON_DAYS} gün`)
    .default(30),
  highOccupancyPct: z.coerce.number().int().min(50, 'Yüksek doluluk eşiği en az 50').max(100, 'Eşik en fazla 100').default(80),
  highAdjustmentPct: z.coerce.number().int().min(1, 'Artış en az %1').max(100, 'Artış en fazla %100').default(10),
  lowOccupancyPct: z.coerce.number().int().min(0, 'Düşük doluluk eşiği negatif olamaz').max(70, 'Eşik en fazla 70').default(30),
  lowDaysOut: z.coerce.number().int().min(1, 'Kalan gün en az 1').max(60, 'Kalan gün en fazla 60').default(7),
  lowAdjustmentPct: z.coerce.number().int().min(1, 'İndirim en az %1').max(50, 'İndirim en fazla %50').default(15),
});

export const yieldSettingsSchema = yieldSettingsBase.superRefine((value, ctx) => {
  if (value.lowOccupancyPct >= value.highOccupancyPct) {
    ctx.addIssue({ code: 'custom', path: ['lowOccupancyPct'], message: 'Düşük doluluk eşiği yüksek eşikten küçük olmalı' });
  }
});

export const updateYieldSettingsSchema = yieldSettingsBase
  .extend({ expectedUpdatedAt })
  .superRefine((value, ctx) => {
    if (value.lowOccupancyPct >= value.highOccupancyPct) {
      ctx.addIssue({ code: 'custom', path: ['lowOccupancyPct'], message: 'Düşük doluluk eşiği yüksek eşikten küçük olmalı' });
    }
  });

/** Varsayılan yield ayarları (kayıt yoksa). */
export const DEFAULT_YIELD_SETTINGS = Object.freeze(yieldSettingsSchema.parse({}));

export const priceSuggestionListQuerySchema = listQuerySchema.extend({
  status: z.enum(PRICE_SUGGESTION_STATUSES, { error: 'Geçersiz durum' }).optional(),
  roomTypeId: uuid('Geçersiz oda tipi').optional(),
});

/** Onaylayan karar vermeden çarpanı düzenleyebilir (yalnız bekleyen öneride). */
export const updatePriceSuggestionSchema = z.object({
  multiplier: decimalField({ scale: 3, min: PRICE_MULTIPLIER_MIN, max: PRICE_MULTIPLIER_MAX, label: 'Çarpan' }),
  expectedUpdatedAt,
});

/** Fiyat geçmişi (uygulanmış ayarlar): dönem + isteğe bağlı oda tipi. */
export const priceHistoryQuerySchema = z
  .object({
    from: dateField,
    to: dateField,
    roomTypeId: uuid('Geçersiz oda tipi').optional(),
  })
  .superRefine((value, ctx) => {
    if (value.to < value.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
    }
  });
