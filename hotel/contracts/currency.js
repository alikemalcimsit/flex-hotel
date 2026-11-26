import { z } from './locale.js';
import { currencyField } from './payments.js';

/**
 * Çoklu dil ve çoklu para birimi sözleşmeleri (modül 60).
 *
 * Kararlar:
 * - **Kur TCMB'den:** iş günü B için B'den önceki son TCMB bülteni ("önceki günün kuru"; gün içinde kur değişmez). Hafta sonu / tatilde
 *   bülten yoktur, geriye bakılır. Kur türü ayardan (varsayılan döviz alış). Elle girilen kur TCMB'ninkiyle ezilmez; elle giriş her zaman
 *   mümkündür. JPY gibi birimi 100 olan kurlar birime bölünür.
 * - **Arayüz dili** kullanıcının (tr / en); **gösterim para birimi** tutarların yanında yaklaşık karşılık gösterir (kayıtlar otelin
 *   para biriminde kalır).
 * - **Fatura** otelin para biriminde (TL) kesilir; istenirse toplamın döviz karşılığı kur ve günüyle not olarak yazılır.
 */

export const APP_LOCALES = Object.freeze(['tr', 'en']);
export const APP_LOCALE_LABELS = Object.freeze({ tr: 'Türkçe', en: 'English' });

export const EXCHANGE_RATE_KINDS = Object.freeze(['FOREX_BUYING', 'FOREX_SELLING', 'BANKNOTE_BUYING', 'BANKNOTE_SELLING']);
export const EXCHANGE_RATE_KIND_LABELS = Object.freeze({
  FOREX_BUYING: 'Döviz alış',
  FOREX_SELLING: 'Döviz satış',
  BANKNOTE_BUYING: 'Efektif alış',
  BANKNOTE_SELLING: 'Efektif satış',
});
/** TCMB XML'indeki alan adları. */
export const TCMB_RATE_FIELDS = Object.freeze({ FOREX_BUYING: 'ForexBuying', FOREX_SELLING: 'ForexSelling', BANKNOTE_BUYING: 'BanknoteBuying', BANKNOTE_SELLING: 'BanknoteSelling' });
export const EXCHANGE_RATE_SOURCES = Object.freeze(['MANUAL', 'TCMB']);
export const EXCHANGE_RATE_SOURCE_LABELS = Object.freeze({ MANUAL: 'Elle', TCMB: 'TCMB' });
/** Gösterim / widget için sık kullanılan dövizler. */
export const COMMON_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'CHF', 'RUB', 'JPY', 'SAR', 'AZN', 'CNY', 'DKK', 'SEK', 'NOK']);
/** TCMB bülteni bulunamazsa en çok bu kadar gün geriye bakılır (uzun bayram). */
export const TCMB_LOOKBACK_DAYS = 10;

/**
 * İş günü B için denenecek bülten günleri: B−1, B−2, … (en çok `TCMB_LOOKBACK_DAYS`). Hafta sonu atlanır.
 * @param {string} businessDay "YYYY-AA-GG" @returns {string[]}
 */
export function tcmbCandidateDays(businessDay) {
  const days = [];
  const start = new Date(`${businessDay}T00:00:00.000Z`);
  for (let offset = 1; offset <= TCMB_LOOKBACK_DAYS; offset += 1) {
    const date = new Date(start.getTime() - offset * 86_400_000);
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    days.push(date.toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Bültenden bir dövizin TL karşılığı (birime bölünmüş, 6 ondalık); yoksa null.
 * @param {{ currencies: Record<string, { unit: number, rates: Record<string, string | null> }> }} bulletin
 * @param {string} currency @param {string} kind
 */
export function tcmbRate(bulletin, currency, kind) {
  const row = bulletin.currencies[currency];
  const raw = row?.rates[kind];
  const value = Number(raw);
  if (!row || !raw || !Number.isFinite(value) || value <= 0) return null;
  return (value / (row.unit || 1)).toFixed(6);
}

/**
 * Yaklaşık karşılık: otel para birimindeki tutar ÷ dövizin kuru (1 döviz = kur TL). Kur yoksa null.
 * @param {string | number} amount @param {string | number | null} rate
 */
export function convertFromHotelCurrency(amount, rate) {
  const value = Number(amount);
  const divisor = Number(rate);
  if (!Number.isFinite(value) || !divisor) return null;
  return (Math.round((value / divisor) * 100) / 100).toFixed(2);
}

export const exchangeRateSettingsSchema = z.object({
  expectedUpdatedAt: z.union([z.string(), z.date(), z.null()]).default(null),
  autoFetch: z.boolean(),
  rateKind: z.enum(EXCHANGE_RATE_KINDS).default('FOREX_BUYING'),
  currencies: z.array(currencyField).min(1, 'En az bir döviz seçin').max(20).refine((list) => new Set(list).size === list.length, { message: 'Aynı döviz iki kez' }),
});

export const userPreferencesSchema = z.object({
  locale: z.enum(APP_LOCALES).optional(),
  /** Boş = yalnız otelin para birimi. */
  displayCurrency: currencyField.nullish(),
});

/** Faturada döviz karşılığı (taslak): boş = yok. */
export const invoiceForeignCurrencySchema = currencyField.nullish();
