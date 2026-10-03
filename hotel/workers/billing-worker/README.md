# billing-worker

Folyo aktörü (modül 15). Girişte folyoyu açar ve erken giriş ücretini, her
gece oda ücretlerini, çıkışta kalan geceleri ve geç çıkış ücretini işler;
bakiyesi sıfır olan folyoyu kapatır (`folio.closed`). İptal / gelmedi
ücretini, restoran (`fnb.order.charged`) ve minibar (`minibar.consumed`)
harcamalarını folyoya yazar. Giriş, çıkış ya da iptal geri alınınca kendi
işlediği ücreti ters kayıtla düşer.

Para hesabı ve kurallar serviste (`hotel/backend/src/modules/folios`); paket
yalnızca olayı doğru işe çevirir. Kapalıyken iş "Folyo" modülünün manuel
görevine düşer; personel aynı işi folyo ekranından yapar.
