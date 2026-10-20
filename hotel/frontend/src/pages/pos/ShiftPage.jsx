import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_METHOD_LABELS, POS_SHIFT_STATUS_LABELS, closePosShiftSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Icon, Input, Spinner, Textarea } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { api, apiPost } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { methodLabel } from '../../lib/payments.js';
import { SHIFT_STATUS_TONES, dateTimeText, posKeys, usePosLive } from '../../lib/pos.js';
import { shiftSlipHtml, printHtml } from '../../lib/posPrint.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { validateWith } from '../../lib/validate.js';
import { useAuthStore } from '../../store/auth.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * Garson vardiyası ve raporu (modül 39): kasa (avans, nakit net, beklenen; kapanmışsa sayılan
 * ve fark), kapanışı engelleyenler, kapanış formu (sayılan nakit → fark önizlemesi), satış
 * özeti, yöntem bazında tahsilat, odaya yazılan, indirim / ikram / iptal / zayi ve en çok
 * satanlar; yazdırılabilir vardiya fişi.
 */
export function ShiftPage() {
  const { shiftId } = useParams();
  usePosLive();
  const report = useQuery({ queryKey: posKeys.shiftReport(shiftId), queryFn: () => api(`/pos/shifts/${shiftId}/report`) });
  if (report.isPending || report.isError) return <QueryFallback query={report} errorTitle="Vardiya yüklenemedi" />;
  return <ShiftScreen report={report.data} />;
}

