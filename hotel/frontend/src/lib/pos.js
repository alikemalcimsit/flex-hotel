import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';
import { POS_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

/**
 * Restoran POS (modül 39): sorgu anahtarları, canlı tazeleme, rozet / masa renkleri ve
 * yollar. Sepet ve para üstü gibi saf dönüşümler `posCart.js`'te.
 *
 * Anahtar öneki `['pos', ...]`; `pos.changed` kanalı (masa planı, adisyon, sipariş turu,
 * ödeme, vardiya, tanımlar) hepsini tazeler. Dört göz kararları da bu kanaldan gelir
 * (dinleyici kaydı işleyip haber yayar).
 */

export const posKeys = Object.freeze({
  all: ['pos'],
  terminal: ['pos', 'terminal'],
  /** @param {string} outletId */
  floor: (outletId) => ['pos', 'floor', outletId],
  /** @param {string} id */
  check: (id) => ['pos', 'check', id],
  /** @param {object} filters */
  checks: (filters) => ['pos', 'checks', filters],
  currentShift: ['pos', 'shift', 'current'],
  /** @param {object} filters */
  shifts: (filters) => ['pos', 'shifts', filters],
  /** @param {string} id */
  shift: (id) => ['pos', 'shift', id],
  /** @param {string} id */
  shiftReport: (id) => ['pos', 'shift-report', id],
  openWaiters: ['pos', 'open-waiters'],
  /** @param {object} range */
  sales: (range) => ['pos', 'sales', range],
  /** @param {string} search */
  inHouse: (search) => ['pos', 'in-house', search],
  outlets: ['pos', 'outlets'],
  /** @param {string} outletId */
  tables: (outletId) => ['pos', 'tables', outletId],
  categories: ['pos', 'categories'],
  /** @param {object} filters */
  items: (filters) => ['pos', 'items', filters],
  settings: ['pos', 'settings'],
});

/**
 * Canlı tazelemede en kısa aralık: servis saatinde masa planı bir saniyede birden çok
 * değişebilir; ekran saniyede bir kez tazelenir.
 */
const LIVE_MIN_REFRESH_MS = 1_000;

/** POS ekranları açıkken kanal dinlenir. */
export function usePosLive() {
  return useLiveChannel(POS_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [posKeys.all] });
}

/**
 * Terminalin açılış verisi (satış noktaları, masalar, menü, politika); tanım değişince kanal tazeler.
 * Yalnızca garsona (`pos.operate`): raporcu adisyon ekranını terminalsiz görür.
 * @param {{ enabled?: boolean }} [options]
 */
export function usePosTerminal({ enabled = true } = {}) {
  return useQuery({ queryKey: posKeys.terminal, queryFn: () => api('/pos/terminal'), staleTime: 60_000, enabled });
}

/** Satış noktaları (pasifler dahil; süzgeç ve tanımlar). */
export function usePosOutlets() {
  return useQuery({ queryKey: posKeys.outlets, queryFn: () => api('/pos/outlets'), staleTime: 60_000 });
}

/**
 * Oturumdaki garsonun açık vardiyası (`{ shift: null }` olabilir). Yalnızca garsona.
 * @param {{ enabled?: boolean }} [options]
 */
export function useCurrentShift({ enabled = true } = {}) {
  return useQuery({ queryKey: posKeys.currentShift, queryFn: () => api('/pos/shifts/current'), enabled });
}

/** @param {string} id */
export function usePosCheck(id) {
  return useQuery({ queryKey: posKeys.check(id), queryFn: () => api(`/pos/checks/${id}`) });
}

/** Masa kutusunun rengi (durum). */
export const TABLE_STATE_CLASSES = Object.freeze({
  FREE: 'border-line bg-surface text-ink hover:border-ink',
  OCCUPIED: 'border-info-line bg-info-soft text-info-ink hover:border-info-ink',
  BILL: 'border-warning-line bg-warning-soft text-warning-ink hover:border-warning-ink',
});

export const CHECK_STATUS_TONES = Object.freeze({ OPEN: 'info', CLOSED: 'success', VOID: 'neutral' });
export const ADJUSTMENT_STATUS_TONES = Object.freeze({ APPLIED: 'success', PENDING: 'violet', DECLINED: 'neutral' });
export const SHIFT_STATUS_TONES = Object.freeze({ OPEN: 'info', CLOSED: 'neutral' });
export const POSTING_TONES = Object.freeze({ POSTED: 'success', MANUAL: 'danger', PENDING: 'warning' });
export const POSTING_LABELS = Object.freeze({ POSTED: 'Folyoya işlendi', MANUAL: 'Folyoya elle işlenecek', PENDING: 'Folyoya gidiyor' });

/** @param {string} id */
export const checkPath = (id) => `/pos/adisyon/${id}`;
/** @param {string} id */
export const shiftPath = (id) => `/pos/vardiyalar/${id}`;

/**
 * Açılıştan bu yana geçen süre ("12 dk", "1 sa 05 dk"): masada ne kadar oturuldu.
 * @param {string} openedAt ISO
 * @param {number} now ms
 */
export function elapsedText(openedAt, now) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(openedAt)) / 60_000));
  if (minutes < 60) return `${minutes} dk`;
  return `${Math.floor(minutes / 60)} sa ${String(minutes % 60).padStart(2, '0')} dk`;
}

const TIME_FORMAT = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' });

/** @param {string | null | undefined} value ISO → "21:40" */
export const timeText = (value) => (value ? TIME_FORMAT.format(new Date(value)) : '—');
/** @param {string | null | undefined} value ISO → "17.10.2026 21:40" */
export const dateTimeText = (value) => (value ? DATE_TIME_FORMAT.format(new Date(value)) : '—');

/** Arama kutusunun bekleme süresi (her tuşta istek gitmesin). */
const SEARCH_DEBOUNCE_MS = 300;

/** Yazmayı bitirince (300 ms) kırpılmış değer. @param {string} text */
export function useDebounced(text) {
  const [value, setValue] = useState(text.trim());
  useEffect(() => {
    const timer = setTimeout(() => setValue(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return value;
}
