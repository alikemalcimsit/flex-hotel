import { reviewCreateSchema, reviewImportSchema, reviewListQuerySchema, reviewParamsSchema, reviewReplySchema, reviewTagSchema, reviewTrendQuerySchema } from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';
import { reviewTrends } from './trends.js';

/**
 * Misafir yorumları route'ları (modül 54), `/reviews` altında.
 * - Görmek (liste, ayrıntı, trend): `reviews.view`. Cevap: `reviews.reply`. Ekle / yükle / etiket / sil / yeniden analiz: `reviews.manage`.
 * @param {import('fastify').FastifyInstance} app
 */
export async function reviewRoutes(app) {
  const guard = (permission) => ({ preValidation: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.REVIEWS_VIEW);
  const reply = guard(PERMISSIONS.REVIEWS_REPLY);
  const manage = guard(PERMISSIONS.REVIEWS_MANAGE);
  const ok = (data) => ({ success: true, data });
  const params = { params: reviewParamsSchema };

  app.get('/', { ...view, schema: { querystring: reviewListQuerySchema } }, async (req) => ok(await service.listReviews(req.hotelId, req.query)));
  app.get('/trends', { ...view, schema: { querystring: reviewTrendQuerySchema } }, async (req) => ok(await reviewTrends(req.hotelId, req.query)));
  app.post('/', { ...manage, schema: { body: reviewCreateSchema } }, async (req, reply_) => reply_.status(201).send(ok(await service.createReview(req.hotelId, req.body))));
  app.post('/import', { ...manage, bodyLimit: 8 * 1024 * 1024, schema: { body: reviewImportSchema } }, async (req) => ok(await service.importReviews(req.hotelId, req.body)));
  app.get('/:reviewId', { ...view, schema: params }, async (req) => ok(await service.getReview(req.hotelId, req.params.reviewId)));
  app.put('/:reviewId/tags', { ...manage, schema: { ...params, body: reviewTagSchema } }, async (req) => ok(await service.tagReview(req.hotelId, req.params.reviewId, req.body)));
  app.put('/:reviewId/reply', { ...reply, schema: { ...params, body: reviewReplySchema } }, async (req) => ok(await service.replyReview(req.hotelId, req.params.reviewId, req.body)));
  app.post('/:reviewId/reanalyze', { ...manage, schema: params }, async (req) => ok(await service.reanalyzeReview(req.hotelId, req.params.reviewId)));
  app.delete('/:reviewId', { ...manage, schema: params }, async (req) => ok(await service.deleteReview(req.hotelId, req.params.reviewId)));
}
