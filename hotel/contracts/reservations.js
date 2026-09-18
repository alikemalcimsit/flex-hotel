import { z } from './locale.js';
import { BOARD_TYPES, RESERVATION_SOURCES, RESERVATION_STATUSES } from './constants.js';
import { EMAIL_PATTERN, dateField, expectedUpdatedAt, paginationQuerySchema } from './fields.js';

/**
 * Rezervasyon sözleşmeleri (modül 4). Sunucu ve tarayıcı aynı şemayı kullanır.
 *
 * Tarih alanları gün hassasiyetli (`dateField` "YYYY-MM-DD" → UTC gün başı);
 * çıkış girişten en az bir gece sonra olmalı. Fiyat sunucuda hesaplanır — form
 * yalnızca önizleme ister (`quoteQuerySchema`).
 */

const MAX_NOTES = 2000;
const MAX_CANCEL_REASON = 500;

/** Konaklamaya katılan kişi sayısı ve oda tipi — hem tekli hem grup satırında ortak. */
const stayBase = {
  roomTypeId: z.string({ error: 'Oda tipi zorunlu' }).uuid({ message: 'Geçersiz oda tipi' }),
  checkIn: dateField,
  checkOut: dateField,
  adults: z.coerce.number({ error: 'Yetişkin sayısı zorunlu' }).int().min(1, 'En az 1 yetişkin').max(20, 'En fazla 20'),
  children: z.coerce.number({ error: 'Çocuk sayısı sayı olmalı' }).int().min(0).max(20, 'En fazla 20').default(0),
  boardType: z.enum(BOARD_TYPES, { error: 'Geçersiz pansiyon tipi' }).default('BB'),
};

/** Çıkış girişten en az bir gece sonra olmalı (müsaitlik yarı-açık `[)` aralık varsayar). */
const nightsRefinement = /** @type {const} */ ([
  (value) => value.checkOut.getTime() > value.checkIn.getTime(),
  { path: ['checkOut'], message: 'Çıkış tarihi girişten en az bir gece sonra olmalı' },
]);

/**
 * Misafir: ya mevcut (`id`) ya da yeni (`name` zorunlu). Telefon/e-posta ile
 * sunucu mevcut misafiri de eşleştirebilir.
 */
export const guestInputSchema = z
  .object({
    id: z.string().uuid({ message: 'Geçersiz misafir' }).optional(),
    name: z.string().trim().max(200, 'Ad en fazla 200 karakter').optional(),
    phone: z.string().trim().max(40, 'Telefon en fazla 40 karakter').optional(),
    email: z
      .string()
      .trim()
      .max(200)
      .refine((value) => value === '' || EMAIL_PATTERN.test(value), { message: 'Geçerli bir e-posta girin' })
      .optional(),
  })
  .refine((guest) => Boolean(guest.id) || Boolean(guest.name && guest.name.length > 0), {
    path: ['name'],
    message: 'Kayıtlı misafir seçin ya da ad girin',
  });

export const reservationInputSchema = z
  .object({
    guest: guestInputSchema,
    ...stayBase,
    notes: z.string().trim().max(MAX_NOTES, 'Not en fazla 2000 karakter').optional().nullable(),
  })
  .refine(...nightsRefinement);

export const updateReservationSchema = z
  .object({
    ...stayBase,
    notes: z.string().trim().max(MAX_NOTES, 'Not en fazla 2000 karakter').optional().nullable(),
    expectedUpdatedAt,
  })
  .refine(...nightsRefinement);

export const cancelReservationSchema = z.object({
  reason: z.string().trim().max(MAX_CANCEL_REASON, 'Sebep en fazla 500 karakter').optional().nullable(),
});

/** Grup: ortak misafir + birden çok oda satırı; her satır bir rezervasyon olur. */
export const groupReservationSchema = z.object({
  guest: guestInputSchema,
  rooms: z
    .array(z.object(stayBase).refine(...nightsRefinement))
    .min(1, 'En az bir oda satırı ekleyin')
    .max(50, 'Tek grupta en fazla 50 oda'),
  notes: z.string().trim().max(MAX_NOTES).optional().nullable(),
});

export const waitingListInputSchema = z
  .object({
    guest: guestInputSchema,
    ...stayBase,
    notes: z.string().trim().max(MAX_NOTES).optional().nullable(),
  })
  .refine(...nightsRefinement);

/** Fiyat önizleme (form). Tarihler sorgu dizesinden string gelir → dateField çevirir. */
export const quoteQuerySchema = z
  .object({
    roomTypeId: z.string().uuid({ message: 'Geçersiz oda tipi' }),
    checkIn: dateField,
    checkOut: dateField,
  })
  .refine(...nightsRefinement);

export const reservationListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  from: dateField.optional(),
  to: dateField.optional(),
  status: z.enum(RESERVATION_STATUSES, { error: 'Geçersiz durum' }).optional(),
  source: z.enum(RESERVATION_SOURCES, { error: 'Geçersiz kaynak' }).optional(),
});
