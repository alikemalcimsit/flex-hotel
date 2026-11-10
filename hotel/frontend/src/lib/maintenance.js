import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MAINTENANCE_CATEGORY_LABELS,
  MAINTENANCE_PHOTO_MAX_BYTES,
  MAINTENANCE_STATUS_LABELS,
  MAINTENANCE_STATUS_TONES,
  MAINTENANCE_THUMB_MAX_BYTES,
} from '@hotelos/hotel-contracts';
import { api, apiDelete, apiPatch, apiPost, withQuery } from './api.js';
import { toastError } from '../store/toast.js';

/**
 * Teknik servis / arıza-bakım (modül 20): sorgu anahtarları, React Query
 * kancaları, etiketler ve tarayıcıda fotoğraf hazırlama. Canlı kanal yok —
 * işlemden sonra `['maintenance']` ağacı elle tazelenir.
 */

export const maintenanceKeys = Object.freeze({
  all: ['maintenance'],
  tickets: (filters) => ['maintenance', 'tickets', filters],
  ticket: (id) => ['maintenance', 'ticket', id],
  plans: (filters) => ['maintenance', 'plans', filters],
});

export const categoryLabel = (value) => MAINTENANCE_CATEGORY_LABELS[value] ?? value;
export const statusLabel = (value) => MAINTENANCE_STATUS_LABELS[value] ?? value;
export const statusTone = (value) => MAINTENANCE_STATUS_TONES[value] ?? 'neutral';

export const PRIORITY_OPTIONS = Object.freeze([
  { value: 1, label: '1 — Acil' },
  { value: 2, label: '2 — Yüksek' },
  { value: 3, label: '3 — Normal' },
  { value: 4, label: '4 — Düşük' },
  { value: 5, label: '5 — En düşük' },
]);
export const priorityLabel = (value) => PRIORITY_OPTIONS.find((o) => o.value === Number(value))?.label ?? String(value);

/** Biletin ekran yolu (personel uyarısı da buraya bağlanır). */
export const ticketPath = (id) => `/teknik-servis/${id}`;
/** Yetki isteyen fotoğrafın API yolu. */
export const photoPath = (ticketId, photoId, size = 'full') => `/maintenance/tickets/${ticketId}/photos/${photoId}?size=${size}`;
/** Konum metni: "Oda 203" ya da yazılı yer. */
export const placeText = (t) => (t.roomNumber ? `Oda ${t.roomNumber}` : t.locationText ?? '—');

/* ─────────────── Sorgular ─────────────── */

export function useTickets(filters) {
  return useQuery({ queryKey: maintenanceKeys.tickets(filters), queryFn: () => api(withQuery('/maintenance/tickets', filters)) });
}

export function useTicket(id) {
  return useQuery({ queryKey: maintenanceKeys.ticket(id), queryFn: () => api(`/maintenance/tickets/${id}`), enabled: Boolean(id) });
}

export function usePlans(filters) {
  return useQuery({ queryKey: maintenanceKeys.plans(filters), queryFn: () => api(withQuery('/maintenance/plans', filters)) });
}

/** Oda seçici için basit oda listesi (numarasıyla). */
export function useRoomOptions() {
  return useQuery({
    queryKey: ['rooms', 'options'],
    queryFn: async () => {
      const data = await api(withQuery('/rooms', { pageSize: 500 }));
      const rows = Array.isArray(data) ? data : data.items ?? [];
      return rows.map((r) => ({ value: r.id, label: `Oda ${r.number}` }));
    },
    staleTime: 60_000,
  });
}

/* ─────────────── İşlemler ─────────────── */

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: maintenanceKeys.all });
}

export function useCreateTicket() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (body) => apiPost('/maintenance/tickets', body), onSuccess: invalidate });
}

export function useTicketAction(id) {
  const invalidate = useInvalidate();
  const run = (fn) => ({ mutationFn: fn, onSuccess: invalidate, onError: (e) => toastError(e) });
  return {
    update: useMutation(run((body) => apiPatch(`/maintenance/tickets/${id}`, body))),
    assign: useMutation(run((body) => apiPost(`/maintenance/tickets/${id}/assign`, body))),
    start: useMutation(run(() => apiPost(`/maintenance/tickets/${id}/start`, {}))),
    resolve: useMutation(run((body) => apiPost(`/maintenance/tickets/${id}/resolve`, body))),
    cancel: useMutation(run((body) => apiPost(`/maintenance/tickets/${id}/cancel`, body))),
    addPhoto: useMutation(run((body) => apiPost(`/maintenance/tickets/${id}/photos`, body))),
    removePhoto: useMutation(run((photoId) => apiDelete(`/maintenance/tickets/${id}/photos/${photoId}`))),
  };
}

export function usePlanActions() {
  const invalidate = useInvalidate();
  const run = (fn) => ({ mutationFn: fn, onSuccess: invalidate, onError: (e) => toastError(e) });
  return {
    create: useMutation(run((body) => apiPost('/maintenance/plans', body))),
    update: useMutation(run(({ id, body }) => apiPatch(`/maintenance/plans/${id}`, body))),
    remove: useMutation(run((id) => apiDelete(`/maintenance/plans/${id}`))),
  };
}

/* ─────────────── Fotoğraf hazırlama (tarayıcıda) ─────────────── */

const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const PHOTO_MAX_EDGE = 1600;
const THUMB_MAX_EDGE = 320;
const JPEG_QUALITY_STEPS = Object.freeze([0.82, 0.72, 0.62, 0.52]);
const THUMB_QUALITY = 0.7;
const SHRINK_FACTOR = 0.8;

async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* <img> ile denenir */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(source, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Fotoğraf işlenemedi'))), 'image/jpeg', quality);
  });
}

async function encodeWithin(source, maxEdge, maxBytes, qualities) {
  for (let edge = maxEdge; edge >= 180; edge = Math.round(edge * SHRINK_FACTOR)) {
    for (const quality of qualities) {
      const blob = await encode(source, edge, quality);
      if (blob.size <= maxBytes) return blob;
    }
  }
  throw new Error('Fotoğraf yeterince küçültülemedi');
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('Fotoğraf okunamadı'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Çekilen / seçilen fotoğrafı yüklemeye hazırlar (küçültme + JPEG + önizleme).
 * @param {File} file
 * @returns {Promise<{ contentType: 'image/jpeg', image: string, thumbnail: string }>}
 */
export async function preparePhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Seçilen dosya bir fotoğraf değil');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Fotoğraf dosyası çok büyük');
  let source;
  try {
    source = await loadImage(file);
  } catch {
    throw new Error('Bu fotoğraf biçimi açılamadı; JPEG ya da PNG deneyin');
  }
  try {
    const [image, thumbnail] = await Promise.all([
      encodeWithin(source, PHOTO_MAX_EDGE, MAINTENANCE_PHOTO_MAX_BYTES, JPEG_QUALITY_STEPS),
      encodeWithin(source, THUMB_MAX_EDGE, MAINTENANCE_THUMB_MAX_BYTES, [THUMB_QUALITY]),
    ]);
    return { contentType: 'image/jpeg', image: await toBase64(image), thumbnail: await toBase64(thumbnail) };
  } finally {
    source.close?.();
  }
}
