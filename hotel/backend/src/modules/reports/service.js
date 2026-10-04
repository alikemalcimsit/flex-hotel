import { toDecimal, toIsoDay } from '@hotelos/core';
import { REPORT_LAST_YEAR_OFFSET_DAYS, REPORT_MAX_FUTURE_DAYS, RESERVATION_SOURCE_LABELS, shiftDay } from '@hotelos/hotel-contracts';
import { getBusinessDate } from '../../lib/business-date.js';
import { ValidationError } from '../../lib/errors.js';
import { createReadCache } from '../../lib/read-cache.js';
import { includedRoomTaxRate } from '../dashboard/rules.js';
import { getHotelSettings } from '../settings/service.js';
import { loadNights, loadPosted, loadRoomTypes, loadSellable, loadStatDays, loadStats, loadTaxes, readOnly } from './queries.js';
import { breakdownRows, bucketRows, dailyTotals, daysBetween, rangeTotals, sumByKey } from './rules.js';
import { closedEndFor } from './stats.js';

/**
 * Gelir raporları (modül 23): doluluk, ADR, RevPAR ve oda geliri — tarih
 * aralığı, gün / hafta / ay gruplaması, oda tipi ve kaynak kırılımı, geçen
 * yılın haftanın aynı günüyle karşılaştırması. Tanımlar `contracts/reports.js`.
 *
 * Tek istek bütün raporu üretir: bu yıl ve geçen yıl için satılabilir oda,
 * kapanmış günlerin özeti (`stats.js`) ve kalan günlerin canlı geceleri /
 * işlenen geliri; kovalar, oranlar ve kırılımlar aynı satırlardan hesaplanır — tablo, grafik ve kırılım hiçbir zaman
 * ayrışmaz. Sorgular salt okunur işlemde (bkz. `queries.js`).
 *
 * ### Yük
 *
 * Cevap otel × aralık × gruplama × iş günü anahtarıyla bir dakika önbellekte
 * (aynı anda gelen istekler tek hesaplamayı bekler). Geçmiş günler özet
 * tablosundan (gün başına birkaç satır) okunur; canlı sorgu yalnızca son
 * `REPORT_LIVE_DAYS` günü ve eldeki rezervasyonu tarar — rapor süresi otelin
 * geçmişi büyüdükçe uzamaz.
 */

const CACHE_TTL_MS = 60_000;

/** "2028-10-03" → "03.10.2028" (kullanıcı mesajı). */
const dotted = (day) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;
const CACHE_MAX_ENTRIES = 500;
const cache = createReadCache({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX_ENTRIES });

/**
 * Bir dönemin (bu yıl ya da geçen yıl) günlük ve kırılım satırları.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {{ from: string, to: string, businessDate: string, currency: string, includedTaxRate: import('@hotelos/core').Decimal }} period
 */
async function loadPeriod(tx, hotelId, { from, to, businessDate, currency, includedTaxRate }) {
  const sellableRows = await loadSellable(tx, hotelId, from, to);

  // Kapanmış ve özeti hesaplanmış günler özetten; geri kalanı (son günler, eldeki
  // rezervasyon, özeti henüz çıkmamış gün) canlı. İki kaynak aynı günü iki kez saymaz.
  const closedEnd = closedEndFor(businessDate);
  const statDays = from <= closedEnd ? await loadStatDays(tx, hotelId, from, to < closedEnd ? to : closedEnd) : new Set();
  // Yalnızca işaretli günlerin satırları (işaret ve satır aynı anlık görüntüden; yine de çift sayım olmasın).
  const statRows = statDays.size > 0 ? (await loadStats(tx, hotelId, from, to < closedEnd ? to : closedEnd)).filter((row) => statDays.has(row.day)) : [];
  const liveDays = daysBetween(from, to).filter((day) => !statDays.has(day));
  const live = (rows) => rows.filter((row) => !statDays.has(row.day));
  const nightRows = [
    ...statRows.map((row) => ({ day: row.day, roomTypeId: row.roomTypeId, source: row.source, currency: row.currency, sold: row.sold, gross: 0 })),
    ...(liveDays.length ? live(await loadNights(tx, hotelId, liveDays[0], liveDays.at(-1), businessDate)) : []),
  ];
  const postedRows = [
    ...statRows,
    ...(liveDays.length ? live(await loadPosted(tx, hotelId, liveDays[0], liveDays.at(-1), businessDate)) : []),
  ];

  // Rezervasyonlar otelin para birimindedir; başka birimde satır varsa karıştırılmaz, sayısı bildirilir.
  const nights = nightRows.filter((row) => row.currency === currency);
  const posted = postedRows.filter((row) => row.currency === currency);
  const otherCurrencyNights = nightRows.filter((row) => row.currency !== currency).reduce((total, row) => total + row.sold, 0);

  const days = daysBetween(from, to);
  const totals = dailyTotals({
    days,
    businessDate,
    includedTaxRate,
    sellable: new Map(sellableRows.map((row) => [row.day, Math.max(0, row.rooms - row.outOfOrder)])),
    nights,
    posted,
  });
  const byKey = (field) =>
    sumByKey({
      businessDate,
      includedTaxRate,
      nights: nights.map((row) => ({ day: row.day, key: row[field], sold: row.sold, gross: row.gross })),
      posted: posted.map((row) => ({ day: row.day, key: row[field], room: row.room })),
    });
  return { totals, roomTypes: byKey('roomTypeId'), sources: byKey('source'), otherCurrencyNights };
}

