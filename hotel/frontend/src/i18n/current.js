import { APP_LOCALES } from '@hotelos/hotel-contracts';

/**
 * Etkin arayüz dili — modül düzeyinde tek kaynak (modül 60).
 *
 * React dışındaki kod (biçimlendiriciler `lib/format.js`, `lib/timeFormat.js`, toast metinleri) dili buradan okur;
 * `I18nProvider` dil değişince `setCurrentLocale` çağırır. Node testlerinde hiç ayarlanmaz → 'tr' (eski çıktılar aynı).
 */

export const DEFAULT_LOCALE = 'tr';

/** Arayüz dili → `Intl` yerel kodu. */
export const INTL_LOCALES = Object.freeze({ tr: 'tr-TR', en: 'en-GB' });

let currentLocale = DEFAULT_LOCALE;

/**
 * Desteklenen dil mi? Değilse null ("en-US" → "en").
 * @param {unknown} value @returns {string | null}
 */
export function normalizeLocale(value) {
  if (typeof value !== 'string' || !value) return null;
  const code = value.slice(0, 2).toLowerCase();
  return APP_LOCALES.includes(code) ? code : null;
}

/** @returns {string} 'tr' | 'en' */
export function getCurrentLocale() {
  return currentLocale;
}

/** @returns {string} 'tr-TR' | 'en-GB' */
export function getIntlLocale() {
  return INTL_LOCALES[currentLocale] ?? INTL_LOCALES[DEFAULT_LOCALE];
}

/**
 * @param {string} locale @returns {boolean} değişti mi
 */
export function setCurrentLocale(locale) {
  const next = normalizeLocale(locale) ?? DEFAULT_LOCALE;
  if (next === currentLocale) return false;
  currentLocale = next;
  return true;
}
