import { randomBytes } from 'node:crypto';
import { multiply, sum, toMoneyString } from '@hotelos/core';
import { findSeasonForDate } from '../settings/rules.js';

/**
 * Rezervasyonun saf iş kuralları (modül 4) — veritabanına dokunmaz, test edilir.
 * Para-kritik: fiyat yanlış hesaplanırsa misafirden sessizce yanlış ücret alınır.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Onay kodu alfabesi — karışan harf/rakamlar (0/O, 1/I) çıkarıldı. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;

/** Herhangi bir tarih değerini UTC gün başına indirger. */
export function toUtcDayStart(value) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * checkIn..checkOut arasındaki her gece (yarı-açık `[)` — çıkış gecesi hariç).
 * @param {Date|string} checkIn
 * @param {Date|string} checkOut
 * @returns {Date[]}
 */
export function eachNight(checkIn, checkOut) {
  const end = toUtcDayStart(checkOut).getTime();
  const nights = [];
  for (let cursor = toUtcDayStart(checkIn); cursor.getTime() < end; cursor = new Date(cursor.getTime() + DAY_MS)) {
    nights.push(cursor);
  }
  return nights;
}

/**
 * Konaklama fiyatı: her gece taban × o günün sezon çarpanı. Vergi eklenmez
 * (folyo/fatura ayrı, modül 15/16). Her gece kendi satırında yuvarlanır (otelin
 * gerçek gecelik ücreti); toplam bu satırların toplamıdır.
 *
 * @param {{
 *   basePrice: string,
 *   seasons: Array<{ startDate: string|Date, endDate: string|Date, multiplier: string }>,
 *   checkIn: Date|string,
 *   checkOut: Date|string,
 * }} input
 * @returns {{ nights: number, perNight: Array<{ date: string, multiplier: string, amount: string }>, total: string }}
 */
export function computeStayPrice({ basePrice, seasons, checkIn, checkOut }) {
  const perNight = eachNight(checkIn, checkOut).map((night) => {
    const season = findSeasonForDate(seasons ?? [], night);
    const multiplier = season?.multiplier ?? '1';
    return { date: isoDay(night), multiplier, amount: toMoneyString(multiply(basePrice, multiplier)) };
  });
  const total = toMoneyString(perNight.length ? sum(...perNight.map((n) => n.amount)) : '0');
  return { nights: perNight.length, perNight, total };
}

/**
 * Benzersiz onay kodu. 10 karakter × 32 alfabe ≈ 1e15 olasılık; çakışma
 * pratikte imkânsız (yine de kolon UNIQUE — son savunma DB'de).
 * @returns {string}
 */
export function generateConfirmationCode() {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

/**
 * Tek satırlık adı ad/soyad'a böler (Guest tablosu ayrı tutar). Tek kelimeyse
 * soyad boş kalır.
 * @param {string} name
 * @returns {{ firstName: string, lastName: string }}
 */
export function splitGuestName(name) {
  const cleaned = (name ?? '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return { firstName: '', lastName: '' };
  const parts = cleaned.split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}
