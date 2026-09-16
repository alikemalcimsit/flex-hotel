import { GUEST_REQUEST_DUE_SOON_MINUTES, guestRequestTiming } from '@hotelos/hotel-contracts';
import { formatMinutes, formatScheduled } from '../../lib/timeFormat.js';

/**
 * Misafir isteklerinin görsel dili — liste, detay ve konuşma yan panelinde
 * aynı anlam aynı renkte görünsün diye tek yerde.
 */

export const CATEGORY_ICONS = Object.freeze({
  HOUSEKEEPING: 'sparkles',
  AMENITY: 'layers',
  MAINTENANCE: 'wrench',
  ROOM_SERVICE: 'utensils',
  WAKE_UP: 'alarm',
  TRANSPORT: 'car',
  INFORMATION: 'info',
  COMPLAINT: 'alertTriangle',
  OTHER: 'clipboard',
});

/** Öncelik: rozet tonu ve satırın solundaki şerit. */
export const PRIORITY_STYLES = Object.freeze({
  LOW: { tone: 'neutral', stripe: 'bg-black/15' },
  NORMAL: { tone: 'info', stripe: 'bg-info' },
  HIGH: { tone: 'warning', stripe: 'bg-warning' },
  URGENT: { tone: 'danger', stripe: 'bg-sec-strong' },
});

export const STATUS_TONES = Object.freeze({
  OPEN: 'warning',
  IN_PROGRESS: 'info',
  DONE: 'success',
  CANCELLED: 'neutral',
});

/**
 * Süre rozeti: kalan / geciken süre ya da zamanlı işin saati.
 *
 * Sunucunun `minutesLeft` alanı cevabın hesaplandığı ana aittir; ekran uzun
 * süre açık kaldığında geri sayım akmalı. Bu yüzden hesap `dueAt` üzerinden
 * burada, sözleşmedeki aynı kuralla yapılır.
 *
 * @param {{ status: string, dueAt: string, scheduledFor: string | null }} request
 * @param {number} now epoch ms
 * @param {string} timeZone
 * @returns {{ tone: string, text: string, overdue: boolean } | null} aktif değilse `null`
 */
export function requestTimingLabel(request, now, timeZone) {
  const timing = guestRequestTiming(request, new Date(now));
  if (!timing.active) return null;

  if (timing.overdue) {
    return { tone: 'danger', text: `${formatMinutes(timing.minutesLeft)} gecikti`, overdue: true };
  }
  if (request.scheduledFor) {
    const soon = timing.minutesLeft <= GUEST_REQUEST_DUE_SOON_MINUTES;
    return {
      tone: soon ? 'warning' : 'violet',
      text: soon ? `${formatMinutes(timing.minutesLeft)} sonra` : formatScheduled(request.scheduledFor, now, timeZone),
      overdue: false,
    };
  }
  return {
    tone: timing.minutesLeft <= GUEST_REQUEST_DUE_SOON_MINUTES ? 'warning' : 'neutral',
    text: `${formatMinutes(timing.minutesLeft)} kaldı`,
    overdue: false,
  };
}
