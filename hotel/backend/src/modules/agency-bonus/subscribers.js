import { runWithContext } from '@hotelos/core';
import { eventBus } from '../../lib/events.js';
import { AGENCY_BONUS_APPROVAL_TYPE, applyBonusDecision } from './settlement.js';

/**
 * Acente bonusunun olay dinleyicisi (modül 35): hak ediş onayının sonucu.
 *
 * İsteği servis açar (aktör değil): onay kuyruğunun "onaylandı / reddedildi /
 * süresi doldu" haberini bu dinleyici karşılar ve hak edişi **karar veren kişi**
 * adına günceller (denetim izi "kim onayladı"yı taşır). Aynı haber iki kez gelse
 * de bir kez uygulanır (`applyBonusDecision`).
 */

/** @type {Array<() => void>} */
let unsubscribers = [];

/**
 * @param {{ hotelId: string, approvalId: string, type: string, decidedBy?: string }} payload
 * @param {{ id: string, name: string, correlationId?: string }} envelope
 */
export function onAgencyBonusApprovalDecision(payload, envelope) {
  if (payload?.type !== AGENCY_BONUS_APPROVAL_TYPE) return Promise.resolve({ handled: false });
  return runWithContext({ correlationId: envelope.correlationId, causationId: envelope.id, actor: payload.decidedBy ?? 'system' }, () =>
    applyBonusDecision(payload, envelope),
  );
}

/** İdempotent: `buildApp()` birden fazla kez çağrılabilir. */
export function registerAgencyBonusSubscribers() {
  stopAgencyBonusSubscribers();
  unsubscribers = [
    eventBus.subscribeMany(['approval.granted', 'approval.denied', 'approval.expired'], 'agency-bonus:approval-decision', (payload, envelope) =>
      onAgencyBonusApprovalDecision(payload, envelope),
    ),
  ];
  return stopAgencyBonusSubscribers;
}

export function stopAgencyBonusSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}
