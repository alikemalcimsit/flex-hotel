import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiPost, withQuery } from './api.js';
import { rsKeys } from './roomService.js';
import { toastError, toastSuccess } from '../store/toast.js';

/**
 * Oda servisi (modül 41) sorgu ve işlem kancaları. Kanal (`pos.changed`) açıkken ekranlar başka personelin
 * işlemiyle tazelenir; sürüm hatasında (başkası değiştirdi) sipariş yeniden okunur.
 */

/** @param {string} id */
export function useRoomServiceOrder(id) {
  return useQuery({ queryKey: rsKeys.order(id), queryFn: () => api(`/pos/room-service/orders/${id}`) });
}

/** @param {{ outletId?: string }} filters @param {{ enabled?: boolean, refetchInterval?: number | false }} [options] */
export function useRoomServiceBoard(filters, { enabled = true, refetchInterval = false } = {}) {
  return useQuery({
    queryKey: rsKeys.board(filters),
    queryFn: () => api(withQuery('/pos/room-service/board', { outletId: filters.outletId || undefined })),
    enabled,
    refetchInterval,
  });
}

/**
 * Siparişe işlem (kabul, ret, mutfağa gönder, adım, teslim, iptal): sonuç sipariş ekranına yazılır, pano tazelenir.
 * @param {{ onDone?: (order: any) => void }} [options]
 */
export function useRoomServiceAction({ onDone } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, path, body }) => apiPost(`/pos/room-service/orders/${orderId}/${path}`, body),
    onSuccess: (order, { message }) => {
      queryClient.setQueryData(rsKeys.order(order.id), order);
      queryClient.invalidateQueries({ queryKey: ['pos'] });
      if (message) toastSuccess(typeof message === 'function' ? message(order) : message);
      onDone?.(order);
    },
    onError: (error) => {
      if (error.code === 'STALE_WRITE' || error.code === 'INVALID_TRANSITION') queryClient.invalidateQueries({ queryKey: rsKeys.all });
      toastError(error.message);
    },
  });
}
