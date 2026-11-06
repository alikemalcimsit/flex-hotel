/**
 * Misafir uygulamasının sınırları. Sözleşmeyle (`@hotelos/hotel-contracts`, `guest-portal.js`) aynıdır; misafir
 * paketine zod ve bütün şemalar inmesin diye burada tekrar edilir — `src/lib/guestLimits.test.js` ikisini karşılaştırır.
 */
export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_MAX_BYTES = 1_500_000;
export const THUMB_MAX_EDGE = 320;
export const THUMB_MAX_BYTES = 60_000;
export const MAX_PHOTOS_PER_PERSON = 2;
export const SIGNATURE_MAX_BYTES = 200_000;
export const PORTAL_LANGUAGES = Object.freeze(['tr', 'en', 'de', 'ru']);
export const PAYMENT_PREFERENCES = Object.freeze(['CARD_AT_DESK', 'CASH_AT_DESK', 'PREPAID', 'COMPANY']);
export const REQUEST_CATEGORIES = Object.freeze(['HOUSEKEEPING', 'AMENITY', 'MAINTENANCE', 'ROOM_SERVICE', 'WAKE_UP', 'TRANSPORT', 'INFORMATION', 'COMPLAINT', 'OTHER']);
export const ID_TYPES = Object.freeze(['NATIONAL_ID', 'PASSPORT', 'OTHER']);
/** Oda servisi (41): bir siparişte en fazla kalem, aynı anda en fazla açık sipariş. */
export const MAX_ORDER_LINES = 15;
export const MAX_ACTIVE_ORDERS = 3;

/**
 * Belge numarası kuralı (sözleşmedeki `identityNumberError` ile aynı): Türk vatandaşının kimlik kartında TC kimlik
 * numarası (sağlamalı), diğerlerinde 5–20 harf / rakam.
 * @param {{ idType: string, idNumber: string, nationality: string }} identity
 * @returns {null | 'TCKN' | 'FORMAT'}
 */
export function idNumberProblem({ idType, idNumber, nationality }) {
  const number = String(idNumber ?? '').toLocaleUpperCase('tr').replace(/İ/g, 'I').replace(/[\s-]/g, '');
  if (idType === 'NATIONAL_ID' && nationality === 'TR') return isValidTckn(number) ? null : 'TCKN';
  return /^[A-Z0-9]{5,20}$/.test(number) ? null : 'FORMAT';
}

/** @param {string} value */
export function isValidTckn(value) {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const odd = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const even = digits[1] + digits[3] + digits[5] + digits[7];
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  const eleventh = digits.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10;
  return digits[9] === tenth && digits[10] === eleventh;
}
