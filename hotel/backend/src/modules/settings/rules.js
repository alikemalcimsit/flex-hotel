import { eachNight, rangesOverlapClosed, toUtcDayStart as coreToUtcDayStart } from '@hotelos/core';
import { ValidationError } from '../../lib/errors.js';

/**
 * Ayarlar modülünün saf iş kuralları — veritabanı, HTTP veya Prisma bilmez.
 *
 * Buradaki kurallar, girdinin *şeklini* değil *bağlamını* denetleyenlerdir:
 * bir sezonun diğerleriyle çakışıp çakışmadığı ancak mevcut sezonlar bilinerek
 * söylenebilir. Alan bazlı kurallar (zorunluluk, biçim, aralık)
 * `@hotelos/hotel-contracts` içindeki zod şemalarında.
 *
 * Tarih aritmetiği `@hotelos/core/dates.js`'te. Sezonlar **iki uçtan kapalı**
 * `[]` aralıktır (1-10 ile 10-20 çakışır); konaklamalar ise yarı açık `[)`.
 * İkisi bilerek farklı ve orada yan yana duruyor.
 */

/**
 * Gün başına indirger; geçersiz tarihi 422 olarak yüzeye çıkarır.
 * @param {Date | string} value
 * @returns {number}
 */
export function toUtcDayStart(value) {
  try {
    return coreToUtcDayStart(value);
  } catch {
    throw new ValidationError('Geçersiz tarih');
  }
}

/**
 * IANA saat dilimi geçerli mi? (Intl'e soruyoruz, elle liste tutmuyoruz.)
 * @param {string} value
 * @returns {boolean}
 */
export function isValidTimeZone(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * İki sezon aralığı kesişiyor mu? İki uçtan kapalı: 1-10 Haziran ile 10-20
 * Haziran çakışır, çünkü 10 Haziran'a hangi çarpanın düştüğü belirsiz kalır.
 *
 * Bu kural veritabanında da var (`Season_no_overlap` EXCLUDE kısıtı).
 * Buradaki kopya kullanıcıya anlaşılır hata mesajı vermek için; garantiyi
 * veritabanı sağlıyor.
 *
 * @param {{ startDate: Date | string, endDate: Date | string }} a
 * @param {{ startDate: Date | string, endDate: Date | string }} b
 * @returns {boolean}
 */
export function rangesOverlap(a, b) {
  return rangesOverlapClosed(a, b);
}

/**
 * Yeni/güncellenen sezonun mevcutlarla çakışmadığını doğrular.
 * @param {Array<{ id: string, name: string, startDate: Date | string, endDate: Date | string }>} existing
 * @param {{ id?: string, startDate: Date | string, endDate: Date | string }} candidate
 */
export function assertNoOverlap(existing, candidate) {
  const clash = existing.find((season) => season.id !== candidate.id && rangesOverlap(season, candidate));
  if (clash) {
    throw new ValidationError(
      `Bu tarih aralığı "${clash.name}" sezonuyla çakışıyor. Aynı güne iki sezon çarpanı düşemez.`,
      { conflictingSeasonId: clash.id, conflictingSeasonName: clash.name },
    );
  }
}

/**
 * Verilen güne düşen sezonu bulur. Fiyat hesabının (modül 4) doğrudan
 * kullanacağı fonksiyon: çakışma veritabanı seviyesinde engellendiği için
 * en fazla bir sonuç olur.
 * @template {{ startDate: Date | string, endDate: Date | string }} T
 * @param {T[]} seasons
 * @param {Date | string} date
 * @returns {T | null}
 */
export function findSeasonForDate(seasons, date) {
  const day = toUtcDayStart(date);
  return seasons.find((season) => toUtcDayStart(season.startDate) <= day && day <= toUtcDayStart(season.endDate)) ?? null;
}

/**
 * Bir güne uygulanacak fiyat çarpanı. Sezon yoksa 1 (taban fiyat).
 * @param {Array<{ startDate: Date | string, endDate: Date | string, multiplier: string }>} seasons
 * @param {Date | string} date
 * @returns {string} Decimal string
 */
export function resolveMultiplierForDate(seasons, date) {
  return findSeasonForDate(seasons, date)?.multiplier ?? '1';
}

/**
 * Bir konaklamanın gecelerine düşen çarpanları sırayla verir.
 * Modül 4 gece gece fiyat hesaplarken bunu kullanacak: 3 gecelik konaklamanın
 * ortasında sezon değişiyorsa her gece kendi çarpanını almalı.
 *
 * @param {Array<{ startDate: Date | string, endDate: Date | string, multiplier: string }>} seasons
 * @param {Date | string} checkIn
 * @param {Date | string} checkOut Çıkış günü dahil değildir (o gece konaklanmaz)
 * @returns {Array<{ date: Date, multiplier: string }>}
 */
export function multipliersForStay(seasons, checkIn, checkOut) {
  return eachNight(checkIn, checkOut).map((date) => ({
    date,
    multiplier: resolveMultiplierForDate(seasons, date),
  }));
}
