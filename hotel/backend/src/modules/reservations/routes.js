import {
  cancelReservationSchema,
  groupReservationSchema,
  idParamSchema,
  quoteQuerySchema,
  reservationInputSchema,
  reservationListQuerySchema,
  updateReservationSchema,
  waitingListInputSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Rezervasyon route'ları (modül 4). Görüntüleme `reservations.view`, yazma
 * `reservations.manage` ister. Servis tipli hata fırlatır; merkezi handler
 * HTTP durumuna çevirir (409 `NO_AVAILABILITY` dolu tarih, 409 `ROOM_NOT_FREE`
 * DB kısıtı).
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function reservationRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.RESERVATIONS_VIEW)] };
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.RESERVATIONS_MANAGE)] };

  app.get('/', { ...view, schema: { querystring: reservationListQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listReservations(request.hotelId, request.query),
  }));

  app.get('/quote', { ...view, schema: { querystring: quoteQuerySchema } }, async (request) => ({
    success: true,
    data: await service.quote(request.hotelId, request.query),
  }));

  app.get('/room-types', view, async (request) => ({
    success: true,
    data: await service.listBookableRoomTypes(request.hotelId),
  }));

  app.get('/guests', view, async (request) => ({
    success: true,
    data: await service.searchGuests(request.hotelId, request.query?.q),
  }));

  app.get('/:id', { ...view, schema: { params: idParamSchema } }, async (request) => ({
    success: true,
    data: await service.getReservation(request.hotelId, request.params.id),
  }));

  app.post('/', { ...manage, schema: { body: reservationInputSchema } }, async (request, reply) => {
    const created = await service.createReservation(request.hotelId, request.body);
    reply.status(201);
    return { success: true, data: created };
  });

  app.post('/group', { ...manage, schema: { body: groupReservationSchema } }, async (request, reply) => {
    const created = await service.createGroupReservation(request.hotelId, request.body);
    reply.status(201);
    return { success: true, data: created };
  });

  app.post('/waiting', { ...manage, schema: { body: waitingListInputSchema } }, async (request, reply) => {
    const created = await service.addToWaitingList(request.hotelId, request.body);
    reply.status(201);
    return { success: true, data: created };
  });

  app.post('/waiting/:id/promote', { ...manage, schema: { params: idParamSchema } }, async (request) => ({
    success: true,
    data: await service.promoteWaiting(request.hotelId, request.params.id),
  }));

  app.put('/:id', { ...manage, schema: { params: idParamSchema, body: updateReservationSchema } }, async (request) => ({
    success: true,
    data: await service.updateReservation(request.hotelId, request.params.id, request.body),
  }));

  app.post('/:id/cancel', { ...manage, schema: { params: idParamSchema, body: cancelReservationSchema } }, async (request) => ({
    success: true,
    data: await service.cancelReservation(request.hotelId, request.params.id, request.body),
  }));

  app.post('/:id/no-show', { ...manage, schema: { params: idParamSchema } }, async (request) => ({
    success: true,
    data: await service.markNoShow(request.hotelId, request.params.id),
  }));
}
