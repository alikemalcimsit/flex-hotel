import { useQuery } from '@tanstack/react-query';
import { api, withQuery } from './api.js';
import { banquetKeys, useBanquetLive } from './banquet.js';
import { PURCHASING_CHANNEL, RECIPES_CHANNEL, STOCK_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

/**
 * Mutfak (modül 43), satın alma ve stok (modül 45): sorgu anahtarları,
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

/** Satın alma: hepsi `purchasing` kökünde (canlı tazeleme tek anahtarla hepsini yeniler). */
export const purchasingKeys = Object.freeze({
  all: ['purchasing'],
  /** @param {object} filters */
  list: (filters) => ['purchasing', 'list', filters],
  /** @param {string} id */
  detail: (id) => ['purchasing', 'detail', id],
  /** @param {object} filters */
  suggestions: (filters) => ['purchasing', 'suggestions', filters],
  /** @param {object} filters */
  openLines: (filters) => ['purchasing', 'open-lines', filters],
  /** @param {object} filters */
  rounds: (filters) => ['purchasing', 'rounds', filters],
  /** @param {string} id */
  round: (id) => ['purchasing', 'round', id],
  /** @param {object} filters */
  orders: (filters) => ['purchasing', 'orders', filters],
  /** @param {string} id */
  order: (id) => ['purchasing', 'order', id],
  /** @param {object} filters */
  receipts: (filters) => ['purchasing', 'receipts', filters],
  /** @param {string} id */
  receipt: (id) => ['purchasing', 'receipt', id],
  /** @param {object} filters */
  suppliers: (filters) => ['purchasing', 'suppliers', filters],
  /** @param {string} id */
  supplier: (id) => ['purchasing', 'supplier', id],
  settings: ['purchasing', 'settings'],
});

/** Stok (modül 45 / 44). */
export const stockKeys = Object.freeze({
  all: ['stock'],
  summary: ['stock', 'summary'],
  /** @param {object} filters */
  levels: (filters) => ['stock', 'levels', filters],
  /** @param {object} filters */
  movements: (filters) => ['stock', 'movements', filters],
  /** @param {boolean} includeInactive */
  warehouses: (includeInactive) => ['stock', 'warehouses', includeInactive],
});

/** Canlı tazelemede en kısa aralık. */
const LIVE_MIN_REFRESH_MS = 2_000;
/** Seçici sonuçları bu kadar süre taze sayılır (yazarken her harfte yeniden gitmesin). */
const PICKER_STALE_MS = 30_000;

/** Reçete / malzeme ekranları açıkken: mal kabul birim maliyeti (hareketli ortalama) değiştirince de. */
export function useRecipesLive() {
  useLiveChannel(STOCK_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [recipeKeys.all] });
  return useLiveChannel(RECIPES_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [recipeKeys.all] });
}

/** Satın alma ekranları açıkken (mal kabul stoğu da değiştirir: öneriler, açık satırlardaki mevcut). */
export function usePurchasingLive() {
  useLiveChannel(STOCK_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [purchasingKeys.all] });
  return useLiveChannel(PURCHASING_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [purchasingKeys.all] });
}

/** Stok ekranları açıkken (mal kabul siparişi de ilerletir: yoldaki miktar). */
export function useStockLive() {
  useLiveChannel(PURCHASING_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [stockKeys.all] });
  return useLiveChannel(STOCK_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [stockKeys.all] });
}

/**
 * Banket F&B ekranları: dosya / menü değişince (banket kanalı), birim maliyet ya da reçete
 * değişince (reçete kanalı), talep açılınca / iptal edilince (satın alma kanalı) tazelenir.
 */
export function useFnbLive() {
  const banquet = useBanquetLive();
  useLiveChannel(RECIPES_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [banquetKeys.all] });
  useLiveChannel(STOCK_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [banquetKeys.all] });
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
 * Tedarikçi seçici: etkin tedarikçiler, ad / kod / vergi no (sayfalı listenin ilk sayfası).
 * @param {{ search: string, enabled?: boolean }} options
 */
export function useSupplierPicker({ search, enabled = true }) {
  const filters = { search: search || undefined, active: 'true', page: 1, pageSize: 30 };
  return useQuery({ queryKey: purchasingKeys.suppliers({ ...filters, picker: true }), queryFn: () => api(withQuery('/purchasing/suppliers', filters)), staleTime: PICKER_STALE_MS, enabled });
}

/** Etkin depolar (mal kabulde seçilir; en fazla `MAX_WAREHOUSES`). */
export function useWarehouses({ includeInactive = false, enabled = true } = {}) {
  return useQuery({ queryKey: stockKeys.warehouses(includeInactive), queryFn: () => api(withQuery('/stock/warehouses', { includeInactive: includeInactive ? 'true' : undefined })), enabled });
}

/**
 * Malzeme seçici: aktif kartlar, ad / koda göre (sayfalı listenin ilk sayfası).
 * @param {{ search: string, enabled?: boolean }} options
 */
export function useStockPicker({ search, enabled = true }) {
  const filters = { search: search || undefined, active: 'true', page: 1, pageSize: 30 };
  return useQuery({ queryKey: recipeKeys.stock({ ...filters, picker: true }), queryFn: () => api(withQuery('/recipes/stock-items', filters)), staleTime: PICKER_STALE_MS, enabled });
}
