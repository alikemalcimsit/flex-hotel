import { memo, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  CONVERSATION_CHANNEL_LABELS,
  CONVERSATION_CHANNELS,
  INBOX_PAGE_SIZE,
  INBOX_VIEW_LABELS,
  INBOX_VIEWS,
} from '@hotelos/hotel-contracts';
import { Alert, Button, EmptyState, Icon, Select, Spinner } from '@hotelos/ui';
import { initialsFor } from '../../layout/initials.js';
import { api, withQuery } from '../../lib/api.js';
import { inboxKeys } from '../../lib/frontOffice.js';
import { formatElapsed, formatListTime, minutesSince } from '../../lib/timeFormat.js';
import { useNow } from '../../lib/useNow.js';
import { CHANNEL_STYLES, PREVIEW_PREFIX } from './messageTheme.js';

/** Satırlardaki "x dk önce / bekliyor" metninin akma sıklığı. */
const LIST_TICK_MS = 30_000;

/** Socket kopukken listenin kendini tazeleme sıklığı. */
const OFFLINE_REFRESH_MS = 30_000;

const ALL = '';

const CHANNEL_OPTIONS = [
  { value: ALL, label: 'Tüm kanallar' },
  ...CONVERSATION_CHANNELS.map((value) => ({ value, label: CONVERSATION_CHANNEL_LABELS[value] })),
];

/** Görünüm → özet sayısı alanı ve acil sayılma koşulu. */
const VIEW_COUNTS = Object.freeze({
  OPEN: { field: 'open' },
  WAITING: { field: 'waiting', urgentField: 'waitingTooLong' },
  MINE: { field: 'mine' },
  UNASSIGNED: { field: 'unassigned' },
});

const EMPTY_TITLES = Object.freeze({
  OPEN: 'Açık konuşma yok',
  WAITING: 'Cevap bekleyen misafir yok',
  MINE: 'Size atanmış açık konuşma yok',
  UNASSIGNED: 'Atanmamış konuşma yok',
  CLOSED: 'Kapalı konuşma yok',
  ALL: 'Henüz konuşma yok',
});

/**
 * Gelen kutusu listesi.
 *
 * İmleçle sayfalanır ("daha eski konuşmalar"): yeni mesaj gelince liste
 * kaymaz, sayfa atlanmaz. Satır, konuşmanın özetini taşır (son mesaj,
 * okunmamış, bekleme süresi) — her satır için mesaj sayılmaz.
 *
 * Klavye: ↑/↓ konuşmalar arasında gezer.
 *
 * @param {{
 *   view: string,
 *   channel: string,
 *   search: string,
 *   searchText: string,
 *   onSearchText: (value: string) => void,
 *   onChangeView: (view: string) => void,
 *   onChangeChannel: (channel: string) => void,
 *   selectedId: string | undefined,
 *   linkSuffix: string,
 *   summary: object | undefined,
 *   isLive: boolean,
 *   timeZone: string,
 * }} props
 */
