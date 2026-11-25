import { api, withQuery } from './api.js';
import { ACCOUNTING_CHANNEL, LEDGER_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

/**
 * Genel muhasebe (modül 48): sorgu anahtarları, canlı tazeleme ve hesap seçici sorgusu. Hepsi `ledger` kökünde:
 * canlı haber tek anahtarla mizan, yevmiye, hesap planı, kurallar ve ayarları yeniler. Ön muhasebe kanalı da
 * dinlenir: cari / kasa hareketi yazılınca fişlenmemiş hareket sayısı değişir.
 */

export const ledgerKeys = Object.freeze({
  all: ['ledger'],
  /** @param {object} filters */
  chart: (filters) => ['ledger', 'chart', filters],
  /** @param {string} search */
  picker: (search) => ['ledger', 'picker', search],
  /** @param {string} id @param {object} filters */
  accountLines: (id, filters) => ['ledger', 'account-lines', id, filters],
  /** @param {object} filters */
  journals: (filters) => ['ledger', 'journals', filters],
  /** @param {string} id */
  journal: (id) => ['ledger', 'journal', id],
  /** @param {object} filters */
  trialBalance: (filters) => ['ledger', 'trial-balance', filters],
  rules: ['ledger', 'rules'],
  settings: ['ledger', 'settings'],
});

/** Genel muhasebe ekranı açıkken: fiş yazılınca / iptal edilince, hesap planı, kural ve ayar değişince tazelenir. */
const LIVE_MIN_REFRESH_MS = 1_500;
export function useLedgerLive() {
  useLiveChannel(ACCOUNTING_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [ledgerKeys.all] });
  return useLiveChannel(LEDGER_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [ledgerKeys.all] });
}

/**
 * Hesap seçici sorgusu (fiş satırı, kural, kasa fişinin karşı hesabı): kod / ad; yalnız yaprak ve etkin
 * hesaplar, boş aramada en çok kullanılanlar.
 * @param {string} search
 */
export const glAccountPickerQuery = (search) => ({
  queryKey: ledgerKeys.picker(search),
  queryFn: () => api(withQuery('/ledger/chart/picker', { search: search || undefined })),
});

/** Hesabın kısa yazımı: "600.01 · Oda geliri". @param {{ code: string, name: string } | null | undefined} account */
export const glAccountLabel = (account) => (account ? `${account.code} · ${account.name}` : '—');

/** Fiş durumunun rozet rengi (yevmiye listesi ve fiş sayfası). */
export const JOURNAL_STATUS_TONES = Object.freeze({ POSTED: 'success', VOIDED: 'neutral' });
