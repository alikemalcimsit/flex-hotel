import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  PAYMENT_REFERENCE_LABELS,
  POS_ADJUSTMENT_KIND_LABELS,
  POS_PAYMENT_METHODS,
  equalShares,
  posAdjustmentSchema,
  posPaymentSchema,
  posRoomChargeSchema,
  reopenPosCheckSchema,
  updatePosCheckSchema,
  voidPosPaymentSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, EmptyState, Input, Spinner, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { methodLabel } from '../../lib/payments.js';
import { posKeys, useDebounced } from '../../lib/pos.js';
import { cashSuggestions, changeDue } from '../../lib/posCart.js';
import { validateWith } from '../../lib/validate.js';
import { toastError } from '../../store/toast.js';

/**
 * Adisyon ekranının diyalogları (modül 39): ödeme (nakit / kart, para üstü), odaya yaz,
 * hatalı ödemenin iptali, ikram / iptal / indirim, yeniden açma ve kişi / not düzeltme.
 * Hepsi sunucunun şemasıyla önceden doğrulanır; sunucu hatası alanın altına ve bildirime düşer.
 */

const METHOD_OPTIONS = POS_PAYMENT_METHODS.map((value) => ({ value, label: methodLabel(value) }));
const ADJUSTMENT_REASONS = Object.freeze({
  COMP: ['Geç servis', 'Misafir memnuniyeti', 'Doğum günü', 'Yönetici ikramı'],
  VOID: ['Yanlış girildi', 'Misafir vazgeçti', 'Yanlış masa', 'Hazırlanamadı'],
  DISCOUNT: ['Sadakat kartı', 'Personel indirimi', 'Yönetici jesti', 'Grup indirimi'],
});

/** Sunucu hatasının alanlarını forma işler. @param {(errors: any) => void} setErrors */
export const onFailure = (setErrors) => (error) => {
  if (error.fields) setErrors(error.fields);
  toastError(error.message);
};

/** @param {{ id: string, title: string, busy: boolean, onClose: () => void, submitLabel: string, icon?: string, variant?: 'primary' | 'danger', children: React.ReactNode, onSubmit: (event: any) => void, size?: 'sm' | 'md' }} props */
export function FormDialog({ id, title, busy, onClose, submitLabel, icon = 'check', variant = 'primary', children, onSubmit, size = 'sm' }) {
  return (
    <Modal
      open
      size={size}
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={id} icon={icon} variant={variant} disabled={busy}>
            {busy ? 'İşleniyor…' : submitLabel}
          </Button>
        </>
      }
    >
      <form id={id} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {children}
      </form>
    </Modal>
  );
}

/* ══════════════════ Ödeme ══════════════════ */

/**
 * Nakit / kart ödeme: varsayılan tutar kalan; kişi başı paylar; nakitte verilen para ve
 * para üstü (kasaya alınan tutar yazılır). İstek kimliği diyalogla bir kez üretilir.
 * @param {{ check: any, onClose: () => void, onDone: (result: any, change: string | null) => void }} props
 */
