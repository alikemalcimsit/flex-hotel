import { loginSchema, refreshSchema } from '@hotelos/hotel-contracts';
import { requireAuth } from '../../lib/permissions.js';
import { resolveEffectivePermissions } from '../roles/service.js';
import * as service from './service.js';

/**
 * Kimlik doğrulama route'ları (modül 2).
 *
 * `/login` ve `/refresh` **herkese açık** (henüz token yok) — bu yüzden
 * `withHotelContext`/`requirePermission` yok. İkisine de sıkı bir hız sınırı
 * uygulanır (kaba kuvvet denemesine karşı, IP başına). `/me` ve `/logout` geçerli
 * bir erişim token'ı ister.
 *
 * @param {import('fastify').FastifyInstance} app
 */

/** Erişim token'ı ömrü. Kısa: iptal (pasife alma, rol değişimi) çabuk etkili olsun. */
const ACCESS_TOKEN_TTL = '15m';

/** Girişe özel sıkı hız sınırı (global sınır cömerttir; burada IP başına dar). */
const AUTH_RATE_LIMIT = { rateLimit: { max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10), timeWindow: '1 minute' } };

export async function authRoutes(app) {
  const signAccessToken = (user) =>
    app.jwt.sign(
      { userId: user.id, email: user.email, hotelId: user.hotelId, role: user.role },
      { expiresIn: ACCESS_TOKEN_TTL },
    );

  /** Giriş/yenileme sonrası panelin ihtiyaç duyduğu her şey (refresh hariç). */
  async function buildSession(user) {
    const permissions = await resolveEffectivePermissions(user.hotelId, user.role);
    return { user: service.toUserDto(user), permissions, accessToken: signAccessToken(user) };
  }

  app.post('/login', { schema: { body: loginSchema }, config: AUTH_RATE_LIMIT }, async (request) => {
    const { email, password } = request.body;
    const user = await service.authenticate(email, password);
    const { token: refreshToken } = await service.issueRefreshToken(user.hotelId, user.id);
    return { success: true, data: { ...(await buildSession(user)), refreshToken } };
  });

  app.post('/refresh', { schema: { body: refreshSchema }, config: AUTH_RATE_LIMIT }, async (request) => {
    const { user, token: refreshToken } = await service.rotateRefreshToken(request.body.refreshToken);
    return { success: true, data: { ...(await buildSession(user)), refreshToken } };
  });

  app.post('/logout', { preHandler: [requireAuth], schema: { body: refreshSchema } }, async (request) => {
    await service.revokeRefreshToken(request.body.refreshToken);
    return { success: true, data: { ok: true } };
  });

  app.get('/me', { preHandler: [requireAuth] }, async (request) => {
    const user = await service.findSessionUser(request.auth.hotelId, request.auth.userId);
    return { success: true, data: { user: service.toUserDto(user), permissions: request.auth.permissions } };
  });
}
