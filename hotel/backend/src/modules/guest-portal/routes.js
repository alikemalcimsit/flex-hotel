import {
  ONLINE_CHECKIN_PHOTO_BODY_LIMIT,
  ONLINE_CHECKIN_SUBMIT_BODY_LIMIT,
  guestPortalRequestSchema,
  guestPortalReservationParamSchema,
  guestPortalSettingsSchema,
  guestPortalTokenSchema,
  onlineCheckinApproveSchema,
  onlineCheckinDocumentStaffParamSchema,
  onlineCheckinListQuerySchema,
  onlineCheckinParamSchema,
  onlineCheckinPhotoSchema,
  onlineCheckinRejectSchema,
  onlineCheckinSubmitSchema,
} from '@hotelos/hotel-contracts';
import { z } from 'zod';
import { guestLinkLimit } from '../../lib/guest-rate-limit.js';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as documents from './documents.js';
import * as invites from './invites.js';
import * as links from './links.js';
import * as guest from './public.js';
import * as service from './service.js';

/**
 * Misafir portalı ve online check-in — personel route'ları (modül 53), `/guest-portal` altında.
 *
 * - `guest_portal.view`: online check-in listesi / ayrıntısı, belge fotoğrafları, imza, portal bağlantısı, ayarlar.
 * - `guest_portal.manage`: onay / düzeltme isteği, bağlantı ver / yenile / iptal, daveti gönder.
 * - `guest_portal.setup`: ayarlar.
 *
 * Belge fotoğrafı ve imza yetki denetleyen bu route'tan okunur (statik değil); tarayıcıda önbelleğe alınmaz.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function guestPortalRoutes(app) {
  const guard = (permission) => ({ preValidation: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.GUEST_PORTAL_VIEW);
  const manage = guard(PERMISSIONS.GUEST_PORTAL_MANAGE);
  const setup = guard(PERMISSIONS.GUEST_PORTAL_SETUP);
  const ok = (data) => ({ success: true, data });
  const sendFile = (reply, file) =>
    reply.header('Content-Type', file.contentType).header('Content-Length', file.size).header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff').send(file.stream);

  app.get('/settings', view, async (req) => ok(await service.getPortalSettings(req.hotelId)));
  app.put('/settings', { ...setup, schema: { body: guestPortalSettingsSchema } }, async (req) => ok(await service.savePortalSettings(req.hotelId, req.body)));

  app.get('/online-checkins', { ...view, schema: { querystring: onlineCheckinListQuerySchema } }, async (req) => ok(await service.listOnlineCheckins(req.hotelId, req.query)));
  app.get('/online-checkins/by-reservation/:reservationId', { ...view, schema: { params: guestPortalReservationParamSchema } }, async (req) =>
    ok(await service.getOnlineCheckinByReservation(req.hotelId, req.params.reservationId)),
  );
  app.get('/online-checkins/:onlineCheckinId', { ...view, schema: { params: onlineCheckinParamSchema } }, async (req) => ok(await service.getOnlineCheckin(req.hotelId, req.params.onlineCheckinId)));
  app.get(
    '/online-checkins/:onlineCheckinId/documents/:documentId',
    { ...view, schema: { params: onlineCheckinDocumentStaffParamSchema, querystring: z.object({ size: z.enum(['full', 'thumb']).default('full') }) } },
    async (req, reply) => sendFile(reply, await documents.openDocument(req.hotelId, req.params.onlineCheckinId, req.params.documentId, { thumb: req.query.size === 'thumb' })),
  );
  app.get('/online-checkins/:onlineCheckinId/signature', { ...view, schema: { params: onlineCheckinParamSchema } }, async (req, reply) =>
    sendFile(reply, await documents.openSignature(req.hotelId, req.params.onlineCheckinId)),
  );
  app.post('/online-checkins/:onlineCheckinId/approve', { ...manage, schema: { params: onlineCheckinParamSchema, body: onlineCheckinApproveSchema } }, async (req) =>
    ok(await service.approveOnlineCheckin(req.hotelId, req.params.onlineCheckinId, req.body)),
  );
  app.post('/online-checkins/:onlineCheckinId/reject', { ...manage, schema: { params: onlineCheckinParamSchema, body: onlineCheckinRejectSchema } }, async (req) =>
    ok(await service.rejectOnlineCheckin(req.hotelId, req.params.onlineCheckinId, req.body)),
  );

  app.get('/links/:reservationId', { ...view, schema: { params: guestPortalReservationParamSchema } }, async (req) => ok(await links.getPortalLink(req.hotelId, req.params.reservationId)));
  app.post('/links/:reservationId', { ...manage, schema: { params: guestPortalReservationParamSchema } }, async (req) => ok(await links.issuePortalLink(req.hotelId, req.params.reservationId)));
  app.delete('/links/:reservationId', { ...manage, schema: { params: guestPortalReservationParamSchema } }, async (req) => ok(await links.revokePortalLink(req.hotelId, req.params.reservationId)));
  app.post('/links/:reservationId/invite', { ...manage, schema: { params: guestPortalReservationParamSchema } }, async (req) => ok(await invites.sendPortalInvite(req.hotelId, req.params.reservationId)));
}

/** Misafir uçlarının bağlantı başına hız sınırları (dakikada; IP tavanı üst kapsamda, bkz. `lib/guest-rate-limit.js`). */
const GUEST_LIMITS = Object.freeze({ read: 60, photo: 20, write: 10 });

