import {
  LAUNDRY_SERVICE_LABELS,
  LAUNDRY_STATUS_LABELS,
  MINIBAR_CATEGORY_LABELS,
  MINIBAR_CHARGE_TARGET_LABELS,
} from '@hotelos/hotel-contracts';

/**
 * Minibar ve çamaşırhane (modül 19): sorgu anahtarları ve ortak yardımcılar.
 * Canlı kanal `extras.changed`: fiş girildi, sipariş durumu değişti, fiyat listesi değişti.
 */

export const extrasKeys = Object.freeze({
  all: ['extras'],
  /** @param {string} number */
  room: (number) => ['extras', 'room', number],
  activeMinibar: ['extras', 'minibar', 'active'],
  activeLaundry: ['extras', 'laundry', 'active'],
  /** @param {object} filters */
  consumptions: (filters) => ['extras', 'consumptions', filters],
  /** @param {object} filters */
  orders: (filters) => ['extras', 'orders', filters],
  /** @param {string} kind @param {object} filters */
  catalog: (kind, filters) => ['extras', 'catalog', kind, filters],
  laundrySettings: ['extras', 'laundry', 'settings'],
  /** @param {object} filters */
  report: (filters) => ['extras', 'report', filters],
});

export const categoryLabel = (value) => MINIBAR_CATEGORY_LABELS[value] ?? value;
export const serviceLabel = (value) => LAUNDRY_SERVICE_LABELS[value] ?? value;
export const laundryStatusLabel = (value) => LAUNDRY_STATUS_LABELS[value] ?? value;
export const chargeTargetLabel = (value) => MINIBAR_CHARGE_TARGET_LABELS[value] ?? value;

export const LAUNDRY_STATUS_TONES = Object.freeze({
  RECEIVED: 'info',
  IN_PROCESS: 'violet',
  READY: 'sky',
  DELIVERED: 'success',
  CANCELLED: 'neutral',
});

/** Folyoya gidişin durumu (fiş, teslim edilen sipariş). */
export const POSTING_LABELS = Object.freeze({
  POSTED: 'Folyoya işlendi',
  PENDING: 'İşleniyor',
  MANUAL: 'Personele düştü',
  LOSS: 'Kayıp',
});

export const POSTING_TONES = Object.freeze({ POSTED: 'success', PENDING: 'info', MANUAL: 'warning', LOSS: 'neutral' });

/**
 * Formdaki anlık toplam (yalnızca gösterim; sunucu kendisi hesaplar ve
 * saklar). Kuruş cinsinden tam sayıyla: kayan nokta hatası olmaz.
 * @param {Array<{ price: string, quantity: number }>} lines
 * @param {string | null} [expressPct] ekspres farkı yüzdesi (çamaşırhane)
 * @returns {{ subtotal: string, surcharge: string, total: string, count: number }}
 */
export function displayTotals(lines, expressPct = null) {
  let cents = 0;
  let count = 0;
  for (const line of lines) {
    cents += Math.round(Number(line.price) * 100) * line.quantity;
    count += line.quantity;
  }
  const surcharge = expressPct ? Math.round((cents * Number(expressPct)) / 100) : 0;
  const text = (value) => (value / 100).toFixed(2);
  return { subtotal: text(cents), surcharge: text(surcharge), total: text(cents + surcharge), count };
}

/** `<input type="datetime-local">` değeri (yerel saat) ↔ ISO. */
export function toLocalInput(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
