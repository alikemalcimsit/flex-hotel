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

/** Prisma `StockMovementKind` ile birebir (44 çıkış, transfer, fire, sayım ekler). */
export const STOCK_MOVEMENT_KINDS = Object.freeze(['RECEIPT']);
export const STOCK_MOVEMENT_KIND_LABELS = Object.freeze({ RECEIPT: 'Mal kabul (giriş)' });

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
    from: isoDayField.optional(),
    to: isoDayField.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.to < value.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
  });
