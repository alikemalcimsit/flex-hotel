import { PAYMENT_KIND_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_SOURCE_LABELS, PAYMENT_STATUS_LABELS } from '@hotelos/hotel-contracts';

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

export const methodLabel = (method) => PAYMENT_METHOD_LABELS[method] ?? method;
export const kindLabel = (kind) => PAYMENT_KIND_LABELS[kind] ?? kind;
export const sourceLabel = (source) => PAYMENT_SOURCE_LABELS[source] ?? source;
export const paymentStatusLabel = (status) => PAYMENT_STATUS_LABELS[status] ?? status;

/** "36.125000" → "36,125" (gösterim; hesap sunucuda). */
export function formatRate(rate) {
  if (!rate) return '—';
  const text = String(rate);
  return (text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text).replace('.', ',');
}

/** Eksi işaretsiz tutar metni ("-500.00" → "500.00"). */
export const absolute = (value) => String(value ?? '').replace(/^-/, '');
