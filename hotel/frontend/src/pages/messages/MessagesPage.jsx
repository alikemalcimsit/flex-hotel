import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CONVERSATION_CHANNELS, INBOX_VIEWS } from '@hotelos/hotel-contracts';
import { Badge, EmptyState, Icon } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { useMediaQuery } from '../../layout/useMediaQuery.js';
import { inboxKeys, requestKeys, useInboxSummary } from '../../lib/frontOffice.js';
import { useInboxSoundStore } from '../../lib/inboxSound.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { MESSAGING_CHANNEL, REQUESTS_CHANNEL } from '../../lib/socket.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { ConversationList } from './ConversationList.jsx';
import { ConversationView } from './ConversationView.jsx';

const DEFAULT_VIEW = 'OPEN';
const ALL = '';
const SEARCH_DEBOUNCE_MS = 300;

/** İki panelin yan yana sığdığı genişlik (Tailwind `xl`). */
const TWO_PANE_QUERY = '(min-width: 80rem)';

/** Yan panelin kalıcı açık durduğu genişlik (Tailwind `2xl`). */
const THREE_PANE_QUERY = '(min-width: 96rem)';

/** @param {URLSearchParams} params */
function readFilters(params) {
  const view = params.get('view');
  const channel = params.get('kanal');
  return {
    view: INBOX_VIEWS.includes(view) ? view : DEFAULT_VIEW,
    channel: CONVERSATION_CHANNELS.includes(channel) ? channel : ALL,
    search: params.get('q') ?? ALL,
  };
}

/**
 * Misafir mesajları — ön büronun gelen kutusu.
 *
 * ### Düzen
 *
 * Geniş ekranda üç sütun: konuşmalar · konuşma · misafir/konaklama/istekler.
 * Orta genişlikte bilgi paneli düğmeyle açılır. Dar ekranda (tablet, telefon)
 * tek sütun: liste ya da konuşma; geri düğmesi listeye döner.
 *
 * ### Adres
 *
 * Açık konuşma yolda (`/mesajlar/:id`), görünüm ve arama sorguda: sayfa
 * yenilenince aynı yer açılır, konuşma bağlantısı paylaşılabilir (istek
 * ekranından "konuşmayı aç" buraya gelir).
 *
 * ### Canlı
 *
 * Misafir yazınca, başka personel cevap verince ya da konuşmayı üstlenince
 * liste ve açık konuşma kendiliğinden tazelenir. Socket yalnızca "şu konuşma
 * değişti" der; açık olmayan konuşmanın geçmişi boşuna indirilmez.
 *
 * ### Kanallar henüz bağlı değil
 *
 * WhatsApp / web chat geçitleri modül 8'de. O gelene kadar ekran bunu açıkça
 * söyler; cevaplar "gönderim bekliyor" olarak saklanır, gönderilmiş gibi
 * gösterilmez.
 */
