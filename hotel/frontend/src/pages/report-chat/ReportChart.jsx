import { useState } from 'react';
import { chartData, formatAxis, formatCell } from '../../lib/reportChat.js';
import { useElementWidth } from '../../lib/useElementWidth.js';

/** Çizim alanı (px); yükseklik x ekseni şeridini de içerir. */
const HEIGHT = 260;
const PAD = Object.freeze({ top: 16, right: 16, bottom: 36, left: 60 });
/** Y ekseninde hedeflenen çizgi sayısı (yuvarlak adımla). */
const Y_TICK_TARGET = 4;
/** Bir eksen etiketine ayrılan en az genişlik (px). */
const X_LABEL_PX = 72;
/** Bu kadar noktaya kadar çizgide noktalar görünür. */
const MAX_DOTS = 31;
/** Sütun grubunun bant içindeki payı. */
const GROUP_SHARE = 0.72;
const TOOLTIP_WIDTH = 220;

/**
 * Yuvarlak eksen adımı (1, 2, 2.5, 5 × 10ⁿ).
 * @param {number} span
 */
function niceStep(span) {
  if (!(span > 0)) return 1;
  const rough = span / Y_TICK_TARGET;
  const power = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough);
}

/** Boş değerde kopan çizgi yolu. @param {Array<[number, number] | null>} points */
function pathOf(points) {
  let path = '';
  let open = false;
  for (const point of points) {
    if (!point) {
      open = false;
      continue;
    }
    path += `${open ? 'L' : 'M'}${point[0]},${point[1]} `;
    open = true;
  }
  return path.trim();
}

/**
 * Rapor asistanının grafiği (modül 24): çizgi (zaman içinde eğilim) ya da gruplu sütun (karşılaştırma / kırılım), en
 * fazla üç seri; ilk seri vurgulu. Boş değer çizgide kopar, sütunda çizilmez. Ayrıntı imleç ipucunda ve tabloda.
 *
 * @param {{ dataset: any, chart: { type: string, series: string[] } | null }} props
 */
export function ReportChart({ dataset, chart }) {
  const [ref, width] = useElementWidth();
  const [active, setActive] = useState(/** @type {number | null} */ (null));
  const data = chartData(dataset, chart);
  if (data.series.length === 0) return null;

  const count = data.labels.length;
  const values = data.series.flatMap((series) => series.values).filter((value) => value !== null);
  const rawMax = Math.max(0, ...values);
  const rawMin = Math.min(0, ...values);
  const step = niceStep(rawMax - rawMin);
  const yBottom = Math.floor(rawMin / step) * step;
  const yTop = Math.max(Math.ceil(rawMax / step) * step, yBottom + step);
  const ticks = [];
  for (let tick = yBottom; tick <= yTop + step / 1e6; tick += step) ticks.push(Math.round(tick * 1000) / 1000);

  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const bar = chart.type === 'BAR';
  const band = count > 0 ? plotWidth / count : 0;
  // Sütunda bant ortası, çizgide uçtan uca.
  const x = (index) => (bar || count === 1 ? PAD.left + band * (index + 0.5) : PAD.left + (plotWidth * index) / (count - 1));
  const y = (value) => PAD.top + plotHeight * (1 - (value - yBottom) / (yTop - yBottom));
  const labelEvery = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(plotWidth / X_LABEL_PX))));
  const groupWidth = band * GROUP_SHARE;
  const barWidth = groupWidth / data.series.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-ink-soft" aria-hidden="true">
        {data.series.map((series) => (
          <span key={series.key} className="flex items-center gap-1.5">
            <span className={`inline-block w-4 rounded-full ${bar ? 'h-2.5 rounded-sm' : 'h-0.5'}`} style={{ backgroundColor: series.color }} /> {series.label}
          </span>
        ))}
      </div>
      <div ref={ref} className="relative w-full" style={{ height: HEIGHT }} onMouseLeave={() => setActive(null)}>
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={`Grafik: ${data.series.map((series) => series.label).join(', ')}`} className="block">
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? 'var(--color-line-strong)' : 'var(--color-line)'} strokeWidth={1} />
                <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-ink-muted text-[11px] tabular-nums">
                  {formatAxis(tick, data.axisKind)}
                </text>
              </g>
            ))}

            {active !== null && <rect x={x(active) - band / 2} y={PAD.top} width={Math.max(band, 2)} height={plotHeight} fill="rgb(16 16 16 / 0.04)" />}

            {bar
              ? data.series.map((series, seriesIndex) =>
                  series.values.map((value, index) =>
                    value === null ? null : (
                      <rect
                        key={`${series.key}-${index}`}
                        x={x(index) - groupWidth / 2 + seriesIndex * barWidth}
                        y={Math.min(y(value), y(0))}
                        width={Math.max(1, barWidth - 1)}
                        height={Math.max(1, Math.abs(y(value) - y(0)))}
                        rx={2}
                        fill={series.color}
                      />
                    ),
                  ),
                )
              : data.series.map((series, seriesIndex) => {
                  const points = series.values.map((value, index) => (value === null ? null : [x(index), y(value)]));
                  return (
                    <g key={series.key}>
                      <path d={pathOf(points)} fill="none" stroke={series.color} strokeWidth={seriesIndex === 0 ? 2 : 1.5} strokeLinejoin="round" strokeLinecap="round" />
                      {points.map((point, index) =>
                        point && (count <= MAX_DOTS || index === active) ? (
                          <circle key={index} cx={point[0]} cy={point[1]} r={index === active ? 4.5 : 3} fill={series.color} stroke="var(--color-surface)" strokeWidth={2} />
                        ) : null,
                      )}
                    </g>
                  );
                })}

            {data.labels.map((label, index) =>
              index % labelEvery === 0 || index === count - 1 ? (
                <text key={index} x={x(index)} y={HEIGHT - 12} textAnchor="middle" className="fill-ink-muted text-[11px]">
                  {label}
                </text>
              ) : null,
            )}

            {data.labels.map((label, index) => (
              <rect key={`hit-${label}-${index}`} x={x(index) - band / 2} y={PAD.top} width={Math.max(band, 8)} height={plotHeight} fill="transparent" onMouseEnter={() => setActive(index)} />
            ))}
          </svg>
        )}
        {active !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-card border border-line bg-surface p-3 text-xs shadow-lg"
            style={{ width: TOOLTIP_WIDTH, left: Math.min(Math.max(0, x(active) + 12), Math.max(0, width - TOOLTIP_WIDTH)) }}
          >
            <p className="mb-1.5 font-semibold text-ink">{data.labels[active]}</p>
            {data.series.map((series) => (
              <p key={series.key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-ink-soft">
                  <span className="inline-block size-2 rounded-full" style={{ backgroundColor: series.color }} />
                  {series.label}
                </span>
                <span className="font-semibold tabular-nums">{formatCell(series.values[active], series.kind)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
