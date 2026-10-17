import {
  banquetCalendarQuerySchema,
  cancelEventSchema,
  completeEventSchema,
  confirmEventSchema,
  createEquipmentSchema,
  createEventClientSchema,
  createEventSchema,
  createSessionSchema,
  createVenueSchema,
  decideEventDocumentSchema,
  equipmentListQuerySchema,
  equipmentParamSchema,
  eventClientListQuerySchema,
  eventClientParamSchema,
  eventDocumentParamSchema,
  eventListQuerySchema,
  eventParamSchema,
  eventPaymentListQuerySchema,
  eventPaymentParamSchema,
  eventPaymentRefParamSchema,
  eventVersionSchema,
  issueEventDocumentSchema,
  loseEventSchema,
  receiveEventPaymentSchema,
  releaseEventSchema,
  saveEventItemsSchema,
  saveInstallmentsSchema,
  sessionParamSchema,
  tentativeEventSchema,
  updateEquipmentSchema,
  updateEventClientSchema,
  updateEventSchema,
  updateEventSettingsSchema,
  updateSessionSchema,
  updateVenueSchema,
  venueAvailabilityQuerySchema,
  venueParamSchema,
  voidEventPaymentSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as documents from './documents.js';
import * as events from './events.js';
import * as payments from './payments.js';
import * as setup from './setup.js';

/**
 * Banket / etkinlik route'ları (modül 37), `/banquet` altında.
 *
 * - Görmek (etkinlik dosyaları, salon takvimi, belgeler, ödemeler, tanımlar):
 *   `banquet.view`.
 * - Etkinlik açmak, programı / kalemi / ödeme planını düzenlemek, opsiyonlamak,
 *   kesinleştirmek, kapatmak; müşteri kartı; teklif / sözleşme / proforma üretmek ve
 *   karar işlemek: `banquet.manage` (satış / banket).
 * - Salon, ekipman, banket politikası: `banquet.setup`.
 * - Tahsilat, iade ve iptal istemek: `banquet.payment` (ön büro / muhasebe). Büyük
 *   tahsilat, iade ve iptal onay kuyruğundan verilir (`approvals.decide`, dört göz).
 *
 * Liste uçları sayfalıdır (salon listesi `MAX_VENUES` ile sınırlı); takvim en fazla
 * 31 gün; ödemeler imleçli.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function banquetRoutes(app) {
  const guard = (permission) => ({ preHandler: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.BANQUET_VIEW);
  const manage = guard(PERMISSIONS.BANQUET_MANAGE);
  const configure = guard(PERMISSIONS.BANQUET_SETUP);
  const collect = guard(PERMISSIONS.BANQUET_PAYMENT);
  const ok = (data) => ({ success: true, data });

  /* ── Özet, takvim, uygunluk ── */

  app.get('/summary', view, async (request) => ok(await events.getBanquetSummary(request.hotelId)));

  app.get('/calendar', { ...view, schema: { querystring: banquetCalendarQuerySchema } }, async (request) =>
    ok(await events.getCalendar(request.hotelId, request.query)),
  );

  app.get('/availability', { ...view, schema: { querystring: venueAvailabilityQuerySchema } }, async (request) =>
    ok(await events.venueAvailability(request.hotelId, request.query)),
  );

  /* ── Salonlar ── */

  app.get('/venues', view, async (request) => ok(await setup.listVenues(request.hotelId)));

  app.post('/venues', { ...configure, schema: { body: createVenueSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await setup.createVenue(request.hotelId, request.body))),
  );

  app.put('/venues/:venueId', { ...configure, schema: { params: venueParamSchema, body: updateVenueSchema } }, async (request) =>
    ok(await setup.updateVenue(request.hotelId, request.params.venueId, request.body)),
  );

  /* ── Ekipman ── */

  app.get('/equipment', { ...view, schema: { querystring: equipmentListQuerySchema } }, async (request) =>
    ok(await setup.listEquipment(request.hotelId, request.query)),
  );

  app.post('/equipment', { ...configure, schema: { body: createEquipmentSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await setup.createEquipment(request.hotelId, request.body))),
  );

  app.put('/equipment/:equipmentId', { ...configure, schema: { params: equipmentParamSchema, body: updateEquipmentSchema } }, async (request) =>
    ok(await setup.updateEquipment(request.hotelId, request.params.equipmentId, request.body)),
  );

  /* ── Müşteriler ── */

  app.get('/clients', { ...view, schema: { querystring: eventClientListQuerySchema } }, async (request) =>
    ok(await setup.listClients(request.hotelId, request.query)),
  );

  app.get('/clients/:clientId', { ...view, schema: { params: eventClientParamSchema } }, async (request) =>
    ok(await setup.getClient(request.hotelId, request.params.clientId)),
  );

  app.post('/clients', { ...manage, schema: { body: createEventClientSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await setup.createClient(request.hotelId, request.body))),
  );

  app.put('/clients/:clientId', { ...manage, schema: { params: eventClientParamSchema, body: updateEventClientSchema } }, async (request) =>
    ok(await setup.updateClient(request.hotelId, request.params.clientId, request.body)),
  );

  /* ── Banket politikası ── */

  app.get('/settings', view, async (request) => ok(await setup.getSettings(request.hotelId)));

  app.put('/settings', { ...configure, schema: { body: updateEventSettingsSchema } }, async (request) =>
    ok(await setup.updateSettings(request.hotelId, request.body)),
  );

  /* ── Etkinlik dosyası ── */

  app.get('/events', { ...view, schema: { querystring: eventListQuerySchema } }, async (request) =>
    ok(await events.listEvents(request.hotelId, request.query)),
  );

  app.post('/events', { ...manage, schema: { body: createEventSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await events.createEvent(request.hotelId, request.body))),
  );

  app.get('/events/:eventId', { ...view, schema: { params: eventParamSchema } }, async (request) =>
    ok(await events.getEvent(request.hotelId, request.params.eventId)),
  );

  app.put('/events/:eventId', { ...manage, schema: { params: eventParamSchema, body: updateEventSchema } }, async (request) =>
    ok(await events.updateEvent(request.hotelId, request.params.eventId, request.body)),
  );

  /* ── Program (oturumlar) ── */

  app.post('/events/:eventId/sessions', { ...manage, schema: { params: eventParamSchema, body: createSessionSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await events.saveSession(request.hotelId, request.params.eventId, null, request.body))),
  );

  app.put('/events/:eventId/sessions/:sessionId', { ...manage, schema: { params: sessionParamSchema, body: updateSessionSchema } }, async (request) =>
    ok(await events.saveSession(request.hotelId, request.params.eventId, request.params.sessionId, request.body)),
  );

  // Sürüm gövdede: açık ekran eski programla oturum silemesin.
  app.delete('/events/:eventId/sessions/:sessionId', { ...manage, schema: { params: sessionParamSchema, body: eventVersionSchema } }, async (request) =>
    ok(await events.deleteSession(request.hotelId, request.params.eventId, request.params.sessionId, request.body)),
  );

  /* ── Kalemler ve ödeme planı ── */

  app.put('/events/:eventId/items', { ...manage, schema: { params: eventParamSchema, body: saveEventItemsSchema } }, async (request) =>
    ok(await events.saveItems(request.hotelId, request.params.eventId, request.body)),
  );

  app.get('/events/:eventId/installments/suggestion', { ...view, schema: { params: eventParamSchema } }, async (request) =>
    ok(await events.suggestPlan(request.hotelId, request.params.eventId)),
  );

  app.put('/events/:eventId/installments', { ...manage, schema: { params: eventParamSchema, body: saveInstallmentsSchema } }, async (request) =>
    ok(await events.saveInstallments(request.hotelId, request.params.eventId, request.body)),
  );

  /* ── Durum ── */

  app.post('/events/:eventId/tentative', { ...manage, schema: { params: eventParamSchema, body: tentativeEventSchema } }, async (request) =>
    ok(await events.setTentative(request.hotelId, request.params.eventId, request.body)),
  );

  app.post('/events/:eventId/release', { ...manage, schema: { params: eventParamSchema, body: releaseEventSchema } }, async (request) =>
    ok(await events.releaseOption(request.hotelId, request.params.eventId, request.body)),
  );

  app.post('/events/:eventId/confirm', { ...manage, schema: { params: eventParamSchema, body: confirmEventSchema } }, async (request) =>
    ok(await events.confirmEvent(request.hotelId, request.params.eventId, request.body)),
  );

  app.post('/events/:eventId/complete', { ...manage, schema: { params: eventParamSchema, body: completeEventSchema } }, async (request) =>
    ok(await events.completeEvent(request.hotelId, request.params.eventId, request.body)),
  );

  app.post('/events/:eventId/cancel', { ...manage, schema: { params: eventParamSchema, body: cancelEventSchema } }, async (request) =>
    ok(await events.cancelEvent(request.hotelId, request.params.eventId, request.body)),
  );

  app.post('/events/:eventId/lose', { ...manage, schema: { params: eventParamSchema, body: loseEventSchema } }, async (request) =>
    ok(await events.loseEvent(request.hotelId, request.params.eventId, request.body)),
  );

  /* ── Ödemeler ── */

  app.get('/events/:eventId/payments', { ...view, schema: { params: eventParamSchema, querystring: eventPaymentListQuerySchema } }, async (request) =>
    ok(await payments.listEventPayments(request.hotelId, request.params.eventId, request.query)),
  );

  app.post('/events/:eventId/payments', { ...collect, schema: { params: eventParamSchema, body: receiveEventPaymentSchema } }, async (request, reply) => {
    const result = await payments.receiveEventPayment(request.hotelId, request.params.eventId, request.body);
    // Aynı istek ikinci kez gelirse yeni satır açılmaz: 200 ve var olan satır.
    return reply.status(result.created ? 201 : 200).send(ok(result));
  });

  app.post(
    '/events/:eventId/payments/:paymentId/void',
    { ...collect, schema: { params: eventPaymentParamSchema, body: voidEventPaymentSchema } },
    async (request) => ok(await payments.requestEventPaymentVoid(request.hotelId, request.params.eventId, request.params.paymentId, request.body)),
  );

  app.get('/payments/:paymentId', { ...view, schema: { params: eventPaymentRefParamSchema } }, async (request) =>
    ok(await payments.findPaymentEvent(request.hotelId, request.params.paymentId)),
  );

  /* ── Belgeler ── */

  app.post('/events/:eventId/documents', { ...manage, schema: { params: eventParamSchema, body: issueEventDocumentSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await documents.issueDocument(request.hotelId, request.params.eventId, request.body))),
  );

  app.post(
    '/events/:eventId/documents/:documentId/decision',
    { ...manage, schema: { params: eventDocumentParamSchema, body: decideEventDocumentSchema } },
    async (request) => ok(await documents.decideDocument(request.hotelId, request.params.eventId, request.params.documentId, request.body)),
  );

  app.get('/events/:eventId/documents/:documentId/file', { ...view, schema: { params: eventDocumentParamSchema } }, async (request, reply) => {
    const file = await documents.openDocument(request.hotelId, request.params.eventId, request.params.documentId);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Length', file.size)
      .header('Content-Disposition', `inline; filename="${file.fileName}"`)
      // Belge sürümü değişmez (yeni sürüm yeni kimlik): tarayıcı önbelleği güvenli, paylaşılan önbellek değil.
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff');
    return reply.send(file.stream);
  });
}
