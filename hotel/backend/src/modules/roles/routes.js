import { matrixUpdateSchema } from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Rol → izin matrisi route'ları (modül 2). Yalnızca `roles.manage` izni olan
 * (varsayılanda ADMIN) görür ve düzenler.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function roleRoutes(app) {
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.ROLES_MANAGE)] };

  app.get('/permissions', manage, async (request) => ({
    success: true,
    data: await service.getMatrix(request.hotelId),
  }));

  app.put('/permissions', { ...manage, schema: { body: matrixUpdateSchema } }, async (request) => ({
    success: true,
    data: await service.setMatrix(request.hotelId, request.body),
  }));
}
