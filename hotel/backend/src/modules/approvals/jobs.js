import { startRecurringJobs } from '../../lib/recurring.js';
import { expireApprovals } from './service.js';

/**
 * Onay kuyruğunun zamanlanmış işi (yalnızca sunucu sürecinde).
 *
 * | İş                    | Sıklık | Neden |
 * |-----------------------|--------|-------|
 * | Süresi dolan onaylar  | 1 dk   | Kimse karar vermeden süresi dolan onay düşer; aktör işi kapatılır, zile uyarı gider |
 */
const EXPIRE_INTERVAL_MS = 60_000;

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startApprovalJobs(logger) {
  return startRecurringJobs(logger, [
    {
      name: 'approval-expiry',
      intervalMs: EXPIRE_INTERVAL_MS,
      run: async () => {
        const expired = await expireApprovals();
        if (expired > 0) logger.info({ expired }, 'Süresi dolan onaylar düşürüldü');
      },
    },
  ]);
}
