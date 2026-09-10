import {
  idParamSchema,
  listQuerySchema,
  roomTypeInputSchema,
  seasonInputSchema,
  taxInputSchema,
  updateGeneralSettingsSchema,
  updateHotelSchema,
  updateRoomTypeSchema,
  updateSeasonSchema,
  updateTaxSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Ayarlar route'ları.
 *
 * Route'larda try/catch yok: servis tipli hata fırlatır, server.js'deki merkezi
 * handler HTTP durumuna çevirir. Her route iki preHandler'dan geçer —
 * otel bağlamı ve izin işareti.
 *
 * DELETE'ler 204 değil 200 + gövde döner: frontend'in `api()` yardımcısı her
 * cevabı JSON olarak okuyor, boş gövde onu kırar.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function settingsRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.SETTINGS_VIEW)] };
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.SETTINGS_MANAGE)] };

  /* ── Otel bilgileri ── */

  app.get('/hotel', view, async (request) => ({
    success: true,
    data: await service.getHotel(request.hotelId),
  }));

  app.put('/hotel', { ...manage, schema: { body: updateHotelSchema } }, async (request) => ({
    success: true,
    data: await service.updateHotel(request.hotelId, request.body),
  }));

  /* ── Genel parametreler ── */

  app.put('/general', { ...manage, schema: { body: updateGeneralSettingsSchema } }, async (request) => ({
    success: true,
    data: await service.updateGeneralSettings(request.hotelId, request.body),
  }));

  /* ── Oda tipleri ── */

  app.get('/room-types', { ...view, schema: { querystring: listQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listRoomTypes(request.hotelId, request.query),
  }));

  app.post('/room-types', { ...manage, schema: { body: roomTypeInputSchema } }, async (request, reply) => {
    const created = await service.createRoomType(request.hotelId, request.body);
    reply.status(201);
    return { success: true, data: created };
  });

  app.put(
    '/room-types/:id',
    { ...manage, schema: { params: idParamSchema, body: updateRoomTypeSchema } },
    async (request) => ({
      success: true,
      data: await service.updateRoomType(request.hotelId, request.params.id, request.body),
    }),
  );

  app.delete('/room-types/:id', { ...manage, schema: { params: idParamSchema } }, async (request) => {
    await service.deleteRoomType(request.hotelId, request.params.id);
    return { success: true, data: { id: request.params.id } };
  });

  /* ── Vergiler ── */

  app.get('/taxes', { ...view, schema: { querystring: listQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listTaxes(request.hotelId, request.query),
  }));

  app.post('/taxes', { ...manage, schema: { body: taxInputSchema } }, async (request, reply) => {
    const created = await service.createTax(request.hotelId, request.body);
    reply.status(201);
    return { success: true, data: created };
  });

  app.put('/taxes/:id', { ...manage, schema: { params: idParamSchema, body: updateTaxSchema } }, async (request) => ({
    success: true,
    data: await service.updateTax(request.hotelId, request.params.id, request.body),
  }));

  app.delete('/taxes/:id', { ...manage, schema: { params: idParamSchema } }, async (request) => {
    await service.deleteTax(request.hotelId, request.params.id);
    return { success: true, data: { id: request.params.id } };
  });

  /* ── Sezonlar ── */

  app.get('/seasons', { ...view, schema: { querystring: listQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listSeasons(request.hotelId, request.query),
  }));

  app.post('/seasons', { ...manage, schema: { body: seasonInputSchema } }, async (request, reply) => {
    const created = await service.createSeason(request.hotelId, request.body);
    reply.status(201);
    return { success: true, data: created };
  });

  app.put(
    '/seasons/:id',
    { ...manage, schema: { params: idParamSchema, body: updateSeasonSchema } },
    async (request) => ({
      success: true,
      data: await service.updateSeason(request.hotelId, request.params.id, request.body),
    }),
  );

  app.delete('/seasons/:id', { ...manage, schema: { params: idParamSchema } }, async (request) => {
    await service.deleteSeason(request.hotelId, request.params.id);
    return { success: true, data: { id: request.params.id } };
  });
}
