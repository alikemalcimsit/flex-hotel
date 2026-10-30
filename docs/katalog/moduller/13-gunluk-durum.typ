#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Müdür sabah ana sayfaya bakıp günü anlar: bu gece doluluk ve kalan oda, bugün gelecek ve gidecek misafirler, oda ve kat hizmeti durumu, oda geliri, ADR ve RevPAR, bekleyen onay ve görevler. Her kart ilgili ekrana götürür; sayılar oda planıyla ve ön büro listeleriyle birebir aynıdır, çünkü aynı hesaptan gelir.],
  rakam: (("6 kart", "doluluk · gelen · giden · oda · kat · gelir"), ("7 gün", "dün → bugün → yarın doluluk serisi"), ("Vergisiz", "net oda geliri, ADR, RevPAR"), ("Tek kaynak", "oda planıyla aynı sayı")),
  ozellik: (
    ("Doluluk ve kalan oda", "Satılabilir oda üzerinden (toplam − arızalı); dünle kıyas. Fazla satışta kalan negatif görünür ve uyarı çıkar — gizlenmez."),
    ("Gelen / giden", "Bugün gelecekler, dünden kalan gelmemişler (gelmedi adayı), gidecekler; ilk 5'i ön büroya bağlantılı."),
    ("Oda ve kat hizmeti", "Dolu, boş, kirli, temizleniyor, temiz, kontrol edildi; \"hazır boş oda\" ve bunlardan bu gece kimseye verilmemiş olanlar. Odası verilmemiş gelecek sayısı bundan fazlaysa uyarı."),
    ("Oda geliri", "Gece fiyatlarından, vergiler hariç net; brüt ayrıca. ADR ve RevPAR; opsiyonlu (kesinleşmemiş) gelir ayrı."),
    ("Haftalık doluluk", "Bugünden 3 gün önce ve 3 gün sonra; üzerine gelince gün ayrıntısı (gelir, ADR, arızalı). Erişilebilir tablo görünümü."),
    ("Bekleyen işler", "Onaylar, manuel görevler, cevap bekleyen mesajlar, açık / geciken misafir istekleri, açık arızalar — her biri kişinin kendi yetkisiyle."),
  ),
  neden: [İki ekranın iki farklı doluluk söylemesi güveni bitirir. Bu panel kendi sayısını üretmez; oda planının ve ön büronun hesabını kullanır.],
  rol: (([Müdür, muhasebe], [Paneli görür (gelir içerdiği için ayrı izinle).]), ([Diğer personel], [Ana sayfada hızlı erişim kartlarını görür; bekleyen işler kutusunda yalnız kendi yetkisindeki sayılar.])),
  baglantilar: ("*Oda planı (5):* doluluk ve satılabilir oda oda planının gün özetinden.", "*Check-in / out (6):* gelen / giden sayıları ön büro özetinden — kart tıklanınca açılan listeyle aynı.", "*Onay kuyruğu (11), aktör paneli (12):* bekleyen işler özetleri.", "*Gelir raporları (23), forecast (25):* aynı iki kaynak (gün özeti + gece geliri sorgusu)."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/dashboard` kendi tablosu olmayan bir okuma katmanıdır: `GET /dashboard/today` ve `GET /dashboard/week?from=` (7 gün). Doluluk, satılan ve satılabilir oda oda planının gün özetinden (`plan/rules.js → summarizeDays`), gelen / giden ön büro özetinden (`getFrontDeskSummary`), oda tipine göre kırılım modül 3'ün müsaitlik takviminden, gelir `ReservationNight`'tan SQL toplamıyla (`(hotelId, date)` index'i) gelir. Oda durumu sayımları tek SQL sorgusunda.],
  kural: (
    ("Satılan gece", "Ortak tanım (`countsSoldNight` / `soldNightSql`; oda planı, günlük durum ve raporlarda aynı): bugün ve sonrası opsiyonlu + kesin + içerideki konaklamanın geceleri; geçmişte yalnız gerçekleşen (içeride ya da çıkmış) konaklamanınkiler. Erken çıkışta ileriki geceler sayılmaz."),
    ("Net gelir", "Fiyata dahil oda vergileri (KDV, konaklama vergisi — `isIncluded` + `ROOM`) ayrılır: net = brüt ÷ (1 + Σ dahil oran); rezervasyon ekranının vergi dökümüyle aynı formül."),
    ("ADR / RevPAR", "ADR = net / fiyatı olan satılan gece (satış yoksa tanımsız, \"0\" değil); RevPAR = net / satılabilir oda."),
    ("Para birimi", "Otelin para birimi dışında satır çıkarsa toplama karıştırılmaz, ayrı uyarılır."),
    ("Gün sınırı", "Rezervasyon tarihleri saat taşıyabilir; karşılaştırmalar gün düzeyinde (`stayCoversNight`): saatli giriş tarihi (ör. 11:00) o günün gelişi sayılır, \"bugün gelecekler\"den düşmez (modül 6 da aynı kuralı kullanır)."),
  ),
  tutarlilik: (
    "Cevaplar otel × canlı sürüm (envanter + rezervasyon) × iş günü anahtarıyla önbellekte; aynı anda gelen istekler tek hesaplamayı bekler.",
    "Ekran `inventory.changed` kanalını dinler: en sık 15 sn'de bir tazelenir, bağlantı kopukken 5 dk'da bir.",
    "Haftalık seri entegrasyon testinde oda planının gün özetiyle birebir karşılaştırılır — iki ekranın sayısı ayrışamaz.",
    "`from` iş gününden en çok 366 gün uzak olabilir; aşarsa 422.",
  ),
  degistir: (
    ("Yeni kart", "Sayıyı mümkünse var olan özetten türetin (`summarizeDays`, ön büro özeti); yeni SQL gerekiyorsa `dashboard/service.js`'te otel kapsamlı ve index'li yazın, önbellek anahtarına giren olayları kontrol edin."),
    ("Yeni rapor ekranı", "Doluluk ve gelir için aynı iki kaynağı kullanın; ikinci bir doluluk tanımı yazmayın."),
  ),
  devir: ("Gelir kartı eldeki rezervasyonun oda geliridir; geçmiş günlerin folyoya işlenen gerçekleşen oda geliri, ücret ve iptal / gelmeme gelirleri gelir raporlarında (23).", "Vergi oranı güncel ayardan okunur: geçmiş günde oran değişmişse küçük fark olabilir (gece bazında kesin vergi folyoda)."),
)
