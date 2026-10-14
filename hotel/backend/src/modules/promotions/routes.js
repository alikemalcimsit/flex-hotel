import {
  couponExportQuerySchema,
  couponListQuerySchema,
  couponParamSchema,
  couponStatusSchema,
  createCouponsSchema,
  createPromotionSchema,
  promotionListQuerySchema,
  promotionParamSchema,
  promotionReportQuerySchema,
  promotionReservationsQuerySchema,
  promotionStatusSchema,
  promotionVersionSchema,
  updatePromotionSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Promosyon ve kupon route'ları (modül 31).
 *
 * - Görmek (promosyonlar, kuponlar, kullanım raporu): `promotions.view`
 *   (müdür, muhasebe).
 * - Promosyon açmak / düzenlemek / yayına almak, kupon üretmek ve kapatmak:
 *   `promotions.manage` (müdür).
 * - Rezervasyon formundaki kupon alanı ayrı yetki istemez: kupon, rezervasyon
 *   önizlemesi ve açma uçlarında (`reservations.*`) değerlendirilir.
 *
 * Liste uçları sayfalıdır; dışa aktarma bir üretimle sınırlıdır (`MAX_COUPON_BATCH`).
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function promotionRoutes(app) {
  const guard = (permission) => ({ preHandler: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.PROMOTIONS_VIEW);
  const manage = guard(PERMISSIONS.PROMOTIONS_MANAGE);
  const ok = (data) => ({ success: true, data });

  /* ── Liste ve rapor (statik yollar parametreli yollardan önce) ── */

  app.get('/', { ...view, schema: { querystring: promotionListQuerySchema } }, async (request) =>
    ok(await service.listPromotions(request.hotelId, request.query)),
  );

  app.post('/', { ...manage, schema: { body: createPromotionSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await service.createPromotion(request.hotelId, request.body))),
  );

  app.get('/report', { ...view, schema: { querystring: promotionReportQuerySchema } }, async (request) =>
    ok(await service.getPromotionReport(request.hotelId, request.query)),
  );

  /* ── Promosyon ── */

  app.get('/:promotionId', { ...view, schema: { params: promotionParamSchema } }, async (request) =>
    ok(await service.getPromotion(request.hotelId, request.params.promotionId)),
  );

  app.patch('/:promotionId', { ...manage, schema: { params: promotionParamSchema, body: updatePromotionSchema } }, async (request) =>
    ok(await service.updatePromotion(request.hotelId, request.params.promotionId, request.body)),
  );

  app.post('/:promotionId/status', { ...manage, schema: { params: promotionParamSchema, body: promotionStatusSchema } }, async (request) =>
    ok(await service.setPromotionStatus(request.hotelId, request.params.promotionId, request.body)),
  );

  app.post('/:promotionId/delete', { ...manage, schema: { params: promotionParamSchema, body: promotionVersionSchema } }, async (request) =>
    ok(await service.deletePromotion(request.hotelId, request.params.promotionId, request.body)),
  );

  app.get(
    '/:promotionId/reservations',
    { ...view, schema: { params: promotionParamSchema, querystring: promotionReservationsQuerySchema } },
    async (request) => ok(await service.listPromotionReservations(request.hotelId, request.params.promotionId, request.query)),
  );

  /* ── Kupon ── */

  app.get('/:promotionId/coupons', { ...view, schema: { params: promotionParamSchema, querystring: couponListQuerySchema } }, async (request) =>
    ok(await service.listCoupons(request.hotelId, request.params.promotionId, request.query)),
  );

  app.post('/:promotionId/coupons', { ...manage, schema: { params: promotionParamSchema, body: createCouponsSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await service.createCoupons(request.hotelId, request.params.promotionId, request.body))),
  );

  app.get(
    '/:promotionId/coupons/export',
    { ...view, schema: { params: promotionParamSchema, querystring: couponExportQuerySchema } },
    async (request) => ok(await service.exportCoupons(request.hotelId, request.params.promotionId, request.query.batchId)),
  );

  app.post(
    '/:promotionId/coupons/:couponId/status',
    { ...manage, schema: { params: couponParamSchema, body: couponStatusSchema } },
    async (request) => ok(await service.setCouponStatus(request.hotelId, request.params.promotionId, request.params.couponId, request.body)),
  );
}
