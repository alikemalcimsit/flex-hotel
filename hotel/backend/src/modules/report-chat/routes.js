import { askReportQuestionSchema, idParamSchema, saveReportSchema, savedReportListQuerySchema, updateSavedReportSchema } from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import { askQuestion, getQuestion, listQuestions } from './questions.js';
import { deleteSavedReport, listSavedReports, runSavedReport, saveReport, updateSavedReport } from './saved.js';

/**
 * Rapor asistanı route'ları (modül 24), `/report-chat` altında.
 *
 * - Soru sor, sohbet geçmişi, kaydet / paylaş / sil: `reports.ask` (soru otelin günlük AI bütçesini harcar).
 * - Kayıtlı (kendi ve paylaşılan) raporu görmek / çalıştırmak: `reports.view` (AI harcamaz).
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function reportChatRoutes(app) {
  const guard = (permission) => ({ preValidation: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.REPORTS_VIEW);
  const ask = guard(PERMISSIONS.REPORTS_ASK);
  const ok = (data) => ({ success: true, data });

  app.get('/questions', ask, async (req) => ok(await listQuestions(req.hotelId)));
  app.post('/questions', { ...ask, schema: { body: askReportQuestionSchema } }, async (req, reply) => {
    reply.code(202);
    return ok(await askQuestion(req.hotelId, req.body));
  });
  app.get('/questions/:id', { ...ask, schema: { params: idParamSchema } }, async (req) => ok(await getQuestion(req.hotelId, req.params.id)));

  app.get('/saved', { ...view, schema: { querystring: savedReportListQuerySchema } }, async (req) => ok(await listSavedReports(req.hotelId, req.query)));
  app.post('/saved', { ...ask, schema: { body: saveReportSchema } }, async (req, reply) => {
    reply.code(201);
    return ok(await saveReport(req.hotelId, req.body));
  });
  app.patch('/saved/:id', { ...ask, schema: { params: idParamSchema, body: updateSavedReportSchema } }, async (req) => ok(await updateSavedReport(req.hotelId, req.params.id, req.body)));
  app.delete('/saved/:id', { ...ask, schema: { params: idParamSchema } }, async (req, reply) => {
    await deleteSavedReport(req.hotelId, req.params.id);
    reply.code(204);
  });
  app.post('/saved/:id/run', { ...view, schema: { params: idParamSchema } }, async (req) => ok(await runSavedReport(req.hotelId, req.params.id)));
}
