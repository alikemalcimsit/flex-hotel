import { runWithContext } from '@hotelos/core';
import { eventBus } from '../../lib/events.js';
import { POS_ADJUSTMENT_APPROVAL_TYPE, applyAdjustmentDecision } from './checks.js';
import { POS_PAYMENT_APPROVAL_TYPE, applyPaymentDecision } from './payments.js';

/**
 * Restoran POS'un olay dinleyicisi (modül 39): dört göz onaylarının sonucu — eşik üstü ikram /
 * iptal / indirim (`POS_ADJUSTMENT`), büyük tahsilat ve hatalı girişin iptali (`POS_PAYMENT`).
 *
 * İsteği servis açar; onay kuyruğunun "onaylandı / reddedildi / süresi doldu" haberini bu
 * dinleyici karşılar ve kaydı **karar veren kişi** adına işler. Aynı haber iki kez gelse de
 * bir kez uygulanır (satırın durumu ve onay kimliği eşleşmezse dokunulmaz).
 */

const HANDLERS = Object.freeze({
  [POS_ADJUSTMENT_APPROVAL_TYPE]: applyAdjustmentDecision,
  [POS_PAYMENT_APPROVAL_TYPE]: applyPaymentDecision,
});

/** @type {Array<() => void>} */
let unsubscribers = [];

/**
 * @param {{ hotelId: string, approvalId: string, type: string, decidedBy?: string }} payload
 * @param {{ id: string, name: string, correlationId?: string }} envelope
 */
export function onPosApprovalDecision(payload, envelope) {
  const handler = HANDLERS[payload?.type];
  if (!handler) return Promise.resolve({ handled: false });
  return runWithContext({ correlationId: envelope.correlationId, causationId: envelope.id, actor: payload.decidedBy ?? 'system' }, () => handler(payload, envelope));
}

/** İdempotent: `buildApp()` birden fazla kez çağrılabilir. */
export function registerPosSubscribers() {
  stopPosSubscribers();
  unsubscribers = [
    eventBus.subscribeMany(['approval.granted', 'approval.denied', 'approval.expired'], 'pos:approval-decision', (payload, envelope) => onPosApprovalDecision(payload, envelope)),
  ];
  return stopPosSubscribers;
}

export function stopPosSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}
