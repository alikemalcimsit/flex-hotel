import {
  guestCardUpdateSchema,
  guestListQuerySchema,
  guestNoteSchema,
  guestNoteUpdateSchema,
  guestPreferenceSchema,
  guestPreferenceUpdateSchema,
  mergeGuestsSchema,
  paginationQuerySchema,
} from '@hotelos/hotel-contracts';
import { z } from 'zod';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

const idParam = z.object({ id: z.string().uuid() });
const prefParam = z.object({ id: z.string().uuid(), prefId: z.string().uuid() });
const noteParam = z.object({ id: z.string().uuid(), noteId: z.string().uuid() });
const searchQuery = z.object({ q: z.string().trim().min(1).max(120) });

/**
 * CRM & misafir kartı route'ları (modül 22), `/guests` altında.
 *
 * - Görmek (liste, kart, geçmiş, harcama): `guests.view`.
 * - Düzenleme (kart, tercih, not): `guests.manage`.
 * - Birleştirme: `guests.merge`.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function guestRoutes(app) {
  const guard = (permission) => ({ preHandler: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.GUESTS_VIEW);
  const manage = guard(PERMISSIONS.GUESTS_MANAGE);
  const merge = guard(PERMISSIONS.GUESTS_MERGE);
  const ok = (data) => ({ success: true, data });

  /* ── Liste / arama ── */
  app.get('/', { ...view, schema: { querystring: guestListQuerySchema } }, async (req) => ok(await service.listGuests(req.hotelId, req.query)));
  app.get('/search', { ...view, schema: { querystring: searchQuery } }, async (req) => ok(await service.searchGuestCards(req.hotelId, req.query.q)));

  /* ── Birleştirme (sabit yol, :id'den önce) ── */
  app.post('/merge', { ...merge, schema: { body: mergeGuestsSchema } }, async (req) => ok(await service.mergeGuests(req.hotelId, req.body)));

  /* ── Kart ── */
  app.get('/:id', { ...view, schema: { params: idParam } }, async (req) => ok(await service.getGuestCard(req.hotelId, req.params.id)));
  app.patch('/:id', { ...manage, schema: { params: idParam, body: guestCardUpdateSchema } }, async (req) => ok(await service.updateGuestCard(req.hotelId, req.params.id, req.body)));
  app.get('/:id/stays', { ...view, schema: { params: idParam, querystring: paginationQuerySchema } }, async (req) => ok(await service.getStayHistory(req.hotelId, req.params.id, req.query)));
  app.get('/:id/spend', { ...view, schema: { params: idParam } }, async (req) => ok(await service.getSpendHistory(req.hotelId, req.params.id)));

  /* ── Tercihler ── */
  app.post('/:id/preferences', { ...manage, schema: { params: idParam, body: guestPreferenceSchema } }, async (req, reply) => {
    reply.code(201);
    return ok(await service.addPreference(req.hotelId, req.params.id, req.body));
  });
  app.patch('/:id/preferences/:prefId', { ...manage, schema: { params: prefParam, body: guestPreferenceUpdateSchema } }, async (req) => ok(await service.updatePreference(req.hotelId, req.params.id, req.params.prefId, req.body)));
  app.delete('/:id/preferences/:prefId', { ...manage, schema: { params: prefParam } }, async (req, reply) => {
    await service.deletePreference(req.hotelId, req.params.id, req.params.prefId);
    reply.code(204);
  });

  /* ── Notlar ── */
  app.post('/:id/notes', { ...manage, schema: { params: idParam, body: guestNoteSchema } }, async (req, reply) => {
    reply.code(201);
    return ok(await service.addNote(req.hotelId, req.params.id, req.body));
  });
  app.patch('/:id/notes/:noteId', { ...manage, schema: { params: noteParam, body: guestNoteUpdateSchema } }, async (req) => ok(await service.updateNote(req.hotelId, req.params.id, req.params.noteId, req.body)));
  app.delete('/:id/notes/:noteId', { ...manage, schema: { params: noteParam } }, async (req, reply) => {
    await service.deleteNote(req.hotelId, req.params.id, req.params.noteId);
    reply.code(204);
  });
}
