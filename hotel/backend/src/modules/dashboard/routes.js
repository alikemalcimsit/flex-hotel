import { dashboardWeekQuerySchema } from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Günlük durum ekranı route'ları (modül 13). Salt okuma; izin
 * `dashboard.view` (gelir içerdiği için ayrı izin: müdür ve muhasebe
 * varsayılan).
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function dashboardRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.DASHBOARD_VIEW)] };

  app.get('/today', view, async (request) => ({
    success: true,
    data: await service.getDashboardToday(request.hotelId),
  }));

  app.get('/week', { ...view, schema: { querystring: dashboardWeekQuerySchema } }, async (request) => ({
    success: true,
    data: await service.getDashboardWeek(request.hotelId, request.query),
  }));
}
