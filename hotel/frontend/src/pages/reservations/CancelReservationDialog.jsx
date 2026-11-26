import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { cancelGroupSchema, cancelReservationSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { useT } from '../../i18n/index.jsx';
import { apiPost } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

/** Hazır sebepler: `value` metin kutusuna yazılan (etkin dilde) sebep, `label` çipin kısa adı. */
const QUICK_REASONS = Object.freeze(['guestChangedMind', 'dateChanged', 'paymentFailed', 'duplicate']);

/**
 * İptal (tek rezervasyon ya da grubun açık odaları). Sebep zorunlu; iptal
 * politikasına göre hesaplanan ceza önceden gösterilir ve gerekçeyle
 * uygulanmayabilir (denetim izine yazılır). Tahsilat folyo/ödemede.
 *
 * @param {{ reservation: object, group: boolean, onClose: () => void, onDone: () => void, onError: (error: Error) => void }} props
 */
export function CancelReservationDialog({ reservation, group, onClose, onDone, onError }) {
  const t = useT();
  const quickReasons = QUICK_REASONS.map((id) => ({ value: t(`reservations.cancel.reason.${id}`), label: t(`reservations.cancel.reasonShort.${id}`) }));
  const [reason, setReason] = useState('');
  const [waiveFee, setWaiveFee] = useState(false);
  const [error, setError] = useState('');
  const preview = reservation.cancellationPreview;
  const currency = reservation.currency;
  const openMembers = reservation.groupMembers.filter((member) => ['PENDING', 'CONFIRMED'].includes(member.status));

  const mutation = useMutation({
    mutationFn: (body) =>
      group
        ? apiPost(`/reservations/groups/${reservation.group.id}/cancel`, body)
        : apiPost(`/reservations/${reservation.id}/cancel`, body),
    onSuccess: (result) => {
      toastSuccess(group ? t('reservations.cancel.groupDone', { count: result.cancelled }) : t('reservations.cancel.done'));
      onDone();
    },
    onError: (failure) => {
      onError(failure);
      onClose();
    },
  });

  function submit(event) {
    event.preventDefault();
    const body = group ? { reason, waiveFee } : { reason, waiveFee, expectedUpdatedAt: reservation.updatedAt };
    const result = validateWith(group ? cancelGroupSchema : cancelReservationSchema, body);
    if (!result.ok) {
      setError(result.errors.reason ?? t('reservations.cancel.reasonRequired'));
      return;
    }
    mutation.mutate(body);
  }

  const busy = mutation.isPending;
  return (
    <Modal
      open
      size="md"
      title={group ? t('reservations.cancel.groupTitle', { name: reservation.group.name }) : t('reservations.cancel.title', { code: reservation.confirmationCode })}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" form="cancel-reservation-form" variant="danger" icon="close" disabled={busy}>
            {busy ? t('reservations.cancel.submitting') : group ? t('reservations.cancel.submitGroup', { count: openMembers.length }) : t('reservations.cancel.submit')}
          </Button>
        </>
      }
    >
      <form id="cancel-reservation-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {group ? (
          <Alert tone="warning" title={t('reservations.cancel.groupWarningTitle', { count: openMembers.length })}>
            {t('reservations.cancel.groupWarning')}
          </Alert>
        ) : preview?.freeUntil ? (
          preview.penaltyApplies ? (
            <Alert tone="warning" title={t('reservations.cancel.feeTitle', { fee: formatMoney(preview.fee, currency) })}>
              {t('reservations.cancel.feeText', { date: formatDate(preview.freeUntil) })}
            </Alert>
          ) : (
            <Alert tone="success" title={t('reservations.cancel.freeTitle')}>
              {t('reservations.cancel.freeText', { date: formatDate(preview.freeUntil) })}
            </Alert>
          )
        ) : (
          <Alert tone="info" title={t('reservations.cancel.noPolicyTitle')}>{t('reservations.cancel.noPolicyText')}</Alert>
        )}
        <ChoiceChips label={t('reservations.cancel.quickReasons')} options={quickReasons} value={reason} onChange={setReason} disabled={busy} />
        <Textarea label={t('reservations.cancel.reasonLabel')} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} error={error} disabled={busy} autoFocus />
        {(group || preview?.penaltyApplies) && (
          <Checkbox
            label={t('reservations.cancel.waiveFee')}
            hint={t('reservations.cancel.waiveFeeHint')}
            checked={waiveFee}
            onChange={(e) => setWaiveFee(e.target.checked)}
            disabled={busy}
          />
        )}
      </form>
    </Modal>
  );
}
