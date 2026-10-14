import { createHash } from 'node:crypto';
import { toMoneyString } from '@hotelos/core';
import { icalReservationCode } from './ical.js';

/**
 * Kanaldan gelen rezervasyonun ortak biçimi. Channex revizyonu da iCal kaydı da
 * buna çevrilip saklanır; rezervasyonu açan / değiştiren servis yalnızca bunu
 * bilir. Kart bilgisi (Channex `guarantee`) hiçbir zaman kopyalanmaz.
 *
 * @typedef {{
 *   externalRoomTypeId: string | null,
 *   externalRatePlanId: string | null,
 *   roomMappingId: string | null,
 *   checkIn: string,
 *   checkOut: string,
 *   adults: number,
 *   children: number,
 *   amount: string | null,
 * }} NormalizedRoom
 *
 * @typedef {{
 *   source: 'CHANNEX' | 'ICAL',
 *   kind: 'NEW' | 'MODIFIED' | 'CANCELLED',
 *   status: 'ACTIVE' | 'CANCELLED',
 *   externalBookingId: string,
 *   externalRevisionId: string,
 *   occurredAt: string,
 *   externalCode: string | null,
 *   otaName: string | null,
 *   guest: { firstName: string | null, lastName: string | null, email: string | null, phone: string | null, country: string | null },
 *   rooms: NormalizedRoom[],
 *   checkIn: string | null,
 *   checkOut: string | null,
 *   amount: string | null,
 *   currency: string | null,
 *   notes: string | null,
 *   paymentCollect: 'OTA' | 'PROPERTY' | null,
 *   priceKnown: boolean,
 * }} NormalizedBooking
 */

/** Kanaldan gelen bir rezervasyonda en fazla oda (fazlası bozuk kayıt sayılır). */
export const MAX_CHANNEL_BOOKING_ROOMS = 50;

const KINDS = Object.freeze({ new: 'NEW', modified: 'MODIFIED', cancelled: 'CANCELLED' });

/** @param {unknown} value @param {number} max */
function text(value, max) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** "2027-06-01" mi? @param {unknown} value */
function day(value) {
  if (typeof value !== 'string') return null;
  const candidate = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const time = Date.parse(`${candidate}T00:00:00.000Z`);
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== candidate ? null : candidate;
}

/** Tutar metni → "180.00"; geçersizse null. @param {unknown} value */
function amount(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = typeof value === 'number' ? String(value) : String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  return toMoneyString(raw);
}

/** @param {unknown} value @param {number} fallback */
function count(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 20 ? number : fallback;
}

/** Saat dilimsiz zaman damgası UTC sayılır. @param {unknown} value */
function instant(value) {
  if (typeof value !== 'string' || !value) return null;
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const time = Date.parse(withZone);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** Kanal kaydı bozuk: saklanmaz, teyit edilmez; log'a yazılır. */
export class InvalidChannelBookingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidChannelBookingError';
  }
}

/**
 * Channex revizyonu → ortak biçim.
 * @param {Record<string, any>} raw revizyonun `attributes`'u (`id` dahil)
 * @returns {NormalizedBooking}
 */
