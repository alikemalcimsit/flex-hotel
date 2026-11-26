import { useState } from 'react';
import { Alert, Button } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { useT } from '../../i18n/index.jsx';
import { MoveReasonField } from './MoveReasonField.jsx';
import { richText } from './planText.jsx';

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
  const t = useT();
  const [reason, setReason] = useState('');

  return (
    <Modal
      open
      size="sm"
      title={t('roomPlan.moveConfirm.title')}
      onClose={isPending ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {t('common.cancel')}
          </Button>
          <Button icon="key" onClick={() => onConfirm(reason.trim())} disabled={isPending}>
            {isPending ? t('roomPlan.moveConfirm.moving') : t('roomPlan.moveConfirm.move')}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-soft">
        {richText(t('roomPlan.moveConfirm.body', { from: move.roomNumber, to: move.room.number }), {
          guest: <strong className="text-ink">{move.guestName ?? t('roomPlan.shared.guest')}</strong>,
          toRoom: <strong className="text-ink">{move.room.number}</strong>,
        })}
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
