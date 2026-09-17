import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelNotificationSchema,
  displayPhone,
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_LANGUAGE_LABELS,
  NOTIFICATION_MAX_ATTEMPTS,
  NOTIFICATION_RESENDABLE_STATUSES,
  NOTIFICATION_SOURCE_LABELS,
  NOTIFICATION_STATUS_LABELS,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Icon, Spinner, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost } from '../../lib/api.js';
import { notificationKeys } from '../../lib/notifications.js';
import { formatDateTime } from '../../lib/timeFormat.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { STATUS_TONES } from './notificationTheme.js';

const CANCEL_REASONS = Object.freeze([
  { value: 'Misafir istemedi', label: 'Misafir istemedi' },
  { value: 'Yanlış alıcı', label: 'Yanlış alıcı' },
  { value: 'Bilgi değişti', label: 'Bilgi değişti' },
]);

/**
 * Tek bildirimin dökümü: tam metin, kime, ne zaman, kaç denemede; gitmediyse
 * sağlayıcının söylediği sebep.
 *
 * - **Tekrar gönder** yeni bir kayıt açar (eskisi olduğu gibi kalır). Misafir
 *   kartındaki adres bu arada düzeltildiyse yeni adrese gider.
 * - **İptal** yalnızca sıradaki bildirimde; sebep zorunlu.
 *
 * İki işlemin onayı da aynı pencerede sorulur (üst üste pencere açılmaz:
 * Esc ikisini birden kapatırdı).
 *
 * @param {{
 *   notificationId: string,
 *   canManage: boolean,
 *   timeZone: string,
 *   onOpen: (id: string) => void,
 *   onClose: () => void,
 * }} props
 */
