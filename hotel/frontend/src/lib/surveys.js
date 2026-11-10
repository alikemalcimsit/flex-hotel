import { SURVEY_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

/**
 * Anket ve memnuniyet (modül 55) — personel ekranları: sorgu anahtarları, canlı tazeleme, dönem seçenekleri.
 * Hepsi `surveys` kökünde: canlı haber (yeni cevap, takip, AI etiketi / özeti) tek anahtarla bütün ekranları yeniler.
 */
export const surveyKeys = Object.freeze({
  all: ['surveys'],
  settings: ['surveys', 'settings'],
  design: (kind) => ['surveys', 'design', kind],
  responses: (params) => ['surveys', 'responses', params],
  response: (id) => ['surveys', 'response', id],
  report: (params) => ['surveys', 'report', params],
  insight: (params) => ['surveys', 'insight', params],
  followUps: (params) => ['surveys', 'follow-ups', params],
  followUp: (id) => ['surveys', 'follow-up', id],
  assignees: ['surveys', 'assignees'],
});

export function useSurveysLive() {
  return useLiveChannel(SURVEY_CHANNEL, { minIntervalMs: 1_000, queryKeys: [surveyKeys.all] });
}

/** "YYYY-MM-DD" bugünden `offset` gün (tarayıcının günü; dönem seçicisi için yeterli). @param {number} offset */
export function dayFromToday(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Hazır dönemler (rapor ve liste). */
export const SURVEY_PERIODS = Object.freeze([
  { value: '7', label: 'Son 7 gün' },
  { value: '30', label: 'Son 30 gün' },
  { value: '90', label: 'Son 90 gün' },
  { value: '365', label: 'Son 1 yıl' },
]);

/** @param {string} days */
export const periodOf = (days) => ({ from: dayFromToday(-(Number(days) - 1)), to: dayFromToday(0) });

/** NPS'nin rengi (sektör eşikleri: 50+ çok iyi, 0 altı kötü). @param {number | null} nps */
export const npsTone = (nps) => (nps === null ? 'neutral' : nps >= 50 ? 'success' : nps >= 0 ? 'warning' : 'danger');

/** Puanın (1–5) rengi. @param {number | null} value */
export const ratingTone = (value) => (value === null ? 'neutral' : value >= 4.2 ? 'success' : value >= 3.2 ? 'warning' : 'danger');

/** "4,35" @param {number | null | undefined} value */
export const formatScore = (value) => (value === null || value === undefined ? '—' : value.toLocaleString('tr-TR', { minimumFractionDigits: value % 1 ? 1 : 0, maximumFractionDigits: 2 }));
