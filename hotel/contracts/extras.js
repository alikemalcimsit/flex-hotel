import { normalizeDecimalString } from './decimal.js';
import { decimalField, expectedUpdatedAt, listQuerySchema, queryBoolean } from './fields.js';
import { z } from './locale.js';

/**
 * Minibar ve çamaşırhane sözleşmeleri (modül 19).
 *
 * - **Minibar:** kat görevlisi odayı sayar, tüketilenleri girer (bir "fiş").
 *   Fiş, odadaki misafirin folyosuna `minibar.consumed` olayıyla gider (folyo
 *   aktörü işler). Misafir bugün çıktıysa ve folyosu açıksa "geç kalem" olarak
 *   ona yazılır; kapandıysa folyo yetkilisine görev düşer. Odada kimse yoksa
 *   tüketim **kayıp** olarak, gerekçesiyle yazılır (folyoya gitmez).
 * - **Çamaşırhane:** sipariş içerideki misafir adına alınır (parça listesi,
 *   ekspres, teslim zamanı); yıkamada → hazır → teslim. **Ücret teslimde**
 *   folyoya `laundry.charged` olayıyla gider; iptal edilen sipariş hiç işlenmez.
 * - Fiyatlar vergi ayarına göre (kalem tipi minibar / çamaşırhane) dahil ya da
 *   hariç yorumlanır; vergi folyoda hesaplanır.
 * - Tutar metindir ("45.50"); hesap sunucuda.
 */

/* ─────────────── Minibar ─────────────── */

/** Prisma `MinibarCategory` ile birebir. */
export const MINIBAR_CATEGORIES = Object.freeze(['DRINK', 'ALCOHOL', 'SNACK', 'OTHER']);

export const MINIBAR_CATEGORY_LABELS = Object.freeze({
  DRINK: 'İçecek',
  ALCOHOL: 'Alkollü içecek',
  SNACK: 'Atıştırmalık',
  OTHER: 'Diğer',
});

/**
 * Prisma `MinibarChargeTarget` ile birebir: tüketim kime yazıldı.
 * - `IN_HOUSE`: odada konaklayan misafir.
 * - `LATE`: odadan yakın zamanda ayrılan misafir (çıkış yaptı ya da başka odaya taşındı).
 * - `NONE`: kimseye yazılmadı — kayıp (gerekçeli).
 */
export const MINIBAR_CHARGE_TARGETS = Object.freeze(['IN_HOUSE', 'LATE', 'NONE']);

export const MINIBAR_CHARGE_TARGET_LABELS = Object.freeze({
  IN_HOUSE: 'Odadaki misafir',
  LATE: 'Ayrılan misafir (geç kalem)',
  NONE: 'Kayıp (folyoya gitmez)',
});

/** Bir otelde aynı anda satıştaki en fazla minibar ürünü (giriş ekranı tek listede gösterir). */
export const MINIBAR_MAX_ACTIVE_ITEMS = 120;
/** Bir fişte en fazla satır (olay sınırı 50). */
export const MINIBAR_MAX_LINES = 50;
/** Bir satırda en fazla adet (yazım hatasını yakalamak için). */
export const MINIBAR_MAX_QUANTITY = 99;
/** Odanın standart dolum adedi üst sınırı. */
export const MINIBAR_MAX_PAR_LEVEL = 20;
/**
 * Odadan ayrılan misafire (çıkış ya da oda değişimi) geç kalem yazılabilecek
 * süre: kat görevlisi odayı genelde aynı gün sayar.
 */
export const MINIBAR_LATE_CHARGE_HOURS = 24;
/** Oda ekranında gösterilen bugünkü giriş sayısı. */
export const MINIBAR_ROOM_RECENT_LIMIT = 10;

/* ─────────────── Çamaşırhane ─────────────── */

/** Prisma `LaundryService` ile birebir. */
export const LAUNDRY_SERVICES = Object.freeze(['WASH', 'DRY_CLEAN', 'PRESS']);

export const LAUNDRY_SERVICE_LABELS = Object.freeze({
  WASH: 'Yıkama + ütü',
  DRY_CLEAN: 'Kuru temizleme',
  PRESS: 'Yalnız ütü',
});

/** Prisma `LaundryStatus` ile birebir. */
export const LAUNDRY_STATUSES = Object.freeze(['RECEIVED', 'IN_PROCESS', 'READY', 'DELIVERED', 'CANCELLED']);

export const LAUNDRY_STATUS_LABELS = Object.freeze({
  RECEIVED: 'Alındı',
  IN_PROCESS: 'Yıkamada',
  READY: 'Hazır',
  DELIVERED: 'Teslim edildi',
  CANCELLED: 'İptal',
});

