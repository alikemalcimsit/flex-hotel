import { prisma } from '../db.js';
import { cache } from './cache.js';
import { AppError, UnauthorizedError } from './errors.js';

/**
 * Otel bağlamı (`request.hotelId`).
 *
 * Korumalı route'larda `hotelId` giriş yapan kullanıcının JWT'sinden gelir
 * (`app.js` onRequest hook'u `request.auth`'a koyar). Zincir yönetimi (modül 63)
 * üst bardan otel seçtirdiğinde de kaynak yine token olacak.
 *
 * `resolveHotelId()` (aşağıda, `HOTEL_CODE` ile) yalnızca token'ın olmadığı
 * bağlamlarda kalır: seed betiği ve socket el sıkışması (kimlik henüz orada
 * doğrulanmıyor — realtime katmanının bilinen sınırı).
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
 * `request.hotelId` alanını giriş yapan kullanıcının token'ından dolduran
 * preHandler. Kimlik yoksa 401 — korumalı route'a token'sız gelinmiştir.
 * @param {import('fastify').FastifyRequest} request
 */
export async function withHotelContext(request) {
  const hotelId = request.auth?.hotelId;
  if (!hotelId) throw new UnauthorizedError();
  request.hotelId = hotelId;
}
