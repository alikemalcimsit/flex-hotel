import {
  chainGroupCreateSchema,
  chainGroupUpdateSchema,
  chainHotelCreateSchema,
  chainHotelListQuerySchema,
  chainHotelParamSchema,
  chainMembershipParamSchema,
  chainMembershipSchema,
  chainReportQuerySchema,
  chainUserCreateSchema,
  chainUserListQuerySchema,
  chainUserParamSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { userRoom } from '../../lib/realtime.js';
import { withHotelContext } from '../../lib/tenant.js';
import { loadActor } from './access.js';
import * as hotels from './hotels.js';
import * as overview from './overview.js';
import * as users from './users.js';

/**
 * Zincir konsolu uçları (modül 63). Açık oteldeki izinle girilir: görünüm `chain.view`, otel / zincir yönetimi
 * `chain.manage`, merkezi kullanıcı yönetimi `chain.users`. Başka bir otele dokunan her işlem ayrıca kişinin O OTELDEKİ
 * rolüne bakar (servis katmanı).
 */
export async function chainRoutes(app) {
  const guard = (permission) => ({ preValidation: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.CHAIN_VIEW);
  const manage = guard(PERMISSIONS.CHAIN_MANAGE);
  const people = guard(PERMISSIONS.CHAIN_USERS);
  const actorOf = (request) => loadActor(request.auth);

  /** Erişimi değişen kişinin o oteldeki soketlerini kes: yeniden bağlanınca yeni rolüyle (ya da hiç) katılır. */
  const dropSockets = (hotelId, userId) => {
    try {
      app.io?.in(userRoom(hotelId, userId)).disconnectSockets(true);
    } catch (error) {
      app.log.warn({ err: error }, 'Zincir: soket kesilemedi');
    }
  };

  app.get('/', view, async (request) => ({ success: true, data: await hotels.getChainOverview(await actorOf(request), request.auth.permissions) }));

  /* ── Zincir ── */

  app.post('/group', { ...manage, schema: { body: chainGroupCreateSchema } }, async (request, reply) => {
    reply.status(201);
    return { success: true, data: await hotels.createGroup(await actorOf(request), request.body) };
  });

  app.patch('/group', { ...manage, schema: { body: chainGroupUpdateSchema } }, async (request) => ({
    success: true,
    data: await hotels.renameGroup(await actorOf(request), request.body),
  }));

  /* ── Oteller ── */

  app.get('/hotels', { ...view, schema: { querystring: chainHotelListQuerySchema } }, async (request) => ({
    success: true,
    data: await hotels.listGroupHotels(await actorOf(request), request.query),
  }));

  app.post('/hotels', { ...manage, schema: { body: chainHotelCreateSchema } }, async (request, reply) => {
    reply.status(201);
    return { success: true, data: await hotels.createChainHotel(await actorOf(request), request.body) };
  });

  app.post('/hotels/:hotelId/attach', { ...manage, schema: { params: chainHotelParamSchema } }, async (request) => ({
    success: true,
    data: await hotels.attachHotel(await actorOf(request), request.params.hotelId),
  }));

  app.post('/hotels/:hotelId/detach', { ...manage, schema: { params: chainHotelParamSchema } }, async (request) => ({
    success: true,
    data: await hotels.detachHotel(await actorOf(request), request.params.hotelId),
  }));

  /* ── Pano ve rapor ── */

  app.get('/dashboard', view, async (request) => ({
    success: true,
    data: await overview.getChainDashboard(await actorOf(request), { logger: request.log }),
  }));

  app.get('/report', { ...view, schema: { querystring: chainReportQuerySchema } }, async (request) => ({
    success: true,
    data: await overview.getChainReport(await actorOf(request), request.query, { logger: request.log }),
  }));

  /* ── Kullanıcılar ── */

  app.get('/users', { ...people, schema: { querystring: chainUserListQuerySchema } }, async (request) => ({
    success: true,
    data: await users.listChainUsers(await actorOf(request), request.query),
  }));

  app.post('/users', { ...people, schema: { body: chainUserCreateSchema } }, async (request, reply) => {
    reply.status(201);
    return { success: true, data: await users.createChainUser(await actorOf(request), request.body) };
  });

  app.get('/users/:userId', { ...people, schema: { params: chainUserParamSchema } }, async (request) => ({
    success: true,
    data: await users.getChainUser(await actorOf(request), request.params.userId),
  }));

  app.put('/users/:userId/hotels/:hotelId', { ...people, schema: { params: chainMembershipParamSchema, body: chainMembershipSchema } }, async (request) => {
    const { userId, hotelId } = request.params;
    const result = await users.setMembership(await actorOf(request), userId, hotelId, request.body);
    if (result.changed) dropSockets(hotelId, userId);
    return { success: true, data: result };
  });

  app.delete('/users/:userId/hotels/:hotelId', { ...people, schema: { params: chainMembershipParamSchema } }, async (request) => {
    const { userId, hotelId } = request.params;
    const user = await users.removeMembership(await actorOf(request), userId, hotelId);
    dropSockets(hotelId, userId);
    return { success: true, data: user };
  });
}
