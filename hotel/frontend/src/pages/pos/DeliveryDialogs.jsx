import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MAX_DELIVERY_DOOR_PAYMENTS, PAYMENT_REFERENCE_LABELS, POS_PAYMENT_METHODS, assignDeliveryCourierSchema, cancelDeliveryOrderSchema, deliverDeliveryOrderSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { api } from '../../lib/api.js';
import { defaultDoorPayments, deliveryStarted, doorPreview } from '../../lib/delivery.js';
import { useDeliveryAction, useDeliveryOrder } from '../../lib/deliveryQueries.js';
import { formatMoney } from '../../lib/format.js';
import { methodLabel } from '../../lib/payments.js';
import { posKeys } from '../../lib/pos.js';
import { changeDue } from '../../lib/posCart.js';
import { validateWith } from '../../lib/validate.js';
import { FormDialog } from './CheckDialogs.jsx';

/**
 * Paket siparişin diyalogları (modül 42): kurye atama, yola çıkarma, teslim (kapıda nakit / kart; kalan tam
 * kapanır) ve iptal. Kurye açık vardiyalı personeldir: kapıda alınan para onun kasasına girer. Girdiler sunucunun
 * şemasıyla önceden doğrulanır; sunucu hatası alanın altına ve bildirime düşer.
 */

const CANCEL_REASONS = Object.freeze(['Müşteri vazgeçti', 'Adres bulunamadı', 'Müşteriye ulaşılamadı', 'Hazırlanamadı']);
const METHOD_OPTIONS = POS_PAYMENT_METHODS.map((value) => ({ value, label: methodLabel(value) }));

/** @param {(errors: Record<string, string>) => void} setErrors */
const fieldErrors = (setErrors) => (error) => setErrors(error.fields ?? {});

/**
 * Açık vardiyalı personel (kurye adayları) seçimi.
 * @param {{ value: string, onChange: (value: string) => void, firstOption: { value: string, label: string } | null, error?: string, busy: boolean }} props
 */
function CourierSelect({ value, onChange, firstOption, error, busy }) {
  const waiters = useQuery({ queryKey: posKeys.openWaiters, queryFn: () => api('/pos/shifts/open-waiters') });
  if (waiters.isPending) return <Spinner className="py-3" />;
  if (waiters.isError) return <Alert tone="danger" title="Personel okunamadı">{waiters.error.message}</Alert>;
  const options = waiters.data.waiters.map((waiter) => ({ value: waiter.waiterEmail, label: `${waiter.name}${waiter.outletName ? ` · ${waiter.outletName}` : ''}` }));
  return (
    <>
      <Select label="Kurye" value={value} onChange={(event) => onChange(event.target.value)} options={firstOption ? [firstOption, ...options] : options} error={error} disabled={busy} />
      {options.length === 0 && <p className="text-xs text-warning-ink">Açık vardiyası olan personel yok; kurye önce vardiya açmalı (kapı parası kasasına girer).</p>}
    </>
  );
}

/* ══════════════════ Kurye ══════════════════ */

/**
 * Kurye ata / değiştir: kuryenin ziline düşer. Yoldaki siparişin kuryesi değişmez (önce geri alınır).
 * @param {{ order: any, onClose: () => void, onDone: (order: any) => void }} props
 */
export function AssignCourierDialog({ order, onClose, onDone }) {
  const [courierEmail, setCourierEmail] = useState(order.courierEmail ?? '');
  const [errors, setErrors] = useState({});
  const action = useDeliveryAction({ onDone });

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(assignDeliveryCourierSchema, { expectedUpdatedAt: order.updatedAt, courierEmail });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    action.mutate({ orderId: order.id, path: 'assign', body: checked.data, message: `${order.number}: kurye ${checked.data.courierEmail}` }, { onError: fieldErrors(setErrors) });
  }

  const busy = action.isPending;
  return (
    <FormDialog id="delivery-assign" title={`Kurye ata · ${order.number}`} busy={busy} onClose={onClose} submitLabel="Ata" icon="user" onSubmit={submit}>
      <p className="text-sm text-ink-soft">
        {order.customerName} · {order.address}
      </p>
      <CourierSelect value={courierEmail} onChange={setCourierEmail} firstOption={order.courierEmail ? null : { value: '', label: 'Kuryeyi seçin' }} error={errors.courierEmail} busy={busy} />
      <p className="text-xs text-ink-muted">Kurye zilinden haber alır; sipariş hazır olunca yola çıkarılır.</p>
    </FormDialog>
  );
}

/**
 * Yola çıkar: atanmış kurye (ya da şimdi seçilen) götürür.
 * @param {{ order: any, onClose: () => void, onDone: (order: any) => void }} props
 */
