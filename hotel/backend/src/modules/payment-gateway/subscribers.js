import { eventBus } from '../../lib/events.js';
import { applyGatewayRefundDecision } from './refunds.js';

/** Sanal POS'un olay dinleyicisi (modül 50): karta iade onayının sonucu. İdempotent kayıt. */
let unsubscribers = [];

export function registerPaymentGatewaySubscribers() {
  stopPaymentGatewaySubscribers();
  unsubscribers = [
    eventBus.subscribeMany(['approval.granted', 'approval.denied', 'approval.expired'], 'payment-gateway:refund-decision', (payload, envelope) =>
      payload?.type === 'GATEWAY_REFUND' ? applyGatewayRefundDecision(payload, envelope) : Promise.resolve({ handled: false }),
    ),
  ];
  return stopPaymentGatewaySubscribers;
}

export function stopPaymentGatewaySubscribers() {
  for (const stop of unsubscribers) stop();
  unsubscribers = [];
}
