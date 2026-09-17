import { calendarDateInTimeZone } from '@hotelos/core';
import { getHotelSettings } from '../modules/settings/service.js';

/**
 * Otelin iş günü ("bugün").
 *
 * Şimdilik otelin saat dilimindeki takvim günü. Gece kapanışı (modül 18)
 * geldiğinde iş günü takvimden değil "kapatılmamış son gün"den okunacak —
 * sabah 02:00'de kapanış yapılmadıysa otel hâlâ dünkü gündedir. O değişiklik
 * yalnızca bu fonksiyonda yapılır; "bugün"e ihtiyaç duyan her yer buradan okur,
 * `new Date()` ile kendi hesaplamaz.
 *
 * @param {string} hotelId
 * @param {Date} [now] test ve yeniden oynatma için
 * @returns {Promise<Date>} UTC gün başı
 */
export async function getBusinessDate(hotelId, now = new Date()) {
  const { timezone } = await getHotelSettings(hotelId);
  return calendarDateInTimeZone(timezone, now);
}
