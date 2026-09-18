import { defineActor } from '@hotelos/actor-kit';

/**
 * Rezervasyon aktörü: async kanallardan (web chat, WhatsApp, OTA — modül 8/32/33)
 * gelen rezervasyon talebini doğrular ve açar ya da yer yoksa reddeder.
 *
 * Resepsiyonun elle açtığı rezervasyon bu aktörden geçmez (senkron HTTP). Bu
 * aktör modül 8 gelene kadar dinlenecek olay yayınlanmadığı için pasiftir;
 * deseni ve sözleşmeyi şimdiden kurar. Kapatılırsa talepler manuel göreve düşer.
 */
export const reservationWorkerManifest = defineActor({
  name: 'reservation-worker',
  type: 'worker',
  description:
    'Async kanaldan gelen rezervasyon talebini müsaitlik/fiyatla açar (reservation.created) ' +
    'ya da yer yoksa reddeder (reservation.rejected). Kapalıyken talepler manuel göreve düşer.',
  subscribes: ['reservation.requested'],
  publishes: ['reservation.created', 'reservation.rejected'],
  retry: { attempts: 3, backoffMs: 400 },
  fallbackModule: 'Rezervasyon işleme',
});
