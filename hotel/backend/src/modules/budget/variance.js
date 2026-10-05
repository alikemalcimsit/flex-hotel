import { actorRegistry } from '@hotelos/actor-kit';
import { budgetAgentManifest } from '@hotelos/budget-agent';
import { currentActor, toDecimal, toIsoDay, toMoneyString } from '@hotelos/core';
import {
  BUDGET_MONTH_LABELS,
  BUDGET_SCOPE_LABELS,
  BUDGET_SYSTEM_ITEMS,
  shiftDay,
} from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { isActorEnabledCached } from '../../lib/actor-settings.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ConflictError, NotFoundError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { LIVE_SCOPES, liveVersion } from '../../lib/live-version.js';
import { createReadCache } from '../../lib/read-cache.js';
import { writeWithEvents } from '../../lib/write.js';
import { getAiSettingsCached } from '../concierge/settings.js';
import { readOnly } from '../reports/queries.js';
import { computeRevenueReport } from '../reports/service.js';
import { getHotelSettings } from '../settings/service.js';
import { loadCollections, loadOtherRevenue } from './queries.js';
import {
  periodActual,
  periodMonths,
  periodPlan,
  periodTargets,
  roomRevenueDrivers,
  topVariances,
  varianceOf,
} from './rules.js';
import { itemList, linesByItem, loadExpenseItems } from './service.js';

/**
 * Sapma raporu ve AI yorumu (modül 27).
 *
 * Plan yılın **onaylı** bütçesinden; onaylı yoksa taslaktan (cevapta
 * işaretli). Gerçekleşen:
 * - oda geliri, ek ücret, iptal geliri, satılan / satılabilir oda: gelir
 *   raporunun hesabı (aynı tanımlar; ay ay, kapanmış günler);
 * - restoran, minibar, çamaşır, diğer gelir ve tahsilat: `queries.js`;
 * - giderler: elle girilen (`BudgetExpenseActual`).
 *
 * Sistem gerçekleşeni (yılın ayları) otel × yıl × iş günü × canlı sürüm
 * anahtarıyla bir dakika önbellekte; bütçe satırları ve elle girilen
 * giderler her istekte okunur (küçük, anında yansısın).
 */

/** AI yorumu bu kadar sürede tamamlanmazsa (ajan kapandı, süreç düştü) yerine yenisi istenebilir. */
export const COMMENTARY_TIMEOUT_MS = 5 * 60_000;
/** Yoruma giden en büyük sapma sayısı. */
export const COMMENTARY_TOP_VARIANCES = 6;
/** Yorum ajanının adı (aktör paneli, kullanım kaydı). */
export const BUDGET_AGENT_NAME = budgetAgentManifest.name;

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;
const cache = createReadCache({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX_ENTRIES });

const SYSTEM_BY_CODE = new Map(BUDGET_SYSTEM_ITEMS.map((item) => [item.code, item]));

/**
 * Yılın sistem gerçekleşeni, ay ay (yalnızca kapanmış günler).
 * @param {string} hotelId
 * @param {number} year
 * @param {string} businessDate
 * @returns {Promise<{ byItem: Map<string, Map<number, string>>, sellable: Map<number, number>, sold: Map<number, number> }>}
 */
