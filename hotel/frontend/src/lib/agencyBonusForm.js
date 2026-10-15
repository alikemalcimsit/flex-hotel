import { AGENCY_BONUS_MODE_LABELS, MAX_BONUS_TIERS } from '@hotelos/hotel-contracts';

/**
 * Acente prim kuralı formunun saf dönüşümleri (modül 35): sunucudaki kural ↔
 * form alanları, gönderilecek gövde, önizleme gövdesi ve kademelerin okunur
 * cümleleri. Tarayıcıya bağlı bir şey içermez (birim test edilir): personelin
 * "ne tanımladım" diye okuduğu cümle ile kaydedilen kuralın aynı olması buna bağlı.
 */

/** Boş kademe satırı. */
export const EMPTY_TIER = Object.freeze({ threshold: '', ratePct: '' });

/** Boş form: gece ölçütü, tüm üretime, tek kademe. */
export const EMPTY_BONUS_FORM = Object.freeze({
  agency: null,
  name: '',
  startDate: '',
  endDate: '',
  metric: 'NIGHTS',
  mode: 'WHOLE',
  target: '',
  tiers: Object.freeze([EMPTY_TIER]),
  roomTypeIds: Object.freeze([]),
  maxBonus: '',
  notes: '',
});

/** @param {unknown} value */
const text = (value) => (value === null || value === undefined ? '' : String(value));

/** Formda Türkçe yazım: "1500000.50" → "1500000,5"; tam sayı olduğu gibi. @param {unknown} value */
function decimalText(value) {
  const raw = text(value);
  if (raw === '') return '';
  return String(Number(raw)).replace('.', ',');
}

/**
 * Sunucudaki kural → form.
 * @param {any} rule `toRuleDto` (yoksa boş form)
 * @param {{ agency?: { id: string, code: string, name: string } | null }} [defaults] yeni kuralda önceden seçili acente
 */
export function formOf(rule, defaults = {}) {
  if (!rule) return { ...EMPTY_BONUS_FORM, tiers: [{ ...EMPTY_TIER }], roomTypeIds: [], agency: defaults.agency ?? null };
  return {
    agency: rule.agency ? { id: rule.agency.id, code: rule.agency.code, name: rule.agency.name } : null,
    name: text(rule.name),
    startDate: text(rule.startDate),
    endDate: text(rule.endDate),
    metric: rule.metric,
    mode: rule.mode,
    target: decimalText(rule.target),
    tiers: (rule.tiers ?? []).map((tier) => ({ threshold: decimalText(tier.threshold), ratePct: decimalText(tier.ratePct) })),
    roomTypeIds: [...(rule.roomTypeIds ?? [])],
    maxBonus: decimalText(rule.maxBonus),
    notes: text(rule.notes),
  };
}

/** Kural koşulları (önizleme ve kayıt ortak). @param {typeof EMPTY_BONUS_FORM} form */
function termsOf(form) {
  return {
    startDate: form.startDate,
    endDate: form.endDate,
    metric: form.metric,
    mode: form.mode,
    target: form.target.trim(),
    tiers: form.tiers.map((tier) => ({ threshold: tier.threshold.trim(), ratePct: tier.ratePct.trim() })),
    roomTypeIds: [...form.roomTypeIds],
    maxBonus: form.maxBonus.trim() === '' ? null : form.maxBonus.trim(),
  };
}

/**
 * Gönderilecek gövde. Yeni kuralda acente, düzenlemede sürüm gider (acente değişmez).
 * @param {typeof EMPTY_BONUS_FORM} form
 * @param {string | null} expectedUpdatedAt düzenlemede formun dayandığı sürüm
 */
export function payloadOf(form, expectedUpdatedAt = null) {
  const body = { name: form.name.trim(), ...termsOf(form), notes: form.notes.trim() || null };
  return expectedUpdatedAt ? { ...body, expectedUpdatedAt } : { ...body, agencyId: form.agency?.id ?? '' };
}

