import { fromCents, toCents } from './accounting.js';
import { looksLikeCardNumber } from './front-desk.js';
import { expectedUpdatedAt, isoDayField, optionalQueryInt, paginationQuerySchema, queryBoolean } from './fields.js';
import { z } from './locale.js';
import { normalizeDecimalString } from './decimal.js';

/**
 * Demirbaş ve amortisman (modül 46) sözleşmesi.
 *
 * - **Demirbaş kartı:** otelin sabit kıymeti. Kodu `DM-000001` biçiminde (otel içinde sıralı); etiketteki QR bu kodu
 *   (kamerayla okutunca kartı açan bağlantı olarak) taşır. Her demirbaş ya bir odada ya tanımlı bir alanda (lobi,
 *   restoran, depo…) durur; isteyen bir personele **zimmetlenir** (bordro personel kartı).
 * - **Amortisman VUK usulü, yıllık ve doğrusaldır:** oran = 1 / faydalı ömür; alındığı yıl tam yıl ayrılır (kıst yok);
 *   elden çıkarıldığı yıl ayrılmaz (kalan net değer elden çıkarmada gider / kâr-zarar olur). Yıl sonunda "yılı
 *   kaydet" o yılın payını tüm demirbaşlar için yazar; kaydedilmiş yıl kilitlidir (yalnız son yıl geri alınır).
 * - Önceki yıllarda (sistemden önce) ayrılmış amortisman **açılış** olarak girilir: tutar + hangi yıla kadar.
 * - Tutarlar uçtan uca metin ("1250.50"); hesap kuruşla (BigInt, ön muhasebenin `toCents`'i) yapılır — kayan nokta
 *   kuruş kaybettirmez.
 */

/* ─────────────── Sabitler ─────────────── */

/** Prisma `AssetStatus` ile birebir. */
export const ASSET_STATUSES = Object.freeze(['ACTIVE', 'DISPOSED']);
export const ASSET_STATUS_LABELS = Object.freeze({ ACTIVE: 'Kullanımda', DISPOSED: 'Elden çıkarıldı' });

/** Prisma `AssetDisposalType` ile birebir. */
export const ASSET_DISPOSAL_TYPES = Object.freeze(['SOLD', 'SCRAPPED', 'LOST']);
export const ASSET_DISPOSAL_TYPE_LABELS = Object.freeze({ SOLD: 'Satıldı', SCRAPPED: 'Hurdaya ayrıldı', LOST: 'Kayıp' });

/** Prisma `AssetMovementKind` ile birebir: kartın ekle-yalnız geçmişi. */
export const ASSET_MOVEMENT_KINDS = Object.freeze(['CREATED', 'UPDATED', 'TRANSFERRED', 'ASSIGNED', 'RETURNED', 'DISPOSED']);
export const ASSET_MOVEMENT_KIND_LABELS = Object.freeze({
  CREATED: 'Kaydedildi',
  UPDATED: 'Bilgileri düzeltildi',
  TRANSFERRED: 'Yeri değişti',
  ASSIGNED: 'Zimmetlendi',
  RETURNED: 'Zimmetten iade alındı',
  DISPOSED: 'Elden çıkarıldı',
});

/** Prisma `AssetCountStatus` ile birebir. */
export const ASSET_COUNT_STATUSES = Object.freeze(['OPEN', 'CLOSED', 'CANCELLED']);
export const ASSET_COUNT_STATUS_LABELS = Object.freeze({ OPEN: 'Sürüyor', CLOSED: 'Kapandı', CANCELLED: 'İptal' });

/** Liste süzgeci: durum. */
export const ASSET_LIST_STATES = Object.freeze(['ACTIVE', 'DISPOSED', 'ALL']);
export const ASSET_LIST_STATE_LABELS = Object.freeze({ ACTIVE: 'Kullanımda', DISPOSED: 'Elden çıkarılan', ALL: 'Tümü' });

