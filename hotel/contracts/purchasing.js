import { decimalField, expectedUpdatedAt, isoDayField, paginationQuerySchema, queryBoolean } from './fields.js';
import { z } from './locale.js';
import { STOCK_ITEM_GROUPS } from './recipes.js';
import { guestInputSchema } from './reservations.js';

/**
 * Satın alma sözleşmeleri (modül 45; talep kısmı modül 43'te kuruldu).
 *
 * Kararlar (kullanıcı, 27 ve 29 Ekim 2026):
 * - Banket malzeme ihtiyacı "satın alma talebine çevir" ile talebe döner (43). Talep satırı
 *   **malzeme × etkinlik** düzeyindedir; teklif turunda malzeme başına birleşir.
 * - **Teklif karşılaştırma satır bazında:** her malzeme kendi en uygun teklifinden (fiyat, sonra
 *   termin) alınır; seçim tedarikçi başına ayrı siparişe döner. En ucuz dışı seçim gerekçe ister.
 * - Sipariş tutarı politikadaki eşik ve üstündeyse onay kuyruğuna gider (dört göz). Reddedilen /
 *   iptal edilen siparişin satırları teklif turuna geri döner (yeniden seçilebilir).
 * - **Mal kabulde stok girer:** 44'ün çekirdeği (depo, depo bazında mevcut, stok hareketi,
 *   hareketli ortalama maliyet) burada kuruldu; transfer / fire / sayım 44'te eklenir.
 *   Mal kabul tedarikçi borcu olayı yayınlar (`purchase.goods.received`; cari 47'de).
 * - Para birimi otelin para birimidir; birim fiyatlar **KDV hariç** ve stok birimindedir.
 */

/* ─────────────── Durumlar ─────────────── */

/** Prisma `PurchaseRequestStatus` ile birebir: açık → işlemde (satırları teklif turunda) → siparişe döndü; iptal. */
export const PURCHASE_REQUEST_STATUSES = Object.freeze(['OPEN', 'IN_PROGRESS', 'ORDERED', 'CANCELLED']);
export const PURCHASE_REQUEST_STATUS_LABELS = Object.freeze({ OPEN: 'Açık', IN_PROGRESS: 'Teklif / siparişte', ORDERED: 'Siparişe döndü', CANCELLED: 'İptal' });
/** Prisma `PurchaseRequestSource` ile birebir. */
export const PURCHASE_REQUEST_SOURCES = Object.freeze(['BANQUET', 'MANUAL', 'STOCK']);
export const PURCHASE_REQUEST_SOURCE_LABELS = Object.freeze({ BANQUET: 'Banket ihtiyacı', MANUAL: 'Elle talep', STOCK: 'Minimum stok' });

/** Prisma `PurchaseRoundStatus` ile birebir: teklif toplanıyor → bütün satırlar siparişe döndü; iptal. */
export const PURCHASE_ROUND_STATUSES = Object.freeze(['OPEN', 'AWARDED', 'CANCELLED']);
export const PURCHASE_ROUND_STATUS_LABELS = Object.freeze({ OPEN: 'Teklif toplanıyor', AWARDED: 'Siparişe döndü', CANCELLED: 'İptal' });

