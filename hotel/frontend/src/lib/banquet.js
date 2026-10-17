import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';
import { BANQUET_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

/**
 * Banket / etkinlik (modül 37): sorgu anahtarları, canlı tazeleme, rozet tonları
 * ve duvar saati metinleri. Formların saf dönüşümleri: `banquetForm.js`.
 *
 * Anahtar öneki `['banquet', ...]`; `banquet.changed` kanalı (salon, ekipman,
 * müşteri, politika, etkinlik, belge, ödeme) hepsini tazeler. Ödeme onayının
 * kararı da bu kanaldan gelir (dinleyici satırı işleyip haber yayar).
 */

export const banquetKeys = Object.freeze({
  all: ['banquet'],
  summary: ['banquet', 'summary'],
  /** @param {object} filters */
  events: (filters) => ['banquet', 'events', filters],
  /** @param {string} id */
  event: (id) => ['banquet', 'event', id],
  /** @param {string} id */
  payments: (id) => ['banquet', 'payments', id],
  /** @param {{ from: string, to: string }} range */
  calendar: (range) => ['banquet', 'calendar', range],
  /** @param {object} input */
  availability: (input) => ['banquet', 'availability', input],
  venues: ['banquet', 'venues'],
  /** @param {object} filters */
  equipment: (filters) => ['banquet', 'equipment', filters],
  /** @param {object} filters */
  clients: (filters) => ['banquet', 'clients', filters],
  settings: ['banquet', 'settings'],
});

/** Canlı tazelemede en kısa aralık (yoğun satış saatinde her kayıt bütün ekranları yormasın). */
const LIVE_MIN_REFRESH_MS = 2_000;

/** Banket ekranları açıkken kanal dinlenir. */
export function useBanquetLive() {
  return useLiveChannel(BANQUET_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [banquetKeys.all] });
}

/** @param {string} id */
export function useBanquetEvent(id) {
  return useQuery({ queryKey: banquetKeys.event(id), queryFn: () => api(`/banquet/events/${id}`) });
}

/** Salonlar (sınırlı sayıda; formlar ve takvim hepsini ister). */
export function useVenues() {
  return useQuery({ queryKey: banquetKeys.venues, queryFn: () => api('/banquet/venues'), staleTime: 30_000 });
}

export function useBanquetSettings() {
  return useQuery({ queryKey: banquetKeys.settings, queryFn: () => api('/banquet/settings'), staleTime: 30_000 });
}

/** Rozet tonları. */
export const EVENT_STATUS_TONES = Object.freeze({ INQUIRY: 'neutral', TENTATIVE: 'warning', DEFINITE: 'success', COMPLETED: 'info', CANCELLED: 'danger', LOST: 'neutral' });
export const DOCUMENT_STATUS_TONES = Object.freeze({ ISSUED: 'info', ACCEPTED: 'success', DECLINED: 'danger', SIGNED: 'success', SUPERSEDED: 'neutral' });
export const INSTALLMENT_STATUS_TONES = Object.freeze({ PAID: 'success', PARTIAL: 'warning', DUE: 'neutral', OVERDUE: 'danger' });
export const PAYMENT_STATUS_TONES = Object.freeze({ POSTED: 'success', PENDING: 'violet', DECLINED: 'neutral' });

/** Takvim bloğunun rengi: kesin dolu, opsiyon sırasına göre. */
export const HOLD_CLASSES = Object.freeze({
  DEFINITE: 'border-success-line bg-success-soft text-success-ink',
  FIRST: 'border-warning-line bg-warning-soft text-warning-ink',
  WAITING: 'border-dashed border-line-strong bg-surface-muted text-ink-soft',
});

/** @param {{ status: string, rank: number }} hold */
export const holdClass = (hold) => (hold.status === 'DEFINITE' ? HOLD_CLASSES.DEFINITE : hold.rank === 1 ? HOLD_CLASSES.FIRST : HOLD_CLASSES.WAITING);

const DAY_FORMAT = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const WEEKDAY_FORMAT = new Intl.DateTimeFormat('tr-TR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });

/** "2026-11-20" → "20 Kas 2026". @param {string | null | undefined} day */
export const dayText = (day) => (day ? DAY_FORMAT.format(new Date(`${day.slice(0, 10)}T00:00:00Z`)) : '—');
/** "2026-11-20" → "Cum 20 Kas". @param {string} day */
export const weekdayText = (day) => WEEKDAY_FORMAT.format(new Date(`${day}T00:00:00Z`));

/**
 * Otelin duvar saati ("2026-11-20T19:00") → "20 Kas 2026 19:00". Tarayıcının saat
 * dilimi karışmaz: metin zaten otelin saatidir.
 * @param {string | null | undefined} wall
 */
export const wallText = (wall) => (wall ? `${dayText(wall.slice(0, 10))} ${wall.slice(11, 16)}` : '—');

/** Aynı gün "20 Kas 2026 19:00–23:30", değilse iki uç. @param {string} startLocal @param {string} endLocal */
export const wallRange = (startLocal, endLocal) =>
  startLocal.slice(0, 10) === endLocal.slice(0, 10) ? `${wallText(startLocal)}–${endLocal.slice(11, 16)}` : `${wallText(startLocal)} – ${wallText(endLocal)}`;

/** "YYYY-AA-GG" ± gün. */
export function shiftDay(day, offset) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

/** Etkinlik ekranının yolu (sekme seçiliyse sorguyla). @param {string} id @param {string} [tab] */
export const eventPath = (id, tab) => `/etkinlikler/${id}${tab ? `?sekme=${tab}` : ''}`;
