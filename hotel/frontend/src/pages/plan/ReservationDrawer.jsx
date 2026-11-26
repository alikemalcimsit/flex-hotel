import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Icon, Spinner } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { HousekeepingBadge, OccupancyBadge } from '../../components/RoomStateBadges.jsx';
import { useT } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';
import { folioPath } from '../../lib/folios.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { RESERVATION_TONES } from './planTheme.js';
import { countText, guestsText } from './planText.jsx';

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
  const t = useT();
  const canViewFolio = useCan()(PERMISSIONS.FOLIO_VIEW);
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
      title={detail ? `${detail.confirmationCode}` : t('roomPlan.drawer.fallbackTitle')}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
          {detail && (
            <Link to={`/rezervasyonlar/${detail.id}`}>
              <Button variant="outline" icon="bookOpen">
                {t('roomPlan.drawer.reservationPage')}
              </Button>
            </Link>
          )}
          {detail && canOperate && detail.actions.canUnassign && (
            <Button variant="dangerSoft" icon="close" onClick={() => onUnassign(detail)}>
              {t('roomPlan.drawer.unassign')}
            </Button>
          )}
          {detail && canOperate && (
            <Button icon="key" disabled={!detail.actions.canChangeRoom} onClick={() => onChangeRoom(detail)}>
              {detail.room ? t('roomPlan.drawer.changeRoom') : t('roomPlan.drawer.assignRoom')}
            </Button>
          )}
        </>
      }
    >
      {query.isPending && <Spinner label={t('roomPlan.drawer.loading')} className="py-8" />}

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

      {detail && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden="true"
              className={`size-2.5 rounded-full ${tone?.swatch ?? ''}`}
            />
            <span className="text-sm font-bold text-ink">
              {t(`roomPlan.reservationStatus.${detail.status}`, detail.status)}
            </span>
            {detail.room ? (
              <Badge tone="info" dot={false}>
                {t('roomPlan.shared.room', { number: detail.room.number })}
              </Badge>
            ) : (
              <Badge tone="warning" dot={false}>
                {t('roomPlan.drawer.awaitingRoom')}
              </Badge>
            )}
            <Badge dot={false}>{detail.roomType.code}</Badge>
          </div>

          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Field label={t('roomPlan.shared.guest')}>
              <span className="font-semibold text-ink">
                {detail.guest.firstName} {detail.guest.lastName}
              </span>
              {detail.guest.phone && <div className="text-xs text-ink-muted">{detail.guest.phone}</div>}
              {detail.guest.email && <div className="truncate text-xs text-ink-muted">{detail.guest.email}</div>}
            </Field>
            <Field label={t('roomPlan.drawer.stay')}>
              {formatDate(detail.checkIn)} → {formatDate(detail.checkOut)}
              <div className="text-xs text-ink-muted">
                {countText(t, 'roomPlan.shared.nights', detail.nights)} · {guestsText(t, detail.adults, detail.children)}
              </div>
            </Field>
            <Field label={t('roomPlan.drawer.roomType')}>
              {detail.roomType.code} — {detail.roomType.name}
              <div className="text-xs text-ink-muted">
                {t('roomPlan.drawer.capacity', {
                  adults: countText(t, 'roomPlan.shared.adults', detail.roomType.capacityAdults),
                  children: countText(t, 'roomPlan.shared.children', detail.roomType.capacityChildren),
                })}
              </div>
            </Field>
            <Field label={t('roomPlan.drawer.board')}>{t(`roomPlan.board.${detail.boardType}`, detail.boardType)}</Field>
            <Field label={t('roomPlan.drawer.total')}>{formatMoney(detail.totalPrice, detail.currency)}</Field>
            <Field label={t('roomPlan.drawer.folio')}>
              {detail.folio ? (
                <>
                  {formatMoney(detail.folio.balance, detail.folio.currency)}
                  <span className="text-xs text-ink-muted">
                    {' '}
                    · {detail.folio.status === 'OPEN' ? t('roomPlan.drawer.folioOpen') : t('roomPlan.drawer.folioClosed')}
                    {detail.folio.count > 1 ? ` · ${t('roomPlan.drawer.folioCount', { count: detail.folio.count })}` : ''}
                  </span>
                  {canViewFolio && (
                    <Link to={folioPath(detail.id)} className="block text-xs font-semibold text-info-ink underline-offset-2 hover:underline">
                      {t('roomPlan.drawer.openFolio')}
                    </Link>
                  )}
                </>
              ) : (
                <span className="text-ink-muted">{t('roomPlan.drawer.noFolio')}</span>
              )}
            </Field>
          </dl>

          {detail.room && (
            <div className="flex flex-wrap items-center gap-2 rounded-panel border border-line bg-surface-muted px-4 py-3">
              <span className="text-sm font-bold text-ink">{t('roomPlan.shared.room', { number: detail.room.number })}</span>
              <span className="text-xs text-ink-muted">{t('roomPlan.shared.floor', { floor: detail.room.floor })}</span>
              <OccupancyBadge occupancy={detail.room.occupancy} />
              <HousekeepingBadge status={detail.room.housekeepingStatus} />
            </div>
          )}

          {detail.roomHistory.length > 1 && (
            <section aria-label={t('roomPlan.drawer.roomHistory')}>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{t('roomPlan.drawer.roomHistory')}</h3>
              <ol className="flex flex-col gap-1.5">
                {detail.roomHistory.map((entry) => (
                  <li
                    key={`${entry.roomId}-${entry.from}`}
                    className="flex flex-wrap items-baseline gap-x-2 rounded-item bg-surface-muted px-3 py-2 text-sm"
                  >
                    <span className="font-bold tabular-nums text-ink">{entry.roomNumber}</span>
                    <span className="text-ink-soft">
                      {formatDate(entry.from)} → {formatDate(entry.to)}
                    </span>
                    {entry.reason && <span className="text-xs text-ink-muted">· {entry.reason}</span>}
                    {entry.movedBy && <span className="text-xs text-ink-muted">· {t('roomPlan.drawer.movedBy', { name: entry.movedBy })}</span>}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {detail.notes && (
            <div className="rounded-panel border border-line bg-surface-muted px-4 py-3 text-sm text-ink-soft">
              <span className="mb-1 block text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{t('roomPlan.drawer.note')}</span>
              {detail.notes}
            </div>
          )}

          {!detail.actions.canChangeRoom && detail.actions.reason && (
            <Alert tone="info">
              <span className="flex items-center gap-2">
                <Icon name="info" className="size-4 shrink-0" />
                {t('roomPlan.drawer.cannotChange', { reason: detail.actions.reason })}
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
