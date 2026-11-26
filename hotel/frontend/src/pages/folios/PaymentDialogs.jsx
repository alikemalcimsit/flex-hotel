import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  FOREIGN_CURRENCY_METHODS,
  LEDGER_PAYMENT_METHODS,
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
import { useT } from '../../i18n/index.jsx';
import { api, apiPost } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PAYMENT_METHOD_ICONS, absolute, cashKeys, formatRate, kindLabel, methodLabel } from '../../lib/payments.js';
import { newRequestId } from '../../lib/reservations.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { LedgerAccountField } from '../accounting/LedgerAccountField.jsx';

const QUOTE_DEBOUNCE_MS = 350;

/** Hazır gerekçeler; metin `folio.refundReason.<anahtar>` / `folio.paymentVoidReason.<anahtar>` sözlükte. */
const REFUND_REASONS = Object.freeze(['depositReturn', 'overpayment', 'earlyDeparture', 'serviceCancelled']);
const VOID_REASONS = Object.freeze(['wrongAmount', 'wrongFolio', 'duplicate', 'wrongMethod']);

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
  const t = useT();
  const refund = mode === 'refund';
  const [requestId] = useState(newRequestId);
  const methods = refund ? REFUND_METHODS : PAYMENT_METHODS;
  const [method, setMethod] = useState('CASH');
  const [currency, setCurrency] = useState(target.currency);
  const [amount, setAmount] = useState(() => suggestedAmount(mode, target) ?? '');
  const [reference, setReference] = useState('');
  // "Acente / cari" ve voucher: borcun yazılacağı cari (modül 47); boşsa rezervasyonun acentesinin carisi.
  const [ledgerAccount, setLedgerAccount] = useState(null);
  const ledgerMethod = LEDGER_PAYMENT_METHODS.includes(method);
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
      if (!result.created) toastSuccess(t('folio.payment.duplicate'));
      else if (result.payment.status === 'PENDING') {
        toastSuccess(t('folio.payment.sentForApproval', { kind: kindLabel(result.payment.kind) }));
      } else {
        toastSuccess(
          t('folio.payment.posted', { method: methodLabel(result.payment.method), amount: formatMoney(absolute(result.payment.folioAmount), target.currency) }),
        );
      }
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
      ledgerAccountId: ledgerMethod ? (ledgerAccount?.id ?? null) : null,
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
      setErrors({ currency: quote.data?.problem ?? t('folio.payment.rateWaiting') });
      return;
    }
    setErrors({});
    mutation.mutate(body);
  }

  const title = t(refund ? 'folio.payment.titleRefund' : target.advance ? 'folio.payment.titleAdvance' : 'folio.payment.title', { name: target.name });
  const referenceRequired = PAYMENT_REFERENCE_REQUIRED_METHODS.includes(method);

  return (
    <Modal
      open
      size="md"
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" form="payment-form" icon={refund ? 'rotateCcw' : 'wallet'} disabled={busy}>
            {busy
              ? t('common.saving')
              : refund
                ? t('folio.payment.submitRefund')
                : quote.data?.requiresApproval
                  ? t('folio.sendForApproval')
                  : t('folio.payment.submit')}
          </Button>
        </>
      }
    >
      <form id="payment-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {serverError && (
          <Alert tone={serverError.code === 'RATE_CHANGED' ? 'warning' : 'danger'} title={serverError.code === 'RATE_CHANGED' ? t('folio.payment.rateChanged') : t('common.notSaved')}>
            {serverError.message}
          </Alert>
        )}
        <BalanceLine mode={mode} target={target} />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink">{refund ? t('folio.payment.refundMethod') : t('folio.payment.method')}</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('folio.payment.methodGroup')}>
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
            label={refund ? t('folio.payment.refundAmount') : t('folio.payment.amount')}
            inputMode="decimal"
            placeholder={t('folio.payment.amountPlaceholder')}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            error={errors.amount}
            disabled={busy}
            autoFocus
          />
          <Select
            label={t('folio.payment.currency')}
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            options={currencies.map((value) => ({ value, label: value }))}
            error={errors.currency}
            disabled={busy || !foreignAllowed || currencies.length < 2}
          />
        </div>
        {!foreignAllowed && usableRates.length > 0 && <p className="-mt-2 text-xs text-ink-muted">{t('folio.payment.foreignMethodsOnly')}</p>}
        {foreignAllowed && rates.isSuccess && usableRates.length === 0 && (
          <p className="-mt-2 text-xs text-ink-muted">{t('folio.payment.noRates')}</p>
        )}

        <Input
          label={t(`folio.paymentReference.${method}`, PAYMENT_REFERENCE_LABELS[method])}
          value={reference}
          maxLength={PAYMENT_REFERENCE_MAX}
          placeholder={referenceRequired ? t('folio.payment.referencePlaceholder') : ''}
          onChange={(event) => setReference(event.target.value)}
          error={errors.reference}
          disabled={busy}
        />

        {ledgerMethod && (
          <LedgerAccountField
            value={ledgerAccount}
            onChange={setLedgerAccount}
            currency={target.currency}
            hint={t('folio.payment.ledgerHint')}
            error={errors.ledgerAccountId}
            disabled={busy}
          />
        )}

        {refund ? (
          <>
            <ChoiceChips
              label={t('folio.quickReasons')}
              options={REFUND_REASONS.map((key) => t(`folio.refundReason.${key}`)).map((value) => ({ value, label: value }))}
              value={reason}
              onChange={setReason}
              disabled={busy}
            />
            <Textarea label={t('folio.reason')} rows={2} value={reason} maxLength={PAYMENT_REASON_MAX} onChange={(event) => setReason(event.target.value)} error={errors.reason} disabled={busy} />
          </>
        ) : (
          <Input label={t('folio.payment.note')} value={note} maxLength={PAYMENT_NOTE_MAX} onChange={(event) => setNote(event.target.value)} error={errors.note} disabled={busy} />
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
  const t = useT();
  if (target.balance === undefined || target.balance === null) return null;
  const balance = Number(target.balance);
  return (
    <dl className="grid grid-cols-2 gap-y-1 rounded-item bg-surface-muted px-4 py-3 text-sm">
      <dt className="text-ink-muted">{balance < 0 ? t('folio.payment.guestCredit') : t('folio.payment.balanceDue')}</dt>
      <dd className="text-right font-bold tabular-nums">{formatMoney(absolute(target.balance), target.currency)}</dd>
      {mode === 'refund' && target.refundable !== undefined && target.refundable !== null && (
        <>
          <dt className="text-ink-muted">{t('folio.payment.maxRefund')}</dt>
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
  const t = useT();
  if (!enabled) {
    return <p className="rounded-item bg-surface-muted px-4 py-3 text-xs text-ink-muted">{t('folio.quote.hint')}</p>;
  }
  if (query.isPending) return <Spinner label={t('folio.quote.calculating')} className="py-2" />;
  if (query.isError) return <p className="text-xs text-sec-strong">{t('folio.preview.failed', { message: query.error.message })}</p>;
  const data = query.data;
  if (data.problem) return <Alert tone="warning" title={t('folio.quote.currencyUnavailable')}>{data.problem}</Alert>;
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-2 gap-y-1 rounded-item bg-surface-muted px-4 py-3 text-sm">
        {data.rate && (
          <>
            <dt className="text-ink-muted">{t('folio.quote.rate', { date: formatDate(data.rateDate) })}</dt>
            <dd className="text-right tabular-nums">1 {data.currency} = {formatRate(data.rate)} {folioCurrency}</dd>
          </>
        )}
        <dt className="font-bold text-ink">{refund ? t('folio.quote.refundTotal') : t('folio.quote.total')}</dt>
        <dd className="text-right font-bold tabular-nums">{formatMoney(absolute(data.folioAmount), folioCurrency)}</dd>
      </dl>
      {refund ? (
        <p className="text-xs text-ink-muted">{t('folio.quote.refundHint')}</p>
      ) : data.requiresApproval ? (
        <Alert tone="warning" title={t('folio.quote.approvalTitle')}>
          {t('folio.quote.approvalBody', { threshold: formatMoney(data.threshold, folioCurrency) })}
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
  const t = useT();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/payments/${payment.id}/void`, body),
    onSuccess: () => {
      toastSuccess(t('folio.void.sent'));
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
      setError(result.errors.reason ?? t('folio.reasonInvalid'));
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
      title={t('folio.paymentVoid.title')}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" form="void-payment-form" variant="danger" icon="rotateCcw" disabled={busy}>
            {busy ? t('folio.sending') : t('folio.paymentVoid.submit')}
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
          {t('folio.paymentVoid.hint')}
        </p>
        <ChoiceChips
          label={t('folio.quickReasons')}
          options={VOID_REASONS.map((key) => t(`folio.paymentVoidReason.${key}`)).map((value) => ({ value, label: value }))}
          value={reason}
          onChange={setReason}
          disabled={busy}
        />
        <Textarea label={t('folio.reason')} rows={2} value={reason} maxLength={PAYMENT_REASON_MAX} onChange={(event) => setReason(event.target.value)} error={error} disabled={busy} />
      </form>
    </Modal>
  );
}
