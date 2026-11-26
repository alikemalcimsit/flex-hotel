import { SENTIMENT_PARTS, weeklyChartData } from '../../lib/reviews.js';

/** Trend ekranının (modül 54) CSS çubuk grafikleri: haftalık yorum sayısı + ortalama puan, haftalık duygu yığılmış çubuk. */

const BAR_AREA = 'relative flex h-36 items-end gap-1 overflow-x-auto';

/** Hafta etiketleri satırı. @param {{ bars: Array<{ week: string, label: string }>, extra?: (bar: any) => React.ReactNode }} props */
function WeekLabels({ bars, extra }) {
  return (
    <div className="flex gap-1 overflow-x-auto text-[10px] text-ink-muted">
      {bars.map((bar) => (
        <span key={bar.week} className="min-w-7 flex-1 text-center tabular-nums">
          {bar.label}
          {extra && <span className="block font-semibold text-ink-soft">{extra(bar)}</span>}
        </span>
      ))}
    </div>
  );
}

/** Haftalık yorum sayısı (çubuk) ve ortalama puan (%, nokta). @param {{ weeks: any[] }} props */
export function WeeklyCountChart({ weeks }) {
  const { bars } = weeklyChartData(weeks);
  return (
    <div className="flex flex-col gap-2">
      <div className={BAR_AREA} role="img" aria-label={bars.map((bar) => `${bar.label}: ${bar.count} yorum, ortalama ${bar.averagePct ?? '—'}`).join('; ')}>
        {bars.map((bar) => (
          <span key={bar.week} className="relative flex h-full min-w-7 flex-1 flex-col items-center justify-end" title={`${bar.label} · ${bar.count} yorum · ortalama %${bar.averagePct ?? '—'}`}>
            {bar.averagePct !== null && (
              <span className="absolute left-1/2 size-2 -translate-x-1/2 rounded-full bg-ink" style={{ bottom: `calc(${bar.averagePct}% - 4px)` }} />
            )}
            <span className="w-3/5 rounded-t-sm bg-info/60" style={{ height: `${Math.max(bar.count ? 3 : 0, bar.countPct)}%` }} />
          </span>
        ))}
      </div>
      <WeekLabels bars={bars} extra={(bar) => (bar.count ? `${bar.count} · %${bar.averagePct ?? '—'}` : '—')} />
      <p className="flex flex-wrap gap-4 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-sm bg-info/60" /> Yorum sayısı
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-ink" /> Ortalama puan (100 üzerinden)
        </span>
      </p>
    </div>
  );
}

/** Haftalık duygu dağılımı (etiketli yorumlar içinde %). @param {{ weeks: any[] }} props */
export function WeeklySentimentChart({ weeks }) {
  const { bars } = weeklyChartData(weeks);
  return (
    <div className="flex flex-col gap-2">
      <div className={BAR_AREA} role="img" aria-label={bars.map((bar) => `${bar.label}: ${bar.parts.map((part) => `${part.label} ${part.value}`).join(', ')}`).join('; ')}>
        {bars.map((bar) => (
          <span key={bar.week} className="flex h-full min-w-7 flex-1 justify-center" title={`${bar.label} · ${bar.parts.map((part) => `${part.label} ${part.value}`).join(' · ')}`}>
            <span className="flex h-full w-3/5 flex-col-reverse overflow-hidden rounded-sm bg-surface-muted">
              {bar.parts.map((part) => part.value > 0 && <span key={part.key} className={part.color} style={{ height: `${part.pct}%` }} />)}
            </span>
          </span>
        ))}
      </div>
      <WeekLabels bars={bars} extra={(bar) => (bar.tagged ? String(bar.tagged) : '—')} />
      <p className="flex flex-wrap gap-4 text-xs text-ink-muted">
        {SENTIMENT_PARTS.map((part) => (
          <span key={part.key} className="inline-flex items-center gap-1.5">
            <span className={`inline-block size-2 rounded-full ${part.color}`} /> {part.label}
          </span>
        ))}
      </p>
    </div>
  );
}
