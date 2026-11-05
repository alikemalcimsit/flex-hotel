import { randomUUID } from 'node:crypto';
import { toIsoDay } from '@hotelos/core';
import {
  ONLINE_CHECKIN_MAX_UPLOADS,
  ONLINE_CHECKIN_ORPHAN_PHOTO_HOURS,
  ONLINE_CHECKIN_PHOTO_MAX_BYTES,
  ONLINE_CHECKIN_SIGNATURE_MAX_BYTES,
  ONLINE_CHECKIN_THUMB_MAX_BYTES,
  onlineCheckinWindow,
} from '@hotelos/hotel-contracts';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { openFile, removeFiles, saveFile } from '../../lib/file-storage.js';
import { sqlTimestamp } from '../../lib/sql-time.js';
import { writeWithEvents } from '../../lib/write.js';
import { sniffImageType } from '../lost-items/rules.js';
import { resolvePortalToken, touchPortalLink } from './links.js';
import { prisma } from './shared.js';

/**
 * Online check-in belgeleri (modül 53): kimlik / pasaport fotoğrafları ve imza.
 *
 * - Tarayıcı fotoğrafı küçültür (EXIF / konum bu sırada düşer), önizlemeyi üretir; sunucu türü dosyanın imzasından,
 *   boyutu sınırdan doğrular. Dosyalar sunucu diskinde (`lib/file-storage.js`), yalnız yetki denetleyen personel
 *   route'u okur. **Misafire geri gösterilmez**: bağlantı ele geçse de kimlik fotoğrafı sızmasın; misafir yalnız
 *   kaç fotoğraf yüklediğini görür.
 * - Yükleme gönderimden önce, kişi başına ayrı istekle; gönderim fotoğrafları kimlikleriyle kişilere bağlar.
 *   Bağlanmayan fotoğraf 48 saat sonra, bağlanan otelin saklama süresi sonunda silinir (dosya gider, satır
 *   "silindi" olarak kalır: kimin belgesi ne zaman silindi izi).
 */

/** Silme işinin bir turda ele aldığı en fazla belge (uzun işlem tutmamak için). */
const PURGE_BATCH = 200;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const EXTENSIONS = Object.freeze({ 'image/jpeg': 'jpg', 'image/webp': 'webp' });

/** @param {{ id: string, hotelId: string, contentType: string }} doc */
export function documentKeys(doc) {
  const extension = EXTENSIONS[doc.contentType];
  if (!extension) throw new Error(`Bilinmeyen fotoğraf türü: ${doc.contentType}`);
  const base = `online-checkin/${doc.hotelId}/${doc.id}`;
  return { full: `${base}.${extension}`, thumb: `${base}.thumb.${extension}` };
}

/**
 * İmzanın disk anahtarı; her gönderimde yeni (sürüm + rastgele ek: aynı anda iki sekmeden gelen gönderimler aynı dosyaya
 * yazmasın, kaybedenin temizliği kazananın imzasını silmesin). Yeni imza önce yazılır, kayıt başarılı olunca eskisi silinir.
 * @param {string} hotelId @param {string} onlineCheckinId @param {string | number} tag küçük harf / rakam
 */
export const signatureKey = (hotelId, onlineCheckinId, tag) => `online-checkin/${hotelId}/${onlineCheckinId}.${tag}.signature.png`;

/**
 * @param {string} text @param {string} label @param {number} maxBytes
 * @returns {Buffer}
 */
function decode(text, label, maxBytes) {
  if (!BASE64.test(text)) throw new ValidationError(`${label} okunamadı (bozuk veri)`, { field: 'image' });
  const buffer = Buffer.from(text, 'base64');
  if (buffer.length === 0) throw new ValidationError(`${label} boş`, { field: 'image' });
  if (buffer.length > maxBytes) throw new ValidationError(`${label} çok büyük`, { field: 'image' });
  return buffer;
}

/**
 * Fotoğrafı ve önizlemesini çözüp doğrular.
 * @param {{ contentType: string, image: string, thumbnail: string }} input
 */
export function decodeDocumentPhoto(input) {
  const image = decode(input.image, 'Fotoğraf', ONLINE_CHECKIN_PHOTO_MAX_BYTES);
  const thumbnail = decode(input.thumbnail, 'Önizleme', ONLINE_CHECKIN_THUMB_MAX_BYTES);
  for (const buffer of [image, thumbnail]) {
    if (sniffImageType(buffer) !== input.contentType) throw new ValidationError('Fotoğraf JPEG ya da WebP değil ya da türü bildirilenle uyuşmuyor', { field: 'image' });
  }
  return { image, thumbnail, contentType: input.contentType };
}

