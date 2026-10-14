import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CHANNEX_ENVIRONMENTS,
  CHANNEX_ENVIRONMENT_LABELS,
  CHANNEX_HORIZON_DAYS,
  CHANNEL_TYPE_LABELS,
  DEFAULT_ICAL_HORIZON_DAYS,
  ICAL_PROVIDERS,
  ICAL_PROVIDER_LABELS,
  MAX_CHANNEL_NAME_LENGTH,
  createChannelSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Select } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { apiPost } from '../../lib/api.js';
import { channelKeys } from '../../lib/channelManager.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const TYPE_OPTIONS = [
  { value: 'CHANNEX', label: CHANNEL_TYPE_LABELS.CHANNEX },
  { value: 'ICAL', label: CHANNEL_TYPE_LABELS.ICAL },
];
const ENVIRONMENT_OPTIONS = CHANNEX_ENVIRONMENTS.map((value) => ({ value, label: CHANNEX_ENVIRONMENT_LABELS[value] }));
const PROVIDER_OPTIONS = ICAL_PROVIDERS.map((value) => ({ value, label: ICAL_PROVIDER_LABELS[value] }));

/**
 * Yeni kanal (modül 33). Channex'te bağlantı kaydederken denetlenir (anahtar,
 * mülk, para birimi); kanal "kuruluyor" açılır, eşleştirmeden sonra senkrona alınır.
 *
 * @param {{ onClose: () => void }} props
 */
export function NewChannelDialog({ onClose }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ type: 'CHANNEX', name: 'Channex', environment: 'STAGING', propertyId: '', apiKey: '', priceMarkupPercent: '0', provider: 'AIRBNB' });
  const [errors, setErrors] = useState({});
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));

  const create = useMutation({
    mutationFn: (payload) => apiPost('/channel-manager', payload),
    onSuccess: (channel) => {
      toastSuccess(channel.type === 'CHANNEX' ? `Channex bağlandı: ${channel.externalName ?? channel.name}` : 'Takvim kanalı açıldı');
      queryClient.invalidateQueries({ queryKey: channelKeys.all });
      navigate(`/kanallar/${channel.id}/eslestirme`);
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      else if (error.details?.field) setErrors({ [error.details.field]: error.message });
      toastError(error.message);
    },
  });

  function payloadOf() {
    return values.type === 'CHANNEX'
      ? { type: 'CHANNEX', name: values.name, environment: values.environment, propertyId: values.propertyId.trim(), apiKey: values.apiKey.trim(), priceMarkupPercent: values.priceMarkupPercent, horizonDays: CHANNEX_HORIZON_DAYS }
      : { type: 'ICAL', name: values.name, provider: values.provider, horizonDays: DEFAULT_ICAL_HORIZON_DAYS };
  }

  function submit(event) {
    event.preventDefault();
    const payload = payloadOf();
    const checked = validateWith(createChannelSchema, payload);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    create.mutate(payload);
  }

  const busy = create.isPending;
  return (
    <Modal
      open
      title="Yeni kanal"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="channel-form" icon="check" disabled={busy}>
            {busy ? (values.type === 'CHANNEX' ? 'Bağlantı denetleniyor…' : 'Açılıyor…') : 'Kanalı aç'}
          </Button>
        </>
      }
    >
      <form id="channel-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <ChoiceChips
          label="Kanal türü"
          options={TYPE_OPTIONS}
          value={values.type}
          onChange={(type) => setValues((current) => ({ ...current, type, name: type === 'CHANNEX' ? 'Channex' : ICAL_PROVIDER_LABELS[current.provider] }))}
          disabled={busy}
          required
        />
        <p className="text-xs text-ink-soft">
          {values.type === 'CHANNEX'
            ? 'Booking.com, Expedia, Airbnb, Agoda ve diğer OTA\'lar Channex üzerinden bağlanır. Müsaitlik, fiyat ve stop-sale otomatik gider; OTA rezervasyonları onaylı olarak, OTA\'nın tutarıyla açılır.'
            : 'Takvim senkronu: kanal bizim takvimimizi okur (satılamayan günler dolu görünür), biz kanalın takvimini okuruz (rezervasyon olarak açılır). Fiyat gitmez.'}
        </p>
        <Input label="Kanal adı" name="channel-name" value={values.name} onChange={set('name')} error={errors.name} maxLength={MAX_CHANNEL_NAME_LENGTH} disabled={busy} required />
        {values.type === 'CHANNEX' ? (
          <>
            <Select label="Ortam" name="channel-environment" value={values.environment} onChange={set('environment')} options={ENVIRONMENT_OPTIONS} error={errors.environment} disabled={busy} />
            <Input
              label="Channex mülk kimliği"
              name="channel-property"
              value={values.propertyId}
              onChange={set('propertyId')}
              error={errors.propertyId}
              placeholder="3f2a9c1e-…"
              autoComplete="off"
              disabled={busy}
              required
            />
            <Input
              label="Channex API anahtarı"
              name="channel-api-key"
              type="password"
              value={values.apiKey}
              onChange={set('apiKey')}
              error={errors.apiKey}
              autoComplete="new-password"
              disabled={busy}
              required
            />
            <Input
              label="Kanal fiyat farkı (%)"
              name="channel-markup"
              inputMode="decimal"
              value={values.priceMarkupPercent}
              onChange={set('priceMarkupPercent')}
              error={errors.priceMarkupPercent}
              disabled={busy}
              className="w-40"
            />
            <p className="-mt-2 text-xs text-ink-muted">Kanala giden fiyat = sistem fiyatı + bu yüzde (komisyonu karşılamak için; eksi değer kanalda daha ucuz).</p>
          </>
        ) : (
          <Select
            label="Takvimin geldiği yer"
            name="channel-provider"
            value={values.provider}
            onChange={(event) => setValues((current) => ({ ...current, provider: event.target.value, name: current.name === ICAL_PROVIDER_LABELS[current.provider] ? ICAL_PROVIDER_LABELS[event.target.value] : current.name }))}
            options={PROVIDER_OPTIONS}
            error={errors.provider}
            disabled={busy}
          />
        )}
        {errors.type && <Alert tone="danger" title="Açılamadı">{errors.type}</Alert>}
      </form>
    </Modal>
  );
}
