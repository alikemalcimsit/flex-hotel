import { decimalField, expectedUpdatedAt, isoDayField, paginationQuerySchema } from './fields.js';
import { z } from './locale.js';

/**
 * Satın alma talebi sözleşmeleri (modül 45'in talep kısmı — modül 43'te kuruldu).
 *
 * Karar (kullanıcı, 27 Ekim 2026): banket malzeme ihtiyacı "satın alma talebine çevir"
 * ile talebe döner; talep tablosu 45'in şekliyle şimdi kurulur. 45 tedarikçi, teklif
 * karşılaştırma, sipariş ve mal kabulü bunun üstüne ekler (durumlar ve kaynaklar o zaman
 * genişler: onaylandı / siparişe döndü, elle talep, stoktan öneri).
 *
 * Talep satırı **malzeme × etkinlik** düzeyindedir: ekranda malzeme başına tek satır girilir,
 * sunucu miktarı etkinliklerin eksiğine ihtiyaç gününe göre dağıtır. Böylece "bu etkinlik
 * için ne talep edildi" kesin bilinir; 45 siparişte malzeme başına birleştirir.
 */

/** Prisma `PurchaseRequestStatus` ile birebir (45 genişletir). */
export const PURCHASE_REQUEST_STATUSES = Object.freeze(['OPEN', 'CANCELLED']);
export const PURCHASE_REQUEST_STATUS_LABELS = Object.freeze({ OPEN: 'Açık', CANCELLED: 'İptal' });
/** Prisma `PurchaseRequestSource` ile birebir (45 elle talep ve stok önerisini ekler). */
export const PURCHASE_REQUEST_SOURCES = Object.freeze(['BANQUET']);
export const PURCHASE_REQUEST_SOURCE_LABELS = Object.freeze({ BANQUET: 'Banket ihtiyacı' });

/** Talep numarası öneki: "STR-2026-0001". */
export const PURCHASE_REQUEST_PREFIX = 'STR';
/** Ekranda bir talepte girilen en fazla malzeme. */
export const MAX_REQUEST_ITEMS = 300;
/** Dağıtım sonrası en fazla satır (malzeme × etkinlik). */
export const MAX_REQUEST_LINES = 3000;
export const MAX_REQUEST_QUANTITY = 1_000_000;
export const REQUEST_QUANTITY_SCALE = 3;
export const MAX_PURCHASE_NOTE_LENGTH = 1000;
export const MIN_REQUEST_REASON_LENGTH = 5;
export const MAX_REQUEST_REASON_LENGTH = 500;

const uuid = (message) => z.string().uuid({ message });

const quantityField = (label) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(',', '.') : value),
    decimalField({ scale: REQUEST_QUANTITY_SCALE, min: 0, max: MAX_REQUEST_QUANTITY, label }),
  );

const requestLine = z.object({
  stockItemId: uuid('Malzeme seçin'),
  /** Talep edilen miktar (stok biriminde); eksikten fazla olabilir (ambalaj yuvarlaması). */
  quantity: quantityField('Miktar').refine((value) => Number(value) > 0, { message: "Miktar 0'dan büyük olmalı" }),
  /**
   * Ekranın gördüğü eksik: sunucu kilit altında yeniden hesaplar, tutmazsa (başkası bu arada
   * talep etti, menü / kişi değişti) talep açılmaz, liste yenilenir.
   */
  expectedShortfall: quantityField('Eksik'),
});

/**
 * Banket ihtiyacından talep: tek etkinlik ya da servis günü aralığı (kesin etkinlikler).
 */
export const createBanquetPurchaseRequestSchema = z
  .object({
    eventId: uuid('Geçersiz etkinlik').nullish(),
    from: isoDayField.nullish(),
    to: isoDayField.nullish(),
    lines: z
      .array(requestLine, { error: 'Satırlar geçersiz' })
      .min(1, 'En az bir malzeme seçin')
      .max(MAX_REQUEST_ITEMS, `Bir talepte en fazla ${MAX_REQUEST_ITEMS} malzeme`),
    note: z
      .string()
      .trim()
      .max(MAX_PURCHASE_NOTE_LENGTH, `Not en fazla ${MAX_PURCHASE_NOTE_LENGTH} karakter`)
      .transform((value) => value || null)
      .nullish(),
  })
  .superRefine((value, ctx) => {
    if (!value.eventId && !(value.from && value.to)) ctx.addIssue({ code: 'custom', path: ['eventId'], message: 'Etkinlik ya da gün aralığı seçin' });
    if (value.eventId && (value.from || value.to)) ctx.addIssue({ code: 'custom', path: ['from'], message: 'Etkinlik seçiliyken aralık verilmez' });
    if (value.from && value.to && value.to < value.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
    const seen = new Set();
    value.lines.forEach((line, index) => {
      if (seen.has(line.stockItemId)) ctx.addIssue({ code: 'custom', path: ['lines', index, 'stockItemId'], message: 'Aynı malzeme iki kez' });
      seen.add(line.stockItemId);
    });
  });

export const purchaseRequestParamSchema = z.object({ requestId: uuid('Geçersiz talep') });
export const cancelPurchaseRequestSchema = z.object({
  expectedUpdatedAt,
  reason: z
    .string({ error: 'Gerekçe yazın' })
    .trim()
    .min(MIN_REQUEST_REASON_LENGTH, `Gerekçe en az ${MIN_REQUEST_REASON_LENGTH} karakter`)
    .max(MAX_REQUEST_REASON_LENGTH, `Gerekçe en fazla ${MAX_REQUEST_REASON_LENGTH} karakter`),
});
export const purchaseRequestListQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(PURCHASE_REQUEST_STATUSES, { error: 'Geçersiz durum' }).optional(),
    /** Talep numarası ya da malzeme adı. */
    search: z.string().trim().max(200).optional(),
    eventId: uuid('Geçersiz etkinlik').optional(),
    /** İhtiyaç günü aralığı. */
    from: isoDayField.optional(),
    to: isoDayField.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.to < value.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
  });
