import {
  activityFeedQuerySchema,
  auditQuerySchema,
  chainParamSchema,
  entityChainsParamSchema,
  eventLogQuerySchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Aktivite akışı, olaylar ve işlem zincirleri (modül 10). Salt okuma;
 * "Aktivite akışını görüntüle" izni. Zincirdeki değişikliklerin eski/yeni
 * değerleri yalnızca "Denetim kaydını görüntüle" izni olana döner.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function activityRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.ACTIVITY_VIEW)] };

  app.get('/feed', { ...view, schema: { querystring: activityFeedQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listActivity(request.hotelId, request.query),
  }));

  app.get('/events', { ...view, schema: { querystring: eventLogQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listEvents(request.hotelId, request.query),
  }));

  app.get('/chains/:correlationId', { ...view, schema: { params: chainParamSchema } }, async (request) => ({
    success: true,
    data: await service.getChain(request.hotelId, request.params.correlationId, {
      includeValues: request.auth.permissions.includes(PERMISSIONS.AUDIT_VIEW),
    }),
  }));

  app.get('/records/:entity/:entityId', { ...view, schema: { params: entityChainsParamSchema } }, async (request) => ({
    success: true,
    data: await service.listEntityChains(request.hotelId, request.params),
  }));

  app.get('/options', view, async () => ({ success: true, data: service.activityOptions() }));
}

/**
 * Denetim kaydı (modül 10): kim hangi kaydı ne zaman nasıl değiştirdi.
 * @param {import('fastify').FastifyInstance} app
 */
export async function auditRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.AUDIT_VIEW)] };

  app.get('/', { ...view, schema: { querystring: auditQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listAudit(request.hotelId, request.query),
  }));
}
