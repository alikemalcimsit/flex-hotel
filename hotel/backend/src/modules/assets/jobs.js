import { prisma } from '../../db.js';
import { startRecurringJobs } from '../../lib/recurring.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { sweepWarranty } from './warranty.js';

/**
 * Demirbaş modülünün zamanlanmış işi (modül 46; yalnızca sunucu sürecinde).
 *
 * | İş            | Sıklık | Neden |
 * |---------------|--------|-------|
 * | Garanti zili  | 6 saat | Garantisi uyarı penceresine giren kartlar için zil (kart ve bitiş tarihi başına bir kez; aynı günün kartları tek zilde) |
 */
const WARRANTY_SWEEP_INTERVAL_MS = 6 * 60 * 60_000;

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startAssetJobs(logger) {
  return startRecurringJobs(logger, [
    {
      name: 'asset-warranty-sweep',
      intervalMs: WARRANTY_SWEEP_INTERVAL_MS,
      run: async () => {
        const hotels = await prisma.hotel.findMany({ where: { deletedAt: null }, select: { id: true } });
        for (const hotel of hotels) {
          try {
            const result = await sweepWarranty(hotel.id, { raiseStaffAlert });
            if (result.alerted > 0) logger.info({ hotelId: hotel.id, ...result }, 'Garanti zili: garantisi bitecek demirbaşlar');
          } catch (error) {
            logger.error({ err: error, hotelId: hotel.id }, 'Garanti süpürmesi başarısız');
          }
        }
      },
    },
  ]);
}
