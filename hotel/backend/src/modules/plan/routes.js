import {
  changeRoomSchema,
  planUnassignedQuerySchema,
  reservationParamSchema,
  roomPlanQuerySchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import { changeRoom, unassignRoom } from '../rooms/service.js';
import * as service from './service.js';

/**
 * Oda planı route'ları.
 *
 * Okumalar `rooms.view` ister; oda değiştirme `rooms.operate` — envanteri
 * tanımlamak (oda açmak, arıza kaydı) yönetim işi, misafiri odaya koymak ön
 * büro işidir. Modül 2'nin rol matrisi bu ayrımı devralacak.
 *
 * Yazma uçları kasıtlı olarak ince: iş `rooms/service.js`'te, çünkü kilitler ve
 * overbooking denetimi orada tek yerde duruyor.
 */

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function planRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.ROOMS_VIEW)] };
  const operate = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.ROOMS_OPERATE)] };

  app.get('/', { ...view, schema: { querystring: roomPlanQuerySchema } }, async (request) => ({
    success: true,
    data: await service.getRoomPlan(request.hotelId, request.query),
  }));

  app.get('/unassigned', { ...view, schema: { querystring: planUnassignedQuerySchema } }, async (request) => ({
    success: true,
    data: await service.getUnassignedForWindow(request.hotelId, request.query),
  }));

  app.get(
    '/reservations/:reservationId',
    { ...view, schema: { params: reservationParamSchema } },
    async (request) => ({
      success: true,
      data: await service.getReservationDetail(request.hotelId, request.params.reservationId),
    }),
  );

  // Sürükle-bırak buraya düşer. Atama mı taşıma mı olduğu yanıttaki `mode`'da:
  // içerideki misafir taşınırsa eski oda kirliye düşer, mesaj da farklıdır.
  app.put(
    '/reservations/:reservationId/room',
    { ...operate, schema: { params: reservationParamSchema, body: changeRoomSchema } },
    async (request) => ({
      success: true,
      data: await changeRoom(request.hotelId, request.params.reservationId, request.body.roomId),
    }),
  );

  app.delete(
    '/reservations/:reservationId/room',
    { ...operate, schema: { params: reservationParamSchema } },
    async (request) => ({
      success: true,
      data: await unassignRoom(request.hotelId, request.params.reservationId),
    }),
  );
}
