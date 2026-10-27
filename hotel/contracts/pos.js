import { TAX_APPLIES_TO } from './constants.js';
import { normalizeDecimalString } from './decimal.js';
import { dateField, expectedUpdatedAt, paginationQuerySchema } from './fields.js';
import { looksLikeCardNumber } from './front-desk.js';
import { z } from './locale.js';
import { PAYMENT_REFERENCE_LABELS, PAYMENT_REFERENCE_MAX } from './payments.js';
import { moneyInputField } from './reservations.js';

/**
 * Restoran POS (modül 39) ve menü (modül 38'in menü kısmı) sözleşmesi.
 *
 * - **Satış noktası** (restoran, lobi bar, havuz bar) ve masaları; menü grupları (satış
 *   noktasına göre kısıtlanabilir) ve ürünler (vergi dahil fiyat, vergi kategorisi,
 *   mutfak istasyonu, "tükendi").
 * - **Adisyon** masada (ya da masasız) açılır; garson "Gönder" deyince **sipariş turu**
 *   (`PosOrder`) oluşur ve kalemler mutfağa gider — gönderilmiş kalem silinmez, yalnızca
 *   gerekçeli **iptal** (zayi işaretiyle) düşer. İkram ve indirim de **düzeltme** kaydıdır;
 *   şef garson / müdür yetkisi ister, eşik üstü dört göz onaya gider.
 * - **Ödeme** nakit / kart (adisyonun kendi ödemesi; kasada "Restoran" kaynağı) ya da
 *   **odaya yaz** (içerideki misafirin folyosuna `fnb.order.charged`). Bakiye sıfırlanınca
 *   adisyon kapanır.
 * - **Vardiya:** garson açılış avansıyla vardiya açar; kapanışta açık adisyonu kalmaz,
 *   kasadaki nakit sayılır, fark kaydedilir.
 *
 * Tutarlar vergi dahil brüttür; vergi kapanışta folyonun motoruyla dökülür.
 */

/* ─────────────── Sabitler ─────────────── */

/** Prisma `PosStation` ile birebir: mutfak ekranı (modül 40) istasyona göre süzer. */
export const POS_STATIONS = Object.freeze(['HOT', 'COLD', 'BAR', 'PASTRY', 'NONE']);
export const POS_STATION_LABELS = Object.freeze({ HOT: 'Sıcak mutfak', COLD: 'Soğuk mutfak', BAR: 'Bar', PASTRY: 'Pastane', NONE: 'Mutfağa gitmez' });

/** Prisma `PosOutletKind` ile birebir: salon (masa planı) ya da oda servisi (teslim panosu, modül 41). */
export const POS_OUTLET_KINDS = Object.freeze(['DINING', 'ROOM_SERVICE']);
export const POS_OUTLET_KIND_LABELS = Object.freeze({ DINING: 'Salon (masa planı)', ROOM_SERVICE: 'Oda servisi' });

/** Oda servisi politikasının sınırları (veritabanı kuralıyla aynı; modül 41). */
export const ROOM_SERVICE_POLICY_LIMITS = Object.freeze({
  deliveryTargetMinutes: Object.freeze({ min: 5, max: 240 }),
  prepLeadMinutes: Object.freeze({ min: 5, max: 240 }),
  trayAlertMinutes: Object.freeze({ min: 15, max: 1440 }),
});

/** Prisma `PosCheckStatus` ile birebir. */
export const POS_CHECK_STATUSES = Object.freeze(['OPEN', 'CLOSED', 'VOID']);
export const POS_CHECK_STATUS_LABELS = Object.freeze({ OPEN: 'Açık', CLOSED: 'Kapandı', VOID: 'İptal (boş)' });

/** Masanın ekrandaki durumu (açık adisyonlardan türetilir). */
export const POS_TABLE_STATES = Object.freeze(['FREE', 'OCCUPIED', 'BILL']);
export const POS_TABLE_STATE_LABELS = Object.freeze({ FREE: 'Boş', OCCUPIED: 'Dolu', BILL: 'Hesap istiyor' });

