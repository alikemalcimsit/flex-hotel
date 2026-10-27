import {
  acceptRoomServiceOrderSchema,
  advanceRoomServiceOrderSchema,
  cancelRoomServiceOrderSchema,
  collectTraysSchema,
  createRoomServiceOrderSchema,
  deliverRoomServiceOrderSchema,
  publicRoomServiceOrderParamSchema,
  publicRoomServiceOrderSchema,
  publicRoomServiceTokenSchema,
  rejectRoomServiceOrderSchema,
  roomServiceBoardQuerySchema,
  roomServiceLinkParamSchema,
  roomServiceListQuerySchema,
  roomServiceParamSchema,
  roomServicePrepQuerySchema,
  roomServiceReportQuerySchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as guest from './room-service-guest.js';
import * as read from './room-service-read.js';
import * as service from './room-service.js';

/**
 * Oda servisi route'ları (modül 41), `/pos/room-service` altında.
 *
 * - **Oda servisi personeli** (`pos.operate`): pano, sipariş girme (telefon / istekten), misafir siparişini kabul /
 *   ret, planlıyı mutfağa gönderme, mutfak / servis adımı, teslim (kapıda ödeme + odaya yaz), mutfağa düşmemiş ya da
 *   hazırlanmaya başlamamış siparişi iptal.
 * - **Şef garson** (`pos.supervise`): mutfakta hazırlanan siparişin iptali (zayi).
 * - **Rapor** (`pos.report`): geçmiş, sipariş ekranı, hazırlık listesi, oda servisi raporu.
 * - **Tepsi ve QR bağlantısı**: oda servisi ya da misafir isteklerini yöneten (kat hizmetleri tepsiyi toplar, ön büro
 *   girişte bağlantıyı verir).
 *
 * Listeler sınırlı ya da sayfalı (pano sütunu, hazırlık listesi bir gün, tepsi listesi, geçmiş sayfalı); rapor en
 * fazla 31 gün.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function roomServiceRoutes(app) {
  const any = (...permissions) => ({ preHandler: [withHotelContext, requireAnyPermission(...permissions)] });
  const operate = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.POS_OPERATE)] };
  const report = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.POS_REPORT)] };
  const view = any(PERMISSIONS.POS_OPERATE, PERMISSIONS.POS_REPORT);
  const trays = any(PERMISSIONS.POS_OPERATE, PERMISSIONS.REQUESTS_MANAGE);
  const links = any(PERMISSIONS.POS_OPERATE, PERMISSIONS.REQUESTS_MANAGE);
  const ok = (data) => ({ success: true, data });
  /** @param {any} request */
  const canSupervise = (request) => Boolean(request.auth?.permissions?.includes(PERMISSIONS.POS_SUPERVISE));

  app.get('/board', { ...view, schema: { querystring: roomServiceBoardQuerySchema } }, async (request) => ok(await read.getBoard(request.hotelId, request.query)));

  app.get('/orders', { ...view, schema: { querystring: roomServiceListQuerySchema } }, async (request) => ok(await read.listOrders(request.hotelId, request.query)));

  app.post('/orders', { ...operate, schema: { body: createRoomServiceOrderSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await service.createOrder(request.hotelId, request.body))),
  );

  app.get('/orders/:orderId', { ...view, schema: { params: roomServiceParamSchema } }, async (request) => ok(await read.getOrder(request.hotelId, request.params.orderId)));

  app.post('/orders/:orderId/accept', { ...operate, schema: { params: roomServiceParamSchema, body: acceptRoomServiceOrderSchema } }, async (request) =>
    ok(await service.acceptOrder(request.hotelId, request.params.orderId, request.body)),
  );

  app.post('/orders/:orderId/reject', { ...operate, schema: { params: roomServiceParamSchema, body: rejectRoomServiceOrderSchema } }, async (request) =>
    ok(await service.rejectOrder(request.hotelId, request.params.orderId, request.body)),
  );

  /** Planlı siparişi şimdi mutfağa gönder (kalemler değiştirilebilir). */
  app.post('/orders/:orderId/release', { ...operate, schema: { params: roomServiceParamSchema, body: acceptRoomServiceOrderSchema } }, async (request) =>
    ok(await service.releaseOrder(request.hotelId, request.params.orderId, request.body)),
  );

  app.post('/orders/:orderId/advance', { ...operate, schema: { params: roomServiceParamSchema, body: advanceRoomServiceOrderSchema } }, async (request) =>
    ok(await service.advanceOrder(request.hotelId, request.params.orderId, request.body)),
  );

  app.post('/orders/:orderId/deliver', { ...operate, schema: { params: roomServiceParamSchema, body: deliverRoomServiceOrderSchema } }, async (request) =>
    ok(await service.deliverOrder(request.hotelId, request.params.orderId, request.body)),
  );

  app.post('/orders/:orderId/cancel', { ...operate, schema: { params: roomServiceParamSchema, body: cancelRoomServiceOrderSchema } }, async (request) =>
    ok(await service.cancelOrder(request.hotelId, request.params.orderId, request.body, { canSupervise: canSupervise(request) })),
  );

  app.get('/prep', { ...view, schema: { querystring: roomServicePrepQuerySchema } }, async (request) => ok(await read.prepList(request.hotelId, request.query)));

  app.get('/trays', { ...trays, schema: { querystring: roomServiceBoardQuerySchema } }, async (request) => ok(await read.listTrays(request.hotelId, request.query)));

  app.post('/trays/collect', { ...trays, schema: { body: collectTraysSchema } }, async (request) => ok(await service.collectTrays(request.hotelId, request.body)));

  app.get('/report', { ...report, schema: { querystring: roomServiceReportQuerySchema } }, async (request) => ok(await read.roomServiceReport(request.hotelId, request.query)));

  /* ── Misafirin QR bağlantısı (konaklama başına) ── */

  app.get('/links/:reservationId', { ...links, schema: { params: roomServiceLinkParamSchema } }, async (request) => ok(await guest.getLink(request.hotelId, request.params.reservationId)));

  /** Bağlantı ver / yenile (eskisi geçersiz olur). */
  app.post('/links/:reservationId', { ...links, schema: { params: roomServiceLinkParamSchema } }, async (request) => ok(await guest.issueLink(request.hotelId, request.params.reservationId)));

  app.delete('/links/:reservationId', { ...links, schema: { params: roomServiceLinkParamSchema } }, async (request) => ok(await guest.revokeLink(request.hotelId, request.params.reservationId)));
}

