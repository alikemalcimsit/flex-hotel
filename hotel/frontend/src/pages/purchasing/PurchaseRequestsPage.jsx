import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { PURCHASE_REQUEST_SOURCES, PURCHASE_REQUEST_SOURCE_LABELS, PURCHASE_REQUEST_STATUSES, PURCHASE_REQUEST_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { dayText } from '../../lib/banquet.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { purchasingKeys } from '../../lib/kitchen.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { REQUEST_STATUS_TONES } from '../../lib/purchasingFormat.js';
import { useHotelContext } from '../../lib/useHotel.js';
import { NewRequestDialog } from './NewRequestDialog.jsx';

const PAGE_SIZE = 25;
const STATUS_OPTIONS = [{ value: '', label: 'Hepsi' }, ...PURCHASE_REQUEST_STATUSES.map((status) => ({ value: status, label: PURCHASE_REQUEST_STATUS_LABELS[status] }))];
const SOURCE_OPTIONS = [{ value: '', label: 'Bütün kaynaklar' }, ...PURCHASE_REQUEST_SOURCES.map((source) => ({ value: source, label: PURCHASE_REQUEST_SOURCE_LABELS[source] }))];

/**
 * Satın alma talepleri (modül 43 / 45): numara, kaynak (banket ihtiyacı, elle, minimum stok),
 * ihtiyaç günü, malzeme / etkinlik sayısı, tahmini tutar, durum (açık → teklif / siparişte →
 * siparişe döndü). Arama: numara ya da malzeme adı. Elle talep `purchasing.request`.
 */
export function PurchaseRequestsPage() {
  const { data: hotel } = useHotelContext();
  const can = useCan();
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  useEffect(() => setPage(1), [search, status, source, from, to]);

  const invalidRange = from && to && to < from;
  const filters = { search: search || undefined, status: status || undefined, source: source || undefined, from: from || undefined, to: to || undefined, page, pageSize: PAGE_SIZE };
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
    { key: 'scope', header: 'Kapsam', render: (row) => (row.events ? `${row.items} malzeme · ${row.events} etkinlik` : `${row.items} malzeme`) },
    { key: 'total', header: 'Tahmini tutar', className: 'text-right tabular-nums', render: (row) => formatMoney(row.estimatedTotal, hotel?.currency) },
    { key: 'created', header: 'Açıldı', render: (row) => formatDate(row.createdAt) },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={REQUEST_STATUS_TONES[row.status]}>{PURCHASE_REQUEST_STATUS_LABELS[row.status]}</Badge> },
  ];
  const filtered = search || status || source || from || to;

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        actions={
          can(PERMISSIONS.PURCHASING_REQUEST) && (
            <Button type="button" icon="plus" onClick={() => setCreating(true)}>
              Yeni talep
            </Button>
          )
        }
      >
        <Input label="Ara" name="request-search" placeholder="Talep no ya da malzeme" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-56" />
        <Select label="Durum" name="request-status" options={STATUS_OPTIONS} value={status} onChange={(event) => setStatus(event.target.value)} className="w-full sm:w-44" />
        <Select label="Kaynak" name="request-source" options={SOURCE_OPTIONS} value={source} onChange={(event) => setSource(event.target.value)} className="w-full sm:w-44" />
        <Input label="İhtiyaç (ilk)" name="request-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} error={invalidRange ? 'Bitiş başlangıçtan önce' : undefined} className="w-full sm:w-40" />
        <Input label="İhtiyaç (son)" name="request-to" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="w-full sm:w-40" />
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
        emptyTitle={filtered ? 'Eşleşen talep yok' : 'Talep yok'}
        emptyHint={filtered ? undefined : 'Talepler banket ihtiyacından (Etkinlikler → Malzeme ihtiyacı), minimum stok önerilerinden ya da "Yeni talep" ile açılır.'}
      />
      {creating && <NewRequestDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
