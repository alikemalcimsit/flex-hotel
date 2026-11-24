import { eventBus } from '../../lib/events.js';
import { applySuggestionDecision } from './yield-service.js';

/**
 * Dinamik fiyat onay kararlarının uygulayıcısı (modül 34): M11 kuyruğundaki
 * `BULK_PRICE_CHANGE` kararı buradaki subscriber'la öneriye işlenir. Karar
 * olayı her onay için gelir; öneriye bağlı değilse tek indeksli okuma ile
 * sessizce geçilir (`approvalId` tekil indeksli).
 */

let unsubscribers = [];
/** @type {{ warn: Function, error: Function }} */
let log = console;

export function setPricingSubscriberLogger(logger) {
  log = logger;
}

export function registerPricingSubscribers() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  const handle = (decision) => async (payload) => {
    try {
      await applySuggestionDecision(payload.hotelId, payload.approvalId, decision, payload.decidedBy ?? null);
    } catch (error) {
      // Karar kaybolmaz: onay kaydı duruyor; ekran bekleyen öneriyi gösterir,
      // personel yeniden karar verebilir. Log'a tam sebep düşer.
      log.error({ err: error, approvalId: payload.approvalId }, 'Fiyat önerisi kararı uygulanamadı');
    }
  };
  unsubscribers = [
    eventBus.subscribe('approval.granted', 'pricing-suggestions', handle('GRANTED')),
    eventBus.subscribe('approval.denied', 'pricing-suggestions', handle('DENIED')),
    eventBus.subscribe('approval.expired', 'pricing-suggestions', handle('EXPIRED')),
  ];
}
