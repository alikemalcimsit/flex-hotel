import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';

/**
 * Otel kaydı kabukta ve birçok ekranda okunur ama nadiren değişir; her
 * gezinmede yeniden istenmesin. Ayarlar'dan kaydedilince aynı önbellek anahtarı
 * güncellendiği için her yer hemen tazelenir.
 */
const HOTEL_STALE_MS = 5 * 60 * 1000;

export const HOTEL_QUERY_KEY = Object.freeze(['settings', 'hotel']);
/** Otel bağlamı (ad, saat dilimi, para birimi): ayarlar kaydedilince bu anahtar da tazelenir. */
export const HOTEL_CONTEXT_KEY = Object.freeze(['settings', 'hotel', 'context']);

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

/**
 * Ekranların otel bağlamı: ad, kod, para birimi, saat dilimi, varsayılan pansiyon, otelin bugünü. Oturum açmış her
 * personel okur (`/settings/hotel/context`); tam otel kaydı (`/settings/hotel`, adres / iptal politikası / eşikler)
 * yalnız ayar yetkilisine açık olduğundan ekranlar bunu kullanır — yoksa oda servisi, kat hizmetleri, ön büro gibi
 * roller 403 alıp saatleri tarayıcının diliminde görüyordu.
 */
export function useHotelContext() {
  return useQuery({
    queryKey: HOTEL_CONTEXT_KEY,
    queryFn: () => api('/settings/hotel/context'),
    staleTime: HOTEL_STALE_MS,
  });
}

/**
 * Otelin bugünü ve saat dilimi (otel bağlamından). Bağlam henüz yüklenmediyse tarayıcının saat dilimi
 * kullanılır — ekran boş beklemesin, bağlam gelince kendiliğinden düzelir. Gün, saat dilimiyle burada hesaplanır
 * (önbellekteki bağlam gece yarısından sonra da doğru günü verir).
 *
 * @returns {{ today: string, timeZone: string }}
 */
export function useHotelToday() {
  const { data } = useHotelContext();
  const timeZone = data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { today: todayInTimeZone(timeZone), timeZone };
}
