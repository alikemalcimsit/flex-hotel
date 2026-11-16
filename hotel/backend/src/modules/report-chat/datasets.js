import { FORECAST_ALERT_LABELS, MAX_REPORT_CHART_SERIES } from '@hotelos/hotel-contracts';

/**
 * Rapor asistanının tabloları (modül 24): MCP rapor aracının çıktısı → ekranın tablosu ve grafiği.
 *
 * Tablo `{ columns, rows, summary, currency }`: sütunun türü (`text` | `number` | `percent` | `money`) ekranda biçimi,
 * grafikte seçilebilirliği belirler (yalnız sayısal sütunlar seri olur; yatay eksen ilk sütun). Rakamlar araçtan
 * olduğu gibi gelir — model tablo yazmaz, yalnız sütun seçer.
 */

const DAY_LABEL = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const MONTH_LABEL = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const date = (day) => new Date(`${day}T00:00:00Z`);

/**
 * Dönem satırının adı: gün "16 Kas", hafta "16 Kas – 22 Kas" (tek güne düşen kenar hafta "1 Kas"), ay "Kasım 2026".
 * @param {{ from: string, to: string }} row @param {'DAY' | 'WEEK' | 'MONTH'} groupBy
 */
export function periodName({ from, to }, groupBy) {
  if (groupBy === 'MONTH') return MONTH_LABEL.format(date(from));
  // Dönemin kenarında tek güne düşen hafta ("1 Kas") aralık gibi yazılmaz.
  if (from === to) return DAY_LABEL.format(date(from));
  return `${DAY_LABEL.format(date(from))} – ${DAY_LABEL.format(date(to))}`;
}

const column = (key, label, kind) => ({ key, label, kind });
const NUMERIC_KINDS = new Set(['number', 'percent', 'money']);

/* ─────────────── Raporlar ─────────────── */

/** @param {any} data `get_occupancy` */
function occupancy(data) {
  return {
    columns: [
      column('period', 'Dönem', 'text'),
      column('occupancyPct', 'Doluluk %', 'percent'),
      column('lastYearOccupancyPct', 'Geçen yıl %', 'percent'),
      column('occupancyChangePts', 'Fark (puan)', 'number'),
      column('sold', 'Satılan oda', 'number'),
      column('sellable', 'Satılabilir oda', 'number'),
    ],
    rows: data.periods.map((row) => ({
      period: periodName(row, data.groupBy),
      occupancyPct: row.occupancyPct,
      lastYearOccupancyPct: row.lastYear.occupancyPct,
      occupancyChangePts: row.change.occupancyPts,
      sold: row.sold,
      sellable: row.sellable,
    })),
    summary: [
      { label: 'Doluluk', value: data.totals.occupancyPct, kind: 'percent' },
      { label: 'Geçen yıl', value: data.totals.lastYear.occupancyPct, kind: 'percent' },
      { label: 'Satılan oda', value: data.totals.sold, kind: 'number' },
    ],
    currency: null,
  };
}

/** @param {any} data `get_revenue` */
function revenue(data) {
  return {
    columns: [
      column('period', 'Dönem', 'text'),
      column('roomRevenue', 'Oda geliri', 'money'),
      column('lastYearRoomRevenue', 'Geçen yıl gelir', 'money'),
      column('roomRevenueChangePct', 'Değişim %', 'percent'),
      column('adr', 'ADR', 'money'),
      column('revpar', 'RevPAR', 'money'),
      column('occupancyPct', 'Doluluk %', 'percent'),
    ],
    rows: data.periods.map((row) => ({
      period: periodName(row, data.groupBy),
      roomRevenue: row.roomRevenue,
      lastYearRoomRevenue: row.lastYear.roomRevenue,
      roomRevenueChangePct: row.change.roomRevenue,
      adr: row.adr,
      revpar: row.revpar,
      occupancyPct: row.occupancyPct,
    })),
    summary: [
      { label: 'Oda geliri', value: data.totals.roomRevenue, kind: 'money' },
      { label: 'ADR', value: data.totals.adr, kind: 'money' },
      { label: 'RevPAR', value: data.totals.revpar, kind: 'money' },
      { label: 'Geçen yıla göre', value: data.totals.change.roomRevenue, kind: 'percent' },
    ],
    currency: data.currency,
  };
}

/** @param {any} data `run_report_query` (oda tipi / kaynak kırılımı) */
function breakdown(data) {
  return {
    columns: [
      column('label', data.breakdown, 'text'),
      column('roomRevenue', 'Oda geliri', 'money'),
      column('sharePct', 'Pay %', 'percent'),
      column('sold', 'Satılan gece', 'number'),
      column('adr', 'ADR', 'money'),
      column('lastYearRoomRevenue', 'Geçen yıl gelir', 'money'),
      column('roomRevenueChangePct', 'Değişim %', 'percent'),
    ],
    rows: data.rows.map((row) => ({
      label: row.label,
      roomRevenue: row.roomRevenue,
      sharePct: row.sharePct,
      sold: row.sold,
      adr: row.adr,
      lastYearRoomRevenue: row.lastYear.roomRevenue,
      roomRevenueChangePct: row.change.roomRevenue,
    })),
    summary: [],
    currency: data.currency,
  };
}

