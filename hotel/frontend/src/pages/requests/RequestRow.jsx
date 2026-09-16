import { memo } from 'react';
import { Link } from 'react-router-dom';
import {
  GUEST_REQUEST_CATEGORY_LABELS,
  GUEST_REQUEST_PRIORITY_LABELS,
  GUEST_REQUEST_SOURCE_LABELS,
  GUEST_REQUEST_STATUS_LABELS,
  guestRequestTransitionError,
} from '@hotelos/hotel-contracts';
import { Badge, Button, Icon, Select } from '@hotelos/ui';
import { useNow } from '../../lib/useNow.js';
import { formatClock, formatDateTime } from '../../lib/timeFormat.js';
import { CATEGORY_ICONS, PRIORITY_STYLES, STATUS_TONES, requestTimingLabel } from './requestTheme.js';

/** Geri sayımın akma sıklığı (dakika hassasiyetinde metin için yeterli). */
const TIMING_TICK_MS = 30_000;

const UNASSIGNED = '';

/**
 * Süre rozeti — ekran açık kaldıkça akar.
 * @param {{ request: object, timeZone: string }} props
 */
export function RequestTimingBadge({ request, timeZone }) {
  const now = useNow(TIMING_TICK_MS);
  const timing = requestTimingLabel(request, now, timeZone);
  if (!timing) return null;
  return (
    <Badge tone={timing.tone} dot={false} className="gap-1">
      <Icon name={request.scheduledFor ? 'alarm' : 'clock'} className="size-3.5" />
      {timing.text}
    </Badge>
  );
}

/**
 * Misafir isteği satırı — istek listesinde ve konuşmanın yan panelinde.
 *
 * Satırın solundaki şerit önceliktir; başlık, kategori ve oda ilk bakışta
 * okunur. Düğmeler yalnızca o durumdan geçilebilen işlemleri gösterir (kural
 * sözleşmede tek yerde: `guestRequestTransitionError`).
 *
 * `compact` yan panel için: açıklama ve atama seçicisi gizlenir.
 *
 * @param {{
 *   request: object,
 *   timeZone: string,
 *   canManage: boolean,
 *   busy: boolean,
 *   compact?: boolean,
 *   assigneeOptions?: Array<{ value: string, label: string }>,
 *   onOpen: (request: object) => void,
 *   onStatus: (request: object, status: string) => void,
 *   onAssign?: (request: object, assignedToId: string | null) => void,
 *   showConversationLink?: boolean,
 * }} props
 */
