import {
  glAccountCreateSchema,
  glAccountLinesQuerySchema,
  glAccountParamSchema,
  glAccountUpdateSchema,
  glChartQuerySchema,
  glPickerQuerySchema,
  journalCreateSchema,
  journalListQuerySchema,
  journalParamSchema,
  journalRulesSchema,
  journalVoidSchema,
  ledgerSettingsSchema,
  ledgerSyncSchema,
  trialBalanceQuerySchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as chart from './chart.js';
import * as journalize from './journalize.js';
import * as journals from './journals.js';
import * as settings from './settings.js';
import { trialBalance } from './trial-balance.js';

/**
 * Genel muhasebe route'ları (modül 48), `/ledger` altında.
 *
 * - Görmek (hesap planı, ekstre, fişler, mizan, kurallar, ayar): `ledger.view`.
 * - Elle fiş, eşitleme: `ledger.manage`. Hesap açma / düzenleme, Tek Düzen tamamlama, kurallar, dönem kilidi,
 *   fiş iptali: `ledger.setup`.
 * - Hesap seçici ayrıca ön muhasebe fişi girenlere açık (kasa / banka giriş-çıkış fişinde karşı hesap).
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function ledgerRoutes(app) {
  const guard = (permission) => ({ preValidation: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.LEDGER_VIEW);
  const manage = guard(PERMISSIONS.LEDGER_MANAGE);
  const setup = guard(PERMISSIONS.LEDGER_SETUP);
  const picker = { preValidation: [withHotelContext, requireAnyPermission(PERMISSIONS.LEDGER_VIEW, PERMISSIONS.ACCOUNTING_MANAGE)] };
  const ok = (data) => ({ success: true, data });

  /* ── Hesap planı ── */
  app.get('/chart', { ...view, schema: { querystring: glChartQuerySchema } }, async (req) => ok(await chart.listChart(req.hotelId, req.query)));
  app.get('/chart/picker', { ...picker, schema: { querystring: glPickerQuerySchema } }, async (req) => ok(await chart.pickAccounts(req.hotelId, req.query)));
  app.post('/chart', { ...setup, schema: { body: glAccountCreateSchema } }, async (req, reply) => reply.status(201).send(ok(await chart.createAccount(req.hotelId, req.body))));
  app.post('/chart/seed', setup, async (req) => ok(await chart.seedChart(req.hotelId)));
  app.put('/chart/:accountId', { ...setup, schema: { params: glAccountParamSchema, body: glAccountUpdateSchema } }, async (req) => ok(await chart.updateAccount(req.hotelId, req.params.accountId, req.body)));
  app.get('/chart/:accountId/lines', { ...view, schema: { params: glAccountParamSchema, querystring: glAccountLinesQuerySchema } }, async (req) =>
    ok(await chart.accountLines(req.hotelId, req.params.accountId, req.query)),
  );

  /* ── Yevmiye ── */
  app.get('/journals', { ...view, schema: { querystring: journalListQuerySchema } }, async (req) => ok(await journals.listJournals(req.hotelId, req.query)));
  app.post('/journals', { ...manage, schema: { body: journalCreateSchema } }, async (req, reply) => {
    const result = await journals.createManualJournal(req.hotelId, req.body);
    return reply.status(result.created ? 201 : 200).send(ok(result));
  });
  app.get('/journals/:journalId', { ...view, schema: { params: journalParamSchema } }, async (req) => ok(await journals.getJournal(req.hotelId, req.params.journalId)));
  app.post('/journals/:journalId/void', { ...setup, schema: { params: journalParamSchema, body: journalVoidSchema } }, async (req) =>
    ok(await journals.voidJournal(req.hotelId, req.params.journalId, req.body)),
  );

  /* ── Mizan ── */
  app.get('/trial-balance', { ...view, schema: { querystring: trialBalanceQuerySchema } }, async (req) => ok(await trialBalance(req.hotelId, req.query)));

  /* ── Kurallar, ayar, eşitleme ── */
  app.get('/rules', view, async (req) => ok(await settings.getRules(req.hotelId)));
  app.put('/rules', { ...setup, schema: { body: journalRulesSchema } }, async (req) => ok(await settings.saveRules(req.hotelId, req.body)));
  app.get('/settings', view, async (req) => ok(await settings.getLedgerSettings(req.hotelId)));
  app.put('/settings', { ...setup, schema: { body: ledgerSettingsSchema } }, async (req) => ok(await settings.saveLedgerSettings(req.hotelId, req.body)));
  app.post('/sync', { ...manage, schema: { body: ledgerSyncSchema } }, async (req) => ok(await journalize.syncJournals(req.hotelId, req.body)));
}
