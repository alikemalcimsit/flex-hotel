import {
  cancelNotificationSchema,
  channelConfigSchema,
  channelParamSchema,
  channelTestSchema,
  notificationHistoryQuerySchema,
  notificationParamSchema,
  notificationTemplateSchema,
  staffAlertParamSchema,
  staffAlertPreferencesSchema,
  staffAlertQuerySchema,
} from '@hotelos/hotel-contracts';
import { ValidationError } from '../../lib/errors.js';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import { deliverTestNotification } from './dispatcher.js';
import * as service from './service.js';
import * as alerts from './staff-alerts.js';

/**
 * Bildirim merkezi route'ları (modül 9).
 *
 * - Geçmiş: `notifications.view` (ön büro "onay e-postası gitti mi" sorusunu
 *   buradan cevaplar).
 * - Şablon, kanal ayarı, test, tekrar gönder, iptal: `notifications.manage`.
 */
export async function notificationRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.NOTIFICATIONS_VIEW)] };
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.NOTIFICATIONS_MANAGE)] };

  app.get('/history', { ...view, schema: { querystring: notificationHistoryQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listNotifications(request.hotelId, request.query),
  }));

  app.get('/summary', view, async (request) => ({
    success: true,
    data: await service.getNotificationSummary(request.hotelId),
  }));

  app.get(
    '/history/:notificationId',
    { ...view, schema: { params: notificationParamSchema } },
    async (request) => ({
      success: true,
      data: await service.getNotification(request.hotelId, request.params.notificationId),
    }),
  );

  app.post(
    '/history/:notificationId/resend',
    { ...manage, schema: { params: notificationParamSchema } },
    async (request, reply) => {
      const created = await service.resendNotification(request.hotelId, request.params.notificationId);
      reply.status(201);
      return { success: true, data: created };
    },
  );

  app.post(
    '/history/:notificationId/cancel',
    { ...manage, schema: { params: notificationParamSchema, body: cancelNotificationSchema } },
    async (request) => ({
      success: true,
      data: await service.cancelNotification(request.hotelId, request.params.notificationId, request.body),
    }),
  );

  app.get('/templates', manage, async (request) => ({
    success: true,
    data: await service.listTemplates(request.hotelId),
  }));

  app.put('/templates', { ...manage, schema: { body: notificationTemplateSchema } }, async (request) => ({
    success: true,
    data: await service.saveTemplate(request.hotelId, request.body),
  }));

  app.get('/channels', manage, async (request) => ({
    success: true,
    data: await service.getChannelConfigs(request.hotelId),
  }));

  app.put(
    '/channels/:channel',
    { ...manage, schema: { params: channelParamSchema, body: channelConfigSchema } },
    async (request) => {
      if (request.body.channel !== request.params.channel) {
        throw new ValidationError('Adresteki kanal ile gönderilen kanal aynı olmalı', { field: 'channel' });
      }
      return { success: true, data: await service.saveChannelConfig(request.hotelId, request.body) };
    },
  );

  // Test iletisi beklenerek gönderilir: yönetici sonucu hemen görmeli.
  app.post('/channels/test', { ...manage, schema: { body: channelTestSchema } }, async (request) => {
    const { id } = await service.prepareChannelTest(request.hotelId, request.body);
    const result = await deliverTestNotification(request.hotelId, id);
    await service.recordChannelTest(request.hotelId, request.body.channel, result);
    return { success: true, data: await service.getNotification(request.hotelId, id) };
  });
}

/**
 * Kişinin zili. İzin istemez: herkes yalnızca kendine ya da izinlerine
 * gönderilmiş uyarıları görür (süzme serviste).
 */
export async function staffAlertRoutes(app) {
  const own = { preHandler: [withHotelContext] };

  app.get('/', { ...own, schema: { querystring: staffAlertQuerySchema } }, async (request) => ({
    success: true,
    data: await alerts.listStaffAlerts(request.hotelId, request.query),
  }));

  app.get('/summary', own, async (request) => ({
    success: true,
    data: await alerts.getStaffAlertSummary(request.hotelId),
  }));

  app.post('/seen', own, async (request) => ({
    success: true,
    data: await alerts.markStaffAlertsSeen(request.hotelId),
  }));

  app.post('/read-all', own, async (request) => ({
    success: true,
    data: await alerts.markAllStaffAlertsRead(request.hotelId),
  }));

  app.post(
    '/:alertId/read',
    { ...own, schema: { params: staffAlertParamSchema } },
    async (request) => ({
      success: true,
      data: await alerts.markStaffAlertRead(request.hotelId, request.params.alertId),
    }),
  );

  app.put('/preferences', { ...own, schema: { body: staffAlertPreferencesSchema } }, async (request) => ({
    success: true,
    data: await alerts.updateStaffAlertPreferences(request.hotelId, request.body),
  }));
}
