import { useQuery } from '@tanstack/react-query';
import { manualTaskScope } from '@hotelos/hotel-contracts';
import { api } from './api.js';
import { MANUAL_TASKS_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';
import { useAuthStore } from '../store/auth.js';

/**
 * Aktör paneli ve manuel görevler (modül 12): sorgu anahtarları, rozet ve
 * ekranların ortak biçimleyicileri.
 */

export const actorKeys = Object.freeze({
  all: ['actors'],
  list: ['actors', 'list'],
  /** @param {string} name */
  detail: (name) => ['actors', 'detail', name],
  /** @param {string} name @param {number} days */
  usage: (name, days) => ['actors', 'usage', name, days],
});

export const taskKeys = Object.freeze({
  all: ['manual-tasks'],
  summary: ['manual-tasks', 'summary'],
  lists: ['manual-tasks', 'list'],
  /** @param {object} filters */
  list: (filters) => ['manual-tasks', 'list', filters],
  /** @param {string} id */
  detail: (id) => ['manual-tasks', 'detail', id],
});

/** Aktör sağlığının ekrandaki adı ve rengi. */
export const HEALTH_STYLES = Object.freeze({
  OK: { label: 'Sorunsuz', tone: 'success', icon: 'checkCircle' },
  IDLE: { label: 'İş gelmedi', tone: 'neutral', icon: 'clock' },
  WARN: { label: 'Uyarı var', tone: 'warning', icon: 'alertTriangle' },
  ERROR: { label: 'Hata var', tone: 'danger', icon: 'alertCircle' },
  OFF: { label: 'Kapalı', tone: 'danger', icon: 'close' },
  UNAVAILABLE: { label: 'Kurulu değil', tone: 'neutral', icon: 'info' },
});

/**
 * USD, küçük tutarlar sıfır görünmesin diye 4 ondalığa kadar.
 * @param {string | number | null | undefined} value
 */
export function formatUsd(value) {
  const number = Number(value ?? 0);
  return `$${number.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

/** @param {number | null | undefined} value */
export const formatCount = (value) => Number(value ?? 0).toLocaleString('tr-TR');

/**
 * Bütçe çubuğunun doluluğu (0–1) ve rengi. Bütçe 0 ise AI çağrı yapmaz (tam).
 * @param {string | number} spent
 * @param {string | number} budget
 */
export function budgetBar(spent, budget) {
  const limit = Number(budget ?? 0);
  if (!(limit > 0)) return { ratio: 1, tone: 'bg-sec-strong', exhausted: true };
  const ratio = Math.min(1, Number(spent ?? 0) / limit);
  return { ratio, tone: ratio >= 1 ? 'bg-sec-strong' : ratio >= 0.8 ? 'bg-warning' : 'bg-success', exhausted: ratio >= 1 };
}

/** Kişinin manuel görev kapsamı (menü, rozet, ekran). */
export function useManualTaskScope() {
  const permissions = useAuthStore((state) => state.permissions);
  return manualTaskScope(permissions ?? []);
}

/**
 * Özet asıl olarak socket haberiyle tazelenir; bu aralık kopukken kaçanları
 * ve "en eski görevin yaşı"nı toplar. Sunucu otel başına dakikada tek
 * hesaplama yapar.
 */
const SUMMARY_REFRESH_MS = 60_000;
/** Rozetin canlı tazelemesi arasındaki en kısa süre (her panelde açık). */
const BADGE_MIN_REFRESH_MS = 10_000;

/** @param {{ enabled?: boolean }} [options] */
export function useManualTaskSummary({ enabled = true } = {}) {
  return useQuery({
    queryKey: taskKeys.summary,
    queryFn: () => api('/manual-tasks/summary'),
    enabled,
    refetchInterval: SUMMARY_REFRESH_MS,
    staleTime: SUMMARY_REFRESH_MS / 2,
  });
}

/**
 * Yan menüdeki "Görevler" rozeti. Görev görme kapsamı olmayan kullanıcı ne
 * sorgu atar ne kanala abone olur.
 *
 * @returns {{ count: number, urgent: boolean, label: string } | null}
 */
export function useManualTaskBadge() {
  const scope = useManualTaskScope();
  const enabled = !scope.empty;
  useLiveChannel(MANUAL_TASKS_CHANNEL, { enabled, minIntervalMs: BADGE_MIN_REFRESH_MS, queryKeys: [taskKeys.summary] });
  const summary = useManualTaskSummary({ enabled }).data;
  if (!enabled || !summary) return null;
  const waiting = summary.open - summary.claimed;
  return {
    count: summary.open,
    urgent: waiting > 0,
    label:
      summary.open === 0
        ? 'Açık manuel görev yok'
        : `${summary.open} manuel görev açık${waiting > 0 ? `, ${waiting} tanesini kimse üstlenmedi` : ''}`,
  };
}

/** Görev bağlantısı → uygulamadaki ekran. */
const TASK_LINK_ROUTES = Object.freeze({
  reservation: { label: 'Rezervasyona git', to: (id) => `/rezervasyonlar/${id}` },
  conversation: { label: 'Konuşmaya git', to: (id) => `/mesajlar/${id}` },
  request: { label: 'Misafir isteğine git', to: (id) => `/istekler?istek=${id}` },
  approval: { label: 'Onaya git', to: (id) => `/onaylar/gecmis?onay=${id}` },
});

/**
 * @param {Array<{ kind: string, id: string }>} links
 * @returns {Array<{ key: string, label: string, to: string }>}
 */
export function taskLinkTargets(links) {
  return (links ?? [])
    .filter((link) => TASK_LINK_ROUTES[link.kind])
    .map((link) => ({ key: `${link.kind}:${link.id}`, label: TASK_LINK_ROUTES[link.kind].label, to: TASK_LINK_ROUTES[link.kind].to(link.id) }));
}
