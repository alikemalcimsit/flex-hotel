import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  MAX_DOOR_PAYMENTS,
  MAX_ROOM_SERVICE_LINES,
  PAYMENT_REFERENCE_LABELS,
  POS_PAYMENT_METHODS,
  acceptRoomServiceOrderSchema,
  cancelRoomServiceOrderSchema,
  deliverRoomServiceOrderSchema,
  kitchenStarted,
  rejectRoomServiceOrderSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Switch } from '../../components/Switch.jsx';
import { api } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { methodLabel } from '../../lib/payments.js';
import { posKeys } from '../../lib/pos.js';
import { cartPayload, changeDue } from '../../lib/posCart.js';
import { cartFromItems, deliveryPreview } from '../../lib/roomService.js';
import { useRoomServiceAction, useRoomServiceOrder } from '../../lib/roomServiceQueries.js';
import { useAuthStore } from '../../store/auth.js';
import { validateWith } from '../../lib/validate.js';
import { FormDialog } from './CheckDialogs.jsx';
import { MenuPicker } from './MenuPicker.jsx';

/**
 * Oda servisi siparişinin diyalogları (modül 41): misafir siparişini kabul (kalemler değiştirilebilir) / ret, planlıyı
 * mutfağa gönderme, yola çıkarma (götüren), teslim (kapıda nakit / kart + kalan odaya) ve iptal. Girdiler sunucunun
 * şemasıyla önceden doğrulanır; sunucu hatası alanın altına ve bildirime düşer.
 */

const REJECT_REASONS = Object.freeze(['Mutfak kapalı', 'Ürün tükendi', 'Misafire ulaşılamadı', 'Yanlış sipariş']);
const CANCEL_REASONS = Object.freeze(['Misafir vazgeçti', 'Yanlış oda', 'Misafir odada değil', 'Hazırlanamadı']);
const METHOD_OPTIONS = POS_PAYMENT_METHODS.map((value) => ({ value, label: methodLabel(value) }));

/** @param {(errors: Record<string, string>) => void} setErrors */
const fieldErrors = (setErrors) => (error) => setErrors(error.fields ?? {});

/* ══════════════════ Kabul / mutfağa gönderme ══════════════════ */

/**
 * Misafir siparişini kabul ya da planlı siparişi şimdi mutfağa gönderme. Kalemler olduğu gibi gider; ürün tükendiyse
 * (ya da misafirle konuşulup değiştiyse) "Kalemleri değiştir" ile menüden düzenlenir.
 *
 * @param {{ order: any, terminal: any | null, mode: 'accept' | 'release', onClose: () => void, onDone: (order: any) => void }} props
 */
export function LinesConfirmDialog({ order, terminal, mode, onClose, onDone }) {
  const [editing, setEditing] = useState(false);
  const [cart, setCart] = useState(() => cartFromItems(order.items));
  const [error, setError] = useState(null);
  const action = useRoomServiceAction({ onDone });
  const accept = mode === 'accept';
  const scheduled = accept && order.deliverAt;

  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: order.updatedAt, ...(editing ? { lines: cartPayload(cart, '').lines } : {}) };
    const checked = validateWith(acceptRoomServiceOrderSchema, body);
    if (!checked.ok) return setError(Object.values(checked.errors)[0]);
    setError(null);
    action.mutate(
      { orderId: order.id, path: accept ? 'accept' : 'release', body: checked.data, message: (updated) => (updated.status === 'SCHEDULED' ? `${updated.number} kabul edildi; zamanı gelince mutfağa düşer` : `${updated.number} mutfağa düştü`) },
      { onError: (failure) => setError(failure.message) },
    );
  }

  const busy = action.isPending;
  return (
    <FormDialog
      id={`rs-${mode}`}
      title={accept ? `Misafir siparişi · oda ${order.roomNumber}` : `Şimdi mutfağa gönder · oda ${order.roomNumber}`}
      busy={busy}
      onClose={onClose}
      submitLabel={accept ? (scheduled ? 'Kabul et (planla)' : 'Kabul et, mutfağa gönder') : 'Mutfağa gönder'}
      icon={accept ? 'check' : 'send'}
      onSubmit={submit}
      size={editing ? 'md' : 'sm'}
    >
      {!editing && (
        <ul className="flex flex-col gap-1 rounded-item bg-surface-muted p-3 text-sm">
          {order.items.map((item, index) => (
            <li key={`${item.menuItemId}:${index}`}>
              <strong className="tabular-nums">{item.quantity}×</strong> {item.name}
              {item.note && <span className="ml-1 italic text-ink-soft">“{item.note}”</span>}
            </li>
          ))}
        </ul>
      )}
      {order.note && <p className="text-sm italic text-ink-soft">Misafirin notu: “{order.note}”</p>}
      {accept && <p className="text-sm text-ink-soft">{scheduled ? 'İleri saatli: teslimden hazırlık payı kadar önce mutfağa düşer.' : 'Kabul edince vardiyanızda adisyon açılır ve sipariş mutfağa düşer.'}</p>}
      {terminal &&
        (editing ? (
          <MenuPicker terminal={terminal} outletId={order.outletId} cart={cart} onCart={setCart} maxLines={MAX_ROOM_SERVICE_LINES} busy={busy} />
        ) : (
          <Button type="button" variant="outline" size="sm" icon="pencil" onClick={() => setEditing(true)} disabled={busy}>
            Kalemleri değiştir (tükenen / misafirle konuşuldu)
          </Button>
        ))}
      {error && <Alert tone="danger" title="Gönderilemedi">{error}</Alert>}
    </FormDialog>
  );
}

