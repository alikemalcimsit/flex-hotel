import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { REPORT_GROUPINGS, REPORT_GROUPING_LABELS, REPORT_METRICS, REPORT_METRIC_LABELS, reportRangeSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, EmptyState, Icon, Input, Spinner } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { METRIC_VALUE, bucketLabel, formatChange, formatPct, fullDate, localDay, reportKeys, reportPresets } from '../../lib/reports.js';
import { validateWith } from '../../lib/validate.js';
import { TrendChart } from './TrendChart.jsx';

const GROUP_OPTIONS = REPORT_GROUPINGS.map((value) => ({ value, label: REPORT_GROUPING_LABELS[value] }));
const METRIC_OPTIONS = REPORT_METRICS.map((value) => ({ value, label: REPORT_METRIC_LABELS[value].split(' (')[0] }));
/** Rapor ağır sorgudur: aynı aralık bir dakika boyunca yeniden istenmez (sunucu da önbellekler). */
const REPORT_STALE_MS = 60_000;

/**
 * Gelir raporları (modül 23): doluluk, ADR, RevPAR ve oda geliri — tarih
 * aralığı, gün / hafta / ay; geçen yılın haftanın aynı günüyle karşılaştırma;
 * oda tipi ve kaynak kırılımı. `reports.view` (müdür, muhasebe).
 */
