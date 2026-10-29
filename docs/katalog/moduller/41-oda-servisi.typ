#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Oda servisi siparişi telefonla personelden, misafirin odasındaki QR koddan ya da bir misafir isteğinden açılır; hemen ya da ileri saatli (kahvaltı kartı) olabilir. Sipariş mutfağa düşer, pano onay bekleyen / mutfakta / hazır / yolda sütunlarında hedefe kalan süreyi gösterir. Teslimde tutar varsayılan olarak odaya yazılır, misafir isterse kapıda nakit ya da kartla öder; teslimden sonra tepsi toplanana kadar izlenir.],
  rakam: (("QR", "misafir odadan kendisi sipariş verir"), ("Tek işlem", "teslim: ödeme + odaya yaz + kapanış"), ("24 saat", "tepsi toplama takibi"), ("25 ms", "pano, 220 bin siparişte")),
  adimlar: (("Sipariş", "personel · QR · istek"), ("Kabul", "misafir siparişi onaylanır"), ("Mutfak", "hazırlanıyor → hazır"), ("Yolda", "götüren · süre"), ("Teslim", "odaya yaz · kapıda öde")),
  ozellik: (
    ("Pano", "Onay bekleyen (QR), mutfakta, hazır, yolda; hedefe kalan süre ve gecikme, planlı ve tepsi sayaçları, vardiya çubuğu."),
    ("Kahvaltı kartı", "İleri saatli toplu sipariş; hazırlık listesi 15 dk aralıklarla ürün toplamı (notlu kalem ayrı), yarın varsayılan, yazdırılır."),
    ("Misafir QR", "Rezervasyondan imzalı oda servisi bağlantısı ve basılı oda kartı; oda değişince ve çıkışta kendiliğinden geçersiz."),
    ("İstekten siparişe", "Misafir isteğinin detayında \"Siparişe çevir\"; teslimde istek de tamamlanır."),
    ("Tepsi ücreti", "Sipariş başına sabit ücret (politika; 0 = yok), adisyonda ayrı kalem; şef garson ikram edebilir."),
    ("Toplanacak tepsiler", "Teslim edilen tepsiler kat görevlisinin de gördüğü listede; toplu toplama."),
  ),
  neden: [Oda servisinde şikâyetin kaynağı gecikme ve kaybolan siparişlerdir; her adımın zamanı ve sorumlusu panoda görünür, misafirin QR siparişi kimse kabul etmezse sessizce beklemez.],
  rol: (([Oda servisi / garson], [Sipariş, adım, teslim.]), ([Şef garson (rol matrisinden; varsayılan müdür)], [Mutfaktaki siparişi iptal, ikram.]), ([Kat hizmeti, ön büro], [Tepsi toplama ve QR bağlantısı.]), ([Muhasebe], [Oda servisi raporu.])),
  baglantilar: ("*Restoran POS (39):* aynı adisyon, tur, ödeme ve odaya yaz çekirdeği; oda servisi bir satış noktası türü.", "*Folyo (15):* odaya yazılan sipariş (kalem adı \"Oda Servisi · OS-…\"), folyoda birebir tutar.", "*Misafir istekleri (7):* istekten siparişe; teslimde istek kapanır.", "*Misafir sayfası (53):* QR'ın açtığı sayfa; uçlar ve sözleşme hazır."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/pos/room-service*.js`: personel servisi, misafir uçları (`room-service-guest.js`), okuma (`room-service-read.js`), korumalar (`room-service-guards.js` — oda servisi adisyonu bölünmez, taşınmaz, birleşmez), dakikalık iş (`room-service-jobs.js`) ve saf kurallar (`room-service-rules.js` + sözleşme `room-service.js`). `RoomServiceOrder` (OS-yıl-sıra; kaynak personel / QR / istek) adisyonla 1:1; mutfağa düşüş masasız adisyon + tur + tepsi ücreti kalemi açar. Restoranın tur yazımı, ödeme ve odaya yaz ortak çekirdeğe alındı (`addOrderRound`, `takePayment`, `postRoomCharge`).],
  kural: (
    ("Durumlar", "REQUESTED → SCHEDULED → RECEIVED → PREPARING → READY → ON_THE_WAY → DELIVERED, CANCELLED / REJECTED; mutfak adımları atlanabilir, yoldan hazıra geri dönülebilir."),
    ("Zamanlama", "Hemen: düşüş + hedef. İleri saatli: teslim − hazırlık payında düşer (o an geçmişse hemen). İstenen an ≥ 10 dk, ≤ 3 gün, çıkış gününden sonra değil; otelin duvar saatiyle."),
    ("Teslim", "Tek transaction: kapı ödemeleri + kalanın odaya yazılması + adisyonun kapanması + turların servis edildisi + isteğin tamamlanması. Teslimden önce ödeme / kapatma yok; kapı ödemesinde fazla ya da ödenmemiş kalan reddedilir."),
    ("Oda değişimi", "Misafir sipariş verdikten sonra oda değiştirdiyse düşüşte şimdiki oda yazılır; konaklaması bitenin mutfağa düşmemiş siparişi iptal edilir."),
    ("QR güvenliği", "Bağlantı imzası JWT sırrından türetilen anahtarla HMAC (veritabanı okunsa da üretilemez); IP başına hız sınırı (menü 60, durum 120, yazma 10 / dk); konaklamada en çok 3 açık misafir siparişi; kabul edilmezse teslim hedefini 30 dk aşınca kendiliğinden reddedilir."),
  ),
  tutarlilik: (
    "Kilit sırası: vardiya → adisyon → sipariş → rezervasyon → istek / bağlantı (`locks.js`).",
    "Personel işlemleri sürümle; istek kimliğiyle çift dokunuşta tek kayıt (teslim dahil); eşzamanlı teslim ve kabul / ret testli.",
    "Konaklamada tek geçerli bağlantı ve istek başına tek bitmemiş sipariş — kısmi tekil index'ler.",
    "Uyarı damgaları ham SQL'le yazılır (ekrandaki sürüm bozulmaz); her sipariş her uyarıyı bir kez alır.",
  ),
  olcek: (("Pano", "25 ms"), ("Geçmiş (derin sayfa 3000)", "31 / 53 ms"), ("Hazırlık listesi (400 kart)", "40 ms"), ("Misafir menüsü / siparişi", "18 / 58 ms"), ("Rapor 31 gün", "28 ms"), ("Sipariş → teslim", "384 ms")),
  olcek-not: [Ölçüm `scripts/perf-room-service.mjs`: ≈219.600 sipariş, restoranın 587.000 adisyonu üstünde. Ölçümle yapılan iyileştirmeler: tepsi listesinin sınırsız büyümesi (24 saat penceresi; pano 92 → 25 ms) ve raporda ciro sorgusunun 1,7 milyon kalemi taraması (480 → 28 ms).],
  degistir: (
    ("Misafir sayfası (53)", "Yol `ROOM_SERVICE_GUEST_PATH`; veri `GET /public/room-service/:token`, durum `…/orders`, sipariş `POST …/orders` (`publicRoomServiceOrderSchema`), iptal `…/orders/:id/cancel`. Hata kodları `LINK_EXPIRED`, `GUEST_ORDERING_CLOSED`, `GUEST_ORDER_LIMIT`, 429."),
    ("QR görseli", "`lib/qr.js → qrSvg` (`qrcode-generator`, MIT, bağımlılıksız)."),
  ),
  devir: ("Misafirin gördüğü QR sayfası modül 53'te; bu modülde imzalı bağlantı, uçlar ve sözleşme hazır.", "Stok düşümü `fnb.order.paid` (iptalde zayi) ile stok modülüne bağlanacak."),
)
