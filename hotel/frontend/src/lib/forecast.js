import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FORECAST_DAYS } from '@hotelos/hotel-contracts';
import { api, withQuery } from './api.js';
import { dashboardKeys } from './dashboard.js';

/**
 * Doluluk ve gelir tahmini (modül 25): sorgu anahtarları ve veri kancası.
 *
 * Anahtarlar günlük durumun altında (`['dashboard', 'forecast', ...]`):
 * günlük durumun canlı kanalı (`useDashboardLive`) rezervasyon değişince
 * tahmini de tazeler. Eşikler değişince kaydeden pencere anahtarı geçersiz
 * kılar; sunucu da önbelleğini ayar olayıyla yeniler.
 */

export const forecastKeys = Object.freeze({
  all: [...dashboardKeys.all, 'forecast'],
  /** @param {number} days */
  window: (days) => [...dashboardKeys.all, 'forecast', days],
});

/** Socket kopukken ve gece yarısı iş günü dönerken (olay yok) tazeleme — günlük durumla aynı. */
const FALLBACK_REFRESH_MS = 5 * 60_000;

/** @param {{ enabled: boolean, days?: number }} options */
export function useForecast({ enabled, days = FORECAST_DAYS }) {
  return useQuery({
    queryKey: forecastKeys.window(days),
    queryFn: () => api(withQuery('/forecast', { days })),
    enabled,
    refetchInterval: FALLBACK_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
}

/** Kritik gün türünün görünümü: renk tonu ve şekil (yalnız renge dayanmasın). */
export const ALERT_STYLE = Object.freeze({
  OVERBOOKED: { tone: 'danger', glyph: '!', color: 'var(--color-danger)' },
  HIGH: { tone: 'warning', glyph: '▲', color: 'var(--color-warning)' },
  LOW: { tone: 'warning', glyph: '▼', color: 'var(--color-warning)' },
});

/** Kritik günde ne yapılabileceği (kısa). */
export const ALERT_HINTS = Object.freeze({
  OVERBOOKED: 'Eldeki satış satılabilir odayı aşıyor: oda planından çözün.',
  HIGH: 'Talep yüksek: fiyatı ve fazla satış sınırını gözden geçirin.',
  LOW: 'Doluluk düşük: fiyat, kampanya ve kanalları gözden geçirin.',
});

/** Eksi / artı işaretli gece farkı ("+12", "−3", "0"). @param {number} value */
export function signedNights(value) {
  const rounded = Math.round(value);
  if (rounded === 0) return '0';
  return rounded > 0 ? `+${rounded}` : `−${Math.abs(rounded)}`;
}
