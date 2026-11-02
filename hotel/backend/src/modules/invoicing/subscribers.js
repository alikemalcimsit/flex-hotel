import { eventBus } from '../../lib/events.js';
import { onInvoiceApprovalDecision } from './invoices.js';

/**
 * Fatura modülünün süreç içi dinleyicisi (modül 16 / 49): iptal isteğinin dört göz kararı (onay kuyruğu).
 *
 * Kapanan folyonun fatura taslağı folyo aktöründe (`billing-worker`, `folio.closed`); faturanın cariye bağlanması
 * muhasebe aktöründe (`accounting-worker`, `invoice.issued` / `invoice.cancelled`): ikisi de kapatılabilir,
 * hatası manuel göreve düşer.
 */

/** @type {Array<() => void>} */
let unsubscribers = [];

/** İdempotent: `buildApp()` birden fazla kez çağrılabilir. */
export function registerInvoiceSubscribers() {
  stopInvoiceSubscribers();
  unsubscribers = [eventBus.subscribeMany(['approval.granted', 'approval.denied', 'approval.expired'], 'invoicing:approval-decision', (payload, envelope) => onInvoiceApprovalDecision(payload, envelope))];
  return stopInvoiceSubscribers;
}

export function stopInvoiceSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}
