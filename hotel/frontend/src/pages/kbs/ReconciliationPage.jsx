import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KBS_STATE_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { api, apiPost } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { kbsKeys, kbsStateTone } from '../../lib/kbs.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const COLUMNS = [
  { key: 'room', header: 'Oda', className: 'whitespace-nowrap tabular-nums font-semibold', render: (row) => row.roomNumber ?? '—' },
  {
    key: 'guest',
    header: 'Misafir',
    render: (row) => (
      <Link to={`/misafirler/${row.guestId}`} className="font-semibold text-ink hover:underline">
        {row.guestName}
      </Link>
    ),
  },
  {
    key: 'reservation',
    header: 'Rezervasyon',
    className: 'whitespace-nowrap',
    render: (row) => (
      <span className="block">
        <Link to={`/rezervasyonlar/${row.reservationId}`} className="font-mono text-xs font-semibold text-ink hover:underline">
          {row.confirmationCode}
        </Link>
        {row.checkedInAt && <span className="block text-xs text-ink-muted">Giriş {formatDateTime(row.checkedInAt)}</span>}
      </span>
    ),
  },
  {
    key: 'state',
    header: 'Durum',
    render: (row) => (row.state ? <Badge tone={kbsStateTone(row.state)}>{KBS_STATE_LABELS[row.state] ?? row.state}</Badge> : <Badge tone="neutral">Bildirim yok</Badge>),
  },
  { key: 'reason', header: 'Neden', className: 'max-w-sm text-xs text-ink-soft', render: (row) => row.reason },
];

/**
 * KBS mutabakatı (modül 58): içerideki kişi sayısı ↔ girişi bildirilmiş (ya da elle bildirilmiş) olan; eksiklerin listesi
 * (oda, misafir, rezervasyon, durum, neden) ve bildirime git.
 */
export function ReconciliationPage() {
  const query = useQuery({ queryKey: kbsKeys.summary, queryFn: () => api('/kbs/summary') });
  const can = useCan();
  const canSend = can(PERMISSIONS.KBS_SEND);
  const queryClient = useQueryClient();
  // Bildirimi hiç açılmamış kişi (aktör kapalıydı, KBS konaklama ortasında açıldı): konaklamanın eksik girişlerini sıraya alır.
  const enqueue = useMutation({
    mutationFn: (reservationId) => apiPost(`/kbs/reservations/${reservationId}/enqueue`, {}),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: kbsKeys.all });
      toastSuccess(result.created ? 'Giriş bildirimi sıraya alındı' : result.message || 'Açılacak bildirim yok');
    },
    onError: (error) => toastError(error.message),
  });
  const inHouse = query.data?.inHouse;
  const missingCount = inHouse ? inHouse.persons - inHouse.reported : undefined;
  // Tablo satırı anahtarı: bir kişi bir konaklamada bir kez görünür.
  const rows = inHouse?.missing.map((row) => ({ ...row, id: `${row.reservationId}:${row.guestId}` }));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryTile label="İçerideki kişi" value={inHouse?.persons} hint={inHouse?.withoutDocument ? `Belgeli kişiler; ${inHouse.withoutDocument} belgesiz çocuk bildirilmez` : 'Konaklayan rezervasyonların belgeli kişileri'} icon="users" />
        <SummaryTile label="Bildirilmiş" value={inHouse?.reported} hint="Girişi gönderilen ya da elle bildirilen" icon="checkCircle" />
        <SummaryTile label="Eksik" value={missingCount} hint="Bildirilmemiş kişi" icon="alertTriangle" tone={missingCount ? 'warning' : 'neutral'} />
      </div>
      <DataTable
        columns={COLUMNS}
        rows={rows}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.isError ? query.error : null}
        onRetry={() => query.refetch()}
        emptyTitle="Eksik yok"
        emptyHint="İçerideki herkesin girişi bildirilmiş."
        rowActions={(row) =>
          row.notificationId ? (
            <Link to={`/kbs/bildirimler/${row.notificationId}`} className="inline-flex items-center gap-1.5 rounded-item px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.04] hover:text-ink">
              Bildirime git
            </Link>
          ) : canSend && query.data?.isEnabled ? (
            <Button type="button" variant="outline" icon="send" onClick={() => enqueue.mutate(row.reservationId)} disabled={enqueue.isPending}>
              Bildirim aç
            </Button>
          ) : null
        }
      />
    </div>
  );
}