/** @param {{ report: any }} props */
function ShiftScreen({ report }) {
  const can = useCan();
  const me = useAuthStore((state) => state.user?.email);
  const { shift, sales, currency } = report;
  const open = shift.status === 'OPEN';
  const canClose = open && (shift.waiterEmail === me || can(PERMISSIONS.POS_SUPERVISE));
  const variance = shift.variance === null ? null : Number(shift.variance);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/pos/vardiyalar" className="flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
          <Icon name="arrowLeft" className="size-4" /> Vardiyalar
        </Link>
        <h2 className="text-xl font-bold text-ink">{shift.waiterEmail}</h2>
        <Badge tone={SHIFT_STATUS_TONES[shift.status]}>{POS_SHIFT_STATUS_LABELS[shift.status]}</Badge>
        <span className="text-sm text-ink-soft">
          {dateTimeText(shift.openedAt)} – {shift.closedAt ? dateTimeText(shift.closedAt) : 'açık'} · iş günü {shift.businessDate}
          {shift.outletName ? ` · ${shift.outletName}` : ''}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          icon="fileText"
          className="ml-auto"
          onClick={() => {
            if (!printHtml(shiftSlipHtml(report, PAYMENT_METHOD_LABELS))) toastError('Yazdırma penceresi açılamadı; açılır pencere iznini verin.');
          }}
        >
          Vardiya fişi
        </Button>
      </div>

      <section aria-label="Kasa" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label="Kasa avansı" value={formatMoney(shift.cash.openingFloat, currency)} hint="Açılışta çekmecedeki para" icon="coins" />
        <SummaryTile label="Nakit tahsilat (net)" value={formatMoney(shift.cash.cashNet, currency)} hint="İptal kayıtları düşülmüş" icon="banknote" />
        <SummaryTile label="Kasada olması gereken" value={formatMoney(shift.cash.expectedCash, currency)} hint={open ? 'Canlı hesap' : 'Kapanıştaki değer'} icon="wallet" />
        <SummaryTile
          label="Kasa farkı"
          value={variance === null ? '—' : formatMoney(shift.variance, currency)}
          hint={variance === null ? 'Kapanışta sayılır' : `Sayılan ${formatMoney(shift.countedCash, currency)}`}
          icon="alertTriangle"
          tone={variance === null || variance === 0 ? 'neutral' : variance < 0 ? 'danger' : 'warning'}
        />
      </section>
      {shift.note && <p className="text-sm italic text-ink-soft">Kapanış notu: {shift.note}</p>}

      {canClose && <CloseShiftCard shift={shift} currency={currency} />}

      <Card title="Satış" description="Vardiyanın kapanmış adisyonları (devirle gelenler dahil, devredilenler hariç).">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Figure label="Adisyon / kişi" value={`${sales.checks} / ${sales.covers}`} />
          <Figure label="Satış (vergi dahil)" value={formatMoney(sales.grandTotal, currency)} />
          <Figure label="Ortalama adisyon" value={formatMoney(sales.averageCheck, currency)} />
          <Figure label="Kişi başı" value={formatMoney(sales.averageCover, currency)} />
          <Figure label="İndirim" value={formatMoney(sales.discountTotal, currency)} />
          <Figure label="İkram" value={formatMoney(sales.compTotal, currency)} />
          <Figure label="İptal" value={formatMoney(sales.voidTotal, currency)} />
          <Figure label={`Zayi (${sales.wasteCount})`} value={formatMoney(sales.wasteTotal, currency)} tone={Number(sales.wasteTotal) > 0 ? 'text-sec-strong' : ''} />
          <Figure label="Odaya yazılan" value={`${formatMoney(report.roomCharges.amount, currency)} (${report.roomCharges.count})`} />
          <Figure label="Vergi" value={formatMoney(sales.taxTotal, currency)} />
          <Figure label="İptal edilen boş adisyon" value={String(sales.voidedChecks)} />
        </dl>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Tahsilat" description="Bu garsonun aldığı para (hangi adisyondan olursa olsun).">
          {shift.payments.length === 0 ? (
            <EmptyState icon="wallet" title="Tahsilat yok" />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th scope="col" className="py-2 font-bold">Yöntem</th>
                  <th scope="col" className="py-2 text-right font-bold">Alınan</th>
                  <th scope="col" className="py-2 text-right font-bold">İptal</th>
                  <th scope="col" className="py-2 text-right font-bold">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shift.payments.map((row) => (
                  <tr key={row.method}>
                    <td className="py-2 font-semibold">{methodLabel(row.method)} <span className="text-xs text-ink-muted">({row.count})</span></td>
                    <td className="py-2 text-right tabular-nums">{formatMoney(row.received)}</td>
                    <td className="py-2 text-right tabular-nums text-ink-muted">{Number(row.reversed) ? formatMoney(row.reversed) : '—'}</td>
                    <td className="py-2 text-right font-bold tabular-nums">{formatMoney(row.net, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="En çok satanlar" description="Faturalanan adet (ikram / iptal hariç) ve tutar.">
          {report.topItems.length === 0 ? (
            <EmptyState icon="utensils" title="Satış yok" />
          ) : (
            <ol className="divide-y divide-line text-sm">
              {report.topItems.map((item, index) => (
                <li key={item.menuItemId} className="flex items-center gap-3 py-2">
                  <span className="w-5 text-right text-xs text-ink-muted">{index + 1}</span>
                  <span className="flex-1 font-semibold">{item.name}</span>
                  <span className="tabular-nums text-ink-soft">{item.quantity} adet</span>
                  <span className="w-28 text-right font-bold tabular-nums">{formatMoney(item.amount, currency)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

/** @param {{ label: string, value: string, tone?: string }} props */
function Figure({ label, value, tone = '' }) {
  return (
    <div className="rounded-item bg-surface-muted px-3 py-2">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={`font-bold tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

/**
 * Kapanış: açık adisyon ya da onay bekleyen ödeme varsa kapanmaz (sunucu da reddeder).
 * Sayılan nakit girilince fark önizlenir; eşiği aşan fark yöneticiye uyarı düşürür.
 * @param {{ shift: any, currency: string }} props
 */
function CloseShiftCard({ shift, currency }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ countedCash: '', note: '' });
  const [errors, setErrors] = useState({});
  const close = useMutation({
    mutationFn: (body) => apiPost(`/pos/shifts/${shift.id}/close`, body),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: posKeys.all });
      toastSuccess(result.varianceAlert ? 'Vardiya kapandı; kasa farkı yöneticiye bildirildi' : 'Vardiya kapandı');
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      queryClient.invalidateQueries({ queryKey: posKeys.shiftReport(shift.id) });
      toastError(error.message);
    },
  });
  const counted = Number(values.countedCash.replace(',', '.'));
  const preview = values.countedCash && Number.isFinite(counted) ? counted - Number(shift.cash.expectedCash) : null;
  const blocked = shift.blockers.openChecks > 0 || shift.blockers.pendingPayments > 0 || shift.blockers.pendingVoids > 0;

  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: shift.updatedAt, countedCash: values.countedCash, note: values.note };
    const checked = validateWith(closePosShiftSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    close.mutate(body);
  }

  const busy = close.isPending;
  return (
    <Card title="Vardiyayı kapat" description="Çekmecedeki nakdi sayın; sistem beklenenle karşılaştırıp farkı kaydeder.">
      {blocked ? (
        <Alert tone="warning" title="Kapanmadan önce">
          {shift.blockers.openChecks > 0 && (
            <span className="block">
              {shift.blockers.openChecks} açık adisyon var: ödemesini alın ya da adisyon ekranından başka garsona devredin.{' '}
              <Link to="/pos/adisyonlar" className="font-semibold underline">Adisyonlar</Link>
            </span>
          )}
          {shift.blockers.pendingPayments + shift.blockers.pendingVoids > 0 && <span className="block">Onay bekleyen tahsilat ya da ödeme iptali var; kararı bekleyin.</span>}
        </Alert>
      ) : (
        <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-3 sm:grid-cols-[14rem_minmax(0,1fr)_auto] sm:items-end">
          <Input label={`Sayılan nakit (${currency})`} name="pos-counted-cash" inputMode="decimal" value={values.countedCash} onChange={(event) => setValues((current) => ({ ...current, countedCash: event.target.value }))} error={errors.countedCash} required disabled={busy} />
          <Textarea label="Not (fark varsa açıklama)" name="pos-close-note" rows={1} value={values.note} onChange={(event) => setValues((current) => ({ ...current, note: event.target.value }))} error={errors.note} disabled={busy} />
          <Button type="submit" icon="lock" disabled={busy}>
            {busy ? 'Kapatılıyor…' : 'Kasayı kapat'}
          </Button>
          {preview !== null && (
            <p className={`text-sm font-semibold sm:col-span-3 ${preview < 0 ? 'text-sec-strong' : preview > 0 ? 'text-warning-ink' : 'text-success-ink'}`}>
              Beklenen {formatMoney(shift.cash.expectedCash, currency)} · fark {formatMoney(preview.toFixed(2), currency)}
              {preview === 0 ? ' — kasa tuttu' : preview < 0 ? ' — açık' : ' — fazla'}
            </p>
          )}
        </form>
      )}
      {busy && <Spinner className="py-2" />}
    </Card>
  );
}
