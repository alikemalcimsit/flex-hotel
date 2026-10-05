import { normalizeDecimalString } from './decimal.js';
import { expectedUpdatedAt, listQuerySchema, queryBoolean } from './fields.js';
import { z } from './locale.js';

/**
 * Kayıp eşya sözleşmeleri (modül 21).
 *
 * - Bulunan eşya fotoğraflı kaydedilir; poşetin üstüne yazılan **etiket no**
 *   (`LF-7K2Q9X`) otel içinde tekildir.
 * - **Eşleştirme:** eşya odada bulunduysa o sırada odada kalan ve son günlerde
 *   odadan ayrılan konaklamalar (oda değişimi dahil) aday olarak gelir; ortak
 *   alanda bulunduysa misafir adıyla / telefonla aranır.
 * - **Teslim:** elden (değerli eşyada kimlik görülmesi zorunlu) ya da kargo
 *   (firma, takip no, adres).
 * - **Saklama:** sahibi çıkmayan eşya süre dolunca "süresi dolan" listesine
 *   düşer (normal 90 gün, değerli 1 yıl; ayarlanabilir), yetkili gerekçeyle
 *   kapatır (bağış, imha, polise teslim). Kapanan eşyanın fotoğrafları bir ay
 *   sonra silinir.
 */

/* ─────────────── Sabitler ─────────────── */

/** Prisma `LostItemCategory` ile birebir. */
export const LOST_ITEM_CATEGORIES = Object.freeze(['ELECTRONICS', 'JEWELRY', 'DOCUMENTS', 'CLOTHING', 'ACCESSORY', 'TOY', 'OTHER']);

export const LOST_ITEM_CATEGORY_LABELS = Object.freeze({
  ELECTRONICS: 'Elektronik',
  JEWELRY: 'Takı / saat',
  DOCUMENTS: 'Cüzdan / kimlik / para',
  CLOTHING: 'Giysi',
  ACCESSORY: 'Çanta / gözlük / aksesuar',
  TOY: 'Oyuncak / çocuk eşyası',
  OTHER: 'Diğer',
});

/** Formda "değerli" kutusunun kendiliğinden işaretlendiği kategoriler (personel değiştirebilir). */
export const LOST_ITEM_VALUABLE_CATEGORIES = Object.freeze(['ELECTRONICS', 'JEWELRY', 'DOCUMENTS']);

/** Prisma `LostItemStatus` ile birebir. */
export const LOST_ITEM_STATUSES = Object.freeze(['STORED', 'MATCHED', 'RETURNED', 'DISPOSED']);

export const LOST_ITEM_STATUS_LABELS = Object.freeze({
  STORED: 'Depoda',
  MATCHED: 'Sahibi bulundu',
  RETURNED: 'Teslim edildi',
  DISPOSED: 'Kapatıldı',
});

/** Henüz sonuçlanmamış eşya (düzenlenebilir, eşleştirilebilir, teslim edilebilir). */
export const LOST_ITEM_OPEN_STATUSES = Object.freeze(['STORED', 'MATCHED']);

/** Prisma `LostItemReturnMethod` ile birebir. */
export const LOST_ITEM_RETURN_METHODS = Object.freeze(['IN_PERSON', 'SHIPPED']);

export const LOST_ITEM_RETURN_METHOD_LABELS = Object.freeze({
  IN_PERSON: 'Elden teslim',
  SHIPPED: 'Kargoyla gönderildi',
});

/** Prisma `LostItemShippingPayer` ile birebir. */
export const LOST_ITEM_SHIPPING_PAYERS = Object.freeze(['GUEST', 'HOTEL']);

export const LOST_ITEM_SHIPPING_PAYER_LABELS = Object.freeze({
  GUEST: 'Misafir (alıcı ödemeli)',
  HOTEL: 'Otel karşıladı',
});

/** Prisma `LostItemDisposal` ile birebir. */
export const LOST_ITEM_DISPOSALS = Object.freeze(['DONATED', 'DESTROYED', 'POLICE', 'RECORD_ERROR']);

export const LOST_ITEM_DISPOSAL_LABELS = Object.freeze({
  DONATED: 'Bağışlandı',
  DESTROYED: 'İmha edildi',
  POLICE: 'Polise / mülki amire teslim edildi',
  RECORD_ERROR: 'Hatalı kayıt',
});

/** Prisma `LostItemContactChannel` ile birebir: iletişim notunun kanalı. */
export const LOST_ITEM_CONTACT_CHANNELS = Object.freeze(['PHONE', 'WHATSAPP', 'SMS', 'EMAIL', 'IN_PERSON', 'NOTE']);

