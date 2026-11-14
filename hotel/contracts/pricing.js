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
