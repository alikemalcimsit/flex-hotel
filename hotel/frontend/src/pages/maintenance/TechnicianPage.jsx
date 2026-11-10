import { useNavigate } from 'react-router-dom';
import { Badge, Button } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { formatDateTime } from '../../lib/format.js';
import { toastSuccess } from '../../store/toast.js';
import { categoryLabel, placeText, priorityLabel, statusLabel, statusTone, ticketPath, useTickets } from '../../lib/maintenance.js';
import { RowActions } from './RowActions.jsx';

const PAGE_SIZE = 50;

/** Teknisyen görünümü (modül 20): bana atanan açık biletler, hızlı başla / bitti. */
export function TechnicianPage() {
  const navigate = useNavigate();
  const query = useTickets({ view: 'MINE', page: 1, pageSize: PAGE_SIZE });

  const columns = [
    { key: 'place', header: 'Oda / konum', className: 'font-semibold', render: (row) => placeText(row) },
    { key: 'title', header: 'Arıza', render: (row) => row.title },
    { key: 'category', header: 'Kategori', render: (row) => categoryLabel(row.category) },
    { key: 'priority', header: 'Öncelik', render: (row) => priorityLabel(row.priority) },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge> },
    { key: 'createdAt', header: 'Açılış', className: 'text-right', render: (row) => <span className="text-ink-muted">{formatDateTime(row.createdAt)}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Bana atananlar" description="Üzerindeki açık arıza biletleri." />
      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        meta={query.data?.meta}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        emptyTitle="Üzerinde açık bilet yok"
        emptyHint="Sana atanan arızalar burada görünür."
        rowActions={(row) => (
          <div className="flex gap-2">
            <RowActions ticket={row} onDone={() => toastSuccess('Güncellendi')} />
            <Button variant="ghost" size="sm" icon="arrowRight" onClick={() => navigate(ticketPath(row.id))}>Aç</Button>
          </div>
        )}
      />
    </div>
  );
}
