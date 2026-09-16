import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Icon, Spinner } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { RoomPicker } from '../../components/RoomPicker.jsx';
import { api, withQuery } from '../../lib/api.js';
import { requestKeys } from '../../lib/frontOffice.js';

/**
 * Konuşmayı içerideki bir konaklamaya bağlar.
 *
 * Web chat gibi kimlik taşımayan kanallarda misafir "203'te kalıyorum" der;
 * resepsiyon odayı seçer, içerideki konaklama bulunur ve bağlanır. Bağlanınca
 * misafir kartı da konuşmaya işlenir; istekler o konaklamaya düşer.
 *
 * Konuşmada zaten bir misafir varsa başka misafirin konaklaması sunucuda
 * reddedilir (yanlış kişiye bilgi gitmesin). Henüz gelmemiş rezervasyonları
 * aramak rezervasyon modülünün (4) işi; burada yalnızca içerideki konaklama.
 *
 * @param {{
 *   conversation: { contactName: string, guest: { id: string, name: string } | null },
 *   isPending: boolean,
 *   error: Error | null,
 *   onLink: (stay: { reservationId: string, confirmationCode: string, guestName: string }, roomNumber: string) => void,
 *   onClose: () => void,
 * }} props
 */
export function LinkStayDialog({ conversation, isPending, error, onLink, onClose }) {
  const [room, setRoom] = useState(null);

  const context = useQuery({
    queryKey: requestKeys.roomContext(room?.id),
    queryFn: () => api(withQuery('/guest-requests/room-context', { roomId: room.id })),
    enabled: Boolean(room?.id),
  });
  const stay = context.data?.stay ?? null;
  const otherGuest = Boolean(stay && conversation.guest && conversation.guest.id !== stay.guestId);

  return (
    <Modal
      open
      size="sm"
      title="Konaklamaya bağla"
      onClose={isPending ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button icon="link" disabled={!stay || otherGuest || isPending} onClick={() => onLink(stay, room.number)}>
            {isPending ? 'Bağlanıyor…' : 'Bağla'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">
          <span className="font-bold text-ink">{conversation.contactName}</span> hangi odada kalıyor?
        </p>
        <RoomPicker label="Oda" value={room} onChange={setRoom} />

        {room && context.isPending && <Spinner label="Odadaki konaklama aranıyor…" className="justify-start" />}
        {context.isError && <Alert tone="danger">{context.error.message}</Alert>}

        {room && context.data && !stay && (
          <Alert tone="warning">Oda {room.number} şu an boş; bağlanacak konaklama yok.</Alert>
        )}

        {stay && (
          <div className="flex items-center gap-3 rounded-panel border border-line bg-surface-muted px-4 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-white">
              <Icon name="user" className="size-4" />
            </span>
            <span className="min-w-0 text-sm">
              <span className="block font-bold text-ink">{stay.guestName}</span>
              <span className="text-xs text-ink-muted">
                {stay.confirmationCode} · Oda {room.number}
              </span>
            </span>
          </div>
        )}

        {otherGuest && (
          <Alert tone="warning">
            Bu konuşma {conversation.guest.name} ile eşleşmiş. Başka misafirin konaklaması bağlanamaz.
          </Alert>
        )}

        {error && <Alert tone="danger">{error.message}</Alert>}
      </div>
    </Modal>
  );
}
