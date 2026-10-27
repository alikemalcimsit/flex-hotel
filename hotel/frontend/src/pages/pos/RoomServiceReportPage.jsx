import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { MAX_POS_REPORT_DAYS, ROOM_SERVICE_SOURCE_LABELS, roomServiceReportQuerySchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, EmptyState, Input, Select, Spinner } from '@hotelos/ui';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { usePosOutlets } from '../../lib/pos.js';
import { rsKeys } from '../../lib/roomService.js';
import { RoomServiceTabs } from './RoomServiceTabs.jsx';
import { ReportTable } from './SalesReportPage.jsx';

/** @param {number | null} value */
const minutes = (value) => (value === null || value === undefined ? '—' : `${value} dk`);
/** @param {number | null} value */
const percent = (value) => (value === null || value === undefined ? '—' : `%${value}`);

/**
 * Oda servisi raporu (modül 41): sipariş günü aralığında (en fazla 31 gün; açılışta otelin bugünü) sipariş sayıları,
 * zamanında teslim oranı, süreler (mutfak / yol / toplam — ortalama, medyan, %90; hemen ve planlı ayrı), misafir
 * siparişinin kabul süresi, ciro (kapanış iş gününe göre; kapıda / odaya, oda servisi ücreti), kaynak, götüren, saat ve gün kırılımı,
 * toplanmamış tepsiler.
 */
