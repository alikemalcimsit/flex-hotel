import { runWithContext } from '@hotelos/core';
import { eventBus } from '../../lib/events.js';
import { syncEmployeeAccount } from './postings.js';
import { onPayrollApprovalDecision } from './runs.js';

/**
 * Bordro modülünün süreç içi dinleyicileri (modül 51):
 * - Bordronun dört göz kararı (onay kuyruğu): kilit, kesintilerin kesinleşmesi ya da hesaplanmış duruma dönüş.
 * - Personel kartı değişince personel carisinin adı / iletişimi eşitlenir.
 *
 * Bordronun muhasebe kayıtları burada değil, muhasebe aktöründe (`accounting-worker`): kapatılabilir, hatası
 * manuel göreve düşer.
 */

/** @type {Array<() => void>} */
let unsubscribers = [];

/** İdempotent: `buildApp()` birden fazla kez çağrılabilir. */
export function registerPayrollSubscribers() {
  stopPayrollSubscribers();
  unsubscribers = [
    eventBus.subscribeMany(['approval.granted', 'approval.denied', 'approval.expired'], 'payroll:approval-decision', (payload, envelope) => onPayrollApprovalDecision(payload, envelope)),
    eventBus.subscribe('employee.changed', 'payroll:employee-account-sync', (payload, envelope) =>
      payload.change === 'UPDATED' ? runWithContext({ correlationId: envelope.correlationId, causationId: envelope.id, actor: 'system' }, () => syncEmployeeAccount(payload.hotelId, payload.employeeId)) : undefined,
    ),
  ];
  return stopPayrollSubscribers;
}

export function stopPayrollSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}