/* ══════════════════ Ret ══════════════════ */

/** Misafir siparişini ret: sebep misafirin sayfasında görünür. @param {{ order: any, onClose: () => void, onDone: (order: any) => void }} props */
export function RejectDialog({ order, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const action = useRoomServiceAction({ onDone });

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(rejectRoomServiceOrderSchema, { expectedUpdatedAt: order.updatedAt, reason });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    action.mutate({ orderId: order.id, path: 'reject', body: checked.data, message: `${order.number} reddedildi` }, { onError: fieldErrors(setErrors) });
  }

  const busy = action.isPending;
  return (
    <FormDialog id="rs-reject" title={`Misafir siparişini reddet · oda ${order.roomNumber}`} busy={busy} onClose={onClose} submitLabel="Reddet" icon="close" variant="danger" onSubmit={submit}>
      <p className="text-sm text-ink-soft">Sebep misafirin sipariş sayfasında görünür; misafire telefonla da haber verin.</p>
      <ChoiceChips label="Hazır sebepler" options={REJECT_REASONS.map((value) => ({ value, label: value }))} value={reason} onChange={(value) => setReason(value || '')} disabled={busy} />
      <Textarea label="Sebep" name="rs-reject-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} error={errors.reason} required disabled={busy} />
    </FormDialog>
  );
}

/* ══════════════════ Yola çıkarma ══════════════════ */

/**
 * Yola çıkar: götüren seçilir (açık vardiyalı personel; boşsa işlemi yapan).
 * @param {{ order: any, onClose: () => void, onDone: (order: any) => void }} props
 */
export function DispatchDialog({ order, onClose, onDone }) {
  const me = useAuthStore((state) => state.user?.email ?? '');
  const waiters = useQuery({ queryKey: posKeys.openWaiters, queryFn: () => api('/pos/shifts/open-waiters') });
  const [runner, setRunner] = useState('');
  const action = useRoomServiceAction({ onDone });
  const options = waiters.data?.waiters ?? [];

  function submit(event) {
    event.preventDefault();
    action.mutate({ orderId: order.id, path: 'advance', body: { expectedUpdatedAt: order.updatedAt, status: 'ON_THE_WAY', runnerEmail: runner || null }, message: `${order.number} yolda` });
  }

  const busy = action.isPending;
  return (
    <FormDialog id="rs-dispatch" title={`Yola çıkar · oda ${order.roomNumber}`} busy={busy} onClose={onClose} submitLabel="Yola çıktı" icon="arrowRight" onSubmit={submit}>
      {waiters.isPending && <Spinner className="py-3" />}
      {waiters.isError && <Alert tone="danger" title="Personel okunamadı">{waiters.error.message}</Alert>}
      {waiters.isSuccess && (
        <Select
          label="Götüren"
          value={runner}
          onChange={(event) => setRunner(event.target.value)}
          options={[{ value: '', label: `Ben (${me})` }, ...options.filter((waiter) => waiter.waiterEmail !== me).map((waiter) => ({ value: waiter.waiterEmail, label: `${waiter.name}${waiter.outletName ? ` · ${waiter.outletName}` : ''}` }))]}
          disabled={busy}
        />
      )}
      <p className="text-xs text-ink-muted">Kapıda ödeme alınacaksa götürenin açık vardiyası olmalı (para onun kasasına girer).</p>
    </FormDialog>
  );
}

/* ══════════════════ Teslim ══════════════════ */

