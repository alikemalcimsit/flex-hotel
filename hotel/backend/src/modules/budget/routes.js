import {
  budgetCommentaryRequestSchema,
  budgetExpenseItemParamSchema,
  budgetExpenseItemSchema,
  budgetIdParamSchema,
  budgetVarianceQuerySchema,
  budgetVersionActionSchema,
  budgetYearParamSchema,
  createBudgetSchema,
  reviseBudgetSchema,
  saveBudgetLinesSchema,
  saveExpenseActualsSchema,
  updateBudgetExpenseItemSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';
import * as variance from './variance.js';

/**
 * Bütçe route'ları (modül 27).
 *
 * - Görmek: \`budget.view\` (müdür, muhasebe).
 * - Taslağı, gider kalemlerini, gerçekleşen giderleri düzenlemek ve AI yorumu
 *   istemek: \`budget.manage\` (müdür, muhasebe).
 * - Onaylamak ve revize açmak: \`budget.approve\` (müdür).
 *
 * Liste uçları sınırlıdır (bir yılın sürümleri, otelin en fazla 40 gider
 * kalemi): sayfalama gerektirecek büyüklükte liste yok.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function budgetRoutes(app) {
  const guard = (permission) => ({ preHandler: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.BUDGET_VIEW);
  const manage = guard(PERMISSIONS.BUDGET_MANAGE);
  const approve = guard(PERMISSIONS.BUDGET_APPROVE);
  const ok = (data) => ({ success: true, data });

  /* ── Gider kalemleri (statik yollar parametreli yıllardan önce) ── */
  app.get('/expense-items', view, async (request) => ok(await service.listExpenseItems(request.hotelId)));
  app.post('/expense-items', { ...manage, schema: { body: budgetExpenseItemSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await service.addExpenseItem(request.hotelId, request.body))),
  );
  app.patch('/expense-items/:itemId', { ...manage, schema: { params: budgetExpenseItemParamSchema, body: updateBudgetExpenseItemSchema } }, async (request) =>
    ok(await service.renameExpenseItem(request.hotelId, request.params.itemId, request.body)),
  );
  app.delete('/expense-items/:itemId', { ...manage, schema: { params: budgetExpenseItemParamSchema } }, async (request) =>
    ok(await service.archiveExpenseItem(request.hotelId, request.params.itemId)),
  );

  /* ── Gerçekleşen giderler ── */
  app.put('/actuals', { ...manage, schema: { body: saveExpenseActualsSchema } }, async (request) =>
    ok(await service.saveExpenseActuals(request.hotelId, request.body)),
  );

  /* ── AI yorumu ── */
  app.post('/commentary', { ...manage, schema: { body: budgetCommentaryRequestSchema } }, async (request, reply) =>
    reply.status(202).send(ok(await variance.requestCommentary(request.hotelId, request.body))),
  );

  /* ── Sürümler ── */
  app.post('/', { ...manage, schema: { body: createBudgetSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await service.createBudget(request.hotelId, request.body))),
  );
  app.put('/versions/:id/lines', { ...manage, schema: { params: budgetIdParamSchema, body: saveBudgetLinesSchema } }, async (request) =>
    ok(await service.saveBudgetLines(request.hotelId, request.params.id, request.body)),
  );
  app.post('/versions/:id/approve', { ...approve, schema: { params: budgetIdParamSchema, body: budgetVersionActionSchema } }, async (request) =>
    ok(await service.approveBudget(request.hotelId, request.params.id, request.body)),
  );

  /* ── Yıl ── */
  app.get('/:year', { ...view, schema: { params: budgetYearParamSchema } }, async (request) =>
    ok(await service.getBudgetYear(request.hotelId, request.params.year)),
  );
  app.post('/:year/revise', { ...approve, schema: { params: budgetYearParamSchema, body: reviseBudgetSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await service.reviseBudget(request.hotelId, request.params.year, request.body))),
  );
  app.get('/:year/actuals', { ...view, schema: { params: budgetYearParamSchema } }, async (request) =>
    ok(await service.getExpenseActuals(request.hotelId, request.params.year)),
  );
  app.get('/:year/variance', { ...view, schema: { params: budgetYearParamSchema, querystring: budgetVarianceQuerySchema.omit({ year: true }) } }, async (request) =>
    ok(await variance.getVarianceReport(request.hotelId, { ...request.query, year: request.params.year })),
  );
  app.get('/:year/commentary', { ...view, schema: { params: budgetYearParamSchema, querystring: budgetVarianceQuerySchema.omit({ year: true }) } }, async (request) =>
    ok(await variance.getCommentary(request.hotelId, { ...request.query, year: request.params.year })),
  );
}
