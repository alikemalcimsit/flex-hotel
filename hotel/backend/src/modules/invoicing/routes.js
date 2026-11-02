import {
  invoiceCancelSchema,
  invoiceDraftCreateSchema,
  invoiceDraftUpdateSchema,
  invoiceIssueSchema,
  invoiceListQuerySchema,
  invoiceParamSchema,
  invoiceSettingsSchema,
  invoiceableQuerySchema,
  testTaxpayerParamSchema,
  testTaxpayerSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, assertRequestPermission, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as invoices from './invoices.js';
import { renderInvoicePdf } from './pdf.js';
import * as settings from './settings.js';

/**
 * Fatura ve e-belge route'ları (modül 16 çekirdeği + 49), `/invoices` altında.
 *
 * - Görmek (faturalanacaklar, faturalar, ayrıntı, PDF, ayarların özeti): `invoices.view`.
 * - Folyo / etkinlik faturası (taslak, alıcı, kesim), e-belgeyi tekrar gönderme: `invoices.issue`.
 * - Cariye serbest fatura, iptal isteği: `invoices.manage`. İptali başka bir yetkili onaylar (onay kuyruğu).
 * - Ayarlar (satıcı, seriler, vergi kodları, entegratör, test mükellefleri): `invoices.setup`.
 *
 * Listeler sayfalı; faturalanacaklar kapanış penceresiyle sınırlı.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function invoiceRoutes(app) {
  const guard = (permission) => ({ preHandler: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.INVOICES_VIEW);
  const issue = guard(PERMISSIONS.INVOICES_ISSUE);
  const manage = guard(PERMISSIONS.INVOICES_MANAGE);
  const setup = guard(PERMISSIONS.INVOICES_SETUP);
  const draftEditors = { preHandler: [withHotelContext, requireAnyPermission(PERMISSIONS.INVOICES_ISSUE, PERMISSIONS.INVOICES_MANAGE)] };
  const ok = (data) => ({ success: true, data });

  /* ── Ayarlar ── */
  app.get('/settings', view, async (req) => ok(await settings.getInvoiceSettings(req.hotelId)));
  app.put('/settings', { ...setup, schema: { body: invoiceSettingsSchema } }, async (req) => ok(await settings.saveInvoiceSettings(req.hotelId, req.body)));
  app.post('/settings/test-taxpayers', { ...setup, schema: { body: testTaxpayerSchema } }, async (req, reply) => reply.status(201).send(ok(await settings.createTestTaxpayer(req.hotelId, req.body))));
  app.put('/settings/test-taxpayers/:taxpayerId', { ...setup, schema: { params: testTaxpayerParamSchema, body: testTaxpayerSchema } }, async (req) =>
    ok(await settings.updateTestTaxpayer(req.hotelId, req.params.taxpayerId, req.body)),
  );
  app.delete('/settings/test-taxpayers/:taxpayerId', { ...setup, schema: { params: testTaxpayerParamSchema } }, async (req) => ok(await settings.deleteTestTaxpayer(req.hotelId, req.params.taxpayerId)));

  /* ── Liste ── */
  app.get('/', { ...view, schema: { querystring: invoiceListQuerySchema } }, async (req) => ok(await invoices.listInvoices(req.hotelId, req.query)));
  app.get('/invoiceables', { ...view, schema: { querystring: invoiceableQuerySchema } }, async (req) => ok(await invoices.listInvoiceables(req.hotelId, req.query)));

  /* ── Taslak ── */
  app.post('/', { ...draftEditors, schema: { body: invoiceDraftCreateSchema } }, async (req, reply) => {
    // Serbest fatura cariye alacak yazar: yönetim izni; folyo / etkinlik taslağı kesen personelin.
    assertRequestPermission(req, req.body.source === 'MANUAL' ? PERMISSIONS.INVOICES_MANAGE : PERMISSIONS.INVOICES_ISSUE, 'Bu fatura türü için yetkiniz yok');
    const result = await invoices.createDraft(req.hotelId, req.body);
    return reply.status(result.created ? 201 : 200).send(ok(await invoices.getInvoice(req.hotelId, result.invoiceId)));
  });
  app.get('/:invoiceId', { ...view, schema: { params: invoiceParamSchema } }, async (req) => ok(await invoices.getInvoice(req.hotelId, req.params.invoiceId)));
  app.put('/:invoiceId', { ...draftEditors, schema: { params: invoiceParamSchema, body: invoiceDraftUpdateSchema } }, async (req) => {
    if (req.body.lines) assertRequestPermission(req, PERMISSIONS.INVOICES_MANAGE, 'Satır düzenlemek için yetkiniz yok');
    return ok(await invoices.updateDraft(req.hotelId, req.params.invoiceId, req.body));
  });
  app.delete('/:invoiceId', { ...draftEditors, schema: { params: invoiceParamSchema } }, async (req) => {
    await invoices.deleteDraft(req.hotelId, req.params.invoiceId);
    return ok({ deleted: true });
  });

  /* ── Kesim, e-belge, iptal ── */
  app.post('/:invoiceId/issue', { ...issue, schema: { params: invoiceParamSchema, body: invoiceIssueSchema } }, async (req) => ok(await invoices.issueInvoice(req.hotelId, req.params.invoiceId, req.body)));
  app.post('/:invoiceId/resend', { ...issue, schema: { params: invoiceParamSchema } }, async (req) => ok(await invoices.resendInvoice(req.hotelId, req.params.invoiceId)));
  app.post('/:invoiceId/cancel', { ...manage, schema: { params: invoiceParamSchema, body: invoiceCancelSchema } }, async (req) => ok(await invoices.requestCancel(req.hotelId, req.params.invoiceId, req.body)));
  app.post('/:invoiceId/copy', { ...draftEditors, schema: { params: invoiceParamSchema } }, async (req, reply) => {
    const result = await invoices.copyInvoice(req.hotelId, req.params.invoiceId);
    return reply.status(201).send(ok(await invoices.getInvoice(req.hotelId, result.invoiceId)));
  });
  app.get('/:invoiceId/pdf', { ...view, schema: { params: invoiceParamSchema } }, async (req, reply) => {
    const file = await renderInvoicePdf(req.hotelId, req.params.invoiceId);
    return (
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Length', file.buffer.length)
        .header('Content-Disposition', `inline; filename="${file.fileName}"`)
        // Durum değişir (kesim, iptal, e-belge): her istekte güncel üretilir.
        .header('Cache-Control', 'private, no-store')
        .send(file.buffer)
    );
  });
}
