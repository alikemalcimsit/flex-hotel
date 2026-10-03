import { normalizeDecimalString } from './decimal.js';
import { queryBoolean } from './fields.js';
import { PAYMENT_METHODS } from './folios.js';
import { looksLikeCardNumber } from './front-desk.js';
import { z } from './locale.js';

/**
 * Ödeme sözleşmeleri (modül 17).
 *
 * Ödeme folyoya yazılır ve bakiyeyi düşürür: bakiye = Σ kalem − Σ ödeme
 * (folyo para biriminde). Kurallar:
 *
 * - **Ödeme silinmez.** Hatalı giriş "ödeme iptali" ile düzeltilir: eksi
 *   tutarlı bir iptal kaydı işlenir (ikinci bir yetkilinin onayıyla). Misafire
 *   geri verilen para **iade**dir (eksi tutarlı satır, her zaman onaylı).
 * - **Büyük ödeme bekler:** folyo para birimindeki karşılığı otelin eşiğine
 *   (ayarlar) eşit ya da büyükse ödeme "onay bekliyor" olarak kaydedilir;
 *   bakiyeye ve kasaya ikinci bir yetkili onaylayınca girer. Reddedilirse hiç
 *   işlenmez.
 * - **Dört göz:** büyük ödemeyi, iadeyi ve ödeme iptalini isteyen kişi kendi
 *   isteğini onaylayamaz (bkz. `approvals.js`).
 * - **Döviz:** kur ödeme formunda yazılmaz; günün kur tablosundan gelir
 *   (1 birim döviz = kur × otel para birimi). Form gördüğü kuru gönderir;
 *   bu arada kur değiştiyse sunucu yazmaz, yeni kuru gösterir.
 * - **Kart numarası hiçbir alana yazılmaz** (PCI DSS): referansta kart
 *   numarasına benzeyen dizi reddedilir; slip / provizyon numarası yazılır.
 */

/* ─────────────── Türler, durumlar, kaynaklar ─────────────── */

/** Prisma `PaymentKind` ile birebir. */
export const PAYMENT_KINDS = Object.freeze(['PAYMENT', 'REFUND', 'REVERSAL']);

export const PAYMENT_KIND_LABELS = Object.freeze({
  PAYMENT: 'Tahsilat',
  REFUND: 'İade',
  REVERSAL: 'İptal kaydı',
});

/** Prisma `PaymentStatus` ile birebir. */
export const PAYMENT_STATUSES = Object.freeze(['PENDING', 'POSTED', 'DECLINED']);

export const PAYMENT_STATUS_LABELS = Object.freeze({
  PENDING: 'Onay bekliyor',
  POSTED: 'İşlendi',
  DECLINED: 'Reddedildi',
});

/**
 * Prisma `PaymentSource` ile birebir: ödeme nereden geldi. Sunucu belirler —
 * gelmeden önce alınan ön ödeme, girişte alınan teminat, resepsiyon tahsilatı.
 */
export const PAYMENT_SOURCES = Object.freeze(['DESK', 'ADVANCE', 'CHECK_IN_DEPOSIT']);

export const PAYMENT_SOURCE_LABELS = Object.freeze({
  DESK: 'Resepsiyon',
  ADVANCE: 'Ön ödeme',
  CHECK_IN_DEPOSIT: 'Giriş teminatı',
});

/** İade yapılabilen yöntemler: voucher geri ödenmez. */
export const REFUND_METHODS = Object.freeze(PAYMENT_METHODS.filter((method) => method !== 'VOUCHER'));

/** Döviz kabul eden yöntemler: nakit döviz ve döviz havalesi (kart otelin parasıyla çekilir). */
export const FOREIGN_CURRENCY_METHODS = Object.freeze(['CASH', 'TRANSFER']);

/** Referansı zorunlu yöntemler (mutabakat için: slip, dekont, voucher, cari no). Nakit hariç hepsi. */
export const PAYMENT_REFERENCE_REQUIRED_METHODS = Object.freeze(PAYMENT_METHODS.filter((method) => method !== 'CASH'));

