import { useState } from 'react';
import { MAX_PAYMENT_LINK_TTL_HOURS, PAYMENT_LINK_PURPOSES, PAYMENT_LINK_PURPOSE_LABELS, paymentLinkCreateSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Select } from '@hotelos/ui';
import { apiPost } from '../../lib/api.js';
import { formatDateTime, formatMoney } from '../../lib/format.js';
import { newRequestId } from '../../lib/reservations.js';
import { toastSuccess } from '../../store/toast.js';
import { GatewayFormDialog, useGatewaySubmit } from './GatewayFormDialog.jsx';
import { PayUrl } from './PayUrl.jsx';
import { useLinkActions } from './useLinkActions.js';

const PURPOSE_OPTIONS = PAYMENT_LINK_PURPOSES.map((value) => ({ value, label: PAYMENT_LINK_PURPOSE_LABELS[value] }));

/**
 * "Ödeme linki oluştur" (modül 50, `payment_gateway.send`): tutar önerilenle (açık bakiye / konaklama tutarı) dolu, amaç,
 * açıklama, süre. İstek kimliği pencere açılırken üretilir: çift tıklama ikinci link açmaz. Oluşunca aynı pencerede
 * bağlantı, "Kopyala" ve "Misafire gönder".
 * @param {{
 *   reservationId: string, currency: string, suggested: { amount: string | null, purpose: string },
 *   program: { linkTtlHours: number }, contact: { hasEmail: boolean, hasPhone: boolean }, onClose: () => void,
 * }} props
 */
export function CreateLinkDialog({ reservationId, currency, suggested, program, contact, onClose }) {
  const [requestId] = useState(newRequestId);
  const [created, setCreated] = useState(null);
  const [values, setValues] = useState({ amount: suggested.amount ?? '', purpose: suggested.purpose, description: '', ttlHours: String(program.linkTtlHours) });
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const { submit, errors, serverError, busy } = useGatewaySubmit({
    schema: paymentLinkCreateSchema,
    request: (body) => apiPost(`/payment-gateway/reservations/${reservationId}/links`, body),
    onSuccess: (result) => {
      toastSuccess('Ödeme linki oluşturuldu');
      setCreated(result.link);
    },
  });

  if (created) return <CreatedView link={created} contact={contact} onClose={onClose} />;
  return (
    <GatewayFormDialog title="Ödeme linki oluştur" formId="pg-create-form" busy={busy} onClose={onClose} submitLabel="Oluştur" submitIcon="link" serverError={serverError}>
      <form
        id="pg-create-form"
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit({ requestId, amount: values.amount, purpose: values.purpose, description: values.description.trim() || null, ttlHours: Number(values.ttlHours) || null });
        }}
      >
        <Input label={`Tutar (${currency})`} name="pg-create-amount" inputMode="decimal" value={values.amount} onChange={set('amount')} error={errors.amount} disabled={busy} />
        <Select label="Amaç" name="pg-create-purpose" options={PURPOSE_OPTIONS} value={values.purpose} onChange={set('purpose')} error={errors.purpose} disabled={busy} />
        <Input label="Açıklama" name="pg-create-description" placeholder="Boşsa rezervasyon kodu ve amaç yazılır" value={values.description} onChange={set('description')} error={errors.description} maxLength={200} disabled={busy} className="sm:col-span-2" />
        <Input label={`Geçerlilik (saat, en çok ${MAX_PAYMENT_LINK_TTL_HOURS})`} name="pg-create-ttl" inputMode="numeric" value={values.ttlHours} onChange={set('ttlHours')} error={errors.ttlHours} disabled={busy} />
        <p className="self-end text-xs text-ink-muted">
          {suggested.amount ? `Önerilen ${formatMoney(suggested.amount, currency)} (${suggested.purpose === 'BALANCE' ? 'açık bakiye' : 'konaklama tutarı'}).` : 'Açık bakiye yok; tutarı yazın.'}
        </p>
      </form>
    </GatewayFormDialog>
  );
}

/** Oluşan link: adres, kopyala, misafire gönder. @param {{ link: any, contact: { hasEmail: boolean, hasPhone: boolean }, onClose: () => void }} props */
function CreatedView({ link, contact, onClose }) {
  const { send } = useLinkActions();
  const [sent, setSent] = useState(false);
  const hasContact = contact.hasEmail || contact.hasPhone;
  return (
    <GatewayFormDialog title="Ödeme linki hazır" onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-ink-soft">
          <span className="font-bold tabular-nums text-ink">{formatMoney(link.amount, link.currency)}</span> · {formatDateTime(link.expiresAt)} tarihine kadar geçerli
        </p>
        <PayUrl url={link.url} />
        {!hasContact && <Alert tone="warning">Misafir kartında e-posta / telefon yok: bağlantıyı kopyalayıp elle iletin.</Alert>}
        {hasContact && (
          <div>
            <Button type="button" icon="send" onClick={() => send.mutate(link.id, { onSuccess: () => setSent(true) })} disabled={send.isPending || sent}>
              {send.isPending ? 'Gönderiliyor…' : sent ? 'Gönderildi' : 'Misafire gönder'}
            </Button>
          </div>
        )}
      </div>
    </GatewayFormDialog>
  );
}