/** Prisma `PosAdjustmentKind`: ikram (kalem bedava), iptal (kalem düşer), indirim (adisyona). */
export const POS_ADJUSTMENT_KINDS = Object.freeze(['COMP', 'VOID', 'DISCOUNT']);
export const POS_ADJUSTMENT_KIND_LABELS = Object.freeze({ COMP: 'İkram', VOID: 'İptal', DISCOUNT: 'İndirim' });
export const POS_ADJUSTMENT_STATUSES = Object.freeze(['APPLIED', 'PENDING', 'DECLINED']);
export const POS_ADJUSTMENT_STATUS_LABELS = Object.freeze({ APPLIED: 'Uygulandı', PENDING: 'Onay bekliyor', DECLINED: 'Reddedildi' });

/** POS'ta alınan para (odaya yaz ayrı kayıttır). */
export const POS_PAYMENT_METHODS = Object.freeze(['CASH', 'CARD']);

export const POS_SHIFT_STATUSES = Object.freeze(['OPEN', 'CLOSED']);
export const POS_SHIFT_STATUS_LABELS = Object.freeze({ OPEN: 'Açık', CLOSED: 'Kapandı' });

/* ─────────────── Sınırlar ─────────────── */

export const MAX_POS_OUTLETS = 30;
export const MAX_POS_TABLES_PER_OUTLET = 300;
export const MAX_MENU_CATEGORIES = 100;
export const MAX_MENU_ITEMS = 2000;
/** Bir sipariş turunda en fazla kalem (masa başı tek seferde). */
export const MAX_ORDER_LINES = 60;
/** Bir adisyonda en fazla kalem satırı (ziyafet masası bile bu kadar olmaz). */
export const MAX_CHECK_LINES = 400;
export const MAX_POS_LINE_QUANTITY = 99;
export const MAX_COVERS = 200;
export const MAX_POS_NAME_LENGTH = 80;
export const MAX_POS_NOTE_LENGTH = 200;
export const MIN_POS_REASON_LENGTH = 3;
export const MAX_POS_REASON_LENGTH = 300;
/** Kasa avansı / sayım üst sınırı (yazım hatası koruması). */
export const MAX_SHIFT_CASH = '10000000';

/* ─────────────── Saf yardımcılar ─────────────── */

/**
 * Tutarı N kişiye kuruş kuruş paylaştırır: fark ilk paylara eklenir, toplam birebir tutar
 * (hesap bölüşme önerisi; ödemeler yine tek tek alınır).
 *
 * @param {string} total "1250.10"
 * @param {number} parts 2–50
 * @returns {string[]}
 */
export function equalShares(total, parts) {
  const cents = Math.round(Number(total) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || !Number.isInteger(parts) || parts < 1) return [];
  const base = Math.floor(cents / parts);
  const remainder = cents - base * parts;
  return Array.from({ length: parts }, (_, index) => ((base + (index < remainder ? 1 : 0)) / 100).toFixed(2));
}

/**
 * Masanın durumu: açık adisyonu yoksa boş; adisyonlarından biri hesap istediyse "hesap
 * istiyor"; değilse dolu.
 * @param {Array<{ billRequestedAt: string | null }>} openChecks
 */
export function tableState(openChecks) {
  if (!openChecks.length) return 'FREE';
  return openChecks.some((check) => check.billRequestedAt) ? 'BILL' : 'OCCUPIED';
}

/* ─────────────── Şema parçaları ─────────────── */

const uuid = (message) => z.string().uuid({ message });

const nameField = (label, min = 1) =>
  z
    .string({ error: `${label} zorunlu` })
    .trim()
    .min(min, min > 1 ? `${label} en az ${min} karakter` : `${label} zorunlu`)
    .max(MAX_POS_NAME_LENGTH, `${label} en fazla ${MAX_POS_NAME_LENGTH} karakter`);

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

const reasonField = (label) =>
  z
    .string({ error: `${label} yazın` })
    .trim()
    .min(MIN_POS_REASON_LENGTH, `${label} en az ${MIN_POS_REASON_LENGTH} karakter`)
    .max(MAX_POS_REASON_LENGTH, `${label} en fazla ${MAX_POS_REASON_LENGTH} karakter`)
    .refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz' });

