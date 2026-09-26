import { DAY_MS, toDecimal, toIsoDay, toMoneyString, toUtcDayStart } from '@hotelos/core';

/**
 * Günlük durum ekranının saf kuralları (modül 13) — veritabanı bilmez.
 *
 * Doluluk ve satılabilir oda oda planının gün özetinden (`summarizeDays`)
 * gelir; burada yalnızca gelir, ADR, anlık oda durumu ve hafta penceresi
 * hesaplanır.
 */

/**
 * Gece gelirlerini güne göre toplar.
 *
 * Satırlar gün × para birimidir (SQL `GROUP BY`). Rezervasyonlar otelin para
 * birimindedir (para birimi rezervasyon varken değiştirilemez, modül 1);
 * yine de başka birimde satır gelirse otelinkine **karıştırılmaz**, ayrı
 * listelenir — farklı paralar toplanmaz.
 *
 * @param {Array<{ date: Date | string, currency: string, amount: unknown, nights: number, pendingNights: number }>} rows
 * @param {string[]} days ISO günleri (sıra korunur)
 * @param {string} hotelCurrency
 * @returns {Map<string, { revenue: import('@hotelos/core').Decimal, nights: number, pendingNights: number, other: Array<{ currency: string, amount: string }> }>}
 */
export function revenueByDay(rows, days, hotelCurrency) {
  const byDay = new Map(days.map((day) => [day, { revenue: toDecimal(0), nights: 0, pendingNights: 0, other: [] }]));
  for (const row of rows) {
    const entry = byDay.get(toIsoDay(row.date));
    if (!entry) continue;
    if (row.currency === hotelCurrency) {
      entry.revenue = entry.revenue.plus(toDecimal(row.amount ?? 0));
      entry.nights += Number(row.nights ?? 0);
      entry.pendingNights += Number(row.pendingNights ?? 0);
    } else {
      entry.other.push({ currency: row.currency, amount: toMoneyString(row.amount ?? 0) });
    }
  }
  return byDay;
}

/**
 * Ortalama oda fiyatı (ADR): oda geliri / fiyatı olan satılan gece. Gece
 * yoksa tanımsız (`null`) — "0,00" yanıltıcı olurdu.
 *
 * @param {import('@hotelos/core').Decimal | string | number} revenue
 * @param {number} nights
 * @returns {string | null}
 */
export function averageDailyRate(revenue, nights) {
  if (!Number.isFinite(nights) || nights <= 0) return null;
  return toMoneyString(toDecimal(revenue).dividedBy(nights));
}

/**
 * Oda planı gün özeti + gelir → ekranın gün satırı.
 *
 * @param {{ date: string, sold: number, sellable: number, occupancyPct: number, arrivals: number, departures: number,
 *           outOfOrder: number, outOfService: number, unassigned: number, stayovers: number }} summary
 * @param {{ revenue: import('@hotelos/core').Decimal, nights: number, pendingNights: number, other: Array<object> } | undefined} revenue
 */
export function dayRow(summary, revenue) {
  const money = revenue ?? { revenue: toDecimal(0), nights: 0, pendingNights: 0, other: [] };
  return {
    date: summary.date,
    sold: summary.sold,
    sellable: summary.sellable,
    occupancyPct: summary.occupancyPct,
    arrivals: summary.arrivals,
    departures: summary.departures,
    stayovers: summary.stayovers,
    unassigned: summary.unassigned,
    outOfOrder: summary.outOfOrder,
    outOfService: summary.outOfService,
    /** Satılanlardan opsiyonlu (kesinleşmemiş) olanlar. */
    pendingSold: money.pendingNights,
    revenue: toMoneyString(money.revenue),
    adr: averageDailyRate(money.revenue, money.nights),
    otherCurrencies: money.other,
  };
}

/**
 * Anlık oda durumu (fiziksel): SQL sayımlarını sayıya çevirir.
 *
 * - `vacantReady`: boş, temiz ya da kontrol edilmiş ve bugün arıza kaydı
 *   olmayan oda — resepsiyonun şu an verebileceği oda.
 *
 * @param {Record<string, unknown> | undefined} row
 */
export function roomStates(row) {
  const count = (key) => Number(row?.[key] ?? 0);
  return {
    total: count('total'),
    occupied: count('occupied'),
    vacant: count('vacant'),
    vacantReady: count('vacantReady'),
    dirty: count('dirty'),
    cleaning: count('cleaning'),
    clean: count('clean'),
    inspected: count('inspected'),
  };
}

/**
 * Haftalık pencere: başlangıç (UTC gün başı) ve iş gününe uzaklık denetimi.
 *
 * @param {Date | string | undefined} from istenen başlangıç; yoksa iş günü
 * @param {Date | string} businessDate
 * @param {{ days: number, maxOffsetDays: number }} limits
 * @returns {{ from: Date, to: Date } | { error: string }}
 */
export function weekWindow(from, businessDate, { days, maxOffsetDays }) {
  const business = toUtcDayStart(businessDate);
  let start;
  try {
    start = from === undefined || from === null ? business : toUtcDayStart(from);
  } catch {
    return { error: 'Başlangıç günü geçersiz' };
  }
  if (Math.abs(start - business) > maxOffsetDays * DAY_MS) {
    return { error: `Başlangıç günü bugünden en fazla ${maxOffsetDays} gün uzakta olabilir` };
  }
  return { from: new Date(start), to: new Date(start + days * DAY_MS) };
}
