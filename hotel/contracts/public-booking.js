import { z } from './locale.js';
import { BOARD_TYPES } from './constants.js';
import { dateField } from './fields.js';
import { couponCodeField } from './promotions.js';

/** Boş metin "kupon yok" demektir. */
const optionalCouponCode = z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? null : value), couponCodeField.nullish());

/**
 * Modül 32: Online rezervasyon motoru (web widget) — public uçların
 * sözleşmeleri. Uçlar oturumsuzdur; kimlik web chat kanalının genel anahtarı
 * (`wc_...`) + izinli site adresi (Origin) + IP hız sınırıdır. Girdiler
 * misafirden gelir: dar sınırlar, hiçbir iç kimlik (acente, promosyon id)
 * kabul edilmez ve yanıtta dönmez.
 */

export const PUBLIC_BOOKING_MAX_NIGHTS = 30;
export const PUBLIC_BOOKING_MAX_ADULTS = 6;
export const PUBLIC_BOOKING_MAX_CHILDREN = 4;
export const PUBLIC_BOOKING_MAX_NOTES = 500;
/** Yanıttaki müsaitlik bu sayıda kırpılır: "5+" — envanter sızmasın. */
export const PUBLIC_BOOKING_AVAILABILITY_CAP = 5;

export const publicBookingKeySchema = z.object({
  key: z.string().regex(/^wc_[A-Za-z0-9_-]{16,40}$/, 'Geçersiz anahtar'),
});

const stayShape = {
  checkIn: dateField,
  checkOut: dateField,
  adults: z.coerce
    .number({ error: 'Yetişkin sayısı gerekli' })
    .int()
    .min(1, 'En az 1 yetişkin')
    .max(PUBLIC_BOOKING_MAX_ADULTS, `En fazla ${PUBLIC_BOOKING_MAX_ADULTS} yetişkin`),
  children: z.coerce
    .number()
    .int()
    .min(0, 'Çocuk sayısı negatif olamaz')
    .max(PUBLIC_BOOKING_MAX_CHILDREN, `En fazla ${PUBLIC_BOOKING_MAX_CHILDREN} çocuk`)
    .default(0),
  boardType: z.enum(BOARD_TYPES, { error: 'Geçersiz pansiyon tipi' }).optional(),
  couponCode: optionalCouponCode,
};

/** Dönem denetimi: en az 1, en fazla `PUBLIC_BOOKING_MAX_NIGHTS` gece. */
function refinePublicStay(value, ctx) {
  const nights = Math.round((value.checkOut.getTime() - value.checkIn.getTime()) / 86_400_000);
  if (nights < 1) {
    ctx.addIssue({ code: 'custom', path: ['checkOut'], message: 'Çıkış tarihi girişten sonra olmalı' });
  } else if (nights > PUBLIC_BOOKING_MAX_NIGHTS) {
    ctx.addIssue({ code: 'custom', path: ['checkOut'], message: `En fazla ${PUBLIC_BOOKING_MAX_NIGHTS} gece için fiyat verilir; daha uzunu için otelle iletişime geçin` });
  }
}

export const publicBookingQuoteSchema = z
  .object({
    ...stayShape,
    /** Seçilen tip (ikinci adım): kişi başı ek dahil kesin toplam için. */
    roomTypeId: z.string().uuid({ message: 'Geçersiz oda tipi' }).nullish(),
  })
  .superRefine(refinePublicStay);

export const publicBookingReserveSchema = z
  .object({
    ...stayShape,
    roomTypeId: z.string().uuid({ message: 'Oda tipi seçin' }),
    guest: z.object({
      firstName: z.string({ error: 'Ad zorunlu' }).trim().min(1, 'Ad zorunlu').max(100, 'Ad en fazla 100 karakter'),
      lastName: z.string({ error: 'Soyad zorunlu' }).trim().min(1, 'Soyad zorunlu').max(100, 'Soyad en fazla 100 karakter'),
      /** Onay kodu ve iletişim için e-posta zorunlu (telefon isteğe bağlı). */
      email: z.string({ error: 'E-posta zorunlu' }).trim().toLowerCase().max(200).email('E-posta geçersiz'),
      phone: z
        .string()
        .trim()
        .max(40, 'Telefon en fazla 40 karakter')
        .refine((value) => value === '' || /^\+?[\d\s()-]{7,}$/.test(value), { message: 'Telefon geçersiz' })
        .transform((value) => value || null)
        .nullish(),
    }),
    notes: z
      .string()
      .trim()
      .max(PUBLIC_BOOKING_MAX_NOTES, `Not en fazla ${PUBLIC_BOOKING_MAX_NOTES} karakter`)
      .transform((value) => value || null)
      .nullish(),
    /** İdempotens: aynı istek iki kez gönderilirse ikinci rezervasyon açılmaz. */
    requestId: z.string().uuid({ message: 'Geçersiz istek kimliği' }),
  })
  .superRefine(refinePublicStay);
