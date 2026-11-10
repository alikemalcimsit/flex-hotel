import {
  MAINTENANCE_PHOTO_BODY_LIMIT,
  maintenanceAssignSchema,
  maintenanceCancelSchema,
  maintenancePlanListQuerySchema,
  maintenancePlanSchema,
  maintenancePlanUpdateSchema,
  maintenancePhotoSchema,
  maintenanceResolveSchema,
  maintenanceTicketCreateSchema,
  maintenanceTicketListQuerySchema,
  maintenanceTicketUpdateSchema,
} from '@hotelos/hotel-contracts';
import { z } from 'zod';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as photos from './photos.js';
import * as service from './service.js';

const idParam = z.object({ id: z.string().uuid() });
const photoParam = z.object({ id: z.string().uuid(), photoId: z.string().uuid() });
const photoQuery = z.object({ size: z.enum(['full', 'thumb']).default('full') });

/**
 * Teknik servis / arıza-bakım route'ları (modül 20), `/maintenance` altında.
 *
 * - Görmek (liste, ayrıntı, fotoğraf, planlar): `maintenance.view`.
 * - Bilet aç / başla / çöz / güncelle, fotoğraf: `maintenance.operate`.
 * - Atama, iptal, periyodik bakım planı: `maintenance.manage`.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function maintenanceRoutes(app) {
  const guard = (permission) => ({ preHandler: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.MAINTENANCE_VIEW);
  const operate = guard(PERMISSIONS.MAINTENANCE_OPERATE);
  const manage = guard(PERMISSIONS.MAINTENANCE_MANAGE);
  const ok = (data) => ({ success: true, data });

  /* ── Biletler ── */
  app.get('/tickets', { ...view, schema: { querystring: maintenanceTicketListQuerySchema } }, async (req) => ok(await service.listTickets(req.hotelId, req.query)));
  app.get('/tickets/:id', { ...view, schema: { params: idParam } }, async (req) => ok(await service.getTicket(req.hotelId, req.params.id)));
  app.post('/tickets', { ...operate, schema: { body: maintenanceTicketCreateSchema } }, async (req, reply) => {
    reply.code(201);
    return ok(await service.createTicket(req.hotelId, req.body));
  });
  app.patch('/tickets/:id', { ...operate, schema: { params: idParam, body: maintenanceTicketUpdateSchema } }, async (req) => ok(await service.updateTicket(req.hotelId, req.params.id, req.body)));
  app.post('/tickets/:id/assign', { ...manage, schema: { params: idParam, body: maintenanceAssignSchema } }, async (req) => ok(await service.assignTicket(req.hotelId, req.params.id, req.body)));
  app.post('/tickets/:id/start', { ...operate, schema: { params: idParam } }, async (req) => ok(await service.startTicket(req.hotelId, req.params.id)));
  app.post('/tickets/:id/resolve', { ...operate, schema: { params: idParam, body: maintenanceResolveSchema } }, async (req) => ok(await service.resolveTicket(req.hotelId, req.params.id, req.body)));
  app.post('/tickets/:id/cancel', { ...manage, schema: { params: idParam, body: maintenanceCancelSchema } }, async (req) => ok(await service.cancelTicket(req.hotelId, req.params.id, req.body)));

  /* ── Fotoğraflar ── */
  app.get('/tickets/:id/photos/:photoId', { ...view, schema: { params: photoParam, querystring: photoQuery } }, async (req, reply) => {
    const file = await photos.openPhoto(req.hotelId, req.params.id, req.params.photoId, req.query.size);
    reply.header('Content-Type', file.contentType).header('Content-Length', file.size).header('Cache-Control', 'private, max-age=86400').header('X-Content-Type-Options', 'nosniff');
    return reply.send(file.stream);
  });
  app.post('/tickets/:id/photos', { ...operate, bodyLimit: MAINTENANCE_PHOTO_BODY_LIMIT, schema: { params: idParam, body: maintenancePhotoSchema } }, async (req, reply) => {
    reply.code(201);
    return ok(await photos.addPhoto(req.hotelId, req.params.id, req.body));
  });
  app.delete('/tickets/:id/photos/:photoId', { ...operate, schema: { params: photoParam } }, async (req, reply) => {
    await photos.removePhoto(req.hotelId, req.params.id, req.params.photoId, req.log);
    reply.code(204);
  });

  /* ── Periyodik bakım planı ── */
  app.get('/plans', { ...view, schema: { querystring: maintenancePlanListQuerySchema } }, async (req) => ok(await service.listPlans(req.hotelId, req.query)));
  app.post('/plans', { ...manage, schema: { body: maintenancePlanSchema } }, async (req, reply) => {
    reply.code(201);
    return ok(await service.createPlan(req.hotelId, req.body));
  });
  app.patch('/plans/:id', { ...manage, schema: { params: idParam, body: maintenancePlanUpdateSchema } }, async (req) => ok(await service.updatePlan(req.hotelId, req.params.id, req.body)));
  app.delete('/plans/:id', { ...manage, schema: { params: idParam } }, async (req, reply) => {
    await service.deletePlan(req.hotelId, req.params.id);
    reply.code(204);
  });
}