/** Prisma `PurchaseOrderStatus` ile birebir. */
export const PURCHASE_ORDER_STATUSES = Object.freeze(['PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'REJECTED', 'CANCELLED']);
export const PURCHASE_ORDER_STATUS_LABELS = Object.freeze({
  PENDING_APPROVAL: 'Onay bekliyor',
  APPROVED: 'Onaylı',
  PARTIALLY_RECEIVED: 'Kısmen teslim',
  RECEIVED: 'Teslim alındı',
  CLOSED: 'Eksik kapatıldı',
  REJECTED: 'Reddedildi',
  CANCELLED: 'İptal',
});
/** Mal kabul yapılabilen sipariş durumları. */
export const RECEIVABLE_ORDER_STATUSES = Object.freeze(['APPROVED', 'PARTIALLY_RECEIVED']);
/** Satırları teklif turuna geri dönen (kapanmış, hiç teslim alınmamış) durumlar. */
export const RELEASED_ORDER_STATUSES = Object.freeze(['REJECTED', 'CANCELLED']);

/** Satın alma KDV oranları (%): temel gıda 1, gıda 10, genel 20, istisna 0. */
export const PURCHASE_TAX_RATES = Object.freeze(['0', '1', '10', '20']);

/** Numara önekleri: talep, teklif turu, sipariş, mal kabul. */
export const PURCHASE_REQUEST_PREFIX = 'STR';
export const PURCHASE_ROUND_PREFIX = 'TKT';
export const PURCHASE_ORDER_PREFIX = 'SAS';
export const GOODS_RECEIPT_PREFIX = 'MKB';

/* ─────────────── Sınırlar ─────────────── */

/** Ekranda bir talepte girilen en fazla malzeme. */
export const MAX_REQUEST_ITEMS = 300;
/** Dağıtım sonrası en fazla satır (malzeme × etkinlik). */
export const MAX_REQUEST_LINES = 3000;
export const MAX_REQUEST_QUANTITY = 1_000_000;
export const REQUEST_QUANTITY_SCALE = 3;
export const MAX_PURCHASE_NOTE_LENGTH = 1000;
export const MIN_REQUEST_REASON_LENGTH = 5;
export const MAX_REQUEST_REASON_LENGTH = 500;
/** Bir teklif turuna alınan en fazla talep satırı ve oluşan en fazla tur satırı (malzeme). */
export const MAX_ROUND_REQUEST_LINES = 3000;
export const MAX_ROUND_LINES = 300;
/** Bir turda en fazla teklif (tedarikçi). */
export const MAX_ROUND_QUOTES = 10;
export const MAX_UNIT_PRICE = 10_000_000;
export const UNIT_PRICE_SCALE = 4;
export const MAX_SUPPLIER_PAYMENT_TERM_DAYS = 180;
export const MAX_SUPPLIER_LEAD_DAYS = 60;
export const MAX_SUPPLIER_NAME_LENGTH = 160;
export const MAX_WAYBILL_LENGTH = 40;
/** Sipariş onay eşiği üst sınırı (yazım hatasını yakalar). */
export const MAX_ORDER_APPROVAL_AMOUNT = 100_000_000;
/** Onay bekleyen sipariş bu kadar gün içinde karara bağlanmazsa düşer (reddedilmiş sayılır, satırlar tura döner). */
export const PURCHASE_ORDER_APPROVAL_DAYS = 3;
/**
 * Tartılan / ölçülen malzemede (kg, g, L, ml) siparişten en fazla bu kadar yüzde fazla teslim alınabilir
 * (10 kg et 10,2 kg gelir); adette fazla teslim alınmaz. Fazlası sipariş fiyatıyla borç doğurur.
 */
export const MAX_OVER_RECEIPT_PCT = 5;
/** Seçici (tedarikçi arama) sonucu. */
export const MAX_SUPPLIER_PICKER_RESULTS = 30;

/* ─────────────── Saf kurallar ─────────────── */

/**
 * Tur satırının en iyi teklifi: fiyatı girilmiş teklifler arasında önce **ihtiyaç gününe yetişenler**
 * (geç teslim eden ucuz teklif, zamanında teslim eden varken önerilmez — düğünün malzemesi ertesi gün
 * işe yaramaz), sonra en düşük birim fiyat; eşitse kısa termin, o da eşitse önce girilen. Fiyat girilmemiş
 * (tedarikçi vermiyor) teklif sayılmaz. Hepsi geçse aralarında en ucuzu.
 *
 * @param {Array<{ id: string, unitPrice: string | null, deliveryDays: number, createdAt: string, late?: boolean }>} candidates
 * @returns {string | null} en iyi teklif satırının kimliği
 */
export function bestQuoteLine(candidates) {
  const priced = candidates.filter((candidate) => candidate.unitPrice !== null && candidate.unitPrice !== undefined && candidate.unitPrice !== '');
  if (priced.length === 0) return null;
  // Fiyatlar en fazla 4 ondalıklı metin: on binde bire çevrilip tam sayıyla karşılaştırılır.
  const tenThousandths = (text) => {
    const [whole, fraction = ''] = String(text).split('.');
    return BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0').slice(0, 4));
  };
  return [...priced].sort((a, b) => {
    if (Boolean(a.late) !== Boolean(b.late)) return a.late ? 1 : -1;
    const price = tenThousandths(a.unitPrice) - tenThousandths(b.unitPrice);
    if (price !== 0n) return price < 0n ? -1 : 1;
    if (a.deliveryDays !== b.deliveryDays) return a.deliveryDays - b.deliveryDays;
    return a.createdAt.localeCompare(b.createdAt);
  })[0].id;
}

/* ─────────────── Şemalar ─────────────── */

const uuid = (message) => z.string().uuid({ message });

const optionalText = (max, label) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter`)
    .transform((value) => value || null)
    .nullish();

const intField = (label, min, max) =>
  z.coerce
    .number({ error: `${label} sayı olmalı` })
    .int(`${label} tam sayı olmalı`)
    .min(min, `${label} en az ${min}`)
    .max(max, `${label} en fazla ${max.toLocaleString('tr-TR')}`);

const quantityField = (label) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(',', '.') : value),
    decimalField({ scale: REQUEST_QUANTITY_SCALE, min: 0, max: MAX_REQUEST_QUANTITY, label }),
  );

const positiveQuantity = (label) => quantityField(label).refine((value) => Number(value) > 0, { message: `${label} 0'dan büyük olmalı` });

const priceField = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().replace(',', '.') : value),
  decimalField({ scale: UNIT_PRICE_SCALE, min: 0, max: MAX_UNIT_PRICE, label: 'Birim fiyat' }),
);