/** Henüz teslim edilmemiş (ve iptal olmamış) durumlar. */
export const LAUNDRY_OPEN_STATUSES = Object.freeze(['RECEIVED', 'IN_PROCESS', 'READY']);

/** Parça listesinin düzeltilebildiği durumlar (sayım çamaşırhanede yapılır; hazır olunca kilitlenir). */
export const LAUNDRY_EDITABLE_STATUSES = Object.freeze(['RECEIVED', 'IN_PROCESS']);

/** Liste görünümleri. */
export const LAUNDRY_VIEWS = Object.freeze(['OPEN', 'OVERDUE', 'DELIVERED', 'CANCELLED']);

export const LAUNDRY_VIEW_LABELS = Object.freeze({
  OPEN: 'Açık',
  OVERDUE: 'Geciken',
  DELIVERED: 'Teslim edilen',
  CANCELLED: 'İptal',
});

export const LAUNDRY_MAX_ACTIVE_ITEMS = 150;
export const LAUNDRY_MAX_LINES = 50;
export const LAUNDRY_MAX_QUANTITY = 99;
/** Standart teslim süresi (saat): formun önerdiği teslim zamanı. */
export const LAUNDRY_STANDARD_DUE_HOURS = 24;
/** Ekspres teslim süresi (saat). */
export const LAUNDRY_EXPRESS_DUE_HOURS = 4;
/** Teslim zamanı en fazla bu kadar gün sonrası olabilir. */
export const LAUNDRY_MAX_DUE_DAYS = 7;
/** Ekspres farkı üst sınırı (yüzde). */
export const LAUNDRY_MAX_EXPRESS_PCT = 300;

/* ─────────────── Ortak sınırlar ─────────────── */

export const EXTRAS_CODE_MAX = 20;
export const EXTRAS_NAME_MAX = 100;
export const EXTRAS_NOTE_MAX = 300;
export const EXTRAS_REASON_MIN = 3;
export const EXTRAS_REASON_MAX = 300;
/** Bir kalemin en yüksek birim fiyatı (yazım hatasını yakalamak için). */
export const EXTRAS_MAX_PRICE = '100000';
export const EXTRAS_PAGE_SIZE = 25;
export const EXTRAS_MAX_PAGE_SIZE = 100;

/* ─────────────── Alanlar ─────────────── */

const uuid = (message) => z.string().uuid({ message });

const codeField = z
  .string({ error: 'Kod zorunlu' })
  .trim()
  .toUpperCase()
  .min(1, 'Kod zorunlu')
  .max(EXTRAS_CODE_MAX, `Kod en fazla ${EXTRAS_CODE_MAX} karakter`)
  .regex(/^[A-Z0-9_-]+$/, 'Kod yalnızca harf, rakam, - ve _ içerebilir');

const nameField = z
  .string({ error: 'Ad zorunlu' })
  .trim()
  .min(2, 'Ad en az 2 karakter olmalı')
  .max(EXTRAS_NAME_MAX, `Ad en fazla ${EXTRAS_NAME_MAX} karakter`);

/** Birim fiyat: sıfırdan büyük, en fazla 2 ondalık; virgül de kabul edilir. */
export const extrasPriceField = z.union([z.string(), z.number()], { error: 'Fiyat zorunlu' }).transform((value, ctx) => {
  const text = String(value).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    ctx.addIssue({ code: 'custom', message: 'Fiyat geçersiz (ör. 45 ya da 45,50; en fazla 2 ondalık)' });
    return z.NEVER;
  }
  const normalized = normalizeDecimalString(text);
  if (Number(normalized) <= 0) {
    ctx.addIssue({ code: 'custom', message: 'Fiyat sıfırdan büyük olmalı' });
    return z.NEVER;
  }
  if (Number(normalized) > Number(EXTRAS_MAX_PRICE)) {
    ctx.addIssue({ code: 'custom', message: 'Fiyat çok yüksek; yazım hatası olabilir' });
    return z.NEVER;
  }
  return normalized;
});

const sortOrderField = z.coerce
  .number({ error: 'Sıra sayı olmalı' })
  .int('Sıra tam sayı olmalı')
  .min(0, 'Sıra negatif olamaz')
  .max(9999, 'Sıra en fazla 9999')
  .default(0);

const noteField = z
  .string()
  .trim()
  .max(EXTRAS_NOTE_MAX, `Not en fazla ${EXTRAS_NOTE_MAX} karakter`)
  .transform((value) => value || null)
  .nullish();

const reasonField = z
  .string({ error: 'Gerekçe zorunlu' })
  .trim()
  .min(EXTRAS_REASON_MIN, `Gerekçe en az ${EXTRAS_REASON_MIN} karakter olmalı`)
  .max(EXTRAS_REASON_MAX, `Gerekçe en fazla ${EXTRAS_REASON_MAX} karakter olabilir`);

