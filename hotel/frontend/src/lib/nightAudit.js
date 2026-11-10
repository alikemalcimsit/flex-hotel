import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiBlob, apiPost, withQuery } from './api.js';
import { toastError } from '../store/toast.js';

/**
 * Gün kapanış (night audit, modül 18): sorgu anahtarları, React Query kancaları
 * ve devir raporu PDF açma. Canlı kanal yok — kapanıştan sonra sorgular elle
 * tazelenir (gün kapanışı nadir ve tek kişinin işi).
 */

export const nightAuditKeys = Object.freeze({
  all: ['night-audit'],
  status: ['night-audit', 'status'],
  /** @param {{ page: number, pageSize: number }} filters */
  closures: (filters) => ['night-audit', 'closures', filters],
  /** @param {string} day */
  closure: (day) => ['night-audit', 'closure', day],
});

/** Kapanış ekranının durumu (gelmeyenler, içeridekiler, beklenen kasa). */
export function useNightAuditStatus() {
  return useQuery({ queryKey: nightAuditKeys.status, queryFn: () => api('/night-audit/status') });
}

/** Kapanış geçmişi (sayfalı). @param {{ page?: number, pageSize?: number }} filters */
export function useClosures(filters) {
  return useQuery({ queryKey: nightAuditKeys.closures(filters), queryFn: () => api(withQuery('/night-audit/closures', filters)) });
}

/** Bir kapanışın ayrıntısı. @param {string} day */
export function useClosure(day) {
  return useQuery({ queryKey: nightAuditKeys.closure(day), queryFn: () => api(`/night-audit/closures/${day}`), enabled: Boolean(day) });
}

/** Kapanışı başlat (IN_PROGRESS). */
export function useStartNightAudit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/night-audit/start', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: nightAuditKeys.all }),
  });
}

/** Günü kapat. @returns kapanış DTO'su */
export function useCloseDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost('/night-audit/close', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: nightAuditKeys.all }),
  });
}

/** Devir raporu PDF'ini yeni sekmede aç. @param {string} day */
export async function openShiftReportPdf(day) {
  const tab = window.open('', '_blank');
  try {
    const blob = await apiBlob(`/night-audit/closures/${day}/report.pdf`);
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    else {
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `vardiya-devir-${day}.pdf`;
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    tab?.close();
    toastError(/** @type {Error} */ (error).message);
  }
}
