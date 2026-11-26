import {
  loyaltyAccountListQuerySchema,
  loyaltyAccountParamSchema,
  loyaltyAdjustSchema,
  loyaltyEnrollSchema,
  loyaltyGuestParamSchema,
  loyaltyRedeemSchema,
  loyaltyReservationParamSchema,
  loyaltySettingsSchema,
  loyaltyTransactionListQuerySchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as accounts from './accounts.js';
import * as redeem from './redeem.js';

/**
 * Sadakat route'ları (modül 56), `/loyalty` altında.
 *
 * - Görmek (üyeler, hesap, hareketler, misafir ve rezervasyon özeti, ayar): `loyalty.view`.
 * - Folyoda puan kullanmak, misafiri üye yapmak: `loyalty.redeem`.
 * - Program ayarı ve elle düzeltme: `loyalty.manage`.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function loyaltyRoutes(app) {
  const guard = (permission) => ({ preValidation: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.LOYALTY_VIEW);
  const redeemGuard = guard(PERMISSIONS.LOYALTY_REDEEM);
  const manage = guard(PERMISSIONS.LOYALTY_MANAGE);
  const ok = (data) => ({ success: true, data });

  app.get('/settings', view, async (req) => ok(await accounts.getLoyaltySettings(req.hotelId)));
  app.put('/settings', { ...manage, schema: { body: loyaltySettingsSchema } }, async (req) => ok(await accounts.saveLoyaltySettings(req.hotelId, req.body)));

  app.get('/accounts', { ...view, schema: { querystring: loyaltyAccountListQuerySchema } }, async (req) => ok(await accounts.listAccounts(req.hotelId, req.query)));
  app.get('/accounts/:accountId', { ...view, schema: { params: loyaltyAccountParamSchema } }, async (req) => ok(await accounts.getAccount(req.hotelId, req.params.accountId)));
  app.get('/accounts/:accountId/transactions', { ...view, schema: { params: loyaltyAccountParamSchema, querystring: loyaltyTransactionListQuerySchema } }, async (req) =>
    ok(await accounts.listTransactions(req.hotelId, req.params.accountId, req.query)),
  );
  app.post('/accounts/:accountId/adjust', { ...manage, schema: { params: loyaltyAccountParamSchema, body: loyaltyAdjustSchema } }, async (req) => ok(await accounts.adjustAccount(req.hotelId, req.params.accountId, req.body)));

  app.get('/guests/:guestId', { ...view, schema: { params: loyaltyGuestParamSchema } }, async (req) => ok(await accounts.guestLoyalty(req.hotelId, req.params.guestId)));
  app.post('/guests/:guestId/enroll', { ...redeemGuard, schema: { params: loyaltyGuestParamSchema, body: loyaltyEnrollSchema } }, async (req, reply) => reply.status(201).send(ok(await accounts.enrollGuest(req.hotelId, req.params.guestId))));

  app.get('/reservations/:reservationId', { ...view, schema: { params: loyaltyReservationParamSchema } }, async (req) => ok(await redeem.reservationLoyalty(req.hotelId, req.params.reservationId)));
  app.post('/reservations/:reservationId/redeem', { ...redeemGuard, schema: { params: loyaltyReservationParamSchema, body: loyaltyRedeemSchema } }, async (req, reply) => {
    const result = await redeem.redeemPoints(req.hotelId, req.params.reservationId, req.body);
    return reply.status(result.created ? 201 : 200).send(ok(result));
  });
}
