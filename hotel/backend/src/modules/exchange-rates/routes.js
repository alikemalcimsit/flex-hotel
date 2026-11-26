import { exchangeRateSettingsSchema } from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Kur ayarı ve TCMB'den çekme (modül 60), `/exchange-rates` altında (günün kurları ve geçmiş ödeme modülünün route'larında).
 * Görmek: `cash.view`; ayar ve çekme: `exchange_rates.manage`.
 * @param {import('fastify').FastifyInstance} app
 */
export async function exchangeRateSettingsRoutes(app) {
  const guard = (permission) => ({ preValidation: [withHotelContext, requirePermission(permission)] });
  const ok = (data) => ({ success: true, data });
  app.get('/settings', guard(PERMISSIONS.CASH_VIEW), async (req) => ok(await service.getRateSettings(req.hotelId)));
  app.put('/settings', { ...guard(PERMISSIONS.EXCHANGE_RATES_MANAGE), schema: { body: exchangeRateSettingsSchema } }, async (req) => ok(await service.saveRateSettings(req.hotelId, req.body)));
  app.post('/fetch', guard(PERMISSIONS.EXCHANGE_RATES_MANAGE), async (req) => ok(await service.fetchTcmbRates(req.hotelId, { actor: `TCMB (${req.auth?.email ?? 'personel'})` })));
}
