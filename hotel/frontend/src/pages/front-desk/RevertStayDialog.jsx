import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { revertStaySchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { apiPost } from '../../lib/api.js';
import { frontDeskKeys } from '../../lib/front-desk.js';
import { reservationKeys } from '../../lib/reservations.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

const REASONS = Object.freeze({
  checkIn: [
    { value: 'Yanlış misafire giriş yapıldı', label: 'Yanlış misafir' },
    { value: 'Yanlış odaya giriş yapıldı', label: 'Yanlış oda' },
    { value: 'Misafir odaya çıkmadan vazgeçti', label: 'Misafir vazgeçti' },
  ],
  checkOut: [
    { value: 'Misafir henüz ayrılmamış', label: 'Misafir ayrılmamış' },
    { value: 'Yanlış odanın çıkışı yapıldı', label: 'Yanlış oda' },
  ],
});

/**
 * Yanlış yapılan girişi ya da çıkışı geri alır (yalnızca aynı gün; sebep
 * zorunlu, denetim izine yazılır). Oda doluluğunu room-worker düzeltir.
 *
 * @param {{ kind: 'checkIn' | 'checkOut', stay: { id: string, confirmationCode: string, updatedAt: string, guest: { name: string },
 *           room: { number: string } | null, depositMethod?: string | null }, onClose: () => void }} props
 */
export function RevertStayDialog({ kind, stay, onClose }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [serverError, setServerError] = useState(null);
  const isCheckIn = kind === 'checkIn';

  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/front-desk/stays/${stay.id}/${isCheckIn ? 'check-in' : 'check-out'}/revert`, body),
    onSuccess: () => {
      toastSuccess(isCheckIn ? 'Giriş geri alındı; oda yeniden boş' : 'Çıkış geri alındı; misafir yeniden içeride');
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
      setError(result.errors.reason ?? 'Sebep yazın');
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
      title={`${isCheckIn ? 'Girişi' : 'Çıkışı'} geri al — ${stay.confirmationCode}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="revert-stay-form" variant="danger" icon="rotateCcw" disabled={busy}>
            {busy ? 'Geri alınıyor…' : 'Geri al'}
          </Button>
        </>
      }
    >
      <form id="revert-stay-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Alert tone="warning" title={isCheckIn ? 'Misafir içeride sayılmayacak' : 'Misafir yeniden içeride sayılacak'}>
          {stay.guest.name}
          {stay.room ? `, oda ${stay.room.number}` : ''}.{' '}
          {isCheckIn
            ? `Rezervasyon onaylıya döner, oda boşalır. ${stay.depositMethod ? 'Alınan teminatı iade edin.' : ''}`
            : 'Çıkışta bırakılan geceler geri gelmez; misafir kalacaksa rezervasyonu uzatın.'}
        </Alert>
        {serverError && <Alert tone="danger" title="Geri alınamadı">{serverError.message}</Alert>}
        <ChoiceChips label="Hazır sebepler" options={REASONS[kind]} value={reason} onChange={setReason} disabled={busy} />
        <Textarea label="Sebep" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} error={error} disabled={busy} autoFocus />
      </form>
    </Modal>
  );
}
