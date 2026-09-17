/**
 * Durum rozeti — Spark Admin'in `.badge-table`'ı: yumuşak zemin, kalın yazı,
 * solda durum noktası. Nokta renkle birlikte bir şekil de verir; rozetin
 * anlamı yine de her zaman metinde.
 */
const TONES = {
  neutral: { badge: 'bg-black/[0.05] text-ink-soft', dot: 'bg-ink-muted' },
  success: { badge: 'bg-success-soft text-success-ink', dot: 'bg-success' },
  warning: { badge: 'bg-warning-soft text-warning-ink', dot: 'bg-warning' },
  danger: { badge: 'bg-danger-soft text-danger-ink', dot: 'bg-danger' },
  info: { badge: 'bg-info-soft text-info-ink', dot: 'bg-info' },
  sky: { badge: 'bg-sky-50 text-sky-800', dot: 'bg-sky-500' },
  violet: { badge: 'bg-violet-50 text-violet-800', dot: 'bg-violet-500' },
};

/**
 * @param {{
 *   tone?: 'neutral'|'success'|'warning'|'danger'|'info'|'sky'|'violet',
 *   dot?: boolean,
 *   className?: string,
 *   children: React.ReactNode,
 * }} props
 */
export function Badge({ tone = 'neutral', dot = true, className = '', children }) {
  const style = TONES[tone] ?? TONES.neutral;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${style.badge} ${className}`}
    >
      {dot && <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${style.dot}`} />}
      {children}
    </span>
  );
}
