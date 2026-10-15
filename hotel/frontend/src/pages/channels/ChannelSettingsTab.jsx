import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CHANNEX_ENVIRONMENTS,
  CHANNEX_ENVIRONMENT_LABELS,
  ICAL_PROVIDERS,
  ICAL_PROVIDER_LABELS,
  MAX_CHANNEL_HORIZON_DAYS,
  MAX_CHANNEL_NAME_LENGTH,
  MIN_CHANNEL_HORIZON_DAYS,
  updateChannelSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input, Select } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { API_URL, apiPatch, apiPost } from '../../lib/api.js';
import { propertyChanged, settingsFormOf, settingsPayload } from '../../lib/channelForm.js';
import { channelKeys } from '../../lib/channelManager.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { useChannelOutlet } from './ChannelPage.jsx';

const ENVIRONMENT_OPTIONS = CHANNEX_ENVIRONMENTS.map((value) => ({ value, label: CHANNEX_ENVIRONMENT_LABELS[value] }));
const PROVIDER_OPTIONS = ICAL_PROVIDERS.map((value) => ({ value, label: ICAL_PROVIDER_LABELS[value] }));
const STALE_TEXT = 'Kanal siz düzenlerken başkası tarafından değiştirildi; ekran yenilendi, değişikliklerinizi yeniden girin.';

/**
 * Kanal ayarları (modül 33): ad, kaç gün ileriye gönderileceği; Channex'te
 * ortam, mülk, API anahtarı (boş = değiştirme) ve fiyat farkı, rezervasyon
 * webhook'u; iCal'de takvimin geldiği yer. Bağlantı değişince sunucu yeniden
 * doğrular; mülk ya da ortam değişirse eşleştirme silinir (onay istenir).
 */
export function ChannelSettingsTab() {
  const { channel } = useChannelOutlet();
  const can = useCan();
  const canManage = can(PERMISSIONS.CHANNEL_MANAGER_MANAGE);
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() => settingsFormOf(channel));
  const [base, setBase] = useState(channel.updatedAt);
  const [errors, setErrors] = useState({});
  const [confirmProperty, setConfirmProperty] = useState(false);

  // Başkası kaydederse (canlı tazeleme) açık formun sürümü eskir: kullanıcı uyarılır, sessizce ezilmez.
  const serverChanged = channel.updatedAt !== base;
  useEffect(() => {
    if (!canManage) {
      setValues(settingsFormOf(channel));
      setBase(channel.updatedAt);
    }
  }, [canManage, channel]);
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));

  const save = useMutation({
    mutationFn: (payload) => apiPatch(`/channel-manager/${channel.id}`, payload),
    onSuccess: (result) => {
      toastSuccess(result.type === 'CHANNEX' && values.apiKey ? 'Kaydedildi; Channex bağlantısı doğrulandı' : 'Kanal ayarı kaydedildi');
      queryClient.setQueryData(channelKeys.detail(result.id), result);
      queryClient.invalidateQueries({ queryKey: channelKeys.all });
      setValues(settingsFormOf(result));
      setBase(result.updatedAt);
      setConfirmProperty(false);
    },
    onError: (error) => {
      setConfirmProperty(false);
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      toastError(error.code === 'STALE_WRITE' ? STALE_TEXT : error.message);
      if (error.code === 'STALE_WRITE') {
        queryClient.invalidateQueries({ queryKey: channelKeys.all });
        setValues(settingsFormOf(channel));
        setBase(channel.updatedAt);
      }
    },
  });

  function submit(event) {
    event.preventDefault();
    const payload = settingsPayload(values, { ...channel, updatedAt: base });
    const checked = validateWith(updateChannelSchema, payload);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    if (propertyChanged(values, channel) && channel.rooms.length > 0) {
      setConfirmProperty(true);
      return;
    }
    save.mutate(payload);
  }

  const busy = save.isPending;
  const disabled = busy || !canManage;
  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-4">
        {serverChanged && canManage && (
          <Alert
            tone="warning"
            title="Kanal başka biri tarafından değiştirildi"
            action={
              <Button type="button" size="sm" variant="outline" icon="refresh" onClick={() => { setValues(settingsFormOf(channel)); setBase(channel.updatedAt); setErrors({}); }}>
                Güncel hâli yükle
              </Button>
            }
          >
            Bu formu kaydetmeden önce güncel hâli yükleyin; yoksa kayıt reddedilir.
          </Alert>
        )}
        <Input label="Kanal adı" name="settings-name" value={values.name} onChange={set('name')} error={errors.name} maxLength={MAX_CHANNEL_NAME_LENGTH} disabled={disabled} />
        <Input
          label={channel.type === 'CHANNEX' ? 'Kaç gün ileriye gönderilir' : 'Takvimde kaç gün ileri'}
          name="settings-horizon"
          type="number"
          inputMode="numeric"
          min={MIN_CHANNEL_HORIZON_DAYS}
          max={MAX_CHANNEL_HORIZON_DAYS}
          value={values.horizonDays}
          onChange={set('horizonDays')}
          error={errors.horizonDays}
          disabled={disabled}
          className="w-48"
        />
        {channel.type === 'CHANNEX' ? (
          <>
            <Input label="Kanal fiyat farkı (%)" name="settings-markup" inputMode="decimal" value={values.priceMarkupPercent} onChange={set('priceMarkupPercent')} error={errors.priceMarkupPercent} disabled={disabled} className="w-48" />
            <p className="-mt-2 text-xs text-ink-muted">Kanala giden fiyat = sistem fiyatı (taban × sezon) + bu yüzde. Değişince bütün günler yeniden gönderilir.</p>
            <Select label="Ortam" name="settings-environment" value={values.environment} onChange={set('environment')} options={ENVIRONMENT_OPTIONS} error={errors.environment} disabled={disabled} className="sm:w-64" />
            <Input label="Channex mülk kimliği" name="settings-property" value={values.propertyId} onChange={set('propertyId')} error={errors.propertyId} autoComplete="off" disabled={disabled} />
            <Input
              label="Channex API anahtarı"
              name="settings-api-key"
              type="password"
              value={values.apiKey}
              onChange={set('apiKey')}
              error={errors.apiKey}
              placeholder={channel.hasApiKey ? 'Kayıtlı (değiştirmek için yenisini yazın)' : ''}
              autoComplete="new-password"
              disabled={disabled}
            />
            {channel.externalCurrency && (
              <p className="-mt-2 text-xs text-ink-muted">
                Bağlı mülk: <span className="font-semibold text-ink">{channel.externalName}</span> · para birimi {channel.externalCurrency}
              </p>
            )}
          </>
        ) : (
          <Select label="Takvimin geldiği yer" name="settings-provider" value={values.provider} onChange={set('provider')} options={PROVIDER_OPTIONS} error={errors.provider} disabled={disabled} className="sm:w-64" />
        )}
        {canManage && (
          <div className="flex gap-2">
            <Button type="submit" icon="check" disabled={busy || serverChanged}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</Button>
          </div>
        )}
      </form>

      {channel.type === 'CHANNEX' && <WebhookSection channel={channel} canManage={canManage} />}

      <ConfirmDialog
        open={confirmProperty}
        title="Channex mülkü değişiyor"
        message={`Eşleştirme eski mülkün oda tiplerine ve fiyat planlarına bağlıydı: ${channel.rooms.length} oda tipi eşleşmesi silinecek, webhook kaldırılacak. Yeni mülk için eşleştirmeyi yeniden yapmanız gerekir.`}
        confirmLabel="Mülkü değiştir"
        confirmVariant="danger"
        onConfirm={() => save.mutate(settingsPayload(values, { ...channel, updatedAt: base }))}
        onClose={() => setConfirmProperty(false)}
        isPending={busy}
      />
    </div>
  );
}

