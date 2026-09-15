/**
 * Gün seviyesinde tarih aritmetiği.
 *
 * Otel yazılımında iki farklı aralık semantiği yan yana yaşar ve karıştırmak
 * sessizce yanlış para/oda hesabı demektir:
 *
 * - **Sezonlar `[]` (iki uçtan kapalı):** 1-10 Haziran sezonu 10 Haziran'ı da
 *   kapsar. 1-10 ile 10-20 sezonları ÇAKIŞIR — 10 Haziran'a iki çarpan düşemez.
 * - **Konaklama ve bloklar `[)` (yarı açık):** 15-18 rezervasyonu 15, 16, 17
 *   gecelerini tutar; 18'de oda boşalır. 15-18 ile 18-20 ÇAKIŞMAZ — misafir
 *   çıkar, yenisi aynı gün girer.
 *
 * İkisi ayrı fonksiyon olarak duruyor ki çağıran hangisini kullandığını
 * bilerek seçsin.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Tarihi UTC gün başına indirger.
 *
 * Rezervasyonlar saat de taşır (giriş 14:00, çıkış 12:00) ama müsaitlik "gece"
 * kavramıyla çalışır. Karşılaştırmadan önce saat bilgisi atılmazsa aynı günün
 * 14:00'ı ile 12:00'ı farklı sayılır ve bir günlük kaymalar başlar.
 *
 * @param {Date | string | number} value
 * @returns {number} epoch ms (UTC gün başı)
 * @throws {RangeError} geçersiz tarih
 */
export function toUtcDayStart(value) {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    throw new RangeError(`Geçersiz tarih: ${JSON.stringify(value)}`);
  }
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * `YYYY-MM-DD` biçimi (gün anahtarı olarak kullanılır).
 * @param {Date | string | number} value
 * @returns {string}
 */
export function toIsoDay(value) {
  return new Date(toUtcDayStart(value)).toISOString().slice(0, 10);
}

/**
 * İki uçtan kapalı `[]` aralık çakışması — sezonlar için.
 * @param {{ startDate: Date | string, endDate: Date | string }} a
 * @param {{ startDate: Date | string, endDate: Date | string }} b
 * @returns {boolean}
 */
export function rangesOverlapClosed(a, b) {
  const aStart = toUtcDayStart(a.startDate);
  const aEnd = toUtcDayStart(a.endDate);
  const bStart = toUtcDayStart(b.startDate);
  const bEnd = toUtcDayStart(b.endDate);
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Yarı açık `[)` aralık çakışması — konaklamalar ve oda blokları için.
 *
 * `end` `null`/`undefined` ise aralık üstten sınırsızdır (süresiz blok).
 *
 * @param {{ start: Date | string, end?: Date | string | null }} a
 * @param {{ start: Date | string, end?: Date | string | null }} b
 * @returns {boolean}
 */
export function rangesOverlapHalfOpen(a, b) {
  const aStart = toUtcDayStart(a.start);
  const bStart = toUtcDayStart(b.start);
  const aEnd = a.end == null ? Number.POSITIVE_INFINITY : toUtcDayStart(a.end);
  const bEnd = b.end == null ? Number.POSITIVE_INFINITY : toUtcDayStart(b.end);
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Konaklamanın gecelerini verir: giriş günü dahil, çıkış günü hariç.
 * 15→18 girişi 15, 16, 17 gecelerini döner (3 gece).
 *
 * @param {Date | string} from
 * @param {Date | string} to
 * @returns {Date[]} UTC gün başlangıçları
 */
export function eachNight(from, to) {
  const start = toUtcDayStart(from);
  const end = toUtcDayStart(to);
  const nights = [];
  for (let day = start; day < end; day += DAY_MS) {
    nights.push(new Date(day));
  }
  return nights;
}

/**
 * Giriş ve çıkış arasındaki gece sayısı. Aynı gün giriş-çıkış → 0.
 * @param {Date | string} checkIn
 * @param {Date | string} checkOut
 * @returns {number}
 */
export function nightCount(checkIn, checkOut) {
  const nights = (toUtcDayStart(checkOut) - toUtcDayStart(checkIn)) / DAY_MS;
  return nights > 0 ? nights : 0;
}

/**
 * Gün ekler (UTC gün başına hizalı).
 * @param {Date | string} value
 * @param {number} days
 * @returns {Date}
 */
export function addDays(value, days) {
  return new Date(toUtcDayStart(value) + days * DAY_MS);
}

/** Saat dilimi başına tek biçimlendirici — `Intl` nesnesi kurmak pahalı. */
const dayFormatters = new Map();

/** @param {string} timeZone */
function dayFormatterFor(timeZone) {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    // en-CA sabit sıralı parçalar verir; yerel ayara göre gün/ay yer değiştirmez.
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Bir anın, verilen saat dilimindeki takvim günü.
 *
 * "Bugün" sunucunun saatine (UTC) göre hesaplanırsa İstanbul'da gece
 * 00:00–03:00 arası sistem dünü bugün sanır — gece kapanışının yapıldığı saat
 * tam o aralıktır. Otelin günü otelin saat diliminden okunmalı.
 *
 * Dönen değer o yerel günün **UTC gün başıdır**; böylece konaklama ve blok
 * tarihleriyle (onlar da UTC gün başı) doğrudan karşılaştırılabilir.
 *
 * @param {string} timeZone IANA saat dilimi (ör. Europe/Istanbul)
 * @param {Date | string | number} [instant]
 * @returns {Date}
 * @throws {RangeError} geçersiz saat dilimi veya tarih
 */
export function calendarDateInTimeZone(timeZone, instant = new Date()) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Geçersiz tarih: ${JSON.stringify(instant)}`);
  }
  const parts = dayFormatterFor(timeZone).formatToParts(date);
  const valueOf = (type) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(valueOf('year'), valueOf('month') - 1, valueOf('day')));
}

export { DAY_MS };