export function DeliveryDispatchDialog({ order, onClose, onDone }) {
  const [courierEmail, setCourierEmail] = useState('');
  const [error, setError] = useState(null);
  const action = useDeliveryAction({ onDone });

  function submit(event) {
    event.preventDefault();
    if (!order.courierEmail && !courierEmail) return setError('Kuryeyi seçin');
    setError(null);
    action.mutate(
      { orderId: order.id, path: 'advance', body: { expectedUpdatedAt: order.updatedAt, status: 'ON_THE_WAY', courierEmail: courierEmail || null }, message: `${order.number} yolda` },
      { onError: (failure) => setError(failure.fields?.courierEmail ?? null) },
    );
  }

  const busy = action.isPending;
  return (
    <FormDialog id="delivery-dispatch" title={`Yola çıkar · ${order.number}`} busy={busy} onClose={onClose} submitLabel="Yola çıktı" icon="truck" onSubmit={submit}>
      <p className="text-sm text-ink-soft">
        {order.customerName} · {order.address}
      </p>
      <CourierSelect
        value={courierEmail}
        onChange={setCourierEmail}
        firstOption={{ value: '', label: order.courierEmail ? `Atanmış kurye (${order.courierEmail})` : 'Kuryeyi seçin' }}
        error={error ?? undefined}
        busy={busy}
      />
      <p className="text-xs text-ink-muted">Kapıda ödeme alınacaksa kuryenin açık vardiyası olmalı (para onun kasasına girer).</p>
    </FormDialog>
  );
}

/* ══════════════════ Teslim ══════════════════ */

/**
 * Teslim: kapıda alınan nakit / kart (bölünebilir, en fazla dört) kalanı tam kapatır; ödemeler kuryenin vardiyasına.
 * Varsayılan satır: kalanın tamamı siparişte beklenen yöntemle. Nakitte verilen paradan para üstü hesaplanır.
 *
 * @param {{ order: any, onClose: () => void, onDone: (order: any) => void }} props
 */
export function DeliveryDeliverDialog({ order: card, onClose, onDone }) {
  const query = useDeliveryOrder(card.id);
  const order = query.data;
  if (!order) {
    return (
      <FormDialog id="delivery-deliver" title={`Teslim · ${card.number}`} busy={false} onClose={onClose} submitLabel="Teslim edildi" icon="checkCheck" onSubmit={(event) => event.preventDefault()}>
        {query.isPending && <Spinner className="py-6" label="Hesap okunuyor…" />}
        {query.isError && <Alert tone="danger" title="Sipariş okunamadı" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => query.refetch()}>Tekrar dene</Button>}>{query.error.message}</Alert>}
      </FormDialog>
    );
  }
  return <DeliverForm order={order} onClose={onClose} onDone={onDone} />;
}

