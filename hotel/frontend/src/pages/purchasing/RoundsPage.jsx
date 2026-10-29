import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { PURCHASE_ROUND_STATUSES, PURCHASE_ROUND_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { dayText } from '../../lib/banquet.js';
import { formatDate } from '../../lib/format.js';
import { purchasingKeys } from '../../lib/kitchen.js';
import { useDebounced } from '../../lib/pos.js';
import { ROUND_STATUS_TONES } from '../../lib/purchasingFormat.js';

const PAGE_SIZE = 25;
const STATUS_OPTIONS = [{ value: '', label: 'Hepsi' }, ...PURCHASE_ROUND_STATUSES.map((status) => ({ value: status, label: PURCHASE_ROUND_STATUS_LABELS[status] }))];

/**
 * Teklif turları (modül 45): numara, ihtiyaç, malzeme / teklif sayısı, siparişe dönen satır, durum.
 * Arama: tur numarası ya da malzeme adı. Tur "Açık satırlar"dan açılır.
 */
export function RoundsPage() {
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [search, status]);
  const filters = { search: search || undefined, status: status || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: purchasingKeys.rounds(filters), queryFn: () => api(withQuery('/purchasing/rounds', filters)), placeholderData: keepPreviousData });

  const columns = [
    {
      key: 'number',
      header: 'Tur',
      render: (row) => (
        <Link to={`/satin-alma/teklif-turlari/${row.id}`} className="block hover:underline">
          <span className="block font-mono font-semibold text-ink">{row.number}</span>
          <span className="block text-xs text-ink-muted">{row.createdBy}</span>
        </Link>
      ),
    },
    { key: 'neededBy', header: 'En erken ihtiyaç', render: (row) => dayText(row.neededBy) },
    { key: 'lines', header: 'Malzeme', className: 'text-right tabular-nums', render: (row) => row.lines },
    { key: 'quotes', header: 'Teklif', className: 'text-right tabular-nums', render: (row) => row.quotes },
    {
      key: 'progress',
      header: 'Siparişe dönen',
      render: (row) => (
        <span className="tabular-nums">
          {row.orderedLines} / {row.lines}
          {row.releasedLines > 0 && <span className="text-xs text-ink-muted"> · {row.releasedLines} bırakıldı</span>}
        </span>
      ),
    },
    { key: 'created', header: 'Açıldı', render: (row) => formatDate(row.createdAt) },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={ROUND_STATUS_TONES[row.status]}>{PURCHASE_ROUND_STATUS_LABELS[row.status]}</Badge> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Toolbar>
        <Input label="Ara" name="round-search" placeholder="Tur no ya da malzeme" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-60" />
        <Select label="Durum" name="round-status" options={STATUS_OPTIONS} value={status} onChange={(event) => setStatus(event.target.value)} className="w-full sm:w-48" />
      </Toolbar>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={search || status ? 'Eşleşen tur yok' : 'Teklif turu yok'}
        emptyHint={search || status ? undefined : 'Açık satırlar sekmesinde malzemeleri seçip teklif turu açın.'}
      />
    </div>
  );
}
