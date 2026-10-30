#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Düğün, toplantı, gala gibi etkinlikler salon takviminde: salon × gün görünümünde kesin, birinci opsiyon ve sıradaki opsiyonlar renkleriyle. Etkinlik dosyası talepten kesine kadar ilerler; program, fiyat kalemleri, ödeme planı ve belgeler (teklif → sözleşme → proforma PDF) tek ekranda. Bölünebilir salonlar, kurulum / söküm süreleri, ekipman stoku ve kapasite kilit altında denetlenir; aynı salonu iki kesin etkinlik asla tutamaz.],
  rakam: (("Sıralı opsiyon", "önce tutan 1., yalnız 1. kesinleşir"), ("0 çakışma", "kesin tutmalar veritabanı kısıtıyla"), ("PDF", "teklif · sözleşme · proforma, sürümlü"), ("53 ms", "31 günlük takvim, 35 bin etkinlikte")),
  adimlar: (("Talep", "müşteri · tarih · kişi"), ("Opsiyon", "salon tutulur, sıra alır"), ("Teklif", "PDF · kabul / ret"), ("Kesin", "imzalı sözleşme · depozito"), ("Gerçekleşti", "kişi · kapanış · proforma")),
  ozellik: (
    ("Salon takvimi", "Salon × gün; bütün salon parçaları da görünür; uygunluk önizlemesi kim tuttuğunu, kaçıncı opsiyon olacağını ve kira önerisini söyler."),
    ("Bölünebilir salon", "İki seviye: bütün → parçalar; düzen başına kapasite (tiyatro, sınıf, banket…); saatlik / yarım / tam gün fiyat, en ucuzu önerilir."),
    ("Fiyat kalemleri", "Kişi başı ya da adetli, indirimli, vergi kategorili; tutarlar folyonun vergi motoruyla, kuruş hassasiyetli önizleme."),
    ("Ödeme planı", "Taksitler ve öneri; tahsilat / iade / hatalı giriş iptali kasada \"Etkinlik\" kaynağıyla. Büyük tutar dört gözle onaylanır."),
    ("Belgeler", "Teklif, sözleşme, proforma — sunucuda PDF, anlık görüntüyle, türe göre tek güncel sürüm (\"TKL-2026-0007/2\")."),
    ("Hatırlatmalar", "Opsiyon günü dolumu, sırası yükselen opsiyon, gecikmiş taksit ve kapatılmamış kesin etkinlik için zil."),
  ),
  neden: [Salon çift satıldığında ya da opsiyon sırası karıştığında kaybedilen sadece bir etkinlik değil, müşteri güvenidir; sıra ve kesinlik burada kural, hatıra değildir.],
  rol: (([Müdür, ön büro, muhasebe, F&B], [Etkinlikleri görür.]), ([Müdür (satış ekibine rol matrisinden)], [Dosya, program, kalem ve belgeler.]), ([Müdür], [Salon, ekipman, politika tanımları.]), ([Müdür, ön büro, muhasebe], [Tahsilat ve iade.])),
  baglantilar: ("*Ödeme ve kasa (17):* kasa özeti ve hareketleri folyo + etkinlik birleşik, kaynak süzgeciyle.", "*Onay kuyruğu (11):* etkinlik ödemesi onayı (büyük tahsilat, iade, iptal), dört göz.", "*Banket F&B (43):* etkinliğe menü bağlanınca kişi başı menü kalemi menüden gelir.", "*Folyo (15):* aynı vergi motoru; etkinliğin kendi hesabı vardır, folyo açılmaz."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/banquet`: etkinlik ve oturumlar (`events.js`), belgeler ve PDF (`documents.js`, `pdf.js` — pdfkit + gömülü DejaVu), ödemeler (`payments.js`), tanımlar (`setup.js`), zamanlanmış işler (`jobs.js`, 15 dk) ve saf kurallar (`rules.js`). Salon tutması oturumun her atomik salon parçası için ayrı satırdır (`EventVenueHold`, kurulum / söküm dahil); kesin tutmalar farklı etkinlikler arasında `EXCLUDE` kısıtıyla çakışamaz, aynı etkinliğin arka arkaya oturumları serbesttir. Belge numaraları `EventSequence` ile (ETK / TKL / SZL / PRF-yıl-sıra).],
  kural: (
    ("Opsiyon sırası", "Kesin hep önde; opsiyonlar tutma anına göre, eşit anda kimlikle. Yalnız 1. opsiyon kesinleşir; opsiyon günü otelin iş günüyle geçince düşer (iş kilit altında yeniden bakar)."),
    ("Faturalanacak kişi", "Kesinleşmeden garanti (yoksa tahmin); gerçekleşince en çok (garanti, gerçekleşen)."),
    ("İptal kademesi", "Alt sınır: \"en az N gün kala\"; politika 0 günü içermek zorunda (yoksa son günler bedelsiz kalıyordu)."),
    ("Tahsilat / iade", "Kapanmış dosyada kalan borçtan fazlası alınmaz, yalnız borcun üstündeki fazla iade edilir; alınmamış para iade edilmez; kaybedilen dosya borçsuz."),
    ("Belge şartları", "Teklif satışta, sözleşme kesine kadar, proforma borç kesinleşince; imzalı sözleşme şartı ayarlıysa imzasız kesinleşmez."),
    ("Ekipman", "Tepe kullanımı süpürme çizgisiyle; stok ileri tarihli kesin ayrımların altına düşürülemez."),
  ),
  tutarlilik: (
    "Kilit sırası: etkinlik → salon → ekipman. Kesinleştirme salonu ve atomik parçalarını kilitler, salon tanımını kilitten sonra yeniden okur; sıra, kapasite, stok ve sözleşme kilit altında denetlenir, son savunma veritabanı kısıtıdır.",
    "Eşzamanlı dört kesinleştirmede tek kazanan (testli). Tahsilat sürüm damgasını ilerletmez — açık formlar bozulmaz.",
    "Ödemelerde tekrar gönderim anahtarı; belgelerde türe göre tek güncel sürüm (kısmi tekil index), eşzamanlı üretim testli.",
    "Takvim sorgusu `(hotelId, endAt)` index'iyle: geçmiş birikse de tarama gelecek ufkuyla sınırlı.",
  ),
  olcek: (("Liste (derin sayfa 500 dahil)", "26–84 ms"), ("Etkinlik ekranı", "10–29 ms"), ("Takvim 7 / 31 gün", "16 / 53 ms"), ("Uygunluk", "7 ms"), ("Dosya → kesin (beş işlem)", "0,7–1,5 sn"), ("200 opsiyon dolumu", "6,9 sn")),
  olcek-not: [Ölçüm `scripts/perf-banquet.mjs`: 56 atomik salon, 34.963 etkinlik, 38.763 oturum, 209.778 kalem, 46.199 ödeme, 20.000 müşteri.],
  degistir: (
    ("Yeni belge türü", "Sözleşmedeki tür + şablon (`pdf.js`, birim testli) + `EventSequence` öneki; tek güncel sürüm index'i türe göre."),
    ("İptal politikası", "Ayar ekranından kademeler; kural `banquet/rules.js`'te (0 gün kademesi zorunluluğu korunmalı)."),
  ),
  devir: ("Resmî fatura 16 / 49'da: \"faturaya hazır\" tutar ve proforma hazır.", "Etkinlik carisi / alacak takibi ön muhasebe (47) ile bağlanacak."),
)
