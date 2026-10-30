#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Garson vardiyasını açar, masa planından masayı seçer, dokunmatik menüden siparişi tur tur gönderir. Adisyon bölünür, taşınır, birleştirilir, devredilir; ikram, iptal ve indirim şef garson yetkisi ve gerekçeyle, eşik üstünde dört gözle yapılır. Ödeme nakit ya da kartla, kişi başı bölüşülerek alınır ya da içerideki misafirin odasına yazılır — folyoda kuruşu kuruşuna aynı tutar. Vardiya kapanışında nakit sayılır, fark varsa uyarılır.],
  rakam: (("11 ms", "masa planı, 587 bin adisyonda"), ("Odaya yaz", "folyoda birebir aynı tutar"), ("Tek kayıt", "çift dokunuş ikinci adisyon açmaz"), ("Dört göz", "eşik üstü ikram / iptal / indirim")),
  adimlar: (("Vardiya", "avans · tek açık vardiya"), ("Masa", "boş · dolu · hesap istiyor"), ("Sipariş", "tur tur, mutfak fişi"), ("Adisyon", "böl · ikram · indirim"), ("Ödeme", "nakit · kart · odaya")),
  ozellik: (
    ("Masa planı", "Satış noktası ve bölüm bölüm masa kutuları: durum, süre, tutar; masasız adisyonlar ayrıca."),
    ("Sipariş ekranı", "Dokunmatik menü + arama, sepet, not, gönder; tur başına mutfak fişi. Ürünün adı / fiyatı / vergisi sipariş anında kopyalanır."),
    ("Adisyon işlemleri", "Kalem başına ikram / iptal + zayi, indirim (yüzde ya da tutar), böl / taşı / birleştir / devret; toplam ve vergi dökümü."),
    ("Ödeme", "Nakit / kart, kişi başı bölüşme, hızlı nakit ve para üstü; odaya yaz: oda / soyadı araması, gerekirse yuvarlama önerisi."),
    ("Vardiya", "Aç / kapat, avans, beklenen / sayılan nakit, fark önizlemesi, yazdırılabilir vardiya fişi ve rapor."),
    ("Satış raporu", "Satış noktası, ürün ve ödeme kırılımı (31 güne kadar); kasa ekranında \"Restoran\" kaynağı."),
  ),
  neden: [Restoranda kayıp çoğunlukla gerekçesiz ikram, kayıt dışı iptal ve odaya yanlış yazılan hesaptır; burada her biri yetkili, gerekçeli ve izlidir, odaya yazılan tutar folyoda aynen görünür.],
  rol: (([Garson (F&B)], [Masa, sipariş, ödeme.]), ([Şef garson (rol matrisinden; varsayılan müdür)], [İkram, iptal, indirim, yeniden açma.]), ([Müdür], [Menü, satış noktası, masa ve politika tanımları.]), ([Muhasebe], [Satış ve vardiya raporları.])),
  baglantilar: ("*Folyo (15):* odaya yazılan hesabı folyo aktörü vergi kategorisiyle kalem olarak işler.", "*Ödeme ve kasa (17):* kasa üç kaynaklı: folyo + etkinlik + restoran.", "*Onay kuyruğu (11):* adisyon düzeltmesi ve ödemesi dört göz türleri.", "*Oda servisi (41):* aynı POS servisleri ve odaya yaz yolu."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/pos`: adisyon ve turlar (`checks.js`), ödemeler (`payments.js`), vardiyalar (`shifts.js`), raporlar (`reports.js`), tanımlar (`setup.js`), zamanlanmış iş (`jobs.js`, 15 dk: 16 saati geçen vardiya, 8 saati geçen adisyon) ve saf kurallar (`rules.js`). Adisyonun kendi ödemesi vardır (`PosPayment`; parayı alan garsonun vardiya kasasına). İş olayları: `fnb.order.placed` (tur gönderildi — mutfak ekranı için), `fnb.order.paid` (adisyon kapandı: ürün başına satılan / ikram / zayi — stok düşümü için; yeniden kapanırsa yeniden yayınlanır), `fnb.order.charged` (odaya yaz).],
  kural: (
    ("Vergi ve indirim", "İndirim (yüzde kuruşa; tutar ara toplamı aşmaz) vergi kategorilerine kuruş kuruş dağıtılır; vergi kategori başına folyonun motoruyla (dahil + hariç)."),
    ("Odaya yaz", "Kalemler kategori başına brüt gönderilir; folyo aynı motorla toplamı birebir bulur. Hariç vergi (servis) kuruşu yüzünden yazılamayan tutar reddedilir, en yakın iki tutar önerilir."),
    ("Düzeltme yetkisi", "İkram / iptal / indirim şef garson + gerekçe; politikadaki eşiğe eşit ya da üstü `POS_ADJUSTMENT` onayına. Onaylanan düzeltme ödemeyi aşacaksa uygulanmaz."),
    ("Bekleyen iş", "Onay bekleyen düzeltme varken ödeme alınmaz; bekleyen ödeme varken toplam değişmez; bekleyen iş varken adisyon da vardiya da kapanmaz."),
    ("Yeniden açma", "Aynı iş günü, vardiya açık ve odaya yazılmamışsa."),
    ("Kasa", "Vardiya kasası = avans + işlenmiş nakit − iptal; kapanışta fark politikadaki eşiği aşarsa uyarı."),
  ),
  tutarlilik: (
    "Kilit sırası: vardiya → adisyon → rezervasyon. Açma, ödeme, devir, yeniden açma vardiyayı paylaşımlı, kapanış özel kilitler (sayım sırasında kasaya para girmez).",
    "İstek kimliği adisyon, tur, ödeme ve odaya yazmanın anahtarı: çift dokunuş / ağ tekrarı ikinci kayıt açmaz (eşzamanlı aynı istek de). Eşzamanlı iki tam ödemede tek kazanan (testli).",
    "Ödeme sürüm damgasını ilerletmez: aynı anda sipariş giren garsonun ekranı bozulmaz.",
    "Bir garsona tek açık vardiya (kısmi tekil index); kapanmış adisyonda alınan + odaya = toplam (CHECK).",
  ),
  olcek: (("Terminal / masa planı / adisyon", "25 / 11 / 11 ms"), ("Liste (derin sayfa 2000)", "53–67 ms"), ("Numara / masa adı araması", "12 / 24 ms"), ("Satış raporu 1 / 31 gün", "7 / 133 ms"), ("Aç → 20 kalem → böl → öde", "384 ms")),
  olcek-not: [Ölçüm `scripts/perf-pos.mjs`: 6 nokta, 420 masa, 600 ürün, ~587.000 adisyon, 1,76 milyon kalem. Ölçümle yapılan iyileştirmeler: numara araması masa adıyla OR'lanınca bütün geçmişi tarıyordu (1,1 sn) → ayrı eşleşme kümesi + `(tableId, openedAt)`; ürün kırılımı kalem tablosunu baştan okuyordu (616 ms) → kalemde kapanış iş günü + `(hotelId, businessDate)`.],
  degistir: (
    ("Yeni ödeme yöntemi", "`PosPayment` yöntemi + kasa birleşimi (`cash` sorguları üç kaynaklı); dört göz eşiği politikada."),
    ("Fiş", "Hesap ve mutfak fişi bilgi fişidir; mali ÖKC entegrasyonu yasal entegrasyonlar kapsamında ayrı iş."),
  ),
  devir: ("`fnb-worker` paketi henüz iskelet: mutfak ekranı (40) `fnb.order.placed` ve `PosOrder.status`, stok düşümü (44 / 45) `fnb.order.paid` olayını tüketecek.", "Reçete / maliyet (38) menü ürünlerine bağlanacak."),
)
