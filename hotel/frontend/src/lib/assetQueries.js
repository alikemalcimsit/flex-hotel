import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiPatch, apiPost, withQuery } from './api.js';
import { assetKeys } from './assets.js';
import { ASSETS_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';
import { toastError, toastSuccess } from '../store/toast.js';

/**
 * Demirbaş (modül 46) sorgu ve işlem kancaları. Kanal (`assets.changed`) açıkken ekranlar başka personelin
 * işlemiyle (kart, sayımda okutma, yıl amortismanı) tazelenir; sürüm hatasında (başkası değiştirdi) kayıt yeniden
 * okunur.
 */

/** Canlı tazelemede en kısa aralık (sayımda birden çok okuyucu aynı anda okutur). */
const LIVE_MIN_REFRESH_MS = 1_500;
/** Seçici listeleri (kategori, alan, oda, personel) bu kadar süre taze sayılır. */
const OPTIONS_STALE_MS = 60_000;
/** Ekranın tazelenmesini gerektiren hata kodları. */
const REFRESH_CODES = Object.freeze(['STALE_WRITE', 'INVALID_TRANSITION', 'CONFLICT']);
/** Hata alan altına yazılacaksa bildirim gösterilmez (form kendisi gösterir). @param {any} error */
const hasFieldErrors = (error) => Object.keys(error?.fields ?? {}).length > 0;

/** Demirbaş ekranları açıkken. */
export function useAssetsLive() {
  return useLiveChannel(ASSETS_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [assetKeys.all] });
}

/** Form seçicileri: etkin kategori, alan, oda ve personel. */
export function useAssetOptions() {
  return useQuery({ queryKey: assetKeys.options, queryFn: () => api('/assets/options'), staleTime: OPTIONS_STALE_MS });
}

/**
 * Demirbaş listesi (sayfalı); sayfa değişirken önceki sayfa ekranda kalır.
 * @param {{ search?: string, state?: string, categoryId?: string, areaId?: string, roomId?: string, employeeId?: string, page: number, pageSize: number }} params
 * @param {{ enabled?: boolean }} [options]
 */
export function useAssets(params, { enabled = true } = {}) {
  return useQuery({
    queryKey: assetKeys.list(params),
    queryFn: () => api(withQuery('/assets', { ...params, search: params.search || undefined })),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** @param {string} id */
export function useAsset(id) {
  return useQuery({ queryKey: assetKeys.detail(id), queryFn: () => api(`/assets/${id}`), enabled: Boolean(id) });
}

/**
 * Personelin zimmetindeki demirbaşlar (işten çıkış uyarısı).
 * @param {string} employeeId @param {{ enabled?: boolean }} [options]
 */
export function useEmployeeAssets(employeeId, { enabled = true } = {}) {
  return useQuery({
    queryKey: assetKeys.employee(employeeId),
    queryFn: () => api(withQuery('/assets', { employeeId, state: 'ACTIVE', pageSize: 50 })),
    enabled: enabled && Boolean(employeeId),
  });
}

/**
 * Karta işlem (oluştur, düzelt, taşı, zimmet, iade, elden çıkar): sonuç kart önbelleğine yazılır, listeler tazelenir.
 * `path` boşsa karta PATCH; `create` ise POST /assets.
 * @param {{ onDone?: (asset: any) => void }} [options]
 */
export function useAssetAction({ onDone } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ assetId, path, body }) => {
      if (path === 'create') return apiPost('/assets', body);
      if (!path) return apiPatch(`/assets/${assetId}`, body);
      return apiPost(`/assets/${assetId}/${path}`, body);
    },
    onSuccess: (asset, { message }) => {
      queryClient.setQueryData(assetKeys.detail(asset.id), asset);
      queryClient.invalidateQueries({ queryKey: assetKeys.all });
      if (message) toastSuccess(typeof message === 'function' ? message(asset) : message);
      onDone?.(asset);
    },
    onError: (error) => {
      if (REFRESH_CODES.includes(error.code)) queryClient.invalidateQueries({ queryKey: assetKeys.all });
      if (!hasFieldErrors(error)) toastError(error.message);
    },
  });
}

/* ─────────────── Tanımlar ─────────────── */

/** @param {boolean} includeInactive */
export function useAssetCategories(includeInactive) {
  return useQuery({ queryKey: assetKeys.categories(includeInactive), queryFn: () => api(withQuery('/assets/categories', { includeInactive: includeInactive || undefined })) });
}

/** @param {boolean} includeInactive */
export function useAssetAreas(includeInactive) {
  return useQuery({ queryKey: assetKeys.areas(includeInactive), queryFn: () => api(withQuery('/assets/areas', { includeInactive: includeInactive || undefined })) });
}

/**
 * Kategori / alan ekle ya da düzelt.
 * @param {'categories' | 'areas'} kind
 */
