import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { DELIVERY_LIST_STATE_LABELS, DELIVERY_LIST_STATES, DELIVERY_SOURCE_LABELS, DELIVERY_STATUS_LABELS, displayPhone } from '@hotelos/hotel-contracts';
import { Badge, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { DELIVERY_SOURCE_TONES, DELIVERY_STATUS_TONES, deliveryOrderPath } from '../../lib/delivery.js';
import { useDeliveryOrders } from '../../lib/deliveryQueries.js';
import { formatMoney } from '../../lib/format.js';
import { useDebounced } from '../../lib/pos.js';
import { dayClockText } from '../../lib/roomService.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { DeliveryTabs } from './DeliveryTabs.jsx';

const PAGE_SIZE = 25;
const OFFLINE_REFRESH_MS = 30_000;
const STATE_OPTIONS = Object.freeze([{ value: '', label: 'Hepsi' }, ...DELIVERY_LIST_STATES.map((value) => ({ value, label: DELIVERY_LIST_STATE_LABELS[value] }))]);

/**
 * Paket servis geçmişi (modül 42): en yeni önce, sayfalı ve canlı; durum grubu ve sipariş günü aralığıyla süzülür;
 * sipariş no parçası, müşteri adı ya da telefonla aranır. Süreler (toplam, zamanında mı) satırda.
 */
export function DeliveryHistoryPage() {
  const { isLive = true } = useOutletContext() ?? {};
  const { timeZone } = useHotelToday();
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [filters, setFilters] = useState({ state: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const rangeError = filters.from && filters.to && filters.to < filters.from ? 'Bitiş başlangıçtan önce olamaz' : null;
  const list = useDeliveryOrders({ ...filters, search, page, pageSize: PAGE_SIZE }, { enabled: !rangeError, refetchInterval: isLive ? false : OFFLINE_REFRESH_MS });
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
        <Link to={deliveryOrderPath(row.id)} className="block">
          <span className="block font-semibold text-ink hover:underline">{row.customerName}</span>
          <span className="block text-xs text-ink-muted">
            <span className="font-mono">{row.number}</span> · {displayPhone(row.phone)}
          </span>
        </Link>
      ),
    },
    { key: 'source', header: 'Kaynak', render: (row) => <Badge tone={DELIVERY_SOURCE_TONES[row.source]} dot={false}>{DELIVERY_SOURCE_LABELS[row.source]}</Badge> },
    {
      key: 'time',
      header: 'Sipariş / teslim',
      className: 'whitespace-nowrap',
      render: (row) => (
        <span className="block text-xs">
          <span className="block">{dayClockText(row.createdAt, timeZone)}</span>
          <span className="block text-ink-muted">{row.deliveredAt ? dayClockText(row.deliveredAt, timeZone) : '—'}</span>
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
    { key: 'courier', header: 'Kurye', render: (row) => <span className="text-xs">{row.courierEmail ?? '—'}</span> },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={DELIVERY_STATUS_TONES[row.status]}>{DELIVERY_STATUS_LABELS[row.status]}</Badge> },
    { key: 'total', header: 'Tutar', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => <span className="text-sm font-bold">{formatMoney(row.total, currency)}</span> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <DeliveryTabs />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Input
          label="Ara"
          name="delivery-history-search"
          value={searchText}
          onChange={(event) => {
            setSearchText(event.target.value);
            setPage(1);
          }}
          placeholder="Sipariş no, müşteri ya da telefon"
        />
        <Select label="Durum" value={filters.state} onChange={set('state')} options={STATE_OPTIONS} />
        <Input label="Sipariş günü (başlangıç)" name="delivery-history-from" type="date" value={filters.from} onChange={set('from')} />
        <Input label="Sipariş günü (bitiş)" name="delivery-history-to" type="date" value={filters.to} onChange={set('to')} error={rangeError ?? undefined} />
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
        emptyTitle={filtered ? 'Süzgece uyan sipariş yok' : 'Henüz paket sipariş yok'}
        emptyHint={filtered ? 'Aramayı ya da süzgeçleri değiştirin.' : 'Panodan yeni paket sipariş girildikçe burada görünür.'}
      />
    </div>
  );
}
