import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DELIVERY_SOURCES,
  DELIVERY_SOURCE_LABELS,
  MAX_DELIVERY_ADDRESS_LENGTH,
  MAX_DELIVERY_ADDRESS_NOTE_LENGTH,
  MAX_DELIVERY_LINES,
  MAX_DELIVERY_NOTE_LENGTH,
  PAYMENT_REFERENCE_LABELS,
  POS_PAYMENT_METHODS,
  createDeliveryOrderSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Card, EmptyState, Icon, Input, Select, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { apiPost } from '../../lib/api.js';
import { DELIVERY_PATH, deliveryKeys, deliveryOrderPath, orderPaymentPreview } from '../../lib/delivery.js';
import { useDeliveryCustomer } from '../../lib/deliveryQueries.js';
import { formatMoney } from '../../lib/format.js';
import { methodLabel } from '../../lib/payments.js';
import { posKeys, useDebounced, usePosTerminal } from '../../lib/pos.js';
import { cartPayload, cartTotal } from '../../lib/posCart.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { MenuPicker } from './MenuPicker.jsx';
import { ShiftBar } from './ShiftBar.jsx';

const SOURCE_OPTIONS = DELIVERY_SOURCES.map((value) => ({ value, label: DELIVERY_SOURCE_LABELS[value] }));
const PAYMENT_OPTIONS = Object.freeze([
  { value: 'CASH', label: 'Kapıda nakit' },
  { value: 'CARD', label: 'Kapıda kart' },
  { value: 'PREPAID', label: 'Önceden ödendi' },
]);
const DOOR_OPTIONS = Object.freeze([
  { value: 'CASH', label: 'Kalan kapıda nakit' },
  { value: 'CARD', label: 'Kalan kapıda kart' },
]);
const METHOD_OPTIONS = POS_PAYMENT_METHODS.map((value) => ({ value, label: methodLabel(value) }));

const EMPTY = Object.freeze({
  source: 'PHONE',
  phone: '',
  customerName: '',
  address: '',
  addressNote: '',
  note: '',
  payment: 'CASH',
  changeFor: '',
  prepayMethod: 'CARD',
  prepayAmount: '',
  prepayReference: '',
  remainderMethod: 'CASH',
});

/**
 * Paket sipariş gövdesi: ödeme seçimi kapı yöntemine ve ön ödemeye çevrilir (bozuk para yalnızca kapıda nakitte).
 * @param {typeof EMPTY} values @param {{ outletId: string, requestId: string, cart: any[], remainder: string }} context
 */
function orderBody(values, { outletId, requestId, cart, remainder }) {
  const prepaid = values.payment === 'PREPAID';
  const doorMethod = prepaid ? (Number(remainder) > 0 ? values.remainderMethod : null) : values.payment;
  return {
    requestId,
    outletId,
    source: values.source,
    customerName: values.customerName,
    phone: values.phone,
    address: values.address,
    addressNote: values.addressNote,
    note: values.note,
    lines: cartPayload(cart, requestId).lines,
    doorMethod,
    changeFor: doorMethod === 'CASH' && values.changeFor.trim() ? values.changeFor : null,
    prepayments: prepaid ? [{ method: values.prepayMethod, amount: values.prepayAmount, reference: values.prepayMethod === 'CARD' ? values.prepayReference : null }] : [],
  };
}

/**
 * Paket sipariş formu (modül 42): kaynak (telefon / mesaj / web-platform), müşteri telefonu (tekrar gelen müşterinin
 * adı ve son adresleri önerilir), ad, adres ve tarif, paket servis noktası, menüden kalemler, not ve ödeme (kapıda
 * nakit — bozuk tutarıyla —, kapıda kart ya da önceden ödendi; kalan varsa kapıda). Paket ücreti ve en az sipariş
 * tutarı politikadan; en az tutarın altındaki sipariş gönderilmez. Sipariş vardiyanızda mutfağa düşer.
 */
