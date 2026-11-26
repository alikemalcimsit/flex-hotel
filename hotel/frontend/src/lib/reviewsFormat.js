import { MAX_REVIEW_IMPORT_ROWS, REVIEW_IMPORT_FIELDS, SURVEY_TOPIC_LABELS } from '@hotelos/hotel-contracts';
import { importCellText, mapImportRows } from './dataImport.js';

/**
 * Misafir yorumları (modül 54) saf yardımcıları: puan metni ve yıldız, duygu puanının rengi / etiketi, kaynak rozet tonu,
 * CSV okuma, dosya satırlarının alan satırına çevrilmesi, haftalık seriden grafik verisi, anomali cümlesi. Sorgu / React
 * içermez; node testiyle denenir (`reviewsFormat.test.js`).
 */

const STAR_COUNT = 5;

/** "8,4 / 10"; puan yoksa "—". @param {number | null | undefined} rating @param {number | null | undefined} scale */
export function formatReviewRating(rating, scale) {
  if (rating === null || rating === undefined || !scale) return '—';
  return `${Number(rating).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} / ${scale}`;
}

/** 0–100 puan → dolu yıldız sayısı (0–5, en yakın). @param {number | null | undefined} ratingPct */
export const reviewStars = (ratingPct) => (ratingPct === null || ratingPct === undefined ? 0 : Math.max(0, Math.min(STAR_COUNT, Math.round((ratingPct / 100) * STAR_COUNT))));

/** Yüzde puanın rengi (ortalama kutusu). @param {number | null | undefined} pct */
export const ratingPctTone = (pct) => (pct === null || pct === undefined ? 'neutral' : pct >= 80 ? 'success' : pct >= 60 ? 'warning' : 'danger');

const SCORE_BANDS = Object.freeze([
  { min: 50, tone: 'success', label: 'Çok olumlu' },
  { min: 15, tone: 'success', label: 'Olumlu' },
  { min: -15, tone: 'neutral', label: 'Nötr' },
  { min: -50, tone: 'warning', label: 'Olumsuz' },
  { min: -Infinity, tone: 'danger', label: 'Çok olumsuz' },
]);

/**
 * Duygu puanı (−100…100) → rozet tonu, etiket ve işaretli metin ("+62").
 * @param {number | null | undefined} score
 * @returns {{ tone: string, label: string, text: string }}
 */
export function sentimentScoreView(score) {
  if (score === null || score === undefined || !Number.isFinite(Number(score))) return { tone: 'neutral', label: 'Puan yok', text: '—' };
  const value = Math.round(Number(score));
  const band = SCORE_BANDS.find((item) => value >= item.min);
  return { tone: band.tone, label: band.label, text: value > 0 ? `+${value}` : String(value) };
}

const SOURCE_TONES = Object.freeze({ GOOGLE: 'info', BOOKING: 'sky', TRIPADVISOR: 'success', EXPEDIA: 'warning', AIRBNB: 'danger', OTHER: 'neutral' });

/** Kaynak rozetinin tonu. @param {string | null | undefined} source */
export const reviewSourceTone = (source) => SOURCE_TONES[source] ?? 'neutral';

const REPLY_TONES = Object.freeze({ NONE: 'warning', DRAFT: 'info', REPLIED: 'success', NOT_NEEDED: 'neutral' });

/** Cevap durumu rozet tonu. @param {string | null | undefined} status */
export const reviewReplyTone = (status) => REPLY_TONES[status] ?? 'neutral';

/* ─────────────── Dosya ─────────────── */

/** İlk satırda en çok geçen ayırıcı (";" Türkçe Excel, "," genel, sekme). @param {string} text */
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [';', ',', '\t'].map((delimiter) => [delimiter, firstLine.split(delimiter).length - 1]);
  return counts.sort((a, b) => Number(b[1]) - Number(a[1]))[0][1] > 0 ? String(counts[0][0]) : ',';
}

/**
 * CSV metni → satırlar (tırnaklı alan, alan içinde satır sonu, "" kaçışı; BOM atılır).
 * @param {string} input @returns {string[][]}
 */
export function parseCsv(input) {
  const text = String(input ?? '').replace(/^﻿/, '');
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) {
      row = [...row, field];
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      rows.push([...row, field]);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length) rows.push([...row, field]);
  return rows;
}

/**
 * Sayfa satırları → başlıklar ve dolu veri satırları (boş satır atlanır; üst sınır `MAX_REVIEW_IMPORT_ROWS`).
 * @param {unknown[][]} sheet @returns {{ headers: string[], rows: unknown[][], errors: string[] }}
 */
