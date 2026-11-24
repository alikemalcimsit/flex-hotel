import {
  idParamSchema,
  packageInputSchema,
  packageListQuerySchema,
  priceHistoryQuerySchema,
  priceSuggestionListQuerySchema,
  ratePlanInputSchema,
  ratePlanListQuerySchema,
  updatePackageSchema,
  updatePriceSuggestionSchema,
  updateRatePlanSchema,
  updateYieldSettingsSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';
import * as yieldService from './yield-service.js';

/**
 * Fiyatlandırma route'ları (modül 28): fiyat planları ve paketler. Yönetim
 * `settings.*` izinleriyle (sezon / oda tipi gibi). Paket seçici rezervasyon
 * açan personele de lazım: `reservations.manage` ya da `settings.view`.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function pricingRoutes(app) {
  const view = { preValidation: [withHotelContext, requirePermission(PERMISSIONS.SETTINGS_VIEW)] };
  const manage = { preValidation: [withHotelContext, requirePermission(PERMISSIONS.SETTINGS_MANAGE)] };
  const picker = { preValidation: [withHotelContext, requireAnyPermission(PERMISSIONS.RESERVATIONS_MANAGE, PERMISSIONS.SETTINGS_VIEW)] };

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

  /* ── Dinamik fiyat / yield (modül 34) ──
   * Öneriler onay nesneleridir: liste `approvals.view`, çarpan düzenleme
   * `approvals.decide` (karar M11 onay uçlarından verilir). Yield kuralları
   * otel ayarıdır: `settings.view/manage`. */

  const approvalsView = { preValidation: [withHotelContext, requirePermission(PERMISSIONS.APPROVALS_VIEW)] };
  const approvalsDecide = { preValidation: [withHotelContext, requirePermission(PERMISSIONS.APPROVALS_DECIDE)] };

  app.get('/suggestions', { ...approvalsView, schema: { querystring: priceSuggestionListQuerySchema } }, async (request) => ({
    success: true,
    data: await yieldService.listSuggestions(request.hotelId, request.query),
  }));

  app.put(
    '/suggestions/:id',
    { ...approvalsDecide, schema: { params: idParamSchema, body: updatePriceSuggestionSchema } },
    async (request) => ({
      success: true,
      data: await yieldService.updateSuggestionMultiplier(request.hotelId, request.params.id, request.body),
    }),
  );

  app.get('/history', { ...approvalsView, schema: { querystring: priceHistoryQuerySchema } }, async (request) => ({
    success: true,
    data: await yieldService.getPriceHistory(request.hotelId, request.query),
  }));

  app.get('/yield-settings', view, async (request) => ({
    success: true,
    data: await yieldService.getYieldSettings(request.hotelId),
  }));

  app.put('/yield-settings', { ...manage, schema: { body: updateYieldSettingsSchema } }, async (request) => ({
    success: true,
    data: await yieldService.saveYieldSettings(request.hotelId, request.body),
  }));
}
