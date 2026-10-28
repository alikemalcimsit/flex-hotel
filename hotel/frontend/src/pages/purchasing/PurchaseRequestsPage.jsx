import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { PURCHASE_REQUEST_SOURCE_LABELS, PURCHASE_REQUEST_STATUSES, PURCHASE_REQUEST_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { dayText } from '../../lib/banquet.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { purchasingKeys, usePurchasingLive } from '../../lib/kitchen.js';
import { useDebounced } from '../../lib/pos.js';
import { useHotelContext } from '../../lib/useHotel.js';

const PAGE_SIZE = 25;
const STATUS_OPTIONS = [{ value: '', label: 'Hepsi' }, ...PURCHASE_REQUEST_STATUSES.map((status) => ({ value: status, label: PURCHASE_REQUEST_STATUS_LABELS[status] }))];
export const REQUEST_STATUS_TONES = Object.freeze({ OPEN: 'info', CANCELLED: 'neutral' });

/**
 * Satın alma talepleri (modül 45'in talep kısmı — 43'te kuruldu): numara, kaynak, ihtiyaç günü,
 * malzeme / etkinlik sayısı, tahmini tutar, durum. Arama: numara ya da malzeme adı. Talepler
 * banket ihtiyacından açılır; teklif, onay ve sipariş satın alma modülünde.
 */
export function PurchaseRequestsPage() {
  const { data: hotel } = useHotelContext();
  usePurchasingLive();
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [status, setStatus] = useState('OPEN');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [search, status, from, to]);

  const invalidRange = from && to && to < from;
  const filters = { search: search || undefined, status: status || undefined, from: from || undefined, to: to || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: purchasingKeys.list(filters), queryFn: () => api(withQuery('/purchasing/requests', filters)), placeholderData: keepPreviousData, enabled: !invalidRange });

  const columns = [
    {
      key: 'number',
      header: 'Talep',
      render: (row) => (
        <Link to={`/satin-alma/talepler/${row.id}`} className="block hover:underline">
          <span className="block font-mono font-semibold text-ink">{row.number}</span>
          <span className="block text-xs text-ink-muted">
            {PURCHASE_REQUEST_SOURCE_LABELS[row.source]} · {row.requestedBy}
          </span>
        </Link>
      ),
    },
    { key: 'neededBy', header: 'İhtiyaç', render: (row) => dayText(row.neededBy) },
    { key: 'scope', header: 'Kapsam', render: (row) => `${row.items} malzeme · ${row.events} etkinlik` },
    { key: 'total', header: 'Tahmini tutar', className: 'text-right tabular-nums', render: (row) => formatMoney(row.estimatedTotal, hotel?.currency) },
    { key: 'created', header: 'Açıldı', render: (row) => formatDate(row.createdAt) },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={REQUEST_STATUS_TONES[row.status]}>{PURCHASE_REQUEST_STATUS_LABELS[row.status]}</Badge> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Satın alma talepleri" description="Banket malzeme ihtiyacından açılan talepler. Tedarikçi teklifi, onay, sipariş ve mal kabul satın alma modülüyle gelir." />
      <Toolbar>
        <Input label="Ara" name="request-search" placeholder="Talep no ya da malzeme" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-60" />
        <Select label="Durum" name="request-status" options={STATUS_OPTIONS} value={status} onChange={(event) => setStatus(event.target.value)} className="w-full sm:w-36" />
        <Input label="İhtiyaç (ilk)" name="request-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} error={invalidRange ? 'Bitiş başlangıçtan önce' : undefined} className="w-full sm:w-44" />
        <Input label="İhtiyaç (son)" name="request-to" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="w-full sm:w-44" />
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
        emptyTitle={search || status || from || to ? 'Eşleşen talep yok' : 'Talep yok'}
        emptyHint="Talepler Etkinlikler → Malzeme ihtiyacı ya da etkinliğin Menü sekmesinden açılır."
      />
    </div>
  );
}
