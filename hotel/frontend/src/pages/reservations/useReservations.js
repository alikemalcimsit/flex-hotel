import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/** Rezervasyon sorgu anahtarları (canlı kanal ve invalidasyon tek yerden). */
export const reservationKeys = Object.freeze({
  all: ['reservations'],
  lists: ['reservations', 'list'],
  /** @param {object} filters */
  list: (filters) => ['reservations', 'list', filters],
  /** @param {string} id */
  detail: (id) => ['reservations', 'detail', id],
  roomTypes: ['reservations', 'room-types'],
  /** @param {object} params */
  quote: (params) => ['reservations', 'quote', params],
});

/** Filtreli, sayfalı rezervasyon listesi. */
export function useReservationList(filters) {
  return useQuery({
    queryKey: reservationKeys.list(filters),
    queryFn: () => api(withQuery('/reservations', filters)),
    placeholderData: keepPreviousData,
  });
}

/** Rezervasyon detayı + geçmişi. */
export function useReservationDetail(id) {
  return useQuery({
    queryKey: reservationKeys.detail(id),
    queryFn: () => api(`/reservations/${id}`),
    enabled: Boolean(id),
  });
}

/** Formun oda tipi seçici verisi. */
export function useBookableRoomTypes() {
  return useQuery({
    queryKey: reservationKeys.roomTypes,
    queryFn: () => api('/reservations/room-types'),
    staleTime: 5 * 60_000,
  });
}

/**
 * Fiyat + müsaitlik önizlemesi. Girdiler geçerliyken (tip + çıkış > giriş)
 * çalışır.
 * @param {{ roomTypeId?: string, checkIn?: string, checkOut?: string }} params
 */
export function useQuote({ roomTypeId, checkIn, checkOut }) {
  const enabled = Boolean(roomTypeId && checkIn && checkOut && checkOut > checkIn);
  return useQuery({
    queryKey: reservationKeys.quote({ roomTypeId, checkIn, checkOut }),
    queryFn: () => api(withQuery('/reservations/quote', { roomTypeId, checkIn, checkOut })),
    enabled,
  });
}

/** Misafir araması (form içi, en az 2 karakter). */
export function useGuestSearch(term) {
  const q = (term ?? '').trim();
  return useQuery({
    queryKey: ['reservations', 'guests', q],
    queryFn: () => api(withQuery('/reservations/guests', { q })),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
  });
}

/** Rezervasyon yazma işlemleri (create/group/update/cancel/no-show/waiting/promote). */
export function useReservationActions() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: reservationKeys.all });
  const onError = (error) => toastError(error.message);

  const create = useMutation({
    mutationFn: (body) => apiPost('/reservations', body),
    onSuccess: (data) => {
      toastSuccess(`Rezervasyon oluşturuldu (${data.confirmationCode})`);
      invalidate();
    },
    onError,
  });

  const createGroup = useMutation({
    mutationFn: (body) => apiPost('/reservations/group', body),
    onSuccess: (data) => {
      toastSuccess(`Grup oluşturuldu (${data.reservations.length} oda)`);
      invalidate();
    },
    onError,
  });

  const update = useMutation({
    mutationFn: ({ id, body }) => apiPut(`/reservations/${id}`, body),
    onSuccess: () => {
      toastSuccess('Rezervasyon güncellendi');
      invalidate();
    },
    onError,
  });

  const cancel = useMutation({
    mutationFn: ({ id, reason }) => apiPost(`/reservations/${id}/cancel`, { reason: reason || null }),
    onSuccess: () => {
      toastSuccess('Rezervasyon iptal edildi');
      invalidate();
    },
    onError,
  });

  const noShow = useMutation({
    mutationFn: (id) => apiPost(`/reservations/${id}/no-show`, {}),
    onSuccess: () => {
      toastSuccess('Gelmedi olarak işaretlendi');
      invalidate();
    },
    onError,
  });

  const addWaiting = useMutation({
    mutationFn: (body) => apiPost('/reservations/waiting', body),
    onSuccess: () => {
      toastSuccess('Bekleyen listeye eklendi');
      invalidate();
    },
    onError,
  });

  const promote = useMutation({
    mutationFn: (id) => apiPost(`/reservations/waiting/${id}/promote`, {}),
    onSuccess: () => {
      toastSuccess('Bekleyen onaylandı');
      invalidate();
    },
    onError,
  });

  return { create, createGroup, update, cancel, noShow, addWaiting, promote, invalidate };
}
