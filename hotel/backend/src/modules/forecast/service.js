import { toDecimal, toIsoDay, toMoneyString } from '@hotelos/core';
import { FORECAST_DAYS, FORECAST_MIN_SAMPLES, shiftDay } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { NotFoundError } from '../../lib/errors.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { LIVE_SCOPES, liveVersion } from '../../lib/live-version.js';
import { createReadCache } from '../../lib/read-cache.js';
import { writeWithEvents } from '../../lib/write.js';
import { loadSellable, readOnly } from '../reports/queries.js';
import { daysBetween } from '../reports/rules.js';
import { computeRevenueReport } from '../reports/service.js';
import { getHotelSettings } from '../settings/service.js';
import { loadDataStart, loadPickupPoints } from './queries.js';
import { alertFor, chooseBasis, forecastDay, forecastTotals, pickupRate, referencePoints, usableRates, windowAdr } from './rules.js';

/**
 * Önümüzdeki günlerin doluluk ve gelir tahmini (modül 25). Tanımlar
 * `contracts/forecast.js`, hesap `rules.js`.
 *
 * Tek istek: pencerenin eldeki gecesi / geliri ve geçen yılın aynı günleri
 * gelir raporunun hesabından (aynı tanımlar — günlük durum, rapor ve tahmin
 * hiçbir zaman ayrışmaz); karşılaştırma noktalarının "o gün kala eldeki" ve
 * gerçekleşen gecesi tek sorguda (`queries.js`), satılabilir odaları iki
 * aralık sorgusunda. Bütün okumalar salt okunur işlemde.
 *
 * ### Yük
 *
 * Cevap otel × iş günü × gün sayısı × canlı sürüm (rezervasyon, envanter,
 * ayar değişince yeni anahtar) anahtarıyla bir dakika önbellekte; aynı anda
 * gelen istekler tek hesaplamayı bekler. Karşılaştırma noktası en fazla
 * 30 gün × (3 + 8) = 330 (son haftalar yalnızca geçen yılı olmayan günlerde);
 * her nokta bir günün gecelerini index'ten okur.
 */

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;
const cache = createReadCache({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX_ENTRIES });

/**
 * Karşılaştırma günleri bundan uzun boşlukla ayrılıyorsa satılabilir oda iki
 * ayrı aralıkta okunur (geçen yılın günleri | son haftalar): aradaki günler
 * sorgulanmaz.
 */
const SELLABLE_RANGE_GAP_DAYS = 180;

const SETTINGS_SELECT = { forecastLowOccupancyPct: true, forecastHighOccupancyPct: true, updatedAt: true };

/**
 * Kritik gün eşikleri ve otel kaydının sürümü (eşik penceresi geri yollar).
 * @param {string} hotelId
 * @returns {Promise<{ lowPct: number, highPct: number, updatedAt: string }>}
 */
export async function getForecastSettings(hotelId) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId }, select: SETTINGS_SELECT });
  if (!hotel) throw new NotFoundError('Otel kaydı bulunamadı');
  return { lowPct: hotel.forecastLowOccupancyPct, highPct: hotel.forecastHighOccupancyPct, updatedAt: hotel.updatedAt.toISOString() };
}

/**
 * Eşikleri değiştirir (sürüm kontrollü; denetim kaydı + olay). Tahmin
 * önbelleği ayar olayıyla yeni anahtara geçer.
 * @param {string} hotelId
 * @param {{ lowPct: number, highPct: number, expectedUpdatedAt: Date }} input `forecastSettingsSchema` çıktısı
 */