/** @param {{ order: any, onClose: () => void, onDone: (order: any) => void }} props */
function DeliverForm({ order, onClose, onDone }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const balance = order.check?.balance ?? order.balance;
  const [payments, setPayments] = useState(() => defaultDoorPayments({ balance, doorMethod: order.doorMethod }));
  const [tendered, setTendered] = useState(order.changeFor ?? '');
  const [errors, setErrors] = useState({});
  const action = useDeliveryAction({ onDone });
  const busy = action.isPending;
  const preview = doorPreview({ balance, payments });
  const cash = payments.find((payment) => payment.method === 'CASH');
  const change = cash && tendered ? changeDue(tendered, cash.amount || '0') : null;
  const update = (index, patch) => setPayments((current) => current.map((payment, at) => (at === index ? { ...payment, ...patch } : payment)));

  function submit(event) {
    event.preventDefault();
    const body = { requestId, expectedUpdatedAt: order.updatedAt, payments: payments.map((payment) => ({ method: payment.method, amount: payment.amount, reference: payment.method === 'CARD' ? payment.reference : null })) };
    const checked = validateWith(deliverDeliveryOrderSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    if (preview.error) return setErrors({ payments: preview.error });
    if (cash && tendered && change === null) return setErrors({ tendered: 'Verilen para nakit tutarını karşılamıyor' });
    setErrors({});
    const message = `${order.number} teslim edildi${change && Number(change) > 0 ? ` · para üstü ${formatMoney(change, order.currency)}` : ''}`;
    action.mutate({ orderId: order.id, path: 'deliver', body: checked.data, message }, { onError: fieldErrors(setErrors) });
  }

  return (
    <FormDialog id="delivery-deliver" title={`Teslim · ${order.customerName} · ${order.number}`} busy={busy} onClose={onClose} submitLabel="Teslim edildi" icon="checkCheck" onSubmit={submit} size="md">
      <p className="text-sm text-ink-soft">
        Hesap <strong className="tabular-nums text-ink">{formatMoney(order.check?.grandTotal ?? order.total, order.currency)}</strong>
        {Number(order.check?.paidTotal ?? 0) > 0 && <> · önceden alınan {formatMoney(order.check.paidTotal, order.currency)}</>} · kapıda kalan{' '}
        <strong className="tabular-nums text-ink">{formatMoney(balance, order.currency)}</strong>
        {order.courierEmail && <> · kurye {order.courierEmail}</>}
      </p>
      {Number(balance) <= 0 && <p className="text-sm font-semibold text-success-ink">Tamamı önceden ödendi; kapıda ödeme alınmaz.</p>}
      {payments.map((payment, index) => (
        <div key={payment.key} className="grid grid-cols-1 gap-2 rounded-item border border-line p-3 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end">
          <ChoiceChips label={`${index + 1}. ödeme`} required options={METHOD_OPTIONS} value={payment.method} onChange={(method) => update(index, { method })} disabled={busy} />
          <Input label={`Tutar (${order.currency})`} name={`delivery-pay-amount-${index}`} inputMode="decimal" value={payment.amount} onChange={(event) => update(index, { amount: event.target.value })} error={errors[`payments.${index}.amount`]} required disabled={busy} />
          {payment.method === 'CARD' ? (
            <Input label={PAYMENT_REFERENCE_LABELS.CARD} name={`delivery-pay-ref-${index}`} value={payment.reference} onChange={(event) => update(index, { reference: event.target.value })} error={errors[`payments.${index}.reference`]} required disabled={busy} placeholder="Slip / provizyon no" />
          ) : (
            <span />
          )}
          <Button type="button" variant="ghost" size="sm" icon="trash" aria-label={`${index + 1}. ödemeyi kaldır`} onClick={() => setPayments((current) => current.filter((_, at) => at !== index))} disabled={busy} />
        </div>
      ))}
      {payments.length < MAX_DELIVERY_DOOR_PAYMENTS && Number(preview.remainder) > 0 && (
        <Button type="button" variant="outline" size="sm" icon="plus" onClick={() => setPayments((current) => [...current, { key: crypto.randomUUID(), method: 'CASH', amount: preview.remainder, reference: '' }])} disabled={busy}>
          Ödeme ekle (nakit / kart bölünmüş)
        </Button>
      )}
      {cash && <Input label="Verilen nakit (para üstü için, isteğe bağlı)" name="delivery-pay-tendered" inputMode="decimal" value={tendered} onChange={(event) => setTendered(event.target.value)} error={errors.tendered} disabled={busy} />}
      {change !== null && <p className="rounded-item bg-success-soft px-3 py-2 text-sm font-semibold text-success-ink">Para üstü: {formatMoney(change, order.currency)}</p>}
      <div className="rounded-item bg-surface-muted p-3 text-sm">
        Kapıda <strong className="tabular-nums">{formatMoney(preview.paid, order.currency)}</strong> · kalan <strong className="tabular-nums">{formatMoney(preview.remainder, order.currency)}</strong>
      </div>
      {(preview.error || errors.payments) && <Alert tone="danger" title="Teslim edilemez">{errors.payments ?? preview.error}</Alert>}
    </FormDialog>
  );
}

/* ══════════════════ İptal ══════════════════ */

/**
 * İptal: kalemler iptal edilir, adisyon sıfır tutarla kapanır; mutfak başladıysa zayi (şef garson). Ön ödeme
 * alınmışsa önce ödeme iptal edilir (sunucu söyler).
 * @param {{ order: any, onClose: () => void, onDone: (order: any) => void }} props
 */
export function DeliveryCancelDialog({ order, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [waste, setWaste] = useState(true);
  const [errors, setErrors] = useState({});
  const action = useDeliveryAction({ onDone });
  const started = deliveryStarted(order.status);

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(cancelDeliveryOrderSchema, { expectedUpdatedAt: order.updatedAt, reason, waste: started && waste });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    action.mutate({ orderId: order.id, path: 'cancel', body: checked.data, message: `${order.number} iptal edildi` }, { onError: fieldErrors(setErrors) });
  }

  const busy = action.isPending;
  return (
    <FormDialog id="delivery-cancel" title={`Paketi iptal et · ${order.number}`} busy={busy} onClose={onClose} submitLabel="İptal et" icon="close" variant="danger" onSubmit={submit}>
      <p className="text-sm text-ink-soft">Kalemler iptal edilir, adisyon sıfır tutarla kapanır. Önceden ödeme alındıysa önce ödemeyi iptal edin.</p>
      <ChoiceChips label="Hazır sebepler" options={CANCEL_REASONS.map((value) => ({ value, label: value }))} value={reason} onChange={(value) => setReason(value || '')} disabled={busy} />
      <Textarea label="Sebep" name="delivery-cancel-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} error={errors.reason} required disabled={busy} />
      {started && <Checkbox label="Hazırlanan ürünler zayi (stoktan düşülür)" checked={waste} onChange={(event) => setWaste(event.target.checked)} disabled={busy} />}
    </FormDialog>
  );
}
