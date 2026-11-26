import { CHAIN_COMPUTE_CONCURRENCY, PERMISSIONS } from '@hotelos/hotel-contracts';
import { AppError } from '../../lib/errors.js';
import { getDashboardToday } from '../dashboard/service.js';
import { getRevenueReport } from '../reports/service.js';
import { requireGroupOf, visibleGroupHotels } from './access.js';
import { dashboardTotalsByCurrency, reportTotalsByCurrency, settleWithConcurrency } from './rules.js';

/**
 * Zincir panosu ve zincir raporu (modül 63).
 *
 * Her otel kendi servisiyle hesaplanır (günlük durum: modül 13, gelir raporu: modül 23): rakam tanımları otel
 * ekranlarındakiyle aynıdır, iki ayrı "doluluk" tanımı oluşmaz. Oteller eşzamanlılık sınırıyla hesaplanır; biri
 * hesaplanamazsa (zaman aşımı) diğerleri yine gelir, o satır hata olarak işaretlenir. Para birimleri karıştırılmaz.
 */

const hotelHead = (hotel) => ({ hotelId: hotel.id, name: hotel.name, code: hotel.code, currency: hotel.currency, role: hotel.role });

/** Beklenen (kullanıcıya söylenebilir) hata mesajı; beklenmeyen hata loglanır, ekrana genel mesaj gider. */
function failure(error, logger) {
  if (error instanceof AppError && error.statusCode < 500) return error.message;
  if (error instanceof AppError && error.code === 'REPORT_TIMEOUT') return error.message;
  logger?.error?.({ err: error }, 'Zincir: otel hesaplanamadı');
  return 'Bu otelin rakamları şu an hesaplanamadı';
}

/**
 * Bugünün durumu, otel otel ve para birimine göre toplam.
 * @param {Awaited<ReturnType<typeof import('./access.js').loadActor>>} actor
 * @param {{ logger?: any, now?: Date }} [options]
 */
export async function getChainDashboard(actor, { logger, now = new Date() } = {}) {
  const group = await requireGroupOf(actor.currentHotelId);
  const { hotels, hidden } = await visibleGroupHotels(actor, group.id, PERMISSIONS.CHAIN_VIEW);
  const results = await settleWithConcurrency(hotels, CHAIN_COMPUTE_CONCURRENCY, (hotel) => getDashboardToday(hotel.id, { now }));

  const rows = hotels.map((hotel, index) => {
    const result = results[index];
    if (!result.ok) return { ...hotelHead(hotel), error: failure(result.error, logger) };
    const day = result.value;
    return {
      ...hotelHead(hotel),
      currency: day.currency,
      businessDate: day.businessDate,
      totalRooms: day.totalRooms,
      sold: day.today.sold,
      sellable: day.today.sellable,
      occupancyPct: day.today.occupancyPct,
      pendingSold: day.today.pendingSold,
      outOfOrder: day.today.outOfOrder,
      arrivals: day.arrivals.expected,
      arrivalsLate: day.arrivals.late ?? 0,
      departures: day.departures.expected,
      departuresOverdue: day.departures.overdue,
      inHouse: day.inHouse,
      revenue: day.today.revenue,
      adr: day.today.adr,
      revpar: day.today.revpar,
      yesterdayOccupancyPct: day.yesterday.occupancyPct,
      thresholds: day.thresholds,
      error: null,
    };
  });
  const ok = rows.filter((row) => !row.error);
  return {
    group: { id: group.id, name: group.name },
    hotels: rows,
    totals: dashboardTotalsByCurrency(ok),
    hiddenHotels: hidden,
    failedHotels: rows.length - ok.length,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Aralığın karşılaştırmalı rakamları: doluluk, satılan / satılabilir, oda geliri, toplam gelir, ADR, RevPAR, geçen yıl.
 * @param {{ from: string, to: string }} range
 * @param {{ logger?: any, now?: Date }} [options]
 */
export async function getChainReport(actor, { from, to }, { logger, now = new Date() } = {}) {
  const group = await requireGroupOf(actor.currentHotelId);
  const { hotels, hidden } = await visibleGroupHotels(actor, group.id, PERMISSIONS.CHAIN_VIEW);
  const results = await settleWithConcurrency(hotels, CHAIN_COMPUTE_CONCURRENCY, (hotel) => getRevenueReport(hotel.id, { from, to, groupBy: 'MONTH' }, { now }));

  const rows = hotels.map((hotel, index) => {
    const result = results[index];
    if (!result.ok) return { ...hotelHead(hotel), error: failure(result.error, logger) };
    const report = result.value;
    const { totals } = report;
    return {
      ...hotelHead(hotel),
      currency: report.currency,
      businessDate: report.businessDate,
      sold: totals.sold,
      sellable: totals.sellable,
      occupancyPct: totals.occupancyPct,
      roomRevenue: totals.roomRevenue,
      totalRevenue: totals.totalRevenue,
      adr: totals.adr,
      revpar: totals.revpar,
      lastYear: { sold: totals.lastYear.sold, sellable: totals.lastYear.sellable, occupancyPct: totals.lastYear.occupancyPct, roomRevenue: totals.lastYear.roomRevenue },
      change: { occupancyPts: totals.change.occupancyPts, roomRevenue: totals.change.roomRevenue, adr: totals.change.adr, revpar: totals.change.revpar },
      otherCurrencyNights: report.otherCurrencyNights,
      error: null,
    };
  });
  const ok = rows.filter((row) => !row.error);
  return {
    group: { id: group.id, name: group.name },
    from,
    to,
    hotels: rows,
    totals: reportTotalsByCurrency(ok),
    hiddenHotels: hidden,
    failedHotels: rows.length - ok.length,
    generatedAt: new Date().toISOString(),
  };
}
