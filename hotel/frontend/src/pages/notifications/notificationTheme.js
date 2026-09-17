/**
 * Bildirim ekranlarının ortak görünüm eşlemeleri.
 */

/** Durum → rozet tonu. Anlam her zaman rozetin metninde. */
export const STATUS_TONES = Object.freeze({
  PENDING: 'info',
  SENDING: 'info',
  SENT: 'success',
  DELIVERED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
});

export const CHANNEL_ICONS = Object.freeze({
  EMAIL: 'mail',
  SMS: 'phone',
  WHATSAPP: 'message',
});