export const RequestRow = memo(function RequestRow({
  request,
  timeZone,
  canManage,
  busy,
  compact = false,
  assigneeOptions = [],
  onOpen,
  onStatus,
  onAssign,
  showConversationLink = true,
}) {
  const priority = PRIORITY_STYLES[request.priority] ?? PRIORITY_STYLES.NORMAL;
  const can = (status) => guestRequestTransitionError(request.status, status) === null && request.status !== status;
  const active = request.status === 'OPEN' || request.status === 'IN_PROGRESS';
  const showPriority = !compact || request.priority === 'HIGH' || request.priority === 'URGENT';

  return (
    <article
      aria-label={`${request.title}${request.room ? `, oda ${request.room.number}` : ''}`}
      className={`relative flex flex-wrap gap-3 overflow-hidden rounded-panel border border-line bg-surface py-3.5 pl-5 pr-4 transition-opacity ${
        busy ? 'opacity-60' : ''
      } ${active ? '' : 'bg-surface-muted'}`}
    >
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1.5 ${active ? priority.stripe : 'bg-black/10'}`} />

      <span
        aria-hidden="true"
        className={`grid shrink-0 place-items-center rounded-item bg-black/[0.04] text-ink-soft ${
          compact ? 'size-8' : 'size-10'
        }`}
      >
        <Icon name={CATEGORY_ICONS[request.category] ?? 'clipboard'} className={compact ? 'size-4' : 'size-5'} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={() => onOpen(request)}
            className="min-w-0 truncate text-left text-sm font-bold text-ink underline-offset-2 hover:underline"
          >
            {request.title}
          </button>
          <Badge tone={STATUS_TONES[request.status]}>{GUEST_REQUEST_STATUS_LABELS[request.status]}</Badge>
          {showPriority && active && (
            <Badge tone={priority.tone} dot={false}>
              {GUEST_REQUEST_PRIORITY_LABELS[request.priority]}
            </Badge>
          )}
          <RequestTimingBadge request={request} timeZone={timeZone} />
        </div>

        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
          {request.room ? (
            <span className="font-bold text-ink-soft">Oda {request.room.number}</span>
          ) : (
            <span className="font-semibold text-warning-ink">Odasız</span>
          )}
          {request.guest && <span>· {request.guest.name}</span>}
          {compact && active && request.assignedTo && <span>· {request.assignedTo.name}</span>}
          <span>· {GUEST_REQUEST_CATEGORY_LABELS[request.category]}</span>
          {!compact && (
            <span>
              · {GUEST_REQUEST_SOURCE_LABELS[request.source]}, {formatClock(request.createdAt, timeZone)}
            </span>
          )}
          {showConversationLink && request.conversation && (
            <Link
              to={`/mesajlar/${request.conversation.id}`}
              className="inline-flex items-center gap-1 font-semibold text-info-ink underline-offset-2 hover:underline"
            >
              · <Icon name="message" className="size-3.5" /> Konuşma
            </Link>
          )}
        </p>

        {!compact && request.description && (
          <p className="mt-1.5 line-clamp-2 text-sm text-ink-soft">{request.description}</p>
        )}

        {request.status === 'DONE' && (
          <p className="mt-1.5 text-xs text-success-ink">
            <Icon name="checkCircle" className="mr-1 inline size-3.5 align-[-2px]" />
            {formatDateTime(request.completedAt, timeZone)} · {request.completedBy ?? '—'}
            {request.resolutionNote ? ` — ${request.resolutionNote}` : ''}
          </p>
        )}
        {request.status === 'CANCELLED' && request.cancelledReason && (
          <p className="mt-1.5 text-xs text-ink-muted">İptal sebebi: {request.cancelledReason}</p>
        )}
      </div>

      <div
        className={`flex shrink-0 flex-col gap-2 ${
          compact ? 'w-full items-start pl-11' : 'w-full items-start pl-[3.25rem] sm:w-auto sm:items-end sm:pl-0'
        }`}
      >
        {!compact && active && (
          canManage && onAssign ? (
            <Select
              compact
              aria-label={`${request.title} — atanan personel`}
              name={`assignee-${request.id}`}
              value={request.assignedTo?.id ?? UNASSIGNED}
              disabled={busy}
              onChange={(event) => onAssign(request, event.target.value || null)}
              options={[{ value: UNASSIGNED, label: 'Atanmamış' }, ...assigneeOptions]}
              className="w-full sm:w-56"
            />
          ) : (
            <span className="text-xs font-semibold text-ink-muted">{request.assignedTo?.name ?? 'Atanmamış'}</span>
          )
        )}

        {canManage && (
          <div className={`flex flex-wrap gap-1.5 ${compact ? '' : 'sm:flex-nowrap sm:justify-end'}`}>
            {can('IN_PROGRESS') && (
              <Button size="sm" variant="outline" icon="play" disabled={busy} onClick={() => onStatus(request, 'IN_PROGRESS')}>
                Başlat
              </Button>
            )}
            {can('DONE') && (
              <Button size="sm" icon="check" disabled={busy} onClick={() => onStatus(request, 'DONE')}>
                Tamamla
              </Button>
            )}
            {request.status === 'IN_PROGRESS' && !compact && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus(request, 'OPEN')}>
                Beklemeye al
              </Button>
            )}
            {can('CANCELLED') && !compact && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus(request, 'CANCELLED')}>
                İptal
              </Button>
            )}
            {!active && can('OPEN') && (
              <Button size="sm" variant="outline" icon="rotateCcw" disabled={busy} onClick={() => onStatus(request, 'OPEN')}>
                Yeniden aç
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
});
