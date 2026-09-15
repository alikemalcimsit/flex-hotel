import { ROOM_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge } from '@hotelos/ui';

/**
 * Oda durumu rozeti.
 *
 * Renkler operasyonel anlam taşır: yeşil satılabilir, mavi misafir içeride,
 * sarı temizlik bekliyor, kırmızı arızalı. Kat planına bakan kat şefi rengi
 * okur, metni değil.
 */
export const ROOM_STATUS_TONES = Object.freeze({
  AVAILABLE: 'success',
  OCCUPIED: 'info',
  DIRTY: 'warning',
  CLEANING: 'sky',
  BLOCKED: 'neutral',
  MAINTENANCE: 'danger',
});

/**
 * @param {{ status: string, className?: string }} props
 */
export function RoomStatusBadge({ status, className = '' }) {
  return (
    <Badge tone={ROOM_STATUS_TONES[status] ?? ROOM_STATUS_TONES.BLOCKED} className={className}>
      {ROOM_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
