import { api, withQuery } from './api.js';
import { formatMoney } from './format.js';
import { ACCOUNTING_CHANNEL, CASH_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

/**
 * Ön muhasebe (modül 47): sorgu anahtarları, canlı tazeleme, seçici sorguları ve bakiye metinleri.
 * Hepsi `accounting` kökünde: canlı haber tek anahtarla bütün muhasebe ekranlarını yeniler.
 */

export const accountingKeys = Object.freeze({
  all: ['accounting'],
  /** @param {object} filters */
  accounts: (filters) => ['accounting', 'accounts', filters],
  /** @param {string} id */
  account: (id) => ['accounting', 'account', id],
  /** @param {string} id @param {object} filters */
  statement: (id, filters) => ['accounting', 'statement', id, filters],
  /** @param {object} filters */
  aging: (filters) => ['accounting', 'aging', filters],
  /** @param {object} filters */
  treasury: (filters) => ['accounting', 'treasury', filters],
  /** @param {string} id */
  treasuryAccount: (id) => ['accounting', 'treasury-account', id],
  /** @param {string} id @param {object} filters */
  movements: (id, filters) => ['accounting', 'movements', id, filters],
  /** @param {object} filters */
  vouchers: (filters) => ['accounting', 'vouchers', filters],
  /** @param {string} id */
  voucher: (id) => ['accounting', 'voucher', id],
  /** @param {object} filters */
  instruments: (filters) => ['accounting', 'instruments', filters],
  /** @param {string} id */
  instrument: (id) => ['accounting', 'instrument', id],
  settings: ['accounting', 'settings'],
  /** @param {object} filters */
  picker: (filters) => ['accounting', 'picker', filters],
});

/** Muhasebe ekranı açıkken: kayıt yazılınca (aktör, fiş, çek) ve kasa değişince tazelenir. */
const LIVE_MIN_REFRESH_MS = 1_500;
export function useAccountingLive() {
  useLiveChannel(CASH_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [accountingKeys.all] });
  return useLiveChannel(ACCOUNTING_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [accountingKeys.all] });
}

/**
 * Cari seçici sorgusu (fiş, ödeme penceresi): ad / kod / vergi no; boş aramada son hareket görenler.
 * @param {string} [type]
 */
export const accountPickerQuery = (type) => (search) => ({
  queryKey: accountingKeys.picker({ search, type }),
  queryFn: () => api(withQuery('/accounting/accounts/picker', { search, type })),
});

/**
 * Cari bakiyesinin okunuşu: artı "borçlu" (cari bize borçlu), eksi "alacaklı" (biz cariye borçluyuz).
 * @param {string | null | undefined} balance @param {string} currency
 * @returns {{ text: string, side: 'DEBIT' | 'CREDIT' | null, tone: 'success' | 'warning' | 'neutral' }}
 */
export function balanceLabel(balance, currency) {
  const value = Number(balance ?? 0);
  if (value === 0) return { text: formatMoney('0', currency), side: null, tone: 'neutral' };
  return value > 0
    ? { text: `${formatMoney(String(value), currency)} (B)`, side: 'DEBIT', tone: 'success' }
    : { text: `${formatMoney(String(-value), currency)} (A)`, side: 'CREDIT', tone: 'warning' };
}

/** Kasa / banka tutarı: + giriş, − çıkış. @param {string} amount @param {string} currency */
export function signedMoney(amount, currency) {
  const value = Number(amount);
  return `${value < 0 ? '−' : '+'}${formatMoney(String(Math.abs(value)), currency)}`;
}

/** Bugünün ilk günü (ay başı) ve yılbaşı, "YYYY-AA-GG". @param {string} today */
export const monthStart = (today) => `${today.slice(0, 7)}-01`;
/** @param {string} today */
export const yearStart = (today) => `${today.slice(0, 4)}-01-01`;
