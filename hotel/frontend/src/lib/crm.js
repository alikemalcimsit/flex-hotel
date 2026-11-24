import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ALLERGEN_LABELS,
  ALLERGENS,
  PREFERENCE_CATEGORY_LABELS,
  PREFERENCE_CONFIDENCE_LABELS,
  PREFERENCE_SOURCE_LABELS,
} from '@hotelos/hotel-contracts';
import { api, apiDelete, apiPatch, apiPost, withQuery } from './api.js';
import { toastError } from '../store/toast.js';

/**
 * CRM & misafir kartı (modül 22): sorgu anahtarları, React Query kancaları ve
 * etiketler. Canlı kanal yok — işlemden sonra `['guests']` ağacı tazelenir.
 */

export const crmKeys = Object.freeze({
  all: ['guests'],
  list: (filters) => ['guests', 'list', filters],
  search: (q) => ['guests', 'search', q],
  card: (id) => ['guests', 'card', id],
  stays: (id, page) => ['guests', 'stays', id, page],
  spend: (id) => ['guests', 'spend', id],
});

export const prefCategoryLabel = (v) => PREFERENCE_CATEGORY_LABELS[v] ?? v;
export const prefSourceLabel = (v) => PREFERENCE_SOURCE_LABELS[v] ?? v;
export const prefConfidenceLabel = (v) => PREFERENCE_CONFIDENCE_LABELS[v] ?? v;
export const allergenLabel = (v) => ALLERGEN_LABELS[v] ?? v;
export const ALLERGEN_OPTIONS = ALLERGENS.map((code) => ({ value: code, label: ALLERGEN_LABELS[code] ?? code }));

export const guestPath = (id) => `/misafirler/${id}`;
export const contactText = (g) => [g.phone, g.email].filter(Boolean).join(' · ') || 'İletişim bilgisi yok';

/* ─────────────── Sorgular ─────────────── */

/** Liste / arama: `q` verilince arama (meta'sız dönebilir → normalize edilir). */
export function useGuests(filters) {
  return useQuery({
    queryKey: crmKeys.list(filters),
    queryFn: async () => {
      const data = await api(withQuery('/guests', filters));
      if (data?.meta) return data;
      const items = data?.items ?? [];
      return { items, meta: { page: data?.page ?? 1, pageSize: data?.pageSize ?? items.length, total: data?.total ?? items.length, totalPages: 1 } };
    },
  });
}

export function useGuestCard(id) {
  return useQuery({ queryKey: crmKeys.card(id), queryFn: () => api(`/guests/${id}`), enabled: Boolean(id) });
}

export function useGuestStays(id, page) {
  return useQuery({ queryKey: crmKeys.stays(id, page), queryFn: () => api(withQuery(`/guests/${id}/stays`, { page, pageSize: 20 })), enabled: Boolean(id) });
}

export function useGuestSpend(id) {
  return useQuery({ queryKey: crmKeys.spend(id), queryFn: () => api(`/guests/${id}/spend`), enabled: Boolean(id) });
}

/** Rezervasyon formu önizlemesi: kart + tercih özeti (arama ucundan). */
export function useGuestPreview(id) {
  return useQuery({ queryKey: crmKeys.card(id), queryFn: () => api(`/guests/${id}`), enabled: Boolean(id), staleTime: 60_000 });
}

/* ─────────────── İşlemler ─────────────── */

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: crmKeys.all });
}

export function useCardActions(id) {
  const invalidate = useInvalidate();
  const run = (fn) => ({ mutationFn: fn, onSuccess: invalidate, onError: (e) => toastError(e) });
  return {
    update: useMutation(run((body) => apiPatch(`/guests/${id}`, body))),
    addPreference: useMutation(run((body) => apiPost(`/guests/${id}/preferences`, body))),
    updatePreference: useMutation(run(({ prefId, body }) => apiPatch(`/guests/${id}/preferences/${prefId}`, body))),
    deletePreference: useMutation(run((prefId) => apiDelete(`/guests/${id}/preferences/${prefId}`))),
    addNote: useMutation(run((body) => apiPost(`/guests/${id}/notes`, body))),
    updateNote: useMutation(run(({ noteId, body }) => apiPatch(`/guests/${id}/notes/${noteId}`, body))),
    deleteNote: useMutation(run((noteId) => apiDelete(`/guests/${id}/notes/${noteId}`))),
  };
}

export function useMergeGuests() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (body) => apiPost('/guests/merge', body), onSuccess: invalidate, onError: (e) => toastError(e) });
}
