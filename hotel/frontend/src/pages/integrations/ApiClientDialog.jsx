import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  API_BOOKING_STATUSES,
  API_BOOKING_STATUS_LABELS,
  API_RATE_LIMIT_DEFAULT,
  API_RATE_LIMIT_MAX,
  API_RATE_LIMIT_MIN,
  MAX_API_CLIENT_DESCRIPTION_LENGTH,
  MAX_API_CLIENT_NAME_LENGTH,
  apiClientCreateSchema,
  apiClientUpdateSchema,
} from '@hotelos/hotel-contracts';
import { Button, Input, Select, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPatch, apiPost } from '../../lib/api.js';
import { integrationKeys } from '../../lib/integrations.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const BOOKING_OPTIONS = API_BOOKING_STATUSES.map((value) => ({ value, label: API_BOOKING_STATUS_LABELS[value] }));

/**
 * Uygulama aç / düzenle. Ad otelde tekil; hız sınırı uygulamanın bütün anahtarlarının toplamıdır; API'den açılan
 * rezervasyon opsiyonlu (resepsiyon kesinleştirir) ya da kesin açılır.
 *
 * @param {{ client?: any, onClose: () => void }} props
 */
export function ApiClientDialog({ client, onClose }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const editing = Boolean(client);
  const [values, setValues] = useState({
    name: client?.name ?? '',
    description: client?.description ?? '',
    contactEmail: client?.contactEmail ?? '',
    rateLimitPerMinute: String(client?.rateLimitPerMinute ?? API_RATE_LIMIT_DEFAULT),
    bookingStatus: client?.bookingStatus ?? 'PENDING',
  });
  const [errors, setErrors] = useState({});
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));

  const save = useMutation({
    mutationFn: (payload) => (editing ? apiPatch(`/integrations/clients/${client.id}`, payload) : apiPost('/integrations/clients', payload)),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: integrationKeys.all });
      if (editing) {
        queryClient.setQueryData(integrationKeys.client(saved.id), saved);
        toastSuccess('Uygulama kaydedildi');
        onClose();
      } else {
        toastSuccess('Uygulama açıldı; şimdi anahtar oluşturun');
        navigate(`/entegrasyonlar/uygulamalar/${saved.id}`);
      }
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      else if (error.code === 'DUPLICATE') setErrors({ name: error.message });
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: integrationKeys.all });
      toastError(error.code === 'STALE_WRITE' ? 'Uygulama bu arada başkası tarafından değiştirildi; ekran yenilendi, tekrar deneyin.' : error.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const payload = { ...values, ...(editing ? { expectedUpdatedAt: client.updatedAt } : {}) };
    const checked = validateWith(editing ? apiClientUpdateSchema : apiClientCreateSchema, payload);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    save.mutate(payload);
  }

  const busy = save.isPending;
  return (
    <Modal
      open
      title={editing ? 'Uygulamayı düzenle' : 'Yeni uygulama'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="api-client-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : editing ? 'Kaydet' : 'Uygulamayı aç'}
          </Button>
        </>
      }
    >
      <form id="api-client-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input label="Ad" name="client-name" value={values.name} onChange={set('name')} error={errors.name} maxLength={MAX_API_CLIENT_NAME_LENGTH} placeholder="ör. Kurumsal CRM" disabled={busy} required />
        <Textarea label="Açıklama" name="client-description" value={values.description} onChange={set('description')} error={errors.description} maxLength={MAX_API_CLIENT_DESCRIPTION_LENGTH} rows={2} placeholder="Ne için bağlanıyor, kim işletiyor" disabled={busy} />
        <Input label="Teknik iletişim (e-posta)" name="client-email" type="email" value={values.contactEmail} onChange={set('contactEmail')} error={errors.contactEmail} placeholder="entegrasyon@firma.com" disabled={busy} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Hız sınırı (istek / dakika)"
            name="client-rate"
            inputMode="numeric"
            value={values.rateLimitPerMinute}
            onChange={set('rateLimitPerMinute')}
            error={errors.rateLimitPerMinute}
            disabled={busy}
          />
          <Select label="API'den açılan rezervasyon" name="client-booking" value={values.bookingStatus} onChange={set('bookingStatus')} options={BOOKING_OPTIONS} error={errors.bookingStatus} disabled={busy} />
        </div>
        <p className="-mt-2 text-xs text-ink-muted">
          Hız sınırı uygulamanın bütün anahtarlarının toplamıdır ({API_RATE_LIMIT_MIN}–{API_RATE_LIMIT_MAX}). Fiyat dışarıdan verilemez: otelin fiyat motorundan gelir.
        </p>
      </form>
    </Modal>
  );
}
