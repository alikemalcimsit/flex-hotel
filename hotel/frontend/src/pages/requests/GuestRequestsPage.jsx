import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  GUEST_REQUEST_CATEGORIES,
  GUEST_REQUEST_CATEGORY_LABELS,
  GUEST_REQUEST_PRIORITIES,
  GUEST_REQUEST_PRIORITY_LABELS,
  GUEST_REQUEST_VIEW_LABELS,
  GUEST_REQUEST_VIEWS,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Icon, Input, Select, Spinner } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { api, withQuery } from '../../lib/api.js';
import { requestKeys, useAssignees, useRequestSummary } from '../../lib/frontOffice.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { REQUESTS_CHANNEL } from '../../lib/socket.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { CreateRequestDialog } from './CreateRequestDialog.jsx';
import { RequestDetailDialog } from './RequestDetailDialog.jsx';
import { RequestRow } from './RequestRow.jsx';
import { RequestStatusDialog } from './RequestStatusDialog.jsx';
import { CATEGORY_ICONS } from './requestTheme.js';
import { useRequestActions } from './useRequestActions.js';

/** Sayfa başına istek. */
const REQUESTS_PAGE_SIZE = 20;

/** Socket kopukken ekranın kendini tazeleme sıklığı. */
const OFFLINE_REFRESH_MS = 60_000;

const SEARCH_DEBOUNCE_MS = 300;

const DEFAULT_VIEW = 'ACTIVE';
const ALL = '';

/** Atama filtresinde "kimseye atanmamış" seçeneği. */
const UNASSIGNED_FILTER = 'none';

/**
 * Adres çubuğundaki filtreler. `konusma` yalnızca bağlantıyla gelir (konuşma
 * ekranındaki "istek daha" bağlantısı); ekranda kaldırılabilir çip olarak görünür.
 */
const FILTER_KEYS = Object.freeze(['category', 'priority', 'assignee', 'q', 'konusma']);

/** Not isteyen durumlar pencere açar; diğerleri doğrudan uygulanır. */
const STATUSES_WITH_NOTE = new Set(['DONE', 'CANCELLED']);

const CATEGORY_OPTIONS = [
  { value: ALL, label: 'Tüm kategoriler' },
  ...GUEST_REQUEST_CATEGORIES.map((value) => ({ value, label: GUEST_REQUEST_CATEGORY_LABELS[value] })),
];

const PRIORITY_OPTIONS = [
  { value: ALL, label: 'Tüm öncelikler' },
  ...GUEST_REQUEST_PRIORITIES.map((value) => ({ value, label: GUEST_REQUEST_PRIORITY_LABELS[value] })),
];

/** @param {URLSearchParams} params */
function readView(params) {
  const view = params.get('view');
  const page = Number(params.get('page'));
  return {
    view: GUEST_REQUEST_VIEWS.includes(view) ? view : DEFAULT_VIEW,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    filters: Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ALL])),
    detailId: params.get('istek'),
  };
}

/**
 * Misafir istekleri — "misafir bir şey bekliyor" listesi.
 *
 * ### Ekranın mantığı
 *
 * - Açık işler **en acilden** sıralı (hedef saate göre); geciken kırmızı,
 *   süresi yaklaşan sarı. Geri sayım ekran açık kaldıkça akar.
 * - Üstteki kutular hem durum özeti hem filtre: "Gecikmiş"e basınca liste
 *   ona döner. Kategori çipleri de öyle.
 * - Satırdan tek tıkla başlat / tamamla / ata. Tamamlama notu ve iptal sebebi
 *   küçük bir pencerede sorulur.
 * - Görünüm, filtreler ve açık detay adreste: yenileyince kaybolmaz, bağlantı
 *   paylaşılabilir (konuşma ekranı detay bağlantısını buradan kurar).
 *
 * ### Canlı
 *
 * Başka personel bir isteği kapatınca ya da misafir mesajından yeni istek
 * açılınca liste kendiliğinden tazelenir (`requests.changed`). Bağlantı
 * yoksa dakikada bir sorar.
 */
