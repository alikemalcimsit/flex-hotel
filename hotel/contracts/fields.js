import { z } from './locale.js';
import { normalizeDecimalString } from './decimal.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './constants.js';

/**
 * Yeniden kullanılan alan tipleri.
 *
 * Para/oran alanları uçtan uca **string** taşınır. Sebep: JavaScript `number`
 * ikili kayan noktadır; 2500 TL'lik oda ücretine %10 vergi uygularken biriken
 * yuvarlama farkı, ay sonunda mizanı tutmayan kuruşlara dönüşür. Hesap
 * gerektiğinde `@hotelos/core`'daki `money.js` kullanılır.
 */

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Decimal alan şeması.
 * @param {{ scale: number, min: number, max: number, label: string }} options
 */
export function decimalField({ scale, min, max, label }) {
  return z
    .union([z.string(), z.number()], { error: `${label} zorunlu` })
    .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
    .refine((value) => value.length > 0, { message: `${label} zorunlu` })
    .refine((value) => new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`).test(value), {
      message: `${label} pozitif olmalı ve en fazla ${scale} ondalık basamak içerebilir`,
    })
    .transform(normalizeDecimalString)
    // Number() yalnızca aralık *karşılaştırması* için; saklanan/taşınan değer string kalır.
    .refine((value) => Number(value) >= min && Number(value) <= max, {
      message: `${label} ${min} ile ${max} arasında olmalı`,
    });
}

/** Gün hassasiyetli tarih. `<input type="date">` "YYYY-MM-DD" gönderir → UTC gün başı. */
export const dateField = z
  .union([z.string(), z.date()])
  .transform((value) => (value instanceof Date ? value : new Date(value)))
  .refine((value) => !Number.isNaN(value.getTime()), { message: 'Geçersiz tarih' });

/**
 * Optimistic lock alanı: istemci en son gördüğü `updatedAt` değerini geri yollar.
 * Sunucu bu damgayla eşleşmeyen kaydı güncellemez.
 */
export const expectedUpdatedAt = z
  .union([z.string(), z.date()])
  .transform((value) => (value instanceof Date ? value : new Date(value)))
  .refine((value) => !Number.isNaN(value.getTime()), { message: 'Geçersiz sürüm damgası' });

export const idParamSchema = z.object({
  id: z.string().uuid({ message: 'Geçersiz kayıt kimliği' }),
});

export const paginationQuerySchema = z.object({
  page: z.coerce
    .number({ error: 'Sayfa numarası sayı olmalı' })
    .int('Sayfa numarası tam sayı olmalı')
    .min(1, 'Sayfa numarası 1\'den küçük olamaz')
    .default(1),
  pageSize: z.coerce
    .number({ error: 'Sayfa boyutu sayı olmalı' })
    .int('Sayfa boyutu tam sayı olmalı')
    .min(1, 'Sayfa boyutu en az 1 olmalı')
    .max(MAX_PAGE_SIZE, `Sayfa boyutu en fazla ${MAX_PAGE_SIZE} olabilir`)
    .default(DEFAULT_PAGE_SIZE),
});

export const listQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional(),
});

/**
 * Zod hatasını `{ alan: mesaj }` sözlüğüne çevirir — form ekranları girdilerin
 * altına basabilsin diye.
 * @param {import('zod').ZodError} error
 * @returns {Record<string, string>}
 */
export function toFieldErrors(error) {
  const fields = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  return fields;
}
