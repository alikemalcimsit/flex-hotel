import { useQuery } from '@tanstack/react-query';
import { api, withQuery } from './api.js';
import { banquetKeys, useBanquetLive } from './banquet.js';
import { PURCHASING_CHANNEL, RECIPES_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

/**
 * Mutfak (modül 43): reçete / malzeme kartı ve satın alma talebinin sorgu anahtarları,
 * canlı tazeleme ve seçici sorguları. Saf biçimler: `kitchenFormat.js`, menü formu:
 * `menuForm.js`, yazdırma: `kitchenPrint.js` (Node testinde `api.js` yüklenmesin diye ayrı).
 */

export const recipeKeys = Object.freeze({
  all: ['recipes'],
  /** @param {object} filters */
  list: (filters) => ['recipes', 'list', filters],
  /** @param {string} id */
  detail: (id) => ['recipes', 'detail', id],
  /** @param {object} filters */
  stock: (filters) => ['recipes', 'stock', filters],
  /** @param {object} filters */
  picker: (filters) => ['recipes', 'picker', filters],
  /** @param {object} filters */
  menuItems: (filters) => ['recipes', 'menu-items', filters],
});

export const purchasingKeys = Object.freeze({
  all: ['purchasing'],
  /** @param {object} filters */
  list: (filters) => ['purchasing', 'list', filters],
  /** @param {string} id */
  detail: (id) => ['purchasing', 'detail', id],
});

/** Canlı tazelemede en kısa aralık. */
const LIVE_MIN_REFRESH_MS = 2_000;
/** Seçici sonuçları bu kadar süre taze sayılır (yazarken her harfte yeniden gitmesin). */
const PICKER_STALE_MS = 30_000;

/** Reçete / malzeme ekranları açıkken. */
export function useRecipesLive() {
  return useLiveChannel(RECIPES_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [recipeKeys.all] });
}

/** Satın alma ekranları açıkken. */
export function usePurchasingLive() {
  return useLiveChannel(PURCHASING_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [purchasingKeys.all] });
}

/**
 * Banket F&B ekranları: dosya / menü değişince (banket kanalı), birim maliyet ya da reçete
 * değişince (reçete kanalı), talep açılınca / iptal edilince (satın alma kanalı) tazelenir.
 */
export function useFnbLive() {
  const banquet = useBanquetLive();
  useLiveChannel(RECIPES_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [banquetKeys.all] });
  useLiveChannel(PURCHASING_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [banquetKeys.all, purchasingKeys.all] });
  return banquet;
}

/**
 * Reçete seçici (aktif reçeteler; yemek / ara ürün). Boş aramada da ilk sonuçları getirir.
 * @param {{ search: string, kind?: string, exclude?: string, enabled?: boolean }} options
 */
export function useRecipePicker({ search, kind, exclude, enabled = true }) {
  const filters = { search: search || undefined, kind, exclude };
  return useQuery({ queryKey: recipeKeys.picker(filters), queryFn: () => api(withQuery('/recipes/picker', filters)), staleTime: PICKER_STALE_MS, enabled });
}

/**
 * Malzeme seçici: aktif kartlar, ad / koda göre (sayfalı listenin ilk sayfası).
 * @param {{ search: string, enabled?: boolean }} options
 */
export function useStockPicker({ search, enabled = true }) {
  const filters = { search: search || undefined, active: 'true', page: 1, pageSize: 30 };
  return useQuery({ queryKey: recipeKeys.stock({ ...filters, picker: true }), queryFn: () => api(withQuery('/recipes/stock-items', filters)), staleTime: PICKER_STALE_MS, enabled });
}