export function RevenueReportPage() {
  const today = useMemo(() => localDay(), []);
  const presets = useMemo(() => reportPresets(today), [today]);
  const [preset, setPreset] = useState('THIS_MONTH');
  const [draft, setDraft] = useState(() => ({ from: presets[0].from, to: presets[0].to, groupBy: presets[0].groupBy }));
  const [params, setParams] = useState(draft);
  const [errors, setErrors] = useState({});
  const [metric, setMetric] = useState('OCCUPANCY');
  const [showTable, setShowTable] = useState(false);

  const report = useQuery({
    queryKey: reportKeys.revenue(params),
    queryFn: () => api(withQuery('/reports/revenue', params)),
    staleTime: REPORT_STALE_MS,
    placeholderData: (previous) => previous,
  });

  function apply(next) {
    const checked = validateWith(reportRangeSchema, next);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setParams(checked.data);
  }

  function choosePreset(key) {
    const chosen = presets.find((item) => item.key === key);
    setPreset(key);
    const next = { from: chosen.from, to: chosen.to, groupBy: chosen.groupBy };
    setDraft(next);
    apply(next);
  }

  const data = report.data;
  const empty = data && data.totals.sold === 0 && data.totals.lastYear.sold === 0 && data.totals.totalRevenue === '0.00';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Gelir raporları"
        description="Doluluk, ADR, RevPAR ve oda geliri; geçen yılın aynı dönemiyle (haftanın aynı günü). Gelir vergiler hariç: geçmiş günler folyoya işlenen, bugün ve sonrası eldeki rezervasyon."
      />

      <Card>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setPreset('CUSTOM');
            apply(draft);
          }}
          noValidate
        >
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Hazır aralıklar">
            {presets.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={preset === item.key}
                onClick={() => choosePreset(item.key)}
                className={`rounded-full border px-3 py-1 text-sm font-semibold ${preset === item.key ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Input label="Başlangıç" type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} error={errors.from} className="w-44" />
            <Input label="Bitiş" type="date" value={draft.to} min={draft.from || undefined} onChange={(event) => setDraft({ ...draft, to: event.target.value })} error={errors.to} className="w-44" />
            <ChoiceChips
              label="Gruplama"
              required
              options={GROUP_OPTIONS}
              value={draft.groupBy}
              onChange={(groupBy) => {
                // Gruplama hemen uygulanır (tarih alanları "Raporu getir" ile: her tuşta istek gitmesin).
                const next = { ...draft, groupBy };
                setDraft(next);
                apply(next);
              }}
            />
            <Button type="submit" icon="refresh" disabled={report.isFetching}>Raporu getir</Button>
          </div>
        </form>
      </Card>

      {report.isPending ? (
        <Spinner label="Rapor hazırlanıyor…" className="py-12" />
      ) : report.isError ? (
        <Alert tone="danger" title="Rapor alınamadı" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => report.refetch()}>Tekrar dene</Button>}>
          {report.error.message}
        </Alert>
      ) : (
        <div className={`flex flex-col gap-6 transition-opacity duration-200 ${report.isFetching ? 'opacity-60' : ''}`}>
          <p className="text-sm text-ink-soft">
            {fullDate(data.from)} – {fullDate(data.to)} · geçen yıl {fullDate(data.lastYear.from)} – {fullDate(data.lastYear.to)}
            {data.buckets.some((bucket) => bucket.onTheBooksDays > 0) && ` · ${fullDate(data.businessDate)} ve sonrası eldeki rezervasyon`}
          </p>
          {data.otherCurrencyNights > 0 && (
            <Alert tone="warning" title={`${data.otherCurrencyNights} gece başka para biriminde`}>
              Otelin para birimi ({data.currency}) dışındaki rezervasyonlar rapora karıştırılmadı.
            </Alert>
          )}

          {empty ? (
            <EmptyState icon="chart" title="Bu aralıkta satış yok" description="Seçilen tarihlerde ve geçen yılın aynı döneminde satılan oda gecesi ya da gelir bulunamadı." />
          ) : (
            <>
              <Kpis report={data} />
              <Card
                title={REPORT_METRIC_LABELS[metric]}
                actions={
                  <Button variant="outline" size="sm" icon={showTable ? 'chart' : 'list'} onClick={() => setShowTable((value) => !value)} aria-pressed={showTable}>
                    {showTable ? 'Grafik' : 'Tablo'}
                  </Button>
                }
              >
                <div className="flex flex-col gap-4">
                  {!showTable && <ChoiceChips label="Ölçü" required options={METRIC_OPTIONS} value={metric} onChange={setMetric} />}
                  {showTable ? <PeriodTable report={data} /> : <TrendChart report={data} metric={metric} />}
                </div>
              </Card>
              <div className="grid gap-6 xl:grid-cols-2">
                <Breakdown title="Oda tipine göre" rows={data.breakdowns.roomType} currency={data.currency} />
                <Breakdown title="Rezervasyon kaynağına göre" rows={data.breakdowns.source} currency={data.currency} />
              </div>
              <Definitions report={data} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Değişim rozeti: yön işaretli metin (renk tek başına anlam taşımaz).
 * @param {{ value: number | null, unit?: 'pct' | 'pts' }} props
 */
function Change({ value, unit = 'pct' }) {
  const change = formatChange(value, unit);
  const tone = change.direction === 'up' ? 'text-success-ink' : change.direction === 'down' ? 'text-danger-ink' : 'text-ink-muted';
  return (
    <span className={`inline-flex items-center gap-0.5 tabular-nums ${tone}`}>
      {change.direction === 'up' && <Icon name="arrowRight" className="size-3 -rotate-45" />}
      {change.direction === 'down' && <Icon name="arrowRight" className="size-3 rotate-45" />}
      {change.text}
    </span>
  );
}

/** @param {{ report: any }} props */
function Kpis({ report }) {
  const { totals, currency } = report;
  const tiles = [
    { label: 'Doluluk', value: formatPct(totals.occupancyPct), ly: formatPct(totals.lastYear.occupancyPct), change: totals.change.occupancyPts, unit: 'pts', hint: `${totals.sold} / ${totals.sellable} oda gecesi` },
    { label: 'ADR', value: totals.adr === null ? '—' : formatMoney(totals.adr, currency), ly: totals.lastYear.adr === null ? '—' : formatMoney(totals.lastYear.adr, currency), change: totals.change.adr, unit: 'pct', hint: 'Oda geliri / satılan gece' },
    { label: 'RevPAR', value: totals.revpar === null ? '—' : formatMoney(totals.revpar, currency), ly: totals.lastYear.revpar === null ? '—' : formatMoney(totals.lastYear.revpar, currency), change: totals.change.revpar, unit: 'pct', hint: 'Oda geliri / satılabilir oda' },
    { label: 'Oda geliri', value: formatMoney(totals.roomRevenue, currency), ly: formatMoney(totals.lastYear.roomRevenue, currency), change: totals.change.roomRevenue, unit: 'pct', hint: `Ek ücret ${formatMoney(totals.fees, currency)} · iptal ${formatMoney(totals.cancellations, currency)}` },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-card bg-surface p-4 shadow-soft sm:p-5">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{tile.label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink sm:text-3xl">{tile.value}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-soft">
            <span>Geçen yıl {tile.ly}</span>
            <Change value={tile.change} unit={tile.unit} />
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-muted">{tile.hint}</p>
        </div>
      ))}
    </div>
  );
}

/** Dönem tablosu (grafiğin erişilebilir ikizi, toplam satırıyla). @param {{ report: any }} props */
function PeriodTable({ report }) {
  const { currency } = report;
  const money = (value) => (value === null ? '—' : formatMoney(value, currency));
  const row = (item, label, key, strong = false) => (
    <tr key={key} className={`border-t border-line ${strong ? 'font-bold' : ''}`}>
      <th scope="row" className="whitespace-nowrap px-2 py-2 text-left font-semibold text-ink">
        {label}
        {item.onTheBooksDays > 0 && <span className="ml-1 text-xs font-normal text-ink-muted">{item.onTheBooksDays === item.days ? '(eldeki)' : '(kısmen eldeki)'}</span>}
      </th>
      <td className="px-2 py-2 text-right tabular-nums">{item.sold} / {item.sellable}</td>
      <td className="px-2 py-2 text-right tabular-nums">{formatPct(item.occupancyPct)}</td>
      <td className="px-2 py-2 text-right tabular-nums text-ink-muted">{formatPct(item.lastYear.occupancyPct)}</td>
      <td className="px-2 py-2 text-right"><Change value={item.change.occupancyPts} unit="pts" /></td>
      <td className="px-2 py-2 text-right tabular-nums">{money(item.adr)}</td>
      <td className="px-2 py-2 text-right"><Change value={item.change.adr} /></td>
      <td className="px-2 py-2 text-right tabular-nums">{money(item.revpar)}</td>
      <td className="px-2 py-2 text-right"><Change value={item.change.revpar} /></td>
      <td className="px-2 py-2 text-right tabular-nums">{money(item.roomRevenue)}</td>
      <td className="px-2 py-2 text-right tabular-nums text-ink-muted">{money(item.lastYear.roomRevenue)}</td>
      <td className="px-2 py-2 text-right"><Change value={item.change.roomRevenue} /></td>
      <td className="px-2 py-2 text-right tabular-nums">{money(item.discounts)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{money(item.fees)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{money(item.cancellations)}</td>
    </tr>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[72rem] text-sm">
        <thead className="text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
          <tr>
            {['Dönem', 'Satılan / satılabilir', 'Doluluk', 'Geçen yıl', 'Fark', 'ADR', 'Değişim', 'RevPAR', 'Değişim', 'Oda geliri', 'Geçen yıl', 'Değişim', 'İndirim', 'Ek ücret', 'İptal geliri'].map((label, index) => (
              <th key={`${label}${index}`} scope="col" className={`px-2 py-2 font-bold ${index === 0 ? '' : 'text-right'}`}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.buckets.map((bucket) => row(bucket, bucketLabel(bucket, report.groupBy), bucket.key))}
          {row({ ...report.totals, onTheBooksDays: 0, days: 0 }, 'Toplam', 'total', true)}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Kırılım: gelir payı tek renk yatay çubuk (kategori kimliği renkle değil
 * etiketle), yanında gece, ADR ve geçen yıl.
 * @param {{ title: string, rows: any[], currency: string }} props
 */
function Breakdown({ title, rows, currency }) {
  const visible = rows.filter((row) => row.sold > 0 || row.lastYear.sold > 0 || row.roomRevenue !== '0.00');
  return (
    <Card title={title}>
      {visible.length === 0 ? (
        <p className="text-sm text-ink-muted">Bu aralıkta satış yok.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((row) => (
            <li key={row.key} className="flex flex-col gap-1 text-sm">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-ink">{row.label}</span>
                <span className="tabular-nums text-ink">
                  {formatMoney(row.roomRevenue, currency)} <span className="text-ink-muted">· {formatPct(row.sharePct)}</span>
                </span>
              </span>
              <span className="block h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                <span className="block h-full rounded-full bg-info" style={{ width: `${Math.max(0, Math.min(100, row.sharePct ?? 0))}%` }} />
              </span>
              <span className="flex flex-wrap gap-x-3 text-xs text-ink-muted">
                <span>{row.sold} gece</span>
                <span>ADR {row.adr === null ? '—' : formatMoney(row.adr, currency)}</span>
                <span>
                  Geçen yıl {formatMoney(row.lastYear.roomRevenue, currency)} <Change value={row.change.roomRevenue} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** @param {{ report: any }} props */
function Definitions({ report }) {
  return (
    <details className="rounded-card bg-surface p-4 text-sm text-ink-soft shadow-soft">
      <summary className="cursor-pointer font-semibold text-ink">Rakamlar nasıl hesaplanıyor?</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Satılan oda gecesi: opsiyonlu, kesin ve içerideki konaklamaların geceleri; çıkış yapanın yalnızca kaldığı geceler. İptal ve gelmeyen sayılmaz.</li>
        <li>Satılabilir oda: kayıtlı oda − o gece arızalı oda (hizmet dışı oda satılabilir sayılır).</li>
        <li>Oda geliri vergiler hariçtir. {fullDate(report.businessDate)} öncesi folyoya işlenen gerçekleşen gelir (fiyat düzeltmeleri, oda indirimleri ve iptaller işlendiği güne); bugün ve sonrası rezervasyonun gece fiyatından eldeki gelir (dahil vergi %{report.includedTaxRate} ayrılarak).</li>
        <li>ADR = oda geliri / satılan gece; RevPAR = oda geliri / satılabilir oda. Erken giriş / geç çıkış ücretleri ve iptal / gelmeme gelirleri ayrı sütundadır, ADR'ye girmez.</li>
        <li>Geçen yıl: haftanın aynı günü (364 gün önce). Oranlar dönem toplamlarından hesaplanır.</li>
      </ul>
    </details>
  );
}