export function normalizeChannexRevision(raw) {
  const kind = KINDS[String(raw?.status ?? '').toLowerCase()];
  const externalRevisionId = text(raw?.id ?? raw?.revision_id, 100);
  const externalBookingId = text(raw?.booking_id, 100);
  if (!externalRevisionId || !externalBookingId) throw new InvalidChannelBookingError('Revizyonun ya da rezervasyonun kimliği yok');
  if (!kind) throw new InvalidChannelBookingError(`Bilinmeyen revizyon durumu: ${raw?.status}`);

  const rawRooms = Array.isArray(raw.rooms) ? raw.rooms : [];
  if (rawRooms.length > MAX_CHANNEL_BOOKING_ROOMS) throw new InvalidChannelBookingError(`Rezervasyonda ${rawRooms.length} oda var (en fazla ${MAX_CHANNEL_BOOKING_ROOMS})`);
  const bookingIn = day(raw.arrival_date);
  const bookingOut = day(raw.departure_date);
  const rooms = rawRooms.map((room, index) => {
    const checkIn = day(room?.checkin_date) ?? bookingIn;
    const checkOut = day(room?.checkout_date) ?? bookingOut;
    if (!checkIn || !checkOut || checkOut <= checkIn) throw new InvalidChannelBookingError(`${index + 1}. odanın tarihleri geçersiz`);
    return {
      externalRoomTypeId: text(room?.room_type_id, 100),
      externalRatePlanId: text(room?.rate_plan_id, 100),
      roomMappingId: null,
      checkIn,
      checkOut,
      adults: Math.max(1, count(room?.occupancy?.adults, 1)),
      children: count(room?.occupancy?.children, 0),
      amount: amount(room?.amount),
    };
  });
  if (kind !== 'CANCELLED' && rooms.length === 0) throw new InvalidChannelBookingError('Rezervasyonda oda yok');

  const customer = raw.customer ?? {};
  const country = text(customer.country, 2);
  const collect = String(raw.payment_collect ?? '').toLowerCase();
  const currency = text(raw.currency, 3)?.toUpperCase() ?? null;
  return {
    source: 'CHANNEX',
    kind,
    status: kind === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE',
    externalBookingId,
    externalRevisionId,
    occurredAt: instant(raw.inserted_at) ?? new Date().toISOString(),
    externalCode: text(raw.ota_reservation_code ?? raw.unique_id, 100),
    otaName: text(raw.ota_name, 60),
    guest: {
      firstName: text(customer.name, 100),
      lastName: text(customer.surname, 100),
      email: text(customer.mail, 200),
      phone: text(customer.phone, 40),
      country: country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null,
    },
    rooms,
    checkIn: bookingIn ?? rooms[0]?.checkIn ?? null,
    checkOut: bookingOut ?? rooms.at(-1)?.checkOut ?? null,
    amount: amount(raw.amount),
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
    notes: text(raw.notes, 1000),
    paymentCollect: collect === 'ota' ? 'OTA' : collect === 'property' ? 'PROPERTY' : null,
    priceKnown: true,
  };
}

/** Takvimin geldiği yerin adı (misafir adı ve not için). */
export const ICAL_PROVIDER_NAMES = Object.freeze({ AIRBNB: 'Airbnb', BOOKING: 'Booking.com', OTHER: 'Takvim' });

/**
 * iCal kaydının durumundan kararlı revizyon kimliği: aynı hâl her okumada aynı
 * kimliği verir (ikinci kez saklanmaz), değişince yeni revizyon olur.
 * @param {string[]} parts
 */
export function icalRevisionId(parts) {
  return `ical-${createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 40)}`;
}

/**
 * iCal kaydı (ya da takvimden kalkması) → ortak biçim. iCal misafir adı, kişi
 * sayısı ve fiyat taşımaz: misafir "Airbnb misafiri", 1 yetişkin, fiyat bilinmiyor.
 *
 * Revizyon kimliği kaydın hâlinden ve bir önceki revizyondan türetilir: aynı hâl
 * aynı kimliği verir (ikinci kez saklanmaz), iptalden sonra aynı tarihlerle
 * yeniden görünen kayıt ise yeni bir revizyondur (yeniden açılır).
 *
 * @param {{
 *   mappingId: string,
 *   provider: 'AIRBNB' | 'BOOKING' | 'OTHER',
 *   event: { uid: string, start: string, end: string, description?: string },
 *   kind: 'NEW' | 'MODIFIED' | 'CANCELLED',
 *   previousRevisionId?: string | null,
 *   now?: Date,
 * }} input
 * @returns {NormalizedBooking}
 */
export function normalizeIcalEvent({ mappingId, provider, event, kind, previousRevisionId = null, now = new Date() }) {
  const providerName = ICAL_PROVIDER_NAMES[provider] ?? ICAL_PROVIDER_NAMES.OTHER;
  const code = icalReservationCode(event.description ?? '');
  const status = kind === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE';
  return {
    source: 'ICAL',
    kind,
    status,
    externalBookingId: `${mappingId}:${event.uid}`.slice(0, 300),
    externalRevisionId: icalRevisionId([mappingId, event.uid, event.start, event.end, status, previousRevisionId ?? 'ilk']),
    occurredAt: now.toISOString(),
    externalCode: code,
    otaName: providerName,
    guest: { firstName: providerName, lastName: code ? `misafiri ${code}` : 'misafiri', email: null, phone: null, country: null },
    rooms: [
      {
        externalRoomTypeId: null,
        externalRatePlanId: null,
        roomMappingId: mappingId,
        checkIn: event.start,
        checkOut: event.end,
        adults: 1,
        children: 0,
        amount: null,
      },
    ],
    checkIn: event.start,
    checkOut: event.end,
    amount: null,
    currency: null,
    notes: null,
    paymentCollect: null,
    priceKnown: false,
  };
}
