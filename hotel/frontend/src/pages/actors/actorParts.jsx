import { ACTOR_TYPE_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Icon } from '@hotelos/ui';
import { HEALTH_STYLES, budgetBar, formatUsd } from '../../lib/actors.js';

/**
 * Aktör ekranlarının ortak parçaları: sağlık rozeti, tür rozeti, bütçe çubuğu.
 */

/** @param {{ health: string }} props */
export function HealthBadge({ health }) {
  const style = HEALTH_STYLES[health] ?? HEALTH_STYLES.IDLE;
  return (
    <Badge tone={style.tone}>
      <span className="inline-flex items-center gap-1">
        <Icon name={style.icon} className="size-3.5" />
        {style.label}
      </span>
    </Badge>
  );
}

/** @param {{ type: string }} props */
export function TypeBadge({ type }) {
  return <Badge tone={type === 'agent' ? 'violet' : 'sky'}>{ACTOR_TYPE_LABELS[type] ?? type}</Badge>;
}

/**
 * Otelin bugünkü AI harcaması / günlük bütçe. `share` verilirse (ajan kartı)
 * çubuğun içinde ajanın payı koyu gösterilir.
 *
 * @param {{ spent: string, budget: string, share?: string | null, label: string }} props
 */
export function BudgetBar({ spent, budget, share = null, label }) {
  const bar = budgetBar(spent, budget);
  const shareRatio = share !== null && Number(budget) > 0 ? Math.min(bar.ratio, Number(share) / Number(budget)) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(bar.ratio * 100)}
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-black/[0.06]"
      >
        <div className={`absolute inset-y-0 left-0 ${bar.tone} opacity-40`} style={{ width: `${Math.round(bar.ratio * 100)}%` }} />
        {shareRatio !== null && <div className={`absolute inset-y-0 left-0 ${bar.tone}`} style={{ width: `${Math.round(shareRatio * 100)}%` }} />}
        {shareRatio === null && <div className={`absolute inset-y-0 left-0 ${bar.tone}`} style={{ width: `${Math.round(bar.ratio * 100)}%` }} />}
      </div>
      <p className="text-xs text-ink-muted">
        {Number(budget) > 0
          ? `${formatUsd(spent)} / ${formatUsd(budget)} günlük bütçe${bar.exhausted ? ' — doldu: AI bugün yeni mesaja cevap vermiyor' : ''}`
          : 'Günlük bütçe girilmemiş: AI çağrı yapmaz (Ayarlar › AI asistanı)'}
      </p>
    </div>
  );
}