function loadSystemActuals(hotelId, year, businessDate) {
  const key = JSON.stringify(['budget-actuals', hotelId, year, businessDate, liveVersion(LIVE_SCOPES.RESERVATIONS, hotelId), liveVersion(LIVE_SCOPES.INVENTORY, hotelId)]);
  return cache.get(key, async () => {
    const yearStart = `${year}-01-01`;
    const lastClosed = shiftDay(businessDate, -1);
    const to = lastClosed < `${year}-12-31` ? lastClosed : `${year}-12-31`;
    /** @type {Map<string, Map<number, string>>} */
    const byItem = new Map();
    const put = (item, month, value) => {
      if (!byItem.has(item)) byItem.set(item, new Map());
      const target = byItem.get(item);
      target.set(month, toMoneyString(toDecimal(target.get(month) ?? 0).plus(toDecimal(value ?? 0))));
    };
    const sellable = new Map();
    const sold = new Map();
    if (to < yearStart) return { byItem, sellable, sold };

    const { currency } = await getHotelSettings(hotelId);
    const [report, other] = await Promise.all([
      computeRevenueReport(hotelId, { from: yearStart, to, groupBy: 'MONTH', businessDate }),
      readOnly(async (tx) => ({
        revenue: await loadOtherRevenue(tx, hotelId, { year, businessDate, currency }),
        collections: await loadCollections(tx, hotelId, { year, businessDate }),
      })),
    ]);
    for (const bucket of report.buckets) {
      const month = Number(bucket.key.slice(5, 7));
      put('ROOM_REVENUE', month, bucket.roomRevenue);
      put('FEE_REVENUE', month, bucket.fees);
      put('CANCELLATION_REVENUE', month, bucket.cancellations);
      sellable.set(month, bucket.sellable);
      sold.set(month, bucket.sold);
    }
    for (const row of other.revenue) put(row.item, row.month, String(row.amount));
    for (const row of other.collections) put('COLLECTIONS', row.month, String(row.amount));
    return { byItem, sellable, sold };
  });
}

/**
 * Yılın plan tabanı: onaylı sürüm, yoksa taslak.
 * @param {string} hotelId
 * @param {number} year
 */
async function loadBasis(hotelId, year) {
  const versions = await prisma.budget.findMany({
    where: { hotelId, year, status: { in: ['APPROVED', 'DRAFT'] } },
    select: { id: true, version: true, status: true, updatedAt: true },
  });
  return versions.find((row) => row.status === 'APPROVED') ?? versions.find((row) => row.status === 'DRAFT') ?? null;
}

/**
 * Sapma raporu.
 *
 * @param {string} hotelId
 * @param {{ year: number, month: number, scope: 'MONTH' | 'YTD' }} query
 * @param {{ now?: Date }} [options]
 */
