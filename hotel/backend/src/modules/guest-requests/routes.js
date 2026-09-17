import { z } from 'zod';
import {
  changeGuestRequestStatusSchema,
  conversationParamSchema,
  createGuestRequestSchema,
  createRequestFromConversationSchema,
  guestRequestListQuerySchema,
  guestRequestParamSchema,
  updateGuestRequestSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Misafir istekleri route'ları (modül 7).
 *
 * Görüntüleme `requests.view`; açma, atama ve durum değiştirme
 * `requests.manage` — kat görevlisi isteği kapatabilmeli ama gelen kutusunu
 * görmesi gerekmez (modül 2'nin rol matrisi bu ayrımı kullanacak).
 */

const roomContextQuerySchema = z.object({
  roomId: z.string().uuid({ message: 'Geçersiz oda' }),
});

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function guestRequestRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.REQUESTS_VIEW)] };
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.REQUESTS_MANAGE)] };

  app.get('/', { ...view, schema: { querystring: guestRequestListQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listRequests(request.hotelId, request.query),
  }));

  app.get('/summary', view, async (request) => ({
    success: true,
    data: await service.getRequestSummary(request.hotelId),
  }));

  // Atama seçicisi: aktif personel (kullanıcı yönetimi modül 2'de).
  app.get('/assignees', view, async (request) => ({
    success: true,
    data: await service.listAssignees(request.hotelId),
  }));

  app.get('/room-context', { ...view, schema: { querystring: roomContextQuerySchema } }, async (request) => ({
    success: true,
    data: await service.getRoomContext(request.hotelId, request.query.roomId),
  }));

  app.get('/:requestId', { ...view, schema: { params: guestRequestParamSchema } }, async (request) => ({
    success: true,
    data: await service.getRequest(request.hotelId, request.params.requestId),
  }));

  app.post('/', { ...manage, schema: { body: createGuestRequestSchema } }, async (request, response) => {
    const created = await service.createRequest(request.hotelId, request.body);
    response.status(201);
    return { success: true, data: created };
  });

  app.post(
    '/from-conversation/:conversationId',
    { ...manage, schema: { params: conversationParamSchema, body: createRequestFromConversationSchema } },
    async (request, response) => {
      const created = await service.createRequestFromConversation(
        request.hotelId,
        request.params.conversationId,
        request.body,
      );
      response.status(201);
      return { success: true, data: created };
    },
  );

  app.patch(
    '/:requestId',
    { ...manage, schema: { params: guestRequestParamSchema, body: updateGuestRequestSchema } },
    async (request) => ({
      success: true,
      data: await service.updateRequest(request.hotelId, request.params.requestId, request.body),
    }),
  );

  app.post(
    '/:requestId/status',
    { ...manage, schema: { params: guestRequestParamSchema, body: changeGuestRequestStatusSchema } },
    async (request) => ({
      success: true,
      data: await service.changeRequestStatus(request.hotelId, request.params.requestId, request.body),
    }),
  );
}
