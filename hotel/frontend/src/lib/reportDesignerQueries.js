import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiDelete, apiPatch, apiPost, withQuery } from './api.js';
import { reportDesignerKeys } from './reportDesigner.js';
import { toastError, toastSuccess } from '../store/toast.js';

/**
 * Rapor tasarımcısı (modül 26) sorgu ve işlem kancaları. Tasarım raporları rapor asistanının kayıtlı raporlarıyla
 * aynı ekranda; canlı kanal (`report-chat.changed`) ikisini birlikte tazeler (anahtarlar `report-chat` altında).
 */

/**
 * @param {'MINE' | 'SHARED'} scope
 * @param {{ enabled?: boolean }} [options]
 */
export function useDesignerDefinitions(scope, { enabled = true } = {}) {
  return useQuery({ queryKey: reportDesignerKeys.definitions(scope), queryFn: () => api(withQuery('/report-designer/definitions', { scope })), enabled });
}

/** @param {string | undefined} id */
export function useDesignerDefinition(id) {
  return useQuery({ queryKey: reportDesignerKeys.definition(id ?? ''), queryFn: () => api(`/report-designer/definitions/${id}`), enabled: Boolean(id) });
}

/** Tasarımı çalıştırır (önizleme 100 satır; Excel için `preview: false`). */
export function useRunDesign() {
  return useMutation({ mutationFn: (body) => apiPost('/report-designer/run', body) });
}

function useDefinitionsInvalidation() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: reportDesignerKeys.all });
}

/** @param {{ onDone?: (definition: any) => void }} [options] */
export function useSaveDefinition({ onDone } = {}) {
  const invalidate = useDefinitionsInvalidation();
  return useMutation({
    mutationFn: (body) => apiPost('/report-designer/definitions', body),
    onSuccess: (definition) => {
      invalidate();
      toastSuccess(`"${definition.title}" kaydedildi`);
      onDone?.(definition);
    },
  });
}

/** Başlık / paylaşım / tasarım. @param {{ onDone?: (definition: any) => void }} [options] */
export function useUpdateDefinition({ onDone } = {}) {
  const invalidate = useDefinitionsInvalidation();
  return useMutation({
    mutationFn: ({ id, body }) => apiPatch(`/report-designer/definitions/${id}`, body),
    onSuccess: (definition, { message }) => {
      invalidate();
      if (message) toastSuccess(message);
      onDone?.(definition);
    },
    onError: (error) => {
      if (error.code === 'STALE_WRITE') invalidate();
    },
  });
}

/** @param {{ onDone?: () => void }} [options] */
export function useDeleteDefinition({ onDone } = {}) {
  const invalidate = useDefinitionsInvalidation();
  return useMutation({
    mutationFn: (id) => apiDelete(`/report-designer/definitions/${id}`),
    onSuccess: () => {
      invalidate();
      toastSuccess('Rapor silindi');
      onDone?.();
    },
  });
}

/** Kayıtlı tasarımı çalıştır (dönem filtreleri bugüne göre). */
export function useRunDefinition() {
  const invalidate = useDefinitionsInvalidation();
  return useMutation({
    mutationFn: (id) => apiPost(`/report-designer/definitions/${id}/run`, {}),
    onSuccess: () => invalidate(),
    onError: (error) => toastError(error.message),
  });
}
