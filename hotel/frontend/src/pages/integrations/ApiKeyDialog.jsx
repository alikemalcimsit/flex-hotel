import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { API_KEY_EXPIRY_DAYS, API_SCOPES, API_SCOPE_HINTS, API_SCOPE_LABELS, MAX_API_KEY_NAME_LENGTH, apiKeyCreateSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Input, Select } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPost } from '../../lib/api.js';
import { toggleScope } from '../../lib/apiScopes.js';
import { integrationKeys } from '../../lib/integrations.js';
import { validateWith } from '../../lib/validate.js';
import { toastError } from '../../store/toast.js';
import { SecretReveal } from './SecretReveal.jsx';

const EXPIRY_OPTIONS = [{ value: '', label: 'Süresiz (iptal edilene kadar)' }, ...API_KEY_EXPIRY_DAYS.map((days) => ({ value: String(days), label: `${days} gün` }))];

/**
 * Yeni API anahtarı: ad, kapsamlar, süre. Oluşunca anahtar bir kez gösterilir.
 * @param {{ client: any, onClose: () => void }} props
 */
export function ApiKeyDialog({ client, onClose }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ name: '', scopes: ['availability:read', 'reservations:read'], expiresInDays: '' });
  const [errors, setErrors] = useState({});
  const [token, setToken] = useState(null);

  const create = useMutation({
    mutationFn: (payload) => apiPost(`/integrations/clients/${client.id}/keys`, payload),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: integrationKeys.all });
      setToken(result.token);
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      toastError(error.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const payload = { name: values.name, scopes: values.scopes, expiresInDays: values.expiresInDays ? Number(values.expiresInDays) : null };
    const checked = validateWith(apiKeyCreateSchema, payload);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    create.mutate(payload);
  }

  if (token) {
    return (
      <SecretReveal
        title="API anahtarı oluştu"
        label="Anahtar"
        value={token}
        hint="Anahtarı şimdi kopyalayıp dış sistemin yöneticisine güvenli yoldan iletin (e-posta gövdesine yazmayın). Kapatınca bir daha gösterilmez; kaybolursa iptal edip yenisini oluşturun."
        onClose={onClose}
      />
    );
  }

  const busy = create.isPending;
  return (
    <Modal
      open
      title={`Yeni anahtar — ${client.name}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="api-key-form" icon="key" disabled={busy}>
            {busy ? 'Oluşturuluyor…' : 'Anahtarı oluştur'}
          </Button>
        </>
      }
    >
      <form id="api-key-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input
          label="Ad"
          name="key-name"
          value={values.name}
          onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
          error={errors.name}
          maxLength={MAX_API_KEY_NAME_LENGTH}
          placeholder="ör. Üretim sunucusu"
          disabled={busy}
          required
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Kapsamlar</legend>
          {API_SCOPES.map((scope) => (
            <Checkbox
              key={scope}
              name={`scope-${scope}`}
              label={API_SCOPE_LABELS[scope]}
              hint={API_SCOPE_HINTS[scope]}
              checked={values.scopes.includes(scope)}
              onChange={(event) => setValues((current) => ({ ...current, scopes: toggleScope(current.scopes, scope, event.target.checked) }))}
              disabled={busy}
            />
          ))}
          {errors.scopes && <p className="text-xs font-semibold text-sec-strong">{errors.scopes}</p>}
        </fieldset>
        <Select
          label="Geçerlilik"
          name="key-expiry"
          value={values.expiresInDays}
          onChange={(event) => setValues((current) => ({ ...current, expiresInDays: event.target.value }))}
          options={EXPIRY_OPTIONS}
          error={errors.expiresInDays}
          disabled={busy}
        />
        {values.scopes.includes('guests:read') && (
          <Alert tone="info" title="Kişisel veri">
            Misafirlerin adı, e-postası ve telefonu bu anahtarla okunabilir (kimlik belgesi okunamaz). Dış sistemle KVKK kapsamında veri işleme sözleşmesi olduğundan emin olun.
          </Alert>
        )}
      </form>
    </Modal>
  );
}