/**
 * Misafir portalı uçları (modül 53), `/public/portal` altında. Oturumsuzdur: kimlik bağlantının imzasıdır. Hız sınırı
 * bağlantı başınadır, üstünde IP tavanı vardır (otel Wi-Fi'ı misafirleri tek adresten çıkarır; bkz.
 * `lib/guest-rate-limit.js`). Yanıt önbelleğe alınmaz, belirteç yönlendirmeyle ve istek günlüğüyle sızmaz.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function publicGuestPortalRoutes(app) {
  const limited = guestLinkLimit;
  const ok = (data) => ({ success: true, data });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').header('x-content-type-options', 'nosniff');
  });
  const params = { params: guestPortalTokenSchema };

  app.get('/:token', { ...limited(GUEST_LIMITS.read), schema: params }, async (req) => ok(await guest.portalOverview(req.params.token)));
  app.get('/:token/check-in', { ...limited(GUEST_LIMITS.read), schema: params }, async (req) => ok(await guest.checkinForm(req.params.token)));
  app.post('/:token/check-in/photos', { ...limited(GUEST_LIMITS.photo), bodyLimit: ONLINE_CHECKIN_PHOTO_BODY_LIMIT, schema: { ...params, body: onlineCheckinPhotoSchema } }, async (req, reply) =>
    reply.status(201).send(ok(await documents.uploadDocumentPhoto(req.params.token, req.body))),
  );
  app.post('/:token/check-in', { ...limited(GUEST_LIMITS.write), bodyLimit: ONLINE_CHECKIN_SUBMIT_BODY_LIMIT, schema: { ...params, body: onlineCheckinSubmitSchema } }, async (req) =>
    ok(await guest.submitCheckin(req.params.token, req.body)),
  );
  app.get('/:token/folio', { ...limited(GUEST_LIMITS.read), schema: params }, async (req) => ok(await guest.portalFolio(req.params.token)));
  app.get('/:token/requests', { ...limited(GUEST_LIMITS.read), schema: params }, async (req) => ok(await guest.portalRequests(req.params.token)));
  app.post('/:token/requests', { ...limited(GUEST_LIMITS.write), schema: { ...params, body: guestPortalRequestSchema } }, async (req, reply) =>
    reply.status(201).send(ok(await guest.createPortalRequest(req.params.token, req.body))),
  );
  app.post('/:token/room-service', { ...limited(GUEST_LIMITS.write), schema: params }, async (req) => ok(await guest.portalRoomService(req.params.token)));
}