export function NotificationDetailDialog({ notificationId, canManage, timeZone, onOpen, onClose }) {
  const queryClient = useQueryClient();
  /** `view` | `resend` (onay bekliyor) | `cancel` (sebep yazılıyor) */
  const [mode, setMode] = useState('view');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');

  const query = useQuery({
    queryKey: notificationKeys.detail(notificationId),
    queryFn: () => api(`/notifications/history/${notificationId}`),
  });
  const item = query.data;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: notificationKeys.histories });
    queryClient.invalidateQueries({ queryKey: notificationKeys.summary });
  };

  const resendMutation = useMutation({
    mutationFn: () => apiPost(`/notifications/history/${notificationId}/resend`, {}),
    onSuccess: (created) => {
      setMode('view');
      refresh();
      queryClient.invalidateQueries({ queryKey: notificationKeys.detail(notificationId) });
      toastSuccess(`${NOTIFICATION_CHANNEL_LABELS[created.channel]} yeniden sıraya alındı: ${channelAddress(created)}`);
      onOpen(created.id);
    },
    onError: (error) => toastError(error.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (input) => apiPost(`/notifications/history/${notificationId}/cancel`, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(notificationKeys.detail(notificationId), updated);
      refresh();
      setMode('view');
      toastSuccess('Bildirim iptal edildi; gönderilmeyecek');
    },
    onError: (error) => {
      toastError(error.message);
      if (error.code === 'NOT_PENDING') {
        setMode('view');
        queryClient.invalidateQueries({ queryKey: notificationKeys.detail(notificationId) });
      }
    },
  });

  function submitCancel(event) {
    event.preventDefault();
    const result = validateWith(cancelNotificationSchema, { reason });
    if (!result.ok) {
      setReasonError(result.errors.reason ?? 'İptal sebebini yazın');
      return;
    }
    cancelMutation.mutate(result.data);
  }

  const canResend =
    canManage && item && NOTIFICATION_RESENDABLE_STATUSES.includes(item.status) && item.source !== 'CHANNEL_TEST';
  const canCancel = canManage && item?.status === 'PENDING';

  const busy = resendMutation.isPending || cancelMutation.isPending;
  const back = (
    <Button variant="outline" onClick={() => setMode('view')} disabled={busy}>
      Vazgeç
    </Button>
  );
  const footer =
    item &&
    (mode === 'cancel' ? (
      <>
        {back}
        <Button type="submit" form="cancel-notification-form" variant="danger" icon="close" disabled={busy}>
          {cancelMutation.isPending ? 'İptal ediliyor…' : 'Bildirimi iptal et'}
        </Button>
      </>
    ) : mode === 'resend' ? (
      <>
        {back}
        <Button icon="send" disabled={busy} onClick={() => resendMutation.mutate()}>
          {resendMutation.isPending ? 'Sıraya alınıyor…' : 'Evet, tekrar gönder'}
        </Button>
      </>
    ) : (
      <>
        {canCancel && (
          <Button variant="dangerSoft" icon="close" onClick={() => setMode('cancel')}>
            İptal et
          </Button>
        )}
        {canResend && (
          <Button icon="send" onClick={() => setMode('resend')}>
            Tekrar gönder
          </Button>
        )}
        <Button variant="outline" onClick={onClose}>
          Kapat
        </Button>
      </>
    ));

  return (
    <Modal
      open
      size="lg"
      title={item ? `${NOTIFICATION_SOURCE_LABELS[item.source]} — ${NOTIFICATION_CHANNEL_LABELS[item.channel]}` : 'Bildirim'}
      onClose={onClose}
      footer={footer}
    >
      {query.isPending && <Spinner className="py-10" />}
      {query.isError && (
        <Alert
          tone="danger"
          title="Bildirim yüklenemedi"
          action={
            <Button variant="outline" size="sm" icon="refresh" onClick={() => query.refetch()}>
              Tekrar dene
            </Button>
          }
        >
          {query.error.message}
        </Alert>
      )}
      {item && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONES[item.status]}>{NOTIFICATION_STATUS_LABELS[item.status]}</Badge>
            {item.resendOfId && (
              <button
                type="button"
                onClick={() => onOpen(item.resendOfId)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-info-ink underline-offset-2 hover:underline"
              >
                <Icon name="rotateCcw" className="size-3.5" />
                İlk gönderimi aç
              </button>
            )}
          </div>

          {item.status === 'FAILED' && item.error && (
            <Alert tone="danger" title="Gönderilemedi">
              {item.error}
              {item.errorCode && <span className="ml-1 text-xs opacity-70">({item.errorCode})</span>}
            </Alert>
          )}
          {item.status === 'PENDING' && item.attempts > 0 && (
            <Alert tone="warning" title={`${item.attempts}. deneme başarısız, yeniden denenecek`}>
              {item.error ?? 'Geçici hata'} — sıradaki deneme {formatDateTime(item.nextAttemptAt, timeZone)}. En fazla{' '}
              {NOTIFICATION_MAX_ATTEMPTS} deneme yapılır.
            </Alert>
          )}
          {item.status === 'CANCELLED' && item.cancelReason && (
            <Alert tone="info" title="Gönderilmedi">
              {item.cancelReason}
            </Alert>
          )}

          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Field label="Alıcı">
              {item.recipientName && <span className="block font-semibold">{item.recipientName}</span>}
              <span className="break-all">{channelAddress(item)}</span>
            </Field>
            <Field label="Rezervasyon">{item.confirmationCode ?? '—'}</Field>
            <Field label="Dil">{NOTIFICATION_LANGUAGE_LABELS[item.language] ?? item.language}</Field>
            <Field label="Oluşturan">{item.createdBy ?? 'Sistem'}</Field>
            <Field label="Sıraya girdi">{formatDateTime(item.createdAt, timeZone)}</Field>
            {item.sentAt && <Field label="Gönderildi">{formatDateTime(item.sentAt, timeZone)}</Field>}
            {item.deliveredAt && <Field label="İletildi">{formatDateTime(item.deliveredAt, timeZone)}</Field>}
            {item.failedAt && <Field label="Vazgeçildi">{formatDateTime(item.failedAt, timeZone)}</Field>}
            {item.cancelledAt && <Field label="İptal">{formatDateTime(item.cancelledAt, timeZone)}</Field>}
            <Field label="Deneme">{item.attempts}</Field>
            {item.provider && (
              <Field label="Sağlayıcı">
                {item.provider}
                {item.providerMessageId && (
                  <span className="block break-all text-xs text-ink-muted">Kayıt no: {item.providerMessageId}</span>
                )}
              </Field>
            )}
          </dl>

          <section aria-label="Gönderilen metin" className="rounded-panel border border-line bg-surface-muted p-4">
            {item.subject && <p className="mb-2 text-sm font-bold text-ink">{item.subject}</p>}
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-soft">{item.body}</p>
          </section>

          {item.resends.length > 0 && (
            <section aria-label="Tekrar gönderimler">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Tekrar gönderimler</h3>
              <ul className="flex flex-col gap-1.5">
                {item.resends.map((resend) => (
                  <li key={resend.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(resend.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-item border border-line px-3 py-2 text-left text-sm hover:border-line-strong"
                    >
                      <span>{formatDateTime(resend.createdAt, timeZone)}</span>
                      <Badge tone={STATUS_TONES[resend.status]}>{NOTIFICATION_STATUS_LABELS[resend.status]}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {mode === 'resend' && (
            <Alert tone="info" title="Bildirim tekrar gönderilsin mi?">
              Aynı metin misafire yeniden gönderilecek ({NOTIFICATION_CHANNEL_LABELS[item.channel]}). Misafir
              kartındaki adres değiştiyse yeni adrese gider.
            </Alert>
          )}

          {mode === 'cancel' && (
            <form id="cancel-notification-form" onSubmit={submitCancel} className="flex flex-col gap-3 border-t border-line pt-4">
              <Textarea
                label="İptal sebebi"
                name="reason"
                rows={2}
                maxLength={200}
                value={reason}
                error={reasonError}
                onChange={(event) => {
                  setReason(event.target.value);
                  setReasonError('');
                }}
              />
              <ChoiceChips
                label="Hazır sebepler"
                options={CANCEL_REASONS}
                value={reason}
                onChange={(value) => {
                  setReason(value);
                  setReasonError('');
                }}
              />
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}

/** SMS alıcısı uluslararası biçimde saklanır; okunaklı gösterilir. */
function channelAddress(item) {
  return item.channel === 'EMAIL' ? item.recipient : displayPhone(item.recipient);
}

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{label}</dt>
      <dd className="mt-1 text-ink">{children}</dd>
    </div>
  );
}
