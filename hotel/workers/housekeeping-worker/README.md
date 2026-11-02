# housekeeping-worker

Kat hizmeti aktörü (modül 14). Misafir çıkınca **çıkış temizliği**, arıza kaydı
kapanınca **detaylı temizlik** görevi açar; misafirin kat isteğini (havlu,
yastık) göreve çevirir. Görevli "Başladım / Bitti" dedikçe ve kat şefi kontrol
ettikçe odanın kat hizmeti durumunu `applySystemRoomState` ile günceller.

Kapalıyken hiçbir iş kaybolmaz: görev üretimi ve oda durumu güncellemesi manuel
görev olarak personele düşer. Misafir isteği sessizce atlanır — istek zaten
kendi ekranında (modül 7) görünür.

## Dinledikleri

| Event | İş |
|---|---|
| `guest.checked_out` | `CHECKOUT_CLEAN` görevi aç (odanın açık temizlik görevi varsa açma) |
| `guest.check_out_reverted` | Açık çıkış temizliği görevini iptal et |
| `room.unblocked` (`mode: ENDED`) | `DEEP_CLEAN` görevi aç (bakım tozu) |
| `guest.request.created` (`HOUSEKEEPING` / `AMENITY`) | `GUEST_REQUEST` görevi aç, isteğe bağla |
| `housekeeping.task.started` (temizlik tipleri) | Oda → `CLEANING` |
| `housekeeping.task.completed` | Oda → `CLEAN`; bağlı isteği kapat |
| `housekeeping.room.inspected` | Oda → `INSPECTED` ya da yeniden `DIRTY` |

## Servis sözleşmesi

Backend `lib/actors.js` şunları verir: `createCleaningTask`,
`createRequestTask`, `cancelOpenCheckoutTasks` (housekeeping servisi),
`applySystemRoomState` (rooms servisi), `completeGuestRequest`
(guest-requests servisi). Worker Prisma ve HTTP bilmez; sahte servisle
veritabanısız test edilir (`npm test`).

Sabah STAYOVER üretimi bu aktörde değil, backend zamanlayıcısındadır
(`modules/housekeeping/jobs.js`): üretim olaya değil güne bağlıdır ve aktör
kapalıyken de ertesi sabah görev listesi dolu olmalıdır.
