import { useState } from 'react';
import { Badge } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { formatDate, formatMoney } from '../../lib/format.js';
import { useGuestStays } from '../../lib/crm.js';
import { statusLabel } from '../reservations/reservationTheme.js';

const STATUS_TONES = { CHECKED_OUT: 'success', CHECKED_IN: 'info', CONFIRMED: 'neutral', PENDING: 'warning', CANCELLED: 'neutral', NO_SHOW: 'danger' };
const statusTone = (s) => STATUS_TONES[s] ?? 'neutral';

/** Konaklama geçmişi sekmesi (modül 22). */
export function StaysTab({ guestId }) {
  const [page, setPage] = useState(1);
  const query = useGuestStays(guestId, page);

  const columns = [
    { key: 'code', header: 'Kod', className: 'font-semibold', render: (r) => r.confirmationCode },
    { key: 'checkIn', header: 'Giriş', render: (r) => formatDate(r.checkIn) },
    { key: 'checkOut', header: 'Çıkış', render: (r) => formatDate(r.checkOut) },
    { key: 'status', header: 'Durum', render: (r) => <Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge> },
    { key: 'total', header: 'Tutar', className: 'text-right tabular-nums', render: (r) => formatMoney(r.totalPrice) },
  ];

  return (
    <DataTable
      columns={columns}
      rows={query.data?.items ?? []}
      meta={query.data?.meta}
      isLoading={query.isPending}
      isFetching={query.isFetching}
      error={query.error}
      onRetry={() => query.refetch()}
      onPageChange={setPage}
      emptyTitle="Konaklama yok"
      emptyHint="Misafirin tamamlanmış ya da gelecek konaklaması burada listelenir."
    />
  );
}
