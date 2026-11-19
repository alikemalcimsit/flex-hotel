import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SPA_CATEGORY_LABELS, SPA_SERVICE_KIND_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, EmptyState, Select, Spinner } from '@hotelos/ui';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatMoney, formatPercent } from '../../lib/format.js';
import { dottedDay, rangeOf, spaKeys } from '../../lib/spa.js';

const PERIODS = Object.freeze([
  { value: 'past7', label: 'Son 7 gün' },
  { value: 'past30', label: 'Son 30 gün' },
  { value: 'past365', label: 'Son 1 yıl' },
  { value: 'month', label: 'Önümüzdeki 30 gün' },
]);
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const bucketLabel = (bucket, kind) => (kind === 'DAY' ? `${bucket.slice(8, 10)}.${bucket.slice(5, 7)}` : `${MONTHS[Number(bucket.slice(5, 7)) - 1]} ${bucket.slice(2, 4)}`);
const hours = (minutes) => `${Math.round(minutes / 6) / 10} sa`.replace('.', ',');

/**
 * Spa raporu (modül 57): dönemin (randevu gününe göre) cirosu, tamamlanan / iptal / gelmedi sayıları, hizmet ve
 * kategori dökümü, terapist performansı (randevu, saat, ciro, doluluk) ve eğilim. Ciro misafirin ödediği toplamdır
 * (vergi dahil); geç iptal ve gelmedi bedelleri ayrı gösterilir.
 */
