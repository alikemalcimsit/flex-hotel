import { runWithContext } from '@hotelos/core';
import { eventBus } from '../../lib/events.js';
import { alertStayCheckout, releaseStayAppointments } from './appointments.js';
import { SPA_PAYMENT_APPROVAL_TYPE, applySpaPaymentDecision } from './payments.js';
import { SPA_SYSTEM_ACTOR } from './shared.js';

/**
 * Spa'nın olay dinleyicisi (modül 57).
 *
 * - **Onay sonucu:** büyük tahsilat, iade ve hatalı girişin iptali (`SPA_PAYMENT`). İsteği servis açar; onay
 *   kuyruğunun "onaylandı / reddedildi / süresi doldu" haberini bu dinleyici karşılar ve satırı **karar veren kişi**
 *   adına işler. Aynı haber iki kez gelse de bir kez uygulanır.
 * - **Konaklama iptal / gelmedi:** misafir otele gelmiyor; ileri tarihli açık spa randevuları bedelsiz kapanır.
 * - **Çıkış:** ödenmemiş spa borcu ya da ileri tarihli randevu varsa spa'ya zil düşer.
 *
 * Konaklama dinleyicileri hata fırlatmaz: spa'nın sorunu rezervasyon işlemini etkilemez; aynı olay yeniden gelse de
 * sonuç aynıdır (kapanmış randevuya dokunulmaz, zil aynı anahtarla tekildir).
 */

/** @type {Array<() => void>} */
let unsubscribers = [];

/**
 * @param {{ hotelId: string, approvalId: string, type: string, decidedBy?: string }} payload
 * @param {{ id: string, name: string, correlationId?: string }} envelope
 */
export function onSpaApprovalDecision(payload, envelope) {
  if (payload?.type !== SPA_PAYMENT_APPROVAL_TYPE) return Promise.resolve({ handled: false });
  return runWithContext({ correlationId: envelope.correlationId, causationId: envelope.id, actor: payload.decidedBy ?? 'system' }, () => applySpaPaymentDecision(payload, envelope));
}

const STAY_RELEASE_REASONS = Object.freeze({ 'reservation.cancelled': 'Konaklama iptal edildi', 'reservation.no_show': 'Misafir otele gelmedi' });

/**
 * @param {{ hotelId: string, reservationId: string }} payload
 * @param {{ id: string, name: string, correlationId?: string }} envelope
 * @param {{ error?: Function }} [logger]
 */
export function onStayEvent(payload, envelope, logger = console) {
  if (!payload?.hotelId || !payload.reservationId) return Promise.resolve(null);
  return runWithContext({ correlationId: envelope.correlationId, causationId: envelope.id, actor: SPA_SYSTEM_ACTOR }, async () => {
    try {
      if (envelope.name === 'guest.checked_out') return await alertStayCheckout(payload.hotelId, payload.reservationId);
      return { closed: await releaseStayAppointments(payload.hotelId, payload.reservationId, { reason: STAY_RELEASE_REASONS[envelope.name] ?? 'Konaklama kapandı', logger }) };
    } catch (error) {
      logger.error?.({ err: error, hotelId: payload.hotelId, reservationId: payload.reservationId, event: envelope.name }, 'Spa konaklama olayını işleyemedi');
      return null;
    }
  });
}

/**
 * İdempotent: `buildApp()` birden fazla kez çağrılabilir.
 * @param {{ error?: Function }} [logger]
 */
export function registerSpaSubscribers(logger = console) {
  stopSpaSubscribers();
  unsubscribers = [
    eventBus.subscribeMany(['approval.granted', 'approval.denied', 'approval.expired'], 'spa:approval-decision', (payload, envelope) => onSpaApprovalDecision(payload, envelope)),
    eventBus.subscribeMany(['reservation.cancelled', 'reservation.no_show', 'guest.checked_out'], 'spa:stay', (payload, envelope) => onStayEvent(payload, envelope, logger)),
  ];
  return stopSpaSubscribers;
}

export function stopSpaSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}