const reasonField = (label) =>
  z
    .string({ error: `${label} yazın` })
    .trim()
    .min(MIN_REQUEST_REASON_LENGTH, `${label} en az ${MIN_REQUEST_REASON_LENGTH} karakter`)
    .max(MAX_REQUEST_REASON_LENGTH, `${label} en fazla ${MAX_REQUEST_REASON_LENGTH} karakter`);

const noteField = optionalText(MAX_PURCHASE_NOTE_LENGTH, 'Not');

/** @param {{ from?: string, to?: string }} value @param {import('zod').RefinementCtx} ctx */
const refineRange = (value, ctx) => {
  if (value.from && value.to && value.to < value.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
};

/** @param {Array<{ stockItemId: string }>} lines @param {import('zod').RefinementCtx} ctx */
const refineUniqueItems = (lines, ctx) => {
  const seen = new Set();
  lines.forEach((line, index) => {
    if (seen.has(line.stockItemId)) ctx.addIssue({ code: 'custom', path: ['lines', index, 'stockItemId'], message: 'Aynı malzeme iki kez' });
    seen.add(line.stockItemId);
  });
};

/* ── Talep ── */

const banquetRequestLine = z.object({
  stockItemId: uuid('Malzeme seçin'),
  /** Talep edilen miktar (stok biriminde); eksikten fazla olabilir (ambalaj yuvarlaması). */
  quantity: positiveQuantity('Miktar'),
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
      .array(banquetRequestLine, { error: 'Satırlar geçersiz' })
      .min(1, 'En az bir malzeme seçin')
      .max(MAX_REQUEST_ITEMS, `Bir talepte en fazla ${MAX_REQUEST_ITEMS} malzeme`),
    note: noteField,
  })
  .superRefine((value, ctx) => {
    if (!value.eventId && !(value.from && value.to)) ctx.addIssue({ code: 'custom', path: ['eventId'], message: 'Etkinlik ya da gün aralığı seçin' });
    if (value.eventId && (value.from || value.to)) ctx.addIssue({ code: 'custom', path: ['from'], message: 'Etkinlik seçiliyken aralık verilmez' });
    refineRange(value, ctx);
    refineUniqueItems(value.lines, ctx);
  });

/**
 * Elle talep (ya da minimum stok önerisinden): malzeme, miktar, ihtiyaç günü (satırda yoksa talebinki).
 */
export const createPurchaseRequestSchema = z
  .object({
    source: z.enum(['MANUAL', 'STOCK'], { error: 'Geçersiz kaynak' }).default('MANUAL'),
    neededBy: isoDayField,
    note: noteField,
    lines: z
      .array(
        z.object({
          stockItemId: uuid('Malzeme seçin'),
          quantity: positiveQuantity('Miktar'),
          neededBy: isoDayField.nullish(),
        }),
        { error: 'Satırlar geçersiz' },
      )
      .min(1, 'En az bir malzeme ekleyin')
      .max(MAX_REQUEST_ITEMS, `Bir talepte en fazla ${MAX_REQUEST_ITEMS} malzeme`),
  })
  .superRefine((value, ctx) => refineUniqueItems(value.lines, ctx));

export const purchaseRequestParamSchema = z.object({ requestId: uuid('Geçersiz talep') });
export const cancelPurchaseRequestSchema = z.object({ expectedUpdatedAt, reason: reasonField('Gerekçe') });
export const purchaseRequestListQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(PURCHASE_REQUEST_STATUSES, { error: 'Geçersiz durum' }).optional(),
    source: z.enum(PURCHASE_REQUEST_SOURCES, { error: 'Geçersiz kaynak' }).optional(),
    /** Talep numarası ya da malzeme adı. */
    search: z.string().trim().max(200).optional(),
    eventId: uuid('Geçersiz etkinlik').optional(),
    /** İhtiyaç günü aralığı. */
    from: isoDayField.optional(),
    to: isoDayField.optional(),
  })
  .superRefine(refineRange);

