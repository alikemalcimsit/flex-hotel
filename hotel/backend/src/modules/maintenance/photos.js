import { randomUUID } from 'node:crypto';
import { currentActor, runWithContext } from '@hotelos/core';
import { MAINTENANCE_MAX_PHOTOS, MAINTENANCE_PHOTO_PURGE_DAYS } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { openFile, removeFiles, saveFile } from '../../lib/file-storage.js';
import { writeWithEvents } from '../../lib/write.js';
import { decodePhoto, photoKeys } from './rules.js';

/**
 * Arıza bileti fotoğrafları (modül 20; modül 21 ile aynı desen). Tarayıcı
 * küçültür, sunucu türü imzadan doğrular; dosyalar diskte, kayıt veritabanında.
 */

const PURGE_BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {string} hotelId @param {string} ticketId
 * @param {{ contentType: string, image: string, thumbnail: string }} input
 */
export async function addPhoto(hotelId, ticketId, input) {
  const decoded = decodePhoto(input);
  if ('error' in decoded) throw new ValidationError(decoded.error, { field: 'image' });

  const id = randomUUID();
  const keys = photoKeys({ id, hotelId, contentType: decoded.contentType });
  await saveFile(keys.full, decoded.image);
  await saveFile(keys.thumb, decoded.thumbnail);
  try {
    const actor = currentActor();
    return await writeWithEvents(async (tx) => {
      const ticket = await tx.maintenanceTicket.findFirst({ where: { id: ticketId, hotelId, deletedAt: null }, select: { id: true, status: true } });
      if (!ticket) throw new NotFoundError('Arıza bileti bulunamadı');
      const count = await tx.maintenancePhoto.count({ where: { ticketId, deletedAt: null } });
      if (count >= MAINTENANCE_MAX_PHOTOS) throw new ConflictError(`Bir bilete en fazla ${MAINTENANCE_MAX_PHOTOS} fotoğraf eklenir; önce birini silin.`, 'PHOTO_LIMIT');
      const created = await tx.maintenancePhoto.create({
        data: { id, hotelId, ticketId, contentType: decoded.contentType, sizeBytes: decoded.image.length, thumbBytes: decoded.thumbnail.length, createdBy: actor },
        select: { id: true, contentType: true, sizeBytes: true, createdAt: true },
      });
      await recordAudit(tx, { hotelId, entity: 'MaintenanceTicket', entityId: ticketId, action: 'UPDATE', after: { photoAdded: id } });
      return { id: created.id, contentType: created.contentType, sizeBytes: created.sizeBytes, createdAt: created.createdAt.toISOString() };
    });
  } catch (error) {
    await removeFiles([keys.full, keys.thumb]);
    throw error;
  }
}

/**
 * @param {string} hotelId @param {string} ticketId @param {string} photoId @param {'full' | 'thumb'} size
 */
export async function openPhoto(hotelId, ticketId, photoId, size) {
  const photo = await prisma.maintenancePhoto.findFirst({ where: { id: photoId, ticketId, hotelId, deletedAt: null }, select: { id: true, hotelId: true, contentType: true } });
  if (!photo) throw new NotFoundError('Fotoğraf bulunamadı');
  const file = await openFile(photoKeys(photo)[size]);
  if (!file) throw new NotFoundError('Fotoğraf dosyası bulunamadı');
  return { ...file, contentType: photo.contentType };
}

/** @param {string} hotelId @param {string} ticketId @param {string} photoId */
export async function removePhoto(hotelId, ticketId, photoId, logger) {
  const keys = await writeWithEvents(async (tx) => {
    const row = await tx.maintenancePhoto.findFirst({ where: { id: photoId, ticketId, hotelId, deletedAt: null }, select: { id: true, hotelId: true, contentType: true } });
    if (!row) throw new NotFoundError('Fotoğraf bulunamadı');
    await tx.maintenancePhoto.update({ where: { id: photoId }, data: { deletedAt: new Date() } });
    await recordAudit(tx, { hotelId, entity: 'MaintenanceTicket', entityId: ticketId, action: 'UPDATE', after: { photoRemoved: photoId } });
    return photoKeys(row);
  });
  const failed = await removeFiles([keys.full, keys.thumb]);
  if (failed.length) logger?.warn?.({ failed }, 'Arıza fotoğrafı dosyası silinemedi (yetim)');
  return { id: photoId };
}

/**
 * Çözülmüş / iptal edilmiş biletlerin fotoğraflarını süre dolunca siler.
 * @param {{ warn: Function }} logger @param {Date} [now]
 * @returns {Promise<number>} silinen fotoğraf sayısı
 */
export async function purgeResolvedTicketPhotos(logger, now = new Date()) {
  const cut = new Date(now.getTime() - MAINTENANCE_PHOTO_PURGE_DAYS * DAY_MS);
  let purged = 0;
  for (;;) {
    const photos = await prisma.maintenancePhoto.findMany({
      where: { deletedAt: null, ticket: { status: { in: ['DONE', 'CANCELLED'] }, resolvedAt: { lt: cut } } },
      select: { id: true, hotelId: true, contentType: true },
      take: PURGE_BATCH,
    });
    if (photos.length === 0) return purged;
    await runWithContext({ actor: 'sistem:teknik-servis' }, () =>
      writeWithEvents(async (tx) => {
        await tx.maintenancePhoto.updateMany({ where: { id: { in: photos.map((p) => p.id) } }, data: { deletedAt: now } });
      }),
    );
    const failed = await removeFiles(photos.flatMap((p) => { const k = photoKeys(p); return [k.full, k.thumb]; }));
    if (failed.length) logger?.warn?.({ count: failed.length }, 'Arıza fotoğrafı dosyaları silinemedi');
    purged += photos.length;
  }
}
