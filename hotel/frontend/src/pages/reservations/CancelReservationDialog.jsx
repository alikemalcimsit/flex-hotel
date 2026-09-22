import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { cancelGroupSchema, cancelReservationSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { apiPost } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

const QUICK_REASONS = Object.freeze([
  { value: 'Misafir vazgeçti', label: 'Misafir vazgeçti' },
  { value: 'Tarih değişti, yeniden açılacak', label: 'Tarih değişti' },
  { value: 'Ödeme alınamadı', label: 'Ödeme alınamadı' },
  { value: 'Mükerrer kayıt', label: 'Mükerrer kayıt' },
]);

/**
 * İptal (tek rezervasyon ya da grubun açık odaları). Sebep zorunlu; iptal
 * politikasına göre hesaplanan ceza önceden gösterilir ve gerekçeyle
 * uygulanmayabilir (denetim izine yazılır). Tahsilat folyo/ödemede.
 *
 * @param {{ reservation: object, group: boolean, onClose: () => void, onDone: () => void, onError: (error: Error) => void }} props
 */
export function CancelReservationDialog({ reservation, group, onClose, onDone, onError }) {
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
      toastSuccess(group ? `${result.cancelled} oda iptal edildi` : 'Rezervasyon iptal edildi');
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
      setError(result.errors.reason ?? 'Sebep yazın');
      return;
    }
    mutation.mutate(body);
  }

  const busy = mutation.isPending;
  return (
    <Modal
      open
      size="md"
      title={group ? `Grubu iptal et — ${reservation.group.name}` : `İptal — ${reservation.confirmationCode}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="cancel-reservation-form" variant="danger" icon="close" disabled={busy}>
            {busy ? 'İptal ediliyor…' : group ? `${openMembers.length} odayı iptal et` : 'İptal et'}
          </Button>
        </>
      }
    >
      <form id="cancel-reservation-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {group ? (
          <Alert tone="warning" title={`${openMembers.length} açık oda iptal edilecek`}>
            Giriş yapmış ya da kapanmış odalara dokunulmaz. Her oda kendi iptal politikasıyla ücretlendirilir.
          </Alert>
        ) : preview?.freeUntil ? (
          preview.penaltyApplies ? (
            <Alert tone="warning" title={`İptal ücreti: ${formatMoney(preview.fee, currency)}`}>
              Ücretsiz iptal süresi {formatDate(preview.freeUntil)} tarihinde doldu. Ücret folyoya yansıtılmak üzere kaydedilir.
            </Alert>
          ) : (
            <Alert tone="success" title="Ücretsiz iptal">
              {formatDate(preview.freeUntil)} tarihine kadar ücretsiz iptal hakkı var.
            </Alert>
          )
        ) : (
          <Alert tone="info" title="İptal cezası yok">Otelin iptal politikası tanımlı değil.</Alert>
        )}
        <ChoiceChips label="Hazır sebepler" options={QUICK_REASONS} value={reason} onChange={setReason} disabled={busy} />
        <Textarea label="İptal sebebi" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} error={error} disabled={busy} autoFocus />
        {(group || preview?.penaltyApplies) && (
          <Checkbox
            label="Ceza uygulama"
            hint="İyi niyet, hastalık, otelden kaynaklı sebep. Politikadaki ücret denetim izine yazılır."
            checked={waiveFee}
            onChange={(e) => setWaiveFee(e.target.checked)}
            disabled={busy}
          />
        )}
      </form>
    </Modal>
  );
}