export function DeliveryOrderForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const terminal = usePosTerminal();
  const [requestId] = useState(() => crypto.randomUUID());
  const [outletId, setOutletId] = useState('');
  const [cart, setCart] = useState([]);
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const phone = useDebounced(values.phone);
  const customer = useDeliveryCustomer(phone);

  const create = useMutation({
    mutationFn: (body) => apiPost('/pos/delivery/orders', body),
    onSuccess: (order) => {
      queryClient.setQueryData(deliveryKeys.order(order.id), order);
      queryClient.invalidateQueries({ queryKey: ['pos'] });
      toastSuccess(`${order.number} mutfağa düştü`);
      navigate(deliveryOrderPath(order.id));
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      if (error.code === 'VALIDATION') queryClient.invalidateQueries({ queryKey: posKeys.terminal });
      toastError(error.message);
    },
  });

  if (terminal.isPending || terminal.isError) return <QueryFallback query={terminal} errorTitle="Menü yüklenemedi" />;
  const outlets = terminal.data.outlets.filter((entry) => entry.kind === 'DELIVERY');
  const outlet = outlets.find((entry) => entry.id === outletId) ?? outlets[0] ?? null;
  if (!outlet) {
    return (
      <Card>
        <EmptyState icon="truck" title="Paket servis noktası yok" description="Menü ve tanımlardan türü “Paket servis” olan bir satış noktası ekleyin." />
      </Card>
    );
  }

  const { settings, currency } = terminal.data;
  const preview = orderPaymentPreview({
    itemsTotal: cartTotal(cart),
    fee: settings.deliveryFee ?? '0',
    minOrder: settings.deliveryMinOrder ?? '0',
    prepayments: values.payment === 'PREPAID' ? [{ amount: values.prepayAmount }] : [],
  });
  const patch = (next) => setValues((current) => ({ ...current, ...next }));

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(createDeliveryOrderSchema, orderBody(values, { outletId: outlet.id, requestId, cart, remainder: preview.remainder }));
    if (!checked.ok) {
      setErrors(checked.errors);
      toastError(Object.values(checked.errors)[0]);
      return;
    }
    if (preview.error) return setErrors({ prepayAmount: preview.error });
    setErrors({});
    create.mutate(checked.data);
  }

  const busy = create.isPending;
  const blocked = cart.length === 0 || Boolean(preview.shortfall) || Boolean(preview.error);
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={DELIVERY_PATH} className="flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
          <Icon name="arrowLeft" className="size-4" /> Paket servis panosu
        </Link>
        <h1 className="text-2xl font-bold text-ink">Yeni paket sipariş</h1>
      </div>
      <ShiftBar outlets={terminal.data.outlets} currency={currency} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col gap-4">
          <CustomerCard values={values} patch={patch} errors={errors} customer={customer} busy={busy} />
          <Card title="Teslim ve ödeme">
            <div className="flex flex-col gap-3">
              {outlets.length > 1 && <Select label="Paket servis noktası" value={outlet.id} onChange={(event) => setOutletId(event.target.value)} options={outlets.map((entry) => ({ value: entry.id, label: entry.name }))} disabled={busy} />}
              <PaymentFields values={values} patch={patch} errors={errors} preview={preview} currency={currency} busy={busy} />
              <Textarea label="Not (alerji, kapı, müşterinin isteği)" name="delivery-note" rows={2} maxLength={MAX_DELIVERY_NOTE_LENGTH} value={values.note} onChange={(event) => patch({ note: event.target.value })} error={errors.note} disabled={busy} />
            </div>
          </Card>
        </div>

        <Card title="Kalemler" description="Menüden ürüne dokunun; adet ve notu sepette düzeltin.">
          <MenuPicker
            terminal={terminal.data}
            outletId={outlet.id}
            cart={cart}
            onCart={setCart}
            maxLines={MAX_DELIVERY_LINES}
            busy={busy}
            actions={
              <Button type="submit" icon="send" disabled={busy || blocked}>
                {busy ? 'Kaydediliyor…' : 'Mutfağa gönder'}
              </Button>
            }
          />
          <Totals preview={preview} fee={settings.deliveryFee ?? '0'} minOrder={settings.deliveryMinOrder ?? '0'} currency={currency} />
          {errors.lines && <p className="mt-2 text-xs font-semibold text-danger-ink">{errors.lines}</p>}
        </Card>
      </div>
    </form>
  );
}

