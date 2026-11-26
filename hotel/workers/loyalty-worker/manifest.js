import { defineActor } from '@hotelos/actor-kit';

/**
 * Sadakat aktörü (modül 56): misafire puan kazandırır ve kazanılanı düzeltir.
 *
 * Kapatılırsa iş "Sadakat" manuel görevine düşer (yetkili, hesapta elle düzeltmeyle tamamlar). Kazanma kaynağa göre
 * hedefe eşitlendiğinden aktör yeniden açılıp aynı olay gelse de puan iki kez yazılmaz.
 */
export const loyaltyWorkerManifest = defineActor({
  name: 'loyalty-worker',
  title: 'Sadakat aktörü',
  packageName: '@hotelos/loyalty-worker',
  type: 'worker',
  description:
    'Folyo kapanınca konaklamanın misafirine uygun harcamadan (vergi kalemleri hariç) seviyesinin çarpanıyla puan kazandırır; ' +
    'folyo yeniden açılınca kazanılanı geri alır, yeniden kapanınca farkı yazar. Spa kasasında ödenen tamamlanmış randevuya ' +
    '(ayarda açıksa) puan verir. Puanla yapılan folyo indirimi iptal edilince puanı iade eder. Seviye yükselince ön büroya ' +
    'haber verir. Kapalıyken iş sadakat yetkilisine manuel görev olarak düşer.',
  subscribes: ['folio.closed', 'folio.reopened', 'folio.item.voided', 'spa.appointment.changed'],
  publishes: ['loyalty.points.changed', 'loyalty.tier.changed', 'staff.alert.raised'],
  retry: { attempts: 3, backoffMs: 400 },
  fallbackModule: 'Sadakat',
});
