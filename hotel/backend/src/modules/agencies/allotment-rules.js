import { eachNight, toIsoDay, toUtcDayStart } from '@hotelos/core';

/**
 * Allotment kuralları (modül 30) — veritabanı ve saat bilmez; "bugün"
 * (otelin iş günü) dışarıdan verilir.
 *
 * Kota bir **garantidir, tavan değil**: acentenin kotası dolunca satış genel
 * havuzdan devam eder (hiç düşüm kalmaz, genel müsaitlik kuralı geçerlidir).
 * Genel satış ise release tarihine kadar başka acentelerin **kullanılmamış**
 * kotasını göremez.
 */

const DAY_MS = 86_400_000;

/**
 * Bir gece bu kota satırınca hâlâ tutuluyor mu? Release tarihi = giriş gecesi −
 * `releaseDays`; o günden itibaren (dahil) kota serbesttir. `releaseDays = 0`
 * giriş gününe kadar tutar (giriş günü serbest: same-day satış herkese açık).
 *
 * @param {{ startDate: Date | string, endDate: Date | string, releaseDays: number }} allotment
 * @param {number} dayMs gecenin UTC gün başı (epoch ms)
 * @param {number} todayMs otel gününün UTC gün başı (epoch ms)
 */
export function isNightHeld(allotment, dayMs, todayMs) {
  if (dayMs < toUtcDayStart(allotment.startDate) || dayMs > toUtcDayStart(allotment.endDate)) return false;
  return todayMs < dayMs - allotment.releaseDays * DAY_MS;
}

/**
 * Satış bağlamı için gece gece tutulan kota: `{ [roomTypeId]: { [gün]: adet } }`.
 *
 * Tutulan = Σ (kota − o acentenin kullandığı), yalnızca release edilmemiş
 * geceler; satışı yapan acentenin kendi kotası düşülmez (kendi kotasını
 * kullanıyor). Kullanım türetilir: acentenin aynı oda tipinde o geceyi
 * kapsayan, envanter tüketen rezervasyonları.
 *
 * @param {object} args
 * @param {Array<{ agencyId: string, roomTypeId: string, startDate: Date | string, endDate: Date | string, quantity: number, releaseDays: number, deletedAt?: Date | null }>} args.allotments
 * @param {Array<{ agencyId: string | null, roomTypeId: string, checkIn: Date | string, checkOut: Date | string }>} args.agencyStays acenteli, envanter tüketen konaklamalar
 * @param {string | null} [args.saleAgencyId] satışı yapan acente (genel satışta null)
 * @param {string[]} args.days pencerenin günleri ("YYYY-MM-DD")
 * @param {Date | string} args.today otelin iş günü
 * @returns {Record<string, Record<string, number>>}
 */
export function allotmentHolds({ allotments, agencyStays, saleAgencyId = null, days, today }) {
  const active = allotments.filter((row) => !row.deletedAt && row.agencyId !== saleAgencyId);
  if (active.length === 0 || days.length === 0) return {};
  const todayMs = toUtcDayStart(today);

  // Kullanım: acente + oda tipi + gece → rezervasyon sayısı.
  const usage = new Map();
  for (const stay of agencyStays) {
    if (!stay.agencyId) continue;
    for (const night of eachNight(stay.checkIn, stay.checkOut)) {
      const key = `${stay.agencyId}|${stay.roomTypeId}|${toIsoDay(night)}`;
      usage.set(key, (usage.get(key) ?? 0) + 1);
    }
  }

  const holds = {};
  for (const row of active) {
    for (const day of days) {
      const dayMs = toUtcDayStart(day);
      if (!isNightHeld(row, dayMs, todayMs)) continue;
      const used = usage.get(`${row.agencyId}|${row.roomTypeId}|${day}`) ?? 0;
      const remaining = Math.max(0, row.quantity - used);
      if (remaining === 0) continue;
      const byDay = (holds[row.roomTypeId] ??= {});
      byDay[day] = (byDay[day] ?? 0) + remaining;
    }
  }
  return holds;
}

/**
 * Kota kullanım tablosu (ekran): bir kota satırının gün gün durumu.
 *
 * @param {{ startDate: Date | string, endDate: Date | string, quantity: number, releaseDays: number, agencyId: string, roomTypeId: string }} allotment
 * @param {Array<{ agencyId: string | null, roomTypeId: string, checkIn: Date | string, checkOut: Date | string }>} agencyStays
 * @param {Date | string} today
 * @returns {Array<{ day: string, given: number, used: number, remaining: number, released: boolean }>}
 */
export function allotmentUsage(allotment, agencyStays, today) {
  const todayMs = toUtcDayStart(today);
  const usage = new Map();
  for (const stay of agencyStays) {
    if (stay.agencyId !== allotment.agencyId || stay.roomTypeId !== allotment.roomTypeId) continue;
    for (const night of eachNight(stay.checkIn, stay.checkOut)) {
      const day = toIsoDay(night);
      usage.set(day, (usage.get(day) ?? 0) + 1);
    }
  }
  // Dönem iki uçtan kapalı: son gece dahil.
  const days = eachNight(allotment.startDate, toUtcDayStart(allotment.endDate) + DAY_MS).map(toIsoDay);
  return days.map((day) => {
    const used = usage.get(day) ?? 0;
    return {
      day,
      given: allotment.quantity,
      used,
      remaining: Math.max(0, allotment.quantity - used),
      released: !isNightHeld(allotment, toUtcDayStart(day), todayMs),
    };
  });
}
