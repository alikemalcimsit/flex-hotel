import { BOARD_TYPES, MAX_STAY_NIGHTS } from './constants.js';
import { normalizeDecimalString } from './decimal.js';
import { dateField, expectedUpdatedAt, paginationQuerySchema } from './fields.js';
import { z } from './locale.js';

/**
 * Promosyon ve kupon sözleşmeleri (modül 31).
 *
 * Kararlar (kullanıcı, 14 Ekim 2026):
 * - **Birleşme yok:** bir rezervasyona tek indirim düşer — uygun otomatik
 *   promosyonlar ve girilen kuponun promosyonu arasından misafire en çok indirim
 *   sağlayan. Kupon daha avantajlı değilse kullanılmaz (hakkı düşmez).
 * - **Acente satışı:** kontrat fiyatı nettir; acente rezervasyonuna promosyon
 *   da kupon da uygulanmaz.
 * - **İptal / gelmedi:** kuponun kullanım hakkı geri açılır. İptal geri
 *   alınırken kupon hâlâ boşsa yeniden bağlanır; başkası kullandıysa geri alma
 *   reddedilir.
 * - **Kısalma:** konaklama kısalınca (düzenleme, erken çıkış) promosyon şartı
 *   bozulursa indirim geri alınır; önizlemede önceden gösterilir, folyoya fark
 *   işlenir.
 *
 * Promosyon rezervasyon açılırken **kopyalanır** (koşulları ve indirimiyle):
 * sonradan promosyon değişse ya da durdurulsa da açılmış rezervasyonun sözü
 * değişmez; konaklama değişince kopyadaki koşullar yeniden denetlenir.
 *
 * Tarihler gün hassasiyetindedir ve **iki ucu da dahildir**. "Rezervasyon
 * tarihi" satışın yapıldığı otel günüdür; "konaklama tarihi" indirimin düştüğü
 * gecelerdir (dönem dışındaki geceler tam fiyattır).
 */

/* ─────────────── Durum ve türler ─────────────── */

/**
 * Prisma `PromotionStatus` ile birebir.
 * - `DRAFT`: hazırlanıyor, uygulanmaz.
 * - `ACTIVE`: yayında; koşulu tutan satışa uygulanır.
 * - `PAUSED`: durduruldu (yeniden yayına alınabilir); açılmış rezervasyonlar etkilenmez.
 */
export const PROMOTION_STATUSES = Object.freeze(['DRAFT', 'ACTIVE', 'PAUSED']);

export const PROMOTION_STATUS_LABELS = Object.freeze({
  DRAFT: 'Taslak',
  ACTIVE: 'Yayında',
  PAUSED: 'Durduruldu',
});

/**
 * Prisma `PromotionDiscountType` ile birebir.
 * - `PERCENT`: konaklama dönemine düşen her gecenin yüzdesi.
 * - `AMOUNT`: konaklama başına tutar (dönemdeki gecelere fiyatları oranında bölünür).
 * - `FREE_NIGHTS`: "X gece kal Y gece öde" — her X gecede en ucuz (X − Y) gece bedava.
 */
export const PROMOTION_DISCOUNT_TYPES = Object.freeze(['PERCENT', 'AMOUNT', 'FREE_NIGHTS']);

export const PROMOTION_DISCOUNT_TYPE_LABELS = Object.freeze({
  PERCENT: 'Yüzde indirim',
  AMOUNT: 'Tutar indirimi (konaklama başına)',
  FREE_NIGHTS: 'X gece kal, Y gece öde',
});

/**
 * Promosyonun uygulanabileceği satış kaynakları: rezervasyon kaynakları eksi
 * acente (kontrat fiyatı nettir). Prisma `ReservationSource` değerleri.
 */
export const PROMOTION_SOURCES = Object.freeze(['UI', 'PHONE', 'EMAIL', 'WEBCHAT', 'WHATSAPP', 'WIDGET', 'OTA']);

/** Yeni promosyonda seçili gelen kaynaklar: doğrudan satış (OTA fiyatını kanal verir, bilerek seçilir). */
export const DEFAULT_PROMOTION_SOURCES = Object.freeze(['UI', 'PHONE', 'EMAIL', 'WEBCHAT', 'WHATSAPP', 'WIDGET']);

