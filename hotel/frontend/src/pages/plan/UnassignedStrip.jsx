import { Badge, Button, Icon } from '@hotelos/ui';
import { useT } from '../../i18n/index.jsx';
import { formatDate } from '../../lib/format.js';
import { countText, guestsText } from './planText.jsx';
import { RESERVATION_TONES } from './planTheme.js';

/**
 * Oda bekleyen rezervasyonlar şeridi.
 *
 * Bu kayıtlar envanteri tüketir ama hiçbir satırda görünmez — ızgaraya bakan
 * personel "8 oda boş" görüp aslında 3'ünün satılmış olduğunu kaçırabilir.
 * Şerit bu boşluğu kapatır: kartı bir odanın satırına sürükleyince atama olur.
 *
 * Dokunmatik ekranda sürükleme yok; kart aynı zamanda düğme, tıklayınca detay
 * çekmecesi açılır ve oda oradan seçilir.
 *
 * @param {{
 *   data: { items: Array<object>, total: number, shown: number } | undefined,
 *   canOperate: boolean,
 *   draggingId: string | null,
 *   onDragStart: (payload: object) => void,
 *   onDragEnd: () => void,
 *   onSelect: (reservationId: string) => void,
 *   onAutoAssign: (reservationId: string) => void,
 *   isAssigning: boolean,
 * }} props
 */
export function UnassignedStrip({
  data,
  canOperate,
  draggingId,
  onDragStart,
  onDragEnd,
  onSelect,
  onAutoAssign,
  isAssigning,
}) {
  const t = useT();
  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-card bg-surface px-5 py-3.5 text-sm text-ink-muted shadow-card">
        <Icon name="checkCircle" className="size-4 shrink-0 text-success" />
        {t('roomPlan.unassigned.none')}
      </div>
    );
  }

  return (
    <section aria-label={t('roomPlan.unassigned.aria')} className="rounded-card bg-surface p-4 shadow-card">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
          <Icon name="inbox" className="size-4 text-sec" />
          {t('roomPlan.unassigned.title')}
          <Badge tone="warning" dot={false}>
            {data.total}
          </Badge>
        </h2>
        <p className="text-xs text-ink-muted">
          {canOperate ? t('roomPlan.unassigned.dragHint') : t('roomPlan.unassigned.noPermission')}
        </p>
      </header>

      <ul className="flex snap-x gap-2 overflow-x-auto pb-1">
        {items.map((item) => (
          <li key={item.id} className="snap-start">
            <div
              className={`flex w-60 flex-col gap-1.5 rounded-panel border border-line bg-surface-muted p-3 transition-shadow duration-150 hover:shadow-card ${
                draggingId === item.id ? 'opacity-40' : ''
              }`}
              draggable={canOperate}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', item.id);
                event.dataTransfer.effectAllowed = 'move';
                onDragStart({
                  reservationId: item.id,
                  roomId: null,
                  checkIn: item.checkIn,
                  checkOut: item.checkOut,
                  status: item.status,
                  guestName: item.guestName,
                  confirmationCode: item.confirmationCode,
                  roomNumber: null,
                });
              }}
              onDragEnd={onDragEnd}
            >
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                className="text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sec"
              >
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={`size-2 shrink-0 rounded-full ${RESERVATION_TONES[item.status]?.swatch ?? ''}`}
                  />
                  <span className="truncate text-sm font-bold text-ink">{item.guestName ?? item.confirmationCode}</span>
                </span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  {t('roomPlan.unassigned.dates', {
                    checkIn: formatDate(item.checkIn),
                    checkOut: formatDate(item.checkOut),
                    nights: countText(t, 'roomPlan.shared.nights', item.nights),
                  })}
                </span>
                <span className="block text-xs text-ink-muted">
                  {item.roomTypeCode} · {guestsText(t, item.adults, item.children)}
                </span>
              </button>

              {canOperate && (
                <Button
                  variant="outline"
                  size="sm"
                  icon="sparkles"
                  className="mt-1 w-full justify-center"
                  disabled={isAssigning}
                  onClick={() => onAutoAssign(item.id)}
                >
                  {t('roomPlan.shared.autoAssign')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {data.shown < data.total && (
        <p className="mt-2 text-xs text-ink-muted">
          {t('roomPlan.unassigned.more', { total: data.total, shown: data.shown })}
        </p>
      )}
    </section>
  );
}
