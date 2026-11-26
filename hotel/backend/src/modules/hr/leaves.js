import { currentActor, runWithContext } from '@hotelos/core';
import { LEAVE_TYPE_LABELS, LEAVE_TYPE_MAX_DAYS, addDaysIso, annualLeaveAccruals, annualLeaveBalance, countLeaveDays, rangesOverlap } from '@hotelos/hotel-contracts';
import { prismaUnfiltered } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { writeWithEvents } from '../../lib/write.js';
import { requestApproval } from '../approvals/service.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { assertMonthOpen } from '../payroll/shared.js';
import { EMPLOYEE_SELECT, dateOnly, day, dotted, employeeView, fullName, hrContext, iso, prisma, requireEmployee, requireOwnEmployee } from './shared.js';

/**
 * İzin (modül 52): talep, onay kararı, iptal, bakiye.
 *
 * - Talep: personel kendi adına (`hr.self`, kullanıcı hesabı karta bağlı) ya da İK personel adına. Çakışan izin, yasal süre
 *   üstü (evlilik 3, vefat 3, babalık 5 iş günü) ve yetersiz yıllık izin bakiyesi reddedilir.
 * - Onay: ayar onay istiyorsa `LEAVE` onayı açılır (dört göz; süresiz bekler); İK'nın girdiği izin ayar kapalıysa doğrudan
 *   onaylı. Karar personelin kullanıcısına ve İK'ya zil (`HR`).
 * - İptal: beklemede isteyen ya da İK; onaylı yalnız İK ve izin günlerinin ayı kilitli bordroya girmemişse.
 * - Bakiye (yıllık izin): yıl dönümlerinde doğan hak + elle düzeltme − onaylı yıllık izin; bakiye tarihi (`asOf`) itibarıyla.
 */

/** Personelin kendi talebi en fazla bu kadar gün geriye girilir (daha eskisi İK'dan). */
const SELF_BACKDATE_DAYS = 30;

export const LEAVE_SELECT = Object.freeze({
  id: true,
  employeeId: true,
  type: true,
  status: true,
  startDate: true,
  endDate: true,
  days: true,
  reason: true,
  requestedBy: true,
  requestedAt: true,
  approvalId: true,
  decidedBy: true,
  decidedAt: true,
  decisionNote: true,
  cancelledBy: true,
  cancelledAt: true,
  cancelReason: true,
  updatedAt: true,
  employee: { select: EMPLOYEE_SELECT },
});

/** @param {any} row */
export const leaveView = (row) => ({
  id: row.id,
  employee: employeeView(row.employee),
  type: row.type,
  typeLabel: LEAVE_TYPE_LABELS[row.type],
  status: row.status,
  startDate: day(row.startDate),
  endDate: day(row.endDate),
  days: Number(row.days),
  reason: row.reason,
  requestedBy: row.requestedBy,
  requestedAt: iso(row.requestedAt),
  approvalId: row.approvalId,
  decidedBy: row.decidedBy,
  decidedAt: iso(row.decidedAt),
  decisionNote: row.decisionNote,
  cancelledBy: row.cancelledBy,
  cancelledAt: iso(row.cancelledAt),
  cancelReason: row.cancelReason,
  updatedAt: iso(row.updatedAt),
});

/* ─────────────── Bakiye ─────────────── */

/**
 * Personelin yıllık izin bakiyesi (bir gün itibarıyla).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {{ id: string, hireDate: Date, birthDate: Date | null, terminationDate: Date | null }} employee @param {string} asOf
 */
export async function balanceOf(client, employee, asOf) {
  const [adjustments, used] = await Promise.all([
    client.leaveAdjustment.findMany({ where: { employeeId: employee.id, effectiveOn: { lte: dateOnly(asOf) } }, select: { days: true } }),
    // Onaylı yıllık izinlerin tamamı bakiyeden düşer (ileri tarihli olsa da yer ayrılmıştır); haklar `asOf` ile sınırlıdır.
    client.leave.findMany({ where: { employeeId: employee.id, type: 'ANNUAL', status: 'APPROVED' }, select: { days: true } }),
  ]);
  const accruals = annualLeaveAccruals({ hireDate: /** @type {string} */ (day(employee.hireDate)), birthDate: day(employee.birthDate), asOf, terminationDate: day(employee.terminationDate) });
  return { asOf, accruals, ...annualLeaveBalance({ accruals, adjustments: adjustments.map((row) => ({ days: String(row.days) })), used: used.map((row) => ({ days: String(row.days) })) }) };
}