/** Garanti listesi süzgeci. */
export const ASSET_WARRANTY_STATES = Object.freeze(['EXPIRING', 'EXPIRED']);
export const ASSET_WARRANTY_STATE_LABELS = Object.freeze({ EXPIRING: 'Bitmek üzere', EXPIRED: 'Bitmiş' });
/** "Garantisi bitecekler" pencereleri (gün); uyarı zili ilk pencerede çalar. */
export const ASSET_WARRANTY_WINDOWS = Object.freeze([30, 60, 90]);
export const ASSET_WARRANTY_WARN_DAYS = ASSET_WARRANTY_WINDOWS[0];
/** Bitmiş garantiler listesinde en fazla kaç gün geriye bakılır. */
export const ASSET_WARRANTY_EXPIRED_LOOKBACK_DAYS = 365;

/** Etiket kâğıtları: termal etiket yazıcısı (tek etiket / sayfa) ve A4 etiket sayfası (3 × 8). */
export const ASSET_LABEL_FORMATS = Object.freeze(['THERMAL_50x30', 'A4_3x8']);
export const ASSET_LABEL_FORMAT_LABELS = Object.freeze({ THERMAL_50x30: 'Etiket yazıcısı (50 × 30 mm)', A4_3x8: 'A4 etiket sayfası (3 × 8, 70 × 37 mm)' });
/** A4 sayfasındaki etiket sayısı (başlangıç konumu için). */
export const ASSET_A4_LABELS_PER_SHEET = 24;
/** Bir yazdırmada en fazla etiket. */
export const MAX_ASSET_LABELS = 240;

export const ASSET_CODE_PREFIX = 'DM';
const ASSET_CODE_DIGITS = 6;
/** Okutulan metindeki demirbaş kodu (QR bağlantısının sonunda ya da yalın). */
const ASSET_CODE_IN_TEXT = /\bDM-(\d{6,9})\b/i;

export const MIN_USEFUL_LIFE_YEARS = 1;
export const MAX_USEFUL_LIFE_YEARS = 50;
/** Bir demirbaşın en yüksek tutarı (yazım hatasına karşı; DB alanı 14,2). */
export const MAX_ASSET_COST = '1000000000';
export const MAX_ASSET_NAME_LENGTH = 120;
export const MAX_ASSET_TEXT_LENGTH = 80;
export const MAX_ASSET_NOTE_LENGTH = 500;
export const MAX_ASSET_DEFINITION_NAME_LENGTH = 60;
/** Excel ile tek seferde en fazla satır. */
export const MAX_ASSET_IMPORT_ROWS = 1000;
/** Sayımda okutulan metnin en fazla uzunluğu (QR bağlantısı dahil). */
export const MAX_ASSET_SCAN_LENGTH = 300;
export const MIN_ASSET_REASON_LENGTH = 3;
export const MAX_ASSET_REASON_LENGTH = 300;
/** Sayım ekranında listelenen en fazla satır (sayılar ayrıca döner). */
export const MAX_ASSET_COUNT_LIST = 500;

/* ─────────────── Kod ─────────────── */

/**
 * Sıra numarasından demirbaş kodu: 1 → "DM-000001".
 * @param {number} sequence
 */
export function assetCode(sequence) {
  return `${ASSET_CODE_PREFIX}-${String(sequence).padStart(ASSET_CODE_DIGITS, '0')}`;
}

/**
 * Okutulan / yazılan metinden demirbaş kodu: yalın kod ("dm-000123"), etiketteki QR bağlantısı
 * (".../demirbas/k/DM-000123") ya da okuyucunun eklediği boşluklar. Kod yoksa `null`.
 * @param {unknown} text
 * @returns {string | null}
 */
export function parseAssetCode(text) {
  if (typeof text !== 'string') return null;
  const match = ASSET_CODE_IN_TEXT.exec(text.trim());
  return match ? `${ASSET_CODE_PREFIX}-${match[1]}` : null;
}

/** Sayım numarası: "SY-2026-0001". */
export function assetCountNumber(year, sequence) {
  return `SY-${year}-${String(sequence).padStart(4, '0')}`;
}

/* ─────────────── Amortisman (VUK, yıllık doğrusal) ─────────────── */

