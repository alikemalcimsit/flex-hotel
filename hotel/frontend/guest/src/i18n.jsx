import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { PORTAL_LANGUAGES } from './limits.js';
import { MESSAGES } from './messages.js';

/**
 * Dil: misafirin seçtiği (tarayıcı hatırlar) → portalın önerdiği (uyruğa göre) → tarayıcının dili → Türkçe.
 * Tarih, para ve ülke adları `Intl` ile misafirin dilinde.
 */
const STORAGE_KEY = 'hotelos-guest-language';
const LanguageContext = createContext(null);

function storedLanguage() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return PORTAL_LANGUAGES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

function browserLanguage() {
  const code = String(navigator.language ?? '').slice(0, 2).toLowerCase();
  return PORTAL_LANGUAGES.includes(code) ? code : null;
}

export function LanguageProvider({ children }) {
  const [chosen, setChosen] = useState(storedLanguage);
  const [suggested, setSuggested] = useState(null);
  const language = chosen ?? suggested ?? browserLanguage() ?? 'tr';
  const choose = useCallback((value) => {
    setChosen(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Gizli sekme: yalnız bu oturumda.
    }
  }, []);
  const value = useMemo(() => ({ language, choose, suggest: setSuggested }), [language, choose]);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** @returns {{ language: string, choose: (value: string) => void, suggest: (value: string | null) => void, t: (key: string, vars?: Record<string, any>) => string, fmt: ReturnType<typeof formatters> }} */
export function useI18n() {
  const context = useContext(LanguageContext);
  const { language } = context;
  const t = useCallback(
    (key, vars = {}) => {
      const text = MESSAGES[language]?.[key] ?? MESSAGES.en[key] ?? key;
      return text.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined || vars[name] === null ? match : String(vars[name])));
    },
    [language],
  );
  const fmt = useMemo(() => formatters(language), [language]);
  return { ...context, t, fmt };
}

/** @param {string} language */
export function formatters(language) {
  const locale = { tr: 'tr-TR', en: 'en-GB', de: 'de-DE', ru: 'ru-RU' }[language] ?? 'en-GB';
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const short = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const time = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  let regions = null;
  try {
    regions = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    regions = null;
  }
  return {
    /** "2026-11-10" → "10 Kasım 2026" */
    day: (value) => (value ? day.format(new Date(`${String(value).slice(0, 10)}T00:00:00Z`)) : '—'),
    shortDay: (value) => (value ? short.format(new Date(`${String(value).slice(0, 10)}T00:00:00Z`)) : '—'),
    dateTime: (value) => (value ? time.format(new Date(value)) : '—'),
    money: (value, currency) => {
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: currency || 'TRY' }).format(Number(value));
      } catch {
        return `${Number(value).toFixed(2)} ${currency ?? ''}`.trim();
      }
    },
    country: (code) => {
      try {
        return regions?.of(code) ?? code;
      } catch {
        return code;
      }
    },
    nights: (from, to) => Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)),
  };
}

/** Sunucu hatasının misafirin dilindeki metni. @param {(key: string) => string} t @param {any} error */
export function errorText(t, error) {
  const code = String(error?.code ?? 'UNKNOWN');
  if (code.startsWith('CHECKIN_')) return t('err.CHECKIN');
  const key = `err.${code}`;
  const text = t(key);
  return text === key ? t('err.UNKNOWN') : text;
}