/**
 * İmza: PNG (imzasından doğrulanır).
 * @param {{ image: string }} input
 */
export function decodeSignature(input) {
  const buffer = decode(input.image, 'İmza', ONLINE_CHECKIN_SIGNATURE_MAX_BYTES);
  const png = buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!png) throw new ValidationError('İmza okunamadı', { field: 'signature' });
  return buffer;
}

/**
 * Misafir belge fotoğrafı yükler (online check-in açıkken; rezervasyon başına üst sınır). Dosya önce yazılır, sonra
 * satır; satır yazılamazsa dosyalar silinir.
 *
 * @param {string} token @param {{ contentType: string, image: string, thumbnail: string }} input
 * @returns {Promise<{ id: string }>}
 */
export async function uploadDocumentPhoto(token, input) {
  const { link, reservation, settings, today } = await resolvePortalToken(prisma, token);
  const submission = await prisma.onlineCheckin.findUnique({ where: { reservationId: reservation.id }, select: { status: true } });
  const window = onlineCheckinWindow(
    { status: reservation.status, checkIn: toIsoDay(reservation.checkIn), checkOut: toIsoDay(reservation.checkOut) },
    { today, openDays: settings.checkinOpenDays, submission, enabled: settings.enabled },
  );
  if (!window.open) throw new ConflictError('Online check-in şu an açık değil.', `CHECKIN_${window.reason}`);
  const decoded = decodeDocumentPhoto(input);

  const id = randomUUID();
  const keys = documentKeys({ id, hotelId: link.hotelId, contentType: decoded.contentType });
  await saveFile(keys.full, decoded.image);
  await saveFile(keys.thumb, decoded.thumbnail);
  try {
    await writeWithEvents(async (tx) => {
      const count = await tx.onlineCheckinDocument.count({ where: { reservationId: reservation.id } });
      if (count >= ONLINE_CHECKIN_MAX_UPLOADS) throw new ConflictError('Bu rezervasyona çok fazla fotoğraf yüklendi; lütfen resepsiyonla görüşün.', 'UPLOAD_LIMIT');
      await tx.onlineCheckinDocument.create({
        data: { id, hotelId: link.hotelId, reservationId: reservation.id, contentType: decoded.contentType, sizeBytes: decoded.image.length, thumbBytes: decoded.thumbnail.length },
      });
    });
  } catch (error) {
    await removeFiles([keys.full, keys.thumb]);
    throw error;
  }
  await touchPortalLink(link);
  return { id };
}

/* ══════════════════ Personel ══════════════════ */

/**
 * Belge fotoğrafının akışı (personel; online check-in'in belgesi olmalı, silinmemiş).
 * @param {string} hotelId @param {string} onlineCheckinId @param {string} documentId @param {{ thumb?: boolean }} [options]
 */
export async function openDocument(hotelId, onlineCheckinId, documentId, { thumb = false } = {}) {
  const doc = await prisma.onlineCheckinDocument.findFirst({ where: { id: documentId, hotelId, onlineCheckinId }, select: { id: true, hotelId: true, contentType: true, purgedAt: true } });
  if (!doc) throw new NotFoundError('Belge bulunamadı');
  if (doc.purgedAt) throw new ConflictError('Belge saklama süresi dolduğu için silindi.', 'DOCUMENT_PURGED');
  const keys = documentKeys(doc);
  const file = await openFile(thumb ? keys.thumb : keys.full);
  if (!file) throw new NotFoundError('Belge dosyası bulunamadı');
  return { ...file, contentType: doc.contentType };
}

/** İmzanın akışı. @param {string} hotelId @param {string} onlineCheckinId */
export async function openSignature(hotelId, onlineCheckinId) {
  const row = await prisma.onlineCheckin.findFirst({ where: { id: onlineCheckinId, hotelId }, select: { signatureKey: true } });
  if (!row) throw new NotFoundError('Online check-in bulunamadı');
  const file = await openFile(row.signatureKey);
  if (!file) throw new NotFoundError('İmza dosyası bulunamadı');
  return { ...file, contentType: 'image/png' };
}

/* ══════════════════ Saklama süresi ══════════════════ */