const percentField = (label) =>
  z
    .union([z.string(), z.number()], { error: `${label} zorunlu` })
    .transform((value) => String(value).trim().replace(',', '.'))
    .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), { message: `${label} geçersiz (en fazla 2 ondalık)` })
    .transform(normalizeDecimalString)
    .refine((value) => Number(value) > 0 && Number(value) <= 100, { message: `${label} 0'dan büyük, en fazla %100 olmalı` });

/** Sıfır olabilen para (kasa avansı, sayım). */
const cashField = (label) =>
  z
    .union([z.string(), z.number()], { error: `${label} zorunlu` })
    .transform((value, ctx) => {
      const text = String(value).trim().replace(',', '.');
      if (!text) {
        ctx.addIssue({ code: 'custom', message: `${label} zorunlu (yoksa 0 yazın)` });
        return z.NEVER;
      }
      if (!/^\d+(\.\d{1,2})?$/.test(text)) {
        ctx.addIssue({ code: 'custom', message: `${label} geçersiz (en fazla 2 ondalık)` });
        return z.NEVER;
      }
      const normalized = normalizeDecimalString(text);
      if (Number(normalized) > Number(MAX_SHIFT_CASH)) {
        ctx.addIssue({ code: 'custom', message: `${label} çok yüksek; yazım hatası olabilir` });
        return z.NEVER;
      }
      return normalized;
    });

const positiveMoney = (label) => moneyInputField.refine((value) => Number(value) > 0, { message: `${label} 0'dan büyük olmalı` });

/* ─────────────── Satış noktası, masa ─────────────── */

const outletShape = {
  code: z
    .string({ error: 'Kod zorunlu' })
    .trim()
    .toUpperCase()
    .min(1, 'Kod zorunlu')
    .max(20, 'Kod en fazla 20 karakter')
    .regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Kod yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir'),
  name: nameField('Ad', 2),
  /** İçerideki misafirin folyosuna yazılabilir mi ("odaya yaz"). */
  allowRoomCharge: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: intField('Sıra', 0, 999).default(0),
};
const outletKind = z.enum(POS_OUTLET_KINDS, { error: 'Satış noktası türünü seçin' });
export const createPosOutletSchema = z.object({ ...outletShape, kind: outletKind.default('DINING') });
/** Tür verilmezse değişmez (eski ekran türü bilmeden kaydederse oda servisi noktası salona dönmesin). */
export const updatePosOutletSchema = z.object({ expectedUpdatedAt, ...outletShape, kind: outletKind.optional() });
export const posOutletParamSchema = z.object({ outletId: uuid('Geçersiz satış noktası') });

const tableShape = {
  outletId: uuid('Satış noktası seçin'),
  name: nameField('Masa adı'),
  seats: intField('Kişi', 1, 50).default(4),
  /** Masa planında bölüm (iç salon, teras, bahçe). */
  zone: optionalText(40, 'Bölüm'),
  isActive: z.boolean().default(true),
  sortOrder: intField('Sıra', 0, 9999).default(0),
};
export const createPosTableSchema = z.object(tableShape);
export const updatePosTableSchema = z.object({ expectedUpdatedAt, ...tableShape });
export const posTableParamSchema = z.object({ tableId: uuid('Geçersiz masa') });

/** Toplu masa ekleme ("1–24", önek ile): planı kurmanın hızlı yolu. */
export const bulkPosTablesSchema = z
  .object({
    outletId: uuid('Satış noktası seçin'),
    prefix: z.string().trim().max(10, 'Önek en fazla 10 karakter').default(''),
    from: intField('Başlangıç', 1, 9999),
    to: intField('Bitiş', 1, 9999),
    seats: intField('Kişi', 1, 50).default(4),
    zone: optionalText(40, 'Bölüm'),
  })
  .refine((value) => value.to >= value.from, { path: ['to'], message: 'Bitiş başlangıçtan küçük olamaz' })
  .refine((value) => value.to - value.from < 200, { path: ['to'], message: 'Tek seferde en fazla 200 masa eklenir' });

/* ─────────────── Menü (modül 38'in menü kısmı) ─────────────── */

