import { z } from './locale.js';
import {
  HOUSEKEEPING_STATUSES,
  HOUSEKEEPING_STATUS_LABELS,
  MAX_AVAILABILITY_DAYS,
  MAX_STAY_NIGHTS,
  ROOM_BLOCK_SCOPES,
  ROOM_BLOCK_TYPES,
  ROOM_CONDITIONS,
  ROOM_OCCUPANCIES,
} from './constants.js';
import {
  dateField,
  expectedUpdatedAt,
  listQuerySchema,
  optionalQueryInt,
  paginationQuerySchema,
  queryBoolean,
} from './fields.js';

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
  occupancy: z.enum(ROOM_OCCUPANCIES, { error: 'Geçersiz doluluk filtresi' }).optional(),
  housekeepingStatus: z.enum(HOUSEKEEPING_STATUSES, { error: 'Geçersiz kat hizmeti filtresi' }).optional(),
  condition: z.enum(ROOM_CONDITIONS, { error: 'Geçersiz arıza filtresi' }).optional(),
  floor: optionalQueryInt({ label: 'Kat', min: -5, max: 200 }),
});

/* ─────────────── Kat hizmeti ─────────────── */

/**
 * Kat hizmeti durum geçişi kuralı — sunucu da tarayıcı da bunu kullanır.
 *
 * Tek kısıt bilinçli olarak dar tutuldu: **kontrol edilmemiş odaya "kontrol
 * edildi" denemez.** Kat şefinin onayı ancak temizlenmiş odaya verilir; kirli
 * odayı doğrudan "kontrol edildi" yapmak, denetimi atlayıp misafire hazır
 * olmayan oda vermektir. Geri kalan geçişler serbest: gerçek hayatta oda her an
 * yeniden kirlenebilir (misafir erken döndü, sızıntı oldu).
 *
 * @param {string} from
 * @param {string} to
 * @returns {string | null} Hata mesajı; geçiş geçerliyse `null`
 */
export function housekeepingTransitionError(from, to) {
  if (!HOUSEKEEPING_STATUSES.includes(to)) return 'Geçersiz kat hizmeti durumu';
  if (from === to) return null;
  if (to === 'INSPECTED' && from !== 'CLEAN') {
    return `"${HOUSEKEEPING_STATUS_LABELS[from] ?? from}" odaya "Kontrol edildi" denemez; önce oda temizlenmeli.`;
  }
  return null;
}

export const setHousekeepingStatusSchema = z.object({
  status: z.enum(HOUSEKEEPING_STATUSES, { error: 'Geçersiz kat hizmeti durumu' }),
  expectedUpdatedAt,
});

/* ─────────────── Arıza kayıtları (bloklar) ─────────────── */

export const blockRoomSchema = z
  .object({
    type: z.enum(ROOM_BLOCK_TYPES, { error: 'Kayıt tipini seçin (Arızalı / Hizmet dışı)' }),
    startDate: dateField,
    // Boş bırakılırsa blok süresizdir (odayı elle açana kadar kapalı kalır).
    endDate: dateField.nullable().optional(),
    reason: z
      .string({ error: 'Sebep zorunlu' })
      .trim()
      .min(1, 'Sebep zorunlu')
      .max(200, 'Sebep en fazla 200 karakter'),
  })
  .refine((value) => value.endDate == null || value.endDate > value.startDate, {
    path: ['endDate'],
    message: 'Bitiş başlangıçtan sonra olmalı',
  });

export const blockListQuerySchema = paginationQuerySchema.extend({
  roomId: z.string().uuid({ message: 'Geçersiz oda' }).optional(),
  scope: z.enum(ROOM_BLOCK_SCOPES, { error: 'Geçersiz kapsam' }).default('ACTIVE'),
});

/* ─────────────── Oda atama ─────────────── */

export const assignRoomSchema = z.object({
  roomId: z.string({ error: 'Oda seçilmedi' }).uuid({ message: 'Geçersiz oda' }),
});

export const assignableRoomsQuerySchema = paginationQuerySchema.extend({
  includeOtherTypes: queryBoolean.default(false),
});

/* ─────────────── Müsaitlik ─────────────── */

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
  })
  .refine((value) => (value.checkOut - value.checkIn) / 86_400_000 <= MAX_STAY_NIGHTS, {
    path: ['checkOut'],
    message: `Konaklama en fazla ${MAX_STAY_NIGHTS} gece olabilir`,
  });