export function ConversationList({
  view,
  channel,
  search,
  searchText,
  onSearchText,
  onChangeView,
  onChangeChannel,
  selectedId,
  linkSuffix,
  summary,
  isLive,
  timeZone,
}) {
  const listRef = useRef(null);
  const filters = { view, channel, search };

  const query = useInfiniteQuery({
    queryKey: inboxKeys.list(filters),
    queryFn: ({ pageParam }) =>
      api(
        withQuery('/messaging/conversations', {
          view,
          channel,
          search,
          cursor: pageParam,
          limit: INBOX_PAGE_SIZE,
        }),
      ),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // Canlı haberde yüklenmiş bütün sayfalar yeniden istenir. İlk sayfa
    // sunucuda sürüm anahtarlı önbellekte; eski sayfaları açan panel az.
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });

  const conversations = query.data?.pages.flatMap((page) => page.items) ?? [];

  const onKeyDown = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const links = [...(listRef.current?.querySelectorAll('a[data-conversation]') ?? [])];
    const index = links.indexOf(document.activeElement);
    if (index === -1) return;
    event.preventDefault();
    const next = links[event.key === 'ArrowDown' ? Math.min(index + 1, links.length - 1) : Math.max(index - 1, 0)];
    next?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-3 border-b border-line p-4">
        <div role="group" aria-label="Gelen kutusu görünümleri" className="flex flex-wrap gap-1.5">
          {INBOX_VIEWS.map((key) => {
            const selected = view === key;
            const config = VIEW_COUNTS[key];
            const count = config && summary ? summary[config.field] : 0;
            const urgent = config?.urgentField && summary ? summary[config.urgentField] > 0 : false;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                onClick={() => onChangeView(key)}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  selected
                    ? 'border-ink bg-ink text-white'
                    : 'border-line-strong bg-surface text-ink-soft hover:border-ink hover:text-ink'
                }`}
              >
                {INBOX_VIEW_LABELS[key]}
                {count > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[0.68rem] font-bold tabular-nums ${
                      urgent ? 'bg-sec-strong text-white' : selected ? 'bg-white/20' : 'bg-black/[0.07]'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Konuşmalarda ara</span>
            <Icon
              name="search"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            />
            <input
              type="search"
              value={searchText}
              onChange={(event) => onSearchText(event.target.value)}
              placeholder="Ad, numara, oda, mesaj…"
              className="w-full rounded-item border border-line-strong bg-surface py-2 pl-9 pr-3 text-sm font-medium text-ink outline-none transition placeholder:font-normal placeholder:text-ink-muted/70 focus:border-ink focus:ring-[3px] focus:ring-black/[0.08]"
            />
          </label>
          <Select
            compact
            aria-label="Kanal"
            name="channel"
            value={channel}
            onChange={(event) => onChangeChannel(event.target.value)}
            options={CHANNEL_OPTIONS}
            className="w-32 shrink-0 [&_select]:py-2"
          />
        </div>
      </div>

      <div
        ref={listRef}
        onKeyDown={onKeyDown}
        aria-busy={query.isFetching}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {query.isPending && <Spinner label="Konuşmalar yükleniyor…" className="py-10" />}

        {query.isError && (
          <div className="p-4">
            <Alert
              tone="danger"
              action={
                <Button variant="outline" size="sm" icon="refresh" onClick={() => query.refetch()}>
                  Tekrar dene
                </Button>
              }
            >
              {query.error.message}
            </Alert>
          </div>
        )}

        {query.isSuccess && conversations.length === 0 && (
          <EmptyState
            icon="message"
            title={search || channel ? 'Aramaya uyan konuşma yok' : EMPTY_TITLES[view]}
            description={
              search || channel
                ? 'Aramayı ya da kanal filtresini değiştirin.'
                : view === 'OPEN'
                  ? 'Misafirler WhatsApp ya da web chat üzerinden yazdığında konuşmalar burada görünür.'
                  : undefined
            }
          />
        )}

        {conversations.length > 0 && (
          <ul aria-label="Konuşmalar" className="divide-y divide-line">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <ConversationItem
                  conversation={conversation}
                  selected={conversation.id === selectedId}
                  linkSuffix={linkSuffix}
                  warningMinutes={summary?.replyWarningMinutes}
                  timeZone={timeZone}
                />
              </li>
            ))}
          </ul>
        )}

        {query.hasNextPage && (
          <div className="p-3">
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Yükleniyor…' : 'Daha eski konuşmalar'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * @param {{ conversation: object, selected: boolean, linkSuffix: string, warningMinutes?: number, timeZone: string }} props
 */
const ConversationItem = memo(function ConversationItem({
  conversation,
  selected,
  linkSuffix,
  warningMinutes,
  timeZone,
}) {
  const now = useNow(LIST_TICK_MS);
  const style = CHANNEL_STYLES[conversation.channel] ?? CHANNEL_STYLES.WEBCHAT;
  const unread = conversation.unreadCount > 0;
  const waitingMinutes = conversation.awaitingReplySince ? minutesSince(conversation.awaitingReplySince, now) : null;
  const waitingTooLong = waitingMinutes !== null && warningMinutes !== undefined && waitingMinutes >= warningMinutes;
  const anonymous = !conversation.guest && conversation.contactName === conversation.address;
  const closed = conversation.status === 'CLOSED';

  const srSummary = [
    CONVERSATION_CHANNEL_LABELS[conversation.channel],
    unread ? `${conversation.unreadCount} okunmamış mesaj` : null,
    waitingMinutes !== null ? `${formatElapsed(conversation.awaitingReplySince, now)} cevap bekliyor` : null,
    closed ? 'kapalı' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <NavLink
      to={`/mesajlar/${conversation.id}${linkSuffix}`}
      data-conversation
      aria-current={selected ? 'page' : undefined}
      className={`flex gap-3 px-4 py-3.5 outline-offset-[-2px] transition-colors ${
        selected ? 'bg-ink/[0.045] shadow-[inset_3px_0_0_var(--color-sec)]' : 'hover:bg-black/[0.025]'
      } ${closed ? 'opacity-70' : ''}`}
    >
      <span className="relative shrink-0">
        <span
          aria-hidden="true"
          className={`grid size-11 place-items-center rounded-full text-sm font-bold ${
            unread ? 'bg-ink text-white' : 'bg-black/[0.06] text-ink-soft'
          }`}
        >
          {anonymous ? <Icon name={style.icon} className="size-5" /> : initialsFor(conversation.contactName)}
        </span>
        <span
          aria-hidden="true"
          className={`absolute -bottom-0.5 -right-0.5 grid size-5 place-items-center rounded-full ring-2 ring-surface ${style.chip}`}
        >
          <Icon name={style.icon} className="size-3" />
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-sm ${unread ? 'font-bold text-ink' : 'font-semibold text-ink'}`}>
            {conversation.contactName}
          </span>
          <span className={`shrink-0 text-[0.7rem] tabular-nums ${unread ? 'font-bold text-ink' : 'text-ink-muted'}`}>
            {formatListTime(conversation.lastMessageAt, now, timeZone)}
          </span>
        </span>

        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className={`truncate text-[0.8rem] ${unread ? 'font-semibold text-ink-soft' : 'text-ink-muted'}`}>
            {PREVIEW_PREFIX[conversation.lastMessageAuthor] ?? ''}
            {conversation.lastMessagePreview ?? 'Mesaj yok'}
          </span>
          {unread && (
            <span
              aria-hidden="true"
              className="min-w-5 shrink-0 rounded-full bg-sec-strong px-1.5 text-center text-[0.68rem] font-bold leading-5 text-white tabular-nums"
            >
              {conversation.unreadCount}
            </span>
          )}
        </span>

        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.68rem] font-semibold">
          {conversation.stay?.roomNumber && (
            <span className="rounded-full bg-info-soft px-2 py-0.5 text-info-ink">Oda {conversation.stay.roomNumber}</span>
          )}
          {waitingMinutes !== null && !closed && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                waitingTooLong ? 'bg-sec-strong text-white' : 'bg-warning-soft text-warning-ink'
              }`}
            >
              <Icon name="clock" className="size-3" />
              {formatElapsed(conversation.awaitingReplySince, now)}
            </span>
          )}
          {conversation.mode === 'AI' && !closed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-violet-800">
              <Icon name="bot" className="size-3" />
              AI
            </span>
          )}
          {conversation.assignedTo && (
            <span className="truncate rounded-full bg-black/[0.05] px-2 py-0.5 text-ink-soft">
              {conversation.assignedTo.name}
            </span>
          )}
          {closed && <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-ink-muted">Kapalı</span>}
        </span>
        <span className="sr-only">{srSummary}</span>
      </span>
    </NavLink>
  );
});
