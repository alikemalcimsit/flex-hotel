import {
  approvalListQuerySchema,
  approvalParamSchema,
  denyApprovalSchema,
  grantApprovalSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Onay kuyruğu route'ları (modül 11).
 *
 * Görüntüleme `approvals.view`, karar `approvals.decide`. Onay **açma** ucu
 * yok: onay isteği aktörden ya da servisten gelir (`service.requestApproval`);
 * HTTP'den keyfi onay açılması ne bir ihtiyaç ne de güvenli.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function approvalRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.APPROVALS_VIEW)] };
  const decide = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.APPROVALS_DECIDE)] };

  app.get('/', { ...view, schema: { querystring: approvalListQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listApprovals(request.hotelId, request.query),
  }));

  app.get('/summary', view, async (request) => ({
    success: true,
    data: await service.getApprovalSummary(request.hotelId),
  }));

  app.get('/:approvalId', { ...view, schema: { params: approvalParamSchema } }, async (request) => ({
    success: true,
    data: await service.getApproval(request.hotelId, request.params.approvalId),
  }));

  app.post(
    '/:approvalId/grant',
    { ...decide, schema: { params: approvalParamSchema, body: grantApprovalSchema } },
    async (request) => ({
      success: true,
      data: await service.decideApproval(request.hotelId, request.params.approvalId, 'GRANTED', request.body),
    }),
  );

  app.post(
    '/:approvalId/deny',
    { ...decide, schema: { params: approvalParamSchema, body: denyApprovalSchema } },
    async (request) => ({
      success: true,
      data: await service.decideApproval(request.hotelId, request.params.approvalId, 'DENIED', request.body),
    }),
  );
}
