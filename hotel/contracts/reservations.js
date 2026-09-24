import { z } from './locale.js';
import { BOARD_TYPES, MAX_STAY_NIGHTS } from './constants.js';
import { EMAIL_PATTERN, dateField, expectedUpdatedAt, paginationQuerySchema, queryBoolean } from './fields.js';
import { normalizeDecimalString } from './decimal.js';

/**
 * Rezervasyon yönetimi sözleşmeleri (modül 4).
 *
 * Tarihler gün hassasiyetindedir ("YYYY-MM-DD" → UTC gün başı); konaklama
 * yarı açık aralıktır: giriş gecesi dahil, çıkış günü hariç. "Bugün" otelin
 * günüdür (`getBusinessDate`) — sunucu saatiyle hesaplanmaz.
 */

const DAY_MS = 86_400_000;

/* ─────────────── Kaynak, durum, görünüm ─────────────── */

/** Prisma `ReservationSource` ile birebir. */
export const RESERVATION_SOURCES = Object.freeze(['UI', 'PHONE', 'EMAIL', 'AGENCY', 'WEBCHAT', 'WHATSAPP', 'WIDGET', 'OTA']);

export const RESERVATION_SOURCE_LABELS = Object.freeze({
  UI: 'Resepsiyon (yüz yüze)',
  PHONE: 'Telefon',
  EMAIL: 'E-posta',
  AGENCY: 'Acente',
  WEBCHAT: 'Web chat',
  WHATSAPP: 'WhatsApp',
  WIDGET: 'Web sitesi',
  OTA: 'Online kanal (OTA)',
});

/** Personelin elle açarken seçebildiği kaynaklar (kanal kaynakları aktörden gelir). */
export const RESERVATION_MANUAL_SOURCES = Object.freeze(['UI', 'PHONE', 'EMAIL', 'AGENCY']);

/** Açılışta seçilebilen durumlar: kesin ya da opsiyonlu (misafir henüz kesinleştirmedi). */
export const RESERVATION_CREATE_STATUSES = Object.freeze(['CONFIRMED', 'PENDING']);

export const RESERVATION_CREATE_STATUS_LABELS = Object.freeze({
  CONFIRMED: 'Kesin (onaylı)',
  PENDING: 'Opsiyonlu (onay bekliyor)',
});

/**
 * Liste görünümleri. "Bugün" otelin günüdür.
 * - `ARRIVALS`: girişi bugün olanlar (giriş yapmış olanlar dahil).
 * - `DEPARTURES`: çıkışı bugün olan içerideki / çıkmış misafirler.
 * - `IN_HOUSE`: şu an içeride.
 * - `UPCOMING`: ileri tarihli bekleyen ve onaylı.
 * - `PENDING`: opsiyonlu (kesinleşmemiş).
 * - `ALL`: hepsi (süzgeçlerle).
 */
export const RESERVATION_VIEWS = Object.freeze(['ALL', 'ARRIVALS', 'DEPARTURES', 'IN_HOUSE', 'UPCOMING', 'PENDING']);

export const RESERVATION_VIEW_LABELS = Object.freeze({
  ALL: 'Tümü',
  ARRIVALS: 'Bugün gelecek',
  DEPARTURES: 'Bugün gidecek',
  IN_HOUSE: 'İçeride',
  UPCOMING: 'Gelecek',
  PENDING: 'Opsiyonlu',
});

export const RESERVATION_SORTS = Object.freeze(['CHECK_IN_ASC', 'CHECK_IN_DESC', 'CREATED_DESC']);

export const RESERVATION_SORT_LABELS = Object.freeze({
  CHECK_IN_ASC: 'Giriş tarihi (yakın önce)',
  CHECK_IN_DESC: 'Giriş tarihi (uzak önce)',
  CREATED_DESC: 'Son açılan önce',
});

/** Prisma `ReservationPriceMode` ile birebir. */
export const RESERVATION_PRICE_MODES = Object.freeze(['CALCULATED', 'MANUAL']);

