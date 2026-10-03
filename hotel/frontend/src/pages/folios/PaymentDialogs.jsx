import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  FOREIGN_CURRENCY_METHODS,
  PAYMENT_METHODS,
  PAYMENT_NOTE_MAX,
  PAYMENT_REASON_MAX,
  PAYMENT_REFERENCE_LABELS,
  PAYMENT_REFERENCE_MAX,
  PAYMENT_REFERENCE_REQUIRED_METHODS,
  REFUND_METHODS,
  paymentQuoteSchema,
  paymentVoidSchema,
  receivePaymentSchema,
  refundRequestSchema,
  stayPaymentSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Icon, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PAYMENT_METHOD_ICONS, absolute, cashKeys, formatRate, kindLabel, methodLabel } from '../../lib/payments.js';
import { newRequestId } from '../../lib/reservations.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

const QUOTE_DEBOUNCE_MS = 350;

const REFUND_REASONS = Object.freeze(['Teminat iadesi', 'Fazla ödeme', 'Erken ayrılış', 'Hizmet iptali']);
const VOID_REASONS = Object.freeze(['Yanlış tutar girildi', 'Yanlış folyoya girildi', 'Çift giriş', 'Yanlış yöntem']);

/**
 * Ödeme al / iade iste (modül 17).
 *
 * Tutar ödemenin kendi para birimindedir; dövizde kur günün kur tablosundan
 * gelir (formda yazılmaz), folyoya girecek tutar ve onaya gidip gitmeyeceği
 * sunucunun hesabıyla canlı gösterilir. Form gördüğü kuru gönderir; bu arada
 * kur değiştiyse sunucu yazmaz, yeni kur gösterilir ve personel yeniden onaylar.
 * Eşik üstü ödeme ve her iade ikinci bir yetkilinin onayına gider. Form
 * açılırken üretilen istek kimliği çift gönderimde ikinci satırı engeller.
 *
 * @param {{
 *   mode: 'payment' | 'refund',
 *   target: { folioId?: string | null, reservationId?: string, name: string, currency: string, balance?: string | null, refundable?: string | null, advance?: boolean },
 *   onClose: () => void,
 *   onDone: (result: { payment: object, created: boolean }) => void,
 * }} props
 */
