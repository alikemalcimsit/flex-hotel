import { expectedUpdatedAt, paginationQuerySchema } from './fields.js';
import { z } from './locale.js';

/**
 * Sanal POS / ödeme geçidi sözleşmeleri (modül 50).
 *
 * Kararlar:
 * - **Barındırılan ödeme sayfası:** misafir kartını sağlayıcının (iyzico Checkout Form) sayfasında girer; kart bilgisi otelin
 *   sunucusuna hiç gelmez, 3D Secure sağlayıcıda. Sunucu sonucu sağlayıcıdan **kendisi sorar** (geri dönüşteki token ile), tutarı ve
 *   konuşma kimliğini karşılaştırır; tarayıcının söylediğine güvenmez.
 * - **Ödeme linki:** konaklamaya bağlı, tutarı ve süresi belli, tek kez ödenir (başarısız denemeden sonra yeniden denenir).
 *   Ödenince folyoya `VIRTUAL_POS` ödemesi olarak düşer; para bankada olduğundan büyük ödeme onayına gitmez.
 * - **İade** dört gözle: istek onaya gider, onaylanınca sağlayıcıdan iade edilir ve folyoya eksi ödeme yazılır.
 * - **Sağlayıcılar:** Test ortamı (dışarı çıkmaz, kendi taklit sayfası) ve iyzico (sandbox / canlı). Canlı ortam otelin iyzico üye iş
 *   yeri anahtarlarıyla çalışır.
 */

export const PAYMENT_GATEWAY_PROVIDERS = Object.freeze(['TEST', 'IYZICO']);
export const PAYMENT_GATEWAY_PROVIDER_LABELS = Object.freeze({ TEST: 'Test ortamı (dışarı çıkmaz)', IYZICO: 'iyzico' });
export const PAYMENT_GATEWAY_ENVIRONMENTS = Object.freeze(['SANDBOX', 'LIVE']);
export const PAYMENT_GATEWAY_ENVIRONMENT_LABELS = Object.freeze({ SANDBOX: 'Deneme (sandbox)', LIVE: 'Canlı' });
export const PAYMENT_GATEWAY_TEST_BEHAVIORS = Object.freeze(['APPROVE', 'DECLINE']);
export const PAYMENT_GATEWAY_TEST_BEHAVIOR_LABELS = Object.freeze({ APPROVE: 'Onaylar', DECLINE: 'Reddeder (kart reddedildi)' });

export const WIDGET_PREPAYMENTS = Object.freeze(['NONE', 'FIRST_NIGHT', 'FULL']);
export const WIDGET_PREPAYMENT_LABELS = Object.freeze({ NONE: 'Ön ödeme yok', FIRST_NIGHT: 'İlk gece', FULL: 'Konaklamanın tamamı' });

export const PAYMENT_LINK_PURPOSES = Object.freeze(['PREPAYMENT', 'BALANCE', 'OTHER']);
export const PAYMENT_LINK_PURPOSE_LABELS = Object.freeze({ PREPAYMENT: 'Ön ödeme', BALANCE: 'Bakiye', OTHER: 'Diğer' });
export const PAYMENT_LINK_ORIGINS = Object.freeze(['STAFF', 'PORTAL', 'WIDGET']);
export const PAYMENT_LINK_ORIGIN_LABELS = Object.freeze({ STAFF: 'Personel', PORTAL: 'Misafir portalı', WIDGET: 'Rezervasyon widget\'ı' });

export const PAYMENT_LINK_STATUSES = Object.freeze(['OPEN', 'PROCESSING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED']);
export const PAYMENT_LINK_STATUS_LABELS = Object.freeze({
  OPEN: 'Ödeme bekliyor',
  PROCESSING: 'Ödeme sürüyor',
  PAID: 'Ödendi',
  FAILED: 'Başarısız',
  EXPIRED: 'Süresi doldu',
  CANCELLED: 'İptal edildi',
});
/** Misafirin ödemeye başlayabileceği durumlar (başarısız deneme sonrası link yine açıktır). */
export const PAYMENT_LINK_PAYABLE_STATUSES = Object.freeze(['OPEN']);

export const GATEWAY_REFUND_STATUSES = Object.freeze(['PENDING_APPROVAL', 'PROCESSING', 'DONE', 'FAILED', 'REJECTED']);
export const GATEWAY_REFUND_STATUS_LABELS = Object.freeze({
  PENDING_APPROVAL: 'Onay bekliyor',
  PROCESSING: 'İade ediliyor',
  DONE: 'İade edildi',
  FAILED: 'İade başarısız',
  REJECTED: 'Reddedildi',
});

