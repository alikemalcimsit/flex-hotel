import { decimalField, expectedUpdatedAt, isoDayField, paginationQuerySchema, queryBoolean } from './fields.js';
import { z } from './locale.js';
import { STOCK_ITEM_GROUPS } from './recipes.js';

/**
 * Stok çekirdeği sözleşmeleri (44'ün çekirdeği — modül 45'te kuruldu).
 *
 * Karar (kullanıcı, 29 Ekim 2026): mal kabulde stok gerçekten girsin diye depo, depo bazında
 * mevcut, stok hareketi ve **hareketli ortalama maliyet** burada kuruldu. 44 (Ali) çıkış, transfer,
 * fire, sayım düzeltmesi ve maliyet raporunu bu tabloların üstüne ekler (hareket türü genişler).
 *
 * Hareketli ortalama: girişte yeni maliyet = (eldeki × eski maliyet + gelen × alış fiyatı) ÷
 * (eldeki + gelen); elde stok yoksa (≤ 0) alış fiyatı. Maliyet malzeme kartında, otel geneli
 * (depolar arası aynı); mevcut hem depo bazında hem kartta (toplam) tutulur.
 */

/**
 * Prisma `StockMovementKind` ile birebir. Yalnız mal kabul (giriş) ortalama maliyeti değiştirir; diğer hareketler
 * miktarı **o anki ortalama maliyetle** değiştirir (modül 44).
 */
export const STOCK_MOVEMENT_KINDS = Object.freeze(['RECEIPT', 'ISSUE', 'WASTE', 'TRANSFER_OUT', 'TRANSFER_IN', 'COUNT_ADJUST', 'SALE']);
export const STOCK_MOVEMENT_KIND_LABELS = Object.freeze({
  RECEIPT: 'Mal kabul (giriş)',
  ISSUE: 'Çıkış (kullanım)',
  WASTE: 'Fire',
  TRANSFER_OUT: 'Transfer (çıkan)',
  TRANSFER_IN: 'Transfer (giren)',
  COUNT_ADJUST: 'Sayım farkı',
  SALE: 'Satış (reçeteden)',
});

/** Elle girilen hareketler (transfer çıkan + giren çift olarak yazılır). */
export const MANUAL_STOCK_MOVEMENT_KINDS = Object.freeze(['ISSUE', 'WASTE', 'TRANSFER']);
export const MANUAL_STOCK_MOVEMENT_KIND_LABELS = Object.freeze({ ISSUE: 'Çıkış (departman kullanımı)', WASTE: 'Fire (bozulan / dökülen)', TRANSFER: 'Depolar arası transfer' });
export const MAX_STOCK_MOVEMENT_LINES = 50;
export const MIN_STOCK_REASON_LENGTH = 3;
export const MAX_STOCK_NOTE_LENGTH = 300;

/** Prisma `StockCountStatus` ile birebir. */
export const STOCK_COUNT_STATUSES = Object.freeze(['OPEN', 'APPROVED', 'CANCELLED']);
export const STOCK_COUNT_STATUS_LABELS = Object.freeze({ OPEN: 'Sayılıyor', APPROVED: 'Onaylandı', CANCELLED: 'İptal' });
export const MAX_STOCK_COUNT_LINES = 1000;
/** Maliyet raporunun en uzun aralığı (gün). */
export const MAX_STOCK_REPORT_DAYS = 366;

export const MAX_WAREHOUSES = 50;
export const MAX_WAREHOUSE_NAME_LENGTH = 80;
export const STOCK_QUANTITY_SCALE = 3;
export const MAX_STOCK_QUANTITY = 10_000_000;

const uuid = (message) => z.string().uuid({ message });

const warehouseShape = {
  code: z
    .string({ error: 'Depo kodu zorunlu' })
    .trim()
    .toUpperCase()
    .min(1, 'Depo kodu zorunlu')
    .max(20, 'Depo kodu en fazla 20 karakter')
    .regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Kod yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir'),
  name: z.string({ error: 'Depo adı zorunlu' }).trim().min(2, 'Depo adı en az 2 karakter').max(MAX_WAREHOUSE_NAME_LENGTH, `Depo adı en fazla ${MAX_WAREHOUSE_NAME_LENGTH} karakter`),
  /** Mal kabulde önce seçili gelen depo (otelde tek). */
  isDefault: z.boolean().default(false),
};

