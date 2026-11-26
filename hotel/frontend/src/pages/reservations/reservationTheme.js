import { tNow } from '../../i18n/translate.js';
import { RESERVATION_STATUS_TONES, WAITLIST_STATUS_TONES } from '../../lib/reservations.js';

export { RESERVATION_STATUS_TONES, WAITLIST_STATUS_TONES };

/*
 * Etiketler etkin dilde (`tNow`): sözlükte `reservations.board.<KOD>`, `reservations.status.<KOD>` … —
 * Türkçesi contracts'taki tablolardan türetilir (`i18n/tr/reservations.js`). Bilinmeyen kod olduğu gibi döner.
 */

/** Pansiyon kısa etiketi ("BB"); uzun açıklama başlıkta (title). */
export const boardShort = (code) => code;
/** @param {string} code */
export const boardLong = (code) => tNow(`reservations.board.${code}`, code ?? '');
/** @param {string} status */
export const statusLabel = (status) => tNow(`reservations.status.${status}`, status ?? '');
/** @param {string} status */
export const waitlistStatusLabel = (status) => tNow(`reservations.waitlistStatus.${status}`, status ?? '');
/** @param {string} source */
export const sourceLabel = (source) => tNow(`reservations.source.${source}`, source ?? '');

/** @param {number} adults @param {number} children */
export function partyLabel(adults, children) {
  return children > 0 ? tNow('reservations.party.adultsChildren', { adults, children }) : tNow('reservations.party.adults', { adults });
}

/**
 * API hata kodları → kullanıcıya ek açıklama (mesajın kendisi sunucudan gelir).
 * @param {string | undefined} code
 */
export function errorHint(code) {
  switch (code) {
    case 'STALE_WRITE':
      return tNow('reservations.errorHint.staleWrite');
    case 'NO_AVAILABILITY':
      return tNow('reservations.errorHint.noAvailability');
    case 'INVALID_STATUS':
      return tNow('reservations.errorHint.invalidStatus');
    default:
      return null;
  }
}
