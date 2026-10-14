import { defineActor } from '@hotelos/actor-kit';
import { INVENTORY_CHANGED_EVENTS } from '@hotelos/core';

/** Aktörün adı (aktör ayarı, manuel görev, aktivite izi bununla). */
export const CHANNEL_SYNC_WORKER_NAME = 'channel-sync-worker';

/**
 * Kanal aktörü (modül 33).
 *
 * İki işi var:
 * 1. **Gönderim tetikleyicisi.** Müsaitliği (envanter olayları) ya da satış
 *    fiyatını (`rate.changed`) etkileyen her değişiklikte senkrondaki kanalları
 *    "gönderilecek değişiklik var" diye işaretler. Gönderimin kendisi zamanlanmış
 *    işte yapılır: farkı birleştirir, kanalın hız sınırına uyar. Kapalıyken bu
 *    olaylar atlanır (personele görev düşmez); aktör yeniden açılınca tam
 *    eşitleme istenir.
 * 2. **Gelen rezervasyon.** Kanaldan gelip saklanan her revizyonu (yeni,
 *    değişiklik, iptal) rezervasyona işler. Yapamazsa (eşleşmeyen oda tipi,
 *    içerideki misafirde değişiklik) ya da kapalıyken iş resepsiyonun önüne
 *    manuel görev olarak düşer.
 */
export const channelSyncWorkerManifest = defineActor({
  name: CHANNEL_SYNC_WORKER_NAME,
  title: 'Kanal aktörü',
  packageName: '@hotelos/channel-sync-worker',
  type: 'worker',
  description:
    'Müsaitlik ya da fiyat değişince bağlı kanalları (Channex, iCal) işaretler; zamanlanmış iş farkı birleştirip kanala gönderir. ' +
    'Kanaldan gelen rezervasyonu (yeni, değişiklik, iptal) açar / değiştirir / iptal eder. Kapalıyken kanala hiçbir şey gitmez ' +
    '(açılınca tam eşitleme yapılır); gelen rezervasyonlar manuel görev olarak resepsiyona düşer.',
  subscribes: [...INVENTORY_CHANGED_EVENTS, 'rate.changed', 'actor.setting.changed', 'channel.booking.received'],
  publishes: ['reservation.created', 'reservation.updated', 'reservation.cancelled', 'channel.booking.changed'],
  retry: { attempts: 3, backoffMs: 1000 },
  fallbackModule: 'Kanal rezervasyonu',
});
