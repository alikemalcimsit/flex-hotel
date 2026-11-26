import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { chainReportQuerySchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Input } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { api, withQuery } from '../../lib/api.js';
import { CHANGE_TONES, chainKeys, withHotelRowIds } from '../../lib/chain.js';
import { formatMoney } from '../../lib/format.js';
import { downloadReportExcel } from '../../lib/reportChat.js';
import { formatChange, formatPct, fullDate, localDay, reportPresets } from '../../lib/reports.js';
import { validateWith } from '../../lib/validate.js';
import { toastError } from '../../store/toast.js';

/** Rapor ağır sorgudur (otel başına gelir raporu): aynı aralık bir dakika yeniden istenmez. */
const REPORT_STALE_MS = 60_000;

/** @param {{ value: number | null, unit?: 'pct' | 'pts' }} props */
function Change({ value, unit = 'pct' }) {
  const change = formatChange(value, unit);
  return <span className={`block text-xs ${CHANGE_TONES[change.direction]}`}>{change.text}</span>;
}

/**
 * Zincir raporu: seçilen aralıkta oteller karşılaştırmalı — doluluk, satılan / satılabilir oda, oda ve toplam gelir,
 * ADR, RevPAR; geçen yılın aynı dönemiyle (haftanın aynı günü). Rakamlar her otelin gelir raporundan (modül 23).
 * Para birimine göre toplam; Excel'e aktarılır.
 */
