import { prisma } from '../../db.js';
import { startRecurringJobs } from '../../lib/recurring.js';
import { remindExpiringDocuments } from './documents.js';

/**
 * İK'nın zamanlanmış işi (yalnızca sunucu sürecinde).
 *
 * | İş                          | Sıklık  | Neden |
 * |-----------------------------|---------|-------|
 * | Özlük belgesi hatırlatması  | 12 saat | Süresi ayardaki gün içinde dolacak / dolmuş belgeler İK'ya zil (belge başına 7 günde bir) |
 */
const DOCUMENT_REMINDER_INTERVAL_MS = 12 * 60 * 60_000;

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startHrModuleJobs(logger) {
  return startRecurringJobs(logger, [
    {
      name: 'hr-document-reminder',
      intervalMs: DOCUMENT_REMINDER_INTERVAL_MS,
      run: async () => {
        const hotels = await prisma.hotel.findMany({ where: { deletedAt: null }, select: { id: true } });
        for (const hotel of hotels) {
          try {
            const result = await remindExpiringDocuments(hotel.id);
            if (result.alerted > 0) logger.info({ hotelId: hotel.id, ...result }, 'İK zili: süresi dolacak özlük belgeleri');
          } catch (error) {
            logger.error({ err: error, hotelId: hotel.id }, 'Özlük belgesi hatırlatması başarısız');
          }
        }
      },
    },
  ]);
}
