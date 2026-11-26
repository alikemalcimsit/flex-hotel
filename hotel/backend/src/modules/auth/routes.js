import { loginSchema, myHotelsQuerySchema, refreshSchema, switchHotelSchema } from '@hotelos/hotel-contracts';
import { requireAuth } from '../../lib/permissions.js';
import { resolveEffectivePermissions } from '../roles/service.js';
import * as service from './service.js';

/**
 * Kimlik doğrulama route'ları (modül 2; otel geçişi modül 63).
 *
 * `/login` ve `/refresh` **herkese açık** (henüz token yok) — bu yüzden
 * `withHotelContext`/`requirePermission` yok. İkisine de sıkı bir hız sınırı
 * uygulanır (kaba kuvvet denemesine karşı, IP başına). `/me`, `/logout`, `/hotels`
 * ve `/switch-hotel` geçerli bir erişim token'ı ister.
 *
 * Oturum bir OTELDE açılır: token'da `hotelId` (açık otel), `homeHotelId` (ana otel)
 * ve o oteldeki `role` taşınır. Giriş ana otele açılır; zincirde erişimi olan kişi
 * `/switch-hotel` ile başka otele geçer. Ana otel dışındaki otelin token'ı her
 * istekte erişimle yeniden doğrulanır (`app.js`).
 *
 * @param {import('fastify').FastifyInstance} app
 */

/** Erişim token'ı ömrü. Kısa: iptal (pasife alma, rol değişimi) çabuk etkili olsun. */
const ACCESS_TOKEN_TTL = '15m';

/** Girişe özel sıkı hız sınırı (global sınır cömerttir; burada IP başına dar). */
const AUTH_RATE_LIMIT = { rateLimit: { max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10), timeWindow: '1 minute' } };

export async function authRoutes(app) {
  /**
   * @param {{ id: string, email: string, hotelId: string }} user ana oteli kayıtta
   * @param {string} hotelId oturumun açıldığı otel
   * @param {string} role o oteldeki rol
   */
  const signAccessToken = (user, hotelId, role) =>
    app.jwt.sign({ userId: user.id, email: user.email, hotelId, homeHotelId: user.hotelId, role }, { expiresIn: ACCESS_TOKEN_TTL });

  /** Giriş / yenileme / geçiş sonrası panelin ihtiyaç duyduğu her şey (refresh hariç). */
  async function buildSession(user, hotelId, role) {
    const [permissions, hotel, hotelCount] = await Promise.all([
      resolveEffectivePermissions(hotelId, role),
      service.sessionHotel(hotelId),
      service.countUserHotels(user.id),
    ]);
    return { user: service.toUserDto({ ...user, role }), permissions, hotel, hotelCount, accessToken: signAccessToken(user, hotelId, role) };
  }

  app.post('/login', { schema: { body: loginSchema }, config: AUTH_RATE_LIMIT }, async (request) => {
    const { email, password } = request.body;
    const user = await service.authenticate(email, password);
    const { token: refreshToken } = await service.issueRefreshToken(user.hotelId, user.id);
    return { success: true, data: { ...(await buildSession(user, user.hotelId, user.role)), refreshToken } };
  });

  app.post('/refresh', { schema: { body: refreshSchema }, config: AUTH_RATE_LIMIT }, async (request) => {
    const { user, hotelId, role, token: refreshToken } = await service.rotateRefreshToken(request.body.refreshToken);
    return { success: true, data: { ...(await buildSession(user, hotelId, role)), refreshToken } };
  });

  app.post('/logout', { preValidation: [requireAuth], schema: { body: refreshSchema } }, async (request) => {
    await service.revokeRefreshToken(request.body.refreshToken);
    return { success: true, data: { ok: true } };
  });

  app.get('/me', { preValidation: [requireAuth] }, async (request) => {
    const user = await service.findSessionUser(request.auth.hotelId, request.auth.userId);
    return { success: true, data: { user: service.toUserDto(user), permissions: request.auth.permissions } };
  });

  /** Kişinin erişebildiği oteller (otel seçici): ana otel + erişimler, ada göre. */
  app.get('/hotels', { preValidation: [requireAuth], schema: { querystring: myHotelsQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listUserHotels(request.auth.userId, request.auth.hotelId, request.query),
  }));

  /** Başka otele geçiş: o otelin kimliği ve rolüyle yeni oturum; eski yenileme token'ı iptal edilir. */
  // Oturum ister ve yenileme token'ı kişinin kendisinin olmalı: girişin dar IP sınırı gerekmez (resepsiyonun ortak
  // IP'sinde geçişler girişleri boğmasın); genel sınır geçerli.
  app.post('/switch-hotel', { preValidation: [requireAuth], schema: { body: switchHotelSchema } }, async (request) => {
    const { user, hotelId, role, token: refreshToken } = await service.switchHotel(request.auth.userId, request.body);
    return { success: true, data: { ...(await buildSession(user, hotelId, role)), refreshToken } };
  });
}
