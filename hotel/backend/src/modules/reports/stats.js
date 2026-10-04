import { runWithContext, toDecimal, toIsoDay, toMoneyString } from '@hotelos/core';
import { shiftDay } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { loadEarliestDay, loadNights, loadPosted, readOnly } from './queries.js';
import { daysBetween } from './rules.js';

/**
 * Gelir raporunun kapanmış gün özeti (modül 23): `RevenueDayStat` +
 * işaret `RevenueStatDay`.
 *
 * ### Neden
 *
 * Canlı rapor sorgusu satılan geceyi ve işlenen geliri rezervasyonla
 * birleştirir; PostgreSQL bunu otelin **bütün** rezervasyon ve folyo
 * geçmişini tarayarak yapar. 1500 odalı ölçüm verisinde bir yıllık rapor
 * 3,5–4,5 sn sürdü ve geçmiş biriktikçe büyüyordu. Özet tablo gün başına en
 * fazla (oda tipi × kaynak) satırdır: bir yıl birkaç bin satır.
 *
 * ### Hangi gün özetten
 *
 * İş gününden `REPORT_LIVE_DAYS` günden eski günler (geç işlenen gece ücreti,
 * gelmeyen işaretlemesi gibi düzeltmeler genelde birkaç gün içinde olur).
 * Daha yeni günler, eldeki rezervasyon ve henüz özeti çıkmamış günler canlı
 * okunur — rapor her zaman doğrudur, özet yalnızca hızlandırır.
 *
 * ### Tazelik
 *
 * Zamanlanmış iş (saatlik) her otelde:
 * 1. Son `STATS_ROLLING_DAYS` kapanmış günü yeniden hesaplar (geç düzeltmeler).
 * 2. Özeti olmayan eski günleri geriye doğru `STATS_CHUNK_DAYS`'lik parçalarla doldurur.
 * 3. Doldurulacak gün yoksa en eski hesaplanan parçayı yeniden hesaplar
 *    (kendini onarma: çok eski bir günde nadir düzeltme de en geç birkaç gün
 *    içinde özete yansır).
 *
 * Kaynak veri değişmez; bu tablo silinip yeniden hesaplanabilir.
 */

/** Bu kadar günden yeni günler özetlenmez, raporda canlı okunur. */
export const REPORT_LIVE_DAYS = 14;
/** Her turda yeniden hesaplanan son kapanmış gün sayısı. */
export const STATS_ROLLING_DAYS = 31;
/** Doldurma / onarma parçası (gün). */
export const STATS_CHUNK_DAYS = 62;
/** Özetin geriye gittiği en uzak gün (bundan eskisi raporda canlı okunur). */
export const STATS_MAX_HISTORY_DAYS = 1500;

/**
 * Bu iş gününde özetlenebilecek son gün.
 * @param {string} businessDate "YYYY-AA-GG"
 */
export const closedEndFor = (businessDate) => shiftDay(businessDate, -(REPORT_LIVE_DAYS + 1));

const ZERO = () => toDecimal(0);

/**
 * Bir aralığın özetini yeniden hesaplar (canlı sorgularla — rapordakiyle aynı
 * tanımlar) ve yazar: aralığın eski satırları silinir, günler işaretlenir.
 *
 * Okuma ile yazma arasında gelen bir düzeltme bu turda kaçabilir; kayan
 * pencere ve onarma turu onu sonra yakalar.
 *
 * @param {string} hotelId
 * @param {string} from
 * @param {string} to
 * @param {{ businessDate: string }} options yalnızca kapanmış günler (`to` ≤ `closedEndFor(businessDate)`)
 * @returns {Promise<{ days: number, rows: number }>}
 */
