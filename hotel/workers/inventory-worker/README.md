# inventory-worker

Stok aktörü (modül 44). `fnb.order.paid` → kapanan adisyonu reçetelerinden malzemeye açar, satış noktasının deposundan
düşer (`SALE` hareketi; yeniden yayında fark düzeltmesi). `stock.changed` (satış / elle hareket / sayım) → minimum altına
inen malzeme için `STOCK` kaynaklı satın alma talebi açar, satın alma yetkilisine zil (`STOCK`).

Servis `hotel/backend/src/modules/stock/sales.js` ve `suggestions.js`; bağlama `hotel/backend/src/lib/actors.js`.
Kapalıyken satış düşümü "Stok" manuel görevine düşer; öneri atlanır (satın alma öneri ekranı aynı hesabı gösterir).
