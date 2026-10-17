import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  EVENT_INSTALLMENT_STATUS_LABELS,
  EVENT_PAYMENTS_PAGE_SIZE,
  EVENT_PAYMENT_METHODS,
  MAX_INSTALLMENTS,
  PAYMENT_KIND_LABELS,
  PAYMENT_REFERENCE_LABELS,
  PAYMENT_REFERENCE_REQUIRED_METHODS,
  PAYMENT_STATUS_LABELS,
  receiveEventPaymentSchema,
  saveInstallmentsSchema,
  voidEventPaymentSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Icon, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { INSTALLMENT_STATUS_TONES, PAYMENT_STATUS_TONES, banquetKeys, dayText } from '../../lib/banquet.js';
import { installmentRowsOf, installmentsPayloadOf, planTotal } from '../../lib/banquetForm.js';
import { formatMoney } from '../../lib/format.js';
import { PAYMENT_METHOD_ICONS, methodLabel } from '../../lib/payments.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { validateWith } from '../../lib/validate.js';

const METHOD_OPTIONS = EVENT_PAYMENT_METHODS.map((value) => ({ value, label: methodLabel(value) }));

/**
 * Ödemeler (modül 37): ödeme planı (taksitler, ödenen tutar vadesi eskiden yeniye
 * dağıtılır, geciken kırmızı) ve etkinliğin ödeme satırları (tahsilat, iade, iptal
 * kaydı). Eşik üstü tahsilat, iade ve hatalı girişin iptali onaya gider.
 *
 * @param {{ event: any }} props
 */
export function EventPaymentsTab({ event }) {
  const can = useCan();
  return (
    <div className="flex flex-col gap-4">
      <InstallmentsCard event={event} canManage={can(PERMISSIONS.BANQUET_MANAGE)} />
      <PaymentsCard event={event} canCollect={can(PERMISSIONS.BANQUET_PAYMENT)} />
    </div>
  );
}

