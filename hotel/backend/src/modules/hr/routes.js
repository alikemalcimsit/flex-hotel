import {
  EMPLOYEE_DOCUMENT_BODY_LIMIT,
  employeeDocumentListQuerySchema,
  employeeDocumentParamSchema,
  employeeDocumentSchema,
  hrEmployeeParamSchema,
  hrSettingsSchema,
  leaveAdjustmentSchema,
  leaveBalanceAsOfSchema,
  leaveBalanceQuerySchema,
  leaveCancelSchema,
  leaveCreateSchema,
  leaveListQuerySchema,
  leaveParamSchema,
  shiftBatchSchema,
  shiftCopyWeekSchema,
  shiftListQuerySchema,
  timesheetBatchSchema,
  timesheetExportSchema,
  timesheetListQuerySchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import { prisma } from './shared.js';
import * as documents from './documents.js';
import * as leaves from './leaves.js';
import { getMyHr } from './me.js';
import * as settings from './settings.js';
import * as shifts from './shifts.js';
import * as timesheets from './timesheets.js';

/**
 * İK route'ları (modül 52), `/hr` altında.
 *
 * - Görmek (bütün personel): `hr.view`. Yazmak (onay / iptal, personel adına talep, bakiye düzeltmesi, çizelge, puantaj,
 *   bordroya aktarım, belge, ayar): `hr.manage`. İzin onayı onay kuyruğundan (`approvals.decide`, isteyen onaylayamaz).
 * - Kendi sayfası (`/me`): `hr.self` — kullanıcı hesabı personel kartına bağlı olmalı.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function hrRoutes(app) {
  const guard = (permission) => ({ preValidation: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.HR_VIEW);
  const manage = guard(PERMISSIONS.HR_MANAGE);
  const self = guard(PERMISSIONS.HR_SELF);
  const selfOrManage = { preValidation: [withHotelContext, requireAnyPermission(PERMISSIONS.HR_SELF, PERMISSIONS.HR_MANAGE)] };
  const anyHr = { preValidation: [withHotelContext, requireAnyPermission(PERMISSIONS.HR_VIEW, PERMISSIONS.HR_SELF, PERMISSIONS.HR_MANAGE)] };
  const has = (req, permission) => Boolean(req.auth?.permissions?.includes(permission));
  const ok = (data) => ({ success: true, data });

  /* ── Kendi sayfam ── */
  app.get('/me', self, async (req) => ok(await getMyHr(req.hotelId, req.auth.userId)));
  app.post('/me/leaves', { ...self, schema: { body: leaveCreateSchema } }, async (req, reply) => reply.status(201).send(ok(await leaves.createLeave(req.hotelId, req.body, { self: true, userId: req.auth.userId }))));

  /* ── İzin ── */
  app.get('/leaves', { ...view, schema: { querystring: leaveListQuerySchema } }, async (req) => ok(await leaves.listLeaves(req.hotelId, req.query)));
  app.post('/leaves', { ...manage, schema: { body: leaveCreateSchema } }, async (req, reply) => reply.status(201).send(ok(await leaves.createLeave(req.hotelId, req.body, { canManage: true, userId: req.auth.userId }))));
  app.get('/leaves/:leaveId', { ...view, schema: { params: leaveParamSchema } }, async (req) => ok(await leaves.getLeave(req.hotelId, req.params.leaveId)));
  app.post('/leaves/:leaveId/cancel', { ...selfOrManage, schema: { params: leaveParamSchema, body: leaveCancelSchema } }, async (req) =>
    ok(await leaves.cancelLeave(req.hotelId, req.params.leaveId, req.body, { userId: req.auth.userId, canManage: has(req, PERMISSIONS.HR_MANAGE) })),
  );
  app.get('/leave-balances', { ...view, schema: { querystring: leaveBalanceQuerySchema } }, async (req) => ok(await leaves.listLeaveBalances(req.hotelId, req.query)));
  app.get('/employees/:employeeId/leave-balance', { ...view, schema: { params: hrEmployeeParamSchema, querystring: leaveBalanceAsOfSchema } }, async (req) => ok(await leaves.getLeaveBalance(req.hotelId, req.params.employeeId, req.query)));
  app.post('/leave-adjustments', { ...manage, schema: { body: leaveAdjustmentSchema } }, async (req, reply) => reply.status(201).send(ok(await leaves.addLeaveAdjustment(req.hotelId, req.body))));

  /* ── Vardiya ── */
  app.get('/shifts', { ...view, schema: { querystring: shiftListQuerySchema } }, async (req) => ok(await shifts.listShifts(req.hotelId, req.query)));
  app.put('/shifts', { ...manage, schema: { body: shiftBatchSchema } }, async (req) => ok(await shifts.saveShifts(req.hotelId, req.body)));
  app.post('/shifts/copy-week', { ...manage, schema: { body: shiftCopyWeekSchema } }, async (req) => ok(await shifts.copyWeek(req.hotelId, req.body)));

  /* ── Puantaj ── */
  app.get('/timesheets', { ...view, schema: { querystring: timesheetListQuerySchema } }, async (req) => ok(await timesheets.listTimesheets(req.hotelId, req.query)));
  app.put('/timesheets', { ...manage, schema: { body: timesheetBatchSchema } }, async (req) => ok(await timesheets.saveTimesheets(req.hotelId, req.body)));
  app.post('/timesheets/export-payroll', { ...manage, schema: { body: timesheetExportSchema } }, async (req) => ok(await timesheets.exportToPayroll(req.hotelId, req.body)));

  /* ── Belgeler ── */
  app.get('/documents', { ...view, schema: { querystring: employeeDocumentListQuerySchema } }, async (req) => ok(await documents.listDocuments(req.hotelId, req.query)));
  app.post('/employees/:employeeId/documents', { ...manage, bodyLimit: EMPLOYEE_DOCUMENT_BODY_LIMIT, schema: { params: hrEmployeeParamSchema, body: employeeDocumentSchema } }, async (req, reply) =>
    reply.status(201).send(ok(await documents.addDocument(req.hotelId, req.params.employeeId, req.body))),
  );
  app.get('/documents/:documentId/file', { ...view, schema: { params: employeeDocumentParamSchema } }, async (req, reply) => {
    const file = await documents.openDocument(req.hotelId, req.params.documentId);
    return reply
      .header('Content-Type', file.contentType)
      .header('Content-Length', String(file.size))
      .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
      .header('Cache-Control', 'private, no-store')
      .send(file.stream);
  });
  app.delete('/documents/:documentId', { ...manage, schema: { params: employeeDocumentParamSchema } }, async (req) => ok(await documents.removeDocument(req.hotelId, req.params.documentId)));

  /* ── Personel kartı için kullanıcı hesabı seçenekleri (kart ↔ hesap bağı; `employees.manage`) ── */
  app.get('/user-options', guard(PERMISSIONS.EMPLOYEES_MANAGE), async (req) => {
    const [users, linked] = await Promise.all([
      prisma.user.findMany({ where: { hotelId: req.hotelId, isActive: true }, select: { id: true, name: true, email: true, role: true }, orderBy: { name: 'asc' }, take: 500 }),
      prisma.employee.findMany({ where: { hotelId: req.hotelId, userId: { not: null } }, select: { id: true, userId: true } }),
    ]);
    const byUser = new Map(linked.map((row) => [row.userId, row.id]));
    return ok({ items: users.map((user) => ({ ...user, employeeId: byUser.get(user.id) ?? null })) });
  });

  /* ── Ayar ── */
  app.get('/settings', anyHr, async (req) => ok(await settings.getHrSettings(req.hotelId)));
  app.put('/settings', { ...manage, schema: { body: hrSettingsSchema } }, async (req) => ok(await settings.saveHrSettings(req.hotelId, req.body)));
}
