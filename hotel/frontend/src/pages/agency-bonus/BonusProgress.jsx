import { AGENCY_BONUS_PACE_LABELS } from '@hotelos/hotel-contracts';
import { Badge } from '@hotelos/ui';
import { PACE_TONES, formatQuantity, formatScore } from '../../lib/agencyBonus.js';
import { formatPercent } from '../../lib/format.js';

/**
 * Acente primi (modül 35) ilerleme gösterimleri: hedef çubuğu, zamana göre
 * durum rozeti ve kademe merdiveni. Kural listesi, kural ekranı ve acente
 * kartı aynı bileşenleri kullanır.
 */

/** Çubuğun en az ölçeği (yüzde): hedef her zaman görünür. */
const MIN_SCALE_PCT = 100;
/** Çubuğun en çok ölçeği: uçuk eşikler çubuğu okunmaz kılmasın. */
const MAX_SCALE_PCT = 200;

/**
 * Hedef çubuğu: gerçekleşen (koyu), eldekiyle tahmin (açık), hedef ve kademe
 * işaretleri. Değerler hedefe göre yüzdedir.
 *
 * @param {{ scorePct: string | number, projectedPct?: string | number | null, tiers?: Array<{ threshold: string }>, target: string | number, compact?: boolean, label: string }} props
 */
export function TargetBar({ scorePct, projectedPct = null, tiers = [], target, compact = false, label }) {
  const goal = Number(target) || 0;
  const tierPcts = goal > 0 ? tiers.map((tier) => (Number(tier.threshold) / goal) * 100) : [];
  const scale = Math.min(MAX_SCALE_PCT, Math.max(MIN_SCALE_PCT, Number(scorePct) || 0, Number(projectedPct) || 0, ...tierPcts));
  const at = (pct) => `${Math.max(0, Math.min(100, (pct / scale) * 100))}%`;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Number(scorePct) || 0)}
      aria-valuetext={`Hedefin ${formatScore(scorePct)}`}
      className={`relative w-full overflow-hidden rounded-full bg-canvas ring-1 ring-line ${compact ? 'h-2' : 'h-3.5'}`}
    >
      {projectedPct !== null && <span className="absolute inset-y-0 left-0 bg-info-line" style={{ width: at(Number(projectedPct)) }} />}
      <span className="absolute inset-y-0 left-0 rounded-full bg-success" style={{ width: at(Number(scorePct)) }} />
      {tierPcts.map((pct, index) => (
        <span key={index} aria-hidden="true" className="absolute inset-y-0 w-px bg-ink-muted/60" style={{ left: at(pct) }} />
      ))}
      <span aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: at(100) }} title="Hedef" />
    </div>
  );
}

/** @param {{ pace: 'AHEAD' | 'NEAR' | 'BEHIND' | null | undefined }} props */
export function PaceBadge({ pace }) {
  if (!pace) return null;
  return <Badge tone={PACE_TONES[pace]}>{AGENCY_BONUS_PACE_LABELS[pace]}</Badge>;
}

/**
 * Kademe merdiveni: her kademenin eşiği, oranı ve durumu (ulaşıldı / eldekiyle
 * ulaşılır / uzak).
 *
 * @param {{ metric: 'NIGHTS' | 'REVENUE', tiers: Array<{ threshold: string, ratePct: string }>, reached: number, projected?: number | null, currency: string }} props
 */
export function TierLadder({ metric, tiers, reached, projected = null, currency }) {
  return (
    <ol className="flex flex-col divide-y divide-line rounded-item border border-line" aria-label="Prim kademeleri">
      {tiers.map((tier, index) => {
        const number = index + 1;
        const done = number <= reached;
        const likely = !done && projected !== null && number <= projected;
        return (
          <li key={number} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm ${done ? 'bg-success-soft' : ''}`}>
            <span className="flex items-center gap-2">
              <span className={`grid size-6 place-items-center rounded-full text-xs font-bold ${done ? 'bg-success text-white' : 'bg-canvas text-ink-soft ring-1 ring-line'}`}>{number}</span>
              <span className="font-semibold text-ink">{formatQuantity(metric, tier.threshold, currency)}</span>
              <span className="text-ink-muted">→ {formatPercent(tier.ratePct)}</span>
            </span>
            {done ? <Badge tone="success">Ulaşıldı</Badge> : likely ? <Badge tone="info">Eldekiyle ulaşılır</Badge> : <Badge tone="neutral" dot={false}>Henüz değil</Badge>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Bir değer kutusu (rakam + açıklama).
 * @param {{ label: string, value: React.ReactNode, hint?: React.ReactNode, tone?: 'neutral' | 'success' | 'warning' | 'danger' }} props
 */
export function Figure({ label, value, hint, tone = 'neutral' }) {
  const tones = { neutral: 'text-ink', success: 'text-success-ink', warning: 'text-warning-ink', danger: 'text-sec-strong' };
  return (
    <div className="min-w-0">
      <dt className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{label}</dt>
      <dd className={`mt-0.5 text-xl font-bold tabular-nums ${tones[tone]}`}>{value}</dd>
      {hint && <dd className="text-xs text-ink-muted">{hint}</dd>}
    </div>
  );
}