export const createWarehouseSchema = z.object(warehouseShape);
export const updateWarehouseSchema = z.object({ expectedUpdatedAt, ...warehouseShape, isActive: z.boolean() });
export const warehouseParamSchema = z.object({ warehouseId: uuid('Geçersiz depo') });
/** Depo listesi (en fazla MAX_WAREHOUSES): pasifler istenirse. */
export const warehouseListQuerySchema = z.object({ includeInactive: queryBoolean.optional() });

/** Minimum seviye (stok birimi): altına düşünce talep önerisine girer; boş = izlenmez. */
export const updateMinLevelSchema = z.object({
  expectedUpdatedAt,
  minLevel: z
    .union([z.literal(''), z.null(), z.preprocess((value) => (typeof value === 'string' ? value.trim().replace(',', '.') : value), decimalField({ scale: STOCK_QUANTITY_SCALE, min: 0, max: MAX_STOCK_QUANTITY, label: 'Minimum seviye' }))])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
});
export const stockItemLevelParamSchema = z.object({ stockItemId: uuid('Geçersiz malzeme') });

export const stockLevelListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  group: z.enum(STOCK_ITEM_GROUPS, { error: 'Geçersiz grup' }).optional(),
  /** Yalnız minimum seviyenin altındakiler. */
  belowMin: queryBoolean.optional(),
  /** Yalnız eldekiler (mevcut > 0). */
  inStock: queryBoolean.optional(),
});

export const stockMovementListQuerySchema = paginationQuerySchema
  .extend({
    stockItemId: uuid('Geçersiz malzeme').optional(),
    warehouseId: uuid('Geçersiz depo').optional(),
    kind: z.enum(['RECEIPT', 'ISSUE', 'WASTE', 'TRANSFER_OUT', 'TRANSFER_IN', 'COUNT_ADJUST', 'SALE']).optional(),
    from: isoDayField.optional(),
    to: isoDayField.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.to < value.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
  });

/* ─────────────── Modül 44: elle hareket, sayım, maliyet raporu ─────────────── */

/** Stok miktarı (stok biriminde): "2,5" de olur. */
const quantityField = (label, min = 0.001) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(',', '.') : value),
    decimalField({ scale: STOCK_QUANTITY_SCALE, min, max: MAX_STOCK_QUANTITY, label }),
  );

const noteField = z
  .string()
  .trim()
  .max(MAX_STOCK_NOTE_LENGTH, `Açıklama en fazla ${MAX_STOCK_NOTE_LENGTH} karakter`)
  .nullish()
  .transform((value) => value || null);

/**
 * Elle hareket: çıkış (departman kullanımı), fire (sebep zorunlu) ya da depolar arası transfer. Miktar depodaki
 * mevcuttan fazla olamaz (eksiye yalnız satış düşümü iner).
 */
export const manualStockMovementSchema = z
  .object({
    /** Formun ürettiği kimlik: çift gönderimde hareket iki kez yazılmaz. */
    requestId: uuid('İstek kimliği geçersiz'),
    kind: z.enum(MANUAL_STOCK_MOVEMENT_KINDS, { error: 'Hareket türünü seçin' }),
    warehouseId: uuid('Depo seçin'),
    toWarehouseId: uuid('Hedef depo seçin').nullish().transform((value) => value ?? null),
    lines: z
      .array(z.object({ stockItemId: uuid('Malzeme seçin'), quantity: quantityField('Miktar') }))
      .min(1, 'En az bir malzeme ekleyin')
      .max(MAX_STOCK_MOVEMENT_LINES, `Bir harekette en fazla ${MAX_STOCK_MOVEMENT_LINES} malzeme`),
    note: noteField,
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'TRANSFER' && !value.toWarehouseId) ctx.addIssue({ code: 'custom', path: ['toWarehouseId'], message: 'Hedef depoyu seçin' });
    if (value.kind === 'TRANSFER' && value.toWarehouseId === value.warehouseId) ctx.addIssue({ code: 'custom', path: ['toWarehouseId'], message: 'Hedef depo kaynakla aynı olamaz' });
    if (value.kind !== 'TRANSFER' && value.toWarehouseId) ctx.addIssue({ code: 'custom', path: ['toWarehouseId'], message: 'Hedef depo yalnız transferde seçilir' });
    if (value.kind === 'WASTE' && (value.note ?? '').length < MIN_STOCK_REASON_LENGTH) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Fire sebebini yazın' });
    const ids = value.lines.map((line) => line.stockItemId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Aynı malzeme iki kez eklenmiş' });
  });


