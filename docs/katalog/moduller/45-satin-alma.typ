#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Mutfağın, banketin ve depoların ihtiyacı tek bir zincirde karşılanır: talepler malzeme başına toplanır, tedarikçi teklifleri yan yana karşılaştırılır, her malzeme kendi en uygun teklifinden siparişe döner ve irsaliye girildiği anda stok, maliyet ve tedarikçi borcu kendiliğinden güncellenir.],
  rakam: (("4 adım", "talep → teklif → sipariş → mal kabul"), ("Satır", "bazında kazanan: her malzeme en uygun tedarikçiden"), ("Dört göz", "eşik üstü sipariş başka yetkiliye gider"), ("Anında", "mal kabulde stok, maliyet ve tedarikçi borcu")),
  adimlar: (("Talep", "banket · elle · min. stok"), ("Açık satırlar", "malzeme başına toplanır"), ("Teklif turu", "tedarikçi × fiyat × termin"), ("Kazanan", "satır bazında seçim"), ("Sipariş", "eşik üstü onaya"), ("Mal kabul", "stok + borç")),
  akis-aciklama: [Her adım kayıtlı ve geri alınabilir: reddedilen ya da iptal edilen sipariş teklif turuna döner, kapanan tur talebe döner.],
  ozellik: (
    ("Satır bazında teklif karşılaştırma", "Etini kasaptan, sebzesini halden: her malzeme kendi en uygun teklifinden alınır, seçimler tedarikçi başına ayrı siparişe döner."),
    ("Zamanında teslim önce gelir", "İhtiyaç gününden sonra gelecek ucuz teklif önerilmez; yine de seçilecekse gerekçe ister. Düğünün eti ertesi gün işe yaramaz."),
    ("Dört göz onayı", "Politikadaki tutarın (KDV dahil) üstündeki sipariş onay kuyruğuna gider; siparişi açan kendisi onaylayamaz. Karar verilmezse 3 gün sonra düşer."),
    ("Banket ve stokla bağlı talep", "Banket menüsünün malzeme eksiği, minimum seviyenin altına düşen malzeme ve elle açılan talepler aynı listede toplanır."),
    ("İrsaliye ile mal kabul", "Depo, irsaliye no, gelen miktar ve fark; tartılan malzemede %5'e kadar fazla kabul, aynı irsaliye iki kez girilemez, gelmeyecek kalan için eksik kapatma."),
    ("Hareketli ortalama maliyet", "Mal kabulde malzemenin maliyeti eldeki ve gelen miktarın ağırlıklı ortalamasına çekilir; reçete ve menü maliyetleri bununla güncellenir."),
    ("Depo bazında stok", "Ana depo, soğuk oda, bar deposu… Her malzemenin depo dağılımı, yoldaki miktarı, minimum seviyesi ve değeri tek ekranda."),
    ("Tedarikçi borcu kendiliğinden", "Her mal kabul tutarı ve vadesi (kabul günü + tedarikçi vadesi) ile tedarikçi borcu olarak yayınlanır; ön muhasebe (47) gelince cariye işlenecek."),
  ),
  neden: [Satın alma kararları belgelenir: hangi teklifler alındı, hangisi neden seçildi, en uygun dışında seçilen kalemin gerekçesi, siparişi kimin onayladığı ve malın hangi irsaliyeyle hangi depoya girdiği — denetimde tek ekrandan görülür.],
  rol: (
    ([Satın alma / müdür], [Tedarikçi kartları, teklif turu ve teklifler, kazanan seçimi, sipariş iptali ve eksik kapatma, satın alma politikası (onay eşiği).]),
    ([Genel müdür / ikinci yetkili], [Eşik üstü siparişi onay kuyruğundan onaylar ya da gerekçeyle reddeder.]),
    ([Mutfak şefi / F&B], [Talep açar (elle ya da minimum stok önerisinden), malı teslim alır (irsaliye), stoğu ve önerileri görür.]),
    ([Muhasebe], [Siparişleri, mal kabulleri, stok değerini izler; tedarikçi borcu olayı hazır, ön muhasebe (47) ile cariye bağlanacak.]),
  ),
  baglantilar: (
    "*Banket F&B (43):* etkinlik menüsünün malzeme eksiği satın alma talebine çevrilir; banket ekranındaki \"talep edildi\" sütunu zincirle güncellenir.",
    "*Onay kuyruğu (11):* eşik üstü sipariş \"Satın alma siparişi\" türüyle onaya gider; onay ekranından siparişe geçilir.",
    "*Stok & maliyet (44):* depo, stok hareketi ve hareketli ortalama maliyet bu modülde kuruldu; transfer, fire ve sayım 44'te bunun üstüne eklenir.",
    "*Ön muhasebe (47):* her mal kabul, tedarikçi borcu olarak (tutar, KDV, vade) yayınlanır.",
  ),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [Modül iki parçadır: *satın alma* (`modules/purchasing`) talep → teklif turu → sipariş → mal kabul zincirini, *stok çekirdeği* (`modules/stock`) depo, depo satırı, değişmez stok hareketi ve hareketli ortalama maliyeti taşır. Stok çekirdeği 44 (stok & maliyet analizi) için zemin olarak burada kuruldu; çıkış, transfer, fire ve sayım 44'te aynı tabloların üstüne eklenir. Ön yüz ve sunucu aynı sözleşmeyi kullanır (`contracts/purchasing.js`, `contracts/stock.js`; en uygun teklif sıralaması `bestQuoteLine` tek yerde). Belge numarası otel × önek × yıl sırasıyla; sipariş PDF'i ortak `lib/pdf-writer.js` ile. Ekranlar `purchasing.changed` ve `stock.changed` kanallarıyla canlı tazelenir; mal kabul maliyeti değiştirdiği için reçete ve banket F&B ekranları da stok kanalını dinler.],
  kural: (
    ("Teklif turu ekranın gördüğüyle açılır", "İstek malzeme başına beklenen toplamı taşır; sunucu talepleri kilitleyip açık satırları yeniden toplar. Bu arada talep açıldı / iptal edildi / başka tura alındıysa tur açılmaz (`LINES_CHANGED`)."),
    ("En uygun teklif", "İhtiyaca yetişen (bugün + termin ≤ ihtiyaç günü) → en düşük birim fiyat → kısa termin → önce girilen. Fiyatsız, süresi dolmuş ve pasif tedarikçinin teklifi aday değildir. En uygun dışı seçim gerekçe ister."),
    ("Tutar ve KDV", "Satır tutarı = miktar × birim fiyat (kuruşa yuvarlı), KDV satırda yuvarlanır, belge toplamı satırların toplamıdır (yeniden yuvarlanmaz)."),
    ("Onay eşiği", "KDV dahil toplam ≥ politika eşiği (> 0) ise sipariş `PENDING_APPROVAL` açılır ve onay isteği aynı işlemde yazılır. Onay → `APPROVED`; red / süre dolumu → `REJECTED` ve satırlar tura döner. `PURCHASE_ORDER` dört göz listesindedir: siparişi açan onaylayamaz."),
    ("Mal kabul sınırı", "Adette kalan kadar; kg / g / L / ml'de sipariş × 1,05 − teslim alınan. Tutar sipariş fiyatıyla. Aynı tedarikçinin aynı irsaliyesi tekil. Sipariş tam alınınca `RECEIVED`, eksik kapatılınca `CLOSED`."),
    ("Hareketli ortalama", "Yeni maliyet = (eldeki × eski maliyet + gelen × alış) ÷ (eldeki + gelen); eldeki ≤ 0 ise alış fiyatı. Aynı belgedeki girişler sırayla işlenir; 4 basamak, yarım yukarı."),
    ("Durumlar türetilir", "Talep: hiç satırı turda değil → açık; hepsi siparişte → siparişe döndü; arası teklif / siparişte. Tur: bekleyen satır → açık; siparişli → siparişe döndü; hepsi bırakıldı → iptal."),
    ("Stokla ilgili koruma", "Elde stok varken malzemenin maliyeti elle değişmez; stok hareketi / açık talebi / açık siparişi olan malzemenin birimi değişmez."),
  ),
  tutarlilik: (
    "*Kilit sırası:* teklif turu → sipariş → talepler (kimlik sıralı) → depo (mal kabulde paylaşımlı) → malzeme kartı (kimlik sıralı). Bütün yazma yolları aynı sırayı izler; kilitlenme döngüsü oluşmaz.",
    "*Sürüm damgası:* her teklif kaydı turun damgasını ilerletir; kazanan seçimi eski karşılaştırmayla yapılamaz (`STALE_WRITE`). Sipariş ve mal kabul de damgalıdır.",
    "*Testli yarışlar:* aynı satırlara aynı anda iki tur, aynı tura iki kazanan seçimi, aynı siparişe iki mal kabul — biri geçer, diğeri anlamlı hatayla döner; stok yalnız bir kez girer.",
    "*Tek işlem:* sipariş + onay isteği + tur satırı bağları; mal kabul + sipariş + stok + hareket + borç olayı — her biri tek transaction.",
  ),
  olcek: (
    ("Listeler ve ekranlar (sipariş, mal kabul, tedarikçi, stok, hareket)", "2–40 ms"),
    ("Karşılaştırma ekranı (40 satır × 4 teklif)", "21 ms"),
    ("Minimum stok önerileri", "26 ms"),
    ("Açık satırlar (filtreli / filtresiz 170.000 açık satır)", "14–78 ms / 0,47 sn"),
    ("Tur aç (40 malzeme, ~3.000 talep satırı birleşir)", "0,63 sn"),
    ("Teklif kaydet (40 satır) · kazanan → sipariş", "~0,1 sn · 0,25 sn"),
    ("Mal kabul (25 satır, stok + ortalama + hareket)", "0,11 sn"),
  ),
  olcek-not: [Ölçüm `scripts/perf-purchasing.mjs`: 1.500 malzeme, ~200.000 talep satırı, 2.000 tur, 320.000 teklif satırı, 5.000 sipariş, 8.000 mal kabul, 64.000 stok hareketi. Ölçümle yapılan iyileştirmeler: tur açma 13,3 sn → 0,6 sn (talep durumları tek ifadede), öneriler 1,7 sn → 26 ms (önce talep süzülür, malzeme başına bir kez toplanır).],
  test-notu: [Entegrasyon senaryoları gerçek PostgreSQL'de koşar: zincirin tamamı elle hesaplanmış sayılarla (10.491,38 TL sipariş, 4.280,48 TL mal kabul, vade, 409,6225 ortalama maliyet, 12.370,60 TL stok değeri); dört göz ve red → tura dönüş → yeniden seçim → onay; iptal ve tur kapatma; eşzamanlı tur / kazanan / mal kabul; öneri, depo kuralları, birim / maliyet koruması; izinler, otel kapsamı ve PDF.],
  degistir: (
    ("Yeni sipariş / tur durumu", "Prisma enum + sözleşmedeki durum listesi ve etiket + `rules.js` durum türetimi + CHECK kısıtları (migration). Ön yüz ton haritası: `lib/purchasingFormat.js`."),
    ("En uygun teklif kuralı", "Tek yer: `contracts/purchasing.js` → `bestQuoteLine`. Hem karşılaştırma ekranı hem kazanan planı (`rules.js → planAward`) onu çağırır; geç teslim bayrağını iki yer de aynı hesaplar."),
    ("Yeni stok hareketi türü (44)", "`StockMovementKind` + sözleşmedeki etiket; çıkış için `postStockIn` benzeri bir yazıcı (maliyet değişmez, yalnız miktar). Malzeme kartını kimlik sırasıyla kilitleyin."),
    ("Onay eşiğinin davranışı", "`rules.js → needsApproval`; onay türü `PURCHASE_ORDER` sözleşmede dört göz listesinde. Karar uygulaması `orders.js → applyOrderDecision` (idempotent)."),
    ("Ham SQL", "Zaman parametreleri `sqlTimestamp` ile verilmeli (oturum saat dilimi). Liste sorgularında `hotelId` ilk koşul ve index'in önünde."),
    ("Demo verisi", "`scripts/demo-purchasing.mjs`; sıfırlama demo tedarikçisine / malzemesine dayanan bütün belgeleri siler — yeni bir tablo eklerseniz sıfırlamaya da ekleyin."),
  ),
  devir: (
    "*44 (stok & maliyet):* depo / hareket / ortalama hazır; transfer, fire, sayım, maliyet raporu ve reçeteden düşüm eklenecek.",
    "*47 (ön muhasebe):* `purchase.goods.received` olayını cariye işler; tedarikçi kartı (vergi no / daire, vade) cari kartın temeli.",
    "Banket talepleri minimum stok önerisinden düşülmez (etkinlik tüketimi içindir); banket siparişleri ise yoldaki mal sayılır.",
  ),
)
