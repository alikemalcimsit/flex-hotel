import { actorRegistry } from '@hotelos/actor-kit';
import { runWithContext } from '@hotelos/core';
import { createManualTaskForActor } from '../../lib/actors.js';
import { eventBus } from '../../lib/events.js';
import { APPROVAL_MODULE_LABEL, claimPendingAction, markPendingActionAbandoned } from './service.js';

/**
 * Onay kuyruğunun olay dinleyicisi (modül 11): onaylanan iş kaldığı yerden
 * devam eder.
 *
 * `approval.granted` commit sonrası dağıtılır; dinleyici bekleyen aktör işini
 * **üstlenir** (bir kez) ve aktörün işleyicisini aynı olayla, `approval`
 * dolu olarak çağırır. Devam, isteyen aktörün dışına çıkmaz — olay bus'a
 * yeniden verilmez (bkz. `service.js` başlığı).
 *
 * Aktör bu arada kayıttan kalkmışsa (yeniden adlandırıldı, paket kaldırıldı)
 * iş kaybolmaz: personelin önüne manuel görev düşer ve olay o aktör için
 * kapatılır.
 */

let logger = { warn: () => {}, error: () => {} };

/** @param {{ warn: Function, error: Function }} next */
export function setApprovalSubscriberLogger(next) {
  logger = next;
}

/**
 * @param {{ hotelId: string, approvalId: string, decidedBy: string }} payload
 * @param {{ id: string, correlationId?: string }} envelope
 */
export async function resumeGrantedApproval(payload, envelope) {
  const claim = await claimPendingAction(payload.approvalId);
  if (!claim) return { resumed: false };
  const { approval, action } = claim;
  const event = /** @type {any} */ (action.resumeEvent);

  const worker = actorRegistry.get(action.actorName);
  const eventUsable = Boolean(event?.name && event?.payload && typeof event.payload === 'object');
  if (!worker || !eventUsable) {
    const reason = worker ? 'saklanan olay zarfı okunamadı' : 'aktörü artık kayıtlı değil';
    logger.error?.({ actor: action.actorName, approvalId: approval.id, reason }, 'Onaylanan iş devam ettirilemedi');
    await createManualTaskForActor({
      hotelId: payload.hotelId,
      module: APPROVAL_MODULE_LABEL,
      title: `Onaylanan iş elle yapılacak: ${approval.summary}`,
      description: `${action.actorName} aktörü: ${reason}; ${payload.decidedBy} onayladı.`,
      originalEvent: { id: action.eventId, name: event?.name ?? null, payload: event?.payload ?? null },
    });
    await markPendingActionAbandoned(payload.hotelId, action);
    return { resumed: false };
  }

  // Aynı zincir (correlationId), sebep olarak onay haberi, aktör olarak onaylayan:
  // devamda yazılan denetim izi ve olaylar "kim yetkilendirdi"yi taşır.
  await runWithContext(
    { correlationId: event?.correlationId ?? envelope?.correlationId, causationId: envelope?.id, actor: payload.decidedBy },
    () =>
      worker.handle(
        event.payload,
        {
          id: action.eventId,
          name: event.name,
          version: event.version ?? 1,
          correlationId: event.correlationId ?? envelope?.correlationId,
          causationId: envelope?.id ?? null,
          hop: (event.hop ?? 0) + 1,
          actor: event.actor ?? 'system',
          occurredAt: event.occurredAt,
        },
        { approval },
      ),
  );
  return { resumed: true };
}

/** @type {Array<() => void>} */
let unsubscribers = [];

/** İdempotent: `buildApp()` birden fazla kez çağrılabilir. */
export function registerApprovalSubscribers() {
  stopApprovalSubscribers();
  unsubscribers = [
    eventBus.subscribe('approval.granted', 'approvals:resume', (payload, envelope) =>
      resumeGrantedApproval(payload, envelope),
    ),
  ];
  return stopApprovalSubscribers;
}

export function stopApprovalSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}
