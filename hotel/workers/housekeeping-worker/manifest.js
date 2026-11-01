import { defineActor } from '@hotelos/actor-kit';

/**
 * Kat hizmeti aktörü: misafir çıkınca ve arıza kaydı kapanınca temizlik görevi
 * açar; misafirin kat isteğini (havlu, yastık) göreve çevirir; görevli
 * "Başladım / Bitti" dedikçe ve kat şefi kontrol ettikçe odanın kat hizmeti
 * durumunu günceller.
 *
 * Kapatılırsa hiçbir şey kaybolmaz — görev üretimi ve oda durumu güncellemesi
 * "manuel görevler" listesine düşer, personel elle yapar. Misafir isteği zaten
 * istek ekranında (modül 7) görünür olduğundan sessizce atlanır.
 */
export const housekeepingWorkerManifest = defineActor({
  name: 'housekeeping-worker',
  title: 'Kat hizmeti aktörü',
  packageName: '@hotelos/housekeeping-worker',
  type: 'worker',
  description:
    'Misafir çıkışında çıkış temizliği, arıza kaydı kapanınca detaylı temizlik görevi açar; ' +
    'misafirin kat isteğini göreve çevirir. Görevli başlayınca odayı "Temizleniyor", bitirince ' +
    '"Temiz", kat şefi onaylayınca "Kontrol edildi" yapar; bağlı misafir isteğini kapatır. ' +
    'Kapalıyken bu işler manuel görev olarak düşer.',
  subscribes: [
    'guest.checked_out',
    'guest.check_out_reverted',
    'room.unblocked',
    'guest.request.created',
    'housekeeping.task.started',
    'housekeeping.task.completed',
    'housekeeping.room.inspected',
  ],
  publishes: ['housekeeping.task.created', 'housekeeping.task.changed', 'room.status.changed', 'guest.request.updated'],
  retry: { attempts: 3, backoffMs: 400 },
  fallbackModule: 'Kat hizmeti',
});