/**
 * Promosyonun / kuponun uygulanmama sebepleri: hata `code`'u ve önizlemedeki
 * `issue.code` aynı değerlerdir.
 */
export const PROMOTION_ISSUES = Object.freeze([
  'COUPON_NOT_FOUND',
  'COUPON_DISABLED',
  'COUPON_USED_UP',
  'COUPON_PROMOTION_INACTIVE',
  'COUPON_NOT_BETTER',
  'PROMO_AGENCY',
  'PROMO_MANUAL_PRICE',
  'PROMO_SOURCE',
  'PROMO_BOOKING_WINDOW',
  'PROMO_ROOM_TYPE',
  'PROMO_BOARD',
  'PROMO_MIN_NIGHTS',
  'PROMO_MAX_NIGHTS',
  'PROMO_LEAD_MIN',
  'PROMO_LEAD_MAX',
  'PROMO_STAY_WINDOW',
  'PROMO_FREE_NIGHTS',
  'PROMO_NO_DISCOUNT',
]);

export const PROMOTION_ISSUE_LABELS = Object.freeze({
  COUPON_NOT_FOUND: 'Kupon bulunamadı',
  COUPON_DISABLED: 'Kupon kapatılmış',
  COUPON_USED_UP: 'Kuponun kullanım hakkı dolmuş',
  COUPON_PROMOTION_INACTIVE: 'Kuponun promosyonu yayında değil',
  COUPON_NOT_BETTER: 'Daha avantajlı promosyon var',
  PROMO_AGENCY: 'Acente satışında promosyon uygulanmaz',
  PROMO_MANUAL_PRICE: 'Elle fiyatta promosyon uygulanmaz',
  PROMO_SOURCE: 'Bu satış kanalında geçerli değil',
  PROMO_BOOKING_WINDOW: 'Rezervasyon tarihi dönem dışında',
  PROMO_ROOM_TYPE: 'Oda tipi kapsam dışında',
  PROMO_BOARD: 'Pansiyon kapsam dışında',
  PROMO_MIN_NIGHTS: 'En az gece şartı tutmuyor',
  PROMO_MAX_NIGHTS: 'En fazla gece şartı tutmuyor',
  PROMO_LEAD_MIN: 'Erken rezervasyon şartı tutmuyor',
  PROMO_LEAD_MAX: 'Son dakika şartı tutmuyor',
  PROMO_STAY_WINDOW: 'Konaklama tarihleri dönem dışında',
  PROMO_FREE_NIGHTS: 'Bedava gece için yeterli gece yok',
  PROMO_NO_DISCOUNT: 'İndirim doğmuyor',
});

/**
 * Önizlemede kuponun durumu.
 * - `APPLIED`: kupon uygulanıyor.
 * - `NOT_BETTER`: kupon geçerli ama otomatik bir promosyon daha avantajlı; kupon kullanılmaz.
 * - `NOT_APPLICABLE`: kupon var ama bu konaklamaya uymuyor (sebebi `issue`).
 * - `INVALID`: kupon yok, kapalı ya da dolmuş.
 */
export const COUPON_QUOTE_STATUSES = Object.freeze(['APPLIED', 'NOT_BETTER', 'NOT_APPLICABLE', 'INVALID']);

/* ─────────────── Sınırlar ─────────────── */

export const MAX_PROMOTION_NAME_LENGTH = 120;
export const MAX_PROMOTION_NOTES_LENGTH = 1000;
/** Yüzde indirimin üst sınırı (100 = bedava). */
export const MAX_PROMOTION_PERCENT = 100;
/** Tutar indiriminin üst sınırı (rezervasyon toplamı sınırıyla aynı). */
export const MAX_PROMOTION_AMOUNT = '100000000';
/** "X gece kal" en fazla bu kadar gece. */
export const MAX_FREE_NIGHTS_CYCLE = 30;
/** Erken rezervasyon / son dakika gün sınırı (yaklaşık iki yıl). */
export const MAX_LEAD_DAYS = 730;
/** Rezervasyon ve konaklama döneminin en uzun hâli (gün; yaklaşık üç yıl). */
export const MAX_PROMOTION_PERIOD_DAYS = 1100;
/** Promosyonun kapsayabileceği en fazla oda tipi. */
export const MAX_PROMOTION_ROOM_TYPES = 100;

