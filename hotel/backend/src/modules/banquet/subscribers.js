import { runWithContext } from '@hotelos/core';
import { eventBus } from '../../lib/events.js';
import { EVENT_PAYMENT_APPROVAL_TYPE, applyEventPaymentDecision } from './payments.js';

/**
 * Banketin olay dinleyicisi (modül 37): etkinlik ödemesi onaylarının sonucu
 * (büyük tahsilat, iade, hatalı girişin iptali).
 *
 * İsteği servis açar: onay kuyruğunun "onaylandı / reddedildi / süresi doldu"
 * haberini bu dinleyici karşılar ve satırı **karar veren kişi** adına işler. Aynı
 * haber iki kez gelse de bir kez uygulanır (`applyEventPaymentDecision`).
 */

/** @type {Array<() => void>} */
let unsubscribers = [];

/**
 * @param {{ hotelId: string, approvalId: string, type: string, decidedBy?: string }} payload
 * @param {{ id: string, name: string, correlationId?: string }} envelope
 */
export function onEventPaymentApprovalDecision(payload, envelope) {
  if (payload?.type !== EVENT_PAYMENT_APPROVAL_TYPE) return Promise.resolve({ handled: false });
  return runWithContext({ correlationId: envelope.correlationId, causationId: envelope.id, actor: payload.decidedBy ?? 'system' }, () =>
    applyEventPaymentDecision(payload, envelope),
  );
}

/** İdempotent: `buildApp()` birden fazla kez çağrılabilir. */
export function registerBanquetSubscribers() {
  stopBanquetSubscribers();
  unsubscribers = [
    eventBus.subscribeMany(['approval.granted', 'approval.denied', 'approval.expired'], 'banquet:approval-decision', (payload, envelope) =>
      onEventPaymentApprovalDecision(payload, envelope),
    ),
  ];
  return stopBanquetSubscribers;
}

export function stopBanquetSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}
