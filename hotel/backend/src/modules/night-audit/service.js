import { addDays, calendarDateInTimeZone, currentActor, sum, toIsoDay, toMoneyString } from '@hotelos/core';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate, invalidateBusinessDate } from '../../lib/business-date.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { writeWithEvents } from '../../lib/write.js';
import { runRoomCharges } from '../folios/service.js';
import { loadSellable } from '../reports/queries.js';
import { markNoShowBatch } from '../reservations/service.js';
import { getHotelSettings } from '../settings/service.js';
import { adr, occupancyPct, reconcileCash, revpar } from './rules.js';

/* ───────────────────────── Yardımcılar (okuma) ───────────────────────── */

/** Gün başı `Date` (UTC) → Prisma `@db.Date` filtrelerinde kullanılan değer. */
const dayStart = (iso) => new Date(`${iso}T00:00:00.000Z`);

/**
 * İş günü takvim gününden ileri olamaz: gün dönmeden (gece 24:00 geçmeden) o
 * günü kapatıp ertesine geçilemez. İlk kapanıştan sonra iş günü = yarın; bir
 * sonraki kapanış ancak takvim yarına ulaşınca yapılır (çift kapanışı da önler).
 *
 * @param {string} hotelId @param {string} iso iş günü @param {Date} now
 */
async function assertDayArrived(hotelId, iso, now) {
  const { timezone } = await getHotelSettings(hotelId);
  const calendar = toIsoDay(calendarDateInTimeZone(timezone, now));
  if (iso > calendar) throw new ConflictError('Gün henüz gelmedi; kapatılamaz.', 'DAY_NOT_ARRIVED');
}

/**
 * Giriş günü gelmiş ama gelmemiş konaklamalar (gelmedi adayları).
 * @param {string} hotelId @param {Date} businessDate
 */
function loadNoShowCandidates(hotelId, businessDate) {
  return prisma.reservation.findMany({
    where: {
      hotelId,
      status: { in: ['CONFIRMED', 'PENDING'] },
      checkIn: { lte: businessDate },
      deletedAt: null,
    },
    select: { id: true, confirmationCode: true, checkIn: true, updatedAt: true },
    orderBy: { checkIn: 'asc' },
  });
}

/** O gece içeride olan (satılan) oda sayısı. */
function countInHouse(hotelId, businessDate) {
  return prisma.reservation.count({
    where: { hotelId, status: 'CHECKED_IN', checkIn: { lte: businessDate }, checkOut: { gt: businessDate }, deletedAt: null },
  });
}

/** O güne işlenmiş net oda geliri (vergi hariç). */
async function sumRoomRevenue(hotelId, businessDate) {
  const row = await prisma.folioItem.aggregate({
    _sum: { netAmount: true },
    where: { hotelId, source: 'ROOM_NIGHT', serviceDate: businessDate, deletedAt: null },
  });
  return toMoneyString(row._sum.netAmount ?? 0);
}

/** Günün tahsilatı yöntem bazında (kasanın beklediği). */
async function loadExpectedCash(hotelId, businessDate) {
  const rows = await prisma.payment.groupBy({
    by: ['method'],
    where: { hotelId, status: 'POSTED', businessDate, deletedAt: null, voidedAt: null },
    _sum: { folioAmount: true },
  });
  return rows.map((row) => ({ method: row.method, expected: toMoneyString(row._sum.folioAmount ?? 0) }));
}

/** Satılabilir oda (toplam − arızalı) o gün için. */
async function countSellable(hotelId, iso) {
  const [row] = await loadSellable(prisma, hotelId, iso, iso);
  if (!row) return 0;
  return Number(row.rooms) - Number(row.outOfOrder ?? 0);
}

/* ───────────────────────── Durum / önizleme ───────────────────────── */

/**
 * Gün kapanış ekranının durumu: hangi gün kapatılacak, kapanış başladı mı,
 * ve sihirbazın göstereceği önizlemeler (gelmeyenler, içerideki oda, beklenen
 * kasa, tahsilat).
 *
 * @param {string} hotelId
 * @param {{ now?: Date }} [options]
 */