/**
 * Süresi dolan belge fotoğraflarını siler (bir tur):
 * - gönderime bağlanmamış, yükleneli 48 saati geçmiş;
 * - bağlı: çıkış yapılmış ve çıkıştan `documentRetentionDays` gün geçmiş; iptal / gelmedi rezervasyonda girişten
 *   bu kadar gün geçmiş; kapatılmamış (gelmedi işaretlenmemiş) rezervasyonda çıkış gününden bu kadar gün geçmiş.
 *   Ayarı olmayan otelde varsayılan süre.
 * Önce satırlar "silindi" işaretlenir (işlem), sonra dosyalar silinir; dosya silinemezse yetim dosya log'a düşer.
 * Bütün belgeleri silinen online check-in'e silinme anı yazılır ve kayıttaki kimlik numarası ile doğum tarihi kopyası
 * da temizlenir (giriş yapıldıysa misafir kartında; gelmeyende hiç gerekmez). Adlar, belge türü, uyruk ve imza kalır.
 *
 * @param {Date} [now] @param {{ warn?: Function }} [logger]
 * @returns {Promise<{ purged: number }>}
 */
export async function purgeExpiredDocuments(now = new Date(), logger = console) {
  const orphanBefore = new Date(now.getTime() - ONLINE_CHECKIN_ORPHAN_PHOTO_HOURS * 3_600_000);
  const rows = /** @type {Array<{ id: string, hotelId: string, contentType: string, onlineCheckinId: string | null, reservationId: string }>} */ (
    await prisma.$queryRaw`
      SELECT d."id", d."hotelId", d."contentType", d."onlineCheckinId", d."reservationId"
      FROM "OnlineCheckinDocument" d
      JOIN "Reservation" r ON r."id" = d."reservationId"
      LEFT JOIN "GuestPortalSettings" s ON s."hotelId" = d."hotelId"
      WHERE d."purgedAt" IS NULL AND (
        (d."onlineCheckinId" IS NULL AND d."createdAt" < ${sqlTimestamp(orphanBefore)})
        OR (r."status" = 'CHECKED_OUT' AND r."checkOut" < ${sqlTimestamp(now)} - make_interval(days => COALESCE(s."documentRetentionDays", 7)))
        OR (r."status" IN ('CANCELLED', 'NO_SHOW') AND r."checkIn" < ${sqlTimestamp(now)} - make_interval(days => COALESCE(s."documentRetentionDays", 7)))
        OR (r."status" IN ('PENDING', 'CONFIRMED') AND r."checkOut" < ${sqlTimestamp(now)} - make_interval(days => COALESCE(s."documentRetentionDays", 7)))
      )
      ORDER BY d."createdAt"
      LIMIT ${PURGE_BATCH}`
  );
  if (rows.length === 0) return { purged: 0 };
  const checkins = [...new Set(rows.map((row) => row.onlineCheckinId).filter(Boolean))];
  await writeWithEvents(async (tx, stage) => {
    await tx.onlineCheckinDocument.updateMany({ where: { id: { in: rows.map((row) => row.id) }, purgedAt: null }, data: { purgedAt: now } });
    for (const onlineCheckinId of checkins) {
      const left = await tx.onlineCheckinDocument.count({ where: { onlineCheckinId, purgedAt: null } });
      if (left > 0) continue;
      const current = await tx.onlineCheckin.findUnique({ where: { id: onlineCheckinId }, select: { guest: true, companions: true } });
      const scrub = (person) => (person ? { ...person, idNumber: null, birthDate: null } : person);
      const checkin = await tx.onlineCheckin.update({
        where: { id: onlineCheckinId },
        data: { documentsPurgedAt: now, guest: scrub(current.guest), companions: (current.companions ?? []).map(scrub) },
        select: { id: true, hotelId: true, reservationId: true, status: true },
      });
      await stage('online_checkin.changed', { hotelId: checkin.hotelId, onlineCheckinId, reservationId: checkin.reservationId, status: checkin.status, change: 'DOCUMENTS_PURGED' });
    }
  });
  const failed = await removeFiles(rows.flatMap((row) => Object.values(documentKeys(row))));
  if (failed.length) logger.warn?.({ failed: failed.length }, 'Online check-in belgelerinin bir kısmı diskten silinemedi');
  return { purged: rows.length };
}

/**
 * Yeniden gönderimde artık kullanılmayan (önceki gönderimin) fotoğraflarını hemen siler. Satırlar çağıranın işleminde
 * işaretlenir; dosyalar commit'ten sonra `removeFiles` ile.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} onlineCheckinId @param {string[]} keepIds @param {Date} now
 * @returns {Promise<string[]>} silinecek dosya anahtarları
 */
export async function detachReplacedDocuments(tx, onlineCheckinId, keepIds, now) {
  const stale = await tx.onlineCheckinDocument.findMany({ where: { onlineCheckinId, purgedAt: null, id: { notIn: keepIds } }, select: { id: true, hotelId: true, contentType: true } });
  if (!stale.length) return [];
  await tx.onlineCheckinDocument.updateMany({ where: { id: { in: stale.map((row) => row.id) } }, data: { purgedAt: now } });
  return stale.flatMap((row) => Object.values(documentKeys(row)));
}
