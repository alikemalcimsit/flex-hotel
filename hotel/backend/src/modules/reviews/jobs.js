import { startRecurringJobs } from '../../lib/recurring.js';
import { dispatchReviewAnalysis } from './analysis.js';
import { detectAllAnomalies } from './anomalies.js';

/**
 * Misafir yorumlarının işleri (modül 54).
 *
 * | İş                     | Sıklık | Neden |
 * |------------------------|--------|-------|
 * | Yorum analiz kuyruğu   | 1 dk   | Bekleyen yorumlardan en çok 40'ı AI'a gönderilir |
 * | Olumsuz konu artışı    | 6 sa   | Son 7 gün ↔ önceki 4 hafta; artışta müdüre zil |
 */
/** @param {{ info: Function, error: Function }} logger */
export function startReviewJobs(logger) {
  return startRecurringJobs(logger, [
    { name: 'review-analysis', intervalMs: 60_000, run: () => dispatchReviewAnalysis() },
    { name: 'review-anomalies', intervalMs: 6 * 60 * 60_000, run: () => detectAllAnomalies() },
  ]);
}
