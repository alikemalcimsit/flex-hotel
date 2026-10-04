import { randomUUID } from 'node:crypto';
import { currentActor, runWithContext } from '@hotelos/core';
import { LOST_ITEM_MAX_PHOTOS, LOST_ITEM_PHOTO_PURGE_DAYS } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { openFile, removeFiles, saveFile } from '../../lib/file-storage.js';
import { writeWithEvents } from '../../lib/write.js';
import { decodePhoto, photoKeys } from './rules.js';
import { lockedItem } from './service.js';

/**
 * Kayıp eşya fotoğrafları (modül 21).
 *
 * Tarayıcı fotoğrafı küçültür (konum / EXIF bilgisi bu sırada düşer) ve liste
 * önizlemesini üretir; sunucu türü dosyanın imzasından, boyutu sınırdan
 * doğrular. Dosyalar sunucu diskinde (`lib/file-storage.js`), kayıt
 * veritabanında; dosya yalnızca yetki denetleyen route'tan okunur.
 *
 * Sıra: önce dosyalar yazılır, sonra (eşya kilitliyken, sınır denetlenerek)
 * kayıt. Kayıt yazılamazsa dosyalar silinir; silmede önce kayıt gider, dosya
 * commit'ten sonra silinir (silinemezse yetim dosya kalır, log'a düşer —
 * görünmeyen bir dosya, görünen ama açılmayan bir fotoğraftan iyidir).
 */

/** Fotoğraf silme işinin bir turda ele aldığı en fazla eşya (uzun kilit tutmamak için). */
const PURGE_BATCH = 100;

/**
 * @param {string} hotelId
 * @param {string} itemId
 * @param {{ contentType: string, image: string, thumbnail: string }} input
 * @returns {Promise<{ id: string, contentType: string, sizeBytes: number, createdAt: string }>}
 */
export async function addPhoto(hotelId, itemId, input) {
  const decoded = decodePhoto(input);
  if ('error' in decoded) throw new ValidationError(decoded.error, { field: 'image' });

  const id = randomUUID();
  const keys = photoKeys({ id, hotelId, contentType: decoded.contentType });
  await saveFile(keys.full, decoded.image);
  await saveFile(keys.thumb, decoded.thumbnail);
  try {
    const actor = currentActor();
    const photo = await writeWithEvents(async (tx, stage) => {
      const item = await lockedItem(tx, hotelId, itemId, null, 'PHOTO');
      const count = await tx.lostItemPhoto.count({ where: { itemId } });
      if (count >= LOST_ITEM_MAX_PHOTOS) {
        throw new ConflictError(`Bir eşyaya en fazla ${LOST_ITEM_MAX_PHOTOS} fotoğraf eklenir; önce birini silin.`, 'PHOTO_LIMIT');
      }
      const created = await tx.lostItemPhoto.create({
        data: {
          id,
          hotelId,
          itemId,
          contentType: decoded.contentType,
          sizeBytes: decoded.image.length,
          thumbBytes: decoded.thumbnail.length,
          createdBy: actor,
        },
        select: { id: true, contentType: true, sizeBytes: true, createdBy: true, createdAt: true },
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'LostItem',
        entityId: itemId,
        action: 'UPDATE',
        before: { photos: count },
        after: { photos: count + 1, photoAdded: id },
      });
      await stage('lost_item.changed', { hotelId, itemId, status: item.status, change: 'PHOTO_ADDED', guestId: item.guestId });
      return created;
    });
    return { ...photo, createdAt: photo.createdAt.toISOString() };
  } catch (error) {
    await removeFiles([keys.full, keys.thumb]);
    throw error;
  }
}

/**
 * Açık eşyanın fotoğrafını siler (yanlış çekilen).
 * @param {string} hotelId
 * @param {string} itemId
 * @param {string} photoId
 * @param {{ warn: Function }} logger
 */
