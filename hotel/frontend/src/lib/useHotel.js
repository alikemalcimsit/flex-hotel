import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';

/**
 * Otel kaydı kabukta ve birçok ekranda okunur ama nadiren değişir; her
 * gezinmede yeniden istenmesin. Ayarlar'dan kaydedilince aynı önbellek anahtarı
 * güncellendiği için her yer hemen tazelenir.
 */
const HOTEL_STALE_MS = 5 * 60 * 1000;

export const HOTEL_QUERY_KEY = Object.freeze(['settings', 'hotel']);

/** Saat dilimi başına tek biçimlendirici. */
const dayFormatters = new Map();

/**
 * Verilen saat dilimindeki bugünün tarihi (`YYYY-MM-DD`).
 *
 * `new Date().toISOString()` UTC'dir: İstanbul'da gece 00:00–03:00 arası dünü
 * verir. Otelin "bugün"ü otelin saat diliminden okunmalı — sunucu da öyle
 * hesaplıyor (bkz. backend `lib/business-date.js`).
 *
 * @param {string} timeZone IANA saat dilimi
 * @param {Date} [now]
 * @returns {string}
 */
export function todayInTimeZone(timeZone, now = new Date()) {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    // en-CA "YYYY-MM-DD" biçiminde verir.
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter.format(now);
}

/** Otel bilgileri (ad, saat dilimi, para birimi...). */
export function useHotelSettings() {
  return useQuery({
    queryKey: HOTEL_QUERY_KEY,
    queryFn: () => api('/settings/hotel'),
    staleTime: HOTEL_STALE_MS,
  });
}

/**
 * Otelin bugünü. Otel kaydı henüz yüklenmediyse tarayıcının saat dilimi
 * kullanılır — ekran boş beklemesin, kayıt gelince kendiliğinden düzelir.
 *
 * @returns {{ today: string, timeZone: string }}
 */
export function useHotelToday() {
  const { data } = useHotelSettings();
  const timeZone = data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { today: todayInTimeZone(timeZone), timeZone };
}
