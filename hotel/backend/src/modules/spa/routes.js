import {
  guestPortalTokenSchema,
  spaAppointmentCreateSchema,
  spaAppointmentListQuerySchema,
  spaAppointmentParamSchema,
  spaAppointmentPriceSchema,
  spaAppointmentUpdateSchema,
  spaAvailabilityQuerySchema,
  spaBlockInputSchema,
  spaBlockListQuerySchema,
  spaBlockParamSchema,
  spaCalendarQuerySchema,
  spaCancelSchema,
  spaCompleteSchema,
  spaDeleteQuerySchema,
  spaEnrollSchema,
  spaEntityParamSchema,
  spaPaymentParamSchema,
  spaPaymentRefParamSchema,
  spaPaymentSchema,
  spaPaymentVoidSchema,
  spaPortalAppointmentParamSchema,
  spaPortalAvailabilityQuerySchema,
  spaPortalBookSchema,
  spaPortalEnrollSchema,
  spaPortalSessionParamSchema,
  spaReportQuerySchema,
  spaRestoreSchema,
  spaRoomChargeSchema,
  spaRoomInputSchema,
  spaRoomUpdateSchema,
  spaServiceInputSchema,
  spaServiceUpdateSchema,
  spaSessionCancelSchema,
  spaSessionCompleteSchema,
  spaSessionCreateSchema,
  spaSessionListQuerySchema,
  spaSessionParamSchema,
  spaSessionUpdateSchema,
  spaSettingsSchema,
  spaStaySearchQuerySchema,
  spaTherapistInputSchema,
  spaTherapistUpdateSchema,
} from '@hotelos/hotel-contracts';
import { guestLinkLimit } from '../../lib/guest-rate-limit.js';
import { PERMISSIONS, assertRequestPermission, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as appointments from './appointments.js';
import * as guest from './guest.js';
import * as payments from './payments.js';
import { spaReport } from './report.js';
import * as schedule from './schedule.js';
import * as sessions from './sessions.js';
import * as setup from './setup.js';

/**
 * Spa ve spor salonu — personel route'ları (modül 57), `/spa` altında.
 *
 * - `spa.view`: takvim, randevular, dersler, rapor, tanımların okunması.
 * - `spa.book`: randevu aç / düzenle / tamamla / iptal / gelmedi / geri al; derse kayıt; ücreti odaya yaz.
 * - `spa.payment`: spa kasasında tahsilat, iade ve iptal isteği.
 * - `spa.supervise`: fiyatı elle belirle; geç iptal / gelmedi bedelini sil (gövdede `waiveFee`).
 * - `spa.setup`: hizmet, terapist, oda, blok, ders programı (seans aç / düzenle / iptal) ve ayarlar.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function spaRoutes(app) {
  const guard = (permission) => ({ preValidation: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.SPA_VIEW);
  const book = guard(PERMISSIONS.SPA_BOOK);
  const pay = guard(PERMISSIONS.SPA_PAYMENT);
  const supervise = guard(PERMISSIONS.SPA_SUPERVISE);
  const manage = guard(PERMISSIONS.SPA_SETUP);
  // Onay ekranından randevuya geçiş: ödemeyi görebilen ya da onaylayabilen.
  const paymentRef = { preValidation: [withHotelContext, requireAnyPermission(PERMISSIONS.SPA_VIEW, PERMISSIONS.APPROVALS_VIEW)] };
  const ok = (data) => ({ success: true, data });
  const created = (reply, data) => reply.status(201).send(ok(data));

  /* ── Ayar ve tanımlar ── */
  app.get('/settings', view, async (req) => ok(await setup.getSpaSettings(req.hotelId)));
  app.put('/settings', { ...manage, schema: { body: spaSettingsSchema } }, async (req) => ok(await setup.saveSpaSettings(req.hotelId, req.body)));
  app.get('/setup', view, async (req) => ok(await setup.getSpaSetup(req.hotelId)));

  app.post('/rooms', { ...manage, schema: { body: spaRoomInputSchema } }, async (req, reply) => created(reply, await setup.createSpaRoom(req.hotelId, req.body)));
  app.put('/rooms/:id', { ...manage, schema: { params: spaEntityParamSchema, body: spaRoomUpdateSchema } }, async (req) => ok(await setup.updateSpaRoom(req.hotelId, req.params.id, req.body)));
  app.delete('/rooms/:id', { ...manage, schema: { params: spaEntityParamSchema, querystring: spaDeleteQuerySchema } }, async (req) => ok(await setup.deleteSpaRoom(req.hotelId, req.params.id, req.query)));

  app.post('/therapists', { ...manage, schema: { body: spaTherapistInputSchema } }, async (req, reply) => created(reply, await setup.createSpaTherapist(req.hotelId, req.body)));
  app.put('/therapists/:id', { ...manage, schema: { params: spaEntityParamSchema, body: spaTherapistUpdateSchema } }, async (req) => ok(await setup.updateSpaTherapist(req.hotelId, req.params.id, req.body)));
  app.delete('/therapists/:id', { ...manage, schema: { params: spaEntityParamSchema, querystring: spaDeleteQuerySchema } }, async (req) => ok(await setup.deleteSpaTherapist(req.hotelId, req.params.id, req.query)));

  app.post('/services', { ...manage, schema: { body: spaServiceInputSchema } }, async (req, reply) => created(reply, await setup.createSpaService(req.hotelId, req.body)));
  app.put('/services/:id', { ...manage, schema: { params: spaEntityParamSchema, body: spaServiceUpdateSchema } }, async (req) => ok(await setup.updateSpaService(req.hotelId, req.params.id, req.body)));
  app.delete('/services/:id', { ...manage, schema: { params: spaEntityParamSchema, querystring: spaDeleteQuerySchema } }, async (req) => ok(await setup.deleteSpaService(req.hotelId, req.params.id, req.query)));

  app.get('/blocks', { ...view, schema: { querystring: spaBlockListQuerySchema } }, async (req) => ok(await setup.listSpaBlocks(req.hotelId, req.query)));
  app.post('/blocks', { ...manage, schema: { body: spaBlockInputSchema } }, async (req, reply) => created(reply, await setup.createSpaBlock(req.hotelId, req.body)));
  app.delete('/blocks/:blockId', { ...manage, schema: { params: spaBlockParamSchema } }, async (req) => ok(await setup.deleteSpaBlock(req.hotelId, req.params.blockId)));

  /* ── Takvim ve boş saat ── */
  app.get('/calendar', { ...view, schema: { querystring: spaCalendarQuerySchema } }, async (req) => ok(await schedule.getSpaCalendar(req.hotelId, req.query)));
  app.get('/availability', { ...view, schema: { querystring: spaAvailabilityQuerySchema } }, async (req) => ok(await schedule.spaAvailability(req.hotelId, req.query)));
  app.get('/stays', { ...book, schema: { querystring: spaStaySearchQuerySchema } }, async (req) => ok(await appointments.searchSpaStays(req.hotelId, req.query)));

  /* ── Randevu ── */
  app.get('/appointments', { ...view, schema: { querystring: spaAppointmentListQuerySchema } }, async (req) => ok(await appointments.listSpaAppointments(req.hotelId, req.query)));
  app.post('/appointments', { ...book, schema: { body: spaAppointmentCreateSchema } }, async (req, reply) => {
    const result = await appointments.createSpaAppointment(req.hotelId, req.body, { logger: req.log });
    return reply.status(result.created ? 201 : 200).send(ok(result));
  });
  app.get('/appointments/:appointmentId', { ...view, schema: { params: spaAppointmentParamSchema } }, async (req) => ok(await appointments.getSpaAppointment(req.hotelId, req.params.appointmentId)));
  app.put('/appointments/:appointmentId', { ...book, schema: { params: spaAppointmentParamSchema, body: spaAppointmentUpdateSchema } }, async (req) =>
    ok(await appointments.updateSpaAppointment(req.hotelId, req.params.appointmentId, req.body, { logger: req.log })),
  );
  app.post('/appointments/:appointmentId/price', { ...supervise, schema: { params: spaAppointmentParamSchema, body: spaAppointmentPriceSchema } }, async (req) =>
    ok(await appointments.priceSpaAppointment(req.hotelId, req.params.appointmentId, req.body)),
  );
  app.post('/appointments/:appointmentId/complete', { ...book, schema: { params: spaAppointmentParamSchema, body: spaCompleteSchema } }, async (req) =>
    ok(await appointments.completeSpaAppointment(req.hotelId, req.params.appointmentId, req.body)),
  );
  /** İptal ve gelmedi: bedeli silmek ayrıca `spa.supervise` ister (gövdeye bağlı yetki, doğrulanmış gövdeyle). */
  const close = (outcome) => async (req) => {
    if (req.body.waiveFee) assertRequestPermission(req, PERMISSIONS.SPA_SUPERVISE, 'Bedeli silmek için yetkiniz yok');
    return ok(await appointments.closeSpaAppointment(req.hotelId, req.params.appointmentId, req.body, { outcome, logger: req.log }));
  };
  app.post('/appointments/:appointmentId/cancel', { ...book, schema: { params: spaAppointmentParamSchema, body: spaCancelSchema } }, close('CANCELLED'));
  app.post('/appointments/:appointmentId/no-show', { ...book, schema: { params: spaAppointmentParamSchema, body: spaCancelSchema } }, close('NO_SHOW'));
  app.post('/appointments/:appointmentId/restore', { ...book, schema: { params: spaAppointmentParamSchema, body: spaRestoreSchema } }, async (req) =>
    ok(await appointments.restoreSpaAppointment(req.hotelId, req.params.appointmentId, req.body)),
  );
  app.post('/appointments/:appointmentId/room-charge', { ...book, schema: { params: spaAppointmentParamSchema, body: spaRoomChargeSchema } }, async (req) =>
    ok(await appointments.chargeSpaAppointmentToRoom(req.hotelId, req.params.appointmentId, req.body)),
  );

  /* ── Ödeme ── */
  app.post('/appointments/:appointmentId/payments', { ...pay, schema: { params: spaAppointmentParamSchema, body: spaPaymentSchema } }, async (req, reply) => {
    const result = await payments.receiveSpaPayment(req.hotelId, req.params.appointmentId, req.body);
    return reply.status(result.created ? 201 : 200).send(ok(result));
  });
  app.post('/appointments/:appointmentId/payments/:paymentId/void', { ...pay, schema: { params: spaPaymentParamSchema, body: spaPaymentVoidSchema } }, async (req) =>
    ok(await payments.requestSpaPaymentVoid(req.hotelId, req.params.appointmentId, req.params.paymentId, req.body)),
  );
  app.get('/payments/:paymentId/appointment', { ...paymentRef, schema: { params: spaPaymentRefParamSchema } }, async (req) => ok(await payments.findSpaPaymentAppointment(req.hotelId, req.params.paymentId)));

  /* ── Grup dersi ── */
  app.get('/sessions', { ...view, schema: { querystring: spaSessionListQuerySchema } }, async (req) => ok(await sessions.listSpaSessions(req.hotelId, req.query)));
  app.post('/sessions', { ...manage, schema: { body: spaSessionCreateSchema } }, async (req, reply) => created(reply, await sessions.createSpaSessions(req.hotelId, req.body)));
  app.get('/sessions/:sessionId', { ...view, schema: { params: spaSessionParamSchema } }, async (req) => ok(await sessions.getSpaSession(req.hotelId, req.params.sessionId)));
  app.put('/sessions/:sessionId', { ...manage, schema: { params: spaSessionParamSchema, body: spaSessionUpdateSchema } }, async (req) =>
    ok(await sessions.updateSpaSession(req.hotelId, req.params.sessionId, req.body, { logger: req.log })),
  );
  app.post('/sessions/:sessionId/cancel', { ...manage, schema: { params: spaSessionParamSchema, body: spaSessionCancelSchema } }, async (req) =>
    ok(await sessions.cancelSpaSession(req.hotelId, req.params.sessionId, req.body)),
  );
  app.post('/sessions/:sessionId/complete', { ...book, schema: { params: spaSessionParamSchema, body: spaSessionCompleteSchema } }, async (req) =>
    ok(await sessions.completeSpaSession(req.hotelId, req.params.sessionId, req.body)),
  );
  app.post('/sessions/:sessionId/enroll', { ...book, schema: { params: spaSessionParamSchema, body: spaEnrollSchema } }, async (req, reply) => {
    const result = await sessions.enrollSpaSession(req.hotelId, req.params.sessionId, req.body, { logger: req.log });
    return reply.status(result.created ? 201 : 200).send(ok(result));
  });

  /* ── Rapor ── */
  app.get('/report', { ...view, schema: { querystring: spaReportQuerySchema } }, async (req) => ok(await spaReport(req.hotelId, req.query)));
}

