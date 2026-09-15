import { z } from './locale.js';
import {
  HOUSEKEEPING_STATUSES,
  MAX_PLAN_DAYS,
  PLAN_ROOMS_PAGE_SIZE,
  PLAN_WINDOW_OPTIONS,
  RESERVATION_STATUSES,
  ROOM_CONDITIONS,
  ROOM_OCCUPANCIES,
} from './constants.js';
import { dateField, optionalQueryInt } from './fields.js';

/**
 * Oda planı (rack / tape chart) sözleşmeleri.
 *
 * Plan ızgarası "satır oda, sütun gece" okunur ve konaklama aralıkları yine
 * **yarı açık** `[)`: 15-18 rezervasyonu 15, 16, 17 sütunlarını doldurur,
 * 18 sütunu boştur (o gün oda tekrar satılabilir). Bu yüzden ızgarada gün
 * sayısı = gece sayısıdır; "çıkış günü" ayrı bir sütun olarak çizilmez.
 */

/**
 * Plan penceresi.
 *
 * `days` gün sayısıdır (bitiş tarihi değil): ekran "14 gün" der, kullanıcı ileri
 * geri gezerken pencere boyu sabit kalır. Üst sınır hem sunucuyu hem tarayıcıyı
 * korur — 500 odalı bir otelde 45 gün zaten 22.500 hücre demek.
 *
 * Oda sayfalaması ızgaranın satır sayısını sınırlar; **özet satırı yine otelin
 * tamamından** hesaplanır (bkz. `modules/plan/service.js`), yoksa "bugün %62
 * dolu" gibi bir sayı sayfaya göre değişirdi.
 */
export const roomPlanQuerySchema = z.object({
  from: dateField,
  days: z.coerce
    .number({ error: 'Gün sayısı sayı olmalı' })
    .int('Gün sayısı tam sayı olmalı')
    .min(1, 'Gün sayısı en az 1 olmalı')
    .max(MAX_PLAN_DAYS, `Gün sayısı en fazla ${MAX_PLAN_DAYS} olabilir`)
    .default(PLAN_WINDOW_OPTIONS[1]),
  page: z.coerce
    .number({ error: 'Sayfa numarası sayı olmalı' })
    .int('Sayfa numarası tam sayı olmalı')
    .min(1, 'Sayfa numarası 1\'den küçük olamaz')
    .default(1),
  pageSize: z.coerce
    .number({ error: 'Sayfa boyutu sayı olmalı' })
    .int('Sayfa boyutu tam sayı olmalı')
    .min(1, 'Sayfa boyutu en az 1 olmalı')
    .max(100, 'Sayfa boyutu en fazla 100 olabilir')
    .default(PLAN_ROOMS_PAGE_SIZE),
  search: z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional(),
  roomTypeId: z.string().uuid({ message: 'Geçersiz oda tipi' }).optional(),
  floor: optionalQueryInt({ label: 'Kat', min: -5, max: 200 }),
  occupancy: z.enum(ROOM_OCCUPANCIES, { error: 'Geçersiz doluluk filtresi' }).optional(),
  housekeepingStatus: z.enum(HOUSEKEEPING_STATUSES, { error: 'Geçersiz kat hizmeti filtresi' }).optional(),
  condition: z.enum(ROOM_CONDITIONS, { error: 'Geçersiz arıza filtresi' }).optional(),
});

/**
 * Oda planında bir rezervasyonun odasını değiştirme / atama.
 *
 * Aynı uç hem boş rezervasyona oda atar hem de atanmış rezervasyonu başka odaya
 * taşır; misafir içerideyse (giriş yapmışsa) eski oda kirliye düşer. Hangisinin
 * olduğu yanıttaki `mode` alanında döner, çünkü kullanıcıya gösterilecek mesaj
 * ("oda atandı" / "misafir taşındı") farklıdır.
 */
export const changeRoomSchema = z.object({
  roomId: z.string({ error: 'Oda seçilmedi' }).uuid({ message: 'Geçersiz oda' }),
});

/** Plan ekranının rezervasyon detayı çekmecesi için kimlik parametresi. */
export const reservationParamSchema = z.object({
  reservationId: z.string().uuid({ message: 'Geçersiz rezervasyon' }),
});

/**
 * Atanmamış rezervasyon şeridinin sorgusu.
 *
 * Plan ekranındaki şerit yalnızca **pencereye düşen** kayıtları gösterir:
 * ekranda 14 gün varken üç ay sonrasının oda bekleyen rezervasyonunu sürükleyip
 * bırakacak bir yer yok.
 */
export const planUnassignedQuerySchema = z.object({
  from: dateField,
  days: z.coerce
    .number({ error: 'Gün sayısı sayı olmalı' })
    .int('Gün sayısı tam sayı olmalı')
    .min(1, 'Gün sayısı en az 1 olmalı')
    .max(MAX_PLAN_DAYS, `Gün sayısı en fazla ${MAX_PLAN_DAYS} olabilir`)
    .default(PLAN_WINDOW_OPTIONS[1]),
  status: z.enum(RESERVATION_STATUSES, { error: 'Geçersiz rezervasyon durumu' }).optional(),
  limit: z.coerce
    .number({ error: 'Kayıt sayısı sayı olmalı' })
    .int('Kayıt sayısı tam sayı olmalı')
    .min(1, 'Kayıt sayısı en az 1 olmalı')
    .max(100, 'Kayıt sayısı en fazla 100 olabilir')
    .default(25),
});
