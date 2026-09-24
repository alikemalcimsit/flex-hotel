import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { GUEST_INTENT_LABELS, MESSAGE_DELIVERY_LABELS, MESSAGE_PAGE_SIZE } from '@hotelos/hotel-contracts';
import { Alert, Button, Icon, Spinner } from '@hotelos/ui';
import { api, withQuery } from '../../lib/api.js';
import { inboxKeys } from '../../lib/frontOffice.js';
import { dayKey, formatClock, formatDateTime, formatDayHeading } from '../../lib/timeFormat.js';
import { useNow } from '../../lib/useNow.js';
import { DELIVERY_STYLES, MESSAGE_GROUP_MINUTES } from './messageTheme.js';

/** Alta bu kadar yakınsa kullanıcı "en altta" sayılır; yeni mesajda aşağı kayılır. */
const STICK_TO_BOTTOM_PX = 120;

/** Socket kopukken konuşmanın kendini tazeleme sıklığı. */
const OFFLINE_REFRESH_MS = 20_000;

/** Gün ayracındaki "Bugün / Dün" metninin tazelenmesi. */
const DAY_TICK_MS = 60_000;

const MINUTE_MS = 60_000;

/**
 * Konuşma geçmişi.
 *
 * ### Sıra ve sayfalama
 *
 * Sunucu en yeniden eskiye imleçle verir; ekran ters çevirip en eskiyi üstte
 * çizer. Yukarı kaydırınca bir önceki sayfa kendiliğinden yüklenir ve okunan
 * yer kaymaz (kaydırma konumu korunur).
 *
 * ### Kaydırma
 *
 * Kullanıcı en alttaysa yeni mesajda aşağı kayılır. Geçmişi okuyorsa yeri
 * bozulmaz; altta "yeni mesaj" düğmesi çıkar. Kendi gönderdiği mesajda her
 * zaman aşağı kayılır.
 *
 * ### Gönderilmekte olan mesajlar
 *
 * `pending` listesi sunucuya henüz yazılmamış (ya da yazılmış ama geçmiş
 * tazelenmemiş) mesajlardır; sunucu kaydı geçmişte görününce yerel kopya
 * kendiliğinden düşer.
 *
 * @param {{
 *   conversationId: string,
 *   timeZone: string,
 *   isLive: boolean,
 *   pending: Array<{ clientMessageId: string, text: string, internal: boolean, status: 'sending' | 'failed' | 'sent', error?: string, serverMessage?: object, createdAt: string }>,
 *   onRetry: (clientMessageId: string) => void,
 *   onCreateRequest?: (message: object) => void,
 * }} props
 */