export async function updateForecastSettings(hotelId, { lowPct, highPct, expectedUpdatedAt }) {
  await writeWithEvents(async (tx, stage) => {
    const row = await tx.hotel.findFirst({ where: { id: hotelId }, select: SETTINGS_SELECT });
    if (!row) throw new NotFoundError('Otel kaydı bulunamadı');
    const before = { forecastLowOccupancyPct: row.forecastLowOccupancyPct, forecastHighOccupancyPct: row.forecastHighOccupancyPct };
    const after = { forecastLowOccupancyPct: lowPct, forecastHighOccupancyPct: highPct };
    await updateWithVersionCheck(tx, 'hotel', { id: hotelId }, expectedUpdatedAt, after, 'Otel kaydı bulunamadı');
    await recordAudit(tx, { hotelId, entity: 'Hotel', entityId: hotelId, action: 'UPDATE', before, after });
    await stage('forecast.settings.changed', { hotelId });
    // Otel satırı (sürüm damgası) değişti: açık "Genel parametreler" formu eski damgayla kaydedemesin diye.
    await stage('settings.hotel.updated', { hotelId, changedFields: Object.keys(after) });
  });
  return getForecastSettings(hotelId);
}

/**
 * Tahmin.
 *
 * @param {string} hotelId
 * @param {{ days?: number }} [query] `forecastQuerySchema` çıktısı
 * @param {{ now?: Date }} [options]
 */
export async function getForecast(hotelId, { days = FORECAST_DAYS } = {}, { now = new Date() } = {}) {
  const businessDate = toIsoDay(await getBusinessDate(hotelId, now));
  const key = JSON.stringify([
    'forecast',
    hotelId,
    businessDate,
    days,
    liveVersion(LIVE_SCOPES.INVENTORY, hotelId),
    liveVersion(LIVE_SCOPES.RESERVATIONS, hotelId),
  ]);
  return cache.get(key, () => computeForecast(hotelId, { days, businessDate, now }));
}

/**
 * @param {string} hotelId
 * @param {{ days: number, businessDate: string, now: Date }} input
 */
