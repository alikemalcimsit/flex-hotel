#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Etkinliğin menüsü set menü kataloğundan seçilir ve dosyada uyarlanır: kurslar, seçmeli yemekler, kişi başı porsiyon, fiyat. Reçetelerden (ara ürünler ve fire dahil) kişi sayısına göre malzeme ihtiyacı ve maliyet çıkar; gıda maliyeti yüzdesi eşik renkleriyle görünür. Malzeme ihtiyacı tek tıkla satın alma talebine çevrilir, mutfak planı gün → saat → istasyon görevleri olarak yazdırılır. Menü kesinleşince mutfağa haber gider; sonradan değişen kişi ya da saat de bildirilir.],
  rakam: (("4 seviye", "ara ürünlü reçete, fire dahil"), ("Tam sayı", "porsiyon aritmetiği: 0,3 × 350 = 105"), ("151 ms", "7 günlük malzeme ihtiyacı"), ("Gizli maliyet", "yetkisi olmayana maliyet dönmez")),
  adimlar: (("Menü", "katalogdan · uyarla"), ("Porsiyon", "kişi × porsiyon × fazla payı"), ("Malzeme", "reçeteden açılır"), ("Talep", "eksik etkinlik başına"), ("Mutfak planı", "gün · saat · istasyon")),
  ozellik: (
    ("Reçeteler", "Maliyet, KDV hariç satış, gıda maliyeti % (%30 / %38 eşikleri), alerjenler (14 grup); kaydetmeden canlı maliyet önizlemesi, kullanıldığı yerler."),
    ("Set menü kataloğu", "Kurslar \"hepsi\" ya da \"seçmeli\"; kişi başı maliyet seçmelide en pahalı seçenekle. Katalog dosyaya kopyalanır, sonradan değişse de dosya bozulmaz."),
    ("Etkinlikte Menü sekmesi", "Seçmelide canlı \"kalan\" kişi, porsiyon planı, maliyet / gıda maliyeti, kesinleştir / gerekçeyle yeniden aç; menünün fiyat kalemi kendiliğinden."),
    ("Malzeme ihtiyacı", "Gruba göre (kasap, manav…): kesin / olası, talep edilen, eksik, mutfakta olması gereken gün; etkinlik dökümü; A4 çıktı."),
    ("Satın alma talebi", "Grup süzgeciyle talebe çevir (STR-yıl-sıra); aynı eksik iki kez talep edilemez. Teklif, sipariş ve mal kabul satın alma modülünde."),
    ("Mutfak planı", "Yemek servisten hazırlık süresi kadar önce, ara ürün onu kullanandan önce; aynı ara ürün birleşir; taslak menü işaretli, A4 çıktı işaret kutulu."),
  ),
  neden: [Banket mutfağında hata iki yönlüdür: eksik malzeme etkinliği bozar, fazla malzeme ziyan olur. İhtiyaç reçeteden, kişi sayısından ve fire payından hesaplanınca ikisi de görünür hâle gelir.],
  rol: (([Müdür, F&B, muhasebe], [Reçeteleri ve maliyeti görür.]), ([Müdür (şef için matristen)], [Reçete ve malzeme kartı yazar.]), ([Müdür, F&B], [Satın alma talebi açar.]), ([Ön büro], [Menüyü görür; maliyeti görmez.])),
  baglantilar: ("*Banket ve etkinlik (37):* dosyada Menü sekmesi; teklif / sözleşmede menünün içeriği ve alerjenler.", "*Satın alma ve stok (45):* talepler teklif → sipariş → mal kabul akışına girer; malzeme kartı stok kartıdır.", "*Restoran POS (39):* reçete restoran ürününe bağlanabilir (kâr marjı)."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/recipes` (reçete, malzeme kartı, maliyet önizlemesi, seçiciler) ve banket F&B dosyaları (`banquet/menus.js` katalog, `event-menus.js` etkinlik menüsü, `fnb-read.js` ihtiyaç ve üretim planı, `fnb-rules.js` saf kurallar, `fnb-hooks.js` mutfak haberleri). Satın alma talebi tablosu (`PurchaseRequest` + satır + numara serisi) satın alma modülünün şekliyle burada kuruldu. Reçete grafiği ve planlama menüleri düz SQL'le okunur; reçete başına "birim ihtiyaç" önbelleklidir (yemek başına yeniden açılmaz).],
  kural: (
    ("Birim ve fire", "Birim aileleri ve çevrim (kg ↔ g, L ↔ ml; aileler arası yok); brüt = net ÷ (1 − fire); satın alma yuvarlaması kg / L binde bir, g / ml / adet tam."),
    ("Porsiyon", "Hazırlanacak = servis edilen kişi × kişi başı porsiyon × (1 + fazla hazırlık), yukarı; tam sayı aritmetiği. Seçmeli kursta sabitler + bir \"kalan\"; aşım / tutmama sorun olarak işaretlenir."),
    ("Reçete grafiği", "Satır malzeme ya da ara reçete (tam biri, CHECK); kendini içeremez; döngü yok, en çok 4 seviye. Kullanılan reçetenin verim ailesi, kullanılan malzemenin birim ailesi değişemez."),
    ("İhtiyaç ve talep", "Etkinlik × malzeme düzeyinde yuvarlanır; eksik etkinlik başınadır (bir etkinliğe fazla istenen başkasının eksiğini kapatmaz). Talep etkinliklere erken ihtiyaç önce dağıtılır."),
    ("Kesinleştirme", "Yalnız kesin dosyada ve sorunsuz menüde; kesin menü değişmez / kalkmaz, gerekçeyle yeniden açılır."),
  ),
  tutarlilik: (
    "Reçete kaydı otel başına danışma kilidiyle: A'ya B, aynı anda B'ye A eklenemez (eşzamanlı döngü testli).",
    "Etkinlik menüsü etkinlik kilidi + dosya sürümüyle; menü kaydı fiyat kalemini yazar ve toplamları aynı transaction'da yeniden hesaplar.",
    "Talep kapsamdaki etkinlikleri kimlik sırasıyla kilitler, eksiği kilit altında yeniden hesaplar; ekranın gördüğü eksik tutmazsa `NEEDS_CHANGED` (eşzamanlı aynı eksik testli).",
    "Maliyet alanları yalnız `recipes.view` olana döner — sunucuda süzülür (testli). Kilit sırası: reçete grafiği → reçete → malzeme; etkinlik → talep.",
  ),
  olcek: (("Reçete listesi / ekranı / önizleme", "13–21 ms"), ("İhtiyaç 7 / 31 gün", "151 ms / 1,1 sn"), ("Üretim planı 1 / 7 gün", "165 ms / 0,5 sn"), ("Talepler (derin sayfa 700)", "4–20 ms"), ("Grubu talebe çevirme", "134 ms")),
  olcek-not: [Ölçüm `scripts/perf-banquet-fnb.mjs`: 1.500 malzeme, 3.000 reçete, 44.681 etkinlik menüsü, 20.000 talep (200.290 satır). Ölçümle yapılan iyileştirme: 31 günlük ihtiyaç 2,6 → 1,1 sn, 1 günlük plan 0,69 → 0,17 sn (düz SQL, önbellekli birim ihtiyaç, tarih biçimlemenin tekilleştirilmesi).],
  degistir: (
    ("Yeni birim", "Sözleşmedeki birim aileleri ve çevrim tablosu (`recipes.js`) + yuvarlama kuralı; birim testleri genişletilmeli."),
    ("Gıda maliyeti eşikleri", "Ekrandaki %30 / %38 adlandırılmış sabitler; otel ayarına taşınabilir."),
  ),
  devir: ("Sözleşme dizini `export *` ile toplanır: aynı ad iki dosyada olursa sessizce kaybolur; dizin denetimi testi bunu yakalar — yeni sözleşme adı benzersiz olmalı.",),
)
