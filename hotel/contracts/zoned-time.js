/**
 * Otelin saat dilimindeki "duvar saati" ile gerçek an (UTC) arasında çeviri.
 *
 * ### Neden gerekli
 *
 * Uyandırma "yarın 06:30" diye kurulur; bu 06:30 **otelin** saatidir.
 * Tarayıcının `datetime-local` alanı ise saati bilgisayarın saat dilimiyle
 * yorumlar. Resepsiyon bilgisayarı yanlış dilime ayarlıysa (ya da zincir
 * merkezi başka ülkeden bakıyorsa) misafir bir saat erken ya da geç uyandırılır.
 * Bu yüzden form duvar saatini metin olarak tutar ve buradan geçirir.
 *
 * ### Yaz saati geçişleri
 *
 * Temporal'ın `compatible` kuralı uygulanır:
 * - İleri alınan gecede var olmayan saat (02:30) geçiş kadar **ileri** kayar.
 * - Geri alınan gecede iki kez yaşanan saat için **ilki** seçilir.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const WALL_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Saat dilimi başına tek biçimlendirici (oluşturmak pahalı). */
const formatters = new Map();

/** @param {string} timeZone */
function partsFormatter(timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * @param {number} instant epoch ms
 * @param {string} timeZone
 */
function wallParts(instant, timeZone) {
  const parts = {};
  for (const part of partsFormatter(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts;
}

/**
 * Verilen anda saat diliminin UTC farkı (dakika; İstanbul için +180).
 * @param {number} instant epoch ms
 * @param {string} timeZone
 */
function offsetMinutesAt(instant, timeZone) {
  const p = wallParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const wholeSecond = Math.floor(instant / 1000) * 1000;
  return Math.round((asUtc - wholeSecond) / MINUTE_MS);
}

const pad = (value) => String(value).padStart(2, '0');

/**
 * Bir anın otel saatindeki karşılığı: `"2026-09-17T06:30"` (datetime-local biçimi).
 *
 * @param {Date | string | number} value
 * @param {string} timeZone IANA saat dilimi
 * @returns {string | null}
 */
export function utcToZonedWallTime(value, timeZone) {
  const instant = new Date(value).getTime();
  if (Number.isNaN(instant)) return null;
  const p = wallParts(instant, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Otel saatindeki duvar saatini gerçek ana çevirir.
 *
 * @param {string} wallTime `"YYYY-MM-DDTHH:mm"`
 * @param {string} timeZone IANA saat dilimi
 * @returns {Date | null} biçim bozuksa `null`
 */
export function zonedWallTimeToUtc(wallTime, timeZone) {
  const match = WALL_TIME_PATTERN.exec(wallTime ?? '');
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // Date.UTC taşan değeri düzeltir (31 Şubat → 3 Mart); geçersiz tarih kabul edilmez.
  if (utcToZonedWallTime(wall, 'UTC') !== wallTime) return null;

  // Geçiş varsa ±1 gün içinde tektir: öncesi ve sonrası farkla iki aday.
  const offsetBefore = offsetMinutesAt(wall - DAY_MS, timeZone);
  const offsetAfter = offsetMinutesAt(wall + DAY_MS, timeZone);
  const candidates = [...new Set([wall - offsetBefore * MINUTE_MS, wall - offsetAfter * MINUTE_MS])];
  const valid = candidates.filter((instant) => utcToZonedWallTime(instant, timeZone) === wallTime).sort((a, b) => a - b);

  if (valid.length > 0) return new Date(valid[0]);
  // Var olmayan saat (ileri alma): geçiş öncesi farkla hesaplanan an, geçiş kadar sonrasıdır.
  return new Date(wall - offsetBefore * MINUTE_MS);
}