/**
 * Yıllık amortisman oranı (yüzde, iki basamak): 5 yıl → "20.00".
 * @param {number} usefulLifeYears
 */
export function depreciationRatePct(usefulLifeYears) {
  return (100 / usefulLifeYears).toFixed(2);
}

/**
 * Bir yılın amortisman payı (kuruş). Kalan net değer, faydalı ömrün kalan yıllarına eşit yayılır; ömrün son
 * yılında (ya da ömür geçmişse) kalanın tamamı ayrılır. Yolunda giden kartta bu `maliyet / ömür`dür; açılışla
 * gelen ya da sistemden önce eksik ayrılmış kartta kalan, kalan yıllara dağılır. Kuruş artığı son yıla kalır.
 *
 * @param {{ costCents: bigint, accumulatedCents: bigint, usefulLifeYears: number, purchaseYear: number, year: number }} input
 * @returns {bigint} kuruş (alış yılından önce ya da tamamen ayrılmışsa 0)
 */
export function plannedDepreciationCents({ costCents, accumulatedCents, usefulLifeYears, purchaseYear, year }) {
  const remaining = costCents - accumulatedCents;
  if (year < purchaseYear || remaining <= 0n) return 0n;
  const yearsLeft = purchaseYear + usefulLifeYears - year;
  if (yearsLeft <= 1) return remaining;
  return remaining / BigInt(yearsLeft);
}

/**
 * Kartın yıl yıl amortisman tablosu: açılış (tek satır), kaydedilmiş yıllar ve kalan yılların planı. Elden çıkarıldığı
 * yıl ve sonrası tabloda yoktur (VUK: o yıl ayrılmaz). Net değer sıfıra inince biter.
 *
 * @param {{
 *   cost: string, usefulLifeYears: number, purchaseYear: number,
 *   openingAccumulated?: string, openingThroughYear?: number | null,
 *   posted?: { year: number, amount: string }[], disposedYear?: number | null,
 * }} asset
 * @returns {{ year: number, amount: string, accumulated: string, bookValue: string, source: 'OPENING' | 'POSTED' | 'PLANNED' }[]}
 */
export function depreciationSchedule(asset) {
  const costCents = toCents(asset.cost);
  const openingCents = toCents(asset.openingAccumulated ?? '0');
  const postedByYear = new Map((asset.posted ?? []).map((row) => [row.year, toCents(row.amount)]));
  const stopYear = asset.disposedYear ?? Number.POSITIVE_INFINITY;
  const rows = [];
  let accumulated = 0n;
  const push = (year, amount, source) => {
    accumulated += amount;
    rows.push({ year, amount: fromCents(amount), accumulated: fromCents(accumulated), bookValue: fromCents(costCents - accumulated), source });
  };

  let year = asset.purchaseYear;
  if (openingCents > 0n && asset.openingThroughYear != null) {
    push(asset.openingThroughYear, openingCents, 'OPENING');
    year = asset.openingThroughYear + 1;
  }
  const lastPostedYear = Math.max(year - 1, ...postedByYear.keys());
  for (; year < stopYear; year += 1) {
    const posted = postedByYear.get(year);
    if (posted !== undefined) {
      push(year, posted, 'POSTED');
      continue;
    }
    if (year <= lastPostedYear) continue;
    const planned = plannedDepreciationCents({ costCents, accumulatedCents: accumulated, usefulLifeYears: asset.usefulLifeYears, purchaseYear: asset.purchaseYear, year });
    if (planned <= 0n) break;
    push(year, planned, 'PLANNED');
  }
  return rows;
}

/**
 * Elden çıkarmanın sonucu: net değer (maliyet − birikmiş) ve satış fiyatına göre kâr (+) / zarar (−).
 * @param {{ cost: string, accumulated: string, price?: string | null }} input
 * @returns {{ bookValue: string, gainLoss: string }}
 */
export function disposalResult({ cost, accumulated, price }) {
  const bookValue = toCents(cost) - toCents(accumulated);
  return { bookValue: fromCents(bookValue), gainLoss: fromCents(toCents(price ?? '0') - bookValue) };
}

/* ─────────────── Alanlar ─────────────── */

