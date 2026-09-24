import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../../lib/api.js';
import { actorKeys, taskKeys } from '../../lib/actors.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/** İşlem → başarı mesajı. */
const SUCCESS_MESSAGES = Object.freeze({
  claim: 'Görevi üstlendiniz',
  release: 'Görevi bıraktınız; başkası üstlenebilir',
  complete: 'Görev tamamlandı',
  cancel: 'Görev kapatıldı (gerek kalmadı)',
});

/** Bu kodlarda görev başkası tarafından değişmiştir: ekran güncel hâli gösterir. */
const STALE_CODES = new Set(['TASK_CLOSED', 'TASK_CLAIMED', 'TASK_NOT_CLAIMED', 'NOT_FOUND']);

/**
 * Görev işlemleri (üstlen, bırak, tamamla, gerek kalmadı). Sunucu güncel
 * görevi döndürür; detay önbelleğe yazılır, liste ve rozet tazelenir.
 * Başkası önce davrandıysa (409) mesaj gösterilir ve ekran güncel hâle döner.
 */
export function useTaskAction() {
  const queryClient = useQueryClient();
  const refresh = (taskId) => {
    queryClient.invalidateQueries({ queryKey: taskKeys.lists });
    queryClient.invalidateQueries({ queryKey: taskKeys.summary });
    queryClient.invalidateQueries({ queryKey: actorKeys.all });
    if (taskId) queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
  };
  return useMutation({
    /** @param {{ taskId: string, action: 'claim' | 'release' | 'complete' | 'cancel', body?: object }} input */
    mutationFn: ({ taskId, action, body }) => apiPost(`/manual-tasks/${taskId}/${action}`, body ?? {}),
    onSuccess: (task, { action }) => {
      queryClient.setQueryData(taskKeys.detail(task.id), task);
      refresh(null);
      toastSuccess(SUCCESS_MESSAGES[action]);
    },
    onError: (error, { taskId }) => {
      toastError(error.message);
      if (STALE_CODES.has(error.code)) refresh(taskId);
    },
  });
}
