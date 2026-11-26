import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ASSIGNMENT_VIEWS, MAX_BULK_ITEMS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Checkbox, Icon, Input, Spinner } from '@hotelos/ui';
import { BulkResultAlert, useRowSelection } from '../../components/BulkSelection.jsx';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';

import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { AssignmentKindBadge, HousekeepingBadge, OccupancyBadge } from '../../components/RoomStateBadges.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { useT } from '../../i18n/index.jsx';
import { api, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useCrudResource } from '../../lib/useCrudResource.js';
import { formatDate } from '../../lib/format.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { guestsText } from '../plan/planText.jsx';

/** Oda seçme penceresinde bir sayfadaki aday oda. */
const CANDIDATE_PAGE_SIZE = 8;

/**
 * Oda atanmayı bekleyen rezervasyonlar: girişi bugün ya da sonra olanlar (oda seç, otomatik ata — tek tek ya da
 * seçilenlere toplu) ve gelişi geçmiş olanlar (giriş günü geçti, giriş yapılmadı: gelmediyse "gelmedi" — tek tek ya
 * da toplu —, geç gelecekse oda verilir). Toplu işlem her kaydı tek tek işlemin kuralıyla işler; yapılamayanlar
 * sebebiyle listelenir.
 */
export function AssignmentTab() {
  const t = useT();
  const queryClient = useQueryClient();
  const can = useCan();
  const canOperate = can(PERMISSIONS.ROOMS_OPERATE);
  const canNoShow = can(PERMISSIONS.RESERVATIONS_MANAGE);
  const [assigning, setAssigning] = useState(null);
  const [view, setView] = useState('UPCOMING');
  const [bulkResult, setBulkResult] = useState(null);
  const [confirmNoShow, setConfirmNoShow] = useState(null);
  const selection = useRowSelection();

  const resource = useCrudResource({
    basePath: '/rooms/assignments/pending',
    queryKey: ['rooms', 'assignments'],
    labels: { singular: 'Atama' },
    extraParams: { view },
  });
  const late = view === 'LATE';
  const { clear } = selection;
  useEffect(() => clear(), [view, resource.page, resource.search, clear]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['rooms'] });
  const labelOf = (id) => {
    const row = resource.rows?.find((item) => item.id === id);
    return row ? `${row.confirmationCode}${row.guestName ? ` · ${row.guestName}` : ''}` : id;
  };
  const bulkAssign = useMutation({
    mutationFn: (reservationIds) => apiPost('/rooms/assignments/auto-batch', { reservationIds }),
    onSuccess: (data) => {
      setBulkResult({ title: t('roomPlan.assignment.bulkAssignTitle'), data });
      clear();
    },
    onError: (error) => toastError(error.message),
    // Yarıda kesilse de işlenenler kalıcıdır: liste her durumda tazelenir.
    onSettled: refresh,
  });
  const bulkNoShow = useMutation({
    mutationFn: ({ items, waiveFee }) => apiPost('/reservations/no-show-batch', { items, waiveFee }),
    onSuccess: (data) => {
      setBulkResult({ title: t('roomPlan.assignment.bulkNoShowTitle'), data });
      setConfirmNoShow(null);
      clear();
    },
    onError: (error) => toastError(error.message),
    onSettled: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
    },
  });
  const noShowItems = (ids) => ids.map((id) => resource.rows.find((row) => row.id === id)).filter(Boolean).map((row) => ({ id: row.id, expectedUpdatedAt: row.updatedAt }));

  const autoAssignMutation = useMutation({
    mutationFn: (reservationId) => apiPost(`/rooms/assignments/${reservationId}/auto`, {}),
    onSuccess: (data) => {
      if (data.assigned) {
        toastSuccess(t('roomPlan.shared.roomAssigned', { room: data.room.number }));
      } else {
        toastError(data.reason ?? t('roomPlan.shared.noRoomFound'));
      }
      refresh();
    },
    onError: (error) => toastError(error.message),
  });

  const columns = [
    ...((late ? canNoShow : canOperate) ? [selection.column(resource.rows ?? [])] : []),
    {
      key: 'confirmationCode',
      header: t('roomPlan.assignment.colCode'),
      render: (row) => <span className="font-mono text-xs font-semibold">{row.confirmationCode}</span>,
    },
    { key: 'guestName', header: t('roomPlan.shared.guest'), render: (row) => row.guestName ?? <span className="text-ink-muted">—</span> },
    {
      key: 'roomType',
      header: t('roomPlan.filter.roomType'),
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
      header: t('roomPlan.assignment.colDates'),
      render: (row) => (
        <span className="flex flex-col whitespace-nowrap">
          <span>
            {formatDate(row.checkIn)} → {formatDate(row.checkOut)}
          </span>
          {row.late && <span className="text-xs font-semibold text-sec-strong">{row.stayEnded ? t('roomPlan.assignment.stayEnded') : t('roomPlan.assignment.arrivalPassed')}</span>}
        </span>
      ),
    },
    {
      key: 'guests',
      header: t('roomPlan.assignment.colGuests'),
      render: (row) => `${row.adults}${row.children > 0 ? ` + ${row.children}` : ''}`,
    },
    {
      key: 'status',
      header: t('roomPlan.assignment.colStatus'),
      render: (row) => <Badge>{t(`roomPlan.reservationStatus.${row.status}`, row.status)}</Badge>,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <ChoiceChips
        label={t('roomPlan.assignment.view')}
        options={ASSIGNMENT_VIEWS.map((value) => {
          const label = t(`roomPlan.assignmentView.${value}`);
          return { value, label: value === 'LATE' && resource.meta?.lateCount ? t('roomPlan.assignment.viewWithCount', { label, count: resource.meta.lateCount }) : label };
        })}
        value={view}
        onChange={setView}
      />
      {!late && resource.meta?.lateCount > 0 && (
        <Alert tone="warning" action={<Button type="button" size="sm" variant="outline" onClick={() => setView('LATE')}>{t('roomPlan.assignment.openLate')}</Button>}>
          {t('roomPlan.assignment.lateAlert', { count: resource.meta.lateCount })}
        </Alert>
      )}
      {late && resource.rows?.some((row) => row.stayEnded) && (
        <p className="text-sm text-ink-muted">{t('roomPlan.assignment.stayEndedNote')}</p>
      )}
      {bulkResult && <BulkResultAlert title={bulkResult.title} result={bulkResult.data} labelOf={labelOf} onClose={() => setBulkResult(null)} />}
      <Toolbar
        actions={
          selection.count > 0 &&
          (late ? (
            canNoShow && (
              <Button type="button" variant="outline" icon="close" disabled={bulkNoShow.isPending || selection.count > MAX_BULK_ITEMS} onClick={() => setConfirmNoShow({ ids: selection.ids })}>
                {t('roomPlan.assignment.bulkNoShow', { count: selection.count })}
              </Button>
            )
          ) : (
            canOperate && (
              <Button type="button" icon="sparkles" disabled={bulkAssign.isPending || selection.count > MAX_BULK_ITEMS} onClick={() => bulkAssign.mutate(selection.ids)}>
                {bulkAssign.isPending ? t('roomPlan.shared.assigning') : t('roomPlan.assignment.bulkAssign', { count: selection.count })}
              </Button>
            )
          ))
        }
      >
        <Input
          name="search"
          label={t('roomPlan.filter.search')}
          type="search"
          placeholder={t('roomPlan.assignment.searchPlaceholder')}
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
        emptyTitle={t(resource.search ? 'roomPlan.assignment.emptySearch' : late ? 'roomPlan.assignment.emptyLate' : 'roomPlan.assignment.emptyUpcoming')}
        emptyHint={t(
          resource.search
            ? 'roomPlan.assignment.emptySearchHint'
            : late
              ? 'roomPlan.assignment.emptyLateHint'
              : 'roomPlan.assignment.emptyUpcomingHint',
        )}
        rowActions={canOperate || canNoShow ? (row) => (
          <div className="flex justify-end gap-2">
            {late && canNoShow && (
              <Button variant="outline" size="sm" icon="close" onClick={() => setConfirmNoShow({ ids: [row.id] })} disabled={bulkNoShow.isPending}>
                {t('roomPlan.assignment.noShow')}
              </Button>
            )}
            {canOperate && !row.stayEnded && (
            <>
            <Button
              variant="outline"
              size="sm"
              icon="sparkles"
              onClick={() => autoAssignMutation.mutate(row.id)}
              disabled={autoAssignMutation.isPending}
            >
              {t('roomPlan.shared.autoAssign')}
            </Button>
            <Button size="sm" icon="key" onClick={() => setAssigning(row)}>
              {t('roomPlan.assignment.pickRoom')}
            </Button>
            </>
            )}
          </div>
        ) : undefined}
      />
      {confirmNoShow && (
        <NoShowConfirm
          count={confirmNoShow.ids.length}
          isPending={bulkNoShow.isPending}
          onConfirm={(waiveFee) => bulkNoShow.mutate({ items: noShowItems(confirmNoShow.ids), waiveFee })}
          onClose={() => setConfirmNoShow(null)}
        />
      )}

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

/** Gelmedi onayı: ücret politikası (ilk gece) uygulanır ya da gerekçesiz vazgeçilir. */
function NoShowConfirm({ count, isPending, onConfirm, onClose }) {
  const t = useT();
  const [waiveFee, setWaiveFee] = useState(false);
  return (
    <Modal
      open
      title={count > 1 ? t('roomPlan.assignment.noShowTitleMany', { count }) : t('roomPlan.assignment.noShowTitleOne')}
      onClose={isPending ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="danger" icon="close" disabled={isPending} onClick={() => onConfirm(waiveFee)}>
            {isPending ? t('roomPlan.shared.processing') : t('roomPlan.assignment.noShowConfirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-ink-soft">
        <p>{t('roomPlan.assignment.noShowBody')}</p>
        <Checkbox label={t('roomPlan.assignment.waiveFee')} checked={waiveFee} onChange={(event) => setWaiveFee(event.target.checked)} />
      </div>
    </Modal>
  );
}

/**
 * Oda seçme penceresi. Liste sunucuda sıralı gelir: önce misafirin tipi (en
 * hazır oda başta), sonra üst sınıf, farklı tip, alt sınıf. Kapasitesi
 * yetmeyen ya da o tipte overbooking yaratacak odalar hiç listelenmez.
 */
function AssignRoomModal({ reservation, onClose, onAssigned }) {
  const t = useT();
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
      toastSuccess(t('roomPlan.shared.roomAssigned', { room: data.roomNumber }));
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
      title={t('roomPlan.assignment.pickTitle', { code: reservation.confirmationCode })}
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose} disabled={assignMutation.isPending}>
          {t('common.close')}
        </Button>
      }
    >
      <div className="mb-5 flex items-start gap-3 rounded-panel border border-line bg-surface-muted p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-item bg-ink text-white">
          <Icon name="user" className="size-5" />
        </span>
        <div className="min-w-0 text-sm">
          <p className="text-ink">
            <span className="font-bold">{reservation.guestName ?? t('roomPlan.shared.guest')}</span>
            <span className="text-ink-muted">
              {' '}
              · {reservation.roomTypeCode} — {reservation.roomTypeName}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {formatDate(reservation.checkIn)} → {formatDate(reservation.checkOut)} ·{' '}
            {guestsText(t, reservation.adults, reservation.children)}
          </p>
        </div>
      </div>

      <Checkbox
        label={t('roomPlan.shared.showOtherTypes')}
        name="includeOtherTypes"
        hint={t('roomPlan.shared.showOtherTypesHint')}
        checked={includeOtherTypes}
        onChange={(event) => {
          setIncludeOtherTypes(event.target.checked);
          setPage(1);
        }}
        className="mb-5"
      />

      {candidatesQuery.isPending && <Spinner label={t('roomPlan.shared.searchingRooms')} className="py-8" />}

      {candidatesQuery.isError && (
        <Alert
          tone="danger"
          action={
            <Button variant="outline" size="sm" icon="refresh" onClick={() => candidatesQuery.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {candidatesQuery.error.message}
        </Alert>
      )}

      {candidatesQuery.data && candidates.length === 0 && (
        <Alert tone="warning" title={t('roomPlan.shared.noCandidatesTitle')}>
          {includeOtherTypes ? t('roomPlan.assignment.noCandidatesHint') : t('roomPlan.shared.noCandidatesTryOtherTypes')}
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
                  {t('roomPlan.shared.floor', { floor: room.floor })} · {room.roomTypeCode}
                </span>
                <OccupancyBadge occupancy={room.occupancy} />
                <HousekeepingBadge status={room.housekeepingStatus} />
                {room.recommended && (
                  <Badge tone="info" dot={false}>
                    {t('roomPlan.shared.recommended')}
                  </Badge>
                )}
                <AssignmentKindBadge kind={room.kind} />
              </div>
              <Button size="sm" icon="check" onClick={() => assignMutation.mutate(room.id)} disabled={assignMutation.isPending}>
                {assignMutation.isPending ? t('roomPlan.shared.assigning') : t('roomPlan.shared.assign')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {meta && meta.totalPages > 1 && (
        <nav aria-label={t('roomPlan.shared.candidatePages')} className="mt-4 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-ink-muted">{t('roomPlan.shared.candidateTotal', { count: meta.total })}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" icon="chevronLeft" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t('roomPlan.shared.prev')}
            </Button>
            <span className="text-sm font-semibold text-ink-soft" aria-live="polite">
              {meta.page} / {meta.totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>
              {t('roomPlan.shared.next')}
              <Icon name="chevronRight" className="size-3.5" />
            </Button>
          </div>
        </nav>
      )}
    </Modal>
  );
}