async function computeForecast(hotelId, { days, businessDate, now }) {
  const to = shiftDay(businessDate, days - 1);
  const dayList = daysBetween(businessDate, to);
  const { currency } = await getHotelSettings(hotelId);

  // Eldeki (rapor hesabı) ile karşılaştırma noktaları birbirini beklemez: ayrı salt okunur
  // işlemlerde paralel. Noktalar iki aşamada: önce geçen yıl (kaydı olan otelde yeter); son
  // haftalar yalnızca geçen yılın yeterli örneği olmayan günler için — sorgulanan gün
  // sayısı üçte bire iner.
  const [report, settings, { dataStart, plans, rates }] = await Promise.all([
    computeRevenueReport(hotelId, { from: businessDate, to, groupBy: 'DAY', businessDate }),
    getForecastSettings(hotelId),
    readOnly(async (tx) => {
      const start = await loadDataStart(tx, hotelId);
      const dayPlans = dayList.map((day) => referencePoints({ day, businessDate, now, dataStart: start }));
      const lastYear = await loadRates(tx, hotelId, currency, dayPlans.map((plan) => plan.lastYear));
      const recent = await loadRates(
        tx,
        hotelId,
        currency,
        dayPlans.map((plan, index) => (usableRates(lastYear[index]).length < FORECAST_MIN_SAMPLES ? plan.recent : [])),
      );
      return { dataStart: start, plans: dayPlans, rates: dayPlans.map((_, index) => ({ lastYear: lastYear[index], recent: recent[index] })) };
    }),
  ]);
  if (report.buckets.length !== dayList.length || report.buckets.some((bucket, index) => bucket.key !== dayList[index])) {
    throw new Error('Tahmin: rapor günleri pencereyle eşleşmiyor');
  }

  const onBooksDays = report.buckets.map((bucket) => ({ sold: bucket.sold, revenue: bucket.roomRevenue }));
  const lastYearAdr = report.totals.lastYear.adr === null ? null : toDecimal(report.totals.lastYear.adr);
  const fallbackAdr = windowAdr(onBooksDays) ?? lastYearAdr;

  const rows = report.buckets.map((bucket, index) => {
    const plan = plans[index];
    const choice = chooseBasis(rates[index]);
    const forecast = forecastDay({ sold: bucket.sold, sellable: bucket.sellable, revenue: bucket.roomRevenue, rate: choice.rate, fallbackAdr });
    return {
      date: bucket.key,
      lead: plan.lead,
      sellable: bucket.sellable,
      onBooks: { sold: bucket.sold, occupancyPct: bucket.occupancyPct, revenue: bucket.roomRevenue },
      forecast: { nights: forecast.nights, pickup: forecast.pickup, occupancyPct: forecast.occupancyPct, revenue: toMoneyString(forecast.revenue) },
      basis: choice.basis,
      samples: choice.samples,
      lastYear: {
        date: bucket.lastYear.from,
        sold: bucket.lastYear.sold,
        sellable: bucket.lastYear.sellable,
        occupancyPct: bucket.lastYear.occupancyPct,
        revenue: bucket.lastYear.roomRevenue,
      },
      alert: alertFor({ sold: bucket.sold, sellable: bucket.sellable, forecastPct: forecast.occupancyPct, basis: choice.basis, ...settings }),
    };
  });

  const basisCounts = { LAST_YEAR: 0, RECENT: 0, NONE: 0 };
  for (const row of rows) basisCounts[row.basis] += 1;

  return {
    businessDate,
    from: businessDate,
    to,
    days,
    currency: report.currency,
    includedTaxRate: report.includedTaxRate,
    settings,
    dataStart: dataStart ? dataStart.toISOString() : null,
    basisCounts,
    totals: forecastTotals(rows),
    rows,
    alerts: rows.filter((row) => row.alert !== null).map((row) => ({ date: row.date, alert: row.alert, sellable: row.sellable, onBooks: row.onBooks, forecast: row.forecast })),
    otherCurrencyNights: report.otherCurrencyNights,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Gün gün karşılaştırma noktalarının pickup oranları (tek sorgu + satılabilir oda).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} currency otelin para birimi (eldeki gibi)
 * @param {Array<Array<{ day: string, asOf: Date }>>} groups gün başına noktalar
 * @returns {Promise<Array<Array<number | null>>>} aynı sırayla oranlar
 */
async function loadRates(tx, hotelId, currency, groups) {
  const points = groups.flat();
  if (points.length === 0) return groups.map(() => []);
  const [samples, sellable] = [await loadPickupPoints(tx, hotelId, currency, points), await loadRefSellable(tx, hotelId, points)];
  let cursor = 0;
  return groups.map((group) =>
    group.map((point) => {
      const sample = samples[cursor];
      cursor += 1;
      return pickupRate({ onBooks: sample.onBooks, final: sample.final, sellable: sellable.get(point.day) ?? 0 });
    }),
  );
}

/**
 * Karşılaştırma günlerinin satılabilir odası: geçen yıl ve son haftalar iki
 * ayrı, kısa aralıkta (aradaki yüzlerce gün sorgulanmaz).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {Array<{ day: string }>} points
 * @returns {Promise<Map<string, number>>}
 */
async function loadRefSellable(tx, hotelId, points) {
  const result = new Map();
  const days = [...new Set(points.map((point) => point.day))].sort();
  if (days.length === 0) return result;
  const ranges = [];
  let start = days[0];
  let previous = days[0];
  for (const day of days.slice(1)) {
    if (day > shiftDay(previous, SELLABLE_RANGE_GAP_DAYS)) {
      ranges.push([start, previous]);
      start = day;
    }
    previous = day;
  }
  ranges.push([start, previous]);
  for (const [from, to] of ranges) {
    for (const row of await loadSellable(tx, hotelId, from, to)) result.set(row.day, Math.max(0, row.rooms - row.outOfOrder));
  }
  return result;
}

/** Sağlık ucu için. */
export function forecastCacheStats() {
  return cache.stats();
}

/** Testler için. */
export function clearForecastCache() {
  cache.clear();
}
