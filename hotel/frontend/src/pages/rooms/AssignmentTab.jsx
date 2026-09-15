import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RESERVATION_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Checkbox, Icon, Input, Spinner } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { RoomStatusBadge } from '../../components/RoomStatusBadge.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { useCrudResource } from '../../lib/useCrudResource.js';
import { formatDate } from '../../lib/format.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * Oda atanmayı bekleyen rezervasyonlar.
 *
 * Modül 4'ün rezervasyon detay ekranı geldiğinde aynı API oradan da
 * kullanılacak; bu ekran o zaman da "toplu atama" görünümü olarak işe yarar.
 */
export function AssignmentTab() {
  const queryClient = useQueryClient();
  const [assigning, setAssigning] = useState(null);

  const resource = useCrudResource({
    basePath: '/rooms/assignments/pending',
    queryKey: ['rooms', 'assignments'],
    labels: { singular: 'Atama' },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['rooms'] });

  const autoAssignMutation = useMutation({
    mutationFn: (reservationId) => apiPost(`/rooms/assignments/${reservationId}/auto`, {}),
    onSuccess: (data) => {
      if (data.assigned) {
        toastSuccess(`${data.room.number} numaralı oda atandı`);
      } else {
        toastError(data.reason ?? 'Uygun oda bulunamadı');
      }
      refresh();
    },
    onError: (error) => toastError(error.message),
  });

  const columns = [
    {
      key: 'confirmationCode',
      header: 'Onay kodu',
      render: (row) => <span className="font-mono text-xs font-semibold">{row.confirmationCode}</span>,
    },
    { key: 'guestName', header: 'Misafir', render: (row) => row.guestName ?? <span className="text-ink-muted">—</span> },
    {
      key: 'roomType',
      header: 'Oda tipi',
      render: (row) =>
        row.roomTypeCode ? (
          <span className="whitespace-nowrap">
            <span className="font-bold">{row.roomTypeCode}</span>
            <span className="text-ink-muted"> — {row.roomTypeName}</span>
          </span>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    {
      key: 'dates',
      header: 'Tarihler',
      render: (row) => (
        <span className="whitespace-nowrap">
          {formatDate(row.checkIn)} → {formatDate(row.checkOut)}
        </span>
      ),
    },
    {
      key: 'guests',
      header: 'Kişi',
      render: (row) => `${row.adults}${row.children > 0 ? ` + ${row.children}` : ''}`,
    },
    {
      key: 'status',
      header: 'Durum',
      render: (row) => <Badge>{RESERVATION_STATUS_LABELS[row.status] ?? row.status}</Badge>,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Toolbar>
        <Input
          name="search"
          label="Ara"
          type="search"
          placeholder="Onay kodu veya misafir adı…"
          value={resource.search}
          onChange={(event) => resource.setSearch(event.target.value)}
          className="w-full sm:w-80"
        />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={resource.rows}
        meta={resource.meta}
        isLoading={resource.isLoading}
        isFetching={resource.isFetching}
        error={resource.error}
        onRetry={resource.refetch}
        onPageChange={resource.setPage}
        emptyTitle={resource.search ? 'Eşleşen rezervasyon yok' : 'Oda bekleyen rezervasyon yok'}
        emptyHint={
          resource.search
            ? 'Farklı bir kod veya isim deneyin.'
            : 'Oda atanmamış bekleyen/onaylı rezervasyon bulunmuyor.'
        }
        rowActions={(row) => (
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              icon="sparkles"
              onClick={() => autoAssignMutation.mutate(row.id)}
              disabled={autoAssignMutation.isPending}
            >
              Otomatik ata
            </Button>
            <Button size="sm" icon="key" onClick={() => setAssigning(row)}>
              Oda seç
            </Button>
          </div>
        )}
      />

      {assigning && (
        <AssignRoomModal
          key={assigning.id}
          reservation={assigning}
          onClose={() => setAssigning(null)}
          onAssigned={() => {
            setAssigning(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function AssignRoomModal({ reservation, onClose, onAssigned }) {
  const [includeOtherTypes, setIncludeOtherTypes] = useState(false);

  const candidatesQuery = useQuery({
    queryKey: ['rooms', 'candidates', reservation.id, { includeOtherTypes }],
    queryFn: () =>
      api(withQuery(`/rooms/assignments/${reservation.id}/candidates`, { includeOtherTypes })),
  });

  const assignMutation = useMutation({
    mutationFn: (roomId) => apiPut(`/rooms/assignments/${reservation.id}`, { roomId }),
    onSuccess: (data) => {
      toastSuccess(`${data.roomNumber} numaralı oda atandı`);
      onAssigned();
    },
    onError: (error) => toastError(error.message),
  });

  const candidates = candidatesQuery.data ?? [];

  return (
    <Modal
      open
      size="lg"
      title={`${reservation.confirmationCode} — oda seç`}
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose} disabled={assignMutation.isPending}>
          Kapat
        </Button>
      }
    >
      <div className="mb-5 flex items-start gap-3 rounded-panel border border-line bg-surface-muted p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-item bg-ink text-white">
          <Icon name="user" className="size-5" />
        </span>
        <div className="min-w-0 text-sm">
          <p className="text-ink">
            <span className="font-bold">{reservation.guestName ?? 'Misafir'}</span>
            <span className="text-ink-muted">
              {' '}
              · {reservation.roomTypeCode} — {reservation.roomTypeName}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {formatDate(reservation.checkIn)} → {formatDate(reservation.checkOut)} · {reservation.adults} yetişkin
            {reservation.children > 0 ? ` + ${reservation.children} çocuk` : ''}
          </p>
        </div>
      </div>

      <Checkbox
        label="Diğer oda tiplerini de göster"
        name="includeOtherTypes"
        hint="Üst sınıf odaya yerleştirmek (upgrade) için."
        checked={includeOtherTypes}
        onChange={(event) => setIncludeOtherTypes(event.target.checked)}
        className="mb-5"
      />

      {candidatesQuery.isPending && <Spinner label="Uygun odalar aranıyor…" className="py-8" />}

      {candidatesQuery.isError && (
        <Alert
          tone="danger"
          action={
            <Button variant="outline" size="sm" icon="refresh" onClick={() => candidatesQuery.refetch()}>
              Tekrar dene
            </Button>
          }
        >
          {candidatesQuery.error.message}
        </Alert>
      )}

      {candidatesQuery.data && candidates.length === 0 && (
        <Alert tone="warning" title="Bu tarihlerde uygun boş oda yok">
          {includeOtherTypes
            ? 'Tarihleri değiştirmeyi veya bir bloğu kaldırmayı deneyin.'
            : 'Diğer oda tiplerini göstererek üst sınıf bir odaya yerleştirebilirsiniz.'}
        </Alert>
      )}

      {candidates.length > 0 && (
        <ul className="-mx-1 flex max-h-96 flex-col gap-2 overflow-y-auto px-1 py-1">
          {candidates.map((room) => (
            <li
              key={room.id}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-panel border px-4 py-3 transition-colors duration-200 ${
                room.recommended ? 'border-ink/25 bg-surface-muted' : 'border-line hover:border-line-strong'
              }`}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-lg font-bold tabular-nums text-ink">{room.number}</span>
                <span className="text-xs font-semibold text-ink-muted">
                  {room.floor}. kat · {room.roomTypeCode}
                </span>
                <RoomStatusBadge status={room.status} />
                {room.recommended && (
                  <Badge tone="info" dot={false}>
                    Önerilen
                  </Badge>
                )}
                {room.isUpgrade && (
                  <Badge tone="violet" dot={false}>
                    Upgrade
                  </Badge>
                )}
              </div>
              <Button size="sm" icon="check" onClick={() => assignMutation.mutate(room.id)} disabled={assignMutation.isPending}>
                {assignMutation.isPending ? 'Atanıyor…' : 'Ata'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