export const RESERVATION_PRICE_MODE_LABELS = Object.freeze({
  CALCULATED: 'Sistem fiyatı',
  MANUAL: 'Elle girilen fiyat',
});

/** Prisma `OverbookingPolicy` ile birebir. */
export const OVERBOOKING_POLICIES = Object.freeze(['REJECT', 'APPROVAL']);

export const OVERBOOKING_POLICY_LABELS = Object.freeze({
  REJECT: 'Reddet — yer yoksa rezervasyon açılmaz',
  APPROVAL: 'Onaya gönder — yönetici onaylarsa kapasite aşılarak açılır',
});

/** Prisma `WaitlistStatus` ile birebir. */
export const WAITLIST_STATUSES = Object.freeze(['WAITING', 'AVAILABLE', 'CONVERTED', 'CANCELLED', 'EXPIRED']);

export const WAITLIST_STATUS_LABELS = Object.freeze({
  WAITING: 'Yer bekliyor',
  AVAILABLE: 'Yer açıldı',
  CONVERTED: 'Rezervasyona çevrildi',
  CANCELLED: 'Vazgeçildi',
  EXPIRED: 'Tarihi geçti',
});

/** Açık (işlem bekleyen) bekleme listesi durumları. */
export const WAITLIST_OPEN_STATUSES = Object.freeze(['WAITING', 'AVAILABLE']);

/* ─────────────── Sınırlar ─────────────── */

/** Tek grup formunda en fazla oda (daha büyük gruplar modül 30'un allotment işi). */
export const MAX_GROUP_ROOMS = 50;
/** Grup formunda en fazla satır (satır başına adet ayrıca verilir). */
export const MAX_GROUP_LINES = 20;
/** Bir satırda aynı özellikte en fazla oda. */
export const MAX_LINE_QUANTITY = 50;
export const MAX_RESERVATION_NOTES_LENGTH = 2000;
export const MAX_PRICE_NOTE_LENGTH = 300;
export const MAX_CANCEL_REASON_LENGTH = 300;
export const MAX_GROUP_NAME_LENGTH = 120;
/** Sayfalı listelerde sayılan en fazla kayıt ("2000+"); fazlası aramayla bulunur. */
export const RESERVATION_COUNT_CAP = 2_000;
/** Misafir arama sonucunda en fazla kart. */
export const GUEST_SEARCH_LIMIT = 10;
/** Elle girilebilecek en yüksek toplam (yazım hatasına karşı üst sınır). */
export const MAX_RESERVATION_TOTAL = '100000000';
/** Kişi sayısı sınırları (oda tipi kapasitesi ayrıca denetlenir). */
export const MAX_PARTY_ADULTS = 20;
export const MAX_PARTY_CHILDREN = 20;

/* ─────────────── Saf kurallar ─────────────── */

/**
 * Konaklamanın gece sayısı (yarı açık aralık).
 * @param {Date | string} checkIn
 * @param {Date | string} checkOut
 */
export function stayNights(checkIn, checkOut) {
  const start = Date.parse(typeof checkIn === 'string' ? checkIn.slice(0, 10) : checkIn.toISOString().slice(0, 10));
  const end = Date.parse(typeof checkOut === 'string' ? checkOut.slice(0, 10) : checkOut.toISOString().slice(0, 10));
  return Math.round((end - start) / DAY_MS);
}

/** @param {Date | string} value */
const dayOf = (value) => (typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10));

