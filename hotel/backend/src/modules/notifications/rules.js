import { nightCount, toIsoDay } from '@hotelos/core';
import { EMAIL_PATTERN, internationalPhone, sanitizeSmsValue } from '@hotelos/hotel-contracts';

/**
 * Bildirim merkezinin saf kuralları (veritabanı ve ağ bilmez).
 */

/** Rezervasyon onayı gönderilmeyen durumlar. */
const NO_CONFIRMATION_STATUSES = new Set(['CANCELLED', 'NO_SHOW', 'CHECKED_OUT']);

/** Oda bilgisi gönderilebilecek, henüz gelmemiş konaklama durumları. */
const ARRIVING_STATUSES = new Set(['PENDING', 'CONFIRMED']);

/**
 * Tetikleyici bu konaklama için bildirim gerektiriyor mu? Gerekmiyorsa sebebi.
 *
 * Oda bilgisi günler önceki atamada gönderilmez: oda, giriş gününe kadar
 * (oda planında sürükle-bırakla) defalarca değişebilir ve misafire her
 * değişiklikte mesaj gitmesi hem kafa karıştırır hem para harcar. Giriş günü
 * yapılan atamada ve içerideki misafirin taşınmasında gönderilir.
 *
 * @param {string} trigger
 * @param {{ status: string, checkIn: Date | string }} reservation
 * @param {Date} businessDate otelin bugünü (UTC gün başı)
 * @returns {string | null}
 */
export function triggerSkipReason(trigger, reservation, businessDate) {
  switch (trigger) {
    case 'RESERVATION_CONFIRMED':
      // Opsiyonlu rezervasyon kesin değildir; onay bildirimi onaylanınca gider
      // (`reservation.confirmed`).
      if (reservation.status === 'PENDING') return 'Opsiyonlu rezervasyon; onaylanınca gönderilir';
      return NO_CONFIRMATION_STATUSES.has(reservation.status) ? `Rezervasyon durumu uygun değil (${reservation.status})` : null;
    case 'ROOM_ASSIGNED':
      if (reservation.status === 'CHECKED_IN') return null;
      if (!ARRIVING_STATUSES.has(reservation.status)) return `Rezervasyon durumu uygun değil (${reservation.status})`;
      return toIsoDay(reservation.checkIn) === toIsoDay(businessDate)
        ? null
        : 'Giriş günü değil; oda bilgisi giriş günü gönderilir';
    case 'CHECKED_IN':
      return reservation.status === 'CHECKED_IN' ? null : 'Misafir içeride değil';
    case 'CHECKED_OUT':
      return reservation.status === 'CHECKED_OUT' ? null : 'Misafir çıkış yapmamış';
    default:
      return 'Bilinmeyen tetikleyici';
  }
}

/**
 * Aynı olay için ikinci bildirimi engelleyen anahtar. Oda bilgisinde oda da
 * anahtarda: misafir başka odaya taşınırsa yeni oda bildirilir.
 *
 * @param {string} trigger
 * @param {{ reservationId: string, roomId?: string | null }} subject
 * @param {string} channel
 */
export function notificationDedupeKey(trigger, { reservationId, roomId }, channel) {
  const parts = [trigger, reservationId];
  if (trigger === 'ROOM_ASSIGNED') parts.push(roomId ?? '-');
  parts.push(channel);
  return parts.join(':');
}

/** "2026-09-14" → "14.09.2026" */
function dottedDay(value) {
  const [year, month, day] = toIsoDay(value).split('-');
  return `${day}.${month}.${year}`;
}

/**
 * Şablon değişkenleri.
 *
 * @param {{
 *   hotel: { name: string, phone?: string | null, checkInTime: string, checkOutTime: string },
 *   reservation: { confirmationCode: string, checkIn: Date, checkOut: Date },
 *   guest: { firstName: string, lastName: string },
 *   roomTypeName?: string | null,
 *   roomNumber?: string | null,
 *   today: Date,
 * }} context
 * @returns {Record<string, string>}
 */
export function stayVariables({ hotel, reservation, guest, roomTypeName, roomNumber, today }) {
  return {
    misafirAdi: `${guest.firstName} ${guest.lastName}`.trim(),
    otelAdi: hotel.name,
    otelTelefonu: hotel.phone ?? '',
    onayKodu: reservation.confirmationCode,
    girisTarihi: dottedDay(reservation.checkIn),
    cikisTarihi: dottedDay(reservation.checkOut),
    geceSayisi: String(nightCount(reservation.checkIn, reservation.checkOut)),
    girisSaati: hotel.checkInTime,
    cikisSaati: hotel.checkOutTime,
    odaTipi: roomTypeName ?? '',
    odaNo: roomNumber ?? '',
    tarih: dottedDay(today),
  };
}

/**
 * SMS'e girecek değişken değerleri: gönderilemeyen harfler en yakın
 * karşılığına çevrilir (misafir adı "Łukasz" → "Lukasz").
 * @param {Record<string, string>} values
 */
export function smsSafeVariables(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, sanitizeSmsValue(value)]));
}

/**
 * Misafir kartından kanal adresi.
 *
 * @param {string} channel
 * @param {{ email?: string | null, phone?: string | null }} guest
 * @param {string | null | undefined} countryCode otelin telefon ülke kodu
 * @returns {string | null}
 */
export function recipientFor(channel, guest, countryCode) {
  if (channel === 'EMAIL') {
    const email = String(guest.email ?? '').trim().toLowerCase();
    return EMAIL_PATTERN.test(email) ? email : null;
  }
  if (channel === 'SMS' || channel === 'WHATSAPP') return internationalPhone(guest.phone, countryCode);
  return null;
}

/**
 * Misafir bu kanaldan bildirim istemiyor mu?
 *
 * Sözleşme (misafir kartı, modül 22): `Guest.preferences.notifications.optOut`
 * kanal adlarının dizisi, ör. `["SMS"]`.
 *
 * @param {unknown} preferences
 * @param {string} channel
 */
export function guestOptedOut(preferences, channel) {
  const optOut = /** @type {{ notifications?: { optOut?: unknown } }} */ (preferences ?? {})?.notifications?.optOut;
  return Array.isArray(optOut) && optOut.includes(channel);
}

/**
 * Personele bırakılan işin uyarısını kim görür: işin modülüne göre izin.
 * Tanımsız modül yönetime düşer.
 */
const MANUAL_TASK_PERMISSIONS = Object.freeze({
  'Oda atama': 'rooms.operate',
  'Bildirim merkezi': 'notifications.manage',
  Rezervasyon: 'reservations.manage',
  'Onay kuyruğu': 'approvals.decide',
});

export const MANUAL_TASK_FALLBACK_PERMISSION = 'settings.manage';

/** @param {string} module */
export function manualTaskPermission(module) {
  return MANUAL_TASK_PERMISSIONS[module] ?? MANUAL_TASK_FALLBACK_PERMISSION;
}

/** Aynı günün aynı kanal+hata uyarıları tek uyarıda toplanır. */
export function failureAlertKey(channel, errorCode, day) {
  return `notification-failed:${channel}:${errorCode ?? 'UNKNOWN'}:${toIsoDay(day)}`;
}

/**
 * SMS kanal ayarındaki sessiz saatler (`quietHoursRelease` biçiminde).
 * @param {{ quietHoursStart?: string | null, quietHoursEnd?: string | null } | null | undefined} settings
 */
export function smsQuietHours(settings) {
  return { start: settings?.quietHoursStart ?? null, end: settings?.quietHoursEnd ?? null };
}