/** Yönteme göre referans alanının etiketi. */
export const PAYMENT_REFERENCE_LABELS = Object.freeze({
  CASH: 'Makbuz no (isteğe bağlı)',
  CARD: 'Slip / provizyon no',
  TRANSFER: 'Dekont no',
  VIRTUAL_POS: 'İşlem no',
  AGENCY: 'Acente / cari hesap',
  VOUCHER: 'Voucher no',
});

/* ─────────────── Sınırlar ─────────────── */

/** Tek ödemenin en büyük tutarı (yazım hatasını yakalamak için). */
export const PAYMENT_MAX_AMOUNT = '50000000';
export const PAYMENT_REFERENCE_MAX = 60;
export const PAYMENT_NOTE_MAX = 200;
export const PAYMENT_REASON_MIN = 3;
export const PAYMENT_REASON_MAX = 500;
/** Folyonun ödeme listesi sayfası. */
export const PAYMENTS_PAGE_SIZE = 50;
/** Kasa hareketleri sayfası. */
export const CASH_PAGE_SIZE = 50;
export const CASH_MAX_PAGE_SIZE = 200;

/** Kur: 1 birim döviz kaç birim otel parası (en fazla 6 ondalık). */
export const EXCHANGE_RATE_SCALE = 6;
export const EXCHANGE_RATE_MAX = '1000000';
/** Bir seferde girilebilen en fazla döviz. */
export const EXCHANGE_RATE_MAX_CURRENCIES = 20;
/**
 * Kur bu kadar günden eskiyse döviz ödemesi alınmaz: önce günün kuru girilmeli.
 * Hafta sonu / bayram kuru değişmeyen günler için birkaç gün tolerans.
 */
export const EXCHANGE_RATE_STALE_DAYS = 3;
export const EXCHANGE_RATE_HISTORY_PAGE_SIZE = 30;

/* ─────────────── Alanlar ─────────────── */

const uuid = (message) => z.string().uuid({ message });

/** ISO 4217 para birimi kodu ("EUR"). */
export const currencyField = z
  .string({ error: 'Para birimi zorunlu' })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Para birimi 3 harfli kod olmalı (ör. EUR)');

/**
 * Ödeme tutarı: sıfırdan büyük, en fazla iki ondalıklı metin; ondalık ayırıcı
 * nokta ya da virgül. İade de pozitif girilir, sunucu eksiye çevirir.
 */
export const paymentAmountField = z
  .union([z.string(), z.number()], { error: 'Tutar zorunlu' })
  .transform((value, ctx) => {
    const text = String(value).trim().replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
      ctx.addIssue({ code: 'custom', message: 'Tutar geçersiz (ör. 2500 ya da 2500,50; en fazla 2 ondalık)' });
      return z.NEVER;
    }
    const normalized = normalizeDecimalString(text);
    if (Number(normalized) <= 0) {
      ctx.addIssue({ code: 'custom', message: 'Tutar sıfırdan büyük olmalı' });
      return z.NEVER;
    }
    if (Number(normalized) > Number(PAYMENT_MAX_AMOUNT)) {
      ctx.addIssue({ code: 'custom', message: 'Tutar çok yüksek; yazım hatası olabilir' });
      return z.NEVER;
    }
    return normalized;
  });

/** Kur: sıfırdan büyük, en fazla 6 ondalık. */
export const exchangeRateField = z
  .union([z.string(), z.number()], { error: 'Kur zorunlu' })
  .transform((value, ctx) => {
    const text = String(value).trim().replace(',', '.');
    if (!new RegExp(`^\\d+(\\.\\d{1,${EXCHANGE_RATE_SCALE}})?$`).test(text)) {
      ctx.addIssue({ code: 'custom', message: `Kur geçersiz (ör. 36,1250; en fazla ${EXCHANGE_RATE_SCALE} ondalık)` });
      return z.NEVER;
    }
    const normalized = normalizeDecimalString(text);
    if (Number(normalized) <= 0) {
      ctx.addIssue({ code: 'custom', message: 'Kur sıfırdan büyük olmalı' });
      return z.NEVER;
    }
    if (Number(normalized) > Number(EXCHANGE_RATE_MAX)) {
      ctx.addIssue({ code: 'custom', message: 'Kur çok yüksek; yazım hatası olabilir' });
      return z.NEVER;
    }
    return normalized;
  });