export async function getVarianceReport(hotelId, { year, month, scope }, { now = new Date() } = {}) {
  const businessDate = toIsoDay(await getBusinessDate(hotelId, now));
  const [hotel, basis] = await Promise.all([getHotelSettings(hotelId), loadBasis(hotelId, year)]);
  const period = periodMonths({ year, month, scope, businessDate });
  const partial = period.find((entry) => entry.share < 1) ?? null;

  const [lineRows, actualRows, system] = await Promise.all([
    basis ? prisma.budgetLine.findMany({ where: { hotelId, budgetId: basis.id }, select: { item: true, month: true, amount: true } }) : [],
    prisma.budgetExpenseActual.findMany({ where: { hotelId, year }, select: { expenseItemId: true, month: true, amount: true } }),
    loadSystemActuals(hotelId, year, businessDate),
  ]);
  const plans = linesByItem(lineRows);
  const referenced = [...new Set([...lineRows.filter((row) => !SYSTEM_BY_CODE.has(row.item)).map((row) => row.item), ...actualRows.map((row) => row.expenseItemId)])];
  const items = itemList(await loadExpenseItems(prisma, hotelId, referenced));
  /** @type {Map<string, Map<number, string>>} */
  const manual = new Map();
  for (const row of actualRows) {
    if (!manual.has(row.expenseItemId)) manual.set(row.expenseItemId, new Map());
    manual.get(row.expenseItemId).set(row.month, String(row.amount));
  }

  const none = () => Array.from({ length: 12 }, () => null);
  const targets = periodTargets({ occupancy: plans.get('OCCUPANCY') ?? none(), adr: plans.get('ADR') ?? none(), sellable: system.sellable, period });
  const soldNights = period.reduce((total, { month: value }) => total + (system.sold.get(value) ?? 0), 0);
  const sellableNights = period.reduce((total, { month: value }) => total + (system.sellable.get(value) ?? 0), 0);
  const roomActual = periodActual(system.byItem.get('ROOM_REVENUE') ?? new Map(), period, { manual: false }).total;

  const rows = items
    .filter((item) => !item.archived || plans.has(item.item) || manual.has(item.item))
    .map((item) => {
      let plan;
      let actual;
      let complete = true;
      if (item.item === 'OCCUPANCY') {
        plan = targets.occupancyPct;
        actual = sellableNights > 0 ? Math.round((soldNights / sellableNights) * 1000) / 10 : null;
      } else if (item.item === 'ADR') {
        plan = targets.adr;
        actual = soldNights > 0 ? roomActual.dividedBy(soldNights) : null;
      } else if (item.system) {
        plan = periodPlan(plans.get(item.item) ?? none(), period);
        actual = periodActual(system.byItem.get(item.item) ?? new Map(), period, { manual: false }).total;
      } else {
        plan = periodPlan(plans.get(item.item) ?? none(), period);
        const result = periodActual(manual.get(item.item) ?? new Map(), period, { manual: true });
        actual = result.total;
        // Planlanmamış ve gerçekleşeni girilmemiş kalem karşılaştırılacak bir şey değil: eksik sayılmaz.
        complete = result.complete || (plan === null && actual === null);
      }
      const variance = varianceOf({ kind: item.kind, unit: item.unit, plan, actual });
      const show = (value) => (value === null || value === undefined ? null : item.unit === 'PCT' ? Number(value) : toMoneyString(toDecimal(value)));
      return {
        item: item.item,
        kind: item.kind,
        unit: item.unit,
        label: item.label,
        source: item.system ? 'SYSTEM' : 'MANUAL',
        plan: show(plan),
        actual: show(actual),
        ...variance,
        complete,
      };
    });

  const sum = (kind, field) =>
    rows.filter((row) => row.kind === kind && row[field] !== null).reduce((total, row) => total.plus(toDecimal(row[field])), toDecimal(0));
  const hasPlan = (kind) => rows.some((row) => row.kind === kind && row.plan !== null);
  const total = (kind) => {
    const plan = hasPlan(kind) ? sum(kind, 'plan') : null;
    const actual = sum(kind, 'actual');
    return { plan: plan === null ? null : toMoneyString(plan), actual: toMoneyString(actual), ...varianceOf({ kind, unit: 'MONEY', plan, actual }) };
  };
  const revenue = total('REVENUE');
  const expense = total('EXPENSE');
  const expenseComplete = rows.filter((row) => row.kind === 'EXPENSE').every((row) => row.complete);
  const gopPlan = revenue.plan === null && expense.plan === null ? null : toDecimal(revenue.plan ?? 0).minus(toDecimal(expense.plan ?? 0));
  const gopActual = toDecimal(revenue.actual).minus(toDecimal(expense.actual));
  const roomPlan = rows.find((row) => row.item === 'ROOM_REVENUE')?.plan ?? null;

  return {
    year,
    month,
    scope,
    businessDate,
    currency: hotel.currency,
    basis: basis ? { budgetId: basis.id, version: basis.version, status: basis.status } : null,
    period: {
      months: period.map((entry) => entry.month),
      label: periodLabel({ year, month, scope }),
      partial: partial ? { month: partial.month, sharePct: Math.round(partial.share * 1000) / 10 } : null,
    },
    rows,
    totals: {
      revenue,
      expense: { ...expense, complete: expenseComplete },
      gop: {
        plan: gopPlan === null ? null : toMoneyString(gopPlan),
        actual: toMoneyString(gopActual),
        ...varianceOf({ kind: 'REVENUE', unit: 'MONEY', plan: gopPlan, actual: gopActual }),
        complete: expenseComplete,
      },
    },
    drivers: {
      room: roomRevenueDrivers({
        planRevenue: roomPlan === null ? null : toDecimal(roomPlan),
        actualRevenue: roomActual,
        planNights: targets.nights,
        planAdr: targets.adr,
        actualNights: soldNights,
      }),
    },
    nights: { sold: soldNights, sellable: sellableNights, planned: targets.nights === null ? null : Math.round(targets.nights) },
    generatedAt: new Date().toISOString(),
  };
}

/** "Eylül 2026" / "Ocak–Eylül 2026". */
export function periodLabel({ year, month, scope }) {
  return scope === 'YTD' && month > 1 ? `${BUDGET_MONTH_LABELS[0]}–${BUDGET_MONTH_LABELS[month - 1]} ${year}` : `${BUDGET_MONTH_LABELS[month - 1]} ${year}`;
}

