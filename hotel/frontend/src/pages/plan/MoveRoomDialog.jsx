import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Checkbox, Icon, Spinner } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { AssignmentKindBadge, HousekeepingBadge, OccupancyBadge } from '../../components/RoomStateBadges.jsx';
import { useT } from '../../i18n/index.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { MoveReasonField } from './MoveReasonField.jsx';
import { guestsText, richText } from './planText.jsx';

/** Bir sayfada listelenecek aday oda sayısı. */
const CANDIDATE_PAGE_SIZE = 8;

/**
 * Oda seçme penceresi — sürükle-bırakın klavye ve dokunmatik karşılığı.
 *
 * Aday listesi sunucudan sıralı gelir (önce misafirin tipi, en hazır oda
 * başta). Kapasitesi yetmeyen ya da o tipte overbooking yaratacak odalar hiç
 * listelenmez; yani buradan seçilen bir oda sunucuda da kabul edilir — yarışta
 * kaybetme durumu hariç, o da anlaşılır bir hata mesajıyla döner.
 *
 * @param {{
 *   reservation: { id: string, confirmationCode: string, status: string, checkIn: string, checkOut: string,
 *                  adults: number, children: number, roomType: object, room: object | null },
 *   isMoving: boolean,
 *   onPick: (room: object, reason: string) => void,
 *   onClose: () => void,
 * }} props
 */
export function MoveRoomDialog({ reservation, isMoving, onPick, onClose }) {
  const t = useT();
  const [includeOtherTypes, setIncludeOtherTypes] = useState(false);
  const [page, setPage] = useState(1);
  const [reason, setReason] = useState('');

  const query = useQuery({
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

  // Misafirin hâlihazırda bulunduğu oda listede çıkar (kendi kaydı engel
  // sayılmaz); seçilecek bir şey olmadığı için gizleniyor.
  const candidates = (query.data?.items ?? []).filter((room) => room.id !== reservation.room?.id);
  const meta = query.data?.meta;
  const inHouse = reservation.status === 'CHECKED_IN';

  return (
    <Modal
      open
      size="lg"
      title={t(reservation.room ? 'roomPlan.moveRoom.titleChange' : 'roomPlan.moveRoom.titleAssign', {
        code: reservation.confirmationCode,
      })}
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose} disabled={isMoving}>
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
            <span className="font-bold">{reservation.guest ? `${reservation.guest.firstName} ${reservation.guest.lastName}` : t('roomPlan.shared.guest')}</span>
            <span className="text-ink-muted">
              {' '}
              · {reservation.roomType.code} — {reservation.roomType.name}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {formatDate(reservation.checkIn)} → {formatDate(reservation.checkOut)} ·{' '}
            {guestsText(t, reservation.adults, reservation.children)}
            {reservation.room ? ` · ${t('roomPlan.moveRoom.currentRoom', { room: reservation.room.number })}` : ''}
          </p>
        </div>
      </div>

      {inHouse && (
        <Alert tone="warning" className="mb-5" title={t('roomPlan.moveRoom.inHouseTitle')}>
          {richText(t('roomPlan.moveRoom.inHouseBody', { room: reservation.room?.number }), {
            dirty: <strong>{t('roomPlan.moveRoom.dirty')}</strong>,
          })}
        </Alert>
      )}

      {reservation.room && (
        <div className="mb-5">
          <MoveReasonField value={reason} onChange={setReason} disabled={isMoving} />
        </div>
      )}

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

      {query.isPending && <Spinner label={t('roomPlan.shared.searchingRooms')} className="py-8" />}

      {query.isError && (
        <Alert
          tone="danger"
          action={
            <Button variant="outline" size="sm" icon="refresh" onClick={() => query.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {query.error.message}
        </Alert>
      )}

      {query.data && candidates.length === 0 && (
        <Alert tone="warning" title={t('roomPlan.shared.noCandidatesTitle')}>
          {includeOtherTypes
            ? t(inHouse ? 'roomPlan.moveRoom.noCandidatesRemaining' : 'roomPlan.moveRoom.noCandidatesWhole')
            : t('roomPlan.shared.noCandidatesTryOtherTypes')}
        </Alert>
      )}

      {candidates.length > 0 && (
        <ul className={`flex flex-col gap-2 transition-opacity duration-200 ${query.isFetching ? 'opacity-60' : ''}`}>
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
              <Button size="sm" icon="check" onClick={() => onPick(room, reason.trim())} disabled={isMoving}>
                {isMoving
                  ? t('roomPlan.shared.processing')
                  : reservation.room
                    ? t('roomPlan.moveRoom.moveHere')
                    : t('roomPlan.shared.assign')}
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
