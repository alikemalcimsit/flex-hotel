import { aiSettingsSchema, aiUsageQuerySchema } from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import { getAiUsage } from './llm.js';
import { getAiSettings, saveAiSettings } from './settings.js';

/**
 * AI asistanı ayarları ve kullanımı (modül 8). Ayar "Ayarlar" yetkisiyle
 * görülür, "Ayarları yönet" ile değişir. API anahtarı hiçbir cevapta yok;
 * ekran yalnızca "sunucuda tanımlı mı" bilgisini görür.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function conciergeRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.SETTINGS_VIEW)] };
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.SETTINGS_MANAGE)] };

  app.get('/settings', view, async (request) => ({
    success: true,
    data: await getAiSettings(request.hotelId),
  }));

  app.put('/settings', { ...manage, schema: { body: aiSettingsSchema } }, async (request) => ({
    success: true,
    data: await saveAiSettings(request.hotelId, request.body),
  }));

  app.get('/usage', { ...view, schema: { querystring: aiUsageQuerySchema } }, async (request) => ({
    success: true,
    data: await getAiUsage(request.hotelId, request.query),
  }));
}
