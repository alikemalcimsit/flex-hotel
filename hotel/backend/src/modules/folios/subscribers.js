import { runWithContext } from '@hotelos/core';
import { eventBus } from '../../lib/events.js';
import { applyVoidDecision } from './service.js';

/**
 * Folyo modülünün olay dinleyicisi (modül 15): kalem iptali onayının sonucu.
 *
 * İptal isteğini servis açar (aktör değil): onay kuyruğunun "onaylandı"
 * haberini aktör devamı değil bu dinleyici karşılar (bkz. modül 11 devir
 * sözleşmesi). Onaylanınca ters kayıt **onaylayan kişi** adına işlenir
 * (denetim izi "kim yetkilendirdi"yi taşır); reddedilince ya da süre dolunca
 * kalem olduğu gibi kalır. Aynı haber iki kez gelse de iptal bir kez
 * uygulanır (kalemdeki bekleyen onay kimliği eşleşmezse dokunulmaz).
 */

/** @type {Array<() => void>} */
let unsubscribers = [];

/**
 * @param {{ hotelId: string, approvalId: string, type: string, decidedBy?: string }} payload
 * @param {{ id: string, name: string, correlationId?: string }} envelope
 */
export function onFolioApprovalDecision(payload, envelope) {
  if (payload?.type !== 'FOLIO_VOID') return Promise.resolve({ handled: false });
  return runWithContext(
    { correlationId: envelope.correlationId, causationId: envelope.id, actor: payload.decidedBy ?? 'system' },
    () => applyVoidDecision(payload, envelope),
  );
}

/** İdempotent: `buildApp()` birden fazla kez çağrılabilir. */
export function registerFolioSubscribers() {
  stopFolioSubscribers();
  unsubscribers = [
    eventBus.subscribeMany(['approval.granted', 'approval.denied', 'approval.expired'], 'folios:void-decision', (payload, envelope) =>
      onFolioApprovalDecision(payload, envelope),
    ),
  ];
  return stopFolioSubscribers;
}

export function stopFolioSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}
