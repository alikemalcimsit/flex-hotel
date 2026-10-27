import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';
import { formatDateTime } from './timeFormat.js';
import { useHotelContext } from './useHotel.js';
import { reservationKeys } from './reservations.js';
import { CHANNEL_MANAGER_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

/**
 * Kanal yönetimi (modül 33): sorgu anahtarları, canlı tazeleme ve rozet
 * tonları. Formların saf dönüşümleri: `channelForm.js`.
 *
 * Anahtar öneki `['channel-manager', ...]`; `channel-manager.changed` kanalı
 * (ayar, eşleştirme, stop-sale, senkron, kanal rezervasyonu) hepsini tazeler.
 * Kanaldan açılan / değişen rezervasyon rezervasyon ekranlarını da bayatlatır.
 */

export const channelKeys = Object.freeze({
  all: ['channel-manager'],
  /** @param {object} filters */
  list: (filters) => ['channel-manager', 'list', filters],
  /** @param {string} id */
  detail: (id) => ['channel-manager', 'detail', id],
  /** @param {string} id */
  options: (id) => ['channel-manager', 'options', id],
  /** @param {string} id @param {object} filters */
  logs: (id, filters) => ['channel-manager', 'logs', id, filters],
  /** @param {string} id @param {string} logId */
  log: (id, logId) => ['channel-manager', 'log', id, logId],
  /** @param {string} id @param {object} filters */
  bookings: (id, filters) => ['channel-manager', 'bookings', id, filters],
});

/** Canlı tazelemede en kısa aralık (gönderim birkaç saniyede bir log yazabilir). */
const LIVE_MIN_REFRESH_MS = 3_000;

/** Kanal ekranları açıkken kanal dinlenir. */
export function useChannelLive() {
  return useLiveChannel(CHANNEL_MANAGER_CHANNEL, {
    minIntervalMs: LIVE_MIN_REFRESH_MS,
    // Kanal rezervasyonu açılınca / değişince rezervasyon listesi de bayatlar.
    queryKeys: [channelKeys.all, reservationKeys.all],
  });
}

/** @param {string} id */
export function useChannel(id) {
  return useQuery({ queryKey: channelKeys.detail(id), queryFn: () => api(`/channel-manager/${id}`) });
}

/**
 * Kanal ekranlarındaki zamanlar otelin saatiyle ("14 Eki 2026 09:30"): senkron
 * ve log zamanı, personelin bulunduğu yerin değil otelin saatidir.
 */
export function useChannelTime() {
  const timeZone = useHotelContext().data?.timezone;
  return useCallback((value) => formatDateTime(value, timeZone), [timeZone]);
}

/** Rozet tonları. */
export const CHANNEL_STATUS_TONES = Object.freeze({ DRAFT: 'warning', ACTIVE: 'success', PAUSED: 'neutral' });
export const SYNC_STATUS_TONES = Object.freeze({ SUCCESS: 'success', PARTIAL: 'warning', FAILED: 'danger' });
export const BOOKING_STATE_TONES = Object.freeze({ PENDING: 'info', PROCESSED: 'success', REVIEW: 'warning', ATTENTION: 'danger' });
export const BOOKING_STATUS_TONES = Object.freeze({ ACTIVE: 'success', CANCELLED: 'neutral' });
