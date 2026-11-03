import { toIsoDay, toMoneyString } from '@hotelos/core';
import { SYSTEM_PAY_ELEMENTS, payrollMonthBounds, payrollPeriodLabel } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { hotelContext } from '../banquet/shared.js';

export { prisma, hotelContext };

/** Bordro modülünün ortak yardımcıları (modül 51). */

export const day = (value) => (value ? toIsoDay(value) : null);
export const dateOnly = (text) => new Date(`${text}T00:00:00.000Z`);
export const money = (value) => toMoneyString(String(value ?? 0));
export const iso = (value) => (value ? value.toISOString() : null);
export const periodLabel = payrollPeriodLabel;
/** Ayı sıralanabilir tek sayıya çevirir: 2026 × 12 + 3. @param {number} year @param {number} month */
export const monthKey = (year, month) => year * 12 + (month - 1);

/**
 * Kalem kataloğu: sistem kalemleri yoksa açılır (ilk bordro ekranında bir kez; eşzamanlı çağrı çakışmaz).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId
 */
export async function ensureSystemElements(client, hotelId) {
  const existing = await client.payElement.findMany({ where: { hotelId, system: true }, select: { code: true } });
  const have = new Set(existing.map((row) => row.code));
  const missing = SYSTEM_PAY_ELEMENTS.filter((element) => !have.has(element.code));
  if (missing.length > 0) {
    await client.payElement.createMany({
      data: missing.map((element) => ({ hotelId, code: element.code, name: element.name, kind: element.kind, system: true, sgk: element.sgk, gv: element.gv, dv: element.dv, exemption: element.exemption })),
      skipDuplicates: true,
    });
  }
}

/**
 * Ayın son günü yürürlükte olan parametre seti (ay içi değişiklikte gün bölünmez).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId @param {number} year @param {number} month
 */
export async function parameterSetFor(client, hotelId, year, month) {
  const { last } = payrollMonthBounds(year, month);
  return client.payrollParameterSet.findFirst({ where: { hotelId, validFrom: { lte: dateOnly(last) } }, orderBy: { validFrom: 'desc' } });
}

/**
 * Bir günde yürürlükte olan set (kıdem tavanı: çıkış günü).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId @param {string} onDay
 */
export async function parameterSetOn(client, hotelId, onDay) {
  return client.payrollParameterSet.findFirst({ where: { hotelId, validFrom: { lte: dateOnly(onDay) } }, orderBy: { validFrom: 'desc' } });
}

/**
 * Ayın açık (taslak / hesaplanmış) bordrolarını "yeniden hesaplanmalı" işaretler: girdisi değişti. Onaydaki ya da
 * onaylı bordroya dokunulmaz (onlar `assertMonthOpen` ile zaten korunur).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {{ year: number, month: number } | { fromYear: number, fromMonth: number }} scope
 */
export async function markRunsStale(tx, hotelId, scope) {
  if ('year' in scope) {
    await tx.payrollRun.updateMany({ where: { hotelId, year: scope.year, month: scope.month, status: 'CALCULATED' }, data: { stale: true } });
    return;
  }
  await tx.$executeRaw`
    UPDATE "PayrollRun" SET "stale" = true, "updatedAt" = now()
    WHERE "hotelId" = ${hotelId} AND "status" = 'CALCULATED' AND ("year" * 12 + "month" - 1) >= ${monthKey(scope.fromYear, scope.fromMonth)}`;
}

/**
 * Ayın girdisi (puantaj, kalem) değiştirilebilir mi: aylık bordro onayda ya da onaylıysa hayır (düzeltme fark
 * bordrosuyla). Fark bordrosuna giden kalem `runId` ile ayrıca denetlenir.
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId @param {number} year @param {number} month
 */
export async function assertMonthOpen(client, hotelId, year, month) {
  const run = await client.payrollRun.findFirst({ where: { hotelId, year, month, kind: 'MONTHLY' }, select: { status: true } });
  if (run && (run.status === 'PENDING_APPROVAL' || run.status === 'APPROVED')) {
    throw new ConflictError(
      `${periodLabel(year, month)} bordrosu ${run.status === 'APPROVED' ? 'onaylı' : 'onay bekliyor'}; bu ayın değişikliği ${run.status === 'APPROVED' ? 'fark bordrosuyla yapılır' : 'onay sonuçlanınca yapılabilir'}`,
      'PAYROLL_MONTH_LOCKED',
    );
  }
}

/**
 * Personelin bu otelde olduğunu doğrular.
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId @param {string} employeeId
 */
export async function requireEmployee(client, hotelId, employeeId, select = { id: true, firstName: true, lastName: true, status: true, hireDate: true, terminationDate: true }) {
  const employee = await client.employee.findFirst({ where: { id: employeeId, hotelId }, select });
  if (!employee) throw new NotFoundError('Personel bulunamadı');
  return employee;
}

/**
 * Otel içi sıra (sicil no): satır kilidiyle artırılır.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} kind
 */
export async function nextPayrollSequence(tx, hotelId, kind) {
  const rows = await tx.$queryRaw`
    INSERT INTO "PayrollSequence" ("hotelId", "kind", "last") VALUES (${hotelId}, ${kind}, 1)
    ON CONFLICT ("hotelId", "kind") DO UPDATE SET "last" = "PayrollSequence"."last" + 1
    RETURNING "last"`;
  return Number(rows[0].last);
}

/** Bordro ayarları (satır yoksa varsayılan). @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId */
export async function loadPayrollSettings(client, hotelId) {
  const row = await client.payrollSettings.findFirst({ where: { hotelId } });
  return row ?? { hotelId, workplaceName: null, sgkWorkplaceNo: null, taxOffice: null, taxNumber: null, sector: 'GENERAL', treasuryDiscount: true, sgkLedgerAccountId: null, taxLedgerAccountId: null, besLedgerAccountId: null, updatedBy: null, createdAt: null, updatedAt: null };
}

/** Ay girdisinin geçerli olduğu yıl / ay. @param {{ year: number, month: number }} input */
export function assertPeriod({ year, month }) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new ValidationError('Dönem geçersiz');
}