/** Kupon kodu uzunluğu (önek + tire + rastgele kısım dahil). */
export const MIN_COUPON_CODE_LENGTH = 4;
export const MAX_COUPON_CODE_LENGTH = 30;
/** Toplu üretimde önek en fazla bu kadar karakter. */
export const MAX_COUPON_PREFIX_LENGTH = 10;
/** Toplu üretimde rastgele kısmın uzunluğu (22 harf^8 ≈ 54 milyar olasılık). */
export const COUPON_RANDOM_LENGTH = 8;
/**
 * Toplu üretimde kullanılan harfler: telefonda ya da kâğıtta karışanlar (0/O,
 * 1/I/L, 2/Z, 5/S, 6/G, 8/B) yok — onay koduyla aynı alfabe.
 */
export const COUPON_CODE_ALPHABET = 'ACDEFHJKMNPQRTUVWXY347';
/** Bir seferde üretilecek en fazla kupon. */
export const MAX_COUPON_BATCH = 5000;
/** Kupon başına en fazla kullanım (boş = sınırsız). */
export const MAX_COUPON_USES = 100000;
/** Kullanım raporu dönemi en fazla bu kadar gün. */
export const MAX_PROMOTION_REPORT_DAYS = 1100;

/* ─────────────── Saf yardımcılar (ekran ve sunucu aynı kuralı kullanır) ─────────────── */

/** @param {Date | string} value */
export const promotionDay = (value) => (typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10));

/** İki uç dahil gün sayısı. */
export function promotionPeriodDays(startDate, endDate) {
  return Math.round((Date.parse(promotionDay(endDate)) - Date.parse(promotionDay(startDate))) / 86_400_000) + 1;
}

/**
 * Kupon kodunu karşılaştırılabilir biçime getirir: boşluklar atılır, büyük harf
 * (Türkçe "i" sorunu olmasın diye İngilizce kural: "yaz2027" → "YAZ2027").
 * @param {string | null | undefined} value
 */
export function normalizeCouponCode(value) {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .toLocaleUpperCase('en-US');
}

const COUPON_CODE_PATTERN = new RegExp(`^[A-Z0-9][A-Z0-9-]{${MIN_COUPON_CODE_LENGTH - 1},${MAX_COUPON_CODE_LENGTH - 1}}$`);

/** Kupon kodu biçimi geçerli mi (normalize edilmiş kodda)? */
export const isCouponCode = (value) => COUPON_CODE_PATTERN.test(value);

/* ─────────────── Şema parçaları ─────────────── */

const uuid = (message) => z.string().uuid({ message });

/** Formdan gelen boş metin "yok" demektir. */
const emptyToNull = (value) => (value === '' || value === undefined ? null : value);

/**
 * İsteğe bağlı tam sayı (boş → null).
 * @param {{ label: string, min: number, max: number }} options
 */
const optionalInt = ({ label, min, max }) =>
  z.preprocess(
    emptyToNull,
    z.coerce
      .number({ error: `${label} sayı olmalı` })
      .int(`${label} tam sayı olmalı`)
      .min(min, `${label} en az ${min} olmalı`)
      .max(max, `${label} en fazla ${max} olabilir`)
      .nullable(),
  );

/** İsteğe bağlı gün (boş → null). */
const optionalDay = z.preprocess(emptyToNull, dateField.nullable());

/**
 * İndirim değeri: en fazla iki ondalıklı, eksi olmayan metin (virgül de olur).
 * Türüne göre aralığı `refinePromotion` denetler; burada yalnızca biçim.
 */
const discountValueField = z.preprocess(
  (value) => (value === null || value === undefined || String(value).trim() === '' ? null : value),
  z
    .union([z.string(), z.number()], { error: 'İndirim değeri geçersiz' })
    .transform((value, ctx) => {
      const text = String(value).trim().replace(',', '.');
      if (!/^\d+(\.\d{1,2})?$/.test(text)) {
        ctx.addIssue({ code: 'custom', message: 'İndirim değeri geçersiz (ör. 15 ya da 250,50; en fazla 2 ondalık)' });
        return z.NEVER;
      }
      return normalizeDecimalString(text);
    })
    .nullable(),
);

/** Tekrarsız liste. */
const uniqueList = (values) => [...new Set(values)];

