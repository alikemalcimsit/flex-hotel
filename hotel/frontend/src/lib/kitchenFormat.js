import { ALLERGEN_LABELS, KITCHEN_UNIT_LABELS } from '@hotelos/hotel-contracts';

/**
 * Mutfak ekranlarının saf biçimleri (modül 43): miktar + birim, alerjen, gıda maliyeti
 * yüzdesinin tonu. Değerler sunucudan metin gelir; burada yalnızca gösterim.
 */

const QUANTITY = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });

/** "103.445" + KG → "103,445 kg". @param {string | number | null | undefined} value @param {string} unit */
export const quantityText = (value, unit) => (value === null || value === undefined || value === '' ? '—' : `${QUANTITY.format(Number(value))} ${KITCHEN_UNIT_LABELS[unit] ?? unit}`);

/** Alerjen adları (sabit sırayla gelir). @param {string[] | null | undefined} list */
export const allergenText = (list) => (list?.length ? list.map((allergen) => ALLERGEN_LABELS[allergen] ?? allergen).join(', ') : '—');

/** "18.7" → "%18,7". @param {string | null | undefined} value */
export const pctText = (value) => (value === null || value === undefined ? '—' : `%${String(value).replace('.', ',')}`);

/** Politika yüzdesi, sondaki sıfırlar atılarak: "5.00" → "%5", "2.50" → "%2,5". @param {string | number} value */
export const policyPctText = (value) => pctText(String(Number(value)));

/**
 * Gıda maliyeti yüzdesinin uyarı eşikleri: banket ve restoranda hedef çoğunlukla %25–30;
 * %30'u geçen ürün / menü fiyat ya da reçete gözden geçirilmeli, %38 üstü zarar riskidir.
 */
export const FOOD_COST_WARNING_PCT = 30;
export const FOOD_COST_DANGER_PCT = 38;

/** @param {string | null | undefined} pct */
export function foodCostTone(pct) {
  if (pct === null || pct === undefined) return 'neutral';
  const value = Number(pct);
  if (value >= FOOD_COST_DANGER_PCT) return 'danger';
  if (value >= FOOD_COST_WARNING_PCT) return 'warning';
  return 'success';
}
