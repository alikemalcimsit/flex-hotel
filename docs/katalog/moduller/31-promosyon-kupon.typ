#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: ["Erken rezervasyon %15", "3 gece kal 2 gece öde", "son dakika 500 TL" gibi kurallar ekrandan tanımlanır; kuralın cümlesi yazarken canlı okunur. Uygun promosyon rezervasyona kendiliğinden düşer, kupon kodu girilince fiyat anında yeniden hesaplanır. Bir rezervasyona tek indirim uygulanır — misafir için en avantajlısı. Konaklama kısalıp şart bozulursa indirim geri alınır ve fark folyoya işlenir; iptal edilen rezervasyonun kupon hakkı geri açılır.],
  rakam: (("3 tür", "yüzde · tutar · X kal Y öde"), ("Tek indirim", "misafire en avantajlısı"), ("100 bin", "kuponla ölçüldü: liste 11–20 ms"), ("Söz değişmez", "kural rezervasyona kopyalanır")),
  adimlar: (("Kural", "koşullar + indirim"), ("Yayın", "eksikler denetlenir"), ("Rezervasyon", "kendiliğinden ya da kuponla"), ("Fiyat", "gece gece indirim"), ("Rapor", "kullanım · net etki")),
  ozellik: (
    ("Kural motoru", "Koşullar: satış ve konaklama dönemi, en az / en çok gece, erken rezervasyon / son dakika günü, oda tipleri, pansiyonlar, satış kanalları."),
    ("Kupon üretimi", "Toplu rastgele (karışmayan harfler, isteğe bağlı önek) ya da tek kod; tek / sınırlı / sınırsız kullanım; Excel'e aktar, kapat / aç."),
    ("Rezervasyon formunda", "Tip kartında liste fiyatı + indirim; kuponun durumu: uygulanıyor / daha avantajlısı var / uymuyor / geçersiz / hak yetmez."),
    ("Düzenleme ve erken çıkış", "Konaklama ya da pansiyon değişince şart yeniden denetlenir; önizleme indirimin akıbetini kaydetmeden söyler."),
    ("Kullanım raporu", "Satış ya da giriş gününe göre: geçerli / iptal, gece, liste, indirim, net, kupon; toplamlarla."),
    ("Kanallar", "WhatsApp, web sohbet ve AI asistanı fiyatı konuşmanın kanalıyla sorar; kanala özel promosyon misafire söylenen fiyatla aynı açılır."),
  ),
  neden: [İndirim kuralı resepsiyonun hafızasına değil sisteme yazılır: misafire söylenen fiyat ile kesilen fiyat aynıdır, kuponun kaç kez kullanıldığı tartışılmaz.],
  rol: (([Müdür], [Promosyon ve kupon yönetir.]), ([Müdür, muhasebe], [Promosyonları ve kullanım raporunu görür.]), ([Rezervasyon personeli], [Rezervasyona kupon girer (rezervasyon izinleriyle).])),
  baglantilar: ("*Rezervasyon (4):* açma, grup, kanal isteği, kapasite onayı, önizleme ve düzenleme aynı kuraldan.", "*Acente ve kontrat (29):* acente satışına promosyon da kupon da uygulanmaz.", "*Folyo (15):* şart bozulunca fark düzeltme kalemi olarak.", "*Konuşarak rezervasyon (8):* rezervasyon isteği kupon kodunu taşır."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/promotions`: promosyon kartı ve yaşam döngüsü (taslak → yayında ⇄ durduruldu), kupon üretimi ve listesi, kullanım raporu. Kural motoru `promotions/rules.js` saf ve birim testlidir; rezervasyon servisi açma, grup, kanal isteği, önizleme ve düzenlemede bu motoru çağırır. Rezervasyona `promotionId`, `couponId`, `promotionTerms` (açılıştaki kopya + satış günü) ve `discountTotal` yazılır; gecede `discount` (liste fiyatı = tutar + indirim). Yeni uç `POST /reservations/:id/preview` düzenlemenin aynı hesabını yazmadan yapar.],
  kural: (
    ("İndirim dağıtımı", "Yalnız konaklama dönemindeki gecelere. Yüzde her geceye (kuruşa); tutar gecelere fiyatları oranında (kuruş kalanı tarih sırasıyla, toplamı aşmaz); \"X kal Y öde\" her X gecede en ucuz (X − Y) gece bedava (eşit fiyatta sondaki)."),
    ("En avantajlı", "Kendiliğinden promosyonlar ve kuponun promosyonu arasından misafire en avantajlısı; eşitlikte kendiliğinden (kupon hakkı harcanmaz)."),
    ("Kupon hakkı", "Sayaç tutulmaz: kupon satırı kilitlenip kuponla açılmış geçerli rezervasyonlar sayılır — iptalde hak kendiliğinden geri açılır. Her oda bir kullanım; grupta hak yetmezse hiçbiri açılmaz."),
    ("Düzenleme", "Kopyadaki koşullar kopyadaki satış günüyle yeniden denetlenir; tutmuyorsa indirim kalkar (içerideki misafirin geçmiş geceleri dahil; fark folyoya). Acente atanınca ya da elle fiyat girilince kalkar."),
    ("Gelmedi ücreti", "Konaklama tek geceye iner, şart o gece için denetlenir (bedava ilk gece ücretsiz sayılmaz)."),
  ),
  tutarlilik: (
    "Kilit sırası: rezervasyon → oda tipi → acente → promosyon → kupon. Aynı kuponla 8 eşzamanlı rezervasyonda tek kullanımlık kupon bir kez geçer (testli).",
    "İptal geri alınırken kupon kilitlenip yeniden sayılır; başkası kullandıysa geri alma reddedilir.",
    "CHECK'ler: türle indirim değeri tutarlı, acente kanalı yok, kupon ↔ promosyon ↔ kopya tutarlı, acente satışında ve elle fiyatta promosyon yok.",
    "Kart sürüm kontrollü; kupon üretimi başına tek denetim kaydı; kanal `promotions.changed`.",
  ),
  olcek: (("Liste", "9–13 ms"), ("Kupon listesi", "11–20 ms"), ("Kullanım raporu", "17–21 ms"), ("Fiyat önizlemesi", "14 ms (kuponla 16 ms)"), ("Rezervasyon açma", "~85 ms"), ("Aynı kuponla 8 eşzamanlı", "~560 ms")),
  olcek-not: [Ölçüm `scripts/perf-promotions.mjs`: yayında 250 promosyon, 100 bin kupon, 27 bin promosyonlu rezervasyon, 550 bin rezervasyonlu tablo.],
  degistir: (
    ("Yeni koşul", "`promotions/rules.js` (birim testli) + sözleşme şeması + formdaki cümle üreticisi; kopya (`promotionTerms`) yeni alanı da taşımalı ki eski rezervasyonların sözü değişmesin."),
    ("Yeni indirim türü", "Kural motoru dağıtım fonksiyonu + Prisma enum + migration + CHECK (türle değer tutarlılığı)."),
  ),
  devir: ("Web widget (32): `POST /reservations/quote` (`couponCode`, `source: 'WIDGET'`; dönen `coupon.status`) ve `reservation.requested` olayında `couponCode`.", "Fiyat planı (28) ve yield (34) liste fiyatını değiştirir; promosyon onun üstüne uygulanır. Sadakat (56) `createCoupons` kullanabilir."),
)