/** @param {string} hotelId @param {string} employeeId @param {{ asOf?: string }} [query] */
export async function getLeaveBalance(hotelId, employeeId, query = {}) {
  const context = await hrContext(hotelId);
  const employee = await requireEmployee(prisma, hotelId, employeeId);
  const asOf = query.asOf ?? context.today;
  const [balance, adjustments, pending] = await Promise.all([
    balanceOf(prisma, employee, asOf),
    prisma.leaveAdjustment.findMany({ where: { employeeId }, orderBy: { effectiveOn: 'desc' }, take: 50, select: { id: true, days: true, effectiveOn: true, reason: true, createdBy: true, createdAt: true } }),
    prisma.leave.aggregate({ where: { employeeId, type: 'ANNUAL', status: 'PENDING' }, _sum: { days: true } }),
  ]);
  return {
    employee: employeeView(employee),
    ...balance,
    pendingDays: Number(pending._sum.days ?? 0),
    adjustments: adjustments.map((row) => ({ id: row.id, days: Number(row.days), effectiveOn: day(row.effectiveOn), reason: row.reason, createdBy: row.createdBy, createdAt: iso(row.createdAt) })),
  };
}

/**
 * Bütün aktif personelin bakiyesi (sayfalı). Her personel için üç küçük sorgu yerine toplamlar iki sorguyla okunur.
 * @param {string} hotelId @param {{ page: number, pageSize: number, asOf?: string, departmentId?: string, search?: string }} query
 */
export async function listLeaveBalances(hotelId, query) {
  const context = await hrContext(hotelId);
  const asOf = query.asOf ?? context.today;
  const where = {
    hotelId,
    status: 'ACTIVE',
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.search ? { OR: [{ firstName: { contains: query.search, mode: 'insensitive' } }, { lastName: { contains: query.search, mode: 'insensitive' } }, { code: { contains: query.search, mode: 'insensitive' } }] } : {}),
  };
  const [rows, total] = await Promise.all([prisma.employee.findMany({ where, select: EMPLOYEE_SELECT, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], ...toSkipTake(query) }), prisma.employee.count({ where })]);
  const ids = rows.map((row) => row.id);
  const [adjustments, used, pending] = await Promise.all([
    prisma.leaveAdjustment.groupBy({ by: ['employeeId'], where: { employeeId: { in: ids }, effectiveOn: { lte: dateOnly(asOf) } }, _sum: { days: true } }),
    prisma.leave.groupBy({ by: ['employeeId'], where: { employeeId: { in: ids }, type: 'ANNUAL', status: 'APPROVED' }, _sum: { days: true } }),
    prisma.leave.groupBy({ by: ['employeeId'], where: { employeeId: { in: ids }, type: 'ANNUAL', status: 'PENDING' }, _sum: { days: true } }),
  ]);
  const sumOf = (list, id) => Number(list.find((row) => row.employeeId === id)?._sum.days ?? 0);
  const items = rows.map((employee) => {
    const accruals = annualLeaveAccruals({ hireDate: /** @type {string} */ (day(employee.hireDate)), birthDate: day(employee.birthDate), asOf, terminationDate: day(employee.terminationDate) });
    const balance = annualLeaveBalance({ accruals, adjustments: [{ days: sumOf(adjustments, employee.id) }], used: [{ days: sumOf(used, employee.id) }] });
    return { employee: employeeView(employee), ...balance, pendingDays: sumOf(pending, employee.id), nextAccrualOn: nextAccrual(/** @type {string} */ (day(employee.hireDate)), asOf) };
  });
  return { ...buildPage(items, total, query), asOf };
}

/** Bir sonraki yıl dönümü (hak doğacak gün). @param {string} hireDate @param {string} asOf */
function nextAccrual(hireDate, asOf) {
  const date = new Date(`${hireDate}T00:00:00.000Z`);
  const year = Number(asOf.slice(0, 4));
  const candidate = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
  if (candidate.toISOString().slice(0, 10) > asOf) return candidate.toISOString().slice(0, 10);
  return new Date(Date.UTC(year + 1, date.getUTCMonth(), date.getUTCDate())).toISOString().slice(0, 10);
}

/**
 * Elle bakiye düzeltmesi (devir izin, ek izin, kesinti).
 * @param {string} hotelId @param {{ employeeId: string, days: string, effectiveOn: string, reason: string }} input
 */
