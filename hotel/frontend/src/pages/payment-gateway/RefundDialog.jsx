import { useState } from 'react';
import { gatewayRefundSchema } from '@hotelos/hotel-contracts';
import { Alert, Input, Textarea } from '@hotelos/ui';
import { apiPost } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { newRequestId } from '../../lib/reservations.js';
import { toastSuccess } from '../../store/toast.js';
import { GatewayFormDialog, useGatewaySubmit } from './GatewayFormDialog.jsx';

/**
 * Karta iade isteği (modül 50, `payment.refund`): tutar en çok iade edilebilir kadar, gerekçe zorunlu. İstek onaya gider;
 * onaylanınca sağlayıcıdan iade edilir ve folyoya eksi sanal POS ödemesi yazılır. İstek kimliği pencere açılırken üretilir.
 * @param {{ link: { id: string, currency: string }, refundable: string, onClose: () => void }} props
 */
export function RefundDialog({ link, refundable, onClose }) {
  const [requestId] = useState(newRequestId);
  const [values, setValues] = useState({ amount: refundable, reason: '' });
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const tooMuch = Number(String(values.amount).replace(',', '.')) > Number(refundable);
  const { submit, errors, serverError, busy } = useGatewaySubmit({
    schema: gatewayRefundSchema,
    request: (body) => apiPost(`/payment-gateway/links/${link.id}/refund`, body),
    onSuccess: () => {
      toastSuccess('İade isteği onaya gönderildi');
      onClose();
    },
  });

  return (
    <GatewayFormDialog title="Karta iade" formId="pg-refund-form" busy={busy} onClose={onClose} submitLabel="Onaya gönder" submitIcon="rotateCcw" serverError={serverError} submitDisabled={tooMuch}>
      <form
        id="pg-refund-form"
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit({ requestId, amount: values.amount, reason: values.reason });
        }}
      >
        <Alert tone="info">İstek onaya gider; onaylanınca tutar misafirin kartına iade edilir ve folyoya eksi ödeme olarak yazılır.</Alert>
        <Input
          label="İade tutarı"
          name="pg-refund-amount"
          inputMode="decimal"
          value={values.amount}
          onChange={set('amount')}
          error={errors.amount ?? (tooMuch ? `En çok ${formatMoney(refundable, link.currency)}` : undefined)}
          disabled={busy}
        />
        <p className="text-xs text-ink-muted">En çok {formatMoney(refundable, link.currency)} (ödenen − iade edilen − onay bekleyen).</p>
        <Textarea label="Gerekçe" name="pg-refund-reason" rows={2} placeholder="Erken çıkış, çift tahsilat…" value={values.reason} onChange={set('reason')} error={errors.reason} disabled={busy} />
      </form>
    </GatewayFormDialog>
  );
}
