import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import {
  APPROVAL_DECIDED_STATUSES,
  APPROVAL_PAGE_SIZE,
  APPROVAL_STATUS_LABELS,
  APPROVAL_TYPE_LABELS,
  APPROVAL_TYPES,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Input, Select, Spinner } from '@hotelos/ui';
import { api, withQuery } from '../../lib/api.js';
import { approvalKeys } from '../../lib/approvals.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { APPROVALS_CHANNEL } from '../../lib/socket.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { useNow } from '../../lib/useNow.js';
import { ApprovalDetailDialog } from './ApprovalDetailDialog.jsx';
import { ApprovalRow } from './ApprovalRow.jsx';
import { FILTER_PARAMS } from './approvalTheme.js';

/** Socket kopukken ekranın kendini tazeleme sıklığı. */
const OFFLINE_REFRESH_MS = 60_000;

/** Kalan sürelerin akması. */
const CLOCK_TICK_MS = 60_000;

const SEARCH_DEBOUNCE_MS = 300;

const ALL = '';

const TYPE_OPTIONS = [
  { value: ALL, label: 'Tüm türler' },
  ...APPROVAL_TYPES.map((value) => ({ value, label: APPROVAL_TYPE_LABELS[value] })),
];

const STATUS_OPTIONS = [
  { value: ALL, label: 'Tüm kararlar' },
  ...APPROVAL_DECIDED_STATUSES.map((value) => ({ value, label: APPROVAL_STATUS_LABELS[value] })),
];

/**
 * @param {URLSearchParams} params
 * @param {boolean} history
 */
function readFilters(params, history) {
  const pick = (name, allowed) => {
    const value = params.get(name) ?? ALL;
    return !allowed || allowed.includes(value) ? value : ALL;
  };
  return {
    type: pick(FILTER_PARAMS.type, APPROVAL_TYPES),
    status: history ? pick(FILTER_PARAMS.status, APPROVAL_DECIDED_STATUSES) : ALL,
    search: pick(FILTER_PARAMS.search),
  };
}

/**
 * Onay listesi: bekleyenler (en uzun bekleyen en üstte) ya da geçmiş (yeni
 * karar önce). İmleçle yüklenir; filtreler ve açık detay adreste (zilin
 * bağlantısı `?onay=` ile buraya gelir).
 *
 * Başka bir yönetici karar verince ya da yeni onay düşünce liste
 * kendiliğinden tazelenir (`approvals.changed`); bağlantı yoksa dakikada bir.
 *
 * @param {{ view: 'PENDING' | 'HISTORY', children?: React.ReactNode }} props `children` üstteki özet kutuları
 */
