import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Checkbox, Icon, Spinner } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { AssignmentKindBadge, HousekeepingBadge, OccupancyBadge } from '../../components/RoomStateBadges.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';

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
 *   onPick: (room: object) => void,
 *   onClose: () => void,
 * }} props
 */
export function MoveRoomDialog({ reservation, isMoving, onPick, onClose }) {
  const [includeOtherTypes, setIncludeOtherTypes] = useState(false);
  const [page, setPage] = useState(1);

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
      title={`${reservation.confirmationCode} — ${reservation.room ? 'oda değiştir' : 'oda ata'}`}
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose} disabled={isMoving}>
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
            <span className="font-bold">{reservation.guest ? `${reservation.guest.firstName} ${reservation.guest.lastName}` : 'Misafir'}</span>
            <span className="text-ink-muted">
              {' '}
              · {reservation.roomType.code} — {reservation.roomType.name}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {formatDate(reservation.checkIn)} → {formatDate(reservation.checkOut)} · {reservation.adults} yetişkin
            {reservation.children > 0 ? ` + ${reservation.children} çocuk` : ''}
            {reservation.room ? ` · şu an ${reservation.room.number}` : ''}
          </p>
        </div>
      </div>

      {inHouse && (
        <Alert tone="warning" className="mb-5" title="Misafir odada">
          Oda değişince {reservation.room?.number} numaralı oda boş ve <strong>kirli</strong> olarak işaretlenir, yeni oda
          dolu sayılır. Misafirin eşyalarının taşındığından emin olun.
        </Alert>
      )}

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

      {query.isPending && <Spinner label="Uygun odalar aranıyor…" className="py-8" />}

      {query.isError && (
        <Alert
          tone="danger"
          action={
            <Button variant="outline" size="sm" icon="refresh" onClick={() => query.refetch()}>
              Tekrar dene
            </Button>
          }
        >
          {query.error.message}
        </Alert>
      )}

      {query.data && candidates.length === 0 && (
        <Alert tone="warning" title="Bu tarihlerde uygun boş oda yok">
          {includeOtherTypes
            ? 'Konaklamanın tamamı boyunca boş olan bir oda gerekiyor. Tarihleri ya da odalardaki arıza kayıtlarını kontrol edin.'
            : 'Diğer oda tiplerini göstererek misafiri başka bir tipe yerleştirebilirsiniz.'}
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
              <Button size="sm" icon="check" onClick={() => onPick(room)} disabled={isMoving}>
                {isMoving ? 'İşleniyor…' : reservation.room ? 'Buraya taşı' : 'Ata'}
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
