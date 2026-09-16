import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';
import { playInboxChime } from './inboxSound.js';
import { PERMISSIONS, useCan } from './permissions.js';
import { MESSAGING_CHANNEL, REQUESTS_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

/**
 * Gelen kutusu ve misafir istekleri: sorgu anahtarları ve her sayfada açık
 * duran özetler (yan menü rozeti, sekme sayıları).
 *
 * Anahtarlar tek yerde; canlı tazeleme hangi anahtarı yenileyeceğini buradan
 * bilir. Önek düzeni: `['messaging', ...]`, `['guest-requests', ...]`.
 */

export const inboxKeys = Object.freeze({
  all: ['messaging'],
  summary: ['messaging', 'summary'],
  lists: ['messaging', 'list'],
  /** @param {object} filters */
  list: (filters) => ['messaging', 'list', filters],
  /** @param {string} id */
  conversation: (id) => ['messaging', 'conversation', id],
  /** @param {string} id */
  messages: (id) => ['messaging', 'messages', id],
});

export const requestKeys = Object.freeze({
  all: ['guest-requests'],
  summary: ['guest-requests', 'summary'],
  lists: ['guest-requests', 'list'],
  /** @param {object} filters */
  list: (filters) => ['guest-requests', 'list', filters],
  /** @param {string} conversationId */
  forConversation: (conversationId) => ['guest-requests', 'list', { conversationId }],
  /** @param {string} id */
  detail: (id) => ['guest-requests', 'detail', id],
  assignees: ['guest-requests', 'assignees'],
  /** @param {string} roomId */
  roomContext: (roomId) => ['guest-requests', 'room-context', roomId],
});

/**
 * Özetler socket haberiyle tazelenir; "uzun süredir bekleyen" ve "gecikmiş"
 * sayıları ise haber olmadan, zamanla değişir. Dakikalık tazeleme bunun için
 * (sunucuda otel başına dakikada tek hesaplama; arka plandaki sekmede durur).
 */
const SUMMARY_REFRESH_MS = 60_000;

/** Personel listesi seyrek değişir (modül 2). */
const ASSIGNEES_STALE_MS = 5 * 60_000;

export function useInboxSummary({ enabled = true } = {}) {
  return useQuery({
    queryKey: inboxKeys.summary,
    queryFn: () => api('/messaging/summary'),
    enabled,
    refetchInterval: SUMMARY_REFRESH_MS,
    staleTime: SUMMARY_REFRESH_MS / 2,
  });
}

export function useRequestSummary({ enabled = true } = {}) {
  return useQuery({
    queryKey: requestKeys.summary,
    queryFn: () => api('/guest-requests/summary'),
    enabled,
    refetchInterval: SUMMARY_REFRESH_MS,
    staleTime: SUMMARY_REFRESH_MS / 2,
  });
}

/** Atama seçicisi seçenekleri. */
export function useAssignees() {
  const query = useQuery({
    queryKey: requestKeys.assignees,
    queryFn: () => api('/guest-requests/assignees'),
    staleTime: ASSIGNEES_STALE_MS,
  });
  // Seçenek dizisi sabit kalsın: liste satırları `memo` ile çiziliyor.
  const options = useMemo(
    () => (query.data ?? []).map((user) => ({ value: user.id, label: user.name })),
    [query.data],
  );
  return { assignees: query.data ?? [], isPending: query.isPending, options };
}

/**
 * Kabukta bir kez çağrılır: rozet özetlerini canlı tutar, yeni misafir
 * mesajında ses çalar ve yan menüye rozetleri verir.
 *
 * Yetkisi olmayan kullanıcı (ör. yalnızca kat hizmeti) ne sorgu atar ne
 * kanala abone olur.
 *
 * @returns {{
 *   messages: { count: number, urgent: boolean, label: string } | null,
 *   requests: { count: number, urgent: boolean, label: string } | null,
 * }}
 */
export function useFrontOfficeBadges() {
  const can = useCan();
  const canMessages = can(PERMISSIONS.MESSAGES_VIEW);
  const canRequests = can(PERMISSIONS.REQUESTS_VIEW);

  useLiveChannel(MESSAGING_CHANNEL, {
    enabled: canMessages,
    queryKeys: [inboxKeys.summary],
    onChange: (payload) => {
      if (payload?.event === 'guest.message.received') playInboxChime();
    },
  });
  useLiveChannel(REQUESTS_CHANNEL, { enabled: canRequests, queryKeys: [requestKeys.summary] });

  const inbox = useInboxSummary({ enabled: canMessages }).data;
  const requests = useRequestSummary({ enabled: canRequests }).data;

  return {
    messages: inbox
      ? {
          count: inbox.waiting,
          urgent: inbox.waitingTooLong > 0,
          label:
            inbox.waiting === 0
              ? 'Cevap bekleyen mesaj yok'
              : `${inbox.waiting} konuşma cevap bekliyor${
                  inbox.waitingTooLong > 0 ? `, ${inbox.waitingTooLong} tanesi ${inbox.replyWarningMinutes} dakikadan uzun süredir` : ''
                }`,
        }
      : null,
    requests: requests
      ? {
          count: requests.open,
          urgent: requests.overdue > 0,
          label:
            requests.open === 0
              ? 'Açık istek yok'
              : `${requests.open} açık istek${requests.overdue > 0 ? `, ${requests.overdue} tanesi gecikmiş` : ''}`,
        }
      : null,
  };
}