export function PaymentDialog({ mode, target, onClose, onDone }) {
  const refund = mode === 'refund';
  const [requestId] = useState(newRequestId);
  const methods = refund ? REFUND_METHODS : PAYMENT_METHODS;
  const [method, setMethod] = useState('CASH');
  const [currency, setCurrency] = useState(target.currency);
  const [amount, setAmount] = useState(() => suggestedAmount(mode, target) ?? '');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);

  const foreignAllowed = FOREIGN_CURRENCY_METHODS.includes(method);
  const rates = useQuery({ queryKey: cashKeys.rates, queryFn: () => api('/exchange-rates/current'), staleTime: 60_000 });
  const usableRates = (rates.data?.rates ?? []).filter((rate) => rate.usable);
  const currencies = [target.currency, ...usableRates.map((rate) => rate.currency)];
  // Döviz kabul etmeyen yönteme geçilince folyonun parasına döner.
  useEffect(() => {
    if (!foreignAllowed && currency !== target.currency) setCurrency(target.currency);
  }, [foreignAllowed, currency, target.currency]);

  const quoteInput = useMemo(() => ({ amount, currency, kind: refund ? 'REFUND' : 'PAYMENT' }), [amount, currency, refund]);
  const [debounced, setDebounced] = useState(quoteInput);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(quoteInput), QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [quoteInput]);
  const quoteValid = paymentQuoteSchema.safeParse(debounced).success;
  const quote = useQuery({
    queryKey: cashKeys.quote(debounced),
    queryFn: () => apiPost('/payments/quote', debounced),
    enabled: quoteValid,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (body) => {
      if (refund) return apiPost(`/payments/folios/${target.folioId}/refunds`, body);
      if (target.folioId) return apiPost(`/payments/folios/${target.folioId}`, body);
      return apiPost(`/payments/stays/${target.reservationId}`, body);
    },
    onSuccess: (result) => {
      if (!result.created) toastSuccess('Bu işlem zaten kaydedilmişti; ikinci kez yazılmadı');
      else if (result.payment.status === 'PENDING') {
        toastSuccess(`${kindLabel(result.payment.kind)} onaya gönderildi; başka bir yetkili onaylayınca bakiyeye girer`);
      } else toastSuccess(`${methodLabel(result.payment.method)} ödeme işlendi: ${formatMoney(absolute(result.payment.folioAmount), target.currency)}`);
      onDone(result);
      onClose();
    },
    onError: (error) => {
      setServerError(error);
      if (error.fields) setErrors(error.fields);
      // Kur değişti: yeni kuru göster (önizleme tazelenir), personel yeniden onaylasın.
      if (error.code === 'RATE_CHANGED') quote.refetch();
    },
  });
  const busy = mutation.isPending;

  function submit(event) {
    event.preventDefault();
    setServerError(null);
    const foreign = currency !== target.currency;
    // Yalnızca bu para biriminin önizlemesindeki kur (döviz yeni değiştiyse önizleme henüz eski olabilir).
    const shownRate = quote.data?.currency === currency ? quote.data.rate : null;
    const body = {
      requestId,
      method,
      amount,
      currency,
      expectedRate: foreign ? shownRate : null,
      reference: reference || null,
      ...(refund ? { reason } : { note: note || null }),
      ...(!refund && !target.folioId ? { folioId: null } : {}),
    };
    const schema = refund ? refundRequestSchema : target.folioId ? receivePaymentSchema : stayPaymentSchema;
    const result = validateWith(schema, body);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (foreign && !shownRate) {
      setErrors({ currency: quote.data?.problem ?? 'Kur bekleniyor; birazdan tekrar deneyin' });
      return;
    }
    setErrors({});
    mutation.mutate(body);
  }

  const title = refund ? `İade — ${target.name}` : target.advance ? `Ön ödeme al — ${target.name}` : `Ödeme al — ${target.name}`;
  const referenceRequired = PAYMENT_REFERENCE_REQUIRED_METHODS.includes(method);

  return (
    <Modal
      open
      size="md"
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="payment-form" icon={refund ? 'rotateCcw' : 'wallet'} disabled={busy}>
            {busy ? 'Kaydediliyor…' : refund ? 'İadeyi onaya gönder' : quote.data?.requiresApproval ? 'Onaya gönder' : 'Ödemeyi işle'}
          </Button>
        </>
      }
    >
      <form id="payment-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {serverError && (
          <Alert tone={serverError.code === 'RATE_CHANGED' ? 'warning' : 'danger'} title={serverError.code === 'RATE_CHANGED' ? 'Kur değişti' : 'Kaydedilmedi'}>
            {serverError.message}
          </Alert>
        )}
        <BalanceLine mode={mode} target={target} />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink">{refund ? 'İade yöntemi' : 'Ödeme yöntemi'}</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Yöntem">
            {methods.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={method === value}
                disabled={busy}
                onClick={() => setMethod(value)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
                  method === value ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink'
                }`}
              >
                <Icon name={PAYMENT_METHOD_ICONS[value]} className="size-4" />
                {methodLabel(value)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <Input
            label={refund ? 'İade tutarı' : 'Tutar'}
            inputMode="decimal"
            placeholder="ör. 2500 ya da 2500,50"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            error={errors.amount}
            disabled={busy}
            autoFocus
          />
          <Select
            label="Para birimi"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            options={currencies.map((value) => ({ value, label: value }))}
            error={errors.currency}
            disabled={busy || !foreignAllowed || currencies.length < 2}
          />
        </div>
        {!foreignAllowed && usableRates.length > 0 && <p className="-mt-2 text-xs text-ink-muted">Döviz yalnızca nakit ya da havaleyle alınır.</p>}
        {foreignAllowed && rates.isSuccess && usableRates.length === 0 && (
          <p className="-mt-2 text-xs text-ink-muted">Döviz almak için önce günün kurunu girin (Kasa → Kurlar).</p>
        )}

        <Input
          label={PAYMENT_REFERENCE_LABELS[method]}
          value={reference}
          maxLength={PAYMENT_REFERENCE_MAX}
          placeholder={referenceRequired ? 'Kart numarası değil; slip / dekont numarası' : ''}
          onChange={(event) => setReference(event.target.value)}
          error={errors.reference}
          disabled={busy}
        />

        {refund ? (
          <>
            <ChoiceChips label="Hazır gerekçeler" options={REFUND_REASONS.map((value) => ({ value, label: value }))} value={reason} onChange={setReason} disabled={busy} />
            <Textarea label="Gerekçe" rows={2} value={reason} maxLength={PAYMENT_REASON_MAX} onChange={(event) => setReason(event.target.value)} error={errors.reason} disabled={busy} />
          </>
        ) : (
          <Input label="Not (isteğe bağlı)" value={note} maxLength={PAYMENT_NOTE_MAX} onChange={(event) => setNote(event.target.value)} error={errors.note} disabled={busy} />
        )}

        <QuotePreview query={quote} enabled={quoteValid} refund={refund} folioCurrency={target.currency} />
      </form>
    </Modal>
  );
}

/**
 * Formun önerdiği tutar: ödemede borç, iadede iade edilecek (alacak, iade sınırıyla).
 * @param {'payment' | 'refund'} mode
 * @param {{ balance?: string | null, refundable?: string | null }} target
 */
function suggestedAmount(mode, target) {
  const balance = Number(target.balance ?? 0);
  if (mode === 'payment') return balance > 0 ? String(target.balance) : null;
  if (balance >= 0) return null;
  const credit = absolute(target.balance);
  return target.refundable && Number(target.refundable) < Number(credit) ? String(target.refundable) : credit;
}

/** @param {{ mode: 'payment' | 'refund', target: { balance?: string | null, refundable?: string | null, currency: string } }} props */
function BalanceLine({ mode, target }) {
  if (target.balance === undefined || target.balance === null) return null;
  const balance = Number(target.balance);
  return (
    <dl className="grid grid-cols-2 gap-y-1 rounded-item bg-surface-muted px-4 py-3 text-sm">
      <dt className="text-ink-muted">{balance < 0 ? 'Misafirin alacağı' : 'Bakiye (borç)'}</dt>
      <dd className="text-right font-bold tabular-nums">{formatMoney(absolute(target.balance), target.currency)}</dd>
      {mode === 'refund' && target.refundable !== undefined && target.refundable !== null && (
        <>
          <dt className="text-ink-muted">En fazla iade</dt>
          <dd className="text-right tabular-nums">{formatMoney(target.refundable, target.currency)}</dd>
        </>
      )}
    </dl>
  );
}

/**
 * Sunucunun hesabı: kur, folyoya girecek tutar, onay.
 * @param {{ query: any, enabled: boolean, refund: boolean, folioCurrency: string }} props
 */
function QuotePreview({ query, enabled, refund, folioCurrency }) {
  if (!enabled) {
    return <p className="rounded-item bg-surface-muted px-4 py-3 text-xs text-ink-muted">Tutarı girince folyoya girecek tutar ve onay durumu burada görünür.</p>;
  }
  if (query.isPending) return <Spinner label="Hesaplanıyor…" className="py-2" />;
  if (query.isError) return <p className="text-xs text-sec-strong">Önizleme alınamadı: {query.error.message}</p>;
  const data = query.data;
  if (data.problem) return <Alert tone="warning" title="Bu para biriminde ödeme alınamıyor">{data.problem}</Alert>;
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-2 gap-y-1 rounded-item bg-surface-muted px-4 py-3 text-sm">
        {data.rate && (
          <>
            <dt className="text-ink-muted">Kur ({formatDate(data.rateDate)})</dt>
            <dd className="text-right tabular-nums">1 {data.currency} = {formatRate(data.rate)} {folioCurrency}</dd>
          </>
        )}
        <dt className="font-bold text-ink">{refund ? 'Folyodan düşecek ödeme' : 'Folyoya girecek'}</dt>
        <dd className="text-right font-bold tabular-nums">{formatMoney(absolute(data.folioAmount), folioCurrency)}</dd>
      </dl>
      {refund ? (
        <p className="text-xs text-ink-muted">İade her zaman ikinci bir yetkilinin onayına gider; onaylanınca kasadan çıkar. Kendi isteğinizi onaylayamazsınız.</p>
      ) : data.requiresApproval ? (
        <Alert tone="warning" title="Bu ödeme onaya gidecek">
          Tutar büyük ödeme eşiğine ({formatMoney(data.threshold, folioCurrency)}) eşit ya da üstünde. İkinci bir yetkili onaylayana kadar
          bakiyeye ve kasaya girmez.
        </Alert>
      ) : null}
    </div>
  );
}

/**
 * Ödeme iptali (hatalı giriş): ikinci bir yetkilinin onayına gider; onaylanınca
 * iptal kaydı işlenir. Misafire para geri verilecekse bu değil iadedir.
 *
 * @param {{ payment: { id: string, kind: string, method: string, amount: string, currency: string, folioAmount: string }, folioCurrency: string, onClose: () => void, onDone: () => void }} props
 */
export function VoidPaymentDialog({ payment, folioCurrency, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/payments/${payment.id}/void`, body),
    onSuccess: () => {
      toastSuccess('İptal isteği onaya gönderildi; başka bir yetkili onaylayınca işlenir');
      onDone();
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });
  const busy = mutation.isPending;

  function submit(event) {
    event.preventDefault();
    const result = validateWith(paymentVoidSchema, { reason });
    if (!result.ok) {
      setError(result.errors.reason ?? 'Gerekçe geçersiz');
      return;
    }
    setError('');
    mutation.mutate(result.data);
  }

  const foreign = payment.currency !== folioCurrency;
  return (
    <Modal
      open
      size="sm"
      title="Ödeme iptali iste"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="void-payment-form" variant="danger" icon="rotateCcw" disabled={busy}>
            {busy ? 'Gönderiliyor…' : 'İptali onaya gönder'}
          </Button>
        </>
      }
    >
      <form id="void-payment-form" onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <p className="text-sm text-ink-soft">
          <span className="font-semibold text-ink">
            {kindLabel(payment.kind)} · {methodLabel(payment.method)} · {formatMoney(absolute(payment.amount), payment.currency)}
          </span>
          {foreign && ` (${formatMoney(absolute(payment.folioAmount), folioCurrency)})`}
        </p>
        <p className="text-xs text-ink-muted">
          Hatalı girişi düzeltir: onaylanınca ters tutarlı bir iptal kaydı işlenir, ödeme silinmez. Misafire para geri veriliyorsa iade kullanın.
        </p>
        <ChoiceChips label="Hazır gerekçeler" options={VOID_REASONS.map((value) => ({ value, label: value }))} value={reason} onChange={setReason} disabled={busy} />
        <Textarea label="Gerekçe" rows={2} value={reason} maxLength={PAYMENT_REASON_MAX} onChange={(event) => setReason(event.target.value)} error={error} disabled={busy} />
      </form>
    </Modal>
  );
}
