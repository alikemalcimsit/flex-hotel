import { REPORT_CHAT_REPORT_LABELS, REPORT_PERIOD_LABELS } from '@hotelos/hotel-contracts';
import { formatDate, formatMoney, formatPercent } from './format.js';

/**
 * Rapor asistanı (modül 24) ekranlarının sorgu anahtarları, yolları ve saf yardımcıları: tablo hücresinin türüne
 * göre biçimi, grafiğin serileri, Excel'e aktarma. Sorgu kancaları `reportChatQueries.js`'te — bu dosya tarayıcısız
 * test edilir (Excel kitaplığı yalnız işlev içinde yüklenir).
 *
 * Tablo (`dataset`) sunucunun çalıştırdığı rapordan gelir: `{ columns: [{ key, label, kind }], rows, summary,
 * currency, notes? }`. Yatay eksen ilk sütun; seriler sayısal sütunlar (en fazla 3).
 */

export const reportChatKeys = Object.freeze({
  all: ['report-chat'],
  questions: ['report-chat', 'questions'],
  /** @param {'MINE' | 'SHARED'} scope */
  saved: (scope) => ['report-chat', 'saved', scope],
});

export const REVENUE_REPORT_PATH = '/raporlar/gelir';
export const REPORT_CHAT_PATH = '/raporlar/asistan';
export const SAVED_REPORTS_PATH = '/raporlar/kayitli';

/** Sohbet ekranındaki örnek sorular. */
export const EXAMPLE_QUESTIONS = Object.freeze([
  'Geçen ayın haftalık doluluğu',
  'Bu yıl kaynağa göre oda geliri',
  'Önümüzdeki 30 günün doluluk tahmini',
  'Geçen ayın bütçe sapması',
  "Son 7 günün ADR ve RevPAR'ı",
]);

/** Grafikte serilerin renkleri (sırayla): vurgu, bağlam, üçüncü. */
export const SERIES_COLORS = Object.freeze(['var(--color-info)', 'var(--color-ink-muted)', 'var(--color-warning)']);

const NUMERIC_KINDS = new Set(['number', 'percent', 'money']);
const numberFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const compactFormat = new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * Hücre değerini sayıya çevirir (para metin gelir: "12500.50"); boş / sayı olmayan → `null`.
 * @param {unknown} value
 * @returns {number | null}
 */
export function numericValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Tablo hücresi: para "12.500,50", yüzde "%74,2", sayı "1.234", gün "16 Kas 2026" (tasarımcı, modül 26), metin olduğu
 * gibi; boş "—".
 * @param {unknown} value
 * @param {'text' | 'number' | 'percent' | 'money' | 'date'} kind
 */
export function formatCell(value, kind) {
  if (value === null || value === undefined || value === '') return '—';
  if (kind === 'money') return formatMoney(value);
  if (kind === 'date') return formatDate(String(value));
  if (kind === 'percent') {
    const number = numericValue(value);
    return number === null ? '—' : formatPercent(Math.round(number * 10) / 10);
  }
  if (kind === 'number') {
    const number = numericValue(value);
    return number === null ? '—' : numberFormat.format(number);
  }
  return String(value);
}

/**
 * Eksen etiketi (kısa): para / sayı "12,5 B", yüzde "%75".
 * @param {number} value @param {string} kind
 */
export function formatAxis(value, kind) {
  if (kind === 'percent') return `%${numberFormat.format(value)}`;
  return compactFormat.format(value);
}

/** @param {{ kind: string }} column */
export const isNumericColumn = (column) => NUMERIC_KINDS.has(column.kind);

/**
 * Grafiğin verisi: yatay eksen etiketleri (ilk sütun) ve seçilen sayısal sütunların serileri. Tabloda olmayan ya da
 * sayısal olmayan seri atlanır; boş hücre `null` kalır (çizgi kopar, sütun çizilmez). Serilerin türü aynıysa eksen o
 * türle yazılır.
 *
 * @param {{ columns: Array<{ key: string, label: string, kind: string }>, rows: Array<Record<string, unknown>> }} dataset
 * @param {{ type: string, series: string[] } | null | undefined} chart
 */
