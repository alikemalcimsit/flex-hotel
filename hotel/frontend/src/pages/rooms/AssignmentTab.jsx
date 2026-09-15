import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RESERVATION_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Checkbox, Icon, Input, Spinner } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { AssignmentKindBadge, HousekeepingBadge, OccupancyBadge } from '../../components/RoomStateBadges.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useCrudResource } from '../../lib/useCrudResource.js';
import { formatDate } from '../../lib/format.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/** Oda seçme penceresinde bir sayfadaki aday oda. */
const CANDIDATE_PAGE_SIZE = 8;

/**
 * Oda atanmayı bekleyen rezervasyonlar.
 *
 * Modül 4'ün rezervasyon detay ekranı geldiğinde aynı API oradan da
 * kullanılacak; bu ekran o zaman da "toplu atama" görünümü olarak işe yarar.
 */
export function AssignmentTab() {
  const queryClient = useQueryClient();
  const canOperate = useCan()(PERMISSIONS.ROOMS_OPERATE);
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
        rowActions={canOperate ? (row) => (
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
        ) : undefined}
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

/**
 * Oda seçme penceresi. Liste sunucuda sıralı gelir: önce misafirin tipi (en
 * hazır oda başta), sonra üst sınıf, farklı tip, alt sınıf. Kapasitesi
 * yetmeyen ya da o tipte overbooking yaratacak odalar hiç listelenmez.
 */
function AssignRoomModal({ reservation, onClose, onAssigned }) {
  const [includeOtherTypes, setIncludeOtherTypes] = useState(false);
  const [page, setPage] = useState(1);

  const candidatesQuery = useQuery({
    queryKey: ['rooms', 'candidates', reservation.id, { includeOtherTypes, page }],
    queryFn: () =>
      api(
        withQuery(`/rooms/assignments/${reservation.id}/candidates`, {
          includeOtherTypes,
          page,
          pageSize: CANDIDATE_PAGE_SIZE,
        }),
      ),
    placeholderData: keepPreviousData,
  });

  const assignMutation = useMutation({
    mutationFn: (roomId) => apiPut(`/rooms/assignments/${reservation.id}`, { roomId }),
    onSuccess: (data) => {
      toastSuccess(`${data.roomNumber} numaralı oda atandı`);
      onAssigned();
    },
    onError: (error) => toastError(error.message),
  });

  const candidates = candidatesQuery.data?.items ?? [];
  const meta = candidatesQuery.data?.meta;

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
        hint="Kapasitesi yeten ve overbooking yaratmayan diğer tipler, sınıfıyla birlikte listelenir."
        checked={includeOtherTypes}
        onChange={(event) => {
          setIncludeOtherTypes(event.target.checked);
          setPage(1);
        }}
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
            ? 'Tarihleri değiştirmeyi ya da odalardaki arıza kayıtlarını kontrol etmeyi deneyin.'
            : 'Diğer oda tiplerini göstererek misafiri başka bir tipe yerleştirebilirsiniz.'}
        </Alert>
      )}

      {candidates.length > 0 && (
        <ul className={`flex flex-col gap-2 transition-opacity duration-200 ${candidatesQuery.isFetching ? 'opacity-60' : ''}`}>
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
                <OccupancyBadge occupancy={room.occupancy} />
                <HousekeepingBadge status={room.housekeepingStatus} />
                {room.recommended && (
                  <Badge tone="info" dot={false}>
                    Önerilen
                  </Badge>
                )}
                <AssignmentKindBadge kind={room.kind} />
              </div>
              <Button size="sm" icon="check" onClick={() => assignMutation.mutate(room.id)} disabled={assignMutation.isPending}>
                {assignMutation.isPending ? 'Atanıyor…' : 'Ata'}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {meta && meta.totalPages > 1 && (
        <nav aria-label="Aday oda sayfaları" className="mt-4 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-ink-muted">{meta.total} uygun oda</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" icon="chevronLeft" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Önceki
            </Button>
            <span className="text-sm font-semibold text-ink-soft" aria-live="polite">
              {meta.page} / {meta.totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>
              Sonraki
              <Icon name="chevronRight" className="size-3.5" />
            </Button>
          </div>
        </nav>
      )}
    </Modal>
  );
}
