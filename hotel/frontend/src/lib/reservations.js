/**
 * Rezervasyon yönetimi (modül 4): sorgu anahtarları ve ortak yardımcılar.
 *
 * Anahtar öneki: `['reservations', ...]`. Canlı kanal (`reservations.changed`)
 * bir rezervasyon ya da bekleme listesi kaydı değişince ilgili anahtarları
 * tazeler.
 */

export const reservationKeys = Object.freeze({
  all: ['reservations'],
  lists: ['reservations', 'list'],
  /** @param {object} filters */
  list: (filters) => ['reservations', 'list', filters],
  /** @param {string} id */
  detail: (id) => ['reservations', 'detail', id],
  /** @param {string} id */
  history: (id) => ['reservations', 'history', id],
  /** @param {object} input */
  quote: (input) => ['reservations', 'quote', input],
  /** @param {string} query */
  guests: (query) => ['reservations', 'guests', query],
  waitlists: ['reservations', 'waitlist'],
  /** @param {object} filters */
  waitlist: (filters) => ['reservations', 'waitlist', filters],
  /** @param {string} id */
  waitlistEntry: (id) => ['reservations', 'waitlist-entry', id],
});

/** Durum → rozet tonu. */
export const RESERVATION_STATUS_TONES = Object.freeze({
  PENDING: 'warning',
  CONFIRMED: 'info',
  CHECKED_IN: 'success',
  CHECKED_OUT: 'neutral',
  CANCELLED: 'danger',
  NO_SHOW: 'danger',
});

/** Bekleme listesi durumu → rozet tonu. */
export const WAITLIST_STATUS_TONES = Object.freeze({
  WAITING: 'warning',
  AVAILABLE: 'success',
  CONVERTED: 'info',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
});

/**
 * Form açılırken üretilen tekil istek kimliği: aynı form ikinci kez
 * gönderilirse (çift tık, ağ tekrarı) sunucu ikinci rezervasyon açmaz.
 */
export function newRequestId() {
  return globalThis.crypto.randomUUID();
}

/**
 * "YYYY-MM-DD" + gün.
 * @param {string} isoDay
 * @param {number} days
 */
export function addDaysIso(isoDay, days) {
  const date = new Date(`${isoDay}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
