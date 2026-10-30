# accounting-worker

Muhasebe aktörü (modül 47). Ön büro, etkinlik ve restoran tahsilatlarını yöntem eşlemesine göre kasaya / bankaya
işler; "Acente / cari" ve voucher'la kapatılan folyoyu seçilen cariye borç yazar. Etkinlik tahsilatını müşteri
carisinden düşer, gerçekleşen etkinliğin bedelini müşteri carisine yazar. Mal kabulü (`purchase.goods.received`)
tedarikçi carisine vadeli borcumuz olarak, onaylanan acente primini acente carisine alacak olarak işler. Ödeme
iptalini ters kayıtla düşer.

Kurallar ve tutarlar serviste (`hotel/backend/src/modules/accounting/postings.js`); paket olayı doğru işe çevirir.
Servis kaynak belgeden okur ve idempotenttir (kaynak anahtarı tekil): aynı olay iki kez gelse de kayıt bir kez
yazılır. Kapalıyken ya da işleyemediğinde (eşleme yok, cari seçilmemiş) iş "Ön muhasebe" manuel görevine düşer;
muhasebeci sorunu düzeltip Muhasebe → Eşitle ile dönemi tamamlar.
