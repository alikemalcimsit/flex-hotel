import { prisma, prismaUnfiltered } from '../../db.js';
import { startRecurringJobs } from '../../lib/recurring.js';
import { sqlTimestamp } from '../../lib/sql-time.js';
import { pollChannexBookings } from './bookings.js';
import { importDueIcalChannels } from './ical.js';
import { runChannexSyncTick } from './sync.js';
import { loadSyncTargets } from './targets.js';

/**
 * Kanal yönetiminin zamanlanmış işleri (modül 33, yalnızca sunucu sürecinde).
 *
 * | İş                     | Sıklık | Ne yapar |
 * |------------------------|--------|----------|
 * | Gönderim turu          | 5 sn   | Kirli kanallara farkı, zamanı gelene tam eşitlemeyi gönderir (kanal başına en sık 10 sn) |
 * | Rezervasyon akışı      | 60 sn  | Senkrondaki Channex kanallarının teyit edilmemiş revizyonları (webhook gelince hemen) |
 * | Takvim okuma           | 60 sn  | Zamanı gelen iCal kanalları (kanal başına 15 dk'da bir) |
 * | Log temizliği          | 6 sa   | 90 günden eski senkron logu |
 */

const SYNC_INTERVAL_MS = 5_000;
const BOOKING_POLL_INTERVAL_MS = 60_000;
const ICAL_INTERVAL_MS = 60_000;
const PURGE_INTERVAL_MS = 6 * 60 * 60_000;
/** Senkron logu bu kadar gün saklanır. */
export const CHANNEL_LOG_RETENTION_DAYS = 90;
/** Uzun kilit tutmamak için silme paket boyutu. */
const PURGE_BATCH = 5_000;

/**
 * Senkrondaki Channex kanallarının rezervasyon akışı (sırayla).
 * @param {{ warn: Function }} logger
 */
export async function pollAllChannexChannels(logger) {
  const channels = await prisma.channel.findMany({ where: { type: 'CHANNEX', status: 'ACTIVE' }, select: { id: true } });
  for (const channel of channels) {
    try {
      await pollChannexBookings(channel.id, { trigger: 'SCHEDULE' });
    } catch (error) {
      logger.warn({ err: error, channelId: channel.id }, 'Kanal rezervasyonları okunamadı');
    }
  }
  return channels.length;
}

/**
 * @param {Date} [now]
 * @returns {Promise<number>} silinen satır
 */
export async function purgeChannelLogs(now = new Date()) {
  const cut = new Date(now.getTime() - CHANNEL_LOG_RETENTION_DAYS * 24 * 60 * 60_000);
  let total = 0;
  for (;;) {
    const deleted = await prismaUnfiltered.$executeRaw`
      DELETE FROM "ChannelSyncLog"
      WHERE "id" IN (SELECT "id" FROM "ChannelSyncLog" WHERE "createdAt" < ${sqlTimestamp(cut)} LIMIT ${PURGE_BATCH})`;
    total += deleted;
    if (deleted < PURGE_BATCH) return total;
  }
}

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startChannelManagerJobs(logger) {
  // Kanal aktörünün "kanalı olan oteller" listesi: açılışta bir kez (sonra kanal değişince tazelenir).
  loadSyncTargets().catch((error) => logger.warn({ err: error }, 'Kanal hedefleri yüklenemedi; olaylar veritabanından denetlenecek'));
  return startRecurringJobs(logger, [
    { name: 'channel-sync', intervalMs: SYNC_INTERVAL_MS, run: () => runChannexSyncTick({ logger }) },
    { name: 'channel-booking-poll', intervalMs: BOOKING_POLL_INTERVAL_MS, run: () => pollAllChannexChannels(logger) },
    { name: 'channel-ical-import', intervalMs: ICAL_INTERVAL_MS, run: () => importDueIcalChannels({ logger }) },
    {
      name: 'channel-log-purge',
      intervalMs: PURGE_INTERVAL_MS,
      run: async () => {
        const purged = await purgeChannelLogs();
        if (purged > 0) logger.info({ purged }, 'Eski kanal senkron logları silindi');
      },
    },
  ]);
}
