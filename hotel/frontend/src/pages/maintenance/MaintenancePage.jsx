import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MAINTENANCE_CATEGORIES, MAINTENANCE_STATUSES } from '@hotelos/hotel-contracts';
import { Badge, Button, Select } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { formatDateTime } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { categoryLabel, placeText, priorityLabel, statusLabel, statusTone, ticketPath, useTickets } from '../../lib/maintenance.js';

const PAGE_SIZE = 25;
const VIEW_OPTIONS = [
  { value: 'OPEN', label: 'Açık' },
  { value: 'ALL', label: 'Hepsi' },
];
const CATEGORY_FILTER = [{ value: '', label: 'Bütün kategoriler' }, ...MAINTENANCE_CATEGORIES.map((v) => ({ value: v, label: categoryLabel(v) }))];
const STATUS_FILTER = [{ value: '', label: 'Bütün durumlar' }, ...MAINTENANCE_STATUSES.map((v) => ({ value: v, label: statusLabel(v) }))];

/**
 * Arıza listesi (modül 20): açık / tüm biletler, durum ve kategori süzgeci.
 * Bilet açmak `maintenance.operate` ile.
 */
export function MaintenancePage() {
  const can = useCan();
  const navigate = useNavigate();
  const [view, setView] = useState('OPEN');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);

  const query = useTickets({ view, status: status || undefined, category: category || undefined, page, pageSize: PAGE_SIZE });

  const columns = [
    { key: 'place', header: 'Oda / konum', className: 'font-semibold', render: (row) => placeText(row) },
    { key: 'title', header: 'Arıza', render: (row) => <span className="text-ink">{row.title}</span> },
    { key: 'category', header: 'Kategori', render: (row) => categoryLabel(row.category) },
    { key: 'priority', header: 'Öncelik', render: (row) => priorityLabel(row.priority) },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge> },
    { key: 'createdAt', header: 'Açılış', className: 'text-right', render: (row) => <span className="text-ink-muted">{formatDateTime(row.createdAt)}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teknik servis"
        description="Arıza ve bakım biletleri; gerekirse oda arızaya alınır."
        actions={can(PERMISSIONS.MAINTENANCE_OPERATE) && <Button icon="plus" onClick={() => navigate('/teknik-servis/yeni')}>Yeni arıza</Button>}
      />

      <div className="flex flex-wrap items-end gap-3">
        <ChoiceChips label="Görünüm" options={VIEW_OPTIONS} value={view} onChange={(v) => { setView(v); setPage(1); }} />
        <Select label="Durum" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={STATUS_FILTER} />
        <Select label="Kategori" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} options={CATEGORY_FILTER} />
      </div>

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        meta={query.data?.meta}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        onPageChange={setPage}
        emptyTitle="Arıza bileti yok"
        emptyHint="Yeni arıza kaydı açtıkça burada listelenir."
        rowActions={(row) => (
          <Button variant="outline" size="sm" icon="arrowRight" onClick={() => navigate(ticketPath(row.id))}>
            Aç
          </Button>
        )}
      />
    </div>
  );
}
