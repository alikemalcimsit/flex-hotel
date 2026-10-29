import {
  createWarehouseSchema,
  stockItemLevelParamSchema,
  stockLevelListQuerySchema,
  stockMovementListQuerySchema,
  updateMinLevelSchema,
  updateWarehouseSchema,
  warehouseListQuerySchema,
  warehouseParamSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Stok route'ları (modül 45 — 44'ün çekirdeği), `/stock` altında.
 *
 * - Görmek (mevcut, hareket, özet): `stock.view` (müdür, muhasebe, F&B).
 * - Depo tanımı ve minimum seviye: `stock.manage`.
 * - Depo listesi mal kabul eden için de açık (`purchasing.receive`): irsaliyede depo seçilir.
 *
 * Mevcut ve hareket listeleri sayfalı; depo listesi `MAX_WAREHOUSES` ile sınırlı.
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

  app.get('/warehouses', { ...warehouseReaders, schema: { querystring: warehouseListQuerySchema } }, async (req) => ok(await service.listWarehouses(req.hotelId, req.query)));
  app.post('/warehouses', { ...manage, schema: { body: createWarehouseSchema } }, async (req, reply) => reply.status(201).send(ok(await service.createWarehouse(req.hotelId, req.body))));
  app.put('/warehouses/:warehouseId', { ...manage, schema: { params: warehouseParamSchema, body: updateWarehouseSchema } }, async (req) =>
    ok(await service.updateWarehouse(req.hotelId, req.params.warehouseId, req.body)),
  );
}
