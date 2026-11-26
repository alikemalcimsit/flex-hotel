import { toastError, toastSuccess } from '../store/toast.js';
import { PAYMENT_GATEWAY_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

export { cardText, gatewayMode, linkRefundable, linkStatusTone, linkWarning, originLabel, pendingRefundTotal, refundStatusTone } from './paymentGatewayFormat.js';

/**
 * Sanal POS / ödeme geçidi (modül 50): sorgu anahtarları, canlı tazeleme ve bağlantı kopyalama. Hepsi `payment-gateway`
 * kökünde: link / iade / ayar haberi tek anahtarla listeyi, ayrıntıyı, ayarı ve rezervasyon kartını yeniler.
 */
export const gatewayKeys = Object.freeze({
  all: ['payment-gateway'],
  settings: ['payment-gateway', 'settings'],
  /** @param {object} filters */
  links: (filters) => ['payment-gateway', 'links', filters],
  /** @param {string} linkId */
  link: (linkId) => ['payment-gateway', 'link', linkId],
  /** @param {string} reservationId */
  reservation: (reservationId) => ['payment-gateway', 'reservation', reservationId],
});

/** İşlem listesi sayfa boyutu. */
export const GATEWAY_PAGE_SIZE = 25;

/** İki tazeleme arası en kısa süre: ödeme sonucu ve iade art arda haber verebilir. */
const LIVE_MIN_REFRESH_MS = 1_500;

/** Sanal POS ekranı / kartı açıkken link, iade ve ayar değişince tazelenir. */
export function useGatewayLive() {
  return useLiveChannel(PAYMENT_GATEWAY_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [gatewayKeys.all] });
}

/**
 * Ödeme bağlantısını panoya kopyalar; tarayıcı izin vermezse hata bildirir.
 * @param {string | null | undefined} url
 */
export async function copyPayLink(url) {
  if (!url) {
    toastError('Bağlantı adresi yok: Misafir portalı ayarında portal adresini girin');
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toastSuccess('Bağlantı kopyalandı');
  } catch {
    toastError('Kopyalanamadı; adresi seçip elle kopyalayın');
  }
}