export function ChainReportTab() {
  const today = useMemo(() => localDay(), []);
  const presets = useMemo(() => reportPresets(today), [today]);
  const [preset, setPreset] = useState('THIS_MONTH');
  const [draft, setDraft] = useState({ from: presets[0].from, to: presets[0].to });
  const [params, setParams] = useState(draft);
  const [errors, setErrors] = useState({});
  const [exporting, setExporting] = useState(false);

  const report = useQuery({
    queryKey: chainKeys.report(params.from, params.to),
    queryFn: () => api(withQuery('/chain/report', params)),
    select: withHotelRowIds,
    staleTime: REPORT_STALE_MS,
    placeholderData: (previous) => previous,
  });

  function apply(next) {
    const checked = validateWith(chainReportQuerySchema, next);
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
    const next = { from: chosen.from, to: chosen.to };
    setDraft(next);
    apply(next);
  }

  const data = report.data;

  async function exportExcel() {
    if (!data) return;
    setExporting(true);
    try {
      const rows = data.hotels.filter((row) => !row.error);
      await downloadReportExcel({
        title: `${data.group.name} zincir raporu`,
        periodLabel: `${fullDate(data.from)} – ${fullDate(data.to)}`,
        dataset: {
          columns: [
            { key: 'name', label: 'Otel', kind: 'text' },
            { key: 'code', label: 'Kod', kind: 'text' },
            { key: 'currency', label: 'Para birimi', kind: 'text' },
            { key: 'occupancyPct', label: 'Doluluk %', kind: 'percent' },
            { key: 'lyOccupancyPct', label: 'Geçen yıl doluluk %', kind: 'percent' },
            { key: 'sold', label: 'Satılan oda', kind: 'number' },
            { key: 'sellable', label: 'Satılabilir oda', kind: 'number' },
            { key: 'roomRevenue', label: 'Oda geliri', kind: 'money' },
            { key: 'lyRoomRevenue', label: 'Geçen yıl oda geliri', kind: 'money' },
            { key: 'totalRevenue', label: 'Toplam gelir', kind: 'money' },
            { key: 'adr', label: 'ADR', kind: 'money' },
            { key: 'revpar', label: 'RevPAR', kind: 'money' },
          ],
          rows: [
            ...rows.map((row) => ({ ...row, lyOccupancyPct: row.lastYear.occupancyPct, lyRoomRevenue: row.lastYear.roomRevenue })),
            ...data.totals.map((total) => ({
              ...total,
              name: `Toplam (${total.hotels} otel)`,
              code: '',
              lyOccupancyPct: total.lastYear.occupancyPct,
              lyRoomRevenue: total.lastYear.roomRevenue,
            })),
          ],
          notes: [
            'Gelir vergiler hariç: geçmiş günler folyoya işlenen, bugün ve sonrası eldeki rezervasyon. Para birimleri ayrı toplanır.',
            ...(data.hiddenHotels > 0 ? [`${data.hiddenHotels} otel yetki olmadığı için rapora katılmadı.`] : []),
            ...(data.failedHotels > 0 ? [`${data.failedHotels} otel hesaplanamadı.`] : []),
          ],
        },
      });
    } catch (error) {
      toastError(`Excel dosyası hazırlanamadı: ${error.message}`);
    } finally {
      setExporting(false);
    }
  }

  const columns = [
    {
      key: 'name',
      header: 'Otel',
      render: (row) => (
        <div className="min-w-0">
          <span className="block truncate font-semibold text-ink">{row.name}</span>
          <span className="block text-xs text-ink-muted">{row.code}</span>
        </div>
      ),
    },
    {
      key: 'occupancy',
      header: 'Doluluk',
      className: 'whitespace-nowrap text-right tabular-nums',
      render: (row) => (row.error ? '—' : <><span className="font-semibold">{formatPct(row.occupancyPct)}</span><Change value={row.change.occupancyPts} unit="pts" /></>),
    },
    { key: 'sold', header: 'Satılan / satılabilir', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => (row.error ? '—' : `${row.sold.toLocaleString('tr-TR')} / ${row.sellable.toLocaleString('tr-TR')}`) },
    {
      key: 'roomRevenue',
      header: 'Oda geliri',
      className: 'whitespace-nowrap text-right tabular-nums',
      render: (row) => (row.error ? '—' : <>{formatMoney(row.roomRevenue, row.currency)}<Change value={row.change.roomRevenue} /></>),
    },
    { key: 'totalRevenue', header: 'Toplam gelir', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => (row.error ? '—' : formatMoney(row.totalRevenue, row.currency)) },
    { key: 'adr', header: 'ADR', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => (row.error ? '—' : <>{formatMoney(row.adr, row.currency)}<Change value={row.change.adr} /></>) },
    { key: 'revpar', header: 'RevPAR', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => (row.error ? '—' : <>{formatMoney(row.revpar, row.currency)}<Change value={row.change.revpar} /></>) },
    { key: 'state', header: '', render: (row) => (row.error ? <Badge tone="danger">{row.error}</Badge> : null) },
  ];

  return (
    <div className="flex flex-col gap-4">
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
            <Button type="submit" icon="refresh" disabled={report.isFetching}>Raporu getir</Button>
            <Button variant="outline" icon="download" onClick={exportExcel} disabled={!data || exporting || report.isFetching}>
              {exporting ? 'Hazırlanıyor…' : "Excel'e aktar"}
            </Button>
          </div>
        </form>
      </Card>

      {data && data.totals.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.totals.map((total) => (
            <Card key={total.currency}>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Zincir toplamı · {total.hotels} otel · {total.currency}</p>
              <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-ink-muted">Doluluk</p>
                  <p className="text-2xl font-bold tabular-nums text-ink">{formatPct(total.occupancyPct)}</p>
                  <Change value={total.change.occupancyPts} unit="pts" />
                </div>
                <div>
                  <p className="text-xs text-ink-muted">Oda geliri</p>
                  <p className="text-lg font-bold tabular-nums text-ink">{formatMoney(total.roomRevenue, total.currency)}</p>
                  <Change value={total.change.roomRevenue} />
                </div>
                <div>
                  <p className="text-xs text-ink-muted">ADR</p>
                  <p className="font-semibold tabular-nums text-ink">{formatMoney(total.adr, total.currency)}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-muted">RevPAR</p>
                  <p className="font-semibold tabular-nums text-ink">{formatMoney(total.revpar, total.currency)}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {data?.hiddenHotels > 0 && <Alert tone="info">Zincirdeki {data.hiddenHotels} otel, orada zinciri görme yetkiniz olmadığı için rapora katılmadı.</Alert>}
      {data?.failedHotels > 0 && (
        <Alert tone="warning" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => report.refetch()}>Tekrar dene</Button>}>
          {data.failedHotels} otelin rakamları hesaplanamadı; toplamlara katılmadı.
        </Alert>
      )}

      <div className={report.isFetching && data ? 'opacity-60 transition-opacity' : ''}>
        <DataTable
          columns={columns}
          rows={data?.hotels}
          isLoading={report.isPending}
          isFetching={report.isFetching}
          error={report.isError ? report.error : null}
          onRetry={() => report.refetch()}
          emptyTitle="Gösterilecek otel yok"
          emptyHint="Zincirdeki otellerin hiçbirinde zinciri görme yetkiniz yok."
        />
      </div>
      {data && (
        <p className="text-xs text-ink-muted">
          {fullDate(data.from)} – {fullDate(data.to)}. Gelir vergiler hariç: geçmiş günler folyoya işlenen, bugün ve sonrası eldeki rezervasyon. Değişimler geçen yılın aynı dönemine göre (haftanın aynı günü); doluluk farkı puan.
        </p>
      )}
    </div>
  );
}