/** Satır listesi: ürün + adet, aynı ürün iki kez yok. */
function linesField({ max, maxQuantity, label }) {
  return z
    .array(
      z.object({
        itemId: uuid('Geçersiz ürün'),
        quantity: z.coerce
          .number({ error: 'Adet sayı olmalı' })
          .int('Adet tam sayı olmalı')
          .min(1, 'Adet en az 1 olmalı')
          .max(maxQuantity, `Adet en fazla ${maxQuantity} olabilir`),
      }),
      { error: `${label} listesi zorunlu` },
    )
    .min(1, `En az bir ${label} girin`)
    .max(max, `Tek seferde en fazla ${max} ${label}`)
    .refine((lines) => new Set(lines.map((line) => line.itemId)).size === lines.length, {
      message: `Aynı ${label} iki kez seçilmiş; adedini artırın`,
    });
}

/* ─────────────── Katalog şemaları ─────────────── */

export const minibarItemInputSchema = z.object({
  code: codeField,
  name: nameField,
  category: z.enum(MINIBAR_CATEGORIES, { error: 'Geçersiz kategori' }),
  price: extrasPriceField,
  parLevel: z.coerce
    .number({ error: 'Standart adet sayı olmalı' })
    .int('Standart adet tam sayı olmalı')
    .min(0, 'Standart adet negatif olamaz')
    .max(MINIBAR_MAX_PAR_LEVEL, `Standart adet en fazla ${MINIBAR_MAX_PAR_LEVEL}`)
    .default(1),
  active: z.boolean().default(true),
  sortOrder: sortOrderField,
});

export const updateMinibarItemSchema = minibarItemInputSchema.extend({ expectedUpdatedAt });

export const laundryItemInputSchema = z.object({
  code: codeField,
  name: nameField,
  service: z.enum(LAUNDRY_SERVICES, { error: 'Geçersiz hizmet' }),
  price: extrasPriceField,
  active: z.boolean().default(true),
  sortOrder: sortOrderField,
});

export const updateLaundryItemSchema = laundryItemInputSchema.extend({ expectedUpdatedAt });

export const catalogListQuerySchema = listQuerySchema.extend({
  includeInactive: queryBoolean.default(false),
});

/** Çamaşırhane ayarı: ekspres farkı (yüzde). */
export const laundrySettingsSchema = z.object({
  expressPct: decimalField({ scale: 2, min: 0, max: LAUNDRY_MAX_EXPRESS_PCT, label: 'Ekspres farkı' }),
});

/* ─────────────── Minibar tüketimi ─────────────── */

export const roomLookupQuerySchema = z.object({
  number: z.string().trim().min(1, 'Oda numarası yazın').max(20, 'Oda numarası en fazla 20 karakter'),
});

/**
 * Tüketim fişi. `chargeTo` ve `reservationId` ekranın gördüğüdür: sunucu odayı
 * yeniden çözer, bu arada misafir değiştiyse yazmaz (`STAY_CHANGED`).
 */
export const minibarConsumptionSchema = z
  .object({
    requestId: uuid('Geçersiz istek kimliği'),
    roomId: uuid('Geçersiz oda'),
    chargeTo: z.enum(MINIBAR_CHARGE_TARGETS, { error: 'Kime yazılacağını seçin' }),
    reservationId: uuid('Geçersiz konaklama').nullish(),
    lines: linesField({ max: MINIBAR_MAX_LINES, maxQuantity: MINIBAR_MAX_QUANTITY, label: 'ürün' }),
    lossReason: z
      .string()
      .trim()
      .max(EXTRAS_REASON_MAX, `Gerekçe en fazla ${EXTRAS_REASON_MAX} karakter olabilir`)
      .transform((value) => value || null)
      .nullish(),
    note: noteField,
  })
  .superRefine((value, ctx) => {
    if (value.chargeTo === 'NONE') {
      if (!value.lossReason || value.lossReason.length < EXTRAS_REASON_MIN) {
        ctx.addIssue({ code: 'custom', path: ['lossReason'], message: 'Kayıp için gerekçe yazın (ör. boş odada eksik bulundu)' });
      }
      if (value.reservationId) ctx.addIssue({ code: 'custom', path: ['reservationId'], message: 'Kayıp tüketim konaklamaya yazılmaz' });
    } else if (!value.reservationId) {
      ctx.addIssue({ code: 'custom', path: ['reservationId'], message: 'Tüketimin yazılacağı konaklama yok; odayı yeniden seçin' });
    }
  });

export const consumptionListQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-AA-GG biçiminde olmalı').optional(),
  roomId: uuid('Geçersiz oda').optional(),
  cursor: z.string().trim().max(200).optional(),
  limit: z.coerce
    .number({ error: 'Sayfa boyutu sayı olmalı' })
    .int()
    .min(1)
    .max(EXTRAS_MAX_PAGE_SIZE, `Sayfa boyutu en fazla ${EXTRAS_MAX_PAGE_SIZE}`)
    .default(EXTRAS_PAGE_SIZE),
});

