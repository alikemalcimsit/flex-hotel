import { startRecurringJobs } from '../../lib/recurring.js';
import { hotelsWithOpenWaitlist, refreshWaitlist } from './waitlist.js';

/**
 * Rezervasyon modülünün zamanlanmış işi (yalnızca sunucu sürecinde).
 *
 * | İş                        | Sıklık | Neden |
 * |---------------------------|--------|-------|
 * | Bekleme listesi taraması  | 5 dk   | Olay kaçarsa (süreç kapandı) açılan yer yine fark edilsin; girişi geçen kayıtlar kapansın |
 *
 * Asıl tetik olaylardır (`subscribers.js`); bu tarama güvenlik ağıdır.
 */
const WAITLIST_SCAN_INTERVAL_MS = 5 * 60_000;

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startReservationJobs(logger) {
  return startRecurringJobs(logger, [
    {
      name: 'waitlist-scan',
      intervalMs: WAITLIST_SCAN_INTERVAL_MS,
      run: async () => {
        for (const hotelId of await hotelsWithOpenWaitlist()) {
          const result = await refreshWaitlist(hotelId);
          if (result.opened || result.expired) logger.info({ hotelId, ...result }, 'Bekleme listesi tarandı');
        }
      },
    },
  ]);
}
