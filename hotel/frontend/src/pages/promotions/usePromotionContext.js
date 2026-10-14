import { useMemo } from 'react';
import { BOARD_TYPE_LABELS } from '@hotelos/hotel-contracts';
import { useHotelSettings } from '../../lib/useHotel.js';
import { useRoomTypes } from '../rooms/useRoomTypes.js';

/**
 * Promosyon ekranlarının ortak bağlamı: kuralın okunur cümlesi için oda tipi
 * adı, pansiyon adı ve otelin para birimi (bkz. `describeRule`).
 */
export function usePromotionContext() {
  const { roomTypes } = useRoomTypes();
  const hotel = useHotelSettings();
  return useMemo(() => {
    const names = new Map(roomTypes.map((type) => [type.id, type.name]));
    return {
      roomTypes,
      currency: hotel.data?.currency ?? '',
      roomTypeName: (id) => names.get(id) ?? 'Silinmiş oda tipi',
      boardLabel: (board) => BOARD_TYPE_LABELS[board]?.split(' — ')[1] ?? board,
    };
  }, [roomTypes, hotel.data?.currency]);
}
