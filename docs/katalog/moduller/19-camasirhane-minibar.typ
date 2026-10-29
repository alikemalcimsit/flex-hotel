#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Kat görevlisi odada telefondan minibar sayımını girer: oda numarası, büyük +/− düğmeleri, kime yazılacağı. Tüketim içerideki misafirin folyosuna kendiliğinden düşer; misafir az önce çıktıysa açık folyosuna geç kalem olarak. Çamaşır siparişi odadan alınır, yıkama → hazır → teslim adımlarıyla izlenir ve teslim edildiği anda folyoya işlenir; ekspres farkı ayrı satırda görünür.],
  rakam: (("Telefon", "kat görevlisi için sayım ekranı"), ("24 saat", "yeni ayrılan misafire geç kalem"), ("Teslimde", "çamaşır folyoya — iptal hiç işlenmez"), ("%50", "varsayılan ekspres farkı")),
  adimlar: (("Oda", "numarayla aç"), ("Sayım", "ürün + adet"), ("Kime?", "içerideki · ayrılan · kayıp"), ("Fiş", "MB-XXXXXX"), ("Folyo", "minibar vergisiyle")),
  ozellik: (
    ("Minibar girişi", "Odadaki misafir ve son 24 saatte ayrılanlar (çıkış ya da oda değişimi) gösterilir; aynı odaya son sayımlar çift giriş uyarısı olarak çıkar."),
    ("Kayıp", "Odada kimse yoksa ya da tüketim kimseye yazılamıyorsa \"kayıp\" — gerekçe zorunlu, folyoya gitmez, raporda ayrı."),
    ("Fiş değişmez", "Minibar fişi silinmez ve düzeltilmez; düzeltme folyodaki kalem iptaliyle (onaylı)."),
    ("Çamaşırhane panosu", "Açık / geciken / teslim / iptal görünümleri; oda, sipariş no, misafir araması; geciken kırmızı; canlı."),
    ("Fiyat koruması", "Siparişteki parça alındığı andaki fiyatı korur; sonradan eklenen parça güncel fiyatla."),
    ("Günlük rapor", "Minibar: yazılan / geç / kayıp, ürün ve personel kırılımı. Çamaşır: alınan, teslim geliri, hizmet, geciken."),
  ),
  neden: [Minibar ve çamaşır gelirinin kaçağı çoğunlukla "çıktıktan sonra fark edilen" tüketimdir; geç kalem kuralı ve kayıp gerekçesi bu kaçağı görünür kılar.],
  rol: (([Kat hizmeti, resepsiyon, müdür], [Minibar ve çamaşır girer.]), ([Müdür, muhasebe], [Fiyat listeleri ve ekspres farkı.]), ([Görüntüleyen], [Kayıtlar ve rapor.])),
  baglantilar: ("*Folyo (15):* minibar ve çamaşır ücreti olayla folyoya kalem olarak düşer; olay iki kez gelse de tek kalem.", "*Check-in / out (6):* çıkış penceresi teslim edilmemiş çamaşır siparişini uyarır.", "*Aktör paneli (12):* folyo kapanmışsa geç kalem folyo yetkilisine görev olarak düşer."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/extras`: minibar ürünleri ve sayım fişleri (`MinibarConsumption` + satırlar: ürünün o anki adı / fiyatı), çamaşır parçaları ve siparişleri (`LaundryOrder` + satırlar), günlük rapor ve fiyat listeleri. Folyoya yazma bu modülde değildir: fiş `minibar.consumed`, teslim `laundry.charged` olayı yayınlar; folyo aktörü `postExternalCharge` ile kalemi işler. Fişin folyo durumu (işlendi / işleniyor / personele düştü / kayıp) ek kolon tutulmadan kalemin anahtarından ve açık görevden okunur — sayfa başına iki sorgu.],
  kural: (
    ("Kime yazılır", "`IN_HOUSE` (içerideki), `LATE` (son 24 saatte ayrılan — `RoomStaySegment` dahil), `NONE` (kayıp, gerekçeli). Seçilen misafir bu arada değiştiyse fiş yazılmaz (`STAY_CHANGED`; rezervasyon → oda kilidi)."),
    ("Geç kalem", "Konaklama açıkça verilmiş ve misafir çıkmışsa açık folyosuna; açık folyo yoksa yeni folyo açılmaz, `FOLIO_CLOSED` → aktörde görev."),
    ("Çamaşır durumu", "Alındı → yıkamada → hazır → teslim (ya da iptal); ileri atlanabilir, geri dönülmez. Sayım düzeltmesi yalnız alındı / yıkamada."),
    ("Teslim zamanı", "İleride ve en çok 7 gün; sipariş içerideki misafir adına, kilit altında doğrulanır."),
    ("Tutar kısıtları", "Satır = fiyat × adet, toplam = ara toplam + ekspres farkı; kayıpsa konaklama yok + gerekçe var; durum izleri eksiksiz (veritabanı)."),
  ),
  tutarlilik: (
    "Her çamaşır geçişi satır kilidi + sürüm damgasıyla: aynı siparişi iki kişi teslim edip ücreti iki kez yazamaz (testli).",
    "Fiş ve sipariş istek kimliğiyle: aynı gönderim ikinci kez gelirse 200 ile aynı kayıt döner.",
    "Olaylar `minibar.recorded`, `laundry.order.changed`, `extras.catalog.changed` (kanal `extras.changed`), `laundry.charged`; canlı tazeleme seyreltilmiş.",
  ),
  olcek: (("Günün fişleri (imleçli)", "`(hotelId, businessDate, recordedAt, id)`"), ("Odanın son sayımları", "`(roomId, recordedAt)`"), ("Çamaşır panosu", "`(hotelId, status, dueAt, id)`"), ("Sipariş no araması", "tekil index, tam eşleşme")),
  olcek-not: [Rapor tek GROUP BY'larla; giriş ekranının ürün listesi satıştaki ürün sınırıyla (minibar 120, çamaşır 150).],
  degistir: (
    ("Yeni ek hizmet", "Bu modülün düzeni örnek alınmalı: kendi fişi + olay; folyoya yazımı folyo aktörü `postExternalCharge` ile yapar (vergi ve yönlendirme orada)."),
    ("Ekspres farkı", "Ayar `Hotel.laundryExpressPct`; sipariş anındaki yüzde siparişte saklanır."),
  ),
  devir: ("Kat hizmeti (14): oda temizliği görevine \"minibar sayıldı\" adımı `minibar.recorded` ile bağlanabilir.", "Stok (45): minibar fiş satırları (`MinibarConsumptionLine`, kayıplar dahil) henüz stok çıkışına bağlı değil; bağlanacağı yer hazır."),
)