/** @param {any} data `get_forecast` */
function forecast(data) {
  return {
    columns: [
      column('day', 'Gün', 'text'),
      column('forecastOccupancyPct', 'Tahmin %', 'percent'),
      column('onBooksOccupancyPct', 'Eldeki %', 'percent'),
      column('lastYearOccupancyPct', 'Geçen yıl %', 'percent'),
      column('forecastRevenue', 'Tahmini gelir', 'money'),
      column('alert', 'Uyarı', 'text'),
    ],
    rows: data.rows.map((row) => ({
      day: DAY_LABEL.format(date(row.date)),
      forecastOccupancyPct: row.forecast.occupancyPct,
      onBooksOccupancyPct: row.onBooks.occupancyPct,
      lastYearOccupancyPct: row.lastYear.occupancyPct,
      forecastRevenue: row.forecast.revenue,
      alert: row.alert ? (FORECAST_ALERT_LABELS[row.alert] ?? row.alert) : null,
    })),
    summary: [
      { label: 'Tahmini doluluk', value: data.totals.forecast.occupancyPct, kind: 'percent' },
      { label: 'Eldeki doluluk', value: data.totals.onBooks.occupancyPct, kind: 'percent' },
      { label: 'Tahmini gelir', value: data.totals.forecast.revenue, kind: 'money' },
    ],
    currency: data.currency,
  };
}

/** @param {any} data `explain_variance` */
function variance(data) {
  const line = (label, row) => ({ item: label, plan: row.plan, actual: row.actual, difference: row.difference, differencePct: row.differencePct });
  const totals = [line('Toplam gelir', data.totals.revenue), line('Toplam gider', data.totals.expense), line('Brüt faaliyet kârı', data.totals.gop)];
  return {
    columns: [
      column('item', 'Kalem', 'text'),
      column('plan', 'Plan', 'money'),
      column('actual', 'Gerçekleşen', 'money'),
      column('difference', 'Fark', 'money'),
      column('differencePct', 'Fark %', 'percent'),
    ],
    rows: [...totals, ...data.topVariances.map((row) => line(row.label, row))],
    summary: [],
    notes: data.notes,
    currency: data.currency,
  };
}

const BUILDERS = Object.freeze({
  get_occupancy: occupancy,
  get_revenue: revenue,
  run_report_query: breakdown,
  get_forecast: forecast,
  explain_variance: variance,
});

/** Raporun varsayılan grafiği (model geçersiz seri seçerse de bu). */
const DEFAULT_CHARTS = Object.freeze({
  get_occupancy: { type: 'LINE', series: ['occupancyPct', 'lastYearOccupancyPct'] },
  get_revenue: { type: 'BAR', series: ['roomRevenue', 'lastYearRoomRevenue'] },
  run_report_query: { type: 'BAR', series: ['roomRevenue'] },
  get_forecast: { type: 'LINE', series: ['forecastOccupancyPct', 'onBooksOccupancyPct'] },
  explain_variance: { type: 'BAR', series: ['plan', 'actual'] },
});

/**
 * @param {string} tool MCP araç adı
 * @param {unknown} data aracın çıktısı
 * @returns {{ columns: { key: string, label: string, kind: string }[], rows: Record<string, unknown>[], summary: object[], currency: string | null, notes?: string[] }}
 */
export function buildDataset(tool, data) {
  const builder = BUILDERS[tool];
  if (!builder) throw new Error(`Tablo yok: ${tool}`);
  return builder(data);
}

/**
 * Modelin grafik seçimi geçerliyse o, değilse raporun varsayılanı: seriler tablonun sayısal sütunları olmalı (yatay
 * eksen ilk sütun); tablo tek satırsa çizgi yerine sütun.
 * @param {string} tool @param {{ columns: { key: string, kind: string }[], rows: unknown[] }} dataset
 * @param {{ type: string, series: string[] } | null | undefined} chart
 */
export function chartFor(tool, dataset, chart) {
  const numeric = new Set(dataset.columns.filter((col) => NUMERIC_KINDS.has(col.kind)).map((col) => col.key));
  const fallback = DEFAULT_CHARTS[tool];
  let picked = chart && chart.type === 'TABLE' ? { type: 'TABLE', series: [] } : null;
  if (!picked) {
    const series = [...new Set(chart?.series ?? [])].filter((key) => numeric.has(key)).slice(0, MAX_REPORT_CHART_SERIES);
    picked = chart && series.length > 0 ? { type: chart.type, series } : { ...fallback };
  }
  if (picked.type === 'LINE' && dataset.rows.length < 2) return { ...picked, type: 'BAR' };
  return picked;
}

/**
 * Modele giden kısa özet: sütunlar bir kez, satırlar dizi (token tasarrufu); çok satır varsa baştan ve sondan.
 * @param {ReturnType<typeof buildDataset>} dataset @param {number} [maxRows]
 */
export function compactForModel(dataset, maxRows = 60) {
  const keys = dataset.columns.map((col) => col.key);
  const toRow = (row) => keys.map((key) => row[key] ?? null);
  const rows = dataset.rows.length <= maxRows ? dataset.rows.map(toRow) : [...dataset.rows.slice(0, maxRows / 2), ...dataset.rows.slice(-maxRows / 2)].map(toRow);
  return {
    columns: dataset.columns.map((col) => `${col.key} (${col.label})`),
    rows,
    ...(dataset.rows.length > maxRows ? { omittedRows: dataset.rows.length - maxRows } : {}),
    summary: dataset.summary,
    currency: dataset.currency,
    ...(dataset.notes?.length ? { notes: dataset.notes } : {}),
  };
}