const promotionShape = {
  name: z
    .string({ error: 'Promosyon adı zorunlu' })
    .trim()
    .min(2, 'Promosyon adı en az 2 karakter')
    .max(MAX_PROMOTION_NAME_LENGTH, `Promosyon adı en fazla ${MAX_PROMOTION_NAME_LENGTH} karakter`),
  notes: z
    .string()
    .trim()
    .max(MAX_PROMOTION_NOTES_LENGTH, `Not en fazla ${MAX_PROMOTION_NOTES_LENGTH} karakter`)
    .transform((value) => value || null)
    .nullish(),
  /** Kuponla mı (kod girilince) yoksa koşul tutunca kendiliğinden mi uygulanır. */
  requiresCoupon: z.boolean({ error: 'Uygulama şeklini seçin' }).default(false),
  discountType: z.enum(PROMOTION_DISCOUNT_TYPES, { error: 'İndirim tipini seçin' }),
  discountValue: discountValueField,
  stayNights: optionalInt({ label: '"Kal" gece sayısı', min: 2, max: MAX_FREE_NIGHTS_CYCLE }),
  payNights: optionalInt({ label: '"Öde" gece sayısı', min: 1, max: MAX_FREE_NIGHTS_CYCLE - 1 }),
  bookFrom: optionalDay,
  bookTo: optionalDay,
  stayFrom: optionalDay,
  stayTo: optionalDay,
  minNights: optionalInt({ label: 'En az gece', min: 1, max: MAX_STAY_NIGHTS }),
  maxNights: optionalInt({ label: 'En fazla gece', min: 1, max: MAX_STAY_NIGHTS }),
  minLeadDays: optionalInt({ label: 'Erken rezervasyon günü', min: 0, max: MAX_LEAD_DAYS }),
  maxLeadDays: optionalInt({ label: 'Son dakika günü', min: 0, max: MAX_LEAD_DAYS }),
  /** Boşsa bütün oda tipleri. */
  roomTypeIds: z
    .array(uuid('Geçersiz oda tipi'), { error: 'Oda tipleri geçersiz' })
    .max(MAX_PROMOTION_ROOM_TYPES, `En fazla ${MAX_PROMOTION_ROOM_TYPES} oda tipi`)
    .default([])
    .transform(uniqueList),
  /** Boşsa bütün pansiyonlar. */
  boardTypes: z
    .array(z.enum(BOARD_TYPES, { error: 'Geçersiz pansiyon tipi' }), { error: 'Pansiyonlar geçersiz' })
    .default([])
    .transform(uniqueList),
  sources: z
    .array(z.enum(PROMOTION_SOURCES, { error: 'Geçersiz satış kanalı' }), { error: 'Satış kanallarını seçin' })
    .min(1, 'En az bir satış kanalı seçin')
    .transform(uniqueList),
};

/**
 * Promosyonun kendi içindeki tutarlılığı. Ekran ve sunucu aynı denetimi yapar;
 * veritabanı kısıtları son savunmadır.
 *
 * @param {Record<string, any>} value
 * @param {import('zod').RefinementCtx} ctx
 */