export async function rebuildStats(hotelId, from, to, { businessDate }) {
  if (to > closedEndFor(businessDate)) throw new Error(`Özet yalnızca kapanmış günler için hesaplanır (${to})`);
  const { nights, posted } = await readOnly(async (tx) => ({
    nights: await loadNights(tx, hotelId, from, to, businessDate),
    posted: await loadPosted(tx, hotelId, from, to, businessDate),
  }));

  /** @type {Map<string, any>} */
  const rows = new Map();
  const entry = (row) => {
    const key = `${row.day}|${row.roomTypeId}|${row.source}|${row.currency}`;
    let target = rows.get(key);
    if (!target) {
      target = { day: row.day, roomTypeId: row.roomTypeId, source: row.source, currency: row.currency, sold: 0, roomRevenue: ZERO(), discounts: ZERO(), fees: ZERO(), cancellations: ZERO() };
      rows.set(key, target);
    }
    return target;
  };
  for (const row of nights) entry(row).sold += row.sold;
  for (const row of posted) {
    const target = entry(row);
    target.roomRevenue = target.roomRevenue.plus(toDecimal(row.room ?? 0));
    target.discounts = target.discounts.plus(toDecimal(row.discounts ?? 0));
    target.fees = target.fees.plus(toDecimal(row.fees ?? 0));
    target.cancellations = target.cancellations.plus(toDecimal(row.cancellations ?? 0));
  }

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  await prisma.$transaction(async (tx) => {
    await tx.revenueDayStat.deleteMany({ where: { hotelId, day: { gte: fromDate, lte: toDate } } });
    if (rows.size > 0) {
      await tx.revenueDayStat.createMany({
        data: [...rows.values()].map((row) => ({
          hotelId,
          day: new Date(`${row.day}T00:00:00.000Z`),
          roomTypeId: row.roomTypeId,
          source: row.source,
          currency: row.currency,
          sold: row.sold,
          roomRevenue: toMoneyString(row.roomRevenue),
          discounts: toMoneyString(row.discounts),
          fees: toMoneyString(row.fees),
          cancellations: toMoneyString(row.cancellations),
        })),
      });
    }
    await tx.$executeRaw`
      INSERT INTO "RevenueStatDay" ("hotelId", "day", "computedAt")
      SELECT ${hotelId}, d::date, now() FROM generate_series(${from}::date, ${to}::date, interval '1 day') AS d
      ON CONFLICT ("hotelId", "day") DO UPDATE SET "computedAt" = EXCLUDED."computedAt"`;
  });
  return { days: daysBetween(from, to).length, rows: rows.size };
}

/**
 * Bir otelin özet turu (bkz. dosya başı). Tur başına en fazla üç parça.
 *
 * @param {string} hotelId
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ rolling: number, backfilled: number, repaired: number }>}
 */
export async function refreshHotelStats(hotelId, { now = new Date() } = {}) {
  const businessDate = toIsoDay(await getBusinessDate(hotelId, now));
  const closedEnd = closedEndFor(businessDate);
  const result = { rolling: 0, backfilled: 0, repaired: 0 };

  const earliest = await readOnly((tx) => loadEarliestDay(tx, hotelId));
  if (!earliest || earliest > closedEnd) return result;
  const floor = [earliest, shiftDay(businessDate, -STATS_MAX_HISTORY_DAYS)].sort().at(-1);

  // 1. Kayan pencere: son kapanmış günler her turda.
  const rollingFrom = [floor, shiftDay(closedEnd, -(STATS_ROLLING_DAYS - 1))].sort().at(-1);
  result.rolling = (await rebuildStats(hotelId, rollingFrom, closedEnd, { businessDate })).days;

  // 2. Doldurma: özeti olmayan en yeni eski parça.
  const olderEnd = shiftDay(rollingFrom, -1);
  if (olderEnd >= floor) {
    const missing = await prisma.$queryRaw`
      SELECT to_char(d, 'YYYY-MM-DD') AS "day"
      FROM generate_series(${floor}::date, ${olderEnd}::date, interval '1 day') AS d
      WHERE NOT EXISTS (SELECT 1 FROM "RevenueStatDay" s WHERE s."hotelId" = ${hotelId} AND s."day" = d::date)
      ORDER BY d DESC
      LIMIT 1`;
    if (missing.length > 0) {
      const chunkEnd = missing[0].day;
      const chunkFrom = [floor, shiftDay(chunkEnd, -(STATS_CHUNK_DAYS - 1))].sort().at(-1);
      result.backfilled = (await rebuildStats(hotelId, chunkFrom, chunkEnd, { businessDate })).days;
      return result;
    }

    // 3. Onarma: en eski hesaplanan parça (kayan pencerenin dışında).
    const [oldest] = await prisma.revenueStatDay.findMany({
      where: { hotelId, day: { gte: new Date(`${floor}T00:00:00.000Z`), lte: new Date(`${olderEnd}T00:00:00.000Z`) } },
      orderBy: [{ computedAt: 'asc' }, { day: 'asc' }],
      take: 1,
      select: { day: true },
    });
    if (oldest) {
      const repairFrom = toIsoDay(oldest.day);
      const repairTo = [olderEnd, shiftDay(repairFrom, STATS_CHUNK_DAYS - 1)].sort()[0];
      result.repaired = (await rebuildStats(hotelId, repairFrom, repairTo, { businessDate })).days;
    }
  }
  return result;
}

/**
 * Bütün otellerin özet turu (zamanlanmış iş).
 * @param {{ warn: Function }} logger
 */
export async function refreshAllStats(logger) {
  const hotels = await prisma.hotel.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  const totals = { hotels: 0, days: 0 };
  for (const hotel of hotels) {
    try {
      const result = await runWithContext({ actor: 'sistem:rapor-ozeti' }, () => refreshHotelStats(hotel.id));
      totals.hotels += 1;
      totals.days += result.rolling + result.backfilled + result.repaired;
    } catch (error) {
      // Bir otelin hatası diğerlerini durdurmaz; rapor o otelde canlı okumaya devam eder.
      logger.warn({ err: error, hotelId: hotel.id }, 'Gelir özeti hesaplanamadı');
    }
  }
  return totals;
}
