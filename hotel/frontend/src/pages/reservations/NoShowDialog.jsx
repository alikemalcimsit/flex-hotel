import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Checkbox } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
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
  const [waiveFee, setWaiveFee] = useState(false);
  const mutation = useMutation({
    mutationFn: () => apiPost(`/reservations/${reservation.id}/no-show`, { expectedUpdatedAt: reservation.updatedAt, waiveFee }),
    onSuccess: (updated) => {
      toastSuccess('"Gelmedi" olarak işaretlendi; oda yeniden satışta');
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
      title={`Gelmedi — ${reservation.confirmationCode}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button variant="danger" icon="alertCircle" onClick={() => mutation.mutate()} disabled={busy}>
            {busy ? 'İşaretleniyor…' : 'Gelmedi olarak işaretle'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Alert tone="warning" title={`Gelmedi ücreti: ${formatMoney(reservation.noShowPreview?.fee ?? '0', reservation.currency)}`}>
          İlk gecenin fiyatı. Rezervasyon yer tutmayı bırakır; misafir sonradan gelirse "Geri al" ile (yer varsa) açılır.
        </Alert>
        <Checkbox label="Ücret uygulama" hint="Uçuş iptali, iyi niyet. Denetim izine yazılır." checked={waiveFee} onChange={(e) => setWaiveFee(e.target.checked)} disabled={busy} />
      </div>
    </Modal>
  );
}
