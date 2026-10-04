import { toDecimal, toMoneyString } from '@hotelos/core';
import { REPORT_LAST_YEAR_OFFSET_DAYS, shiftDay } from '@hotelos/hotel-contracts';

/**
 * Gelir raporlarının saf kuralları (modül 23) — veritabanı bilmez, birim testli.
 *
 * Sıra: SQL günlük ham toplamları verir (satılan gece, satılabilir oda,
 * işlenen gelir sınıfları, eldeki brüt gelir); burada her gün için gelirin
 * kaynağı seçilir (geçmiş: folyo, bugün ve sonrası: rezervasyon), günler
 * gruplanır ve oranlar **toplamlardan** hesaplanır. Yuvarlama en sonda,
 * kuruşa, yarım yukarı (`@hotelos/core` money).
 */

const ZERO = () => toDecimal(0);

/**
 * Dahil vergiyi ayırır: brüt ÷ (1 + oran/100). Yuvarlamadan (sonda yuvarlanır).
 * @param {import('@hotelos/core').Decimal | string | number} gross
 * @param {import('@hotelos/core').Decimal | string | number} includedRate yüzde
 */
export function netOfIncluded(gross, includedRate) {
  return toDecimal(gross).dividedBy(toDecimal(1).plus(toDecimal(includedRate).dividedBy(100)));
}

/**
 * Günün kovası: gün kendisi, hafta (pazartesi), ay (ayın ilk günü).
 * @param {string} day "YYYY-AA-GG"
 * @param {'DAY' | 'WEEK' | 'MONTH'} groupBy
 */
export function bucketOf(day, groupBy) {
  if (groupBy === 'MONTH') return `${day.slice(0, 7)}-01`;
  if (groupBy === 'WEEK') {
    const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay(); // 0 pazar
    return shiftDay(day, -((weekday + 6) % 7));
  }
  return day;
}

/**
 * Aralığın günleri (iki uç dahil).
 * @param {string} from
 * @param {string} to
 */
export function daysBetween(from, to) {
  const days = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day);
  return days;
}

/**
 * Oranlar (toplamlardan): doluluk yüzdesi (bir ondalık), ADR, RevPAR.
 * Payda sıfırsa tanımsız (`null`): "0" yanıltır.
 *
 * @param {{ sold: number, sellable: number, roomRevenue: import('@hotelos/core').Decimal }} totals
 */
export function ratios({ sold, sellable, roomRevenue }) {
  return {
    occupancyPct: sellable > 0 ? Math.round((sold / sellable) * 1000) / 10 : null,
    adr: sold > 0 ? toMoneyString(roomRevenue.dividedBy(sold)) : null,
    revpar: sellable > 0 ? toMoneyString(roomRevenue.dividedBy(sellable)) : null,
  };
}

/**
 * Değişim yüzdesi (bir ondalık). Önceki yoksa ya da sıfırsa tanımsız.
 * @param {number | string | null} current
 * @param {number | string | null} previous
 * @returns {number | null}
 */
export function changePct(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  const before = toDecimal(previous);
  if (before.isZero()) return null;
  return Math.round(toDecimal(current).minus(before).dividedBy(before.abs()).times(1000).toNumber()) / 10;
}

/**
 * @typedef {{
 *   sold: number,
 *   roomRevenue: import('@hotelos/core').Decimal,
 *   discounts: import('@hotelos/core').Decimal,
 *   fees: import('@hotelos/core').Decimal,
 *   cancellations: import('@hotelos/core').Decimal,
 *   sellable: number,
 *   onTheBooks: boolean,
 * }} DayTotals
 */

/**
 * Her günün toplamı. Gelirin kaynağı güne göre seçilir: iş gününden önceki
 * günler folyoya işlenen (gerçekleşen), iş günü ve sonrası rezervasyonun gece
 * fiyatından eldeki (dahil vergi ayrılmış). Ek ücret ve iptal geliri yalnızca
 * gerçekleşende vardır.
 *
 * @param {{
 *   days: string[],
 *   businessDate: string,
 *   includedTaxRate: import('@hotelos/core').Decimal | string,
 *   sellable: Map<string, number>,
 *   nights: Array<{ day: string, sold: number, gross: unknown }>,
 *   posted: Array<{ day: string, room: unknown, discounts: unknown, fees: unknown, cancellations: unknown }>,
 * }} input `nights` / `posted` aynı günün birden fazla satırı olabilir (kırılım)
 * @returns {Map<string, DayTotals>}
 */
