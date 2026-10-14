import { useQuery } from '@tanstack/react-query';
import { api, withQuery } from './api.js';
import { reservationKeys } from './reservations.js';
import { AGENCY_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

/**
 * Acente ve kontrat (modül 29): sorgu anahtarları, canlı tazeleme, rozet
 * tonları ve rezervasyon formundaki acente metinleri. Fiyat tablosunun saf
 * dönüşümleri: `rateBlocks.js`.
 *
 * Anahtar öneki `['agencies', ...]`; `agencies.changed` kanalı (kart, kontrat,
 * fiyat, stop-sale) hepsini ve açık rezervasyon formlarının fiyat önizlemesini
 * tazeler.
 */

export const agencyKeys = Object.freeze({
  all: ['agencies'],
  /** @param {object} filters */
  list: (filters) => ['agencies', 'list', filters],
  /** @param {string} id */
  detail: (id) => ['agencies', 'detail', id],
  /** @param {string} id */
  contract: (id) => ['agencies', 'contract', id],
  /** @param {string} id @param {object} period */
  summary: (id, period) => ['agencies', 'summary', id, period],
  /** @param {string} id @param {object} filters */
  reservations: (id, filters) => ['agencies', 'reservations', id, filters],
  /** @param {object} query */
  options: (query) => ['agencies', 'options', query],
});

/** Canlı tazelemede en kısa aralık. */
const LIVE_MIN_REFRESH_MS = 1_500;

/** Acente ekranları (ve acente seçilebilen formlar) açıkken kanal dinlenir. */
export function useAgencyLive() {
  return useLiveChannel(AGENCY_CHANNEL, {
    minIntervalMs: LIVE_MIN_REFRESH_MS,
    // Kontrat / stop-sale değişince açık rezervasyon formundaki fiyat önizlemesi de bayatlar.
    queryKeys: [agencyKeys.all, reservationKeys.quotes],
  });
}

/** @param {string} id */
export function useAgency(id) {
  return useQuery({ queryKey: agencyKeys.detail(id), queryFn: () => api(`/agencies/${id}`) });
}

/** @param {string} id */
export function useContract(id) {
  return useQuery({ queryKey: agencyKeys.contract(id), queryFn: () => api(`/agencies/contracts/${id}`) });
}

/** Rozet tonları. */
export const AGENCY_STATUS_TONES = Object.freeze({ ACTIVE: 'success', PASSIVE: 'neutral' });
export const CONTRACT_STATUS_TONES = Object.freeze({ DRAFT: 'warning', ACTIVE: 'success', ENDED: 'neutral' });

/* ─────────────── Rezervasyon formu ─────────────── */

/**
 * Acente fiyat önizlemesindeki sorunun kullanıcıya yazılacak hali.
 * `STOP_SALE` elle fiyatla aşılmaz; diğerleri yetkili personelde aşılabilir.
 *
 * @param {{ code: string, message: string } | null | undefined} issue
 * @param {boolean} canOverridePrice
 */
export function agencyIssueText(issue, canOverridePrice) {
  if (!issue) return '';
  if (issue.code === 'AGENCY_STOP_SALE' || issue.code === 'AGENCY_PASSIVE' || issue.code === 'AGENCY_NOT_FOUND') return issue.message;
  return canOverridePrice ? `${issue.message}. Fiyatı elle girerek devam edebilirsiniz.` : `${issue.message}. Yetkili personel fiyatı elle girebilir.`;
}

/**
 * Cari özeti ve rezervasyon tablosu sorgusu.
 * @param {string} id
 * @param {{ from?: string, to?: string }} period
 */
export function useAgencySummary(id, period) {
  return useQuery({
    queryKey: agencyKeys.summary(id, period),
    queryFn: () => api(withQuery(`/agencies/${id}/summary`, { from: period.from || undefined, to: period.to || undefined })),
    placeholderData: (previous) => previous,
  });
}