export const PAYMENT_LINK_EVENT_KINDS = Object.freeze(['CREATED', 'SENT', 'STARTED', 'SESSION', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUND_REQUESTED', 'REFUNDED', 'REFUND_FAILED', 'REFUND_REJECTED']);

export const DEFAULT_PAYMENT_LINK_TTL_HOURS = 72;
export const MAX_PAYMENT_LINK_TTL_HOURS = 24 * 30;
export const MAX_GATEWAY_INSTALLMENT = 12;
/** "Ödeme sürüyor"da bu kadar kalan link sağlayıcıdan sorularak sonuçlandırılır (geri dönüş kaybolduysa). */
export const PAYMENT_LINK_STALE_PROCESSING_MS = 10 * 60_000;
export const PAYMENT_LINK_CODE_LENGTH = 32;
/** Misafir uygulamasında ödeme sayfasının yolu (portal adresinin altında). */
export const PAYMENT_LINK_PATH = '/misafir/o';

const money = (label) =>
  z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim().replace(',', '.'))
    .refine((value) => /^\d{1,9}(\.\d{1,2})?$/.test(value), { message: `${label} "1250.00" biçiminde olmalı` })
    .refine((value) => Number(value) > 0, { message: `${label} sıfırdan büyük olmalı` });

const urlField = z
  .string()
  .trim()
  .max(300)
  .refine((value) => /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(value) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s]*)?$/.test(value), { message: 'https:// ile başlayan bir adres yazın' })
  .transform((value) => value.replace(/\/+$/, ''));

/**
 * Ayar. Anahtarlar yalnız yazılır: `apiKey` / `secretKey` boş bırakılırsa kayıtlı olan kalır, `clearCredentials` siler.
 * iyzico açıkken anahtarlar ve geri dönüş adresi zorunlu.
 */
export const paymentGatewaySettingsSchema = z
  .object({
    expectedUpdatedAt: z.union([expectedUpdatedAt, z.null()]).default(null),
    isEnabled: z.boolean(),
    provider: z.enum(PAYMENT_GATEWAY_PROVIDERS, { error: 'Sağlayıcı seçin' }),
    environment: z.enum(PAYMENT_GATEWAY_ENVIRONMENTS).default('SANDBOX'),
    apiKey: z.string().trim().max(200).nullish(),
    secretKey: z.string().trim().max(200).nullish(),
    clearCredentials: z.boolean().default(false),
    apiPublicUrl: urlField.nullish(),
    linkTtlHours: z.number().int().min(1, 'En az 1 saat').max(MAX_PAYMENT_LINK_TTL_HOURS, `En çok ${MAX_PAYMENT_LINK_TTL_HOURS} saat`).default(DEFAULT_PAYMENT_LINK_TTL_HOURS),
    maxInstallment: z.number().int().min(1).max(MAX_GATEWAY_INSTALLMENT).default(1),
    allowPortalPayment: z.boolean().default(true),
    widgetPrepayment: z.enum(WIDGET_PREPAYMENTS).default('NONE'),
    testBehavior: z.enum(PAYMENT_GATEWAY_TEST_BEHAVIORS).default('APPROVE'),
  })
  .superRefine((value, ctx) => {
    if (!value.isEnabled) return;
    if (!value.apiPublicUrl) ctx.addIssue({ code: 'custom', path: ['apiPublicUrl'], message: 'Sunucunun dış adresini yazın (ör. https://otel.example.com/api); ödeme sonucu buraya döner' });
  });

export const paymentLinkCreateSchema = z.object({
  requestId: z.string().uuid({ message: 'Geçersiz istek kimliği' }),
  amount: money('Tutar'),
  purpose: z.enum(PAYMENT_LINK_PURPOSES).default('BALANCE'),
  description: z.string().trim().max(200, 'En fazla 200 karakter').transform((value) => value || null).nullish(),
  folioId: z.string().uuid({ message: 'Geçersiz folyo' }).nullish(),
  ttlHours: z.number().int().min(1).max(MAX_PAYMENT_LINK_TTL_HOURS).nullish(),
});

export const paymentLinkListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(PAYMENT_LINK_STATUSES).optional(),
  reservationId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().trim().max(100).optional(),
});

export const paymentLinkParamsSchema = z.object({ linkId: z.string().uuid({ message: 'Geçersiz link' }) });
export const paymentLinkReservationParamsSchema = z.object({ reservationId: z.string().uuid({ message: 'Geçersiz rezervasyon' }) });
export const paymentLinkCodeParamsSchema = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/, 'Geçersiz bağlantı') });

export const gatewayRefundSchema = z.object({
  requestId: z.string().uuid({ message: 'Geçersiz istek kimliği' }),
  amount: money('İade tutarı'),
  reason: z.string({ error: 'Gerekçe yazın' }).trim().min(3, 'Gerekçe yazın').max(300),
});

/**
 * Bir linkten en çok iade edilebilecek (ödenen − iade edilen − onayda bekleyen).
 * @param {{ paidAmount: string | null, refundedAmount: string, pendingRefunds: string }} link
 */
export function refundableOnLink(link) {
  const cents = (value) => Math.round(Number(value ?? 0) * 100);
  const left = cents(link.paidAmount) - cents(link.refundedAmount) - cents(link.pendingRefunds);
  return (Math.max(0, left) / 100).toFixed(2);
}

/**
 * Widget ön ödemesi: ilk gece ya da tamamı (gecelerin toplamı). Yoksa null.
 * @param {'NONE' | 'FIRST_NIGHT' | 'FULL'} mode @param {{ nights: Array<{ amount: string }>, total: string }} stay
 */
export function widgetPrepaymentAmount(mode, stay) {
  if (mode === 'NONE') return null;
  const amount = mode === 'FIRST_NIGHT' ? stay.nights[0]?.amount : stay.total;
  return amount && Number(amount) > 0 ? Number(amount).toFixed(2) : null;
}
