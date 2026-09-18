import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RESERVATION_STATUSES, RESERVATION_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { formatDate } from '../../lib/format.js';
import { formatMoney } from '../../lib/format.js';
import { RESERVATIONS_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { ReservationDetailDialog } from './ReservationDetailDialog.jsx';
import { statusTone } from './reservationStatus.js';
import { reservationKeys, useReservationList } from './useReservations.js';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const STATUS_OPTIONS = [
  { value: '', label: 'Tüm durumlar' },
  ...RESERVATION_STATUSES.filter((s) => s !== 'WAITLISTED').map((value) => ({
    value,
    label: RESERVATION_STATUS_LABELS[value],
  })),
];

/** Rezervasyon listesi — filtre + canlı yayın + tıklayınca detay. */
export function ReservationListTab() {
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState({ page: 1, pageSize: PAGE_SIZE, search: '', status: '', from: '', to: '' });
  const [params, setParams] = useSearchParams();
  const detailId = params.get('rez');

  // Arama debounce.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) => ({ ...current, search: searchInput.trim(), page: 1 }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const query = useReservationList(filters);
  const { isLive } = useLiveChannel(RESERVATIONS_CHANNEL, { queryKeys: [reservationKeys.lists] });

  const openDetail = (id) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    next.set('rez', id);
    return next;
  });
  const closeDetail = () => setParams((prev) => {
    const next = new URLSearchParams(prev);
    next.delete('rez');
    return next;
  });

  const updateFilter = (key) => (event) => setFilters((current) => ({ ...current, [key]: event.target.value, page: 1 }));

  const columns = [
    {
      key: 'confirmationCode',
      header: 'Kod',
      render: (row) => <span className="font-mono text-xs font-bold">{row.confirmationCode}</span>,
    },
    { key: 'guestName', header: 'Misafir', className: 'font-semibold' },
    { key: 'roomType', header: 'Oda tipi', render: (row) => row.roomTypeName ?? row.roomTypeCode ?? '—' },
    {
      key: 'dates',
      header: 'Tarihler',
      render: (row) => `${formatDate(row.checkIn)} → ${formatDate(row.checkOut)}`,
    },
    { key: 'room', header: 'Oda', render: (row) => row.roomNumber ?? <span className="text-ink-muted">atanmadı</span> },
    {
      key: 'status',
      header: 'Durum',
      render: (row) => <Badge tone={statusTone(row.status)}>{RESERVATION_STATUS_LABELS[row.status] ?? row.status}</Badge>,
    },
    {
      key: 'totalPrice',
      header: 'Tutar',
      className: 'tabular-nums',
      render: (row) => formatMoney(row.totalPrice, row.currency),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Toolbar
        actions={
          <Badge tone={isLive ? 'success' : 'warning'}>{isLive ? 'Canlı' : 'Canlı değil'}</Badge>
        }
      >
        <Input
          name="search"
          label="Ara"
          type="search"
          placeholder="Kod, misafir adı, telefon…"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          className="w-full sm:w-72"
        />
        <Select label="Durum" name="status" value={filters.status} onChange={updateFilter('status')} options={STATUS_OPTIONS} />
        <Input label="Giriş (min)" name="from" type="date" value={filters.from} onChange={updateFilter('from')} />
        <Input label="Çıkış (max)" name="to" type="date" value={filters.to} onChange={updateFilter('to')} />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        meta={query.data?.meta}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={query.refetch}
        onPageChange={(page) => setFilters((current) => ({ ...current, page }))}
        emptyTitle={filters.search ? 'Aramayla eşleşen rezervasyon yok' : 'Henüz rezervasyon yok'}
        emptyHint="Sağ üstteki “Yeni rezervasyon” ile ekleyebilirsiniz."
        rowActions={(row) => (
          <Button variant="outline" size="sm" icon="eye" onClick={() => openDetail(row.id)}>
            Detay
          </Button>
        )}
      />

      {detailId && <ReservationDetailDialog id={detailId} onClose={closeDetail} />}
    </div>
  );
}