export const LOST_ITEM_CONTACT_CHANNEL_LABELS = Object.freeze({
  PHONE: 'Telefon',
  WHATSAPP: 'WhatsApp',
  SMS: 'SMS',
  EMAIL: 'E-posta',
  IN_PERSON: 'Yüz yüze',
  NOTE: 'Not',
});

/** Liste görünümleri. */
export const LOST_ITEM_VIEWS = Object.freeze(['OPEN', 'MATCHED', 'EXPIRED', 'RETURNED', 'DISPOSED']);

export const LOST_ITEM_VIEW_LABELS = Object.freeze({
  OPEN: 'Saklananlar',
  MATCHED: 'Teslim bekleyen',
  EXPIRED: 'Süresi dolan',
  RETURNED: 'Teslim edilen',
  DISPOSED: 'Kapatılan',
});

/** Bir eşyanın en fazla fotoğrafı. */
export const LOST_ITEM_MAX_PHOTOS = 4;
/** Tarayıcının küçülttüğü fotoğrafın uzun kenarı (piksel). */
export const LOST_ITEM_PHOTO_MAX_EDGE = 1600;
/** Liste önizlemesinin uzun kenarı (piksel). */
export const LOST_ITEM_THUMB_MAX_EDGE = 320;
/** Küçültülmüş fotoğrafın en büyük boyutu (bayt). */
export const LOST_ITEM_PHOTO_MAX_BYTES = 1_500_000;
/** Önizlemenin en büyük boyutu (bayt). */
export const LOST_ITEM_THUMB_MAX_BYTES = 150_000;
/** Kabul edilen görüntü türleri (tarayıcı JPEG ya da WebP'ye çevirir). */
export const LOST_ITEM_PHOTO_TYPES = Object.freeze(['image/jpeg', 'image/webp']);

/** Eşleştirmede geriye bakılan gün: oda bu süre içinde boşaldıysa çıkan misafir aday. */
export const LOST_ITEM_MATCH_LOOKBACK_DAYS = 7;
/** Eşleştirme adayı en fazla. */
export const LOST_ITEM_MATCH_CANDIDATE_LIMIT = 12;
/** Bulunma anı en fazla bu kadar gün geriye yazılabilir (geç girilen kayıt). */
export const LOST_ITEM_MAX_BACKDATE_DAYS = 30;
/** Bulunma anı en fazla bu kadar ileri olabilir (saat farkı toleransı). */
export const LOST_ITEM_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** Saklama süresi varsayılanları ve sınırları (gün). */
export const LOST_ITEM_DEFAULT_RETENTION_DAYS = 90;
export const LOST_ITEM_DEFAULT_VALUABLE_RETENTION_DAYS = 365;
export const LOST_ITEM_MIN_RETENTION_DAYS = 7;
export const LOST_ITEM_MAX_RETENTION_DAYS = 3650;
/** Kapanan (teslim edilen / kapatılan) eşyanın fotoğrafları bu kadar gün sonra silinir. */
export const LOST_ITEM_PHOTO_PURGE_DAYS = 30;

export const LOST_ITEM_DESCRIPTION_MIN = 3;
export const LOST_ITEM_DESCRIPTION_MAX = 500;
export const LOST_ITEM_PLACE_MAX = 120;
export const LOST_ITEM_PERSON_MAX = 100;
export const LOST_ITEM_NOTE_MAX = 1000;
export const LOST_ITEM_REASON_MIN = 3;
export const LOST_ITEM_REASON_MAX = 300;
export const LOST_ITEM_ADDRESS_MAX = 500;
export const LOST_ITEM_TRACKING_MAX = 60;
/** Kargo ücretinin üst sınırı (yazım hatasını yakalamak için). */
export const LOST_ITEM_MAX_SHIPPING_COST = '100000';
export const LOST_ITEM_PAGE_SIZE = 25;
export const LOST_ITEM_MAX_PAGE_SIZE = 100;

/* ─────────────── Alanlar ─────────────── */

const uuid = (message) => z.string().uuid({ message });

const text = ({ label, min = 1, max }) =>
  z
    .string({ error: `${label} zorunlu` })
    .trim()
    .min(min, min > 1 ? `${label} en az ${min} karakter olmalı` : `${label} zorunlu`)
    .max(max, `${label} en fazla ${max} karakter olabilir`);

