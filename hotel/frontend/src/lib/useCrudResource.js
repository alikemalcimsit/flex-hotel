import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiDelete, apiPost, apiPut, withQuery } from './api.js';
import { toastError, toastSuccess } from '../store/toast.js';

/**
 * Sayfalı liste + create/update/delete ekranlarının ortak veri katmanı.
 *
 * Oda tipleri, vergiler, sezonlar ve odalar aynı sözleşmeyi konuşuyor
 * (sayfalama, arama, optimistic lock), bu yüzden react-query bağlantısı tek
 * yerde. Ekranlar yalnızca kolonlarını ve form alanlarını tanımlıyor.
 */

const SEARCH_DEBOUNCE_MS = 300;

/**
 * @param {{
 *   basePath: string,
 *   queryKey: unknown[],
 *   labels: { singular: string },
 *   extraParams?: Record<string, unknown>,
 * }} options
 */
export function useCrudResource({ basePath, queryKey, labels, extraParams = {} }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Her tuş vuruşunda sunucuya gitmiyoruz; yazma durunca tek istek atılıyor.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const serializedExtras = JSON.stringify(extraParams);

  const listQuery = useQuery({
    queryKey: [...queryKey, { page, search: debouncedSearch, extras: serializedExtras }],
    queryFn: () => api(withQuery(basePath, { page, search: debouncedSearch, ...extraParams })),
    // Sayfa değişirken tabloyu boşaltmıyoruz — yanıp sönme olmuyor.
    placeholderData: keepPreviousData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  /** @param {any} error */
  const handleMutationError = (error) => {
    toastError(error.message);
    // Sürüm çakışmasında ekrandaki veri bayattır; tazeleyip kullanıcıyı doğru
    // hâlin üstüne oturtuyoruz.
    if (error.code === 'STALE_WRITE') invalidate();
  };

  const createMutation = useMutation({
    mutationFn: (values) => apiPost(basePath, values),
    onSuccess: () => {
      toastSuccess(`${labels.singular} eklendi`);
      invalidate();
    },
    onError: handleMutationError,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }) => apiPut(`${basePath}/${id}`, values),
    onSuccess: () => {
      toastSuccess(`${labels.singular} güncellendi`);
      invalidate();
    },
    onError: handleMutationError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => apiDelete(`${basePath}/${id}`),
    onSuccess: () => {
      toastSuccess(`${labels.singular} silindi`);
      invalidate();
    },
    // Silme hatası (ör. kullanımda) diyalogun içinde gösteriliyor; toast basıp
    // iki yerden aynı şeyi söylemiyoruz.
    onError: (error) => {
      if (error.code === 'STALE_WRITE') invalidate();
    },
  });

  return {
    page,
    setPage,
    search,
    setSearch,
    rows: listQuery.data?.items ?? [],
    meta: listQuery.data?.meta,
    // `isPending`, `isLoading` değil: `isLoading` yeniden deneme aralarında
    // kısa süre `false` oluyor ve tablo o anda "kayıt yok" gösteriyordu.
    isLoading: listQuery.isPending,
    isFetching: listQuery.isFetching,
    error: listQuery.error,
    refetch: listQuery.refetch,
    invalidate,
    createMutation,
    updateMutation,
    deleteMutation,
  };
}
