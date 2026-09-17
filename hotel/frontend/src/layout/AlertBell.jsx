import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { STAFF_ALERT_KIND_LABELS, STAFF_ALERT_KINDS, STAFF_ALERT_PAGE_SIZE } from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Icon, Spinner } from '@hotelos/ui';
import { api, apiPost, apiPut, withQuery } from '../lib/api.js';
import { staffAlertKeys, useStaffAlertBell } from '../lib/notifications.js';
import { formatElapsed } from '../lib/timeFormat.js';
import { useNow } from '../lib/useNow.js';
import { useAuthStore } from '../store/auth.js';
import { toastError } from '../store/toast.js';

/** Liste açıkken "5 dk önce" yazılarının tazelenmesi. */
const CLOCK_TICK_MS = 30_000;

const KIND_ICONS = Object.freeze({
  GUEST_MESSAGE: 'message',
  URGENT_REQUEST: 'alertTriangle',
  OVERDUE_REQUEST: 'clock',
  MANUAL_TASK: 'clipboard',
  NOTIFICATION_FAILED: 'alertCircle',
  APPROVAL_REQUESTED: 'checkCheck',
});

const SEVERITY_TONES = Object.freeze({
  INFO: 'bg-info-soft text-info-ink',
  WARNING: 'bg-warning-soft text-warning-ink',
  CRITICAL: 'bg-danger-soft text-sec-strong',
});

const SEVERITY_LABELS = Object.freeze({ INFO: '', WARNING: 'Uyarı', CRITICAL: 'Acil' });

/**
 * Üst bardaki zil — personele düşen uyarılar (modül 9).
 *
 * - Rozet: son bakıştan sonra gelen uyarılar. Zil açılınca sıfırlanır.
 * - Liste: en yeni önce; okunmamış olan koyu. Tıklayınca okundu olur ve
 *   ilgili ekrana gider (konuşma, istek, bildirim geçmişi).
 * - Kişi istemediği türleri susturabilir (ör. resepsiyon şefi misafir
 *   mesajlarını gelen kutusundan zaten izliyor).
 *
 * Açılır panel bir diyalog gibi davranır: Esc kapatır ve odağı zile geri
 * verir; dışarı tıklamak kapatır.
 */
