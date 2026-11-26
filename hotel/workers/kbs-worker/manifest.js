import { defineActor } from '@hotelos/actor-kit';

/**
 * KBS aktörü (modül 58): konaklama olaylarından kişi başına kimlik bildirimi açar; gönderimi KBS göndericisi yapar.
 *
 * Kapatılırsa iş "KBS" manuel görevine düşer: bildirim yasal yükümlülüktür, personel KBS ekranından elle bildirir. Bildirimin
 * kaynak anahtarı tekil olduğundan aktör yeniden açılıp aynı olay gelse de ikinci bildirim açılmaz.
 */
export const kbsWorkerManifest = defineActor({
  name: 'kbs-worker',
  title: 'KBS aktörü',
  packageName: '@hotelos/kbs-worker',
  type: 'worker',
  description:
    'Misafir girince belgesi girilmiş her kişi (rezervasyon sahibi ve refakatçiler) için KBS giriş bildirimini sıraya alır; ' +
    'çıkışta çıkış, içerideyken oda değişince oda değişikliği bildirimi açar. Giriş geri alınırsa gönderilmemiş bildirimi iptal ' +
    'eder, gönderilmişse çıkışla kapatır; çıkış geri alınırsa yeniden giriş bildirir. Zorunlu bilgisi eksik kişide ön büroya zil ' +
    'çalar. Kapalıyken iş KBS yetkilisine manuel görev olarak düşer.',
  subscribes: ['guest.checked_in', 'guest.checked_out', 'guest.check_in_reverted', 'guest.check_out_reverted', 'room.assigned'],
  publishes: ['kbs.notification.changed', 'staff.alert.raised'],
  retry: { attempts: 3, backoffMs: 400 },
  fallbackModule: 'KBS',
});
