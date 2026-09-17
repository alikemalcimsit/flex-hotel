import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';
import { PERMISSIONS, useCan } from './permissions.js';
import { APPROVALS_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';
import { useAuthStore } from '../store/auth.js';
import { useToastStore } from '../store/toast.js';

/**
 * Onay kuyruğu (modül 11): sorgu anahtarları ve her sayfada açık duran özet
 * (üst bar sayacı, yan menü rozeti).
 *
 * Anahtar öneki: `['approvals', ...]`.
 */

export const approvalKeys = Object.freeze({
  all: ['approvals'],
  summary: ['approvals', 'summary'],
  lists: ['approvals', 'list'],
  /** @param {string} view @param {object} filters */
  list: (view, filters) => ['approvals', 'list', view, filters],
  /** @param {string} id */
  detail: (id) => ['approvals', 'detail', id],
});

/**
 * Özet asıl olarak socket haberiyle tazelenir; bu aralık kopukken kaçanları
 * ve zamanla değişen "süresi yaklaşan" sayısını toplar. Sunucu otel başına
 * dakikada tek hesaplama yapıyor (sürüm + dakika anahtarlı önbellek).
 */
const SUMMARY_REFRESH_MS = 60_000;

/**
 * Sayacın canlı tazelemesi arasındaki en kısa süre: her panelde açık;
 * yoğun bir onay dalgasında 2500 özet sorgusu gereksiz.
 */
const BADGE_MIN_REFRESH_MS = 10_000;

/** Aynı panelde art arda gelen "yeni onay" bildirimlerinin en kısa aralığı. */
const NEW_APPROVAL_TOAST_MIN_INTERVAL_MS = 30_000;

/** @param {{ enabled?: boolean }} [options] */
export function useApprovalSummary({ enabled = true } = {}) {
  return useQuery({
    queryKey: approvalKeys.summary,
    queryFn: () => api('/approvals/summary'),
    enabled,
    refetchInterval: SUMMARY_REFRESH_MS,
    staleTime: SUMMARY_REFRESH_MS / 2,
  });
}

/**
 * Kabukta bir kez çağrılır: bekleyen onay sayısını canlı tutar ve karar
 * yetkisi olan kişiye yeni onay düşünce kısa bir bildirim gösterir (zil de
 * ayrıca uyarır; buradaki bildirim ekranın neresinde olursa olsun görünsün diye).
 *
 * Yetkisi olmayan kullanıcı ne sorgu atar ne kanala abone olur.
 *
 * @returns {{ count: number, urgent: boolean, label: string } | null}
 */
export function useApprovalBadge() {
  const can = useCan();
  const canView = can(PERMISSIONS.APPROVALS_VIEW);
  const canDecide = can(PERMISSIONS.APPROVALS_DECIDE);
  const me = useAuthStore((state) => state.user?.email);

  useLiveChannel(APPROVALS_CHANNEL, {
    enabled: canView,
    minIntervalMs: BADGE_MIN_REFRESH_MS,
    queryKeys: [approvalKeys.summary],
    onChange: (payload) => {
      if (!canDecide || payload?.event !== 'approval.requested') return;
      // Kendi tetiklediği iş için kendine bildirim gereksiz.
      if (payload.actor && payload.actor === me) return;
      notifyNewApproval();
    },
  });

  const summary = useApprovalSummary({ enabled: canView }).data;
  if (!canView || !summary) return null;

  const { pending, expiringSoon } = summary;
  return {
    count: pending,
    urgent: expiringSoon > 0,
    label:
      pending === 0
        ? 'Bekleyen onay yok'
        : `${pending} iş onay bekliyor${expiringSoon > 0 ? `, ${expiringSoon} tanesinin süresi bir saat içinde doluyor` : ''}`,
  };
}

let lastToastAt = 0;

function notifyNewApproval() {
  const now = Date.now();
  if (now - lastToastAt < NEW_APPROVAL_TOAST_MIN_INTERVAL_MS) return;
  lastToastAt = now;
  useToastStore.getState().push({ message: 'Yeni bir iş onayınızı bekliyor (Yönetim › Onaylar)', variant: 'info' });
}
