import { useLayoutEffect, useRef, useState } from 'react';
import { METRIC_VALUE, axisLabel, bucketLabel, formatChange, fullDate } from '../../lib/reports.js';

/** Çizim alanı (px); yükseklik x ekseni şeridini de içerir. */
const HEIGHT = 280;
const PAD = Object.freeze({ top: 28, right: 64, bottom: 36, left: 64 });
/** Y ekseninde hedeflenen çizgi sayısı (yuvarlak adımla). */
const Y_TICK_TARGET = 4;
/** Eksende en fazla bu kadar etiket (yoğun aralıkta çakışmasın). */
const MAX_X_LABELS = 8;
/** Bir eksen etiketine ayrılan en az genişlik (px): "12 Eki" yazısı + boşluk. */
const X_LABEL_PX = 56;
/** Nokta yarıçapı ve yüzey halkası. */
const DOT_RADIUS = 4;
const RING = 2;
const TOOLTIP_WIDTH = 236;
/** Dar ekranda sağ boşluk (uç etiketi) küçülür. */
const NARROW_PX = 480;

/** Bu dönem: vurgulanan seri; geçen yıl: bağlam (gri, ince). */
const CURRENT_COLOR = 'var(--color-info)';
const LAST_YEAR_COLOR = 'var(--color-ink-muted)';

/** @returns {[React.RefObject<HTMLDivElement>, number]} */
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
 * Yuvarlak eksen adımı (1, 2, 2.5, 5 × 10ⁿ).
 * @param {number} max
 */
function niceScale(max) {
  if (!(max > 0)) return { top: 1, step: 1 };
  const rough = max / Y_TICK_TARGET;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough);
  return { top: Math.ceil(max / step) * step, step };
}

/**
 * Değerleri tanımsız olmayan ardışık parçalara bölüp yol çizer (ADR'si olmayan
 * dönemde çizgi kopar; sıfıra inmez).
 * @param {Array<[number, number] | null>} points
 */
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

/** Uç etiketleri arasında en az bu kadar dikey boşluk (px). */
const LABEL_GAP = 13;

/**
 * İki serinin uç etiketi; değerler yakınsa üstteki yukarı, alttaki aşağı itilir.
 * @param {Array<[number, number] | null>} pointsNow
 * @param {Array<number | null>} now
 * @param {Array<[number, number] | null>} pointsLy
 * @param {Array<number | null>} ly
 * @param {{ top: number, bottom: number }} bounds çizim alanı: etiket eksen yazısına taşmasın
 */
function endLabels(pointsNow, now, pointsLy, ly, { top, bottom }) {
  const last = (points) => points.findLastIndex((point) => point !== null);
  const labels = [];
  const iNow = last(pointsNow);
  const iLy = last(pointsLy);
  if (iNow >= 0) labels.push({ key: 'now', x: pointsNow[iNow][0], y: pointsNow[iNow][1], value: now[iNow], className: 'fill-info-ink font-bold' });
  if (iLy >= 0) labels.push({ key: 'ly', x: pointsLy[iLy][0], y: pointsLy[iLy][1], value: ly[iLy], className: 'fill-ink-muted' });
  if (labels.length === 2 && Math.abs(labels[0].y - labels[1].y) < LABEL_GAP) {
    const middle = (labels[0].y + labels[1].y) / 2;
    // Bu dönem eşitlikte üstte.
    const [upper, lower] = labels[0].y <= labels[1].y ? labels : [labels[1], labels[0]];
    upper.y = middle - LABEL_GAP / 2;
    lower.y = middle + LABEL_GAP / 2;
  }
  // Çizim alanının içinde kalsın (altta x ekseni tarihleri var).
  const lowest = Math.max(...labels.map((label) => label.y));
  const highest = Math.min(...labels.map((label) => label.y));
  const shift = lowest > bottom - LABEL_GAP / 2 ? bottom - LABEL_GAP / 2 - lowest : highest < top ? top - highest : 0;
  for (const label of labels) label.y += shift;
  return labels;
}

