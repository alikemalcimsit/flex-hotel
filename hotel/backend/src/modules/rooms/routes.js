import { z } from 'zod';
import {
  assignableRoomsQuerySchema,
  assignRoomSchema,
  availabilityQuerySchema,
  blockListQuerySchema,
  blockRoomSchema,
  idParamSchema,
  listQuerySchema,
  roomInputSchema,
  roomListQuerySchema,
  setHousekeepingStatusSchema,
  stayAvailabilityQuerySchema,
  updateRoomSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Oda envanteri, oda durumu, arıza kayıtları, müsaitlik ve atama route'ları.
 *
 * İzinler ikiye ayrılıyor: envanter tanımını değiştirmek (oda ekleme, arıza
 * kaydı) yönetim işidir; oda atamak ve kat hizmeti durumunu değiştirmek ön
 * büro / kat hizmetleri işidir. Modül 2'nin rol matrisi bu ayrımı kullanacak.
 *
 * Doluluğu (Boş/Dolu) değiştiren bir route yok, kasıtlı: doluluğun tek
 * yazıcısı giriş-çıkış akışıdır (modül 6 → room-worker).
 */

const reservationParamSchema = z.object({
  reservationId: z.string().uuid({ message: 'Geçersiz rezervasyon' }),
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

  /* ── Kat hizmeti durumu ── */

  app.patch(
    '/:id/housekeeping',
    { ...operate, schema: { params: idParamSchema, body: setHousekeepingStatusSchema } },
    async (request) => ({
      success: true,
      data: await service.setHousekeepingStatus(request.hotelId, request.params.id, request.body),
    }),
  );

  /* ── Arıza kayıtları ── */

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

  // Silme değil "kaldırma": başlamamış kayıt iptal edilir, süren kayıt bugün
  // biter; hangisi olduğu yanıttaki `mode` alanında.
  app.delete('/blocks/:id', { ...manage, schema: { params: idParamSchema } }, async (request) => ({
    success: true,
    data: await service.removeBlock(request.hotelId, request.params.id),
  }));

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
    { ...view, schema: { params: reservationParamSchema, querystring: assignableRoomsQuerySchema } },
    async (request) => ({
      success: true,
      data: await service.getAssignableRooms(request.hotelId, request.params.reservationId, request.query),
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
