import { DEFAULT_LOCALE, getCurrentLocale } from './current.js';
import { DICTIONARIES } from './dictionaries.js';

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * `{ad}` yer tutucularını doldurur; değeri verilmeyen yer tutucu olduğu gibi kalır.
 * @param {string} text @param {Record<string, unknown> | undefined} vars
 */
export function interpolate(text, vars) {
  if (!vars) return text;
  return text.replace(PLACEHOLDER, (match, name) => (vars[name] === undefined || vars[name] === null ? match : String(vars[name])));
}

/**
 * Saf çeviri: seçili dil → Türkçe sözlük → verilen Türkçe yedek metin → anahtarın kendisi. Eksik anahtar sessizdir
 * (uyarı yok) — ekranlar kademeli taşınır.
 *
 * İkinci argüman metinse yedek metindir, nesneyse değişkenler: `t('cash.title')`, `t('cash.saved', { date })`,
 * `t(\`nav.${to}\`, 'Kasa')`, `t('x.y', 'Yedek {n}', { n: 2 })`.
 *
 * @param {string} locale @param {string} key
 * @param {string | Record<string, unknown>} [fallbackOrVars] @param {Record<string, unknown>} [maybeVars]
 * @param {Record<string, Record<string, string>>} [dictionaries]
 * @returns {string}
 */
export function translate(locale, key, fallbackOrVars, maybeVars, dictionaries = DICTIONARIES) {
  const fallback = typeof fallbackOrVars === 'string' ? fallbackOrVars : undefined;
  const vars = fallbackOrVars && typeof fallbackOrVars === 'object' ? fallbackOrVars : maybeVars;
  const text = dictionaries[locale]?.[key] ?? dictionaries[DEFAULT_LOCALE]?.[key] ?? fallback ?? key;
  return interpolate(text, vars);
}

/**
 * React dışında (yardımcılar, toast, biçimlendirici) etkin dilde çeviri. Bileşende `useT()` kullanın: dil değişince
 * yeniden çizilir.
 * @param {string} key @param {string | Record<string, unknown>} [fallbackOrVars] @param {Record<string, unknown>} [maybeVars]
 */
export function tNow(key, fallbackOrVars, maybeVars) {
  return translate(getCurrentLocale(), key, fallbackOrVars, maybeVars);
}
