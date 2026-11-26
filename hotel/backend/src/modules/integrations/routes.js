import {
  apiClientCreateSchema,
  apiClientParamSchema,
  apiClientUpdateSchema,
  apiKeyCreateSchema,
  apiKeyParamSchema,
  webhookCreateSchema,
  webhookDeliveryListQuerySchema,
  webhookDeliveryParamSchema,
  webhookParamSchema,
  webhookUpdateSchema,
  webhookVersionSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Entegrasyon yönetimi uçları (modül 61, panel). Görüntüleme `integrations.view`; uygulama / anahtar / abonelik
 * değişikliği ve yeniden gönderim `integrations.manage`.
 *
 * Anahtarın ve imza sırrının kendisi yalnız oluşturma (ve sır yenileme) cevabında döner; cevaplar önbelleğe
 * alınmasın diye `no-store`.
 */
export async function integrationRoutes(app) {
  const view = { preValidation: [withHotelContext, requirePermission(PERMISSIONS.INTEGRATIONS_VIEW)] };
  const manage = { preValidation: [withHotelContext, requirePermission(PERMISSIONS.INTEGRATIONS_MANAGE)] };
  const noStore = (reply) => reply.header('cache-control', 'no-store');

  /* ── Uygulamalar ── */

  app.get('/clients', view, async (request) => ({ success: true, data: await service.listApiClients(request.hotelId) }));

  app.post('/clients', { ...manage, schema: { body: apiClientCreateSchema } }, async (request, reply) => {
    reply.status(201);
    return { success: true, data: await service.createApiClient(request.hotelId, request.body) };
  });

  app.get('/clients/:clientId', { ...view, schema: { params: apiClientParamSchema } }, async (request) => ({
    success: true,
    data: await service.getApiClient(request.hotelId, request.params.clientId),
  }));

  app.patch('/clients/:clientId', { ...manage, schema: { params: apiClientParamSchema, body: apiClientUpdateSchema } }, async (request) => ({
    success: true,
    data: await service.updateApiClient(request.hotelId, request.params.clientId, request.body),
  }));

  app.delete('/clients/:clientId', { ...manage, schema: { params: apiClientParamSchema, body: webhookVersionSchema } }, async (request) => {
    await service.deleteApiClient(request.hotelId, request.params.clientId, request.body);
    return { success: true, data: null };
  });

  /* ── Anahtarlar ── */

  app.post('/clients/:clientId/keys', { ...manage, schema: { params: apiClientParamSchema, body: apiKeyCreateSchema } }, async (request, reply) => {
    noStore(reply);
    reply.status(201);
    return { success: true, data: await service.createApiKey(request.hotelId, request.params.clientId, request.body) };
  });

  app.post('/clients/:clientId/keys/:keyId/revoke', { ...manage, schema: { params: apiKeyParamSchema } }, async (request) => ({
    success: true,
    data: await service.revokeApiKey(request.hotelId, request.params.clientId, request.params.keyId),
  }));

  /* ── Webhook abonelikleri ── */

  app.post('/clients/:clientId/webhooks', { ...manage, schema: { params: apiClientParamSchema, body: webhookCreateSchema } }, async (request, reply) => {
    noStore(reply);
    reply.status(201);
    return { success: true, data: await service.createWebhook(request.hotelId, request.params.clientId, request.body) };
  });

  app.patch('/clients/:clientId/webhooks/:subscriptionId', { ...manage, schema: { params: webhookParamSchema, body: webhookUpdateSchema } }, async (request) => ({
    success: true,
    data: await service.updateWebhook(request.hotelId, request.params.clientId, request.params.subscriptionId, request.body),
  }));

  app.post('/clients/:clientId/webhooks/:subscriptionId/rotate-secret', { ...manage, schema: { params: webhookParamSchema, body: webhookVersionSchema } }, async (request, reply) => {
    noStore(reply);
    return { success: true, data: await service.rotateWebhookSecret(request.hotelId, request.params.clientId, request.params.subscriptionId, request.body) };
  });

  app.post('/clients/:clientId/webhooks/:subscriptionId/test', { ...manage, schema: { params: webhookParamSchema } }, async (request) => ({
    success: true,
    data: await service.sendTestWebhook(request.hotelId, request.params.clientId, request.params.subscriptionId),
  }));

  app.delete('/clients/:clientId/webhooks/:subscriptionId', { ...manage, schema: { params: webhookParamSchema, body: webhookVersionSchema } }, async (request) => {
    await service.deleteWebhook(request.hotelId, request.params.clientId, request.params.subscriptionId, request.body);
    return { success: true, data: null };
  });

  /* ── Teslimat logu ── */

  app.get('/deliveries', { ...view, schema: { querystring: webhookDeliveryListQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listWebhookDeliveries(request.hotelId, request.query),
  }));

  app.get('/deliveries/:deliveryId', { ...view, schema: { params: webhookDeliveryParamSchema } }, async (request) => ({
    success: true,
    data: await service.getWebhookDelivery(request.hotelId, request.params.deliveryId),
  }));

  app.post('/deliveries/:deliveryId/redeliver', { ...manage, schema: { params: webhookDeliveryParamSchema } }, async (request) => ({
    success: true,
    data: await service.redeliverWebhook(request.hotelId, request.params.deliveryId),
  }));
}
