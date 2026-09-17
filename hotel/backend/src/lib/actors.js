import { actorRegistry } from '@hotelos/actor-kit';
import { NOTIFICATION_CHANNEL_LABELS, NOTIFICATION_SOURCE_LABELS, NOTIFICATION_TRIGGER_EVENTS } from '@hotelos/hotel-contracts';
import { createNotificationWorker, NOTIFICATION_WORKER_NAME } from '@hotelos/notification-worker';
import { createRoomWorker } from '@hotelos/room-worker';
import { prismaUnfiltered } from '../db.js';
import { manualTaskPermission } from '../modules/notifications/rules.js';
import { enqueueTriggerNotifications } from '../modules/notifications/service.js';
import { raiseStaffAlert } from '../modules/notifications/staff-alerts.js';
import { applySystemRoomState, autoAssignRoom } from '../modules/rooms/service.js';
import { eventBus } from './events.js';
import { writeWithEvents } from './write.js';

/**
 * Aktörlerin veritabanına bağlandığı yer.
 *
 * `shared/actor-kit` ve worker paketleri altyapı bilmez; Prisma'ya dokunan
 * her şey burada. Modül 12'nin yönetim paneli geldiğinde açma/kapama ayarını
 * `ActorSetting` tablosundan okuyan `isEnabled` zaten hazır olacak.
 */

let logger = { warn: () => {}, error: () => {} };

/** @param {{ warn: Function, error: Function }} next */
export function setActorLogger(next) {
  logger = next;
}

/**
 * Aktör bağımlılıkları. Hepsi filtresiz istemciyi kullanır: bu kayıtlar
 * (işlenmiş event, aktivite izi, manuel görev) sistemin defteri, soft-delete
 * filtresine tabi değil.
 */
const deps = {
  /**
   * Aynı event ikinci kez geldiyse işlenmemeli. `ProcessedEvent` üzerindeki
   * `(actorName, eventId)` unique kısıtı bunu veritabanı seviyesinde tutar.
   */
  isProcessed: async (actorName, eventId) => {
    const existing = await prismaUnfiltered.processedEvent.findFirst({
      where: { actorName, eventId },
      select: { id: true },
    });
    return Boolean(existing);
  },

  markProcessed: async (actorName, eventId, hotelId) => {
    try {
      await prismaUnfiltered.processedEvent.create({ data: { actorName, eventId, hotelId } });
    } catch (error) {
      // Yarış durumunda ikinci yazım unique kısıtına takılır; zaten işaretli
      // olması istediğimiz sonuç, hata değil.
      if (error?.code !== 'P2002') throw error;
    }
  },

  /**
   * Aktör açık mı? Kayıt yoksa varsayılan açıktır — yeni bir aktör eklendiğinde
   * kimse ayar girmeden çalışsın diye.
   */
  isEnabled: async (hotelId, actorName) => {
    if (!hotelId) return false;
    const setting = await prismaUnfiltered.actorSetting.findFirst({
      where: { hotelId, actorName },
      select: { enabled: true },
    });
    return setting?.enabled ?? true;
  },

  logActivity: async (entry) => {
    if (!entry.hotelId) return;
    await prismaUnfiltered.activityLog.create({ data: entry });
  },

  /**
   * İş personele düştü: görev yazılır ve işin modülüne yetkili personelin
   * ziline uyarı gider (aynı transaction — görev varsa uyarı da vardır).
   */
  createManualTask: async (task) => {
    if (!task.hotelId) return;
    await writeWithEvents(async (tx, stage) => {
      const created = await tx.manualTask.create({ data: task, select: { id: true } });
      await raiseStaffAlert(tx, stage, {
        hotelId: task.hotelId,
        kind: 'MANUAL_TASK',
        severity: 'WARNING',
        title: task.title,
        body: task.description ?? null,
        permission: manualTaskPermission(task.module),
        entityType: 'ManualTask',
        entityId: created.id,
      });
    });
  },

  logger: {
    warn: (...args) => logger.warn(...args),
    error: (...args) => logger.error(...args),
  },
};

/**
 * Aktörleri kaydeder ve event bus'a bağlar.
 *
 * İdempotent: `buildApp()` birden fazla kez çağrılabildiği için aynı aktör
 * ikinci kez kaydedilmez. `bindAll` da önce eski aboneliği kaldırır — aksi
 * hâlde tek rezervasyon için iki kez oda atanmaya çalışılırdı.
 */
/** Olay → misafir bildirimi eşlemesi (notification-worker'a verilir). */
const NOTIFICATION_TRIGGERS = Object.freeze(
  Object.fromEntries(
    Object.entries(NOTIFICATION_TRIGGER_EVENTS).map(([trigger, eventName]) => [
      eventName,
      { trigger, label: NOTIFICATION_SOURCE_LABELS[trigger] },
    ]),
  ),
);

export function registerActors() {
  if (!actorRegistry.get('room-worker')) {
    actorRegistry.register(createRoomWorker({ autoAssignRoom, applySystemRoomState }, deps));
  }
  if (!actorRegistry.get(NOTIFICATION_WORKER_NAME)) {
    actorRegistry.register(
      createNotificationWorker(
        {
          triggers: NOTIFICATION_TRIGGERS,
          enqueue: enqueueTriggerNotifications,
          channelLabels: NOTIFICATION_CHANNEL_LABELS,
        },
        deps,
      ),
    );
  }
  actorRegistry.bindAll(eventBus);
  return actorRegistry;
}

export { actorRegistry };
