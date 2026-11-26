import { eventBus } from '../../lib/events.js';
import { onLeaveApprovalDecision } from './leaves.js';

/**
 * İK'nın süreç içi dinleyicisi (modül 52): izin talebinin onay kuyruğu kararı (onaylandı / reddedildi / süresi doldu).
 */

/** @type {Array<() => void>} */
let unsubscribers = [];

/** İdempotent: `buildApp()` birden fazla kez çağrılabilir. */
export function registerHrSubscribers() {
  stopHrSubscribers();
  unsubscribers = [eventBus.subscribeMany(['approval.granted', 'approval.denied', 'approval.expired'], 'hr:leave-approval-decision', (payload, envelope) => onLeaveApprovalDecision(payload, envelope))];
  return stopHrSubscribers;
}

export function stopHrSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}
