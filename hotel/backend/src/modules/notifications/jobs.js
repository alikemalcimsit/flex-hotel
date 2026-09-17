import { PERMISSIONS } from '../../lib/permissions.js';
import { writeWithEvents } from '../../lib/write.js';
import {
  dispatchDueNotifications,
  pollDeliveryReports,
  recoverStaleNotifications,
  setDispatcherLogger,
  stopDispatcher,
} from './dispatcher.js';
import { purgeExpiredStaffAlerts, raiseStaffAlert } from './staff-alerts.js';

/**
 * Bildirim merkezinin zamanlanmış işleri (yalnızca sunucu sürecinde çalışır;
 * testler ve betikler başlatmaz).
 *
 * | İş                        | Sıklık  | Neden |
 * |---------------------------|---------|-------|
 * | Sıradaki bildirimler      | 15 sn   | Yeniden deneme ve sessiz saat sonrası gönderim (yeni bildirim zaten anında tetikler) |
 * | Takılı gönderim kurtarma  | 1 dk    | Süreç gönderim sırasında kapandıysa |
 * | Geciken istek taraması    | 1 dk    | "Hedef süresi geçti" uyarısı (olay yok, zamanla olur) |
 * | SMS teslim raporu         | 2 dk    | Netgsm: dakikada en fazla 10 sorgu |
 * | Eski uyarıları silme      | 1 sa    | Zil bir iş listesi değil; 30 gün saklanır |
 *
 * Her iş kendi turunu bitirmeden yeniden başlamaz; hatası log'a düşer, diğer
 * işleri durdurmaz.
 */

const DISPATCH_INTERVAL_MS = 15_000;
const STALE_RECOVERY_INTERVAL_MS = 60_000;
const OVERDUE_SCAN_INTERVAL_MS = 60_000;
const DELIVERY_REPORT_INTERVAL_MS = 120_000;
const ALERT_PURGE_INTERVAL_MS = 60 * 60_000;

/** Sunucu açılışında ilk turun beklemesi (açılış yükü bitsin). */
const STARTUP_DELAY_MS = 5_000;

/** Bir taramada en fazla geciken istek. */
const OVERDUE_SCAN_BATCH = 200;

/**
 * Süresi geçmiş, henüz uyarılmamış açık istekleri işaretleyip uyarı açar.
 *
 * İstek satırının `updatedAt`'ine dokunulmaz: o, ekrandaki iyimser kilidin
 * sürümüdür; tarayıcı değiştirirse resepsiyonistin tıklaması "başkası
 * değiştirdi" hatası verirdi.
 *
 * @param {Date} [now]
 * @returns {Promise<number>} uyarılan istek
 */
export function scanOverdueRequests(now = new Date()) {
  return writeWithEvents(async (tx, stage) => {
    const rows = await tx.$queryRaw`
      UPDATE "GuestRequest" g
      SET "overdueAlertedAt" = ${now}
      WHERE g."id" IN (
        SELECT "id" FROM "GuestRequest"
        WHERE "overdueAlertedAt" IS NULL AND "deletedAt" IS NULL
          AND "status" IN ('OPEN', 'IN_PROGRESS') AND "dueAt" < ${now}
        ORDER BY "dueAt"
        LIMIT ${OVERDUE_SCAN_BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING g."id", g."hotelId", g."title", g."dueAt", g."assignedToId", g."priority", g."roomId"`;
    if (rows.length === 0) return 0;

    const roomIds = [...new Set(rows.map((row) => row.roomId).filter(Boolean))];
    const rooms = roomIds.length
      ? await tx.room.findMany({ where: { id: { in: roomIds } }, select: { id: true, number: true } })
      : [];
    const roomNumber = new Map(rooms.map((room) => [room.id, room.number]));

    for (const row of rows) {
      await raiseStaffAlert(tx, stage, {
        hotelId: row.hotelId,
        kind: 'OVERDUE_REQUEST',
        severity: row.priority === 'URGENT' ? 'CRITICAL' : 'WARNING',
        title: `Gecikti: ${row.title}`,
        body: row.roomId ? `Oda ${roomNumber.get(row.roomId) ?? '—'}` : null,
        link: `/istekler?istek=${row.id}`,
        userId: row.assignedToId,
        permission: row.assignedToId ? null : PERMISSIONS.REQUESTS_MANAGE,
        entityType: 'GuestRequest',
        entityId: row.id,
        dedupeKey: `overdue-request:${row.id}:${row.dueAt.getTime()}`,
      });
    }
    return rows.length;
  });
}

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void} işleri durdurur
 */
export function startNotificationJobs(logger) {
  setDispatcherLogger(logger);
  const timers = [];
  const busy = new Set();

  /** @param {string} name @param {number} interval @param {() => Promise<unknown>} task */
  const every = (name, interval, task) => {
    const run = async () => {
      if (busy.has(name)) return;
      busy.add(name);
      try {
        await task();
      } catch (error) {
        logger.error({ err: error, job: name }, 'Bildirim işi başarısız');
      } finally {
        busy.delete(name);
      }
    };
    const startup = setTimeout(run, STARTUP_DELAY_MS);
    const repeat = setInterval(run, interval);
    startup.unref?.();
    repeat.unref?.();
    timers.push(startup, repeat);
  };

  every('dispatch', DISPATCH_INTERVAL_MS, () => dispatchDueNotifications(logger));
  every('stale-recovery', STALE_RECOVERY_INTERVAL_MS, async () => {
    const recovered = await recoverStaleNotifications();
    if (recovered > 0) logger.warn({ recovered }, 'Takılı kalan bildirimler sıraya geri alındı');
  });
  every('overdue-requests', OVERDUE_SCAN_INTERVAL_MS, () => scanOverdueRequests());
  every('delivery-reports', DELIVERY_REPORT_INTERVAL_MS, () => pollDeliveryReports(logger));
  every('alert-purge', ALERT_PURGE_INTERVAL_MS, async () => {
    const purged = await purgeExpiredStaffAlerts();
    if (purged > 0) logger.info({ purged }, 'Süresi dolan personel uyarıları silindi');
  });

  return () => {
    for (const timer of timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    stopDispatcher();
  };
}
