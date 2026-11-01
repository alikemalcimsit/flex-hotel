import { createManualTaskForActor } from '../../lib/actors.js';
import { eventBus } from '../../lib/events.js';

/**
 * Kat hizmetlerinin olay dinleyicisi (modül 14): "Sorun var" bildirimi.
 *
 * Görevli temizlik sırasında arıza görünce (kırık duş başlığı, çalışmayan
 * klima) işi teknik servise taşır. Arıza-bakım modülü (20) henüz yok; o gelene
 * dek bildirim **manuel görev** olarak `rooms.operate` yetkilisinin önüne
 * düşer — arıza kaydını (`blockRoom`, modül 3) o açar. Modül 20 geldiğinde bu
 * dinleyici MaintenanceTicket açacak; olay sözleşmesi değişmez.
 *
 * Aktöre bağlı değildir: aktör kapalıyken de sorun bildirimi kaybolmaz.
 */

/** @type {Array<() => void>} */
let unsubscribers = [];

/**
 * @param {{ hotelId: string, taskId: string, roomId: string, roomNumber: string, note: string }} payload
 * @param {{ id: string, name: string, correlationId?: string }} envelope
 */
export function onHousekeepingIssue(payload, envelope) {
  return createManualTaskForActor({
    hotelId: payload.hotelId,
    module: 'Teknik servis',
    title: `${payload.roomNumber} odasında sorun: ${payload.note}`,
    description: 'Kat görevlisi temizlik sırasında bildirdi. Gerekirse odayı arızaya alın (Odalar → arıza kaydı).',
    originalEvent: { id: envelope.id, name: envelope.name, payload },
    correlationId: envelope.correlationId ?? null,
  });
}

/** İdempotent: `buildApp()` birden fazla kez çağrılabilir. */
export function registerHousekeepingSubscribers() {
  stopHousekeepingSubscribers();
  unsubscribers = [
    eventBus.subscribe('housekeeping.issue.reported', 'housekeeping:issue-to-maintenance', (payload, envelope) =>
      onHousekeepingIssue(payload, envelope),
    ),
  ];
  return stopHousekeepingSubscribers;
}

export function stopHousekeepingSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}
