import {
  advanceDeliveryOrderSchema,
  assignDeliveryCourierSchema,
  cancelDeliveryOrderSchema,
  createDeliveryOrderSchema,
  deliverDeliveryOrderSchema,
  deliveryBoardQuerySchema,
  deliveryCustomerQuerySchema,
  deliveryListQuerySchema,
  deliveryParamSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as read from './delivery-read.js';
import * as service from './delivery.js';

/**
 * Paket servis route'ları (modül 42), `/pos/delivery` altında.
 *
 * - **Garson / kurye** (`pos.operate`): pano, sipariş girme (telefon / mesaj / web), tekrar gelen müşteri, mutfak /
 *   servis adımı, kurye atama, teslim (kapı ödemesi kuryenin kasasına), mutfak başlamadan iptal.
 * - **Şef garson** (`pos.supervise`): mutfakta hazırlanan siparişin iptali (zayi).
 * - **Rapor** (`pos.report`): pano, geçmiş ve sipariş ekranı (işlem yok).
 *
 * Listeler sınırlı ya da sayfalı (pano sütunu, geçmiş sayfalı, müşteri sorgusu son siparişler).
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function deliveryRoutes(app) {
  const operate = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.POS_OPERATE)] };
  const view = { preHandler: [withHotelContext, requireAnyPermission(PERMISSIONS.POS_OPERATE, PERMISSIONS.POS_REPORT)] };
  const ok = (data) => ({ success: true, data });
  /** @param {any} request */
  const canSupervise = (request) => Boolean(request.auth?.permissions?.includes(PERMISSIONS.POS_SUPERVISE));

  app.get('/board', { ...view, schema: { querystring: deliveryBoardQuerySchema } }, async (request) => ok(await read.getDeliveryBoard(request.hotelId, request.query)));
  app.get('/customers', { ...operate, schema: { querystring: deliveryCustomerQuerySchema } }, async (request) => ok(await read.findDeliveryCustomer(request.hotelId, request.query)));
  app.get('/orders', { ...view, schema: { querystring: deliveryListQuerySchema } }, async (request) => ok(await read.listDeliveryOrders(request.hotelId, request.query)));
  app.post('/orders', { ...operate, schema: { body: createDeliveryOrderSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await service.createDeliveryOrder(request.hotelId, request.body))),
  );
  app.get('/orders/:orderId', { ...view, schema: { params: deliveryParamSchema } }, async (request) => ok(await read.getDeliveryOrder(request.hotelId, request.params.orderId)));
  app.post('/orders/:orderId/advance', { ...operate, schema: { params: deliveryParamSchema, body: advanceDeliveryOrderSchema } }, async (request) =>
    ok(await service.advanceDeliveryOrder(request.hotelId, request.params.orderId, request.body)),
  );
  app.post('/orders/:orderId/assign', { ...operate, schema: { params: deliveryParamSchema, body: assignDeliveryCourierSchema } }, async (request) =>
    ok(await service.assignDeliveryCourier(request.hotelId, request.params.orderId, request.body)),
  );
  app.post('/orders/:orderId/deliver', { ...operate, schema: { params: deliveryParamSchema, body: deliverDeliveryOrderSchema } }, async (request) =>
    ok(await service.deliverDeliveryOrder(request.hotelId, request.params.orderId, request.body)),
  );
  app.post('/orders/:orderId/cancel', { ...operate, schema: { params: deliveryParamSchema, body: cancelDeliveryOrderSchema } }, async (request) =>
    ok(await service.cancelDeliveryOrder(request.hotelId, request.params.orderId, request.body, { canSupervise: canSupervise(request) })),
  );
}
