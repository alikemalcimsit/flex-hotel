import { shiftDay } from '@hotelos/hotel-contracts';
import { formatMoney } from './format.js';

/**
 * Gelir raporu ekranının ortakları (modül 23).
 */

export const reportKeys = Object.freeze({
  all: ['reports'],
  revenue: (params) => ['reports', 'revenue', params],
});

/** Yerel takvim günü "YYYY-AA-GG". */
export function localDay(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Ayın son günü. @param {string} day */
const monthEnd = (day) => {
  const [year, month] = day.split('-').map(Number);
  return localDay(new Date(year, month, 0));
};

/**
 * Hazır aralıklar. `today` iş gününe yakın yerel gün; aralık sunucuda yeniden doğrulanır.
 * @param {string} today
 */
export function reportPresets(today) {
  const monthStart = `${today.slice(0, 7)}-01`;
  const previousMonthEnd = shiftDay(monthStart, -1);
  const previousMonthStart = `${previousMonthEnd.slice(0, 7)}-01`;
  return [
    { key: 'THIS_MONTH', label: 'Bu ay', from: monthStart, to: monthEnd(today), groupBy: 'DAY' },
    { key: 'LAST_MONTH', label: 'Geçen ay', from: previousMonthStart, to: previousMonthEnd, groupBy: 'DAY' },
    { key: 'LAST_30', label: 'Son 30 gün', from: shiftDay(today, -30), to: shiftDay(today, -1), groupBy: 'DAY' },
    { key: 'NEXT_30', label: 'Önümüzdeki 30 gün', from: today, to: shiftDay(today, 29), groupBy: 'DAY' },
    { key: 'YEAR_TO_DATE', label: 'Yılbaşından bugüne', from: `${today.slice(0, 4)}-01-01`, to: today, groupBy: 'MONTH' },
    { key: 'LAST_12_MONTHS', label: 'Son 12 ay', from: `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`, to: shiftDay(monthStart, -1), groupBy: 'MONTH' },
  ];
}

const dayFormatter = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayYearFormatter = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const weekdayFormatter = new Intl.DateTimeFormat('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthFormatter = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const utc = (day) => new Date(`${day}T00:00:00.000Z`);

/** Kısa gün: "4 Eki". */
export const shortDate = (day) => dayFormatter.format(utc(day));
/** Yıllı gün: "4 Eki 2025". */
export const fullDate = (day) => dayYearFormatter.format(utc(day));

/**
 * Kovanın adı: gün "Cmt 4 Eki", hafta "28 Eyl – 4 Eki", ay "Ekim 2026".
 * @param {{ from: string, to: string, key: string }} bucket
 * @param {'DAY' | 'WEEK' | 'MONTH'} groupBy
 */
export function bucketLabel(bucket, groupBy) {
  if (groupBy === 'MONTH') return monthFormatter.format(utc(bucket.key));
  if (groupBy === 'WEEK') return `${shortDate(bucket.from)} – ${shortDate(bucket.to)}`;
  return weekdayFormatter.format(utc(bucket.from));
}

/** Eksen için kısa ad. */
export function axisLabel(bucket, groupBy) {
  if (groupBy === 'MONTH') return new Intl.DateTimeFormat('tr-TR', { month: 'short', timeZone: 'UTC' }).format(utc(bucket.key));
  return shortDate(bucket.from);
}

const pctFormatter = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "%72,4"; tanımsızsa "—". */
export const formatPct = (value) => (value === null || value === undefined ? '—' : `%${pctFormatter.format(value)}`);

/**
 * Değişim metni ve yönü: "+12,3%", "−4,0 puan".
 * @param {number | null} value
 * @param {'pct' | 'pts'} unit
 * @returns {{ text: string, direction: 'up' | 'down' | 'flat' | 'none' }}
 */
export function formatChange(value, unit = 'pct') {
  if (value === null || value === undefined) return { text: '—', direction: 'none' };
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
  const body = pctFormatter.format(Math.abs(value));
  return { text: unit === 'pts' ? `${sign}${body} puan` : `${sign}%${body}`, direction: value > 0 ? 'up' : value < 0 ? 'down' : 'flat' };
}

/** Ölçünün değeri ve metni (grafik ve tablo aynı yerden). */
export const METRIC_VALUE = Object.freeze({
  OCCUPANCY: { read: (row) => row.occupancyPct, text: (value) => formatPct(value), changeKey: 'occupancyPts', unit: 'pts' },
  ADR: { read: (row) => (row.adr === null ? null : Number(row.adr)), text: (value, currency) => (value === null ? '—' : formatMoney(String(value), currency)), changeKey: 'adr', unit: 'pct' },
  REVPAR: { read: (row) => (row.revpar === null ? null : Number(row.revpar)), text: (value, currency) => (value === null ? '—' : formatMoney(String(value), currency)), changeKey: 'revpar', unit: 'pct' },
  ROOM_REVENUE: { read: (row) => Number(row.roomRevenue), text: (value, currency) => formatMoney(String(value), currency), changeKey: 'roomRevenue', unit: 'pct' },
});
