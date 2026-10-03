import { prisma } from '../../db.js';

/**
 * Folyoya giden olayın (minibar fişi, teslim edilen çamaşır) durumu (modül 19).
 *
 * Ek alan tutulmaz: folyo aktörü olayı işleyince kalemlerin tekrar işleme
 * anahtarı `evt:<olay>:<sıra>` olur (bkz. folyo `postExternalCharge`); ilk
 * kalem varsa işlenmiştir. Aktör işleyemediyse (kapalı, folyo kapalı, misafir
 * yok) olay "Folyo" modülünün açık manuel görevindedir.
 *
 * - `POSTED`: folyoya işlendi (hangi folyo, hangi konaklama).
 * - `MANUAL`: personele düştü (görev açık).
 * - `PENDING`: aktör henüz işlemedi (birkaç saniye) ya da görev kapatıldı.
 *
 * Sayfa başına iki sorgu (N+1 yok): kalem anahtarları ve açık görevler.
 *
 * @param {string} hotelId
 * @param {string[]} eventIds
 * @returns {Promise<Map<string, { status: 'POSTED' | 'MANUAL' | 'PENDING', folioId?: string, reservationId?: string, taskId?: string }>>}
 */
export async function chargePostingStatus(hotelId, eventIds) {
  const ids = [...new Set(eventIds.filter(Boolean))];
  const result = new Map(ids.map((id) => [id, { status: 'PENDING' }]));
  if (ids.length === 0) return result;
  const [items, tasks] = await Promise.all([
    prisma.folioItem.findMany({
      where: { hotelId, sourceKey: { in: ids.map((id) => `evt:${id}:0`) } },
      select: { sourceKey: true, folioId: true, folio: { select: { reservationId: true } } },
    }),
    prisma.$queryRaw`
      SELECT t."id", t."originalEvent"->>'id' AS "eventId"
      FROM "ManualTask" t
      WHERE t."hotelId" = ${hotelId} AND t."module" = 'Folyo' AND t."closedAt" IS NULL AND t."deletedAt" IS NULL
        AND t."originalEvent"->>'id' = ANY(${ids}::text[])`,
  ]);
  for (const task of tasks) result.set(task.eventId, { status: 'MANUAL', taskId: task.id });
  for (const item of items) {
    const eventId = item.sourceKey.slice('evt:'.length, -':0'.length);
    result.set(eventId, { status: 'POSTED', folioId: item.folioId, reservationId: item.folio.reservationId });
  }
  return result;
}
