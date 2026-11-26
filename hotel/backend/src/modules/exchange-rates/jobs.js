import { startRecurringJobs } from '../../lib/recurring.js';
import { fetchAllTcmbRates } from './service.js';

/**
 * Kur işi (modül 60): saatte bir, otomatik çekme açık otellerin iş günü kurları TCMB'den yazılır (gün değişince ve gün kapanınca yeni
 * iş gününün kuru da gelir; aynı kur yeniden yazılmaz).
 * @param {{ info: Function, error: Function }} logger
 */
export function startExchangeRateJobs(logger) {
  return startRecurringJobs(logger, [{ name: 'tcmb-rates', intervalMs: 60 * 60_000, run: () => fetchAllTcmbRates(logger) }]);
}
