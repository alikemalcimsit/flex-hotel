import {
  HOUSEKEEPING_STATUS_LABELS,
  ROOM_ASSIGNMENT_KIND_LABELS,
  ROOM_BLOCK_TYPE_LABELS,
  ROOM_OCCUPANCY_LABELS,
} from '@hotelos/hotel-contracts';
import { Badge } from '@hotelos/ui';

/**
 * Oda durumunun üç bağımsız bilgisi için rozetler.
 *
 * Renkler operasyonel anlam taşır ve bilgiler arasında çakışmaz: kat şefi
 * sarıyı "kirli", kırmızıyı "arızalı" okur. Anlam hiçbir zaman yalnızca
 * renkte değil — her rozetin metni ve noktası var.
 */

/** Doluluk: boş nötr, dolu mavi. */
export const OCCUPANCY_TONES = Object.freeze({
  VACANT: 'neutral',
  OCCUPIED: 'info',
});

/** Kat hizmeti: kirli sarı → temizleniyor gök mavisi → temiz yeşil → kontrol edildi mor. */
export const HOUSEKEEPING_TONES = Object.freeze({
  DIRTY: 'warning',
  CLEANING: 'sky',
  CLEAN: 'success',
  INSPECTED: 'violet',
});

/** Arıza kaydı: arızalı (satış dışı) kırmızı, hizmet dışı nötr. */
export const BLOCK_TYPE_TONES = Object.freeze({
  OUT_OF_ORDER: 'danger',
  OUT_OF_SERVICE: 'neutral',
});

/** Atanan odanın sınıfı: aynı tipte rozet yok, alt sınıf dikkat çeker. */
const ASSIGNMENT_KIND_TONES = Object.freeze({
  UPGRADE: 'violet',
  LATERAL: 'neutral',
  DOWNGRADE: 'warning',
});

/** @param {{ occupancy: string }} props */
export function OccupancyBadge({ occupancy }) {
  return <Badge tone={OCCUPANCY_TONES[occupancy] ?? 'neutral'}>{ROOM_OCCUPANCY_LABELS[occupancy] ?? occupancy}</Badge>;
}

/** @param {{ status: string }} props */
export function HousekeepingBadge({ status }) {
  return <Badge tone={HOUSEKEEPING_TONES[status] ?? 'neutral'}>{HOUSEKEEPING_STATUS_LABELS[status] ?? status}</Badge>;
}

/** @param {{ type: string }} props */
export function BlockTypeBadge({ type }) {
  return <Badge tone={BLOCK_TYPE_TONES[type] ?? 'neutral'}>{ROOM_BLOCK_TYPE_LABELS[type] ?? type}</Badge>;
}

/** @param {{ kind: string }} props */
export function AssignmentKindBadge({ kind }) {
  if (kind === 'SAME' || !ASSIGNMENT_KIND_TONES[kind]) return null;
  return (
    <Badge tone={ASSIGNMENT_KIND_TONES[kind]} dot={false}>
      {ROOM_ASSIGNMENT_KIND_LABELS[kind]}
    </Badge>
  );
}
