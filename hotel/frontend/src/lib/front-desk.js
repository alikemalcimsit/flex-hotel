import { COUNTRY_CODES, DEPOSIT_METHODS, DEPOSIT_METHOD_LABELS, ID_DOCUMENT_TYPES, ID_DOCUMENT_TYPE_LABELS } from '@hotelos/hotel-contracts';

/**
 * Ön büro (modül 6): sorgu anahtarları ve ortak yardımcılar.
 *
 * Anahtar öneki `['front-desk', ...]`. Canlı kanallar: `reservations.changed`
 * (giriş / çıkış / geri alma, rezervasyon değişikliği) ve `inventory.changed`
 * (oda temizlendi, kirlendi — gelecekler listesindeki oda hazırlığı).
 */

export const frontDeskKeys = Object.freeze({
  all: ['front-desk'],
  summary: ['front-desk', 'summary'],
  lists: ['front-desk', 'list'],
  /** @param {'arrivals' | 'departures' | 'in-house'} kind @param {object} filters */
  list: (kind, filters) => ['front-desk', 'list', kind, filters],
  /** @param {string} id */
  checkIn: (id) => ['front-desk', 'check-in', id],
  /** @param {string} id */
  checkOut: (id) => ['front-desk', 'check-out', id],
});

/** Oda hazırlığı → rozet. */
export const READINESS = Object.freeze({
  READY: { tone: 'success', label: 'Hazır' },
  DIRTY: { tone: 'warning', label: 'Kirli' },
  CLEANING: { tone: 'warning', label: 'Temizleniyor' },
  OCCUPIED: { tone: 'danger', label: 'Önceki misafir içeride' },
  BLOCKED: { tone: 'danger', label: 'Arıza / hizmet dışı' },
});

/** Uyruk seçeneği: Türkçe ülke adı (tarayıcının `Intl` verisinden), Türkiye başta. */
export const COUNTRY_OPTIONS = (() => {
  let names;
  try {
    names = new Intl.DisplayNames(['tr'], { type: 'region' });
  } catch {
    names = null;
  }
  const label = (code) => {
    try {
      return names?.of(code) ?? code;
    } catch {
      return code;
    }
  };
  const rest = COUNTRY_CODES.filter((code) => code !== 'TR')
    .map((code) => ({ value: code, label: `${label(code)} (${code})` }))
    .sort((a, b) => a.label.localeCompare(b.label, 'tr'));
  return Object.freeze([{ value: 'TR', label: `${label('TR')} (TR)` }, ...rest]);
})();

export const ID_TYPE_OPTIONS = Object.freeze(ID_DOCUMENT_TYPES.map((value) => ({ value, label: ID_DOCUMENT_TYPE_LABELS[value] })));

export const DEPOSIT_OPTIONS = Object.freeze(DEPOSIT_METHODS.map((value) => ({ value, label: DEPOSIT_METHOD_LABELS[value] })));

/** Bakiye tonu: borç kırmızı, iade sarı, sıfır nötr. */
export function balanceTone(balance) {
  if (balance === null || balance === undefined) return 'neutral';
  const value = Number(balance);
  if (value > 0) return 'danger';
  if (value < 0) return 'warning';
  return 'success';
}
