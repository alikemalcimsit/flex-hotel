import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LOST_ITEM_CATEGORY_LABELS,
  LOST_ITEM_CONTACT_CHANNEL_LABELS,
  LOST_ITEM_DISPOSAL_LABELS,
  LOST_ITEM_PHOTO_MAX_BYTES,
  LOST_ITEM_PHOTO_MAX_EDGE,
  LOST_ITEM_RETURN_METHOD_LABELS,
  LOST_ITEM_SHIPPING_PAYER_LABELS,
  LOST_ITEM_STATUS_LABELS,
  LOST_ITEM_THUMB_MAX_BYTES,
  LOST_ITEM_THUMB_MAX_EDGE,
} from '@hotelos/hotel-contracts';
import { apiBlob } from './api.js';

/**
 * Kayıp eşya ekranlarının ortakları (modül 21).
 */

export const lostItemKeys = Object.freeze({
  all: ['lost-items'],
  list: (filters) => ['lost-items', 'list', filters],
  summary: () => ['lost-items', 'summary'],
  detail: (id) => ['lost-items', 'detail', id],
  candidates: (id) => ['lost-items', 'candidates', id],
  owners: (q) => ['lost-items', 'owners', q],
  settings: () => ['lost-items', 'settings'],
});

export const categoryLabel = (value) => LOST_ITEM_CATEGORY_LABELS[value] ?? value;
export const statusLabel = (value) => LOST_ITEM_STATUS_LABELS[value] ?? value;
export const channelLabel = (value) => LOST_ITEM_CONTACT_CHANNEL_LABELS[value] ?? value;
export const disposalLabel = (value) => LOST_ITEM_DISPOSAL_LABELS[value] ?? value;
export const returnMethodLabel = (value) => LOST_ITEM_RETURN_METHOD_LABELS[value] ?? value;
export const shippingPayerLabel = (value) => LOST_ITEM_SHIPPING_PAYER_LABELS[value] ?? value;

export const STATUS_TONES = Object.freeze({ STORED: 'info', MATCHED: 'warning', RETURNED: 'success', DISPOSED: 'neutral' });

/** Eşyanın ekran yolu. */
export const lostItemPath = (id) => `/kayip-esya/${id}`;

/** Fotoğrafın API yolu (oturumla okunur). */
export const photoPath = (itemId, photoId, size = 'full') => `/lost-items/${itemId}/photos/${photoId}?size=${size}`;

/** Bulunduğu yer: "Oda 203" ya da yazılı yer. */
export const placeText = (item) => (item.roomNumber ? `Oda ${item.roomNumber}` : item.locationText ?? '—');

/* ─────────────── Fotoğraf hazırlama (tarayıcıda) ─────────────── */

/** Telefonun ham fotoğrafı için üst sınır (bundan büyük dosya büyük ihtimalle fotoğraf değil). */
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
/** Sıkıştırma kalitesi: önce bu, sınırı aşarsa adım adım düşer. */
const JPEG_QUALITY_STEPS = Object.freeze([0.82, 0.72, 0.62, 0.52]);
const THUMB_QUALITY = 0.7;
/** Hâlâ sınırı aşan görüntü bu oranla küçültülüp yeniden denenir. */
const SHRINK_FACTOR = 0.8;

/**
 * Dosyayı çizilebilir görüntüye çevirir (telefonun döndürme bilgisi uygulanır).
 * @param {File} file
 */
async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Bazı tarayıcılar seçeneği tanımaz; <img> ile denenir.
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

/**
 * @param {CanvasImageSource & { width: number, height: number }} source
 * @param {number} maxEdge
 * @param {number} quality
 * @returns {Promise<Blob>}
 */
function encode(source, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d');
  // Saydam PNG siyaha dönmesin.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Fotoğraf işlenemedi'))), 'image/jpeg', quality);
  });
}

/**
 * Sınırı aşmayan JPEG: kalite düşürülür, yetmezse boyut küçültülür.
 * @param {any} source
 * @param {number} maxEdge
 * @param {number} maxBytes
 * @param {readonly number[]} qualities
 */
async function encodeWithin(source, maxEdge, maxBytes, qualities) {
  for (let edge = maxEdge; edge >= 200; edge = Math.round(edge * SHRINK_FACTOR)) {
    for (const quality of qualities) {
      const blob = await encode(source, edge, quality);
      if (blob.size <= maxBytes) return blob;
    }
  }
  throw new Error('Fotoğraf yeterince küçültülemedi');
}

/** @param {Blob} blob */
function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('Fotoğraf okunamadı'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Telefondan çekilen / seçilen fotoğrafı yüklemeye hazırlar: uzun kenar
 * sınırına küçültür, JPEG'e çevirir (konum ve cihaz bilgisi — EXIF — bu sırada
 * düşer) ve liste önizlemesini üretir.
 *
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
      encodeWithin(source, LOST_ITEM_PHOTO_MAX_EDGE, LOST_ITEM_PHOTO_MAX_BYTES, JPEG_QUALITY_STEPS),
      encodeWithin(source, LOST_ITEM_THUMB_MAX_EDGE, LOST_ITEM_THUMB_MAX_BYTES, [THUMB_QUALITY]),
    ]);
    return { contentType: 'image/jpeg', image: await toBase64(image), thumbnail: await toBase64(thumbnail) };
  } finally {
    source.close?.();
  }
}

/* ─────────────── Oturumla okunan görüntü ─────────────── */

/** Görüntü önbellekte kalma süresi (bellek): liste sayfaları arasında gidip gelince yeniden inmesin. */
const IMAGE_CACHE_MS = 10 * 60_000;

/**
 * Yetki isteyen görüntünün tarayıcı adresi (`blob:`). Bileşen kalkınca adres
 * bırakılır; dosyanın kendisi sorgu önbelleğinde kalır.
 *
 * @param {string | null} path API yolu; `null` → görüntü yok
 * @returns {{ url: string | null, isPending: boolean, isError: boolean }}
 */
export function useProtectedImage(path) {
  const query = useQuery({
    queryKey: ['protected-file', path],
    queryFn: ({ signal }) => apiBlob(path, { signal }),
    enabled: Boolean(path),
    staleTime: Infinity,
    gcTime: IMAGE_CACHE_MS,
    retry: 1,
  });
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!query.data) {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(query.data);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [query.data]);
  return { url, isPending: Boolean(path) && query.isPending, isError: query.isError };
}