export async function removePhoto(hotelId, itemId, photoId, logger) {
  const photo = await writeWithEvents(async (tx, stage) => {
    const item = await lockedItem(tx, hotelId, itemId, null, 'PHOTO');
    const row = await tx.lostItemPhoto.findFirst({ where: { id: photoId, itemId, hotelId }, select: { id: true, hotelId: true, contentType: true } });
    if (!row) throw new NotFoundError('Fotoğraf bulunamadı');
    await tx.lostItemPhoto.delete({ where: { id: photoId } });
    await recordAudit(tx, { hotelId, entity: 'LostItem', entityId: itemId, action: 'UPDATE', before: { photo: photoId }, after: { photoRemoved: photoId } });
    await stage('lost_item.changed', { hotelId, itemId, status: item.status, change: 'PHOTO_REMOVED', guestId: item.guestId });
    return row;
  });
  const keys = photoKeys(photo);
  const failed = await removeFiles([keys.full, keys.thumb]);
  if (failed.length) logger.warn({ failed }, 'Kayıp eşya fotoğrafı diskten silinemedi');
}

/**
 * Fotoğrafı okur (yetki route'ta denetlenir). Kayıt yoksa ya da dosya diskte
 * yoksa 404.
 * @param {string} hotelId
 * @param {string} itemId
 * @param {string} photoId
 * @param {'full' | 'thumb'} size
 */
export async function openPhoto(hotelId, itemId, photoId, size) {
  const photo = await prisma.lostItemPhoto.findFirst({
    where: { id: photoId, itemId, hotelId },
    select: { id: true, hotelId: true, contentType: true },
  });
  if (!photo) throw new NotFoundError('Fotoğraf bulunamadı');
  const file = await openFile(photoKeys(photo)[size]);
  if (!file) throw new NotFoundError('Fotoğraf dosyası bulunamadı');
  return { ...file, contentType: photo.contentType };
}

/**
 * Kapanmış (teslim edilen / kapatılan) eşyaların fotoğraflarını süre dolunca
 * siler; bütün otellerde, paket paket (`LostItem_photo_purge_idx`).
 *
 * @param {{ warn: Function }} logger
 * @param {Date} [now]
 * @returns {Promise<{ items: number, photos: number }>}
 */
export async function purgeClosedItemPhotos(logger, now = new Date()) {
  const cut = new Date(now.getTime() - LOST_ITEM_PHOTO_PURGE_DAYS * 24 * 60 * 60 * 1000);
  const total = { items: 0, photos: 0 };
  for (;;) {
    const items = await prisma.lostItem.findMany({
      where: { closedAt: { lt: cut }, photosPurgedAt: null },
      select: { id: true, hotelId: true, status: true, guestId: true },
      orderBy: { closedAt: 'asc' },
      take: PURGE_BATCH,
    });
    if (items.length === 0) return total;
    const itemIds = items.map((item) => item.id);
    const photos = await prisma.lostItemPhoto.findMany({
      where: { itemId: { in: itemIds } },
      select: { id: true, hotelId: true, itemId: true, contentType: true },
    });
    const photosByItem = new Map();
    for (const photo of photos) photosByItem.set(photo.itemId, (photosByItem.get(photo.itemId) ?? 0) + 1);

    await runWithContext({ actor: 'sistem:kayip-esya' }, () =>
      writeWithEvents(async (tx, stage) => {
        if (photos.length) await tx.lostItemPhoto.deleteMany({ where: { id: { in: photos.map((photo) => photo.id) } } });
        await tx.lostItem.updateMany({ where: { id: { in: itemIds }, photosPurgedAt: null }, data: { photosPurgedAt: now } });
        for (const item of items) {
          const count = photosByItem.get(item.id) ?? 0;
          if (count === 0) continue;
          await recordAudit(tx, {
            hotelId: item.hotelId,
            entity: 'LostItem',
            entityId: item.id,
            action: 'UPDATE',
            before: { photos: count },
            after: { photos: 0, reason: `Kapanıştan ${LOST_ITEM_PHOTO_PURGE_DAYS} gün sonra silindi` },
          });
          await stage('lost_item.changed', { hotelId: item.hotelId, itemId: item.id, status: item.status, change: 'PHOTOS_PURGED', guestId: item.guestId });
        }
      }),
    );
    const failed = await removeFiles(photos.flatMap((photo) => Object.values(photoKeys(photo))));
    if (failed.length) logger.warn({ failed: failed.length }, 'Süresi dolan kayıp eşya fotoğraflarının bir kısmı diskten silinemedi');
    total.items += items.length;
    total.photos += photos.length;
    if (items.length < PURGE_BATCH) return total;
  }
}