export function chartData(dataset, chart) {
  const empty = { labels: [], series: [], axisKind: 'number' };
  if (!dataset?.columns?.length || !chart || chart.type === 'TABLE') return empty;
  const [first] = dataset.columns;
  const byKey = new Map(dataset.columns.map((column) => [column.key, column]));
  const series = [...new Set(chart.series ?? [])]
    .map((key) => byKey.get(key))
    .filter((column) => column && column.key !== first.key && isNumericColumn(column))
    .slice(0, SERIES_COLORS.length)
    .map((column, index) => ({
      key: column.key,
      label: column.label,
      kind: column.kind,
      color: SERIES_COLORS[index],
      values: dataset.rows.map((row) => numericValue(row[column.key])),
    }));
  if (series.length === 0) return empty;
  const kinds = new Set(series.map((entry) => entry.kind));
  return {
    labels: dataset.rows.map((row) => formatCell(row[first.key], first.kind)),
    series,
    axisKind: kinds.size === 1 ? series[0].kind : 'number',
  };
}

/**
 * Tanımın okunur adı: "Doluluk · Geçen ay" (sabit tarihte tarihler).
 * @param {{ report: string, period: string, from?: string | null, to?: string | null } | null | undefined} spec
 */
export function specLabel(spec) {
  if (!spec) return '';
  const period = spec.period === 'CUSTOM' && spec.from && spec.to ? `${formatDate(spec.from)} – ${formatDate(spec.to)}` : REPORT_PERIOD_LABELS[spec.period] ?? spec.period;
  return `${REPORT_CHAT_REPORT_LABELS[spec.report] ?? spec.report} · ${period}`;
}

/** Tabloyu olmayan (yalnız metin) cevap. @param {{ status: string, dataset: unknown }} question */
export const isTextAnswer = (question) => question.status === 'READY' && !question.dataset;

/* ─────────────── Excel ─────────────── */

const EXCEL_FORMATS = Object.freeze({ money: '#,##0.00', percent: '0.0', number: '#,##0.##' });
const bold = (value) => ({ value, fontWeight: 'bold', backgroundColor: '#eef2f7' });

/**
 * Excel hücresi: sayısal sütun sayı (biçimli), metin metin, boş `null`.
 * @param {unknown} value @param {string} kind
 */
function excelCell(value, kind) {
  if (NUMERIC_KINDS.has(kind)) {
    const number = numericValue(value);
    return number === null ? null : { value: number, type: Number, format: EXCEL_FORMATS[kind] };
  }
  return value === null || value === undefined || value === '' ? null : { value: String(value), type: String };
}

/**
 * Excel satırları: başlık, dönem, sütun başlıkları, veriler; altta özet ve notlar.
 * @param {{ title: string, periodLabel?: string | null, dataset: any }} input
 * @returns {Array<Array<object | null>>}
 */
export function excelRows({ title, periodLabel, dataset }) {
  const { columns } = dataset;
  const rows = [[bold(title)], ...(periodLabel ? [[{ value: periodLabel, type: String }]] : []), [], columns.map((column) => bold(column.label))];
  for (const row of dataset.rows) rows.push(columns.map((column) => excelCell(row[column.key], column.kind)));
  if (dataset.summary?.length) {
    rows.push([]);
    for (const item of dataset.summary) rows.push([bold(item.label), excelCell(item.value, item.kind)]);
  }
  for (const note of dataset.notes ?? []) rows.push([{ value: note, type: String }]);
  return rows;
}

/** Dosya adı: "Ekim doluluğu" → "ekim-dolulugu". @param {string} title */
export function fileSlug(title) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
  const slug = title
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşü]/g, (char) => map[char])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'rapor';
}

/**
 * Raporu .xlsx olarak indirir.
 * @param {{ title: string, periodLabel?: string | null, dataset: any }} input
 */
export async function downloadReportExcel(input) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  await writeXlsxFile(excelRows(input), {
    sheet: 'Rapor',
    columns: input.dataset.columns.map((column) => ({ width: Math.max(12, column.label.length + 4) })),
  }).toFile(`${fileSlug(input.title)}.xlsx`);
}