/** Teklif turuna alınabilecek açık talep satırları, malzeme başına toplanmış (malzeme grubu, ihtiyaç günü, arama). */
export const openRequestLinesQuerySchema = paginationQuerySchema
  .extend({
    group: z.enum(STOCK_ITEM_GROUPS, { error: 'Geçersiz grup' }).optional(),
    search: z.string().trim().max(200).optional(),
    from: isoDayField.optional(),
    to: isoDayField.optional(),
  })
  .superRefine(refineRange);

/** Minimum stok önerileri (malzeme grubu, arama). */
export const purchaseSuggestionQuerySchema = paginationQuerySchema.extend({
  group: z.enum(STOCK_ITEM_GROUPS, { error: 'Geçersiz grup' }).optional(),
  search: z.string().trim().max(200).optional(),
});

/* ── Tedarikçi ── */

const supplierShape = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .max(20, 'Kod en fazla 20 karakter')
    .regex(/^([A-Z0-9][A-Z0-9._-]*)?$/, 'Kod yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir')
    .transform((value) => value || null)
    .nullish(),
  name: z.string({ error: 'Tedarikçi adı zorunlu' }).trim().min(2, 'Tedarikçi adı en az 2 karakter').max(MAX_SUPPLIER_NAME_LENGTH, `Tedarikçi adı en fazla ${MAX_SUPPLIER_NAME_LENGTH} karakter`),
  contactName: optionalText(100, 'Yetkili adı'),
  phone: guestInputSchema.shape.phone,
  email: guestInputSchema.shape.email,
  taxOffice: optionalText(100, 'Vergi dairesi'),
  taxNumber: z
    .string()
    .trim()
    .max(30, 'Vergi / T.C. kimlik no en fazla 30 karakter')
    .refine((value) => value === '' || /^\d{10,11}$/.test(value), { message: 'Vergi no 10, T.C. kimlik no 11 hane olmalı' })
    .transform((value) => value || null)
    .nullish(),
  address: optionalText(300, 'Adres'),
  /** Ödeme vadesi (gün): mal kabulden itibaren; tedarikçi borcunun vadesi buradan. */
  paymentTermDays: intField('Ödeme vadesi', 0, MAX_SUPPLIER_PAYMENT_TERM_DAYS).default(30),
  /** Olağan termin (gün): teklif girilirken varsayılan. */
  leadTimeDays: intField('Termin', 0, MAX_SUPPLIER_LEAD_DAYS).default(1),
  /** Tedarik ettiği malzeme grupları (kasap: kırmızı et…); teklif turunda öneri için. */
  groups: z.array(z.enum(STOCK_ITEM_GROUPS, { error: 'Geçersiz grup' })).max(STOCK_ITEM_GROUPS.length).default([]),
  notes: optionalText(1000, 'Not'),
};

