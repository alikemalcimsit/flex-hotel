/** Onay durumu → rozet tonu. */
export const STATUS_TONES = Object.freeze({
  PENDING: 'warning',
  GRANTED: 'success',
  DENIED: 'danger',
  EXPIRED: 'neutral',
});

/** Onay türü → ikon. */
export const TYPE_ICONS = Object.freeze({
  REFUND: 'rotateCcw',
  LARGE_PAYMENT: 'zap',
  BULK_PRICE_CHANGE: 'sliders',
  OTHER: 'clipboard',
});

/** Adres çubuğundaki filtre adları (uyarı bağlantıları da bunları kullanır: `?onay=`). */
export const FILTER_PARAMS = Object.freeze({ type: 'tur', status: 'durum', search: 'q', detail: 'onay' });