/**
 * Rezervasyona yapılabilecek işlemler ve yapılamıyorsa sebebi. Ekran
 * düğmeleri buna göre gösterilir; sunucu aynı kuralı yazmadan önce denetler.
 *
 * - `edit`: bekleyen ve onaylıda her şey; içerideki misafirde yalnızca çıkış
 *   tarihi ve not (giriş gecesi geçmiştir, oda değişikliği oda planından).
 * - `confirm`: yalnızca opsiyonlu.
 * - `cancel`: bekleyen ve onaylı (içerideki misafir çıkış yapar, iptal edilmez).
 * - `noShow`: bekleyen ve onaylı, giriş günü gelmiş olmalı.
 * - `reinstate`: iptal ya da gelmedi; çıkış tarihi henüz geçmemiş olmalı.
 * - `checkIn` (modül 6): bekleyen ve onaylı; giriş günü gelmiş, çıkış günü
 *   gelmemiş olmalı (geç gelen misafir ertesi gün de girebilir).
 * - `checkOut` (modül 6): yalnızca içerideki misafir.
 *
 * @param {'edit' | 'confirm' | 'cancel' | 'noShow' | 'reinstate' | 'checkIn' | 'checkOut'} action
 * @param {{ status: string, checkIn: Date | string, checkOut: Date | string }} reservation
 * @param {Date | string} businessDate otelin bugünü
 * @returns {string | null} yapılamıyorsa kullanıcıya gösterilecek sebep
 */
