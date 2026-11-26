import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Input } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { useT } from '../../i18n/index.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { reservationKeys } from '../../lib/reservations.js';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Grup dosyaları listesi (modül 30): tur / kongre gruplarının kodu, oda sayısı
 * ve durumu. Satır grup dosyasına gider (toplu oda atama / giriş / çıkış orada).
 */
export function GroupsPage() {
  const t = useT();
  const navigate = useNavigate();
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const query = useQuery({
    queryKey: reservationKeys.groupList({ search, page }),
    queryFn: () => api(withQuery('/reservations/groups', { search: search || undefined, page })),
    placeholderData: (previous) => previous,
  });

  const columns = [
    {
      key: 'name',
      header: t('reservations.groups.colGroup'),
      render: (row) => (
        <Link to={`/gruplar/${row.id}`} className="block min-w-0">
          <span className="block truncate font-semibold text-ink hover:underline">{row.name}</span>
          <span className="block font-mono text-xs text-ink-muted">{row.code}</span>
        </Link>
      ),
    },
    { key: 'rooms', header: t('reservations.groups.colRooms'), className: 'tabular-nums' },
    {
      key: 'state',
      header: t('reservations.groups.colState'),
      render: (row) => (
        <span className="flex flex-wrap gap-1.5">
          {row.open > 0 && <Badge tone="info" dot={false}>{t('reservations.groups.open', { count: row.open })}</Badge>}
          {row.inHouse > 0 && <Badge tone="success" dot={false}>{t('reservations.groups.inHouse', { count: row.inHouse })}</Badge>}
          {row.open === 0 && row.inHouse === 0 && <Badge tone="neutral" dot={false}>{t('reservations.groups.closed')}</Badge>}
        </span>
      ),
    },
    {
      key: 'stay',
      header: t('reservations.groups.colStay'),
      render: (row) => (row.checkIn ? `${formatDate(row.checkIn)} – ${formatDate(row.checkOut)}` : '—'),
    },
    { key: 'createdAt', header: t('reservations.groups.colCreatedAt'), className: 'text-ink-muted', render: (row) => formatDateTime(row.createdAt) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('reservations.groups.title')}
        description={t('reservations.groups.description')}
        actions={<Button icon="plus" onClick={() => navigate('/rezervasyonlar/yeni')}>{t('reservations.groups.newGroup')}</Button>}
      />
      <Input
        name="search"
        label={t('reservations.groups.searchLabel')}
        type="search"
        placeholder={t('reservations.groups.searchPlaceholder')}
        value={searchText}
        onChange={(event) => setSearchText(event.target.value)}
        className="w-full sm:w-80"
      />
      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        meta={query.data?.meta}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={query.refetch}
        onPageChange={setPage}
        emptyTitle={search ? t('reservations.groups.noMatch') : t('reservations.groups.empty')}
        emptyHint={search ? undefined : t('reservations.groups.emptyHint')}
      />
    </div>
  );
}
