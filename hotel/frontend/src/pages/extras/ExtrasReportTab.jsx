import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, Input } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { api, withQuery } from '../../lib/api.js';
import { LAUNDRY_STATUS_TONES, extrasKeys, laundryStatusLabel, serviceLabel } from '../../lib/extras.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { EXTRAS_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';

const dueFormatter = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const LIVE_MIN_INTERVAL_MS = 5000;

/**
 * Günlük minibar / çamaşırhane raporu (modül 19): minibar — folyoya yazılan
 * (odadaki + geç kalem), kayıp, ürün ve personel kırılımı; çamaşırhane — o gün
 * alınan, teslim edilen (gelir, hizmet kırılımı), şu an açık ve geciken.
 * Tutarlar liste fiyatıdır; vergili toplam folyoda.
 */
export function ExtrasReportTab() {
  const [date, setDate] = useState('');
  useLiveChannel(EXTRAS_CHANNEL, { queryKeys: [['extras', 'report']], enabled: !date, minIntervalMs: LIVE_MIN_INTERVAL_MS });
  const query = useQuery({ queryKey: extrasKeys.report({ date }), queryFn: () => api(withQuery('/extras/report', { date: date || undefined })) });

  if (!query.data) return <QueryFallback query={query} errorTitle="Rapor yüklenemedi" />;
  const { minibar, laundry, currency } = query.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <Input label="İş günü" type="date" value={date || query.data.date} max={query.data.businessDate} onChange={(event) => setDate(event.target.value === query.data.businessDate ? '' : event.target.value)} className="w-44" />
        {date && <Button variant="outline" icon="calendar" onClick={() => setDate('')}>Bugün</Button>}
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="report-minibar">
        <h2 id="report-minibar" className="text-base font-bold text-ink">Minibar · {formatDate(query.data.date)}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryTile label="Folyoya yazılan" value={formatMoney(minibar.chargedAmount, currency)} hint={`${minibar.byTarget.IN_HOUSE.slips + minibar.byTarget.LATE.slips} fiş · ${minibar.byTarget.LATE.slips} geç kalem`} icon="check" />
          <SummaryTile label="Kayıp" value={formatMoney(minibar.lossAmount, currency)} hint={`${minibar.byTarget.NONE.slips} fiş · ${minibar.byTarget.NONE.items} ürün`} icon="alertTriangle" tone={Number(minibar.lossAmount) > 0 ? 'warning' : 'neutral'} />
          <SummaryTile label="Sayılan oda" value={minibar.byTarget.IN_HOUSE.rooms + minibar.byTarget.LATE.rooms + minibar.byTarget.NONE.rooms} hint="Fişi olan oda" icon="bed" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Ürünler">
            {minibar.items.length === 0 ? (
              <EmptyState icon="utensils" title="Tüketim yok" />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                  <tr>
                    <th scope="col" className="py-2">Ürün</th>
                    <th scope="col" className="py-2 text-right">Adet</th>
                    <th scope="col" className="py-2 text-right">Yazılan</th>
                    <th scope="col" className="py-2 text-right">Kayıp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {minibar.items.map((row) => (
                    <tr key={row.itemId}>
                      <td className="py-2 font-semibold">{row.name}</td>
                      <td className="py-2 text-right tabular-nums">{row.quantity}</td>
                      <td className="whitespace-nowrap py-2 text-right tabular-nums">{formatMoney(row.charged)}</td>
                      <td className="whitespace-nowrap py-2 text-right tabular-nums text-warning-ink">{row.lossQuantity ? `${row.lossQuantity} · ${formatMoney(row.loss)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Personel">
            {minibar.staff.length === 0 ? (
              <EmptyState icon="user" title="Sayım girilmemiş" />
            ) : (
              <ul className="flex flex-col divide-y divide-line text-sm">
                {minibar.staff.map((row) => (
                  <li key={row.staff} className="flex justify-between gap-2 py-2">
                    <span className="min-w-0 truncate">{row.staff}</span>
                    <span className="whitespace-nowrap tabular-nums text-ink-soft">
                      {row.slips} fiş · {row.rooms} oda · {formatMoney(row.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="report-laundry">
        <h2 id="report-laundry" className="text-base font-bold text-ink">Çamaşırhane · {formatDate(query.data.date)}</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <SummaryTile label="Alınan" value={laundry.received.orders} hint={`${laundry.received.items} parça · ${laundry.received.express} ekspres · ${laundry.received.cancelled} iptal`} icon="plus" />
          <SummaryTile label="Teslim (gelir)" value={formatMoney(laundry.delivered.amount, currency)} hint={`${laundry.delivered.orders} sipariş · ekspres farkı ${formatMoney(laundry.delivered.surcharge)}`} icon="checkCheck" />
          <SummaryTile label="Şu an açık" value={laundry.openNow} hint="Teslim bekleyen sipariş" icon="clock" />
          <SummaryTile label="Geciken" value={laundry.overdueCount} hint="Teslim zamanı geçti" icon="alertTriangle" tone={laundry.overdueCount > 0 ? 'danger' : 'neutral'} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Hizmetler (teslim edilen)">
            {laundry.delivered.byService.length === 0 ? (
              <EmptyState icon="layers" title="Teslim yok" />
            ) : (
              <ul className="flex flex-col divide-y divide-line text-sm">
                {laundry.delivered.byService.map((row) => (
                  <li key={row.service} className="flex justify-between py-2">
                    <span>{serviceLabel(row.service)}</span>
                    <span className="tabular-nums text-ink-soft">{row.quantity} parça · {formatMoney(row.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Gecikenler (şu an)">
            {laundry.overdue.length === 0 ? (
              <EmptyState icon="checkCircle" title="Geciken sipariş yok" />
            ) : (
              <ul className="flex flex-col divide-y divide-line text-sm">
                {laundry.overdue.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-semibold">Oda {row.roomNumber}</span> · {row.guestName} <span className="font-mono text-xs text-ink-muted">{row.reference}</span>
                    </span>
                    <span className="flex items-center gap-2 text-xs">
                      <Badge tone={LAUNDRY_STATUS_TONES[row.status]}>{laundryStatusLabel(row.status)}</Badge>
                      <span className="text-sec-strong">{dueFormatter.format(new Date(row.dueAt))}</span>
                    </span>
                  </li>
                ))}
                {laundry.overdueCount > laundry.overdue.length && (
                  <li className="py-2 text-xs text-ink-muted">ve {laundry.overdueCount - laundry.overdue.length} sipariş daha (Çamaşırhane → Geciken)</li>
                )}
              </ul>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}
