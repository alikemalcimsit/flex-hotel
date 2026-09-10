import { prisma } from '../db.js';
import { cache } from './cache.js';
import { AppError } from './errors.js';

/**
 * ⚠️ GEÇİCİ (STOPGAP) — otel bağlamı token'dan değil ortam değişkeninden geliyor.
 *
 * Şema en baştan multi-tenant (her tabloda `hotelId`). Gerçek çözüm: kullanıcı
 * giriş yapınca JWT içindeki `hotelId` bağlam olur (modül 2), zincir yönetimi
 * ise modül 63'te üst bardan otel seçtirir. O ikisi gelene kadar tek demo otel
 * `HOTEL_CODE` ile çözülüyor.
 *
 * Önemli: bu geçicilik `hotelId`'nin sorgularda *kullanılmasını* etkilemiyor.
 * Servis katmanı her zaman hotelId ile filtreliyor — sadece bu kimliğin nereden
 * geldiği değişecek, tek satırda.
 */

const HOTEL_CODE = process.env.HOTEL_CODE ?? 'DEMO';
const TENANT_TTL_MS = 5 * 60_000;

/**
 * Aktif otelin id'sini döner.
 * @returns {Promise<string>}
 */
export async function resolveHotelId() {
  return cache.getOrSet(
    `tenant:code:${HOTEL_CODE}`,
    async () => {
      const hotel = await prisma.hotel.findFirst({
        where: { code: HOTEL_CODE },
        select: { id: true },
      });
      if (!hotel) {
        throw new AppError(
          `HOTEL_CODE='${HOTEL_CODE}' ile eşleşen otel yok. 'npm run db:seed' çalıştırın veya .env içindeki HOTEL_CODE değerini düzeltin.`,
          { statusCode: 503, code: 'TENANT_NOT_FOUND' },
        );
      }
      return hotel.id;
    },
    TENANT_TTL_MS,
  );
}

/**
 * `request.hotelId` alanını dolduran preHandler.
 * @param {import('fastify').FastifyRequest} request
 */
export async function withHotelContext(request) {
  request.hotelId = await resolveHotelId();
}
