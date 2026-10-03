import {
  catalogListQuerySchema,
  consumptionListQuerySchema,
  extrasIdParamSchema,
  extrasReportQuerySchema,
  laundryItemInputSchema,
  laundryLinesSchema,
  laundryListQuerySchema,
  laundryOrderSchema,
  laundrySettingsSchema,
  laundryStatusSchema,
  minibarConsumptionSchema,
  minibarItemInputSchema,
  roomLookupQuerySchema,
  updateLaundryItemSchema,
  updateMinibarItemSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as catalog from './catalog.js';
import * as laundry from './laundry.js';
import * as minibar from './minibar.js';
import * as report from './report.js';

/**
 * Minibar ve çamaşırhane route'ları (modül 19).
 *
 * Kayıtları, panoyu ve günlük raporu `extras.view` görür. Minibar sayımı
 * `minibar.post`, çamaşır siparişi `laundry.post`, fiyat listeleri ve ekspres
 * farkı `extras.manage`. Giriş ekranının ihtiyacı olan okumalar (oda arama,
 * satıştaki ürünler) giriş yetkisiyle de açılır.
 *
 * Yanıt kodları: yeni fiş / sipariş 201, aynı istek ikinci kez 200.
 */

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function extrasRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.EXTRAS_VIEW)] };
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.EXTRAS_MANAGE)] };
  const minibarPost = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.MINIBAR_POST)] };
  const laundryPost = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.LAUNDRY_POST)] };
  const entry = {
    preHandler: [
      withHotelContext,
      requireAnyPermission(PERMISSIONS.MINIBAR_POST, PERMISSIONS.LAUNDRY_POST, PERMISSIONS.EXTRAS_VIEW, PERMISSIONS.EXTRAS_MANAGE),
    ],
  };

  /* ── Giriş ekranları ── */

  app.get('/rooms/lookup', { ...entry, schema: { querystring: roomLookupQuerySchema } }, async (request) => ({
    success: true,
    data: await minibar.lookupRoom(request.hotelId, request.query),
  }));

  app.get('/minibar/items/active', entry, async (request) => ({
    success: true,
    data: await catalog.activeCatalog('MINIBAR', request.hotelId),
  }));

  app.get('/laundry/items/active', entry, async (request) => ({
    success: true,
    data: { items: await catalog.activeCatalog('LAUNDRY', request.hotelId), settings: await catalog.getLaundrySettings(request.hotelId) },
  }));

  /* ── Minibar ── */

  app.post('/minibar/consumptions', { ...minibarPost, schema: { body: minibarConsumptionSchema } }, async (request, reply) => {
    const result = await minibar.recordConsumption(request.hotelId, request.body);
    reply.code(result.created ? 201 : 200);
    return { success: true, data: result };
  });

  app.get('/minibar/consumptions', { ...view, schema: { querystring: consumptionListQuerySchema } }, async (request) => ({
    success: true,
    data: await minibar.listConsumptions(request.hotelId, request.query),
  }));

  /* ── Çamaşırhane ── */

  app.get('/laundry/orders', { ...view, schema: { querystring: laundryListQuerySchema } }, async (request) => ({
    success: true,
    data: await laundry.listLaundryOrders(request.hotelId, request.query),
  }));

  app.get('/laundry/orders/:id', { ...view, schema: { params: extrasIdParamSchema } }, async (request) => ({
    success: true,
    data: await laundry.getLaundryOrder(request.hotelId, request.params.id),
  }));

  app.post('/laundry/orders', { ...laundryPost, schema: { body: laundryOrderSchema } }, async (request, reply) => {
    const result = await laundry.createLaundryOrder(request.hotelId, request.body);
    reply.code(result.created ? 201 : 200);
    return { success: true, data: result };
  });

  app.put('/laundry/orders/:id/lines', { ...laundryPost, schema: { params: extrasIdParamSchema, body: laundryLinesSchema } }, async (request) => ({
    success: true,
    data: await laundry.updateLaundryLines(request.hotelId, request.params.id, request.body),
  }));

  app.post('/laundry/orders/:id/status', { ...laundryPost, schema: { params: extrasIdParamSchema, body: laundryStatusSchema } }, async (request) => ({
    success: true,
    data: await laundry.changeLaundryStatus(request.hotelId, request.params.id, request.body),
  }));

  /* ── Günlük rapor ── */

  app.get('/report', { ...view, schema: { querystring: extrasReportQuerySchema } }, async (request) => ({
    success: true,
    data: await report.getExtrasReport(request.hotelId, request.query),
  }));

  /* ── Fiyat listeleri ── */

  const catalogRoutes = (path, kind, inputSchema, updateSchema) => {
    app.get(path, { ...entry, schema: { querystring: catalogListQuerySchema } }, async (request) => ({
      success: true,
      data: await catalog.listCatalog(kind, request.hotelId, request.query),
    }));
    app.post(path, { ...manage, schema: { body: inputSchema } }, async (request, reply) => {
      reply.code(201);
      return { success: true, data: await catalog.createCatalogItem(kind, request.hotelId, request.body) };
    });
    app.put(`${path}/:id`, { ...manage, schema: { params: extrasIdParamSchema, body: updateSchema } }, async (request) => ({
      success: true,
      data: await catalog.updateCatalogItem(kind, request.hotelId, request.params.id, request.body),
    }));
    app.delete(`${path}/:id`, { ...manage, schema: { params: extrasIdParamSchema } }, async (request, reply) => {
      await catalog.deleteCatalogItem(kind, request.hotelId, request.params.id);
      reply.code(204);
    });
  };
  catalogRoutes('/minibar/items', 'MINIBAR', minibarItemInputSchema, updateMinibarItemSchema);
  catalogRoutes('/laundry/items', 'LAUNDRY', laundryItemInputSchema, updateLaundryItemSchema);

  app.get('/laundry/settings', entry, async (request) => ({
    success: true,
    data: await catalog.getLaundrySettings(request.hotelId),
  }));

  app.put('/laundry/settings', { ...manage, schema: { body: laundrySettingsSchema } }, async (request) => ({
    success: true,
    data: await catalog.updateLaundrySettings(request.hotelId, request.body),
  }));
}