const optionalText = ({ label, max }) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter olabilir`)
    .transform((value) => value || null)
    .nullish();

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-AA-GG biçiminde olmalı');

const timestampField = (label) =>
  z
    .union([z.string(), z.date()], { error: `${label} zorunlu` })
    .transform((value) => (value instanceof Date ? value : new Date(value)))
    .refine((value) => !Number.isNaN(value.getTime()), { message: `${label} geçersiz` });

const retentionDays = (label) =>
  z.coerce
    .number({ error: `${label} sayı olmalı` })
    .int(`${label} tam gün olmalı`)
    .min(LOST_ITEM_MIN_RETENTION_DAYS, `${label} en az ${LOST_ITEM_MIN_RETENTION_DAYS} gün olmalı`)
    .max(LOST_ITEM_MAX_RETENTION_DAYS, `${label} en fazla ${LOST_ITEM_MAX_RETENTION_DAYS} gün olabilir`);

/** Kargo ücreti: boş bırakılabilir; sıfır ya da pozitif, en fazla 2 ondalık, virgül de kabul. */
const shippingCostField = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value, ctx) => {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const raw = String(value).trim().replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      ctx.addIssue({ code: 'custom', message: 'Kargo ücreti geçersiz (ör. 120 ya da 120,50)' });
      return z.NEVER;
    }
    const normalized = normalizeDecimalString(raw);
    if (Number(normalized) > Number(LOST_ITEM_MAX_SHIPPING_COST)) {
      ctx.addIssue({ code: 'custom', message: 'Kargo ücreti çok yüksek; yazım hatası olabilir' });
      return z.NEVER;
    }
    return normalized;
  });

/** Bulunduğu yer: oda ya da ortak alan (ikisinden biri). */
const placeFields = {
  roomId: uuid('Geçersiz oda').nullish(),
  locationText: optionalText({ label: 'Bulunduğu yer', max: LOST_ITEM_PLACE_MAX }),
};

/** @param {{ roomId?: string | null, locationText?: string | null }} value @param {any} ctx */
function requirePlace(value, ctx) {
  if (!value.roomId && !value.locationText) {
    ctx.addIssue({ code: 'custom', path: ['locationText'], message: 'Oda seçin ya da bulunduğu yeri yazın (ör. lobi, havuz)' });
  }
}

const itemFields = {
  description: text({ label: 'Açıklama', min: LOST_ITEM_DESCRIPTION_MIN, max: LOST_ITEM_DESCRIPTION_MAX }),
  category: z.enum(LOST_ITEM_CATEGORIES, { error: 'Kategori seçin' }),
  valuable: z.boolean().default(false),
  ...placeFields,
  foundAt: timestampField('Bulunma zamanı'),
  foundByName: text({ label: 'Bulan kişi', min: 2, max: LOST_ITEM_PERSON_MAX }),
  storageLocation: text({ label: 'Saklandığı yer', min: 2, max: LOST_ITEM_PLACE_MAX }),
};

/* ─────────────── Şemalar ─────────────── */

export const lostItemInputSchema = z
  .object({
    requestId: uuid('Geçersiz istek kimliği'),
    ...itemFields,
    note: optionalText({ label: 'Not', max: LOST_ITEM_NOTE_MAX }),
  })
  .superRefine(requirePlace);

/** Açık eşyanın bilgileri (fotoğraf ve notlar ayrı uçlarda). */
export const updateLostItemSchema = z.object({ expectedUpdatedAt, ...itemFields }).superRefine(requirePlace);

export const lostItemMatchSchema = z.object({
  expectedUpdatedAt,
  guestId: uuid('Misafir seçin'),
  /** Adaydan seçildiyse konaklama (ortak alanda bulunup aramayla seçilen misafirde yok). */
  reservationId: uuid('Geçersiz konaklama').nullish(),
});

export const lostItemUnmatchSchema = z.object({
  expectedUpdatedAt,
  reason: text({ label: 'Gerekçe', min: LOST_ITEM_REASON_MIN, max: LOST_ITEM_REASON_MAX }),
});

export const lostItemContactSchema = z.object({
  channel: z.enum(LOST_ITEM_CONTACT_CHANNELS, { error: 'Kanal seçin' }),
  text: text({ label: 'Not', min: LOST_ITEM_REASON_MIN, max: LOST_ITEM_NOTE_MAX }),
});

/**
 * Teslim. Elden: teslim alanın adı (değerli eşyada kimlik görülmesi zorunlu —
 * sunucu eşyanın değerli olup olmadığını bilir). Kargo: firma, takip no, adres.
 */
export const lostItemReturnSchema = z
  .object({
    expectedUpdatedAt,
    method: z.enum(LOST_ITEM_RETURN_METHODS, { error: 'Teslim şeklini seçin' }),
    receiverName: optionalText({ label: 'Teslim alan', max: LOST_ITEM_PERSON_MAX }),
    receiverIdChecked: z.boolean().default(false),
    carrier: optionalText({ label: 'Kargo firması', max: LOST_ITEM_PERSON_MAX }),
    trackingNumber: optionalText({ label: 'Takip no', max: LOST_ITEM_TRACKING_MAX }),
    shippingAddress: optionalText({ label: 'Adres', max: LOST_ITEM_ADDRESS_MAX }),
    shippingCost: shippingCostField,
    shippingPayer: z.enum(LOST_ITEM_SHIPPING_PAYERS, { error: 'Kargo ücretini kimin ödediğini seçin' }).nullish(),
    note: optionalText({ label: 'Not', max: LOST_ITEM_NOTE_MAX }),
  })
  .superRefine((value, ctx) => {
    if (value.method === 'IN_PERSON') {
      if (!value.receiverName || value.receiverName.length < 2) {
        ctx.addIssue({ code: 'custom', path: ['receiverName'], message: 'Teslim alan kişinin adını yazın' });
      }
      return;
    }
    if (!value.carrier) ctx.addIssue({ code: 'custom', path: ['carrier'], message: 'Kargo firmasını yazın' });
    if (!value.trackingNumber) ctx.addIssue({ code: 'custom', path: ['trackingNumber'], message: 'Takip numarasını yazın' });
    if (!value.shippingAddress || value.shippingAddress.length < 10) {
      ctx.addIssue({ code: 'custom', path: ['shippingAddress'], message: 'Gönderim adresini yazın' });
    }
    if (!value.shippingPayer) ctx.addIssue({ code: 'custom', path: ['shippingPayer'], message: 'Kargo ücretini kimin ödediğini seçin' });
  });

export const lostItemDisposeSchema = z.object({
  expectedUpdatedAt,
  method: z.enum(LOST_ITEM_DISPOSALS, { error: 'Kapatma şeklini seçin' }),
  reason: text({ label: 'Gerekçe', min: LOST_ITEM_REASON_MIN, max: LOST_ITEM_REASON_MAX }),
});

/** Base64 metnin üst sınırı: 4/3 büyüme + biraz pay. */
const base64Field = (label, maxBytes) =>
  z
    .string({ error: `${label} zorunlu` })
    .min(1, `${label} zorunlu`)
    .max(Math.ceil((maxBytes * 4) / 3) + 4, `${label} çok büyük`);

/**
 * Fotoğraf: tarayıcı küçültür (EXIF / konum bilgisi bu sırada düşer) ve
 * önizlemeyi üretir; sunucu türü dosyanın imzasından doğrular.
 */
export const lostItemPhotoSchema = z.object({
  contentType: z.enum(LOST_ITEM_PHOTO_TYPES, { error: 'Fotoğraf JPEG ya da WebP olmalı' }),
  image: base64Field('Fotoğraf', LOST_ITEM_PHOTO_MAX_BYTES),
  thumbnail: base64Field('Önizleme', LOST_ITEM_THUMB_MAX_BYTES),
});

/** Fotoğraf isteğinin gövde sınırı (route `bodyLimit`): iki base64 + JSON payı. */
export const LOST_ITEM_PHOTO_BODY_LIMIT = Math.ceil(((LOST_ITEM_PHOTO_MAX_BYTES + LOST_ITEM_THUMB_MAX_BYTES) * 4) / 3) + 16_384;

export const lostItemListQuerySchema = listQuerySchema.extend({
  view: z.enum(LOST_ITEM_VIEWS, { error: 'Geçersiz görünüm' }).default('OPEN'),
  category: z.enum(LOST_ITEM_CATEGORIES, { error: 'Geçersiz kategori' }).optional(),
  valuable: queryBoolean.optional(),
  /** Bulunma günü aralığı (iş günü, dahil). */
  from: isoDay.optional(),
  to: isoDay.optional(),
  pageSize: z.coerce
    .number({ error: 'Sayfa boyutu sayı olmalı' })
    .int()
    .min(1)
    .max(LOST_ITEM_MAX_PAGE_SIZE, `Sayfa boyutu en fazla ${LOST_ITEM_MAX_PAGE_SIZE}`)
    .default(LOST_ITEM_PAGE_SIZE),
}).refine((value) => !value.from || !value.to || value.from <= value.to, {
  path: ['to'],
  message: 'Bitiş tarihi başlangıçtan önce olamaz',
});

/** `expectedUpdatedAt`: otel kaydının okunan sürümü (iki kişi aynı anda kaydederse ikincisi ezmez). */
export const lostItemSettingsSchema = z
  .object({
    expectedUpdatedAt,
    retentionDays: retentionDays('Saklama süresi'),
    valuableRetentionDays: retentionDays('Değerli eşya saklama süresi'),
  })
  .refine((value) => value.valuableRetentionDays >= value.retentionDays, {
    path: ['valuableRetentionDays'],
    message: 'Değerli eşya en az normal eşya kadar saklanmalı',
  });

export const lostItemGuestSearchSchema = z.object({
  q: z.string({ error: 'Aranacak metni yazın' }).trim().min(2, 'En az 2 karakter yazın').max(100, 'En fazla 100 karakter'),
});

export const lostItemIdParamSchema = z.object({ id: uuid('Geçersiz kayıt') });

export const lostItemPhotoParamSchema = z.object({
  id: uuid('Geçersiz kayıt'),
  photoId: uuid('Geçersiz fotoğraf'),
});

export const lostItemPhotoQuerySchema = z.object({
  size: z.enum(['full', 'thumb'], { error: 'Geçersiz boyut' }).default('full'),
});

/* ─────────────── Kurallar (ekran ve sunucu aynı cevabı versin) ─────────────── */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Eşyanın saklama süresinin son günü (bulunduğu iş günü + süre).
 * @param {{ businessDate: string, valuable: boolean }} item `businessDate` "YYYY-AA-GG"
 * @param {{ retentionDays: number, valuableRetentionDays: number }} settings
 * @returns {string} "YYYY-AA-GG"
 */
export function lostItemRetainUntil(item, settings) {
  const days = item.valuable ? settings.valuableRetentionDays : settings.retentionDays;
  return new Date(Date.parse(`${item.businessDate}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Süresi doldu mu (açık eşya, son gün bugünden önce)?
 * @param {{ status: string, businessDate: string, valuable: boolean }} item
 * @param {{ retentionDays: number, valuableRetentionDays: number }} settings
 * @param {string} today otelin iş günü "YYYY-AA-GG"
 */
