import { forecastQuerySchema, forecastSettingsSchema } from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Tahmin route'ları (modül 25). Okuma günlük durumun izniyle
 * (`dashboard.view`: müdür, muhasebe — tahmin günlük durum ekranındadır, gelir
 * içerir). Kritik gün eşiklerini değiştirmek `forecast.manage` (müdür; kullanıcı
 * kararı: müdür tahmin kartından değiştirir).
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function forecastRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.DASHBOARD_VIEW)] };
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.FORECAST_MANAGE)] };

  app.get('/', { ...view, schema: { querystring: forecastQuerySchema } }, async (request) => ({
    success: true,
    data: await service.getForecast(request.hotelId, request.query),
  }));

  app.put('/settings', { ...manage, schema: { body: forecastSettingsSchema } }, async (request) => ({
    success: true,
    data: await service.updateForecastSettings(request.hotelId, request.body),
  }));
}
