/**
 * Satın alma ekranlarının saf biçimleri (modül 45): durum tonları ve kısa metinler. Değerler
 * sunucudan metin gelir; burada yalnızca gösterim (Node testinde `api.js` yüklenmesin diye ayrı).
 */

export const REQUEST_STATUS_TONES = Object.freeze({ OPEN: 'info', IN_PROGRESS: 'warning', ORDERED: 'success', CANCELLED: 'neutral' });
export const ROUND_STATUS_TONES = Object.freeze({ OPEN: 'info', AWARDED: 'success', CANCELLED: 'neutral' });
export const ORDER_STATUS_TONES = Object.freeze({
  PENDING_APPROVAL: 'warning',
  APPROVED: 'info',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  CLOSED: 'neutral',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
});

/** Tur satırının durumu. */
export const ROUND_LINE_STATE_LABELS = Object.freeze({ PENDING: 'Bekliyor', ORDERED: 'Siparişte', RELEASED: 'Talebe bırakıldı' });

/** Tam sayı birimler: miktar alanında adım 1 (kg / L binde bir). @param {string} unit */
export const quantityStep = (unit) => (unit === 'KG' || unit === 'L' ? '0.001' : '1');

/** "2026-11-20" → "20.11.2026"; boşsa tire. @param {string | null | undefined} day */
export const shortDay = (day) => (day ? day.slice(0, 10).split('-').reverse().join('.') : '—');
