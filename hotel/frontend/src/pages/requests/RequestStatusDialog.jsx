import { useState } from 'react';
import { MAX_REQUEST_NOTE_LENGTH } from '@hotelos/hotel-contracts';
import { Alert, Button, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';

const CANCEL_REASONS = Object.freeze(
  ['Misafir vazgeçti', 'Mükerrer kayıt', 'Yanlış oda', 'Misafir ayrıldı'].map((value) => ({ value, label: value })),
);

const DONE_NOTES = Object.freeze(
  ['Odaya bırakıldı', 'Misafire teslim edildi', 'Teknik ekip giderdi', 'Misafir arandı'].map((value) => ({
    value,
    label: value,
  })),
);

const COPY = Object.freeze({
  DONE: {
    title: 'İsteği tamamla',
    label: 'Çözüm notu (isteğe bağlı)',
    placeholder: 'ör. 2 havlu odaya bırakıldı',
    confirm: 'Tamamla',
    icon: 'check',
    chips: DONE_NOTES,
  },
  CANCELLED: {
    title: 'İsteği iptal et',
    label: 'İptal sebebi',
    placeholder: 'ör. Misafir vazgeçti',
    confirm: 'İptal et',
    icon: 'close',
    chips: CANCEL_REASONS,
  },
});

/**
 * Tamamlama ve iptal için not penceresi.
 *
 * İptal sebebi zorunlu (sözleşme de ister): "neden yapılmadı" sorusu şikâyet
 * incelemesinde ilk sorulan şey. Tamamlama notu isteğe bağlı ama gece
 * vardiyasının "ne yapıldı" sorusunu cevaplar.
 *
 * @param {{
 *   request: { title: string, room: { number: string } | null },
 *   status: 'DONE' | 'CANCELLED',
 *   isPending: boolean,
 *   onConfirm: (note: string) => void,
 *   onClose: () => void,
 * }} props
 */
export function RequestStatusDialog({ request, status, isPending, onConfirm, onClose }) {
  const copy = COPY[status];
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const submit = (event) => {
    event.preventDefault();
    if (status === 'CANCELLED' && !note.trim()) {
      setError('İptal sebebini yazın');
      return;
    }
    onConfirm(note);
  };

  return (
    <Modal
      open
      size="sm"
      title={copy.title}
      onClose={isPending ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button
            type="submit"
            form="request-status-form"
            variant={status === 'CANCELLED' ? 'danger' : 'primary'}
            icon={copy.icon}
            disabled={isPending}
          >
            {isPending ? 'İşleniyor…' : copy.confirm}
          </Button>
        </>
      }
    >
      <form id="request-status-form" onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">
          <span className="font-bold text-ink">{request.title}</span>
          {request.room ? ` · Oda ${request.room.number}` : ''}
        </p>
        <Textarea
          label={copy.label}
          name="statusNote"
          rows={3}
          value={note}
          maxLength={MAX_REQUEST_NOTE_LENGTH}
          placeholder={copy.placeholder}
          error={error}
          onChange={(event) => {
            setNote(event.target.value);
            setError('');
          }}
        />
        <ChoiceChips
          label="Hızlı seçenekler"
          options={copy.chips}
          value={note}
          onChange={(value) => {
            setNote(value);
            setError('');
          }}
          disabled={isPending}
        />
        {status === 'CANCELLED' && (
          <Alert tone="info">İptal edilen istek listeden düşer; gerekirse yeniden açılabilir.</Alert>
        )}
      </form>
    </Modal>
  );
}
