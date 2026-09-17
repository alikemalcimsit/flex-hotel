import { memo } from 'react';
import { APPROVAL_STATUS_LABELS, approvalTiming } from '@hotelos/hotel-contracts';
import { Badge, Button, Icon } from '@hotelos/ui';
import { formatMoney } from '../../lib/format.js';
import { formatElapsed, formatListTime, formatMinutes } from '../../lib/timeFormat.js';
import { STATUS_TONES, TYPE_ICONS } from './approvalTheme.js';

/**
 * Onay satırı. Bekleyen satırda kalan süre akar ve yetkisi olan tek tıkla
 * onaylar / reddeder (ikisi de not penceresi açar); geçmiş satırda karar,
 * veren kişi ve zaman görünür. Satırın kendisi detayı açar.
 *
 * `memo`: liste yüz satıra çıkabilir; dakikalık saat tıkında yalnızca kalan
 * süresi değişen satırlar yeniden çizilsin diye `now` satıra veriliyor.
 *
 * @param {{
 *   item: object,
 *   now: number,
 *   timeZone: string,
 *   canDecide: boolean,
 *   onOpen: (id: string, mode?: 'view' | 'grant' | 'deny') => void,
 * }} props
 */
export const ApprovalRow = memo(function ApprovalRow({ item, now, timeZone, canDecide, onOpen }) {
  const timing = approvalTiming(item, now);
  const requester = item.actorName ? `${item.actorName} (aktör)` : item.requestedBy;
  const amount = item.amount !== null ? formatMoney(item.amount, item.currency ?? '') : null;
  const pending = item.status === 'PENDING';

  return (
    <article
      className={`flex flex-col gap-3 rounded-card border bg-surface p-4 shadow-soft transition-colors sm:flex-row sm:items-center ${
        timing.expiringSoon || timing.expired ? 'border-warning-ink/40' : 'border-transparent hover:border-line-strong'
      }`}
    >
      <button
        type="button"
        onClick={() => onOpen(item.id)}
        className="flex min-w-0 flex-1 items-start gap-4 text-left sm:items-center"
      >
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-item bg-info-soft text-info-ink"
        >
          <Icon name={TYPE_ICONS[item.type] ?? 'clipboard'} className="size-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold text-ink">{item.summary}</span>
            {amount && <span className="text-sm font-semibold text-ink">{amount}</span>}
          </span>
          <span className="truncate text-xs text-ink-muted">
            {item.typeLabel} · İsteyen: {requester} · {formatListTime(item.createdAt, now, timeZone)}
          </span>
        </span>
      </button>

      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        {pending ? (
          <>
            <Badge tone={timing.expired ? 'neutral' : timing.expiringSoon ? 'danger' : 'warning'}>
              {timing.expired
                ? 'Süresi doldu'
                : timing.minutesLeft === null
                  ? 'Süresiz'
                  : `Kalan ${formatMinutes(timing.minutesLeft)}`}
            </Badge>
            <span className="text-xs text-ink-muted" title="Bekleme süresi">
              {formatElapsed(item.createdAt, now)}
            </span>
            {canDecide && !timing.expired && (
              <>
                <Button size="sm" variant="outline" icon="close" onClick={() => onOpen(item.id, 'deny')}>
                  Reddet
                </Button>
                <Button size="sm" icon="check" onClick={() => onOpen(item.id, 'grant')}>
                  Onayla
                </Button>
              </>
            )}
          </>
        ) : (
          <>
            <Badge tone={STATUS_TONES[item.status]}>{APPROVAL_STATUS_LABELS[item.status]}</Badge>
            <span className="text-xs text-ink-muted">
              {item.decidedBy ? `${item.decidedBy} · ` : ''}
              {formatListTime(item.decidedAt ?? item.updatedAt, now, timeZone)}
            </span>
          </>
        )}
      </div>
    </article>
  );
});
