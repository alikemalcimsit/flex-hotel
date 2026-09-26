import { useLayoutEffect, useRef, useState } from 'react';
import { Button, Card, Spinner } from '@hotelos/ui';
import { formatMoney } from '../../lib/format.js';
import { longDay, shortDay } from '../../lib/dashboard.js';
import { QueryError } from '../activity/shared.jsx';

/** Grafiğin çizim alanı (px). Yükseklik x ekseni şeridini de içerir: kartta iç kaydırma çıkmaz. */
const HEIGHT = 240;
const PAD = Object.freeze({ top: 28, right: 20, bottom: 40, left: 44 });
/**
 * Y ekseni: doluluk yüzdesi, 0–100 (günler kıyaslansın, ölçek oynamasın). Fazla
 * satış olan hafta eksen %100'ün üstüne açılır: noktayı %100'de kesmek fazla
 * satışı gizlerdi.
 */
const Y_STEP = 25;
const Y_MIN_TOP = 100;
/** Nokta yarıçapı ve yüzey halkası (dataviz: ≥ 8px nokta, 2px halka). */
const DOT_RADIUS = 4;
const RING = 2;
/** Tooltip genişliği; kenara taşmasın diye yerleşimde kullanılır. */
const TOOLTIP_WIDTH = 208;
/** Günler arası bundan darsa (telefon) eksende yalnızca gün numarası yazar; etiketler çakışmasın. */
const COMPACT_STEP_PX = 48;

/**
 * Kabın genişliğini izler: grafik gerçek piksellerle çizilir (viewBox
 * esnetmesi yazıları bozardı).
 * @returns {[React.RefObject<HTMLDivElement>, number]}
 */
function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Haftalık doluluk (modül 13): 7 günün doluluk yüzdesi tek çizgi. Bugün
 * dikey çizgiyle işaretli; öncesi gerçekleşen, sonrası eldeki rezervasyon.
 * Tek seri: lejant yok, başlık adını söyler; yalnız bugünün değeri etiketli,
 * gerisi eksen, ipucu ve tablo görünümünde.
 *
 * @param {{ query: import('@tanstack/react-query').UseQueryResult<any> }} props
 */
export function WeekOccupancyChart({ query }) {
  const [showTable, setShowTable] = useState(false);
  const week = query.data;

  return (
    <Card
      title="Haftalık doluluk"
      description="Satılan oda / satılabilir oda (arızalı oda paydadan düşer). Bugünden öncesi gerçekleşen, sonrası eldeki rezervasyon; gelir vergiler hariç."
      actions={
        <Button variant="outline" size="sm" icon={showTable ? 'dashboard' : 'list'} onClick={() => setShowTable((value) => !value)} aria-pressed={showTable}>
          {showTable ? 'Grafik' : 'Tablo'}
        </Button>
      }
    >
      {query.isPending && <Spinner label="Haftalık seri yükleniyor…" className="py-12" />}
      {query.isError && <QueryError query={query} title="Haftalık seri yüklenemedi" />}
      {week && (
        <div className={`transition-opacity duration-200 ${query.isFetching && !query.isPending ? 'opacity-60' : ''}`}>
          {showTable ? <WeekTable week={week} /> : <Plot week={week} />}
        </div>
      )}
    </Card>
  );
}

/** @param {{ week: any }} props */
function Plot({ week }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(/** @type {number | null} */ (null));
  const days = week.days;
  const todayIndex = days.findIndex((day) => day.date === week.businessDate);

  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const step = days.length > 1 ? plotWidth / (days.length - 1) : 0;
  const yTop = Math.max(Y_MIN_TOP, Math.ceil(Math.max(...days.map((day) => day.occupancyPct)) / Y_STEP) * Y_STEP);
  const yTicks = Array.from({ length: yTop / Y_STEP + 1 }, (_, index) => index * Y_STEP);
  const x = (index) => PAD.left + index * step;
  const y = (pct) => PAD.top + plotHeight * (1 - Math.max(0, pct) / yTop);
  const points = days.map((day, index) => [x(index), y(day.occupancyPct)]);
  const line = points.map(([px, py], index) => `${index === 0 ? 'M' : 'L'}${px},${py}`).join(' ');
  const area = `${line} L${x(days.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const shown = active ?? null;
  const compact = step < COMPACT_STEP_PX;
  const axisLabel = (day, index) => (index === todayIndex ? 'Bugün' : compact ? String(Number(day.date.slice(8))) : shortDay(day.date));

  return (
    <div ref={ref} className="relative w-full" style={{ height: HEIGHT }} onMouseLeave={() => setActive(null)}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={`Haftalık doluluk, ${days[0].date} – ${days.at(-1).date}`} className="block">
          {/* Izgara: düz, ince, geri planda */}
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                // %100 çizgisi fazla satış haftasında kapasite sınırıdır: bir ton koyu.
                stroke={tick === 100 && yTop > 100 ? 'var(--color-line-strong)' : 'var(--color-line)'}
                strokeWidth={1}
              />
              <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-ink-muted text-[11px] tabular-nums">
                %{tick}
              </text>
            </g>
          ))}

          {/* Bugün */}
          {todayIndex >= 0 && (
            <g>
              <line x1={x(todayIndex)} x2={x(todayIndex)} y1={PAD.top - 6} y2={y(0)} stroke="var(--color-ink-muted)" strokeWidth={1} opacity={0.5} />
            </g>
          )}

          <path d={area} fill="var(--color-info)" opacity={0.1} />
          <path d={line} fill="none" stroke="var(--color-info)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* İmleç çizgisi */}
          {shown !== null && (
            <line x1={x(shown)} x2={x(shown)} y1={PAD.top} y2={y(0)} stroke="var(--color-ink)" strokeWidth={1} opacity={0.35} />
          )}

          {points.map(([px, py], index) => (
            <circle
              key={days[index].date}
              cx={px}
              cy={py}
              r={index === todayIndex || index === shown ? DOT_RADIUS + 1 : DOT_RADIUS}
              fill="var(--color-info)"
              stroke="var(--color-surface)"
              strokeWidth={RING}
            />
          ))}

          {/* Yalnızca bugünün değeri etiketli */}
          {todayIndex >= 0 && (
            <text x={x(todayIndex)} y={points[todayIndex][1] - 12} textAnchor="middle" className="fill-ink text-[12px] font-bold">
              %{days[todayIndex].occupancyPct}
            </text>
          )}

          {/* X ekseni */}
          {days.map((day, index) => (
            <text
              key={day.date}
              x={x(index)}
              y={HEIGHT - PAD.bottom + 18}
              textAnchor="middle"
              className={`text-[11px] ${index === todayIndex ? 'fill-ink font-bold' : 'fill-ink-muted'}`}
            >
              {axisLabel(day, index)}
            </text>
          ))}

          {/* Vuruş alanları: günün tüm sütunu (çizgiye nişan almak gerekmez); klavyeyle de gezilir */}
          {days.map((day, index) => (
            <rect
              key={day.date}
              x={x(index) - step / 2}
              y={PAD.top}
              width={Math.max(step, 24)}
              height={plotHeight}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${longDay(day.date)}: doluluk yüzde ${day.occupancyPct}, ${day.sold} / ${day.sellable} oda`}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              className="cursor-crosshair outline-none focus-visible:fill-black/[0.03]"
            />
          ))}
        </svg>
      )}

      {shown !== null && width > 0 && (
        <Tooltip day={days[shown]} currency={week.currency} isToday={shown === todayIndex} isPast={shown < todayIndex} left={x(shown)} width={width} />
      )}
    </div>
  );
}

