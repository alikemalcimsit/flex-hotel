import { useState } from 'react';
import { Alert, Button } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { MoveReasonField } from './MoveReasonField.jsx';

/**
 * Sürükle-bırakla içerideki misafiri taşımadan önce onay (sebep ile).
 *
 * Taşıma fiziksel bir iştir (eşya, anahtar kartı) ve oda durumlarını
 * değiştirir; sürükleme kazara olabilir. Genel onay diyaloğu yerine burada
 * sebep de sorulur — geçmişe ve denetim izine yazılır.
 *
 * @param {{
 *   move: { guestName: string | null, roomNumber: string | null, room: { number: string } },
 *   isPending: boolean,
 *   error: Error | null,
 *   onConfirm: (reason: string) => void,
 *   onClose: () => void,
 * }} props
 */
export function MoveConfirmDialog({ move, isPending, error, onConfirm, onClose }) {
  const [reason, setReason] = useState('');

  return (
    <Modal
      open
      size="sm"
      title="İçerideki misafir taşınacak"
      onClose={isPending ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button icon="key" onClick={() => onConfirm(reason.trim())} disabled={isPending}>
            {isPending ? 'Taşınıyor…' : 'Taşı'}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-soft">
        <strong className="text-ink">{move.guestName ?? 'Misafir'}</strong> {move.roomNumber} numaralı odadan{' '}
        <strong className="text-ink">{move.room.number}</strong> numaralı odaya taşınacak. {move.roomNumber} numaralı
        oda boş ve kirli olarak işaretlenecek; bu geceden itibaren {move.room.number} dolu sayılacak. Önceki geceler
        geçmişte {move.roomNumber} odasında kalır.
      </p>

      <div className="mt-5">
        <MoveReasonField value={reason} onChange={setReason} disabled={isPending} />
      </div>

      {error && (
        <Alert tone="danger" className="mt-5">
          {error.message}
        </Alert>
      )}
    </Modal>
  );
}
