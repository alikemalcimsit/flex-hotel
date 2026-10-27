import { cancelPurchaseRequestSchema, createBanquetPurchaseRequestSchema, purchaseRequestListQuerySchema, purchaseRequestParamSchema } from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Satın alma talebi route'ları (modül 45'in talep kısmı — modül 43), `/purchasing` altında.
 *
 * - Görmek: `purchasing.view` (müdür, F&B, muhasebe).
 * - Banket ihtiyacından talep açmak ve açık talebi iptal etmek: `purchasing.request` (müdür, F&B).
 *
 * Liste sayfalı; talep satırları `MAX_REQUEST_LINES` ile sınırlı.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function purchasingRoutes(app) {
  const guard = (permission) => ({ preHandler: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.PURCHASING_VIEW);
  const request = guard(PERMISSIONS.PURCHASING_REQUEST);
  const ok = (data) => ({ success: true, data });

  app.get('/requests', { ...view, schema: { querystring: purchaseRequestListQuerySchema } }, async (req) => ok(await service.listRequests(req.hotelId, req.query)));

  app.get('/requests/:requestId', { ...view, schema: { params: purchaseRequestParamSchema } }, async (req) => ok(await service.getRequest(req.hotelId, req.params.requestId)));

  app.post('/requests/banquet', { ...request, schema: { body: createBanquetPurchaseRequestSchema } }, async (req, reply) =>
    reply.status(201).send(ok(await service.createFromBanquet(req.hotelId, req.body))),
  );

  app.post('/requests/:requestId/cancel', { ...request, schema: { params: purchaseRequestParamSchema, body: cancelPurchaseRequestSchema } }, async (req) =>
    ok(await service.cancelRequest(req.hotelId, req.params.requestId, req.body)),
  );
}
