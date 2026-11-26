import { useAuthStore } from '../store/auth.js';
import { apiPost, ensureFreshAccessToken } from './api.js';

/**
 * Zincir konsolunun ortak parçaları (modül 63): sorgu anahtarları, otel geçişi.
 */

export const chainKeys = Object.freeze({
  all: ['chain'],
  overview: () => ['chain', 'overview'],
  hotels: (search) => ['chain', 'hotels', search ?? ''],
  dashboard: () => ['chain', 'dashboard'],
  report: (from, to) => ['chain', 'report', from, to],
  users: (filters) => ['chain', 'users', filters],
  user: (id) => ['chain', 'user', id],
  myHotels: (search) => ['auth', 'hotels', search ?? ''],
});

/**
 * Otel geçişini seçici başlattı mı? Oturumun oteli kendiliğinden değişirse (erişim kaldırıldı, yenileme kişiyi ana
 * oteline döndürdü) ekran bunu ayırt edip kullanıcıya söyler.
 */
let switchInProgress = false;

/** @returns {boolean} bir kez okunur */
export function consumeSwitchFlag() {
  const value = switchInProgress;
  switchInProgress = false;
  return value;
}

/**
 * Başka bir otele geçer: sunucu o otelin kimliği ve rolüyle yeni oturum açar; eski yenileme token'ı iptal olur.
 * Önbellek ve soket oturum değişince kendiliğinden yenilenir (`main.jsx`, `lib/socket.js`).
 *
 * @param {string} hotelId
 */
export async function switchHotel(hotelId) {
  // Önce erişim token'ı tazelenir, yenileme token'ı SONRA okunur: süresi dolmuş token'la gelen 401'de istemci
  // yenileyip isteği tekrarlardı, ama gövdedeki yenileme token'ı o yenilemede iptal edilmiş olurdu → geçiş "oturum
  // süresi doldu" ile düşerdi.
  await ensureFreshAccessToken();
  const { refreshToken } = useAuthStore.getState();
  const session = await apiPost('/auth/switch-hotel', { hotelId, refreshToken });
  switchInProgress = true;
  useAuthStore.getState().setSession(session);
  return session;
}

/** Değişim yönünün rengi (`formatChange` yönüyle; artış iyi). */
export const CHANGE_TONES = Object.freeze({ up: 'text-success-ink', down: 'text-danger-ink', flat: 'text-ink-muted', none: 'text-ink-muted' });

/**
 * Pano / rapor satırları otel kimliğini `hotelId`'de taşır; tablo satır anahtarı `id` ister (yoksa anahtarsız satırlar
 * yenilemede karışır). Sorgunun `select`'inde bir kez eklenir.
 *
 * @template {{ hotels: Array<{ hotelId: string }> }} T
 * @param {T} data
 */
export const withHotelRowIds = (data) => ({ ...data, hotels: data.hotels.map((row) => ({ ...row, id: row.hotelId })) });
