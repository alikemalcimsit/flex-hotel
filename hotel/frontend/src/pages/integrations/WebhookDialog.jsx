import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MAX_WEBHOOK_URL_LENGTH, WEBHOOK_EVENT_GROUPS, WEBHOOK_EVENT_LABELS, webhookCreateSchema, webhookUpdateSchema } from '@hotelos/hotel-contracts';
import { Button, Input } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { MultiChips } from '../../components/MultiChips.jsx';
import { apiPatch, apiPost } from '../../lib/api.js';
import { integrationKeys } from '../../lib/integrations.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { SecretReveal } from './SecretReveal.jsx';

/**
 * Webhook aboneliği aç / düzenle: HTTPS adres ve olaylar (gruplu). Açılınca imza sırrı bir kez gösterilir.
 * @param {{ client: any, subscription?: any, onClose: () => void }} props
 */
export function WebhookDialog({ client, subscription, onClose }) {
  const queryClient = useQueryClient();
  const editing = Boolean(subscription);
  const [values, setValues] = useState({ url: subscription?.url ?? 'https://', events: subscription?.events ?? ['reservation.created', 'reservation.updated', 'reservation.cancelled'] });
  const [errors, setErrors] = useState({});
  const [secret, setSecret] = useState(null);

  const save = useMutation({
    mutationFn: (payload) =>
      editing ? apiPatch(`/integrations/clients/${client.id}/webhooks/${subscription.id}`, payload) : apiPost(`/integrations/clients/${client.id}/webhooks`, payload),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: integrationKeys.client(client.id) });
      if (editing) {
        toastSuccess('Abonelik kaydedildi');
        onClose();
      } else setSecret(result.secret);
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      else if (error.code === 'DUPLICATE_URL') setErrors({ url: error.message });
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: integrationKeys.client(client.id) });
      toastError(error.code === 'STALE_WRITE' ? 'Abonelik bu arada değişti; ekran yenilendi, tekrar deneyin.' : error.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const payload = { url: values.url.trim(), events: values.events, ...(editing ? { expectedUpdatedAt: subscription.updatedAt } : {}) };
    const checked = validateWith(editing ? webhookUpdateSchema : webhookCreateSchema, payload);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    save.mutate(payload);
  }

  if (secret) {
    return (
      <SecretReveal
        title="Abonelik açıldı"
        label="İmza sırrı"
        value={secret}
        hint="Alıcı sunucu her teslimatın X-FlexHotel-Signature başlığını bu sırla doğrulamalı (API dokümanında örnek kod var). Kapatınca bir daha gösterilmez; kaybolursa abonelikten sırrı yenileyin."
        onClose={onClose}
      />
    );
  }

  const busy = save.isPending;
  return (
    <Modal
      open
      size="lg"
      title={editing ? 'Aboneliği düzenle' : `Yeni webhook — ${client.name}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="webhook-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : editing ? 'Kaydet' : 'Aboneliği aç'}
          </Button>
        </>
      }
    >
      <form id="webhook-form" onSubmit={submit} noValidate className="flex flex-col gap-5">
        <Input
          label="Adres (HTTPS)"
          name="webhook-url"
          type="url"
          value={values.url}
          onChange={(event) => setValues((current) => ({ ...current, url: event.target.value }))}
          error={errors.url}
          maxLength={MAX_WEBHOOK_URL_LENGTH}
          placeholder="https://api.firma.com/flexhotel/webhook"
          disabled={busy}
          required
        />
        <p className="-mt-3 text-xs text-ink-muted">Yalnız HTTPS; iç ağ adresleri (localhost, 10.x, 192.168.x) kabul edilmez. Yönlendirme takip edilmez.</p>
        {WEBHOOK_EVENT_GROUPS.map((group) => (
          <MultiChips
            key={group.key}
            label={group.label}
            options={group.events.map((type) => ({ value: type, label: WEBHOOK_EVENT_LABELS[type] }))}
            values={values.events.filter((type) => group.events.includes(type))}
            onChange={(selected) => setValues((current) => ({ ...current, events: [...current.events.filter((type) => !group.events.includes(type)), ...selected] }))}
            disabled={busy}
          />
        ))}
        {errors.events && <p className="text-xs font-semibold text-sec-strong">{errors.events}</p>}
        <p className="text-xs text-ink-muted">Gövde incedir: kimlikler, durum, tarih ve tutar gider; misafirin adı, iletişimi ve kimliği gitmez. Ayrıntı API'den çekilir.</p>
      </form>
    </Modal>
  );
}