export function MessagesPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const can = useCan();
  const canReply = can(PERMISSIONS.MESSAGES_REPLY);
  const canViewRequests = can(PERMISSIONS.REQUESTS_VIEW);
  const canManageRequests = can(PERMISSIONS.REQUESTS_MANAGE);
  const { timeZone } = useHotelToday();
  const summary = useInboxSummary().data;
  const soundEnabled = useInboxSoundStore((state) => state.enabled);
  const toggleSound = useInboxSoundStore((state) => state.toggle);

  const twoPane = useMediaQuery(TWO_PANE_QUERY);
  const threePane = useMediaQuery(THREE_PANE_QUERY);
  const [detailsToggled, setDetailsToggled] = useState(false);
  const detailsOpen = threePane || detailsToggled;

  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readFilters(searchParams);
  const querySuffix = searchParams.toString() ? `?${searchParams.toString()}` : '';

  const updateFilters = useCallback(
    (changes, { replace = false } = {}) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === undefined || value === ALL) next.delete(key);
            else next.set(key, String(value));
          }
          if (next.get('view') === DEFAULT_VIEW) next.delete('view');
          return next;
        },
        { replace },
      );
    },
    [setSearchParams],
  );

  const [searchText, setSearchText] = useState(filters.search);
  useEffect(() => setSearchText(filters.search), [filters.search]);
  useEffect(() => {
    if (searchText === filters.search) return undefined;
    const timer = setTimeout(() => updateFilters({ q: searchText }, { replace: true }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText, filters.search, updateFilters]);

  // Yalnızca değişen konuşmanın ayrıntısı tazelenir; liste her haberde.
  const { isLive } = useLiveChannel(MESSAGING_CHANNEL, {
    queryKeys: (payload) => {
      if (!payload) return [inboxKeys.lists, ['messaging', 'conversation'], ['messaging', 'messages']];
      const keys = [inboxKeys.lists];
      if (payload.conversationId && payload.conversationId === conversationId) {
        keys.push(inboxKeys.conversation(conversationId), inboxKeys.messages(conversationId));
      }
      return keys;
    },
  });
  // Konuşmadan açılan istek başka ekranda kapanınca yan panel de güncellensin.
  useLiveChannel(REQUESTS_CHANNEL, {
    enabled: canViewRequests && Boolean(conversationId),
    queryKeys: (payload) =>
      payload === null || payload?.requestId
        ? [requestKeys.lists, ...(conversationId ? [inboxKeys.conversation(conversationId)] : [])]
        : [],
  });

  const listVisible = twoPane || !conversationId;
  const conversationVisible = twoPane || Boolean(conversationId);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Mesajlar"
        description={
          // Telefonda açıklama mesaj alanından yer çalmasın.
          <span className="hidden sm:inline">
            Misafirlerle yapılan WhatsApp ve web chat konuşmaları; istekleri buradan işe dönüştürün.
          </span>
        }
        actions={
          <>
            <Badge tone={isLive ? 'success' : 'warning'}>{isLive ? 'Canlı' : 'Canlı değil'}</Badge>
            <button
              type="button"
              onClick={toggleSound}
              aria-pressed={soundEnabled}
              className="inline-flex items-center gap-2 rounded-control border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-ink shadow-soft transition-colors hover:bg-line"
            >
              <Icon name={soundEnabled ? 'volume' : 'volumeOff'} className="size-4" />
              {soundEnabled ? 'Ses açık' : 'Ses kapalı'}
            </button>
          </>
        }
      />

      {/* Kart ekranın kalanını doldurur: mesaj alanı ve cevap kutusu sayfa kaydırmadan görünür. */}
      <div className="relative flex h-[max(30rem,calc(100dvh-12.5rem))] overflow-hidden rounded-card bg-surface shadow-card sm:h-[max(34rem,calc(100dvh-14.5rem))]">
        {listVisible && (
          <section
            aria-label="Konuşma listesi"
            className="flex w-full min-w-0 flex-col border-line xl:w-[22rem] xl:shrink-0 xl:border-r 2xl:w-[24rem]"
          >
            <ConversationList
              view={filters.view}
              channel={filters.channel}
              search={filters.search.trim()}
              searchText={searchText}
              onSearchText={setSearchText}
              onChangeView={(view) => updateFilters({ view })}
              onChangeChannel={(channel) => updateFilters({ kanal: channel })}
              selectedId={conversationId}
              linkSuffix={querySuffix}
              summary={summary}
              isLive={isLive}
              timeZone={timeZone}
            />
          </section>
        )}

        {conversationVisible && (
          <section aria-label="Konuşma" className="flex min-w-0 flex-1 flex-col">
            {conversationId ? (
              <ConversationView
                key={conversationId}
                conversationId={conversationId}
                timeZone={timeZone}
                isLive={isLive}
                canReply={canReply}
                canViewRequests={canViewRequests}
                canManageRequests={canManageRequests}
                detailsOpen={detailsOpen}
                onToggleDetails={() => setDetailsToggled((open) => !open)}
                onBack={() => navigate(`/mesajlar${querySuffix}`)}
              />
            ) : (
              <div className="grid flex-1 place-items-center bg-canvas/60">
                <EmptyState
                  icon="message"
                  title="Bir konuşma seçin"
                  description={
                    summary?.waiting
                      ? `${summary.waiting} konuşma cevap bekliyor. En uzun bekleyen listede kırmızı görünür.`
                      : 'Soldaki listeden bir konuşma açın.'
                  }
                />
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
