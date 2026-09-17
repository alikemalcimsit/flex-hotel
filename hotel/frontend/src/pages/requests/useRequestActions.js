import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPatch, apiPost } from '../../lib/api.js';
import { inboxKeys, requestKeys } from '../../lib/frontOffice.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/** Durum değişikliğinden sonra kullanıcıya söylenen. */
const STATUS_MESSAGES = Object.freeze({
  IN_PROGRESS: (title) => `"${title}" üstlenildi`,
  DONE: (title) => `"${title}" tamamlandı`,
  CANCELLED: (title) => `"${title}" iptal edildi`,
  OPEN: (title) => `"${title}" yeniden açıldı; süre baştan başladı`,
});

/** Başkası değiştirdiyse ekranın tazelenmesi gereken hata kodları. */
const REFRESH_ON_ERROR = new Set(['STALE_WRITE', 'INVALID_TRANSITION', 'NOT_FOUND']);

/**
 * İstek üzerindeki işlemler — liste, detay ve konuşma yan paneli aynı
 * davranışı paylaşır.
 *
 * Her yazma kaydın ekrandaki sürümünü (`updatedAt`) gönderir: iki personel
 * aynı isteği aynı anda kapatmaya çalışırsa ikincisi "başkası değiştirdi"
 * uyarısı alır ve liste tazelenir.
 */
export function useRequestActions() {
  const queryClient = useQueryClient();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: requestKeys.all });
    // Konuşma başlığındaki "açık istek" sayısı da değişir.
    queryClient.invalidateQueries({ queryKey: inboxKeys.all });
  };

  const onError = (error) => {
    toastError(error.message);
    if (REFRESH_ON_ERROR.has(error.code)) refresh();
  };

  const changeStatus = useMutation({
    /** @param {{ request: { id: string, updatedAt: string, title: string }, status: string, note?: string }} input */
    mutationFn: ({ request, status, note }) =>
      apiPost(`/guest-requests/${request.id}/status`, {
        status,
        note: note?.trim() ? note.trim() : null,
        expectedUpdatedAt: request.updatedAt,
      }),
    onSuccess: (data, { status }) => {
      toastSuccess(STATUS_MESSAGES[status]?.(data.title) ?? 'İstek güncellendi');
      refresh();
    },
    onError,
  });

  const update = useMutation({
    /** @param {{ request: { id: string, updatedAt: string }, changes: object, message?: string }} input */
    mutationFn: ({ request, changes }) =>
      apiPatch(`/guest-requests/${request.id}`, { ...changes, expectedUpdatedAt: request.updatedAt }),
    onSuccess: (_data, { message }) => {
      if (message) toastSuccess(message);
      refresh();
    },
    onError,
  });

  /** İşlemi süren isteğin kimliği (satırdaki düğmeleri kilitlemek için). */
  const busyId =
    (changeStatus.isPending && changeStatus.variables?.request.id) ||
    (update.isPending && update.variables?.request.id) ||
    null;

  return { changeStatus, update, busyId, refresh };
}