/**
 * Önizleme gövdesi; önizlemeye yetmeyen formda `null` (acente, dönem, hedef ve
 * en az bir dolu kademe gerekir).
 * @param {typeof EMPTY_BONUS_FORM} form
 */
export function previewPayloadOf(form) {
  if (!form.agency || !form.startDate || !form.endDate || form.endDate < form.startDate || form.target.trim() === '') return null;
  const terms = termsOf(form);
  if (!terms.tiers.some((tier) => tier.threshold && tier.ratePct)) return null;
  return { agencyId: form.agency.id, ...terms, tiers: terms.tiers.filter((tier) => tier.threshold && tier.ratePct) };
}

/**
 * Yeni kademe satırı ekler (üst sınıra kadar).
 * @param {Array<{ threshold: string, ratePct: string }>} tiers
 */
export const addTier = (tiers) => (tiers.length >= MAX_BONUS_TIERS ? tiers : [...tiers, { ...EMPTY_TIER }]);

/**
 * Kademe satırını siler (en az bir satır kalır).
 * @param {Array<{ threshold: string, ratePct: string }>} tiers
 * @param {number} index
 */
export const removeTier = (tiers, index) => (tiers.length <= 1 ? tiers : tiers.filter((_, position) => position !== index));

/**
 * Doğrulama hatalarını kademe satırlarına dağıtır: "tiers.1.ratePct" → satır 1, oran.
 * @param {Record<string, string>} errors
 * @returns {Map<number, { threshold?: string, ratePct?: string }>}
 */
export function tierErrorsByRow(errors) {
  /** @type {Map<number, { threshold?: string, ratePct?: string }>} */
  const rows = new Map();
  for (const [key, message] of Object.entries(errors ?? {})) {
    const match = /^tiers\.(\d+)\.(threshold|ratePct)$/.exec(key);
    if (!match) continue;
    const index = Number(match[1]);
    rows.set(index, { ...(rows.get(index) ?? {}), [match[2]]: message });
  }
  return rows;
}

/** "1500" → "1.500 gece"; tutar → "1.500.000 TRY". */
function quantity(metric, value, currency) {
  const number = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(number)) return String(value);
  if (metric === 'NIGHTS') return `${number.toLocaleString('tr-TR')} gece`;
  return `${number.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${currency}`.trim();
}

/** "1,5" ya da "1.5" → "%1,5". */
const rateText = (value) => `%${String(value).replace('.', ',')}`;

/**
 * Kademelerin okunur cümleleri (formun yan paneli ve kural ekranı aynı metni gösterir).
 *
 * - Tüm üretime: "1.500 gece ve üstü → bütün ciroya %1".
 * - Dilimli: "1.500 – 2.000 gece arası → bu dilime %1", son kademe "2.000 gece üstü → aşan kısma %2".
 *
 * @param {{ metric: 'NIGHTS' | 'REVENUE', mode: 'WHOLE' | 'EXCESS', tiers: Array<{ threshold: string, ratePct: string }>, maxBonus?: string | null }} terms
 * @param {string} currency
 * @returns {{ headline: string, lines: string[] }}
 */
export function describeTiers(terms, currency) {
  const tiers = terms.tiers.filter((tier) => text(tier.threshold).trim() && text(tier.ratePct).trim());
  const lines = tiers.map((tier, index) => {
    const from = quantity(terms.metric, tier.threshold, currency);
    if (terms.mode === 'WHOLE') return `${from} ve üstü → bütün ciroya ${rateText(tier.ratePct)}`;
    const next = tiers[index + 1];
    return next
      ? `${from} – ${quantity(terms.metric, next.threshold, currency)} arası → bu dilime ${rateText(tier.ratePct)}`
      : `${from} üstü → aşan kısma ${rateText(tier.ratePct)}`;
  });
  const cap = text(terms.maxBonus).trim();
  if (cap) lines.push(`Prim en fazla ${quantity('REVENUE', cap, currency)} (tavan)`);
  return { headline: AGENCY_BONUS_MODE_LABELS[terms.mode] ?? '', lines };
}
