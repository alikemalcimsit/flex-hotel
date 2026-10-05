import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AGENCY_STATUSES, AGENCY_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button, Icon, Input } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { api, withQuery } from '../../lib/api.js';
import { AGENCY_STATUS_TONES, agencyKeys, useAgencyLive } from '../../lib/agencies.js';
import { formatDate, formatPercent } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { AgencyFormDialog } from './AgencyDialogs.jsx';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const OFFLINE_REFRESH_MS = 60_000;

const STATUS_FILTERS = Object.freeze([{ value: '', label: 'Tümü' }, ...AGENCY_STATUSES.map((value) => ({ value, label: AGENCY_STATUS_LABELS[value] }))]);

/**
 * Acente listesi (modül 29): ad / kod / yetkili araması, durum süzgeci, sayfalı
 * ve canlı. Satırda komisyon, vade ve bugün satıştaki kontrat görünür: kontratı
 * olmayan aktif acentenin adına rezervasyon açılamaz, bu yüzden uyarılır.
 * Açma ve düzenleme `agencies.manage` ister.
 */
export function AgenciesPage() {
  const can = useCan();
  const navigate = useNavigate();
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const { isLive } = useAgencyLive();
  const filters = { search, status, page };
  const list = useQuery({
    queryKey: agencyKeys.list(filters),
    queryFn: () => api(withQuery('/agencies', { search: search || undefined, status: status || undefined, page, pageSize: PAGE_SIZE })),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
    placeholderData: (previous) => previous,
  });

  const columns = [
    {
      key: 'name',
      header: 'Acente',
      render: (row) => (
        <Link to={`/acenteler/${row.id}`} className="block min-w-0">
          <span className="block truncate font-semibold text-ink hover:underline">{row.name}</span>
          <span className="block font-mono text-xs text-ink-muted">{row.code}</span>
        </Link>
      ),
    },
    {
      key: 'contact',
      header: 'Yetkili / iletişim',
      render: (row) => (
        <span className="block text-xs text-ink-soft">
          {row.contactName && <span className="block font-semibold text-ink">{row.contactName}</span>}
          {[row.phone, row.email].filter(Boolean).join(' · ') || (row.contactName ? '' : '—')}
        </span>
      ),
    },
    { key: 'commissionPct', header: 'Komisyon', className: 'whitespace-nowrap', render: (row) => formatPercent(row.commissionPct) },
    { key: 'paymentTermDays', header: 'Vade', className: 'whitespace-nowrap', render: (row) => (row.paymentTermDays ? `${row.paymentTermDays} gün` : 'Peşin') },
    {
      key: 'contract',
      header: 'Satıştaki kontrat',
      render: (row) =>
        row.activeContract ? (
          <Link to={`/acenteler/kontrat/${row.activeContract.id}`} className="block text-xs">
            <span className="block font-semibold text-ink hover:underline">{row.activeContract.name}</span>
            <span className="block text-ink-muted">
              {row.activeContract.current ? '' : 'Başlıyor: '}
              {formatDate(row.activeContract.startDate)} – {formatDate(row.activeContract.endDate)}
            </span>
          </Link>
        ) : (
          <span className={`inline-flex items-center gap-1 text-xs font-semibold ${row.status === 'ACTIVE' ? 'text-warning-ink' : 'text-ink-muted'}`}>
            {row.status === 'ACTIVE' && <Icon name="alertTriangle" className="size-3.5" />}
            Kontrat yok
          </span>
        ),
    },
    {
      key: 'status',
      header: 'Durum',
      render: (row) => <Badge tone={AGENCY_STATUS_TONES[row.status]}>{AGENCY_STATUS_LABELS[row.status]}</Badge>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Acenteler"
        description="Acente kartları, kontrat fiyatları ve stop-sale. Acente adına açılan rezervasyon kontratın fiyatını otomatik alır."
        actions={
          can(PERMISSIONS.AGENCIES_MANAGE) && (
            <Button icon="plus" onClick={() => setCreating(true)}>
              Yeni acente
            </Button>
          )
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Durum">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value || 'all'}
              type="button"
              aria-pressed={status === filter.value}
              onClick={() => {
                setStatus(filter.value);
                setPage(1);
              }}
              className={`rounded-full border px-3 py-1 text-sm font-semibold ${status === filter.value ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink'}`}
            >
              {filter.label}
            </button>
          ))}
          <Badge tone={isLive ? 'success' : 'warning'} className="ml-auto">
            {isLive ? 'Canlı' : 'Canlı değil'}
          </Badge>
        </div>
        <Input label="Ara" name="agency-search" placeholder="Acente adı, kod ya da yetkili" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="sm:max-w-md" />
      </div>

      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={search || status ? 'Süzgece uyan acente yok' : 'Henüz acente yok'}
        emptyHint={search || status ? 'Aramayı ya da durum süzgecini değiştirin.' : can(PERMISSIONS.AGENCIES_MANAGE) ? 'İlk acenteyi ekleyin; sonra kontrat fiyatlarını girin.' : undefined}
      />

      {creating && (
        <AgencyFormDialog
          onClose={() => setCreating(false)}
          onSaved={(agency) => {
            setCreating(false);
            navigate(`/acenteler/${agency.id}`);
          }}
        />
      )}
    </div>
  );
}