export function PaymentDialog({ check, onClose, onDone }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [values, setValues] = useState({ method: 'CASH', amount: check.balance, reference: '', tendered: '' });
  const [errors, setErrors] = useState({});
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const pay = useMutation({ mutationFn: (body) => apiPost(`/pos/checks/${check.id}/payments`, body), onError: onFailure(setErrors) });
  const shares = check.covers > 1 ? equalShares(check.balance, check.covers) : [];
  const cash = values.method === 'CASH';
  const amountText = values.amount.replace(',', '.');
  const change = cash && values.tendered ? changeDue(values.tendered, amountText) : null;

  function submit(event) {
    event.preventDefault();
    const body = { requestId, method: values.method, amount: values.amount, reference: cash ? null : values.reference };
    const checked = validateWith(posPaymentSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    if (Number(checked.data.amount) > Number(check.balance)) return setErrors({ amount: `En fazla ${formatMoney(check.balance, check.currency)} (kalan)` });
    if (cash && values.tendered && change === null) return setErrors({ tendered: 'Verilen para tutarı karşılamıyor' });
    setErrors({});
    pay.mutate(checked.data, { onSuccess: (result) => onDone(result, change) });
  }

  const busy = pay.isPending;
  return (
    <FormDialog id="pos-payment" title={`Ödeme · kalan ${formatMoney(check.balance, check.currency)}`} busy={busy} onClose={onClose} submitLabel="Ödemeyi al" icon="banknote" onSubmit={submit}>
      <ChoiceChips label="Yöntem" required options={METHOD_OPTIONS} value={values.method} onChange={(method) => setValues((current) => ({ ...current, method }))} disabled={busy} />
      <Input label={`Alınacak tutar (${check.currency})`} name="pos-pay-amount" inputMode="decimal" value={values.amount} onChange={set('amount')} error={errors.amount} required disabled={busy} />
      {shares.length > 0 && (
        <ChoiceChips
          label="Kişi başı"
          options={[...new Set(shares)].map((share) => ({ value: share, label: `Kişi başı ${formatMoney(share)}` }))}
          value={shares.includes(amountText) ? amountText : ''}
          onChange={(share) => setValues((current) => ({ ...current, amount: share || check.balance }))}
          disabled={busy}
        />
      )}
      {cash ? (
        <>
          <Input label="Verilen nakit (para üstü için, isteğe bağlı)" name="pos-pay-tendered" inputMode="decimal" value={values.tendered} onChange={set('tendered')} error={errors.tendered} disabled={busy} />
          <ChoiceChips
            label="Hızlı nakit"
            options={cashSuggestions(Number(amountText) > 0 ? amountText : '0').map((value) => ({ value, label: formatMoney(value) }))}
            value={values.tendered}
            onChange={(tendered) => setValues((current) => ({ ...current, tendered }))}
            disabled={busy}
          />
          {change !== null && (
            <p className="rounded-item bg-success-soft px-3 py-2 text-sm font-semibold text-success-ink">
              Para üstü: <span className="text-lg tabular-nums">{formatMoney(change, check.currency)}</span>
            </p>
          )}
        </>
      ) : (
        <Input label={PAYMENT_REFERENCE_LABELS.CARD} name="pos-pay-reference" value={values.reference} onChange={set('reference')} error={errors.reference} required disabled={busy} placeholder="Slip / provizyon no — kart numarası yazılmaz" />
      )}
    </FormDialog>
  );
}

/* ══════════════════ Odaya yaz ══════════════════ */

/**
 * Odaya yaz: oda numarası ya da soyadıyla içerideki misafir seçilir; tutar varsayılan
 * kalan. Folyo vergi kuruşu yüzünden tutar birebir yazılamıyorsa sunucunun önerdiği en
 * yakın tutarlar tek dokunuşla seçilir.
 * @param {{ check: any, onClose: () => void, onDone: (check: any) => void }} props
 */
export function RoomChargeDialog({ check, onClose, onDone }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [stay, setStay] = useState(null);
  const [amount, setAmount] = useState(check.balance);
  const [errors, setErrors] = useState({});
  const [nearest, setNearest] = useState([]);
  const stays = useQuery({
    queryKey: posKeys.inHouse(search),
    queryFn: () => api(withQuery('/pos/in-house', { search })),
    enabled: search.length > 0,
  });
  const charge = useMutation({
    mutationFn: (body) => apiPost(`/pos/checks/${check.id}/room-charge`, body),
    onSuccess: onDone,
    onError: (error) => {
      setNearest(error.details?.nearest ?? []);
      onFailure(setErrors)(error);
    },
  });

  function submit(event) {
    event.preventDefault();
    const body = { requestId, reservationId: stay?.id ?? '', amount };
    const checked = validateWith(posRoomChargeSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    if (Number(checked.data.amount) > Number(check.balance)) return setErrors({ amount: `En fazla ${formatMoney(check.balance, check.currency)} (kalan)` });
    setErrors({});
    setNearest([]);
    charge.mutate(checked.data);
  }

  const busy = charge.isPending;
  return (
    <FormDialog id="pos-room-charge" title="Odaya yaz" busy={busy} onClose={onClose} submitLabel="Folyoya yaz" icon="bed" onSubmit={submit} size="md">
      <Input label="Oda numarası ya da soyadı" name="pos-room-search" value={searchText} onChange={(event) => setSearchText(event.target.value)} disabled={busy} placeholder="ör. 412 ya da Yılmaz" />
      {search.length > 0 && (
        <div role="radiogroup" aria-label="İçerideki konaklamalar" className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
          {stays.isPending && <Spinner className="py-3" />}
          {stays.isError && <Alert tone="danger" title="Arama yapılamadı">{stays.error.message}</Alert>}
          {stays.isSuccess && stays.data.stays.length === 0 && <EmptyState icon="bed" title="İçeride bu oda / misafir yok" description="Giriş yapmamış ya da çıkmış misafire yazılmaz." />}
          {stays.data?.stays.map((row) => (
            <button
              key={row.id}
              type="button"
              role="radio"
              aria-checked={stay?.id === row.id}
              onClick={() => setStay(row)}
              className={`flex items-center justify-between gap-3 rounded-item border px-3 py-2 text-left text-sm ${stay?.id === row.id ? 'border-ink bg-surface-muted' : 'border-line hover:border-ink'}`}
            >
              <span>
                <strong>Oda {row.roomNumber}</strong> · {row.guestName}
              </span>
              <span className="text-xs text-ink-muted">
                {row.confirmationCode} · çıkış {row.checkOut}
              </span>
            </button>
          ))}
        </div>
      )}
      {errors.reservationId && <p className="text-xs font-semibold text-sec-strong">{errors.reservationId}</p>}
      <Input label={`Tutar (${check.currency})`} name="pos-room-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} error={errors.amount} required disabled={busy} />
      {nearest.length > 0 && (
        <ChoiceChips label="Yazılabilen en yakın tutar" options={nearest.map((value) => ({ value, label: `${formatMoney(value)} yaz` }))} value="" onChange={(value) => value && setAmount(value)} disabled={busy} />
      )}
      {!check.outlet.allowRoomCharge && <Alert tone="warning" title="Bu satış noktası odaya yazmaya kapalı">Ödemeyi nakit ya da kartla alın.</Alert>}
    </FormDialog>
  );
}

/* ══════════════════ Hatalı ödeme ══════════════════ */

/** @param {{ check: any, payment: any, onClose: () => void, onDone: (check: any) => void }} props */
export function PaymentVoidDialog({ check, payment, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const request = useMutation({ mutationFn: (body) => apiPost(`/pos/checks/${check.id}/payments/${payment.id}/void`, body), onSuccess: onDone, onError: onFailure(setErrors) });

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(voidPosPaymentSchema, { reason });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    request.mutate(checked.data);
  }

  return (
    <FormDialog id="pos-payment-void" title="Hatalı ödemeyi iptal et" busy={request.isPending} onClose={onClose} submitLabel="Onaya gönder" icon="close" variant="danger" onSubmit={submit}>
      <p className="text-sm text-ink-soft">
        <strong>
          {methodLabel(payment.method)} {formatMoney(payment.amount, check.currency)}
        </strong>{' '}
        başka bir yetkili onaylayınca ters kayıtla düşülür (parayı alanın vardiya kasasından). Vardiyası kapanmış ödeme iptal edilemez.
      </p>
      <Textarea label="Gerekçe" name="pos-void-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} error={errors.reason} required disabled={request.isPending} />
    </FormDialog>
  );
}

/* ══════════════════ Düzeltme ══════════════════ */

/**
 * İkram / iptal (kalemin bir kısmı) ya da adisyona indirim. Değer politikadaki eşiğe eşit ya
 * da üstündeyse dört göz onaya gider; ekran bunu önceden söyler.
 * @param {{ check: any, kind: 'COMP' | 'VOID' | 'DISCOUNT', line?: any, threshold: string, onClose: () => void, onDone: (check: any) => void }} props
 */
export function AdjustmentDialog({ check, kind, line = null, threshold, onClose, onDone }) {
  const [values, setValues] = useState({ quantity: line ? String(Math.min(1, line.freeQuantity)) : '', waste: false, discountMode: 'PCT', discount: '', reason: '' });
  const [errors, setErrors] = useState({});
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const request = useMutation({ mutationFn: (body) => apiPost(`/pos/checks/${check.id}/adjustments`, body), onSuccess: onDone, onError: onFailure(setErrors) });

  const discount = Number(values.discount.replace(',', '.')) || 0;
  const value =
    kind === 'DISCOUNT'
      ? values.discountMode === 'PCT'
        ? (Number(check.totals.subtotal) * discount) / 100
        : Math.min(discount, Number(check.totals.subtotal))
      : Number(line?.unitPrice ?? 0) * (Number(values.quantity) || 0);
  const needsApproval = Number(threshold) > 0 && value >= Number(threshold);

  function submit(event) {
    event.preventDefault();
    const body =
      kind === 'DISCOUNT'
        ? { kind, reason: values.reason, ...(values.discountMode === 'PCT' ? { discountPct: values.discount } : { discountAmount: values.discount }) }
        : { kind, lineId: line.id, quantity: values.quantity, waste: kind === 'VOID' ? values.waste : false, reason: values.reason };
    const checked = validateWith(posAdjustmentSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    if (line && checked.data.quantity > line.freeQuantity) return setErrors({ quantity: `En fazla ${line.freeQuantity} adet` });
    setErrors({});
    request.mutate(checked.data);
  }

  const busy = request.isPending;
  const title = line ? `${POS_ADJUSTMENT_KIND_LABELS[kind]}: ${line.name}` : 'Adisyona indirim';
  return (
    <FormDialog id="pos-adjustment" title={title} busy={busy} onClose={onClose} submitLabel={needsApproval ? 'Onaya gönder' : 'Uygula'} icon={kind === 'VOID' ? 'close' : 'check'} variant={kind === 'VOID' ? 'danger' : 'primary'} onSubmit={submit}>
      {line ? (
        <>
          <Input label={`Adet (en fazla ${line.freeQuantity})`} name="pos-adj-quantity" type="number" min={1} max={line.freeQuantity} value={values.quantity} onChange={set('quantity')} error={errors.quantity} required disabled={busy} />
          {kind === 'VOID' && (
            <Checkbox
              label="Hazırlandı (zayi)"
              hint="Mutfakta hazırlanıp atılan kalem zayi raporuna girer."
              checked={values.waste}
              onChange={(event) => setValues((current) => ({ ...current, waste: event.target.checked }))}
              disabled={busy}
            />
          )}
        </>
      ) : (
        <>
          <ChoiceChips
            label="İndirim türü"
            required
            options={[
              { value: 'PCT', label: 'Yüzde' },
              { value: 'AMOUNT', label: `Tutar (${check.currency})` },
            ]}
            value={values.discountMode}
            onChange={(discountMode) => setValues((current) => ({ ...current, discountMode }))}
            disabled={busy}
          />
          <Input
            label={values.discountMode === 'PCT' ? 'İndirim (%)' : `İndirim (${check.currency})`}
            name="pos-adj-discount"
            inputMode="decimal"
            value={values.discount}
            onChange={set('discount')}
            error={errors.discountPct ?? errors.discountAmount}
            required
            disabled={busy}
          />
          {check.totals.discountTotal !== '0.00' && <p className="text-xs text-ink-muted">Var olan indirim ({formatMoney(check.totals.discountTotal, check.currency)}) bunun yerine geçer.</p>}
        </>
      )}
      <ChoiceChips label="Hazır gerekçe" options={ADJUSTMENT_REASONS[kind].map((reason) => ({ value: reason, label: reason }))} value={values.reason} onChange={(reason) => setValues((current) => ({ ...current, reason }))} disabled={busy} />
      <Textarea label="Gerekçe" name="pos-adj-reason" rows={2} value={values.reason} onChange={set('reason')} error={errors.reason} required disabled={busy} />
      <p className={`rounded-item px-3 py-2 text-sm ${needsApproval ? 'bg-warning-soft font-semibold text-warning-ink' : 'bg-surface-muted text-ink-soft'}`}>
        Değer {formatMoney(value.toFixed(2), check.currency)}
        {needsApproval
          ? ` — eşik ${formatMoney(threshold, check.currency)} ve üstü: başka bir yetkili onaylayınca uygulanır; o zamana kadar ödeme alınmaz.`
          : ' — hemen uygulanır.'}
      </p>
    </FormDialog>
  );
}

/* ══════════════════ Yeniden açma, düzeltme ══════════════════ */

/** @param {{ check: any, onClose: () => void, onDone: (check: any) => void }} props */
export function ReopenDialog({ check, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const reopen = useMutation({ mutationFn: (body) => apiPost(`/pos/checks/${check.id}/reopen`, body), onSuccess: onDone, onError: onFailure(setErrors) });

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(reopenPosCheckSchema, { reason });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    reopen.mutate(checked.data);
  }

  return (
    <FormDialog id="pos-reopen" title="Adisyonu yeniden aç" busy={reopen.isPending} onClose={onClose} submitLabel="Yeniden aç" icon="rotateCcw" onSubmit={submit}>
      <p className="text-sm text-ink-soft">
        Yalnızca bugünün, vardiyası açık ve odaya yazılmamış adisyonu açılır. Hatalı ödeme açık adisyonda iptal edilir; kalem eklenebilir.
      </p>
      <Textarea label="Gerekçe" name="pos-reopen-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} error={errors.reason} required disabled={reopen.isPending} />
    </FormDialog>
  );
}

/** Kişi sayısı ve not (sürüm damgasıyla). @param {{ check: any, onClose: () => void, onDone: (check: any) => void }} props */
export function EditCheckDialog({ check, onClose, onDone }) {
  const [values, setValues] = useState({ covers: String(check.covers), note: check.note ?? '' });
  const [errors, setErrors] = useState({});
  const save = useMutation({ mutationFn: (body) => apiPut(`/pos/checks/${check.id}`, body), onSuccess: onDone, onError: onFailure(setErrors) });

  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: check.updatedAt, covers: values.covers, note: values.note };
    const checked = validateWith(updatePosCheckSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(body);
  }

  return (
    <FormDialog id="pos-edit-check" title="Kişi ve not" busy={save.isPending} onClose={onClose} submitLabel="Kaydet" onSubmit={submit}>
      <Input label="Kişi" name="pos-edit-covers" type="number" min={1} value={values.covers} onChange={(event) => setValues((current) => ({ ...current, covers: event.target.value }))} error={errors.covers} required disabled={save.isPending} />
      <Input label="Not" name="pos-edit-note" value={values.note} onChange={(event) => setValues((current) => ({ ...current, note: event.target.value }))} error={errors.note} disabled={save.isPending} />
    </FormDialog>
  );
}
