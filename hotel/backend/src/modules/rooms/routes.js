import { z } from 'zod';
import {
  assignRoomSchema,
  availabilityQuerySchema,
  blockRoomSchema,
  idParamSchema,
  listQuerySchema,
  roomInputSchema,
  roomListQuerySchema,
  setRoomStatusSchema,
  stayAvailabilityQuerySchema,
  updateRoomSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Oda envanteri, müsaitlik ve atama route'ları.
 *
 * İzinler ikiye ayrılıyor: envanter tanımını değiştirmek (oda ekleme, bloklama)
 * yönetim işidir; oda atamak ve durum değiştirmek ön büro işidir. Modül 2'nin
 * rol matrisi bu ayrımı kullanacak.
 */

const reservationParamSchema = z.object({
  reservationId: z.string().uuid({ message: 'Geçersiz rezervasyon' }),
});

const assignableQuerySchema = z.object({
  includeOtherTypes: z.coerce.boolean().default(false),
});

const blockListQuerySchema = z.object({
  roomId: z.string().uuid({ message: 'Geçersiz oda' }).optional(),
  includePast: z.coerce.boolean().default(false),
});

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function roomsRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.ROOMS_VIEW)] };
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.ROOMS_MANAGE)] };
  const operate = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.ROOMS_OPERATE)] };

  /* ── Oda envanteri ── */

  app.get('/', { ...view, schema: { querystring: roomListQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listRooms(request.hotelId, request.query),
  }));

  app.post('/', { ...manage, schema: { body: roomInputSchema } }, async (request, reply) => {
    const created = await service.createRoom(request.hotelId, request.body);
    reply.status(201);
    return { success: true, data: created };
  });

  app.put('/:id', { ...manage, schema: { params: idParamSchema, body: updateRoomSchema } }, async (request) => ({
    success: true,
    data: await service.updateRoom(request.hotelId, request.params.id, request.body),
  }));

  app.delete('/:id', { ...manage, schema: { params: idParamSchema } }, async (request) => {
    await service.deleteRoom(request.hotelId, request.params.id);
    return { success: true, data: { id: request.params.id } };
  });

  /* ── Oda durumu (ön büro / kat hizmetleri) ── */

  app.patch(
    '/:id/status',
    { ...operate, schema: { params: idParamSchema, body: setRoomStatusSchema } },
    async (request) => ({
      success: true,
      data: await service.setRoomStatus(request.hotelId, request.params.id, request.body),
    }),
  );

  /* ── Bloklar ── */

  app.get('/blocks', { ...view, schema: { querystring: blockListQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listBlocks(request.hotelId, request.query),
  }));

  app.post(
    '/:id/blocks',
    { ...manage, schema: { params: idParamSchema, body: blockRoomSchema } },
    async (request, reply) => {
      const created = await service.blockRoom(request.hotelId, request.params.id, request.body);
      reply.status(201);
      return { success: true, data: created };
    },
  );

  app.delete('/blocks/:id', { ...manage, schema: { params: idParamSchema } }, async (request) => {
    await service.unblockRoom(request.hotelId, request.params.id);
    return { success: true, data: { id: request.params.id } };
  });

  /* ── Müsaitlik ── */

  app.get('/availability', { ...view, schema: { querystring: availabilityQuerySchema } }, async (request) => ({
    success: true,
    data: await service.getAvailabilityCalendar(request.hotelId, request.query),
  }));

  app.get(
    '/availability/stay',
    { ...view, schema: { querystring: stayAvailabilityQuerySchema } },
    async (request) => ({
      success: true,
      data: await service.getStayAvailability(request.hotelId, request.query),
    }),
  );

  /* ── Oda atama ── */

  app.get(
    '/assignments/pending',
    { ...view, schema: { querystring: listQuerySchema } },
    async (request) => ({
      success: true,
      data: await service.listUnassignedReservations(request.hotelId, request.query),
    }),
  );

  app.get(
    '/assignments/:reservationId/candidates',
    { ...view, schema: { params: reservationParamSchema, querystring: assignableQuerySchema } },
    async (request) => ({
      success: true,
      data: await service.getAssignableRooms(request.hotelId, request.params.reservationId, {
        includeOtherTypes: request.query.includeOtherTypes,
      }),
    }),
  );

  app.put(
    '/assignments/:reservationId',
    { ...operate, schema: { params: reservationParamSchema, body: assignRoomSchema } },
    async (request) => ({
      success: true,
      data: await service.assignRoom(request.hotelId, request.params.reservationId, request.body.roomId),
    }),
  );

  app.delete(
    '/assignments/:reservationId',
    { ...operate, schema: { params: reservationParamSchema } },
    async (request) => ({
      success: true,
      data: await service.unassignRoom(request.hotelId, request.params.reservationId),
    }),
  );

  app.post(
    '/assignments/:reservationId/auto',
    { ...operate, schema: { params: reservationParamSchema } },
    async (request) => ({
      success: true,
      data: await service.autoAssignRoom(request.hotelId, request.params.reservationId),
    }),
  );
}