/** @param {{ event: any, canManage: boolean }} props */
function InstallmentsCard({ event, canManage }) {
  const queryClient = useQueryClient();
  const editable = canManage && !['CANCELLED', 'LOST'].includes(event.status);
  const saved = useMemo(() => installmentRowsOf(event.installments), [event.installments]);
  const [rows, setRows] = useState(saved);
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (!editing) setRows(saved);
  }, [saved, editing]);

  const save = useMutation({
    mutationFn: (body) => api(`/banquet/events/${event.id}/installments`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (result) => {
      queryClient.setQueryData(banquetKeys.event(event.id), result);
      queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      setEditing(false);
      toastSuccess('Ödeme planı kaydedildi');
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: banquetKeys.event(event.id) });
      toastError(error.message);
    },
  });
  const suggest = useMutation({
    mutationFn: () => api(`/banquet/events/${event.id}/installments/suggestion`),
    onSuccess: (result) => {
      setRows(installmentRowsOf(result.installments));
      setEditing(true);
    },
    onError: (error) => toastError(error.message),
  });

  const set = (key, field) => (changeEvent) => setRows((current) => current.map((row) => (row.key === key ? { ...row, [field]: changeEvent.target.value } : row)));
  const total = planTotal(rows);
  const mismatch = Number(total) !== Number(event.amountDue);

  function submit(submitEvent) {
    submitEvent.preventDefault();
    const body = installmentsPayloadOf(rows, event.updatedAt);
    const checked = validateWith(saveInstallmentsSchema, body);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending;
  return (
    <Card
      title="Ödeme planı"
      description="Depozito ve kalan taksitler. Alınan para vadesi en eski taksitten başlayarak düşülür."
      actions={
        editable &&
        !editing && (
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" icon="sparkles" onClick={() => suggest.mutate()} disabled={suggest.isPending || !event.sessions.length}>
              Önerilen plan
            </Button>
            <Button type="button" size="sm" variant="outline" icon="pencil" onClick={() => setEditing(true)}>
              Düzenle
            </Button>
          </div>
        )
      }
    >
      {['CANCELLED', 'LOST'].includes(event.status) ? (
        <Alert tone="info" title="Ödeme planı kapandı">
          {event.status === 'CANCELLED'
            ? `Etkinlik iptal edildi; taksitler geçersiz. Borç iptal bedelidir: ${formatMoney(event.amountDue, event.currency)}.`
            : 'Dosya kaybedildi; müşteri borçlu değil. Alınmış para varsa iade edilir.'}
        </Alert>
      ) : editing ? (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <div key={row.key} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_11rem_10rem_auto]">
              <Input label={index === 0 ? 'Açıklama' : undefined} aria-label={`${index + 1}. taksit açıklaması`} value={row.label} onChange={set(row.key, 'label')} error={errors[`installments.${index}.label`]} disabled={busy} />
              <Input label={index === 0 ? 'Vade' : undefined} aria-label={`${index + 1}. taksit vadesi`} type="date" value={row.dueDate} onChange={set(row.key, 'dueDate')} error={errors[`installments.${index}.dueDate`]} disabled={busy} />
              <Input label={index === 0 ? 'Tutar' : undefined} aria-label={`${index + 1}. taksit tutarı`} inputMode="decimal" value={row.amount} onChange={set(row.key, 'amount')} error={errors[`installments.${index}.amount`]} disabled={busy} />
              <Button type="button" variant="ghost" icon="trash" aria-label={`${index + 1}. taksiti kaldır`} onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))} disabled={busy} />
            </div>
          ))}
          {errors.installments && <p className="text-xs font-semibold text-sec-strong">{errors.installments}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              icon="plus"
              onClick={() => setRows((current) => [...current, { key: `new-${Date.now()}`, label: current.length ? 'Ara ödeme' : 'Depozito', dueDate: '', amount: '' }])}
              disabled={busy || rows.length >= MAX_INSTALLMENTS}
            >
              Taksit ekle
            </Button>
            <p className={`text-sm ${mismatch ? 'font-semibold text-warning-ink' : 'text-ink-soft'}`}>
              Plan {formatMoney(total, event.currency)} · borç {formatMoney(event.amountDue, event.currency)}
              {mismatch ? ' — tutmuyor' : ''}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditing(false);
                setErrors({});
              }}
              disabled={busy}
            >
              Vazgeç
            </Button>
            <Button type="submit" icon="check" disabled={busy}>
              {busy ? 'Kaydediliyor…' : 'Planı kaydet'}
            </Button>
          </div>
        </form>
      ) : event.installments.length === 0 ? (
        <EmptyState icon="calendar" title="Ödeme planı yok" description={editable ? '"Önerilen plan" politikadaki depozito oranıyla depozito ve kalan ödemeyi önerir.' : 'Bu dosyada ödeme planı yok.'} />
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-bold">Taksit</th>
                <th scope="col" className="px-3 py-2 font-bold">Vade</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Tutar</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Ödenen</th>
                <th scope="col" className="px-3 py-2 font-bold">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {event.installments.map((row) => (
                <tr key={row.id ?? `${row.label}-${row.dueDate}`}>
                  <td className="px-3 py-2 font-semibold">{row.label}</td>
                  <td className="px-3 py-2 tabular-nums">{dayText(row.dueDate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.amount, event.currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.paid, event.currency)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={INSTALLMENT_STATUS_TONES[row.status]}>{EVENT_INSTALLMENT_STATUS_LABELS[row.status]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {Number(planTotal(event.installments)) !== Number(event.amountDue) && (
            <p className="mt-2 text-xs font-semibold text-warning-ink">
              Plan toplamı ({formatMoney(planTotal(event.installments), event.currency)}) borçla ({formatMoney(event.amountDue, event.currency)}) tutmuyor: kişi ya da kalem değişti, planı güncelleyin.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/** @param {{ event: any, canCollect: boolean }} props */
function PaymentsCard({ event, canCollect }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState(null);
  const payments = useInfiniteQuery({
    queryKey: banquetKeys.payments(event.id),
    queryFn: ({ pageParam }) => api(withQuery(`/banquet/events/${event.id}/payments`, { cursor: pageParam ?? undefined, limit: EVENT_PAYMENTS_PAGE_SIZE })),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const first = payments.data?.pages[0];
  const summary = first?.summary;
  const rows = payments.data?.pages.flatMap((page) => page.payments) ?? [];
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: banquetKeys.all });
  };
  // Kapanmış dosyada (gerçekleşti / iptal) borç kesin: kalan yoksa tahsilat açılmaz (sunucu da reddeder).
  const outstanding = summary ? Number(summary.amountDue) - Number(summary.postedNet) - Number(summary.pendingPayments) : 0;
  const canPay = canCollect && event.status !== 'LOST' && (!['COMPLETED', 'CANCELLED'].includes(event.status) || outstanding > 0);
  const canRefund = canCollect && summary && Number(summary.refundable) > 0;

  return (
    <Card
      title="Ödemeler"
      description="Etkinliğin kendi hesabı; satırlar kasada &quot;Etkinlik&quot; kaynağıyla görünür."
      actions={
        canCollect && (
          <div className="flex gap-2">
            {canPay && (
              <Button type="button" size="sm" icon="banknote" onClick={() => setDialog({ kind: 'PAYMENT' })}>
                Tahsilat
              </Button>
            )}
            {canRefund && (
              <Button type="button" size="sm" variant="outline" icon="rotateCcw" onClick={() => setDialog({ kind: 'REFUND' })}>
                İade
              </Button>
            )}
          </div>
        )
      }
    >
      {summary && (
        <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Figure label={event.status === 'CANCELLED' ? 'İptal bedeli' : 'Borç'} value={formatMoney(summary.amountDue, event.currency)} />
          <Figure label="Ödenen (işlenmiş)" value={formatMoney(summary.postedNet, event.currency)} />
          <Figure label={Number(summary.balance) < 0 ? 'Fazla ödeme' : 'Kalan'} value={formatMoney(Math.abs(Number(summary.balance)), event.currency)} tone={Number(summary.balance) > 0 ? 'text-warning-ink' : Number(summary.balance) < 0 ? 'text-info-ink' : ''} />
          <Figure label="Onay bekleyen" value={`${formatMoney(summary.pendingPayments, event.currency)} / iade ${formatMoney(Math.abs(Number(summary.pendingRefunds)), event.currency)}`} />
        </dl>
      )}
      {payments.isPending && <Spinner className="py-6" />}
      {payments.isError && (
        <Alert tone="danger" title="Ödemeler yüklenemedi" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => payments.refetch()}>Tekrar dene</Button>}>
          {payments.error.message}
        </Alert>
      )}
      {payments.isSuccess && rows.length === 0 && <EmptyState icon="wallet" title="Ödeme yok" description={canPay ? 'Depozito ya da ara ödemeyi "Tahsilat" ile alın.' : 'Bu dosyada ödeme yok.'} />}
      {rows.length > 0 && (
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-bold">Tarih</th>
                <th scope="col" className="px-3 py-2 font-bold">Tür / yöntem</th>
                <th scope="col" className="px-3 py-2 text-right font-bold">Tutar</th>
                <th scope="col" className="px-3 py-2 font-bold">Durum</th>
                <th scope="col" className="px-3 py-2 font-bold">Referans / alan</th>
                {canCollect && <th scope="col" className="px-3 py-2"><span className="sr-only">İşlem</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => {
                const negative = Number(row.amount) < 0;
                const voidable = canCollect && row.status === 'POSTED' && row.kind !== 'REVERSAL' && !row.voided && !row.voidPending;
                return (
                  <tr key={row.id} className={row.voided || row.status === 'DECLINED' ? 'bg-surface-muted text-ink-muted' : ''}>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                      {new Date(row.receivedAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
                      <span className="block text-xs text-ink-muted">kasa günü {dayText(row.businessDate)}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5 font-semibold">
                        <Icon name={PAYMENT_METHOD_ICONS[row.method]} className="size-4 text-ink-muted" />
                        {PAYMENT_KIND_LABELS[row.kind]}
                      </span>
                      <span className="block text-xs text-ink-muted">{methodLabel(row.method)}</span>
                    </td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums ${negative ? 'text-warning-ink' : ''} ${row.voided ? 'line-through' : ''}`}>
                      {negative ? '−' : ''}
                      {formatMoney(Math.abs(Number(row.amount)), row.currency)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={PAYMENT_STATUS_TONES[row.status]}>{PAYMENT_STATUS_LABELS[row.status]}</Badge>
                      {row.voided && <span className="block text-xs">iptal edildi: {row.voidReason}</span>}
                      {row.voidPending && <span className="block text-xs text-warning-ink">iptal onay bekliyor</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className="block">{row.reference ?? '—'}</span>
                      <span className="block text-ink-muted">{row.receivedBy}</span>
                      {row.note && <span className="block text-ink-muted">{row.note}</span>}
                    </td>
                    {canCollect && (
                      <td className="px-3 py-2 text-right">
                        {voidable && (
                          <Button type="button" size="sm" variant="ghost" icon="close" onClick={() => setDialog({ void: row })}>
                            Hatalı giriş
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {payments.hasNextPage && (
            <div className="border-t border-line px-3 py-3 text-center">
              <Button type="button" size="sm" variant="outline" icon="arrowDown" onClick={() => payments.fetchNextPage()} disabled={payments.isFetchingNextPage}>
                {payments.isFetchingNextPage ? 'Yükleniyor…' : 'Daha fazla'}
              </Button>
            </div>
          )}
        </div>
      )}
      {dialog?.kind && summary && (
        <ReceiveDialog
          event={event}
          kind={dialog.kind}
          refundable={summary.refundable}
          onClose={() => setDialog(null)}
          onDone={(result) => {
            setDialog(null);
            refresh();
            if (!result.created) toastSuccess('Bu istek zaten işlenmişti; ikinci kez alınmadı');
            else if (result.payment.status === 'PENDING') toastSuccess(dialog.kind === 'REFUND' ? 'İade onaya gönderildi (dört göz)' : 'Tutar eşiğin üstünde: tahsilat onaya gönderildi');
            else toastSuccess('Tahsilat işlendi');
          }}
        />
      )}
      {dialog?.void && (
        <VoidDialog
          event={event}
          payment={dialog.void}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            refresh();
            toastSuccess('İptal isteği onaya gönderildi');
          }}
        />
      )}
    </Card>
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
 * Tahsilat / iade. İstek kimliği diyalog açılınca bir kez üretilir: çift tıklama ya da
 * ağ tekrarı ikinci satır açmaz.
 * @param {{ event: any, kind: 'PAYMENT' | 'REFUND', refundable: string, onClose: () => void, onDone: (result: any) => void }} props
 */
function ReceiveDialog({ event, kind, refundable, onClose, onDone }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [values, setValues] = useState({ method: kind === 'REFUND' ? 'TRANSFER' : 'CARD', amount: '', reference: '', note: '' });
  const [errors, setErrors] = useState({});
  const set = (key) => (changeEvent) => setValues((current) => ({ ...current, [key]: changeEvent.target.value }));
  const receive = useMutation({
    mutationFn: (body) => apiPost(`/banquet/events/${event.id}/payments`, body),
    onSuccess: onDone,
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      toastError(error.message);
    },
  });

  function submit(submitEvent) {
    submitEvent.preventDefault();
    const body = { requestId, kind, ...values };
    const checked = validateWith(receiveEventPaymentSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    if (kind === 'REFUND' && Number(checked.data.amount) > Number(refundable)) return setErrors({ amount: `En fazla ${formatMoney(refundable, event.currency)} iade edilebilir` });
    setErrors({});
    receive.mutate(body);
  }

  const busy = receive.isPending;
  const referenceLabel = PAYMENT_REFERENCE_REQUIRED_METHODS.includes(values.method) ? PAYMENT_REFERENCE_LABELS[values.method] : 'Referans (isteğe bağlı)';
  return (
    <Modal
      open
      size="sm"
      title={kind === 'REFUND' ? 'İade' : 'Tahsilat'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="event-payment-form" icon={kind === 'REFUND' ? 'rotateCcw' : 'banknote'} disabled={busy}>
            {busy ? 'İşleniyor…' : kind === 'REFUND' ? 'Onaya gönder' : 'Tahsil et'}
          </Button>
        </>
      }
    >
      <form id="event-payment-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {kind === 'REFUND' && (
          <Alert tone="info" title="İade onaylı işlenir">
            Başka bir yetkili onaylayınca işlenir. En fazla {formatMoney(refundable, event.currency)} (alınan para, bekleyen iadeler düşülmüş).
          </Alert>
        )}
        <ChoiceChips label="Yöntem" options={METHOD_OPTIONS} value={values.method} onChange={(method) => setValues((current) => ({ ...current, method }))} />
        <Input label={`Tutar (${event.currency})`} name="event-payment-amount" inputMode="decimal" value={values.amount} onChange={set('amount')} error={errors.amount} required disabled={busy} />
        <Input label={referenceLabel} name="event-payment-reference" value={values.reference} onChange={set('reference')} error={errors.reference} disabled={busy} placeholder="Slip / dekont / işlem no — kart numarası yazılmaz" />
        <Textarea label="Not" name="event-payment-note" rows={2} value={values.note} onChange={set('note')} error={errors.note} disabled={busy} />
      </form>
    </Modal>
  );
}

/** Hatalı girişin iptali (onaylı). @param {{ event: any, payment: any, onClose: () => void, onDone: () => void }} props */
function VoidDialog({ event, payment, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const request = useMutation({
    mutationFn: (body) => apiPost(`/banquet/events/${event.id}/payments/${payment.id}/void`, body),
    onSuccess: onDone,
    onError: (failure) => {
      setError(failure.fields?.reason ?? null);
      toastError(failure.message);
    },
  });

  function submit(submitEvent) {
    submitEvent.preventDefault();
    const checked = validateWith(voidEventPaymentSchema, { reason });
    if (!checked.ok) return setError(checked.errors.reason);
    setError(null);
    request.mutate({ reason });
  }

  const busy = request.isPending;
  return (
    <Modal
      open
      size="sm"
      title="Hatalı girişi iptal et"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="event-void-form" variant="danger" icon="close" disabled={busy}>
            {busy ? 'Gönderiliyor…' : 'Onaya gönder'}
          </Button>
        </>
      }
    >
      <form id="event-void-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">
          <strong>
            {PAYMENT_KIND_LABELS[payment.kind]} {formatMoney(Math.abs(Number(payment.amount)), payment.currency)} · {methodLabel(payment.method)}
          </strong>{' '}
          onaylanınca ters kayıtla düşülür. Müşteriye para geri veriliyorsa bu değil &quot;İade&quot; kullanılır.
        </p>
        <Textarea label="Gerekçe" name="event-void-reason" rows={3} value={reason} onChange={(changeEvent) => setReason(changeEvent.target.value)} error={error ?? undefined} required disabled={busy} />
      </form>
    </Modal>
  );
}
