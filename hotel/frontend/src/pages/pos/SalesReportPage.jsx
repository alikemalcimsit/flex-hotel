import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { MAX_POS_REPORT_DAYS, posSalesQuerySchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, EmptyState, Input, Select, Spinner } from '@hotelos/ui';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { methodLabel } from '../../lib/payments.js';
import { posKeys, usePosOutlets } from '../../lib/pos.js';

/**
 * Restoran satış raporu (modül 39): iş günü aralığında (en fazla 31 gün; açılışta bugünün iş
 * günü — sunucu verir, otel ayarını okuma yetkisi gerekmez) kapanmış
 * adisyonlar — satış noktası, gün ve garson kırılımı, yöntem bazında tahsilat, odaya
 * yazılan, indirim / ikram / iptal / zayi ve en çok satanlar.
 */
export function SalesReportPage() {
  const outlets = usePosOutlets();
  const [range, setRange] = useState({ from: '', to: '', outletId: '' });
  const checked = posSalesQuerySchema.safeParse({ from: range.from || undefined, to: range.to || undefined, outletId: range.outletId || undefined });
  const rangeError = checked.success ? null : checked.error.issues[0]?.message;
  const report = useQuery({
    queryKey: posKeys.sales(range),
    queryFn: () => api(withQuery('/pos/reports/sales', { from: range.from || undefined, to: range.to || undefined, outletId: range.outletId || undefined })),
    enabled: checked.success,
    placeholderData: keepPreviousData,
  });
  const data = report.data;
  const currency = data?.currency ?? '';
  // İlk açılışta uçları sunucunun iş günü doldurur; kullanıcı birini değiştirince öteki de sabitlenir.
  const set = (key) => (event) =>
    setRange((current) => ({ ...current, from: current.from || data?.from || '', to: current.to || data?.to || '', [key]: event.target.value }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input label="İş günü (başlangıç)" name="pos-sales-from" type="date" value={range.from || data?.from || ''} onChange={set('from')} />
        <Input label="İş günü (bitiş)" name="pos-sales-to" type="date" value={range.to || data?.to || ''} onChange={set('to')} error={rangeError ?? undefined} />
        <Select
          label="Satış noktası"
          value={range.outletId}
          onChange={set('outletId')}
          options={[{ value: '', label: 'Hepsi' }, ...(outlets.data?.items ?? []).map((outlet) => ({ value: outlet.id, label: outlet.name }))]}
        />
      </div>
      <p className="text-xs text-ink-muted">En fazla {MAX_POS_REPORT_DAYS} gün. Kapanış iş gününe göre; açık adisyonlar dahil değil.</p>
      {report.isPending && checked.success && <Spinner className="py-10" />}
      {report.isError && (
        <Alert tone="danger" title="Rapor yüklenemedi" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => report.refetch()}>Tekrar dene</Button>}>
          {report.error.message}
        </Alert>
      )}
      {data && (
        <div className={`flex flex-col gap-4 transition-opacity ${report.isFetching ? 'opacity-60' : ''}`}>
          <section aria-label="Özet" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryTile label="Satış (vergi dahil)" value={formatMoney(data.totals.grandTotal, currency)} hint={`Vergisiz ${formatMoney(data.totals.netTotal, currency)}`} icon="chart" />
            <SummaryTile label="Adisyon" value={data.totals.checks} hint={`Ortalama ${formatMoney(data.totals.averageCheck, currency)}`} icon="list" />
            <SummaryTile label="Kişi" value={data.totals.covers} hint={`Kişi başı ${formatMoney(data.totals.averageCover, currency)}`} icon="users" />
            <SummaryTile
              label="Zayi"
              value={data.adjustments.waste.count}
              hint={`${formatMoney(data.adjustments.waste.value, currency)} · ikram ${formatMoney(data.totals.compTotal, currency)}`}
              icon="alertTriangle"
              tone={data.adjustments.waste.count ? 'warning' : 'neutral'}
            />
          </section>
          {data.totals.checks === 0 ? (
            <Card>
              <EmptyState icon="chart" title="Bu aralıkta kapanmış adisyon yok" description="Tarih aralığını ya da satış noktasını değiştirin." />
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <ReportTable
                  title="Satış noktaları"
                  head={['Satış noktası', 'Adisyon', 'İndirim + ikram', 'Satış']}
                  rows={data.outlets.map((row) => [row.outletName, row.checks, formatMoney(Number(row.discountTotal) + Number(row.compTotal)), formatMoney(row.grandTotal, currency)])}
                />
                <ReportTable
                  title="Tahsilat"
                  head={['Yöntem', 'Adet', 'İptal', 'Net']}
                  rows={[
                    ...data.payments.map((row) => [methodLabel(row.method), row.count, Number(row.reversed) ? formatMoney(row.reversed) : '—', formatMoney(row.net, currency)]),
                    ['Odaya yazılan', data.roomCharges.count, '—', formatMoney(data.roomCharges.amount, currency)],
                  ]}
                />
                <ReportTable title="Günler" head={['İş günü', 'Adisyon', 'Kişi', 'Satış']} rows={data.days.map((row) => [row.date, row.checks, row.covers, formatMoney(row.grandTotal, currency)])} />
                <ReportTable
                  title="Garsonlar"
                  head={['Garson', 'Adisyon', 'İndirim + ikram', 'Satış']}
                  rows={data.waiters.map((row) => [row.waiterEmail, row.checks, formatMoney(row.givenAway), formatMoney(row.grandTotal, currency)])}
                />
                <ReportTable
                  title="Düzeltmeler"
                  head={['Tür', 'Adet', 'Değer']}
                  rows={[
                    ['İkram', data.adjustments.comp.count, formatMoney(data.adjustments.comp.value, currency)],
                    ['İptal', data.adjustments.void.count, formatMoney(data.adjustments.void.value, currency)],
                    ['· zayi', data.adjustments.waste.count, formatMoney(data.adjustments.waste.value, currency)],
                    ['İndirim', data.adjustments.discount.count, formatMoney(data.totals.discountTotal, currency)],
                  ]}
                />
                <ReportTable title="En çok satanlar" head={['Ürün', 'Adet', 'Tutar']} rows={data.topItems.map((item) => [item.name, item.quantity, formatMoney(item.amount, currency)])} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** @param {{ title: string, head: string[], rows: Array<Array<string | number>> }} props */
export function ReportTable({ title, head, rows }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">Kayıt yok.</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                {head.map((label, index) => (
                  <th key={label} scope="col" className={`py-2 font-bold ${index > 0 ? 'text-right' : ''}`}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={String(row[0])}>
                  {row.map((cell, index) => (
                    <td key={head[index]} className={`py-2 ${index > 0 ? 'text-right tabular-nums' : 'font-semibold'}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