/**
 * Sapmanın açıklaması (AI yorumunun girdisi; MCP \`explain_variance\`):
 * dönem, toplamlar, en büyük sapmalar, oda gelirinin doluluk / fiyat etkisi,
 * hedefler, eksik veri notları. Yalnızca rakam ve etiket — kişisel veri yok.
 *
 * @param {string} hotelId
 * @param {{ year: number, month: number, scope: 'MONTH' | 'YTD' }} query
 */
export async function explainVariance(hotelId, query) {
  const report = await getVarianceReport(hotelId, query);
  const pick = (row) => ({
    item: row.item,
    label: row.label,
    kind: row.kind,
    plan: row.plan,
    actual: row.actual,
    difference: row.difference,
    differencePct: row.differencePct,
    tone: row.tone,
  });
  const notes = [];
  if (!report.basis) notes.push('Bu yıl için bütçe girilmemiş; sapma hesaplanamaz.');
  else if (report.basis.status === 'DRAFT') notes.push('Plan henüz onaylanmamış taslak bütçeden.');
  if (report.period.partial) notes.push(`${BUDGET_MONTH_LABELS[report.period.partial.month - 1]} ayı sürüyor: plan kapanmış günler oranında (%${report.period.partial.sharePct}) karşılaştırıldı.`);
  if (!report.totals.expense.complete) notes.push('Bazı gider kalemlerinin gerçekleşeni girilmemiş; gider ve brüt faaliyet kârı eksik.');
  if (report.period.months.length === 0) notes.push('Seçilen dönemin henüz kapanmış günü yok.');
  return {
    period: report.period.label,
    scope: BUDGET_SCOPE_LABELS[report.scope],
    currency: report.currency,
    basis: report.basis,
    totals: report.totals,
    topVariances: topVariances(report.rows, COMMENTARY_TOP_VARIANCES).map(pick),
    targets: report.rows.filter((row) => row.kind === 'KPI').map(pick),
    roomDrivers: report.drivers.room,
    nights: report.nights,
    notes,
  };
}

/* ─────────────── AI yorumu ─────────────── */

/** @param {object | null} row */
function toCommentaryDto(row) {
  if (!row) return null;
  const pending = row.status === 'PENDING';
  const timedOut = pending && Date.now() - row.requestedAt.getTime() > COMMENTARY_TIMEOUT_MS;
  return {
    id: row.id,
    status: timedOut ? 'FAILED' : row.status,
    text: row.text,
    failureReason: timedOut ? 'Yorum zamanında tamamlanmadı; tekrar isteyebilirsiniz.' : row.failureReason,
    model: row.model,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    budgetId: row.budgetId,
  };
}

/**
 * AI yorumu bu otelde istenebilir mi; değilse neden (ekrandaki düğme).
 * @param {string} hotelId
 * @returns {Promise<{ available: boolean, reason: string | null }>}
 */
export async function commentaryAvailability(hotelId) {
  // Ajan yalnızca model istemcisi varken (sunucuda anahtar) kaydedilir.
  if (!actorRegistry.get(BUDGET_AGENT_NAME)) return { available: false, reason: 'Sunucuda AI anahtarı tanımlı değil.' };
  const settings = await getAiSettingsCached(hotelId);
  if (!settings.enabled) return { available: false, reason: 'AI bu otelde kapalı (Ayarlar › AI asistanı).' };
  if (!settings.conciergeModel) return { available: false, reason: 'AI modeli seçilmemiş (Ayarlar › AI asistanı).' };
  if (!(await isActorEnabledCached(hotelId, BUDGET_AGENT_NAME))) return { available: false, reason: 'Bütçe yorum ajanı aktör panelinde kapalı.' };
  return { available: true, reason: null };
}

/**
 * Dönemin son yorumu.
 * @param {string} hotelId
 * @param {{ year: number, month: number, scope: string }} query
 */
