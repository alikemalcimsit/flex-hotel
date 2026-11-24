import { defineActor } from '@hotelos/actor-kit';

/**
 * Stok aktörü (modül 44): restoranın kapanan adisyonunu reçetelerinden malzemeye açıp satış noktasının deposundan
 * düşer; miktarı değişen malzeme minimumun altına inmişse satın alma talebi açar (kaynak: stok) ve satın alma
 * yetkilisine zil çalar.
 *
 * Kapatılırsa satış düşümü "Stok" manuel görevine düşer (stok yetkilisi elle çıkış hareketiyle tamamlar; adisyon
 * numarası görevde). Minimum altı önerisi kapalıyken atlanır: satın alma ekranındaki öneri listesi aynı hesabı
 * her an gösterir, kaçan iş yoktur.
 */
export const inventoryWorkerManifest = defineActor({
  name: 'inventory-worker',
  title: 'Stok aktörü',
  packageName: '@hotelos/inventory-worker',
  type: 'worker',
  description:
    'Kapanan adisyonun ürünlerini (satılan, ikram, hazırlanıp iptal edilen) reçetelerinden malzemeye açar ve satış ' +
    'noktasının deposundan düşer; adisyon yeniden açılıp kapanırsa farkı düzeltir. Reçetesi olmayan ürünü atlar, ' +
    'tepsi / paket ücretini düşmez. Çıkış, fire, transfer ya da sayımla miktarı değişen malzeme minimumun altına ' +
    'inmişse (yoldaki ve talepteki düşüldükten sonra) satın alma talebi açar ve satın alma yetkilisine haber verir. ' +
    'Kapalıyken satış düşümü stok yetkilisine manuel görev olarak düşer.',
  subscribes: ['fnb.order.paid', 'stock.changed'],
  publishes: ['stock.changed', 'purchase.request.changed', 'staff.alert.raised'],
  retry: { attempts: 3, backoffMs: 400 },
  fallbackModule: 'Stok',
});
