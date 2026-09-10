import { z } from './locale.js';
import { MANUAL_ROOM_STATUSES, MAX_AVAILABILITY_DAYS } from './constants.js';
import { dateField, expectedUpdatedAt, listQuerySchema } from './fields.js';

/**
 * Oda envanteri ve müsaitlik sözleşmeleri.
 *
 * Tarih alanları gün hassasiyetindedir. Konaklama ve blok aralıkları
 * **yarı açık** `[)` yorumlanır: 15-18 aralığı 15, 16, 17 gecelerini kapsar,
 * 18'de oda boşalır. (Sezonlar bunun tersine iki uçtan kapalıdır.)
 */

const roomNumber = z
  .string({ error: 'Oda numarası zorunlu' })
  .trim()
  .min(1, 'Oda numarası zorunlu')
  .max(20, 'Oda numarası en fazla 20 karakter')
  .regex(/^[A-Za-z0-9-]+$/, 'Oda numarası yalnızca harf, rakam ve - içerebilir');

export const roomInputSchema = z.object({
  number: roomNumber,
  floor: z.coerce
    .number({ error: 'Kat sayı olmalı' })
    .int('Kat tam sayı olmalı')
    .min(-5, 'Kat -5\'ten küçük olamaz')
    .max(200, 'Kat 200\'den büyük olamaz'),
  roomTypeId: z.string({ error: 'Oda tipi zorunlu' }).uuid({ message: 'Geçersiz oda tipi' }),
  notes: z.string().trim().max(1000, 'Not en fazla 1000 karakter').optional().nullable(),
});

export const updateRoomSchema = roomInputSchema.extend({ expectedUpdatedAt });

export const roomListQuerySchema = listQuerySchema.extend({
  roomTypeId: z.string().uuid({ message: 'Geçersiz oda tipi' }).optional(),
  status: z.enum(['AVAILABLE', 'OCCUPIED', 'DIRTY', 'CLEANING', 'BLOCKED', 'MAINTENANCE']).optional(),
  floor: z.coerce.number().int().optional(),
});

/** Personelin elle değiştirebileceği durumlar; bkz. `MANUAL_ROOM_STATUSES`. */
export const setRoomStatusSchema = z.object({
  status: z.enum(MANUAL_ROOM_STATUSES, { error: 'Bu durum elle atanamaz' }),
  expectedUpdatedAt,
});

export const blockRoomSchema = z
  .object({
    startDate: dateField,
    // Boş bırakılırsa blok süresizdir (odayı elle açana kadar kapalı kalır).
    endDate: dateField.nullable().optional(),
    reason: z
      .string({ error: 'Blok sebebi zorunlu' })
      .trim()
      .min(1, 'Blok sebebi zorunlu')
      .max(200, 'Sebep en fazla 200 karakter'),
  })
  .refine((value) => value.endDate == null || value.endDate > value.startDate, {
    path: ['endDate'],
    message: 'Blok bitişi başlangıçtan sonra olmalı',
  });

export const assignRoomSchema = z.object({
  roomId: z.string({ error: 'Oda seçilmedi' }).uuid({ message: 'Geçersiz oda' }),
});

/**
 * Müsaitlik penceresi. Üst sınır kasıtlı: bir yıllık takvim istemek sunucuyu
 * ve tarayıcıyı gereksiz yorar, ekran zaten aylık gezinir.
 */
export const availabilityQuerySchema = z
  .object({
    from: dateField,
    to: dateField,
    roomTypeId: z.string().uuid({ message: 'Geçersiz oda tipi' }).optional(),
  })
  .refine((value) => value.to > value.from, {
    path: ['to'],
    message: 'Bitiş tarihi başlangıçtan sonra olmalı',
  })
  .refine(
    (value) => (value.to - value.from) / 86_400_000 <= MAX_AVAILABILITY_DAYS,
    { path: ['to'], message: `En fazla ${MAX_AVAILABILITY_DAYS} günlük aralık sorgulanabilir` },
  );

/** "15-18 Ekim'de kaç Standart boş?" sorgusu. */
export const stayAvailabilityQuerySchema = z
  .object({
    checkIn: dateField,
    checkOut: dateField,
    roomTypeId: z.string().uuid({ message: 'Geçersiz oda tipi' }).optional(),
  })
  .refine((value) => value.checkOut > value.checkIn, {
    path: ['checkOut'],
    message: 'Çıkış tarihi girişten sonra olmalı',
  });
