import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Checkbox } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { useT } from '../../i18n/index.jsx';
import { apiPost } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { toastSuccess } from '../../store/toast.js';

/**
 * "Gelmedi" işareti: giriş günü gelmiş ama misafir gelmemiş. Ücret ilk gecenin
 * fiyatıdır; personel gerekçeyle uygulamayabilir. Oda yeniden satışa açılır.
 *
 * @param {{ reservation: object, onClose: () => void, onDone: (updated: object) => void, onError: (error: Error) => void }} props
 */
export function NoShowDialog({ reservation, onClose, onDone, onError }) {
  const t = useT();
  const [waiveFee, setWaiveFee] = useState(false);
  const mutation = useMutation({
    mutationFn: () => apiPost(`/reservations/${reservation.id}/no-show`, { expectedUpdatedAt: reservation.updatedAt, waiveFee }),
    onSuccess: (updated) => {
      toastSuccess(t('reservations.noShow.done'));
      onDone(updated);
    },
    onError: (error) => {
      onError(error);
      onClose();
    },
  });
  const busy = mutation.isPending;

  return (
    <Modal
      open
      size="sm"
      title={t('reservations.noShow.title', { code: reservation.confirmationCode })}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button variant="danger" icon="alertCircle" onClick={() => mutation.mutate()} disabled={busy}>
            {busy ? t('reservations.noShow.submitting') : t('reservations.noShow.submit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Alert tone="warning" title={t('reservations.noShow.feeTitle', { fee: formatMoney(reservation.noShowPreview?.fee ?? '0', reservation.currency) })}>
          {t('reservations.noShow.feeHint')}
        </Alert>
        <Checkbox label={t('reservations.noShow.waiveFee')} hint={t('reservations.noShow.waiveFeeHint')} checked={waiveFee} onChange={(e) => setWaiveFee(e.target.checked)} disabled={busy} />
      </div>
    </Modal>
  );
}
