import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiPost, withQuery } from './api.js';
import { posKeys } from './pos.js';
import { KITCHEN_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';
import { toastError } from '../store/toast.js';

/**
 * Mutfak ekranı / KDS (modül 40) sorgu ve işlem kancaları. Anahtarlar `['pos', 'kitchen', ...]` altında: garsonun
 * adisyon ekranındaki işlem (POS anahtarlarını tazeler) mutfak panosunu da tazeler. Mutfak tableti yalnız
 * `kitchen.changed` kanalını dinler (masa planının bütün haberlerini değil).
 */

export const kdsKeys = Object.freeze({
  all: ['pos', 'kitchen'],
  /** @param {{ outletId?: string, station?: string }} filters */
  board: (filters) => ['pos', 'kitchen', 'board', filters],
});

/** Serviste art arda düşen turlar saniyede bir tazelemede toplanır. */
const LIVE_MIN_REFRESH_MS = 1_000;

/** Mutfak ekranı açıkken kanal dinlenir. */
export function useKitchenLive() {
  return useLiveChannel(KITCHEN_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [kdsKeys.all] });
}

/** @param {{ outletId?: string, station?: string }} filters @param {{ refetchInterval?: number | false }} [options] */
export function useKitchenBoard(filters, { refetchInterval = false } = {}) {
  return useQuery({
    queryKey: kdsKeys.board(filters),
    queryFn: () => api(withQuery('/pos/kitchen/board', { outletId: filters.outletId || undefined, station: filters.station || undefined })),
    refetchInterval,
  });
}

/**
 * Turu ilerletir (başla / hazır / servis edildi). Sürüm hatasında (başka tablet ya da oda servisi panosu ilerletti)
 * pano yeniden okunur.
 * @param {{ onDone?: (result: { orderId: string, status: string }) => void }} [options]
 */
export function useAdvanceKitchenOrder({ onDone } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, status, expectedUpdatedAt }) => apiPost(`/pos/kitchen/orders/${orderId}/advance`, { status, expectedUpdatedAt }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: posKeys.all });
      onDone?.(result);
    },
    onError: (error) => {
      if (['STALE_WRITE', 'INVALID_TRANSITION', 'CHECK_CLOSED'].includes(error.code)) queryClient.invalidateQueries({ queryKey: posKeys.all });
      toastError(error.message);
    },
  });
}