export async function getAuditStatus(hotelId, { now = new Date() } = {}) {
  const businessDate = await getBusinessDate(hotelId, now);
  const iso = toIsoDay(businessDate);
  const [hotel, current, candidates, inHouse, expectedCash, lastClosure] = await Promise.all([
    getHotelSettings(hotelId),
    prisma.nightAudit.findFirst({ where: { hotelId, date: businessDate, deletedAt: null }, select: { id: true, status: true, startedAt: true, startedBy: true } }),
    loadNoShowCandidates(hotelId, businessDate),
    countInHouse(hotelId, businessDate),
    loadExpectedCash(hotelId, businessDate),
    prisma.nightAudit.findFirst({ where: { hotelId, status: 'CLOSED', deletedAt: null }, orderBy: { date: 'desc' }, select: { date: true, closedAt: true, closedBy: true } }),
  ]);

  return {
    businessDay: iso,
    currency: hotel.currency,
    status: current?.status ?? 'OPEN',
    startedAt: current?.startedAt?.toISOString() ?? null,
    startedBy: current?.startedBy ?? null,
    noShows: candidates.map((row) => ({ id: row.id, confirmationCode: row.confirmationCode, checkIn: toIsoDay(row.checkIn) })),
    inHouse,
    expectedCash,
    collections: toMoneyString(sum(...expectedCash.map((row) => row.expected))),
    lastClosure: lastClosure ? { day: toIsoDay(lastClosure.date), closedAt: lastClosure.closedAt?.toISOString() ?? null, closedBy: lastClosure.closedBy } : null,
  };
}

/* ───────────────────────── Kapanış akışı ───────────────────────── */

/**
 * Gün kapanışını başlatır: IN_PROGRESS kaydı (iki görevli aynı anda kapatmasın).
 * İş gününü ilerletmez; yalnızca kapanış kapatınca ilerler.
 *
 * @param {string} hotelId
 * @param {{ now?: Date }} [options]
 */
export async function startNightAudit(hotelId, { now = new Date() } = {}) {
  const businessDate = await getBusinessDate(hotelId, now);
  const iso = toIsoDay(businessDate);
  const actor = currentActor();
  await assertDayArrived(hotelId, iso, now);
  const existing = await prisma.nightAudit.findFirst({ where: { hotelId, date: businessDate, deletedAt: null }, select: { id: true, status: true } });
  if (existing?.status === 'CLOSED') throw new ConflictError('Bu gün zaten kapatıldı.', 'ALREADY_CLOSED');
  if (existing) return getAuditStatus(hotelId, { now });

  await writeWithEvents(async (tx, stage) => {
    const audit = await tx.nightAudit.create({ data: { hotelId, date: businessDate, status: 'IN_PROGRESS', startedBy: actor } });
    await recordAudit(tx, { hotelId, entity: 'NightAudit', entityId: audit.id, action: 'CREATE', after: { date: iso, status: 'IN_PROGRESS' } });
    await stage('night.audit.started', { hotelId, businessDay: iso });
  });
  return getAuditStatus(hotelId, { now });
}

/**
 * Günü kapatır (sihirbazın "Kapat" adımı):
 *   1. gelmeyenleri NO_SHOW yapar (envanter serbest kalır, ücret policy ile),
 *   2. içerideki bütün odalara o gecenin oda ücretini basar,
 *   3. günlük özeti (doluluk, gelir, ADR, RevPAR, tahsilat) yazar,
 *   4. kasa sayımını ShiftReport'a kaydeder,
 *   5. iş gününü ilerletir ve `night.audit.closed` yayınlar.
 *
 * Tekrar çağrılamaz: gün kapandıysa hata verir (sihirbaz durumdan anlar).
 *
 * @param {string} hotelId
 * @param {{ counts?: Array<{ method: string, counted: string }>, note?: string, waiveNoShowFees?: boolean }} input
 * @param {{ now?: Date }} [options]
 */
