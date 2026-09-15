import { defineActor } from '@hotelos/actor-kit';

/**
 * Oda aktörü: rezervasyon açılınca oda seçer, misafir girip çıkınca odanın
 * durumunu günceller.
 *
 * Kapatılırsa hiçbir şey kaybolmaz — yapacağı işler "manuel görevler"
 * listesine düşer ve personel elle yapar. Otelin bu aktör olmadan da
 * çalışabilmesi tasarımın gereği.
 */
export const roomWorkerManifest = defineActor({
  name: 'room-worker',
  type: 'worker',
  description:
    'Yeni rezervasyona uygun odayı otomatik seçip atar; misafir giriş yapınca odayı dolu, ' +
    'çıkış yapınca boş ve kirli olarak işaretler. Kapalıyken bu işler manuel görev olarak düşer.',
  subscribes: ['reservation.created', 'guest.checked_in', 'guest.checked_out'],
  publishes: ['room.assigned', 'room.status.changed'],
  retry: { attempts: 3, backoffMs: 400 },
  fallbackModule: 'Oda atama',
});
