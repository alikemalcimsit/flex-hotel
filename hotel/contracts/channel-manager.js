import { BOARD_TYPES } from './constants.js';
import { dateField, expectedUpdatedAt, paginationQuerySchema } from './fields.js';
import { z } from './locale.js';

/**
 * Kanal yönetimi / channel manager sözleşmeleri (modül 33).
 *
 * Kararlar (kullanıcı, 14 Ekim 2026):
 * - **OTA bağlantısı Channex.io** üzerinden (Booking, Expedia, Airbnb, Agoda…
 *   Channex'e bağlanır; biz Channex'e). Müsaitlik oda tipine, fiyat ve
 *   stop-sale fiyat planına gider.
 * - **OTA rezervasyonu onaylı açılır, tutarı OTA'nın tutarıdır.** Yer yoksa
 *   reddedilmez (misafir kanalda onay almıştır): kapasite aşılarak açılır,
 *   personele "overbooking" uyarısı düşer.
 * - **iCal'deki dolu günler rezervasyon olarak açılır** (onaylı; iCal misafir adı
 *   ve fiyat taşımaz). Fiyat geçici olarak sistem fiyatıdır ve "kanaldan
 *   doğrulanmalı" diye işaretlenir; takvimden kalkan, henüz gelmemiş
 *   rezervasyon iptal edilir.
 *
 * Kanala giden fiyat: otelin liste fiyatı (taban × sezon) + kanalın fiyat farkı
 * yüzdesi (komisyonu karşılamak için). Promosyonlar kanala gitmez (OTA'nın
 * kendi kampanyaları vardır). Pansiyon farkı modül 28 ile gelir; o zamana kadar
 * aynı oda tipinin bütün fiyat planları aynı fiyatı alır.
 */

/* ─────────────── Türler ve durumlar ─────────────── */

/** Prisma `ChannelType` ile birebir. */
export const CHANNEL_TYPES = Object.freeze(['CHANNEX', 'ICAL']);

export const CHANNEL_TYPE_LABELS = Object.freeze({
  CHANNEX: 'Channex (OTA bağlantısı)',
  ICAL: 'iCal takvimi',
});

/**
 * Prisma `ChannelStatus` ile birebir.
 * - `DRAFT`: kuruluyor; bağlantı ve eşleştirme tamamlanınca senkrona alınır.
 * - `ACTIVE`: senkronda — değişiklikler gider, rezervasyonlar alınır.
 * - `PAUSED`: durduruldu; hiçbir şey gönderilmez / alınmaz (Channex'teki
 *   rezervasyonlar bekler, yeniden açılınca alınır).
 */
export const CHANNEL_STATUSES = Object.freeze(['DRAFT', 'ACTIVE', 'PAUSED']);

export const CHANNEL_STATUS_LABELS = Object.freeze({
  DRAFT: 'Kuruluyor',
  ACTIVE: 'Senkronda',
  PAUSED: 'Durduruldu',
});

/** Channex ortamı: test (staging) ya da canlı. Prisma `ChannexEnvironment` ile birebir. */
export const CHANNEX_ENVIRONMENTS = Object.freeze(['STAGING', 'PRODUCTION']);

export const CHANNEX_ENVIRONMENT_LABELS = Object.freeze({
  STAGING: 'Test (staging)',
  PRODUCTION: 'Canlı',
});

/**
 * iCal takviminin geldiği yer. Airbnb takviminde rezervasyon ("Reserved") ile
 * evsahibinin kapattığı gün ("Not available") ayrılır; kapatma rezervasyon
 * açmaz. Booking.com ve diğerleri ikisini ayırmaz: her kayıt rezervasyondur.
 * Prisma `IcalProvider` ile birebir.
 */
export const ICAL_PROVIDERS = Object.freeze(['AIRBNB', 'BOOKING', 'OTHER']);

export const ICAL_PROVIDER_LABELS = Object.freeze({
  AIRBNB: 'Airbnb',
  BOOKING: 'Booking.com',
  OTHER: 'Diğer',
});

/** Senkron logunun iş türü. Prisma `ChannelSyncKind` ile birebir. */
export const CHANNEL_SYNC_KINDS = Object.freeze(['DELTA', 'FULL', 'BOOKINGS', 'ICAL_IMPORT', 'SETUP']);

export const CHANNEL_SYNC_KIND_LABELS = Object.freeze({
  DELTA: 'Değişiklik gönderimi',
  FULL: 'Tam eşitleme',
  BOOKINGS: 'Rezervasyon alımı',
  ICAL_IMPORT: 'Takvim okuma',
  SETUP: 'Bağlantı',
});