/**
 * Teslim: kapıda alınan nakit / kart (bölünebilir, en fazla dört) ve kalanın odaya yazılması. Önizleme sunucunun
 * kuralıyla aynı; nakitte verilen paradan para üstü hesaplanır. Konaklama bittiyse kalan kapıda alınmalı.
 *
 * @param {{ order: any, onClose: () => void, onDone: (order: any) => void }} props
 */
export function DeliverDialog({ order: card, onClose, onDone }) {
  const query = useRoomServiceOrder(card.id);
  const [requestId] = useState(() => crypto.randomUUID());
  const [payments, setPayments] = useState([]);
  const [chargeRemainder, setChargeRemainder] = useState(true);
  const [tendered, setTendered] = useState('');
  const [errors, setErrors] = useState({});
  const action = useRoomServiceAction({ onDone });
  const order = query.data;
  const busy = action.isPending;

  if (!order) {
    return (
      <FormDialog id="rs-deliver" title={`Teslim · oda ${card.roomNumber}`} busy={false} onClose={onClose} submitLabel="Teslim edildi" icon="checkCheck" onSubmit={(event) => event.preventDefault()}>
        {query.isPending && <Spinner className="py-6" label="Hesap okunuyor…" />}
        {query.isError && <Alert tone="danger" title="Sipariş okunamadı" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => query.refetch()}>Tekrar dene</Button>}>{query.error.message}</Alert>}
      </FormDialog>
    );
  }

  const balance = order.check?.balance ?? '0.00';
  const canCharge = order.stayActive && chargeRemainder;
  const preview = deliveryPreview({ balance, payments, chargeRemainder: canCharge });
  const cash = payments.find((payment) => payment.method === 'CASH');
  const change = cash && tendered ? changeDue(tendered, cash.amount || '0') : null;
  const set = (index, key) => (event) => setPayments((current) => current.map((payment, at) => (at === index ? { ...payment, [key]: event.target.value } : payment)));

  function submit(event) {
    event.preventDefault();
    const body = { requestId, expectedUpdatedAt: order.updatedAt, payments: payments.map((payment) => ({ method: payment.method, amount: payment.amount, reference: payment.method === 'CARD' ? payment.reference : null })), chargeRemainder: canCharge };
    const checked = validateWith(deliverRoomServiceOrderSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    if (preview.error) return setErrors({ payments: preview.error });
    if (cash && tendered && change === null) return setErrors({ tendered: 'Verilen para nakit tutarını karşılamıyor' });
    setErrors({});
    action.mutate(
      {
        orderId: order.id,
        path: 'deliver',
        body: checked.data,
        message: (updated) =>
          `${updated.number} teslim edildi${Number(preview.remainder) > 0 ? ` · ${formatMoney(preview.remainder, order.currency)} odaya yazıldı` : ''}${change && Number(change) > 0 ? ` · para üstü ${formatMoney(change, order.currency)}` : ''}`,
      },
      { onError: fieldErrors(setErrors) },
    );
  }

  return (
    <FormDialog id="rs-deliver" title={`Teslim · oda ${order.movedTo ?? order.roomNumber} · ${order.number}`} busy={busy} onClose={onClose} submitLabel="Teslim edildi" icon="checkCheck" onSubmit={submit} size="md">
      <p className="text-sm text-ink-soft">
        Hesap <strong className="tabular-nums text-ink">{formatMoney(order.check?.grandTotal ?? '0', order.currency)}</strong>
        {Number(order.check?.paidTotal ?? 0) + Number(order.check?.roomChargeTotal ?? 0) > 0 && <> · alınan {formatMoney((Number(order.check.paidTotal) + Number(order.check.roomChargeTotal)).toFixed(2), order.currency)}</>} · kalan{' '}
        <strong className="tabular-nums text-ink">{formatMoney(balance, order.currency)}</strong>
      </p>
      {!order.stayActive && <Alert tone="warning" title="Misafirin konaklaması bitti">Odaya yazılamaz; kalanı kapıda alın.</Alert>}
      {payments.length === 0 && Number(balance) > 0 && <p className="text-sm">Kapıda ödeme yoksa tutarın tamamı misafirin folyosuna yazılır.</p>}
      {payments.map((payment, index) => (
        <div key={payment.key} className="grid grid-cols-1 gap-2 rounded-item border border-line p-3 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end">
          <ChoiceChips label={`${index + 1}. ödeme`} required options={METHOD_OPTIONS} value={payment.method} onChange={(method) => setPayments((current) => current.map((row, at) => (at === index ? { ...row, method } : row)))} disabled={busy} />
          <Input label={`Tutar (${order.currency})`} name={`rs-pay-amount-${index}`} inputMode="decimal" value={payment.amount} onChange={set(index, 'amount')} error={errors[`payments.${index}.amount`]} required disabled={busy} />
          {payment.method === 'CARD' ? (
            <Input label={PAYMENT_REFERENCE_LABELS.CARD} name={`rs-pay-ref-${index}`} value={payment.reference} onChange={set(index, 'reference')} error={errors[`payments.${index}.reference`]} required disabled={busy} placeholder="Slip / provizyon no" />
          ) : (
            <span />
          )}
          <Button type="button" variant="ghost" size="sm" icon="trash" aria-label={`${index + 1}. ödemeyi kaldır`} onClick={() => setPayments((current) => current.filter((_, at) => at !== index))} disabled={busy} />
        </div>
      ))}
      {payments.length < MAX_DOOR_PAYMENTS && Number(balance) > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          icon="plus"
          onClick={() => setPayments((current) => [...current, { key: crypto.randomUUID(), method: 'CASH', amount: deliveryPreview({ balance, payments: current, chargeRemainder: true }).remainder, reference: '' }])}
          disabled={busy || Number(preview.remainder) === 0}
        >
          Kapıda ödeme ekle (nakit / kart)
        </Button>
      )}
      {cash && <Input label="Verilen nakit (para üstü için, isteğe bağlı)" name="rs-pay-tendered" inputMode="decimal" value={tendered} onChange={(event) => setTendered(event.target.value)} error={errors.tendered} disabled={busy} />}
      {change !== null && <p className="rounded-item bg-success-soft px-3 py-2 text-sm font-semibold text-success-ink">Para üstü: {formatMoney(change, order.currency)}</p>}
      {Number(preview.remainder) > 0 && order.stayActive && (
        <Switch label={`Kalan ${formatMoney(preview.remainder, order.currency)} odaya yazılsın`} showLabel checked={chargeRemainder} onChange={setChargeRemainder} disabled={busy} />
      )}
      <div className="rounded-item bg-surface-muted p-3 text-sm">
        Kapıda <strong className="tabular-nums">{formatMoney(preview.paid, order.currency)}</strong> · odaya <strong className="tabular-nums">{formatMoney(canCharge ? preview.remainder : '0', order.currency)}</strong>
      </div>
      {(preview.error || errors.payments || errors.chargeRemainder) && <Alert tone="danger" title="Teslim edilemez">{errors.payments ?? errors.chargeRemainder ?? preview.error}</Alert>}
    </FormDialog>
  );
}

