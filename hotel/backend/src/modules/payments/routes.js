import {
  cashMovementsQuerySchema,
  cashSummaryQuerySchema,
  exchangeRateHistoryQuerySchema,
  exchangeRatesInputSchema,
  folioParamSchema,
  folioStayParamSchema,
  paymentParamSchema,
  paymentQuoteSchema,
  paymentVoidSchema,
  receivePaymentSchema,
  refundRequestSchema,
  stayPaymentSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Ödeme route'ları (modül 17).
 *
 * Ödeme almak (tahsilat, ön ödeme, giriş teminatını işlemek) `payment.receive`;
 * iade ve ödeme iptali istemek `payment.refund` (ikisi de onaya gider; karar
 * `approvals.decide` ve isteyen dışında biri). Kasa `cash.view`, günlük kur
 * girişi `exchange_rates.manage`. Folyonun ödeme listesi folyo route'larında
 * (`GET /folios/:folioId/payments`, `folio.view`).
 *
 * Yanıt kodları: işlenen ödeme 201, onaya giden 202, aynı istek ikinci kez 200.
 */

/**
 * @param {{ payment: { status: string }, created: boolean }} result
 */
const statusCode = (result) => (!result.created ? 200 : result.payment.status === 'PENDING' ? 202 : 201);

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function paymentRoutes(app) {
  const receive = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.PAYMENT_RECEIVE)] };
  const refund = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.PAYMENT_REFUND)] };
  const cash = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.CASH_VIEW)] };
  const quote = { preHandler: [withHotelContext, requireAnyPermission(PERMISSIONS.PAYMENT_RECEIVE, PERMISSIONS.PAYMENT_REFUND)] };

  app.post('/quote', { ...quote, schema: { body: paymentQuoteSchema } }, async (request) => ({
    success: true,
    data: await service.quotePayment(request.hotelId, request.body),
  }));

  app.post('/folios/:folioId', { ...receive, schema: { params: folioParamSchema, body: receivePaymentSchema } }, async (request, reply) => {
    const result = await service.receivePayment(request.hotelId, request.params.folioId, request.body);
    reply.code(statusCode(result));
    return { success: true, data: result };
  });

  // Ön ödeme / depozito: folyo yoksa açılır.
  app.post(
    '/stays/:reservationId',
    { ...receive, schema: { params: folioStayParamSchema, body: stayPaymentSchema } },
    async (request, reply) => {
      const result = await service.receiveStayPayment(request.hotelId, request.params.reservationId, request.body);
      reply.code(statusCode(result));
      return { success: true, data: result };
    },
  );

  // Aktör kapalıyken (ya da beklemeden) girişte alınan teminatı ödeme olarak işlemek; tekrar basmak güvenli.
  app.post('/stays/:reservationId/deposit', { ...receive, schema: { params: folioStayParamSchema } }, async (request) => ({
    success: true,
    data: await service.recordCheckInDeposit(request.hotelId, request.params.reservationId),
  }));

  app.post(
    '/folios/:folioId/refunds',
    { ...refund, schema: { params: folioParamSchema, body: refundRequestSchema } },
    async (request, reply) => {
      const result = await service.requestRefund(request.hotelId, request.params.folioId, request.body);
      reply.code(result.created ? 202 : 200);
      return { success: true, data: result };
    },
  );

  app.post('/:paymentId/void', { ...refund, schema: { params: paymentParamSchema, body: paymentVoidSchema } }, async (request, reply) => {
    reply.code(202);
    return { success: true, data: await service.requestPaymentVoid(request.hotelId, request.params.paymentId, request.body) };
  });

  /* ── Kasa ── */

  app.get('/cash/summary', { ...cash, schema: { querystring: cashSummaryQuerySchema } }, async (request) => ({
    success: true,
    data: await service.getCashSummary(request.hotelId, request.query),
  }));

  app.get('/cash/movements', { ...cash, schema: { querystring: cashMovementsQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listCashMovements(request.hotelId, request.query),
  }));
}

/**
 * Döviz kuru route'ları (modül 17). Güncel kurları ödeme alan, iade isteyen,
 * kasayı gören ve kuru giren okur; girmek `exchange_rates.manage`.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function exchangeRateRoutes(app) {
  const read = {
    preHandler: [
      withHotelContext,
      requireAnyPermission(PERMISSIONS.PAYMENT_RECEIVE, PERMISSIONS.PAYMENT_REFUND, PERMISSIONS.CASH_VIEW, PERMISSIONS.EXCHANGE_RATES_MANAGE),
    ],
  };
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.EXCHANGE_RATES_MANAGE)] };

  app.get('/current', read, async (request) => ({
    success: true,
    data: await service.getCurrentRates(request.hotelId),
  }));

  app.get('/history', { ...read, schema: { querystring: exchangeRateHistoryQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listRateHistory(request.hotelId, request.query),
  }));

  app.put('/today', { ...manage, schema: { body: exchangeRatesInputSchema } }, async (request) => ({
    success: true,
    data: await service.setTodayRates(request.hotelId, request.body),
  }));
}