/** Prisma `ChannelSyncStatus` ile birebir. `PARTIAL`: kanal bazı satırları reddetti. */
export const CHANNEL_SYNC_STATUSES = Object.freeze(['SUCCESS', 'PARTIAL', 'FAILED']);

export const CHANNEL_SYNC_STATUS_LABELS = Object.freeze({
  SUCCESS: 'Başarılı',
  PARTIAL: 'Kısmen',
  FAILED: 'Hata',
});

/** İşi kim başlattı. Prisma `ChannelSyncTrigger` ile birebir. */
export const CHANNEL_SYNC_TRIGGERS = Object.freeze(['CHANGE', 'SCHEDULE', 'MANUAL', 'WEBHOOK']);

export const CHANNEL_SYNC_TRIGGER_LABELS = Object.freeze({
  CHANGE: 'Değişiklik',
  SCHEDULE: 'Zamanlanmış',
  MANUAL: 'Elle',
  WEBHOOK: 'Kanal bildirimi',
});

/**
 * Kanal rezervasyonunun bizdeki durumu. Prisma `ChannelBookingState` ile birebir.
 * - `PENDING`: alındı, işlenmeyi bekliyor.
 * - `PROCESSED`: rezervasyon(lar) açıldı / değişti / iptal edildi.
 * - `REVIEW`: açıldı ama bir şey doğrulanmalı (iCal fiyatı, OTA para birimi farkı).
 * - `ATTENTION`: elle işlenmeli (eşleşmeyen oda tipi, içerideki misafirde
 *   değişiklik / iptal); personele görev düştü.
 */
export const CHANNEL_BOOKING_STATES = Object.freeze(['PENDING', 'PROCESSED', 'REVIEW', 'ATTENTION']);

export const CHANNEL_BOOKING_STATE_LABELS = Object.freeze({
  PENDING: 'Sırada',
  PROCESSED: 'İşlendi',
  REVIEW: 'Doğrulanmalı',
  ATTENTION: 'Elle işlenmeli',
});

/** Kanaldaki rezervasyonun durumu. Prisma `ChannelBookingStatus` ile birebir. */
export const CHANNEL_BOOKING_STATUSES = Object.freeze(['ACTIVE', 'CANCELLED']);

export const CHANNEL_BOOKING_STATUS_LABELS = Object.freeze({
  ACTIVE: 'Geçerli',
  CANCELLED: 'İptal',
});

/* ─────────────── Sınırlar ─────────────── */

export const MAX_CHANNEL_NAME_LENGTH = 80;
/** Channex sertifikasyonu tam eşitlemede 500 gün ister. */
export const CHANNEX_HORIZON_DAYS = 500;
/** iCal ihracında varsayılan pencere (OTA'lar ~1 yıl okur). */
export const DEFAULT_ICAL_HORIZON_DAYS = 365;
export const MIN_CHANNEL_HORIZON_DAYS = 30;
export const MAX_CHANNEL_HORIZON_DAYS = 730;
/** Kanal fiyat farkı (yüzde). Negatif değer kanalda daha ucuz satmak demektir. */
export const MIN_CHANNEL_MARKUP_PERCENT = -50;
export const MAX_CHANNEL_MARKUP_PERCENT = 100;
export const MAX_CHANNEX_API_KEY_LENGTH = 200;
export const MIN_CHANNEX_API_KEY_LENGTH = 16;
/** Bir kanalda en fazla eşleşen oda tipi ve oda tipi başına fiyat planı. */
export const MAX_CHANNEL_ROOM_MAPPINGS = 100;
export const MAX_CHANNEL_RATE_MAPPINGS_PER_ROOM = 20;
export const MAX_EXTERNAL_NAME_LENGTH = 255;
export const MAX_EXTERNAL_ID_LENGTH = 100;
export const MAX_ICAL_URL_LENGTH = 2000;
/** Bir kanaldaki en fazla stop-sale kaydı. */
export const MAX_CHANNEL_STOP_SALES = 500;
/** Tek stop-sale en fazla bu kadar gün (iki uç dahil). */
export const MAX_CHANNEL_STOP_SALE_DAYS = MAX_CHANNEL_HORIZON_DAYS;
export const MAX_CHANNEL_STOP_SALE_REASON_LENGTH = 200;
export const MAX_CHANNEL_NOTE_LENGTH = 500;
/** Senkron logu süzgecinde en uzun dönem (gün). */
export const MAX_CHANNEL_LOG_DAYS = 366;

/* ─────────────── Yardımcılar ─────────────── */

