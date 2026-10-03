import { defineActor } from '@hotelos/actor-kit';

/**
 * Folyo aktörü (modül 15, 17): konaklamanın hesabını sistemin kendi olaylarından
 * yürütür.
 *
 * Kapatılırsa hiçbir şey kaybolmaz — yapacağı işler "manuel görevler"
 * listesine düşer ve personel folyo ekranından aynı işi yapar (aynı servis,
 * aynı tekrar işleme anahtarı: aktör sonradan açılıp olay yeniden gelse de
 * kalem ikinci kez işlenmez).
 */
export const billingWorkerManifest = defineActor({
  name: 'billing-worker',
  title: 'Folyo aktörü',
  packageName: '@hotelos/billing-worker',
  type: 'worker',
  description:
    'Misafir giriş yapınca folyoyu açar ve erken giriş ücretini, her gece oda ücretlerini, çıkışta kalan geceleri ' +
    've geç çıkış ücretini işler; bakiyesi kapanan folyoyu kapatır. İptal / gelmedi ücretini, restoran ve minibar ' +
    'harcamalarını, teslim edilen çamaşırı folyoya yazar (çıkmış misafirin açık folyosuna geç kalem). ' +
    'Girişte alınan nakit / havale teminatını ödeme olarak işler. Giriş, çıkış ya da ' +
    'iptal geri alınınca kendi işlediği ücreti ve teminatı ters kayıtla düşer. Çıkmış misafirin folyosu ödemeyle ' +
    'sıfırlanınca folyoyu kapatır (fatura). Kapalıyken bu işler manuel görev olarak düşer.',
  subscribes: [
    'guest.checked_in',
    'guest.checked_out',
    'guest.check_in_reverted',
    'guest.check_out_reverted',
    'reservation.cancelled',
    'reservation.no_show',
    'reservation.reinstated',
    'folio.room_charges.due',
    'fnb.order.charged',
    'minibar.consumed',
    'laundry.charged',
    'payment.received',
    'payment.refunded',
    'payment.voided',
  ],
  publishes: [
    'folio.opened',
    'folio.charge.posted',
    'folio.room_charges.posted',
    'folio.item.voided',
    'folio.closed',
    'folio.reopened',
    'folio.routes.changed',
    'payment.received',
    'payment.requested',
    'payment.voided',
  ],
  retry: { attempts: 3, backoffMs: 400 },
  fallbackModule: 'Folyo',
});
