import { actorParamSchema, actorToggleSchema, actorUsageQuerySchema } from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Aktör yönetim paneli route'ları (modül 12).
 *
 * Görüntüleme `actors.view`, açma / kapama `actors.manage`. Açma ve kapama
 * ayrı uçlar (anahtar değil): iki yönetici aynı anda "kapat" derse sonuç
 * yine "kapalı"dır, biri diğerinin kararını tersine çevirmez.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function actorRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.ACTORS_VIEW)] };
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.ACTORS_MANAGE)] };

  app.get('/', view, async (request) => ({
    success: true,
    data: await service.listActors(request.hotelId),
  }));

  app.get('/:name', { ...view, schema: { params: actorParamSchema } }, async (request) => ({
    success: true,
    data: await service.getActor(request.hotelId, request.params.name),
  }));

  app.get(
    '/:name/usage',
    { ...view, schema: { params: actorParamSchema, querystring: actorUsageQuerySchema } },
    async (request) => ({
      success: true,
      data: await service.getActorUsage(request.hotelId, request.params.name, request.query),
    }),
  );

  app.post(
    '/:name/enable',
    { ...manage, schema: { params: actorParamSchema, body: actorToggleSchema } },
    async (request) => ({
      success: true,
      data: await service.setActorEnabled(request.hotelId, request.params.name, true, request.body ?? {}),
    }),
  );

  app.post(
    '/:name/disable',
    { ...manage, schema: { params: actorParamSchema, body: actorToggleSchema } },
    async (request) => ({
      success: true,
      data: await service.setActorEnabled(request.hotelId, request.params.name, false, request.body ?? {}),
    }),
  );
}
