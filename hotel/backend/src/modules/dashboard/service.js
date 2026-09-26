import { addDays, toIsoDay } from '@hotelos/core';
import {
  DASHBOARD_FAULT_LIST_LIMIT,
  DASHBOARD_WEEK_DAYS,
  DASHBOARD_WEEK_MAX_OFFSET_DAYS,
} from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ValidationError } from '../../lib/errors.js';
import { LIVE_SCOPES, liveVersion } from '../../lib/live-version.js';
import { createReadCache } from '../../lib/read-cache.js';
import { sqlTimestamp } from '../../lib/sql-time.js';
import { getFrontDeskSummary } from '../front-desk/service.js';
import { planDays, summarizeDays } from '../plan/rules.js';
import { loadSummarySource } from '../plan/service.js';
import { getHotelSettings } from '../settings/service.js';
import { dayRow, revenueByDay, roomStates, weekWindow } from './rules.js';

/**
 * Günlük durum ekranı (modül 13): müdürün sabah baktığı tek ekran.
 *
 * ### Tanımlar
 *
 * Doluluk, satılan ve satılabilir oda oda planının gün özetinden
 * (`summarizeDays`) gelir; iki ekranın sayısı hiçbir zaman ayrışmaz. Gelecek
 * ve gidecek sayıları ön büro özetinden (`getFrontDeskSummary`) gelir; kart
 * tıklanınca açılan ön büro listesiyle aynı sayılar.
 *
 * Gelir, gece fiyatlarından (`ReservationNight`) aynı "sayılan gece"
 * kuralıyla toplanır: bekleyen, onaylı ve içerideki konaklamanın her gecesi;
 * çıkış yapmış konaklamanın yalnızca geçmiş geceleri (erken çıkışta ileriki
 * geceler gelir sayılmaz).
 *
 * ### Yük
 *
 * Ekran her panelde açık durabilir. Cevap otel × canlı sürüm × iş günü
 * anahtarıyla önbelleklenir (`read-cache`): envanteri, rezervasyonu ya da oda
 * durumunu değiştiren her olay sürümü artırır, eski cevap bir daha okunmaz;
 * aynı anda gelen istekler tek hesaplamayı bekler. Hesaplama sorguları otel
 * kapsamlı index'lerden okur: oda planı özeti (bir günlük / haftalık pencere),
 * gece geliri `(hotelId, date)`, oda sayımları `(hotelId, …)`.
 */

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 5000;
const cache = createReadCache({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX_ENTRIES });

/**
 * Pencerenin gece gelirleri (gün × para birimi). Sayılan gece kuralı oda
 * planınınkiyle aynıdır (`summarizeDays` → `countsNight`).
 *
 * @param {string} hotelId
 * @param {{ from: Date, to: Date }} window
 * @param {Date} businessDate
 */
function loadNightRevenue(hotelId, { from, to }, businessDate) {
  return prisma.$queryRaw`
    SELECT n."date" AS "date",
           r."currency" AS "currency",
           SUM(n."amount") AS "amount",
           COUNT(*)::int AS "nights",
           (COUNT(*) FILTER (WHERE r."status" = 'PENDING'))::int AS "pendingNights"
    FROM "ReservationNight" n
    JOIN "Reservation" r ON r."id" = n."reservationId"
    WHERE n."hotelId" = ${hotelId}
      AND r."hotelId" = ${hotelId}
      AND n."date" >= ${sqlTimestamp(from)}
      AND n."date" < ${sqlTimestamp(to)}
      AND n."deletedAt" IS NULL
      AND r."deletedAt" IS NULL
      AND (r."status" IN ('PENDING', 'CONFIRMED', 'CHECKED_IN')
           OR (r."status" = 'CHECKED_OUT' AND n."date" < ${sqlTimestamp(businessDate)}))
    GROUP BY n."date", r."currency"`;
}

/**
 * Anlık oda durumu tek sorguda. "Hazır boş oda": boş, temiz ya da kontrol
 * edilmiş ve bugün arıza kaydı (arızalı ya da hizmet dışı) olmayan oda.
 *
 * @param {string} hotelId
 * @param {Date} businessDate
 */