export async function getCommentary(hotelId, { year, month, scope }) {
  const [row, availability] = await Promise.all([
    prisma.budgetCommentary.findFirst({ where: { hotelId, year, month, scope }, orderBy: [{ requestedAt: 'desc' }] }),
    commentaryAvailability(hotelId),
  ]);
  return { commentary: toCommentaryDto(row), ...availability };
}

/**
 * Dönem için AI yorumu ister. Bekleyen (zamanı geçmemiş) istek varsa o
 * döner (çift tık / iki kişi aynı anda → tek istek). Ajan olayı alır, yorumu
 * yazar; ekran canlı tazelenir.
 *
 * @param {string} hotelId
 * @param {{ year: number, month: number, scope: 'MONTH' | 'YTD' }} query
 */
export async function requestCommentary(hotelId, { year, month, scope }) {
  const availability = await commentaryAvailability(hotelId);
  if (!availability.available) throw new ConflictError(availability.reason, 'AI_UNAVAILABLE');
  const basis = await loadBasis(hotelId, year);
  if (!basis) throw new ValidationError(`${year} için bütçe girilmemiş; yorumlanacak sapma yok.`, { field: 'year' });
  const businessDate = toIsoDay(await getBusinessDate(hotelId));
  if (periodMonths({ year, month, scope, businessDate }).length === 0) {
    throw new ValidationError('Seçilen dönemin henüz kapanmış günü yok; yorumlanacak gerçekleşen yok.', { field: 'month' });
  }
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      const pending = await tx.budgetCommentary.findFirst({ where: { hotelId, budgetId: basis.id, year, month, scope, status: 'PENDING' } });
      if (pending) {
        if (Date.now() - pending.requestedAt.getTime() <= COMMENTARY_TIMEOUT_MS) return;
        // Zamanı geçmiş istek kapanır (ajan kapanmış / süreç düşmüş olabilir); yerine yenisi açılır.
        await tx.budgetCommentary.update({
          where: { id: pending.id },
          data: { status: 'FAILED', failureReason: 'Yorum zamanında tamamlanmadı.', completedAt: new Date() },
        });
      }
      const row = await tx.budgetCommentary.create({ data: { hotelId, budgetId: basis.id, year, month, scope, requestedBy: actor }, select: { id: true } });
      await recordAudit(tx, { hotelId, entity: 'BudgetCommentary', entityId: row.id, action: 'CREATE', after: { year, month, scope, budgetId: basis.id } });
      await stage('budget.commentary.requested', { hotelId, commentaryId: row.id, budgetId: basis.id, year, month, scope });
    });
  } catch (error) {
    // Aynı anda iki istek: kısmi tekil index ikincisini reddeder — bekleyen istek zaten var.
    if (error?.code !== 'P2002') rethrowPrismaError(error);
  }
  return getCommentary(hotelId, { year, month, scope });
}

/**
 * Ajanın sonucu: yorum yazıldı ya da yazılamadı. Yalnızca bekleyen istek
 * kapanır (iki kez gelen olay ikinci kez yazmaz).
 *
 * @param {string} hotelId
 * @param {string} commentaryId
 * @param {{ status: 'READY', text: string, model: string } | { status: 'FAILED', failureReason: string, model?: string | null }} result
 */
export async function completeCommentary(hotelId, commentaryId, result) {
  return writeWithEvents(async (tx, stage) => {
    const data =
      result.status === 'READY'
        ? { status: 'READY', text: result.text, model: result.model, completedAt: new Date() }
        : { status: 'FAILED', failureReason: result.failureReason, model: result.model ?? null, completedAt: new Date() };
    const updated = await tx.budgetCommentary.updateMany({ where: { id: commentaryId, hotelId, status: 'PENDING' }, data });
    if (updated.count === 0) {
      const exists = await tx.budgetCommentary.findFirst({ where: { id: commentaryId, hotelId }, select: { id: true } });
      if (!exists) throw new NotFoundError('Yorum isteği bulunamadı');
      return false;
    }
    await stage('budget.commentary.completed', { hotelId, commentaryId, status: result.status });
    return true;
  });
}

/** Testler için. */
export function clearBudgetCache() {
  cache.clear();
}

/** Sağlık ucu için. */
export function budgetCacheStats() {
  return cache.stats();
}