/** Sayım aç: deponun mevcutları "beklenen" olarak dondurulur. */
export const createStockCountSchema = z.object({ warehouseId: uuid('Depo seçin'), note: noteField });

/** Sayılan miktarlar (boş = sayılmadı); listede olmayan malzeme de eklenebilir. */
export const updateStockCountLinesSchema = z.object({
  expectedUpdatedAt,
  lines: z
    .array(
      z.object({
        stockItemId: uuid('Malzeme seçin'),
        countedQuantity: z.union([z.literal(''), z.null(), quantityField('Sayılan miktar', 0)]).transform((value) => (value === '' ? null : value)),
      }),
    )
    .min(1, 'Satır yok')
    .max(MAX_STOCK_COUNT_LINES, `En fazla ${MAX_STOCK_COUNT_LINES} satır`),
});

export const approveStockCountSchema = z.object({ expectedUpdatedAt });
export const cancelStockCountSchema = z.object({
  expectedUpdatedAt,
  reason: z.string({ error: 'Sebep yazın' }).trim().min(MIN_STOCK_REASON_LENGTH, 'Sebep en az 3 karakter').max(MAX_STOCK_NOTE_LENGTH),
});
export const stockCountParamSchema = z.object({ countId: uuid('Geçersiz sayım') });
export const stockCountListQuerySchema = paginationQuerySchema.extend({ status: z.enum(STOCK_COUNT_STATUSES).optional() });

/** Maliyet raporu: dönemde giriş / tüketim (satış, çıkış, fire, sayım farkı) miktar ve maliyeti, bugünkü mevcut ve değer. */
export const stockCostReportQuerySchema = z
  .object({ from: isoDayField, to: isoDayField, warehouseId: uuid('Geçersiz depo').optional() })
  .superRefine((value, ctx) => {
    if (value.to < value.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
    const days = (Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86_400_000 + 1;
    if (days > MAX_STOCK_REPORT_DAYS) ctx.addIssue({ code: 'custom', path: ['from'], message: `Aralık en fazla ${MAX_STOCK_REPORT_DAYS} gün` });
  });

/* ─────────────── Modül 44: satış noktası → depo (satış düşümü hangi depodan) ─────────────── */

export const MAX_OUTLET_WAREHOUSE_LINKS = 50;

/**
 * Otel ayarı `Hotel.settings.stock.outletWarehouses`: satış noktasının stoğunun düştüğü depo; eşlenmemiş nokta
 * varsayılan depodan düşer. Çift gönderime karşı otel kaydının sürüm damgasıyla.
 */
export const updateStockSettingsSchema = z
  .object({
    expectedUpdatedAt,
    outletWarehouses: z
      .array(z.object({ outletId: uuid('Satış noktası geçersiz'), warehouseId: uuid('Depo seçin') }))
      .max(MAX_OUTLET_WAREHOUSE_LINKS, `En fazla ${MAX_OUTLET_WAREHOUSE_LINKS} eşleme`),
  })
  .superRefine((value, ctx) => {
    const ids = value.outletWarehouses.map((link) => link.outletId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['outletWarehouses'], message: 'Bir satış noktası bir kez eşlenir' });
  });

/** Ürün bazlı maliyet raporu (satılan adet / ciro / reçeteden düşen maliyet / marj) — aynı gün aralığı kuralları. */
export const stockProductReportQuerySchema = stockCostReportQuerySchema;
