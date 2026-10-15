import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';
import { formatMoney } from './format.js';
import { AGENCY_BONUS_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

/**
 * Acente bonusu (modül 35): sorgu anahtarları, canlı tazeleme, rozet tonları
 * ve miktar metinleri. Formun saf dönüşümleri: `agencyBonusForm.js`.
 *
 * Anahtar öneki `['agency-bonus', ...]`; `agency-bonus.changed` kanalı (kural,
 * hak ediş, kademe, ilerleme özeti) hepsini tazeler.
 */

export const agencyBonusKeys = Object.freeze({
  all: ['agency-bonus'],
  summary: ['agency-bonus', 'summary'],
  /** @param {object} filters */
  rules: (filters) => ['agency-bonus', 'rules', filters],
  /** @param {string} id */
  rule: (id) => ['agency-bonus', 'rule', id],
  /** @param {object} input */
  preview: (input) => ['agency-bonus', 'preview', input],
  /** @param {object} filters */
  settlements: (filters) => ['agency-bonus', 'settlements', filters],
  /** @param {string} id */
  settlement: (id) => ['agency-bonus', 'settlement', id],
  /** @param {string} id @param {object} filters */
  lines: (id, filters) => ['agency-bonus', 'lines', id, filters],
});

/** Canlı tazelemede en kısa aralık. */
const LIVE_MIN_REFRESH_MS = 2_000;

/**
 * Prim ekranları açıkken kanal dinlenir. Onay kuyruğunun kararı da buradan gelir
 * (dinleyici hak edişi güncelleyip `agency.bonus.changed` yayar); onay kanalı
 * ayrıca dinlenmez — otelin her onay haberi prim ekranlarını tazelemesin.
 */
export function useAgencyBonusLive() {
  return useLiveChannel(AGENCY_BONUS_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [agencyBonusKeys.all] });
}

/** @param {string} id */
export function useBonusRule(id) {
  return useQuery({ queryKey: agencyBonusKeys.rule(id), queryFn: () => api(`/agency-bonus/rules/${id}`) });
}

/** @param {string} id */
export function useBonusSettlement(id) {
  return useQuery({ queryKey: agencyBonusKeys.settlement(id), queryFn: () => api(`/agency-bonus/settlements/${id}`) });
}

/** Rozet tonları. */
export const RULE_STATUS_TONES = Object.freeze({ DRAFT: 'warning', ACTIVE: 'success', CANCELLED: 'neutral' });
export const PHASE_TONES = Object.freeze({ UPCOMING: 'info', RUNNING: 'sky', ENDED: 'neutral' });
export const PACE_TONES = Object.freeze({ AHEAD: 'success', NEAR: 'warning', BEHIND: 'danger' });
export const SETTLEMENT_STATUS_TONES = Object.freeze({ DRAFT: 'warning', PENDING_APPROVAL: 'violet', APPROVED: 'info', PAID: 'success' });

/**
 * Gece ya da tutar metni.
 * @param {'NIGHTS' | 'REVENUE'} metric
 * @param {string | number | null | undefined} value
 * @param {string} currency
 */
export function formatQuantity(metric, value, currency) {
  if (value === null || value === undefined || value === '') return '—';
  return metric === 'NIGHTS' ? `${Number(value).toLocaleString('tr-TR')} gece` : formatMoney(value, currency);
}

/** "%12,50" — yüzde metni (sunucudan iki ondalıklı gelir). @param {string | number | null | undefined} value */
export function formatScore(value) {
  if (value === null || value === undefined) return '—';
  return `%${Number(value).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}`;
}

/** İlerleme çubuğu genişliği (0–100; yüzü aşan puan dolu görünür). @param {string | number} score */
export const barWidth = (score) => `${Math.max(0, Math.min(100, Number(score) || 0))}%`;

/** "2027-06" → "Haz 2027". @param {string} month */
export function monthLabel(month) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString('tr-TR', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
