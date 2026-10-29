#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Bulunan her eşya fotoğraflı kayda girer ve poşete yazılan bir etiket numarası (`LF-XXXXXX`) alır. Sistem, eşyanın bulunduğu odada o sırada kalanları ve son 7 günde ayrılanları aday olarak önerir; misafirle eşleştirilen eşya elden (kimlik görülerek) ya da kargoyla teslim edilir. İletişim notları silinmez, saklama süresi dolan eşya gerekçeyle kapatılır.],
  rakam: (("4 fotoğraf", "eşya başına, telefon kamerasıyla"), ("7 gün", "geriye dönük sahip adayı"), ("90 / 365", "saklama günü: normal / değerli"), ("Kimlikle", "değerli eşya kimlik görülmeden verilmez")),
  adimlar: (("Bulundu", "oda ya da yer · fotoğraf"), ("Depoda", "etiket no · saklama yeri"), ("Sahibi", "aday misafirler"), ("Teslim", "elden · kargo"), ("Kapanış", "bağış · imha · polis")),
  ozellik: (
    ("Hızlı kayıt", "Telefonda kamera; açıklama, kategori, değerli işareti, oda ya da yazılı yer, bulan (hesabı olmayan personel de), saklandığı yer."),
    ("Sahibini bul", "Odada bulunduysa o anda kalanlar ve son 7 günde ayrılanlar (refakatçiler dahil), ayrılışa yakınlığa göre; ortak alanda misafir araması."),
    ("Teslim", "Elden: teslim alan + kimlik görüldü. Kargo: firma, takip no, adres, ücret, ödeyen."),
    ("Saklama ve kapatma", "Süresi dolan eşya ayrı listede; yönetici bağış / imha / polis / hatalı kayıt gerekçesiyle kapatır. Fotoğraflar kapanıştan 30 gün sonra silinir."),
    ("Çıkışta uyarı", "Çıkış penceresi misafire eşleşmiş eşyayı ve odasında bulunup eşleşmemiş eşyayı hatırlatır."),
    ("Gizlilik", "Misafirin telefonu / e-postası ve kargo adresi yalnız teslim yetkisine; fotoğraflar yalnız oturumla, API'den."),
  ),
  neden: [Kayıp eşya şikâyeti otelin itibarına doğrudan dokunur; fotoğraf, etiket ve teslim izi "eşyamı kim aldı" sorusunu kesin cevaplar.],
  rol: (([Müdür, resepsiyon, kat, F&B], [Eşya kaydeder ve görür.]), ([Müdür, resepsiyon], [Eşleştirir ve teslim eder.]), ([Müdür], [Kapatır, saklama sürelerini ayarlar.])),
  baglantilar: ("*Oda (3) / oda planı (5):* adaylar odanın konaklama geçmişinden, taşınan misafir dahil.", "*Check-in / out (6):* çıkış penceresinde eşya uyarısı.", "*Bildirim (9):* \"eşyanız bulundu\" şablonu bu modülün eşya olayına bağlanabilir."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/lost-items`: kayıt, arama, aday bulma, eşleştirme, teslim / kapatma, notlar, fotoğraflar ve saklama ayarları. Fotoğraf hattı: tarayıcı uzun kenarı 1600 px'e küçültür, JPEG'e çevirir (EXIF / konum düşer) ve 320 px önizleme üretir; sunucu türü dosyanın imzasından, boyutu sınırdan doğrular (1,5 MB / 150 KB; gövde sınırı yalnız bu uçta yükseltildi). Dosya `FILE_STORAGE_DIR/lost-items/<otel>/<id>.jpg` altında, statik sunulmaz; kayıt veritabanında (`LostItemPhoto`). Saatlik iş kapanıştan 30 gün sonra fotoğrafları siler.],
  kural: (
    ("Yer", "Oda ya da yazılı yer — biri zorunlu (veritabanı kısıtı)."),
    ("Aday kuralı", "Eşyadan sonra gelen misafir aday değildir; konaklama verildiyse misafir o konaklamanın misafiri olmalı."),
    ("Durum", "Depoda → sahibi bulundu → teslim edildi / kapatıldı; eşleşme gerekçeyle kaldırılır (nota düşer); kapanmış kayıt değişmez, not her durumda yazılır."),
    ("Değerli eşya", "Elden teslimde kimlik görülmeden verilmez; saklama süresi ayrı (`lostItemValuableRetentionDays`)."),
    ("Dosya güvenliği", "Eşya başına en çok 4 fotoğraf (kilit altında); yazılamayan kaydın dosyası geri silinir; yanıt tarayıcı önbelleğine özel."),
  ),
  tutarlilik: (
    "Her geçiş satır kilidi + sürüm damgasıyla: aynı eşya iki kişiye teslim edilemez (testli).",
    "Kayıt istek kimliğiyle: aynı gönderim ikinci kez gelirse 200 ile aynı kayıt.",
    "Oturum kapanınca / kişi değişince panelin sorgu önbelleği boşalır (ortak resepsiyon bilgisayarı).",
    "Olay yükünde yalnız kimlikler; kanal `lost-items.changed`.",
  ),
  olcek: (("Liste", "`(hotelId, status, foundAt, id)` / `(hotelId, status, closedAt, id)`"), ("Süresi dolanlar", "`(hotelId, status, valuable, businessDate)`"), ("Açıklama ve yer araması", "trigram"), ("Adaylar", "oda + tarih index'leriyle sınırlı tarama")),
  olcek-not: [Sayfa başına kapak fotoğrafları tek sorguda; sayım sınırlı. Süre kolonu tutulmaz, eşik sorguda hesaplanır.],
  degistir: (
    ("Saklama süresi", "Ayar ekranından (`lostItemRetentionDays`, `lostItemValuableRetentionDays`); kod değişikliği gerekmez."),
    ("Yeni kapatma sebebi", "Sözleşmedeki liste + etiket; Prisma enum + migration; kapatma gerekçesi zorunluluğu korunmalı."),
  ),
  devir: ("Üretimde `FILE_STORAGE_DIR` uygulama klasörünün dışında olmalı ve yedeğe dahil edilmeli.", "Misafir kartı (22) misafirin eşyalarını `guestId` index'iyle gösterebilir."),
)
