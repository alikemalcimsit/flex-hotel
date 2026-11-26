import { PAYMENT_GATEWAY_ENVIRONMENT_LABELS, PAYMENT_GATEWAY_PROVIDER_LABELS, PAYMENT_LINK_ORIGIN_LABELS, refundableOnLink } from '@hotelos/hotel-contracts';

/**
 * Sanal POS (modül 50) saf yardımcıları: link / iade durum rozet tonu, kart metni, kaynak etiketi, iade edilebilir tutar,
 * çalışma kipi şeridi. Sorgu / canlı kanal içermez; node testiyle denenir (`paymentGatewayFormat.test.js`).
 */

const LINK_STATUS_TONES = Object.freeze({
  OPEN: 'info',
  PROCESSING: 'sky',
  PAID: 'success',
  FAILED: 'danger',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
});

const REFUND_STATUS_TONES = Object.freeze({
  PENDING_APPROVAL: 'warning',
  PROCESSING: 'sky',
  DONE: 'success',
  FAILED: 'danger',
  REJECTED: 'neutral',
});

/** Onayda ya da sağlayıcıda süren iadeler: iade edilebilir tutardan düşülür. */
const PENDING_REFUND_STATUSES = Object.freeze(['PENDING_APPROVAL', 'PROCESSING']);

/** Link durumunun rozet tonu. @param {string | null | undefined} status */
export const linkStatusTone = (status) => LINK_STATUS_TONES[status] ?? 'neutral';

/** İade durumunun rozet tonu. @param {string | null | undefined} status */
export const refundStatusTone = (status) => REFUND_STATUS_TONES[status] ?? 'neutral';

/**
 * Kart metni: "MASTER_CARD •••• 0008", marka yoksa "•••• 0008", kart yoksa "—".
 * @param {{ cardBrand?: string | null, cardLast4?: string | null } | null | undefined} link
 */
export function cardText(link) {
  if (!link?.cardLast4) return '—';
  return [link.cardBrand, `•••• ${link.cardLast4}`].filter(Boolean).join(' ');
}

/** Linkin kaynağı (personel / portal / widget). @param {string | null | undefined} origin */
export const originLabel = (origin) => PAYMENT_LINK_ORIGIN_LABELS[origin] ?? origin ?? '—';

/**
 * Onay bekleyen / süren iadelerin toplamı ("12.50").
 * @param {Array<{ amount: string, status: string }>} refunds
 */
export function pendingRefundTotal(refunds = []) {
  const cents = refunds.filter((row) => PENDING_REFUND_STATUSES.includes(row.status)).reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0);
  return (cents / 100).toFixed(2);
}

/**
 * Linkten en çok iade edilebilecek tutar (ödenen − iade edilen − onayda bekleyen). Ödenmemiş linkte "0.00".
 * @param {{ status: string, paidAmount: string | null, refundedAmount: string | null }} link
 * @param {Array<{ amount: string, status: string }>} refunds
 */
export function linkRefundable(link, refunds = []) {
  if (link.status !== 'PAID') return '0.00';
  return refundableOnLink({ paidAmount: link.paidAmount, refundedAmount: link.refundedAmount ?? '0', pendingRefunds: pendingRefundTotal(refunds) });
}

/**
 * Üst şeridin metni: kapalı / test ortamı / iyzico sandbox / iyzico canlı.
 * @param {{ isEnabled: boolean, provider: string, environment: string }} settings
 * @returns {{ kind: 'off' | 'test' | 'sandbox' | 'live', tone: 'warning' | 'danger' | 'info' | 'success', title: string }}
 */
export function gatewayMode({ isEnabled, provider, environment }) {
  if (!isEnabled) return { kind: 'off', tone: 'warning', title: 'Sanal POS kapalı' };
  if (provider === 'TEST') return { kind: 'test', tone: 'danger', title: 'Test ortamı — gerçek para çekilmez' };
  const name = PAYMENT_GATEWAY_PROVIDER_LABELS[provider] ?? provider;
  if (environment === 'LIVE') return { kind: 'live', tone: 'success', title: `${name} canlı` };
  return { kind: 'sandbox', tone: 'info', title: `${name} ${PAYMENT_GATEWAY_ENVIRONMENT_LABELS.SANDBOX ?? 'sandbox'}` };
}

/**
 * Linkin dikkat isteyen durumu (ayrıntı uyarısı ve listedeki kısa not):
 * - ödendi ama folyoya yazılamadı (`NOT_POSTED`; sistem birkaç dakikada bir yeniden yazar),
 * - sağlayıcı "ödendi" dedi ama doğrulanamadı (`UNVERIFIED`, ödeme sürüyor),
 * - açık linkte son deneme başarısız (misafir yeniden deneyebilir).
 * @param {{ status: string, paymentId?: string | null, failureCode?: string | null, failureMessage?: string | null }} link
 * @returns {{ tone: 'warning' | 'danger', title: string, text: string } | null}
 */
export function linkWarning(link) {
  const { status, paymentId, failureCode, failureMessage } = link;
  if (status === 'PAID' && !paymentId && failureCode === 'NOT_POSTED') {
    return { tone: 'warning', title: 'Folyoya yazılmayı bekliyor', text: failureMessage || 'Ödeme alındı ama folyoya yazılamadı; sistem birkaç dakikada bir yeniden dener.' };
  }
  if (status === 'PROCESSING' && failureCode === 'UNVERIFIED') {
    return { tone: 'danger', title: 'Doğrulanamadı', text: 'Sağlayıcı ödendi dedi ama doğrulanamadı — sağlayıcı panelinden kontrol edin.' };
  }
  if (status === 'OPEN' && failureMessage) {
    return { tone: 'warning', title: 'Son deneme başarısız', text: `${failureMessage}${failureCode ? ` (${failureCode})` : ''} — link açık, misafir yeniden deneyebilir.` };
  }
  return null;
}
