import { DAY_MS, toDecimal, toIsoDay, toMoneyString, toUtcDayStart } from '@hotelos/core';

/**
 * Günlük durum ekranının saf kuralları (modül 13) — veritabanı bilmez.
 *
 * Doluluk ve satılabilir oda oda planının gün özetinden (`summarizeDays`)
 * gelir; burada gelir (vergiden arındırılmış), ADR, RevPAR, kalan oda, anlık
 * oda durumu, misafir dağılımı ve hafta penceresi hesaplanır.
 *
 * ### Neden vergiler hariç
 *
 * Gece fiyatı otelin vergi ayarına göre KDV ve konaklama vergisi **dahil**
 * olabilir. Oda geliri, ADR ve RevPAR otelcilikte vergiler hariç raporlanır
 * (vergi otelin geliri değildir; dahil göstermek geliri ~%12 şişirir). Net =
 * brüt ÷ (1 + oda kalemine uygulanan dahil vergi oranlarının toplamı) —
 * rezervasyon ekranının vergi dökümüyle aynı formül (`roomTaxBreakdown`).
 * Hariç vergiler fiyatın içinde değildir, dokunulmaz.
 */

/** Oda kalemi (vergi ayarındaki `appliesTo`). */
const ROOM_TAX_TARGET = 'ROOM';

/** Pansiyon sırası (ekranda ve testte sabit). */
const BOARD_ORDER = Object.freeze(['RO', 'BB', 'HB', 'FB', 'AI', 'UAI']);

/**
 * Oda fiyatının içindeki vergi oranlarının toplamı (yüzde).
 * @param {Array<{ rate: string | number, isIncluded: boolean, appliesTo?: string[] }>} taxes
 */
export function includedRoomTaxRate(taxes) {
  return (taxes ?? [])
    .filter((tax) => tax.isIncluded && (tax.appliesTo ?? []).includes(ROOM_TAX_TARGET))
    .reduce((total, tax) => total.plus(toDecimal(tax.rate)), toDecimal(0));
}

/**
 * Brüt tutardan dahil vergiyi ayırır (yuvarlamadan; yuvarlama en sonda).
 * @param {import('@hotelos/core').Decimal | string | number} gross
 * @param {import('@hotelos/core').Decimal} includedRate yüzde
 */
export function netOfIncludedTax(gross, includedRate) {
  return toDecimal(gross).dividedBy(toDecimal(1).plus(toDecimal(includedRate).dividedBy(100)));
}

/**
 * Gece gelirlerini güne göre toplar.
 *
 * Satırlar gün × para birimidir (SQL `GROUP BY`). Rezervasyonlar otelin para
 * birimindedir (para birimi rezervasyon varken değiştirilemez, modül 1);
 * yine de başka birimde satır gelirse otelinkine **karıştırılmaz**, ayrı
 * listelenir — farklı paralar toplanmaz.
 *
 * @param {Array<{ date: Date | string, currency: string, amount: unknown, pendingAmount?: unknown, nights: number, pendingNights: number }>} rows
 * @param {string[]} days ISO günleri (sıra korunur)
 * @param {string} hotelCurrency
 */