export function GuestRequestsPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.REQUESTS_MANAGE);
  const { timeZone } = useHotelToday();
  const { options: assigneeOptions } = useAssignees();
  const actions = useRequestActions();
  const summary = useRequestSummary().data;

  const [searchParams, setSearchParams] = useSearchParams();
  const { view, page, filters, detailId } = readView(searchParams);

  const updateParams = useCallback(
    (changes, { resetPage = true, replace = false } = {}) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === undefined || value === ALL) next.delete(key);
            else next.set(key, String(value));
          }
          if (next.get('view') === DEFAULT_VIEW) next.delete('view');
          if (resetPage && !('page' in changes)) next.delete('page');
          return next;
        },
        { replace },
      );
    },
    [setSearchParams],
  );

  const [searchText, setSearchText] = useState(filters.q);
  useEffect(() => setSearchText(filters.q), [filters.q]);
  useEffect(() => {
    if (searchText === filters.q) return undefined;
    const timer = setTimeout(() => updateParams({ q: searchText }, { replace: true }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText, filters.q, updateParams]);

  const [creating, setCreating] = useState(false);
  // Telefonda filtreler katlanır; masaüstünde hep açık.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState(null);

  const { isLive } = useLiveChannel(REQUESTS_CHANNEL, {
    queryKeys: [requestKeys.lists, ['guest-requests', 'detail']],
  });

  const listFilters = {
    view,
    page,
    category: filters.category,
    priority: filters.priority,
    assignee: filters.assignee,
    search: filters.q.trim(),
    conversationId: filters.konusma,
  };
  const listQuery = useQuery({
    queryKey: requestKeys.list(listFilters),
    queryFn: () =>
      api(
        withQuery('/guest-requests', {
          view,
          page,
          pageSize: REQUESTS_PAGE_SIZE,
          category: filters.category,
          priority: filters.priority,
          search: listFilters.search,
          conversationId: filters.konusma,
          ...(filters.assignee === UNASSIGNED_FILTER
            ? { unassigned: true }
            : { assignedToId: filters.assignee }),
        }),
      ),
    placeholderData: keepPreviousData,
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });

  const openDetail = useCallback((request) => updateParams({ istek: request.id }, { resetPage: false }), [updateParams]);
  const closeDetail = useCallback(() => updateParams({ istek: null }, { resetPage: false }), [updateParams]);

  const mutateStatus = actions.changeStatus.mutate;
  const handleStatus = useCallback(
    (request, status) => {
      if (STATUSES_WITH_NOTE.has(status)) setStatusTarget({ request, status });
      else mutateStatus({ request, status });
    },
    [mutateStatus],
  );

  const mutateUpdate = actions.update.mutate;
  const handleAssign = useCallback(
    (request, assignedToId) => {
      const name = assigneeOptions.find((option) => option.value === assignedToId)?.label;
      mutateUpdate({
        request,
        changes: { assignedToId },
        message: name ? `"${request.title}" ${name} kişisine atandı` : `"${request.title}" ataması kaldırıldı`,
      });
    },
    [assigneeOptions, mutateUpdate],
  );

  const data = listQuery.data;
  const meta = data?.meta;
  const filtersActive = FILTER_KEYS.some((key) => filters[key] !== ALL);
  const activeFilterCount = ['category', 'priority', 'assignee'].filter((key) => filters[key] !== ALL).length;

  const viewCount = {
    ACTIVE: summary?.open,
    OVERDUE: summary?.overdue,
    MINE: summary?.mine,
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Misafir istekleri"
        description="Havlu, arıza, uyandırma, şikâyet — misafirin beklediği her şey, en acilden başlayarak."
        actions={
          canManage && (
            <Button icon="plus" onClick={() => setCreating(true)}>
              Yeni istek
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile
          label="Açık"
          value={summary?.open}
          hint="Bekleyen ve üzerinde çalışılan"
          icon="clipboard"
          selected={view === 'ACTIVE' && filters.assignee === ALL}
          onClick={() => updateParams({ view: 'ACTIVE', assignee: null })}
        />
        <SummaryTile
          label="Gecikmiş"
          value={summary?.overdue}
          hint="Hedef süresi geçti"
          icon="alertTriangle"
          tone={summary?.overdue > 0 ? 'danger' : 'neutral'}
          selected={view === 'OVERDUE'}
          onClick={() => updateParams({ view: 'OVERDUE' })}
        />
        <SummaryTile
          label="Süresi yaklaşan"
          value={summary?.dueSoon}
          hint={`${summary?.dueSoonMinutes ?? ''} dakika içinde`}
          icon="clock"
          tone={summary?.dueSoon > 0 ? 'warning' : 'neutral'}
        />
        <SummaryTile
          label="Atanmamış"
          value={summary?.unassigned}
          hint="Kimse üstlenmedi"
          icon="user"
          tone={summary?.unassigned > 0 ? 'warning' : 'neutral'}
          selected={view === 'ACTIVE' && filters.assignee === UNASSIGNED_FILTER}
          onClick={() => updateParams({ view: 'ACTIVE', assignee: UNASSIGNED_FILTER })}
        />
      </div>

      <div className="flex flex-col gap-4 rounded-card bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="İstek görünümleri" className="-mx-1 flex overflow-x-auto px-1">
            <div className="inline-flex min-w-max gap-1 rounded-control border border-line bg-surface-muted p-1">
              {GUEST_REQUEST_VIEWS.map((key) => {
                const selected = view === key;
                const count = viewCount[key];
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => updateParams({ view: key })}
                    className={`inline-flex items-center gap-2 whitespace-nowrap rounded-item px-3.5 py-2 text-sm font-semibold transition-colors ${
                      selected ? 'bg-ink text-white' : 'text-ink-muted hover:bg-black/[0.04] hover:text-ink'
                    }`}
                  >
                    {GUEST_REQUEST_VIEW_LABELS[key]}
                    {count > 0 && (
                      <span
                        className={`rounded-full px-1.5 text-[0.7rem] font-bold tabular-nums ${
                          key === 'OVERDUE'
                            ? 'bg-sec-strong text-white'
                            : selected
                              ? 'bg-white/20 text-white'
                              : 'bg-black/[0.07] text-ink-soft'
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <span className="flex items-center gap-2" aria-live="polite">
            {listQuery.isFetching && !listQuery.isPending && <Spinner label="Yenileniyor…" />}
            <Badge tone={isLive ? 'success' : 'warning'}>{isLive ? 'Canlı' : 'Canlı değil'}</Badge>
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <Input
            label="Ara"
            name="q"
            type="search"
            placeholder="Başlık, oda ya da misafir…"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            className="w-full sm:w-64"
          />
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="request-filters"
            onClick={() => setFiltersOpen((open) => !open)}
            className="inline-flex items-center gap-2 rounded-control border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink sm:hidden"
          >
            <Icon name="sliders" className="size-4" />
            Filtreler
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-ink px-1.5 text-[0.7rem] font-bold text-white">{activeFilterCount}</span>
            )}
            <Icon name="chevronDown" className={`size-4 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
          </button>
          <div
            id="request-filters"
            className={`${filtersOpen ? 'flex' : 'hidden'} w-full flex-col gap-3 sm:contents`}
          >
            <Select
              label="Kategori"
              name="category"
              value={filters.category}
              onChange={(event) => updateParams({ category: event.target.value })}
              options={CATEGORY_OPTIONS}
              className="w-full sm:w-48"
            />
            <Select
              label="Öncelik"
              name="priority"
              value={filters.priority}
              onChange={(event) => updateParams({ priority: event.target.value })}
              options={PRIORITY_OPTIONS}
              className="w-full sm:w-44"
            />
            <Select
              label="Atanan"
              name="assignee"
              value={filters.assignee}
              onChange={(event) => updateParams({ assignee: event.target.value })}
              options={[
                { value: ALL, label: 'Herkes' },
                { value: UNASSIGNED_FILTER, label: 'Atanmamış' },
                ...assigneeOptions,
              ]}
              className="w-full sm:w-52"
            />
          </div>
          {filters.konusma && (
            <button
              type="button"
              onClick={() => updateParams({ konusma: null })}
              className="inline-flex items-center gap-1.5 self-end rounded-full bg-info-soft px-3 py-2 text-xs font-semibold text-info-ink hover:bg-info-line"
            >
              <Icon name="message" className="size-3.5" />
              Tek konuşmanın istekleri
              <Icon name="close" className="size-3.5" />
              <span className="sr-only">— filtreyi kaldır</span>
            </button>
          )}
          {filtersActive && (
            <Button
              variant="ghost"
              icon="close"
              onClick={() => {
                setSearchText(ALL);
                updateParams(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])));
              }}
            >
              Filtreleri temizle
            </Button>
          )}
        </div>

        {summary && Object.keys(summary.byCategory).length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Açık isteklerin kategorileri">
            <span className="mr-1 text-xs font-semibold text-ink-muted">Açık işler:</span>
            {GUEST_REQUEST_CATEGORIES.filter((category) => summary.byCategory[category] > 0).map((category) => {
              const selected = filters.category === category;
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => updateParams({ category: selected ? null : category })}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                    selected
                      ? 'border-ink bg-ink text-white'
                      : 'border-line-strong bg-surface text-ink-soft hover:border-ink hover:text-ink'
                  }`}
                >
                  <Icon name={CATEGORY_ICONS[category]} className="size-3.5" />
                  {GUEST_REQUEST_CATEGORY_LABELS[category]}
                  <span className="tabular-nums opacity-70">{summary.byCategory[category]}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {listQuery.isPending && (
        <Card>
          <Spinner label="İstekler yükleniyor…" className="py-10" />
        </Card>
      )}

      {listQuery.isError && (
        <Alert
          tone="danger"
          title="İstekler yüklenemedi"
          action={
            <Button variant="outline" size="sm" icon="refresh" onClick={() => listQuery.refetch()}>
              Tekrar dene
            </Button>
          }
        >
          {listQuery.error.message}
        </Alert>
      )}

      {data && data.items.length === 0 && (
        <Card>
          <EmptyState
            icon="clipboard"
            title={emptyTitle(view, filtersActive)}
            description={
              filtersActive
                ? 'Filtreleri temizleyin ya da başka bir görünüme geçin.'
                : view === 'ACTIVE'
                  ? 'Misafir bir şey istediğinde (telefon, resepsiyon ya da mesaj) buraya düşer.'
                  : undefined
            }
            action={
              canManage &&
              view === 'ACTIVE' &&
              !filtersActive && (
                <Button variant="outline" icon="plus" onClick={() => setCreating(true)}>
                  Yeni istek
                </Button>
              )
            }
          />
        </Card>
      )}

      {data && data.items.length > 0 && (
        <section aria-label="İstek listesi" aria-busy={listQuery.isFetching} className="flex flex-col gap-2.5">
          {data.items.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              timeZone={timeZone}
              canManage={canManage}
              busy={actions.busyId === request.id}
              assigneeOptions={assigneeOptions}
              onOpen={openDetail}
              onStatus={handleStatus}
              onAssign={handleAssign}
            />
          ))}
        </section>
      )}

      {meta && meta.totalPages > 1 && (
        <nav aria-label="İstek sayfaları" className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs font-semibold text-ink-muted">{meta.total} istek</span>
          <Button
            variant="outline"
            size="sm"
            icon="chevronLeft"
            disabled={page <= 1}
            onClick={() => updateParams({ page: page - 1 }, { resetPage: false })}
          >
            Önceki
          </Button>
          <span className="text-sm font-semibold text-ink-soft" aria-live="polite">
            {meta.page} / {meta.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= meta.totalPages}
            onClick={() => updateParams({ page: page + 1 }, { resetPage: false })}
          >
            Sonraki
            <Icon name="chevronRight" className="size-3.5" />
          </Button>
        </nav>
      )}

      {creating && <CreateRequestDialog onClose={() => setCreating(false)} />}

      {detailId && (
        <RequestDetailDialog
          key={detailId}
          requestId={detailId}
          canManage={canManage}
          actions={actions}
          onStatus={handleStatus}
          onClose={closeDetail}
        />
      )}

      {statusTarget && (
        <RequestStatusDialog
          key={`${statusTarget.request.id}-${statusTarget.status}`}
          request={statusTarget.request}
          status={statusTarget.status}
          isPending={actions.changeStatus.isPending}
          onClose={() => setStatusTarget(null)}
          onConfirm={(note) =>
            actions.changeStatus.mutate(
              { request: statusTarget.request, status: statusTarget.status, note },
              // Hata olursa pencere açık kalır: yazılan not kaybolmasın.
              { onSuccess: () => setStatusTarget(null) },
            )
          }
        />
      )}
    </div>
  );
}

/** @param {string} view @param {boolean} filtersActive */
function emptyTitle(view, filtersActive) {
  if (filtersActive) return 'Filtrelere uyan istek yok';
  switch (view) {
    case 'OVERDUE':
      return 'Geciken istek yok';
    case 'MINE':
      return 'Size atanmış açık istek yok';
    case 'DONE':
      return 'Henüz tamamlanan istek yok';
    case 'CANCELLED':
      return 'İptal edilen istek yok';
    case 'ALL':
      return 'Henüz istek açılmamış';
    default:
      return 'Açık istek yok';
  }
}
