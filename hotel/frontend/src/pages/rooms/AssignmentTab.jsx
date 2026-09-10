import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RESERVATION_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Button, Card, Checkbox, Input } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { RoomStatusBadge } from '../../components/RoomStatusBadge.jsx';
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
    { key: 'confirmationCode', header: 'Onay kodu', className: 'font-mono text-xs' },
    { key: 'guestName', header: 'Misafir', render: (row) => row.guestName ?? '—' },
    {
      key: 'roomType',
      header: 'Oda tipi',
      render: (row) => (row.roomTypeCode ? `${row.roomTypeCode} — ${row.roomTypeName}` : '—'),
    },
    {
      key: 'dates',
      header: 'Tarihler',
      render: (row) => (
        <span>
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
      render: (row) => (
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
          {RESERVATION_STATUS_LABELS[row.status] ?? row.status}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          name="search"
          placeholder="Onay kodu veya misafir adı…"
          value={resource.search}
          onChange={(event) => resource.setSearch(event.target.value)}
          className="w-72"
        />
      </div>

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
              variant="secondary"
              onClick={() => autoAssignMutation.mutate(row.id)}
              disabled={autoAssignMutation.isPending}
            >
              Otomatik ata
            </Button>
            <Button onClick={() => setAssigning(row)}>Oda seç</Button>
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
        <Button variant="secondary" onClick={onClose} disabled={assignMutation.isPending}>
          Kapat
        </Button>
      }
    >
      <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
        <div>
          <b>{reservation.guestName ?? 'Misafir'}</b> · {reservation.roomTypeCode} — {reservation.roomTypeName}
        </div>
        <div className="text-xs text-gray-500">
          {formatDate(reservation.checkIn)} → {formatDate(reservation.checkOut)} · {reservation.adults} yetişkin
          {reservation.children > 0 ? ` + ${reservation.children} çocuk` : ''}
        </div>
      </div>

      <Checkbox
        label="Diğer oda tiplerini de göster"
        name="includeOtherTypes"
        hint="Üst sınıf odaya yerleştirmek (upgrade) için."
        checked={includeOtherTypes}
        onChange={(event) => setIncludeOtherTypes(event.target.checked)}
        className="mb-4"
      />

      {candidatesQuery.isPending && <Card>Uygun odalar aranıyor…</Card>}

      {candidatesQuery.isError && (
        <Card>
          <p className="mb-3 text-sm text-red-600">{candidatesQuery.error.message}</p>
          <Button variant="secondary" onClick={() => candidatesQuery.refetch()}>
            Tekrar dene
          </Button>
        </Card>
      )}

      {candidatesQuery.data && candidates.length === 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm font-medium text-amber-900">Bu tarihlerde uygun boş oda yok</p>
          <p className="mt-1 text-xs text-amber-800">
            {includeOtherTypes
              ? 'Tarihleri değiştirmeyi veya bir bloğu kaldırmayı deneyin.'
              : 'Diğer oda tiplerini göstererek üst sınıf bir odaya yerleştirebilirsiniz.'}
          </p>
        </Card>
      )}

      {candidates.length > 0 && (
        <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {candidates.map((room) => (
            <li
              key={room.id}
              className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2"
            >
              <div className="flex items-center gap-3">
                <span className="text-base font-semibold text-gray-900">{room.number}</span>
                <span className="text-xs text-gray-500">
                  {room.floor}. kat · {room.roomTypeCode}
                </span>
                <RoomStatusBadge status={room.status} />
                {room.recommended && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                    Önerilen
                  </span>
                )}
                {room.isUpgrade && (
                  <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-800">Upgrade</span>
                )}
              </div>
              <Button onClick={() => assignMutation.mutate(room.id)} disabled={assignMutation.isPending}>
                {assignMutation.isPending ? 'Atanıyor…' : 'Ata'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