/** Misafir uçlarının IP başına hız sınırları (dakikada). */
const GUEST_LIMITS = Object.freeze({ menu: 60, status: 120, write: 10 });

/**
 * Misafirin oda servisi uçları (modül 41; sayfası modül 53), `/public/room-service` altında. Oturumsuzdur: kimlik
 * bağlantının imzasıdır. Hız sınırı **yalnızca IP'ye** göredir (genel sınırın anahtarındaki `x-actor` başlığı misafirin
 * elindedir; değiştirerek sınırdan kaçmasın). Yanıt önbelleğe alınmaz, belirteç yönlendirmeyle sızmaz.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function publicRoomServiceRoutes(app) {
  const limited = (max) => ({ config: { rateLimit: { max, timeWindow: '1 minute', keyGenerator: (request) => request.ip } } });
  const ok = (data) => ({ success: true, data });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').header('x-content-type-options', 'nosniff');
  });

  app.get('/:token', { ...limited(GUEST_LIMITS.menu), schema: { params: publicRoomServiceTokenSchema } }, async (request) => ok(await guest.publicMenu(request.params.token)));

  app.get('/:token/orders', { ...limited(GUEST_LIMITS.status), schema: { params: publicRoomServiceTokenSchema } }, async (request) => ok(await guest.publicOrders(request.params.token)));

  app.post('/:token/orders', { ...limited(GUEST_LIMITS.write), schema: { params: publicRoomServiceTokenSchema, body: publicRoomServiceOrderSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await guest.publicCreateOrder(request.params.token, request.body))),
  );

  app.post('/:token/orders/:orderId/cancel', { ...limited(GUEST_LIMITS.write), schema: { params: publicRoomServiceOrderParamSchema } }, async (request) =>
    ok(await guest.publicCancelOrder(request.params.token, request.params.orderId)),
  );
}
