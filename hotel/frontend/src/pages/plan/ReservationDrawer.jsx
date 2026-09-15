import { useQuery } from '@tanstack/react-query';
import { BOARD_TYPE_LABELS, RESERVATION_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Icon, Spinner } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { HousekeepingBadge, OccupancyBadge } from '../../components/RoomStateBadges.jsx';
import { api } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { RESERVATION_TONES } from './planTheme.js';

/**
 * Izgaradaki bara tıklayınca açılan konaklama detayı.
 *
 * Modül 4'ün rezervasyon detay ekranı gelene kadar bir konaklamanın tek
 * yerden görülebildiği yer burası; o ekran geldiğinde bu çekmece onun kısa
 * hâli olarak kalır (ızgaradan ayrılmadan bakmak isteyen için).
 *
 * İşlem düğmelerinin açık/kapalı olmasına **sunucu** karar verir (`actions`):
 * aynı kuralı React'te ikinci kez yazmak, iki tarafın ayrışması demektir.
 *
 * @param {{
 *   reservationId: string,
 *   canOperate: boolean,
 *   onClose: () => void,
 *   onChangeRoom: (detail: object) => void,
 *   onUnassign: (detail: object) => void,
 * }} props
 */
export function ReservationDrawer({ reservationId, canOperate, onClose, onChangeRoom, onUnassign }) {
  const query = useQuery({
    queryKey: ['plan', 'reservation', reservationId],
    queryFn: () => api(`/plan/reservations/${reservationId}`),
  });

  const detail = query.data;
  const tone = detail ? RESERVATION_TONES[detail.status] : null;

  return (
    <Modal
      open
      size="md"
      title={detail ? `${detail.confirmationCode}` : 'Rezervasyon'}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Kapat
          </Button>
          {detail && canOperate && detail.actions.canUnassign && (
            <Button variant="dangerSoft" icon="close" onClick={() => onUnassign(detail)}>
              Oda atamasını kaldır
            </Button>
          )}
          {detail && canOperate && (
            <Button icon="key" disabled={!detail.actions.canChangeRoom} onClick={() => onChangeRoom(detail)}>
              {detail.room ? 'Odayı değiştir' : 'Oda ata'}
            </Button>
          )}
        </>
      }
    >
      {query.isPending && <Spinner label="Rezervasyon yükleniyor…" className="py-8" />}

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

      {detail && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden="true"
              className={`size-2.5 rounded-full ${tone?.swatch ?? ''}`}
            />
            <span className="text-sm font-bold text-ink">
              {RESERVATION_STATUS_LABELS[detail.status] ?? detail.status}
            </span>
            {detail.room ? (
              <Badge tone="info" dot={false}>
                Oda {detail.room.number}
              </Badge>
            ) : (
              <Badge tone="warning" dot={false}>
                Oda bekliyor
              </Badge>
            )}
            <Badge dot={false}>{detail.roomType.code}</Badge>
          </div>

          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Field label="Misafir">
              <span className="font-semibold text-ink">
                {detail.guest.firstName} {detail.guest.lastName}
              </span>
              {detail.guest.phone && <div className="text-xs text-ink-muted">{detail.guest.phone}</div>}
              {detail.guest.email && <div className="truncate text-xs text-ink-muted">{detail.guest.email}</div>}
            </Field>
            <Field label="Konaklama">
              {formatDate(detail.checkIn)} → {formatDate(detail.checkOut)}
              <div className="text-xs text-ink-muted">
                {detail.nights} gece · {detail.adults} yetişkin
                {detail.children > 0 ? ` + ${detail.children} çocuk` : ''}
              </div>
            </Field>
            <Field label="Oda tipi">
              {detail.roomType.code} — {detail.roomType.name}
              <div className="text-xs text-ink-muted">
                Kapasite: {detail.roomType.capacityAdults} yetişkin, {detail.roomType.capacityChildren} çocuk
              </div>
            </Field>
            <Field label="Pansiyon">{BOARD_TYPE_LABELS[detail.boardType] ?? detail.boardType}</Field>
            <Field label="Toplam tutar">{formatMoney(detail.totalPrice, detail.currency)}</Field>
            <Field label="Folyo">
              {detail.folio ? (
                <>
                  {formatMoney(detail.folio.balance, detail.folio.currency)}
                  <span className="text-xs text-ink-muted"> · {detail.folio.status === 'OPEN' ? 'açık' : 'kapalı'}</span>
                </>
              ) : (
                <span className="text-ink-muted">Henüz folyo açılmadı</span>
              )}
            </Field>
          </dl>

          {detail.room && (
            <div className="flex flex-wrap items-center gap-2 rounded-panel border border-line bg-surface-muted px-4 py-3">
              <span className="text-sm font-bold text-ink">Oda {detail.room.number}</span>
              <span className="text-xs text-ink-muted">{detail.room.floor}. kat</span>
              <OccupancyBadge occupancy={detail.room.occupancy} />
              <HousekeepingBadge status={detail.room.housekeepingStatus} />
            </div>
          )}

          {detail.notes && (
            <div className="rounded-panel border border-line bg-surface-muted px-4 py-3 text-sm text-ink-soft">
              <span className="mb-1 block text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Not</span>
              {detail.notes}
            </div>
          )}

          {!detail.actions.canChangeRoom && detail.actions.reason && (
            <Alert tone="info">
              <span className="flex items-center gap-2">
                <Icon name="info" className="size-4 shrink-0" />
                {detail.actions.reason} — oda değişikliği yapılamaz.
              </span>
            </Alert>
          )}
        </div>
      )}
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-ink-soft">{children}</dd>
    </div>
  );
}
