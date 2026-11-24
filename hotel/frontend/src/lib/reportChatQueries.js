import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiDelete, apiPatch, apiPost, withQuery } from './api.js';
import { reportChatKeys } from './reportChat.js';
import { REPORT_CHAT_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';
import { toastError, toastSuccess } from '../store/toast.js';

/**
 * Rapor asistanı (modül 24) sorgu ve işlem kancaları. Ajan cevabı arka planda yazar: kanal (`report-chat.changed`)
 * haber verince sohbet tazelenir; kanal kopuksa bekleyen soru varken kısa aralıkla yeniden okunur.
 */

/** Canlı tazelemede en kısa aralık. */
const LIVE_MIN_REFRESH_MS = 1_000;
/** Bekleyen soru varken yedek yoklama aralığı. */
const PENDING_POLL_MS = 3_000;

/** Rapor asistanı ekranları açıkken. */
export function useReportChatLive() {
  return useLiveChannel(REPORT_CHAT_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [reportChatKeys.all] });
}

/** Sohbet: soranın son soruları (eskiden yeniye) + ajanın kullanılabilirliği. */
export function useReportQuestions() {
  return useQuery({
    queryKey: reportChatKeys.questions,
    queryFn: () => api('/report-chat/questions'),
    refetchInterval: (query) => (query.state.data?.items?.some((item) => item.status === 'PENDING') ? PENDING_POLL_MS : false),
  });
}

/** Soru sor: cevap gelene kadar soru "hazırlanıyor" olarak sohbette görünür. */
export function useAskReportQuestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost('/report-chat/questions', body),
    onSuccess: (question) => {
      queryClient.setQueryData(reportChatKeys.questions, (current) =>
        current ? { ...current, items: [...current.items.filter((item) => item.id !== question.id), question] } : current,
      );
      queryClient.invalidateQueries({ queryKey: reportChatKeys.questions });
    },
  });
}

/** @param {'MINE' | 'SHARED'} scope */
export function useSavedReports(scope) {
  return useQuery({ queryKey: reportChatKeys.saved(scope), queryFn: () => api(withQuery('/report-chat/saved', { scope })) });
}

/** Kayıtlı rapor işlemleri sonrası listeler tazelenir. */
function useSavedInvalidation() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['report-chat', 'saved'] });
}

/** @param {{ onDone?: (saved: any) => void }} [options] */
export function useSaveReport({ onDone } = {}) {
  const invalidate = useSavedInvalidation();
  return useMutation({
    mutationFn: (body) => apiPost('/report-chat/saved', body),
    onSuccess: (saved) => {
      invalidate();
      toastSuccess(`"${saved.title}" kaydedildi`);
      onDone?.(saved);
    },
  });
}

/** Başlık / paylaşım. @param {{ onDone?: (saved: any) => void }} [options] */
export function useUpdateSavedReport({ onDone } = {}) {
  const invalidate = useSavedInvalidation();
  return useMutation({
    mutationFn: ({ id, body }) => apiPatch(`/report-chat/saved/${id}`, body),
    onSuccess: (saved, { message }) => {
      invalidate();
      if (message) toastSuccess(message);
      onDone?.(saved);
    },
    onError: (error) => {
      if (error.code === 'STALE_WRITE') invalidate();
    },
  });
}

/** @param {{ onDone?: () => void }} [options] */
export function useDeleteSavedReport({ onDone } = {}) {
  const invalidate = useSavedInvalidation();
  return useMutation({
    mutationFn: (id) => apiDelete(`/report-chat/saved/${id}`),
    onSuccess: () => {
      invalidate();
      toastSuccess('Rapor silindi');
      onDone?.();
    },
  });
}

/** Kayıtlı raporu çalıştır (AI'sız; dönem bugüne göre). */
export function useRunSavedReport() {
  const invalidate = useSavedInvalidation();
  return useMutation({
    mutationFn: (id) => apiPost(`/report-chat/saved/${id}/run`, {}),
    onSuccess: () => invalidate(),
    onError: (error) => toastError(error.message),
  });
}
