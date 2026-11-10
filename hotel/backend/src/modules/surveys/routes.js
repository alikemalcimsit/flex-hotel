import {
  surveyFollowUpAssignSchema,
  surveyFollowUpListQuerySchema,
  surveyFollowUpNoteSchema,
  surveyFollowUpParamSchema,
  surveyFollowUpReopenSchema,
  surveyFollowUpResolveSchema,
  surveyInsightRequestSchema,
  surveyKindParamSchema,
  surveyQuestionCreateSchema,
  surveyQuestionOrderSchema,
  surveyQuestionParamSchema,
  surveyQuestionUpdateSchema,
  surveyReportQuerySchema,
  surveyResponseListQuerySchema,
  surveyResponseParamSchema,
  surveySettingsSchema,
  surveySubmitSchema,
  surveyTokenSchema,
  surveyVersionSchema,
} from '@hotelos/hotel-contracts';
import { guestLinkLimit } from '../../lib/guest-rate-limit.js';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as design from './design.js';
import * as followUps from './followups.js';
import * as guest from './public.js';
import * as responses from './responses.js';

/**
 * Anket ve memnuniyet — personel route'ları (modül 55), `/surveys` altında.
 *
 * - `surveys.view`: cevaplar, NPS raporu, takipler, AI özeti, ayarların özeti.
 * - `surveys.follow_up`: takibi üstlen / not / kapat / yeniden aç.
 * - `surveys.setup`: anket tasarımı, ayarlar, AI dönem özeti isteme (maliyetli).
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function surveyRoutes(app) {
  const guard = (permission) => ({ preHandler: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.SURVEYS_VIEW);
  const followUp = guard(PERMISSIONS.SURVEYS_FOLLOW_UP);
  const setup = guard(PERMISSIONS.SURVEYS_SETUP);
  const ok = (data) => ({ success: true, data });

  app.get('/settings', view, async (req) => ok(await design.getSurveySettings(req.hotelId)));
  app.put('/settings', { ...setup, schema: { body: surveySettingsSchema } }, async (req) => ok(await design.saveSurveySettings(req.hotelId, req.body)));

  app.get('/design/:kind', { ...view, schema: { params: surveyKindParamSchema } }, async (req) => ok(await design.getSurveyDesign(req.hotelId, req.params.kind)));
  app.post('/design/:kind/questions', { ...setup, schema: { params: surveyKindParamSchema, body: surveyQuestionCreateSchema } }, async (req) => ok(await design.addQuestion(req.hotelId, req.params.kind, req.body)));
  app.put('/design/:kind/questions/:questionId', { ...setup, schema: { params: surveyQuestionParamSchema, body: surveyQuestionUpdateSchema } }, async (req) =>
    ok(await design.updateQuestion(req.hotelId, req.params.kind, req.params.questionId, req.body)),
  );
  app.post('/design/:kind/questions/:questionId/remove', { ...setup, schema: { params: surveyQuestionParamSchema, body: surveyVersionSchema } }, async (req) =>
    ok(await design.removeQuestion(req.hotelId, req.params.kind, req.params.questionId, req.body)),
  );
  app.post('/design/:kind/questions/:questionId/restore', { ...setup, schema: { params: surveyQuestionParamSchema, body: surveyVersionSchema } }, async (req) =>
    ok(await design.restoreQuestion(req.hotelId, req.params.kind, req.params.questionId, req.body)),
  );
  app.post('/design/:kind/order', { ...setup, schema: { params: surveyKindParamSchema, body: surveyQuestionOrderSchema } }, async (req) => ok(await design.reorderQuestions(req.hotelId, req.params.kind, req.body)));

  app.get('/responses', { ...view, schema: { querystring: surveyResponseListQuerySchema } }, async (req) => ok(await responses.listResponses(req.hotelId, req.query)));
  app.get('/responses/:responseId', { ...view, schema: { params: surveyResponseParamSchema } }, async (req) => ok(await responses.getResponse(req.hotelId, req.params.responseId)));
  app.get('/report', { ...view, schema: { querystring: surveyReportQuerySchema } }, async (req) => ok(await responses.surveyReport(req.hotelId, req.query)));
  app.get('/insights', { ...view, schema: { querystring: surveyInsightRequestSchema } }, async (req) => ok(await responses.getInsight(req.hotelId, req.query)));
  app.post('/insights', { ...setup, schema: { body: surveyInsightRequestSchema } }, async (req) => ok(await responses.requestInsight(req.hotelId, req.body)));

  app.get('/follow-ups', { ...view, schema: { querystring: surveyFollowUpListQuerySchema } }, async (req) => ok(await followUps.listFollowUps(req.hotelId, req.query)));
  app.get('/follow-ups/assignees', followUp, async (req) => ok(await followUps.listAssignees(req.hotelId)));
  app.get('/follow-ups/:followUpId', { ...view, schema: { params: surveyFollowUpParamSchema } }, async (req) => ok(await followUps.getFollowUp(req.hotelId, req.params.followUpId)));
  app.post('/follow-ups/:followUpId/assign', { ...followUp, schema: { params: surveyFollowUpParamSchema, body: surveyFollowUpAssignSchema } }, async (req) =>
    ok(await followUps.assignFollowUp(req.hotelId, req.params.followUpId, req.body)),
  );
  app.post('/follow-ups/:followUpId/notes', { ...followUp, schema: { params: surveyFollowUpParamSchema, body: surveyFollowUpNoteSchema } }, async (req, reply) =>
    reply.status(201).send(ok(await followUps.addFollowUpNote(req.hotelId, req.params.followUpId, req.body))),
  );
  app.post('/follow-ups/:followUpId/resolve', { ...followUp, schema: { params: surveyFollowUpParamSchema, body: surveyFollowUpResolveSchema } }, async (req) =>
    ok(await followUps.resolveFollowUp(req.hotelId, req.params.followUpId, req.body)),
  );
  app.post('/follow-ups/:followUpId/reopen', { ...followUp, schema: { params: surveyFollowUpParamSchema, body: surveyFollowUpReopenSchema } }, async (req) =>
    ok(await followUps.reopenFollowUp(req.hotelId, req.params.followUpId, req.body)),
  );
}

/** Misafir uçlarının bağlantı başına hız sınırları (dakikada; IP tavanı üst kapsamda, bkz. `lib/guest-rate-limit.js`). */
const GUEST_LIMITS = Object.freeze({ read: 30, write: 5 });

/**
 * Misafirin anket uçları (modül 55), `/public/survey` altında. Oturumsuzdur: kimlik bağlantının imzasıdır. Yanıt
 * önbelleğe alınmaz, belirteç yönlendirmeyle ve istek günlüğüyle sızmaz.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function publicSurveyRoutes(app) {
  const ok = (data) => ({ success: true, data });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').header('x-content-type-options', 'nosniff');
  });
  app.get('/:token', { ...guestLinkLimit(GUEST_LIMITS.read), schema: { params: surveyTokenSchema } }, async (req) => ok(await guest.surveyForm(req.params.token)));
  app.post('/:token', { ...guestLinkLimit(GUEST_LIMITS.write), schema: { params: surveyTokenSchema, body: surveySubmitSchema } }, async (req) => ok(await guest.submitSurvey(req.params.token, req.body)));
}
