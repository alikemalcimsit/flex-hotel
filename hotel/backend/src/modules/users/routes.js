import {
  idParamSchema,
  listQuerySchema,
  resetPasswordSchema,
  updateUserSchema,
  userInputSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Kullanıcı yönetimi route'ları (modül 2). Görüntüleme `users.view`, değişiklik
 * `users.manage` ister (varsayılanda ikisi de ADMIN). Ayarlar modülüyle aynı
 * desen: servis tipli hata fırlatır, merkezi handler HTTP'ye çevirir.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function userRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.USERS_VIEW)] };
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.USERS_MANAGE)] };

  app.get('/', { ...view, schema: { querystring: listQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listUsers(request.hotelId, request.query),
  }));

  app.post('/', { ...manage, schema: { body: userInputSchema } }, async (request, reply) => {
    const created = await service.createUser(request.hotelId, request.body);
    reply.status(201);
    return { success: true, data: created };
  });

  app.put('/:id', { ...manage, schema: { params: idParamSchema, body: updateUserSchema } }, async (request) => ({
    success: true,
    data: await service.updateUser(request.hotelId, request.params.id, request.body),
  }));

  app.post(
    '/:id/reset-password',
    { ...manage, schema: { params: idParamSchema, body: resetPasswordSchema } },
    async (request) => ({
      success: true,
      data: await service.resetPassword(request.hotelId, request.params.id, request.body.password),
    }),
  );
}