export const createSupplierSchema = z.object(supplierShape);
export const updateSupplierSchema = z.object({ expectedUpdatedAt, ...supplierShape, isActive: z.boolean() });
export const supplierParamSchema = z.object({ supplierId: uuid('Geçersiz tedarikçi') });
export const supplierListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  group: z.enum(STOCK_ITEM_GROUPS, { error: 'Geçersiz grup' }).optional(),
  active: queryBoolean.optional(),
});

/* ── Teklif turu ── */

/**
 * Teklif turu: seçilen malzemelerin (ihtiyaç günü aralığındaki) bütün açık talep satırları malzeme başına
 * birleşir. Ekran gördüğü toplamı gönderir; sunucu kilit altında yeniden toplar, tutmazsa (bu arada talep
 * açıldı / iptal edildi / başka tura alındı) tur açılmaz.
 */
export const createPurchaseRoundSchema = z
  .object({
    from: isoDayField.nullish(),
    to: isoDayField.nullish(),
    items: z
      .array(z.object({ stockItemId: uuid('Malzeme seçin'), expectedQuantity: positiveQuantity('Miktar') }), { error: 'Malzemeler geçersiz' })
      .min(1, 'En az bir malzeme seçin')
      .max(MAX_ROUND_LINES, `Bir turda en fazla ${MAX_ROUND_LINES} malzeme`),
    note: noteField,
  })
  .superRefine((value, ctx) => {
    refineRange(value, ctx);
    const seen = new Set();
    value.items.forEach((item, index) => {
      if (seen.has(item.stockItemId)) ctx.addIssue({ code: 'custom', path: ['items', index, 'stockItemId'], message: 'Aynı malzeme iki kez' });
      seen.add(item.stockItemId);
    });
  });
export const purchaseRoundParamSchema = z.object({ roundId: uuid('Geçersiz teklif turu') });
export const purchaseRoundQuoteParamSchema = z.object({ roundId: uuid('Geçersiz teklif turu'), supplierId: uuid('Geçersiz tedarikçi') });
export const purchaseRoundListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(PURCHASE_ROUND_STATUSES, { error: 'Geçersiz durum' }).optional(),
  search: z.string().trim().max(200).optional(),
});

/**
 * Tedarikçinin teklifi (turda tedarikçi başına tek; yeniden kaydedilince güncellenir): termin, geçerlilik,
 * satır fiyatları (KDV hariç, stok biriminde; boş = bu malzemeyi vermiyor) ve KDV oranı.
 */
export const savePurchaseQuoteSchema = z.object({
  expectedUpdatedAt,
  deliveryDays: intField('Termin', 0, MAX_SUPPLIER_LEAD_DAYS),
  validUntil: isoDayField.nullish(),
  note: noteField,
  lines: z
    .array(
      z.object({
        roundLineId: uuid('Geçersiz tur satırı'),
        unitPrice: z.union([z.literal(''), z.null(), priceField]).optional().transform((value) => (value === '' || value === undefined ? null : value)),
        taxRatePct: z.enum(PURCHASE_TAX_RATES, { error: 'KDV oranı seçin' }),
      }),
      { error: 'Satırlar geçersiz' },
    )
    .max(MAX_ROUND_LINES)
    .refine((lines) => new Set(lines.map((line) => line.roundLineId)).size === lines.length, { message: 'Aynı satır iki kez' })
    .refine((lines) => lines.some((line) => line.unitPrice !== null), { message: 'En az bir malzemeye fiyat girin' }),
});

