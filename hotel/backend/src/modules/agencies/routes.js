import {
  addStopSaleSchema,
  agencyListQuerySchema,
  agencyOptionsQuerySchema,
  agencyParamSchema,
  agencyReservationsQuerySchema,
  agencyStatusSchema,
  agencySummaryQuerySchema,
  contractParamSchema,
  contractVersionSchema,
  createAgencySchema,
  createContractSchema,
  endContractSchema,
  saveContractRatesSchema,
  stopSaleParamSchema,
  updateAgencySchema,
  updateContractSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Acente ve kontrat route'ları (modül 29).
 *
 * - Görmek (kart, kontrat fiyatı, komisyon, cari özeti): `agencies.view`
 *   (müdür, muhasebe).
 * - Kart ve kontrat düzenlemek, satışa açmak, stop-sale: `agencies.manage` (müdür).
 * - Rezervasyon formunun acente seçicisi: `reservations.manage` ya da
 *   `agencies.view`; yalnızca ad ve kod döner (komisyon ve fiyat dönmez).
 *
 * Liste uçları sayfalıdır; kontrat başına fiyat satırı sayısı sınırlıdır
 * (`MAX_CONTRACT_RATES`), bu yüzden kontrat ekranı satırları tek yanıtta verir.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function agencyRoutes(app) {
  const guard = (permission) => ({ preHandler: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.AGENCIES_VIEW);
  const manage = guard(PERMISSIONS.AGENCIES_MANAGE);
  const picker = { preHandler: [withHotelContext, requireAnyPermission(PERMISSIONS.RESERVATIONS_MANAGE, PERMISSIONS.AGENCIES_VIEW)] };
  const ok = (data) => ({ success: true, data });

  /* ── Seçici ve liste (statik yollar parametreli yollardan önce) ── */

  app.get('/options', { ...picker, schema: { querystring: agencyOptionsQuerySchema } }, async (request) =>
    ok(await service.searchAgencyOptions(request.hotelId, request.query)),
  );

  app.get('/', { ...view, schema: { querystring: agencyListQuerySchema } }, async (request) =>
    ok(await service.listAgencies(request.hotelId, request.query)),
  );

  app.post('/', { ...manage, schema: { body: createAgencySchema } }, async (request, reply) =>
    reply.status(201).send(ok(await service.createAgency(request.hotelId, request.body))),
  );

  /* ── Kontrat (kimlikle; acente yollarından ayrı önek) ── */

  app.get('/contracts/:contractId', { ...view, schema: { params: contractParamSchema } }, async (request) =>
    ok(await service.getContract(request.hotelId, request.params.contractId)),
  );

  app.patch('/contracts/:contractId', { ...manage, schema: { params: contractParamSchema, body: updateContractSchema } }, async (request) =>
    ok(await service.updateContract(request.hotelId, request.params.contractId, request.body)),
  );

  app.put('/contracts/:contractId/rates', { ...manage, schema: { params: contractParamSchema, body: saveContractRatesSchema } }, async (request) =>
    ok(await service.saveContractRates(request.hotelId, request.params.contractId, request.body)),
  );

  app.post('/contracts/:contractId/activate', { ...manage, schema: { params: contractParamSchema, body: contractVersionSchema } }, async (request) =>
    ok(await service.activateContract(request.hotelId, request.params.contractId, request.body)),
  );

  app.post('/contracts/:contractId/end', { ...manage, schema: { params: contractParamSchema, body: endContractSchema } }, async (request) =>
    ok(await service.endContract(request.hotelId, request.params.contractId, request.body)),
  );

  app.post('/contracts/:contractId/delete', { ...manage, schema: { params: contractParamSchema, body: contractVersionSchema } }, async (request) =>
    ok(await service.deleteContract(request.hotelId, request.params.contractId, request.body)),
  );

  app.post('/contracts/:contractId/stop-sales', { ...manage, schema: { params: contractParamSchema, body: addStopSaleSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await service.addStopSale(request.hotelId, request.params.contractId, request.body))),
  );

  app.delete('/contracts/:contractId/stop-sales/:stopSaleId', { ...manage, schema: { params: stopSaleParamSchema } }, async (request) =>
    ok(await service.removeStopSale(request.hotelId, request.params.contractId, request.params.stopSaleId)),
  );

  /* ── Acente ── */

  app.get('/:agencyId', { ...view, schema: { params: agencyParamSchema } }, async (request) =>
    ok(await service.getAgency(request.hotelId, request.params.agencyId)),
  );

  app.patch('/:agencyId', { ...manage, schema: { params: agencyParamSchema, body: updateAgencySchema } }, async (request) =>
    ok(await service.updateAgency(request.hotelId, request.params.agencyId, request.body)),
  );

  app.post('/:agencyId/status', { ...manage, schema: { params: agencyParamSchema, body: agencyStatusSchema } }, async (request) =>
    ok(await service.setAgencyStatus(request.hotelId, request.params.agencyId, request.body)),
  );

  app.post('/:agencyId/contracts', { ...manage, schema: { params: agencyParamSchema, body: createContractSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await service.createContract(request.hotelId, request.params.agencyId, request.body))),
  );

  app.get('/:agencyId/summary', { ...view, schema: { params: agencyParamSchema, querystring: agencySummaryQuerySchema } }, async (request) =>
    ok(await service.getAgencySummary(request.hotelId, request.params.agencyId, request.query)),
  );

  app.get('/:agencyId/reservations', { ...view, schema: { params: agencyParamSchema, querystring: agencyReservationsQuerySchema } }, async (request) =>
    ok(await service.listAgencyReservations(request.hotelId, request.params.agencyId, request.query)),
  );
}
