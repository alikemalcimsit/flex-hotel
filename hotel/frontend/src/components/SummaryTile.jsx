import { Icon } from '@hotelos/ui';

const TILE_TONES = {
  neutral: 'text-ink',
  warning: 'text-warning-ink',
  danger: 'text-sec-strong',
};

/**
 * Liste ekranlarının üstündeki özet kutusu (istekler, bildirim geçmişi).
 * `onClick` verilirse aynı zamanda filtre düğmesidir (`aria-pressed`).
 * @param {{ label: string, value?: number, hint: string, icon: string, tone?: 'neutral' | 'warning' | 'danger', selected?: boolean, onClick?: () => void }} props
 */
export function SummaryTile({ label, value, hint, icon, tone = 'neutral', selected = false, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button', 'aria-pressed': selected, onClick } : {})}
      className={`flex items-start justify-between gap-3 rounded-card border bg-surface p-4 text-left shadow-soft transition-colors sm:p-5 ${
        selected ? 'border-ink' : onClick ? 'border-transparent hover:border-line-strong' : 'border-transparent'
      }`}
    >
      <span className="min-w-0">
        <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{label}</span>
        <span className={`mt-1 block text-3xl font-bold tabular-nums ${TILE_TONES[tone]}`}>{value ?? '—'}</span>
        <span className="mt-0.5 block text-xs text-ink-muted sm:truncate">{hint}</span>
      </span>
      <span
        aria-hidden="true"
        className={`grid size-10 shrink-0 place-items-center rounded-item ${
          tone === 'danger'
            ? 'bg-danger-soft text-sec-strong'
            : tone === 'warning'
              ? 'bg-warning-soft text-warning-ink'
              : 'bg-black/[0.04] text-ink-soft'
        }`}
      >
        <Icon name={icon} className="size-5" />
      </span>
    </Tag>
  );
}