/** Kazanan seçimi: tur satırı başına bir teklif satırı; en ucuz dışı seçim gerekçe ister (sunucu denetler). */
export const awardPurchaseRoundSchema = z.object({
  expectedUpdatedAt,
  awards: z
    .array(
      z.object({
        roundLineId: uuid('Geçersiz tur satırı'),
        quoteLineId: uuid('Teklif seçin'),
        reason: optionalText(MAX_REQUEST_REASON_LENGTH, 'Gerekçe'),
      }),
      { error: 'Seçimler geçersiz' },
    )
    .min(1, 'En az bir satır için teklif seçin')
    .max(MAX_ROUND_LINES)
    .refine((awards) => new Set(awards.map((award) => award.roundLineId)).size === awards.length, { message: 'Aynı satır iki kez' }),
});
export const cancelPurchaseRoundSchema = z.object({ expectedUpdatedAt, reason: reasonField('Gerekçe') });
/** Teklifi turdan çıkarmak (yanlış tedarikçi, geri çekilen teklif): turun sürüm damgasıyla. */
export const removePurchaseQuoteSchema = z.object({ expectedUpdatedAt });

/* ── Sipariş ve mal kabul ── */

export const purchaseOrderParamSchema = z.object({ orderId: uuid('Geçersiz sipariş') });
export const purchaseOrderListQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(PURCHASE_ORDER_STATUSES, { error: 'Geçersiz durum' }).optional(),
    /** Teslim bekleyenler (onaylı + kısmen teslim). */
    open: queryBoolean.optional(),
    supplierId: uuid('Geçersiz tedarikçi').optional(),
    search: z.string().trim().max(200).optional(),
    /** Beklenen teslim günü aralığı. */
    from: isoDayField.optional(),
    to: isoDayField.optional(),
  })
  .superRefine(refineRange);
export const cancelPurchaseOrderSchema = z.object({ expectedUpdatedAt, reason: reasonField('Gerekçe') });
/** Kısmen teslim alınmış siparişin kalanı gelmeyecek: sipariş eksik kapatılır. */
export const closePurchaseOrderSchema = z.object({ expectedUpdatedAt, reason: reasonField('Gerekçe') });

export const receiveGoodsSchema = z
  .object({
    expectedUpdatedAt,
    warehouseId: uuid('Depo seçin'),
    /** İrsaliye numarası. */
    waybillNumber: z.string({ error: 'İrsaliye no yazın' }).trim().min(1, 'İrsaliye no yazın').max(MAX_WAYBILL_LENGTH, `İrsaliye no en fazla ${MAX_WAYBILL_LENGTH} karakter`),
    receivedOn: isoDayField,
    note: noteField,
    /** Kalan miktar gelmeyecek: sipariş bu kabulle eksik kapatılır (hiç mal gelmeden kapatmak `close`). */
    closeShort: z.boolean().default(false),
    lines: z
      .array(z.object({ orderLineId: uuid('Geçersiz sipariş satırı'), quantity: quantityField('Gelen miktar') }), { error: 'Satırlar geçersiz' })
      .min(1, 'En az bir satır girin')
      .max(MAX_ROUND_LINES)
      .refine((lines) => new Set(lines.map((line) => line.orderLineId)).size === lines.length, { message: 'Aynı satır iki kez' }),
  })
  .refine((value) => value.lines.some((line) => Number(line.quantity) > 0), { message: 'En az bir satırda gelen miktar girin', path: ['lines'] });
export const goodsReceiptParamSchema = z.object({ receiptId: uuid('Geçersiz mal kabul') });
export const goodsReceiptListQuerySchema = paginationQuerySchema
  .extend({
    supplierId: uuid('Geçersiz tedarikçi').optional(),
    warehouseId: uuid('Geçersiz depo').optional(),
    search: z.string().trim().max(200).optional(),
    from: isoDayField.optional(),
    to: isoDayField.optional(),
  })
  .superRefine(refineRange);

/* ── Politika ── */

export const updatePurchaseSettingsSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAt.nullish(),
  /** Bu tutar (KDV dahil) ve üstündeki sipariş onay kuyruğuna gider; 0 = onay yok. */
  orderApprovalAmount: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(',', '.') : value),
    decimalField({ scale: 2, min: 0, max: MAX_ORDER_APPROVAL_AMOUNT, label: 'Onay eşiği' }),
  ),
  defaultTaxRatePct: z.enum(PURCHASE_TAX_RATES, { error: 'KDV oranı seçin' }),
});
