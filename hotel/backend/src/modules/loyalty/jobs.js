import { prisma } from '../../db.js';
import { startRecurringJobs } from '../../lib/recurring.js';
import { expireAndRefresh } from './accounts.js';

/**
 * Sadakatin zamanlanmış işi (yalnızca sunucu sürecinde).
 *
 * | İş                              | Sıklık  | Neden |
 * |---------------------------------|---------|-------|
 * | Puan süresi ve seviye tazeleme  | 12 saat | Süresi dolan kullanılmamış puan düşer; 12 aylık seviye penceresi kayar |
 */
const INTERVAL_MS = 12 * 60 * 60_000;

/** @param {{ info: Function, error: Function }} logger @returns {() => void} */
export function startLoyaltyModuleJobs(logger) {
  return startRecurringJobs(logger, [
    {
      name: 'loyalty-expiry',
      intervalMs: INTERVAL_MS,
      run: async () => {
        const hotels = await prisma.loyaltySettings.findMany({ where: { isEnabled: true }, select: { hotelId: true } });
        for (const { hotelId } of hotels) {
          try {
            const result = await expireAndRefresh(hotelId);
            if (result.expired > 0) logger.info({ hotelId, ...result }, 'Sadakat: süresi dolan puan düşüldü');
          } catch (error) {
            logger.error({ err: error, hotelId }, 'Sadakat puan süresi işi başarısız');
          }
        }
      },
    },
  ]);
}
