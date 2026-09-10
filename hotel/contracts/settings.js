import { z } from './locale.js';
import { BOARD_TYPES, TAX_APPLIES_TO } from './constants.js';
import { decimalField, dateField, EMAIL_PATTERN, expectedUpdatedAt, TIME_PATTERN } from './fields.js';

/**
 * Ayarlar modülünün girdi sözleşmeleri.
 *
 * Sunucu bunları istek doğrulamasında, tarayıcı ise formu göndermeden önce
 * kullanır. Tek kaynak olmaları şart: kuralları iki yerde elle tutmak,
 * er ya da geç "tarayıcı kabul etti, sunucu reddetti" durumunu doğurur.
 */

/* ─────────────── Otel bilgileri ─────────────── */

export const hotelInfoSchema = z.object({
  name: z
    .string({ error: 'Otel adı zorunlu' })
    .trim()
    .min(1, 'Otel adı zorunlu')
    .max(200, 'Otel adı en fazla 200 karakter'),
  address: z.string().trim().max(500, 'Adres en fazla 500 karakter').optional().nullable(),
  phone: z.string().trim().max(40, 'Telefon en fazla 40 karakter').optional().nullable(),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((value) => value === '' || EMAIL_PATTERN.test(value), { message: 'Geçerli bir e-posta girin' })
    .optional()
    .nullable(),
  logoUrl: z.string().trim().max(1000, 'Logo adresi en fazla 1000 karakter').optional().nullable(),
  currency: z
    .string({ error: 'Para birimi zorunlu' })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Para birimi 3 harfli ISO kodu olmalı (TRY, EUR, USD)'),
  timezone: z.string({ error: 'Saat dilimi zorunlu' }).trim().min(1, 'Saat dilimi zorunlu').max(100),
  checkInTime: z
    .string({ error: 'Giriş saati zorunlu' })
    .trim()
    .regex(TIME_PATTERN, 'Giriş saati SS:DD biçiminde olmalı'),
  checkOutTime: z
    .string({ error: 'Çıkış saati zorunlu' })
    .trim()
    .regex(TIME_PATTERN, 'Çıkış saati SS:DD biçiminde olmalı'),
});

export const updateHotelSchema = hotelInfoSchema.extend({ expectedUpdatedAt });

/* ─────────────── Genel parametreler ─────────────── */

const generalSettingsBase = z.object({
  defaultBoardType: z.enum(BOARD_TYPES, { error: 'Geçersiz pansiyon tipi' }),
  cancellationPolicyDays: z.coerce
    .number({ error: 'Gün sayısı sayı olmalı' })
    .int('Gün sayısı tam sayı olmalı')
    .min(0, 'Gün sayısı negatif olamaz')
    .max(365, 'Gün sayısı 365\'ten büyük olamaz'),
  cancellationPolicyPenaltyPct: decimalField({ scale: 2, min: 0, max: 100, label: 'Ceza oranı' }),
});

/**
 * Yarım iptal politikası sessizce hiçbir şey yapmaz: süre girilip ceza
 * girilmezse hiçbir rezervasyon ceza almaz, tersi de anlamsızdır.
 * @param {{ cancellationPolicyDays: number, cancellationPolicyPenaltyPct: string }} value
 * @param {import('zod').RefinementCtx} ctx
 */
function refineCancellationPolicy(value, ctx) {
  const penalty = Number(value.cancellationPolicyPenaltyPct);
  if (value.cancellationPolicyDays > 0 && penalty === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['cancellationPolicyPenaltyPct'],
      message: 'İptal süresi girildiyse ceza oranı da 0\'dan büyük olmalı',
    });
  }
  if (value.cancellationPolicyDays === 0 && penalty > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['cancellationPolicyDays'],
      message: 'Ceza oranı girildiyse kaç gün öncesine kadar ücretsiz olduğunu da belirtin',
    });
  }
}

export const generalSettingsSchema = generalSettingsBase.superRefine(refineCancellationPolicy);

export const updateGeneralSettingsSchema = generalSettingsBase
  .extend({ expectedUpdatedAt })
  .superRefine(refineCancellationPolicy);

/* ─────────────── Oda tipleri ─────────────── */

export const roomTypeInputSchema = z.object({
  code: z
    .string({ error: 'Kod zorunlu' })
    .trim()
    .toUpperCase()
    .min(1, 'Kod zorunlu')
    .max(20, 'Kod en fazla 20 karakter')
    .regex(/^[A-Z0-9_-]+$/, 'Kod yalnızca harf, rakam, - ve _ içerebilir'),
  name: z.string({ error: 'Ad zorunlu' }).trim().min(1, 'Ad zorunlu').max(200, 'Ad en fazla 200 karakter'),
  capacityAdults: z.coerce
    .number({ error: 'Yetişkin kapasitesi sayı olmalı' })
    .int('Yetişkin kapasitesi tam sayı olmalı')
    .min(1, 'En az 1 yetişkin kapasitesi olmalı')
    .max(20, 'Yetişkin kapasitesi 20\'den fazla olamaz'),
  capacityChildren: z.coerce
    .number({ error: 'Çocuk kapasitesi sayı olmalı' })
    .int('Çocuk kapasitesi tam sayı olmalı')
    .min(0, 'Çocuk kapasitesi negatif olamaz')
    .max(20, 'Çocuk kapasitesi 20\'den fazla olamaz'),
  basePrice: decimalField({ scale: 2, min: 0, max: 10_000_000, label: 'Taban fiyat' }),
  description: z.string().trim().max(2000, 'Açıklama en fazla 2000 karakter').optional().nullable(),
});

export const updateRoomTypeSchema = roomTypeInputSchema.extend({ expectedUpdatedAt });

/* ─────────────── Vergiler ─────────────── */

export const taxInputSchema = z.object({
  name: z
    .string({ error: 'Vergi adı zorunlu' })
    .trim()
    .min(1, 'Vergi adı zorunlu')
    .max(100, 'Vergi adı en fazla 100 karakter'),
  rate: decimalField({ scale: 3, min: 0, max: 100, label: 'Vergi oranı' }),
  isIncluded: z.coerce.boolean(),
  appliesTo: z
    .array(z.enum(TAX_APPLIES_TO, { error: 'Geçersiz kalem tipi' }))
    .min(1, 'En az bir kalem tipi seçin')
    .refine((values) => new Set(values).size === values.length, { message: 'Aynı kalem tipi iki kez seçilemez' }),
});

export const updateTaxSchema = taxInputSchema.extend({ expectedUpdatedAt });

/* ─────────────── Sezonlar ─────────────── */

const seasonBase = z.object({
  name: z
    .string({ error: 'Sezon adı zorunlu' })
    .trim()
    .min(1, 'Sezon adı zorunlu')
    .max(100, 'Sezon adı en fazla 100 karakter'),
  startDate: dateField,
  endDate: dateField,
  // 0 çarpan fiyatı sıfırlar; üst sınır insan hatasına karşı emniyet supabı.
  multiplier: decimalField({ scale: 3, min: 0.001, max: 100, label: 'Çarpan' }),
});

const rangeRefinement = /** @type {const} */ ([
  (value) => value.endDate >= value.startDate,
  { path: ['endDate'], message: 'Sezon bitiş tarihi başlangıç tarihinden önce olamaz' },
]);

export const seasonInputSchema = seasonBase.refine(...rangeRefinement);

export const updateSeasonSchema = seasonBase.extend({ expectedUpdatedAt }).refine(...rangeRefinement);
