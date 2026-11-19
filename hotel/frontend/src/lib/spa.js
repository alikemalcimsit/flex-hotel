import { SPA_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

/**
 * Spa ve spor salonu (modül 57) — personel ekranları: sorgu anahtarları, canlı tazeleme, gün ve saat yardımcıları.
 * Hepsi `spa` kökünde: canlı haber (randevu, ders, ödeme, tanım) tek anahtarla bütün ekranları yeniler.
 */
export const spaKeys = Object.freeze({
  all: ['spa'],
  setup: ['spa', 'setup'],
  settings: ['spa', 'settings'],
  calendar: (day) => ['spa', 'calendar', day],
  availability: (params) => ['spa', 'availability', params],
  appointments: (params) => ['spa', 'appointments', params],
  appointment: (id) => ['spa', 'appointment', id],
  sessions: (params) => ['spa', 'sessions', params],
  session: (id) => ['spa', 'session', id],
  blocks: (params) => ['spa', 'blocks', params],
  report: (params) => ['spa', 'report', params],
  stays: (search) => ['spa', 'stays', search],
});

export function useSpaLive() {
  return useLiveChannel(SPA_CHANNEL, { minIntervalMs: 1_000, queryKeys: [spaKeys.all] });
}

const pad = (value) => String(value).padStart(2, '0');

/** "YYYY-MM-DD" bugünden `offset` gün (tarayıcının günü; süzgeçlerin varsayılanı için yeterli). @param {number} offset */
export function dayFromToday(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** @param {string} day "YYYY-MM-DD" @param {number} count */
export function shiftDay(day, count) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + count * 86_400_000).toISOString().slice(0, 10);
}

const DAY_FORMAT = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const SHORT_DAY_FORMAT = new Intl.DateTimeFormat('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "20 Kasım 2026 Cuma" @param {string} day */
export const dayLabel = (day) => DAY_FORMAT.format(new Date(`${day}T00:00:00.000Z`));
/** "20 Kas Cum" @param {string} day */
export const shortDayLabel = (day) => SHORT_DAY_FORMAT.format(new Date(`${day}T00:00:00.000Z`));
/** "20.11.2026" @param {string} day */
export const dottedDay = (day) => day.split('-').reverse().join('.');

/** 870 → "14:30" @param {number} minute */
export const minuteLabel = (minute) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

/** Hazır dönemler (liste ve rapor). `from` / `to` bugüne göre gün farkı. */
export const SPA_RANGES = Object.freeze([
  { value: 'today', label: 'Bugün', from: 0, to: 0 },
  { value: 'week', label: 'Önümüzdeki 7 gün', from: 0, to: 6 },
  { value: 'month', label: 'Önümüzdeki 30 gün', from: 0, to: 29 },
  { value: 'past7', label: 'Son 7 gün', from: -6, to: 0 },
  { value: 'past30', label: 'Son 30 gün', from: -29, to: 0 },
  { value: 'past365', label: 'Son 1 yıl', from: -364, to: 0 },
]);

/** @param {string} value */
export function rangeOf(value) {
  const range = SPA_RANGES.find((item) => item.value === value) ?? SPA_RANGES[0];
  return { from: dayFromToday(range.from), to: dayFromToday(range.to) };
}

/** Takvim bloğunun rengi (durum / tür). */
export const SPA_BLOCK_CLASSES = Object.freeze({
  BOOKED: 'border-info-line bg-info-soft text-info-ink',
  COMPLETED: 'border-success-line bg-success-soft text-success-ink',
  SESSION: 'border-violet-200 bg-violet-50 text-violet-800',
});

export const appointmentPath = (id) => `/spa/randevular/${id}`;
export const sessionPath = (id) => `/spa/dersler/${id}`;