export function dailyTotals({ days, businessDate, includedTaxRate, sellable, nights, posted }) {
  /** @type {Map<string, DayTotals>} */
  const byDay = new Map(
    days.map((day) => [
      day,
      {
        sold: 0,
        roomRevenue: ZERO(),
        discounts: ZERO(),
        fees: ZERO(),
        cancellations: ZERO(),
        sellable: sellable.get(day) ?? 0,
        onTheBooks: day >= businessDate,
      },
    ]),
  );
  for (const row of nights) {
    const entry = byDay.get(row.day);
    if (!entry) continue;
    entry.sold += Number(row.sold ?? 0);
    if (entry.onTheBooks) entry.roomRevenue = entry.roomRevenue.plus(netOfIncluded(row.gross ?? 0, includedTaxRate));
  }
  for (const row of posted) {
    const entry = byDay.get(row.day);
    if (!entry || entry.onTheBooks) continue;
    entry.roomRevenue = entry.roomRevenue.plus(toDecimal(row.room ?? 0));
    entry.discounts = entry.discounts.plus(toDecimal(row.discounts ?? 0));
    entry.fees = entry.fees.plus(toDecimal(row.fees ?? 0));
    entry.cancellations = entry.cancellations.plus(toDecimal(row.cancellations ?? 0));
  }
  return byDay;
}

const emptyTotals = () => ({ sold: 0, sellable: 0, roomRevenue: ZERO(), discounts: ZERO(), fees: ZERO(), cancellations: ZERO() });

/**
 * @param {ReturnType<typeof emptyTotals>} target
 * @param {DayTotals | undefined} day
 */
function accumulate(target, day) {
  if (!day) return;
  target.sold += day.sold;
  target.sellable += day.sellable;
  target.roomRevenue = target.roomRevenue.plus(day.roomRevenue);
  target.discounts = target.discounts.plus(day.discounts);
  target.fees = target.fees.plus(day.fees);
  target.cancellations = target.cancellations.plus(day.cancellations);
}

/**
 * Günleri kovalara toplar; oranlar kova toplamlarından. Geçen yılın günleri
 * **bu yılın karşılık günü** (364 gün sonrası) üzerinden aynı kovaya düşer:
 * iki dönem gün gün hizalı, kovalar aynı uzunlukta.
 *
 * @param {{ days: string[], groupBy: 'DAY' | 'WEEK' | 'MONTH', current: Map<string, DayTotals>, lastYear: Map<string, DayTotals> }} input
 */
export function bucketRows({ days, groupBy, current, lastYear }) {
  /** @type {Map<string, { key: string, from: string, to: string, days: number, onTheBooksDays: number, now: object, ly: object }>} */
  const buckets = new Map();

  for (const day of days) {
    const key = bucketOf(day, groupBy);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, from: day, to: day, days: 0, onTheBooksDays: 0, now: emptyTotals(), ly: emptyTotals() };
      buckets.set(key, bucket);
    }
    bucket.to = day;
    bucket.days += 1;
    const today = current.get(day);
    if (today?.onTheBooks) bucket.onTheBooksDays += 1;
    accumulate(bucket.now, today);
    accumulate(bucket.ly, lastYear.get(shiftDay(day, -REPORT_LAST_YEAR_OFFSET_DAYS)));
  }

  return [...buckets.values()].map((bucket) => {
    const now = periodFigures(bucket.now);
    const ly = periodFigures(bucket.ly);
    return {
      key: bucket.key,
      from: bucket.from,
      to: bucket.to,
      days: bucket.days,
      onTheBooksDays: bucket.onTheBooksDays,
      ...now,
      lastYear: { from: shiftDay(bucket.from, -REPORT_LAST_YEAR_OFFSET_DAYS), to: shiftDay(bucket.to, -REPORT_LAST_YEAR_OFFSET_DAYS), ...ly },
      change: changeSet(now, ly),
    };
  });
}

/**
 * Dönemin rakamları (para metin, oranlar toplamdan).
 * @param {{ sold: number, sellable: number, roomRevenue: any, discounts: any, fees: any, cancellations: any }} totals
 */
export function periodFigures(totals) {
  return {
    sold: totals.sold,
    sellable: totals.sellable,
    roomRevenue: toMoneyString(totals.roomRevenue),
    discounts: toMoneyString(totals.discounts),
    fees: toMoneyString(totals.fees),
    cancellations: toMoneyString(totals.cancellations),
    totalRevenue: toMoneyString(totals.roomRevenue.plus(totals.fees).plus(totals.cancellations)),
    ...ratios(totals),
  };
}

/**
 * Geçen yıla göre değişim: doluluk puan farkı (yüzde puanı), diğerleri yüzde.
 * @param {ReturnType<typeof periodFigures>} now
 * @param {ReturnType<typeof periodFigures>} ly
 */
export function changeSet(now, ly) {
  return {
    occupancyPts: now.occupancyPct === null || ly.occupancyPct === null ? null : Math.round((now.occupancyPct - ly.occupancyPct) * 10) / 10,
    sold: changePct(now.sold, ly.sold),
    roomRevenue: changePct(now.roomRevenue, ly.roomRevenue),
    adr: changePct(now.adr, ly.adr),
    revpar: changePct(now.revpar, ly.revpar),
  };
}

