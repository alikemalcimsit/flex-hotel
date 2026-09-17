import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPatch, apiPost } from '../../lib/api.js';
import { inboxKeys } from '../../lib/frontOffice.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * Konuşma yönetimi: atama, kapatma, manuele alma, konaklama bağlama, okundu.
 *
 * Yönetim işlemleri konuşmanın `stateVersion`'ını taşır. İki resepsiyonist
 * aynı anda farklı karar verirse (biri kapatır, öbürü atar) ikincisi uyarı
 * alır ve ekran tazelenir; bu arada misafirin yazması çakışma sayılmaz.
 *
 * @param {string} conversationId
 */
export function useConversationActions(conversationId) {
  const queryClient = useQueryClient();

  const refreshLists = () => {
    queryClient.invalidateQueries({ queryKey: inboxKeys.lists });
    queryClient.invalidateQueries({ queryKey: inboxKeys.summary });
  };

  const update = useMutation({
    /**
     * @param {{ conversation: { stateVersion: number }, changes: object, message?: string }} input
     */
    mutationFn: ({ conversation, changes }) =>
      apiPatch(`/messaging/conversations/${conversationId}`, {
        ...changes,
        expectedStateVersion: conversation.stateVersion,
      }),
    onSuccess: (updated, { message }) => {
      queryClient.setQueryData(inboxKeys.conversation(conversationId), updated);
      if (message) toastSuccess(message);
      refreshLists();
    },
    onError: (error) => {
      toastError(error.message);
      if (error.code === 'STALE_WRITE' || error.code === 'NOT_FOUND') {
        queryClient.invalidateQueries({ queryKey: inboxKeys.conversation(conversationId) });
        refreshLists();
      }
    },
  });

  const markRead = useMutation({
    mutationFn: () => apiPost(`/messaging/conversations/${conversationId}/read`, {}),
    onSuccess: ({ changed }) => {
      if (!changed) return;
      queryClient.setQueryData(inboxKeys.conversation(conversationId), (current) =>
        current ? { ...current, unreadCount: 0 } : current,
      );
      refreshLists();
    },
    // Okundu işareti kritik değil: başarısızsa bir sonraki açılışta tekrar denenir.
    onError: () => {},
  });

  return { update, markRead };
}