export function AlertBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const bell = useStaffAlertBell();
  const actor = useAuthStore((state) => state.user?.email);
  // Oturum değişince başka kişinin listesi görünmesin.
  const listKey = [...staffAlertKeys.list, actor];
  const [isOpen, setIsOpen] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const panelId = useId();
  const headingId = useId();

  const { summary, unseenCount, capped } = bell;
  const staffKnown = summary?.staffKnown !== false;

  const listQuery = useInfiniteQuery({
    queryKey: listKey,
    queryFn: ({ pageParam }) =>
      api(withQuery('/staff-alerts', { limit: STAFF_ALERT_PAGE_SIZE, cursor: pageParam })),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: isOpen && staffKnown,
  });

  const seenMutation = useMutation({
    mutationFn: () => apiPost('/staff-alerts/seen', {}),
    onSuccess: (result) => bell.markSeenLocally(result.lastSeenAt),
  });

  const updateItems = (update) =>
    queryClient.setQueryData(listKey, (current) =>
      current
        ? { ...current, pages: current.pages.map((page) => ({ ...page, items: page.items.map(update) })) }
        : current,
    );

  const readMutation = useMutation({
    mutationFn: (alertId) => apiPost(`/staff-alerts/${alertId}/read`, {}),
    onMutate: (alertId) => updateItems((item) => (item.id === alertId ? { ...item, read: true } : item)),
    // Uyarı bu arada saklama süresinden düşmüş olabilir; gezinme yine yapılır.
    onError: () => queryClient.invalidateQueries({ queryKey: staffAlertKeys.list }),
  });

  const readAllMutation = useMutation({
    mutationFn: () => apiPost('/staff-alerts/read-all', {}),
    onSuccess: (result) => {
      updateItems((item) => ({ ...item, read: true }));
      bell.markSeenLocally(result.lastSeenAt);
    },
    onError: (error) => toastError(error.message),
  });

  const preferencesMutation = useMutation({
    mutationFn: (mutedKinds) => apiPut('/staff-alerts/preferences', { mutedKinds }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: staffAlertKeys.all }),
    onError: (error) => toastError(error.message),
  });

  const mutateSeen = seenMutation.mutate;
  const hasUnseen = unseenCount > 0;
  useEffect(() => {
    if (isOpen && hasUnseen && staffKnown) mutateSeen();
  }, [isOpen, hasUnseen, staffKnown, mutateSeen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    panelRef.current?.focus();

    const close = () => {
      setIsOpen(false);
      setShowPreferences(false);
    };
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) close();
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      close();
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  function openAlert(alert) {
    if (!alert.read) readMutation.mutate(alert.id);
    setIsOpen(false);
    if (alert.link) navigate(alert.link);
  }

  const badgeText = capped ? '99+' : String(unseenCount);
  const buttonLabel = hasUnseen ? `Uyarılar, ${capped ? '99’dan fazla' : unseenCount} yeni` : 'Uyarılar';
  const items = listQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const mutedKinds = summary?.mutedKinds ?? [];

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        aria-label={buttonLabel}
        title="Uyarılar"
        onClick={() => {
          setIsOpen((open) => !open);
          setShowPreferences(false);
        }}
        className="relative inline-flex size-[42px] shrink-0 items-center justify-center rounded-control border border-line bg-surface text-ink shadow-soft transition duration-200 hover:bg-line"
      >
        <Icon name="bell" className="size-[18px]" />
        {hasUnseen && (
          <span
            aria-hidden="true"
            className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-sec-strong px-1 text-center text-[0.68rem] font-bold leading-5 text-white ring-2 ring-canvas tabular-nums"
          >
            {badgeText}
          </span>
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {hasUnseen ? `${badgeText} yeni uyarı` : ''}
      </span>

      {isOpen && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-labelledby={headingId}
          tabIndex={-1}
          className="fixed inset-x-4 top-[4.75rem] z-30 flex max-h-[min(34rem,calc(100dvh-6rem))] animate-pop-in flex-col rounded-panel border border-line bg-surface shadow-float outline-none sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[24rem]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 id={headingId} className="text-sm font-bold text-ink">
              {showPreferences ? 'Hangi uyarılar gelsin?' : 'Uyarılar'}
            </h2>
            <div className="flex items-center gap-1">
              {!showPreferences && items.some((item) => !item.read) && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="checkCheck"
                  disabled={readAllMutation.isPending}
                  onClick={() => readAllMutation.mutate()}
                >
                  Tümünü okundu say
                </Button>
              )}
              {staffKnown && (
                <button
                  type="button"
                  aria-pressed={showPreferences}
                  onClick={() => setShowPreferences((open) => !open)}
                  title={showPreferences ? 'Uyarılara dön' : 'Uyarı tercihleri'}
                  aria-label={showPreferences ? 'Uyarılara dön' : 'Uyarı tercihleri'}
                  className="grid size-8 place-items-center rounded-item text-ink-muted transition-colors hover:bg-black/[0.05] hover:text-ink"
                >
                  <Icon name={showPreferences ? 'arrowLeft' : 'sliders'} className="size-4" />
                </button>
              )}
            </div>
          </div>

          {!staffKnown && (
            <div className="p-4">
              <Alert tone="warning" title="Personel kaydınız bulunamadı">
                Uyarılar kişiye ve yetkiye göre gelir. Giriş yaptığınız e-posta otelin personel listesinde yok.
              </Alert>
            </div>
          )}

          {staffKnown && showPreferences && (
            <fieldset className="flex flex-col gap-3 overflow-y-auto px-4 py-4">
              <legend className="sr-only">Uyarı türleri</legend>
              <p className="text-xs text-ink-muted">
                Kapattığınız türler zilde görünmez ve rozeti artırmaz. Ekranların kendi sayaçları (gelen kutusu,
                istekler) etkilenmez.
              </p>
              {STAFF_ALERT_KINDS.map((kind) => (
                <Checkbox
                  key={kind}
                  id={`alert-kind-${kind}`}
                  label={STAFF_ALERT_KIND_LABELS[kind]}
                  checked={!mutedKinds.includes(kind)}
                  disabled={preferencesMutation.isPending}
                  onChange={(event) =>
                    preferencesMutation.mutate(
                      event.target.checked ? mutedKinds.filter((entry) => entry !== kind) : [...mutedKinds, kind],
                    )
                  }
                />
              ))}
            </fieldset>
          )}

          {staffKnown && !showPreferences && (
            <AlertList
              query={listQuery}
              items={items}
              onOpen={openAlert}
              mutedCount={mutedKinds.length}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * @param {{
 *   query: import('@tanstack/react-query').UseInfiniteQueryResult,
 *   items: Array<object>,
 *   onOpen: (alert: object) => void,
 *   mutedCount: number,
 * }} props
 */
function AlertList({ query, items, onOpen, mutedCount }) {
  const now = useNow(CLOCK_TICK_MS);

  if (query.isPending) return <Spinner className="py-10" label="Uyarılar yükleniyor…" />;
  if (query.isError) {
    return (
      <div className="p-4">
        <Alert
          tone="danger"
          title="Uyarılar yüklenemedi"
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
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <span className="grid size-11 place-items-center rounded-panel bg-black/[0.04] text-ink-muted">
          <Icon name="bell" className="size-5" />
        </span>
        <p className="text-sm font-bold text-ink">Uyarı yok</p>
        <p className="text-xs text-ink-muted">
          Misafir yazınca, acil ya da geciken istek olunca burada görünür.
          {mutedCount > 0 ? ` ${mutedCount} tür susturulmuş.` : ''}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto overscroll-contain">
      <ul className="divide-y divide-line">
        {items.map((alert) => (
          <li key={alert.id}>
            <button
              type="button"
              onClick={() => onOpen(alert)}
              className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-black/[0.03] focus-visible:bg-black/[0.03] ${
                alert.read ? '' : 'bg-sec/[0.035]'
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-item ${SEVERITY_TONES[alert.severity]}`}
              >
                <Icon name={KIND_ICONS[alert.kind] ?? 'bell'} className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-2">
                  <span className={`line-clamp-2 text-sm leading-snug text-ink ${alert.read ? 'font-medium' : 'font-bold'}`}>
                    {SEVERITY_LABELS[alert.severity] && (
                      <span className="sr-only">{SEVERITY_LABELS[alert.severity]}: </span>
                    )}
                    {alert.title}
                  </span>
                  <span className="shrink-0 whitespace-nowrap pt-0.5 text-[0.7rem] font-semibold text-ink-muted tabular-nums">
                    {formatElapsed(alert.occurredAt, now)}
                  </span>
                </span>
                {alert.body && <span className="mt-0.5 line-clamp-2 block text-xs text-ink-muted">{alert.body}</span>}
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.7rem] font-semibold text-ink-muted">
                  <span>{STAFF_ALERT_KIND_LABELS[alert.kind]}</span>
                  {alert.count > 1 && <span className="tabular-nums">· {alert.count} kez</span>}
                  {alert.personal && <span>· size atanmış</span>}
                </span>
              </span>
              {!alert.read && (
                <span className="mt-2 size-2 shrink-0 rounded-full bg-sec-strong">
                  <span className="sr-only">Okunmadı</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {query.hasNextPage && (
        <div className="border-t border-line p-3 text-center">
          <Button
            variant="ghost"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? 'Yükleniyor…' : 'Daha eski uyarılar'}
          </Button>
        </div>
      )}
    </div>
  );
}