export async function closeDay(hotelId, input, { now = new Date() } = {}) {
  const businessDate = await getBusinessDate(hotelId, now);
  const iso = toIsoDay(businessDate);
  const actor = currentActor();

  await assertDayArrived(hotelId, iso, now);
  const existing = await prisma.nightAudit.findFirst({ where: { hotelId, date: businessDate, deletedAt: null }, select: { id: true, status: true } });
  if (existing?.status === 'CLOSED') throw new ConflictError('Bu gün zaten kapatıldı.', 'ALREADY_CLOSED');

  // 1. Gelmeyenler (tek tek işlemin kuralıyla; biri düşmezse diğerleri sürer).
  const candidates = await loadNoShowCandidates(hotelId, businessDate);
  const noShowResult = candidates.length
    ? await markNoShowBatch(hotelId, candidates.map((row) => ({ id: row.id, expectedUpdatedAt: row.updatedAt })), { waiveFee: input.waiveNoShowFees ?? false })
    : { succeeded: 0, failed: 0, results: [] };

  // 2. O gecenin oda ücretleri (kapanış geceyi "bitti" sayar → allowCurrent).
  const charges = await runRoomCharges(hotelId, { night: iso, allowCurrent: true });

  // 3+4. Özet ve kasa için okumalar (ücretler işlendikten sonra).
  const [sellable, sold, roomRevenue, expectedCash, hotel] = await Promise.all([
    countSellable(hotelId, iso),
    countInHouse(hotelId, businessDate),
    sumRoomRevenue(hotelId, businessDate),
    loadExpectedCash(hotelId, businessDate),
    getHotelSettings(hotelId),
  ]);
  const cash = reconcileCash(expectedCash, input.counts ?? []);
  const collections = cash.countedTotal;

  // 5. Kapanış transaction'ı: NightAudit CLOSED + ShiftReport + DailyStats + olay.
  await writeWithEvents(async (tx, stage, afterCommit) => {
    const audit = existing
      ? await tx.nightAudit.update({
          where: { id: existing.id },
          data: { status: 'CLOSED', closedAt: new Date(), closedBy: actor, noShowCount: noShowResult.succeeded, roomChargeStays: charges.stays, roomChargeTotal: charges.total, notes: input.note ?? null },
        })
      : await tx.nightAudit.create({
          data: { hotelId, date: businessDate, status: 'CLOSED', startedBy: actor, closedAt: new Date(), closedBy: actor, noShowCount: noShowResult.succeeded, roomChargeStays: charges.stays, roomChargeTotal: charges.total, notes: input.note ?? null },
        });

    await tx.shiftReport.create({
      data: {
        hotelId,
        nightAuditId: audit.id,
        date: businessDate,
        counts: cash.counts,
        expectedTotal: cash.expectedTotal,
        countedTotal: cash.countedTotal,
        variance: cash.variance,
        note: input.note ?? null,
        handedOverBy: actor,
      },
    });

    await tx.dailyStats.upsert({
      where: { hotelId_day: { hotelId, day: businessDate } },
      create: {
        hotelId,
        day: businessDate,
        currency: hotel.currency,
        roomsSellable: sellable,
        roomsSold: sold,
        occupancyPct: occupancyPct(sold, sellable),
        roomRevenue,
        adr: adr(roomRevenue, sold),
        revpar: revpar(roomRevenue, sellable),
        collections,
      },
      update: {
        currency: hotel.currency,
        roomsSellable: sellable,
        roomsSold: sold,
        occupancyPct: occupancyPct(sold, sellable),
        roomRevenue,
        adr: adr(roomRevenue, sold),
        revpar: revpar(roomRevenue, sellable),
        collections,
        closedAt: new Date(),
      },
    });

    await recordAudit(tx, {
      hotelId,
      entity: 'NightAudit',
      entityId: audit.id,
      action: 'UPDATE',
      after: { date: iso, status: 'CLOSED', noShows: noShowResult.succeeded, roomChargeStays: charges.stays, variance: cash.variance },
    });

    await stage('night.audit.closed', {
      hotelId,
      businessDay: iso,
      noShows: noShowResult.succeeded,
      roomChargeStays: charges.stays,
      roomChargeTotal: toMoneyString(charges.total),
    });

    // İş günü ancak kapanış işlendikten sonra ilerlesin.
    afterCommit(() => invalidateBusinessDate(hotelId));
  });

  return { ...(await getClosure(hotelId, iso)), noShowFailures: noShowResult.failed };
}