const referenceField = z
  .string()
  .trim()
  .max(PAYMENT_REFERENCE_MAX, `Referans en fazla ${PAYMENT_REFERENCE_MAX} karakter`)
  .refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz; slip ya da provizyon numarasını yazın' })
  .transform((value) => value || null)
  .nullish();

const noteField = z
  .string()
  .trim()
  .max(PAYMENT_NOTE_MAX, `Not en fazla ${PAYMENT_NOTE_MAX} karakter`)
  .refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz' })
  .transform((value) => value || null)
  .nullish();

const reasonField = z
  .string({ error: 'Gerekçe zorunlu' })
  .trim()
  .min(PAYMENT_REASON_MIN, `Gerekçe en az ${PAYMENT_REASON_MIN} karakter olmalı`)
  .max(PAYMENT_REASON_MAX, `Gerekçe en fazla ${PAYMENT_REASON_MAX} karakter olabilir`)
  .refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz' });

/**
 * Formun gördüğü kur (döviz ödemesinde). Sunucu kendi kuruyla karşılaştırır;
 * farklıysa yazmaz (kur bu arada güncellendi).
 */
const expectedRateField = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => /^\d+(\.\d+)?$/.test(value), { message: 'Kur geçersiz' })
  .nullish();

/**
 * Yöntemin referansı zorunluysa yazılmış olmalı. (Dövizin yönteme uygunluğu
 * folyonun para birimini bilmeyi gerektirir: `paymentCurrencyError`.)
 * @param {{ method: string, reference?: string | null }} value
 * @param {import('zod').RefinementCtx} ctx
 */
function refineMethod(value, ctx) {
  if (PAYMENT_REFERENCE_REQUIRED_METHODS.includes(value.method) && !value.reference) {
    ctx.addIssue({ code: 'custom', path: ['reference'], message: `${PAYMENT_REFERENCE_LABELS[value.method]} zorunlu` });
  }
}

const moneyFields = {
  method: z.enum(PAYMENT_METHODS, { error: 'Ödeme yöntemi seçin' }),
  amount: paymentAmountField,
  /** Boşsa folyonun para birimi. */
  currency: currencyField.nullish(),
  expectedRate: expectedRateField,
  reference: referenceField,
};

/* ─────────────── Şemalar ─────────────── */

/** Ödeme al (folyoya). `requestId` çift gönderimde ikinci ödemeyi engeller. */
export const receivePaymentSchema = z
  .object({
    requestId: uuid('Geçersiz istek kimliği'),
    ...moneyFields,
    note: noteField,
  })
  .superRefine(refineMethod);

/**
 * Konaklamaya ödeme (ön ödeme / depozito): folyo verilmezse konaklamanın ilk
 * açık folyosu; hiç folyosu yoksa açılır.
 */
export const stayPaymentSchema = z
  .object({
    requestId: uuid('Geçersiz istek kimliği'),
    folioId: uuid('Geçersiz folyo').nullish(),
    ...moneyFields,
    note: noteField,
  })
  .superRefine(refineMethod);

/** İade isteği (her zaman onaya gider). */
export const refundRequestSchema = z
  .object({
    requestId: uuid('Geçersiz istek kimliği'),
    ...moneyFields,
    method: z.enum(REFUND_METHODS, { error: 'İade yöntemi seçin' }),
    reason: reasonField,
  })
  .superRefine(refineMethod);

/** Ödeme iptali isteği (hatalı giriş; onaya gider). */
export const paymentVoidSchema = z.object({ reason: reasonField });

/** Formdaki canlı çeviri ve onay önizlemesi. */
export const paymentQuoteSchema = z.object({
  amount: paymentAmountField,
  currency: currencyField.nullish(),
  kind: z.enum(['PAYMENT', 'REFUND'], { error: 'Geçersiz tür' }).default('PAYMENT'),
});

