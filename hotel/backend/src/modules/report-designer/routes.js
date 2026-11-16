import { createReportDefinitionSchema, idParamSchema, runReportDesignSchema, savedReportListQuerySchema, updateReportDefinitionSchema } from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import { createDefinition, deleteDefinition, getDefinition, listDefinitions, runDefinition, runDesign, updateDefinition } from './service.js';

/**
 * Rapor tasarımcısı route'ları (modül 26), `/report-designer` altında. Hepsi `reports.view` ister; kaynağın kendi
 * yetkisi (rezervasyon / folyo / misafir / kasa görme) serviste denetlenir.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function reportDesignerRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.REPORTS_VIEW)] };
  const ok = (data) => ({ success: true, data });
  const perms = (req) => req.auth.permissions;

  app.post('/run', { ...view, schema: { body: runReportDesignSchema } }, async (req) => ok(await runDesign(req.hotelId, perms(req), req.body)));
  app.get('/definitions', { ...view, schema: { querystring: savedReportListQuerySchema } }, async (req) => ok(await listDefinitions(req.hotelId, perms(req), req.query)));
  app.post('/definitions', { ...view, schema: { body: createReportDefinitionSchema } }, async (req, reply) => {
    reply.code(201);
    return ok(await createDefinition(req.hotelId, perms(req), req.body));
  });
  app.get('/definitions/:id', { ...view, schema: { params: idParamSchema } }, async (req) => ok(await getDefinition(req.hotelId, perms(req), req.params.id)));
  app.patch('/definitions/:id', { ...view, schema: { params: idParamSchema, body: updateReportDefinitionSchema } }, async (req) =>
    ok(await updateDefinition(req.hotelId, perms(req), req.params.id, req.body)),
  );
  app.delete('/definitions/:id', { ...view, schema: { params: idParamSchema } }, async (req, reply) => {
    await deleteDefinition(req.hotelId, req.params.id);
    reply.code(204);
  });
  app.post('/definitions/:id/run', { ...view, schema: { params: idParamSchema } }, async (req) => ok(await runDefinition(req.hotelId, perms(req), req.params.id)));
}
