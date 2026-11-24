import { runWithContext } from '@hotelos/core';
import { eventBus } from '../../lib/events.js';
import { createTicketFromIssue } from '../maintenance/service.js';

/**
 * Kat hizmetlerinin olay dinleyicisi (modül 14): "Sorun var" bildirimi.
 *
 * Görevli temizlik sırasında arıza görünce (kırık duş başlığı, çalışmayan
 * klima) işi teknik servise taşır. Modül 20 (teknik servis) geldiğinde bu
 * dinleyici artık **MaintenanceTicket** açıyor (eskiden `rooms.operate`
 * yetkilisine manuel görev düşerdi); olay sözleşmesi değişmedi. Aynı kat
 * hizmeti görevinden ikinci kez bilet açılmaz (idempotent).
 *
 * Aktöre bağlı değildir: aktör kapalıyken de sorun bildirimi kaybolmaz.
 */

/** @type {Array<() => void>} */
let unsubscribers = [];

/**
 * @param {{ hotelId: string, taskId: string, roomId: string, roomNumber: string, note: string }} payload
 */
export function onHousekeepingIssue(payload) {
  return runWithContext({ actor: 'sistem:kat-hizmetleri' }, () => createTicketFromIssue(payload));
}

/** İdempotent: `buildApp()` birden fazla kez çağrılabilir. */
export function registerHousekeepingSubscribers() {
  stopHousekeepingSubscribers();
  unsubscribers = [
    eventBus.subscribe('housekeeping.issue.reported', 'housekeeping:issue-to-maintenance', (payload) => onHousekeepingIssue(payload)),
  ];
  return stopHousekeepingSubscribers;
}

export function stopHousekeepingSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}
