import { toDecimal, toMoneyString } from '@hotelos/core';
import { BONUS_PACE_TOLERANCE_PCT } from '@hotelos/hotel-contracts';

/**
 * Acente priminin saf kuralları (modül 35) — veritabanı, HTTP ve saat bilmez.
 *
 * Girdi bir kuralın koşulları (ölçüt, uygulama, kademeler, tavan) ve dönemin
 * üretimidir (gerçekleşen gece + vergisiz oda geliri). Çıktı ulaşılan kademe,
 * dilim dökümü ve primdir.
 *
 * ### Tanımlar
 *
 * - **Ulaşılan kademe:** üretim eşiğe **eşit ya da büyükse** kademeye ulaşılmıştır
 *   (1000 gece eşiğine 1000. gecede ulaşılır).
 * - **`WHOLE` (tüm üretime):** ulaşılan en yüksek kademenin oranı dönemin bütün
 *   cirosuna uygulanır (geriye dönük).
 * - **`EXCESS` (dilimli):** her kademenin oranı yalnızca eşiğini aşan, bir sonraki
 *   eşiğe kadarki dilime uygulanır. Ciro ölçütünde dilim tutarın kendisidir; gece
 *   ölçütünde dilimdeki gece sayısı **dönemin ortalama gece geliriyle** tutara
 *   çevrilir (hangi gecenin "aşan" olduğu sırasından bağımsız; sezonun sonundaki
 *   pahalı geceler primi şişirmez).
 * - **Tavan:** prim (dilimlerin toplamı) tavanı aşarsa tavan ödenir.
 *
 * ### Yuvarlama
 *
 * Dilim matrahı ve dilim primi kuruşa yuvarlanır (yarım yukarı); prim **yuvarlanmış
 * dilimlerin toplamıdır** — raporda dilimler toplamı her zaman primi tutar. Eksi
 * ciro (gelirinden fazla düzeltme yazılmış dönem) sıfır sayılır; prim eksi olmaz.
 */

const ZERO = () => toDecimal(0);
const HUNDRED = 100;

/**
 * @typedef {{ threshold: string, ratePct: string }} BonusTier
 * @typedef {'NIGHTS' | 'REVENUE'} BonusMetric
 * @typedef {'WHOLE' | 'EXCESS'} BonusMode
 * @typedef {{ tier: number, ratePct: string, from: string, to: string | null, base: string, amount: string, nights?: number }} BonusSlice
 * @typedef {{
 *   achieved: string,
 *   tierIndex: number,
 *   ratePct: string | null,
 *   slices: BonusSlice[],
 *   grossAmount: string,
 *   amount: string,
 *   capped: boolean,
 *   effectiveRatePct: string | null,
 * }} BonusResult
 */

/**
 * Ölçüte göre üretim: gece sayısı ya da ciro.
 * @param {BonusMetric} metric
 * @param {{ nights: number, revenue: string | number | import('@hotelos/core').Decimal }} production
 */
export function achievedOf(metric, { nights, revenue }) {
  return metric === 'NIGHTS' ? toDecimal(nights) : toDecimal(revenue);
}

/**
 * Ulaşılan kademe sayısı (0 = hiçbiri, 1..n). Eşikler artan sıradadır.
 * @param {BonusTier[]} tiers
 * @param {import('@hotelos/core').Decimal} achieved
 */
export function reachedTier(tiers, achieved) {
  let reached = 0;
  tiers.forEach((tier, index) => {
    if (achieved.greaterThanOrEqualTo(toDecimal(tier.threshold))) reached = index + 1;
  });
  return reached;
}

/**
 * Sonraki kademe ve ona kalan (gece ya da tutar). Hepsine ulaşıldıysa `null`.
 * @param {BonusTier[]} tiers
 * @param {import('@hotelos/core').Decimal} achieved
 * @param {BonusMetric} metric
 * @returns {{ tier: number, threshold: string, ratePct: string, remaining: string } | null}
 */
export function nextTier(tiers, achieved, metric) {
  const index = reachedTier(tiers, achieved);
  if (index >= tiers.length) return null;
  const next = tiers[index];
  const remaining = toDecimal(next.threshold).minus(achieved);
  return {
    tier: index + 1,
    threshold: next.threshold,
    ratePct: next.ratePct,
    remaining: metric === 'NIGHTS' ? remaining.toFixed(0) : toMoneyString(remaining),
  };
}

/**
 * Hedefe ulaşma yüzdesi (puan), kuruş hassasiyetinde. Hedef sıfırsa 0.
 * @param {import('@hotelos/core').Decimal} achieved
 * @param {string | number} target
 */
export function scorePct(achieved, target) {
  const goal = toDecimal(target);
  if (!goal.greaterThan(0)) return '0.00';
  return toMoneyString(achieved.times(HUNDRED).dividedBy(goal));
}

/**
 * Primi hesaplar.
 *
 * @param {{
 *   metric: BonusMetric,
 *   mode: BonusMode,
 *   tiers: BonusTier[],
 *   maxBonus?: string | null,
 *   nights: number,
 *   revenue: string | number | import('@hotelos/core').Decimal,
 * }} input
 * @returns {BonusResult}
 */
