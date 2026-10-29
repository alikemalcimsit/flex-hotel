import { eventBus } from '../../lib/events.js';
import { onPurchaseApprovalDecision } from './orders.js';

/**
 * Satın almanın olay dinleyicisi (modül 45): eşik üstü siparişin dört göz onayı. Onay kuyruğunun
 * "onaylandı / reddedildi / süresi doldu" haberini karşılar; sipariş onaylı olur ya da reddedilip
 * satırları teklif turuna döner. Aynı haber iki kez gelse de bir kez uygulanır.
 */

/** @type {Array<() => void>} */
let unsubscribers = [];

/** İdempotent: `buildApp()` birden fazla kez çağrılabilir. */
export function registerPurchasingSubscribers() {
  stopPurchasingSubscribers();
  unsubscribers = [
    eventBus.subscribeMany(['approval.granted', 'approval.denied', 'approval.expired'], 'purchasing:approval-decision', (payload, envelope) => onPurchaseApprovalDecision(payload, envelope)),
  ];
  return stopPurchasingSubscribers;
}

export function stopPurchasingSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}
