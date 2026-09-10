import { ROOM_STATUS_LABELS } from '@hotelos/hotel-contracts';

/**
 * Oda durumu rozeti.
 *
 * Renkler operasyonel anlam taşır: yeşil satılabilir, mavi misafir içeride,
 * sarı temizlik bekliyor, kırmızı arızalı. Kat planına bakan kat şefi rengi
 * okur, metni değil.
 */
const TONES = {
  AVAILABLE: 'bg-green-100 text-green-800 ring-green-600/20',
  OCCUPIED: 'bg-blue-100 text-blue-800 ring-blue-600/20',
  DIRTY: 'bg-amber-100 text-amber-900 ring-amber-600/20',
  CLEANING: 'bg-sky-100 text-sky-800 ring-sky-600/20',
  BLOCKED: 'bg-gray-200 text-gray-700 ring-gray-500/20',
  MAINTENANCE: 'bg-red-100 text-red-800 ring-red-600/20',
};

/**
 * @param {{ status: string, className?: string }} props
 */
export function RoomStatusBadge({ status, className = '' }) {
  const tone = TONES[status] ?? TONES.BLOCKED;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone} ${className}`}
    >
      {ROOM_STATUS_LABELS[status] ?? status}
    </span>
  );
}