/** Misafir uçlarının bağlantı başına hız sınırları (dakikada; IP tavanı üst kapsamda, bkz. `lib/guest-rate-limit.js`). */
const GUEST_LIMITS = Object.freeze({ read: 60, write: 10 });

/**
 * Misafir portalının spa uçları (modül 57), `/public/portal` altında (portalın diğer uçlarıyla aynı bağlantı).
 * Oturumsuzdur: kimlik bağlantının imzasıdır. Yanıt önbelleğe alınmaz, belirteç yönlendirmeyle ve istek günlüğüyle
 * sızmaz (`/public/portal/*` maskelidir).
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function publicSpaRoutes(app) {
  const ok = (data) => ({ success: true, data });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').header('x-content-type-options', 'nosniff');
  });
  const read = guestLinkLimit(GUEST_LIMITS.read);
  const write = guestLinkLimit(GUEST_LIMITS.write);

  app.get('/:token/spa', { ...read, schema: { params: guestPortalTokenSchema } }, async (req) => ok(await guest.portalSpa(req.params.token)));
  app.get('/:token/spa/availability', { ...read, schema: { params: guestPortalTokenSchema, querystring: spaPortalAvailabilityQuerySchema } }, async (req) =>
    ok(await guest.portalSpaAvailability(req.params.token, req.query)),
  );
  app.post('/:token/spa/appointments', { ...write, schema: { params: guestPortalTokenSchema, body: spaPortalBookSchema } }, async (req, reply) => {
    const result = await guest.portalSpaBook(req.params.token, req.body);
    return reply.status(result.created ? 201 : 200).send(ok(result));
  });
  app.post('/:token/spa/appointments/:appointmentId/cancel', { ...write, schema: { params: spaPortalAppointmentParamSchema } }, async (req) =>
    ok(await guest.portalSpaCancel(req.params.token, req.params.appointmentId)),
  );
  app.post('/:token/spa/sessions/:sessionId/enroll', { ...write, schema: { params: spaPortalSessionParamSchema, body: spaPortalEnrollSchema } }, async (req, reply) => {
    const result = await guest.portalSpaEnroll(req.params.token, req.params.sessionId, req.body);
    return reply.status(result.created ? 201 : 200).send(ok(result));
  });
}