/* ─────────────── Çamaşır siparişi ─────────────── */

const dueAtField = z
  .union([z.string(), z.date()], { error: 'Teslim zamanı zorunlu' })
  .transform((value) => (value instanceof Date ? value : new Date(value)))
  .refine((value) => !Number.isNaN(value.getTime()), { message: 'Teslim zamanı geçersiz' });

export const laundryOrderSchema = z.object({
  requestId: uuid('Geçersiz istek kimliği'),
  roomId: uuid('Geçersiz oda'),
  /** Ekranın gördüğü konaklama (odadaki misafir); sunucu yeniden çözer. */
  reservationId: uuid('Geçersiz konaklama'),
  express: z.boolean().default(false),
  dueAt: dueAtField,
  lines: linesField({ max: LAUNDRY_MAX_LINES, maxQuantity: LAUNDRY_MAX_QUANTITY, label: 'parça' }),
  note: noteField,
});

/** Sayımda düzelen parça listesi (alındı / yıkamada iken). */
export const laundryLinesSchema = z.object({
  expectedUpdatedAt,
  lines: linesField({ max: LAUNDRY_MAX_LINES, maxQuantity: LAUNDRY_MAX_QUANTITY, label: 'parça' }),
  note: noteField,
});

export const laundryStatusSchema = z
  .object({
    expectedUpdatedAt,
    status: z.enum(['IN_PROCESS', 'READY', 'DELIVERED', 'CANCELLED'], { error: 'Geçersiz durum' }),
    reason: z.string().trim().max(EXTRAS_REASON_MAX).transform((value) => value || null).nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'CANCELLED' && (!value.reason || value.reason.length < EXTRAS_REASON_MIN)) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'İptal gerekçesini yazın' });
    }
  });

export const laundryListQuerySchema = listQuerySchema.extend({
  view: z.enum(LAUNDRY_VIEWS, { error: 'Geçersiz görünüm' }).default('OPEN'),
});

export const extrasReportQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-AA-GG biçiminde olmalı').optional(),
});

export const extrasIdParamSchema = z.object({ id: uuid('Geçersiz kayıt') });

/* ─────────────── Kurallar (ekran ve sunucu aynı cevabı versin) ─────────────── */

/** Durum sırası: ileri atlanabilir (hazır olmadan teslim, ütü hemen biter), geri dönülmez. */
const LAUNDRY_ORDER = Object.freeze({ RECEIVED: 0, IN_PROCESS: 1, READY: 2, DELIVERED: 3 });

/**
 * Sipariş bu duruma geçebilir mi? Geçemiyorsa sebep.
 * @param {string} from
 * @param {string} to
 * @returns {string | null}
 */
export function laundryTransitionError(from, to) {
  if (from === to) return `Sipariş zaten "${LAUNDRY_STATUS_LABELS[to]}"`;
  if (from === 'DELIVERED') return 'Teslim edilmiş sipariş değiştirilemez; ücret folyoda (düzeltme folyodan)';
  if (from === 'CANCELLED') return 'İptal edilmiş sipariş değiştirilemez';
  if (to === 'CANCELLED') return null;
  if (LAUNDRY_ORDER[to] === undefined) return 'Geçersiz durum';
  if (LAUNDRY_ORDER[to] < LAUNDRY_ORDER[from]) return `"${LAUNDRY_STATUS_LABELS[from]}" siparişi "${LAUNDRY_STATUS_LABELS[to]}" durumuna geri alınamaz`;
  return null;
}

/**
 * Sipariş gecikti mi (teslim zamanı geçti, teslim edilmedi)?
 * @param {{ status: string, dueAt: string | Date }} order
 * @param {Date | number} now
 */
export function laundryOverdue(order, now) {
  if (!LAUNDRY_OPEN_STATUSES.includes(order.status)) return false;
  const nowMs = now instanceof Date ? now.getTime() : now;
  return new Date(order.dueAt).getTime() < nowMs;
}

/**
 * Teslim zamanı kabul edilebilir mi (şimdiden sonra, en fazla birkaç gün)?
 * @param {Date} dueAt
 * @param {Date} now
 * @returns {string | null}
 */
export function laundryDueAtError(dueAt, now) {
  if (dueAt.getTime() <= now.getTime()) return 'Teslim zamanı şimdiden sonra olmalı';
  if (dueAt.getTime() > now.getTime() + LAUNDRY_MAX_DUE_DAYS * 24 * 60 * 60 * 1000) {
    return `Teslim zamanı en fazla ${LAUNDRY_MAX_DUE_DAYS} gün sonrası olabilir`;
  }
  return null;
}