const categoryShape = {
  name: nameField('Grup adı', 2),
  sortOrder: intField('Sıra', 0, 999).default(0),
  isActive: z.boolean().default(true),
  /** Boş = bütün satış noktaları. */
  outletIds: z.array(uuid('Geçersiz satış noktası')).max(MAX_POS_OUTLETS).default([]),
};
export const createMenuCategorySchema = z.object(categoryShape);
export const updateMenuCategorySchema = z.object({ expectedUpdatedAt, ...categoryShape });
export const menuCategoryParamSchema = z.object({ categoryId: uuid('Geçersiz menü grubu') });

const menuItemShape = {
  categoryId: uuid('Menü grubu seçin'),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .max(20, 'Kod en fazla 20 karakter')
    .refine((value) => value === '' || /^[A-Z0-9][A-Z0-9._-]*$/.test(value), { message: 'Kod yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir' })
    .transform((value) => value || null)
    .nullish(),
  name: nameField('Ürün adı', 2),
  description: optionalText(300, 'Açıklama'),
  /** Vergi dahil satış fiyatı. */
  price: positiveMoney('Fiyat'),
  taxCategory: z.enum(TAX_APPLIES_TO, { error: 'Vergi kategorisi seçin' }).default('FNB'),
  station: z.enum(POS_STATIONS, { error: 'İstasyon seçin' }).default('HOT'),
  isActive: z.boolean().default(true),
  sortOrder: intField('Sıra', 0, 9999).default(0),
};
export const createMenuItemSchema = z.object(menuItemShape);
export const updateMenuItemSchema = z.object({ expectedUpdatedAt, ...menuItemShape });
export const menuItemParamSchema = z.object({ itemId: uuid('Geçersiz ürün') });
export const menuItemListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  categoryId: uuid('Geçersiz menü grubu').optional(),
  active: z.enum(['true', 'false']).optional(),
});
/** Servis sırasında "tükendi" anahtarı (şef garson). */
export const menuItemSoldOutSchema = z.object({ soldOut: z.boolean() });

/* ─────────────── Politika ─────────────── */

export const updatePosSettingsSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAt.nullish(),
  /** İkram / indirim / iptal bu tutar ve üstündeyse dört göz onaya gider (0: onay yok). */
  adjustmentApprovalAmount: cashField('Onay eşiği'),
  /** Vardiya kapanışında bu tutarı aşan nakit farkı yöneticiye uyarı düşürür. */
  cashVarianceAlert: cashField('Kasa farkı uyarısı'),
  /*
   * Oda servisi (modül 41); verilmeyen alan değişmez. Tepsi ücreti sipariş başına (0 = yok); teslim hedefi ve
   * ileri saatli siparişin mutfağa düşme payı dakika; tepsi uyarısı teslimden sonra dakika.
   */
  trayCharge: cashField('Tepsi ücreti').optional(),
  deliveryTargetMinutes: intField('Teslim hedefi', ROOM_SERVICE_POLICY_LIMITS.deliveryTargetMinutes.min, ROOM_SERVICE_POLICY_LIMITS.deliveryTargetMinutes.max).optional(),
  prepLeadMinutes: intField('Hazırlık payı', ROOM_SERVICE_POLICY_LIMITS.prepLeadMinutes.min, ROOM_SERVICE_POLICY_LIMITS.prepLeadMinutes.max).optional(),
  trayAlertMinutes: intField('Tepsi uyarısı', ROOM_SERVICE_POLICY_LIMITS.trayAlertMinutes.min, ROOM_SERVICE_POLICY_LIMITS.trayAlertMinutes.max).optional(),
  guestOrderingEnabled: z.boolean().optional(),
});

/* ─────────────── Vardiya ─────────────── */

export const openPosShiftSchema = z.object({
  /** Kasa avansı (bozuk para): beklenen nakdin başlangıcı. */
  openingFloat: cashField('Kasa avansı'),
  outletId: uuid('Geçersiz satış noktası').nullish(),
});
export const closePosShiftSchema = z.object({
  expectedUpdatedAt,
  countedCash: cashField('Sayılan nakit'),
  note: optionalText(MAX_POS_NOTE_LENGTH, 'Not'),
});
export const posShiftParamSchema = z.object({ shiftId: uuid('Geçersiz vardiya') });
export const posShiftListQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(POS_SHIFT_STATUSES, { error: 'Geçersiz durum' }).optional(),
    waiterEmail: z.string().trim().toLowerCase().max(200).optional(),
    from: dateField.optional(),
    to: dateField.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.to < value.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
  });

