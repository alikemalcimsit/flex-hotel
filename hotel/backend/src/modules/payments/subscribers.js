import { runWithContext } from '@hotelos/core';
import { eventBus } from '../../lib/events.js';
import { PAYMENT_APPROVAL_TYPES, applyPaymentDecision } from './service.js';

/**
 * Ödeme modülünün olay dinleyicisi (modül 17): büyük ödeme, iade ve ödeme
 * iptali onaylarının sonucu.
 *
 * İsteği servis açar (aktör değil): onay kuyruğunun "onaylandı" haberini bu
 * dinleyici karşılar. Onaylanınca satır **onaylayan kişi** adına işlenir
 * (denetim izi "kim yetkilendirdi"yi taşır); reddedilince ya da süre dolunca
 * işlenmez. Aynı haber iki kez gelse de bir kez uygulanır (satırdaki onay
 * kimliği ve durum eşleşmezse dokunulmaz).
 */

/** @type {Array<() => void>} */
let unsubscribers = [];

/**
 * @param {{ hotelId: string, approvalId: string, type: string, decidedBy?: string }} payload
 * @param {{ id: string, name: string, correlationId?: string }} envelope
 */
export function onPaymentApprovalDecision(payload, envelope) {
  if (!PAYMENT_APPROVAL_TYPES.includes(payload?.type)) return Promise.resolve({ handled: false });
  return runWithContext(
    { correlationId: envelope.correlationId, causationId: envelope.id, actor: payload.decidedBy ?? 'system' },
    () => applyPaymentDecision(payload, envelope),
  );
}

/** İdempotent: `buildApp()` birden fazla kez çağrılabilir. */
export function registerPaymentSubscribers() {
  stopPaymentSubscribers();
  unsubscribers = [
    eventBus.subscribeMany(['approval.granted', 'approval.denied', 'approval.expired'], 'payments:approval-decision', (payload, envelope) =>
      onPaymentApprovalDecision(payload, envelope),
    ),
  ];
  return stopPaymentSubscribers;
}

export function stopPaymentSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}
