import { startRecurringJobs } from '../../lib/recurring.js';
import { prisma } from '../../db.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { sweepSales } from './service.js';

/**
 * Satış CRM'in zamanlanmış işi (modül 36; yalnızca sunucu sürecinde).
 *
 * | İş              | Sıklık | Neden |
 * |-----------------|--------|-------|
 * | Satış süpürmesi | 30 dk  | Geçerliliği geçen gönderilmiş teklifler süresi doldu olur; takip tarihi gelen fırsatlar için günde tek birleşik zil (dedupeKey) çalar — 30 dakikalık tur sunucu yeniden başlasa da günü kaçırmaz, zil mükerrer çalmaz |
 */
const SWEEP_INTERVAL_MS = 30 * 60_000;

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startSalesJobs(logger) {
  return startRecurringJobs(logger, [
    {
      name: 'sales-sweep',
      intervalMs: SWEEP_INTERVAL_MS,
      run: async () => {
        const hotels = await prisma.hotel.findMany({ where: { deletedAt: null }, select: { id: true } });
        for (const hotel of hotels) {
          try {
            const result = await sweepSales(hotel.id, { raiseStaffAlert });
            if (result.expired > 0) logger.info({ hotelId: hotel.id, ...result }, 'Satış süpürmesi: teklif süresi doldu');
          } catch (error) {
            logger.error({ err: error, hotelId: hotel.id }, 'Satış süpürmesi başarısız');
          }
        }
      },
    },
  ]);
}
