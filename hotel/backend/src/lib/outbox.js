import { prismaUnfiltered } from '../db.js';
import { eventBus } from './events.js';
import { SQL_NOW, sqlTimestamp } from './sql-time.js';

/**
 * Transactional outbox — 3. adım: dağıtılamamış olayları geri almak.
 *
 * Olay, iş verisiyle aynı transaction'da `EventLog`'a yazılır ve commit
 * sonrası aynı süreçte dağıtılır (`lib/write.js`). Süreç tam o arada kapanırsa
 * (yeniden başlatma, çökme) olay kayıtlı ama dağıtılmamış kalır: oda
 * atanmaz, misafire bildirim gitmez, kimse fark etmez. Bu tarayıcı
 * `publishedAt` boş kalmış olayları bulup yeniden dağıtır.
 *
 * - **Bekleme payı:** yeni olayın dağıtımı istek içinde sürüyor olabilir;
 *   yalnızca `RELAY_GRACE_MS`'den eski olanlar alınır.
 * - **Üstlenme:** olay önce "yayınlandı" işaretlenir, sonra dağıtılır
 *   (`FOR UPDATE SKIP LOCKED`): birden fazla süreç aynı olayı iki kez almaz.
 *   Aktörler zaten tekrar gelen olayı tanır (`ProcessedEvent`).
 */

/** İstek içindeki dağıtımın bitmesi için tanınan süre. */
export const RELAY_GRACE_MS = 2 * 60_000;

/** Bir turda üstlenilen en fazla olay. */
const RELAY_BATCH = 100;

/** Bir çalıştırmada en fazla tur (birikmiş kuyruk diğer işleri bekletmesin). */
const RELAY_MAX_ROUNDS = 10;

/**
 * @param {{ error?: Function, warn?: Function }} [logger]
 * @param {Date} [now]
 * @returns {Promise<number>} yeniden dağıtılan olay
 */
export async function relayUnpublishedEvents(logger, now = new Date()) {
  const cut = new Date(now.getTime() - RELAY_GRACE_MS);
  let relayed = 0;

  for (let round = 0; round < RELAY_MAX_ROUNDS; round += 1) {
    const rows = await prismaUnfiltered.$queryRaw`
      UPDATE "EventLog" e
      SET "publishedAt" = ${SQL_NOW}, "updatedAt" = ${SQL_NOW}
      WHERE e."id" IN (
        SELECT "id" FROM "EventLog"
        WHERE "publishedAt" IS NULL AND "deletedAt" IS NULL AND "occurredAt" < ${sqlTimestamp(cut)}
        ORDER BY "occurredAt"
        LIMIT ${RELAY_BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING e."id", e."name", e."version", e."payload", e."correlationId", e."causationId",
                e."hop", e."actor", e."occurredAt"`;
    if (rows.length === 0) break;

    rows.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    for (const row of rows) {
      try {
        await eventBus.dispatch({
          id: row.id,
          name: row.name,
          version: row.version,
          payload: row.payload,
          correlationId: row.correlationId,
          causationId: row.causationId ?? undefined,
          hop: row.hop,
          actor: row.actor,
          occurredAt: row.occurredAt,
        });
      } catch (error) {
        logger?.error?.({ err: error, event: row.name, id: row.id }, 'Geri alınan olay dağıtılamadı');
      }
    }
    relayed += rows.length;
    if (rows.length < RELAY_BATCH) break;
  }

  if (relayed > 0) logger?.warn?.({ relayed }, 'Dağıtılmamış kalan olaylar yeniden dağıtıldı');
  return relayed;
}