/**
 * Gelir raporu.
 *
 * @param {string} hotelId
 * @param {{ from: string, to: string, groupBy: 'DAY' | 'WEEK' | 'MONTH' }} query `reportRangeSchema` çıktısı
 * @param {{ now?: Date }} [options]
 */
export async function getRevenueReport(hotelId, { from, to, groupBy }, { now = new Date() } = {}) {
  const businessDate = toIsoDay(await getBusinessDate(hotelId, now));
  const latest = shiftDay(businessDate, REPORT_MAX_FUTURE_DAYS);
  if (to > latest) throw new ValidationError(`Rapor en fazla ${dotted(latest)} tarihine kadar alınır (eldeki rezervasyon)`, { field: 'to' });

  return cache.get(JSON.stringify(['revenue', hotelId, businessDate, from, to, groupBy]), async () => {
    const hotel = await getHotelSettings(hotelId);
    const lyFrom = shiftDay(from, -REPORT_LAST_YEAR_OFFSET_DAYS);
    const lyTo = shiftDay(to, -REPORT_LAST_YEAR_OFFSET_DAYS);

    const { current, lastYear, roomTypes, includedTaxRate } = await readOnly(async (tx) => {
      const [taxes, types] = [await loadTaxes(tx, hotelId), await loadRoomTypes(tx, hotelId)];
      const rate = includedRoomTaxRate(taxes.map((tax) => ({ ...tax, rate: String(tax.rate) })));
      const period = { businessDate, currency: hotel.currency, includedTaxRate: rate };
      return {
        current: await loadPeriod(tx, hotelId, { ...period, from, to }),
        lastYear: await loadPeriod(tx, hotelId, { ...period, from: lyFrom, to: lyTo }),
        roomTypes: types,
        includedTaxRate: rate,
      };
    });

    const days = daysBetween(from, to);
    const typeLabel = new Map(roomTypes.map((type) => [type.id, `${type.name} (${type.code})`]));
    return {
      from,
      to,
      groupBy,
      businessDate,
      currency: hotel.currency,
      includedTaxRate: toDecimal(includedTaxRate).toString(),
      lastYear: { from: lyFrom, to: lyTo, offsetDays: REPORT_LAST_YEAR_OFFSET_DAYS },
      totals: rangeTotals(days, current.totals, lastYear.totals),
      buckets: bucketRows({ days, groupBy, current: current.totals, lastYear: lastYear.totals }),
      breakdowns: {
        roomType: breakdownRows({ current: current.roomTypes, lastYear: lastYear.roomTypes, label: (key) => typeLabel.get(key) ?? 'Silinmiş oda tipi' }),
        source: breakdownRows({ current: current.sources, lastYear: lastYear.sources, label: (key) => RESERVATION_SOURCE_LABELS[key] ?? key }),
      },
      otherCurrencyNights: current.otherCurrencyNights,
      generatedAt: new Date().toISOString(),
    };
  });
}

/** Sağlık ucu için. */
export function reportCacheStats() {
  return cache.stats();
}

/** Testler için. */
export function clearReportCache() {
  cache.clear();
}