/** İki uç dahil gün sayısı ("YYYY-MM-DD" ya da Date). */
export function channelPeriodDays(startDate, endDate) {
  const day = (value) => Date.parse(typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10));
  return Math.round((day(endDate) - day(startDate)) / 86_400_000) + 1;
}

/**
 * iCal adresi kabul edilebilir mi: yalnızca https (takvim kanalın sunucusundan
 * okunur; düz http'de rezervasyon bilgisi açıkta gider), kullanıcı adı / parola
 * ve IP adresi olmadan. Sunucu ayrıca adın özel ağa çözülmediğini denetler.
 *
 * @param {string} value
 * @returns {string | null} sorun varsa mesaj
 */
export function icalUrlIssue(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return 'Geçerli bir adres değil';
  }
  if (url.protocol !== 'https:') return 'Takvim adresi https:// ile başlamalı';
  if (url.username || url.password) return 'Adreste kullanıcı adı / parola olamaz';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname.startsWith('[')) return 'Adres IP değil, alan adı olmalı';
  if (url.hostname === 'localhost' || !url.hostname.includes('.')) return 'Adres herkese açık bir alan adı olmalı';
  return null;
}

/* ─────────────── Şema parçaları ─────────────── */

const uuid = (message) => z.string().uuid({ message });

