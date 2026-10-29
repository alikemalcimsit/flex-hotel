import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { PURCHASE_ORDER_STATUSES, PURCHASE_ORDER_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { dayText } from '../../lib/banquet.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { purchasingKeys } from '../../lib/kitchen.js';
import { useDebounced } from '../../lib/pos.js';
import { ORDER_STATUS_TONES } from '../../lib/purchasingFormat.js';

const PAGE_SIZE = 25;
/** "Teslim bekleyen" sanal filtresi: onaylı + kısmen teslim. */
const OPEN_FILTER = 'OPEN';
const STATUS_OPTIONS = [
  { value: '', label: 'Hepsi' },
  { value: OPEN_FILTER, label: 'Teslim bekleyen' },
  ...PURCHASE_ORDER_STATUSES.map((status) => ({ value: status, label: PURCHASE_ORDER_STATUS_LABELS[status] })),
];

/**
 * Satın alma siparişleri (modül 45): numara, tedarikçi, tur, beklenen teslim (gecikme uyarısı),
 * tutar ve teslim alınan, durum. Arama: sipariş no, tedarikçi ya da malzeme.
 */
export function OrdersPage() {
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [status, setStatus] = useState(OPEN_FILTER);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [search, status, from, to]);

  const invalidRange = from && to && to < from;
  const filters = {
    search: search || undefined,
    status: status && status !== OPEN_FILTER ? status : undefined,
    open: status === OPEN_FILTER ? 'true' : undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const list = useQuery({ queryKey: purchasingKeys.orders(filters), queryFn: () => api(withQuery('/purchasing/orders', filters)), placeholderData: keepPreviousData, enabled: !invalidRange });

  const columns = [
    {
      key: 'number',
      header: 'Sipariş',
      render: (row) => (
        <Link to={`/satin-alma/siparisler/${row.id}`} className="block hover:underline">
          <span className="block font-mono font-semibold text-ink">{row.number}</span>
          <span className="block text-xs text-ink-muted">{row.round ? `Tur ${row.round.number}` : '—'}</span>
        </Link>
      ),
    },
    { key: 'supplier', header: 'Tedarikçi', render: (row) => <span className="font-semibold text-ink">{row.supplierName}</span> },
    {
      key: 'expected',
      header: 'Beklenen teslim',
      render: (row) => (
        <span className="flex items-center gap-1.5">
          {dayText(row.expectedOn)}
          {row.late && <Badge tone="danger">gecikti</Badge>}
        </span>
      ),
    },
    { key: 'lines', header: 'Kalem', className: 'text-right tabular-nums', render: (row) => row.lines },
    { key: 'total', header: 'Tutar (KDV dahil)', className: 'text-right tabular-nums', render: (row) => formatMoney(row.grandTotal, row.currency) },
    { key: 'received', header: 'Teslim alınan', className: 'text-right tabular-nums', render: (row) => (Number(row.receivedTotal) > 0 ? formatMoney(row.receivedTotal, row.currency) : '—') },
    { key: 'created', header: 'Açıldı', render: (row) => formatDate(row.createdAt) },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={ORDER_STATUS_TONES[row.status]}>{PURCHASE_ORDER_STATUS_LABELS[row.status]}</Badge> },
  ];
  const filtered = search || (status && status !== OPEN_FILTER) || from || to;

  return (
    <div className="flex flex-col gap-4">
      <Toolbar>
        <Input label="Ara" name="order-search" placeholder="Sipariş no, tedarikçi ya da malzeme" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-64" />
        <Select label="Durum" name="order-status" options={STATUS_OPTIONS} value={status} onChange={(event) => setStatus(event.target.value)} className="w-full sm:w-48" />
        <Input label="Teslim (ilk)" name="order-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} error={invalidRange ? 'Bitiş başlangıçtan önce' : undefined} className="w-full sm:w-40" />
        <Input label="Teslim (son)" name="order-to" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="w-full sm:w-40" />
      </Toolbar>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending && !invalidRange}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={filtered ? 'Eşleşen sipariş yok' : status === OPEN_FILTER ? 'Teslim bekleyen sipariş yok' : 'Sipariş yok'}
        emptyHint={filtered ? undefined : 'Siparişler teklif turunda kazanan seçilince tedarikçi başına açılır.'}
      />
    </div>
  );
}