export function splitReviewSheet(sheet) {
  if (!sheet?.length) return { headers: [], rows: [], errors: ['Dosya boş.'] };
  const headers = sheet[0].map((cell, index) => importCellText(cell) || `Sütun ${index + 1}`);
  const rows = sheet.slice(1).filter((row) => row.some((cell) => importCellText(cell) !== ''));
  if (rows.length === 0) return { headers, rows: [], errors: ['Dosyada başlıktan sonra satır yok.'] };
  if (rows.length > MAX_REVIEW_IMPORT_ROWS) return { headers, rows: [], errors: [`Bir seferde en fazla ${MAX_REVIEW_IMPORT_ROWS} satır yüklenir (dosyada ${rows.length} var); dosyayı bölün.`] };
  return { headers, rows, errors: [] };
}

/**
 * Eşleştirmeye göre sunucuya giden satırlar: alan anahtarı → hücre metni (eşlenmemiş alan gönderilmez).
 * @param {unknown[][]} rows @param {Record<string, number | null>} mapping @returns {Array<Record<string, string>>}
 */
export const reviewImportRows = (rows, mapping) => mapImportRows(rows, mapping);

/** Eşlenmemiş zorunlu alanların adları. @param {Record<string, number | null>} mapping */
export const missingReviewFields = (mapping) => REVIEW_IMPORT_FIELDS.filter((field) => field.required && (mapping[field.key] === null || mapping[field.key] === undefined)).map((field) => field.label);

/** Metinli bir sütun eşlendi mi (yorum, olumlu ya da olumsuz). @param {Record<string, number | null>} mapping */
export const hasReviewTextColumn = (mapping) => ['text', 'positive', 'negative', 'rating'].some((key) => mapping[key] !== null && mapping[key] !== undefined);

/* ─────────────── Trend ─────────────── */

const SENTIMENT_PARTS = Object.freeze([
  { key: 'positive', label: 'Olumlu', color: 'bg-success' },
  { key: 'neutral', label: 'Nötr', color: 'bg-line-strong' },
  { key: 'mixed', label: 'Karışık', color: 'bg-warning' },
  { key: 'negative', label: 'Olumsuz', color: 'bg-danger' },
]);
export { SENTIMENT_PARTS };

/** "2026-11-23" → "23.11". @param {string} day */
export const shortDay = (day) => day.slice(5).split('-').reverse().join('.');

/**
 * Haftalık seri → grafik verisi: çubuk yüksekliği (en çok yorum = %100), ortalama puan, duygu payları (etiketlenen yorumlar
 * içinde, %).
 * @param {Array<{ week: string, count: number, averagePct: number | null, positive: number, neutral: number, negative: number, mixed: number }>} weeks
 */
export function weeklyChartData(weeks) {
  const maxCount = Math.max(1, ...weeks.map((row) => row.count));
  return {
    maxCount,
    bars: weeks.map((row) => {
      const tagged = SENTIMENT_PARTS.reduce((sum, part) => sum + (row[part.key] ?? 0), 0);
      return {
        week: row.week,
        label: shortDay(row.week),
        count: row.count,
        countPct: Math.round((row.count / maxCount) * 100),
        averagePct: row.averagePct,
        tagged,
        parts: SENTIMENT_PARTS.map((part) => ({ ...part, value: row[part.key] ?? 0, pct: tagged ? Math.round(((row[part.key] ?? 0) / tagged) * 100) : 0 })),
      };
    }),
  };
}

/** Konu satırının olumsuz payı (%). @param {{ count: number, negative: number }} row */
export const negativeShare = (row) => (row.count ? Math.round((row.negative / row.count) * 100) : 0);

/** Konu tablosu: olumsuz paya, sonra olumsuz sayıya göre. @param {Array<{ count: number, negative: number }>} topics */
export const sortTopicsByNegative = (topics) => [...topics].sort((a, b) => negativeShare(b) - negativeShare(a) || b.negative - a.negative || b.count - a.count);

/**
 * "Temizlik şikâyeti bu hafta 3 kat arttı — 6 yorum, önceki ortalama 2".
 * @param {{ topic: string, count: number, baseline: number, factor: number }} anomaly
 */
export function anomalyText(anomaly) {
  const label = SURVEY_TOPIC_LABELS[anomaly.topic] ?? anomaly.topic;
  const number = (value) => Number(value).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
  return `${label} şikâyeti bu hafta ${number(anomaly.factor)} kat arttı — ${anomaly.count} yorum, önceki ortalama ${number(anomaly.baseline)}`;
}
