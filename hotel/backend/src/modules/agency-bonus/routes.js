import {
  agencyBonusLinesQuerySchema,
  agencyBonusListQuerySchema,
  agencyBonusExportQuerySchema,
  agencyBonusParamSchema,
  agencyBonusRuleListQuerySchema,
  agencyBonusRuleParamSchema,
  agencyBonusVersionSchema,
  cancelAgencyBonusRuleSchema,
  createAgencyBonusRuleSchema,
  markAgencyBonusPaidSchema,
  previewAgencyBonusRuleSchema,
  reopenAgencyBonusSchema,
  revertAgencyBonusPaymentSchema,
  submitAgencyBonusSchema,
  updateAgencyBonusRuleSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as rules from './service.js';
import * as settlement from './settlement.js';

/**
 * Acente bonusu route'ları (modül 35).
 *
 * - Görmek (kurallar, ilerleme, hak ediş raporu ve dökümü): `agency_bonus.view`
 *   (müdür, muhasebe).
 * - Kural açmak / düzenlemek / yürürlüğe almak / iptal, hak edişi hesaplamak,
 *   onaya göndermek, yeniden açmak: `agency_bonus.manage` (müdür).
 * - Ödendi işaretlemek / geri almak: `agency_bonus.pay` (muhasebe, müdür).
 * - Hak edişin onayı onay kuyruğundan verilir (`approvals.decide`, dört göz).
 *
 * Liste uçları sayfalıdır; dökümün Excel'i üst sınırlıdır.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function agencyBonusRoutes(app) {
  const guard = (permission) => ({ preHandler: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.AGENCY_BONUS_VIEW);
  const manage = guard(PERMISSIONS.AGENCY_BONUS_MANAGE);
  const pay = guard(PERMISSIONS.AGENCY_BONUS_PAY);
  const ok = (data) => ({ success: true, data });

  /* ── Özet ve kurallar (statik yollar parametreli yollardan önce) ── */

  app.get('/summary', view, async (request) => ok(await rules.getBonusSummary(request.hotelId)));

  app.get('/rules', { ...view, schema: { querystring: agencyBonusRuleListQuerySchema } }, async (request) =>
    ok(await rules.listRules(request.hotelId, request.query)),
  );

  app.post('/rules', { ...manage, schema: { body: createAgencyBonusRuleSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await rules.createRule(request.hotelId, request.body))),
  );

  // Önizleme okuma işidir ama formun girdisini gövdeyle alır; kural yazabilen kişi kullanır.
  app.post('/rules/preview', { ...manage, schema: { body: previewAgencyBonusRuleSchema } }, async (request) =>
    ok(await rules.previewRule(request.hotelId, request.body)),
  );

  app.get('/rules/:ruleId', { ...view, schema: { params: agencyBonusRuleParamSchema } }, async (request) =>
    ok(await rules.getRule(request.hotelId, request.params.ruleId)),
  );

  app.patch('/rules/:ruleId', { ...manage, schema: { params: agencyBonusRuleParamSchema, body: updateAgencyBonusRuleSchema } }, async (request) =>
    ok(await rules.updateRule(request.hotelId, request.params.ruleId, request.body)),
  );

  app.post('/rules/:ruleId/activate', { ...manage, schema: { params: agencyBonusRuleParamSchema, body: agencyBonusVersionSchema } }, async (request) =>
    ok(await rules.activateRule(request.hotelId, request.params.ruleId, request.body)),
  );

  app.post('/rules/:ruleId/cancel', { ...manage, schema: { params: agencyBonusRuleParamSchema, body: cancelAgencyBonusRuleSchema } }, async (request) =>
    ok(await rules.cancelRule(request.hotelId, request.params.ruleId, request.body)),
  );

  app.post('/rules/:ruleId/delete', { ...manage, schema: { params: agencyBonusRuleParamSchema, body: agencyBonusVersionSchema } }, async (request) =>
    ok(await rules.deleteRule(request.hotelId, request.params.ruleId, request.body)),
  );

  app.post('/rules/:ruleId/settle', { ...manage, schema: { params: agencyBonusRuleParamSchema } }, async (request) =>
    ok(await settlement.calculateBonus(request.hotelId, request.params.ruleId)),
  );

  /* ── Hak ediş ── */

  app.get('/settlements', { ...view, schema: { querystring: agencyBonusListQuerySchema } }, async (request) =>
    ok(await settlement.listBonuses(request.hotelId, request.query)),
  );

  app.get('/settlements/:bonusId', { ...view, schema: { params: agencyBonusParamSchema } }, async (request) =>
    ok(await settlement.getBonus(request.hotelId, request.params.bonusId)),
  );

  app.get('/settlements/:bonusId/lines', { ...view, schema: { params: agencyBonusParamSchema, querystring: agencyBonusLinesQuerySchema } }, async (request) =>
    ok(await settlement.listBonusLines(request.hotelId, request.params.bonusId, request.query)),
  );

  app.get('/settlements/:bonusId/export', { ...view, schema: { params: agencyBonusParamSchema, querystring: agencyBonusExportQuerySchema } }, async (request) =>
    ok(await settlement.exportBonusLines(request.hotelId, request.params.bonusId, request.query)),
  );

  app.post('/settlements/:bonusId/submit', { ...manage, schema: { params: agencyBonusParamSchema, body: submitAgencyBonusSchema } }, async (request) =>
    ok(await settlement.submitBonus(request.hotelId, request.params.bonusId, request.body)),
  );

  app.post('/settlements/:bonusId/reopen', { ...manage, schema: { params: agencyBonusParamSchema, body: reopenAgencyBonusSchema } }, async (request) =>
    ok(await settlement.reopenBonus(request.hotelId, request.params.bonusId, request.body)),
  );

  app.post('/settlements/:bonusId/pay', { ...pay, schema: { params: agencyBonusParamSchema, body: markAgencyBonusPaidSchema } }, async (request) =>
    ok(await settlement.markBonusPaid(request.hotelId, request.params.bonusId, request.body)),
  );

  app.post('/settlements/:bonusId/revert-payment', { ...pay, schema: { params: agencyBonusParamSchema, body: revertAgencyBonusPaymentSchema } }, async (request) =>
    ok(await settlement.revertBonusPayment(request.hotelId, request.params.bonusId, request.body)),
  );
}
