import { useState } from 'react';
import { MAX_REQUEST_REASON_LENGTH, MIN_REQUEST_REASON_LENGTH } from '@hotelos/hotel-contracts';
import { Button, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';

/**
 * Gerekçe isteyen onay penceresi (tur kapatma, sipariş iptali / eksik kapatma). Gerekçe
 * sözleşmedeki sınırlarla denetlenir; sunucu da aynı şemayla doğrular.
 *
 * @param {{ title: string, message: string, confirmLabel: string, confirmVariant?: 'danger' | 'primary', confirmIcon?: string, busy: boolean, onConfirm: (reason: string) => void, onClose: () => void }} props
 */
export function ReasonDialog({ title, message, confirmLabel, confirmVariant = 'danger', confirmIcon = 'close', busy, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  function submit(event) {
    event.preventDefault();
    const text = reason.trim();
    if (text.length < MIN_REQUEST_REASON_LENGTH) return setError(`Gerekçe en az ${MIN_REQUEST_REASON_LENGTH} karakter`);
    setError(null);
    onConfirm(text);
  }
  return (
    <Modal
      open
      size="sm"
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="reason-form" variant={confirmVariant} icon={confirmIcon} disabled={busy}>
            {busy ? 'İşleniyor…' : confirmLabel}
          </Button>
        </>
      }
    >
      <form id="reason-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">{message}</p>
        <Textarea label="Gerekçe" name="reason" rows={3} maxLength={MAX_REQUEST_REASON_LENGTH} value={reason} onChange={(event) => setReason(event.target.value)} error={error ?? undefined} required disabled={busy} />
      </form>
    </Modal>
  );
}
