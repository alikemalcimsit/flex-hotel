import { Decimal, sum, toDecimal } from '@hotelos/core';

/**
 * Model çağrısının maliyeti (USD).
 *
 * Fiyatlar sağlayıcının **1 milyon token** başına fiyatıdır ve otelin AI
 * ayarlarından gelir: sağlayıcı fiyat değiştirdiğinde kod değişmez, ayar
 * değişir. Önbellekten okunan girdi tokenı (OpenAI `cached_tokens`) girdi
 * tokenının **içindedir** ve indirimli fiyattan sayılır.
 *
 * Para-kritik: günlük bütçe bu toplamla denetlenir. Ondalık kütüphanesiyle
 * hesaplanır, `Number` ile değil.
 *
 * @param {{ inputTokens: number, cachedInputTokens?: number, outputTokens: number }} usage
 * @param {{ input: string, cachedInput: string, output: string }} price 1M token başına USD
 * @returns {string} altı ondalıklı USD ("0.001234")
 */
export function usageCost(usage, price) {
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const fresh = usage.inputTokens - cached;
  const perToken = (value) => toDecimal(value).dividedBy(1_000_000);
  const total = sum(
    perToken(price.input).times(fresh),
    perToken(price.cachedInput).times(cached),
    perToken(price.output).times(usage.outputTokens),
  );
  // Yukarı yuvarlanır: bütçe hiçbir zaman eksik sayılmaz.
  return total.toDecimalPlaces(6, Decimal.ROUND_UP).toFixed(6);
}

/**
 * Bütçe kalan mı? Harcanan ≥ bütçe ise yeni çağrı yapılmaz. Bütçe 0 ise
 * AI kapalı sayılır (sınırsız bütçe yoktur: yanlış ayar faturayı patlatmasın).
 *
 * @param {string} spentUsd bugün harcanan
 * @param {string} budgetUsd günlük bütçe
 */
export function budgetExhausted(spentUsd, budgetUsd) {
  const budget = toDecimal(budgetUsd);
  if (budget.lte(0)) return true;
  return toDecimal(spentUsd).gte(budget);
}

/**
 * Bir modelin fiyatı ayarlarda var mı ve geçerli mi? Fiyatı bilinmeyen modelle
 * çağrı yapılmaz: maliyet sayılamazsa bütçe de denetlenemez.
 *
 * @param {Record<string, { input: string, cachedInput: string, output: string }>} prices
 * @param {string} model
 */
export function priceFor(prices, model) {
  const price = prices?.[model];
  if (!price) return null;
  const valid = ['input', 'cachedInput', 'output'].every((key) => {
    try {
      return toDecimal(price[key]).gte(0);
    } catch {
      return false;
    }
  });
  return valid ? price : null;
}
