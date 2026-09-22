# reservation-worker

Kanaldan (WhatsApp, web chat, e-posta, OTA) gelen rezervasyon isteğini
(`reservation.requested`) işleyen aktör (modül 4).

- Servis: backend `modules/reservations/service.js → createFromChannelRequest`.
- Sonuç: `reservation.created` ya da gerekçeli `reservation.rejected` (ret bir
  hata değildir; kanal misafire cevap olarak iletir).
- Aynı `requestId` ikinci rezervasyon açmaz.
- Kanal isteği varsayılan olarak **opsiyonlu** açılır (personel onaylar) ve
  otelin overbooking politikasından bağımsız olarak onaya gitmez: yer yoksa
  reddedilir.
- Kapalıyken istek "manuel görev" olarak personele düşer.