function refinePromotion(value, ctx) {
  const issue = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
  const amount = value.discountValue === null ? null : Number(value.discountValue);

  if (value.discountType === 'PERCENT') {
    if (amount === null) issue('discountValue', 'İndirim yüzdesini yazın');
    else if (amount <= 0 || amount > MAX_PROMOTION_PERCENT) issue('discountValue', `Yüzde 0'dan büyük, en fazla ${MAX_PROMOTION_PERCENT} olmalı`);
  } else if (value.discountType === 'AMOUNT') {
    if (amount === null) issue('discountValue', 'İndirim tutarını yazın');
    else if (amount <= 0) issue('discountValue', 'Tutar sıfırdan büyük olmalı');
    else if (amount > Number(MAX_PROMOTION_AMOUNT)) issue('discountValue', 'Tutar çok yüksek; yazım hatası olabilir');
  } else if (value.discountType === 'FREE_NIGHTS') {
    if (value.stayNights === null) issue('stayNights', '"Kaç gece kalana" sayısını yazın');
    if (value.payNights === null) issue('payNights', '"Kaç gece ödesin" sayısını yazın');
    if (value.stayNights !== null && value.payNights !== null && value.payNights >= value.stayNights) {
      issue('payNights', 'Ödenen gece, kalınan geceden az olmalı (ör. 3 kal 2 öde)');
    }
    if (value.stayNights !== null && value.maxNights !== null && value.maxNights < value.stayNights) {
      issue('maxNights', `En fazla gece ${value.stayNights}'ten az olursa bedava gece hiç doğmaz`);
    }
    if (value.stayNights !== null && value.stayFrom && value.stayTo && promotionPeriodDays(value.stayFrom, value.stayTo) < value.stayNights) {
      issue('stayTo', `Konaklama dönemi en az ${value.stayNights} gece olmalı; yoksa bedava gece hiç doğmaz`);
    }
  }

  const window = (from, to, label) => {
    if (!value[from] || !value[to]) return;
    if (value[to] < value[from]) issue(to, 'Bitiş başlangıçtan önce olamaz');
    else if (promotionPeriodDays(value[from], value[to]) > MAX_PROMOTION_PERIOD_DAYS) {
      issue(to, `${label} en fazla ${MAX_PROMOTION_PERIOD_DAYS} gün olabilir`);
    }
  };
  window('bookFrom', 'bookTo', 'Rezervasyon dönemi');
  window('stayFrom', 'stayTo', 'Konaklama dönemi');
  if (value.minNights !== null && value.maxNights !== null && value.maxNights < value.minNights) {
    issue('maxNights', 'En fazla gece, en az geceden küçük olamaz');
  }
  if (value.minLeadDays !== null && value.maxLeadDays !== null && value.maxLeadDays < value.minLeadDays) {
    issue('maxLeadDays', 'Son dakika günü, erken rezervasyon gününden küçük olamaz');
  }
}

/**
 * Türün kullanmadığı alanlar boşaltılır (ekran tür değiştirince eski değer kalmasın).
 * @param {Record<string, any>} value
 */
function normalizePromotion(value) {
  const freeNights = value.discountType === 'FREE_NIGHTS';
  return {
    ...value,
    discountValue: freeNights ? null : value.discountValue,
    stayNights: freeNights ? value.stayNights : null,
    payNights: freeNights ? value.payNights : null,
  };
}

/** Yeni promosyon (taslak olarak açılır). */
export const createPromotionSchema = z.object(promotionShape).superRefine(refinePromotion).transform(normalizePromotion);

/** Promosyonu günceller (form hepsini gönderir) — sürüm kontrolüyle. Açılmış rezervasyonlar etkilenmez. */
export const updatePromotionSchema = z
  .object({ expectedUpdatedAt, ...promotionShape })
  .superRefine(refinePromotion)
  .transform(normalizePromotion);

/** Yayına al / durdur. */
export const promotionStatusSchema = z.object({
  expectedUpdatedAt,
  status: z.enum(['ACTIVE', 'PAUSED'], { error: 'Geçersiz durum' }),
});

export const promotionVersionSchema = z.object({ expectedUpdatedAt });

export const promotionParamSchema = z.object({ promotionId: uuid('Geçersiz promosyon') });
export const couponParamSchema = z.object({
  promotionId: uuid('Geçersiz promosyon'),
  couponId: uuid('Geçersiz kupon'),
});

export const promotionListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional(),
  status: z.enum(PROMOTION_STATUSES, { error: 'Geçersiz durum' }).optional(),
  /** `AUTO`: kendiliğinden uygulananlar, `COUPON`: kuponla uygulananlar. */
  kind: z.enum(['AUTO', 'COUPON'], { error: 'Geçersiz tür' }).optional(),
});

/* ─────────────── Kupon ─────────────── */

/** Kupon kodu: harf, rakam ve tire; büyük harfe çevrilir, boşluklar atılır. */
export const couponCodeField = z
  .string({ error: 'Kupon kodunu yazın' })
  .transform(normalizeCouponCode)
  .refine((value) => value.length >= MIN_COUPON_CODE_LENGTH, { message: `Kupon kodu en az ${MIN_COUPON_CODE_LENGTH} karakter` })
  .refine((value) => value.length <= MAX_COUPON_CODE_LENGTH, { message: `Kupon kodu en fazla ${MAX_COUPON_CODE_LENGTH} karakter` })
  .refine(isCouponCode, { message: 'Kupon kodu yalnızca harf, rakam ve tire içerebilir (tireyle başlamaz)' });

/** Kupon başına kullanım: boş = sınırsız, 1 = tek kullanımlık. Her oda bir kullanımdır. */
const maxUsesField = optionalInt({ label: 'Kullanım sayısı', min: 1, max: MAX_COUPON_USES });

