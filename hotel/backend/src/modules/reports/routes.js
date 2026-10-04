import { reportRangeSchema } from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Rapor route'ları (modül 23). Gelir raporu `reports.view` (müdür, muhasebe):
 * otelin gelir rakamları resepsiyonun ve kat hizmetlerinin ekranı değildir.
 * Raporlar salt okunurdur; değiştirme ucu yok.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function reportRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.REPORTS_VIEW)] };

  app.get('/revenue', { ...view, schema: { querystring: reportRangeSchema } }, async (request) => ({
    success: true,
    data: await service.getRevenueReport(request.hotelId, request.query),
  }));
}
