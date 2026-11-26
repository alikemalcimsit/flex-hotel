import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MAX_KBS_NOTE_LENGTH, kbsManualSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPost } from '../../lib/api.js';
import { kbsKeys } from '../../lib/kbs.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

/**
 * "Elle bildirildi" (modül 58, `kbs.send`): sırada ya da gönderilemeyen bildirim KBS ekranından elle girildiyse işaretlenir.
 * Not zorunlu (nasıl bildirildiği); işaretlenince buna bağlı çıkış / oda değişikliği gidebilir.
 * @param {{ notification: { id: string, guestName: string }, onClose: () => void }} props
 */
export function ManualDialog({ notification, onClose }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/kbs/notifications/${notification.id}/manual`, body),
    onSuccess: (result) => {
      queryClient.setQueryData(kbsKeys.notification(notification.id), result);
      queryClient.invalidateQueries({ queryKey: kbsKeys.all });
      toastSuccess('Elle bildirildi olarak işaretlendi');
      onClose();
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
    },
  });
  const busy = mutation.isPending;

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(kbsManualSchema, { note });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    mutation.mutate(checked.data);
  }

  return (
    <Modal
      open
      title={`Elle bildirildi: ${notification.guestName}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="kbs-manual-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'İşaretle'}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <Alert tone="danger" title="Yapılmadı" className="mb-4">
          {mutation.error.message}
        </Alert>
      )}
      <form id="kbs-manual-form" noValidate onSubmit={submit} className="flex flex-col gap-3">
        <Textarea
          label="Nasıl bildirildi"
          name="kbs-manual-note"
          rows={3}
          maxLength={MAX_KBS_NOTE_LENGTH}
          placeholder="ör. KBS ekranından elle girildi, saat 14:20"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          error={errors.note}
          disabled={busy}
        />
        <p className="text-xs text-ink-muted">Sistem bu bildirimi bir daha göndermez; not iz kaydına yazılır.</p>
      </form>
    </Modal>
  );
}