export function revenueByDay(rows, days, hotelCurrency) {
  const byDay = new Map(
    days.map((day) => [day, { revenue: toDecimal(0), pendingRevenue: toDecimal(0), nights: 0, pendingNights: 0, other: [] }]),
  );
  for (const row of rows) {
    const entry = byDay.get(toIsoDay(row.date));
    if (!entry) continue;
    if (row.currency === hotelCurrency) {
      entry.revenue = entry.revenue.plus(toDecimal(row.amount ?? 0));
      entry.pendingRevenue = entry.pendingRevenue.plus(toDecimal(row.pendingAmount ?? 0));
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
 * Satılabilir oda başına gelir (RevPAR): oda geliri / satılabilir oda.
 * Satılabilir oda yoksa (hepsi arızalı) tanımsız.
 *
 * @param {import('@hotelos/core').Decimal | string | number} revenue
 * @param {number} sellable
 * @returns {string | null}
 */
export function revenuePerAvailableRoom(revenue, sellable) {
  if (!Number.isFinite(sellable) || sellable <= 0) return null;
  return toMoneyString(toDecimal(revenue).dividedBy(sellable));
}

/**
 * Oda planı gün özeti + gelir → ekranın gün satırı.
 *
 * - `available`: bu gece daha satılabilecek oda (satılabilir − satılan).
 *   **Negatif olabilir**: fazla satış (overbooking) gizlenmez.
 * - `revenue` / `adr` / `revpar`: vergiler hariç; `grossRevenue` vergiler dahil.
 * - `pendingRevenue`: gelirin opsiyonlu (kesinleşmemiş) rezervasyonlardan gelen kısmı.
 *
 * @param {{ date: string, sold: number, sellable: number, occupancyPct: number, arrivals: number, departures: number,
 *           outOfOrder: number, outOfService: number, unassigned: number, stayovers: number }} summary
 * @param {{ revenue: import('@hotelos/core').Decimal, pendingRevenue: import('@hotelos/core').Decimal, nights: number,
 *           pendingNights: number, other: Array<object> } | undefined} revenue
 * @param {import('@hotelos/core').Decimal} includedTaxRate
 */
export function dayRow(summary, revenue, includedTaxRate) {
  const money = revenue ?? { revenue: toDecimal(0), pendingRevenue: toDecimal(0), nights: 0, pendingNights: 0, other: [] };
  const net = netOfIncludedTax(money.revenue, includedTaxRate);
  return {
    date: summary.date,
    sold: summary.sold,
    sellable: summary.sellable,
    available: summary.sellable - summary.sold,
    occupancyPct: summary.occupancyPct,
    arrivals: summary.arrivals,
    departures: summary.departures,
    stayovers: summary.stayovers,
    unassigned: summary.unassigned,
    outOfOrder: summary.outOfOrder,
    outOfService: summary.outOfService,
    /** Satılanlardan opsiyonlu (kesinleşmemiş) olanlar. */
    pendingSold: money.pendingNights,
    revenue: toMoneyString(net),
    grossRevenue: toMoneyString(money.revenue),
    pendingRevenue: toMoneyString(netOfIncludedTax(money.pendingRevenue, includedTaxRate)),
    adr: averageDailyRate(net, money.nights),
    revpar: revenuePerAvailableRoom(net, summary.sellable),
    otherCurrencies: money.other,
  };
}

/**
 * Anlık oda durumu (fiziksel): SQL sayımlarını sayıya çevirir.
 *
 * - `vacantReady`: boş, temiz ya da kontrol edilmiş ve bugün arıza kaydı
 *   olmayan oda.
 * - `vacantReadyFree`: bunlardan bu gece hiçbir konaklamaya atanmamış olanlar —
 *   odası verilmemiş gelen misafire şu an verilebilecek oda.
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
    vacantReadyFree: count('vacantReadyFree'),
    dirty: count('dirty'),
    cleaning: count('cleaning'),
    clean: count('clean'),
    inspected: count('inspected'),
  };
}

/**
 * Bu gece konaklayan misafirler: kişi sayısı ve pansiyona göre dağılım
 * (mutfak ve kahvaltı planı). Satırlar pansiyon başına SQL toplamıdır.
 *
 * @param {Array<{ boardType: string, stays: number, adults: number, children: number }>} rows
 */
export function guestMix(rows) {
  const byBoard = new Map();
  for (const row of rows ?? []) {
    const entry = byBoard.get(row.boardType) ?? { boardType: row.boardType, stays: 0, adults: 0, children: 0 };
    entry.stays += Number(row.stays ?? 0);
    entry.adults += Number(row.adults ?? 0);
    entry.children += Number(row.children ?? 0);
    byBoard.set(row.boardType, entry);
  }
  const boards = [...byBoard.values()]
    .map((entry) => ({ ...entry, guests: entry.adults + entry.children }))
    .sort((a, b) => indexOrEnd(BOARD_ORDER, a.boardType) - indexOrEnd(BOARD_ORDER, b.boardType));
  const total = (key) => boards.reduce((sum, entry) => sum + entry[key], 0);
  return {
    stays: total('stays'),
    adults: total('adults'),
    children: total('children'),
    guests: total('guests'),
    byBoard: boards,
  };
}

/** @param {readonly string[]} list @param {string} value */
function indexOrEnd(list, value) {
  const index = list.indexOf(value);
  return index === -1 ? list.length : index;
}

/**
 * Oda tipine göre bu gece: modül 3'ün müsaitlik takviminden (rezervasyon
 * ekranının "yer var mı" cevabıyla aynı sayı).
 *
 * - `sold` = odası atanmış + oda bekleyen; `sellable` = toplam − arızalı.
 * - `available` = müsaitlikteki boş; negatifse o tipte fazla satış var.
 *
 * @param {Array<{ id: string, code: string, name: string, total: number,
 *   days: Record<string, { occupied: number, outOfOrder: number, outOfService: number, unassigned: number, free: number }> }>} roomTypes
 * @param {string} day ISO gün
 */
export function roomTypeRows(roomTypes, day) {
  return roomTypes
    .filter((type) => type.total > 0)
    .map((type) => {
      const night = type.days[day] ?? { occupied: 0, outOfOrder: 0, outOfService: 0, unassigned: 0, free: type.total };
      const sold = night.occupied + night.unassigned;
      const sellable = Math.max(0, type.total - night.outOfOrder);
      return {
        id: type.id,
        code: type.code,
        name: type.name,
        total: type.total,
        sold,
        sellable,
        outOfOrder: night.outOfOrder,
        outOfService: night.outOfService,
        available: night.free,
        occupancyPct: sellable === 0 ? 0 : Math.round((sold / sellable) * 100),
      };
    });
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