export function useDefinitionSave(kind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) => (id ? apiPatch(`/assets/${kind}/${id}`, body) : apiPost(`/assets/${kind}`, body)),
    onSuccess: (_, { message }) => {
      queryClient.invalidateQueries({ queryKey: assetKeys.all });
      if (message) toastSuccess(message);
    },
    onError: (error) => {
      if (REFRESH_CODES.includes(error.code)) queryClient.invalidateQueries({ queryKey: assetKeys.all });
      if (!hasFieldErrors(error)) toastError(error.message);
    },
  });
}

/* ─────────────── Sayım ─────────────── */

/** @param {{ status?: string, page: number, pageSize: number }} params */
export function useAssetCounts(params) {
  return useQuery({
    queryKey: assetKeys.counts(params),
    queryFn: () => api(withQuery('/assets/counts', { ...params, status: params.status || undefined })),
    placeholderData: keepPreviousData,
  });
}

/** @param {string} id */
export function useAssetCount(id) {
  return useQuery({ queryKey: assetKeys.count(id), queryFn: () => api(`/assets/counts/${id}`), enabled: Boolean(id) });
}

/** Sayım aç. @param {{ onDone?: (count: any) => void }} [options] */
export function useOpenAssetCount({ onDone } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost('/assets/counts', body),
    onSuccess: (count) => {
      queryClient.setQueryData(assetKeys.count(count.id), count);
      queryClient.invalidateQueries({ queryKey: assetKeys.all });
      toastSuccess(`${count.number} sayımı açıldı`);
      onDone?.(count);
    },
    onError: (error) => {
      if (!hasFieldErrors(error)) toastError(error.message);
    },
  });
}

/**
 * Sayımda okut: sonuç bandı ekranda; sayım yeniden okunur (sayılar, listeler).
 * @param {string} countId
 */
export function useAssetCountScan(countId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost(`/assets/counts/${countId}/scan`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assetKeys.count(countId) }),
    onError: (error) => {
      if (REFRESH_CODES.includes(error.code)) queryClient.invalidateQueries({ queryKey: assetKeys.count(countId) });
    },
  });
}

/**
 * Sayımı kapat / iptal et.
 * @param {string} countId @param {{ onDone?: (count: any) => void }} [options]
 */
export function useAssetCountAction(countId, { onDone } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }) => apiPost(`/assets/counts/${countId}/${path}`, body),
    onSuccess: (count, { message }) => {
      queryClient.setQueryData(assetKeys.count(countId), count);
      queryClient.invalidateQueries({ queryKey: assetKeys.all });
      if (message) toastSuccess(message);
      onDone?.(count);
    },
    onError: (error) => {
      if (REFRESH_CODES.includes(error.code)) queryClient.invalidateQueries({ queryKey: assetKeys.count(countId) });
      if (!hasFieldErrors(error)) toastError(error.message);
    },
  });
}

/* ─────────────── Amortisman, garanti, etiket, Excel ─────────────── */

/** @param {number} year */
export function useDepreciation(year) {
  return useQuery({ queryKey: assetKeys.depreciation(year), queryFn: () => api(withQuery('/assets/depreciation', { year })), placeholderData: keepPreviousData });
}

/** Yılı kaydet / geri al (`post` | `reverse`): yanıt tablonun yeni hâli. */
export function useDepreciationAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, year }) => apiPost(`/assets/depreciation/${path}`, { year }),
    onSuccess: (table, { message }) => {
      queryClient.setQueryData(assetKeys.depreciation(table.year), table);
      queryClient.invalidateQueries({ queryKey: assetKeys.all });
      if (message) toastSuccess(message);
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ['assets', 'depreciation'] });
      toastError(error.message);
    },
  });
}

/** @param {{ state: string, withinDays?: number }} params */
export function useAssetWarranty(params) {
  return useQuery({ queryKey: assetKeys.warranty(params), queryFn: () => api(withQuery('/assets/warranty', params)), placeholderData: keepPreviousData });
}

/**
 * Etiket bilgileri (seçim sırasıyla).
 * @param {string[]} ids
 * @returns {Promise<{ hotelName: string, items: Array<{ id: string, code: string, name: string, categoryName: string, locationLabel: string }> }>}
 */
export function fetchAssetLabels(ids) {
  return api(withQuery('/assets/labels', { ids: ids.join(',') }));
}

/** Excel yüklemesi: önizleme (`dryRun`) ve yükleme. */
export function useAssetImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost('/assets/import', body),
    onSuccess: (result) => {
      if (result.dryRun) return;
      queryClient.invalidateQueries({ queryKey: assetKeys.all });
      toastSuccess(`${result.created} demirbaş yüklendi`);
    },
    onError: (error) => toastError(error.message),
  });
}
