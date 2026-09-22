import {
  BOARD_TYPE_LABELS,
  RESERVATION_SOURCE_LABELS,
  RESERVATION_STATUS_LABELS,
  WAITLIST_STATUS_LABELS,
} from '@hotelos/hotel-contracts';
import { RESERVATION_STATUS_TONES, WAITLIST_STATUS_TONES } from '../../lib/reservations.js';

export { RESERVATION_STATUS_TONES, WAITLIST_STATUS_TONES };

/** Pansiyon kısa etiketi ("BB"); uzun açıklama başlıkta (title). */
export const boardShort = (code) => code;
/** @param {string} code */
export const boardLong = (code) => BOARD_TYPE_LABELS[code] ?? code;
/** @param {string} status */
export const statusLabel = (status) => RESERVATION_STATUS_LABELS[status] ?? status;
/** @param {string} status */
export const waitlistStatusLabel = (status) => WAITLIST_STATUS_LABELS[status] ?? status;
/** @param {string} source */
export const sourceLabel = (source) => RESERVATION_SOURCE_LABELS[source] ?? source;

/** @param {number} adults @param {number} children */
export function partyLabel(adults, children) {
  return children > 0 ? `${adults} yetişkin, ${children} çocuk` : `${adults} yetişkin`;
}

/**
 * API hata kodları → kullanıcıya ek açıklama (mesajın kendisi sunucudan gelir).
 * @param {string | undefined} code
 */
export function errorHint(code) {
  switch (code) {
    case 'STALE_WRITE':
      return 'Kayıt siz bakarken değişti; sayfa tazelendi, değişikliği yeniden yapın.';
    case 'NO_AVAILABILITY':
      return 'Başka tarih ya da oda tipi deneyin veya misafiri bekleme listesine alın.';
    case 'INVALID_STATUS':
      return 'Rezervasyonun durumu bu işleme uygun değil.';
    default:
      return null;
  }
}
