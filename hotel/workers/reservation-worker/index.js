import { BaseWorker } from '@hotelos/actor-kit';
import { reservationWorkerManifest } from './manifest.js';

/**
 * İş kuralı hatası (4xx) tekrar denemekle düzelmez — beklemeden personelin
 * önüne düşmeli. Yer yokluğu (NO_AVAILABILITY) ise hata değil, geçerli bir
 * sonuçtur (reddetme) — servis onu event'le bildirir, buraya hata gelmez.
 * @param {unknown} error
 */
function markBusinessErrorsFinal(error) {
  const status = /** @type {{ statusCode?: number }} */ (error)?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    /** @type {{ retryable?: boolean }} */ (error).retryable = false;
  }
  return error;
}

/**
 * Rezervasyon aktörü. Servisi dışarıdan alır (worker paketi Prisma/HTTP bilmez).
 */
class ReservationWorker extends BaseWorker {
  /**
   * @param {{
   *   requestReservation: (hotelId: string, payload: object) => Promise<{ created?: { id: string, confirmationCode: string }, rejected?: boolean, reason?: string }>,
   * }} service
   * @param {object} deps BaseWorker bağımlılıkları
   */
  constructor(service, deps) {
    super(
      reservationWorkerManifest,
      {
        'reservation.requested': async (payload) => {
          let result;
          try {
            result = await service.requestReservation(payload.hotelId, payload);
          } catch (error) {
            throw markBusinessErrorsFinal(error);
          }

          if (result.rejected) {
            return { message: `Yer bulunamadı; talep reddedildi (${result.reason})`, meta: { requestId: payload.requestId ?? null } };
          }
          return {
            message: `Rezervasyon açıldı: ${result.created.confirmationCode}`,
            meta: { reservationId: result.created.id, confirmationCode: result.created.confirmationCode },
          };
        },
      },
      deps,
    );
  }

  describeFallback(eventName, payload) {
    if (eventName === 'reservation.requested') return 'Gelen rezervasyon talebi elle işlenecek';
    return super.describeFallback(eventName, payload);
  }
}

/**
 * @param {object} service
 * @param {object} deps
 * @returns {ReservationWorker}
 */
export function createReservationWorker(service, deps) {
  return new ReservationWorker(service, deps);
}

export { reservationWorkerManifest };
