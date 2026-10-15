import { toDecimal, toIsoDay, toMoneyString } from '@hotelos/core';
import { bonusPhase } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { includedRoomTaxRate, netOfIncludedTax } from '../dashboard/rules.js';
import { getActiveTaxes } from '../settings/service.js';
import { loadMonthlyProduction, loadProductionTotals } from './queries.js';
import { achievedOf, computeBonus, nextTier, paceOf, scorePct } from './rules.js';

/**
 * Acente bonusu (modül 35) — kural ve hak ediş servislerinin ortak parçaları:
 * seçimler, DTO'lar, denetim izi görüntüleri ve canlı ilerleme hesabı.
 */

export const DAY_MS = 86_400_000;
/** Zamanlanmış işin ve sistem hesabının aktör adı. */
export const SYSTEM_ACTOR = 'system';

/** @param {Date | null | undefined} value */
export const iso = (value) => (value ? value.toISOString() : null);
/** @param {Date | null | undefined} value */
export const day = (value) => (value ? toIsoDay(value) : null);
export const money = (value) => toMoneyString(String(value ?? 0));
/** "YYYY-AA-GG" → @db.Date değeri. */
export const dateOnly = (text) => new Date(`${text}T00:00:00.000Z`);

/**
 * Hedef / eşik metni: gece ölçütünde tam sayı, ciroda kuruşlu.
 * @param {'NIGHTS' | 'REVENUE'} metric
 * @param {unknown} value
 */
export const quantityText = (metric, value) => (metric === 'NIGHTS' ? toDecimal(String(value)).toFixed(0) : money(value));

/** Kayıtlı kademeler (JSON) → metin çiftleri. @param {unknown} value */
export function tiersOf(value) {
  return /** @type {Array<{ threshold: unknown, ratePct: unknown }>} */ (Array.isArray(value) ? value : []).map((tier) => ({
    threshold: String(tier.threshold),
    ratePct: String(tier.ratePct),
  }));
}

export const RULE_SELECT = Object.freeze({
  id: true,
  hotelId: true,
  agencyId: true,
  name: true,
  startDate: true,
  endDate: true,
  metric: true,
  mode: true,
  target: true,
  tiers: true,
  roomTypeIds: true,
  maxBonus: true,
  currency: true,
  notes: true,
  status: true,
  createdBy: true,
  activatedAt: true,
  activatedBy: true,
  cancelledAt: true,
  cancelledBy: true,
  cancelReason: true,
  progressNights: true,
  progressRevenue: true,
  progressScore: true,
  reachedTier: true,
  progressAt: true,
  createdAt: true,
  updatedAt: true,
  agency: { select: { id: true, code: true, name: true, status: true } },
  bonus: { select: { id: true, status: true, amount: true, revision: true, updatedAt: true } },
});

/**
 * Kuralın üretim süzgeci (sorgulara giden tanım).
 * @param {{ id: string, agencyId: string, startDate: Date | string, endDate: Date | string, roomTypeIds: string[] }} row
 * @returns {import('./queries.js').ProductionSpec}
 */
export const specOf = (row) => ({
  id: row.id,
  agencyId: row.agencyId,
  startDate: typeof row.startDate === 'string' ? row.startDate : toIsoDay(row.startDate),
  endDate: typeof row.endDate === 'string' ? row.endDate : toIsoDay(row.endDate),
  roomTypeIds: row.roomTypeIds ?? [],
});

/**
 * Hesap motorunun koşulları.
 * @param {{ metric: 'NIGHTS' | 'REVENUE', mode: 'WHOLE' | 'EXCESS', tiers: unknown, maxBonus: unknown, target: unknown }} row
 */
export const termsOf = (row) => ({
  metric: row.metric,
  mode: row.mode,
  tiers: tiersOf(row.tiers),
  maxBonus: row.maxBonus === null || row.maxBonus === undefined ? null : money(row.maxBonus),
  target: quantityText(row.metric, row.target),
});

/** Eksi ciro sıfır sayılır (bkz. `rules.js`). @param {string | number} value */
export const nonNegativeMoney = (value) => {
  const amount = toDecimal(String(value));
  return toMoneyString(amount.greaterThan(0) ? amount : 0);
};

/**
 * Oda tipi adları (silinmiş olanlar dahil: geçmiş kuralın süzgeci okunabilsin).
 * @param {string} hotelId
 * @param {string[]} ids
 * @returns {Promise<Map<string, { id: string, code: string, name: string }>>}
 */
