import { useQuery } from '@tanstack/react-query';
import { api, withQuery } from '../../lib/api.js';

/**
 * Oda tipleri — form ve filtre açılır listeleri için.
 *
 * Ayarlar modülünün API'sinden okunuyor: oda tipi tanımının sahibi orası,
 * burada ikinci bir kaynak oluşturmuyoruz. Nadiren değiştiği için uzun süre
 * taze sayılıyor.
 */
export function useRoomTypes() {
  const query = useQuery({
    queryKey: ['settings', 'room-types', 'all'],
    queryFn: () => api(withQuery('/settings/room-types', { pageSize: 200 })),
    staleTime: 5 * 60_000,
  });

  return {
    roomTypes: query.data?.items ?? [],
    isPending: query.isPending,
    error: query.error,
    options: (query.data?.items ?? []).map((type) => ({
      value: type.id,
      label: `${type.code} — ${type.name}`,
    })),
  };
}
