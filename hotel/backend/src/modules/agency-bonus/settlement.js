import { calendarDateInTimeZone, currentActor, toDecimal, toIsoDay } from '@hotelos/core';
import {
  AGENCY_BONUS_APPROVAL_TTL_DAYS,
  AGENCY_BONUS_EXPORT_MAX_LINES,
  AGENCY_BONUS_EXPORT_PART_SIZE,
  AGENCY_BONUS_METRIC_LABELS,
  AGENCY_BONUS_MODE_LABELS,
  bonusPhase,
  formatBonusPeriod,
  formatBonusQuantity,
} from '@hotelos/hotel-contracts';
import { prisma, prismaUnfiltered } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockAgencyBonusRules, lockAgencyBonuses } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { containsText } from '../../lib/search.js';
import { findActiveStaffByEmail } from '../../lib/staff.js';
import { writeWithEvents } from '../../lib/write.js';
import { requestApproval } from '../approvals/service.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { guestFullName } from '../reservations/guests.js';
import { reservationSearchConditions } from '../reservations/service.js';
import { getHotelSettings } from '../settings/service.js';
import { countMissingPostings, insertProductionLines, loadProductionTotals, sumProductionLines } from './queries.js';
import { achievedOf, computeBonus, productionDrift, scorePct } from './rules.js';
import { DAY_MS, SYSTEM_ACTOR, day, iso, money, nonNegativeMoney, roomTypeNames, specOf, termsOf } from './shared.js';

/**
 * Acente prim hak edişi servisi (modül 35).
 *
 * ### Akış
 *
 * Dönem biter (son gecenin gece kapanışı yapılır) → hak ediş **hesaplanır**
 * (zamanlanmış iş kendisi ya da yetkili elle) → yetkili **onaya gönderir** (onay
 * kuyruğu, dört göz: gönderen onaylayamaz) → onaylanınca **kilitlenir** →
 * muhasebe **ödendi** işaretler (tarih + belge no). Ret / süre dolumu hak edişi
 * "hesaplandı"ya döndürür (gerekçe görünür). Onaylı ama ödenmemiş hak ediş
 * gerekçeyle **yeniden açılabilir** (sürüm artar); ödeme işareti gerekçeyle geri
 * alınabilir.
 *
 * ### Dondurma ve fark
 *
 * Hesap kuralın koşullarını ve dayandığı rezervasyonları (`AgencyBonusLine`)
 * dondurur: kural ya da veri sonradan değişse de hak ediş "o gün ne
 * hesaplandıysa" odur. Ekran bugünkü üretimle farkı gösterir; fark varken ya da
 * kural hesaptan sonra değiştiyse hak ediş onaya gönderilemez (önce yeniden
 * hesaplanır) — onaylanan rakam, onaya gönderildiği andaki veridir.
 *
 * ### Prim doğmayan dönem
 *
 * Kademeye ulaşılmadıysa (prim 0) onay kuyruğuna gitmez: gönderen kapatır
 * (onaylandı, "prim doğmadı"); ödeme işareti yoktur.
 *
 * ### Kilit düzeni
 *
 * prim kuralı → hak ediş. Onay kararı hak edişi commit'ten sonra, kendi
 * işleminde kilitler (karar ile gönderme aynı anda olamaz: gönderme kuralı ve
 * hak edişi kilitliyken onay satırını açar).
 */

/** Hak ediş onayının süresi (kararsız kalırsa düşer, hak ediş "hesaplandı"ya döner). */
const APPROVAL_TTL_MS = AGENCY_BONUS_APPROVAL_TTL_DAYS * DAY_MS;
/** Yeni hak edişin döküm yazılmadan önceki (sıfır) rakamları; aynı işlemde gerçeğiyle güncellenir. */
const EMPTY_FIGURES = Object.freeze({
  nights: 0,
  revenue: '0',
  scorePct: '0',
  tierIndex: 0,
  grossAmount: '0',
  amount: '0',
  capped: false,
  slices: [],
  reservationCount: 0,
  missingPostings: 0,
});
/** Büyük acentenin (on binlerce rezervasyon) hesabı için işlem süresi. */
const SETTLEMENT_TRANSACTION_TIMEOUT_MS = 60_000;
/** Arama: adı / kodu eşleşen en fazla bu kadar acentenin hak edişi. */
const SEARCH_AGENCY_LIMIT = 500;
/** Ekranın adresi (uyarı ve onay bağlantıları). */
export const bonusLink = (bonusId) => `/acente-primleri/hak-edis/${bonusId}`;

