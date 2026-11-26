import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { revertStaySchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { useT } from '../../i18n/index.jsx';
import { apiPost } from '../../lib/api.js';
import { frontDeskKeys } from '../../lib/front-desk.js';
import { reservationKeys } from '../../lib/reservations.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

/** Hazır sebepler: çip etiketi `…Label`, seçilince yazılan metin (denetim izine giden) etkin dilde. */
const REASONS = Object.freeze({
  checkIn: ['checkInWrongGuest', 'checkInWrongRoom', 'checkInGuestCancelled'],
  checkOut: ['checkOutNotLeft', 'checkOutWrongRoom'],
});

/**
 * Yanlış yapılan girişi ya da çıkışı geri alır (yalnızca aynı gün; sebep
 * zorunlu, denetim izine yazılır). Oda doluluğunu room-worker düzeltir.
 *
 * @param {{ kind: 'checkIn' | 'checkOut', stay: { id: string, confirmationCode: string, updatedAt: string, guest: { name: string },
 *           room: { number: string } | null, depositMethod?: string | null }, onClose: () => void }} props
 */
export function RevertStayDialog({ kind, stay, onClose }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [serverError, setServerError] = useState(null);
  const isCheckIn = kind === 'checkIn';
  const reasonOptions = REASONS[kind].map((id) => ({ value: t(`frontDesk.revert.reason.${id}`), label: t(`frontDesk.revert.reason.${id}Label`) }));

  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/front-desk/stays/${stay.id}/${isCheckIn ? 'check-in' : 'check-out'}/revert`, body),
    onSuccess: () => {
      toastSuccess(isCheckIn ? t('frontDesk.revert.doneCheckIn') : t('frontDesk.revert.doneCheckOut'));
      queryClient.invalidateQueries({ queryKey: frontDeskKeys.all });
      queryClient.invalidateQueries({ queryKey: reservationKeys.all });
      onClose();
    },
    onError: (failure) => {
      setServerError(failure);
      if (failure.code === 'STALE_WRITE' || failure.code === 'INVALID_STATUS') {
        queryClient.invalidateQueries({ queryKey: frontDeskKeys.lists });
      }
    },
  });
  const busy = mutation.isPending;

  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: stay.updatedAt, reason };
    const result = validateWith(revertStaySchema, body);
    if (!result.ok) {
      setError(result.errors.reason ?? t('frontDesk.revert.reasonRequired'));
      return;
    }
    setError('');
    setServerError(null);
    mutation.mutate(body);
  }

  return (
    <Modal
      open
      size="sm"
      title={t(isCheckIn ? 'frontDesk.revert.titleCheckIn' : 'frontDesk.revert.titleCheckOut', { code: stay.confirmationCode })}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" form="revert-stay-form" variant="danger" icon="rotateCcw" disabled={busy}>
            {busy ? t('frontDesk.revert.busy') : t('frontDesk.revert.submit')}
          </Button>
        </>
      }
    >
      <form id="revert-stay-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Alert tone="warning" title={isCheckIn ? t('frontDesk.revert.warnCheckIn') : t('frontDesk.revert.warnCheckOut')}>
          {stay.room ? t('frontDesk.revert.guestRoom', { name: stay.guest.name, room: stay.room.number }) : t('frontDesk.revert.guest', { name: stay.guest.name })}{' '}
          {isCheckIn
            ? `${t('frontDesk.revert.checkInBody')} ${
                stay.depositMethod === 'CARD_PREAUTH'
                  ? t('frontDesk.revert.checkInPreauth')
                  : stay.depositMethod
                    ? t('frontDesk.revert.checkInDeposit')
                    : ''
              }`
            : t('frontDesk.revert.checkOutBody')}
        </Alert>
        {serverError && <Alert tone="danger" title={t('frontDesk.revert.failed')}>{serverError.message}</Alert>}
        <ChoiceChips label={t('frontDesk.revert.presets')} options={reasonOptions} value={reason} onChange={setReason} disabled={busy} />
        <Textarea label={t('frontDesk.revert.reasonField')} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} error={error} disabled={busy} autoFocus />
      </form>
    </Modal>
  );
}
