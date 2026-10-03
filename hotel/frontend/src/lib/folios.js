import { FOLIO_ITEM_SOURCE_LABELS, FOLIO_ITEM_TYPE_LABELS, FOLIO_STATUS_LABELS } from '@hotelos/hotel-contracts';

/**
 * Folyo (modül 15): sorgu anahtarları ve ortak yardımcılar.
 *
 * Anahtar öneki `['folios', ...]`. Canlı kanal `folios.changed`: kalem
 * işlendi, iptal edildi, aktarıldı, folyo kapandı… Haberde yalnızca kimlikler
 * gelir; ekran kendi sorgusunu tazeler.
 */

export const folioKeys = Object.freeze({
  all: ['folios'],
  lists: ['folios', 'list'],
  /** @param {object} filters */
  list: (filters) => ['folios', 'list', filters],
  roomCharges: ['folios', 'room-charges'],
  /** @param {string} reservationId */
  stay: (reservationId) => ['folios', 'stay', reservationId],
  /** @param {string} folioId */
  folio: (folioId) => ['folios', 'folio', folioId],
  /** @param {string} folioId @param {boolean} includeVoided */
  items: (folioId, includeVoided) => ['folios', 'items', folioId, includeVoided],
  /** @param {string} folioId */
  payments: (folioId) => ['folios', 'payments', folioId],
  /** @param {object} input */
  preview: (input) => ['folios', 'preview', input],
  /** @param {string} search */
  search: (search) => ['folios', 'search', search],
});

/** Konaklamanın folyo ekranı (istenirse belirli pencere açık). */
export function folioPath(reservationId, folioId) {
  return folioId ? `/folyolar/${reservationId}?folyo=${folioId}` : `/folyolar/${reservationId}`;
}

export const FOLIO_STATUS_TONES = Object.freeze({ OPEN: 'success', CLOSED: 'neutral', TRANSFERRED: 'info' });

export const folioStatusLabel = (status) => FOLIO_STATUS_LABELS[status] ?? status;
export const itemTypeLabel = (type) => FOLIO_ITEM_TYPE_LABELS[type] ?? type;
export const itemSourceLabel = (source) => FOLIO_ITEM_SOURCE_LABELS[source] ?? source;

/** Bakiye tonu: borç kırmızı, iade (eksi) sarı, sıfır yeşil. */
export function balanceTone(balance) {
  const value = Number(balance ?? 0);
  if (value > 0) return 'danger';
  if (value < 0) return 'warning';
  return 'success';
}

/** Tutarın metin rengi (tablo hücresi). */
export function amountClass(value) {
  return Number(value) < 0 ? 'text-warning-ink' : 'text-ink';
}
