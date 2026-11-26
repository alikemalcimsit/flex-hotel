import { CASH_ORIGIN_LABELS, PAYMENT_KIND_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_SOURCE_LABELS, PAYMENT_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { getCurrentLocale } from '../i18n/current.js';
import { tNow } from '../i18n/translate.js';

/**
 * Ödeme (modül 17): sorgu anahtarları ve ortak yardımcılar.
 *
 * Folyonun ödeme listesi folyo anahtarlarının altında (`folioKeys.payments`):
 * ödeme folyonun bakiyesini değiştirir, folyo ekranı birlikte tazelenir. Kasa
 * ve kurlar `['cash', ...]` altında; canlı kanal `cash.changed`.
 */

export const cashKeys = Object.freeze({
  all: ['cash'],
  /** @param {object} filters */
  summary: (filters) => ['cash', 'summary', filters],
  /** @param {object} filters */
  movements: (filters) => ['cash', 'movements', filters],
  rates: ['cash', 'rates'],
  /** Kur ayarı: TCMB'den otomatik çekme, kur türü, dövizler (modül 60). */
  rateSettings: ['cash', 'rate-settings'],
  /** @param {object} filters */
  rateHistory: (filters) => ['cash', 'rate-history', filters],
  /** @param {object} input */
  quote: (input) => ['cash', 'quote', input],
});

export const PAYMENT_METHOD_ICONS = Object.freeze({
  CASH: 'banknote',
  CARD: 'creditCard',
  TRANSFER: 'send',
  VIRTUAL_POS: 'globe',
  AGENCY: 'building',
  VOUCHER: 'fileText',
});

export const PAYMENT_STATUS_TONES = Object.freeze({ PENDING: 'warning', POSTED: 'success', DECLINED: 'neutral' });

/** Etkin arayüz dilinde etiketler (modül 60; sözlük `i18n/tr/payments.js`, `i18n/en/payments.js`, Türkçesi sözleşmeden). */
export const methodLabel = (method) => tNow(`payments.method.${method}`, PAYMENT_METHOD_LABELS[method] ?? method);
export const kindLabel = (kind) => tNow(`payments.kind.${kind}`, PAYMENT_KIND_LABELS[kind] ?? kind);
export const sourceLabel = (source) => tNow(`payments.source.${source}`, PAYMENT_SOURCE_LABELS[source] ?? source);
export const paymentStatusLabel = (status) => tNow(`payments.status.${status}`, PAYMENT_STATUS_LABELS[status] ?? status);
/** @param {string} origin FOLIO | EVENT | POS | SPA */
export const originLabel = (origin) => tNow(`payments.origin.${origin}`, CASH_ORIGIN_LABELS[origin] ?? origin);

/** "36.125000" → "36,125" (İngilizcede "36.125"; gösterim; hesap sunucuda). */
export function formatRate(rate) {
  if (!rate) return '—';
  const text = String(rate);
  const trimmed = text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  return getCurrentLocale() === 'tr' ? trimmed.replace('.', ',') : trimmed;
}

/** Eksi işaretsiz tutar metni ("-500.00" → "500.00"). */
export const absolute = (value) => String(value ?? '').replace(/^-/, '');