export async function roomTypeNames(hotelId, ids) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await prisma.roomType.findMany({
    where: { hotelId, id: { in: unique }, deletedAt: undefined },
    select: { id: true, code: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Kayıtlı ilerleme özetinden puan ve zamana göre durum (liste için; canlı değil).
 * @param {any} row `RULE_SELECT`
 * @param {string} businessDate
 */
function storedProgress(row, businessDate) {
  const terms = termsOf(row);
  const achieved = achievedOf(row.metric, { nights: row.progressNights, revenue: money(row.progressRevenue) });
  const pace =
    row.status === 'ACTIVE'
      ? paceOf({ startDate: day(row.startDate), endDate: day(row.endDate), businessDate, target: terms.target, achieved, metric: row.metric })
      : null;
  return {
    nights: row.progressNights,
    revenue: money(row.progressRevenue),
    achieved: row.metric === 'NIGHTS' ? String(row.progressNights) : money(row.progressRevenue),
    scorePct: money(row.progressScore),
    reachedTier: row.reachedTier,
    pace: pace?.pace ?? null,
    expected: pace?.expected ?? null,
    at: iso(row.progressAt),
  };
}

/**
 * @param {any} row `RULE_SELECT`
 * @param {{ businessDate: string, roomTypes: Map<string, { id: string, code: string, name: string }> }} context
 */
export function toRuleDto(row, { businessDate, roomTypes }) {
  const terms = termsOf(row);
  return {
    id: row.id,
    agency: row.agency,
    name: row.name,
    startDate: day(row.startDate),
    endDate: day(row.endDate),
    metric: row.metric,
    mode: row.mode,
    target: terms.target,
    tiers: terms.tiers,
    roomTypeIds: row.roomTypeIds,
    roomTypes: row.roomTypeIds.map((id) => roomTypes.get(id) ?? { id, code: '?', name: 'Bilinmeyen oda tipi' }),
    maxBonus: terms.maxBonus,
    currency: row.currency,
    notes: row.notes,
    status: row.status,
    phase: bonusPhase({ startDate: day(row.startDate), endDate: day(row.endDate) }, businessDate),
    progress: storedProgress(row, businessDate),
    bonus: row.bonus ? { id: row.bonus.id, status: row.bonus.status, amount: money(row.bonus.amount), revision: row.bonus.revision } : null,
    createdBy: row.createdBy,
    activatedAt: iso(row.activatedAt),
    activatedBy: row.activatedBy,
    cancelledAt: iso(row.cancelledAt),
    cancelledBy: row.cancelledBy,
    cancelReason: row.cancelReason,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** Denetim izine yazılan kural alanları. @param {any} row */
export function ruleSnapshot(row) {
  const terms = termsOf(row);
  return {
    agencyId: row.agencyId,
    name: row.name,
    startDate: day(row.startDate),
    endDate: day(row.endDate),
    metric: row.metric,
    mode: row.mode,
    target: terms.target,
    tiers: terms.tiers,
    roomTypeIds: [...row.roomTypeIds].sort(),
    maxBonus: terms.maxBonus,
    notes: row.notes ?? null,
    status: row.status,
    cancelReason: row.cancelReason ?? null,
  };
}

/**
 * Canlı ilerleme: gerçekleşen, eldeki, tahmin, şu ana kadarki ve tahmini prim,
 * zamana göre durum, sonraki kademe ve aylık kırılım. Eldeki tutar rezervasyon
 * fiyatıdır (vergiler dahil): dahil vergiler ayrılır (gelir raporuyla aynı yol).
 *
 * @param {string} hotelId
 * @param {import('./queries.js').ProductionSpec} spec
 * @param {ReturnType<typeof termsOf>} terms
 * @param {string} businessDate
 */
export async function liveProgress(hotelId, spec, terms, businessDate) {
  const [totals, months, taxes] = await Promise.all([
    loadProductionTotals(prisma, hotelId, [spec], businessDate, { onTheBooks: true }),
    loadMonthlyProduction(prisma, hotelId, spec, businessDate),
    getActiveTaxes(hotelId),
  ]);
  const includedRate = includedRoomTaxRate(taxes);
  const net = (gross) => toMoneyString(netOfIncludedTax(gross, includedRate));
  const row = totals.get(spec.id) ?? { nights: 0, revenue: '0', onBooksNights: 0, onBooksGross: '0' };

  const realized = { nights: row.nights, revenue: nonNegativeMoney(row.revenue) };
  const onBooks = { nights: row.onBooksNights, revenue: net(row.onBooksGross) };
  const projected = { nights: realized.nights + onBooks.nights, revenue: toMoneyString(toDecimal(realized.revenue).plus(toDecimal(onBooks.revenue))) };

  const achieved = achievedOf(terms.metric, realized);
  const projectedAchieved = achievedOf(terms.metric, projected);
  const earned = computeBonus({ ...terms, ...realized });
  const forecast = computeBonus({ ...terms, ...projected });

  return {
    businessDate,
    phase: bonusPhase(spec, businessDate),
    includedTaxRate: includedRate.toString(),
    realized: { ...realized, achieved: earned.achieved, scorePct: scorePct(achieved, terms.target) },
    onBooks,
    projected: { ...projected, achieved: forecast.achieved, scorePct: scorePct(projectedAchieved, terms.target) },
    pace: paceOf({ startDate: spec.startDate, endDate: spec.endDate, businessDate, target: terms.target, achieved, metric: terms.metric }),
    nextTier: nextTier(terms.tiers, achieved, terms.metric),
    projectedTier: forecast.tierIndex,
    earned,
    forecast,
    months: months.map((month) => ({
      month: month.month,
      nights: month.nights,
      revenue: money(month.revenue),
      onBooksNights: month.onBooksNights,
      onBooksRevenue: net(month.onBooksGross),
    })),
  };
}
