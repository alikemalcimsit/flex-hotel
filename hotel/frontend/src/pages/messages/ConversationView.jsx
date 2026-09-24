import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CONVERSATION_CHANNEL_LABELS, REPLY_WAIT_WARNING_MINUTES } from '@hotelos/hotel-contracts';
import { Alert, Button, Icon, Select, Spinner } from '@hotelos/ui';
import { initialsFor } from '../../layout/initials.js';
import { api, apiPost } from '../../lib/api.js';
import { inboxKeys, requestKeys, useAssignees } from '../../lib/frontOffice.js';
import { formatElapsed, minutesSince } from '../../lib/timeFormat.js';
import { useNow } from '../../lib/useNow.js';
import { useAuthStore } from '../../store/auth.js';
import { CreateRequestDialog } from '../requests/CreateRequestDialog.jsx';
import { ConversationDetails } from './ConversationDetails.jsx';
import { MessageComposer } from './MessageComposer.jsx';
import { MessageThread } from './MessageThread.jsx';
import { CHANNEL_STYLES } from './messageTheme.js';
import { useConversationActions } from './useConversationActions.js';

/** Başlıktaki "x dk bekliyor" metninin akma sıklığı. */
const HEADER_TICK_MS = 30_000;

/** Socket kopukken konuşma başlığının tazelenme sıklığı. */
const OFFLINE_REFRESH_MS = 20_000;

const UNASSIGNED = '';

/** Güvenli bağlam dışında (`crypto.randomUUID` yok) da çalışan v4 kimlik. */
function newClientId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Tek konuşma: başlık, geçmiş, cevap kutusu ve yan panel.
 *
 * ### Okundu
 *
 * Konuşma ekranda açıkken okunmamışlar okunmuş sayılır — ama yalnızca sekme
 * gerçekten görünürken. Arka plandaki sekmede açık kalan konuşma, gelen mesajı
 * "okundu" yapıp rozeti sessizce söndürmemeli.
 *
 * ### Gönderme
 *
 * Mesaj yazılır yazılmaz ekranda görünür ("kaydediliyor"). Kayıt başarısız
 * olursa mesaj kaybolmaz: "Tekrar dene" aynı istemci kimliğiyle gönderir,
 * sunucu ikinci kaydı açmaz (çift tıklama ve ağ tekrarı da böyle korunur).
 *
 * @param {{
 *   conversationId: string,
 *   timeZone: string,
 *   isLive: boolean,
 *   canReply: boolean,
 *   canViewRequests: boolean,
 *   canManageRequests: boolean,
 *   detailsOpen: boolean,
 *   onToggleDetails: () => void,
 *   onBack: () => void,
 * }} props
 */
