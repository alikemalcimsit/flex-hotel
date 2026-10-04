import { startRecurringJobs } from '../../lib/recurring.js';
import { refreshAllStats } from './stats.js';

/**
 * Rapor modülünün zamanlanmış işi (yalnızca sunucu sürecinde).
 *
 * | İş                      | Sıklık | Neden |
 * |-------------------------|--------|-------|
 * | Gelir özeti (kapanmış gün) | 1 sa | Son günlerin geç düzeltmeleri, eski günlerin doldurulması ve onarımı (bkz. `stats.js`) |
 *
 * Özet yalnızca raporu hızlandırır: iş hiç çalışmasa da rapor doğrudur
 * (özeti olmayan gün canlı okunur).
 */
const STATS_INTERVAL_MS = 60 * 60_000;

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startReportJobs(logger) {
  return startRecurringJobs(logger, [
    {
      name: 'revenue-day-stats',
      intervalMs: STATS_INTERVAL_MS,
      run: async () => {
        const totals = await refreshAllStats(logger);
        if (totals.days > 0) logger.info(totals, 'Gelir özeti güncellendi');
      },
    },
  ]);
}
