import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  RESERVATION_COUNT_CAP,
  RESERVATION_SOURCES,
  RESERVATION_SOURCE_LABELS,
  RESERVATION_STATUSES,
  RESERVATION_STATUS_LABELS,
  RESERVATION_VIEWS,
  RESERVATION_VIEW_LABELS,
} from '@hotelos/hotel-contracts';
import { Badge, Button, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { reservationKeys } from '../../lib/reservations.js';
import { RESERVATIONS_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { useRoomTypes } from '../rooms/useRoomTypes.js';
import { RESERVATION_STATUS_TONES, partyLabel, sourceLabel, statusLabel } from './reservationTheme.js';

/** Sayfa başına rezervasyon. */
const PAGE_SIZE = 25;
/** Socket kopukken ekranın kendini tazeleme sıklığı. */
const OFFLINE_REFRESH_MS = 60_000;
const SEARCH_DEBOUNCE_MS = 300;
const ALL = '';

/** Adres çubuğundaki filtreler: yenileyince kaybolmaz, bağlantı paylaşılabilir. */
const PARAMS = Object.freeze({
  view: 'gorunum',
  search: 'q',
  status: 'durum',
  source: 'kaynak',
  roomTypeId: 'tip',
  from: 'baslangic',
  to: 'bitis',
  page: 'sayfa',
});

const STATUS_OPTIONS = [
  { value: ALL, label: 'Tüm durumlar' },
  ...RESERVATION_STATUSES.map((value) => ({ value, label: RESERVATION_STATUS_LABELS[value] })),
];
const SOURCE_OPTIONS = [
  { value: ALL, label: 'Tüm kaynaklar' },
  ...RESERVATION_SOURCES.map((value) => ({ value, label: RESERVATION_SOURCE_LABELS[value] })),
];
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** @param {URLSearchParams} params */
function readFilters(params) {
  const pick = (name, allowed) => {
    const value = params.get(name) ?? ALL;
    return !allowed || allowed.includes(value) ? value : ALL;
  };
  const day = (name) => (DAY_PATTERN.test(params.get(name) ?? '') ? params.get(name) : ALL);
  const page = Number(params.get(PARAMS.page));
  return {
    view: pick(PARAMS.view, RESERVATION_VIEWS) || 'ALL',
    search: pick(PARAMS.search),
    status: pick(PARAMS.status, RESERVATION_STATUSES),
    source: pick(PARAMS.source, RESERVATION_SOURCES),
    roomTypeId: pick(PARAMS.roomTypeId),
    from: day(PARAMS.from),
    to: day(PARAMS.to),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/**
 * Rezervasyon listesi.
 *
 * - Üstteki çipler resepsiyonun günlük görünümleri: bugün gelecek, bugün
 *   gidecek, içeride, gelecek, opsiyonlu, tümü.
 * - Arama: misafir adı, onay kodu, telefon ya da oda numarası.
 * - Filtreler ve sayfa adreste; başka personel değiştirince liste canlı tazelenir.
 * - Çok büyük listelerde sayım üst sınırlıdır ("2000+"); eskiye arama ile ulaşılır.
 */
export function ReservationListTab() {
  const can = useCan();
  const canManage = can(PERMISSIONS.RESERVATIONS_MANAGE);
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readFilters(searchParams);
  const { options: roomTypeOptions } = useRoomTypes();

  const updateParams = useCallback(
    (changes, { resetPage = true, replace = false } = {}) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === undefined || value === ALL) next.delete(key);
            else next.set(key, String(value));
          }
          if (resetPage) next.delete(PARAMS.page);
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
    const timer = setTimeout(() => updateParams({ [PARAMS.search]: searchText.trim() }, { replace: true }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText, filters.search, updateParams]);

  const { isLive } = useLiveChannel(RESERVATIONS_CHANNEL, {
    queryKeys: [reservationKeys.lists],
  });

  const query = useQuery({
    queryKey: reservationKeys.list(filters),
    queryFn: () =>
      api(
        withQuery('/reservations', {
          view: filters.view,
          search: filters.search || undefined,
          status: filters.status || undefined,
          source: filters.source || undefined,
          roomTypeId: filters.roomTypeId || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          page: filters.page,
          pageSize: PAGE_SIZE,
        }),
      ),
    placeholderData: keepPreviousData,
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });

  const filtersActive = [filters.search, filters.status, filters.source, filters.roomTypeId, filters.from, filters.to].some(Boolean);
  const meta = query.data?.meta;

  const columns = [
    {
      key: 'code',
      header: 'Onay kodu',
      render: (row) => (
        <Link to={`/rezervasyonlar/${row.id}`} className="font-mono text-xs font-bold text-info-ink underline-offset-2 hover:underline">
          {row.confirmationCode}
        </Link>
      ),
    },
    {
      key: 'guest',
      header: 'Misafir',
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-semibold">{row.guest?.name ?? '—'}</span>
          {row.group && <span className="text-xs text-ink-muted">Grup: {row.group.name}</span>}
        </span>
      ),
    },
    {
      key: 'stay',
      header: 'Konaklama',
      render: (row) => (
        <span className="whitespace-nowrap">
          {formatDate(row.checkIn)} – {formatDate(row.checkOut)}
          <span className="ml-1 text-xs text-ink-muted">({row.nights} gece)</span>
        </span>
      ),
    },
    {
      key: 'room',
      header: 'Oda',
      render: (row) => (
        <span className="whitespace-nowrap">
          {row.roomType?.code}
          {row.room ? <span className="ml-1 font-semibold">· {row.room.number}</span> : <span className="ml-1 text-xs text-ink-muted">· atanmadı</span>}
        </span>
      ),
    },
    { key: 'party', header: 'Kişi', render: (row) => <span className="whitespace-nowrap text-xs">{partyLabel(row.adults, row.children)} · {row.boardType}</span> },
    {
      key: 'total',
      header: 'Tutar',
      className: 'text-right',
      render: (row) => <span className="whitespace-nowrap font-semibold">{formatMoney(row.totalPrice, row.currency)}</span>,
    },
    {
      key: 'status',
      header: 'Durum',
      render: (row) => <Badge tone={RESERVATION_STATUS_TONES[row.status]}>{statusLabel(row.status)}</Badge>,
    },
    { key: 'source', header: 'Kaynak', render: (row) => <span className="text-xs text-ink-muted">{sourceLabel(row.source)}</span> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Görünüm">
        {RESERVATION_VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            aria-pressed={filters.view === view}
            onClick={() => updateParams({ [PARAMS.view]: view === 'ALL' ? null : view })}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
              filters.view === view ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink'
            }`}
          >
            {RESERVATION_VIEW_LABELS[view]}
          </button>
        ))}
        {canManage && (
          <Link to="/rezervasyonlar/yeni" className="ml-auto">
            <Button icon="plus">Yeni rezervasyon</Button>
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-card bg-surface p-5 shadow-card">
        <Input
          label="Ara"
          name="q"
          type="search"
          placeholder="Misafir, onay kodu, telefon, oda no…"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          className="w-full sm:w-72"
        />
        <Select
          label="Durum"
          name="durum"
          value={filters.status}
          onChange={(event) => updateParams({ [PARAMS.status]: event.target.value })}
          options={STATUS_OPTIONS}
          className="w-full sm:w-40"
        />
        <Select
          label="Oda tipi"
          name="tip"
          value={filters.roomTypeId}
          onChange={(event) => updateParams({ [PARAMS.roomTypeId]: event.target.value })}
          options={[{ value: ALL, label: 'Tüm tipler' }, ...roomTypeOptions]}
          className="w-full sm:w-48"
        />
        <Select
          label="Kaynak"
          name="kaynak"
          value={filters.source}
          onChange={(event) => updateParams({ [PARAMS.source]: event.target.value })}
          options={SOURCE_OPTIONS}
          className="w-full sm:w-44"
        />
        <Input
          label="Konaklama başlangıcı"
          name="baslangic"
          type="date"
          value={filters.from}
          onChange={(event) => updateParams({ [PARAMS.from]: event.target.value })}
          className="w-full sm:w-44"
        />
        <Input
          label="Konaklama bitişi"
          name="bitis"
          type="date"
          value={filters.to}
          min={filters.from || undefined}
          onChange={(event) => updateParams({ [PARAMS.to]: event.target.value })}
          className="w-full sm:w-44"
        />
        {filtersActive && (
          <Button
            variant="ghost"
            icon="close"
            onClick={() => {
              setSearchText(ALL);
              updateParams({
                [PARAMS.search]: null,
                [PARAMS.status]: null,
                [PARAMS.source]: null,
                [PARAMS.roomTypeId]: null,
                [PARAMS.from]: null,
                [PARAMS.to]: null,
              });
            }}
          >
            Filtreleri temizle
          </Button>
        )}
        <span className="ml-auto self-center">
          <Badge tone={isLive ? 'success' : 'warning'}>{isLive ? 'Canlı' : 'Canlı değil'}</Badge>
        </span>
      </div>

      {meta?.totalCapped && (
        <p className="text-xs text-ink-muted">
          {RESERVATION_COUNT_CAP}'den fazla kayıt var; yalnızca ilk {RESERVATION_COUNT_CAP} sayıldı. Eski kayıtlar için arama ya da tarih
          aralığı kullanın.
        </p>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        meta={meta}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        onPageChange={(page) => updateParams({ [PARAMS.page]: page }, { resetPage: false })}
        emptyTitle={filtersActive || filters.view !== 'ALL' ? 'Bu görünüme uyan rezervasyon yok' : 'Henüz rezervasyon yok'}
        emptyHint={
          filtersActive
            ? 'Filtreleri temizleyip tekrar bakın.'
            : canManage
              ? '"Yeni rezervasyon" ile ilk rezervasyonu açın.'
              : undefined
        }
      />
    </div>
  );
}