export async function addLeaveAdjustment(hotelId, input) {
  const employee = await requireEmployee(prisma, hotelId, input.employeeId);
  const created = await writeWithEvents(async (tx, stage) => {
    const row = await tx.leaveAdjustment.create({ data: { hotelId, employeeId: employee.id, days: input.days, effectiveOn: dateOnly(input.effectiveOn), reason: input.reason, createdBy: currentActor() } });
    await recordAudit(tx, { hotelId, entity: 'LeaveAdjustment', entityId: row.id, action: 'CREATE', after: { employeeId: employee.id, days: input.days, effectiveOn: input.effectiveOn, reason: input.reason } });
    await stage('hr.changed', { hotelId, area: 'LEAVE_BALANCE' });
    return row;
  });
  return { adjustment: { id: created.id, days: Number(created.days), effectiveOn: day(created.effectiveOn), reason: created.reason }, balance: await getLeaveBalance(hotelId, employee.id) };
}

/* ─────────────── Liste / tekil ─────────────── */

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, from?: string, to?: string, status?: string, type?: string, employeeId?: string, departmentId?: string, search?: string }} query
 */
export async function listLeaves(hotelId, query) {
  const where = {
    hotelId,
    ...(query.status ? { status: /** @type {any} */ (query.status) } : {}),
    ...(query.type ? { type: /** @type {any} */ (query.type) } : {}),
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.from ? { endDate: { gte: dateOnly(query.from) } } : {}),
    ...(query.to ? { startDate: { lte: dateOnly(query.to) } } : {}),
    ...(query.departmentId || query.search
      ? {
          employee: {
            ...(query.departmentId ? { departmentId: query.departmentId } : {}),
            ...(query.search ? { OR: [{ firstName: { contains: query.search, mode: 'insensitive' } }, { lastName: { contains: query.search, mode: 'insensitive' } }, { code: { contains: query.search, mode: 'insensitive' } }] } : {}),
          },
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.leave.findMany({ where, select: LEAVE_SELECT, orderBy: [{ startDate: 'desc' }, { requestedAt: 'desc' }], ...toSkipTake(query) }),
    prisma.leave.count({ where }),
  ]);
  return buildPage(rows.map(leaveView), total, query);
}

/** @param {string} hotelId @param {string} leaveId */
export async function getLeave(hotelId, leaveId) {
  const row = await prisma.leave.findFirst({ where: { id: leaveId, hotelId }, select: LEAVE_SELECT });
  if (!row) throw new NotFoundError('İzin bulunamadı');
  return leaveView(row);
}

/* ─────────────── Talep ─────────────── */

/**
 * İzin talebi. `self` doğruysa oturumdaki kullanıcının personel kartı; değilse `input.employeeId`.
 * @param {string} hotelId @param {{ employeeId: string | null, type: string, startDate: string, endDate: string, reason: string | null }} input
 * @param {{ self?: boolean, userId?: string | null, canManage?: boolean }} [options]
 */