export function MessageThread({ conversationId, timeZone, isLive, pending, onRetry, onCreateRequest }) {
  const scrollRef = useRef(null);
  const topSentinelRef = useRef(null);
  const atBottomRef = useRef(true);
  const restoreRef = useRef(null);
  const initialScrollDone = useRef(false);
  const [unseen, setUnseen] = useState(0);
  const now = useNow(DAY_TICK_MS);

  const query = useInfiniteQuery({
    queryKey: inboxKeys.messages(conversationId),
    queryFn: ({ pageParam }) =>
      api(
        withQuery(`/messaging/conversations/${conversationId}/messages`, {
          before: pageParam,
          limit: MESSAGE_PAGE_SIZE,
        }),
      ),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });

  const serverMessages = (query.data?.pages.flatMap((page) => page.items) ?? []).slice().reverse();
  const serverIds = new Set(serverMessages.map((message) => message.id));
  const localMessages = pending
    .filter((entry) => !(entry.serverMessage && serverIds.has(entry.serverMessage.id)))
    .map((entry) =>
      entry.serverMessage
        ? { ...entry.serverMessage, local: entry }
        : {
            id: `local-${entry.clientMessageId}`,
            direction: 'OUT',
            author: 'STAFF',
            actorName: null,
            text: entry.text,
            internal: entry.internal,
            delivery: null,
            createdAt: entry.createdAt,
            local: entry,
          },
    );
  const messages = [...serverMessages, ...localMessages];
  const newestId = messages.at(-1)?.id;
  const newestIsOwn = messages.at(-1)?.direction === 'OUT';
  const oldestId = messages[0]?.id;

  const scrollToBottom = (behavior = 'auto') => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    atBottomRef.current = true;
    setUnseen(0);
  };

  // İlk yüklemede en alta; sonra yeni mesaj gelince (altta ise ya da kendi mesajıysa).
  useLayoutEffect(() => {
    if (!newestId) return;
    if (!initialScrollDone.current) {
      initialScrollDone.current = true;
      scrollToBottom();
      return;
    }
    if (atBottomRef.current || newestIsOwn) scrollToBottom();
    else setUnseen((count) => count + 1);
  }, [newestId, newestIsOwn]);

  // Eski sayfa eklenince okunan yeri koru.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const saved = restoreRef.current;
    if (!element || !saved) return;
    element.scrollTop = element.scrollHeight - saved.height + saved.top;
    restoreRef.current = null;
  }, [oldestId]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  // Üstteki işaret görününce bir önceki sayfayı yükle.
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !hasNextPage) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || isFetchingNextPage || !initialScrollDone.current) return;
        restoreRef.current = { height: root.scrollHeight, top: root.scrollTop };
        fetchNextPage();
      },
      { root, rootMargin: '200px 0px 0px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_TO_BOTTOM_PX;
    atBottomRef.current = atBottom;
    if (atBottom && unseen > 0) setUnseen(0);
  };

  if (query.isPending) return <Spinner label="Mesajlar yükleniyor…" className="flex-1" />;

  if (query.isError) {
    return (
      <div className="flex-1 p-5">
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
    );
  }

  const rows = [];
  let previous = null;
  for (const message of messages) {
    const day = dayKey(message.createdAt, timeZone);
    const newDay = !previous || dayKey(previous.createdAt, timeZone) !== day;
    if (newDay) rows.push({ type: 'day', key: `day-${day}`, at: message.createdAt });
    const startsGroup =
      newDay ||
      previous.author !== message.author ||
      previous.internal !== message.internal ||
      previous.actorName !== message.actorName ||
      new Date(message.createdAt) - new Date(previous.createdAt) > MESSAGE_GROUP_MINUTES * MINUTE_MS;
    rows.push({ type: 'message', key: message.id, message, startsGroup });
    previous = message;
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-label="Mesaj geçmişi"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-canvas/60 px-4 py-4 sm:px-6"
      >
        <div ref={topSentinelRef} aria-hidden="true" className="h-px" />
        {isFetchingNextPage && <Spinner label="Eski mesajlar yükleniyor…" className="py-3" />}
        {!hasNextPage && messages.length > 0 && (
          <p className="py-3 text-center text-xs font-semibold text-ink-muted">Konuşmanın başı</p>
        )}

        {messages.length === 0 && (
          <p className="py-10 text-center text-sm text-ink-muted">Bu konuşmada henüz mesaj yok.</p>
        )}

        <ol className="flex flex-col">
          {rows.map((row) =>
            row.type === 'day' ? (
              <li key={row.key} className="my-3 flex justify-center">
                <span className="rounded-full border border-line bg-surface px-3 py-1 text-[0.7rem] font-bold text-ink-soft shadow-soft">
                  {formatDayHeading(row.at, now, timeZone)}
                </span>
              </li>
            ) : (
              <MessageBubble
                key={row.key}
                message={row.message}
                startsGroup={row.startsGroup}
                timeZone={timeZone}
                onRetry={onRetry}
                onCreateRequest={onCreateRequest}
              />
            ),
          )}
        </ol>
      </div>

      {unseen > 0 && (
        <button
          type="button"
          onClick={() => scrollToBottom('smooth')}
          className="absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 animate-pop-in items-center gap-2 rounded-full bg-ink px-4 py-2 text-xs font-bold text-white shadow-float"
        >
          <Icon name="arrowDown" className="size-4" />
          {unseen === 1 ? 'Yeni mesaj' : `${unseen} yeni mesaj`}
        </button>
      )}
    </div>
  );
}

/**
 * @param {{
 *   message: object,
 *   startsGroup: boolean,
 *   timeZone: string,
 *   onRetry: (clientMessageId: string) => void,
 *   onCreateRequest?: (message: object) => void,
 * }} props
 */