export function SpaReportPage() {
  const [period, setPeriod] = useState('past30');
  const range = rangeOf(period);
  const query = useQuery({ queryKey: spaKeys.report(range), queryFn: () => api(withQuery('/spa/report', range)), placeholderData: keepPreviousData });
  const data = query.data;
  const money = (value) => formatMoney(value, data?.currency ?? '');

  return (
    <div className="flex flex-col gap-4">
      <Toolbar>
        <Select label="Dönem" compact options={PERIODS} value={period} onChange={(event) => setPeriod(event.target.value)} className="w-52" />
        <p className="pb-1 text-sm text-ink-muted">
          {dottedDay(range.from)} – {dottedDay(range.to)} · randevu gününe göre
        </p>
      </Toolbar>
      {query.isPending && <Spinner className="py-10" label="Rapor hazırlanıyor…" />}
      {query.isError && (
        <Alert tone="danger" title="Rapor alınamadı" action={<Button type="button" size="sm" variant="outline" onClick={() => query.refetch()}>Tekrar dene</Button>}>
          {query.error.message}
        </Alert>
      )}
      {data && data.totals.appointments === 0 && <EmptyState icon="chart" title="Bu dönemde randevu yok" description="Dönemi değiştirin; randevular açıldıkça rapor dolar." />}
      {data && data.totals.appointments > 0 && (
        <div className={`flex flex-col gap-4 ${query.isFetching ? 'opacity-80' : ''}`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryTile label="Tamamlanan" value={data.totals.completed} hint={`${data.totals.guests} misafir · ${data.totals.booked} randevu açık`} icon="checkCircle" />
            <SummaryTile label="İptal" value={data.totals.cancelled} hint={`Kapananların ${formatPercent(data.totals.cancellationPct)}'i`} icon="close" />
            <SummaryTile label="Gelmedi" value={data.totals.noShow} hint={`Kapananların ${formatPercent(data.totals.noShowPct)}'i`} icon="alertCircle" tone={data.totals.noShow ? 'warning' : 'neutral'} />
            <SummaryTile label="Portaldan" value={data.totals.portal} hint={`Randevuların ${formatPercent(data.totals.portalPct)}'i`} icon="globe" />
          </div>
          <Card title="Ciro" description="Misafirin ödediği toplam (vergi dahil). Bedel: geç iptal ve gelmedi.">
            <dl className="grid gap-4 sm:grid-cols-4">
              <Figure label="Hizmet cirosu" value={money(data.totals.revenue)} />
              <Figure label="Bedel geliri" value={money(data.totals.feeRevenue)} />
              <Figure label="Toplam" value={money(data.totals.totalRevenue)} strong />
              <Figure label="Tahsil edilmemiş" value={money(data.totals.openBalance)} tone={Number(data.totals.openBalance) > 0 ? 'text-warning-ink' : ''} />
            </dl>
          </Card>

          {data.trend.points.length > 1 && <TrendCard trend={data.trend} money={money} />}

          <Card title="Terapist performansı" description="Tamamladığı randevu ve dersler. Çift terapistli randevuda ciro eşit bölünür. Doluluk, bugünkü haftalık çalışma saatlerine göre yaklaşıktır (izinler düşülmez).">
            <ReportTable
              head={['Terapist', 'Randevu', 'Ders', 'Süre', 'Doluluk', 'Ciro']}
              rows={data.therapists.map((row) => [
                <span key="name" className="font-semibold text-ink">
                  {row.name}
                  {row.title && <span className="block text-xs font-normal text-ink-muted">{row.title}</span>}
                </span>,
                row.appointments,
                row.sessions,
                hours(row.minutes),
                row.workMinutes ? <Occupancy key="occ" pct={row.occupancyPct} /> : '—',
                money(row.revenue),
              ])}
              empty="Bu dönemde tamamlanan iş yok."
            />
          </Card>

          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Card title="Hizmetler" description="Ciroya göre.">
              <ReportTable
                head={['Hizmet', 'Tamamlanan', 'İptal', 'Gelmedi', 'Ciro', 'Bedel']}
                rows={data.services.map((row) => [
                  <span key="name" className="font-semibold text-ink">
                    {row.name}
                    <span className="block text-xs font-normal text-ink-muted">
                      {SPA_CATEGORY_LABELS[row.category] ?? row.category}
                      {row.kind === 'GROUP' ? ` · ${SPA_SERVICE_KIND_LABELS.GROUP}` : ''}
                    </span>
                  </span>,
                  row.completed,
                  row.cancelled,
                  row.noShow,
                  money(row.revenue),
                  Number(row.fees) ? money(row.fees) : '—',
                ])}
                empty="Kapanan randevu yok."
              />
            </Card>
            <Card title="Kategoriler">
              <ReportTable head={['Kategori', 'Misafir', 'Ciro']} rows={data.categories.map((row) => [SPA_CATEGORY_LABELS[row.category] ?? row.category, row.guests, money(row.revenue)])} empty="Tamamlanan randevu yok." />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, strong = false, tone = '' }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{label}</dt>
      <dd className={`mt-1 tabular-nums ${strong ? 'text-2xl font-bold' : 'text-lg font-semibold'} ${tone || 'text-ink'}`}>{value}</dd>
    </div>
  );
}

function Occupancy({ pct }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-black/[0.07]">
        <span className={`block h-full rounded-full ${pct >= 85 ? 'bg-warning' : 'bg-info'}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className="tabular-nums">{formatPercent(pct)}</span>
    </span>
  );
}

/** İlk sütun metin, diğerleri sağa dayalı sayı. */
function ReportTable({ head, rows, empty }) {
  if (rows.length === 0) return <p className="text-sm text-ink-muted">{empty}</p>;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
          <tr>
            {head.map((title, index) => (
              <th key={title} scope="col" className={`px-3 py-2 font-bold ${index ? 'text-right' : ''}`}>
                {title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row, rowIndex) => (
            // Satırların kimliği yok (toplam satırları); sıra sabittir.
            // eslint-disable-next-line react/no-array-index-key
            <tr key={rowIndex}>
              {row.map((cell, index) => (
                // eslint-disable-next-line react/no-array-index-key
                <td key={index} className={`px-3 py-2 ${index ? 'text-right tabular-nums' : ''}`}>
                  {index && typeof cell === 'object' ? <span className="flex justify-end">{cell}</span> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Eğilim: dönem başına ciro çubuğu; altında tamamlanan ve kaybedilen sayıları. */
function TrendCard({ trend, money }) {
  const max = Math.max(...trend.points.map((point) => Number(point.revenue)), 1);
  return (
    <Card title="Eğilim" description={trend.bucket === 'DAY' ? 'Günlük ciro (bedeller dahil).' : 'Aylık ciro (bedeller dahil).'}>
      <div className="overflow-x-auto">
        <ol className="flex min-w-max items-end gap-1.5" aria-label="Ciro eğilimi">
          {trend.points.map((point) => (
            <li key={point.bucket} className="flex w-9 flex-col items-center gap-1" title={`${bucketLabel(point.bucket, trend.bucket)}: ${money(point.revenue)} · ${point.completed} tamamlandı · ${point.lost} iptal / gelmedi`}>
              <span className="flex h-28 w-full items-end">
                <span className="block w-full rounded-t-[4px] bg-info" style={{ height: `${Math.max(2, (Number(point.revenue) / max) * 100)}%` }} />
              </span>
              <span className="text-[0.65rem] tabular-nums text-ink-muted">{bucketLabel(point.bucket, trend.bucket)}</span>
              <span className="text-[0.65rem] font-semibold tabular-nums text-ink-soft">{point.completed}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="mt-2 text-xs text-ink-muted">Çubuk: ciro · alttaki sayı: tamamlanan randevu. Ayrıntı için çubuğun üstüne gelin.</p>
    </Card>
  );
}
