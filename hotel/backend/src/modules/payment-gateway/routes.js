import { gatewayRefundSchema, paymentGatewaySettingsSchema, paymentLinkCodeParamsSchema, paymentLinkCreateSchema, paymentLinkListQuerySchema, paymentLinkParamsSchema, paymentLinkReservationParamsSchema } from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as checkout from './checkout.js';
import * as links from './links.js';
import * as refunds from './refunds.js';
import * as settings from './settings.js';

/**
 * Sanal POS route'ları (modül 50), `/payment-gateway` altında.
 * - Görmek (linkler, işlemler, ayar, konaklama özeti): `payment_gateway.view`.
 * - Link oluştur / gönder / iptal: `payment_gateway.send`. Karta iade isteği: `payment.refund` (onaya gider).
 * - Ayar ve bağlantı denemesi: `payment_gateway.setup`.
 * @param {import('fastify').FastifyInstance} app
 */
export async function paymentGatewayRoutes(app) {
  const guard = (permission) => ({ preValidation: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.PAYMENT_GATEWAY_VIEW);
  const send = guard(PERMISSIONS.PAYMENT_GATEWAY_SEND);
  const setup = guard(PERMISSIONS.PAYMENT_GATEWAY_SETUP);
  const refund = guard(PERMISSIONS.PAYMENT_REFUND);
  const ok = (data) => ({ success: true, data });
  const linkParams = { params: paymentLinkParamsSchema };

  app.get('/settings', view, async (req) => ok(await settings.getGatewaySettings(req.hotelId)));
  app.put('/settings', { ...setup, schema: { body: paymentGatewaySettingsSchema } }, async (req) => ok(await settings.saveGatewaySettings(req.hotelId, req.body)));
  app.post('/settings/test', setup, async (req) => ok(await settings.testGatewayConnection(req.hotelId)));

  app.get('/links', { ...view, schema: { querystring: paymentLinkListQuerySchema } }, async (req) => ok(await links.listPaymentLinks(req.hotelId, req.query)));
  app.get('/links/:linkId', { ...view, schema: linkParams }, async (req) => ok(await links.getPaymentLink(req.hotelId, req.params.linkId)));
  app.post('/links/:linkId/send', { ...send, schema: linkParams }, async (req) => ok(await links.sendPaymentLink(req.hotelId, req.params.linkId)));
  app.post('/links/:linkId/cancel', { ...send, schema: linkParams }, async (req) => ok(await links.cancelPaymentLink(req.hotelId, req.params.linkId)));
  app.post('/links/:linkId/refund', { ...refund, schema: { ...linkParams, body: gatewayRefundSchema } }, async (req, reply) => reply.status(201).send(ok(await refunds.requestGatewayRefund(req.hotelId, req.params.linkId, req.body))));

  app.get('/reservations/:reservationId', { ...view, schema: { params: paymentLinkReservationParamsSchema } }, async (req) => ok(await links.reservationGateway(req.hotelId, req.params.reservationId)));
  app.post('/reservations/:reservationId/links', { ...send, schema: { params: paymentLinkReservationParamsSchema, body: paymentLinkCreateSchema } }, async (req, reply) =>
    reply.status(201).send(ok(await links.createPaymentLink(req.hotelId, req.params.reservationId, req.body))),
  );
}

/** Bağlantı başına sınır (kod ile), yoksa IP. */
const byCode = (max) => ({ config: { rateLimit: { max, timeWindow: 60_000, keyGenerator: (request) => `pay|${String(request.params?.code ?? request.ip).slice(0, 40)}` } } });

/**
 * Misafirin ödeme uçları, `/public/pay/:code` (oturumsuz; kimlik bağlantının tahmin edilemez kodu). Geri dönüş sağlayıcının
 * form POST'udur (`application/x-www-form-urlencoded`) ve misafiri 303 ile sonuç sayfasına yollar.
 * @param {import('fastify').FastifyInstance} app
 */
export async function publicPaymentRoutes(app) {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 16_384 }, (_request, body, done) => {
    try {
      done(null, Object.fromEntries(new URLSearchParams(String(body))));
    } catch (error) {
      done(/** @type {Error} */ (error), undefined);
    }
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').header('x-content-type-options', 'nosniff');
  });
  const ok = (data) => ({ success: true, data });
  const params = { params: paymentLinkCodeParamsSchema };

  app.get('/:code', { ...byCode(60), schema: params }, async (req) => ok(await checkout.publicPaymentLink(req.params.code)));
  app.post('/:code/start', { ...byCode(10), schema: params }, async (req) =>
    ok(await checkout.startPayment(req.params.code, { ip: req.ip, locale: /** @type {any} */ (req.body)?.locale ?? null })),
  );
  app.post('/:code/callback', { ...byCode(30), schema: params }, async (req, reply) => reply.redirect(await checkout.handleCallback(req.params.code, /** @type {any} */ (req.body) ?? {}), 303));
  app.get('/:code/test-checkout', { ...byCode(30), schema: params }, async (req, reply) =>
    reply.type('text/html; charset=utf-8').send(await checkout.testCheckoutPage(req.params.code, String(/** @type {any} */ (req.query)?.token ?? ''))),
  );
}