const MessageBubble = memo(function MessageBubble({ message, startsGroup, timeZone, onRetry, onCreateRequest }) {
  // Sistemin iç notu (AI'ın devir sebebi, gönderdiği rezervasyon isteği): akışın ortasında, misafir görmez.
  if (message.author === 'SYSTEM' && message.internal) {
    return (
      <li className="my-2 flex justify-center">
        <span className="inline-flex max-w-[min(40rem,90%)] items-start gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-center text-xs text-ink-soft">
          <Icon name="lock" className="mt-0.5 size-3.5 shrink-0 text-ink-muted" />
          <span>
            {message.text} · {formatClock(message.createdAt, timeZone)}
          </span>
        </span>
      </li>
    );
  }

  const inbound = message.direction === 'IN';
  const ai = message.author === 'AI';
  // Sistemin misafire yazdığı mesaj (rezervasyon onay kodu): teslim durumuyla, giden balon.
  const system = message.author === 'SYSTEM';
  const note = message.internal;
  const local = message.local;
  const sending = local?.status === 'sending';
  const failed = local?.status === 'failed';

  const bubbleTone = inbound
    ? 'border border-line bg-surface text-ink'
    : note
      ? 'border border-warning-line bg-warning-soft text-ink'
      : ai
        ? 'border border-violet-200 bg-violet-50 text-ink'
        : system
          ? 'border border-line bg-surface-muted text-ink'
          : 'bg-ink text-white';
  const dark = !inbound && !note && !ai && !system;

  const author = inbound
    ? message.actorName || 'Misafir'
    : ai
      ? 'AI asistanı'
      : system
        ? 'Otomatik mesaj'
        : note
          ? `İç not · ${message.actorName ?? 'Siz'}`
          : message.actorName ?? 'Siz';

  const delivery = !note && !inbound && message.delivery ? DELIVERY_STYLES[message.delivery] : null;

  return (
    <li className={`flex flex-col ${inbound ? 'items-start' : 'items-end'} ${startsGroup ? 'mt-3' : 'mt-1'}`}>
      {startsGroup && (
        <span className={`mb-1 flex items-center gap-1.5 px-1 text-[0.7rem] font-bold ${note ? 'text-warning-ink' : 'text-ink-muted'}`}>
          {ai && <Icon name="bot" className="size-3.5 text-violet-700" />}
          {system && <Icon name="zap" className="size-3.5" />}
          {note && <Icon name="lock" className="size-3.5" />}
          {author}
        </span>
      )}

      <div
        className={`max-w-[min(34rem,85%)] rounded-[18px] px-3.5 py-2 text-sm leading-relaxed shadow-soft ${bubbleTone} ${
          inbound ? 'rounded-tl-md' : 'rounded-tr-md'
        } ${sending ? 'opacity-70' : ''}`}
      >
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
        <p
          className={`mt-1 flex items-center justify-end gap-1.5 text-[0.68rem] ${dark ? 'text-white/60' : 'text-ink-muted'}`}
        >
          {note && <span className="font-semibold text-warning-ink">Misafir görmez</span>}
          <time dateTime={message.createdAt} title={formatDateTime(message.createdAt, timeZone)}>
            {formatClock(message.createdAt, timeZone)}
          </time>
          {sending && (
            <span className="inline-flex items-center gap-1">
              <Icon name="clock" className="size-3" />
              Kaydediliyor…
            </span>
          )}
          {delivery && !sending && (
            <span className={`inline-flex items-center gap-1 font-semibold ${dark ? delivery.onDark : delivery.className}`}>
              <Icon name={delivery.icon} className="size-3.5" />
              {MESSAGE_DELIVERY_LABELS[message.delivery]}
            </span>
          )}
        </p>
        {message.delivery === 'FAILED' && message.failureReason && (
          <p className={`mt-1 text-xs ${dark ? 'text-red-200' : 'text-sec-strong'}`}>{message.failureReason}</p>
        )}
      </div>

      {failed && (
        <p role="alert" className="mt-1 flex items-center gap-2 px-1 text-xs font-semibold text-sec-strong">
          <Icon name="alertCircle" className="size-3.5" />
          Kaydedilemedi{local.error ? `: ${local.error}` : ''}
          <button
            type="button"
            onClick={() => onRetry(local.clientMessageId)}
            className="rounded-item px-1.5 py-0.5 underline underline-offset-2 hover:bg-danger-soft"
          >
            Tekrar dene
          </button>
        </p>
      )}

      {inbound && message.intent && (
        <span className="mt-1 px-1 text-[0.68rem] font-semibold text-ink-muted" title="AI asistanının belirlediği niyet">
          Niyet: {GUEST_INTENT_LABELS[message.intent] ?? message.intent}
        </span>
      )}

      {inbound && onCreateRequest && (
        <button
          type="button"
          onClick={() => onCreateRequest(message)}
          className="mt-1 inline-flex items-center gap-1 rounded-item px-1.5 py-0.5 text-[0.7rem] font-semibold text-ink-muted transition-colors hover:bg-black/[0.05] hover:text-ink"
        >
          <Icon name="clipboard" className="size-3.5" />
          İstek oluştur
        </button>
      )}
    </li>
  );
});