/**
 * @param {{ day: any, currency: string, isToday: boolean, isPast: boolean, left: number, width: number }} props
 */
function Tooltip({ day, currency, isToday, isPast, left, width }) {
  const place = Math.min(Math.max(8, left - TOOLTIP_WIDTH / 2), width - TOOLTIP_WIDTH - 8);
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-1 rounded-control border border-line bg-surface px-3 py-2 text-xs shadow-float"
      style={{ left: place, width: TOOLTIP_WIDTH }}
    >
      <p className="font-semibold text-ink-muted">
        {longDay(day.date)} · {isToday ? 'bugün' : isPast ? 'gerçekleşen' : 'eldeki rezervasyon'}
      </p>
      <p className="mt-1 flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded-full bg-info" />
        <span className="text-base font-bold text-ink">%{day.occupancyPct}</span>
        <span className="text-ink-muted">
          {day.sold} / {day.sellable} oda
        </span>
      </p>
      <p className="mt-1 text-ink-soft">
        Oda geliri {formatMoney(day.revenue, currency)}
        {day.adr !== null && <> · ADR {formatMoney(day.adr, currency)}</>}
      </p>
      <p className="mt-0.5 text-ink-muted">
        {[
          day.available < 0 ? `${-day.available} oda fazla satış` : `${day.available} oda kaldı`,
          day.pendingSold > 0 ? `${day.pendingSold} opsiyonlu` : null,
          day.outOfOrder > 0 ? `${day.outOfOrder} arızalı oda` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </div>
  );
}

/** Grafiğin erişilebilir ikizi: aynı değerler tabloda. @param {{ week: any }} props */
function WeekTable({ week }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
          <tr>
            <th scope="col" className="px-2 py-2 font-bold">Gün</th>
            <th scope="col" className="px-2 py-2 text-right font-bold">Doluluk</th>
            <th scope="col" className="px-2 py-2 text-right font-bold">Satılan / satılabilir</th>
            <th scope="col" className="px-2 py-2 text-right font-bold">Kalan</th>
            <th scope="col" className="px-2 py-2 text-right font-bold">Oda geliri</th>
            <th scope="col" className="px-2 py-2 text-right font-bold">ADR</th>
            <th scope="col" className="px-2 py-2 text-right font-bold">RevPAR</th>
          </tr>
        </thead>
        <tbody>
          {week.days.map((day) => (
            <tr key={day.date} className={`border-t border-line ${day.date === week.businessDate ? 'font-bold' : ''}`}>
              <th scope="row" className="px-2 py-2 text-left font-semibold text-ink">
                {longDay(day.date)}
                {day.date === week.businessDate && <span className="ml-1 text-xs text-ink-muted">(bugün)</span>}
              </th>
              <td className="px-2 py-2 text-right tabular-nums">%{day.occupancyPct}</td>
              <td className="px-2 py-2 text-right tabular-nums">
                {day.sold} / {day.sellable}
              </td>
              <td className={`px-2 py-2 text-right tabular-nums ${day.available < 0 ? 'text-sec-strong' : ''}`}>{day.available}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatMoney(day.revenue, week.currency)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{day.adr !== null ? formatMoney(day.adr, week.currency) : '—'}</td>
              <td className="px-2 py-2 text-right tabular-nums">{day.revpar !== null ? formatMoney(day.revpar, week.currency) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
