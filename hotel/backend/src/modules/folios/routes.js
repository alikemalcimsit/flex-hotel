import {
  chargePreviewSchema,
  folioItemParamSchema,
  folioItemsQuerySchema,
  folioListQuerySchema,
  folioParamSchema,
  folioPaymentsQuerySchema,
  folioRoutesSchema,
  folioStayParamSchema,
  mergeFoliosSchema,
  openFolioSchema,
  postChargeSchema,
  reopenFolioSchema,
  splitFolioSchema,
  transferItemsSchema,
  updateFolioSchema,
  voidRequestSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, assertRequestPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as payments from '../payments/service.js';
import * as service from './service.js';

/**
 * Folyo route'ları (modül 15).
 *
 * Görüntüleme `folio.view` (kat hizmetleri görmez). Harcama işleme, aktarma,
 * bölme, birleştirme, yönlendirme, kapatma ve iptal isteği `folio.post`
 * (iptal onaya gider; karar `approvals.decide` ve isteyen dışında biri).
 * İndirim ve kapanmış folyoyu yeniden açma `folio.adjust`.
 */

const DISCOUNT_DENIED = 'İndirim uygulama yetkiniz yok; yöneticiye ya da muhasebeye başvurun.';

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function folioRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.FOLIO_VIEW)] };
  const post = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.FOLIO_POST)] };
  const adjust = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.FOLIO_ADJUST)] };

  /* ── Liste ve gece çalışması ── */

  app.get('/', { ...view, schema: { querystring: folioListQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listFolios(request.hotelId, request.query),
  }));

  app.get('/room-charges', view, async (request) => ({
    success: true,
    data: await service.getRoomChargeStatus(request.hotelId),
  }));

  // Aktör kapalıyken (ya da beklemeden) gecenin oda ücretlerini işlemek; tekrar basmak güvenli.
  app.post('/room-charges/run', post, async (request) => ({
    success: true,
    data: await service.runRoomCharges(request.hotelId),
  }));

  app.post('/charges/preview', { ...post, schema: { body: chargePreviewSchema } }, async (request) => ({
    success: true,
    data: await service.previewCharge(request.hotelId, request.body),
  }));

  /* ── Konaklamanın folyoları ── */

  app.get('/stays/:reservationId', { ...view, schema: { params: folioStayParamSchema } }, async (request) => ({
    success: true,
    data: await service.getStayFolios(request.hotelId, request.params.reservationId),
  }));

  app.post(
    '/stays/:reservationId',
    { ...post, schema: { params: folioStayParamSchema, body: openFolioSchema } },
    async (request, reply) => {
      reply.code(201);
      return { success: true, data: await service.openFolio(request.hotelId, request.params.reservationId, request.body) };
    },
  );

  app.put(
    '/stays/:reservationId/routes',
    { ...post, schema: { params: folioStayParamSchema, body: folioRoutesSchema } },
    async (request) => ({
      success: true,
      data: await service.setRoutes(request.hotelId, request.params.reservationId, request.body),
    }),
  );

  app.post('/stays/:reservationId/room-charges', { ...post, schema: { params: folioStayParamSchema } }, async (request) => ({
    success: true,
    data: await service.postStayRoomCharges(request.hotelId, request.params.reservationId),
  }));

  /* ── Tek folyo ── */

  app.get('/:folioId', { ...view, schema: { params: folioParamSchema } }, async (request) => ({
    success: true,
    data: await service.getFolio(request.hotelId, request.params.folioId),
  }));

  app.get('/:folioId/items', { ...view, schema: { params: folioParamSchema, querystring: folioItemsQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listFolioItems(request.hotelId, request.params.folioId, request.query),
  }));

  // Ödemeler modül 17'nin (yazma uçları `/payments`); folyoyu gören ödemelerini de görür.
  app.get(
    '/:folioId/payments',
    { ...view, schema: { params: folioParamSchema, querystring: folioPaymentsQuerySchema } },
    async (request) => ({
      success: true,
      data: await payments.listFolioPayments(request.hotelId, request.params.folioId, request.query),
    }),
  );

  app.patch('/:folioId', { ...post, schema: { params: folioParamSchema, body: updateFolioSchema } }, async (request) => ({
    success: true,
    data: await service.updateFolio(request.hotelId, request.params.folioId, request.body),
  }));

  app.post(
    '/:folioId/charges',
    { ...post, schema: { params: folioParamSchema, body: postChargeSchema } },
    async (request, reply) => {
      // İndirim gövdeye bağlı ek yetki: matris ayrı verebilir.
      if (request.body.type === 'DISCOUNT') assertRequestPermission(request, PERMISSIONS.FOLIO_ADJUST, DISCOUNT_DENIED);
      const result = await service.postCharge(request.hotelId, request.params.folioId, request.body);
      reply.code(result.created ? 201 : 200);
      return { success: true, data: result };
    },
  );

  app.post(
    '/:folioId/items/:itemId/void',
    { ...post, schema: { params: folioItemParamSchema, body: voidRequestSchema } },
    async (request, reply) => {
      reply.code(202);
      return {
        success: true,
        data: await service.requestVoid(request.hotelId, request.params.folioId, request.params.itemId, request.body),
      };
    },
  );

  app.post('/:folioId/transfer', { ...post, schema: { params: folioParamSchema, body: transferItemsSchema } }, async (request) => ({
    success: true,
    data: await service.transferItems(request.hotelId, request.params.folioId, request.body),
  }));

  app.post('/:folioId/split', { ...post, schema: { params: folioParamSchema, body: splitFolioSchema } }, async (request, reply) => {
    reply.code(201);
    return { success: true, data: await service.splitFolio(request.hotelId, request.params.folioId, request.body) };
  });

  app.post('/:folioId/merge', { ...post, schema: { params: folioParamSchema, body: mergeFoliosSchema } }, async (request) => ({
    success: true,
    data: await service.mergeFolios(request.hotelId, request.params.folioId, request.body),
  }));

  app.post('/:folioId/close', { ...post, schema: { params: folioParamSchema } }, async (request) => ({
    success: true,
    data: await service.closeFolio(request.hotelId, request.params.folioId),
  }));

  app.post('/:folioId/reopen', { ...adjust, schema: { params: folioParamSchema, body: reopenFolioSchema } }, async (request) => ({
    success: true,
    data: await service.reopenFolio(request.hotelId, request.params.folioId, request.body),
  }));
}
