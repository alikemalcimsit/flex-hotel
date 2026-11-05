import { PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, THUMB_MAX_BYTES, THUMB_MAX_EDGE } from './limits.js';

/**
 * Telefonla çekilen belge fotoğrafını yüklemeye hazırlar: uzun kenar sınırına küçültür, JPEG'e çevirir (konum ve
 * cihaz bilgisi — EXIF — bu sırada düşer), önizlemeyi üretir. Sunucu türü ve boyutu yeniden denetler.
 */

/** Kaynak dosyanın üst sınırı (telefon kamerası ~10 MB). */
const MAX_SOURCE_BYTES = 30_000_000;
const QUALITIES = Object.freeze([0.85, 0.75, 0.65, 0.55]);
const SHRINK = 0.8;

/** @param {File} file */
async function loadImage(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Bazı tarayıcılar seçeneği tanımıyor: <img> yolu.
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

/** @param {any} source @param {number} edge @param {number} quality @returns {Promise<Blob>} */
function encode(source, edge, quality) {
  const scale = Math.min(1, edge / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode'))), 'image/jpeg', quality));
}

/** @param {any} source @param {number} maxEdge @param {number} maxBytes */
async function encodeWithin(source, maxEdge, maxBytes) {
  for (let edge = maxEdge; edge >= 240; edge = Math.round(edge * SHRINK)) {
    for (const quality of QUALITIES) {
      const blob = await encode(source, edge, quality);
      if (blob.size <= maxBytes) return blob;
    }
  }
  throw new Error('too-large');
}

/** @param {Blob} blob @returns {Promise<string>} */
export function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('read'));
    reader.readAsDataURL(blob);
  });
}

/**
 * @param {File} file
 * @returns {Promise<{ contentType: 'image/jpeg', image: string, thumbnail: string, previewUrl: string }>}
 * @throws {Error} `not-image` | `too-large` | `unreadable`
 */
export async function preparePhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('not-image');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('too-large');
  let source;
  try {
    source = await loadImage(file);
  } catch {
    throw new Error('unreadable');
  }
  try {
    const [image, thumbnail] = await Promise.all([encodeWithin(source, PHOTO_MAX_EDGE, PHOTO_MAX_BYTES), encodeWithin(source, THUMB_MAX_EDGE, THUMB_MAX_BYTES)]);
    return { contentType: 'image/jpeg', image: await toBase64(image), thumbnail: await toBase64(thumbnail), previewUrl: URL.createObjectURL(thumbnail) };
  } finally {
    source.close?.();
  }
}
