import { startRecurringJobs } from '../../lib/recurring.js';
import { prisma } from '../../db.js';
import { generateSuggestions } from './yield-service.js';

/**
 * Dinamik fiyatın zamanlanmış işi (modül 34; yalnızca sunucu sürecinde).
 *
 * | İş                 | Sıklık | Neden |
 * |--------------------|--------|-------|
 * | Öneri üretimi      | 6 saat | Günde bir değerlendirme yeter; iş idempotent olduğu için (çakışan bekleyen öneri atlanır) sık koşmak kuyruğu şişirmez, sunucu yeniden başlasa da gün kaçmaz |
 *
 * 2500 oda ölçeği: otel başına tek envanter anlık görüntüsü + tek geçen-yıl
 * sorgusu; oteller sırayla işlenir, birinin hatası diğerini durdurmaz.
 */
const GENERATE_INTERVAL_MS = 6 * 60 * 60_000;

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startPricingJobs(logger) {
  return startRecurringJobs(logger, [
    {
      name: 'pricing-suggestions',
      intervalMs: GENERATE_INTERVAL_MS,
      run: async () => {
        const hotels = await prisma.hotel.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
        for (const hotel of hotels) {
          try {
            const result = await generateSuggestions(hotel.id);
            if (result.created > 0) {
              logger.info({ hotelId: hotel.id, ...result }, 'Fiyat önerileri onaya düşürüldü');
            }
          } catch (error) {
            logger.error({ err: error, hotelId: hotel.id }, 'Fiyat önerisi üretimi başarısız');
          }
        }
      },
    },
  ]);
}
