import { toDecimal, toMoneyString } from '@hotelos/core';

/**
 * Zincir konsolunun saf hesapları (modül 63). Veritabanı yok: birim testlenir.
 */

/* ─────────────── Yeni otel: kopyalanan genel parametreler ─────────────── */

/**
 * "Genel parametreler" grubunda kaynak otelden kopyalanan `Hotel` alanları (açık liste: yeni bir modül otele alan
 * eklerse sessizce kopyalanmasın — kimlik, adres, portal adresi, yasal bilgiler otelin kendine aittir).
 */
export const HOTEL_GENERAL_FIELDS = Object.freeze([
  'phoneCountryCode',
  'checkInTime',
  'checkOutTime',
  'defaultBoardType',
  'cancellationPolicyDays',
  'cancellationPolicyPenaltyPct',
  'overbookingPolicy',
  'earlyCheckInFeeMode',
  'earlyCheckInFeeValue',
  'lateCheckOutFeeMode',
  'lateCheckOutFeeValue',
  'checkInIdentityPolicy',
  'largePaymentThreshold',
  'laundryExpressPct',
  'lostItemRetentionDays',
  'lostItemValuableRetentionDays',
  'forecastLowOccupancyPct',
  'forecastHighOccupancyPct',
]);

/**
 * Otelin para biriminde tutar olan alanlar: para birimi farklıysa kopyalanmaz (1.000 TRY eşik, 1.000 EUR olmasın).
 * Sabit tutarlı ücret de kopyalanmaz (tür "ücret yok"a döner); yüzdeli ücret birimden bağımsızdır, kalır.
 */
const MONEY_FIELDS = Object.freeze(['largePaymentThreshold']);
const FEE_PAIRS = Object.freeze([
  ['earlyCheckInFeeMode', 'earlyCheckInFeeValue'],
  ['lateCheckOutFeeMode', 'lateCheckOutFeeValue'],
]);

/**
 * Kaynak otelin genel parametrelerinden yeni otelin alanları.
 *
 * @param {Record<string, any>} source kaynak `Hotel` satırı
 * @param {{ sameCurrency: boolean }} options
 * @returns {{ data: Record<string, any>, skipped: string[] }} `skipped`: para birimi farkı yüzünden kopyalanmayanlar
 */
export function generalSettingsCopy(source, { sameCurrency }) {
  const data = {};
  for (const field of HOTEL_GENERAL_FIELDS) {
    if (source[field] !== undefined) data[field] = source[field];
  }
  const skipped = [];
  if (!sameCurrency) {
    for (const field of MONEY_FIELDS) {
      if (data[field] !== undefined && !toDecimal(data[field]).isZero()) skipped.push(field);
      delete data[field];
    }
    for (const [mode, value] of FEE_PAIRS) {
      if (data[mode] === 'FIXED') {
        skipped.push(value);
        data[mode] = 'NONE';
        data[value] = '0';
      }
    }
  }
  return { data, skipped };
}

/**
 * Şablondan kopyalanan tabloların alanları. Her tablo için şemadaki her alan ya burada ya `TEMPLATE_NEVER_COPIED`'de
 * olmak zorunda (birim testi şemadan denetler): yeni bir alan eklenince kopyalanıp kopyalanmayacağına karar verilsin,
 * başka otelin kaydına işaret eden bir bağ sessizce yeni otele taşınmasın.
 */
export const TEMPLATE_FIELDS = Object.freeze({
  RoomType: Object.freeze(['code', 'name', 'capacityAdults', 'capacityChildren', 'basePrice', 'description', 'amenities']),
  Tax: Object.freeze(['name', 'rate', 'isIncluded', 'appliesTo']),
  Season: Object.freeze(['name', 'startDate', 'endDate', 'multiplier']),
  RolePermission: Object.freeze(['role', 'permission']),
});

/** Hiçbir tabloda kopyalanmayan alanlar: kimlik, otel bağı, zaman damgaları. */
export const TEMPLATE_NEVER_COPIED = Object.freeze(['id', 'hotelId', 'createdAt', 'updatedAt', 'deletedAt']);

/** Kaynak otelden tablo başına en fazla kopyalanan satır (oda tipi, vergi, sezon gerçekte onlarcadır). */
export const TEMPLATE_MAX_ROWS = 1000;

/* ─────────────── Eşzamanlılık sınırlı hesap ─────────────── */

/**
 * Her öğe için `work` çalıştırır, aynı anda en fazla `limit` tane. Bir öğenin hatası diğerlerini durdurmaz: sonuç
 * sırası girdiyle aynıdır, her biri `{ ok, value }` ya da `{ ok: false, error }`.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} work
 * @returns {Promise<Array<{ ok: true, value: R } | { ok: false, error: unknown }>>}
 */
