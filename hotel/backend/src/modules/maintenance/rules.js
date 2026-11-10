import {
  MAINTENANCE_PHOTO_MAX_BYTES,
  MAINTENANCE_THUMB_MAX_BYTES,
} from '@hotelos/hotel-contracts';
import { addDays, toIsoDay } from '@hotelos/core';
import { sniffImageType } from '../lost-items/rules.js';

/**
 * Teknik servisin saf hesapları (modül 20). Veritabanı yok: birim testlenir.
 */

/**
 * Periyodik bakım planı bugün (iş günü) bilet üretmeli mi?
 * - Hiç üretilmemişse (lastRunOn boş) evet.
 * - Son üretimden `intervalDays` geçtiyse evet.
 *
 * @param {{ lastRunOn: Date | null, intervalDays: number, active: boolean }} plan
 * @param {Date} businessDate iş günü (UTC gün başı)
 * @returns {boolean}
 */
export function isPlanDue(plan, businessDate) {
  if (!plan.active) return false;
  if (!plan.lastRunOn) return true;
  const due = toIsoDay(addDays(plan.lastRunOn, plan.intervalDays));
  return toIsoDay(businessDate) >= due;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Yüklenen fotoğrafı ve önizlemesini çözüp doğrular (modül 21 ile aynı kural).
 * @param {{ contentType: string, image: string, thumbnail: string }} input
 * @returns {{ error: string } | { image: Buffer, thumbnail: Buffer, contentType: string }}
 */
export function decodePhoto(input) {
  const decoded = {};
  for (const [field, label, maxBytes] of [
    ['image', 'Fotoğraf', MAINTENANCE_PHOTO_MAX_BYTES],
    ['thumbnail', 'Önizleme', MAINTENANCE_THUMB_MAX_BYTES],
  ]) {
    const text = input[field];
    if (!BASE64.test(text)) return { error: `${label} okunamadı (bozuk veri)` };
    const buffer = Buffer.from(text, 'base64');
    if (buffer.length === 0) return { error: `${label} boş` };
    if (buffer.length > maxBytes) return { error: `${label} çok büyük (en fazla ${Math.floor(maxBytes / 1000)} KB)` };
    const type = sniffImageType(buffer);
    if (!type) return { error: `${label} JPEG ya da WebP değil` };
    if (type !== input.contentType) return { error: `${label} türü bildirilenle uyuşmuyor` };
    decoded[field] = buffer;
  }
  return { image: decoded.image, thumbnail: decoded.thumbnail, contentType: input.contentType };
}

const EXTENSIONS = Object.freeze({ 'image/jpeg': 'jpg', 'image/webp': 'webp' });

/**
 * Fotoğrafın disk anahtarları (otel başına klasör).
 * @param {{ id: string, hotelId: string, contentType: string }} photo
 */
export function photoKeys(photo) {
  const extension = EXTENSIONS[photo.contentType];
  if (!extension) throw new Error(`Bilinmeyen fotoğraf türü: ${photo.contentType}`);
  const base = `maintenance/${photo.hotelId}/${photo.id}`;
  return { full: `${base}.${extension}`, thumb: `${base}.thumb.${extension}` };
}
