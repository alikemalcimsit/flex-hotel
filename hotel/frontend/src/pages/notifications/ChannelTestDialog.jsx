import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { channelTestSchema, NOTIFICATION_CHANNEL_LABELS, NOTIFICATION_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPost } from '../../lib/api.js';
import { notificationKeys } from '../../lib/notifications.js';
import { validateWith } from '../../lib/validate.js';
import { STATUS_TONES } from './notificationTheme.js';

const FORM_ID = 'channel-test-form';

const DELIVERY_HINTS = Object.freeze({
  EMAIL:
    'Birkaç dakika içinde gelmezse gereksiz (spam) klasörüne bakın; alan adının gönderen doğrulaması (SPF/DKIM) eksik olabilir.',
  SMS: 'Birkaç dakika içinde gelmezse gönderici başlığının sağlayıcıda onaylı olduğunu kontrol edin. Teslim durumu geçmişte güncellenir.',
});

/**
 * Kanalın kayıtlı ayarıyla gerçek bir test iletisi gönderir ve sonucu
 * hemen gösterir (sağlayıcının hata metniyle). Test iletisi geçmişte
 * "Kanal testi" olarak görünür.
 *
 * @param {{ channel: 'EMAIL' | 'SMS', onClose: () => void }} props
 */
export function ChannelTestDialog({ channel, onClose }) {
  const queryClient = useQueryClient();
  const [to, setTo] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (values) => apiPost('/notifications/channels/test', values),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.channels });
      queryClient.invalidateQueries({ queryKey: notificationKeys.histories });
      queryClient.invalidateQueries({ queryKey: notificationKeys.summary });
    },
    onError: (failure) => setError(failure.fields?.to ?? ''),
  });

  function handleSubmit(event) {
    event.preventDefault();
    const result = validateWith(channelTestSchema, { channel, to });
    if (!result.ok) {
      setError(result.errors.to ?? 'Alıcıyı kontrol edin');
      return;
    }
    setError('');
    mutation.mutate(result.data);
  }

  const result = mutation.data;
  const ok = result && (result.status === 'SENT' || result.status === 'DELIVERED');
  const label = NOTIFICATION_CHANNEL_LABELS[channel];

  return (
    <Modal
      open
      size="sm"
      title={`${label} testi`}
      onClose={mutation.isPending ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Kapat
          </Button>
          <Button type="submit" form={FORM_ID} icon="send" disabled={mutation.isPending}>
            {mutation.isPending ? 'Gönderiliyor…' : result ? 'Tekrar dene' : 'Gönder'}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          Kayıtlı ayarla gerçek bir {channel === 'EMAIL' ? 'e-posta' : 'SMS'} gönderilir
          {channel === 'SMS' ? ' (sağlayıcı ücretlendirir)' : ''}. Kendi adresinizi yazın.
        </p>
        <Input
          label={channel === 'EMAIL' ? 'Alıcı e-posta' : 'Alıcı telefon'}
          name="to"
          type={channel === 'EMAIL' ? 'email' : 'tel'}
          placeholder={channel === 'EMAIL' ? 'siz@alanadiniz.com' : '0532 000 00 00'}
          value={to}
          error={error}
          onChange={(event) => {
            setTo(event.target.value);
            setError('');
          }}
        />

        <div aria-live="polite">
          {mutation.isError && !error && (
            <Alert tone="danger" title="Test yapılamadı">
              {mutation.error.message}
            </Alert>
          )}
          {result && (
            <Alert
              tone={ok ? 'success' : 'danger'}
              title={ok ? 'Sağlayıcı iletiyi kabul etti' : 'İleti gönderilemedi'}
            >
              <span className="flex flex-col gap-1.5">
                <span>
                  <Badge tone={STATUS_TONES[result.status]}>{NOTIFICATION_STATUS_LABELS[result.status]}</Badge>
                </span>
                {ok ? (
                  <span>{DELIVERY_HINTS[channel]}</span>
                ) : (
                  <span>{result.error ?? 'Sağlayıcı hata bildirmedi.'}</span>
                )}
              </span>
            </Alert>
          )}
        </div>
      </form>
    </Modal>
  );
}