export async function settleWithConcurrency(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { ok: true, value: await work(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return results;
}

/* ─────────────── Zincir toplamları (para birimine göre) ─────────────── */

const ratio = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const perUnit = (money, count) => (count > 0 ? toMoneyString(money.dividedBy(count)) : null);

/**
 * Para birimi farklı oteller toplanmaz (kur çevrimi yok): her para birimi ayrı satır. Oranlar toplamdan hesaplanır
 * (otel oranlarının ortalaması değil: 300 odalı otel ile 20 odalı otel aynı ağırlıkta olmasın).
 *
 * @param {Array<{ currency: string, sold: number, sellable: number, roomRevenue: string, totalRevenue: string,
 *   lastYear?: { sold: number, sellable: number, roomRevenue: string } }>} rows
 */
export function reportTotalsByCurrency(rows) {
  const byCurrency = new Map();
  for (const row of rows) {
    const entry = byCurrency.get(row.currency) ?? {
      currency: row.currency,
      hotels: 0,
      sold: 0,
      sellable: 0,
      roomRevenue: toDecimal(0),
      totalRevenue: toDecimal(0),
      ly: { sold: 0, sellable: 0, roomRevenue: toDecimal(0) },
    };
    entry.hotels += 1;
    entry.sold += row.sold;
    entry.sellable += row.sellable;
    entry.roomRevenue = entry.roomRevenue.plus(row.roomRevenue);
    entry.totalRevenue = entry.totalRevenue.plus(row.totalRevenue);
    if (row.lastYear) {
      entry.ly.sold += row.lastYear.sold;
      entry.ly.sellable += row.lastYear.sellable;
      entry.ly.roomRevenue = entry.ly.roomRevenue.plus(row.lastYear.roomRevenue);
    }
    byCurrency.set(row.currency, entry);
  }
  return [...byCurrency.values()]
    .sort((a, b) => a.currency.localeCompare(b.currency))
    .map((entry) => {
      const occupancyPct = ratio(entry.sold, entry.sellable);
      const lyOccupancyPct = ratio(entry.ly.sold, entry.ly.sellable);
      const lyRevenue = entry.ly.roomRevenue;
      return {
        currency: entry.currency,
        hotels: entry.hotels,
        sold: entry.sold,
        sellable: entry.sellable,
        occupancyPct,
        roomRevenue: toMoneyString(entry.roomRevenue),
        totalRevenue: toMoneyString(entry.totalRevenue),
        adr: perUnit(entry.roomRevenue, entry.sold),
        revpar: perUnit(entry.roomRevenue, entry.sellable),
        lastYear: {
          sold: entry.ly.sold,
          sellable: entry.ly.sellable,
          occupancyPct: lyOccupancyPct,
          roomRevenue: toMoneyString(lyRevenue),
        },
        change: {
          occupancyPts: occupancyPct === null || lyOccupancyPct === null ? null : Math.round((occupancyPct - lyOccupancyPct) * 10) / 10,
          roomRevenue: lyRevenue.isZero() ? null : Math.round(entry.roomRevenue.minus(lyRevenue).dividedBy(lyRevenue.abs()).times(1000).toNumber()) / 10,
        },
      };
    });
}

/**
 * Panonun para birimi toplamları: bu gece satılan / satılabilir, gelecek / gidecek / konaklayan, bu gecenin net oda
 * geliri; oranlar toplamdan.
 *
 * @param {Array<{ currency: string, sold: number, sellable: number, arrivals: number, departures: number,
 *   inHouse: number, revenue: string }>} rows
 */
export function dashboardTotalsByCurrency(rows) {
  const byCurrency = new Map();
  for (const row of rows) {
    const entry = byCurrency.get(row.currency) ?? { currency: row.currency, hotels: 0, sold: 0, sellable: 0, arrivals: 0, departures: 0, inHouse: 0, revenue: toDecimal(0) };
    entry.hotels += 1;
    entry.sold += row.sold;
    entry.sellable += row.sellable;
    entry.arrivals += row.arrivals;
    entry.departures += row.departures;
    entry.inHouse += row.inHouse;
    entry.revenue = entry.revenue.plus(row.revenue);
    byCurrency.set(row.currency, entry);
  }
  return [...byCurrency.values()]
    .sort((a, b) => a.currency.localeCompare(b.currency))
    .map((entry) => ({
      currency: entry.currency,
      hotels: entry.hotels,
      sold: entry.sold,
      sellable: entry.sellable,
      occupancyPct: ratio(entry.sold, entry.sellable),
      arrivals: entry.arrivals,
      departures: entry.departures,
      inHouse: entry.inHouse,
      revenue: toMoneyString(entry.revenue),
      adr: perUnit(entry.revenue, entry.sold),
      revpar: perUnit(entry.revenue, entry.sellable),
    }));
}

/* ─────────────── Sayfalama imleci ─────────────── */

/**
 * Ada göre sıralı listelerin imleci (`ad|id`): ad tekil değil, id eşitliği bozar.
 * @param {{ name: string, id: string }} row
 */
export function encodeNameCursor(row) {
  return Buffer.from(JSON.stringify([row.name, row.id])).toString('base64url');
}

/**
 * @param {string | undefined} cursor
 * @returns {{ name: string, id: string } | null} bozuksa `null` (ilk sayfa)
 */
export function decodeNameCursor(cursor) {
  if (!cursor) return null;
  try {
    const [name, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof name !== 'string' || typeof id !== 'string') return null;
    return { name, id };
  } catch {
    return null;
  }
}