export function computeBonus({ metric, mode, tiers, maxBonus = null, nights, revenue }) {
  if (!Number.isInteger(nights) || nights < 0) throw new RangeError(`Gece sayısı geçersiz: ${nights}`);
  if (tiers.length === 0) throw new RangeError('Kademe yok');
  const income = nonNegative(toDecimal(revenue));
  const achieved = achievedOf(metric, { nights, revenue: income });
  const tierIndex = reachedTier(tiers, achieved);

  /** @type {BonusSlice[]} */
  const slices = [];
  if (tierIndex > 0 && mode === 'WHOLE') {
    const tier = tiers[tierIndex - 1];
    slices.push({
      tier: tierIndex,
      ratePct: tier.ratePct,
      from: tier.threshold,
      to: null,
      base: toMoneyString(income),
      amount: toMoneyString(income.times(toDecimal(tier.ratePct)).dividedBy(HUNDRED)),
    });
  } else if (tierIndex > 0) {
    for (let index = 0; index < tierIndex; index += 1) {
      const tier = tiers[index];
      const lower = toDecimal(tier.threshold);
      const upper = index + 1 < tiers.length ? toDecimal(tiers[index + 1].threshold) : null;
      const reach = upper && achieved.greaterThan(upper) ? upper : achieved;
      const band = nonNegative(reach.minus(lower));
      // Gece ölçütünde dilimin cirosu: dilimdeki gece × ortalama gece geliri.
      const base = metric === 'REVENUE' ? band : nights > 0 ? income.times(band).dividedBy(nights) : ZERO();
      /** @type {BonusSlice} */
      const slice = {
        tier: index + 1,
        ratePct: tier.ratePct,
        from: tier.threshold,
        to: upper ? tiers[index + 1].threshold : null,
        base: toMoneyString(base),
        amount: toMoneyString(base.times(toDecimal(tier.ratePct)).dividedBy(HUNDRED)),
      };
      if (metric === 'NIGHTS') slice.nights = band.toNumber();
      slices.push(slice);
    }
  }

  const gross = slices.reduce((total, slice) => total.plus(toDecimal(slice.amount)), ZERO());
  const cap = maxBonus === null || maxBonus === undefined || maxBonus === '' ? null : toDecimal(maxBonus);
  const payable = cap && gross.greaterThan(cap) ? cap : gross;
  return {
    achieved: metric === 'NIGHTS' ? achieved.toFixed(0) : toMoneyString(achieved),
    tierIndex,
    ratePct: tierIndex > 0 ? tiers[tierIndex - 1].ratePct : null,
    slices,
    grossAmount: toMoneyString(gross),
    amount: toMoneyString(payable),
    capped: payable.lessThan(gross),
    effectiveRatePct: income.greaterThan(0) ? toMoneyString(payable.times(HUNDRED).dividedBy(income)) : null,
  };
}

/** @param {import('@hotelos/core').Decimal} value */
function nonNegative(value) {
  return value.greaterThan(0) ? value : ZERO();
}

const DAY_MS = 86_400_000;
const dayIndex = (day) => Math.round(Date.parse(`${day}T00:00:00.000Z`) / DAY_MS);

/**
 * Zamana göre ilerleme: dönemin geçen kısmına düşen doğrusal beklentiyle kıyas.
 *
 * Geçen gün = iş gününden önceki dönem geceleri (bugünün gecesi henüz
 * gerçekleşmedi). Dönem başlamadıysa beklenti yoktur (`pace: null`). Gerçekleşen
 * beklentiye eşit ya da fazlaysa "önünde", toleransın içinde eksikse "yakın",
 * daha eksikse "gerisinde".
 *
 * @param {{ startDate: string, endDate: string, businessDate: string, target: string | number, achieved: import('@hotelos/core').Decimal, metric: BonusMetric }} input
 * @returns {{ totalDays: number, elapsedDays: number, expected: string, pace: 'AHEAD' | 'NEAR' | 'BEHIND' | null, paceRatioPct: string | null }}
 */
export function paceOf({ startDate, endDate, businessDate, target, achieved, metric }) {
  const totalDays = dayIndex(endDate) - dayIndex(startDate) + 1;
  const elapsedDays = Math.max(0, Math.min(totalDays, dayIndex(businessDate) - dayIndex(startDate)));
  const expectedValue = toDecimal(target).times(elapsedDays).dividedBy(totalDays);
  const expected = metric === 'NIGHTS' ? expectedValue.toDecimalPlaces(0).toFixed(0) : toMoneyString(expectedValue);
  if (elapsedDays === 0 || !expectedValue.greaterThan(0)) return { totalDays, elapsedDays, expected, pace: null, paceRatioPct: null };
  const ratio = achieved.times(HUNDRED).dividedBy(expectedValue);
  const pace = ratio.greaterThanOrEqualTo(HUNDRED) ? 'AHEAD' : ratio.greaterThanOrEqualTo(HUNDRED - BONUS_PACE_TOLERANCE_PCT) ? 'NEAR' : 'BEHIND';
  return { totalDays, elapsedDays, expected, pace, paceRatioPct: toMoneyString(ratio) };
}

/**
 * Hak edişin bugünkü verilerle farkı: hesaptan sonra üretim değişti mi?
 * @param {{ nights: number, revenue: string }} snapshot
 * @param {{ nights: number, revenue: string }} current
 * @returns {{ nights: number, revenue: string } | null} fark (bugün − hesap) ya da yok
 */
export function productionDrift(snapshot, current) {
  const nights = current.nights - snapshot.nights;
  const revenue = toDecimal(current.revenue).minus(toDecimal(snapshot.revenue));
  if (nights === 0 && revenue.isZero()) return null;
  return { nights, revenue: toMoneyString(revenue) };
}
