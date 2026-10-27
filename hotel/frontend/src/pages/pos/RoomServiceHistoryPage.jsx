import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ROOM_SERVICE_LIST_STATES, ROOM_SERVICE_LIST_STATE_LABELS, ROOM_SERVICE_SOURCES, ROOM_SERVICE_SOURCE_LABELS, ROOM_SERVICE_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { useDebounced } from '../../lib/pos.js';
import { RS_SOURCE_TONES, RS_STATUS_TONES, dayClockText, orderPath, rsKeys } from '../../lib/roomService.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { RoomServiceTabs } from './RoomServiceTabs.jsx';

const PAGE_SIZE = 25;
const OFFLINE_REFRESH_MS = 30_000;
const STATE_OPTIONS = Object.freeze([{ value: '', label: 'Hepsi' }, ...ROOM_SERVICE_LIST_STATES.map((value) => ({ value, label: ROOM_SERVICE_LIST_STATE_LABELS[value] }))]);
const SOURCE_OPTIONS = Object.freeze([{ value: '', label: 'Bütün kaynaklar' }, ...ROOM_SERVICE_SOURCES.map((value) => ({ value, label: ROOM_SERVICE_SOURCE_LABELS[value] }))]);

/**
 * Oda servisi geçmişi (modül 41): en yeni önce, sayfalı ve canlı; durum grubu, kaynak ve sipariş günü aralığıyla
 * süzülür; sipariş no parçası, oda numarası ya da misafir adıyla aranır. Süreler (toplam, zamanında mı) satırda.
 */
export function RoomServiceHistoryPage() {
  const { isLive = true } = useOutletContext() ?? {};
  const { timeZone } = useHotelToday();
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [filters, setFilters] = useState({ state: '', source: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const rangeError = filters.from && filters.to && filters.to < filters.from ? 'Bitiş başlangıçtan önce olamaz' : null;
  const params = { ...filters, search, page };
  const list = useQuery({
    queryKey: rsKeys.orders(params),
    queryFn: () =>
      api(
        withQuery('/pos/room-service/orders', {
          state: filters.state || undefined,
          source: filters.source || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          search: search || undefined,
          page,
          pageSize: PAGE_SIZE,
        }),
      ),
    enabled: !rangeError,
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
  const currency = list.data?.meta?.currency ?? '';
  const set = (key) => (event) => {
    setFilters((current) => ({ ...current, [key]: event.target.value }));
    setPage(1);
  };
  const filtered = Boolean(search || Object.values(filters).some(Boolean));

  const columns = [
    {
      key: 'order',
      header: 'Sipariş',
      render: (row) => (
        <Link to={orderPath(row.id)} className="block">
          <span className="block font-semibold text-ink hover:underline">Oda {row.roomNumber}</span>
          <span className="block text-xs text-ink-muted">
            <span className="font-mono">{row.number}</span> · {row.guestName}
          </span>
        </Link>
      ),
    },
    { key: 'source', header: 'Kaynak', render: (row) => <Badge tone={RS_SOURCE_TONES[row.source]} dot={false}>{ROOM_SERVICE_SOURCE_LABELS[row.source]}</Badge> },
    {
      key: 'time',
      header: 'Sipariş / teslim',
      className: 'whitespace-nowrap',
      render: (row) => (
        <span className="block text-xs">
          <span className="block">{dayClockText(row.createdAt, timeZone)}</span>
          <span className="block text-ink-muted">{row.deliveredAt ? dayClockText(row.deliveredAt, timeZone) : row.deliverAt ? `planlı ${dayClockText(row.deliverAt, timeZone)}` : '—'}</span>
        </span>
      ),
    },
    {
      key: 'duration',
      header: 'Süre',
      className: 'whitespace-nowrap',
      render: (row) =>
        row.durations.total === null ? (
          <span className="text-xs text-ink-muted">—</span>
        ) : (
          <span className={`text-xs ${row.durations.onTime ? 'text-success-ink' : 'font-semibold text-danger-ink'}`}>
            {row.durations.total} dk · {row.durations.onTime ? 'zamanında' : 'gecikti'}
          </span>
        ),
    },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={RS_STATUS_TONES[row.status]}>{ROOM_SERVICE_STATUS_LABELS[row.status]}</Badge> },
    { key: 'total', header: 'Tutar', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => <span className="text-sm font-bold">{formatMoney(row.itemsTotal, currency)}</span> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <RoomServiceTabs />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Input
          label="Ara"
          name="rs-history-search"
          value={searchText}
          onChange={(event) => {
            setSearchText(event.target.value);
            setPage(1);
          }}
          placeholder="Sipariş no, oda ya da misafir"
        />
        <Select label="Durum" value={filters.state} onChange={set('state')} options={STATE_OPTIONS} />
        <Select label="Kaynak" value={filters.source} onChange={set('source')} options={SOURCE_OPTIONS} />
        <Input label="Sipariş günü (başlangıç)" name="rs-history-from" type="date" value={filters.from} onChange={set('from')} />
        <Input label="Sipariş günü (bitiş)" name="rs-history-to" type="date" value={filters.to} onChange={set('to')} error={rangeError ?? undefined} />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending && !rangeError}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={filtered ? 'Süzgece uyan sipariş yok' : 'Henüz oda servisi siparişi yok'}
        emptyHint={filtered ? 'Aramayı ya da süzgeçleri değiştirin.' : 'Panodan ya da misafir isteğinden sipariş girildikçe burada görünür.'}
      />
    </div>
  );
}