/* ══════════════════ İptal ══════════════════ */

/**
 * İptal: mutfak başladıysa kalemler zayi sayılır (şef garson); planlı sipariş adisyonsuz düşer.
 * @param {{ order: any, onClose: () => void, onDone: (order: any) => void }} props
 */
export function CancelDialog({ order, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [waste, setWaste] = useState(true);
  const [errors, setErrors] = useState({});
  const action = useRoomServiceAction({ onDone });
  const started = kitchenStarted(order.status);

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(cancelRoomServiceOrderSchema, { expectedUpdatedAt: order.updatedAt, reason, waste: started && waste });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    action.mutate({ orderId: order.id, path: 'cancel', body: checked.data, message: `${order.number} iptal edildi` }, { onError: fieldErrors(setErrors) });
  }

  const busy = action.isPending;
  return (
    <FormDialog id="rs-cancel" title={`Siparişi iptal et · ${order.number}`} busy={busy} onClose={onClose} submitLabel="İptal et" icon="close" variant="danger" onSubmit={submit}>
      <p className="text-sm text-ink-soft">
        {order.status === 'SCHEDULED' ? 'Planlı sipariş henüz mutfağa düşmedi; adisyon açılmamış.' : 'Kalemler iptal edilir, adisyon sıfır tutarla kapanır.'}
      </p>
      <ChoiceChips label="Hazır sebepler" options={CANCEL_REASONS.map((value) => ({ value, label: value }))} value={reason} onChange={(value) => setReason(value || '')} disabled={busy} />
      <Textarea label="Sebep" name="rs-cancel-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} error={errors.reason} required disabled={busy} />
      {started && <Checkbox label="Hazırlanan ürünler zayi (stoktan düşülür)" checked={waste} onChange={(event) => setWaste(event.target.checked)} disabled={busy} />}
    </FormDialog>
  );
}

