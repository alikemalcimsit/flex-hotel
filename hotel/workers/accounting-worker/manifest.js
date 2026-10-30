import { defineActor } from '@hotelos/actor-kit';

/**
 * Muhasebe aktörü (modül 47): sistemin para olaylarını ön muhasebeye işler — cari ve kasa / banka hareketleri.
 *
 * Kapatılırsa hiçbir şey kaybolmaz: kayıtlar yazılmaz, iş "Ön muhasebe" manuel görevine düşer; muhasebeci
 * eşleme / cari sorununu düzeltip Muhasebe → Eşitle ile dönemi tamamlar (aynı servis, aynı kaynak anahtarı:
 * aktör sonradan açılıp olay yeniden gelse de kayıt ikinci kez yazılmaz).
 */
export const accountingWorkerManifest = defineActor({
  name: 'accounting-worker',
  title: 'Muhasebe aktörü',
  packageName: '@hotelos/accounting-worker',
  type: 'worker',
  description:
    'Ön büro, etkinlik ve restoran tahsilatlarını yöntem eşlemesine göre kasaya / bankaya işler; "Acente / cari" ve ' +
    "voucher'la kapatılan folyoyu seçilen cariye borç yazar. Etkinlik tahsilatını müşteri carisinden düşer, gerçekleşen " +
    'etkinliğin bedelini (iptalde iptal bedelini) müşteri carisine borç yazar. Mal kabulü tedarikçi carisine vadeli ' +
    'borcumuz olarak, onaylanan acente primini acente carisine alacak olarak işler. Ödeme iptalini ters kayıtla düşer. ' +
    'Kapalıyken ya da işleyemediğinde iş manuel görev olarak düşer.',
  subscribes: [
    'payment.received',
    'payment.refunded',
    'payment.voided',
    'banquet.payment.changed',
    'pos.payment.changed',
    'purchase.goods.received',
    'agency.bonus.changed',
    'banquet.event.changed',
  ],
  publishes: ['accounting.posted'],
  retry: { attempts: 3, backoffMs: 400 },
  fallbackModule: 'Ön muhasebe',
});