/** Eksen kısa sayı: 12.500 → "12,5 B". */
const compactNumber = new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 });
/** Uç etiketi tam sayı (kuruşsuz): "3.909". */
const wholeNumber = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const onePlace = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Bu dönem ile geçen yılın aynı dönemi (haftanın aynı günü) tek eksende, tek
 * ölçü (iki ölçü aynı grafiğe konmaz). Eldeki rezervasyon dönemi (iş günü ve
 * sonrası) gölgeli. Bu dönem vurgulu, geçen yıl gri bağlam; iki serinin de
 * son değeri yazılı, gerisi imleç ipucunda ve tabloda.
 *
 * @param {{ report: any, metric: 'OCCUPANCY' | 'ADR' | 'REVPAR' | 'ROOM_REVENUE' }} props
 */
export function TrendChart({ report, metric }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(/** @type {number | null} */ (null));
  const buckets = report.buckets;
  const spec = METRIC_VALUE[metric];
  const narrow = width < NARROW_PX;
  const pad = narrow ? { ...PAD, right: 16, left: 52 } : PAD;

  const now = buckets.map((bucket) => spec.read(bucket));
  const ly = buckets.map((bucket) => spec.read(bucket.lastYear));
  const values = [...now, ...ly].filter((value) => value !== null && Number.isFinite(value));
  const max = Math.max(metric === 'OCCUPANCY' ? 100 : 0, ...values, 0);
  const min = Math.min(0, ...values);
  const scale = niceScale(max - min);
  const yBottom = min < 0 ? -Math.ceil(-min / scale.step) * scale.step : 0;
  const yTop = Math.max(scale.top + yBottom, scale.step);
  const ticks = [];
  for (let tick = yBottom; tick <= yTop + 1e-9; tick += scale.step) ticks.push(Math.round(tick * 100) / 100);

  const plotWidth = Math.max(0, width - pad.left - pad.right);
  const plotHeight = HEIGHT - pad.top - pad.bottom;
  const step = buckets.length > 1 ? plotWidth / (buckets.length - 1) : 0;
  const x = (index) => (buckets.length > 1 ? pad.left + index * step : pad.left + plotWidth / 2);
  const y = (value) => pad.top + plotHeight * (1 - (value - yBottom) / (yTop - yBottom));
  const pointsNow = now.map((value, index) => (value === null ? null : [x(index), y(value)]));
  const pointsLy = ly.map((value, index) => (value === null ? null : [x(index), y(value)]));
  const otbStart = buckets.findIndex((bucket) => bucket.onTheBooksDays > 0);
  const labelSlots = Math.max(2, Math.min(MAX_X_LABELS, Math.floor(plotWidth / X_LABEL_PX)));
  const labelEvery = Math.max(1, Math.ceil(buckets.length / labelSlots));
  // Son dönem her zaman yazılır; bir önceki etikete çok yakınsa o atlanır.
  const lastLabelled = (buckets.length - 1) % labelEvery === 0 ? -1 : buckets.length - 1;
  const showLabel = (index) =>
    index === buckets.length - 1 || (index % labelEvery === 0 && !(lastLabelled >= 0 && lastLabelled - index < labelEvery * 0.75));
  const tickText = (value) => (metric === 'OCCUPANCY' ? `%${value}` : compactNumber.format(value));
  const endText = (value) => (metric === 'OCCUPANCY' ? `%${onePlace.format(value)}` : wholeNumber.format(value));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-ink-soft" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded-full bg-info" /> Bu dönem
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded-full bg-ink-muted" /> Geçen yıl (haftanın aynı günü)
        </span>
        {otbStart >= 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-4 rounded-sm bg-black/[0.05]" /> Eldeki rezervasyon
          </span>
        )}
      </div>
      <div ref={ref} className="relative w-full" style={{ height: HEIGHT }} onMouseLeave={() => setActive(null)}>
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={`${report.from} – ${report.to}: bu dönem ve geçen yıl`} className="block">
            {otbStart >= 0 && (
              <g>
                <rect
                  x={otbStart > 0 ? x(otbStart) - step / 2 : pad.left}
                  y={pad.top}
                  width={Math.max(0, width - pad.right - (otbStart > 0 ? x(otbStart) - step / 2 : pad.left))}
                  height={plotHeight}
                  fill="rgb(16 16 16 / 0.04)"
                />
                <text x={(otbStart > 0 ? x(otbStart) - step / 2 : pad.left) + 6} y={pad.top - 10} className="fill-ink-muted text-[11px]">
                  Eldeki
                </text>
              </g>
            )}

            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? 'var(--color-line-strong)' : 'var(--color-line)'} strokeWidth={1} />
                <text x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-ink-muted text-[11px] tabular-nums">
                  {tickText(tick)}
                </text>
              </g>
            ))}

            <path d={pathOf(pointsLy)} fill="none" stroke={LAST_YEAR_COLOR} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
            <path d={pathOf(pointsNow)} fill="none" stroke={CURRENT_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

            {/* Tek dönemde ya da kopuk parçada çizgi görünmez: noktalar her zaman var */}
            {pointsNow.map((point, index) =>
              point && (buckets.length <= 31 || index === active) ? (
                <circle key={`n${index}`} cx={point[0]} cy={point[1]} r={index === active ? DOT_RADIUS + 1 : DOT_RADIUS - 1} fill={CURRENT_COLOR} stroke="var(--color-surface)" strokeWidth={RING} />
              ) : null,
            )}
            {active !== null && pointsLy[active] && (
              <circle cx={pointsLy[active][0]} cy={pointsLy[active][1]} r={DOT_RADIUS} fill={LAST_YEAR_COLOR} stroke="var(--color-surface)" strokeWidth={RING} />
            )}

            {active !== null && <line x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + plotHeight} stroke="var(--color-ink)" strokeWidth={1} opacity={0.3} />}

            {/* Uç etiketleri: iki serinin son değeri (geniş ekranda); üst üste binmesin diye aralanır */}
            {!narrow &&
              endLabels(pointsNow, now, pointsLy, ly, { top: pad.top, bottom: pad.top + plotHeight }).map((label) => (
                <text key={label.key} x={label.x + 8} y={label.y} dy="0.32em" className={`text-[11px] tabular-nums ${label.className}`}>
                  {endText(label.value)}
                </text>
              ))}

            {buckets.map((bucket, index) =>
              showLabel(index) ? (
                <text key={bucket.key} x={x(index)} y={HEIGHT - pad.bottom + 18} textAnchor="middle" className="fill-ink-muted text-[11px]">
                  {axisLabel(bucket, report.groupBy)}
                </text>
              ) : null,
            )}

            {buckets.map((bucket, index) => (
              <rect
                key={bucket.key}
                x={x(index) - Math.max(step, 12) / 2}
                y={pad.top}
                width={Math.max(step, 12)}
                height={plotHeight}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${bucketLabel(bucket, report.groupBy)}: ${spec.text(now[index], report.currency)}, geçen yıl ${spec.text(ly[index], report.currency)}`}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                className="cursor-crosshair outline-none focus-visible:fill-black/[0.03]"
              />
            ))}
          </svg>
        )}
        {active !== null && width > 0 && (
          <Tooltip bucket={buckets[active]} report={report} metric={metric} left={x(active)} width={width} />
        )}
      </div>
    </div>
  );
}

/** @param {{ bucket: any, report: any, metric: string, left: number, width: number }} props */
function Tooltip({ bucket, report, metric, left, width }) {
  const spec = METRIC_VALUE[metric];
  const change = formatChange(bucket.change[spec.changeKey], spec.unit);
  const place = Math.min(Math.max(8, left - TOOLTIP_WIDTH / 2), width - TOOLTIP_WIDTH - 8);
  return (
    <div role="status" className="pointer-events-none absolute top-1 rounded-control border border-line bg-surface px-3 py-2 text-xs shadow-float" style={{ left: place, width: TOOLTIP_WIDTH }}>
      <p className="font-semibold text-ink-muted">
        {bucketLabel(bucket, report.groupBy)}
        {bucket.onTheBooksDays > 0 ? ` · ${bucket.onTheBooksDays === bucket.days ? 'eldeki' : 'kısmen eldeki'}` : ''}
      </p>
      <p className="mt-1 flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded-full bg-info" />
        <span className="text-base font-bold text-ink">{spec.text(spec.read(bucket), report.currency)}</span>
        <span className="text-ink-muted">{change.text}</span>
      </p>
      <p className="mt-0.5 flex items-center gap-2 text-ink-soft">
        <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded-full bg-ink-muted" />
        {spec.text(spec.read(bucket.lastYear), report.currency)}
        <span className="text-ink-muted">
          ({fullDate(bucket.lastYear.from)}
          {bucket.lastYear.to !== bucket.lastYear.from ? ` – ${fullDate(bucket.lastYear.to)}` : ''})
        </span>
      </p>
      <p className="mt-1 text-ink-muted">
        {bucket.sold} / {bucket.sellable} oda gecesi
      </p>
    </div>
  );
}
