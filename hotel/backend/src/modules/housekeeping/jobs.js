import { startRecurringJobs } from '../../lib/recurring.js';
import { generateStayoverTasks } from './service.js';

/**
 * Kat hizmetlerinin zamanlanmış işi (yalnızca sunucu sürecinde).
 *
 * | İş                  | Sıklık | Neden |
 * |---------------------|--------|-------|
 * | STAYOVER üretimi    | 10 dk  | Otelin iş günü dönünce konaklayan odaların günlük temizlik görevleri bir kez açılır |
 *
 * Üretim idempotent: o güne görevi olan oda atlanır, ikinci koşu hiçbir şey
 * üretmez. Sunucu kapalıyken geçen sabah sonraki açılışta telafi edilir —
 * iş "saat 06:00'da üret" değil "bugünün görevleri eksikse tamamla"dır.
 */
const STAYOVER_CHECK_INTERVAL_MS = 10 * 60_000;

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startHousekeepingJobs(logger) {
  return startRecurringJobs(logger, [
    {
      name: 'housekeeping-stayover',
      intervalMs: STAYOVER_CHECK_INTERVAL_MS,
      run: async () => {
        const created = await generateStayoverTasks();
        if (created > 0) logger.info({ created }, 'Konaklama temizliği görevleri açıldı');
      },
    },
  ]);
}
