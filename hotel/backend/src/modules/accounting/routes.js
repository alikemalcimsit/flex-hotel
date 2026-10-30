import {
  accountingSettingsSchema,
  accountingSyncSchema,
  agingQuerySchema,
  instrumentActionSchema,
  instrumentListQuerySchema,
  instrumentParamSchema,
  ledgerAccountCreateSchema,
  ledgerAccountLinkSchema,
  ledgerAccountListQuerySchema,
  ledgerAccountParamSchema,
  ledgerAccountPickerQuerySchema,
  ledgerAccountUpdateSchema,
  openingBalanceSchema,
  statementQuerySchema,
  treasuryAccountCreateSchema,
  treasuryAccountParamSchema,
  treasuryAccountUpdateSchema,
  treasuryListQuerySchema,
  treasuryMappingSchema,
  treasuryMovementsQuerySchema,
  voucherCreateSchema,
  voucherListQuerySchema,
  voucherParamSchema,
  voucherVoidSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as accounts from './accounts.js';
import * as instruments from './instruments.js';
import * as postings from './postings.js';
import * as treasury from './treasury.js';
import * as vouchers from './vouchers.js';

/**
 * Ön muhasebe route'ları (modül 47), `/accounting` altında.
 *
 * - Görmek (cariler, ekstre, yaşlandırma, kasa / banka hareketleri, çek / senet, fişler): `accounting.view`.
 * - Fiş girmek (tahsilat, ödeme, virman, giriş / çıkış), çek / senet işlemleri, cari kartı, eksik kayıtları
 *   eşitlemek: `accounting.manage`. Eşik üstü ödeme fişi onay kuyruğundan, başka yetkili onaylar.
 * - Kasa / banka tanımları, eşleme, başlangıç günü ve onay eşiği, açılış bakiyesi, fiş iptali: `accounting.setup`.
 * - Cari seçici ayrıca ödeme alan personele açık (folyoda "Acente / cari" için cari seçimi, modül 17).
 *
 * Bütün listeler sayfalı (ekstre ve hareketler imleçli); kasa / banka hesap listesi otel başına sınırlı (200).
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function accountingRoutes(app) {
  const guard = (permission) => ({ preHandler: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.ACCOUNTING_VIEW);
  const manage = guard(PERMISSIONS.ACCOUNTING_MANAGE);
  const setup = guard(PERMISSIONS.ACCOUNTING_SETUP);
  const picker = { preHandler: [withHotelContext, requireAnyPermission(PERMISSIONS.ACCOUNTING_VIEW, PERMISSIONS.PAYMENT_RECEIVE, PERMISSIONS.PAYMENT_REFUND)] };
  const ok = (data) => ({ success: true, data });

  /* ── Cari ── */
  app.get('/accounts', { ...view, schema: { querystring: ledgerAccountListQuerySchema } }, async (req) => ok(await accounts.listAccounts(req.hotelId, req.query)));
  app.get('/accounts/picker', { ...picker, schema: { querystring: ledgerAccountPickerQuerySchema } }, async (req) => ok(await accounts.pickAccounts(req.hotelId, req.query)));
  app.get('/accounts/aging', { ...view, schema: { querystring: agingQuerySchema } }, async (req) => ok(await accounts.agingReport(req.hotelId, req.query)));
  app.post('/accounts', { ...manage, schema: { body: ledgerAccountCreateSchema } }, async (req, reply) => reply.status(201).send(ok(await accounts.createAccount(req.hotelId, req.body))));
  app.post('/accounts/link', { ...manage, schema: { body: ledgerAccountLinkSchema } }, async (req) => ok(await accounts.linkAccount(req.hotelId, req.body)));
  app.get('/accounts/:accountId', { ...view, schema: { params: ledgerAccountParamSchema } }, async (req) => ok(await accounts.getAccount(req.hotelId, req.params.accountId)));
  app.put('/accounts/:accountId', { ...manage, schema: { params: ledgerAccountParamSchema, body: ledgerAccountUpdateSchema } }, async (req) =>
    ok(await accounts.updateAccount(req.hotelId, req.params.accountId, req.body)),
  );
  app.get('/accounts/:accountId/statement', { ...view, schema: { params: ledgerAccountParamSchema, querystring: statementQuerySchema } }, async (req) =>
    ok(await accounts.getStatement(req.hotelId, req.params.accountId, req.query)),
  );

  /* ── Kasa / banka ── */
  app.get('/treasury', { ...view, schema: { querystring: treasuryListQuerySchema } }, async (req) => ok(await treasury.listTreasuryAccounts(req.hotelId, req.query)));
  app.post('/treasury', { ...setup, schema: { body: treasuryAccountCreateSchema } }, async (req, reply) => reply.status(201).send(ok(await treasury.createTreasuryAccount(req.hotelId, req.body))));
  app.get('/treasury/:treasuryAccountId', { ...view, schema: { params: treasuryAccountParamSchema } }, async (req) => ok(await treasury.getTreasuryAccount(req.hotelId, req.params.treasuryAccountId)));
  app.put('/treasury/:treasuryAccountId', { ...setup, schema: { params: treasuryAccountParamSchema, body: treasuryAccountUpdateSchema } }, async (req) =>
    ok(await treasury.updateTreasuryAccount(req.hotelId, req.params.treasuryAccountId, req.body)),
  );
  app.get('/treasury/:treasuryAccountId/movements', { ...view, schema: { params: treasuryAccountParamSchema, querystring: treasuryMovementsQuerySchema } }, async (req) =>
    ok(await treasury.listMovements(req.hotelId, req.params.treasuryAccountId, req.query)),
  );

  /* ── Fiş ── */
  app.get('/vouchers', { ...view, schema: { querystring: voucherListQuerySchema } }, async (req) => ok(await vouchers.listVouchers(req.hotelId, req.query)));
  app.post('/vouchers', { ...manage, schema: { body: voucherCreateSchema } }, async (req, reply) => {
    const result = await vouchers.createVoucher(req.hotelId, req.body);
    return reply.status(result.created ? 201 : 200).send(ok(result));
  });
  app.post('/vouchers/opening', { ...setup, schema: { body: openingBalanceSchema } }, async (req, reply) => {
    const result = await vouchers.createOpening(req.hotelId, req.body);
    return reply.status(result.created ? 201 : 200).send(ok(result));
  });
  app.get('/vouchers/:voucherId', { ...view, schema: { params: voucherParamSchema } }, async (req) => ok(await vouchers.getVoucher(req.hotelId, req.params.voucherId)));
  app.post('/vouchers/:voucherId/void', { ...setup, schema: { params: voucherParamSchema, body: voucherVoidSchema } }, async (req) =>
    ok(await vouchers.voidVoucher(req.hotelId, req.params.voucherId, req.body)),
  );

  /* ── Çek / senet ── */
  app.get('/instruments', { ...view, schema: { querystring: instrumentListQuerySchema } }, async (req) => ok(await instruments.listInstruments(req.hotelId, req.query)));
  app.get('/instruments/:instrumentId', { ...view, schema: { params: instrumentParamSchema } }, async (req) => ok(await instruments.getInstrument(req.hotelId, req.params.instrumentId)));
  app.post('/instruments/:instrumentId/actions', { ...manage, schema: { params: instrumentParamSchema, body: instrumentActionSchema } }, async (req) =>
    ok(await instruments.applyInstrumentAction(req.hotelId, req.params.instrumentId, req.body)),
  );

  /* ── Ayar, eşleme, eşitleme ── */
  app.get('/settings', view, async (req) => ok(await treasury.getSettings(req.hotelId)));
  app.put('/settings', { ...setup, schema: { body: accountingSettingsSchema } }, async (req) => ok(await treasury.saveSettings(req.hotelId, req.body)));
  app.put('/settings/mappings', { ...setup, schema: { body: treasuryMappingSchema } }, async (req) => ok(await treasury.saveMappings(req.hotelId, req.body)));
  app.post('/sync', { ...manage, schema: { body: accountingSyncSchema } }, async (req) => ok(await postings.syncPeriod(req.hotelId, req.body)));
}