/* ───────────────────────── Geçmiş / ayrıntı ───────────────────────── */

/**
 * Kapanış geçmişi (sayfalı): kapanmış günler, kasa farkı ve özet göstergeler.
 * @param {string} hotelId @param {{ page?: number, pageSize?: number }} query
 */
export async function listClosures(hotelId, query) {
  const { skip, take } = toSkipTake(query);
  const [rows, total] = await Promise.all([
    prisma.nightAudit.findMany({
      where: { hotelId, status: 'CLOSED', deletedAt: null },
      orderBy: { date: 'desc' },
      skip,
      take,
      include: { shiftReport: true },
    }),
    prisma.nightAudit.count({ where: { hotelId, status: 'CLOSED', deletedAt: null } }),
  ]);

  const days = rows.map((row) => toIsoDay(row.date));
  const stats = await prisma.dailyStats.findMany({ where: { hotelId, day: { in: rows.map((row) => row.date) } } });
  const statByDay = new Map(stats.map((row) => [toIsoDay(row.day), row]));

  return buildPage(
    rows.map((row) => toClosureDto(row, statByDay.get(toIsoDay(row.date)))),
    total,
    query,
  );
}

/**
 * Bir kapanışın ayrıntısı (devir raporu PDF'inin kaynağı).
 * @param {string} hotelId @param {string} iso "YYYY-AA-GG"
 */
export async function getClosure(hotelId, iso) {
  const day = dayStart(iso);
  const [audit, stat] = await Promise.all([
    prisma.nightAudit.findFirst({ where: { hotelId, date: day, deletedAt: null }, include: { shiftReport: true } }),
    prisma.dailyStats.findFirst({ where: { hotelId, day } }),
  ]);
  if (!audit) throw new NotFoundError('Kapanış kaydı bulunamadı');
  return toClosureDto(audit, stat);
}

function toClosureDto(audit, stat) {
  return {
    day: toIsoDay(audit.date),
    status: audit.status,
    startedAt: audit.startedAt?.toISOString() ?? null,
    startedBy: audit.startedBy,
    closedAt: audit.closedAt?.toISOString() ?? null,
    closedBy: audit.closedBy,
    noShowCount: audit.noShowCount,
    roomChargeStays: audit.roomChargeStays,
    roomChargeTotal: toMoneyString(audit.roomChargeTotal),
    notes: audit.notes,
    shift: audit.shiftReport
      ? {
          counts: audit.shiftReport.counts,
          expectedTotal: toMoneyString(audit.shiftReport.expectedTotal),
          countedTotal: toMoneyString(audit.shiftReport.countedTotal),
          variance: toMoneyString(audit.shiftReport.variance),
          note: audit.shiftReport.note,
          handedOverBy: audit.shiftReport.handedOverBy,
        }
      : null,
    stats: stat
      ? {
          currency: stat.currency,
          roomsSellable: stat.roomsSellable,
          roomsSold: stat.roomsSold,
          occupancyPct: toMoneyString(stat.occupancyPct),
          roomRevenue: toMoneyString(stat.roomRevenue),
          adr: toMoneyString(stat.adr),
          revpar: toMoneyString(stat.revpar),
          collections: toMoneyString(stat.collections),
        }
      : null,
  };
}
