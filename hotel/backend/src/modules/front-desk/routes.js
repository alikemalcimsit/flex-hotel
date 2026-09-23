import {
  arrivalsQuerySchema,
  checkInSchema,
  checkOutSchema,
  departuresQuerySchema,
  inHouseQuerySchema,
  revertStaySchema,
  stayParamSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, assertRequestPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Ön büro route'ları (modül 6).
 *
 * Listeler ve özet `stays.view` (kat hizmetleri de gidecekleri görür); giriş,
 * çıkış, önizlemeler ve geri alma `stays.manage`. Giriş önizlemesi kimlik
 * numarasının tamamını döndürdüğü için görüntüleme izniyle açılmaz.
 * Bakiyeyle çıkış gövdeye bağlı ek yetki ister (`stays.checkout_open_balance`).
 */

const OPEN_BALANCE_DENIED = 'Bakiyesi kapanmadan çıkış yapma yetkiniz yok; tahsilatı tamamlayın ya da yöneticiye başvurun.';

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function frontDeskRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.STAYS_VIEW)] };
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.STAYS_MANAGE)] };
  const params = { params: stayParamSchema };

  app.get('/summary', view, async (request) => ({
    success: true,
    data: await service.getFrontDeskSummary(request.hotelId),
  }));

  app.get('/arrivals', { ...view, schema: { querystring: arrivalsQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listArrivals(request.hotelId, request.query),
  }));

  app.get('/departures', { ...view, schema: { querystring: departuresQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listDepartures(request.hotelId, request.query),
  }));

  app.get('/in-house', { ...view, schema: { querystring: inHouseQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listInHouse(request.hotelId, request.query),
  }));

  app.get('/stays/:reservationId/check-in', { ...manage, schema: params }, async (request) => ({
    success: true,
    data: await service.getCheckInPreview(request.hotelId, request.params.reservationId),
  }));

  app.post('/stays/:reservationId/check-in', { ...manage, schema: { ...params, body: checkInSchema } }, async (request) => ({
    success: true,
    data: await service.checkIn(request.hotelId, request.params.reservationId, request.body),
  }));

  app.get('/stays/:reservationId/check-out', { ...manage, schema: params }, async (request) => ({
    success: true,
    data: await service.getCheckOutPreview(request.hotelId, request.params.reservationId),
  }));

  app.post('/stays/:reservationId/check-out', { ...manage, schema: { ...params, body: checkOutSchema } }, async (request) => {
    if (request.body.allowOpenBalance) {
      assertRequestPermission(request, PERMISSIONS.STAYS_OPEN_BALANCE, OPEN_BALANCE_DENIED);
    }
    return {
      success: true,
      data: await service.checkOut(request.hotelId, request.params.reservationId, request.body, {
        canAllowOpenBalance: request.body.allowOpenBalance,
      }),
    };
  });

  app.post('/stays/:reservationId/check-in/revert', { ...manage, schema: { ...params, body: revertStaySchema } }, async (request) => ({
    success: true,
    data: await service.revertCheckIn(request.hotelId, request.params.reservationId, request.body),
  }));

  app.post('/stays/:reservationId/check-out/revert', { ...manage, schema: { ...params, body: revertStaySchema } }, async (request) => ({
    success: true,
    data: await service.revertCheckOut(request.hotelId, request.params.reservationId, request.body),
  }));
}