export function lostItemExpired(item, settings, today) {
  if (!LOST_ITEM_OPEN_STATUSES.includes(item.status)) return false;
  return lostItemRetainUntil(item, settings) < today;
}

/**
 * Süresi dolan eşyanın en geç bulunduğu gün: bulunma günü bu günden önceyse
 * süre dolmuştur. Liste sorgusu (index'li tarih karşılaştırması) bunu kullanır.
 * @param {string} today "YYYY-AA-GG"
 * @param {number} days
 * @returns {string} "YYYY-AA-GG"
 */
export function lostItemExpiryCutoff(today, days) {
  return new Date(Date.parse(`${today}T00:00:00.000Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Bulunma anı kabul edilebilir mi (gelecekte değil, çok eskide değil)?
 * @param {Date} foundAt
 * @param {Date} now
 * @returns {string | null}
 */
export function lostItemFoundAtError(foundAt, now) {
  if (foundAt.getTime() > now.getTime() + LOST_ITEM_FUTURE_TOLERANCE_MS) return 'Bulunma zamanı ileride olamaz';
  if (foundAt.getTime() < now.getTime() - LOST_ITEM_MAX_BACKDATE_DAYS * DAY_MS) {
    return `Bulunma zamanı en fazla ${LOST_ITEM_MAX_BACKDATE_DAYS} gün öncesi olabilir`;
  }
  return null;
}

/**
 * İşlem eşyanın durumunda yapılabilir mi? Yapılamıyorsa sebep.
 * @param {string} status
 * @param {'EDIT' | 'MATCH' | 'UNMATCH' | 'CONTACT' | 'RETURN' | 'DISPOSE' | 'PHOTO'} action CONTACT her durumda serbest
 * @returns {string | null}
 */
export function lostItemActionError(status, action) {
  // İletişim notu kapanmış kayda da yazılır ("kargo misafire ulaştı").
  if (action === 'CONTACT') return null;
  if (status === 'RETURNED') return 'Eşya teslim edilmiş; kayıt kapandı';
  if (status === 'DISPOSED') return 'Eşya kapatılmış; kayıt değiştirilemez';
  if (action === 'UNMATCH' && status !== 'MATCHED') return 'Eşya bir misafirle eşleşmemiş';
  return null;
}

/**
 * Teslim kuralı (şemanın bilemediği, eşyaya bağlı kısım): değerli eşya elden
 * teslimde teslim alanın kimliği görülmeli.
 * @param {{ valuable: boolean }} item
 * @param {{ method: string, receiverIdChecked?: boolean }} input
 * @returns {string | null}
 */
export function lostItemReturnError(item, input) {
  if (item.valuable && input.method === 'IN_PERSON' && !input.receiverIdChecked) {
    return 'Değerli eşya teslim alanın kimliği görülmeden verilmez';
  }
  return null;
}