/** Günün kurları (yalnızca iş günü için girilir; aynı gün yeniden girilirse güncellenir). */
export const exchangeRatesInputSchema = z.object({
  rates: z
    .array(z.object({ currency: currencyField, rate: exchangeRateField }), { error: 'Kur listesi zorunlu' })
    .min(1, 'En az bir kur girin')
    .max(EXCHANGE_RATE_MAX_CURRENCIES, `Tek seferde en fazla ${EXCHANGE_RATE_MAX_CURRENCIES} döviz`)
    .refine((rates) => new Set(rates.map((rate) => rate.currency)).size === rates.length, {
      message: 'Aynı döviz iki kez girilmiş',
    }),
});

export const exchangeRateHistoryQuerySchema = z.object({
  currency: currencyField.optional(),
  cursor: z.string().trim().max(200).optional(),
  limit: z.coerce
    .number({ error: 'Sayfa boyutu sayı olmalı' })
    .int()
    .min(1)
    .max(100, 'Sayfa boyutu en fazla 100 olabilir')
    .default(EXCHANGE_RATE_HISTORY_PAGE_SIZE),
});

const isoDayField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-AA-GG biçiminde olmalı');

/** Kasa görünümü: günün toplamları (gün verilmezse iş günü). */
export const cashSummaryQuerySchema = z.object({
  date: isoDayField.optional(),
  /** Yalnızca oturumdaki kişinin aldıkları ("benim kasam"). */
  mine: queryBoolean.default(false),
});

/** Kasa hareketleri: günün işlenen ödemeleri (son işlenen önce), imleçli. */
export const cashMovementsQuerySchema = cashSummaryQuerySchema.extend({
  method: z.enum(PAYMENT_METHODS, { error: 'Geçersiz yöntem' }).optional(),
  kind: z.enum(PAYMENT_KINDS, { error: 'Geçersiz tür' }).optional(),
  cursor: z.string().trim().max(200).optional(),
  limit: z.coerce
    .number({ error: 'Sayfa boyutu sayı olmalı' })
    .int()
    .min(1)
    .max(CASH_MAX_PAGE_SIZE, `Sayfa boyutu en fazla ${CASH_MAX_PAGE_SIZE} olabilir`)
    .default(CASH_PAGE_SIZE),
});

export const folioPaymentsQuerySchema = z.object({
  cursor: z.string().trim().max(200).optional(),
  limit: z.coerce
    .number({ error: 'Sayfa boyutu sayı olmalı' })
    .int()
    .min(1)
    .max(200, 'Sayfa boyutu en fazla 200 olabilir')
    .default(PAYMENTS_PAGE_SIZE),
});

export const paymentParamSchema = z.object({ paymentId: uuid('Geçersiz ödeme') });

/* ─────────────── Kurallar (ekran ve sunucu aynı cevabı versin) ─────────────── */

/**
 * Bu ödeme satırı iptal edilebilir mi (hatalı giriş)? Edilemiyorsa sebep.
 * @param {{ kind: string, status: string, voidedAt?: unknown, voidPending?: boolean }} payment
 * @returns {string | null}
 */
export function paymentVoidError(payment) {
  if (payment.kind === 'REVERSAL') return 'İptal kaydı iptal edilemez';
  if (payment.status === 'PENDING') return 'Onay bekleyen ödeme iptal edilmez; onay kuyruğunda reddedin';
  if (payment.status === 'DECLINED') return 'Reddedilmiş ödeme işlenmedi; iptale gerek yok';
  if (payment.voidedAt) return 'Ödeme zaten iptal edilmiş';
  if (payment.voidPending) return 'Bu ödeme için iptal onayı zaten bekliyor';
  return null;
}

/**
 * Döviz bu yöntemle alınabilir mi?
 * @param {string} method
 * @param {string} currency ödemenin para birimi
 * @param {string} folioCurrency
 * @returns {string | null}
 */
export function paymentCurrencyError(method, currency, folioCurrency) {
  if (!currency || currency === folioCurrency) return null;
  if (!FOREIGN_CURRENCY_METHODS.includes(method)) return `${currency} yalnızca nakit ya da havaleyle alınır; kart ${folioCurrency} çekilir`;
  return null;
}
