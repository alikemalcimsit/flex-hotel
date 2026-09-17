import { prismaUnfiltered } from '../db.js';
import { relayUnpublishedEvents } from './outbox.js';
import { startRecurringJobs } from './recurring.js';
import { sqlTimestamp } from './sql-time.js';

/**
 * Altyapının zamanlanmış işleri (yalnızca sunucu sürecinde).
 *
 * | İş                          | Sıklık | Neden |
 * |-----------------------------|--------|-------|
 * | Dağıtılmamış olaylar        | 30 sn  | Süreç commit ile dağıtım arasında kapandıysa olay kaybolmasın |
 * | İşlenmiş olay kayıtları     | 1 sa   | `ProcessedEvent` yalnızca tekrar gelen olayı tanımak için; sınırsız büyümesin |
 */

const RELAY_INTERVAL_MS = 30_000;
const PURGE_INTERVAL_MS = 60 * 60_000;

/**
 * Aktörün "bu olayı işledim" kaydının saklandığı gün. Olay yeniden en geç
 * dakikalar içinde gelir (outbox, yeniden deneme); bir ay bol bol yeter.
 */
export const PROCESSED_EVENT_RETENTION_DAYS = 30;

/** Uzun kilit tutmamak için silme paket boyutu. */
const PURGE_BATCH = 5_000;

/**
 * @param {Date} [now]
 * @returns {Promise<number>} silinen kayıt
 */
export async function purgeProcessedEvents(now = new Date()) {
  const cut = new Date(now.getTime() - PROCESSED_EVENT_RETENTION_DAYS * 24 * 60 * 60_000);
  let total = 0;
  for (;;) {
    const deleted = await prismaUnfiltered.$executeRaw`
      DELETE FROM "ProcessedEvent"
      WHERE "id" IN (SELECT "id" FROM "ProcessedEvent" WHERE "createdAt" < ${sqlTimestamp(cut)} LIMIT ${PURGE_BATCH})`;
    total += deleted;
    if (deleted < PURGE_BATCH) return total;
  }
}

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startMaintenanceJobs(logger) {
  return startRecurringJobs(logger, [
    { name: 'outbox-relay', intervalMs: RELAY_INTERVAL_MS, run: () => relayUnpublishedEvents(logger) },
    {
      name: 'processed-event-purge',
      intervalMs: PURGE_INTERVAL_MS,
      run: async () => {
        const purged = await purgeProcessedEvents();
        if (purged > 0) logger.info({ purged }, 'Eski işlenmiş olay kayıtları silindi');
      },
    },
  ]);
}