export async function createLeave(hotelId, input, { self = false, userId = null, canManage = false } = {}) {
  const context = await hrContext(hotelId);
  const employee = self ? await requireOwnEmployee(hotelId, userId) : await requireEmployee(prisma, hotelId, /** @type {string} */ (input.employeeId));
  if (!self && !input.employeeId) throw new ValidationError('Personel seçin', { fields: { employeeId: 'Personel seçin' } });
  if (employee.status !== 'ACTIVE') throw new ConflictError('İşten ayrılmış personele izin girilemez', 'EMPLOYEE_INACTIVE');
  const hireDate = /** @type {string} */ (day(employee.hireDate));
  if (input.startDate < hireDate) throw new ValidationError(`İzin işe giriş gününden (${dotted(hireDate)}) önce başlayamaz`, { fields: { startDate: 'İşe girişten önce' } });
  const exit = day(employee.terminationDate);
  if (exit && input.endDate > exit) throw new ValidationError(`İzin çıkış gününden (${dotted(exit)}) sonraya uzanamaz`, { fields: { endDate: 'Çıkıştan sonra' } });
  if (self && input.startDate < addDaysIso(context.today, -SELF_BACKDATE_DAYS)) throw new ValidationError(`Kendi izin talebiniz en fazla ${SELF_BACKDATE_DAYS} gün geriye girilir; daha eskisi için İK'ya başvurun`, { fields: { startDate: 'Çok eski' } });
  const days = countLeaveDays({ type: input.type, startDate: input.startDate, endDate: input.endDate, weeklyRestDay: context.settings.weeklyRestDay, holidays: context.settings.holidaySet });
  if (days <= 0) throw new ValidationError('Seçilen aralıkta iş günü yok (hafta tatili / resmî tatil)', { fields: { endDate: 'İş günü yok' } });
  const limit = LEAVE_TYPE_MAX_DAYS[input.type];
  if (limit && days > limit) throw new ValidationError(`${LEAVE_TYPE_LABELS[input.type]} en fazla ${limit} iş günü`, { fields: { endDate: `En fazla ${limit} gün` } });
  // Kendi kartına giriş hiçbir zaman doğrudan onaylı olmaz (dört göz).
  const ownCard = Boolean(userId) && employee.userId === userId;
  const direct = canManage && !self && !ownCard && !context.settings.leaveApprovalRequired;
  const actor = currentActor();
  const leave = await writeWithEvents(async (tx, stage) => {
    // Aynı personelin izinleri sıralansın (çift talep yarışı): personel satırı kilidi.
    await tx.$executeRaw`SELECT "id" FROM "Employee" WHERE "id" = ${employee.id} FOR UPDATE`;
    // Onaylı / onaydaki bordro ayına izin girilmez (puantaj o ay kesinleşti; düzeltme fark bordrosuyla).
    for (const month of monthsOf(input.startDate, input.endDate)) await assertMonthOpen(tx, hotelId, month.year, month.month);
    const overlapping = await tx.leave.findFirst({
      where: { employeeId: employee.id, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: dateOnly(input.endDate) }, endDate: { gte: dateOnly(input.startDate) } },
      select: { startDate: true, endDate: true, type: true, status: true },
    });
    if (overlapping) throw new ConflictError(`${dotted(/** @type {string} */ (day(overlapping.startDate)))} – ${dotted(/** @type {string} */ (day(overlapping.endDate)))} arasında ${LEAVE_TYPE_LABELS[overlapping.type].toLocaleLowerCase('tr-TR')} kaydı var (${overlapping.status === 'PENDING' ? 'onay bekliyor' : 'onaylı'})`, 'LEAVE_OVERLAP');
    let balance = null;
    if (input.type === 'ANNUAL') {
      balance = await balanceOf(tx, employee, input.endDate);
      const pending = await tx.leave.aggregate({ where: { employeeId: employee.id, type: 'ANNUAL', status: 'PENDING' }, _sum: { days: true } });
      const available = balance.balance - Number(pending._sum.days ?? 0);
      if (available < days) throw new ConflictError(`Yıllık izin bakiyesi yetersiz: kullanılabilir ${available} gün, istenen ${days} gün`, 'LEAVE_BALANCE');
    }
    const row = await tx.leave.create({
      data: {
        hotelId,
        employeeId: employee.id,
        type: /** @type {any} */ (input.type),
        status: direct ? 'APPROVED' : 'PENDING',
        startDate: dateOnly(input.startDate),
        endDate: dateOnly(input.endDate),
        days: String(days),
        reason: input.reason,
        requestedBy: actor,
        ...(direct ? { decidedBy: actor, decidedAt: new Date(), decisionNote: 'İK girişi (onay gerekmez)' } : {}),
      },
      select: { id: true },
    });
    const summary = `${fullName(employee)} · ${LEAVE_TYPE_LABELS[input.type]} · ${dotted(input.startDate)} – ${dotted(input.endDate)} (${days} gün)`;
    if (!direct) {
      const { approvalId } = await requestApproval(tx, stage, {
        hotelId,
        type: 'LEAVE',
        summary: summary.slice(0, 200),
        reason: input.reason ?? null,
        data: {
          Personel: `${employee.code} ${fullName(employee)}`,
          Departman: employee.department?.name ?? '—',
          Tür: LEAVE_TYPE_LABELS[input.type],
          Tarih: `${dotted(input.startDate)} – ${dotted(input.endDate)}`,
          Gün: String(days),
          ...(balance ? { 'Kalan yıllık izin (talep sonrası)': String(Math.round((balance.balance - days) * 10) / 10) } : {}),
        },
        entityType: 'Leave',
        entityId: row.id,
        expiresInMs: null,
      });
      await tx.leave.update({ where: { id: row.id }, data: { approvalId } });
      await raiseStaffAlert(tx, stage, {
        hotelId,
        kind: 'HR',
        severity: 'INFO',
        title: `İzin talebi: ${fullName(employee)}`,
        body: `${LEAVE_TYPE_LABELS[input.type]}, ${dotted(input.startDate)} – ${dotted(input.endDate)} (${days} gün). Onay kuyruğunda.`,
        link: '/onaylar',
        permission: PERMISSIONS.HR_MANAGE,
        entityType: 'Leave',
        entityId: row.id,
        dedupeKey: `hr-leave-request:${row.id}`,
      });
    }
    await recordAudit(tx, { hotelId, entity: 'Leave', entityId: row.id, action: 'CREATE', after: { employeeId: employee.id, type: input.type, startDate: input.startDate, endDate: input.endDate, days, status: direct ? 'APPROVED' : 'PENDING' } });
    await stage('hr.leave.changed', { hotelId, leaveId: row.id, employeeId: employee.id, type: input.type, change: direct ? 'APPROVED' : 'REQUESTED', startDate: input.startDate, endDate: input.endDate });
    return row;
  });
  return getLeave(hotelId, leave.id);
}

