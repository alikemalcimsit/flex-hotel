import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LEAD_OPEN_STATUSES, LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button, Card, EmptyState, Input, Spinner } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { salesKeys } from '../../lib/sales.js';
import { LeadFormModal } from './LeadFormModal.jsx';

/** Pano tek sorguda açık fırsatları çeker (sütunlara ekranda bölünür). */
const BOARD_PAGE_SIZE = 200;
const STATUS_TONES = Object.freeze({ NEW: 'info', QUOTED: 'warning', WAITING: 'neutral', WON: 'success', LOST: 'neutral' });

/**
 * Satış panosu (modül 36): açık fırsatlar sütunlarda (Yeni / Teklif verildi /
 * Bekliyor), kazanılan ve kaybedilenler altta sayfalı listede. "Bugün
 * aranacak" zili `?due=1` ile bu sayfaya düşer. Sürükle-bırak bilinçli yok:
 * durum, kartın menüsünden değiştirilir (kayıp sebep ister, kazanma yalnız
 * teklif kabulüyle).
 */
export function SalesBoardPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.SALES_MANAGE);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const dueOnly = params.get('due') === '1';

  const [searchText, setSearchText] = useState('');
  const [closedPage, setClosedPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const summary = useQuery({ queryKey: salesKeys.summary, queryFn: () => api('/sales/summary') });

  const openFilters = { dueOnly, search: searchText.trim() || undefined };
  const openQuery = useQuery({
    queryKey: salesKeys.leadList({ kind: 'open', ...openFilters }),
    queryFn: () =>
      api(
        withQuery('/sales/leads', {
          pageSize: BOARD_PAGE_SIZE,
          dueOnly: dueOnly || undefined,
          search: openFilters.search,
        }),
      ),
    placeholderData: (previous) => previous,
  });

  const closedQuery = useQuery({
    queryKey: salesKeys.leadList({ kind: 'closed', page: closedPage }),
    queryFn: async () => {
      // Kazanılan + kaybedilen tek listede: iki durum sorgusu birleştirilir
      // (liste küçük; pano sütunlarını şişirmemek için ayrı tutulur).
      const [won, lost] = await Promise.all([
        api(withQuery('/sales/leads', { status: 'WON', page: closedPage })),
        api(withQuery('/sales/leads', { status: 'LOST', page: closedPage })),
      ]);
      return { won, lost };
    },
    placeholderData: (previous) => previous,
  });

  const byStatus = useMemo(() => {
    const groups = Object.fromEntries(LEAD_OPEN_STATUSES.map((status) => [status, []]));
    for (const lead of openQuery.data?.items ?? []) {
      if (groups[lead.status]) groups[lead.status].push(lead);
    }
    return groups;
  }, [openQuery.data]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: salesKeys.all });
  };

  const closedColumns = (kind) => [
    {
      key: 'name',
      header: kind === 'won' ? 'Kazanılan' : 'Kaybedilen',
      render: (row) => (
        <Link to={`/satis/${row.id}`} className="block min-w-0">
          <span className="block truncate font-semibold text-ink hover:underline">{row.name}</span>
          {row.company && <span className="block truncate text-xs text-ink-muted">{row.company}</span>}
        </Link>
      ),
    },
    kind === 'won'
      ? {
          key: 'reservation',
          header: 'Rezervasyon',
          render: (row) =>
            row.wonReservationId ? (
              <Link to={`/rezervasyonlar/${row.wonReservationId}`} className="text-sm font-semibold text-ink hover:underline">
                Rezervasyona git
              </Link>
            ) : (
              '—'
            ),
        }
      : { key: 'lostReason', header: 'Sebep', className: 'text-ink-muted', render: (row) => row.lostReason ?? '—' },
    { key: 'updatedAt', header: 'Tarih', className: 'text-ink-muted', render: (row) => formatDate(row.updatedAt) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Satış CRM"
        description="Telefonla gelen her talep kayıtlı: fırsat panosu, arama günlüğü, teklifler ve takip hatırlatmaları."
        actions={
          canManage && (
            <Button icon="plus" onClick={() => setCreating(true)}>
              Yeni fırsat
            </Button>
          )
        }
      />

      {/* Özet şeridi */}
      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(LEAD_STATUS_LABELS).map(([status, label]) => (
          <Badge key={status} tone={STATUS_TONES[status]} dot={false}>
            {label}: {summary.data?.byStatus?.[status] ?? 0}
          </Badge>
        ))}
        <button
          type="button"
          className="ml-auto"
          onClick={() => {
            setParams(dueOnly ? {} : { due: '1' });
          }}
        >
          <Badge tone={(summary.data?.dueToday ?? 0) > 0 ? 'danger' : 'neutral'} dot={false} className={dueOnly ? 'ring-2 ring-accent' : ''}>
            Bugün aranacak: {summary.data?.dueToday ?? 0}
            {dueOnly ? ' · süzgeç açık' : ''}
          </Badge>
        </button>
      </div>

      <Input
        name="search"
        label="Ara"
        type="search"
        placeholder="Ad, firma, telefon ya da e-posta…"
        value={searchText}
        onChange={(event) => setSearchText(event.target.value)}
        className="w-full sm:w-80"
      />

      {/* Pano: açık durum sütunları */}
      {openQuery.isPending ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {LEAD_OPEN_STATUSES.map((status) => (
            <Card key={status} title={`${LEAD_STATUS_LABELS[status]} (${byStatus[status].length})`}>
              <div className="flex flex-col gap-3">
                {byStatus[status].length === 0 && (
                  <EmptyState title="Fırsat yok" description={status === 'NEW' ? 'Telefon çalınca "Yeni fırsat" ile kaydedin.' : undefined} className="py-6" />
                )}
                {byStatus[status].map((lead) => (
                  <LeadCard key={lead.id} lead={lead} onOpen={() => navigate(`/satis/${lead.id}`)} businessDate={summary.data?.businessDate} />
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Sonuçlananlar */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Kazanılan (${summary.data?.byStatus?.WON ?? 0})`}>
          <DataTable
            columns={closedColumns('won')}
            rows={closedQuery.data?.won?.items ?? []}
            meta={closedQuery.data?.won?.meta}
            isLoading={closedQuery.isPending}
            onPageChange={setClosedPage}
            emptyTitle="Henüz kazanılan fırsat yok"
          />
        </Card>
        <Card title={`Kaybedilen (${summary.data?.byStatus?.LOST ?? 0})`}>
          <DataTable
            columns={closedColumns('lost')}
            rows={closedQuery.data?.lost?.items ?? []}
            meta={closedQuery.data?.lost?.meta}
            isLoading={closedQuery.isPending}
            onPageChange={setClosedPage}
            emptyTitle="Kaybedilen fırsat yok"
          />
        </Card>
      </div>

      {creating && (
        <LeadFormModal
          onSaved={(saved) => {
            setCreating(false);
            refresh();
            navigate(`/satis/${saved.id}`);
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

/** Pano kartı: kim, ne istiyor, takip ne zaman. */
function LeadCard({ lead, onOpen, businessDate }) {
  const followDue = lead.followUpAt && businessDate && lead.followUpAt <= businessDate;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-control border border-line bg-surface p-3 text-left transition hover:border-accent hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{lead.name}</p>
          {lead.company && <p className="truncate text-xs text-ink-muted">{lead.company}</p>}
        </div>
        <Badge tone="neutral" dot={false} className="shrink-0 text-[11px]">
          {LEAD_SOURCE_LABELS[lead.source] ?? lead.source}
        </Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        {lead.phone && <span className="font-mono">{lead.phone}</span>}
        {lead.checkIn && (
          <span>
            {formatDate(lead.checkIn)} – {formatDate(lead.checkOut)}
          </span>
        )}
        {lead.quoteCount > 0 && <span>{lead.quoteCount} teklif</span>}
      </div>
      {lead.followUpAt && (
        <div className="mt-2">
          <Badge tone={followDue ? 'danger' : 'info'} dot={false} className="text-[11px]">
            Takip: {formatDate(lead.followUpAt)}
          </Badge>
        </div>
      )}
    </button>
  );
}
