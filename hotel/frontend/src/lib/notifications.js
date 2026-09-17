import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { STAFF_ALERT_BADGE_CAP } from '@hotelos/hotel-contracts';
import { api } from './api.js';
import { STAFF_ALERTS_CHANNEL, connectSpreadMs, socket } from './socket.js';
import { useAuthStore } from '../store/auth.js';

/**
 * Bildirim merkezi (modül 9): sorgu anahtarları ve üst bardaki zilin durumu.
 *
 * Anahtar önekleri: `['notifications', ...]` (misafir bildirimleri),
 * `['staff-alerts', ...]` (zil).
 */

export const notificationKeys = Object.freeze({
  all: ['notifications'],
  summary: ['notifications', 'summary'],
  histories: ['notifications', 'history'],
  /** @param {object} filters */
  history: (filters) => ['notifications', 'history', filters],
  /** @param {string} id */
  detail: (id) => ['notifications', 'detail', id],
  templates: ['notifications', 'templates'],
  channels: ['notifications', 'channels'],
});

export const staffAlertKeys = Object.freeze({
  all: ['staff-alerts'],
  summary: ['staff-alerts', 'summary'],
  list: ['staff-alerts', 'list'],
});

/**
 * Zil özetinin kendiliğinden tazelenme aralığı. Rozet asıl olarak socket
 * haberiyle artar; bu tazeleme yalnızca kopukken kaçanları ve zamanla
 * düşenleri (saklama süresi) toplar. 2500 panel aynı dakikada sormasın diye
 * her panel kendi rastgele payını ekler.
 */
const SUMMARY_REFRESH_MS = 5 * 60_000;
const SUMMARY_REFRESH_JITTER_MS = 60_000;

/** Yeniden bağlanınca tazelemeden önceki rastgele bekleme (sunucu açılış yükü). */
const RECONNECT_JITTER_MS = 5_000;

/**
 * Haber bu panelin kullanıcısını ilgilendiriyor mu? Sunucudaki görünürlük
 * kuralının (kişiye ya da izne) aynısı; susturulan türler sayılmaz.
 *
 * @param {{ userId?: string | null, permission?: string | null, kind?: string | null }} payload
 * @param {{ userId?: string, permissions?: string[], mutedKinds?: string[] }} summary
 */
export function alertConcernsMe(payload, summary) {
  if (!payload?.alertId || !summary?.userId) return false;
  if (payload.kind && summary.mutedKinds?.includes(payload.kind)) return false;
  if (payload.userId) return payload.userId === summary.userId;
  return Boolean(payload.permission) && (summary.permissions ?? []).includes(payload.permission);
}

/**
 * Üst bardaki zilin durumu. Kabukta bir kez çağrılır.
 *
 * Rozet = sunucunun verdiği görülmemiş uyarılar ∪ sonradan socket'ten gelen
 * (bu kişiyi ilgilendiren) uyarılar. Aynı konuşmadan art arda gelen mesajlar
 * aynı uyarıda birleştiği için kimlik kümesi sayıyı şişirmez.
 *
 * @returns {{
 *   summary: object | undefined,
 *   unseenCount: number,
 *   capped: boolean,
 *   lastEventAt: number,
 *   markSeenLocally: (lastSeenAt: string) => void,
 * }}
 */
export function useStaffAlertBell() {
  const queryClient = useQueryClient();
  const actor = useAuthStore((state) => state.user?.email);
  const [refreshMs] = useState(() => SUMMARY_REFRESH_MS + Math.round(Math.random() * SUMMARY_REFRESH_JITTER_MS));
  /** Socket'ten gelen uyarılar: kimlik → olay anı (ms). */
  const [liveAlerts, setLiveAlerts] = useState(() => new Map());
  const [lastEventAt, setLastEventAt] = useState(0);

  const summaryQuery = useQuery({
    queryKey: [...staffAlertKeys.summary, actor],
    queryFn: () => api('/staff-alerts/summary'),
    enabled: Boolean(actor),
    refetchInterval: refreshMs,
    staleTime: refreshMs / 2,
  });
  const summary = summaryQuery.data;
  const summaryRef = useRef(summary);
  summaryRef.current = summary;

  useEffect(() => {
    if (!actor) return undefined;
    let reconnectTimer = null;
    let connectedOnce = socket.connected;

    const handleAlert = (payload) => {
      if (!alertConcernsMe(payload, summaryRef.current)) return;
      const at = Date.parse(payload.at) || Date.now();
      setLiveAlerts((current) => {
        if ((current.get(payload.alertId) ?? 0) >= at) return current;
        const next = new Map(current);
        next.set(payload.alertId, at);
        return next;
      });
      setLastEventAt(Date.now());
      queryClient.invalidateQueries({ queryKey: staffAlertKeys.list });
    };
    const handleConnect = () => {
      if (connectedOnce) {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(
          () => queryClient.invalidateQueries({ queryKey: staffAlertKeys.all }),
          Math.random() * Math.max(RECONNECT_JITTER_MS, connectSpreadMs()),
        );
      }
      connectedOnce = true;
    };

    socket.on(STAFF_ALERTS_CHANNEL, handleAlert);
    socket.on('ready', handleConnect);
    return () => {
      clearTimeout(reconnectTimer);
      socket.off(STAFF_ALERTS_CHANNEL, handleAlert);
      socket.off('ready', handleConnect);
    };
  }, [actor, queryClient]);

  // Son bakıştan önceki canlı haberler sayılmaz (başka sekmede bakılmış
  // olabilir); özet tazelenirken arada gelen haber kaybolmaz.
  const unseen = useMemo(() => {
    const ids = new Set(summary?.unseenIds ?? []);
    const seenAt = summary?.lastSeenAt ? Date.parse(summary.lastSeenAt) : 0;
    for (const [id, at] of liveAlerts) if (at > seenAt) ids.add(id);
    return ids.size;
  }, [summary, liveAlerts]);

  const markSeenLocally = useCallback(
    (lastSeenAt) => {
      queryClient.setQueryData([...staffAlertKeys.summary, actor], (current) =>
        current ? { ...current, unseenIds: [], unseenCount: 0, capped: false, lastSeenAt } : current,
      );
      // Bakış isteği sürerken gelen haber düşmesin: yalnızca bakıştan öncekiler atılır.
      const seenAt = Date.parse(lastSeenAt);
      setLiveAlerts((current) => new Map([...current].filter(([, at]) => at > seenAt)));
    },
    [actor, queryClient],
  );

  return {
    summary,
    unseenCount: Math.min(unseen, STAFF_ALERT_BADGE_CAP),
    capped: Boolean(summary?.capped) || unseen > STAFF_ALERT_BADGE_CAP,
    lastEventAt,
    markSeenLocally,
  };
}