/**
 * Müşteri: kaynak, telefon (tekrar gelen müşterinin adı / son adresleri tek dokunuşla), ad, adres ve tarif.
 * @param {{ values: typeof EMPTY, patch: (next: Partial<typeof EMPTY>) => void, errors: Record<string, string>, customer: any, busy: boolean }} props
 */
function CustomerCard({ values, patch, errors, customer, busy }) {
  const known = customer.data;
  const suggestions = known?.addresses ?? [];
  return (
    <Card title="Müşteri" description="Telefonu yazın: daha önce sipariş verdiyse adı ve adresleri önerilir.">
      <div className="flex flex-col gap-3">
        <ChoiceChips label="Siparişin geldiği yol" required options={SOURCE_OPTIONS} value={values.source} onChange={(source) => patch({ source })} disabled={busy} />
        <Input label="Telefon" name="delivery-phone" type="tel" inputMode="tel" value={values.phone} onChange={(event) => patch({ phone: event.target.value })} error={errors.phone} required disabled={busy} placeholder="0532 111 22 33" />
        {(known?.customerName || suggestions.length > 0) && (
          <div className="flex flex-col gap-1.5 rounded-item border border-info-line bg-info-soft/40 p-2 text-sm" role="group" aria-label="Önceki siparişler">
            <span className="text-xs font-semibold text-info-ink">Tekrar gelen müşteri{known.customerName ? ` · ${known.customerName}` : ''}</span>
            {suggestions.map((entry) => (
              <button
                key={`${entry.address}|${entry.addressNote ?? ''}`}
                type="button"
                onClick={() => patch({ customerName: values.customerName || known.customerName || '', address: entry.address, addressNote: entry.addressNote ?? '' })}
                className="rounded-item border border-line bg-surface px-2 py-1 text-left hover:border-ink"
                disabled={busy}
              >
                {entry.address}
                {entry.addressNote && <span className="block text-xs text-ink-soft">{entry.addressNote}</span>}
              </button>
            ))}
          </div>
        )}
        <Input label="Ad soyad" name="delivery-name" value={values.customerName} onChange={(event) => patch({ customerName: event.target.value })} error={errors.customerName} required disabled={busy} />
        <Textarea label="Adres" name="delivery-address" rows={2} maxLength={MAX_DELIVERY_ADDRESS_LENGTH} value={values.address} onChange={(event) => patch({ address: event.target.value })} error={errors.address} required disabled={busy} />
        <Input label="Adres tarifi (kapı kodu, kat, yakın yer)" name="delivery-address-note" maxLength={MAX_DELIVERY_ADDRESS_NOTE_LENGTH} value={values.addressNote} onChange={(event) => patch({ addressNote: event.target.value })} error={errors.addressNote} disabled={busy} />
      </div>
    </Card>
  );
}

/**
 * Ödeme: kapıda nakit (bozuk tutarı) / kapıda kart / önceden ödendi (yöntem, tutar, kartta referans; kalan varsa
 * kapıda yöntemi).
 * @param {{ values: typeof EMPTY, patch: (next: Partial<typeof EMPTY>) => void, errors: Record<string, string>, preview: ReturnType<typeof orderPaymentPreview>, currency: string, busy: boolean }} props
 */