/**
 * İptal: beklemede isteyen (kendi kartı) ya da İK; onaylı yalnız İK ve ayı kilitli değilse.
 * @param {string} hotelId @param {string} leaveId @param {{ reason: string }} input @param {{ userId?: string | null, canManage?: boolean }} options
 */
export async function cancelLeave(hotelId, leaveId, input, { userId = null, canManage = false }) {
  const row = await prisma.leave.findFirst({ where: { id: leaveId, hotelId }, select: LEAVE_SELECT });
  if (!row) throw new NotFoundError('İzin bulunamadı');
  if (row.status === 'CANCELLED' || row.status === 'REJECTED') throw new ConflictError('İzin zaten kapanmış', 'LEAVE_CLOSED');
  const own = Boolean(userId) && row.employee.userId === userId;
  if (!canManage && !(own && row.status === 'PENDING')) throw new ForbiddenError(row.status === 'APPROVED' ? 'Onaylı izni yalnız İK iptal eder' : 'Bu izni iptal etme yetkiniz yok');
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    if (row.status === 'APPROVED') {
      // Kilitli bordro ayına giren izin iptal edilemez (puantaj bordroya girmiş olabilir; düzeltme fark bordrosuyla).
      for (const month of monthsOf(/** @type {string} */ (day(row.startDate)), /** @type {string} */ (day(row.endDate)))) await assertMonthOpen(tx, hotelId, month.year, month.month);
    }
    const changed = await tx.leave.updateMany({ where: { id: leaveId, status: row.status }, data: { status: 'CANCELLED', cancelledBy: actor, cancelledAt: new Date(), cancelReason: input.reason } });
    if (changed.count !== 1) throw new ConflictError('İzin bu arada değişti; yenileyip tekrar deneyin', 'STALE_WRITE');
    if (row.status === 'PENDING' && row.approvalId) {
      // Bekleyen onay isteği artık konusuz: süresi dolmuş sayılır (karar verilemez).
      await tx.approval.updateMany({ where: { id: row.approvalId, status: 'PENDING' }, data: { status: 'EXPIRED', decidedAt: new Date(), note: `İzin talebi iptal edildi: ${input.reason}`.slice(0, 500) } });
    }
    await recordAudit(tx, { hotelId, entity: 'Leave', entityId: leaveId, action: 'UPDATE', before: { status: row.status }, after: { status: 'CANCELLED', reason: input.reason } });
    await stage('hr.leave.changed', { hotelId, leaveId, employeeId: row.employeeId, type: row.type, change: 'CANCELLED', startDate: day(row.startDate), endDate: day(row.endDate) });
    if (row.employee.userId && !own) {
      await raiseStaffAlert(tx, stage, { hotelId, kind: 'HR', severity: 'INFO', title: 'İzniniz iptal edildi', body: `${LEAVE_TYPE_LABELS[row.type]}, ${dotted(/** @type {string} */ (day(row.startDate)))} – ${dotted(/** @type {string} */ (day(row.endDate)))}: ${input.reason}`, link: '/ik/benim', userId: row.employee.userId, dedupeKey: `hr-leave-cancel:${leaveId}` });
    }
  });
  return getLeave(hotelId, leaveId);
}

