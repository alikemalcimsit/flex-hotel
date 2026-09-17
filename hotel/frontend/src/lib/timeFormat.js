/**
 * Otelin saat dilimine göre zaman metinleri (gelen kutusu, istekler).
 *
 * Tarayıcının saat dilimi otelinkinden farklı olabilir (zincir merkezi,
 * yanlış ayarlı bilgisayar). "Bugün 06:30 uyandırma" otelin bugünüdür; bu
 * yüzden bütün biçimlendiriciler saat dilimini açıkça alır.
 */

const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const DAY_MS = MINUTES_PER_DAY * MINUTE_MS;

/** Listede gün adıyla gösterilecek en eski gün farkı (bir hafta içi). */
const WEEKDAY_RANGE_DAYS = 6;

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatters = new Map();

/**
 * @param {string} locale
 * @param {Intl.DateTimeFormatOptions} options
 */
function formatter(locale, options) {
  const key = `${locale}|${JSON.stringify(options)}`;
  let instance = formatters.get(key);
  if (!instance) {
    instance = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, instance);
  }
  return instance;
}

/** @param {string | number | Date | null | undefined} value */
function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Anın otel saatindeki günü: `"2026-09-17"`.
 * @param {string | number | Date} value
 * @param {string} timeZone
 */
export function dayKey(value, timeZone) {
  const date = toDate(value);
  if (!date) return null;
  return formatter('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** İki gün anahtarı arasındaki fark (b − a). */
function dayDiff(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** "14:05" */
export function formatClock(value, timeZone) {
  const date = toDate(value);
  return date ? formatter('tr-TR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(date) : '—';
}

/** "17 Eyl 2026 14:05" */
export function formatDateTime(value, timeZone) {
  const date = toDate(value);
  if (!date) return '—';
  return formatter('tr-TR', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Gelen kutusu satırındaki zaman: bugünse saat, dünse "Dün", bu haftaysa gün
 * adı, daha eskiyse tarih.
 *
 * @param {string | number | Date} value
 * @param {number} now epoch ms
 * @param {string} timeZone
 */
export function formatListTime(value, now, timeZone) {
  const date = toDate(value);
  if (!date) return '';
  const diff = dayDiff(dayKey(date, timeZone), dayKey(now, timeZone));
  if (diff <= 0) return formatClock(date, timeZone);
  if (diff === 1) return 'Dün';
  if (diff <= WEEKDAY_RANGE_DAYS) return formatter('tr-TR', { timeZone, weekday: 'short' }).format(date);
  return formatter('tr-TR', { timeZone, day: 'numeric', month: 'short' }).format(date);
}

/**
 * Konuşma içindeki gün ayracı: "Bugün", "Dün", "15 Eylül Salı".
 *
 * @param {string | number | Date} value
 * @param {number} now epoch ms
 * @param {string} timeZone
 */
export function formatDayHeading(value, now, timeZone) {
  const date = toDate(value);
  if (!date) return '';
  const day = dayKey(date, timeZone);
  const today = dayKey(now, timeZone);
  const diff = dayDiff(day, today);
  if (diff === 0) return 'Bugün';
  if (diff === 1) return 'Dün';
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return formatter('tr-TR', {
    timeZone,
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

/**
 * Zamanlı iş: "Bugün 18:00", "Yarın 06:30", "19 Eyl 06:30".
 *
 * @param {string | number | Date} value
 * @param {number} now epoch ms
 * @param {string} timeZone
 */
export function formatScheduled(value, now, timeZone) {
  const date = toDate(value);
  if (!date) return '—';
  const diff = dayDiff(dayKey(now, timeZone), dayKey(date, timeZone));
  const clock = formatClock(date, timeZone);
  if (diff === 0) return `Bugün ${clock}`;
  if (diff === 1) return `Yarın ${clock}`;
  if (diff === -1) return `Dün ${clock}`;
  return `${formatter('tr-TR', { timeZone, day: 'numeric', month: 'short' }).format(date)} ${clock}`;
}

/**
 * Süre: "5 dk", "1 sa 20 dk", "2 gün 3 sa".
 * @param {number} minutes
 */
export function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(Math.abs(minutes)));
  if (total < MINUTES_PER_HOUR) return `${total} dk`;
  if (total < MINUTES_PER_DAY) {
    const hours = Math.floor(total / MINUTES_PER_HOUR);
    const rest = total % MINUTES_PER_HOUR;
    return rest ? `${hours} sa ${rest} dk` : `${hours} sa`;
  }
  const days = Math.floor(total / MINUTES_PER_DAY);
  const hours = Math.floor((total % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  return hours ? `${days} gün ${hours} sa` : `${days} gün`;
}

/**
 * Geçen süre: "şimdi", "5 dk", "2 sa 3 dk".
 * @param {string | number | Date} value
 * @param {number} now epoch ms
 */
export function formatElapsed(value, now) {
  const date = toDate(value);
  if (!date) return '';
  const minutes = Math.floor((now - date.getTime()) / MINUTE_MS);
  return minutes < 1 ? 'şimdi' : formatMinutes(minutes);
}

/**
 * Geçen dakika (negatifse gelecekte).
 * @param {string | number | Date} value
 * @param {number} now epoch ms
 */
export function minutesSince(value, now) {
  const date = toDate(value);
  return date ? Math.floor((now - date.getTime()) / MINUTE_MS) : 0;
}