/* ─────────────── Adisyon ─────────────── */

export const openPosCheckSchema = z.object({
  /** Çift dokunuşta ikinci adisyon açılmasın. */
  requestId: uuid('Geçersiz istek'),
  outletId: uuid('Satış noktası seçin'),
  /** Masasız (bar tezgâhı, paket) adisyonda boş. */
  tableId: uuid('Geçersiz masa').nullish(),
  covers: intField('Kişi', 1, MAX_COVERS).default(1),
  note: optionalText(MAX_POS_NOTE_LENGTH, 'Not'),
});
export const posCheckParamSchema = z.object({ checkId: uuid('Geçersiz adisyon') });
export const updatePosCheckSchema = z.object({
  expectedUpdatedAt,
  covers: intField('Kişi', 1, MAX_COVERS),
  note: optionalText(MAX_POS_NOTE_LENGTH, 'Not'),
});
export const posCheckVersionSchema = z.object({ expectedUpdatedAt });
export const posCheckListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(POS_CHECK_STATUSES, { error: 'Geçersiz durum' }).optional(),
  outletId: uuid('Geçersiz satış noktası').optional(),
  waiterEmail: z.string().trim().toLowerCase().max(200).optional(),
  search: z.string().trim().max(60).optional(),
  from: dateField.optional(),
  to: dateField.optional(),
});
export const posFloorQuerySchema = z.object({ outletId: uuid('Satış noktası seçin') });

