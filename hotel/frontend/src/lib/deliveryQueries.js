import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiPost, withQuery } from './api.js';
import { deliveryKeys } from './delivery.js';
import { toastError, toastSuccess } from '../store/toast.js';

/**
 * Paket servis (modül 42) sorgu ve işlem kancaları. Kanal (`pos.changed`) açıkken ekranlar başka personelin
 * işlemiyle tazelenir; sürüm / durum hatasında (başkası değiştirdi) sipariş yeniden okunur.
 */

/** Ekranın tazelenmesini gerektiren hata kodları (başkası ilerletti, adisyon kapandı, vardiya yok). */
const REFRESH_CODES = Object.freeze(['STALE_WRITE', 'INVALID_TRANSITION', 'CHECK_CLOSED', 'NO_SHIFT', 'DELIVERY_LOCKED']);

/** @param {string} id */
export function useDeliveryOrder(id) {
  return useQuery({ queryKey: deliveryKeys.order(id), queryFn: () => api(`/pos/delivery/orders/${id}`) });
}

/** @param {{ outletId?: string }} filters @param {{ enabled?: boolean, refetchInterval?: number | false }} [options] */
export function useDeliveryBoard(filters, { enabled = true, refetchInterval = false } = {}) {
  return useQuery({
    queryKey: deliveryKeys.board(filters),
    queryFn: () => api(withQuery('/pos/delivery/board', { outletId: filters.outletId || undefined })),
    enabled,
    refetchInterval,
  });
}

/**
 * Geçmiş (sayfalı): durum grubu, sipariş günü aralığı, arama. Sayfa değişirken önceki sayfa ekranda kalır.
 * @param {{ state: string, from: string, to: string, search: string, page: number, pageSize: number }} params
 * @param {{ enabled?: boolean, refetchInterval?: number | false }} [options]
 */
export function useDeliveryOrders(params, { enabled = true, refetchInterval = false } = {}) {
  return useQuery({
    queryKey: deliveryKeys.orders(params),
    queryFn: () =>
      api(
        withQuery('/pos/delivery/orders', {
          state: params.state || undefined,
          from: params.from || undefined,
          to: params.to || undefined,
          search: params.search || undefined,
          page: params.page,
          pageSize: params.pageSize,
        }),
      ),
    enabled,
    refetchInterval,
    placeholderData: keepPreviousData,
  });
}

/**
 * Tekrar gelen müşteri: telefonla son adı ve adresleri (formda telefon yazılınca).
 * @param {string} phone @param {{ enabled?: boolean }} [options]
 */
export function useDeliveryCustomer(phone, { enabled = true } = {}) {
  return useQuery({
    queryKey: deliveryKeys.customer(phone),
    queryFn: () => api(withQuery('/pos/delivery/customers', { phone })),
    enabled: enabled && phone.replace(/\D/g, '').length >= 7,
    staleTime: 60_000,
  });
}

/**
 * Siparişe işlem (adım, kurye, teslim, iptal): sonuç sipariş ekranına yazılır, pano tazelenir.
 * @param {{ onDone?: (order: any) => void }} [options]
 */
export function useDeliveryAction({ onDone } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, path, body }) => apiPost(`/pos/delivery/orders/${orderId}/${path}`, body),
    onSuccess: (order, { message }) => {
      queryClient.setQueryData(deliveryKeys.order(order.id), order);
      queryClient.invalidateQueries({ queryKey: ['pos'] });
      if (message) toastSuccess(typeof message === 'function' ? message(order) : message);
      onDone?.(order);
    },
    onError: (error) => {
      if (REFRESH_CODES.includes(error.code)) queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      toastError(error.message);
    },
  });
}
