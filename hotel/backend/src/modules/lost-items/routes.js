import {
  LOST_ITEM_PHOTO_BODY_LIMIT,
  lostItemContactSchema,
  lostItemDisposeSchema,
  lostItemGuestSearchSchema,
  lostItemIdParamSchema,
  lostItemInputSchema,
  lostItemListQuerySchema,
  lostItemMatchSchema,
  lostItemPhotoParamSchema,
  lostItemPhotoQuerySchema,
  lostItemPhotoSchema,
  lostItemReturnSchema,
  lostItemSettingsSchema,
  lostItemUnmatchSchema,
  updateLostItemSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as photos from './photos.js';
import * as service from './service.js';

/**
 * Kayıp eşya route'ları (modül 21).
 *
 * Liste, eşya ekranı ve fotoğraflar `lost_items.view`; kayıt, düzeltme ve
 * fotoğraf ekleme / silme `lost_items.record`; eşleştirme, iletişim notu ve
 * teslim `lost_items.release`; kapatma ve saklama süreleri `lost_items.manage`.
 * Misafirin telefonu / e-postası ve kargo adresi yalnızca teslim yetkisi
 * olana döner.
 *
 * Fotoğraf dosyası herkese açık değildir: yalnızca buradan, oturumla okunur.
 * Yanıt tarayıcı önbelleğine özel ve değişmez (fotoğraf kimliği değişmez).
 */

/** Fotoğraf değişmez (yeni fotoğraf = yeni kimlik): tarayıcı bir yıl önbellekte tutar, ortak önbellekler tutmaz. */
const PHOTO_CACHE_CONTROL = 'private, max-age=31536000, immutable';

/** @param {import('fastify').FastifyRequest} request */
const canSeeContact = (request) => Boolean(request.auth?.permissions.includes(PERMISSIONS.LOST_ITEMS_RELEASE));

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function lostItemRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.LOST_ITEMS_VIEW)] };
  const record = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.LOST_ITEMS_RECORD)] };
  const release = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.LOST_ITEMS_RELEASE)] };
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.LOST_ITEMS_MANAGE)] };

  /* ── Okuma ── */

  app.get('/', { ...view, schema: { querystring: lostItemListQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listLostItems(request.hotelId, request.query, { includeContact: canSeeContact(request) }),
  }));

  app.get('/summary', view, async (request) => ({
    success: true,
    data: await service.getLostItemSummary(request.hotelId),
  }));

  app.get('/settings', view, async (request) => ({
    success: true,
    data: await service.getLostItemSettings(request.hotelId),
  }));

  app.get('/owners', { ...release, schema: { querystring: lostItemGuestSearchSchema } }, async (request) => ({
    success: true,
    data: await service.searchOwners(request.hotelId, request.query.q),
  }));

  app.get('/:id', { ...view, schema: { params: lostItemIdParamSchema } }, async (request) => ({
    success: true,
    data: await service.getLostItem(request.hotelId, request.params.id, { includeContact: canSeeContact(request) }),
  }));

  app.get('/:id/candidates', { ...release, schema: { params: lostItemIdParamSchema } }, async (request) => ({
    success: true,
    data: await service.getMatchCandidates(request.hotelId, request.params.id),
  }));

  app.get(
    '/:id/photos/:photoId',
    { ...view, schema: { params: lostItemPhotoParamSchema, querystring: lostItemPhotoQuerySchema } },
    async (request, reply) => {
      const file = await photos.openPhoto(request.hotelId, request.params.id, request.params.photoId, request.query.size);
      reply
        .header('Content-Type', file.contentType)
        .header('Content-Length', file.size)
        .header('Cache-Control', PHOTO_CACHE_CONTROL)
        .header('X-Content-Type-Options', 'nosniff');
      return reply.send(file.stream);
    },
  );

  /* ── Kayıt ── */

  app.post('/', { ...record, schema: { body: lostItemInputSchema } }, async (request, reply) => {
    const result = await service.createLostItem(request.hotelId, request.body, { includeContact: canSeeContact(request) });
    reply.code(result.created ? 201 : 200);
    return { success: true, data: result };
  });

  app.put('/:id', { ...record, schema: { params: lostItemIdParamSchema, body: updateLostItemSchema } }, async (request) => ({
    success: true,
    data: await service.updateLostItem(request.hotelId, request.params.id, request.body, { includeContact: canSeeContact(request) }),
  }));

  app.post(
    '/:id/photos',
    { ...record, bodyLimit: LOST_ITEM_PHOTO_BODY_LIMIT, schema: { params: lostItemIdParamSchema, body: lostItemPhotoSchema } },
    async (request, reply) => {
      reply.code(201);
      return { success: true, data: await photos.addPhoto(request.hotelId, request.params.id, request.body) };
    },
  );

  app.delete('/:id/photos/:photoId', { ...record, schema: { params: lostItemPhotoParamSchema } }, async (request, reply) => {
    await photos.removePhoto(request.hotelId, request.params.id, request.params.photoId, request.log);
    reply.code(204);
  });

  /* ── Eşleştirme, iletişim, teslim ── */

  app.post('/:id/match', { ...release, schema: { params: lostItemIdParamSchema, body: lostItemMatchSchema } }, async (request) => ({
    success: true,
    data: await service.matchLostItem(request.hotelId, request.params.id, request.body),
  }));

  app.post('/:id/unmatch', { ...release, schema: { params: lostItemIdParamSchema, body: lostItemUnmatchSchema } }, async (request) => ({
    success: true,
    data: await service.unmatchLostItem(request.hotelId, request.params.id, request.body),
  }));

  app.post('/:id/notes', { ...release, schema: { params: lostItemIdParamSchema, body: lostItemContactSchema } }, async (request, reply) => {
    reply.code(201);
    return { success: true, data: await service.addContactNote(request.hotelId, request.params.id, request.body) };
  });

  app.post('/:id/return', { ...release, schema: { params: lostItemIdParamSchema, body: lostItemReturnSchema } }, async (request) => ({
    success: true,
    data: await service.returnLostItem(request.hotelId, request.params.id, request.body),
  }));

  /* ── Yönetim ── */

  app.post('/:id/dispose', { ...manage, schema: { params: lostItemIdParamSchema, body: lostItemDisposeSchema } }, async (request) => ({
    success: true,
    data: await service.disposeLostItem(request.hotelId, request.params.id, request.body, { includeContact: canSeeContact(request) }),
  }));

  app.put('/settings', { ...manage, schema: { body: lostItemSettingsSchema } }, async (request) => ({
    success: true,
    data: await service.updateLostItemSettings(request.hotelId, request.body),
  }));
}
