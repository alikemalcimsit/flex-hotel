import {
  advanceSchema,
  attendanceBatchSchema,
  departmentSchema,
  employeeCreateSchema,
  employeeListQuerySchema,
  employeeParamSchema,
  employeeUpdateSchema,
  garnishmentSchema,
  incentiveSchema,
  payElementSchema,
  payrollEntryListQuerySchema,
  payrollItemSchema,
  payrollMonthQuerySchema,
  payrollOpeningSchema,
  payrollParameterSetSchema,
  payrollPaySchema,
  payrollPdfQuerySchema,
  payrollRunCreateSchema,
  payrollRunListQuerySchema,
  payrollRunParamSchema,
  payrollSettingsSchema,
  serviceChargeSchema,
  terminationSchema,
} from '@hotelos/hotel-contracts';
import { z } from 'zod';
import { PERMISSIONS, assertRequestPermission, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as employees from './employees.js';
import * as inputs from './inputs.js';
import { renderPayrollPdf } from './pdf.js';
import * as runs from './runs.js';
import * as setup from './setup.js';

/**
 * Personel ve bordro route'ları (modül 51), `/payroll` altında.
 *
 * - Personel listesi / kartı: `employees.view` ya da `payroll.view`; ücret, IBAN, avans, icra yalnız `payroll.view`
 *   ile döner, kimlik numarası `employees.manage` / `payroll.view` yoksa maskeli.
 * - Kart: `employees.manage`; ücret alanlarını yazmak ayrıca `payroll.manage` ister (yoksa yok sayılır).
 * - Çıkış hakları, teşvik, matrah devri, avans, icra, puantaj, kalemler, servis payı, bordro hesap / onaya gönderme:
 *   `payroll.manage`. Kasadan / bankadan avans ve maaş ödemesi: `payroll.pay`.
 * - Yasal parametreler (teyit), kalemler, departmanlar, işyeri: `payroll.setup`.
 *
 * Bordroyu onaylamak onay kuyruğunun işidir (`approvals.decide`; hazırlayan onaylayamaz).
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function payrollRoutes(app) {
  const guard = (permission) => ({ preValidation: [withHotelContext, requirePermission(permission)] });
  const any = (...permissions) => ({ preValidation: [withHotelContext, requireAnyPermission(...permissions)] });
  const has = (req, permission) => Boolean(req.auth?.permissions?.includes(permission));
  const ok = (data) => ({ success: true, data });
  const created = (reply, data) => reply.status(201).send(ok(data));

  const peopleView = any(PERMISSIONS.EMPLOYEES_VIEW, PERMISSIONS.PAYROLL_VIEW);
  const peopleManage = guard(PERMISSIONS.EMPLOYEES_MANAGE);
  const view = guard(PERMISSIONS.PAYROLL_VIEW);
  const manage = guard(PERMISSIONS.PAYROLL_MANAGE);
  const pay = guard(PERMISSIONS.PAYROLL_PAY);
  const setupGuard = guard(PERMISSIONS.PAYROLL_SETUP);
  const visibility = (req) => ({ withPay: has(req, PERMISSIONS.PAYROLL_VIEW), withFullId: has(req, PERMISSIONS.EMPLOYEES_MANAGE) || has(req, PERMISSIONS.PAYROLL_VIEW) });

  const idParam = (key) => z.object({ [key]: z.string().uuid({ message: 'Geçersiz kayıt' }) });
  const reasonBody = z.object({ reason: z.string().trim().min(3, 'Gerekçe yazın').max(300) });
  const periodQuery = z.object({ year: z.coerce.number().int().min(2024).max(2100), month: z.coerce.number().int().min(1).max(12) });

  /* ── Personel ── */
  app.get('/employees', { ...peopleView, schema: { querystring: employeeListQuerySchema } }, async (req) => ok(await employees.listEmployees(req.hotelId, req.query, visibility(req))));
  app.get('/employees/:employeeId', { ...peopleView, schema: { params: employeeParamSchema } }, async (req) => ok(await employees.getEmployee(req.hotelId, req.params.employeeId, visibility(req))));
  app.post('/employees', { ...peopleManage, schema: { body: employeeCreateSchema } }, async (req, reply) => created(reply, await employees.createEmployee(req.hotelId, req.body, { withPay: has(req, PERMISSIONS.PAYROLL_MANAGE) })));
  app.put('/employees/:employeeId', { ...peopleManage, schema: { params: employeeParamSchema, body: employeeUpdateSchema } }, async (req) =>
    ok(await employees.updateEmployee(req.hotelId, req.params.employeeId, req.body, { withPay: has(req, PERMISSIONS.PAYROLL_MANAGE) })),
  );
  app.delete('/employees/:employeeId', { ...peopleManage, schema: { params: employeeParamSchema } }, async (req) => ok(await employees.deleteEmployee(req.hotelId, req.params.employeeId)));

  app.post('/employees/:employeeId/termination/preview', { ...manage, schema: { params: employeeParamSchema, body: terminationSchema } }, async (req) => {
    assertRequestPermission(req, PERMISSIONS.EMPLOYEES_MANAGE, 'İşten çıkış personel yönetimi izni ister');
    return ok(await employees.previewTermination(req.hotelId, req.params.employeeId, req.body));
  });
  app.post('/employees/:employeeId/termination', { ...manage, schema: { params: employeeParamSchema, body: terminationSchema } }, async (req) => {
    assertRequestPermission(req, PERMISSIONS.EMPLOYEES_MANAGE, 'İşten çıkış personel yönetimi izni ister');
    return ok(await employees.terminateEmployee(req.hotelId, req.params.employeeId, req.body));
  });
  app.delete('/employees/:employeeId/termination', { ...manage, schema: { params: employeeParamSchema } }, async (req) => {
    assertRequestPermission(req, PERMISSIONS.EMPLOYEES_MANAGE, 'Çıkışı geri almak personel yönetimi izni ister');
    return ok(await employees.reinstateEmployee(req.hotelId, req.params.employeeId));
  });

  app.post('/employees/:employeeId/incentives', { ...manage, schema: { params: employeeParamSchema, body: incentiveSchema } }, async (req, reply) => created(reply, await employees.addIncentive(req.hotelId, req.params.employeeId, req.body)));
  app.delete('/employees/:employeeId/incentives/:incentiveId', { ...manage, schema: { params: employeeParamSchema.extend({ incentiveId: z.string().uuid() }) } }, async (req) =>
    ok(await employees.removeIncentive(req.hotelId, req.params.employeeId, req.params.incentiveId)),
  );
  app.put('/openings', { ...manage, schema: { body: payrollOpeningSchema } }, async (req) => ok(await employees.saveOpening(req.hotelId, req.body)));

  app.post('/employees/:employeeId/advances', { ...manage, schema: { params: employeeParamSchema, body: advanceSchema } }, async (req, reply) => {
    if (req.body.treasuryAccountId) assertRequestPermission(req, PERMISSIONS.PAYROLL_PAY, 'Kasadan / bankadan avans ödemek ödeme izni ister');
    return created(reply, await inputs.createAdvance(req.hotelId, req.params.employeeId, req.body));
  });
  app.post('/advances/:advanceId/cancel', { ...manage, schema: { params: idParam('advanceId'), body: reasonBody } }, async (req) => ok(await inputs.cancelAdvance(req.hotelId, req.params.advanceId, req.body.reason)));
  app.post('/employees/:employeeId/garnishments', { ...manage, schema: { params: employeeParamSchema, body: garnishmentSchema } }, async (req, reply) => created(reply, await inputs.createGarnishment(req.hotelId, req.params.employeeId, req.body)));
  app.post('/garnishments/:garnishmentId/cancel', { ...manage, schema: { params: idParam('garnishmentId'), body: reasonBody } }, async (req) => ok(await inputs.cancelGarnishment(req.hotelId, req.params.garnishmentId, req.body.reason)));

  /* ── Departman ── */
  app.get('/departments', peopleView, async (req) => ok(await employees.listDepartments(req.hotelId)));
  app.post('/departments', { ...setupGuard, schema: { body: departmentSchema } }, async (req, reply) => created(reply, await employees.saveDepartment(req.hotelId, req.body)));
  app.put('/departments/:departmentId', { ...setupGuard, schema: { params: idParam('departmentId'), body: departmentSchema } }, async (req) => ok(await employees.saveDepartment(req.hotelId, req.body, req.params.departmentId)));

  /* ── Puantaj, kalemler, servis payı ── */
  app.get('/attendance', { ...view, schema: { querystring: payrollMonthQuerySchema } }, async (req) => ok(await inputs.listAttendance(req.hotelId, req.query)));
  app.put('/attendance', { ...manage, schema: { querystring: periodQuery, body: attendanceBatchSchema } }, async (req) => ok(await inputs.saveAttendance(req.hotelId, req.query.year, req.query.month, req.body.rows)));
  app.get('/items', { ...view, schema: { querystring: payrollMonthQuerySchema } }, async (req) => ok(await inputs.listItems(req.hotelId, req.query)));
  app.post('/items', { ...manage, schema: { body: payrollItemSchema } }, async (req, reply) => created(reply, await inputs.createItem(req.hotelId, req.body)));
  app.delete('/items/:itemId', { ...manage, schema: { params: idParam('itemId') } }, async (req) => ok(await inputs.deleteItem(req.hotelId, req.params.itemId)));
  app.get('/service-charge', { ...view, schema: { querystring: periodQuery } }, async (req) => ok(await inputs.getServiceCharge(req.hotelId, req.query.year, req.query.month)));
  app.put('/service-charge', { ...manage, schema: { body: serviceChargeSchema } }, async (req) => ok(await inputs.distributeServiceCharge(req.hotelId, req.body)));
  app.delete('/service-charge', { ...manage, schema: { querystring: periodQuery } }, async (req) => ok(await inputs.undoServiceCharge(req.hotelId, req.query.year, req.query.month)));

  /* ── Bordro ── */
  app.get('/runs', { ...view, schema: { querystring: payrollRunListQuerySchema } }, async (req) => ok(await runs.listRuns(req.hotelId, req.query)));
  app.post('/runs', { ...manage, schema: { body: payrollRunCreateSchema } }, async (req, reply) => created(reply, await runs.createRun(req.hotelId, req.body)));
  app.get('/runs/:runId', { ...view, schema: { params: payrollRunParamSchema } }, async (req) => ok(await runs.getRun(req.hotelId, req.params.runId)));
  app.delete('/runs/:runId', { ...manage, schema: { params: payrollRunParamSchema } }, async (req) => ok(await runs.deleteRun(req.hotelId, req.params.runId)));
  app.post('/runs/:runId/calculate', { ...manage, schema: { params: payrollRunParamSchema } }, async (req) => ok(await runs.calculateRun(req.hotelId, req.params.runId)));
  app.post('/runs/:runId/submit', { ...manage, schema: { params: payrollRunParamSchema } }, async (req) => ok(await runs.submitRun(req.hotelId, req.params.runId)));
  app.post('/runs/:runId/pay', { ...pay, schema: { params: payrollRunParamSchema, body: payrollPaySchema } }, async (req) => ok(await runs.payRun(req.hotelId, req.params.runId, req.body)));
  app.get('/runs/:runId/entries', { ...view, schema: { params: payrollRunParamSchema, querystring: payrollEntryListQuerySchema } }, async (req) => ok(await runs.listEntries(req.hotelId, req.params.runId, req.query)));
  app.get('/runs/:runId/entries/:entryId', { ...view, schema: { params: payrollRunParamSchema.extend({ entryId: z.string().uuid() }) } }, async (req) => ok(await runs.getEntry(req.hotelId, req.params.runId, req.params.entryId)));
  app.get('/runs/:runId/export', { ...view, schema: { params: payrollRunParamSchema, querystring: z.object({ kind: z.enum(['BANK', 'ACCOUNTANT']) }) } }, async (req) => ok(await runs.exportRows(req.hotelId, req.params.runId, req.query.kind)));
  app.get('/runs/:runId/pdf', { ...view, schema: { params: payrollRunParamSchema, querystring: payrollPdfQuerySchema } }, async (req, reply) => {
    const buffer = await renderPayrollPdf(req.hotelId, req.params.runId, req.query);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Length', buffer.length)
      .header('Content-Disposition', `inline; filename="bordro-${req.query.kind === 'PAYSLIPS' ? 'pusula' : 'liste'}.pdf"`)
      .header('Cache-Control', 'private, no-store')
      .send(buffer);
  });

  /* ── Ayarlar ── */
  app.get('/settings', view, async (req) => ok(await setup.getPayrollSettings(req.hotelId)));
  app.put('/settings', { ...setupGuard, schema: { body: payrollSettingsSchema } }, async (req) => ok(await setup.savePayrollSettings(req.hotelId, req.body)));
  app.get('/parameters', view, async (req) => ok(await setup.listParameterSets(req.hotelId)));
  app.post('/parameters/catalog', { ...setupGuard, schema: { body: z.object({ keys: z.array(z.string().max(20)).max(20).optional().nullable() }) } }, async (req) => ok(await setup.loadCatalogSets(req.hotelId, req.body.keys ?? null)));
  app.post('/parameters', { ...setupGuard, schema: { body: payrollParameterSetSchema } }, async (req, reply) => created(reply, await setup.saveParameterSet(req.hotelId, req.body)));
  app.put('/parameters/:setId', { ...setupGuard, schema: { params: idParam('setId'), body: payrollParameterSetSchema } }, async (req) => ok(await setup.saveParameterSet(req.hotelId, req.body, req.params.setId)));
  app.post('/parameters/:setId/verify', { ...setupGuard, schema: { params: idParam('setId'), body: z.object({ verified: z.boolean() }) } }, async (req) => ok(await setup.verifyParameterSet(req.hotelId, req.params.setId, req.body.verified)));
  app.delete('/parameters/:setId', { ...setupGuard, schema: { params: idParam('setId') } }, async (req) => ok(await setup.deleteParameterSet(req.hotelId, req.params.setId)));
  app.get('/elements', any(PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_MANAGE), async (req) => ok(await setup.listPayElements(req.hotelId)));
  app.post('/elements', { ...setupGuard, schema: { body: payElementSchema } }, async (req, reply) => created(reply, await setup.savePayElement(req.hotelId, req.body)));
  app.put('/elements/:elementId', { ...setupGuard, schema: { params: idParam('elementId'), body: payElementSchema } }, async (req) => ok(await setup.savePayElement(req.hotelId, req.body, req.params.elementId)));
}
