import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Checkbox, Spinner } from '@hotelos/ui';
import { AssignmentKindBadge, HousekeepingBadge, OccupancyBadge } from '../../components/RoomStateBadges.jsx';
import { useT } from '../../i18n/index.jsx';
import { api, withQuery } from '../../lib/api.js';

const PAGE_SIZE = 6;

/**
 * Girişte oda seçimi: modül 3'ün aday listesi (misafirin tipi önce, en hazır
 * oda başta; kapasitesi yetmeyen ya da overbooking yaratacak oda listelenmez).
 * Seçilen oda girişle aynı işlemde atanır.
 *
 * @param {{ reservationId: string, currentRoomId: string | null, selectedId: string | null,
 *           onSelect: (room: object) => void, disabled?: boolean }} props
 */
export function RoomChoice({ reservationId, currentRoomId, selectedId, onSelect, disabled = false }) {
  const t = useT();
  const [includeOtherTypes, setIncludeOtherTypes] = useState(false);
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['rooms', 'candidates', reservationId, { includeOtherTypes, page, pageSize: PAGE_SIZE }],
    queryFn: () => api(withQuery(`/rooms/assignments/${reservationId}/candidates`, { includeOtherTypes, page, pageSize: PAGE_SIZE })),
    placeholderData: keepPreviousData,
  });
  const rooms = (query.data?.items ?? []).filter((room) => room.id !== currentRoomId);
  const meta = query.data?.meta;

  return (
    <div className="flex flex-col gap-3">
      <Checkbox
        label={t('frontDesk.roomChoice.showOtherTypes')}
        checked={includeOtherTypes}
        onChange={(event) => {
          setIncludeOtherTypes(event.target.checked);
          setPage(1);
        }}
        disabled={disabled}
      />
      {query.isPending && <Spinner label={t('frontDesk.roomChoice.searching')} className="py-4" />}
      {query.isError && (
        <Alert tone="danger" action={<Button variant="outline" size="sm" icon="refresh" onClick={() => query.refetch()}>{t('common.retry')}</Button>}>
          {query.error.message}
        </Alert>
      )}
      {query.data && rooms.length === 0 && (
        <Alert tone="warning" title={t('frontDesk.roomChoice.noneTitle')}>
          {includeOtherTypes ? t('frontDesk.roomChoice.noneAllTypes') : t('frontDesk.roomChoice.noneTryOtherTypes')}
        </Alert>
      )}
      {rooms.length > 0 && (
        <ul className={`flex flex-col gap-2 ${query.isFetching ? 'opacity-60' : ''}`}>
          {rooms.map((room) => {
            const selected = room.id === selectedId;
            return (
              <li
                key={room.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-panel border px-3 py-2.5 ${
                  selected ? 'border-ink bg-surface-muted' : 'border-line'
                }`}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-bold tabular-nums text-ink">{room.number}</span>
                  <span className="text-xs text-ink-muted">{t('frontDesk.roomChoice.floorType', { floor: room.floor, type: room.roomTypeCode })}</span>
                  <OccupancyBadge occupancy={room.occupancy} />
                  <HousekeepingBadge status={room.housekeepingStatus} />
                  {room.recommended && <Badge tone="info" dot={false}>{t('frontDesk.roomChoice.recommended')}</Badge>}
                  <AssignmentKindBadge kind={room.kind} />
                </span>
                <Button size="sm" variant={selected ? 'primary' : 'outline'} icon="check" onClick={() => onSelect(room)} disabled={disabled}>
                  {selected ? t('frontDesk.roomChoice.selected') : t('frontDesk.roomChoice.select')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || disabled} onClick={() => setPage(page - 1)}>{t('frontDesk.roomChoice.previous')}</Button>
          <span className="text-xs font-semibold text-ink-muted">{meta.page} / {meta.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= meta.totalPages || disabled} onClick={() => setPage(page + 1)}>{t('frontDesk.roomChoice.next')}</Button>
        </div>
      )}
    </div>
  );
}
