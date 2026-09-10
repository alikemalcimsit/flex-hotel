/**
 * Ayarlar modülünün saf iş kuralları — veritabanı, HTTP veya Prisma bilmez.
 *
 * Buradaki kurallar, girdinin *şeklini* değil *bağlamını* denetleyenlerdir:
 * bir sezonun diğerleriyle çakışıp çakışmadığı ancak mevcut sezonlar bilinerek
 * söylenebilir. Alan bazlı kurallar (zorunluluk, biçim, aralık) ise
 * `@hotelos/hotel-contracts` içindeki zod şemalarında — orası hem sunucunun
 * hem tarayıcının okuduğu tek kaynak.
 *
 * `rules.test.js` bunları veritabanı olmadan doğrular.
 */

import { ValidationError } from '../../lib/errors.js';

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
 * Gün bazlı karşılaştırma için tarihi UTC gün başına indirger.
 * Sezonlar "gün" kavramıdır; saat farkı yüzünden bir günlük kayma olmasın diye
 * karşılaştırma öncesi normalize edilir.
 * @param {Date | string} value
 * @returns {number} epoch ms (UTC gün başı)
 */
export function toUtcDayStart(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError('Geçersiz tarih');
  }
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * İki tarih aralığı kesişiyor mu? Aralıklar iki uçtan da kapalıdır:
 * 01-10 Haziran ile 10-20 Haziran çakışır (10 Haziran ikisinde de var), çünkü
 * o gün için hangi çarpanın geçerli olduğu belirsiz kalır.
 *
 * Bu kural veritabanında da var (Season üzerindeki EXCLUDE kısıtı, `[]` kapalı
 * aralık). Buradaki kopya kullanıcıya anlaşılır hata mesajı vermek için;
 * garantiyi veritabanı sağlıyor.
 *
 * @param {{ startDate: Date | string, endDate: Date | string }} a
 * @param {{ startDate: Date | string, endDate: Date | string }} b
 * @returns {boolean}
 */
export function rangesOverlap(a, b) {
  const aStart = toUtcDayStart(a.startDate);
  const aEnd = toUtcDayStart(a.endDate);
  const bStart = toUtcDayStart(b.startDate);
  const bEnd = toUtcDayStart(b.endDate);
  return aStart <= bEnd && bStart <= aEnd;
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
  const start = toUtcDayStart(checkIn);
  const end = toUtcDayStart(checkOut);
  if (end <= start) return [];

  const nights = [];
  const dayMs = 24 * 60 * 60 * 1000;
  for (let day = start; day < end; day += dayMs) {
    const date = new Date(day);
    nights.push({ date, multiplier: resolveMultiplierForDate(seasons, date) });
  }
  return nights;
}