/**
 * Channex rezervasyon webhook'u: Channex yeni / değişen / iptal edilen
 * rezervasyonu bu sunucuya anında haber verir (yoksa dakikada bir okunur).
 * Adres bu panelin konuştuğu sunucu köküdür; https olmalı.
 *
 * @param {{ channel: any, canManage: boolean }} props
 */
function WebhookSection({ channel, canManage }) {
  const queryClient = useQueryClient();
  const callbackUrl = `${API_URL.replace(/\/+$/, '')}/webhooks/channex/${channel.id}`;
  const secure = API_URL.startsWith('https://');
  const setup = useMutation({
    mutationFn: () => apiPost(`/channel-manager/${channel.id}/webhook`, { expectedUpdatedAt: channel.updatedAt, callbackBaseUrl: API_URL }),
    onSuccess: (result) => {
      toastSuccess('Webhook kuruldu: yeni rezervasyonlar anında gelecek');
      queryClient.setQueryData(channelKeys.detail(result.id), result);
      queryClient.invalidateQueries({ queryKey: channelKeys.all });
    },
    onError: (error) => toastError(error.code === 'STALE_WRITE' ? STALE_TEXT : error.message),
  });
  return (
    <section aria-label="Webhook" className="flex max-w-2xl flex-col gap-3 rounded-item border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-ink">Rezervasyon webhook'u</h2>
        <Badge tone={channel.webhookConfigured ? 'success' : 'neutral'}>{channel.webhookConfigured ? 'Kurulu' : 'Kurulmadı'}</Badge>
      </div>
      <p className="text-sm text-ink-soft">
        Kurulursa Channex yeni, değişen ve iptal edilen rezervasyonu anında bildirir. Kurulmasa da rezervasyonlar dakikada bir okunur; hiçbiri kaybolmaz.
      </p>
      <p className="break-all font-mono text-xs text-ink-muted">{callbackUrl}</p>
      {!secure && <Alert tone="warning" title="Adres https değil">Channex yalnızca https adresine bildirim gönderir; bu ortamda webhook kurulamaz (rezervasyonlar dakikada bir okunur).</Alert>}
      {canManage && (
        <div>
          <Button variant="outline" icon="link" onClick={() => setup.mutate()} disabled={setup.isPending || !secure || !channel.hasApiKey}>
            {setup.isPending ? 'Kuruluyor…' : channel.webhookConfigured ? 'Webhook\'u yenile' : 'Webhook\'u kur'}
          </Button>
        </div>
      )}
    </section>
  );
}