async function loadRoomStates(hotelId, businessDate) {
  const today = sqlTimestamp(businessDate);
  const [row] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS "total",
           (COUNT(*) FILTER (WHERE r."occupancy" = 'OCCUPIED'))::int AS "occupied",
           (COUNT(*) FILTER (WHERE r."occupancy" = 'VACANT'))::int AS "vacant",
           (COUNT(*) FILTER (WHERE r."housekeepingStatus" = 'DIRTY'))::int AS "dirty",
           (COUNT(*) FILTER (WHERE r."housekeepingStatus" = 'CLEANING'))::int AS "cleaning",
           (COUNT(*) FILTER (WHERE r."housekeepingStatus" = 'CLEAN'))::int AS "clean",
           (COUNT(*) FILTER (WHERE r."housekeepingStatus" = 'INSPECTED'))::int AS "inspected",
           (COUNT(*) FILTER (
              WHERE r."occupancy" = 'VACANT'
                AND r."housekeepingStatus" IN ('CLEAN', 'INSPECTED')
                AND NOT EXISTS (
                  SELECT 1 FROM "RoomBlock" b
                  WHERE b."hotelId" = ${hotelId} AND b."roomId" = r."id" AND b."deletedAt" IS NULL
                    AND b."startDate" <= ${today} AND (b."endDate" IS NULL OR b."endDate" > ${today})
                )
           ))::int AS "vacantReady"
    FROM "Room" r
    WHERE r."hotelId" = ${hotelId} AND r."deletedAt" IS NULL`;
  return roomStates(row);
}

/**
 * Bugün süren arıza kayıtları (arızalı + hizmet dışı): sayı ve en eskiden
 * başlayan kısa liste. Silinmiş odanın kaydı sayılmaz.
 *
 * @param {string} hotelId
 * @param {Date} businessDate
 */
async function loadOpenFaults(hotelId, businessDate) {
  const where = {
    hotelId,
    startDate: { lte: businessDate },
    OR: [{ endDate: null }, { endDate: { gt: businessDate } }],
    room: { deletedAt: null },
  };
  const [total, rows] = await Promise.all([
    prisma.roomBlock.count({ where }),
    prisma.roomBlock.findMany({
      where,
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      take: DASHBOARD_FAULT_LIST_LIMIT,
      select: { id: true, type: true, reason: true, startDate: true, endDate: true, room: { select: { id: true, number: true } } },
    }),
  ]);
  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      reason: row.reason,
      roomId: row.room.id,
      roomNumber: row.room.number,
      startDate: toIsoDay(row.startDate),
      endDate: row.endDate ? toIsoDay(row.endDate) : null,
    })),
  };
}

/**
 * Önbellek anahtarı: envanter (rezervasyon, oda durumu, arıza) ve
 * rezervasyon (giriş / çıkış) sürümleri ve iş günü.
 * @param {string} kind
 * @param {string} hotelId
 * @param {Date} businessDate
 * @param {string} [extra]
 */
const cacheKey = (kind, hotelId, businessDate, extra = '') =>
  JSON.stringify([
    kind,
    hotelId,
    liveVersion(LIVE_SCOPES.INVENTORY, hotelId),
    liveVersion(LIVE_SCOPES.RESERVATIONS, hotelId),
    toIsoDay(businessDate),
    extra,
  ]);

/**
 * Bugünün durumu: doluluk, gelecek / gidecek, anlık oda durumu, bu gecenin
 * oda geliri ve ADR, açık arızalar.
 *
 * @param {string} hotelId
 * @param {{ now?: Date }} [options]
 */
export async function getDashboardToday(hotelId, { now = new Date() } = {}) {
  const businessDate = await getBusinessDate(hotelId, now);
  return cache.get(cacheKey('today', hotelId, businessDate), async () => {
    const window = { from: businessDate, to: addDays(businessDate, 1) };
    const [hotel, source, frontDesk, rooms, revenueRows, faults] = await Promise.all([
      getHotelSettings(hotelId),
      loadSummarySource(hotelId, window),
      getFrontDeskSummary(hotelId, { now }),
      loadRoomStates(hotelId, businessDate),
      loadNightRevenue(hotelId, window, businessDate),
      loadOpenFaults(hotelId, businessDate),
    ]);
    const [summary] = summarizeDays({ ...source, from: businessDate, days: 1, businessDate });
    const revenue = revenueByDay(revenueRows, [summary.date], hotel.currency);
    return {
      businessDate: toIsoDay(businessDate),
      currency: hotel.currency,
      totalRooms: source.totalRooms,
      today: dayRow(summary, revenue.get(summary.date)),
      arrivals: frontDesk.arrivals,
      departures: frontDesk.departures,
      inHouse: frontDesk.inHouse,
      rooms,
      faults,
      generatedAt: new Date().toISOString(),
    };
  });
}

/**
 * Haftalık seri (7 gün): doluluk, satılan / satılabilir, gelecek / gidecek,
 * oda geliri ve ADR. Geçmiş günler gerçekleşen, gelecek günler eldeki
 * (kesin + opsiyonlu) rezervasyondur.
 *
 * @param {string} hotelId
 * @param {{ from?: Date }} query
 * @param {{ now?: Date }} [options]
 */
export async function getDashboardWeek(hotelId, query, { now = new Date() } = {}) {
  const businessDate = await getBusinessDate(hotelId, now);
  const window = weekWindow(query.from, businessDate, { days: DASHBOARD_WEEK_DAYS, maxOffsetDays: DASHBOARD_WEEK_MAX_OFFSET_DAYS });
  if ('error' in window) throw new ValidationError(window.error, { field: 'from' });

  return cache.get(cacheKey('week', hotelId, businessDate, toIsoDay(window.from)), async () => {
    const [hotel, source, revenueRows] = await Promise.all([
      getHotelSettings(hotelId),
      loadSummarySource(hotelId, window),
      loadNightRevenue(hotelId, window, businessDate),
    ]);
    const days = planDays(window.from, DASHBOARD_WEEK_DAYS);
    const summaries = summarizeDays({ ...source, from: window.from, days: DASHBOARD_WEEK_DAYS, businessDate });
    const revenue = revenueByDay(revenueRows, days, hotel.currency);
    return {
      businessDate: toIsoDay(businessDate),
      currency: hotel.currency,
      from: days[0],
      to: days.at(-1),
      days: summaries.map((summary) => dayRow(summary, revenue.get(summary.date))),
      generatedAt: new Date().toISOString(),
    };
  });
}

/** Sağlık ucu için. */
export function dashboardCacheStats() {
  return cache.stats();
}

/** Testler için. */
export function clearDashboardCache() {
  cache.clear();
}
