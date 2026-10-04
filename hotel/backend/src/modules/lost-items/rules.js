import {
  LOST_ITEM_MATCH_CANDIDATE_LIMIT,
  LOST_ITEM_MATCH_LOOKBACK_DAYS,
  LOST_ITEM_PHOTO_MAX_BYTES,
  LOST_ITEM_THUMB_MAX_BYTES,
} from '@hotelos/hotel-contracts';

/**
 * Kayıp eşyanın saf kuralları (modül 21): veritabanı bilmez, birim testli.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Eşyanın bulunduğu odada kim vardı? Konaklamaların bu odadaki aralıklarından
 * adaylar:
 *
 * - `IN_ROOM`: eşya bulunduğunda odada kalıyordu (henüz çıkmamış ya da çıkışı
 *   bulunmadan sonra).
 * - `DEPARTED`: eşya bulunmadan önce odadan ayrıldı (çıkış ya da oda değişimi),
 *   en fazla `lookbackDays` gün önce. Ayrılış ne kadar yakınsa o kadar üstte:
 *   temizlikte bulunan eşya genelde son çıkanındır.
 *
 * Odaya eşya bulunduktan **sonra** gelen konaklama aday değildir. Aynı
 * konaklama odada iki kez kaldıysa (gidip geri döndü) en yakın aralığı sayılır.
 *
 * @param {Array<{ reservationId: string, from: Date, to: Date | null }>} stays
 *   `to: null` → hâlâ bu odada
 * @param {Date} foundAt
 * @param {{ lookbackDays?: number, limit?: number }} [options]
 * @returns {Array<{ reservationId: string, relation: 'IN_ROOM' | 'DEPARTED', leftAt: Date | null, gapMs: number }>}
 */
export function rankCandidates(stays, foundAt, { lookbackDays = LOST_ITEM_MATCH_LOOKBACK_DAYS, limit = LOST_ITEM_MATCH_CANDIDATE_LIMIT } = {}) {
  const found = foundAt.getTime();
  const horizon = lookbackDays * DAY_MS;
  /** @type {Map<string, { reservationId: string, relation: 'IN_ROOM' | 'DEPARTED', leftAt: Date | null, gapMs: number }>} */
  const best = new Map();

  for (const stay of stays) {
    if (stay.from.getTime() > found) continue;
    const left = stay.to ? stay.to.getTime() : null;
    const candidate =
      left === null || left >= found
        ? { reservationId: stay.reservationId, relation: /** @type {const} */ ('IN_ROOM'), leftAt: stay.to, gapMs: 0 }
        : { reservationId: stay.reservationId, relation: /** @type {const} */ ('DEPARTED'), leftAt: stay.to, gapMs: found - left };
    if (candidate.gapMs > horizon) continue;
    const previous = best.get(stay.reservationId);
    if (!previous || candidate.gapMs < previous.gapMs) best.set(stay.reservationId, candidate);
  }

  return [...best.values()]
    .sort((a, b) => a.gapMs - b.gapMs || a.reservationId.localeCompare(b.reservationId))
    .slice(0, limit);
}

/**
 * Konaklamanın bu odadaki aralıkları: şimdiki odası (oda değişiminden sonraki
 * kısmı) ve oda değişiminde kapanan eski dilimler.
 *
 * @param {{
 *   current: Array<{ id: string, status: string, checkIn: Date, checkOut: Date, roomSince: Date | null, checkedInAt: Date | null, checkedOutAt: Date | null }>,
 *   segments: Array<{ reservationId: string, startDate: Date, endDate: Date, createdAt: Date }>,
 * }} input
 * @returns {Array<{ reservationId: string, from: Date, to: Date | null }>}
 */
export function roomIntervals({ current, segments }) {
  const intervals = current.map((stay) => ({
    reservationId: stay.id,
    // Odaya taşındıysa taşınma günü; değilse giriş anı (yoksa planlanan giriş günü).
    from: stay.roomSince ?? stay.checkedInAt ?? stay.checkIn,
    to: stay.status === 'CHECKED_IN' ? null : (stay.checkedOutAt ?? stay.checkOut),
  }));
  for (const segment of segments) {
    // Dilim taşıma anında yazılır: misafir odadan o an çıktı (gün sonu değil).
    intervals.push({ reservationId: segment.reservationId, from: segment.startDate, to: segment.createdAt });
  }
  return intervals;
}

/**
 * Dosyanın gerçek türü (imzasından): JPEG `FF D8 FF`, WebP `RIFF....WEBP`.
 * Uzantıya ya da istemcinin söylediğine güvenilmez.
 * @param {Buffer} buffer
 * @returns {'image/jpeg' | 'image/webp' | null}
 */
export function sniffImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Base64 metni (boşluksuz, standart alfabe; sondaki `=` dolgusu olabilir). */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Yüklenen fotoğrafı ve önizlemesini çözüp doğrular. Hata varsa kullanıcıya
 * gösterilecek sebep döner.
 *
 * @param {{ contentType: string, image: string, thumbnail: string }} input
 * @returns {{ error: string } | { image: Buffer, thumbnail: Buffer, contentType: 'image/jpeg' | 'image/webp' }}
 */
export function decodePhoto(input) {
  const decoded = {};
  for (const [field, label, maxBytes] of [
    ['image', 'Fotoğraf', LOST_ITEM_PHOTO_MAX_BYTES],
    ['thumbnail', 'Önizleme', LOST_ITEM_THUMB_MAX_BYTES],
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
  const base = `lost-items/${photo.hotelId}/${photo.id}`;
  return { full: `${base}.${extension}`, thumb: `${base}.thumb.${extension}` };
}