/** Satış raporunda en fazla gün (ay sonu raporu sığar; daha uzunu genel raporlarda). */
export const MAX_POS_REPORT_DAYS = 31;
const isoDay = (label) =>
  z
    .string({ error: `${label} seçin` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} YYYY-AA-GG biçiminde olmalı`)
    // Gidiş-dönüş: "2026-02-31" Date'te 3 Mart'a kayar; takvimde olmayan gün reddedilir.
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }, { message: `${label} geçersiz` });
/**
 * Satış raporu: iş günü aralığı (iki uç dahil; ikisi birlikte verilir, verilmezse otelin iş
 * günü) ve isteğe bağlı satış noktası.
 */
export const posSalesQuerySchema = z
  .object({ from: isoDay('Başlangıç').optional(), to: isoDay('Bitiş').optional(), outletId: uuid('Geçersiz satış noktası').optional() })
  .superRefine((value, ctx) => {
    if (!value.from !== !value.to) {
      ctx.addIssue({ code: 'custom', path: [value.from ? 'to' : 'from'], message: 'Başlangıç ve bitişi birlikte seçin' });
      return;
    }
    if (!value.from) return;
    const days = (Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86_400_000 + 1;
    if (days < 1) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
    else if (days > MAX_POS_REPORT_DAYS) ctx.addIssue({ code: 'custom', path: ['to'], message: `Bir raporda en fazla ${MAX_POS_REPORT_DAYS} gün seçilir` });
  });

const orderLine = z.object({
  menuItemId: uuid('Ürün seçin'),
  quantity: intField('Adet', 1, MAX_POS_LINE_QUANTITY),
  note: optionalText(MAX_POS_NOTE_LENGTH, 'Not'),
});
/** Sipariş turu ("Gönder"): istek kimliği tekrar gönderimde ikinci tur açmaz. */
export const sendPosOrderSchema = z.object({
  requestId: uuid('Geçersiz istek'),
  lines: z.array(orderLine, { error: 'Kalemler geçersiz' }).min(1, 'En az bir kalem seçin').max(MAX_ORDER_LINES, `Bir turda en fazla ${MAX_ORDER_LINES} kalem`),
});

export const requestPosBillSchema = z.object({ requested: z.boolean() });

/** İkram / iptal (kalemin bir kısmı da olabilir) ya da adisyona indirim. */
export const posAdjustmentSchema = z
  .object({
    kind: z.enum(POS_ADJUSTMENT_KINDS, { error: 'İşlem seçin' }),
    lineId: uuid('Kalem seçin').nullish(),
    quantity: intField('Adet', 1, MAX_POS_LINE_QUANTITY).nullish(),
    /** İptalde: hazırlanmış (zayi) mı. */
    waste: z.boolean().default(false),
    discountPct: percentField('İndirim').nullish(),
    discountAmount: positiveMoney('İndirim').nullish(),
    reason: reasonField('Gerekçe'),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'DISCOUNT') {
      if (!value.discountPct === !value.discountAmount) ctx.addIssue({ code: 'custom', path: ['discountPct'], message: 'Yüzde ya da tutar girin (yalnızca biri)' });
      if (value.lineId) ctx.addIssue({ code: 'custom', path: ['lineId'], message: 'İndirim adisyona uygulanır' });
    } else {
      if (!value.lineId) ctx.addIssue({ code: 'custom', path: ['lineId'], message: 'Kalem seçin' });
      if (!value.quantity) ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Adet girin' });
      if (value.discountPct || value.discountAmount) ctx.addIssue({ code: 'custom', path: ['discountPct'], message: 'İndirim yalnızca adisyona' });
    }
    if (value.kind !== 'VOID' && value.waste) ctx.addIssue({ code: 'custom', path: ['waste'], message: 'Zayi yalnızca iptalde' });
  });
export const posAdjustmentParamSchema = z.object({ checkId: uuid('Geçersiz adisyon'), adjustmentId: uuid('Geçersiz düzeltme') });
/** Onay ekranından düzeltmenin adisyonuna geçiş. */
export const posAdjustmentRefParamSchema = z.object({ adjustmentId: uuid('Geçersiz düzeltme') });

const referenceField = z
  .string()
  .trim()
  .max(PAYMENT_REFERENCE_MAX, `Referans en fazla ${PAYMENT_REFERENCE_MAX} karakter`)
  .refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz; slip ya da provizyon numarasını yazın' })
  .transform((value) => value || null)
  .nullish();

export const posPaymentSchema = z
  .object({
    requestId: uuid('Geçersiz istek'),
    method: z.enum(POS_PAYMENT_METHODS, { error: 'Ödeme yöntemi seçin' }),
    amount: positiveMoney('Tutar'),
    reference: referenceField,
  })
  .superRefine((value, ctx) => {
    if (value.method === 'CARD' && !value.reference) ctx.addIssue({ code: 'custom', path: ['reference'], message: `${PAYMENT_REFERENCE_LABELS.CARD} zorunlu` });
  });
export const posPaymentParamSchema = z.object({ checkId: uuid('Geçersiz adisyon'), paymentId: uuid('Geçersiz ödeme') });
/** Onay ekranından ödemenin adisyonuna geçiş. */
export const posPaymentRefParamSchema = z.object({ paymentId: uuid('Geçersiz ödeme') });
export const voidPosPaymentSchema = z.object({ reason: reasonField('Gerekçe') });

export const posRoomChargeSchema = z.object({
  requestId: uuid('Geçersiz istek'),
  reservationId: uuid('Oda / misafir seçin'),
  amount: positiveMoney('Tutar'),
});
export const posInHouseQuerySchema = z.object({ search: z.string().trim().min(1, 'Oda numarası ya da soyadı yazın').max(40) });

/** Adisyonu bölme: seçilen kalemler (adetleriyle) yeni adisyona. */
export const splitPosCheckSchema = z.object({
  expectedUpdatedAt,
  lines: z
    .array(z.object({ lineId: uuid('Geçersiz kalem'), quantity: intField('Adet', 1, MAX_POS_LINE_QUANTITY) }))
    .min(1, 'Taşınacak kalem seçin')
    .max(MAX_CHECK_LINES)
    .refine((rows) => new Set(rows.map((row) => row.lineId)).size === rows.length, { message: 'Aynı kalem iki kez seçilmiş' }),
});
export const movePosCheckSchema = z.object({ expectedUpdatedAt, tableId: uuid('Masa seçin').nullable() });
export const mergePosCheckSchema = z.object({ expectedUpdatedAt, sourceCheckId: uuid('Birleştirilecek adisyonu seçin') });
export const transferPosCheckSchema = z.object({ expectedUpdatedAt, waiterEmail: z.string().trim().toLowerCase().email('Garson seçin') });
export const reopenPosCheckSchema = z.object({ reason: reasonField('Gerekçe') });
