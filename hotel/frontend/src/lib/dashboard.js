import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, withQuery } from './api.js';
import { frontDeskKeys } from './front-desk.js';
import { INVENTORY_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

/**
 * Günlük durum ekranı (modül 13): sorgu anahtarları ve veri kancaları.
 *
 * Anahtar öneki `['dashboard', ...]`. Canlı kanal `inventory.changed`:
 * rezervasyon açılması / değişmesi / iptali, giriş, çıkış, oda durumu ve arıza
 * kaydı hepsi bu kanala düşer (sunucu da önbelleğini aynı olaylarla tazeler).
 */

export const dashboardKeys = Object.freeze({
  all: ['dashboard'],
  today: ['dashboard', 'today'],
  /** @param {string} from */
  week: (from) => ['dashboard', 'week', from],
});

/** Haftalık grafikte bugünden önce gösterilen gün: dünü de görmek için. */
export const WEEK_DAYS_BEFORE_TODAY = 3;

/**
 * Canlı tazeleme arasında en kısa süre: yoğun saatte her rezervasyonda
 * ekranın baştan hesaplanması gereksiz; müdür birkaç saniyelik gecikmeyi fark etmez.
 */
const LIVE_MIN_REFRESH_MS = 15_000;

/**
 * Socket kopukken ve gece yarısı iş günü dönerken (olay yok) tazeleme.
 */
const FALLBACK_REFRESH_MS = 5 * 60_000;

/**
 * Günlük durum ve ana sayfadaki gelecek / gidecek kısa listeleri birlikte tazelenir.
 * @param {{ enabled: boolean }} options
 */
export function useDashboardLive({ enabled }) {
  return useLiveChannel(INVENTORY_CHANNEL, {
    enabled,
    minIntervalMs: LIVE_MIN_REFRESH_MS,
    queryKeys: [dashboardKeys.all, frontDeskKeys.lists],
  });
}

/** @param {{ enabled: boolean }} options */
export function useDashboardToday({ enabled }) {
  return useQuery({
    queryKey: dashboardKeys.today,
    queryFn: () => api('/dashboard/today'),
    enabled,
    refetchInterval: FALLBACK_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
}

/** @param {{ from: string | null }} options `from` bilinene (bugün) kadar sorgu atılmaz */
export function useDashboardWeek({ from }) {
  return useQuery({
    queryKey: dashboardKeys.week(from),
    queryFn: () => api(withQuery('/dashboard/week', { from })),
    enabled: Boolean(from),
    refetchInterval: FALLBACK_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
}

/**
 * ISO güne gün ekler (`YYYY-MM-DD`, UTC; saat dilimi kayması yok).
 * @param {string} isoDay
 * @param {number} days
 */
export function shiftIsoDay(isoDay, days) {
  const time = Date.parse(`${isoDay}T00:00:00.000Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

const weekdayFormatter = new Intl.DateTimeFormat('tr-TR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
const longDayFormatter = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** "Cmt 26" @param {string} isoDay */
export const shortDay = (isoDay) => weekdayFormatter.format(new Date(`${isoDay}T00:00:00.000Z`));

/** "26 Eylül Cumartesi" @param {string} isoDay */
export const longDay = (isoDay) => longDayFormatter.format(new Date(`${isoDay}T00:00:00.000Z`));
