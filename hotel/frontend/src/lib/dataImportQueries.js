import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiPost } from './api.js';
import { dataImportKeys } from './dataImport.js';

/**
 * Excel'den toplu yükleme (modül 26) kancaları: denetleme / içe aktarma ve yükleme geçmişi.
 */

/** @param {{ enabled?: boolean }} [options] */
export function useImportHistory({ enabled = true } = {}) {
  return useQuery({ queryKey: dataImportKeys.history, queryFn: () => api('/imports'), enabled });
}

/** Denetle (`dryRun: true`) ya da içe aktar (`dryRun: false`; aynı yükleme kimliğiyle). */
export function useRunImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, body }) => apiPost(`/imports/${kind}`, body),
    onSuccess: (result) => {
      if (!result.dryRun) queryClient.invalidateQueries({ queryKey: dataImportKeys.all });
    },
  });
}
