import { useState } from 'react';
import { FORECAST_ALERT_LABELS, FORECAST_BASIS_LABELS } from '@hotelos/hotel-contracts';
import { longDay } from '../../lib/dashboard.js';
import { ALERT_STYLE, signedNights } from '../../lib/forecast.js';
import { formatMoney } from '../../lib/format.js';
import { formatPct } from '../../lib/reports.js';
import { useElementWidth } from '../../lib/useElementWidth.js';

/** Çizim alanı (px); yükseklik kritik gün şeridini ve x eksenini de içerir. */
const HEIGHT = 260;
const PAD = Object.freeze({ top: 20, right: 40, bottom: 52, left: 44 });
/** Y ekseni doluluk yüzdesi 0–100; fazla satış / tahmin %100'ü aşarsa eksen açılır. */
const Y_STEP = 25;
const Y_MIN_TOP = 100;
/** Çubuk genişliği gün aralığının bu oranı, en fazla bu kadar piksel. */
const BAR_RATIO = 0.62;
const BAR_MAX_PX = 18;
/** Tahmin noktası (içi boş: kesin değil) ve kesikli çizgi. */
const DOT_RADIUS = 3;
const FORECAST_DASH = '5 4';
const THRESHOLD_DASH = '3 3';
/** Eksen yazıları arasında en az bu kadar piksel (telefonda seyrelir). */
const X_LABEL_PX = 46;
/** Kritik gün işaretinin ve eksen yazısının çizim alanından uzaklığı. */
const MARKER_OFFSET = 14;
const LABEL_OFFSET = 36;
const TOOLTIP_WIDTH = 240;

const OTB_COLOR = 'var(--color-info)';
const FORECAST_COLOR = 'var(--color-ink)';
const THRESHOLD_COLOR = 'var(--color-warning)';

const monthDay = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dateOf = (isoDay) => new Date(`${isoDay}T00:00:00.000Z`);

/**
 * Önümüzdeki günlerin doluluğu (modül 25): eldeki rezervasyon (gerçek) dolu
 * çubuk, tahmin kesikli çizgi; kritik gün eşikleri kesikli yatay çizgi,
 * kritik günler eksenin üstünde şekil + renkle (yalnız renge dayanmaz).
 * Ayrıntı imleçte / klavyede; aynı değerler tablo görünümünde.
 *
 * @param {{ forecast: any }} props
 */