function PaymentFields({ values, patch, errors, preview, currency, busy }) {
  const prepaid = values.payment === 'PREPAID';
  const doorMethod = prepaid ? (Number(preview.remainder) > 0 ? values.remainderMethod : null) : values.payment;
  return (
    <>
      <ChoiceChips label="Ödeme" required options={PAYMENT_OPTIONS} value={values.payment} onChange={(payment) => patch({ payment })} disabled={busy} />
      {prepaid && (
        <div className="grid grid-cols-1 gap-2 rounded-item border border-line p-3 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
          <ChoiceChips label="Ön ödeme" required options={METHOD_OPTIONS} value={values.prepayMethod} onChange={(prepayMethod) => patch({ prepayMethod })} disabled={busy} />
          <Input
            label={`Tutar (${currency})`}
            name="delivery-prepay-amount"
            inputMode="decimal"
            value={values.prepayAmount}
            onChange={(event) => patch({ prepayAmount: event.target.value })}
            error={errors.prepayAmount ?? errors['prepayments.0.amount']}
            required
            disabled={busy}
          />
          {values.prepayMethod === 'CARD' ? (
            <Input label={PAYMENT_REFERENCE_LABELS.CARD} name="delivery-prepay-ref" value={values.prepayReference} onChange={(event) => patch({ prepayReference: event.target.value })} error={errors['prepayments.0.reference']} required disabled={busy} placeholder="Slip / provizyon no" />
          ) : (
            <span />
          )}
          <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => patch({ prepayAmount: preview.total })} disabled={busy}>
            Tamamı ({formatMoney(preview.total, currency)})
          </Button>
        </div>
      )}
      {prepaid && Number(preview.remainder) > 0 && <ChoiceChips label="Kalan" required options={DOOR_OPTIONS} value={values.remainderMethod} onChange={(remainderMethod) => patch({ remainderMethod })} disabled={busy} />}
      {doorMethod === 'CASH' && (
        <Input label="Bozuk para (müşteri şu tutarı verecek, isteğe bağlı)" name="delivery-change-for" inputMode="decimal" value={values.changeFor} onChange={(event) => patch({ changeFor: event.target.value })} error={errors.changeFor} disabled={busy} placeholder="ör. 500" />
      )}
      {prepaid && <p className="text-xs text-ink-muted">Ön ödeme vardiyanızın kasasına yazılır; kapıda kalan kuryenin kasasına girer.</p>}
    </>
  );
}

/**
 * Tutarlar: ürünler, paket ücreti, toplam, ön ödeme ve kapıda kalan; en az tutarın altındaysa uyarı.
 * @param {{ preview: ReturnType<typeof orderPaymentPreview>, fee: string, minOrder: string, currency: string }} props
 */
function Totals({ preview, fee, minOrder, currency }) {
  const money = (value) => formatMoney(value, currency);
  return (
    <div className="mt-3 flex flex-col gap-2">
      <dl className="grid grid-cols-2 gap-y-1 rounded-item bg-surface-muted p-3 text-sm">
        {Number(fee) > 0 && (
          <>
            <dt className="text-ink-soft">Paket servis ücreti</dt>
            <dd className="text-right tabular-nums">{money(fee)}</dd>
          </>
        )}
        <dt className="text-ink-soft">Toplam</dt>
        <dd className="text-right font-bold tabular-nums">{money(preview.total)}</dd>
        {Number(preview.prepaid) > 0 && (
          <>
            <dt className="text-ink-soft">Önceden ödenen</dt>
            <dd className="text-right tabular-nums">{money(preview.prepaid)}</dd>
          </>
        )}
        <dt className="text-ink-soft">Kapıda alınacak</dt>
        <dd className="text-right font-bold tabular-nums">{money(preview.remainder)}</dd>
      </dl>
      {preview.shortfall && (
        <Alert tone="warning" title={`En az sipariş tutarı ${money(minOrder)}`}>
          Ürün toplamı {money(preview.shortfall)} eksik (paket ücreti hariç).
        </Alert>
      )}
      {preview.error && <Alert tone="danger" title="Ön ödeme">{preview.error}</Alert>}
    </div>
  );
}
