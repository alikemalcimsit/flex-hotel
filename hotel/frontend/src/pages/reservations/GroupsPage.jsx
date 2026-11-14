import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Input } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { reservationKeys } from '../../lib/reservations.js';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Grup dosyaları listesi (modül 30): tur / kongre gruplarının kodu, oda sayısı
 * ve durumu. Satır grup dosyasına gider (toplu oda atama / giriş / çıkış orada).
 */
export function GroupsPage() {
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
      header: 'Grup',
      render: (row) => (
        <Link to={`/gruplar/${row.id}`} className="block min-w-0">
          <span className="block truncate font-semibold text-ink hover:underline">{row.name}</span>
          <span className="block font-mono text-xs text-ink-muted">{row.code}</span>
        </Link>
      ),
    },
    { key: 'rooms', header: 'Oda', className: 'tabular-nums' },
    {
      key: 'state',
      header: 'Durum',
      render: (row) => (
        <span className="flex flex-wrap gap-1.5">
          {row.open > 0 && <Badge tone="info" dot={false}>{row.open} açık</Badge>}
          {row.inHouse > 0 && <Badge tone="success" dot={false}>{row.inHouse} içeride</Badge>}
          {row.open === 0 && row.inHouse === 0 && <Badge tone="neutral" dot={false}>Kapandı</Badge>}
        </span>
      ),
    },
    {
      key: 'stay',
      header: 'Giriş – çıkış',
      render: (row) => (row.checkIn ? `${formatDate(row.checkIn)} – ${formatDate(row.checkOut)}` : '—'),
    },
    { key: 'createdAt', header: 'Açılış', className: 'text-ink-muted', render: (row) => formatDateTime(row.createdAt) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Gruplar"
        description="Grup rezervasyonlarının dosyaları: rooming list, toplu oda atama, toplu giriş ve çıkış."
        actions={<Button icon="plus" onClick={() => navigate('/rezervasyonlar/yeni')}>Yeni grup</Button>}
      />
      <Input
        name="search"
        label="Ara"
        type="search"
        placeholder="Grup adı ya da koduna göre ara…"
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
        emptyTitle={search ? 'Aramanızla eşleşen grup yok' : 'Henüz grup rezervasyonu yok'}
        emptyHint={search ? undefined : 'Yeni rezervasyon ekranında "Grup" türünü seçerek ya da rooming list yükleyerek grup açın.'}
      />
    </div>
  );
}
