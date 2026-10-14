import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';
import { reservationKeys } from './reservations.js';
import { PROMOTION_CHANNEL, RESERVATIONS_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

/**
 * Promosyon ve kupon (modül 31): sorgu anahtarları, canlı tazeleme, rozet
 * tonları ve rezervasyon formundaki kupon metinleri. Formun saf dönüşümleri:
 * `promotionForm.js`.
 *
 * Anahtar öneki `['promotions', ...]`; `promotions.changed` kanalı (promosyon,
 * kupon) hepsini ve açık rezervasyon formlarının fiyat önizlemesini tazeler.
 */

export const promotionKeys = Object.freeze({
  all: ['promotions'],
  /** @param {object} filters */
  list: (filters) => ['promotions', 'list', filters],
  /** @param {string} id */
  detail: (id) => ['promotions', 'detail', id],
  /** @param {string} id @param {object} filters */
  coupons: (id, filters) => ['promotions', 'coupons', id, filters],
  /** @param {object} filters */
  report: (filters) => ['promotions', 'report', filters],
  /** @param {string} id @param {object} filters */
  reservations: (id, filters) => ['promotions', 'reservations', id, filters],
  /** Kullanım sayıları rezervasyonla değişen sorgular. */
  usage: [['promotions', 'list'], ['promotions', 'detail'], ['promotions', 'coupons'], ['promotions', 'report'], ['promotions', 'reservations']],
});

/** Canlı tazelemede en kısa aralık. */
const LIVE_MIN_REFRESH_MS = 1_500;
/** Kullanım sayıları (rezervasyon açıldı / iptal) daha seyrek tazelenir: yoğun otelde her satışta rapor sorulmasın. */
const USAGE_MIN_REFRESH_MS = 10_000;

/**
 * Promosyon ekranları açıkken kanal dinlenir. `withUsage`: kullanım sayılarını
 * gösteren ekranlar rezervasyon kanalını da dinler (açılan / iptal edilen
 * rezervasyon kuponun ve promosyonun kullanımını değiştirir).
 *
 * @param {{ withUsage?: boolean }} [options]
 */
export function usePromotionLive({ withUsage = false } = {}) {
  const live = useLiveChannel(PROMOTION_CHANNEL, {
    minIntervalMs: LIVE_MIN_REFRESH_MS,
    // Promosyon / kupon değişince açık rezervasyon formundaki fiyat önizlemesi de bayatlar.
    queryKeys: [promotionKeys.all, reservationKeys.quotes],
  });
  useLiveChannel(RESERVATIONS_CHANNEL, { enabled: withUsage, minIntervalMs: USAGE_MIN_REFRESH_MS, queryKeys: promotionKeys.usage });
  return live;
}

/** @param {string} id */
export function usePromotion(id) {
  return useQuery({ queryKey: promotionKeys.detail(id), queryFn: () => api(`/promotions/${id}`) });
}

/** Rozet tonları. */
export const PROMOTION_STATUS_TONES = Object.freeze({ DRAFT: 'warning', ACTIVE: 'success', PAUSED: 'neutral' });

/** Yayındaki promosyonun satışa göre durumu. */
export const AVAILABILITY_LABELS = Object.freeze({ LIVE: 'Satışta', SCHEDULED: 'Satış başlamadı', EXPIRED: 'Satış dönemi bitti' });
export const AVAILABILITY_TONES = Object.freeze({ LIVE: 'success', SCHEDULED: 'info', EXPIRED: 'neutral' });

/** Kupon önizleme durumunun tonu (bkz. `COUPON_QUOTE_STATUSES`). */
export const COUPON_STATUS_TONES = Object.freeze({ APPLIED: 'success', NOT_BETTER: 'info', NOT_APPLICABLE: 'warning', INVALID: 'danger' });

/**
 * Önizlemedeki kuponun personele söylenen hali.
 * @param {{ status: string, issue: { message: string } | null, promotion: { name: string, label: string } | null, remainingUses: number | null } | null} coupon
 */
export function couponStatusText(coupon) {
  if (!coupon) return '';
  if (coupon.status === 'APPLIED') {
    const left = coupon.remainingUses === null ? '' : ` · ${coupon.remainingUses} kullanım hakkı var`;
    return `Uygulanıyor: ${coupon.promotion?.name ?? ''} (${coupon.promotion?.label ?? ''})${left}`;
  }
  return coupon.issue?.message ?? '';
}

/**
 * Önizlemedeki kupon rezervasyonu engelliyor mu (açarken sunucu da reddeder)?
 * Daha avantajlı promosyon yüzünden kullanılmayan kupon engel değildir.
 * @param {{ status: string } | null | undefined} coupon
 */
export const couponBlocks = (coupon) => coupon?.status === 'INVALID' || coupon?.status === 'NOT_APPLICABLE';
