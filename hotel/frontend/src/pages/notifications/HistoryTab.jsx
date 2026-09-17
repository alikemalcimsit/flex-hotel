import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  displayPhone,
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_SOURCE_LABELS,
  NOTIFICATION_SOURCES,
  NOTIFICATION_STATUS_LABELS,
  NOTIFICATION_STATUSES,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Icon, Input, Select, Spinner } from '@hotelos/ui';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { api, withQuery } from '../../lib/api.js';
import { notificationKeys } from '../../lib/notifications.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { NOTIFICATIONS_CHANNEL } from '../../lib/socket.js';
import { formatClock, formatListTime } from '../../lib/timeFormat.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { useNow } from '../../lib/useNow.js';
import { NotificationDetailDialog } from './NotificationDetailDialog.jsx';
import { CHANNEL_ICONS, STATUS_TONES } from './notificationTheme.js';

/** Bir seferde yüklenen kayıt. */
const HISTORY_PAGE_SIZE = 30;

/** Socket kopukken ekranın kendini tazeleme sıklığı. */
const OFFLINE_REFRESH_MS = 60_000;

const SEARCH_DEBOUNCE_MS = 300;

const CLOCK_TICK_MS = 60_000;

const ALL = '';

/** Adres çubuğundaki filtreler (uyarı bağlantıları da bunları kullanır: `?durum=FAILED`). */
const FILTER_PARAMS = Object.freeze({ status: 'durum', channel: 'kanal', source: 'kaynak', search: 'q' });

const option = (labels) => (value) => ({ value, label: labels[value] });

const STATUS_OPTIONS = [
  { value: ALL, label: 'Tüm durumlar' },
  ...NOTIFICATION_STATUSES.map(option(NOTIFICATION_STATUS_LABELS)),
];
const CHANNEL_OPTIONS = [
  { value: ALL, label: 'Tüm kanallar' },
  ...NOTIFICATION_CHANNELS.map(option(NOTIFICATION_CHANNEL_LABELS)),
];
const SOURCE_OPTIONS = [
  { value: ALL, label: 'Tüm bildirimler' },
  ...NOTIFICATION_SOURCES.map(option(NOTIFICATION_SOURCE_LABELS)),
];

/** @param {URLSearchParams} params */
function readFilters(params) {
  const pick = (name, allowed) => {
    const value = params.get(name) ?? ALL;
    return !allowed || allowed.includes(value) ? value : ALL;
  };
  return {
    status: pick(FILTER_PARAMS.status, NOTIFICATION_STATUSES),
    channel: pick(FILTER_PARAMS.channel, NOTIFICATION_CHANNELS),
    source: pick(FILTER_PARAMS.source, NOTIFICATION_SOURCES),
    search: pick(FILTER_PARAMS.search),
  };
}

/**
 * Gönderim geçmişi — "onay e-postası gitti mi?" sorusunun cevabı.
 *
 * - Üstteki kutular son 24 saatin özeti; "Gönderilemedi" ve "Sırada" aynı
 *   zamanda filtre.
 * - Liste en yeni önce, imleçle ("daha fazla") yüklenir: binlerce kayıtta
 *   sayfa numarası hesaplatılmaz.
 * - Satır detay penceresini açar (adreste: `?bildirim=`). Yetkisi olan
 *   buradan tekrar gönderir ya da sıradakini iptal eder.
 * - Başka süreçte gönderim sonucu değişince liste kendiliğinden tazelenir.
 */
