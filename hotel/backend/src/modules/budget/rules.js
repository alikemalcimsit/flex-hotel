import { toDecimal, toMoneyString } from '@hotelos/core';
import { BUDGET_MONTHS, varianceTone } from '@hotelos/hotel-contracts';

/**
 * Bütçenin saf kuralları (modül 27) — veritabanı bilmez, birim testli.
 *
 * ### Dönem ve orantılı plan
 *
 * Gerçekleşen yalnızca kapanmış günler için vardır (folyoya işlenen gelir iş
 * gününden önceki günlerin). Bu yüzden:
 * - Geçmiş ay: planın tamamı.
 * - İçinde bulunulan ay: plan × (kapanmış gün / ayın gün sayısı) — "ay içi"
 *   (pacing); ekranda işaretlenir.
 * - Gelecek ay: kapsam dışı (gerçekleşen yok, sapma yok).
 * Oranlar (doluluk, ADR) orantılanmaz; dönemin ağırlıklı ortalamasıdır.
 *
 * ### Ağırlıklı hedefler
 *
 * Doluluk hedefi ay ay yüzdedir; birden çok ayın hedefi o ayların
 * satılabilir odasıyla ağırlıklanır (satılabilir oda gerçekleşenden: aynı
 * odalar). ADR hedefi planlanan geceyle ağırlıklanır (planlanan gece =
 * doluluk hedefi × satılabilir oda).
 */

const ZERO = () => toDecimal(0);

/**
 * Ayın gün sayısı.
 * @param {number} year
 * @param {number} month 1–12
 */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Bir ayın gerçekleşen için kapanmış gün oranı (0–1).
 * @param {number} year
 * @param {number} month 1–12
 * @param {string} businessDate "YYYY-AA-GG" (otelin iş günü; o gün kapanmamıştır)
 */
export function closedShare(year, month, businessDate) {
  const by = Number(businessDate.slice(0, 4));
  const bm = Number(businessDate.slice(5, 7));
  if (year < by || (year === by && month < bm)) return 1;
  if (year > by || month > bm) return 0;
  return (Number(businessDate.slice(8, 10)) - 1) / daysInMonth(year, month);
}

/**
 * Dönemin ayları: tek ay ya da yılbaşından seçilen aya kadar; gerçekleşeni
 * hiç olmayan (gelecek) aylar çıkar.
 *
 * @param {{ year: number, month: number, scope: 'MONTH' | 'YTD', businessDate: string }} input
 * @returns {Array<{ month: number, share: number }>} `share` < 1 ise ay içi
 */
export function periodMonths({ year, month, scope, businessDate }) {
  const months = scope === 'YTD' ? Array.from({ length: month }, (_, index) => index + 1) : [month];
  return months.map((value) => ({ month: value, share: closedShare(year, value, businessDate) })).filter((entry) => entry.share > 0);
}

/**
 * Para kaleminin dönem planı (ay içi orantılı). Planlanmamış ay sayılmaz;
 * dönemde hiç plan yoksa `null`.
 *
 * @param {Array<string | null>} months 12 ayın planı
 * @param {Array<{ month: number, share: number }>} period
 */
export function periodPlan(months, period) {
  let total = null;
  for (const { month, share } of period) {
    const value = months[month - 1];
    if (value === null || value === undefined) continue;
    total = (total ?? ZERO()).plus(toDecimal(value).times(share));
  }
  return total;
}

/**
 * Para kaleminin dönem gerçekleşeni (ay → tutar). Girilmemiş ay varsa
 * eksik (`complete: false`): giderin gerçekleşeni elle girilir.
 *
 * @param {Map<number, string | import('@hotelos/core').Decimal>} byMonth
 * @param {Array<{ month: number }>} period
 * @param {{ manual: boolean }} options elle girilen kalem mi (sistem kaleminde boş ay = 0)
 */
export function periodActual(byMonth, period, { manual }) {
  let total = ZERO();
  let missing = 0;
  for (const { month } of period) {
    const value = byMonth.get(month);
    if (value === undefined || value === null) {
      if (manual) missing += 1;
      continue;
    }
    total = total.plus(toDecimal(value));
  }
  if (manual && missing === period.length) return { total: null, complete: false };
  return { total, complete: missing === 0 };
}

/**
 * Doluluk ve ADR hedeflerinin dönem değeri (ağırlıklı).
 *
 * @param {{
 *   occupancy: Array<string | null>,
 *   adr: Array<string | null>,
 *   sellable: Map<number, number>,
 *   period: Array<{ month: number }>,
 * }} input
 * @returns {{ occupancyPct: number | null, adr: import('@hotelos/core').Decimal | null, nights: number | null }}
 */