/**
 * Kupon üretimi:
 * - `GENERATE`: `count` adet rastgele kod (isteğe bağlı önekle: "YAZ-K7QXNA3P").
 * - `CUSTOM`: tek, elle verilen kod ("YAZ2027"); genellikle çok kullanımlık.
 */
export const createCouponsSchema = z.discriminatedUnion(
  'mode',
  [
    z.object({
      mode: z.literal('GENERATE'),
      count: z.coerce
        .number({ error: 'Adet sayı olmalı' })
        .int('Adet tam sayı olmalı')
        .min(1, 'En az 1 kupon')
        .max(MAX_COUPON_BATCH, `Bir seferde en fazla ${MAX_COUPON_BATCH} kupon`),
      prefix: z
        .string()
        .transform(normalizeCouponCode)
        .refine((value) => value === '' || /^[A-Z0-9]+$/.test(value), { message: 'Önek yalnızca harf ve rakam içerebilir' })
        .refine((value) => value.length <= MAX_COUPON_PREFIX_LENGTH, { message: `Önek en fazla ${MAX_COUPON_PREFIX_LENGTH} karakter` })
        .transform((value) => value || null)
        .nullish(),
      maxUses: maxUsesField,
    }),
    z.object({
      mode: z.literal('CUSTOM'),
      code: couponCodeField,
      maxUses: maxUsesField,
    }),
  ],
  { error: 'Üretim şeklini seçin' },
);

/** Kuponu kapat / yeniden aç. */
export const couponStatusSchema = z.object({
  expectedUpdatedAt,
  isActive: z.boolean({ error: 'Durumu seçin' }),
});

export const couponListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100, 'Arama metni en fazla 100 karakter').optional(),
  /** `USED`: en az bir geçerli kullanımı olanlar, `UNUSED`: hiç kullanılmamışlar. */
  usage: z.enum(['USED', 'UNUSED'], { error: 'Geçersiz süzgeç' }).optional(),
  active: z.enum(['true', 'false'], { error: 'Geçersiz süzgeç' }).optional(),
  batchId: uuid('Geçersiz üretim').optional(),
});

/** Bir üretimin kodları (dağıtım için Excel). Üretim en fazla `MAX_COUPON_BATCH` kod. */
export const couponExportQuerySchema = z.object({ batchId: uuid('Geçersiz üretim') });

/* ─────────────── Kullanım raporu ─────────────── */

/**
 * - `BOOKED`: rezervasyonun açıldığı (satış) güne göre.
 * - `STAY`: giriş gününe göre.
 */
export const PROMOTION_REPORT_BASES = Object.freeze(['BOOKED', 'STAY']);

export const PROMOTION_REPORT_BASIS_LABELS = Object.freeze({
  BOOKED: 'Satış tarihine göre',
  STAY: 'Giriş tarihine göre',
});

/** @param {{ from?: Date, to?: Date }} value @param {import('zod').RefinementCtx} ctx */
function refineReportPeriod(value, ctx) {
  if (!value.from || !value.to) return;
  if (value.to < value.from) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
  } else if (promotionPeriodDays(value.from, value.to) > MAX_PROMOTION_REPORT_DAYS) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: `Dönem en fazla ${MAX_PROMOTION_REPORT_DAYS} gün olabilir` });
  }
}

const reportPeriodShape = {
  from: dateField,
  to: dateField,
  basis: z.enum(PROMOTION_REPORT_BASES, { error: 'Geçersiz rapor esası' }).default('BOOKED'),
};

/** Promosyon başına kullanım özeti (sayfalı); `promotionId` verilirse yalnızca o promosyon (kartın kullanım sekmesi). */
export const promotionReportQuerySchema = paginationQuerySchema
  .extend({ ...reportPeriodShape, promotionId: uuid('Geçersiz promosyon').optional() })
  .superRefine(refineReportPeriod);

/** Bir promosyonun rezervasyonları (sayfalı). */
export const promotionReservationsQuerySchema = paginationQuerySchema
  .extend({
    ...reportPeriodShape,
    status: z.enum(['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'], { error: 'Geçersiz durum' }).optional(),
    couponId: uuid('Geçersiz kupon').optional(),
    search: z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional(),
  })
  .superRefine(refineReportPeriod);
