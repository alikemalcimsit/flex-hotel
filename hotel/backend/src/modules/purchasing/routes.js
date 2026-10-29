import {
  awardPurchaseRoundSchema,
  cancelPurchaseOrderSchema,
  cancelPurchaseRequestSchema,
  cancelPurchaseRoundSchema,
  closePurchaseOrderSchema,
  createBanquetPurchaseRequestSchema,
  createPurchaseRequestSchema,
  createPurchaseRoundSchema,
  createSupplierSchema,
  goodsReceiptListQuerySchema,
  goodsReceiptParamSchema,
  openRequestLinesQuerySchema,
  purchaseOrderListQuerySchema,
  purchaseOrderParamSchema,
  purchaseRequestListQuerySchema,
  purchaseRequestParamSchema,
  purchaseRoundListQuerySchema,
  purchaseRoundParamSchema,
  purchaseRoundQuoteParamSchema,
  purchaseSuggestionQuerySchema,
  receiveGoodsSchema,
  removePurchaseQuoteSchema,
  savePurchaseQuoteSchema,
  supplierListQuerySchema,
  supplierParamSchema,
  updatePurchaseSettingsSchema,
  updateSupplierSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as orders from './orders.js';
import { renderOrderPdf } from './pdf.js';
import * as receipts from './receipts.js';
import * as rounds from './rounds.js';
import * as service from './service.js';
import * as settings from './settings.js';
import * as suppliers from './suppliers.js';

/**
 * Satın alma route'ları (modül 43 / 45), `/purchasing` altında.
 *
 * - Görmek: `purchasing.view` (müdür, F&B, muhasebe).
 * - Talep açmak (banket, elle, minimum stok) ve açık talebi iptal: `purchasing.request`.
 * - Tedarikçi, teklif turu ve teklifler, kazanan seçimi (sipariş), sipariş iptali / eksik kapatma,
 *   politika: `purchasing.manage`. Eşik üstü sipariş onay kuyruğundan, başka yetkili onaylar.
 * - Mal kabul / irsaliye: `purchasing.receive` (ambar / mutfak da girer).
 *
 * Bütün listeler sayfalı; tur ve belge satırları sözleşme sınırlarıyla (`MAX_ROUND_LINES` …) sınırlı.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function purchasingRoutes(app) {
  const guard = (permission) => ({ preHandler: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.PURCHASING_VIEW);
  const request = guard(PERMISSIONS.PURCHASING_REQUEST);
  const manage = guard(PERMISSIONS.PURCHASING_MANAGE);
  const receive = guard(PERMISSIONS.PURCHASING_RECEIVE);
  // Talep açan da önerileri ve tedarikçi listesini görür (talep formu); teklif ekranı yönetimde.
  const requestOrManage = { preHandler: [withHotelContext, requireAnyPermission(PERMISSIONS.PURCHASING_REQUEST, PERMISSIONS.PURCHASING_MANAGE)] };
  const ok = (data) => ({ success: true, data });

  /* ── Talep ── */
  app.get('/requests', { ...view, schema: { querystring: purchaseRequestListQuerySchema } }, async (req) => ok(await service.listRequests(req.hotelId, req.query)));
  app.get('/requests/:requestId', { ...view, schema: { params: purchaseRequestParamSchema } }, async (req) => ok(await service.getRequest(req.hotelId, req.params.requestId)));
  app.post('/requests/banquet', { ...request, schema: { body: createBanquetPurchaseRequestSchema } }, async (req, reply) =>
    reply.status(201).send(ok(await service.createFromBanquet(req.hotelId, req.body))),
  );
  app.post('/requests', { ...request, schema: { body: createPurchaseRequestSchema } }, async (req, reply) => reply.status(201).send(ok(await service.createRequest(req.hotelId, req.body))));
  app.post('/requests/:requestId/cancel', { ...request, schema: { params: purchaseRequestParamSchema, body: cancelPurchaseRequestSchema } }, async (req) =>
    ok(await service.cancelRequest(req.hotelId, req.params.requestId, req.body)),
  );
  app.get('/suggestions', { ...requestOrManage, schema: { querystring: purchaseSuggestionQuerySchema } }, async (req) => ok(await service.listSuggestions(req.hotelId, req.query)));

  /* ── Tedarikçi ── */
  app.get('/suppliers', { ...view, schema: { querystring: supplierListQuerySchema } }, async (req) => ok(await suppliers.listSuppliers(req.hotelId, req.query)));
  app.get('/suppliers/:supplierId', { ...view, schema: { params: supplierParamSchema } }, async (req) => ok(await suppliers.getSupplier(req.hotelId, req.params.supplierId)));
  app.post('/suppliers', { ...manage, schema: { body: createSupplierSchema } }, async (req, reply) => reply.status(201).send(ok(await suppliers.createSupplier(req.hotelId, req.body))));
  app.put('/suppliers/:supplierId', { ...manage, schema: { params: supplierParamSchema, body: updateSupplierSchema } }, async (req) =>
    ok(await suppliers.updateSupplier(req.hotelId, req.params.supplierId, req.body)),
  );

  /* ── Teklif turu ── */
  app.get('/open-lines', { ...view, schema: { querystring: openRequestLinesQuerySchema } }, async (req) => ok(await rounds.listOpenLines(req.hotelId, req.query)));
  app.get('/rounds', { ...view, schema: { querystring: purchaseRoundListQuerySchema } }, async (req) => ok(await rounds.listRounds(req.hotelId, req.query)));
  app.post('/rounds', { ...manage, schema: { body: createPurchaseRoundSchema } }, async (req, reply) => reply.status(201).send(ok(await rounds.createRound(req.hotelId, req.body))));
  app.get('/rounds/:roundId', { ...view, schema: { params: purchaseRoundParamSchema } }, async (req) => ok(await rounds.getRound(req.hotelId, req.params.roundId)));
  app.get('/rounds/:roundId/supplier-suggestions', { ...manage, schema: { params: purchaseRoundParamSchema } }, async (req) => ok(await rounds.suggestSuppliers(req.hotelId, req.params.roundId)));
  app.put('/rounds/:roundId/quotes/:supplierId', { ...manage, schema: { params: purchaseRoundQuoteParamSchema, body: savePurchaseQuoteSchema } }, async (req) =>
    ok(await rounds.saveQuote(req.hotelId, req.params.roundId, req.params.supplierId, req.body)),
  );
  app.post('/rounds/:roundId/quotes/:supplierId/remove', { ...manage, schema: { params: purchaseRoundQuoteParamSchema, body: removePurchaseQuoteSchema } }, async (req) =>
    ok(await rounds.removeQuote(req.hotelId, req.params.roundId, req.params.supplierId, req.body)),
  );
  app.post('/rounds/:roundId/award', { ...manage, schema: { params: purchaseRoundParamSchema, body: awardPurchaseRoundSchema } }, async (req) =>
    ok(await rounds.awardRound(req.hotelId, req.params.roundId, req.body)),
  );
  app.post('/rounds/:roundId/cancel', { ...manage, schema: { params: purchaseRoundParamSchema, body: cancelPurchaseRoundSchema } }, async (req) =>
    ok(await rounds.cancelRound(req.hotelId, req.params.roundId, req.body)),
  );

  /* ── Sipariş ── */
  app.get('/orders', { ...view, schema: { querystring: purchaseOrderListQuerySchema } }, async (req) => ok(await orders.listOrders(req.hotelId, req.query)));
  app.get('/orders/:orderId', { ...view, schema: { params: purchaseOrderParamSchema } }, async (req) => ok(await orders.getOrder(req.hotelId, req.params.orderId)));
  app.get('/orders/:orderId/pdf', { ...view, schema: { params: purchaseOrderParamSchema } }, async (req, reply) => {
    const file = await renderOrderPdf(req.hotelId, req.params.orderId);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Length', file.buffer.length)
      .header('Content-Disposition', `inline; filename="${file.fileName}"`)
      // Sipariş durumu değişir (onay, teslim): her istekte güncel üretilir, önbelleğe alınmaz.
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff');
    return reply.send(file.buffer);
  });
  app.post('/orders/:orderId/cancel', { ...manage, schema: { params: purchaseOrderParamSchema, body: cancelPurchaseOrderSchema } }, async (req) =>
    ok(await orders.cancelOrder(req.hotelId, req.params.orderId, req.body)),
  );
  app.post('/orders/:orderId/close', { ...manage, schema: { params: purchaseOrderParamSchema, body: closePurchaseOrderSchema } }, async (req) =>
    ok(await orders.closeOrder(req.hotelId, req.params.orderId, req.body)),
  );

  /* ── Mal kabul ── */
  app.post('/orders/:orderId/receipts', { ...receive, schema: { params: purchaseOrderParamSchema, body: receiveGoodsSchema } }, async (req, reply) =>
    reply.status(201).send(ok(await receipts.receiveGoods(req.hotelId, req.params.orderId, req.body))),
  );
  app.get('/receipts', { ...view, schema: { querystring: goodsReceiptListQuerySchema } }, async (req) => ok(await receipts.listReceipts(req.hotelId, req.query)));
  app.get('/receipts/:receiptId', { ...view, schema: { params: goodsReceiptParamSchema } }, async (req) => ok(await receipts.getReceipt(req.hotelId, req.params.receiptId)));

  /* ── Politika ── */
  app.get('/settings', view, async (req) => ok(await settings.getPurchaseSettings(req.hotelId)));
  app.put('/settings', { ...manage, schema: { body: updatePurchaseSettingsSchema } }, async (req) => ok(await settings.updatePurchaseSettings(req.hotelId, req.body)));
}
