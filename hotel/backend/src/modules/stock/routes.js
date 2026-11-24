import {
  approveStockCountSchema,
  cancelStockCountSchema,
  createStockCountSchema,
  createWarehouseSchema,
  manualStockMovementSchema,
  stockCostReportQuerySchema,
  stockCountListQuerySchema,
  stockCountParamSchema,
  stockItemLevelParamSchema,
  stockLevelListQuerySchema,
  stockMovementListQuerySchema,
  stockProductReportQuerySchema,
  updateMinLevelSchema,
  updateStockCountLinesSchema,
  updateStockSettingsSchema,
  updateWarehouseSchema,
  warehouseListQuerySchema,
  warehouseParamSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as counts from './counts.js';
import * as manual from './manual.js';
import * as reports from './reports.js';
import * as service from './service.js';
import * as settings from './settings.js';

/**
 * Stok route'ları (modül 45 çekirdek + modül 44), `/stock` altında.
 *
 * - Görmek (mevcut, hareket, özet, sayımlar, maliyet raporları, ayarlar): `stock.view` (müdür, muhasebe, F&B).
 * - Depo tanımı, minimum seviye, elle hareket (çıkış / fire / transfer), sayım (aç, say, onayla, iptal),
 *   satış noktası → depo eşlemesi: `stock.manage`.
 * - Depo listesi mal kabul eden için de açık (`purchasing.receive`): irsaliyede depo seçilir.
 *
 * Listeler sayfalı; depo listesi `MAX_WAREHOUSES`, rapor aralığı `MAX_STOCK_REPORT_DAYS` ile sınırlı.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function stockRoutes(app) {
  const guard = (permission) => ({ preHandler: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.STOCK_VIEW);
  const manage = guard(PERMISSIONS.STOCK_MANAGE);
  const warehouseReaders = { preHandler: [withHotelContext, requireAnyPermission(PERMISSIONS.STOCK_VIEW, PERMISSIONS.PURCHASING_RECEIVE)] };
  const ok = (data) => ({ success: true, data });

  app.get('/summary', view, async (req) => ok(await service.getStockSummary(req.hotelId)));
  app.get('/levels', { ...view, schema: { querystring: stockLevelListQuerySchema } }, async (req) => ok(await service.listLevels(req.hotelId, req.query)));
  app.put('/items/:stockItemId/min-level', { ...manage, schema: { params: stockItemLevelParamSchema, body: updateMinLevelSchema } }, async (req) =>
    ok(await service.updateMinLevel(req.hotelId, req.params.stockItemId, req.body)),
  );
  app.get('/movements', { ...view, schema: { querystring: stockMovementListQuerySchema } }, async (req) => ok(await service.listMovements(req.hotelId, req.query)));
  // Elle hareket (modül 44): çıkış, fire, transfer; istek kimliğiyle tekrar güvenli.
  app.post('/movements', { ...manage, schema: { body: manualStockMovementSchema } }, async (req, reply) => reply.status(201).send(ok(await manual.createManualMovement(req.hotelId, req.body))));

  app.get('/warehouses', { ...warehouseReaders, schema: { querystring: warehouseListQuerySchema } }, async (req) => ok(await service.listWarehouses(req.hotelId, req.query)));
  app.post('/warehouses', { ...manage, schema: { body: createWarehouseSchema } }, async (req, reply) => reply.status(201).send(ok(await service.createWarehouse(req.hotelId, req.body))));
  app.put('/warehouses/:warehouseId', { ...manage, schema: { params: warehouseParamSchema, body: updateWarehouseSchema } }, async (req) =>
    ok(await service.updateWarehouse(req.hotelId, req.params.warehouseId, req.body)),
  );

  // Sayım (modül 44).
  app.get('/counts', { ...view, schema: { querystring: stockCountListQuerySchema } }, async (req) => ok(await counts.listCounts(req.hotelId, req.query)));
  app.post('/counts', { ...manage, schema: { body: createStockCountSchema } }, async (req, reply) => reply.status(201).send(ok(await counts.createCount(req.hotelId, req.body))));
  app.get('/counts/:countId', { ...view, schema: { params: stockCountParamSchema } }, async (req) => ok(await counts.getCount(req.hotelId, req.params.countId)));
  app.put('/counts/:countId/lines', { ...manage, schema: { params: stockCountParamSchema, body: updateStockCountLinesSchema } }, async (req) =>
    ok(await counts.saveCountLines(req.hotelId, req.params.countId, req.body)),
  );
  app.post('/counts/:countId/approve', { ...manage, schema: { params: stockCountParamSchema, body: approveStockCountSchema } }, async (req) =>
    ok(await counts.approveCount(req.hotelId, req.params.countId, req.body)),
  );
  app.post('/counts/:countId/cancel', { ...manage, schema: { params: stockCountParamSchema, body: cancelStockCountSchema } }, async (req) =>
    ok(await counts.cancelCount(req.hotelId, req.params.countId, req.body)),
  );

  // Maliyet raporları (modül 44): malzeme ve ürün bazlı.
  app.get('/reports/cost', { ...view, schema: { querystring: stockCostReportQuerySchema } }, async (req) => ok(await reports.costReport(req.hotelId, req.query)));
  app.get('/reports/products', { ...view, schema: { querystring: stockProductReportQuerySchema } }, async (req) => ok(await reports.productCostReport(req.hotelId, req.query)));

  // Satış noktası → depo (satış düşümü hangi depodan).
  app.get('/settings', view, async (req) => ok(await settings.describeStockSettings(req.hotelId)));
  app.put('/settings', { ...manage, schema: { body: updateStockSettingsSchema } }, async (req) => ok(await settings.saveStockSettings(req.hotelId, req.body)));
}
