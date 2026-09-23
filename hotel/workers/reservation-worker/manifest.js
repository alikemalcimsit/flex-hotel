import { defineActor } from '@hotelos/actor-kit';

/**
 * Rezervasyon aktörü: kanaldan gelen rezervasyon isteğini (`reservation.requested`)
 * rezervasyon servisine verir.
 *
 * Sonuç ya açılan rezervasyondur (`reservation.created`) ya da gerekçeli ret
 * (`reservation.rejected`: yer yok, kapasite, geçersiz tarih). Ret bir hata
 * değildir; kanal (modül 8) misafire cevap olarak iletir. Beklenmeyen hata
 * yeniden denenir, olmazsa personelin önüne manuel görev düşer.
 *
 * Kapatılırsa kanal istekleri manuel görev olarak personele düşer: personel
 * rezervasyonu elle açar.
 */
export const reservationWorkerManifest = defineActor({
  name: 'reservation-worker',
  type: 'worker',
  description:
    'Kanaldan (WhatsApp, web chat, e-posta, OTA) gelen rezervasyon isteğini müsaitlik ve fiyat denetimiyle açar; ' +
    'yer yoksa gerekçeli ret yayınlar. Kapalıyken istekler manuel görev olarak personele düşer.',
  subscribes: ['reservation.requested'],
  publishes: ['reservation.created', 'reservation.rejected'],
  retry: { attempts: 3, backoffMs: 500 },
  fallbackModule: 'Rezervasyon',
});