export function HistoryTab() {
  const can = useCan();
  const canManage = can(PERMISSIONS.NOTIFICATIONS_MANAGE);
  const { timeZone } = useHotelToday();
  const now = useNow(CLOCK_TICK_MS);
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readFilters(searchParams);
  const detailId = searchParams.get('bildirim');

  const updateParams = useCallback(
    (changes, { replace = false } = {}) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === undefined || value === ALL) next.delete(key);
            else next.set(key, String(value));
          }
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
    const timer = setTimeout(
      () => updateParams({ [FILTER_PARAMS.search]: searchText.trim() }, { replace: true }),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [searchText, filters.search, updateParams]);

  const { isLive } = useLiveChannel(NOTIFICATIONS_CHANNEL, {
    queryKeys: (payload) =>
      payload?.notificationId
        ? [notificationKeys.histories, notificationKeys.summary, notificationKeys.detail(payload.notificationId)]
        : [notificationKeys.all],
  });

  const summaryQuery = useQuery({
    queryKey: notificationKeys.summary,
    queryFn: () => api('/notifications/summary'),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });
  const summary = summaryQuery.data;

  const historyQuery = useInfiniteQuery({
    queryKey: notificationKeys.history(filters),
    queryFn: ({ pageParam }) =>
      api(
        withQuery('/notifications/history', {
          ...filters,
          limit: HISTORY_PAGE_SIZE,
          cursor: pageParam,
        }),
      ),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });

  const items = historyQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const filtersActive = Object.values(filters).some((value) => value !== ALL);
  const last24h = summary?.last24h ?? {};
  const sentCount = summary ? (last24h.SENT ?? 0) + (last24h.DELIVERED ?? 0) : undefined;

  const openDetail = (id) => updateParams({ bildirim: id });
  const closeDetail = () => updateParams({ bildirim: null });

  return (
    <div className="flex flex-col gap-5">
      {canManage && summary && !summary.secretKeyConfigured && (
        <Alert tone="danger" title="Sunucuda şifreleme anahtarı tanımlı değil">
          SMTP ve SMS parolaları kaydedilemiyor; kanallar bu yüzden çalışmaz. Sunucu yöneticisi ortam dosyasına
          <code className="mx-1 rounded bg-black/[0.06] px-1">SETTINGS_SECRET_KEY</code>
          eklemeli (bkz. <code className="rounded bg-black/[0.06] px-1">.env.example</code>).
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Gönderildi" value={sentCount} hint="Son 24 saat" icon="checkCircle" />
        <SummaryTile
          label="Gönderilemedi"
          value={summary ? last24h.FAILED ?? 0 : undefined}
          hint="Son 24 saat"
          icon="alertCircle"
          tone={last24h.FAILED > 0 ? 'danger' : 'neutral'}
          selected={filters.status === 'FAILED'}
          onClick={() => updateParams({ [FILTER_PARAMS.status]: filters.status === 'FAILED' ? null : 'FAILED' })}
        />
        <SummaryTile
          label="Sırada"
          value={summary?.pending}
          hint="Gönderilmeyi bekleyen"
          icon="clock"
          tone={summary?.pending > 0 ? 'warning' : 'neutral'}
          selected={filters.status === 'PENDING'}
          onClick={() => updateParams({ [FILTER_PARAMS.status]: filters.status === 'PENDING' ? null : 'PENDING' })}
        />
        <SummaryTile
          label="Gönderilmedi"
          value={summary ? last24h.CANCELLED ?? 0 : undefined}
          hint="Son 24 saat"
          icon="bellOff"
        />
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-card bg-surface p-5 shadow-card">
        <Input
          label="Ara"
          name="q"
          type="search"
          placeholder="Misafir, e-posta, telefon, onay kodu…"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          className="w-full sm:w-72"
        />
        <Select
          label="Durum"
          name="durum"
          value={filters.status}
          onChange={(event) => updateParams({ [FILTER_PARAMS.status]: event.target.value })}
          options={STATUS_OPTIONS}
          className="w-full sm:w-44"
        />
        <Select
          label="Kanal"
          name="kanal"
          value={filters.channel}
          onChange={(event) => updateParams({ [FILTER_PARAMS.channel]: event.target.value })}
          options={CHANNEL_OPTIONS}
          className="w-full sm:w-40"
        />
        <Select
          label="Bildirim"
          name="kaynak"
          value={filters.source}
          onChange={(event) => updateParams({ [FILTER_PARAMS.source]: event.target.value })}
          options={SOURCE_OPTIONS}
          className="w-full sm:w-48"
        />
        {filtersActive && (
          <Button
            variant="ghost"
            icon="close"
            onClick={() => {
              setSearchText(ALL);
              updateParams(Object.fromEntries(Object.values(FILTER_PARAMS).map((key) => [key, null])));
            }}
          >
            Filtreleri temizle
          </Button>
        )}
        <span className="ml-auto flex items-center gap-2 self-center" aria-live="polite">
          {historyQuery.isFetching && !historyQuery.isPending && <Spinner label="Yenileniyor…" />}
          <Badge tone={isLive ? 'success' : 'warning'}>{isLive ? 'Canlı' : 'Canlı değil'}</Badge>
        </span>
      </div>

      {historyQuery.isPending && (
        <Card>
          <Spinner label="Bildirimler yükleniyor…" className="py-10" />
        </Card>
      )}

      {historyQuery.isError && (
        <Alert
          tone="danger"
          title="Bildirimler yüklenemedi"
          action={
            <Button variant="outline" size="sm" icon="refresh" onClick={() => historyQuery.refetch()}>
              Tekrar dene
            </Button>
          }
        >
          {historyQuery.error.message}
        </Alert>
      )}

      {historyQuery.data && items.length === 0 && (
        <Card>
          <EmptyState
            icon="bell"
            title={filtersActive ? 'Filtrelere uyan bildirim yok' : 'Henüz bildirim gönderilmedi'}
            description={
              filtersActive
                ? 'Filtreleri temizleyip tekrar bakın.'
                : 'Rezervasyon onaylanınca, oda atanınca, giriş ve çıkışta misafire giden bildirimler burada görünür. Önce "Kanallar" sekmesinden e-posta ya da SMS kanalını açın.'
            }
          />
        </Card>
      )}

      {items.length > 0 && (
        <section aria-label="Bildirim listesi" aria-busy={historyQuery.isFetching} className="flex flex-col gap-2">
          {items.map((item) => (
            <HistoryRow key={item.id} item={item} now={now} timeZone={timeZone} onOpen={openDetail} />
          ))}
        </section>
      )}

      {historyQuery.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            icon="arrowDown"
            disabled={historyQuery.isFetchingNextPage}
            onClick={() => historyQuery.fetchNextPage()}
          >
            {historyQuery.isFetchingNextPage ? 'Yükleniyor…' : 'Daha eski bildirimler'}
          </Button>
        </div>
      )}

      {detailId && (
        <NotificationDetailDialog
          key={detailId}
          notificationId={detailId}
          canManage={canManage}
          timeZone={timeZone}
          onOpen={openDetail}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}

/**
 * @param {{ item: object, now: number, timeZone: string, onOpen: (id: string) => void }} props
 */
function HistoryRow({ item, now, timeZone, onOpen }) {
  const address = item.channel === 'EMAIL' ? item.recipient : displayPhone(item.recipient);
  const who = item.recipientName ? `${item.recipientName} · ${address}` : address;
  const shownAt = item.sentAt ?? item.failedAt ?? item.cancelledAt ?? item.createdAt;

  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      className="flex w-full items-start gap-4 rounded-card border border-transparent bg-surface p-4 text-left shadow-soft transition-colors hover:border-line-strong sm:items-center"
    >
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-item bg-black/[0.04] text-ink-soft"
      >
        <Icon name={CHANNEL_ICONS[item.channel] ?? 'bell'} className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-bold text-ink">{NOTIFICATION_SOURCE_LABELS[item.source]}</span>
          <span className="text-xs font-semibold text-ink-muted">{NOTIFICATION_CHANNEL_LABELS[item.channel]}</span>
          {item.confirmationCode && (
            <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[0.7rem] font-bold text-ink-soft">
              {item.confirmationCode}
            </span>
          )}
          {item.resendOfId && (
            <span className="text-[0.7rem] font-semibold text-ink-muted">· tekrar gönderim</span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-sm text-ink-soft">{who}</span>
        <span className="mt-0.5 block truncate text-xs text-ink-muted">{item.subject ?? item.preview}</span>
        {item.status === 'FAILED' && item.error && (
          <span className="mt-1 block text-xs font-semibold text-sec-strong">{item.error}</span>
        )}
        {item.status === 'CANCELLED' && item.cancelReason && (
          <span className="mt-1 block text-xs text-ink-muted">{item.cancelReason}</span>
        )}
        {item.status === 'PENDING' && item.attempts > 0 && item.nextAttemptAt && (
          <span className="mt-1 block text-xs font-semibold text-warning-ink">
            {item.attempts}. deneme olmadı ({item.error ?? 'geçici hata'}); yeniden deneme {formatClock(item.nextAttemptAt, timeZone)}
          </span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <Badge tone={STATUS_TONES[item.status]}>{NOTIFICATION_STATUS_LABELS[item.status]}</Badge>
        <time dateTime={shownAt} className="text-xs font-semibold text-ink-muted tabular-nums">
          {formatListTime(shownAt, now, timeZone)}
        </time>
      </span>
    </button>
  );
}
