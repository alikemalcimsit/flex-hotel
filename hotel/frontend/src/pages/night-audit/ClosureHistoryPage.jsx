import { useState } from 'react';
import { Button } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { formatDateTime, formatMoney } from '../../lib/format.js';
import { openShiftReportPdf, useClosures } from '../../lib/nightAudit.js';

const PAGE_SIZE = 25;

/** Kapanış geçmişi (modül 18): kapanmış günler, doluluk, gelir, kasa farkı; devir raporu PDF. */
export function ClosureHistoryPage() {
  const [page, setPage] = useState(1);
  const query = useClosures({ page, pageSize: PAGE_SIZE });

  const columns = [
    { key: 'day', header: 'Gün', render: (row) => <span className="font-semibold text-ink">{row.day}</span> },
    { key: 'closedAt', header: 'Kapanış', render: (row) => <span className="text-ink-muted">{row.closedAt ? formatDateTime(row.closedAt) : '—'}</span> },
    { key: 'closedBy', header: 'Kapatan', render: (row) => row.closedBy ?? '—' },
    { key: 'occupancy', header: 'Doluluk', className: 'text-right', render: (row) => (row.stats ? `%${row.stats.occupancyPct}` : '—') },
    { key: 'revenue', header: 'Oda geliri', className: 'text-right', render: (row) => (row.stats ? formatMoney(row.stats.roomRevenue, row.stats.currency) : '—') },
    { key: 'collections', header: 'Tahsilat', className: 'text-right', render: (row) => (row.stats ? formatMoney(row.stats.collections, row.stats.currency) : '—') },
    {
      key: 'variance',
      header: 'Kasa farkı',
      className: 'text-right',
      render: (row) => {
        const v = row.shift?.variance;
        if (v === undefined || v === null) return '—';
        const tone = Number(v) < 0 ? 'text-sec-strong' : Number(v) > 0 ? 'text-ink' : 'text-ink-muted';
        return <span className={`font-semibold tabular-nums ${tone}`}>{formatMoney(v, row.stats?.currency ?? '')}</span>;
      },
    },
    { key: 'noShows', header: 'Gelmeyen', className: 'text-right', render: (row) => row.noShowCount },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Kapanış geçmişi" description="Kapatılmış günler ve günlük özetleri." />

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        meta={query.data?.meta}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        onPageChange={setPage}
        emptyTitle="Henüz kapatılmış gün yok"
        emptyHint="Günü kapattıkça burada listelenir."
        rowActions={(row) => (
          <Button variant="outline" size="sm" icon="fileText" onClick={() => openShiftReportPdf(row.day)}>
            Devir raporu
          </Button>
        )}
      />
    </div>
  );
}
