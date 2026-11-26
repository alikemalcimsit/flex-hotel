import { kbsManualSchema, kbsNotificationListQuerySchema, kbsNotificationParamsSchema, kbsReservationParamsSchema, kbsSettingsSchema } from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * KBS route'ları (modül 58), `/kbs` altında.
 *
 * - Görmek (özet, mutabakat, bildirimler, ayar): `kbs.view`.
 * - Tekrar gönder, elle bildirildi: `kbs.send`.
 * - Ayar ve bağlantı denemesi: `kbs.manage`.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function kbsRoutes(app) {
  const guard = (permission) => ({ preValidation: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.KBS_VIEW);
  const send = guard(PERMISSIONS.KBS_SEND);
  const manage = guard(PERMISSIONS.KBS_MANAGE);
  const ok = (data) => ({ success: true, data });

  app.get('/settings', view, async (req) => ok(await service.getKbsSettings(req.hotelId)));
  app.put('/settings', { ...manage, schema: { body: kbsSettingsSchema } }, async (req) => ok(await service.saveKbsSettings(req.hotelId, req.body)));
  app.post('/settings/test', manage, async (req) => ok(await service.testKbsConnection(req.hotelId)));

  app.get('/summary', view, async (req) => ok(await service.kbsSummary(req.hotelId)));
  app.get('/notifications', { ...view, schema: { querystring: kbsNotificationListQuerySchema } }, async (req) => ok(await service.listKbsNotifications(req.hotelId, req.query)));
  app.get('/notifications/:notificationId', { ...view, schema: { params: kbsNotificationParamsSchema } }, async (req) => ok(await service.getKbsNotification(req.hotelId, req.params.notificationId)));
  app.post('/notifications/:notificationId/retry', { ...send, schema: { params: kbsNotificationParamsSchema } }, async (req) => ok(await service.retryKbsNotification(req.hotelId, req.params.notificationId)));
  app.post('/reservations/:reservationId/enqueue', { ...send, schema: { params: kbsReservationParamsSchema } }, async (req) => ok(await service.enqueueMissing(req.hotelId, req.params.reservationId)));
  app.post('/notifications/:notificationId/manual', { ...send, schema: { params: kbsNotificationParamsSchema, body: kbsManualSchema } }, async (req) => ok(await service.markKbsManual(req.hotelId, req.params.notificationId, req.body)));
}