export function ConversationView({
  conversationId,
  timeZone,
  isLive,
  canReply,
  canViewRequests,
  canManageRequests,
  detailsOpen,
  onToggleDetails,
  onBack,
}) {
  const queryClient = useQueryClient();
  const actions = useConversationActions(conversationId);
  const { assignees, options: assigneeOptions } = useAssignees();
  const userEmail = useAuthStore((state) => state.user?.email);
  const now = useNow(HEADER_TICK_MS);

  const query = useQuery({
    queryKey: inboxKeys.conversation(conversationId),
    queryFn: () => api(`/messaging/conversations/${conversationId}`),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });
  const conversation = query.data;

  const [pending, setPending] = useState([]);
  // "Tekrar dene" güncel listeyi okur; state güncelleyicisinin içinde istek atılmaz
  // (StrictMode güncelleyiciyi iki kez çalıştırır, mesaj iki kez giderdi).
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [requestTarget, setRequestTarget] = useState(null);

  /* ── Okundu ── */
  const markRead = actions.markRead.mutate;
  const markingRef = useRef(false);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  const unreadCount = conversation?.unreadCount ?? 0;
  useEffect(() => {
    if (!visible || unreadCount === 0 || markingRef.current) return;
    markingRef.current = true;
    markRead(undefined, { onSettled: () => (markingRef.current = false) });
  }, [visible, unreadCount, markRead]);

  /* ── Gönderme ── */
  const refreshAfterSend = useCallback(() => {
    const messagesKey = inboxKeys.messages(conversationId);
    queryClient.invalidateQueries({ queryKey: messagesKey }).then(() => {
      // Geçmişte görünen gönderilmiş mesajların yerel kopyası artık gereksiz.
      const pages = queryClient.getQueryData(messagesKey)?.pages ?? [];
      const saved = new Set(pages.flatMap((page) => page.items.map((message) => message.id)));
      setPending((entries) =>
        entries.filter((entry) => !(entry.status === 'sent' && saved.has(entry.serverMessage?.id))),
      );
    });
    queryClient.invalidateQueries({ queryKey: inboxKeys.conversation(conversationId) });
    queryClient.invalidateQueries({ queryKey: inboxKeys.lists });
    queryClient.invalidateQueries({ queryKey: inboxKeys.summary });
  }, [queryClient, conversationId]);

  const patchPending = (clientMessageId, changes) =>
    setPending((entries) =>
      entries.map((entry) => (entry.clientMessageId === clientMessageId ? { ...entry, ...changes } : entry)),
    );

  const send = useMutation({
    mutationFn: ({ clientMessageId, text, internal }) =>
      apiPost(`/messaging/conversations/${conversationId}/messages`, { text, internal, clientMessageId }),
    onSuccess: (message, { clientMessageId }) => {
      patchPending(clientMessageId, { status: 'sent', serverMessage: message, error: undefined });
      refreshAfterSend();
    },
    onError: (error, { clientMessageId }) => {
      patchPending(clientMessageId, { status: 'failed', error: error.message });
    },
  });
  const mutateSend = send.mutate;

  const handleSend = useCallback(
    ({ text, internal }) => {
      const clientMessageId = newClientId();
      setPending((entries) => [
        ...entries,
        { clientMessageId, text, internal, status: 'sending', createdAt: new Date().toISOString() },
      ]);
      mutateSend({ clientMessageId, text, internal });
    },
    [mutateSend],
  );

  const handleRetry = useCallback(
    (clientMessageId) => {
      const entry = pendingRef.current.find((item) => item.clientMessageId === clientMessageId);
      if (!entry || entry.status === 'sending') return;
      setPending((entries) =>
        entries.map((item) =>
          item.clientMessageId === clientMessageId ? { ...item, status: 'sending', error: undefined } : item,
        ),
      );
      mutateSend({ clientMessageId, text: entry.text, internal: entry.internal });
    },
    [mutateSend],
  );

  const handleCreateRequest = useCallback((message) => setRequestTarget({ message }), []);

  if (query.isPending) return <Spinner label="Konuşma yükleniyor…" className="flex-1" />;

  if (query.isError) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <Button variant="ghost" icon="arrowLeft" onClick={onBack} className="self-start xl:hidden">
          Konuşmalar
        </Button>
        <Alert
          tone="danger"
          title="Konuşma açılamadı"
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

  const style = CHANNEL_STYLES[conversation.channel] ?? CHANNEL_STYLES.WEBCHAT;
  const closed = conversation.status === 'CLOSED';
  const me = assignees.find((user) => user.email?.toLowerCase() === userEmail?.toLowerCase()) ?? null;
  const waitingMinutes = conversation.awaitingReplySince ? minutesSince(conversation.awaitingReplySince, now) : null;
  const anonymous = !conversation.guest && conversation.contactName === conversation.address;

  const update = (changes, message) => actions.update.mutate({ conversation, changes, message });
  const assign = (assignedToId) => {
    const name = assigneeOptions.find((option) => option.value === assignedToId)?.label;
    update({ assignedToId }, name ? `Konuşma ${name} kişisine atandı` : 'Konuşmanın ataması kaldırıldı');
  };

  return (
    <div className="relative flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onBack}
            aria-label="Konuşma listesine dön"
            className="grid size-9 shrink-0 place-items-center rounded-item text-ink-muted hover:bg-black/[0.05] hover:text-ink xl:hidden"
          >
            <Icon name="arrowLeft" className="size-5" />
          </button>

          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-sm font-bold text-white"
          >
            {anonymous ? <Icon name={style.icon} className="size-5" /> : initialsFor(conversation.contactName)}
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-ink">{conversation.contactName}</h2>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
              <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold ${style.chip}`}>
                <Icon name={style.icon} className="size-3" />
                {CONVERSATION_CHANNEL_LABELS[conversation.channel]}
              </span>
              {conversation.stay?.roomNumber && (
                <span className="font-semibold text-ink-soft">Oda {conversation.stay.roomNumber}</span>
              )}
              {conversation.stay && <span>{conversation.stay.confirmationCode}</span>}
              {waitingMinutes !== null && !closed && (
                <span
                  className={`inline-flex items-center gap-1 font-semibold ${
                    waitingMinutes >= REPLY_WAIT_WARNING_MINUTES ? 'text-sec-strong' : 'text-warning-ink'
                  }`}
                >
                  <Icon name="clock" className="size-3" />
                  {formatElapsed(conversation.awaitingReplySince, now)} cevap bekliyor
                </span>
              )}
            </p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {canReply ? (
              <>
                <Select
                  compact
                  aria-label="Atanan personel"
                  name="conversation-assignee"
                  value={conversation.assignedTo?.id ?? UNASSIGNED}
                  disabled={actions.update.isPending}
                  onChange={(event) => assign(event.target.value || null)}
                  options={[{ value: UNASSIGNED, label: 'Atanmamış' }, ...assigneeOptions]}
                  className="w-40"
                />
                {me && conversation.assignedTo?.id !== me.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    icon="user"
                    disabled={actions.update.isPending}
                    onClick={() => update({ assignedToId: me.id }, 'Konuşmayı üstlendiniz')}
                  >
                    Üstlen
                  </Button>
                )}
                {conversation.mode === 'AI' && !closed && (
                  <Button
                    size="sm"
                    icon="user"
                    disabled={actions.update.isPending}
                    onClick={() =>
                      update({ mode: 'MANUAL' }, 'Konuşma personele alındı; AI asistanı bu konuşmaya karışmayacak')
                    }
                  >
                    Manuele al
                  </Button>
                )}
                {conversation.mode === 'MANUAL' && conversation.autoResponderAvailable && !closed && (
                  <Button
                    size="sm"
                    variant="outline"
                    icon="bot"
                    disabled={actions.update.isPending}
                    onClick={() => update({ mode: 'AI' }, 'Konuşma AI asistanına devredildi')}
                  >
                    AI'a devret
                  </Button>
                )}
                {closed ? (
                  <Button
                    size="sm"
                    variant="outline"
                    icon="rotateCcw"
                    disabled={actions.update.isPending}
                    onClick={() => update({ status: 'OPEN' }, 'Konuşma yeniden açıldı')}
                  >
                    Yeniden aç
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="check"
                    disabled={actions.update.isPending}
                    onClick={() => update({ status: 'CLOSED' }, 'Konuşma kapatıldı')}
                  >
                    Kapat
                  </Button>
                )}
              </>
            ) : (
              conversation.assignedTo && (
                <span className="text-xs font-semibold text-ink-muted">Atanan: {conversation.assignedTo.name}</span>
              )
            )}
            <button
              type="button"
              onClick={onToggleDetails}
              aria-pressed={detailsOpen}
              aria-label="Misafir ve konaklama bilgisi"
              title="Misafir ve konaklama bilgisi"
              className={`grid size-9 place-items-center rounded-item border transition-colors 2xl:hidden ${
                detailsOpen ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink hover:bg-line'
              }`}
            >
              <Icon name="panelRight" className="size-[18px]" />
            </button>
          </div>
        </header>

        <div className="flex flex-col empty:hidden [&>*]:rounded-none [&>*]:border-x-0 [&>*]:border-t-0">
          {!conversation.channelConnected && (
            <Alert tone="warning">
              <span className="sm:hidden">
                {CONVERSATION_CHANNEL_LABELS[conversation.channel]} bağlı değil; cevaplar sırada bekler.
              </span>
              <span className="hidden sm:inline">
                {CONVERSATION_CHANNEL_LABELS[conversation.channel]} bağlantısı kapalı (Ayarlar → Mesaj kanalları). Misafir
                mesajları ve cevaplarınız kaydedilir; cevaplar kanal açılınca gönderilir.
              </span>
            </Alert>
          )}
          {conversation.mode === 'AI' && !closed && (
            <Alert tone="info">
              Bu konuşmayı AI asistanı yanıtlıyor. Yazarsanız ya da "Manuele al"a basarsanız konuşma size geçer.
            </Alert>
          )}
          {closed && <Alert tone="info">Konuşma kapalı. Misafir yazarsa ya da siz cevap verirseniz yeniden açılır.</Alert>}
        </div>

        <MessageThread
          conversationId={conversationId}
          timeZone={timeZone}
          isLive={isLive}
          pending={pending}
          onRetry={handleRetry}
          onCreateRequest={canManageRequests ? handleCreateRequest : undefined}
        />

        {canReply && <MessageComposer conversation={conversation} onSend={handleSend} />}
      </div>

      {detailsOpen && (
        <aside
          aria-label="Misafir ve konaklama"
          className="absolute inset-y-0 right-0 z-20 w-[min(22rem,100%)] overflow-y-auto border-l border-line bg-surface shadow-float 2xl:static 2xl:z-auto 2xl:w-80 2xl:shrink-0 2xl:shadow-none"
        >
          <div className="flex items-center justify-between border-b border-line px-5 py-3 2xl:hidden">
            <span className="text-sm font-bold text-ink">Bilgi</span>
            <button
              type="button"
              onClick={onToggleDetails}
              aria-label="Bilgi panelini kapat"
              className="grid size-8 place-items-center rounded-item text-ink-muted hover:bg-black/[0.05] hover:text-ink"
            >
              <Icon name="close" className="size-4" />
            </button>
          </div>
          <ConversationDetails
            conversation={conversation}
            timeZone={timeZone}
            canReply={canReply}
            canViewRequests={canViewRequests}
            canManageRequests={canManageRequests}
            actions={actions}
            onCreateRequest={() => setRequestTarget({ message: null })}
          />
        </aside>
      )}

      {requestTarget && (
        <CreateRequestDialog
          conversation={conversation}
          message={requestTarget.message}
          onClose={() => setRequestTarget(null)}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: requestKeys.forConversation(conversationId) });
          }}
        />
      )}
    </div>
  );
}