export function RoomServiceReportPage() {
  const outlets = usePosOutlets();
  const [range, setRange] = useState({ from: '', to: '', outletId: '' });
  const checked = roomServiceReportQuerySchema.safeParse({ from: range.from || undefined, to: range.to || undefined, outletId: range.outletId || undefined });
  const rangeError = checked.success ? null : checked.error.issues[0]?.message;
  const report = useQuery({
    queryKey: rsKeys.report(range),
    queryFn: () => api(withQuery('/pos/room-service/report', { from: range.from || undefined, to: range.to || undefined, outletId: range.outletId || undefined })),
    enabled: checked.success,
    placeholderData: keepPreviousData,
  });
  const data = report.data;
  const currency = data?.currency ?? '';
  const set = (key) => (event) => setRange((current) => ({ ...current, from: current.from || data?.from || '', to: current.to || data?.to || '', [key]: event.target.value }));
  const rsOutlets = (outlets.data?.items ?? []).filter((outlet) => outlet.kind === 'ROOM_SERVICE');
  const peak = data ? Math.max(1, ...data.byHour.map((row) => row.orders)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <RoomServiceTabs />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input label="Sipariş günü (başlangıç)" name="rs-report-from" type="date" value={range.from || data?.from || ''} onChange={set('from')} />
        <Input label="Sipariş günü (bitiş)" name="rs-report-to" type="date" value={range.to || data?.to || ''} onChange={set('to')} error={rangeError ?? undefined} />
        {rsOutlets.length > 1 && <Select label="Oda servisi noktası" value={range.outletId} onChange={set('outletId')} options={[{ value: '', label: 'Hepsi' }, ...rsOutlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))]} />}
      </div>
      <p className="text-xs text-ink-muted">
        En fazla {MAX_POS_REPORT_DAYS} gün. Sipariş sayıları ve süreler siparişin verildiği güne (otelin günü), ciro adisyonun kapandığı iş gününe göre (satış raporuyla aynı). Süreler mutfağa düşüşten sayılır.
      </p>
      {report.isPending && checked.success && <Spinner className="py-10" />}
      {report.isError && (
        <Alert tone="danger" title="Rapor yüklenemedi" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => report.refetch()}>Tekrar dene</Button>}>
          {report.error.message}
        </Alert>
      )}
      {data && (
        <div className={`flex flex-col gap-4 transition-opacity ${report.isFetching ? 'opacity-60' : ''}`}>
          <section aria-label="Özet" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryTile label="Sipariş" value={data.summary.orders} hint={`${data.summary.delivered} teslim · ${data.summary.cancelled} iptal · ${data.summary.rejected} ret · ${data.summary.open} açık`} icon="utensils" />
            <SummaryTile
              label="Zamanında teslim"
              value={data.summary.onTimePct === null ? undefined : `%${data.summary.onTimePct}`}
              hint={`Toplam süre ort. ${minutes(data.timing.asap?.total.avg ?? null)} (hemen)`}
              icon="clock"
              tone={data.summary.onTimePct !== null && data.summary.onTimePct < 80 ? 'warning' : 'neutral'}
            />
            <SummaryTile label="Ciro (vergi dahil)" value={formatMoney(data.revenue.grandTotal, currency)} hint={`Oda servisi ücreti ${formatMoney(data.revenue.trayCharges, currency)} · ortalama ${data.revenue.average ? formatMoney(data.revenue.average, currency) : '—'}`} icon="chart" />
            <SummaryTile
              label="Toplanmamış tepsi"
              value={data.trays.uncollected}
              hint={`Toplama ort. ${minutes(data.trays.collectAvg)} · misafir siparişi kabul ort. ${minutes(data.summary.guestAcceptMinutes)}`}
              icon="checkCheck"
              tone={data.trays.uncollected ? 'warning' : 'neutral'}
            />
          </section>
          {data.summary.orders === 0 ? (
            <Card>
              <EmptyState icon="chart" title="Bu aralıkta oda servisi siparişi yok" description="Tarih aralığını değiştirin." />
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <ReportTable
                  title="Süreler (teslim edilenler)"
                  head={['', 'Teslim', 'Zamanında', 'Mutfak ort. / %90', 'Yol ort.', 'Toplam ort. / %90']}
                  rows={[
                    ['Hemen', data.timing.asap],
                    ['Planlı', data.timing.scheduled],
                  ]
                    .filter(([, row]) => row)
                    .map(([label, row]) => [label, row.delivered, percent(row.onTimePct), `${minutes(row.kitchen.avg)} / ${minutes(row.kitchen.p90)}`, minutes(row.transitAvg), `${minutes(row.total.avg)} / ${minutes(row.total.p90)}`])}
                />
                <ReportTable
                  title="Tahsilat"
                  head={['', 'Tutar']}
                  rows={[
                    ['Odaya yazılan', formatMoney(data.revenue.roomCharged, currency)],
                    ['Kapıda alınan', formatMoney(data.revenue.doorPaid, currency)],
                    ['İkram + indirim', formatMoney(data.revenue.givenAway, currency)],
                    ['Oda servisi ücreti', formatMoney(data.revenue.trayCharges, currency)],
                  ]}
                />
                <ReportTable
                  title="Kaynak"
                  head={['Kaynak', 'Sipariş', 'Teslim', 'İptal / ret']}
                  rows={data.bySource.map((row) => [ROOM_SERVICE_SOURCE_LABELS[row.source], row.orders, row.delivered, row.lost])}
                />
                <ReportTable title="Götüren" head={['Personel', 'Teslim', 'Zamanında', 'Yol ort.']} rows={data.byRunner.map((row) => [row.runnerEmail, row.delivered, percent(row.onTimePct), minutes(row.transitAvg)])} />
              </div>
              <Card title="Saat dağılımı" description="Siparişin verildiği saat (otelin saati).">
                <ul className="flex h-36 items-end gap-1" aria-label="Saatlere göre sipariş">
                  {Array.from({ length: 24 }, (_, hour) => {
                    const count = data.byHour.find((row) => row.hour === hour)?.orders ?? 0;
                    return (
                      <li key={hour} className="flex flex-1 flex-col items-center gap-1" title={`${String(hour).padStart(2, '0')}:00 — ${count} sipariş`}>
                        <span className="w-full rounded-t bg-info-line" style={{ height: `${Math.round((count / peak) * 100)}%`, minHeight: count ? 4 : 0 }} />
                        <span className="text-[0.6rem] text-ink-muted">{hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}</span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
              <ReportTable title="Günlük" head={['Gün', 'Sipariş', 'Teslim', 'Zamanında', 'Toplam ort.']} rows={data.byDay.map((row) => [row.date, row.orders, row.delivered, percent(row.onTimePct), minutes(row.totalAvg)])} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