export function reservationActionError(action, reservation, businessDate) {
  const today = dayOf(businessDate);
  const status = reservation.status;
  switch (action) {
    case 'edit':
      if (['PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(status)) return null;
      return 'Kapanmış rezervasyon düzenlenemez (çıkış yapmış, iptal ya da gelmedi)';
    case 'confirm':
      return status === 'PENDING' ? null : 'Yalnızca opsiyonlu rezervasyon onaylanır';
    case 'cancel':
      if (status === 'CHECKED_IN') return 'Misafir içeride; iptal yerine çıkış işlemi yapılır';
      return ['PENDING', 'CONFIRMED'].includes(status) ? null : 'Bu rezervasyon zaten kapanmış';
    case 'noShow':
      if (!['PENDING', 'CONFIRMED'].includes(status)) return 'Yalnızca gelmesi beklenen rezervasyon "gelmedi" işaretlenir';
      return dayOf(reservation.checkIn) <= today ? null : 'Giriş günü gelmeden "gelmedi" işaretlenemez';
    case 'reinstate':
      if (!['CANCELLED', 'NO_SHOW'].includes(status)) return 'Yalnızca iptal ya da gelmedi kaydı geri alınır';
      return dayOf(reservation.checkOut) > today ? null : 'Konaklama tarihleri geçmiş; geri alınamaz';
    case 'checkIn':
      if (status === 'CHECKED_IN') return 'Misafir zaten giriş yapmış';
      if (!['PENDING', 'CONFIRMED'].includes(status)) return 'Yalnızca gelmesi beklenen rezervasyona giriş yapılır';
      if (dayOf(reservation.checkIn) > today) {
        return 'Giriş günü gelmedi. Misafir erken geldiyse önce rezervasyonun giriş tarihini bugüne çekin.';
      }
      return dayOf(reservation.checkOut) > today ? null : 'Konaklama tarihleri geçmiş; giriş yapılamaz';
    case 'checkOut':
      return status === 'CHECKED_IN' ? null : 'Yalnızca içerideki misafirin çıkışı yapılır';
    default:
      return 'Bilinmeyen işlem';
  }
}

/**
 * @param {{ status: string, checkIn: Date | string, checkOut: Date | string }} reservation
 * @param {Date | string} businessDate
 * @returns {Array<'edit' | 'confirm' | 'cancel' | 'noShow' | 'reinstate' | 'checkIn' | 'checkOut'>}
 */
export function allowedReservationActions(reservation, businessDate) {
  return /** @type {const} */ (['edit', 'confirm', 'cancel', 'noShow', 'reinstate', 'checkIn', 'checkOut']).filter(
    (action) => reservationActionError(action, reservation, businessDate) === null,
  );
}

/* ─────────────── Şema parçaları ─────────────── */

const uuid = (message) => z.string().uuid({ message });

const trimmedOptional = (max, label) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter`)
    .transform((value) => value || null)
    .nullish();

const adultsField = z.coerce
  .number({ error: 'Yetişkin sayısı sayı olmalı' })
  .int('Yetişkin sayısı tam sayı olmalı')
  .min(1, 'En az 1 yetişkin olmalı')
  .max(MAX_PARTY_ADULTS, `En fazla ${MAX_PARTY_ADULTS} yetişkin`);

const childrenField = z.coerce
  .number({ error: 'Çocuk sayısı sayı olmalı' })
  .int('Çocuk sayısı tam sayı olmalı')
  .min(0, 'Çocuk sayısı negatif olamaz')
  .max(MAX_PARTY_CHILDREN, `En fazla ${MAX_PARTY_CHILDREN} çocuk`);

const boardField = z.enum(BOARD_TYPES, { error: 'Geçersiz pansiyon tipi' });

/**
 * Tutar: en fazla iki ondalıklı, eksi olmayan metin. Ondalık ayırıcı nokta ya
 * da virgül olabilir ("1250,50"); binlik ayırıcı kabul edilmez ("1.250" hem
 * 1250 hem 1,25 okunabilir — yanlış tutar kaydetmektense reddedilir).
 */
export const moneyInputField = z.union([z.string(), z.number()], { error: 'Tutar geçersiz' }).transform((value, ctx) => {
  const text = String(value).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    ctx.addIssue({ code: 'custom', message: 'Tutar geçersiz (ör. 1250 ya da 1250,50; en fazla 2 ondalık)' });
    return z.NEVER;
  }
  const normalized = normalizeDecimalString(text);
  if (Number(normalized) > Number(MAX_RESERVATION_TOTAL)) {
    ctx.addIssue({ code: 'custom', message: 'Tutar çok yüksek; yazım hatası olabilir' });
    return z.NEVER;
  }
  return normalized;
});

/**
 * Konaklama aralığı denetimi (giriş < çıkış, en fazla `MAX_STAY_NIGHTS` gece).
 * @param {{ checkIn?: Date, checkOut?: Date }} value
 * @param {import('zod').RefinementCtx} ctx
 */
function refineStay(value, ctx) {
  if (!value.checkIn || !value.checkOut) return;
  if (value.checkOut <= value.checkIn) {
    ctx.addIssue({ code: 'custom', path: ['checkOut'], message: 'Çıkış tarihi girişten sonra olmalı' });
    return;
  }
  if ((value.checkOut - value.checkIn) / DAY_MS > MAX_STAY_NIGHTS) {
    ctx.addIssue({ code: 'custom', path: ['checkOut'], message: `Konaklama en fazla ${MAX_STAY_NIGHTS} gece olabilir` });
  }
}

/** Yeni misafir kartı (kısa form; ayrıntılar CRM'de, modül 22). */
export const guestInputSchema = z
  .object({
    firstName: z.string({ error: 'Ad zorunlu' }).trim().min(1, 'Ad zorunlu').max(100, 'Ad en fazla 100 karakter'),
    lastName: z.string({ error: 'Soyad zorunlu' }).trim().min(1, 'Soyad zorunlu').max(100, 'Soyad en fazla 100 karakter'),
    phone: z
      .string()
      .trim()
      .max(40, 'Telefon en fazla 40 karakter')
      .refine((value) => value === '' || /^\+?[\d\s()-]{7,}$/.test(value), { message: 'Telefon geçersiz' })
      .refine((value) => value === '' || value.replace(/\D/g, '').length >= 7, { message: 'Telefon en az 7 rakam olmalı' })
      .transform((value) => value || null)
      .nullish(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(200, 'E-posta en fazla 200 karakter')
      .refine((value) => value === '' || EMAIL_PATTERN.test(value), { message: 'E-posta geçersiz' })
      .transform((value) => value || null)
      .nullish(),
    nationality: z
      .string()
      .trim()
      .toUpperCase()
      .refine((value) => value === '' || /^[A-Z]{2}$/.test(value), { message: 'Uyruk iki harfli ülke kodu olmalı (TR, DE)' })
      .transform((value) => value || null)
      .nullish(),
  })
  .refine((value) => value.phone || value.email, {
    path: ['phone'],
    message: 'Misafire ulaşmak için telefon ya da e-posta girin',
  });

/** Konaklama satırı: oda tipi, kişi, pansiyon. */
const lineShape = {
  roomTypeId: uuid('Oda tipi seçin'),
  adults: adultsField,
  children: childrenField.default(0),
  boardType: boardField,
};

/**
 * Misafir: var olan kart (`guestId`) ya da yeni kart (`guest`). İkisi birden
 * ya da hiçbiri olmaz. `forceNewGuest`: aynı telefon/e-postada farklı adlı bir
 * kart bulunduğunda personel "yine de yeni kart aç" dedi.
 */
const guestChoiceShape = {
  guestId: uuid('Geçersiz misafir').nullish(),
  guest: guestInputSchema.nullish(),
  forceNewGuest: z.boolean().default(false),
};

/** @param {{ guestId?: string | null, guest?: object | null }} value @param {import('zod').RefinementCtx} ctx */
function refineGuestChoice(value, ctx) {
  if (Boolean(value.guestId) === Boolean(value.guest)) {
    ctx.addIssue({ code: 'custom', path: ['guestId'], message: 'Var olan bir misafir seçin ya da yeni misafir bilgisi girin' });
  }
}

/**
 * Elle fiyat: toplam ve gerekçe birlikte. Yetki sunucuda
 * (`reservations.price_override`).
 */
const manualPriceShape = {
  manualTotal: moneyInputField.nullish(),
  priceNote: trimmedOptional(MAX_PRICE_NOTE_LENGTH, 'Fiyat gerekçesi'),
};

/** @param {{ manualTotal?: string | null, priceNote?: string | null }} value @param {import('zod').RefinementCtx} ctx */
function refineManualPrice(value, ctx) {
  if (value.manualTotal !== null && value.manualTotal !== undefined && !value.priceNote) {
    ctx.addIssue({ code: 'custom', path: ['priceNote'], message: 'Elle fiyat için gerekçe yazın (ör. "kurumsal anlaşma")' });
  }
}

/** Ortak açılış alanları. */
const createCommonShape = {
  checkIn: dateField,
  checkOut: dateField,
  status: z.enum(RESERVATION_CREATE_STATUSES, { error: 'Geçersiz durum' }).default('CONFIRMED'),
  source: z.enum(RESERVATION_MANUAL_SOURCES, { error: 'Geçersiz kaynak' }).default('UI'),
  notes: trimmedOptional(MAX_RESERVATION_NOTES_LENGTH, 'Not'),
  /**
   * İstemcinin ürettiği tekil istek kimliği (form açılırken). Aynı kimlikle
   * ikinci gönderim yeni rezervasyon açmaz, ilkini döndürür (çift tık, ağ tekrarı).
   */
  requestId: uuid('Geçersiz istek kimliği'),
  /** Bekleme listesinden çevriliyorsa kaydın kimliği (çevrilince kapanır). */
  waitlistId: uuid('Geçersiz bekleme kaydı').nullish(),
};

export const createReservationSchema = z
  .object({
    ...guestChoiceShape,
    ...lineShape,
    ...createCommonShape,
    ...manualPriceShape,
    /** Oda planından "bu odaya" açılıyorsa oda (kontrolleriyle atanır). */
    roomId: uuid('Geçersiz oda').nullish(),
  })
  .superRefine(refineGuestChoice)
  .superRefine(refineStay)
  .superRefine(refineManualPrice);

const groupLineSchema = z.object({
  ...lineShape,
  quantity: z.coerce
    .number({ error: 'Adet sayı olmalı' })
    .int('Adet tam sayı olmalı')
    .min(1, 'En az 1 oda')
    .max(MAX_LINE_QUANTITY, `Bir satırda en fazla ${MAX_LINE_QUANTITY} oda`),
});

export const createGroupReservationSchema = z
  .object({
    ...guestChoiceShape,
    ...createCommonShape,
    groupName: z
      .string({ error: 'Grup adı zorunlu' })
      .trim()
      .min(1, 'Grup adı zorunlu')
      .max(MAX_GROUP_NAME_LENGTH, `Grup adı en fazla ${MAX_GROUP_NAME_LENGTH} karakter`),
    lines: z
      .array(groupLineSchema, { error: 'Oda satırları geçersiz' })
      .min(1, 'En az bir oda satırı ekleyin')
      .max(MAX_GROUP_LINES, `En fazla ${MAX_GROUP_LINES} satır`),
  })
  .superRefine(refineGuestChoice)
  .superRefine(refineStay)
  .superRefine((value, ctx) => {
    const rooms = value.lines.reduce((total, line) => total + line.quantity, 0);
    if (rooms < 2) {
      ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Grup en az iki odadan oluşur; tek oda için normal rezervasyon açın' });
    }
    if (rooms > MAX_GROUP_ROOMS) {
      ctx.addIssue({ code: 'custom', path: ['lines'], message: `Tek grupta en fazla ${MAX_GROUP_ROOMS} oda açılabilir` });
    }
  });

/**
 * Düzenleme. Gönderilmeyen alan değişmez. Fiyat:
 * - `price` verilmezse ve tarih / oda tipi değiştiyse: sistem fiyatındaki
 *   rezervasyon yeniden hesaplanır (kalan geceler anlaşılan fiyatında kalır);
 *   elle fiyatta sunucu karar ister (`PRICE_DECISION_REQUIRED`).
 * - `price.mode = CALCULATED`: güncel fiyatlarla baştan hesapla.
 * - `price.mode = MANUAL`: toplam + gerekçe (yetki gerekir).
 */
export const updateReservationSchema = z
  .object({
    expectedUpdatedAt,
    checkIn: dateField.optional(),
    checkOut: dateField.optional(),
    roomTypeId: uuid('Geçersiz oda tipi').optional(),
    adults: adultsField.optional(),
    children: childrenField.optional(),
    boardType: boardField.optional(),
    notes: trimmedOptional(MAX_RESERVATION_NOTES_LENGTH, 'Not'),
    price: z
      .discriminatedUnion('mode', [
        z.object({ mode: z.literal('CALCULATED') }),
        z.object({
          mode: z.literal('MANUAL'),
          total: moneyInputField,
          note: z
            .string({ error: 'Fiyat gerekçesi zorunlu' })
            .trim()
            .min(1, 'Elle fiyat için gerekçe yazın')
            .max(MAX_PRICE_NOTE_LENGTH, `Gerekçe en fazla ${MAX_PRICE_NOTE_LENGTH} karakter`),
        }),
      ])
      .optional(),
  })
  .superRefine(refineStay);

export const reservationVersionSchema = z.object({ expectedUpdatedAt });

export const cancelReservationSchema = z.object({
  expectedUpdatedAt,
  reason: z
    .string({ error: 'İptal sebebini yazın' })
    .trim()
    .min(1, 'İptal sebebini yazın')
    .max(MAX_CANCEL_REASON_LENGTH, `Sebep en fazla ${MAX_CANCEL_REASON_LENGTH} karakter`),
  /** Politikadaki cezayı uygulama (sebep denetim izine yazılır). */
  waiveFee: z.boolean().default(false),
});

export const noShowReservationSchema = z.object({
  expectedUpdatedAt,
  waiveFee: z.boolean().default(false),
});

/** Grubun bütün açık odalarını birlikte iptal. */
export const cancelGroupSchema = z.object({
  reason: cancelReservationSchema.shape.reason,
  waiveFee: z.boolean().default(false),
});

/** Fiyat ve müsaitlik önizlemesi (form yazılırken). */
export const reservationQuoteSchema = z
  .object({
    checkIn: dateField,
    checkOut: dateField,
    lines: z
      .array(
        z.object({
          roomTypeId: uuid('Oda tipi seçin'),
          quantity: z.coerce.number().int().min(1).max(MAX_LINE_QUANTITY).default(1),
          adults: adultsField.default(1),
          children: childrenField.default(0),
        }),
      )
      .max(MAX_GROUP_LINES, `En fazla ${MAX_GROUP_LINES} satır`)
      .default([]),
    /** Düzenlenen rezervasyon: kendi tuttuğu yer "dolu" sayılmasın. */
    excludeReservationId: uuid('Geçersiz rezervasyon').nullish(),
  })
  .superRefine(refineStay);

export const reservationListQuerySchema = paginationQuerySchema.extend({
  view: z.enum(RESERVATION_VIEWS, { error: 'Geçersiz görünüm' }).default('ALL'),
  status: z.enum(['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'], { error: 'Geçersiz durum' }).optional(),
  source: z.enum(RESERVATION_SOURCES, { error: 'Geçersiz kaynak' }).optional(),
  roomTypeId: uuid('Geçersiz oda tipi').optional(),
  groupId: uuid('Geçersiz grup').optional(),
  /** Bu aralıkta en az bir gecesi olan konaklamalar (her iki uç dahil). */
  from: dateField.optional(),
  to: dateField.optional(),
  search: z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional(),
  sort: z.enum(RESERVATION_SORTS, { error: 'Geçersiz sıralama' }).optional(),
}).superRefine((value, ctx) => {
  if (value.from && value.to && value.to < value.from) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
  }
});

export const reservationParamSchema = z.object({
  reservationId: uuid('Geçersiz rezervasyon'),
});

export const reservationGroupParamSchema = z.object({
  groupId: uuid('Geçersiz grup'),
});

export const guestSearchQuerySchema = z.object({
  q: z.string({ error: 'Aranacak metni yazın' }).trim().min(2, 'En az 2 karakter yazın').max(100, 'En fazla 100 karakter'),
});

/* ─────────────── Bekleme listesi ─────────────── */

export const createWaitlistSchema = z
  .object({
    guestId: uuid('Geçersiz misafir').nullish(),
    firstName: z.string({ error: 'Ad zorunlu' }).trim().min(1, 'Ad zorunlu').max(100, 'Ad en fazla 100 karakter'),
    lastName: z.string({ error: 'Soyad zorunlu' }).trim().min(1, 'Soyad zorunlu').max(100, 'Soyad en fazla 100 karakter'),
    phone: guestInputSchema.shape.phone,
    email: guestInputSchema.shape.email,
    ...lineShape,
    checkIn: dateField,
    checkOut: dateField,
    notes: trimmedOptional(MAX_RESERVATION_NOTES_LENGTH, 'Not'),
  })
  .refine((value) => value.guestId || value.phone || value.email, {
    path: ['phone'],
    message: 'Yer açılınca aramak için telefon ya da e-posta girin',
  })
  .superRefine(refineStay);

export const waitlistListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(WAITLIST_STATUSES, { error: 'Geçersiz durum' }).optional(),
  /** Yalnızca açık kayıtlar (yer bekleyen + yer açılan). Varsayılan. */
  open: queryBoolean.optional(),
  roomTypeId: uuid('Geçersiz oda tipi').optional(),
});

export const waitlistParamSchema = z.object({
  waitlistId: uuid('Geçersiz bekleme kaydı'),
});

export const closeWaitlistSchema = z.object({
  reason: z
    .string({ error: 'Sebep yazın' })
    .trim()
    .min(1, 'Sebep yazın')
    .max(MAX_CANCEL_REASON_LENGTH, `Sebep en fazla ${MAX_CANCEL_REASON_LENGTH} karakter`),
});
