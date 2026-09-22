import { BaseWorker } from '@hotelos/actor-kit';
import { reservationWorkerManifest } from './manifest.js';

/** Kanal adları (manuel görev başlığında). */
const SOURCE_LABELS = Object.freeze({
  WEBCHAT: 'Web chat',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-posta',
  WIDGET: 'Web sitesi',
  OTA: 'Online kanal',
  AGENCY: 'Acente',
  PHONE: 'Telefon',
});

/** @param {string | undefined} value ISO tarih */
const dotted = (value) => {
  const [year, month, day] = String(value ?? '').slice(0, 10).split('-');
  return year && month && day ? `${day}.${month}.${year}` : '?';
};

/**
 * Rezervasyon aktörü. Servisi dışarıdan alır (veritabanı bilmez; sahte
 * servisle test edilir).
 */
class ReservationWorker extends BaseWorker {
  /**
   * @param {{
   *   createFromChannelRequest: (payload: object) => Promise<{
   *     outcome: 'CREATED' | 'EXISTING' | 'REJECTED',
   *     reservationId?: string,
   *     confirmationCode?: string,
   *     code?: string,
   *     reason?: string,
   *   }>,
   * }} service
   * @param {object} deps BaseWorker bağımlılıkları
   */
  constructor(service, deps) {
    super(
      reservationWorkerManifest,
      {
        'reservation.requested': async (payload) => {
          const result = await service.createFromChannelRequest(payload);
          if (result.outcome === 'REJECTED') {
            return {
              message: `İstek karşılanamadı: ${result.reason}`,
              meta: { requestId: payload.requestId, code: result.code },
            };
          }
          return {
            message:
              result.outcome === 'EXISTING'
                ? `İstek daha önce işlenmiş (${result.confirmationCode})`
                : `${result.confirmationCode} numaralı rezervasyon açıldı`,
            meta: { requestId: payload.requestId, reservationId: result.reservationId },
          };
        },
      },
      deps,
    );
  }

  /**
   * @param {string} eventName
   * @param {{ guest?: { firstName: string, lastName: string }, source?: string, checkIn?: string, checkOut?: string }} payload
   */
  describeFallback(eventName, payload) {
    if (eventName !== 'reservation.requested') return super.describeFallback(eventName, payload);
    const who = payload.guest ? `${payload.guest.firstName} ${payload.guest.lastName}`.trim() : 'misafir';
    const via = SOURCE_LABELS[payload.source] ?? 'Kanal';
    return `${via} rezervasyon isteği elle açılacak: ${who}, ${dotted(payload.checkIn)} – ${dotted(payload.checkOut)}`;
  }
}

/**
 * @param {object} service
 * @param {object} deps
 */
export function createReservationWorker(service, deps) {
  return new ReservationWorker(service, deps);
}

export { reservationWorkerManifest };