/** Aralığın dokunduğu aylar. @param {string} from @param {string} to */
export function monthsOf(from, to) {
  const months = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const endYear = Number(to.slice(0, 4));
  const endMonth = Number(to.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/* ─────────────── Onay kararı ─────────────── */

/**
 * Onay kuyruğunun kararı: onaylandı → APPROVED (bakiye yeniden denetlenir), reddedildi / süresi doldu → REJECTED.
 * @param {any} payload @param {{ id: string, name: string, correlationId: string }} envelope
 */
export function onLeaveApprovalDecision(payload, envelope) {
  if (payload?.type !== 'LEAVE') return Promise.resolve({ handled: false });
  return runWithContext({ correlationId: envelope.correlationId, causationId: envelope.id, actor: payload.decidedBy ?? 'system' }, () => applyLeaveDecision(payload, envelope));
}

/** @param {any} payload @param {{ name: string }} envelope */
export async function applyLeaveDecision(payload, envelope) {
  const hotelId = payload.hotelId;
  const approval = await prismaUnfiltered.approval.findFirst({ where: { id: payload.approvalId, hotelId }, select: { id: true, entityId: true, decidedBy: true, note: true } });
  if (!approval?.entityId) return { handled: false };
  const granted = envelope.name === 'approval.granted';
  const result = await writeWithEvents(async (tx, stage) => {
    const peek = await tx.leave.findFirst({ where: { id: approval.entityId, hotelId }, select: { employeeId: true } });
    if (!peek) return { stale: true };
    // Kilit sırası talepteki gibi: personel → izin (aynı personelin iki onayı bakiyeyi birlikte aşamasın).
    await tx.$executeRaw`SELECT "id" FROM "Employee" WHERE "id" = ${peek.employeeId} AND "hotelId" = ${hotelId} FOR UPDATE`;
    await tx.$executeRaw`SELECT "id" FROM "Leave" WHERE "id" = ${approval.entityId} AND "hotelId" = ${hotelId} FOR UPDATE`;
    const row = await tx.leave.findFirst({ where: { id: approval.entityId, hotelId }, select: LEAVE_SELECT });
    if (!row || row.status !== 'PENDING' || row.approvalId !== approval.id) return { stale: true };
    const decidedBy = approval.decidedBy ?? 'system';
    let problem = granted ? null : envelope.name === 'approval.denied' ? (approval.note ? `Reddedildi: ${approval.note}` : 'Reddedildi') : 'Onayın süresi doldu';
    if (granted && row.employee.userId) {
      const decider = await tx.user.findFirst({ where: { hotelId, email: decidedBy }, select: { id: true } });
      if (decider?.id === row.employee.userId) problem = 'Kişi kendi iznini onaylayamaz (dört göz)';
    }
    if (granted && !problem) {
      for (const month of monthsOf(/** @type {string} */ (day(row.startDate)), /** @type {string} */ (day(row.endDate)))) {
        const run = await tx.payrollRun.findFirst({ where: { hotelId, year: month.year, month: month.month, kind: 'MONTHLY', status: { in: ['PENDING_APPROVAL', 'APPROVED'] } }, select: { id: true } });
        if (run) problem = `${month.month}/${month.year} bordrosu onaylı ya da onayda; izin o aya işlenemez`;
      }
    }
    if (granted && row.type === 'ANNUAL') {
      const balance = await balanceOf(tx, row.employee, /** @type {string} */ (day(row.endDate)));
      if (balance.balance < Number(row.days)) problem = `Onay anında yıllık izin bakiyesi yetersiz (${balance.balance} gün)`;
    }
    const status = problem ? 'REJECTED' : 'APPROVED';
    await tx.leave.update({ where: { id: row.id }, data: { status, decidedBy, decidedAt: new Date(), decisionNote: problem ?? approval.note ?? null } });
    await recordAudit(tx, { hotelId, entity: 'Leave', entityId: row.id, action: 'UPDATE', before: { status: 'PENDING' }, after: { status, decidedBy, note: problem ?? approval.note ?? null } });
    await stage('hr.leave.changed', { hotelId, leaveId: row.id, employeeId: row.employeeId, type: row.type, change: status, startDate: day(row.startDate), endDate: day(row.endDate) });
    const range = `${dotted(/** @type {string} */ (day(row.startDate)))} – ${dotted(/** @type {string} */ (day(row.endDate)))}`;
    if (row.employee.userId) {
      await raiseStaffAlert(tx, stage, {
        hotelId,
        kind: 'HR',
        severity: status === 'APPROVED' ? 'INFO' : 'WARNING',
        title: status === 'APPROVED' ? 'İzniniz onaylandı' : 'İzin talebiniz reddedildi',
        body: `${LEAVE_TYPE_LABELS[row.type]}, ${range} (${Number(row.days)} gün)${problem ? ` — ${problem}` : ''}`,
        link: '/ik/benim',
        userId: row.employee.userId,
        dedupeKey: `hr-leave-decision:${row.id}`,
      });
    }
    return { applied: true, status };
  });
  return { handled: true, ...result };
}
