import { DAY_MS, toDecimal, toMoneyString } from '@hotelos/core';

/**
 * Kanala giden müsaitlik / fiyat / stop-sale (ARI) değerlerinin saf hesabı —
 * veritabanı ve HTTP bilmez.
 *
 * Gönderim "fark" ile yapılır: penceredeki istenen değerler, kanala en son
 * başarıyla gönderilen değerlerle karşılaştırılır; yalnızca değişen günler,
 * ardışık aynı değerler tek aralığa sıkıştırılarak gönderilir. Böylece bir
 * rezervasyon 500 günlük takvimde tek bir aralık gönderir, gece boyunca hiçbir
 * şey değişmediyse hiçbir şey gönderilmez.
 *
 * Değerler günlük sözlükte tutulur ("YYYY-MM-DD" → değer):
 * - müsaitlik: tam sayı (eksi değer — overbooking — kanala 0 gider),
 * - fiyat planı: `"1150.00|0"` (fiyat | stop-sale) — tek metin, karşılaştırması kolay.
 */

/** "2027-06-01" + n gün. */
export function addIsoDays(day, days) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Pencerenin günleri: `from` dahil, `to` hariç.
 * @param {string} from
 * @param {string} to
 * @returns {string[]}
 */
export function windowDays(from, to) {
  const days = [];
  for (let day = from; day < to; day = addIsoDays(day, 1)) days.push(day);
  return days;
}

/**
 * Kanalın fiyatı: liste fiyatı × (1 + fark / 100), kuruşa yuvarlanır. Kanal 0'dan
 * büyük fiyat ister: sonuç 0.01'in altındaysa 0.01.
 *
 * @param {string | number} listPrice
 * @param {string | number} markupPercent
 * @returns {string}
 */
export function channelRate(listPrice, markupPercent) {
  const rate = toDecimal(listPrice).times(toDecimal(markupPercent).plus(100)).dividedBy(100);
  const rounded = toMoneyString(rate);
  return toDecimal(rounded).lessThan('0.01') ? '0.01' : rounded;
}

/** Kanala giden müsaitlik: boş oda sayısı; overbooking (eksi) 0 olarak gider. */
export function channelAvailability(free) {
  return Math.max(0, Math.trunc(Number(free) || 0));
}

/** @param {{ rate: string, stopSell: boolean }} value */
export function encodeRestriction({ rate, stopSell }) {
  return `${rate}|${stopSell ? 1 : 0}`;
}

/** @param {string} value */
export function decodeRestriction(value) {
  const [rate, stop] = String(value).split('|');
  return { rate, stopSell: stop === '1' };
}

/**
 * Değişen günler: istenen değerden farklı olan ya da hiç gönderilmemiş günler.
 *
 * @template V
 * @param {Record<string, V>} desired pencere (gün → değer)
 * @param {Record<string, V>} sent en son gönderilenler
 * @returns {Array<[string, V]>} gün sırasıyla
 */
export function changedDays(desired, sent) {
  return Object.keys(desired)
    .sort()
    .filter((day) => !Object.hasOwn(sent, day) || sent[day] !== desired[day])
    .map((day) => [day, desired[day]]);
}

/**
 * Ardışık günlerde aynı değeri tek aralıkta toplar (iki uç dahil).
 *
 * @template V
 * @param {Array<[string, V]>} entries gün sırasıyla
 * @returns {Array<{ from: string, to: string, value: V }>}
 */
export function compressRanges(entries) {
  const ranges = [];
  for (const [day, value] of entries) {
    const last = ranges.at(-1);
    if (last && last.value === value && addIsoDays(last.to, 1) === day) {
      last.to = day;
    } else {
      ranges.push({ from: day, to: day, value });
    }
  }
  return ranges;
}

/**
 * Gönderilmiş değerlerin yeni hâli: gönderilenler yazılır, geçmiş günler atılır
 * (kanal geçmiş günü kabul etmez; durum tablosu büyümesin).
 *
 * @template V
 * @param {Record<string, V>} sent
 * @param {Array<[string, V]>} delivered
 * @param {string} today
 * @returns {Record<string, V>}
 */
export function mergeSent(sent, delivered, today) {
  const next = {};
  for (const [day, value] of Object.entries(sent)) if (day >= today) next[day] = value;
  for (const [day, value] of delivered) if (day >= today) next[day] = value;
  return next;
}

/**
 * İki pencerenin birleşimi (kirli pencere birikir). `null` boş demektir.
 * @param {{ from: string, to: string } | null} a
 * @param {{ from: string, to: string } | null} b
 */
export function unionWindow(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { from: a.from < b.from ? a.from : b.from, to: a.to > b.to ? a.to : b.to };
}

/**
 * Kirli pencereyi kanalın gönderim penceresine kırpar: bugünden (dahil)
 * `today + horizonDays`'e (hariç). Kesişim yoksa `null`.
 *
 * @param {{ from: string, to: string }} window `to` hariç
 * @param {string} today
 * @param {number} horizonDays
 */
export function clampWindow(window, today, horizonDays) {
  const end = addIsoDays(today, horizonDays);
  const from = window.from > today ? window.from : today;
  const to = window.to < end ? window.to : end;
  return from < to ? { from, to } : null;
}

/* ─────────────── Channex gövdeleri ─────────────── */

/**
 * @param {string} propertyId
 * @param {string} roomTypeId Channex oda tipi
 * @param {Array<{ from: string, to: string, value: number }>} ranges
 */
export function availabilityValues(propertyId, roomTypeId, ranges) {
  return ranges.map((range) => ({
    property_id: propertyId,
    room_type_id: roomTypeId,
    date_from: range.from,
    date_to: range.to,
    availability: range.value,
  }));
}

/**
 * @param {string} propertyId
 * @param {string} ratePlanId Channex fiyat planı
 * @param {Array<{ from: string, to: string, value: string }>} ranges değerler `encodeRestriction` biçiminde
 */
export function restrictionValues(propertyId, ratePlanId, ranges) {
  return ranges.map((range) => {
    const { rate, stopSell } = decodeRestriction(range.value);
    return {
      property_id: propertyId,
      rate_plan_id: ratePlanId,
      date_from: range.from,
      date_to: range.to,
      rate,
      stop_sell: stopSell,
    };
  });
}

/**
 * Bir hedefin (oda tipi ya da fiyat planı) gönderim planı: fark (ya da tam
 * eşitlemede pencerenin tamamı), aralıklar ve gönderim sonrası yeni durum.
 *
 * @template V
 * @param {{ desired: Record<string, V>, sent: Record<string, V>, full: boolean }} input
 * @returns {{ days: Array<[string, V]>, ranges: Array<{ from: string, to: string, value: V }> }}
 */
export function planTarget({ desired, sent, full }) {
  const days = full ? Object.keys(desired).sort().map((day) => [day, desired[day]]) : changedDays(desired, sent);
  return { days, ranges: compressRanges(days) };
}