export function periodTargets({ occupancy, adr, sellable, period }) {
  let rooms = 0;
  let nights = 0;
  let plannedOcc = false;
  let adrWeight = 0;
  let adrSum = ZERO();
  for (const { month } of period) {
    const target = occupancy[month - 1];
    const available = sellable.get(month) ?? 0;
    if (target === null || target === undefined) continue;
    plannedOcc = true;
    rooms += available;
    const monthNights = (Number(target) / 100) * available;
    nights += monthNights;
    const rate = adr[month - 1];
    if (rate !== null && rate !== undefined && monthNights > 0) {
      adrSum = adrSum.plus(toDecimal(rate).times(monthNights));
      adrWeight += monthNights;
    }
  }
  // Doluluk hedefi yokken ADR hedefi tek başına: ayların düz ortalaması (ağırlık için gece yok).
  if (!plannedOcc) {
    const rates = period.map(({ month }) => adr[month - 1]).filter((value) => value !== null && value !== undefined);
    const average = rates.length ? rates.reduce((sum, value) => sum.plus(toDecimal(value)), ZERO()).dividedBy(rates.length) : null;
    return { occupancyPct: null, adr: average, nights: null };
  }
  return {
    occupancyPct: rooms > 0 ? Math.round((nights / rooms) * 1000) / 10 : null,
    adr: adrWeight > 0 ? adrSum.dividedBy(adrWeight) : null,
    nights,
  };
}

/**
 * Sapma satırı.
 *
 * @param {{
 *   kind: 'REVENUE' | 'KPI' | 'EXPENSE' | 'CASH',
 *   unit: 'MONEY' | 'PCT',
 *   plan: import('@hotelos/core').Decimal | number | null,
 *   actual: import('@hotelos/core').Decimal | number | null,
 * }} input
 */
export function varianceOf({ kind, unit, plan, actual }) {
  if (plan === null || plan === undefined || actual === null || actual === undefined) {
    return { difference: null, differencePct: null, tone: 'NEUTRAL' };
  }
  if (unit === 'PCT') {
    const difference = Math.round((Number(actual) - Number(plan)) * 10) / 10;
    return { difference: String(difference), differencePct: null, tone: varianceTone(kind, difference) };
  }
  const planned = toDecimal(plan);
  const difference = toDecimal(actual).minus(planned);
  const differencePct = planned.isZero() ? null : Math.round(difference.dividedBy(planned.abs()).times(1000).toNumber()) / 10;
  return { difference: toMoneyString(difference), differencePct, tone: varianceTone(kind, difference.toNumber()) };
}

/**
 * Oda gelirinin sapmasını doluluk ve fiyat etkisine ayırır (klasik ayrıştırma):
 * - doluluk etkisi = (gerçek gece − planlanan gece) × hedef ADR
 * - fiyat etkisi = (gerçek ADR − hedef ADR) × gerçek gece
 * İkisi toplamı "hedeflerin ima ettiği gelir" ile gerçek arasındaki farktır;
 * girilen oda geliri planı hedeflerle tutmuyorsa kalan fark ayrıca verilir.
 *
 * @param {{
 *   planRevenue: import('@hotelos/core').Decimal | null,
 *   actualRevenue: import('@hotelos/core').Decimal,
 *   planNights: number | null,
 *   planAdr: import('@hotelos/core').Decimal | null,
 *   actualNights: number,
 * }} input
 * @returns {null | { occupancyEffect: string, rateEffect: string, planGap: string | null }}
 */
export function roomRevenueDrivers({ planRevenue, actualRevenue, planNights, planAdr, actualNights }) {
  if (planNights === null || planAdr === null) return null;
  const actualAdr = actualNights > 0 ? actualRevenue.dividedBy(actualNights) : ZERO();
  const occupancyEffect = planAdr.times(actualNights - planNights);
  const rateEffect = actualAdr.minus(planAdr).times(actualNights);
  const implied = planAdr.times(planNights);
  return {
    occupancyEffect: toMoneyString(occupancyEffect),
    rateEffect: toMoneyString(rateEffect),
    // Girilen plan ile hedeflerin ima ettiği gelir arasındaki fark (plan tutarsızlığı).
    planGap: planRevenue === null ? null : toMoneyString(implied.minus(planRevenue)),
  };
}

/**
 * 12 aylık plan dizisinin yıllık toplamı (para kalemi); boşsa `null`.
 * @param {Array<string | null>} months
 */
export function yearTotal(months) {
  const values = months.filter((value) => value !== null && value !== undefined);
  if (values.length === 0) return null;
  return toMoneyString(values.reduce((sum, value) => sum.plus(toDecimal(value)), ZERO()));
}

/** Boş 12 ay. */
export const emptyMonths = () => Array.from({ length: BUDGET_MONTHS }, () => null);

/**
 * En büyük sapmalar (yorum için): para kalemlerinin mutlak farkına göre,
 * hedefler ayrı.
 * @param {Array<{ code: string, kind: string, unit: string, difference: string | null }>} rows
 * @param {number} limit
 */
export function topVariances(rows, limit) {
  return rows
    .filter((row) => row.unit === 'MONEY' && row.kind !== 'KPI' && row.difference !== null && toDecimal(row.difference).abs().gt(0))
    .sort((a, b) => toDecimal(b.difference).abs().comparedTo(toDecimal(a.difference).abs()))
    .slice(0, limit);
}
