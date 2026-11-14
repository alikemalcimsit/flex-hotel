import {
  idParamSchema,
  packageInputSchema,
  packageListQuerySchema,
  ratePlanInputSchema,
  ratePlanListQuerySchema,
  updatePackageSchema,
  updateRatePlanSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Fiyatlandırma route'ları (modül 28): fiyat planları ve paketler. Yönetim
 * `settings.*` izinleriyle (sezon / oda tipi gibi). Paket seçici rezervasyon
 * açan personele de lazım: `reservations.manage` ya da `settings.view`.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function pricingRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.SETTINGS_VIEW)] };
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.SETTINGS_MANAGE)] };
  const picker = { preHandler: [withHotelContext, requireAnyPermission(PERMISSIONS.RESERVATIONS_MANAGE, PERMISSIONS.SETTINGS_VIEW)] };

  /* ── Fiyat planları ── */

  app.get('/rate-plans', { ...view, schema: { querystring: ratePlanListQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listRatePlans(request.hotelId, request.query),
  }));

  app.post('/rate-plans', { ...manage, schema: { body: ratePlanInputSchema } }, async (request, reply) => {
    const created = await service.createRatePlan(request.hotelId, request.body);
    reply.status(201);
    return { success: true, data: created };
  });

  app.put('/rate-plans/:id', { ...manage, schema: { params: idParamSchema, body: updateRatePlanSchema } }, async (request) => ({
    success: true,
    data: await service.updateRatePlan(request.hotelId, request.params.id, request.body),
  }));

  app.delete('/rate-plans/:id', { ...manage, schema: { params: idParamSchema } }, async (request) => {
    await service.deleteRatePlan(request.hotelId, request.params.id);
    return { success: true, data: { id: request.params.id } };
  });

  /* ── Paketler ── */

  app.get('/packages', { ...view, schema: { querystring: packageListQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listPackages(request.hotelId, request.query),
  }));

  /** Rezervasyon formu seçici: yayındaki paketler (ad, pansiyon, gecelik fiyat). */
  app.get('/packages/active', picker, async (request) => ({
    success: true,
    data: await service.getActivePackages(request.hotelId),
  }));

  app.post('/packages', { ...manage, schema: { body: packageInputSchema } }, async (request, reply) => {
    const created = await service.createPackage(request.hotelId, request.body);
    reply.status(201);
    return { success: true, data: created };
  });

  app.put('/packages/:id', { ...manage, schema: { params: idParamSchema, body: updatePackageSchema } }, async (request) => ({
    success: true,
    data: await service.updatePackage(request.hotelId, request.params.id, request.body),
  }));

  app.delete('/packages/:id', { ...manage, schema: { params: idParamSchema } }, async (request) => {
    await service.deletePackage(request.hotelId, request.params.id);
    return { success: true, data: { id: request.params.id } };
  });
}