const optionalText = (max, label) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter`)
    .transform((value) => value || null)
    .nullish();

const nameField = z
  .string({ error: 'Kanal adı zorunlu' })
  .trim()
  .min(2, 'Kanal adı en az 2 karakter')
  .max(MAX_CHANNEL_NAME_LENGTH, `Kanal adı en fazla ${MAX_CHANNEL_NAME_LENGTH} karakter`);

/** "-10", "12.5", "12,5" → "12.50" biçiminde metin. */
const markupField = z
  .union([z.string(), z.number()], { error: 'Fiyat farkı zorunlu' })
  .transform((value) => (typeof value === 'number' ? String(value) : value.trim().replace(',', '.')))
  .transform((value) => (value === '' ? '0' : value))
  .refine((value) => /^-?\d+(\.\d{1,2})?$/.test(value), { message: 'Fiyat farkı en fazla iki ondalıklı yüzde olmalı' })
  .refine((value) => Number(value) >= MIN_CHANNEL_MARKUP_PERCENT && Number(value) <= MAX_CHANNEL_MARKUP_PERCENT, {
    message: `Fiyat farkı %${MIN_CHANNEL_MARKUP_PERCENT} ile %${MAX_CHANNEL_MARKUP_PERCENT} arasında olmalı`,
  })
  .transform((value) => Number(value).toFixed(2));

const horizonField = z.coerce
  .number({ error: 'Gün sayısı sayı olmalı' })
  .int('Gün sayısı tam sayı olmalı')
  .min(MIN_CHANNEL_HORIZON_DAYS, `En az ${MIN_CHANNEL_HORIZON_DAYS} gün`)
  .max(MAX_CHANNEL_HORIZON_DAYS, `En fazla ${MAX_CHANNEL_HORIZON_DAYS} gün`);

const apiKeyField = z
  .string({ error: 'API anahtarı zorunlu' })
  .trim()
  .min(MIN_CHANNEX_API_KEY_LENGTH, `API anahtarı en az ${MIN_CHANNEX_API_KEY_LENGTH} karakter`)
  .max(MAX_CHANNEX_API_KEY_LENGTH, `API anahtarı en fazla ${MAX_CHANNEX_API_KEY_LENGTH} karakter`)
  .refine((value) => !/\s/.test(value), { message: 'API anahtarında boşluk olamaz' });

/** Düzenlemede boş anahtar "değiştirme" demektir. */
const optionalApiKeyField = z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? null : value), apiKeyField.nullish());

const externalIdField = (label) =>
  z
    .string({ error: `${label} zorunlu` })
    .trim()
    .min(1, `${label} zorunlu`)
    .max(MAX_EXTERNAL_ID_LENGTH, `${label} en fazla ${MAX_EXTERNAL_ID_LENGTH} karakter`);

const externalNameField = z
  .string()
  .trim()
  .max(MAX_EXTERNAL_NAME_LENGTH, `Ad en fazla ${MAX_EXTERNAL_NAME_LENGTH} karakter`)
  .transform((value) => value || null)
  .nullish();

const icalUrlField = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value),
  z
    .string()
    .max(MAX_ICAL_URL_LENGTH, `Adres en fazla ${MAX_ICAL_URL_LENGTH} karakter`)
    .superRefine((value, ctx) => {
      const issue = icalUrlIssue(value);
      if (issue) ctx.addIssue({ code: 'custom', message: issue });
    })
    .nullish(),
);

/* ─────────────── Kanal ─────────────── */

const channexShape = {
  type: z.literal('CHANNEX'),
  name: nameField,
  environment: z.enum(CHANNEX_ENVIRONMENTS, { error: 'Ortam seçin' }),
  /** Channex'teki mülkün (otelin) kimliği. */
  propertyId: uuid('Channex mülk kimliği UUID biçiminde olmalı'),
  apiKey: apiKeyField,
  priceMarkupPercent: markupField.default('0.00'),
  horizonDays: horizonField.default(CHANNEX_HORIZON_DAYS),
};

const icalShape = {
  type: z.literal('ICAL'),
  name: nameField,
  provider: z.enum(ICAL_PROVIDERS, { error: 'Takvimin geldiği yeri seçin' }),
  horizonDays: horizonField.default(DEFAULT_ICAL_HORIZON_DAYS),
};

export const createChannelSchema = z.discriminatedUnion('type', [z.object(channexShape), z.object(icalShape)], {
  error: 'Kanal türü seçin',
});

/**
 * Kanal ayarı düzenleme. Türü değişmez; türe ait olmayan alan yok sayılır.
 * Boş API anahtarı mevcut anahtarı korur.
 */
export const updateChannelSchema = z.object({
  expectedUpdatedAt,
  name: nameField,
  horizonDays: horizonField,
  priceMarkupPercent: markupField.optional(),
  environment: z.enum(CHANNEX_ENVIRONMENTS, { error: 'Ortam seçin' }).optional(),
  propertyId: uuid('Channex mülk kimliği UUID biçiminde olmalı').optional(),
  apiKey: optionalApiKeyField,
  provider: z.enum(ICAL_PROVIDERS, { error: 'Takvimin geldiği yeri seçin' }).optional(),
});

export const channelVersionSchema = z.object({ expectedUpdatedAt });

/** Senkrona al / durdur. */
export const channelStatusSchema = z.object({
  expectedUpdatedAt,
  status: z.enum(['ACTIVE', 'PAUSED'], { error: 'Geçersiz durum' }),
});

export const channelManagerParamSchema = z.object({ channelId: uuid('Geçersiz kanal') });

export const channelStopSaleParamSchema = z.object({
  channelId: uuid('Geçersiz kanal'),
  stopSaleId: uuid('Geçersiz stop-sale kaydı'),
});

export const channelBookingParamSchema = z.object({
  channelId: uuid('Geçersiz kanal'),
  bookingId: uuid('Geçersiz kanal rezervasyonu'),
});

export const channelListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional(),
  status: z.enum(CHANNEL_STATUSES, { error: 'Geçersiz durum' }).optional(),
});

/* ─────────────── Eşleştirme ─────────────── */

const rateMappingSchema = z.object({
  externalRatePlanId: externalIdField('Kanal fiyat planı'),
  externalName: externalNameField,
  boardType: z.enum(BOARD_TYPES, { error: 'Pansiyon seçin' }),
});

const roomMappingSchema = z.object({
  roomTypeId: uuid('Oda tipi seçin'),
  /** Channex oda tipi kimliği (iCal'de yok). */
  externalRoomTypeId: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    externalIdField('Kanal oda tipi').nullish(),
  ),
  externalName: externalNameField,
  rates: z
    .array(rateMappingSchema, { error: 'Fiyat planları geçersiz' })
    .max(MAX_CHANNEL_RATE_MAPPINGS_PER_ROOM, `Bir oda tipine en fazla ${MAX_CHANNEL_RATE_MAPPINGS_PER_ROOM} fiyat planı`)
    .default([]),
  /** iCal: kanalın takvim adresi (içe aktarma). Boşsa yalnızca dışa aktarılır. */
  icalImportUrl: icalUrlField,
});

/**
 * Bir mapping tablosunun tekillik denetimi: bizim oda tipi, kanal oda tipi ve
 * kanal fiyat planı birer kez eşleşir. Sunucu kanal türüne göre zorunlu alanları
 * ayrıca denetler (Channex'te kanal oda tipi ve en az bir fiyat planı).
 *
 * @param {Array<{ roomTypeId: string, externalRoomTypeId?: string | null, rates?: Array<{ externalRatePlanId: string }> }>} rooms
 * @returns {Array<{ path: Array<string | number>, message: string }>}
 */
export function channelMappingIssues(rooms) {
  const issues = [];
  const seenTypes = new Map();
  const seenExternal = new Map();
  const seenRates = new Map();
  rooms.forEach((room, index) => {
    if (seenTypes.has(room.roomTypeId)) {
      issues.push({ path: ['rooms', index, 'roomTypeId'], message: `Bu oda tipi ${seenTypes.get(room.roomTypeId) + 1}. satırda da eşleşmiş` });
    } else {
      seenTypes.set(room.roomTypeId, index);
    }
    if (room.externalRoomTypeId) {
      if (seenExternal.has(room.externalRoomTypeId)) {
        issues.push({ path: ['rooms', index, 'externalRoomTypeId'], message: `Bu kanal oda tipi ${seenExternal.get(room.externalRoomTypeId) + 1}. satırda da eşleşmiş` });
      } else {
        seenExternal.set(room.externalRoomTypeId, index);
      }
    }
    (room.rates ?? []).forEach((rate, rateIndex) => {
      if (seenRates.has(rate.externalRatePlanId)) {
        issues.push({ path: ['rooms', index, 'rates', rateIndex, 'externalRatePlanId'], message: 'Bu kanal fiyat planı başka bir satırda da eşleşmiş' });
      } else {
        seenRates.set(rate.externalRatePlanId, true);
      }
    });
  });
  return issues;
}

export const saveChannelMappingsSchema = z
  .object({
    expectedUpdatedAt,
    rooms: z
      .array(roomMappingSchema, { error: 'Eşleştirme satırları geçersiz' })
      .max(MAX_CHANNEL_ROOM_MAPPINGS, `En fazla ${MAX_CHANNEL_ROOM_MAPPINGS} oda tipi eşleşir`),
  })
  .superRefine((value, ctx) => {
    for (const issue of channelMappingIssues(value.rooms)) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  });

/* ─────────────── Stop-sale ─────────────── */

export const addChannelStopSaleSchema = z
  .object({
    /** Boşsa kanaldaki bütün oda tipleri. */
    roomTypeIds: z.array(uuid('Geçersiz oda tipi'), { error: 'Oda tipleri geçersiz' }).max(MAX_CHANNEL_ROOM_MAPPINGS).default([]),
    startDate: dateField,
    endDate: dateField,
    reason: optionalText(MAX_CHANNEL_STOP_SALE_REASON_LENGTH, 'Sebep'),
  })
  .superRefine((value, ctx) => {
    if (value.endDate < value.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Bitiş tarihi başlangıçtan önce olamaz' });
    } else if (channelPeriodDays(value.startDate, value.endDate) > MAX_CHANNEL_STOP_SALE_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: `Stop-sale en fazla ${MAX_CHANNEL_STOP_SALE_DAYS} gün olabilir` });
    }
    if (new Set(value.roomTypeIds).size !== value.roomTypeIds.length) {
      ctx.addIssue({ code: 'custom', path: ['roomTypeIds'], message: 'Aynı oda tipi iki kez seçilmiş' });
    }
  });

/* ─────────────── Log ve rezervasyonlar ─────────────── */

export const channelLogQuerySchema = paginationQuerySchema
  .extend({
    kind: z.enum(CHANNEL_SYNC_KINDS, { error: 'Geçersiz iş türü' }).optional(),
    status: z.enum(CHANNEL_SYNC_STATUSES, { error: 'Geçersiz sonuç' }).optional(),
    from: dateField.optional(),
    to: dateField.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.from || !value.to) return;
    if (value.to < value.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
    } else if (channelPeriodDays(value.from, value.to) > MAX_CHANNEL_LOG_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: `Dönem en fazla ${MAX_CHANNEL_LOG_DAYS} gün olabilir` });
    }
  });

export const channelBookingQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional(),
  state: z.enum(CHANNEL_BOOKING_STATES, { error: 'Geçersiz durum' }).optional(),
});

/** Doğrulanmalı / elle işlenmeli rezervasyonu "tamam" diye kapatmak (notla). */
export const resolveChannelBookingSchema = z.object({
  note: z
    .string({ error: 'Ne yapıldığını kısaca yazın' })
    .trim()
    .min(3, 'Not en az 3 karakter')
    .max(MAX_CHANNEL_NOTE_LENGTH, `Not en fazla ${MAX_CHANNEL_NOTE_LENGTH} karakter`),
});

/**
 * Channex'te webhook kurulumu: Channex yeni rezervasyonu bu adrese haber verir
 * (yine de dakikada bir sorgulanır). Adres backend'in herkese açık kökü.
 */
export const channexWebhookSchema = z.object({
  expectedUpdatedAt,
  callbackBaseUrl: z
    .string({ error: 'Sunucu adresi zorunlu' })
    .trim()
    .max(500, 'Adres en fazla 500 karakter')
    .refine((value) => {
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    }, { message: 'Webhook adresi https:// ile başlamalı (Channex düz http adresine bildirim göndermez)' }),
});
