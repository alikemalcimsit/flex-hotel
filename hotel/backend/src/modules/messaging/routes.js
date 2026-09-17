import {
  conversationParamSchema,
  inboxQuerySchema,
  messagesQuerySchema,
  sendMessageSchema,
  updateConversationSchema,
} from '@hotelos/hotel-contracts';
import { channelStatus } from '../../lib/channels.js';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Gelen kutusu route'ları (modül 7).
 *
 * Gelen mesaj için HTTP ucu **yok**: kanal geçidi (modül 8) kendi imza
 * doğrulamasını yapıp `receiveInboundMessage` servisini süreç içinde çağırır.
 * Kimliği doğrulanmamış bir uçtan "misafir mesajı" yazdırmak sahte mesaj
 * demektir.
 */

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function messagingRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.MESSAGES_VIEW)] };
  const reply = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.MESSAGES_REPLY)] };

  app.get('/conversations', { ...view, schema: { querystring: inboxQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listConversations(request.hotelId, request.query),
  }));

  app.get('/summary', view, async (request) => ({
    success: true,
    data: await service.getInboxSummary(request.hotelId),
  }));

  // Ekran "kanal bağlı değil" bilgisini buradan gösterir (modül 8 yokken boş).
  app.get('/channels', view, async () => ({ success: true, data: channelStatus() }));

  app.get(
    '/conversations/:conversationId',
    { ...view, schema: { params: conversationParamSchema } },
    async (request) => ({
      success: true,
      data: await service.getConversation(request.hotelId, request.params.conversationId),
    }),
  );

  app.get(
    '/conversations/:conversationId/messages',
    { ...view, schema: { params: conversationParamSchema, querystring: messagesQuerySchema } },
    async (request) => ({
      success: true,
      data: await service.listMessages(request.hotelId, request.params.conversationId, request.query),
    }),
  );

  app.post(
    '/conversations/:conversationId/messages',
    { ...reply, schema: { params: conversationParamSchema, body: sendMessageSchema } },
    async (request, response) => {
      const message = await service.sendStaffMessage(request.hotelId, request.params.conversationId, request.body);
      response.status(201);
      return { success: true, data: message };
    },
  );

  // Okundu işareti yalnızca görüntüleme izni ister: konuşmayı açan herkes okumuştur.
  app.post(
    '/conversations/:conversationId/read',
    { ...view, schema: { params: conversationParamSchema } },
    async (request) => ({
      success: true,
      data: await service.markConversationRead(request.hotelId, request.params.conversationId),
    }),
  );

  app.patch(
    '/conversations/:conversationId',
    { ...reply, schema: { params: conversationParamSchema, body: updateConversationSchema } },
    async (request) => ({
      success: true,
      data: await service.updateConversation(request.hotelId, request.params.conversationId, request.body),
    }),
  );
}