/**
 * Aralığın tamamı (oranlar toplamdan) ve geçen yılın hizalı günleri.
 * @param {string[]} days
 * @param {Map<string, DayTotals>} current
 * @param {Map<string, DayTotals>} lastYear
 */
export function rangeTotals(days, current, lastYear) {
  const total = emptyTotals();
  const totalLy = emptyTotals();
  for (const day of days) {
    accumulate(total, current.get(day));
    accumulate(totalLy, lastYear.get(shiftDay(day, -REPORT_LAST_YEAR_OFFSET_DAYS)));
  }
  const now = periodFigures(total);
  const ly = periodFigures(totalLy);
  return { ...now, lastYear: ly, change: changeSet(now, ly) };
}

/**
 * Kırılım (oda tipi / kaynak): aralığın satılan gecesi ve oda geliri, ADR ve
 * gelirdeki payı; geçen yılın aynı anahtarı yanında. Gelire göre büyükten
 * küçüğe; yalnızca geçen yıl olan anahtar da gösterilir (o yıl satılıp bu yıl
 * satılmayan oda tipi kaybolmasın).
 *
 * @param {{
 *   current: Array<{ key: string, sold: number, roomRevenue: import('@hotelos/core').Decimal }>,
 *   lastYear: Array<{ key: string, sold: number, roomRevenue: import('@hotelos/core').Decimal }>,
 *   label: (key: string) => string,
 * }} input
 */
export function breakdownRows({ current, lastYear, label }) {
  const sum = (rows) => rows.reduce((total, row) => total.plus(row.roomRevenue), ZERO());
  const totalNow = sum(current);
  const totalLy = sum(lastYear);
  const lyByKey = new Map(lastYear.map((row) => [row.key, row]));
  const keys = [...new Set([...current.map((row) => row.key), ...lastYear.map((row) => row.key)])];
  const byKey = new Map(current.map((row) => [row.key, row]));
  const share = (value, total) => (total.isZero() ? null : Math.round(value.dividedBy(total).times(1000).toNumber()) / 10);

  return keys
    .map((key) => {
      const now = byKey.get(key) ?? { key, sold: 0, roomRevenue: ZERO() };
      const ly = lyByKey.get(key) ?? { key, sold: 0, roomRevenue: ZERO() };
      const adr = now.sold > 0 ? toMoneyString(now.roomRevenue.dividedBy(now.sold)) : null;
      const lyAdr = ly.sold > 0 ? toMoneyString(ly.roomRevenue.dividedBy(ly.sold)) : null;
      return {
        key,
        label: label(key),
        sold: now.sold,
        roomRevenue: toMoneyString(now.roomRevenue),
        adr,
        sharePct: share(now.roomRevenue, totalNow),
        lastYear: { sold: ly.sold, roomRevenue: toMoneyString(ly.roomRevenue), adr: lyAdr, sharePct: share(ly.roomRevenue, totalLy) },
        change: { sold: changePct(now.sold, ly.sold), roomRevenue: changePct(now.roomRevenue, ly.roomRevenue), adr: changePct(adr, lyAdr) },
        _sort: now.roomRevenue,
      };
    })
    .sort((a, b) => b._sort.comparedTo(a._sort) || b.sold - a.sold || a.label.localeCompare(b.label, 'tr'))
    .map(({ _sort, ...row }) => row);
}

/**
 * Kırılımın ham satırlarını (gün × anahtar) anahtara göre toplar; günün gelir
 * kaynağı `dailyTotals`'daki kuralla aynıdır.
 *
 * @param {{
 *   businessDate: string,
 *   includedTaxRate: import('@hotelos/core').Decimal | string,
 *   nights: Array<{ day: string, key: string, sold: number, gross: unknown }>,
 *   posted: Array<{ day: string, key: string, room: unknown }>,
 * }} input
 */
export function sumByKey({ businessDate, includedTaxRate, nights, posted }) {
  /** @type {Map<string, { key: string, sold: number, roomRevenue: import('@hotelos/core').Decimal }>} */
  const byKey = new Map();
  const entry = (key) => {
    let row = byKey.get(key);
    if (!row) {
      row = { key, sold: 0, roomRevenue: ZERO() };
      byKey.set(key, row);
    }
    return row;
  };
  for (const row of nights) {
    const target = entry(row.key);
    target.sold += Number(row.sold ?? 0);
    if (row.day >= businessDate) target.roomRevenue = target.roomRevenue.plus(netOfIncluded(row.gross ?? 0, includedTaxRate));
  }
  for (const row of posted) {
    if (row.day >= businessDate) continue;
    entry(row.key).roomRevenue = entry(row.key).roomRevenue.plus(toDecimal(row.room ?? 0));
  }
  return [...byKey.values()];
}
