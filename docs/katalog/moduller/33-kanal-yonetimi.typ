#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Müsaitlik, fiyat ve stop-sale değişince Booking.com, Expedia, Airbnb, Agoda gibi kanallara Channex.io üzerinden kendiliğinden gider; kanaldan gelen rezervasyon onaylı olarak, OTA'nın tutarıyla sisteme düşer. iCal takvimleriyle (Airbnb, Booking) iki yönlü eşitleme de vardır. Oda tipleri ve fiyat planları kanal tipleriyle eşleştirilir; her gönderim ve gelen kayıt senkron logunda izlenir, işlenemeyen kayıt resepsiyona görev olarak düşer.],
  rakam: (("Yalnız fark", "en son gönderilenle karşılaştırılır"), ("500 gün", "tam eşitleme ~0,8 sn"), ("2 çağrı", "bir eşitleme turunda en çok"), ("0 kayıp", "her revizyon önce saklanır, sonra teyit")),
  adimlar: (("Değişiklik", "rezervasyon · fiyat · arıza"), ("Kirli pencere", "gün aralığı birikir"), ("Fark", "müsaitlik · fiyat · stop-sale"), ("Channex", "OTA'lara dağıtır"), ("Gelen", "rezervasyon · değişiklik · iptal")),
  akis-aciklama: [Gönderim isteğin yolunda değildir: zamanlanmış iş 5 sn'de bir birikmiş değişiklikleri toplar, kanal başına en sık 10 sn'de bir gönderir (Channex sınırı).],
  ozellik: (
    ("Kanal kartı", "Ayarlar (bağlantı, webhook), eşleştirme, stop-sale, senkron logu, kanal rezervasyonları; zamanlar otelin saatiyle."),
    ("Eşleştirme", "Oda tipi ↔ Channex oda tipi, pansiyon ↔ fiyat planı; iCal'de takvim adresi ve kopyalanabilir dışa aktarma adresi."),
    ("OTA rezervasyonu", "Oda başına onaylı rezervasyon, misafir kartı, not (kanal, kod, ödeme kimde). Yer yoksa reddedilmez: kapasite aşılarak açılır, resepsiyona kritik overbooking uyarısı."),
    ("Değişiklik ve iptal", "Değişiklik rezervasyonu günceller (azalan oda iptal), iptal cezasızdır; eski revizyon yenisinin üstüne yazılmaz."),
    ("iCal", "Takvimdeki dolu günler rezervasyon olarak açılır (\"doğrulanmalı\"); takvimden kalkan, gelinmemiş rezervasyon iptal edilir; takvim birden boş gelirse toplu iptal yapılmaz."),
    ("Kanal stop-sale'i", "Kanala özel kapatma; otel genelindeki acente stop-sale'inden ayrı."),
  ),
  neden: [Kanal fiyatı ve müsaitliği elle güncellemek hem personel saati hem overbooking riskidir; fark gönderimi kanalı saniyeler içinde güncel tutar, gelen hiçbir rezervasyon kaybolmaz.],
  rol: (([Müdür], [Kanal açar, eşleştirir, stop-sale ve elle senkron yapar.]), ([Görüntüleyen], [Kanalları ve logu izler.]), ([Resepsiyon], [\"Elle işlenmeli\" kanal rezervasyonu görevlerini yapar.])),
  baglantilar: ("*Oda planı (5):* müsaitlik oda planının takviminden.", "*Ayarlar (1):* fiyat = taban × sezon + kanal farkı %.", "*Rezervasyon (4):* kanal rezervasyonu detayda kanal, kod ve durumla.", "*Aktör paneli (12):* kanal eşitleme aktörü panelde; işlenemeyen kayıt personele \"Kanal rezervasyonu\" görevi olarak düşer."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/channel-manager` (kanal kartı, eşleştirme, stop-sale, log, webhook, iCal dışa aktarma) ve `@hotelos/channel-sync-worker` aktörü (fark / aralık hesabı, iCal okuma-yazma, Channex istemcisi ve hata sınıfları, normalleştirme). Envanter olayları ve `rate.changed` kanalı kirli işaretler (`ChannelState`: kirli pencere, tam eşitleme isteği, bekleme — kanal ayarının sürümü arka plan gönderimiyle ilerlemez). Değerler `channel-manager/ari.js → computeRoomTypeValues`'ta hesaplanır ve `ChannelAriState`'teki son gönderilenle karşılaştırılır; ardışık aynı değerler tek aralıkta, müsaitlik oda tipine, fiyat + stop-sale fiyat planına gider.],
  kural: (
    ("Tam eşitleme", "500 gün, iki çağrı: senkrona alınınca, eşleştirme / fiyat farkı değişince, elle ve gece (otelin saatiyle 02–05) bir kez."),
    ("Hata ve bekleme", "Pencere geri işaretlenir; 429'da 1 dk, anahtar hatasında 30 dk, geçici hatada 30 sn × 2ⁿ (en çok 15 dk). 3 art arda hatada ya da anahtar hatasında müdüre uyarı; kanalın reddettiği satırlar logda \"kısmen\"."),
    ("Gelen revizyon", "Dakikada bir okunur, webhook gelince hemen (sır başlıkta, sabit zamanlı karşılaştırma). Önce saklanır, sonra teyit edilir; kart bilgisi saklanmaz. Aynı rezervasyonun revizyonları sırayla."),
    ("Elle işlenmeli", "Eşleşmeyen plan, içerideki / çıkmış misafir, geçmiş giriş, elle fiyatlı rezervasyonun tarihi → resepsiyona görev; para birimi farkı ve iCal tutarı \"doğrulanmalı\". Müdür gereğini yapınca kaydı notla kapatır."),
    ("iCal güvenliği", "Dışa aktarma gizli belirteçle, oturumsuz, 60 sn önbellek; kendi kayıtlarımız UID sonekiyle tanınır (geri yansıma döngüsü yok). İçe aktarma yalnız https, özel ağa çözülen ad / yönlendirme reddedilir, 2 MB / 15 sn sınırı."),
  ),
  tutarlilik: (
    "API anahtarı ve webhook sırrı şifreli; Channex mülkü bütün kanallarda tekil (kısmi index); ad otel içinde tekil.",
    "Aktör kapalıyken gönderim tetikleyicileri görev açmadan atlanır (actor-kit `skipWhenDisabled` kancası; açılınca tam eşitleme); gelen rezervasyon ise göreve düşer.",
    "Kart sürüm kontrollü; bağlantı kayıtta yeniden doğrulanır; mülk değişirse eşleştirme silinir. Kanal yalnız durmuşken silinir (yumuşak silme).",
    "Senkron logu 90 gün; uyarı türleri `CHANNEL_BOOKING`, `CHANNEL_SYNC`.",
  ),
  olcek: (("500 günlük değer hesabı", "~0,5 sn"), ("Tam eşitleme", "~0,8 sn"), ("Olay başına işaretleme", "2–3 ms"), ("3 gecelik fark gönderimi", "~60 ms"), ("Listeler (100 bin log, 20 bin kayıt)", "9–67 ms")),
  olcek-not: [Ölçüm `scripts/perf-channels.mjs`: 550 bin rezervasyonlu veritabanı, ufukta 99 bin, 12 oda tipi × 2 plan.],
  degistir: (
    ("Fiyat kaynağı", "Kanala giden fiyat `ari.js → computeRoomTypeValues` (şimdilik taban × sezon); fiyat planı (28) ve yield (34) `rate.changed` yayınlamalı."),
    ("Yeni kanal türü", "Aktör paketine istemci + normalleştirme (birim testli), `Channel` türü + CHECK'ler, kart sekmesi; gönderim ve gelen kayıt akışı aynı kalır."),
  ),
  devir: ("Promosyon kanala gitmez; pansiyon farkı fiyat planı modülüyle gelir (o zamana kadar bir tipin bütün planları aynı fiyatı alır).", "Gerçek kanallara bağlanmak için otelin Channex hesabı, mülk kimliği ve API anahtarı gerekir; PMS sertifikasyonu kanıtları senkron logunda (görev kimlikleri)."),
)
