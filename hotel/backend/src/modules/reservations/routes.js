import { z } from 'zod';
import {
  cancelGroupSchema,
  cancelReservationSchema,
  closeWaitlistSchema,
  createGroupReservationSchema,
  createReservationSchema,
  createWaitlistSchema,
  guestSearchQuerySchema,
  noShowReservationSchema,
  reservationGroupParamSchema,
  reservationListQuerySchema,
  reservationParamSchema,
  reservationQuoteSchema,
  reservationVersionSchema,
  updateReservationSchema,
  waitlistListQuerySchema,
  waitlistParamSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, assertRequestPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import { getHotelSettings } from '../settings/service.js';
import { searchGuests } from './guests.js';
import * as service from './service.js';
import * as waitlist from './waitlist.js';

/**
 * Rezervasyon route'ları (modül 4).
 *
 * Görüntüleme `reservations.view`; açma, düzenleme, iptal, gelmedi ve bekleme
 * listesi `reservations.manage`. Elle fiyat ayrıca `reservations.price_override`
 * ister; gövdeye bağlı olduğu için handler içinde denetlenir
 * (`assertRequestPermission`).
 *
 * Açma cevabının durum kodu sonucu söyler: `201` açıldı, `200` aynı istek
 * daha önce açılmıştı, `202` yer yok ve yönetici onayına gönderildi.
 */

const OUTCOME_STATUS = Object.freeze({ CREATED: 201, EXISTING: 200, APPROVAL_REQUESTED: 202, APPROVAL_PENDING: 202 });

const historyQuerySchema = z.object({ cursor: z.string().max(200, 'Geçersiz imleç').optional() });

const PRICE_OVERRIDE_DENIED = 'Fiyatı elle değiştirme yetkiniz yok; sistem fiyatıyla devam edin ya da yöneticiye başvurun.';

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function reservationRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.RESERVATIONS_VIEW)] };
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.RESERVATIONS_MANAGE)] };

  /** @param {import('fastify').FastifyRequest} request */
  const priceOverride = (request) => {
    assertRequestPermission(request, PERMISSIONS.RESERVATIONS_PRICE_OVERRIDE, PRICE_OVERRIDE_DENIED);
    return true;
  };

  /* ── Liste, önizleme, misafir ── */

  app.get('/', { ...view, schema: { querystring: reservationListQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listReservations(request.hotelId, request.query),
  }));

  // Gövdeli okuma: satır listesi sorgu dizesine sığmaz.
  app.post('/quote', { ...view, schema: { body: reservationQuoteSchema } }, async (request) => ({
    success: true,
    data: await service.quoteReservation(request.hotelId, request.body),
  }));

  app.get('/guests', { ...view, schema: { querystring: guestSearchQuerySchema } }, async (request) => ({
    success: true,
    data: await searchGuests(request.hotelId, request.query.q, await getHotelSettings(request.hotelId)),
  }));

  /* ── Bekleme listesi ── */

  app.get('/waitlist', { ...view, schema: { querystring: waitlistListQuerySchema } }, async (request) => ({
    success: true,
    data: await waitlist.listWaitlist(request.hotelId, request.query),
  }));

  app.post('/waitlist', { ...manage, schema: { body: createWaitlistSchema } }, async (request, reply) => {
    reply.status(201);
    return { success: true, data: await waitlist.createWaitlistEntry(request.hotelId, request.body) };
  });

  app.get('/waitlist/:waitlistId', { ...view, schema: { params: waitlistParamSchema } }, async (request) => ({
    success: true,
    data: await waitlist.getWaitlistEntry(request.hotelId, request.params.waitlistId),
  }));

  app.post(
    '/waitlist/:waitlistId/close',
    { ...manage, schema: { params: waitlistParamSchema, body: closeWaitlistSchema } },
    async (request) => ({
      success: true,
      data: await waitlist.closeWaitlistEntry(request.hotelId, request.params.waitlistId, request.body),
    }),
  );

  /* ── Açma ── */

  app.post('/', { ...manage, schema: { body: createReservationSchema } }, async (request, reply) => {
    const canOverridePrice = request.body.manualTotal != null ? priceOverride(request) : false;
    const result = await service.createReservation(request.hotelId, request.body, { canOverridePrice });
    reply.status(OUTCOME_STATUS[result.outcome] ?? 200);
    return { success: true, data: result };
  });

  app.post('/groups', { ...manage, schema: { body: createGroupReservationSchema } }, async (request, reply) => {
    const result = await service.createGroupReservation(request.hotelId, request.body);
    reply.status(OUTCOME_STATUS[result.outcome] ?? 200);
    return { success: true, data: result };
  });

  app.post(
    '/groups/:groupId/cancel',
    { ...manage, schema: { params: reservationGroupParamSchema, body: cancelGroupSchema } },
    async (request) => ({
      success: true,
      data: await service.cancelGroup(request.hotelId, request.params.groupId, request.body),
    }),
  );

  /* ── Tek rezervasyon ── */

  app.get('/:reservationId', { ...view, schema: { params: reservationParamSchema } }, async (request) => ({
    success: true,
    data: await service.getReservation(request.hotelId, request.params.reservationId),
  }));

  app.get(
    '/:reservationId/history',
    { ...view, schema: { params: reservationParamSchema, querystring: historyQuerySchema } },
    async (request) => ({
      success: true,
      data: await service.getReservationHistory(request.hotelId, request.params.reservationId, request.query),
    }),
  );

  app.patch(
    '/:reservationId',
    { ...manage, schema: { params: reservationParamSchema, body: updateReservationSchema } },
    async (request) => {
      const canOverridePrice = request.body.price?.mode === 'MANUAL' ? priceOverride(request) : false;
      return {
        success: true,
        data: await service.updateReservation(request.hotelId, request.params.reservationId, request.body, { canOverridePrice }),
      };
    },
  );

  app.post(
    '/:reservationId/confirm',
    { ...manage, schema: { params: reservationParamSchema, body: reservationVersionSchema } },
    async (request) => ({
      success: true,
      data: await service.confirmReservation(request.hotelId, request.params.reservationId, request.body),
    }),
  );

  app.post(
    '/:reservationId/cancel',
    { ...manage, schema: { params: reservationParamSchema, body: cancelReservationSchema } },
    async (request) => ({
      success: true,
      data: await service.cancelReservation(request.hotelId, request.params.reservationId, request.body),
    }),
  );

  app.post(
    '/:reservationId/no-show',
    { ...manage, schema: { params: reservationParamSchema, body: noShowReservationSchema } },
    async (request) => ({
      success: true,
      data: await service.markNoShow(request.hotelId, request.params.reservationId, request.body),
    }),
  );

  app.post(
    '/:reservationId/reinstate',
    { ...manage, schema: { params: reservationParamSchema, body: reservationVersionSchema } },
    async (request) => ({
      success: true,
      data: await service.reinstateReservation(request.hotelId, request.params.reservationId, request.body),
    }),
  );
}