const BONUS_SELECT = Object.freeze({
  id: true,
  hotelId: true,
  ruleId: true,
  agencyId: true,
  status: true,
  revision: true,
  periodStart: true,
  periodEnd: true,
  metric: true,
  mode: true,
  target: true,
  tiers: true,
  roomTypeIds: true,
  maxBonus: true,
  currency: true,
  ruleUpdatedAt: true,
  nights: true,
  revenue: true,
  scorePct: true,
  tierIndex: true,
  grossAmount: true,
  amount: true,
  capped: true,
  slices: true,
  reservationCount: true,
  missingPostings: true,
  calculatedAt: true,
  calculatedBy: true,
  submittedAt: true,
  submittedBy: true,
  submitNote: true,
  approvalId: true,
  approvedAt: true,
  approvedBy: true,
  decisionNote: true,
  paidAt: true,
  paidBy: true,
  paidRecordedAt: true,
  paymentRef: true,
  paymentNote: true,
  reopenedAt: true,
  reopenedBy: true,
  reopenReason: true,
  createdAt: true,
  updatedAt: true,
  agency: { select: { id: true, code: true, name: true, status: true } },
  rule: { select: { id: true, name: true, status: true, updatedAt: true } },
});

/** @param {any} row `BONUS_SELECT` */
function toBonusDto(row) {
  const terms = termsOf(row);
  return {
    id: row.id,
    ruleId: row.ruleId,
    rule: { id: row.rule.id, name: row.rule.name, status: row.rule.status },
    agency: row.agency,
    status: row.status,
    revision: row.revision,
    periodStart: day(row.periodStart),
    periodEnd: day(row.periodEnd),
    metric: row.metric,
    mode: row.mode,
    target: terms.target,
    tiers: terms.tiers,
    roomTypeIds: row.roomTypeIds,
    maxBonus: terms.maxBonus,
    currency: row.currency,
    nights: row.nights,
    revenue: money(row.revenue),
    achieved: row.metric === 'NIGHTS' ? String(row.nights) : money(row.revenue),
    scorePct: money(row.scorePct),
    tierIndex: row.tierIndex,
    grossAmount: money(row.grossAmount),
    amount: money(row.amount),
    capped: row.capped,
    slices: Array.isArray(row.slices) ? row.slices : [],
    reservationCount: row.reservationCount,
    missingPostings: row.missingPostings,
    calculatedAt: iso(row.calculatedAt),
    calculatedBy: row.calculatedBy,
    submittedAt: iso(row.submittedAt),
    submittedBy: row.submittedBy,
    submitNote: row.submitNote,
    approvalId: row.approvalId,
    approvedAt: iso(row.approvedAt),
    approvedBy: row.approvedBy,
    decisionNote: row.decisionNote,
    paidAt: day(row.paidAt),
    paidBy: row.paidBy,
    paidRecordedAt: iso(row.paidRecordedAt),
    paymentRef: row.paymentRef,
    paymentNote: row.paymentNote,
    reopenedAt: iso(row.reopenedAt),
    reopenedBy: row.reopenedBy,
    reopenReason: row.reopenReason,
    /** Kural hesaptan sonra değişti mi (hak ediş bayat). */
    ruleChanged: row.rule.updatedAt.getTime() !== row.ruleUpdatedAt.getTime(),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** Denetim izine yazılan hak ediş alanları (satırlar hariç). @param {any} row */
function bonusSnapshot(row) {
  return {
    status: row.status,
    revision: row.revision,
    nights: row.nights,
    revenue: money(row.revenue),
    scorePct: money(row.scorePct),
    tierIndex: row.tierIndex,
    grossAmount: money(row.grossAmount),
    amount: money(row.amount),
    capped: row.capped,
    reservationCount: row.reservationCount,
    missingPostings: row.missingPostings,
    approvalId: row.approvalId ?? null,
    approvedBy: row.approvedBy ?? null,
    paidAt: day(row.paidAt),
    paymentRef: row.paymentRef ?? null,
    decisionNote: row.decisionNote ?? null,
  };
}

/** @param {string} hotelId */
async function businessDay(hotelId) {
  return toIsoDay(await getBusinessDate(hotelId));
}

/** Hak edişin üretim süzgeci (hesap anındaki kopyadan). @param {any} row */
const bonusSpec = (row) => specOf({ id: row.id, agencyId: row.agencyId, startDate: row.periodStart, endDate: row.periodEnd, roomTypeIds: row.roomTypeIds });

/**
 * Bugünkü verilerle üretim (fark denetimi).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {any} row
 * @param {string} businessDate
 */
async function currentProduction(client, hotelId, row, businessDate) {
  const totals = await loadProductionTotals(client, hotelId, [bonusSpec(row)], businessDate);
  const current = totals.get(row.id) ?? { nights: 0, revenue: '0' };
  return { nights: current.nights, revenue: nonNegativeMoney(current.revenue) };
}

/* ══════════════════ Hesap ══════════════════ */

/**
 * Dönem sonu hak edişini hesaplar ya da (henüz onaya gitmediyse) yeniden
 * hesaplar. Kural kilitlidir: hesap sürerken kural değişmez, aynı kural için
 * iki hesap üst üste yazmaz.
 *
 * `automatic`: zamanlanmış iş — hak ediş zaten varsa dokunmaz, sistem adına
 * hesaplar ve yetkilinin ziline "onaya gönderin" uyarısı bırakır.
 *
 * @param {string} hotelId
 * @param {string} ruleId
 * @param {{ automatic?: boolean }} [options]
 * @returns {Promise<any | null>} hak ediş (otomatikte zaten varsa `null`)
 */
export async function calculateBonus(hotelId, ruleId, { automatic = false } = {}) {
  const actor = automatic ? SYSTEM_ACTOR : currentActor();
  const businessDate = await businessDay(hotelId);
  let bonusId;
  try {
    bonusId = await writeWithEvents(
      async (tx, stage) => {
        await lockAgencyBonusRules(tx, hotelId, [ruleId]);
        const rule = await tx.agencyBonusRule.findFirst({
          where: { id: ruleId, hotelId },
          select: {
            id: true,
            agencyId: true,
            name: true,
            status: true,
            startDate: true,
            endDate: true,
            metric: true,
            mode: true,
            target: true,
            tiers: true,
            roomTypeIds: true,
            maxBonus: true,
            currency: true,
            updatedAt: true,
            agency: { select: { name: true } },
            bonus: { select: { id: true } },
          },
        });
        if (!rule) throw new NotFoundError('Prim kuralı bulunamadı');
        if (automatic && rule.bonus) return null;
        if (rule.status !== 'ACTIVE') throw new ConflictError('Yalnızca yürürlükteki kuralın hak edişi hesaplanır', 'RULE_NOT_ACTIVE');
        if (bonusPhase({ startDate: day(rule.startDate), endDate: day(rule.endDate) }, businessDate) !== 'ENDED') {
          throw new ConflictError(
            'Dönem bitmeden hak ediş hesaplanmaz: dönemin son gecesinin gece kapanışından sonra hesaplanır. Bu arada ilerlemeyi kural ekranından izleyin.',
            'PERIOD_NOT_ENDED',
          );
        }
        let before = null;
        if (rule.bonus) {
          await lockAgencyBonuses(tx, hotelId, [rule.bonus.id]);
          before = await tx.agencyBonus.findFirst({ where: { id: rule.bonus.id }, select: BONUS_SELECT });
          if (before.status !== 'DRAFT') {
            throw new ConflictError('Hak ediş onaya gönderilmiş ya da onaylanmış; yeniden hesaplamak için önce yeniden açın.', 'BONUS_LOCKED');
          }
        }

        const terms = termsOf(rule);
        const copy = {
          periodStart: rule.startDate,
          periodEnd: rule.endDate,
          metric: rule.metric,
          mode: rule.mode,
          target: rule.target,
          tiers: terms.tiers,
          roomTypeIds: rule.roomTypeIds,
          maxBonus: rule.maxBonus,
          currency: rule.currency,
          ruleUpdatedAt: rule.updatedAt,
          calculatedAt: new Date(),
          calculatedBy: actor,
        };
        // Döküm hak edişe bağlıdır: yeni hak edişte önce sıfır rakamlı satır açılır, döküm
        // veritabanında yazılır, rakamlar dökümün toplamından gelir (satırlar uygulamaya taşınmaz).
        let targetId = before?.id ?? null;
        if (before) {
          await tx.agencyBonusLine.deleteMany({ where: { bonusId: targetId } });
        } else {
          const opened = await tx.agencyBonus.create({
            data: { hotelId, ruleId, agencyId: rule.agencyId, ...copy, ...EMPTY_FIGURES },
            select: { id: true },
          });
          targetId = opened.id;
        }
        const spec = specOf(rule);
        await insertProductionLines(tx, hotelId, targetId, spec, businessDate);
        const totals = await sumProductionLines(tx, targetId);
        const missingPostings = await countMissingPostings(tx, hotelId, spec, businessDate);
        const { nights } = totals;
        const revenue = nonNegativeMoney(totals.revenue);
        const result = computeBonus({ ...terms, nights, revenue });
        const saved = await tx.agencyBonus.update({
          where: { id: targetId },
          data: {
            ...copy,
            nights,
            revenue,
            scorePct: scorePct(achievedOf(rule.metric, { nights, revenue }), terms.target),
            tierIndex: result.tierIndex,
            grossAmount: result.grossAmount,
            amount: result.amount,
            capped: result.capped,
            slices: result.slices,
            reservationCount: totals.lines,
            missingPostings,
          },
          select: BONUS_SELECT,
        });

        await recordAudit(tx, {
          hotelId,
          entity: 'AgencyBonus',
          entityId: saved.id,
          action: before ? 'UPDATE' : 'CREATE',
          before: before ? bonusSnapshot(before) : null,
          after: { ...bonusSnapshot(saved), calculatedBy: actor },
        });
        await stage('agency.bonus.changed', { hotelId, bonusId: saved.id, ruleId, agencyId: rule.agencyId, change: before ? 'RECALCULATED' : 'CALCULATED' });

        if (automatic) {
          const outcome = toDecimal(saved.amount).greaterThan(0)
            ? `${formatBonusQuantity('REVENUE', saved.amount, saved.currency)} prim — onaya gönderin`
            : 'kademeye ulaşılmadı, prim doğmadı — kapatın';
          await raiseStaffAlert(tx, stage, {
            hotelId,
            kind: 'AGENCY_BONUS',
            severity: 'INFO',
            title: `Dönem bitti: ${rule.agency.name} · ${rule.name}`,
            body: `Hak ediş hesaplandı: ${outcome}. Hedefe ulaşma %${money(saved.scorePct).replace('.', ',')}.${missingPostings ? ` ${missingPostings} gecenin oda ücreti folyoya işlenmemiş; ciro eksik olabilir.` : ''}`,
            link: bonusLink(saved.id),
            permission: PERMISSIONS.AGENCY_BONUS_MANAGE,
            entityType: 'AgencyBonus',
            entityId: saved.id,
            dedupeKey: `agency-bonus-settled:${saved.id}`,
          });
        }
        return saved.id;
      },
      { timeout: SETTLEMENT_TRANSACTION_TIMEOUT_MS },
    );
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kuralın hak edişi az önce başka bir işlemle hesaplandı; sayfayı yenileyin.' });
  }
  return bonusId ? getBonus(hotelId, bonusId) : null;
}

/* ══════════════════ Okuma ══════════════════ */

/**
 * Hak ediş ekranı: hak ediş + bugünkü verilerle fark + onay durumu.
 * @param {string} hotelId
 * @param {string} bonusId
 */
export async function getBonus(hotelId, bonusId) {
  const row = await prisma.agencyBonus.findFirst({ where: { id: bonusId, hotelId }, select: BONUS_SELECT });
  if (!row) throw new NotFoundError('Hak ediş bulunamadı');
  const [businessDate, roomTypes, approval] = await Promise.all([
    businessDay(hotelId),
    roomTypeNames(hotelId, row.roomTypeIds),
    row.approvalId
      ? prisma.approval.findFirst({ where: { id: row.approvalId, hotelId }, select: { id: true, status: true, expiresAt: true, requestedBy: true } })
      : Promise.resolve(null),
  ]);
  const current = await currentProduction(prisma, hotelId, row, businessDate);
  const drift = productionDrift({ nights: row.nights, revenue: money(row.revenue) }, current);
  return {
    ...toBonusDto(row),
    roomTypes: row.roomTypeIds.map((id) => roomTypes.get(id) ?? { id, code: '?', name: 'Bilinmeyen oda tipi' }),
    approval: approval ? { id: approval.id, status: approval.status, expiresAt: iso(approval.expiresAt), requestedBy: approval.requestedBy } : null,
    current,
    drift,
    /** Bugünkü verilerle prim (fark varsa ne olurdu). */
    currentAmount: drift ? computeBonus({ ...termsOf(row), ...current }).amount : money(row.amount),
  };
}

/**
 * Hak ediş raporu (sayfalı): durum, acente, dönem sonu aralığı, arama. Durum
 * kırılımı (adet + tutar) aynı süzgeçlerle, durum süzgeci hariç.
 *
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, status?: string, agencyId?: string, from?: Date, to?: Date, search?: string }} query
 */
export async function listBonuses(hotelId, query) {
  const hotel = await getHotelSettings(hotelId);
  const base = [];
  if (query.agencyId) base.push({ agencyId: query.agencyId });
  if (query.from) base.push({ periodEnd: { gte: query.from } });
  if (query.to) base.push({ periodEnd: { lte: query.to } });
  const text = query.search?.trim();
  if (text) {
    const agencies = await prisma.agency.findMany({
      where: { hotelId, OR: [{ name: containsText(text) }, { code: containsText(text) }] },
      select: { id: true },
      take: SEARCH_AGENCY_LIMIT,
    });
    base.push({ OR: [{ rule: { name: containsText(text) } }, ...(agencies.length ? [{ agencyId: { in: agencies.map((row) => row.id) } }] : [])] });
  }
  const scope = { hotelId, ...(base.length ? { AND: base } : {}) };
  const where = query.status ? { ...scope, status: query.status } : scope;

  const [rows, total, byStatus] = await Promise.all([
    prisma.agencyBonus.findMany({ where, orderBy: [{ periodEnd: 'desc' }, { id: 'desc' }], ...toSkipTake(query), select: BONUS_SELECT }),
    prisma.agencyBonus.count({ where }),
    prisma.agencyBonus.groupBy({ by: ['status'], where: scope, _count: { _all: true }, _sum: { amount: true } }),
  ]);
  const page = buildPage(rows.map(toBonusDto), total, query);
  return {
    ...page,
    totals: byStatus.map((row) => ({ status: row.status, count: row._count._all, amount: money(row._sum.amount ?? 0) })),
    meta: { ...page.meta, currency: hotel.currency },
  };
}

const LINE_ORDER = Object.freeze({
  REVENUE_DESC: [{ revenue: 'desc' }, { id: 'asc' }],
  NIGHTS_DESC: [{ nights: 'desc' }, { id: 'asc' }],
  CHECK_IN: [{ reservation: { checkIn: 'asc' } }, { id: 'asc' }],
});

const LINE_SELECT = Object.freeze({
  id: true,
  nights: true,
  revenue: true,
  reservation: {
    select: {
      id: true,
      confirmationCode: true,
      status: true,
      checkIn: true,
      checkOut: true,
      boardType: true,
      guest: { select: { firstName: true, lastName: true } },
      roomType: { select: { code: true, name: true } },
    },
  },
});

/** @param {any} row `LINE_SELECT` */
const toLineDto = (row) => ({
  id: row.id,
  reservationId: row.reservation.id,
  confirmationCode: row.reservation.confirmationCode,
  status: row.reservation.status,
  guestName: guestFullName(row.reservation.guest),
  roomType: row.reservation.roomType,
  boardType: row.reservation.boardType,
  checkIn: toIsoDay(row.reservation.checkIn),
  checkOut: toIsoDay(row.reservation.checkOut),
  nights: row.nights,
  revenue: money(row.revenue),
});

/**
 * @param {string} hotelId
 * @param {string} bonusId
 */
async function bonusInHotel(hotelId, bonusId) {
  const bonus = await prisma.agencyBonus.findFirst({ where: { id: bonusId, hotelId }, select: { id: true, reservationCount: true, currency: true } });
  if (!bonus) throw new NotFoundError('Hak ediş bulunamadı');
  return bonus;
}

/**
 * Hak edişin rezervasyon dökümü (sayfalı; onay kodu / misafir araması).
 * @param {string} hotelId
 * @param {string} bonusId
 * @param {{ page: number, pageSize: number, search?: string, sort: string }} query
 */
export async function listBonusLines(hotelId, bonusId, query) {
  const bonus = await bonusInHotel(hotelId, bonusId);
  const conditions = await reservationSearchConditions(hotelId, query.search);
  const where = { bonusId, hotelId, ...(conditions.length ? { reservation: { AND: conditions } } : {}) };
  const [rows, total] = await Promise.all([
    prisma.agencyBonusLine.findMany({ where, orderBy: LINE_ORDER[query.sort] ?? LINE_ORDER.REVENUE_DESC, ...toSkipTake(query), select: LINE_SELECT }),
    conditions.length ? prisma.agencyBonusLine.count({ where }) : Promise.resolve(bonus.reservationCount),
  ]);
  const page = buildPage(rows.map(toLineDto), total, query);
  return { ...page, meta: { ...page.meta, currency: bonus.currency } };
}

/**
 * Dökümün Excel parçası: ciroya göre sıralı, `AGENCY_BONUS_EXPORT_PART_SIZE`
 * satırlık parçalar (ekran parçaları sırayla çekip tek dosyada birleştirir;
 * büyük tur operatörünün on binlerce satırı tek yanıtta taşınmaz). Döküm
 * dondurulmuş olduğundan parçalar arasında değişmez.
 *
 * @param {string} hotelId
 * @param {string} bonusId
 * @param {{ part: number }} query
 */
export async function exportBonusLines(hotelId, bonusId, { part = 1 } = {}) {
  const bonus = await bonusInHotel(hotelId, bonusId);
  if (bonus.reservationCount > AGENCY_BONUS_EXPORT_MAX_LINES) {
    throw new ValidationError(
      `Döküm ${bonus.reservationCount.toLocaleString('tr-TR')} satır; Excel'e en fazla ${AGENCY_BONUS_EXPORT_MAX_LINES.toLocaleString('tr-TR')} satır aktarılır. Ekrandan sayfalı inceleyin.`,
    );
  }
  const parts = Math.max(1, Math.ceil(bonus.reservationCount / AGENCY_BONUS_EXPORT_PART_SIZE));
  if (part > parts) throw new ValidationError(`Döküm ${parts} parça; ${part}. parça yok`, { fields: { part: 'Parça numarası çok büyük' } });
  const rows = await prisma.agencyBonusLine.findMany({
    where: { bonusId, hotelId },
    orderBy: LINE_ORDER.REVENUE_DESC,
    skip: (part - 1) * AGENCY_BONUS_EXPORT_PART_SIZE,
    take: AGENCY_BONUS_EXPORT_PART_SIZE,
    select: LINE_SELECT,
  });
  return { items: rows.map(toLineDto), part, parts, total: bonus.reservationCount, currency: bonus.currency };
}

/* ══════════════════ Onaya gönderme ve karar ══════════════════ */

/**
 * Kilitli hak ediş (sürüm kontrolüyle).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} bonusId
 * @param {Date} expectedUpdatedAt
 */
async function lockedBonus(tx, hotelId, bonusId, expectedUpdatedAt) {
  await lockAgencyBonuses(tx, hotelId, [bonusId]);
  const row = await tx.agencyBonus.findFirst({ where: { id: bonusId, hotelId }, select: BONUS_SELECT });
  if (!row) throw new NotFoundError('Hak ediş bulunamadı');
  if (expectedUpdatedAt && row.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
  return row;
}

/**
 * Onay isteğindeki veri (onay penceresinde görünür; izni olmayan karar verici
 * de neyi onayladığını görsün).
 * @param {any} row
 */
function approvalData(row) {
  const quantity = (value) => formatBonusQuantity(row.metric, value, row.currency);
  return {
    Acente: `${row.agency.name} (${row.agency.code})`,
    Kural: row.rule.name,
    Dönem: formatBonusPeriod(day(row.periodStart), day(row.periodEnd)),
    Ölçüt: AGENCY_BONUS_METRIC_LABELS[row.metric],
    Uygulama: AGENCY_BONUS_MODE_LABELS[row.mode],
    Hedef: quantity(termsOf(row).target),
    Gerçekleşen: quantity(row.metric === 'NIGHTS' ? row.nights : money(row.revenue)),
    'Hedefe ulaşma': `%${money(row.scorePct).replace('.', ',')}`,
    Kademe: row.tierIndex ? `${row.tierIndex}. kademe` : 'Ulaşılmadı',
    'Vergisiz oda geliri': formatBonusQuantity('REVENUE', money(row.revenue), row.currency),
    'Prim (tavan öncesi)': formatBonusQuantity('REVENUE', money(row.grossAmount), row.currency),
    Prim: formatBonusQuantity('REVENUE', money(row.amount), row.currency),
    Rezervasyon: String(row.reservationCount),
    ...(row.missingPostings ? { Uyarı: `${row.missingPostings} gecenin oda ücreti folyoya işlenmemiş` } : {}),
    _bonusId: row.id,
  };
}

/**
 * Hak edişi onaya gönderir. Önce bayatlık denetlenir: kural hesaptan sonra
 * değiştiyse ya da bugünkü üretim hesaptakinden farklıysa gönderilemez (önce
 * yeniden hesaplanır). Prim sıfırsa onaya gitmez, gönderen kapatır.
 *
 * @param {string} hotelId
 * @param {string} bonusId
 * @param {{ expectedUpdatedAt: Date, note?: string | null }} input
 */
export async function submitBonus(hotelId, bonusId, { expectedUpdatedAt, note = null }) {
  const actor = currentActor();
  const businessDate = await businessDay(hotelId);
  await writeWithEvents(async (tx, stage) => {
    const probe = await tx.agencyBonus.findFirst({ where: { id: bonusId, hotelId }, select: { ruleId: true } });
    if (!probe) throw new NotFoundError('Hak ediş bulunamadı');
    await lockAgencyBonusRules(tx, hotelId, [probe.ruleId]);
    const before = await lockedBonus(tx, hotelId, bonusId, expectedUpdatedAt);
    if (before.status !== 'DRAFT') throw new ConflictError('Hak ediş zaten onaya gönderilmiş ya da onaylanmış', 'BONUS_NOT_DRAFT');
    if (before.rule.status !== 'ACTIVE') throw new ConflictError('Kural yürürlükte değil; hak ediş onaya gönderilemez', 'RULE_NOT_ACTIVE');
    if (before.rule.updatedAt.getTime() !== before.ruleUpdatedAt.getTime()) {
      throw new ConflictError('Kural hesaptan sonra değişti; önce hak edişi yeniden hesaplayın.', 'BONUS_STALE');
    }
    const current = await currentProduction(tx, hotelId, before, businessDate);
    const drift = productionDrift({ nights: before.nights, revenue: money(before.revenue) }, current);
    if (drift) {
      throw new ConflictError(
        `Hesaptan sonra üretim değişti (${drift.nights >= 0 ? '+' : ''}${drift.nights} gece, ${drift.revenue} ${before.currency}); önce hak edişi yeniden hesaplayın.`,
        'BONUS_STALE',
        { drift },
      );
    }

    const now = new Date();
    let after;
    if (!toDecimal(before.amount).greaterThan(0)) {
      after = await tx.agencyBonus.update({
        where: { id: bonusId },
        data: { status: 'APPROVED', approvedAt: now, approvedBy: actor, decisionNote: note || 'Prim doğmadı (kademeye ulaşılmadı); onay gerekmedi.' },
        select: BONUS_SELECT,
      });
      await stage('agency.bonus.changed', { hotelId, bonusId, ruleId: before.ruleId, agencyId: before.agencyId, change: 'APPROVED' });
    } else {
      const { approvalId } = await requestApproval(tx, stage, {
        hotelId,
        type: 'AGENCY_BONUS',
        summary: `Acente primi: ${before.agency.name} · ${formatBonusPeriod(day(before.periodStart), day(before.periodEnd))}`.slice(0, 200),
        reason: note ?? null,
        amount: money(before.amount),
        currency: before.currency,
        entityType: 'AgencyBonus',
        entityId: bonusId,
        expiresInMs: APPROVAL_TTL_MS,
        requestedBy: actor,
        data: approvalData(before),
      });
      after = await tx.agencyBonus.update({
        where: { id: bonusId },
        data: { status: 'PENDING_APPROVAL', submittedAt: now, submittedBy: actor, submitNote: note || null, approvalId, decisionNote: null },
        select: BONUS_SELECT,
      });
      await stage('agency.bonus.changed', { hotelId, bonusId, ruleId: before.ruleId, agencyId: before.agencyId, change: 'SUBMITTED' });
    }
    await recordAudit(tx, { hotelId, entity: 'AgencyBonus', entityId: bonusId, action: 'UPDATE', before: bonusSnapshot(before), after: bonusSnapshot(after) });
  });
  return getBonus(hotelId, bonusId);
}

/** Bu modülün onay türü. */
export const AGENCY_BONUS_APPROVAL_TYPE = 'AGENCY_BONUS';

/**
 * Onay kuyruğunun kararı (dinleyiciden): onaylandı → kilitli; reddedildi /
 * süresi doldu → "hesaplandı"ya döner (gerekçe görünür). Aynı haber iki kez
 * gelse de bir kez uygulanır (hak edişin onay kimliği ve durumu eşleşmezse
 * dokunulmaz). Gönderene zilde sonuç düşer.
 *
 * @param {{ hotelId: string, approvalId: string, type: string, decidedBy?: string }} payload
 * @param {{ name: string }} envelope
 */
export async function applyBonusDecision(payload, envelope) {
  if (payload?.type !== AGENCY_BONUS_APPROVAL_TYPE) return { handled: false };
  const { hotelId } = payload;
  const approval = await prismaUnfiltered.approval.findFirst({
    where: { id: payload.approvalId, hotelId },
    select: { id: true, status: true, note: true, decidedBy: true, decidedAt: true, summary: true },
  });
  if (!approval) return { handled: false };

  return writeWithEvents(async (tx, stage) => {
    const found = await tx.agencyBonus.findFirst({ where: { hotelId, approvalId: approval.id }, select: { id: true } });
    if (!found) return { handled: true, stale: true };
    await lockAgencyBonuses(tx, hotelId, [found.id]);
    const before = await tx.agencyBonus.findFirst({ where: { id: found.id }, select: BONUS_SELECT });
    if (before.status !== 'PENDING_APPROVAL' || before.approvalId !== approval.id) return { handled: true, stale: true };

    const decidedBy = approval.decidedBy ?? payload.decidedBy ?? SYSTEM_ACTOR;
    const granted = envelope.name === 'approval.granted';
    const denied = envelope.name === 'approval.denied';
    const data = granted
      ? { status: 'APPROVED', approvedAt: approval.decidedAt ?? new Date(), approvedBy: decidedBy, decisionNote: approval.note ?? null }
      : {
          status: 'DRAFT',
          submittedAt: null,
          submittedBy: null,
          submitNote: null,
          approvalId: null,
          decisionNote: denied ? `Reddedildi (${decidedBy}): ${approval.note ?? 'gerekçe yazılmadı'}` : 'Onay süresi doldu; yeniden onaya gönderin.',
        };
    const after = await tx.agencyBonus.update({ where: { id: before.id }, data, select: BONUS_SELECT });
    await recordAudit(tx, { hotelId, entity: 'AgencyBonus', entityId: before.id, action: 'UPDATE', before: bonusSnapshot(before), after: bonusSnapshot(after) });
    const change = granted ? 'APPROVED' : denied ? 'REJECTED' : 'EXPIRED';
    await stage('agency.bonus.changed', { hotelId, bonusId: before.id, ruleId: before.ruleId, agencyId: before.agencyId, change });

    const submitter = before.submittedBy?.includes('@') ? await findActiveStaffByEmail(tx, hotelId, before.submittedBy.toLowerCase()) : null;
    const titles = {
      APPROVED: `Prim hak edişi onaylandı: ${before.agency.name}`,
      REJECTED: `Prim hak edişi reddedildi: ${before.agency.name}`,
      EXPIRED: `Prim hak edişi onayının süresi doldu: ${before.agency.name}`,
    };
    await raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'APPROVAL_DECIDED',
      severity: granted ? 'INFO' : 'WARNING',
      title: titles[change],
      body: granted
        ? `${formatBonusQuantity('REVENUE', money(before.amount), before.currency)} · ${decidedBy} onayladı. Ödeme muhasebede işaretlenir.`
        : after.decisionNote,
      link: bonusLink(before.id),
      userId: submitter?.id ?? null,
      permission: submitter ? null : PERMISSIONS.AGENCY_BONUS_MANAGE,
      entityType: 'AgencyBonus',
      entityId: before.id,
      dedupeKey: `agency-bonus-decided:${approval.id}`,
    });
    return { handled: true, applied: change };
  });
}

/* ══════════════════ Ödeme ve yeniden açma ══════════════════ */

/**
 * Onaylı hak edişi "ödendi" işaretler (tarih + belge no). Ödeme tarihi iş
 * gününden sonra ve onay gününden önce olamaz. Prim sıfırsa ödeme yoktur.
 *
 * @param {string} hotelId
 * @param {string} bonusId
 * @param {{ expectedUpdatedAt: Date, paidAt: Date, paymentRef: string, note?: string | null }} input
 */
export async function markBonusPaid(hotelId, bonusId, { expectedUpdatedAt, paidAt, paymentRef, note = null }) {
  const actor = currentActor();
  const [businessDate, hotel] = await Promise.all([businessDay(hotelId), getHotelSettings(hotelId)]);
  await writeWithEvents(async (tx, stage) => {
    const before = await lockedBonus(tx, hotelId, bonusId, expectedUpdatedAt);
    if (before.status !== 'APPROVED') throw new ConflictError('Yalnızca onaylı hak ediş ödendi işaretlenir', 'BONUS_NOT_APPROVED');
    if (!toDecimal(before.amount).greaterThan(0)) throw new ConflictError('Prim doğmamış hak edişin ödemesi olmaz', 'BONUS_ZERO');
    const paidDay = toIsoDay(paidAt);
    if (paidDay > businessDate) throw new ValidationError('Ödeme tarihi ileri bir gün olamaz', { fields: { paidAt: 'Ödeme tarihi ileri bir gün olamaz' } });
    const approvedDay = toIsoDay(calendarDateInTimeZone(hotel.timezone, before.approvedAt));
    if (paidDay < approvedDay) {
      throw new ValidationError('Ödeme tarihi onay gününden önce olamaz', { fields: { paidAt: `Onay günü ${approvedDay}; ödeme bundan önce olamaz` } });
    }
    const after = await tx.agencyBonus.update({
      where: { id: bonusId },
      data: { status: 'PAID', paidAt, paidBy: actor, paidRecordedAt: new Date(), paymentRef, paymentNote: note || null },
      select: BONUS_SELECT,
    });
    await recordAudit(tx, { hotelId, entity: 'AgencyBonus', entityId: bonusId, action: 'UPDATE', before: bonusSnapshot(before), after: bonusSnapshot(after) });
    await stage('agency.bonus.changed', { hotelId, bonusId, ruleId: before.ruleId, agencyId: before.agencyId, change: 'PAID' });
  });
  return getBonus(hotelId, bonusId);
}

/**
 * Ödeme işaretini gerekçeyle geri alır (yanlış hak edişe işaretlendi, ödeme
 * iade döndü). Hak ediş onaylı duruma döner.
 *
 * @param {string} hotelId
 * @param {string} bonusId
 * @param {{ expectedUpdatedAt: Date, reason: string }} input
 */
export async function revertBonusPayment(hotelId, bonusId, { expectedUpdatedAt, reason }) {
  await writeWithEvents(async (tx, stage) => {
    const before = await lockedBonus(tx, hotelId, bonusId, expectedUpdatedAt);
    if (before.status !== 'PAID') throw new ConflictError('Hak ediş ödendi işaretli değil', 'BONUS_NOT_PAID');
    const after = await tx.agencyBonus.update({
      where: { id: bonusId },
      data: { status: 'APPROVED', paidAt: null, paidBy: null, paidRecordedAt: null, paymentRef: null, paymentNote: null },
      select: BONUS_SELECT,
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'AgencyBonus',
      entityId: bonusId,
      action: 'UPDATE',
      before: bonusSnapshot(before),
      after: { ...bonusSnapshot(after), reason: `Ödeme işareti geri alındı: ${reason}` },
    });
    await stage('agency.bonus.changed', { hotelId, bonusId, ruleId: before.ruleId, agencyId: before.agencyId, change: 'PAYMENT_REVERTED' });
  });
  return getBonus(hotelId, bonusId);
}

/**
 * Onaylı ama ödenmemiş hak edişi gerekçeyle yeniden açar (sürüm artar):
 * düzeltme yapılır, yeniden hesaplanır ve yeniden onaya gider.
 *
 * @param {string} hotelId
 * @param {string} bonusId
 * @param {{ expectedUpdatedAt: Date, reason: string }} input
 */
export async function reopenBonus(hotelId, bonusId, { expectedUpdatedAt, reason }) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const before = await lockedBonus(tx, hotelId, bonusId, expectedUpdatedAt);
    if (before.status === 'PAID') throw new ConflictError('Ödenmiş hak ediş yeniden açılmaz; önce ödeme işaretini geri alın.', 'BONUS_PAID');
    if (before.status !== 'APPROVED') throw new ConflictError('Yalnızca onaylı hak ediş yeniden açılır', 'BONUS_NOT_APPROVED');
    const after = await tx.agencyBonus.update({
      where: { id: bonusId },
      data: {
        status: 'DRAFT',
        revision: before.revision + 1,
        submittedAt: null,
        submittedBy: null,
        submitNote: null,
        approvalId: null,
        approvedAt: null,
        approvedBy: null,
        decisionNote: null,
        reopenedAt: new Date(),
        reopenedBy: actor,
        reopenReason: reason,
      },
      select: BONUS_SELECT,
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'AgencyBonus',
      entityId: bonusId,
      action: 'UPDATE',
      before: bonusSnapshot(before),
      after: { ...bonusSnapshot(after), reason: `Yeniden açıldı: ${reason}` },
    });
    await stage('agency.bonus.changed', { hotelId, bonusId, ruleId: before.ruleId, agencyId: before.agencyId, change: 'REOPENED' });
  });
  return getBonus(hotelId, bonusId);
}

