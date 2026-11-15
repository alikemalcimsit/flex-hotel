import {
  createCallLogSchema,
  createLeadSchema,
  createQuoteSchema,
  leadListQuerySchema,
  leadParamSchema,
  leadStatusSchema,
  quoteParamSchema,
  quoteVersionSchema,
  rejectQuoteSchema,
  updateLeadSchema,
  updateQuoteSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import { renderQuotePdf } from './pdf.js';
import * as service from './service.js';

/**
 * Satış CRM route'ları (modül 36).
 *
 * - Görüntüleme (pano, fırsat dosyası, teklif, PDF): `sales.view`.
 * - Fırsat/arama kaydı açma, teklif hazırlama/gönderme/sonuçlandırma:
 *   `sales.manage` (müdür + resepsiyon varsayılanı).
 * - Teklif kabulü rezervasyonu teklifin kilitli toplamıyla açar; elle fiyat
 *   yetkisi burada teklife dayanır (ayrıca `reservations.price_override`
 *   istenmez — kayıt `priceNote` ile teklif koduna bağlıdır).
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function salesRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.SALES_VIEW)] };
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.SALES_MANAGE)] };
  const ok = (data) => ({ success: true, data });

  /* ── Pano ve fırsatlar ── */

  app.get('/summary', view, async (request) => ok(await service.getSalesSummary(request.hotelId)));

  app.get('/leads', { ...view, schema: { querystring: leadListQuerySchema } }, async (request) =>
    ok(await service.listLeads(request.hotelId, request.query)),
  );

  app.post('/leads', { ...manage, schema: { body: createLeadSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await service.createLead(request.hotelId, request.body))),
  );

  app.get('/leads/:leadId', { ...view, schema: { params: leadParamSchema } }, async (request) =>
    ok(await service.getLead(request.hotelId, request.params.leadId)),
  );

  app.put('/leads/:leadId', { ...manage, schema: { params: leadParamSchema, body: updateLeadSchema } }, async (request) =>
    ok(await service.updateLead(request.hotelId, request.params.leadId, request.body)),
  );

  app.post('/leads/:leadId/status', { ...manage, schema: { params: leadParamSchema, body: leadStatusSchema } }, async (request) =>
    ok(await service.setLeadStatus(request.hotelId, request.params.leadId, request.body)),
  );

  /* ── Arama kayıtları ── */

  app.post('/leads/:leadId/calls', { ...manage, schema: { params: leadParamSchema, body: createCallLogSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await service.addCallLog(request.hotelId, request.params.leadId, request.body))),
  );

  /* ── Teklifler ── */

  app.post('/leads/:leadId/quotes', { ...manage, schema: { params: leadParamSchema, body: createQuoteSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await service.createQuote(request.hotelId, request.params.leadId, request.body))),
  );

  app.put('/quotes/:quoteId', { ...manage, schema: { params: quoteParamSchema, body: updateQuoteSchema } }, async (request) =>
    ok(await service.updateQuote(request.hotelId, request.params.quoteId, request.body)),
  );

  app.post('/quotes/:quoteId/send', { ...manage, schema: { params: quoteParamSchema, body: quoteVersionSchema } }, async (request) =>
    ok(await service.sendQuote(request.hotelId, request.params.quoteId, request.body)),
  );

  app.post('/quotes/:quoteId/accept', { ...manage, schema: { params: quoteParamSchema, body: quoteVersionSchema } }, async (request) =>
    ok(await service.acceptQuote(request.hotelId, request.params.quoteId, request.body)),
  );

  app.post('/quotes/:quoteId/reject', { ...manage, schema: { params: quoteParamSchema, body: rejectQuoteSchema } }, async (request) =>
    ok(await service.rejectQuote(request.hotelId, request.params.quoteId, request.body)),
  );

  app.get('/quotes/:quoteId/pdf', { ...view, schema: { params: quoteParamSchema } }, async (request, reply) => {
    const { buffer, fileName } = await renderQuotePdf(request.hotelId, request.params.quoteId);
    reply
      .type('application/pdf')
      .header('content-disposition', `attachment; filename="${fileName}"`)
      .header('cache-control', 'no-store');
    return buffer;
  });
}