export function ForecastChart({ forecast }) {
  const [ref, width] = useElementWidth();
  const [active, setActive] = useState(/** @type {number | null} */ (null));
  const rows = forecast.rows;
  const { lowPct, highPct } = forecast.settings;

  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const band = rows.length > 0 ? plotWidth / rows.length : 0;
  const barWidth = Math.min(BAR_MAX_PX, band * BAR_RATIO);
  const peak = Math.max(0, ...rows.flatMap((row) => [row.onBooks.occupancyPct ?? 0, row.forecast.occupancyPct ?? 0]));
  const yTop = Math.max(Y_MIN_TOP, Math.ceil(peak / Y_STEP) * Y_STEP);
  const yTicks = Array.from({ length: yTop / Y_STEP + 1 }, (_, index) => index * Y_STEP);
  const center = (index) => PAD.left + band * (index + 0.5);
  const y = (value) => PAD.top + plotHeight * (1 - Math.max(0, value ?? 0) / yTop);
  const base = y(0);

  const forecastPoints = rows.map((row, index) => [center(index), y(row.forecast.occupancyPct)]);
  const forecastLine = forecastPoints.map(([px, py], index) => `${index === 0 ? 'M' : 'L'}${px},${py}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(X_LABEL_PX / Math.max(band, 1)));
  // Yazılan ilk gün ve ayı bir öncekinden farklı olan gün ay adıyla ("1 Kas"); diğerleri yalnız gün.
  const axisLabel = (row, index) => {
    if (index === 0) return 'Bugün';
    const previous = rows[index - labelEvery];
    const newMonth = index === labelEvery || row.date.slice(0, 7) !== previous.date.slice(0, 7);
    return newMonth ? monthDay.format(dateOf(row.date)) : String(Number(row.date.slice(8)));
  };

  return (
    <div>
      <Legend lowPct={lowPct} highPct={highPct} />
      <div ref={ref} className="relative mt-2 w-full" style={{ height: HEIGHT }} onMouseLeave={() => setActive(null)}>
        {width > 0 && rows.length > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Önümüzdeki ${rows.length} günün doluluğu: eldeki rezervasyon ve tahmin, ${rows[0].date} – ${rows.at(-1).date}`}
            className="block"
          >
            {yTicks.map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} stroke={tick === 100 && yTop > 100 ? 'var(--color-line-strong)' : 'var(--color-line)'} strokeWidth={1} />
                <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-ink-muted text-[11px] tabular-nums">
                  %{tick}
                </text>
              </g>
            ))}

            {/* Eldeki (gerçek): dolu çubuk */}
            {rows.map((row, index) => {
              const top = y(row.onBooks.occupancyPct);
              return (
                <rect
                  key={row.date}
                  x={center(index) - barWidth / 2}
                  y={top}
                  width={barWidth}
                  height={Math.max(0, base - top)}
                  rx={Math.min(3, barWidth / 4)}
                  fill={OTB_COLOR}
                  opacity={active === null || active === index ? 0.9 : 0.55}
                />
              );
            })}

            {/* Eşikler: yazısı sağda, çizgiyle aynı renk */}
            {[
              ['low', lowPct],
              ['high', highPct],
            ].map(([key, value]) => (
              <g key={key}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(value)} y2={y(value)} stroke={THRESHOLD_COLOR} strokeWidth={1.5} strokeDasharray={THRESHOLD_DASH} />
                <text x={width - PAD.right + 6} y={y(value)} dy="0.32em" className="fill-warning-ink text-[11px] font-semibold tabular-nums">
                  %{value}
                </text>
              </g>
            ))}

            {/* Tahmin: kesikli çizgi, içi boş nokta */}
            <path d={forecastLine} fill="none" stroke={FORECAST_COLOR} strokeWidth={2} strokeDasharray={FORECAST_DASH} strokeLinejoin="round" />
            {forecastPoints.map(([px, py], index) => (
              <circle
                key={rows[index].date}
                cx={px}
                cy={py}
                r={index === active ? DOT_RADIUS + 1.5 : DOT_RADIUS}
                fill="var(--color-surface)"
                stroke={FORECAST_COLOR}
                strokeWidth={1.5}
              />
            ))}

            {active !== null && <line x1={center(active)} x2={center(active)} y1={PAD.top} y2={base} stroke="var(--color-ink)" strokeWidth={1} opacity={0.3} />}

            {/* Kritik günler: eksenin üstünde şekil + renk */}
            {rows.map((row, index) =>
              row.alert ? (
                <text
                  key={row.date}
                  x={center(index)}
                  y={base + MARKER_OFFSET}
                  textAnchor="middle"
                  dy="0.32em"
                  className="text-[10px] font-bold"
                  fill={ALERT_STYLE[row.alert].color}
                  aria-hidden="true"
                >
                  {ALERT_STYLE[row.alert].glyph}
                </text>
              ) : null,
            )}

            {rows.map((row, index) =>
              index % labelEvery === 0 ? (
                <text
                  key={row.date}
                  x={center(index)}
                  y={base + LABEL_OFFSET}
                  textAnchor="middle"
                  className={`text-[11px] tabular-nums ${index === 0 ? 'fill-ink font-bold' : 'fill-ink-muted'}`}
                >
                  {axisLabel(row, index)}
                </text>
              ) : null,
            )}

            {/* Vuruş alanları: günün bütün sütunu; klavyeyle de gezilir */}
            {rows.map((row, index) => (
              <rect
                key={row.date}
                x={PAD.left + band * index}
                y={PAD.top}
                width={band}
                height={plotHeight + MARKER_OFFSET + 8}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${longDay(row.date)}: eldeki yüzde ${row.onBooks.occupancyPct ?? 0}, tahmin yüzde ${row.forecast.occupancyPct ?? 0}${row.alert ? `, ${FORECAST_ALERT_LABELS[row.alert]}` : ''}`}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                className="cursor-crosshair outline-none focus-visible:fill-black/[0.04]"
              />
            ))}
          </svg>
        )}
        {active !== null && width > 0 && <Tooltip row={rows[active]} currency={forecast.currency} left={center(active)} width={width} />}
      </div>
    </div>
  );
}

/** @param {{ lowPct: number, highPct: number }} props */
function Legend({ lowPct, highPct }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft" aria-label="Lejant">
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-block h-3 w-2.5 rounded-sm bg-info" />
        Eldeki rezervasyon (gerçek)
      </li>
      <li className="flex items-center gap-1.5">
        <svg width="22" height="8" aria-hidden="true">
          <line x1="0" x2="22" y1="4" y2="4" stroke={FORECAST_COLOR} strokeWidth="2" strokeDasharray={FORECAST_DASH} />
        </svg>
        Tahmin
      </li>
      <li className="flex items-center gap-1.5">
        <svg width="22" height="8" aria-hidden="true">
          <line x1="0" x2="22" y1="4" y2="4" stroke={THRESHOLD_COLOR} strokeWidth="1.5" strokeDasharray={THRESHOLD_DASH} />
        </svg>
        Kritik eşik %{lowPct} / %{highPct}
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="font-bold text-warning-ink">▼▲</span>
        <span aria-hidden="true" className="font-bold text-danger-ink">!</span>
        Kritik gün
      </li>
    </ul>
  );
}

/** @param {{ row: any, currency: string, left: number, width: number }} props */
function Tooltip({ row, currency, left, width }) {
  const place = Math.min(Math.max(8, left - TOOLTIP_WIDTH / 2), width - TOOLTIP_WIDTH - 8);
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-0 rounded-control border border-line bg-surface px-3 py-2 text-xs shadow-float"
      style={{ left: place, width: TOOLTIP_WIDTH }}
    >
      <p className="font-semibold text-ink-muted">
        {longDay(row.date)} · {row.lead === 0 ? 'bugün' : `${row.lead} gün sonra`}
      </p>
      <p className="mt-1 flex items-baseline gap-2">
        <span aria-hidden="true" className="inline-block h-2.5 w-2 rounded-sm bg-info" />
        <span className="text-ink-soft">Eldeki</span>
        <span className="font-bold text-ink">{formatPct(row.onBooks.occupancyPct)}</span>
        <span className="text-ink-muted">
          {row.onBooks.sold} / {row.sellable} oda
        </span>
      </p>
      <p className="mt-0.5 flex items-baseline gap-2">
        <span aria-hidden="true" className="inline-block w-2 border-t-2 border-dashed border-ink" />
        <span className="text-ink-soft">Tahmin</span>
        <span className="font-bold text-ink">{formatPct(row.forecast.occupancyPct)}</span>
        <span className="text-ink-muted">
          ≈ {Math.round(row.forecast.nights)} oda ({signedNights(row.forecast.pickup)})
        </span>
      </p>
      <p className="mt-1 text-ink-soft">
        Gelir: eldeki {formatMoney(row.onBooks.revenue, currency)} · tahmin {formatMoney(row.forecast.revenue, currency)}
      </p>
      <p className="mt-0.5 text-ink-muted">
        Geçen yıl aynı gün {formatPct(row.lastYear.occupancyPct)} · {FORECAST_BASIS_LABELS[row.basis]}
        {row.samples > 0 ? ` (${row.samples} gün)` : ''}
      </p>
      {row.alert && (
        <p className={`mt-1 font-semibold ${row.alert === 'OVERBOOKED' ? 'text-danger-ink' : 'text-warning-ink'}`}>
          {ALERT_STYLE[row.alert].glyph} {FORECAST_ALERT_LABELS[row.alert]}
        </p>
      )}
    </div>
  );
}

/** Grafiğin erişilebilir ikizi: aynı değerler tabloda. @param {{ forecast: any }} props */
export function ForecastTable({ forecast }) {
  const money = (value) => formatMoney(value, forecast.currency);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-sm">
        <thead className="text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
          <tr>
            <th scope="col" className="px-2 py-2 font-bold">Gün</th>
            <th scope="col" className="px-2 py-2 text-right font-bold">Eldeki</th>
            <th scope="col" className="px-2 py-2 text-right font-bold">Tahmin</th>
            <th scope="col" className="px-2 py-2 text-right font-bold">Beklenen</th>
            <th scope="col" className="px-2 py-2 text-right font-bold">Geçen yıl</th>
            <th scope="col" className="px-2 py-2 text-right font-bold">Eldeki gelir</th>
            <th scope="col" className="px-2 py-2 text-right font-bold">Tahmini gelir</th>
            <th scope="col" className="px-2 py-2 font-bold">Kaynak</th>
            <th scope="col" className="px-2 py-2 font-bold">Uyarı</th>
          </tr>
        </thead>
        <tbody>
          {forecast.rows.map((row) => (
            <tr key={row.date} className={`border-t border-line ${row.lead === 0 ? 'font-bold' : ''}`}>
              <th scope="row" className="px-2 py-2 text-left font-semibold text-ink">
                {longDay(row.date)}
              </th>
              <td className="px-2 py-2 text-right tabular-nums">
                {formatPct(row.onBooks.occupancyPct)} <span className="text-ink-muted">({row.onBooks.sold}/{row.sellable})</span>
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{formatPct(row.forecast.occupancyPct)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{signedNights(row.forecast.pickup)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatPct(row.lastYear.occupancyPct)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{money(row.onBooks.revenue)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{money(row.forecast.revenue)}</td>
              <td className="px-2 py-2 text-ink-soft">{FORECAST_BASIS_LABELS[row.basis]}</td>
              <td className={`px-2 py-2 ${row.alert === 'OVERBOOKED' ? 'text-danger-ink' : 'text-warning-ink'}`}>
                {row.alert ? `${ALERT_STYLE[row.alert].glyph} ${FORECAST_ALERT_LABELS[row.alert]}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
