import { useState } from 'react';
import { PERMISSIONS } from '@hotelos/hotel-contracts';
import { Badge, Button } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { formatDate } from '../../lib/format.js';
import { useCan } from '../../lib/permissions.js';
import { RESERVATIONS_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { reservationKeys, useReservationActions, useReservationList } from './useReservations.js';

const PAGE_SIZE = 20;

/** Bekleyen liste (WAITLISTED): yer açılınca "Onayla" ile CONFIRMED'e çevrilir. */
export function ReservationWaitingTab() {
  const [page, setPage] = useState(1);
  const query = useReservationList({ page, pageSize: PAGE_SIZE, status: 'WAITLISTED' });
  const actions = useReservationActions();
  const can = useCan();
  const canManage = can(PERMISSIONS.RESERVATIONS_MANAGE);
  useLiveChannel(RESERVATIONS_CHANNEL, { queryKeys: [reservationKeys.lists] });

  const columns = [
    {
      key: 'confirmationCode',
      header: 'Kod',
      render: (row) => <span className="font-mono text-xs font-bold">{row.confirmationCode}</span>,
    },
    { key: 'guestName', header: 'Misafir', className: 'font-semibold' },
    { key: 'roomType', header: 'Oda tipi', render: (row) => row.roomTypeName ?? row.roomTypeCode ?? '—' },
    { key: 'dates', header: 'Tarihler', render: (row) => `${formatDate(row.checkIn)} → ${formatDate(row.checkOut)}` },
    { key: 'status', header: 'Durum', render: () => <Badge tone="violet">Bekliyor</Badge> },
  ];

  return (
    <DataTable
      columns={columns}
      rows={query.data?.items ?? []}
      meta={query.data?.meta}
      isLoading={query.isPending}
      isFetching={query.isFetching}
      error={query.error}
      onRetry={query.refetch}
      onPageChange={setPage}
      emptyTitle="Bekleyen listede kayıt yok"
      emptyHint="Yer olmayan bir rezervasyon açılırken “Bekleyen listeye ekle” dendiğinde burada görünür."
      rowActions={(row) =>
        canManage && (
          <Button
            variant="outline"
            size="sm"
            icon="check"
            disabled={actions.promote.isPending}
            onClick={() => actions.promote.mutate(row.id)}
          >
            Onayla
          </Button>
        )
      }
    />
  );
}
