import {
  bulkPosTablesSchema,
  closePosShiftSchema,
  createMenuCategorySchema,
  createMenuItemSchema,
  createPosOutletSchema,
  createPosTableSchema,
  menuCategoryParamSchema,
  menuItemListQuerySchema,
  menuItemParamSchema,
  menuItemSoldOutSchema,
  mergePosCheckSchema,
  movePosCheckSchema,
  openPosCheckSchema,
  openPosShiftSchema,
  posAdjustmentRefParamSchema,
  posAdjustmentSchema,
  posCheckListQuerySchema,
  posCheckParamSchema,
  posCheckVersionSchema,
  posFloorQuerySchema,
  posInHouseQuerySchema,
  posOutletParamSchema,
  posPaymentParamSchema,
  posPaymentRefParamSchema,
  posPaymentSchema,
  posRoomChargeSchema,
  posSalesQuerySchema,
  posShiftListQuerySchema,
  posShiftParamSchema,
  posTableParamSchema,
  reopenPosCheckSchema,
  requestPosBillSchema,
  sendPosOrderSchema,
  splitPosCheckSchema,
  transferPosCheckSchema,
  updateMenuCategorySchema,
  updateMenuItemSchema,
  updatePosCheckSchema,
  updatePosOutletSchema,
  updatePosSettingsSchema,
  updatePosTableSchema,
  voidPosPaymentSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as checks from './checks.js';
import * as payments from './payments.js';
import * as reports from './reports.js';
import * as setup from './setup.js';
import * as shifts from './shifts.js';

/**
 * Restoran POS route'ları (modül 39), `/pos` altında.
 *
 * - **Garson** (`pos.operate`): terminal, masa planı, adisyon açma / sipariş / hesap /
 *   bölme / taşıma / birleştirme / kendi adisyonunu devretme, ödeme ve odaya yazma, hatalı
 *   ödeme için iptal isteği, kendi vardiyası (aç / kapat / rapor).
 * - **Şef garson** (`pos.supervise`): ikram / iptal / indirim (eşik üstü dört göz onaya),
 *   kapanmış adisyonu yeniden açma, başkasının adisyonunu devretme, başkasının vardiyasını
 *   kapatma, "tükendi" anahtarı.
 * - **Tanımlar** (`pos.setup`): satış noktaları, masalar, menü grupları ve ürünler, politika.
 * - **Rapor** (`pos.report`): satış raporu, bütün vardiyalar ve raporları; adisyonları
 *   (kapanmışlar dahil) görür ama işlem yapamaz.
 *
 * Liste uçları sayfalıdır ya da tanımla sınırlıdır (satış noktası ≤ 30, masa ≤ 300 / nokta,
 * menü grubu ≤ 100); rapor en fazla 31 gün.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function posRoutes(app) {
  const guard = (permission) => ({ preHandler: [withHotelContext, requirePermission(permission)] });
  const operate = guard(PERMISSIONS.POS_OPERATE);
  const supervise = guard(PERMISSIONS.POS_SUPERVISE);
  const configure = guard(PERMISSIONS.POS_SETUP);
  const report = guard(PERMISSIONS.POS_REPORT);
  /** Okuma: garson ya da raporcu (muhasebe kapanmış adisyonu ve vardiya raporunu görür). */
  const read = { preHandler: [withHotelContext, requireAnyPermission(PERMISSIONS.POS_OPERATE, PERMISSIONS.POS_REPORT)] };
  const ok = (data) => ({ success: true, data });
  /** @param {any} request */
  const has = (request, permission) => Boolean(request.auth?.permissions?.includes(permission));
  const canSupervise = (request) => has(request, PERMISSIONS.POS_SUPERVISE);
  const canSeeAll = (request) => canSupervise(request) || has(request, PERMISSIONS.POS_REPORT);

  /* ── Terminal ve masa planı ── */

  app.get('/terminal', operate, async (request) => ok(await setup.getTerminal(request.hotelId)));

  app.get('/floor', { ...operate, schema: { querystring: posFloorQuerySchema } }, async (request) =>
    ok(await checks.getFloor(request.hotelId, request.query.outletId)),
  );

  app.get('/in-house', { ...operate, schema: { querystring: posInHouseQuerySchema } }, async (request) =>
    ok(await payments.inHouseStays(request.hotelId, request.query)),
  );

  /* ── Adisyon ── */

  app.get('/checks', { ...read, schema: { querystring: posCheckListQuerySchema } }, async (request) =>
    ok(await checks.listChecks(request.hotelId, request.query)),
  );

  app.post('/checks', { ...operate, schema: { body: openPosCheckSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await checks.openCheck(request.hotelId, request.body))),
  );

  app.get('/checks/:checkId', { ...read, schema: { params: posCheckParamSchema } }, async (request) =>
    ok(await checks.getCheck(request.hotelId, request.params.checkId)),
  );

  app.put('/checks/:checkId', { ...operate, schema: { params: posCheckParamSchema, body: updatePosCheckSchema } }, async (request) =>
    ok(await checks.updateCheck(request.hotelId, request.params.checkId, request.body)),
  );

  app.post('/checks/:checkId/orders', { ...operate, schema: { params: posCheckParamSchema, body: sendPosOrderSchema } }, async (request) =>
    ok(await checks.sendOrder(request.hotelId, request.params.checkId, request.body)),
  );

  app.post('/checks/:checkId/bill', { ...operate, schema: { params: posCheckParamSchema, body: requestPosBillSchema } }, async (request) =>
    ok(await checks.requestBill(request.hotelId, request.params.checkId, request.body)),
  );

  app.post('/checks/:checkId/adjustments', { ...supervise, schema: { params: posCheckParamSchema, body: posAdjustmentSchema } }, async (request) =>
    ok(await checks.requestAdjustment(request.hotelId, request.params.checkId, request.body)),
  );

  app.post('/checks/:checkId/split', { ...operate, schema: { params: posCheckParamSchema, body: splitPosCheckSchema } }, async (request) =>
    ok(await checks.splitCheck(request.hotelId, request.params.checkId, request.body)),
  );

  app.post('/checks/:checkId/move', { ...operate, schema: { params: posCheckParamSchema, body: movePosCheckSchema } }, async (request) =>
    ok(await checks.moveCheck(request.hotelId, request.params.checkId, request.body)),
  );

  app.post('/checks/:checkId/merge', { ...operate, schema: { params: posCheckParamSchema, body: mergePosCheckSchema } }, async (request) =>
    ok(await checks.mergeChecks(request.hotelId, request.params.checkId, request.body)),
  );

  app.post('/checks/:checkId/transfer', { ...operate, schema: { params: posCheckParamSchema, body: transferPosCheckSchema } }, async (request) =>
    ok(await checks.transferCheck(request.hotelId, request.params.checkId, request.body, { canSupervise: canSupervise(request) })),
  );

  app.post('/checks/:checkId/close', { ...operate, schema: { params: posCheckParamSchema, body: posCheckVersionSchema } }, async (request) =>
    ok(await checks.closeCheck(request.hotelId, request.params.checkId, request.body)),
  );

  app.post('/checks/:checkId/void', { ...operate, schema: { params: posCheckParamSchema, body: posCheckVersionSchema } }, async (request) =>
    ok(await checks.voidEmptyCheck(request.hotelId, request.params.checkId, request.body)),
  );

  app.post('/checks/:checkId/reopen', { ...supervise, schema: { params: posCheckParamSchema, body: reopenPosCheckSchema } }, async (request) =>
    ok(await checks.reopenCheck(request.hotelId, request.params.checkId, request.body)),
  );

  /** Onay ekranının "aç" bağlantısı: düzeltmenin / ödemenin adisyonu. */
  app.get('/adjustments/:adjustmentId', { ...read, schema: { params: posAdjustmentRefParamSchema } }, async (request) =>
    ok(await checks.findAdjustmentCheck(request.hotelId, request.params.adjustmentId)),
  );

  /* ── Ödeme ve odaya yaz ── */

  app.post('/checks/:checkId/payments', { ...operate, schema: { params: posCheckParamSchema, body: posPaymentSchema } }, async (request, reply) => {
    const result = await payments.receivePayment(request.hotelId, request.params.checkId, request.body);
    return reply.status(result.created ? 201 : 200).send(ok(result));
  });

  app.post(
    '/checks/:checkId/payments/:paymentId/void',
    { ...operate, schema: { params: posPaymentParamSchema, body: voidPosPaymentSchema } },
    async (request) => ok(await payments.requestPaymentVoid(request.hotelId, request.params.checkId, request.params.paymentId, request.body)),
  );

  app.get('/payments/:paymentId', { ...read, schema: { params: posPaymentRefParamSchema } }, async (request) =>
    ok(await payments.findPaymentCheck(request.hotelId, request.params.paymentId)),
  );

  app.post('/checks/:checkId/room-charge', { ...operate, schema: { params: posCheckParamSchema, body: posRoomChargeSchema } }, async (request) =>
    ok(await payments.chargeToRoom(request.hotelId, request.params.checkId, request.body)),
  );

  /* ── Vardiya ── */

  app.get('/shifts/current', operate, async (request) => ok(await shifts.getCurrentShift(request.hotelId)));

  app.get('/shifts/open-waiters', operate, async (request) => ok(await shifts.openShiftWaiters(request.hotelId)));

  app.post('/shifts', { ...operate, schema: { body: openPosShiftSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await shifts.openShift(request.hotelId, request.body))),
  );

  app.get('/shifts', { ...read, schema: { querystring: posShiftListQuerySchema } }, async (request) =>
    ok(await shifts.listShifts(request.hotelId, request.query, { canSeeAll: canSeeAll(request) })),
  );

  app.get('/shifts/:shiftId', { ...read, schema: { params: posShiftParamSchema } }, async (request) =>
    ok(await shifts.getShift(request.hotelId, request.params.shiftId, { canSeeAll: canSeeAll(request) })),
  );

  app.post('/shifts/:shiftId/close', { ...operate, schema: { params: posShiftParamSchema, body: closePosShiftSchema } }, async (request) =>
    ok(await shifts.closeShift(request.hotelId, request.params.shiftId, request.body, { canSupervise: canSupervise(request) })),
  );

  app.get('/shifts/:shiftId/report', { ...read, schema: { params: posShiftParamSchema } }, async (request) =>
    ok(await shifts.shiftReport(request.hotelId, request.params.shiftId, { canSeeAll: canSeeAll(request) })),
  );

  /* ── Rapor ── */

  app.get('/reports/sales', { ...report, schema: { querystring: posSalesQuerySchema } }, async (request) =>
    ok(await reports.salesReport(request.hotelId, request.query)),
  );

  /* ── Tanımlar ── */

  /** Satış noktası listesi süzgeçlerde de kullanılır (garson, raporcu, tanımcı). */
  app.get('/outlets', { preHandler: [withHotelContext, requireAnyPermission(PERMISSIONS.POS_OPERATE, PERMISSIONS.POS_REPORT, PERMISSIONS.POS_SETUP)] }, async (request) =>
    ok(await setup.listOutlets(request.hotelId)),
  );

  app.post('/outlets', { ...configure, schema: { body: createPosOutletSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await setup.createOutlet(request.hotelId, request.body))),
  );

  app.put('/outlets/:outletId', { ...configure, schema: { params: posOutletParamSchema, body: updatePosOutletSchema } }, async (request) =>
    ok(await setup.updateOutlet(request.hotelId, request.params.outletId, request.body)),
  );

  app.get('/outlets/:outletId/tables', { ...configure, schema: { params: posOutletParamSchema } }, async (request) =>
    ok(await setup.listTables(request.hotelId, request.params.outletId)),
  );

  app.post('/tables', { ...configure, schema: { body: createPosTableSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await setup.createTable(request.hotelId, request.body))),
  );

  app.post('/tables/bulk', { ...configure, schema: { body: bulkPosTablesSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await setup.createTablesBulk(request.hotelId, request.body))),
  );

  app.put('/tables/:tableId', { ...configure, schema: { params: posTableParamSchema, body: updatePosTableSchema } }, async (request) =>
    ok(await setup.updateTable(request.hotelId, request.params.tableId, request.body)),
  );

  app.get('/menu/categories', configure, async (request) => ok(await setup.listCategories(request.hotelId)));

  app.post('/menu/categories', { ...configure, schema: { body: createMenuCategorySchema } }, async (request, reply) =>
    reply.status(201).send(ok(await setup.createCategory(request.hotelId, request.body))),
  );

  app.put('/menu/categories/:categoryId', { ...configure, schema: { params: menuCategoryParamSchema, body: updateMenuCategorySchema } }, async (request) =>
    ok(await setup.updateCategory(request.hotelId, request.params.categoryId, request.body)),
  );

  app.get('/menu/items', { ...configure, schema: { querystring: menuItemListQuerySchema } }, async (request) =>
    ok(await setup.listItems(request.hotelId, request.query)),
  );

  app.post('/menu/items', { ...configure, schema: { body: createMenuItemSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await setup.createItem(request.hotelId, request.body))),
  );

  app.put('/menu/items/:itemId', { ...configure, schema: { params: menuItemParamSchema, body: updateMenuItemSchema } }, async (request) =>
    ok(await setup.updateItem(request.hotelId, request.params.itemId, request.body)),
  );

  app.put('/menu/items/:itemId/sold-out', { ...supervise, schema: { params: menuItemParamSchema, body: menuItemSoldOutSchema } }, async (request) =>
    ok(await setup.setSoldOut(request.hotelId, request.params.itemId, request.body)),
  );

  app.get('/settings', configure, async (request) => ok(await setup.getSettings(request.hotelId)));

  app.put('/settings', { ...configure, schema: { body: updatePosSettingsSchema } }, async (request) =>
    ok(await setup.updateSettings(request.hotelId, request.body)),
  );
}