const uuid = (message) => z.string({ error: message }).uuid(message);

const requiredText = (max, label) =>
  z
    .string({ error: `${label} yazın` })
    .trim()
    .min(1, `${label} yazın`)
    .max(max, `${label} en fazla ${max} karakter`)
    .refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz' });

const optionalText = (max, label) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter`)
    .refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz' })
    .transform((value) => value || null)
    .nullish();

const reasonField = (label) =>
  z
    .string({ error: `${label} yazın` })
    .trim()
    .min(MIN_ASSET_REASON_LENGTH, `${label} en az ${MIN_ASSET_REASON_LENGTH} karakter`)
    .max(MAX_ASSET_REASON_LENGTH, `${label} en fazla ${MAX_ASSET_REASON_LENGTH} karakter`)
    .refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz' });

/** Tutar: "1250", "1250,50" ya da sayı → "1250.5"; en fazla 2 ondalık. */
const amountField = (label) =>
  z.union([z.string(), z.number()], { error: `${label} geçersiz` }).transform((value, ctx) => {
    const text = String(value).trim().replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
      ctx.addIssue({ code: 'custom', message: `${label} geçersiz (ör. 1250 ya da 1250,50; en fazla 2 ondalık)` });
      return z.NEVER;
    }
    const normalized = normalizeDecimalString(text);
    if (toCents(normalized) > toCents(MAX_ASSET_COST)) {
      ctx.addIssue({ code: 'custom', message: `${label} çok yüksek; yazım hatası olabilir` });
      return z.NEVER;
    }
    return normalized;
  });

const usefulLifeField = z.coerce
  .number({ error: 'Faydalı ömür sayı olmalı' })
  .int('Faydalı ömür tam yıl olmalı')
  .min(MIN_USEFUL_LIFE_YEARS, `Faydalı ömür en az ${MIN_USEFUL_LIFE_YEARS} yıl`)
  .max(MAX_USEFUL_LIFE_YEARS, `Faydalı ömür en fazla ${MAX_USEFUL_LIFE_YEARS} yıl`);

const yearField = (label) =>
  z.coerce.number({ error: `${label} sayı olmalı` }).int(`${label} tam sayı olmalı`).min(1950, `${label} geçersiz`).max(2200, `${label} geçersiz`);

const nullableDay = isoDayField.nullish().or(z.literal('').transform(() => null));

/* ─────────────── Tanımlar: kategori ve alan ─────────────── */

export const assetCategorySchema = z.object({
  name: requiredText(MAX_ASSET_DEFINITION_NAME_LENGTH, 'Kategori adı'),
  usefulLifeYears: usefulLifeField,
});

export const updateAssetCategorySchema = z.object({
  expectedUpdatedAt,
  name: requiredText(MAX_ASSET_DEFINITION_NAME_LENGTH, 'Kategori adı').optional(),
  usefulLifeYears: usefulLifeField.optional(),
  isActive: z.boolean().optional(),
});

export const assetAreaSchema = z.object({
  name: requiredText(MAX_ASSET_DEFINITION_NAME_LENGTH, 'Alan adı'),
});

export const updateAssetAreaSchema = z.object({
  expectedUpdatedAt,
  name: requiredText(MAX_ASSET_DEFINITION_NAME_LENGTH, 'Alan adı').optional(),
  isActive: z.boolean().optional(),
});

/* ─────────────── Demirbaş kartı ─────────────── */

/** Konum: bir oda ya da tanımlı bir alan — tam olarak biri. */
const locationShape = {
  roomId: uuid('Oda geçersiz').nullish(),
  areaId: uuid('Alan geçersiz').nullish(),
};

/** @param {{ roomId?: string | null, areaId?: string | null }} value @param {import('zod').RefinementCtx} ctx */
function refineLocation(value, ctx) {
  const count = Number(Boolean(value.roomId)) + Number(Boolean(value.areaId));
  if (count !== 1) ctx.addIssue({ code: 'custom', path: ['areaId'], message: 'Konum seçin: bir oda ya da bir alan' });
}

const identityShape = {
  name: requiredText(MAX_ASSET_NAME_LENGTH, 'Demirbaş adı'),
  categoryId: uuid('Kategori seçin'),
  brand: optionalText(MAX_ASSET_TEXT_LENGTH, 'Marka'),
  model: optionalText(MAX_ASSET_TEXT_LENGTH, 'Model'),
  serialNumber: optionalText(MAX_ASSET_TEXT_LENGTH, 'Seri no'),
  supplierName: optionalText(MAX_ASSET_TEXT_LENGTH, 'Tedarikçi'),
  invoiceNumber: optionalText(MAX_ASSET_TEXT_LENGTH, 'Fatura no'),
  warrantyUntil: nullableDay,
  note: optionalText(MAX_ASSET_NOTE_LENGTH, 'Not'),
};

const financialShape = {
  purchaseDate: isoDayField,
  cost: amountField('Tutar'),
  /** Boşsa kategorinin ömrü. */
  usefulLifeYears: usefulLifeField.nullish(),
  /** Sistemden önce ayrılmış amortisman (toplam). */
  openingAccumulated: amountField('Önceki amortisman').nullish(),
  /** Önceki amortisman hangi yıla kadar (dahil). */
  openingThroughYear: yearField('Önceki amortisman yılı').nullish(),
};

/**
 * Finansal alanların tutarlılığı: önceki amortisman maliyeti aşamaz ve yılı alış yılından önce olamaz; garanti
 * alıştan önce bitemez.
 * @param {Record<string, any>} value
 * @param {import('zod').RefinementCtx} ctx
 */
function refineFinancials(value, ctx) {
  const isText = (field) => typeof field === 'string' && field !== '';
  const opening = isText(value.openingAccumulated) ? toCents(value.openingAccumulated) : 0n;
  if (opening > 0n && value.openingThroughYear == null) {
    ctx.addIssue({ code: 'custom', path: ['openingThroughYear'], message: 'Önceki amortismanın hangi yıla kadar ayrıldığını yazın' });
  }
  if (isText(value.cost) && opening > toCents(value.cost)) {
    ctx.addIssue({ code: 'custom', path: ['openingAccumulated'], message: 'Önceki amortisman tutarı aşamaz' });
  }
  if (isText(value.purchaseDate) && opening > 0n && value.openingThroughYear != null && value.openingThroughYear < Number(value.purchaseDate.slice(0, 4))) {
    ctx.addIssue({ code: 'custom', path: ['openingThroughYear'], message: 'Önceki amortisman yılı alış yılından önce olamaz' });
  }
  if (isText(value.purchaseDate) && isText(value.warrantyUntil) && value.warrantyUntil < value.purchaseDate) {
    ctx.addIssue({ code: 'custom', path: ['warrantyUntil'], message: 'Garanti alış tarihinden önce bitemez' });
  }
}

export const createAssetSchema = z
  .object({
    /** Formun ürettiği kimlik: çift gönderimde ikinci kart açılmaz. */
    requestId: uuid('İstek kimliği geçersiz'),
    ...identityShape,
    ...financialShape,
    ...locationShape,
    /** İsteğe bağlı: açılışta zimmet (personel kartı). */
    employeeId: uuid('Personel geçersiz').nullish(),
  })
  .superRefine((value, ctx) => {
    refineLocation(value, ctx);
    refineFinancials(value, ctx);
  });

/**
 * Kart düzeltmesi. Kimlik alanları her zaman; finansal alanlar (alış tarihi, tutar, ömür, önceki amortisman) yalnız
 * kartın kaydedilmiş amortismanı yokken — yoksa önce son yılın kaydı geri alınır. Konum ve zimmet kendi işlemleriyle.
 */
export const updateAssetSchema = z
  .object({
    expectedUpdatedAt,
    ...Object.fromEntries(Object.entries(identityShape).map(([key, field]) => [key, field.optional()])),
    purchaseDate: financialShape.purchaseDate.optional(),
    cost: financialShape.cost.optional(),
    usefulLifeYears: usefulLifeField.optional(),
    openingAccumulated: financialShape.openingAccumulated,
    openingThroughYear: financialShape.openingThroughYear,
  })
  .superRefine(refineFinancials);

export const transferAssetSchema = z
  .object({ expectedUpdatedAt, ...locationShape, note: optionalText(MAX_ASSET_NOTE_LENGTH, 'Not') })
  .superRefine(refineLocation);

export const assignAssetSchema = z.object({
  expectedUpdatedAt,
  employeeId: uuid('Personel seçin'),
  note: optionalText(MAX_ASSET_NOTE_LENGTH, 'Not'),
});

export const returnAssetSchema = z.object({ expectedUpdatedAt, note: optionalText(MAX_ASSET_NOTE_LENGTH, 'Not') });

export const disposeAssetSchema = z
  .object({
    expectedUpdatedAt,
    type: z.enum(ASSET_DISPOSAL_TYPES, { error: 'Elden çıkarma türünü seçin' }),
    disposedOn: isoDayField,
    /** Yalnız satışta (KDV hariç satış bedeli). */
    price: amountField('Satış bedeli').nullish(),
    reason: reasonField('Açıklama'),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'SOLD' && !value.price) ctx.addIssue({ code: 'custom', path: ['price'], message: 'Satış bedelini yazın' });
    if (value.type !== 'SOLD' && value.price) ctx.addIssue({ code: 'custom', path: ['price'], message: 'Satış bedeli yalnız satışta yazılır' });
  });

export const assetListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100, 'Arama en fazla 100 karakter').optional(),
  state: z.enum(ASSET_LIST_STATES).default('ACTIVE'),
  categoryId: z.string().uuid().optional(),
  areaId: z.string().uuid().optional(),
  roomId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
});

export const assetCodeParamSchema = z.object({
  code: z
    .string()
    .trim()
    .transform((value, ctx) => {
      const code = parseAssetCode(value);
      if (!code) {
        ctx.addIssue({ code: 'custom', message: 'Demirbaş kodu geçersiz (ör. DM-000123)' });
        return z.NEVER;
      }
      return code;
    }),
});

/** Etiket için kartlar (sıra korunur). */
export const assetLabelQuerySchema = z.object({
  ids: z
    .string()
    .transform((value) => value.split(',').map((id) => id.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid('Kart kimliği geçersiz')).min(1, 'Etiket için kart seçin').max(MAX_ASSET_LABELS, `Bir seferde en fazla ${MAX_ASSET_LABELS} etiket`)),
});

/* ─────────────── Excel ile toplu yükleme ─────────────── */

/** Excel sütunları (şablon başlıkları bu sırayla). Ad / kategori / konum / tarih / tutar zorunlu. */
export const ASSET_IMPORT_COLUMNS = Object.freeze([
  { key: 'name', label: 'Demirbaş adı', required: true },
  { key: 'category', label: 'Kategori', required: true },
  { key: 'location', label: 'Konum (oda no ya da alan)', required: true },
  { key: 'purchaseDate', label: 'Alış tarihi', required: true },
  { key: 'cost', label: 'Tutar (KDV hariç)', required: true },
  { key: 'usefulLifeYears', label: 'Faydalı ömür (yıl)' },
  { key: 'brand', label: 'Marka' },
  { key: 'model', label: 'Model' },
  { key: 'serialNumber', label: 'Seri no' },
  { key: 'supplierName', label: 'Tedarikçi' },
  { key: 'invoiceNumber', label: 'Fatura no' },
  { key: 'warrantyUntil', label: 'Garanti bitiş' },
  { key: 'openingAccumulated', label: 'Önceki amortisman' },
  { key: 'openingThroughYear', label: 'Önceki amortisman yılı' },
  { key: 'employeeCode', label: 'Zimmet (sicil no)' },
  { key: 'note', label: 'Not' },
]);

const importCell = z.union([z.string(), z.number()]).nullish().transform((value) => (value == null ? '' : String(value).trim()));

/** Excel'den gelen ham satır (metin hücreler); sunucu satır satır doğrular ve adları kayda çevirir. */
const importRowSchema = z.object(Object.fromEntries(ASSET_IMPORT_COLUMNS.map((column) => [column.key, importCell])));

/** Tek satırın sıkı doğrulaması (adlar henüz kayda çevrilmemiş). */
export const assetImportRowSchema = z
  .object({
    name: requiredText(MAX_ASSET_NAME_LENGTH, 'Demirbaş adı'),
    category: requiredText(MAX_ASSET_DEFINITION_NAME_LENGTH, 'Kategori'),
    location: requiredText(MAX_ASSET_DEFINITION_NAME_LENGTH, 'Konum'),
    purchaseDate: isoDayField,
    cost: amountField('Tutar'),
    usefulLifeYears: z.literal('').transform(() => null).or(usefulLifeField),
    brand: optionalText(MAX_ASSET_TEXT_LENGTH, 'Marka'),
    model: optionalText(MAX_ASSET_TEXT_LENGTH, 'Model'),
    serialNumber: optionalText(MAX_ASSET_TEXT_LENGTH, 'Seri no'),
    supplierName: optionalText(MAX_ASSET_TEXT_LENGTH, 'Tedarikçi'),
    invoiceNumber: optionalText(MAX_ASSET_TEXT_LENGTH, 'Fatura no'),
    warrantyUntil: nullableDay,
    openingAccumulated: z.literal('').transform(() => null).or(amountField('Önceki amortisman')),
    openingThroughYear: z.literal('').transform(() => null).or(yearField('Önceki amortisman yılı')),
    employeeCode: optionalText(20, 'Sicil no'),
    note: optionalText(MAX_ASSET_NOTE_LENGTH, 'Not'),
  })
  .superRefine(refineFinancials);

export const importAssetsSchema = z.object({
  requestId: uuid('İstek kimliği geçersiz'),
  /** Önizleme: doğrular, yazmaz. */
  dryRun: z.boolean().default(true),
  rows: z.array(importRowSchema).min(1, 'Dosyada satır yok').max(MAX_ASSET_IMPORT_ROWS, `Bir seferde en fazla ${MAX_ASSET_IMPORT_ROWS} satır`),
});

/* ─────────────── Sayım ─────────────── */

/** Sayım kapsamı: tüm otel (ikisi boş), bir alan ya da bir oda. */
export const createAssetCountSchema = z
  .object({
    title: optionalText(MAX_ASSET_DEFINITION_NAME_LENGTH, 'Başlık'),
    roomId: uuid('Oda geçersiz').nullish(),
    areaId: uuid('Alan geçersiz').nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.roomId && value.areaId) ctx.addIssue({ code: 'custom', path: ['areaId'], message: 'Kapsam ya bir oda ya bir alan olur' });
  });

/** Okutma: okutulan metin + sayımı yapanın şu an bulunduğu yer. */
export const scanAssetCountSchema = z
  .object({
    code: z.string({ error: 'Kodu okutun' }).trim().min(1, 'Kodu okutun').max(MAX_ASSET_SCAN_LENGTH, 'Okutulan metin çok uzun'),
    ...locationShape,
  })
  .superRefine(refineLocation);

export const closeAssetCountSchema = z.object({
  expectedUpdatedAt,
  /** Başka yerde bulunanları bulunduğu yere taşı. */
  applyTransfers: z.boolean().default(true),
  note: optionalText(MAX_ASSET_NOTE_LENGTH, 'Not'),
});

export const cancelAssetCountSchema = z.object({ expectedUpdatedAt, reason: reasonField('İptal sebebi') });

export const assetCountListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(ASSET_COUNT_STATUSES).optional(),
});

/* ─────────────── Amortisman ve garanti ─────────────── */

export const depreciationYearQuerySchema = z.object({ year: yearField('Yıl') });
export const depreciationYearSchema = z.object({ year: yearField('Yıl') });

export const assetWarrantyQuerySchema = z.object({
  state: z.enum(ASSET_WARRANTY_STATES).default('EXPIRING'),
  withinDays: optionalQueryInt({ label: 'Gün', min: 1, max: 365 }),
});

export const assetListFlagsSchema = z.object({ includeInactive: queryBoolean.optional() });
