import { closeDaySchema, nightAuditHistoryQuerySchema } from '@hotelos/hotel-contracts';
import { z } from 'zod';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import { renderShiftReportPdf } from './pdf.js';
import * as audit from './service.js';

const dayParamSchema = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Geçersiz gün') });

/**
 * Gün kapanış (night audit) route'ları (modül 18), `/night-audit` altında.
 *
 * - Durum, geçmiş, özet ve devir raporu PDF: `night_audit.view`.
 * - Kapanışı başlatmak ve günü kapatmak: `night_audit.close`.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function nightAuditRoutes(app) {
  const guard = (permission) => ({ preHandler: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.NIGHT_AUDIT_VIEW);
  const close = guard(PERMISSIONS.NIGHT_AUDIT_CLOSE);
  const ok = (data) => ({ success: true, data });

  app.get('/status', view, async (req) => ok(await audit.getAuditStatus(req.hotelId)));
  app.post('/start', close, async (req) => ok(await audit.startNightAudit(req.hotelId)));
  app.post('/close', { ...close, schema: { body: closeDaySchema } }, async (req) => ok(await audit.closeDay(req.hotelId, req.body)));

  app.get('/closures', { ...view, schema: { querystring: nightAuditHistoryQuerySchema } }, async (req) => ok(await audit.listClosures(req.hotelId, req.query)));
  app.get('/closures/:day', { ...view, schema: { params: dayParamSchema } }, async (req) => ok(await audit.getClosure(req.hotelId, req.params.day)));

  app.get('/closures/:day/report.pdf', { ...view, schema: { params: dayParamSchema } }, async (req, reply) => {
    const file = await renderShiftReportPdf(req.hotelId, req.params.day);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Length', file.buffer.length)
      .header('Content-Disposition', `inline; filename="${file.fileName}"`)
      .header('Cache-Control', 'private, no-store')
      .send(file.buffer);
  });
}
