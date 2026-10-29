#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Resepsiyon nakit, kart, havale ya da dövizle tahsilat girer; ön ödeme rezervasyondan, giriş teminatı girişten kendiliğinden ödemeye dönüşür. Eşik üstü tutar ikinci bir yetkilinin onayına düşer ve onaylanana kadar bakiyeye ve kasaya girmez. Ödeme silinmez: hatalı giriş onaylı iptalle, misafire geri verilen para onaylı iadeyle düzeltilir. Kasa ekranı günün tahsilatını yöntem ve döviz başına anlık gösterir.],
  rakam: (("Döviz", "nakit ve havalede günün kuruyla"), ("Eşik", "üstü onaya, onaylanana kadar kasada yok"), ("3 gün", "en eski kabul edilen döviz kuru"), ("Silinmez", "iptal ve iade onaylı ters kayıt")),
  adimlar: (("Tahsilat", "folyo · yöntem · tutar"), ("Kur", "günün kuru, değiştiyse durur"), ("Eşik?", "büyükse onaya"), ("Bakiye", "aynı işlemde düşer"), ("Kasa", "yöntem × döviz")),
  ozellik: (
    ("Ödeme al", "Canlı kur ve \"onaya gider mi\" önizlemesi; nakit dışı yöntemde referans (slip, dekont, voucher) zorunlu; çift gönderim korumalı."),
    ("Ön ödeme ve teminat", "Rezervasyon kartından ön ödeme (folyo yoksa açılır); girişteki nakit / havale teminatı bir kez ödemeye dönüşür. Kart provizyonu ödeme değildir."),
    ("İade ve iptal", "İade her zaman onaylı ve alınmış net ödemeyle sınırlı; hatalı giriş \"ödeme iptali\" ile, parayı alanın kasasından düşer."),
    ("Kasa", "Gün seçimi, \"yalnızca benim\", yöntem × döviz tahsilat / iade / iptal / net, onay bekleyenler, süzgeçli hareket listesi; canlı."),
    ("Döviz kurları", "Günün kuru personelce girilir; form gördüğü kuru gönderir, arada değiştiyse ödeme yazılmaz. Her ödeme kendi kurunu saklar."),
    ("Kart güvenliği", "Kart numarasına benzeyen dizi referansa ve nota yazılamaz (PCI)."),
  ),
  neden: [Kasada para var ama defterde yok, ya da defterde var kasada yok durumları yapısal olarak önlenir: büyük para iki kişinin kararıyla, düzeltme iz bırakarak girer.],
  rol: (([Resepsiyon, müdür, muhasebe], [Tahsilat ve iade isteği, kasa.]), ([Müdür, muhasebe], [Döviz kurlarını girer.]), ([Yönetici, müdür], [Büyük ödeme, iade, ödeme iptali onayı; isteyen onaylayamaz.])),
  baglantilar: ("*Folyo (15):* ödeme folyo kilitliyken yazılır, toplamlar aynı transaction'da yenilenir.", "*Onay kuyruğu (11):* büyük ödeme, iade ve ödeme iptali dört göz türleri.", "*Check-in / out (6):* çıkış penceresinde \"Ödeme al\"; girişi geri almayı yalnız resepsiyonda alınan ödeme engeller.", "*Ayarlar (1):* büyük ödeme eşiği (Genel parametreler → Ödeme onayı).", "*Banket (37), restoran (39):* kendi ödemeleri aynı kasada görünür."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/payments`: ödeme, iade, iptal, ön ödeme ve teminat servisleri; kasa özeti ve hareketleri; döviz kurları. `Payment` satırı türüyle (`PAYMENT` artı, `REFUND` eksi, `REVERSAL` asıl satırın tersi), durumuyla (`PENDING` onayda / `POSTED` işlendi / `DECLINED`) ve kaynağıyla (`DESK`, `ADVANCE`, `CHECK_IN_DEPOSIT`) taşınır; folyoya giren tutar `folioAmount` = ROUND(tutar × kur, 2) kısıtla sabit. Folyo aktörü (`billing-worker`) girişte teminatı ödemeye çevirir, geri almada iptal eder; bitmiş konaklamanın folyosu ödemeyle sıfırlanınca folyoyu kapatır (`folio.closed` → fatura).],
  kural: (
    ("Bakiye", "Σ kalem − Σ işlenmiş ödemenin `folioAmount`'u; onay bekleyen ve reddedilen sayılmaz. Ödeme yazan her işlem folyoyu kilitler ve toplamları aynı transaction'da yeniler."),
    ("Büyük ödeme", "Folyo tutarı eşiğe eşit ya da büyükse satır `PENDING` (`LARGE_PAYMENT`); reddedilir / süresi dolarsa hiç işlenmez. Onaylanınca kasanın günü onay günüdür. Eşik 0 = onay yok."),
    ("İade sınırı", "İşlenmiş net ödeme − bekleyen iadeler (alınmamış para iade edilmez); iadesi yapılmış paranın ödemesi iptal edilemez."),
    ("Döviz", "Yalnız nakit ve havale; iş gününe kadar girilmiş en son kur, en çok 3 gün eski (`EXCHANGE_RATE_STALE_DAYS`); form kuru değiştiyse 409 `RATE_CHANGED`."),
    ("Çok pencere", "Konaklamada birden fazla açık folyo varsa folyo seçilmeden ödeme alınmaz (`FOLIO_REQUIRED`) — tahmin edilirse pencereler ters bakiyeyle açık kalırdı."),
    ("Kapatma", "Onay bekleyen ödeme / iade ya da ödeme iptali olan folyo kapanmaz (elle de, çıkışta da)."),
  ),
  tutarlilik: (
    "Kısıtlar: işaret türe uyar, onaysız iade ve onaysız bekleyen satır olamaz, durum izleri eksiksiz; `sourceKey` otel başına tekil (teminat bir kez).",
    "Aynı folyoya eşzamanlı 10 ödeme ve aynı isteğin eşzamanlı iki gönderimi entegrasyon testinde: toplam tutarlı, tek kayıt.",
    "Olaylar `payment.*` ve `exchange_rate.updated`; kanallar `folios.changed` ve `cash.changed`.",
  ),
  olcek: (("Kasa toplamı (tek GROUP BY)", "`(hotelId, businessDate, postedAt, id)`"), ("Onay bekleyenler", "`(hotelId, status, receivedAt)`"), ("Folyo ödemeleri (imleçli)", "`(folioId, receivedAt, id)`"), ("Güncel kur", "`DISTINCT ON` + tekil index")),
  degistir: (
    ("Yeni ödeme yöntemi", "Sözleşmedeki yöntem listesi + etiket, Prisma enum + migration; referans zorunluluğu ve döviz izni `payments` kurallarında."),
    ("Sanal POS", "`VIRTUAL_POS` yöntemi ve işlem no referansı hazır; ödeme `receivePayment` ile yazılır (modül 50)."),
  ),
  devir: ("Gece kapanışı (18): kasa sayımı `getCashSummary(hotelId, { date })`; onay bekleyen ödemeler (para çekmecede, defterde değil) ayrıca raporlanmalı.", "Üretimde eşik varsayılanı 0 (onay yok) — ayarlardan girilmeli; kurlar personelce girilir."),
)
