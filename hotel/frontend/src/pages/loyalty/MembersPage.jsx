import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { LOYALTY_ACCOUNT_STATUSES, LOYALTY_ACCOUNT_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDateTime, formatMoney } from '../../lib/format.js';
import { LOYALTY_PAGE_SIZE, loyaltyKeys, pointsNumber, pointsText, tierTone } from '../../lib/loyalty.js';
import { useDebounced } from '../../lib/pos.js';

const STATUS_OPTIONS = [{ value: '', label: 'Hepsi' }, ...LOYALTY_ACCOUNT_STATUSES.map((value) => ({ value, label: LOYALTY_ACCOUNT_STATUS_LABELS[value] }))];
const SORT_OPTIONS = [
  { value: 'recent', label: 'Son hareket' },
  { value: 'balance', label: 'Bakiye' },
  { value: 'name', label: 'Ad' },
];

/**
 * Sadakat üyeleri (modül 56): özet (üye, dolaşımdaki puan ve karşılığı), arama / seviye / durum / sıralama süzgeçli
 * liste. Numara hesap sayfasına, misafir adı misafir kartına gider.
 */
export function MembersPage() {
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [tier, setTier] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [search, tier, status, sort]);

  const filters = { search: search || undefined, tier: tier || undefined, status: status || undefined, sort, page, pageSize: LOYALTY_PAGE_SIZE };
  const list = useQuery({ queryKey: loyaltyKeys.accounts(filters), queryFn: () => api(withQuery('/loyalty/accounts', filters)), placeholderData: keepPreviousData });
  const settings = useQuery({ queryKey: loyaltyKeys.settings, queryFn: () => api('/loyalty/settings') });
  const currency = settings.data?.currency ?? '';
  const tiers = list.data?.tiers ?? [];
  const summary = list.data?.summary;
  const tierOptions = [{ value: '', label: 'Hepsi' }, ...tiers.map((row) => ({ value: row.code, label: row.name }))];

  const columns = [
    {
      key: 'number',
      header: 'Numara',
      className: 'whitespace-nowrap',
      render: (row) => (
        <Link to={`/sadakat/uyeler/${row.id}`} className="font-mono font-semibold text-ink hover:underline">
          {row.number}
        </Link>
      ),
    },
    {
      key: 'guest',
      header: 'Misafir',
      render: (row) => (
        <span className="block">
          <Link to={`/misafirler/${row.guestId}`} className="font-semibold text-ink hover:underline">
            {row.guestName ?? '—'}
          </Link>
          {row.status !== 'ACTIVE' && <span className="block text-xs text-ink-muted">{LOYALTY_ACCOUNT_STATUS_LABELS[row.status]}</span>}
        </span>
      ),
    },
    { key: 'tier', header: 'Seviye', render: (row) => <Badge tone={tierTone(row.tier.code, tiers)}>{row.tier.name}</Badge> },
    {
      key: 'balance',
      header: 'Bakiye',
      className: 'text-right tabular-nums whitespace-nowrap',
      render: (row) => (
        <span className="block">
          <span className="block font-semibold text-ink">{pointsText(row.balance)}</span>
          <span className="block text-xs text-ink-muted">{formatMoney(row.balanceValue, currency)}</span>
        </span>
      ),
    },
    { key: 'qualifying', header: 'Son 12 ay', className: 'text-right tabular-nums', render: (row) => pointsNumber(row.qualifyingPoints) },
    { key: 'last', header: 'Son hareket', className: 'whitespace-nowrap text-xs text-ink-soft', render: (row) => formatDateTime(row.lastActivityAt) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryTile label="Üye" value={summary ? pointsNumber(summary.members) : undefined} hint="Etkin sadakat hesabı" icon="users" />
        <SummaryTile label="Dolaşımdaki puan" value={summary ? pointsNumber(summary.outstandingPoints) : undefined} hint="Kullanılmamış bakiye" icon="star" />
        <SummaryTile label="Karşılığı" value={summary ? formatMoney(summary.outstandingValue, currency) : undefined} hint="Puan değeriyle olası indirim" icon="coins" />
      </div>
      <Toolbar>
        <Input label="Ara" name="loyalty-search" placeholder="Ad, numara, telefon" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-56" />
        <Select label="Seviye" name="loyalty-tier" options={tierOptions} value={tier} onChange={(event) => setTier(event.target.value)} className="w-full sm:w-40" />
        <Select label="Durum" name="loyalty-status" options={STATUS_OPTIONS} value={status} onChange={(event) => setStatus(event.target.value)} className="w-full sm:w-36" />
        <Select label="Sıralama" name="loyalty-sort" options={SORT_OPTIONS} value={sort} onChange={(event) => setSort(event.target.value)} className="w-full sm:w-40" />
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
        emptyTitle="Üye yok"
        emptyHint="Otomatik üyelik açıksa misafir ilk folyo kapanışında üye olur; misafir kartından da üye yapılabilir."
        rowActions={(row) => (
          <Link to={`/sadakat/uyeler/${row.id}`} className="inline-flex items-center gap-1.5 rounded-item px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.04] hover:text-ink">
            Hesap
          </Link>
        )}
      />
    </div>
  );
}