export function ApprovalList({ view, children }) {
  const history = view === 'HISTORY';
  const can = useCan();
  const canDecide = can(PERMISSIONS.APPROVALS_DECIDE);
  const { timeZone } = useHotelToday();
  const now = useNow(CLOCK_TICK_MS);
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readFilters(searchParams, history);
  const detailId = searchParams.get(FILTER_PARAMS.detail);
  /** Satırdan tek tıkla gelen karar penceresi hangi kipte açılsın. */
  const [detailMode, setDetailMode] = useState('view');

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

  const { isLive } = useLiveChannel(APPROVALS_CHANNEL, {
    queryKeys: (payload) =>
      payload?.approvalId
        ? [approvalKeys.lists, approvalKeys.summary, approvalKeys.detail(payload.approvalId)]
        : [approvalKeys.all],
  });

  const listQuery = useInfiniteQuery({
    queryKey: approvalKeys.list(view, filters),
    queryFn: ({ pageParam }) =>
      api(
        withQuery('/approvals', {
          view,
          type: filters.type || undefined,
          status: history && filters.status ? filters.status : undefined,
          search: filters.search || undefined,
          limit: APPROVAL_PAGE_SIZE,
          cursor: pageParam,
        }),
      ),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });

  const items = listQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const filtersActive = Object.values(filters).some((value) => value !== ALL);

  const openDetail = useCallback(
    (id, mode = 'view') => {
      setDetailMode(mode);
      updateParams({ [FILTER_PARAMS.detail]: id });
    },
    [updateParams],
  );
  const closeDetail = () => {
    setDetailMode('view');
    updateParams({ [FILTER_PARAMS.detail]: null });
  };

  return (
    <div className="flex flex-col gap-5">
      {children}

      <div className="flex flex-wrap items-end gap-3 rounded-card bg-surface p-5 shadow-card">
        <Input
          label="Ara"
          name="q"
          type="search"
          placeholder="Özet, isteyen, kayıt kimliği…"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          className="w-full sm:w-72"
        />
        <Select
          label="Tür"
          name="tur"
          value={filters.type}
          onChange={(event) => updateParams({ [FILTER_PARAMS.type]: event.target.value })}
          options={TYPE_OPTIONS}
          className="w-full sm:w-52"
        />
        {history && (
          <Select
            label="Karar"
            name="durum"
            value={filters.status}
            onChange={(event) => updateParams({ [FILTER_PARAMS.status]: event.target.value })}
            options={STATUS_OPTIONS}
            className="w-full sm:w-44"
          />
        )}
        {filtersActive && (
          <Button
            variant="ghost"
            icon="close"
            onClick={() => {
              setSearchText(ALL);
              updateParams(Object.fromEntries([FILTER_PARAMS.type, FILTER_PARAMS.status, FILTER_PARAMS.search].map((key) => [key, null])));
            }}
          >
            Filtreleri temizle
          </Button>
        )}
        <span className="ml-auto flex items-center gap-2 self-center" aria-live="polite">
          {listQuery.isFetching && !listQuery.isPending && <Spinner label="Yenileniyor…" />}
          <Badge tone={isLive ? 'success' : 'warning'}>{isLive ? 'Canlı' : 'Canlı değil'}</Badge>
        </span>
      </div>

      {listQuery.isPending && (
        <Card>
          <Spinner label="Onaylar yükleniyor…" className="py-10" />
        </Card>
      )}

      {listQuery.isError && (
        <Alert
          tone="danger"
          title="Onaylar yüklenemedi"
          action={
            <Button variant="outline" size="sm" icon="refresh" onClick={() => listQuery.refetch()}>
              Tekrar dene
            </Button>
          }
        >
          {listQuery.error.message}
        </Alert>
      )}

      {listQuery.data && items.length === 0 && (
        <Card>
          <EmptyState
            icon="checkCheck"
            title={
              filtersActive
                ? 'Filtrelere uyan onay yok'
                : history
                  ? 'Henüz karara bağlanmış onay yok'
                  : 'Bekleyen onay yok'
            }
            description={
              filtersActive
                ? 'Filtreleri temizleyip tekrar bakın.'
                : history
                  ? 'Onaylanan, reddedilen ve süresi dolan işler burada listelenir.'
                  : 'Para iadesi, büyük ödeme ya da toplu fiyat değişimi gibi bir iş karar beklediğinde burada görünür; zil de haber verir.'
            }
          />
        </Card>
      )}

      {items.length > 0 && (
        <section aria-label="Onay listesi" aria-busy={listQuery.isFetching} className="flex flex-col gap-2">
          {items.map((item) => (
            <ApprovalRow
              key={item.id}
              item={item}
              now={now}
              timeZone={timeZone}
              canDecide={canDecide && !history}
              onOpen={openDetail}
            />
          ))}
        </section>
      )}

      {listQuery.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            icon="arrowDown"
            disabled={listQuery.isFetchingNextPage}
            onClick={() => listQuery.fetchNextPage()}
          >
            {listQuery.isFetchingNextPage ? 'Yükleniyor…' : history ? 'Daha eski kararlar' : 'Daha fazla'}
          </Button>
        </div>
      )}

      {detailId && (
        <ApprovalDetailDialog
          key={detailId}
          approvalId={detailId}
          canDecide={canDecide}
          timeZone={timeZone}
          initialMode={detailMode}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}
