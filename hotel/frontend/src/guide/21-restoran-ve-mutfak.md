# Restoran, mutfak ve oda servisi

Bu bölüm otelin yiyecek-içecek tarafını anlatır: menü ve masa tanımlarından garsonun vardiya açmasına, siparişin mutfağa düşmesinden adisyonun kapanmasına, oda servisinden paket servise, reçete maliyetinden banket menüsüne kadar. Her ekran için **nerede bulunur**, **ne yapar**, **adım adım nasıl kullanılır**, **arka planda ne otomatik olur**, **dikkat edilecekler** düzeni izlenir. Her alt bölümde sayılarla anlatılan bir örnek vardır.

Kime hitap eder: garson, şef garson, mutfak, oda servisi, kurye, F&B müdürü, muhasebe ve sistemi başkasına anlatacak ürün sahibi.

Üç ilke bütün bölümü özetler:

- **Adisyon gerçeğin kaydıdır.** Siparişin kalemleri gönderildiği anki ad / fiyat / vergi / istasyonla kopyalanır; menü sonradan değişse adisyon değişmez.
- **Para yalnızca açık vardiyaya girer.** Vardiyası olmayan garson adisyon açamaz, ödeme alamaz; nakit garsonun vardiya kasasında birikir ve kapanışta sayılır.
- **Düzeltmeler gerekçelidir, büyükleri dört gözdür.** İkram, iptal ve indirim şef garson yetkisi ve gerekçe ister; eşik üstü düzeltme ve büyük tahsilat onay kuyruğuna gider.

## Nasıl birbirine bağlanır: büyük resim

| Adım | Ekran | Arka planda ne olur |
|------|-------|---------------------|
| Garson vardiya açar | Restoran → Masa planı → vardiya çubuğu | Kasa avansı kaydedilir; bu garsonun alacağı para bu vardiyaya yazılır |
| Masaya dokunur, sipariş girer, "Gönder" | Masa planı → Adisyon ekranı | Sipariş turu açılır, kalemler kopyalanır, **"sipariş verildi"** olayı yayınlanır → Mutfak ekranına kart düşer |
| Mutfak "Başla" / "Hazır" | Mutfak ekranı | Tur durumu ilerler; "hazır" olunca **garsonun ziline** haber düşer |
| Garson "Servis edildi" | Adisyon ekranı | Tur kapanır |
| Ödeme alınır ya da odaya yazılır | Adisyon ekranı → Ödeme | Adisyon kapanır; **"adisyon kapandı"** olayı → Stok aktörü reçeteden malzeme düşer; odaya yazıldıysa **"odaya yazıldı"** olayı → Folyo aktörü misafirin folyosuna kalem işler |
| Vardiya kapanır, nakit sayılır | Vardiyalar → Vardiya ekranı | Beklenen − sayılan = fark; eşik üstü fark şef garsona uyarı |

## Menü ve tanımlar

**Nerede:** Restoran → **Menü ve tanımlar** (`/pos/tanimlar`). Tanım yetkisi (müdür) ister. Üstteki çiplerle bölüm seçilir: ürünler, gruplar, masalar, satış noktaları, politika.

**Ne yapar:** Restoranın "sabit" tanımlarını tutar. Burada silme yoktur: bir kere satılmış kayıt **pasife alınır**; geçmiş adisyonlar bozulmaz.

### Satış noktaları

Satış noktası restoranın bir "kasası / birimi"dir: ana restoran, bar, havuz bar, oda servisi, paket servis.

| Alan | Ne anlama gelir |
|------|-----------------|
| Ad, kod | Masa planında ve raporlarda görünür |
| Tür | **Salon** (masalı), **Oda servisi** (masasız, odaya yazmaya açık), **Paket servis** (masasız, kurye) |
| Odaya yaz açık / kapalı | Kapalıysa bu noktadan odaya yazılamaz (örneğin dış müşteriye açık kafe) |
| Aktif | Pasif nokta terminalde görünmez |

Masa planı yalnızca **salon** türündeki noktaları gösterir. Açık paket siparişi varken paket noktasının türü değiştirilemez / nokta kapatılamaz.

### Masalar

Satış noktasına bağlı; **bölüm** (teras, iç salon…) ve kişi kapasitesi. Toplu ekleme ile "T1…T20" gibi seri açılır. Masa planında bölüm bölüm kutular hâlinde görünür.

### Menü grupları

Ad, sıra, aktif; **satıldığı satış noktaları** (boşsa her yerde). Örnek: "Kokteyller" grubu yalnız barda görünür.

### Ürünler

| Alan | Ne anlama gelir |
|------|-----------------|
| Grup, kod, ad, açıklama | Sepette ve fişte görünen ad |
| Fiyat | **Vergi dahil** satış fiyatı |
| Vergi kategorisi | Folyo ve kasa vergi dökümü bu kategoriyle hesaplar (yiyecek %10, alkol %20 gibi — oteldeki tanıma göre) |
| Mutfak istasyonu | **Sıcak / Soğuk / Bar / Pastane / Yok**. Mutfak ekranındaki süzgeç bunu kullanır; "Yok" mutfağa gitmez |
| Aktif, sıra | Terminal düzeni |
| Tükendi | Geçici kapatma; terminalde düğme kapalı görünür, tanım bozulmaz |

**Sistem ürünleri:** "Oda servisi ücreti" (tepsi ücreti) ve "Paket servis ücreti" **gizli sistem ürünleridir**. Tanım ekranında ve terminalde görünmez, düzenlenmez; sistem kendisi ekler. İstasyonu "Yok"tur (mutfağa gitmez) ve **reçetesi olmadığı için stok düşümünde atlanır**.

### Politika

| Alan | Ne yapar |
|------|----------|
| Dört göz eşiği | Bu tutara eşit ya da üstü ikram / iptal / indirim ve büyük tahsilat onay kuyruğuna gider |
| Kasa farkı uyarısı | Vardiya kapanışında beklenen ile sayılan nakit farkı bu sınırı aşarsa şef garsona uyarı |
| Oda servisi: tepsi ücreti, teslim hedefi (dk), hazırlık payı (dk), tepsi uyarısı (dk), misafir siparişi açık mı | Oda servisi bölümünde anlatılır |
| Paket servis: paket ücreti, en az sipariş tutarı, teslim hedefi (dk) | Paket servis bölümünde anlatılır |

**Örnek tanım seti:** Satış noktası "Ana Restoran" (salon, odaya yaz açık), bölümler "İç salon" (T1–T12) ve "Teras" (T13–T20). Gruplar: Çorbalar, Ana yemekler, İçecekler. Ürün "Izgara köfte": 380 TL, vergi kategorisi yiyecek, istasyon Sıcak. Politika: dört göz eşiği 500 TL, kasa farkı uyarısı 100 TL.

## Vardiyalar

**Nerede:** Restoran → Masa planı üstündeki **vardiya çubuğu**; liste Restoran → **Vardiyalar** (`/pos/vardiyalar`); vardiya ekranı listeden.

**Ne yapar:** Garsonun çalışma dönemini ve **kasasını** tutar. Bir garsonun aynı anda tek açık vardiyası olur.

### Vardiya açma

1. Masa planına girin. Vardiya yoksa çubuk "Vardiya aç" der.
2. Satış noktasını seçin, **kasa avansını** (bozuk para olarak kasaya konan tutar) yazın.
3. Açın. Çubukta açılış saati, avans, beklenen nakit, açık adisyon sayısı ve onay bekleyenler görünür.

### Vardiya kapatma

1. Vardiya ekranında "Kapanışı engelleyenler" listesi boş olmalı: açık adisyon, onay bekleyen düzeltme / ödeme varsa önce onlar çözülür.
2. **Sayılan nakit** girilir; fark önizlemesi anında görünür.
3. Kapat. Kapanış vardiyayı **özel kilitler**: sayım sırasında kasaya para girmez.

**Beklenen nakit** = avans + işlenmiş nakit ödemeler − iptal edilen nakit ödemeler. **Fark** = sayılan − beklenen.

**Örnek:** Avans 500 TL. Vardiyada 7 nakit ödeme toplam 4.300 TL, biri (300 TL) hatalı girilip iptal edildi. Beklenen = 500 + 4.300 − 300 = **4.500 TL**. Garson 4.380 TL sayar → fark **−120 TL**. Politika eşiği 100 TL olduğundan şef garsona uyarı düşer. Fark vardiya kaydında kalır; rapor ve kasa ekranında görünür.

### Vardiya raporu

Vardiya ekranı: kasa (avans, nakit net, beklenen, sayılan, fark), satış özeti, yöntem bazında tahsilat (nakit / kart), odaya yazılan, indirim / ikram / iptal / zayi tutarları, en çok satanlar; **yazdırılabilir vardiya fişi**. Garson yalnızca kendi vardiyalarını görür; şef garson ve raporcu hepsini.

### Arka planda

| Ne tetikler | Ne olur | Nerede görünür | Dikkat |
|-------------|---------|----------------|--------|
| Vardiya 16 saati geçti | Zamanlanmış iş (15 dk) şef garsona bir kez uyarı | Zil | Unutulan vardiya kasayı bozar |
| Adisyon 8 saati geçti | Aynı iş şef garsona bir kez uyarı | Zil | Unutulan açık masa |
| Kapanışta fark eşik üstü | Şef garsona uyarı | Zil, vardiya ekranı | Fark gizlenmez, kayda geçer |

Vardiyanın nakit hareketleri otelin **Kasa** ekranında "Restoran" kaynağıyla görünür (folyo ve etkinlik tahsilatıyla yan yana).

## Masa planı ve adisyon

### Masa planı

**Nerede:** Restoran → **Masa planı** (`/pos/masalar`; satış noktası adres çubuğunda `?nokta=`). Garson yetkisi.

Bölüm bölüm masa kutuları: **boş / dolu / hesap istiyor**; dolu masada adisyon numarası, kişi, geçen süre, tutar. Altında masasız adisyonlar. Boş masaya dokunmak adisyon açar (kişi sayısı hızlı seçimi: 1, 2, 3, 4, 5, 6, 8, 10); dolu masaya dokunmak adisyonuna gider (birden çok adisyon varsa seçtirir). Canlı bağlantı yokken plan 15 saniyede bir yenilenir.

### Adisyon ekranı

**Nerede:** `/pos/adisyon/:id`. Adisyon numarası **ADS-yıl-sıra** biçimindedir.

Sol tarafta dokunmatik menü (gruplar, ürün düğmeleri — tükenen kapalı — ve arama), sepet (adet, satır notu) ve **Gönder**. Sağda turlar ve kalemler, kalem başına ikram / iptal, indirim, toplam ve vergi dökümü, ödeme ve odaya yaz, böl / taşı / birleştir / devret, hesap fişi ve tur başına mutfak fişi.

#### Sipariş turu

1. Ürünlere dokunun; adet artırın; gerekiyorsa satır notu yazın ("az pişmiş", "soğansız").
2. **Gönder**. Tur mutfağa gider; kalemler adisyona o anki ad / fiyat / vergi / istasyonla yazılır.
3. Turun yanında **mutfak durumu rozeti** (yeni / hazırlanıyor / hazır) görünür; hazır turda garson "**Servis edildi**" der.

Sepet dolunca bir istek kimliği üretilir: çift dokunuş ya da ağ tekrarı **ikinci tur açmaz**.

#### İkram, iptal, zayi, indirim

Kalem menüsünden **ikram** (misafire bedava), **iptal** (yanlış girildi, hazırlanmadı) ya da **iptal + zayi** (hazırlandı ama servis edilmedi — malzeme gitti); adisyon menüsünden **indirim** (yüzde ya da tutar). Hepsi **şef garson yetkisi + gerekçe** ister.

- Politikadaki eşiğe eşit ya da üstü düzeltme **dört göz** onayına gider (onay türü "POS düzeltme"); isteyen kendi isteğini onaylayamaz.
- Onay bekleyen düzeltme varken ödeme alınmaz; bekleyen ödeme varken toplam değişmez.
- Onaylanan düzeltme ödemeyi aşacaksa uygulanmaz; isteyene "uygulanamadı" döner.
- İndirim: yüzde kuruşa, tutar ara toplamı aşmaz; vergi kategorilerine kuruş kuruş dağıtılır.

**Örnek:** 4 kişilik masada 2 × köfte (380) + 2 × tavuk (320) + 4 × ayran (40) = 1.560 TL. Bir köfte yanlış pişti, yeniden yapıldı: garson eski köfteyi "iptal + zayi" ister (380 TL; eşik 500 altı → şef garson onayı yeterli, dört göz gerekmez). Masa şikâyetçi; şef garson %10 indirim verir: indirim 118 TL (1.180'in %10'u), vergi kategorilerine oranla dağıtılır. Ödenecek: **1.062 TL**. Zayi edilen köftenin malzemesi stoktan yine düşer (bkz. Stok bölümü).

#### Hesap bölme, taşıma, birleştirme, devir

- **Böl:** kalemler yeni adisyona taşınır (serbest adet; onay bekleyen kalem taşınmaz). "Kişi başı" bölüşme ödeme penceresinde ayrı seçenektir.
- **Taşı:** adisyonu başka masaya.
- **Birleştir:** iki adisyonu tek adisyona; turlar devam numarasıyla taşınır.
- **Devret:** adisyonu başka garsona (vardiya değişiminde).

Hepsi ekranın gördüğü sürümle gönderilir; arada adisyon değiştiyse sunucu reddeder ve ekran tazelenir.

#### Ödeme

1. "Ödeme": nakit ya da kart; **hızlı nakit** düğmeleri; para üstü otomatik; kısmi ödeme mümkün (kalan görünür); **kişi başı** bölüşme.
2. Ödeme, parayı alan garsonun vardiya kasasına yazılır. Eşik üstü tek ödeme dört göz onayına gider (onay türü "POS ödeme").
3. Toplam karşılanınca adisyon **kapanır** (kapanışta alınan + odaya yazılan = toplam kuralı veritabanında da denetlenir).

Hatalı ödeme "ödeme iptali" ile ters kayıtla düzeltilir (dört göz). Çift dokunuş ikinci ödeme almaz (istek kimliği). Aynı anda iki tam ödeme denemesinden yalnız biri geçer.

#### Odaya yaz

1. "Odaya yaz": oda numarası ya da soyadıyla içerideki misafir aranır.
2. Tutar seçilir (tamamı ya da bir kısmı). Hariç vergili kalemler (servis ücreti gibi) yüzünden kuruşu tutmayan tutar reddedilir ve **en yakın iki tutar önerilir** (yuvarlama önerisi).
3. Onaylanınca **"odaya yazıldı"** olayı yayınlanır; **Folyo aktörü** kalemleri vergi kategorisiyle misafirin folyosuna işler. Folyo aynı vergi motoruyla toplamı **birebir** bulur.

Satış noktasında "odaya yaz" kapalıysa ya da misafir çıkış yapmışsa reddedilir. Yeniden açma yalnızca aynı iş günü, vardiya açıkken ve odaya yazılmamış adisyonda mümkündür.

#### Fişler

Hesap fişi ve tur başına mutfak fişi **bilgi fişidir**; mali yazar kasa (ÖKC) entegrasyonu kapsam dışıdır. Yazdırma penceresi açılamazsa tarayıcının açılır pencere iznini verin.

### Arka planda: adisyon olayları

| Ne tetikler | Ne olur | Nerede görünür | Kapalıysa / hatada |
|-------------|---------|----------------|--------------------|
| Tur gönderildi | "sipariş verildi" olayı: nokta, masa, kişi, garson, kalemler, istasyon, not | Mutfak ekranı kartı | Mutfak ekranı sunucuya bağlı değilse pano yeniden okununca gelir |
| Adisyon kapandı | "adisyon kapandı" olayı: ürün başına satılan / ikram / zayi adet | Stok → Hareketler (satış düşümü) | Stok aktörü kapalıysa "Stok" manuel görevi düşer (bkz. Stok bölümü) |
| Odaya yazıldı | "odaya yazıldı" olayı: kalemler, vergi kategorisi, konaklama | Folyo → ilgili misafir | Folyo aktörü kapalıysa "Folyo" manuel görevi; aynı tekrar işleme anahtarı ile iki kez işlenmez |
| Adisyon yeniden açılıp kapandı | "adisyon kapandı" yeniden yayınlanır | Stok düzeltme hareketi | Tüketici son yayını esas alır |

### Adisyonlar listesi

**Nerede:** Restoran → **Adisyonlar** (`/pos/adisyonlar`). Durum, satış noktası, garson, kapanış iş günü aralığıyla süzülür; numara ("123") ya da masa adıyla aranır. Kapanmış adisyonu bulup yeniden yazdırmak, ödemesini görmek için.

## Mutfak ekranı (KDS)

**Nerede:** Restoran → **Mutfak ekranı** (`/pos/mutfak-ekrani`). Kabuksuz tam genişlik (mutfak tabletine uygun); süzgeçler adres çubuğunda (satış noktası, istasyon). Garsonla aynı yetkiyle girilir.

**Ne yapar:** Açık adisyonların servis edilmemiş turlarını kart kart, en eski önde gösterir (üst sınır 300). Kartta masa (ya da "Oda 412 · 07:30" / "Paket · müşteri"), kalemler, geçen süre; renk: **yeni** (mavi), **hazırlanıyor** (mor), **10 dk** sarı, **20 dk** kırmızı, **hazır** yeşil. Süre yarım dakikada bir tazelenir.

### Adım adım

1. İstasyon süzgecini seçin (Sıcak / Soğuk / Bar / Pastane). "Yok" istasyonu (tepsi ücreti) mutfağa hiç gelmez.
2. Kartta "**Başla**" → tur **hazırlanıyor**.
3. "**Hazır**" → tur **hazır**; salondaki turda garsonun ziline haber düşer (adisyon başına tek uyarıda toplanır; hesabı kapatılmış garsona zil yok).
4. Salon turunda "**Servis edildi**" garson tarafından (adisyon ekranı) ya da mutfak ekranından verilebilir. **Oda servisi ve paket turunda mutfak ekranı "servis edildi" vermez**; teslim ilgili panodan yapılır.

### Kurallar

- Durum yalnızca **ileri** gider (yeni → hazırlanıyor → hazır → servis edildi).
- İki tablet aynı karta aynı anda dokunursa ikincisi "bayat" uyarısı alır ve kart tazelenir.
- Kapanmış adisyonun turu panoda yoktur. Tamamen iptal edilmiş tur ve iptal edilen kalemler görünmez.
- **Oda servisi turu:** sipariş ancak mutfakta bekleyen (görünür kalemli) başka tur kalmayınca "hazır" olur; yoldaki siparişe dokunulmaz. Planlı (kahvaltı) siparişin turu zamanı gelene kadar yazılmaz; mutfak yalnızca düşmüş turu görür.

**Örnek:** 19:42'de T7'den 2 köfte + 1 çorba gelir. Sıcak istasyonu kartı mavi görür; 19:45 "Başla" (mor). 19:53 kart sarıya döner (10 dk geçti). 19:56 "Hazır" (yeşil); garson Ayşe'nin ziline "T7 hazır" düşer. Ayşe servis edip adisyon ekranında "Servis edildi" der; kart panodan kalkar.

## Oda servisi

**Nerede:** Restoran → **Oda servisi** (`/pos/oda-servisi`); alt sekmeler: pano, hazırlık listesi, geçmiş, rapor; **Toplanacak tepsiler** ayrı menü maddesi (`/oda-servisi/tepsiler`, kat görevlisi de görür). Sipariş numarası **OS-yıl-sıra**.

**Ne yapar:** Odaya siparişi alır (telefon / misafir QR / misafir isteğinden), mutfağa düşürür, teslimi ve tepsiyi takip eder; teslimde ücreti folyoya yazar ya da kapıda alır.

### Politika (Menü ve tanımlar → politika)

| Alan | Ne yapar | Örnek |
|------|----------|-------|
| Tepsi ücreti | Sipariş başına sabit ücret; adisyonda ayrı "Oda servisi ücreti" kalemi (vergisi F&B; şef garson ikram edebilir); 0 = yok | 50 TL |
| Teslim hedefi | Siparişin kaç dakikada teslim edilmesi beklenir; pano kalan süreyi ve gecikmeyi buna göre gösterir | 35 dk |
| Hazırlık payı | İleri saatli siparişin mutfağa kaç dakika önce düşeceği | 30 dk |
| Tepsi uyarısı | Teslimden sonra toplanmayan tepsi için uyarı süresi | 90 dk |
| Misafir siparişi açık | QR bağlantısından sipariş alınır mı | Evet |

### Yeni sipariş (personel)

1. Pano → "Yeni sipariş": içerideki konaklamayı oda numarası ya da soyadıyla bulun.
2. Oda servisi noktasını ve menüden kalemleri (adet, not) seçin; misafirin notu, kişi.
3. Teslim zamanı: **Hemen** ya da **İleri saat (kahvaltı kartı)** — yarın sabah kısayolları 07:00 / 07:30 / 08:00 / 08:30 / 09:00. Saat **otelin duvar saatidir**. İstenen an en az 10 dk sonra, en fazla 3 gün sonra ve çıkış gününden sonra olamaz.
4. Tepsi bırakılacak mı işareti. Kaydet.

Hemen siparişte: masasız adisyon + tur + tepsi ücreti kalemi açılır, mutfak ekranına düşer. İleri saatli siparişte **"planlı"** durumuna girer; teslim − hazırlık payı anında dakikalık iş mutfağa düşürür (o an geçmişse hemen).

### Misafir QR siparişi

- Rezervasyon ekranında "**Oda servisi bağlantısı**": konaklamaya ve odaya bağlı imzalı adres; QR kodu ve basılı oda kartı. Yenilemek eskisini geçersiz kılar; **oda değişince ve çıkışta kendiliğinden geçersiz** olur.
- Misafir menüyü görür, sipariş verir; konaklamada en fazla **3 açık** sipariş. Sipariş **kabul bekler**: personelin ziline "yeni misafir siparişi" düşer; kabulde kalemler değiştirilebilir (tükenen ürün), ret sebep ister.
- Kimse kabul etmezse teslim hedefini 30 dk aşınca kendiliğinden **reddedilir**; misafir "zamanında kabul edilemedi; oda servisini arayın" görür, şef garsona bilgi.
- Misafir sipariş verdikten sonra oda değiştirdiyse mutfağa düşüşte **şimdiki oda** yazılır.
- Hız sınırı bağlantı başına; politika kapalıysa bağlantı menüyü gösterir ama sipariş almaz.

### İstekten siparişe

Misafir "kahvaltı istiyorum" gibi bir istek açtıysa (İstekler menüsü) istek detayında "**Siparişe çevir**" formu dolu açılır; teslimde istek tamamlanır.

### Pano ve adımlar

Pano sütunları: **onay bekleyen / mutfakta / hazır / yolda**; her kartta hedefe kalan süre ve gecikme; planlı ve tepsi sayaçları; vardiya çubuğu. Durum sırası: istendi → planlı → alındı → hazırlanıyor → hazır → yolda → teslim edildi (iptal / ret ayrı). Mutfak adımları KDS ile senkrondur; "yolda"dan "hazır"a geri dönülebilir (yanlış dokunuş).

### Teslim

1. Kartta "**Teslim**": varsayılan **odaya yaz**.
2. Misafir isterse **kapıda nakit / kart** (götürenin kasasına; bölünebilir; para üstü). Kalan odaya yazılır (önizleme).
3. Teslim **tek işlemdir**: kapı ödemeleri + kalanın odaya yazılması + adisyonun kapanması + turların "servis edildi" olması + isteğin tamamlanması birlikte. Çift dokunuş ikinci teslim yapmaz.

Teslimden önce adisyon ekranında ödeme / odaya yaz / kapat yoktur; oda servisi adisyonu bölünmez, taşınmaz, birleşmez. Tur eklenebilir (hazır sipariş mutfağa döner; yoldakine eklenmez).

### İptal

Mutfak başlamadıysa garson iptal eder; mutfak başladıysa **şef garson + zayi** (malzeme stoktan yine düşer). Planlı ve henüz düşmemiş sipariş adisyonsuz iptal edilir.

### Tepsi toplama

Teslim edilmiş, tepsi bırakılmış, toplanmamış siparişler **Toplanacak tepsiler** listesinde en eski önde; uyarı süresini geçenler işaretli. Kat görevlisi ya da oda servisi tek tek ya da toplu "toplandı" der. **24 saatlik pencere**: sonrası oda temizliğiyle toplanmış sayılır (liste sonsuza büyümez). Misafir oda değiştirdiyse tepsi eski odadadır.

### Hazırlık listesi (kahvaltı kartı)

Seçilen günün (varsayılan yarın) teslim saatli siparişleri: günün üretim toplamı (ürün başına adet, notlu kalem ayrı) ve **15 dakikalık teslim aralıkları** (odalar, kalemler, durumlar). Mutfak sabah bu listeyle hazırlar; yazdırılır.

### Rapor

Sipariş günü aralığı (en fazla 31 gün): sipariş sayıları, zamanında teslim oranı, süreler (mutfak / yol / toplam — ortalama, medyan, %90; hemen ve planlı ayrı), misafir siparişinin kabul süresi, ciro (kapanış iş gününe göre; kapıda / odaya; oda servisi ücreti), kaynak, götüren, saat ve gün kırılımı, toplanmamış tepsiler.

### Arka planda: dakikalık iş

| Ne tetikler | Ne olur | Nerede görünür |
|-------------|---------|----------------|
| Planlı siparişin zamanı geldi | Mutfağa düşer (girenin vardiyasında; yoksa oda servisi noktasının en erken açılmış vardiyasında; vardiya yoksa bir kez uyarı) | KDS kartı, pano "mutfakta" |
| Konaklama bitti, sipariş mutfağa düşmemiş | İptal edilir; mutfaktaki için uyarı | Pano, zil |
| Misafir siparişi 5 dk kabul bekliyor | Uyarı | Zil |
| Teslim hedefi geçti | Gecikme uyarısı (her sipariş bir kez) | Pano kırmızı, zil |
| Tepsi uyarı süresini geçti | Uyarı | Toplanacak tepsiler |

**Örnek:** Oda 412, 2 kişi, kahvaltı kartı: 2 × "Serpme kahvaltı" (250), teslim 07:30. Hazırlık payı 30 dk → sipariş 07:00'de mutfağa düşer; KDS kartı "Oda 412 · 07:30". Tepsi ücreti 50 TL kalem olarak eklenir. 07:28 "yolda", 07:33 teslim: misafir odaya yazdırır → folyoya "Oda Servisi · OS-2027-0142" 550 TL, vergi kategorisiyle. Tepsi 09:30'da toplanmamış → uyarı; kat görevlisi 09:40'ta "toplandı" der. Stok aktörü serpme kahvaltının reçetesinden 2 porsiyonluk malzemeyi düşer; tepsi ücretini atlar.

## Paket servis

**Nerede:** Restoran → **Paket servis** (`/pos/paket` pano, `/pos/paket/gecmis`, `/pos/paket/yeni`, sipariş `/pos/paket/siparis/:id`). Sipariş numarası **PS-yıl-sıra**.

**Ne yapar:** Dışarıdan telefonla / mesajla / web platformundan gelen siparişi personel girer; aynı POS zincirinden geçer (adisyon, mutfak ekranı, stok); kurye atanır; kapıda ya da önceden ödenir.

Kararlar: kurye **otel personelidir** (açık vardiyası olan); ödeme **kapıda (nakit / kart)** ya da **önceden** (kart / havale referansıyla; gerçek online tahsilat yok); public sipariş sayfası **şimdilik yok**; **sabit paket ücreti + en az sipariş tutarı** politikadan.

### Yeni sipariş

1. "Yeni sipariş": telefon girilince **tekrar gelen müşteri** adı ve adresiyle bulunur (telefon otelin ülke koduyla rakam olarak saklanır).
2. Müşteri adı, adres + tarif, kaynak (telefon / mesaj / web platformu).
3. Kalemler; ücret ve **en az tutar önizlemesi** (en az tutar ücret hariç ürün toplamına bakar).
4. Ödeme: kapıda nakit (bozuk para notu) / kapıda kart / önceden ödendi (referans). Kalan varsa kapı yöntemi şart.
5. Kaydet: girenin vardiyasında masasız adisyon + tur (+ paket ücreti kalemi) açılır; mutfak ekranına "Paket · müşteri" kartı düşer.

Ön ödeme girenin kasasına yazılır; **tamamı ödense de adisyon teslime kadar açık kalır** (mutfak ve kurye görür).

### Kurye ve teslim

1. Hazır olunca "**Kurye ata**" (açık vardiyalı personel listesi); kuryenin ziline düşer.
2. "**Yola çıkar**": kapıda para varsa kuryenin açık vardiyası gerekir (para onun kasasına girecek).
3. "**Teslim**": kapı ödemeleri kuryenin kasasına; kalan tam kapanır (açık hesap / odaya yaz yok); adisyon kapanır; turlar servis edildi. Tekrar teslim aynı sonucu verir.

İptal: mutfak başladıysa şef garson + zayi; ön ödemeli siparişte önce ödeme iptali. Adisyon ekranında paket adisyonu bölünmez / taşınmaz / birleşmez; teslimden önce ödeme-kapatma yok; tur eklenebilir (hazır → mutfağa döner; yoldayken yok).

Pano günün özetini (teslim, iptal, zamanında %) verir; gecikme kırmızıyla gösterilir (ayrı zil bilinçli olarak yok). Paket raporu ayrı yoktur; satış raporu paket noktasını kapsar.

**Örnek:** Politika: paket ücreti 30 TL, en az sipariş 300 TL. Telefonla 2 × köfte (760) + 1 × pide (220) = 980 TL + 30 = **1.010 TL**, kapıda nakit, "500'lük bozacak". Kurye Mehmet (vardiyası açık) atanır. Teslimde 1.010 TL nakit Mehmet'in kasasına yazılır; adisyon kapanır; stok aktörü 2 köfte + 1 pide reçetesini düşer, paket ücretini atlar.

## Satış raporu

**Nerede:** Restoran → **Satış raporu** (`/pos/rapor`). Rapor yetkisi (muhasebe, müdür).

İş günü aralığında (en fazla 31 gün) kapanmış adisyonlar: satış noktası, gün ve garson kırılımı; yöntem bazında tahsilat (nakit / kart); odaya yazılan; indirim / ikram / iptal / zayi; en çok satanlar. Vergi dökümü adisyon düzeyindedir. Oda servisi ve paket noktaları da buradadır. Ürün bazında **maliyet ve kâr** bu raporda değil, Stok → Maliyet raporu'ndadır.

## Reçeteler ve malzeme kartları

**Nerede:** **Mutfak** menüsü → **Reçeteler** (`/mutfak`) ve **Malzeme kartları** (`/mutfak/malzemeler`). Görmek müdür, F&B, muhasebe; düzenlemek müdür (şef için rol matrisinden verilir). **Maliyet alanları yalnızca reçete görme yetkisi olana döner**: ön büro menüyü görür, maliyeti görmez.

### Malzeme kartı

| Alan | Açıklama |
|------|----------|
| Kod, ad | Ad harf duyarsız tekil |
| Grup | Kasap, manav, kuru gıda… (ihtiyaç listesi ve satın alma bu gruba göre sıralar) |
| Stok birimi | kg, g, L, ml, adet. **Birim aileleri:** kg↔g, L↔ml çevrilir; aileler arası çevrim yok |
| Birim maliyet (KDV hariç) + maliyet damgası | Stok modülü mal kabulde **hareketli ortalamayla** günceller; elde stok varken elle değişmez |
| Alerjenler | 14 grup (gluten, süt, yumurta, fıstık…) |
| Kullanıldığı reçete satırları | Hangi reçetelerde geçtiği |

Kurallar: reçetede kullanılan malzemenin birim ailesi değişemez (kg ↔ L); stok hareketi / açık talep / açık siparişi olan malzemenin birimi değişmez; pasif malzeme reçeteye eklenemez.

### Reçete

Reçete bir **yemek** (verim: porsiyon) ya da **ara ürün**dür (verim: kg / L / adet — örneğin "domates sos 5 L", "köfte harcı 10 kg"). Alanlar: ad, tür, verim miktarı ve birimi, istasyon, **servisten önce hazırlık süresi** (0–3 gün; banket üretim planı kullanır), bağlı restoran ürünü (tek bağ), satırlar.

Satır: **malzeme ya da ara reçete** (tam biri), net miktar + birim (aile ile sınırlı), **fire %**.

**Brüt = net ÷ (1 − fire)**. Örnek: 150 g temizlenmiş soğan, fire %12 → brüt 150 ÷ 0,88 = **170,45 g** satın alınacak / stoktan düşecek soğan.

Ara reçete kullanan reçete açılır: ara ürünün kendi satırları, verimine oranlanarak dahil edilir. Derinlik en fazla 4 seviye; kendini içeremez (döngü denetimi, eşzamanlı kayıtlarda da).

### Reçete editörü — adım adım

1. Reçeteler → "Yeni reçete": ad "Izgara köfte", tür yemek, verim **1 porsiyon**, istasyon Sıcak, hazırlık 0 gün, bağlı ürün "Izgara köfte" (380 TL).
2. Satır ekle: Dana kıyma 180 g fire %0; Soğan 30 g fire %12; Ekmek içi 20 g; Yumurta 0,25 adet; Tuz-baharat 3 g; Pilav (ara reçete, 10 kg verim) 150 g; Közlenmiş biber 1 adet fire %5.
3. **Canlı maliyet önizlemesi** yazarken güncellenir: satır brütü × malzeme birim maliyeti.
4. Kaydet. Reçete kaydı otel başına **danışma kilidiyle** yapılır (döngü yarışı yok).

### Maliyet ve kâr marjı

Reçeteler listesi: porsiyon / birim maliyeti (güncel malzeme maliyetinden), menü ürününe bağlı yemekte **KDV hariç satış fiyatı** ve **gıda maliyeti %** — **%30 / %38 eşikleri** renkli; "yalnız menü ürünleri" süzgeci.

**Örnek hesap (köfte porsiyonu):** Kıyma 180 g × 520 TL/kg = 93,60; soğan brüt 34,09 g × 18 TL/kg = 0,61; ekmek içi 20 g × 60 TL/kg = 1,20; yumurta 0,25 × 6 = 1,50; baharat 3 g × 400 TL/kg = 1,20; pilav 150 g: ara reçete 10 kg'ın maliyeti 850 TL → 85 TL/kg → 12,75; biber brüt 1,05 adet × 8 = 8,40. **Porsiyon maliyeti ≈ 119,26 TL.** Satış 380 TL vergi dahil, yiyecek KDV %10 → KDV hariç 345,45. **Gıda maliyeti % = 119,26 ÷ 345,45 = %34,5** (sarı bölge: %30 üstü, %38 altı). Brüt kâr 226,19 TL.

### Alerjen

Reçetenin alerjenleri satırlardaki malzemelerden (ara reçeteler dahil) toplanır. Banket teklif ve sözleşmesinde menü içeriğiyle birlikte yazılır. Misafir kartındaki alerji tercihleri aynı alerjen kodlarını kullanır.

**Dikkat:**

- Reçetesi olmayan menü ürünü satılır ama stoktan **düşmez** ve maliyet raporunda maliyetsiz görünür.
- Kullanılan reçetenin verim ailesi değişemez; banket menüsündeki yemek ara ürüne çevrilemez.
- Ürün görseli ve QR menü JSON çıktısı yol haritasındadır.

## Etkinlikler / banket

**Nerede:** Ön büro → **Etkinlikler** (`/etkinlikler`): sekmeler dosyalar, salon takvimi, set menüler, malzeme ihtiyacı, mutfak planı, tanımlar (salonlar, ekipman, müşteriler, politika). Görmek müdür, ön büro, muhasebe, F&B; dosya açmak ve yönetmek "banket yönetimi"; tanımlar müdür; tahsilat müdür, ön büro, muhasebe.

**Ne yapar:** Düğün, toplantı, kokteyl gibi etkinlikleri salon takviminde tutar; teklif → sözleşme → depozito / taksit → proforma akışını yürütür; menüyü planlar ve malzeme ihtiyacı ile mutfak üretim planını çıkarır.

Numaralar: etkinlik **ETK-yıl-sıra**, teklif **TKL**, sözleşme **SZL**, proforma **PRF**; belge sürümleri "TKL-2026-0007/2".

### Tanımlar

- **Salon:** iki seviyeli **bölünebilir** (bütün salon → parçalar; "Balo A" + "Balo B" = "Balo salonu"); düzen başına kapasite (sıralı 300, banket 180, U 60…); saatlik / yarım gün / tam gün fiyatı; kurulum / söküm dakikası.
- **Ekipman:** stoklu (projeksiyon 3 adet); stok ileri tarihli kesin ayrımların altına düşürülemez.
- **Müşteri:** ad, yetkili, telefon, vergi no (aramalı seçici).
- **Politika:** opsiyon süresi, teklif geçerliliği, depozito %, imzalı sözleşme şartı, iptal kademeleri ("en az N gün kala %X" — 0 günü içermek zorunlu), sözleşme şartları metni, **fazla hazırlık payı %0–30**, **menü kesinleştirme süresi** (gün).

### Etkinlik dosyası ve opsiyon sırası

1. "Yeni dosya": müşteri (ara / yeni), etkinlik adı, tür, tahmini kişi. Durum **talep**.
2. **Program** sekmesi: oturum ekle — salon, düzen, kişi, başlangıç / bitiş (otelin saatiyle). Uygunluk önizlemesi kimin tuttuğunu, kaçıncı opsiyon olacağınızı ve kira önerisini (saatlik / yarım gün / gün — en ucuzu) gösterir.
3. "**Opsiyonla**": sıralı opsiyon — aynı saatte önce tutan 1. opsiyondur; yalnız 1. kesinleşir; opsiyon günü geçince düşer. Opsiyon bırakılınca / düşünce sırası yükselenin sorumlusuna zil.
4. "**Kesinleştir**": yalnız 1. opsiyon; politika imzalı sözleşme istiyorsa imzasız kesinleşmez. Kesin tutmalar farklı etkinlikler arasında çakışamaz (veritabanı kısıtı; aynı etkinliğin arka arkaya oturumları serbest). Kesinleşen salonda bekleyenlere zil.
5. Etkinlik günü sonrası "**Gerçekleşti**" (gerçekleşen kişi girilir) → fatura tarafı "faturaya hazır".

Faturalanacak kişi: kesinleşmeden **garanti** (yoksa tahmin); gerçekleşince **en çok (garanti, gerçekleşen)**.

### Fiyat kalemleri

Tablo: kategori, açıklama, oturum, ekipman, **kişi başı / adetli**, miktar, birim fiyat (vergi dahil), indirim, vergi kategorisi; kuruş hassasiyetli önizleme; tablo bütün olarak kaydedilir. Menüden gelen kalemler burada salt okunurdur (menü sekmesinden değişir).

### Menü (set menü → etkinlik menüsü)

- **Set menü kataloğu** (Etkinlikler → Set menüler): kurslar (çorba, ana, tatlı…), her kurs **hepsi** ya da **seçmeli**; yemekler (yemek reçeteleri), kişi başı porsiyon; kişi başı fiyat (vergi dahil), en az kişi; reçete yetkisi olana kişi başı maliyet ve gıda maliyeti % (seçmelide en pahalı seçenekle).
- Dosyanın **Menü** sekmesi: katalogdan başla → **kopyalanır, etkinlikte uyarlanır** (katalog sonradan değişse dosya bozulmaz). Oturum, servis anı, kendi kişi sayısı ya da etkinliğinki, fiyat / indirim / vergi, mutfak notu. Seçmeli kursta kişi sayıları ve canlı "**kalan**" (sabitler + bir kalan; aşım uyarısı). Menü kaydı **fiyat kalemini** yazar ve toplamları yeniden hesaplar.
- **Porsiyon planı:** hazırlanacak porsiyon = servis edilen kişi × kişi başı porsiyon × (1 + fazla hazırlık) — yukarı yuvarlı, **tam sayı aritmetiğiyle** (0,3 × 350 = 105, 106 değil).
- "**Mutfağa kesinleştir**": yalnız kesin dosyada ve sorunsuz menüde. Kesin menü değişmez / kalkmaz; **gerekçeyle yeniden açılır**. Kesinleşince mutfağa (talep açabilenlere) zil.

### Malzeme ihtiyacı ve satın alma talebi

Etkinlikler → **Malzeme ihtiyacı**: servis günü aralığındaki (≤ 31 gün) kesin etkinliklerin menüleri, istenirse opsiyonlular "olası" sütununda; malzeme grubuna göre (kasap, manav…); kesin / olası / talep edilmiş / **eksik** / "mutfakta olmalı" günü (servisten hazırlık süresi kadar önce); satır açılınca etkinlik dökümü. "**Talebe çevir**" eksikleri satın alma talebine döndürür (grup süzgeciyle; ambalaja göre artırılabilir). Aynı işlem dosyanın Menü sekmesinden tek etkinlik için yapılır. A4 çıktı.

Kurallar: ihtiyaç etkinlik düzeyinde yuvarlanır (kg / L binde bir; g / ml / adet tam); eksik **etkinlik başına** hesaplanır (bir etkinliğe fazla istenen başkasının eksiğini kapatmaz — teslim günü farklı olabilir); talep kapsamdaki etkinlikleri kilitleyip eksiği yeniden hesaplar; ekranın gördüğü eksik tutmazsa talep açılmaz ve liste yenilenir (aynı eksik iki kez talep edilemez). Talep yalnız **kesin** dosyadan açılır.

### Mutfak planı

Etkinlikler → **Mutfak planı** (≤ 7 gün): kesin menülerden, servis saatinden geriye sayılan hazırlık görevleri — gün → saat → istasyon; yemek servisten hazırlık süresi kadar önce, ara ürün onu kullanan yemeğin başlangıcından önce; aynı ara ürün birleşir. Kesinleşmemiş menünün görevi "taslak". A4 çıktı, işaret kutulu.

### Belgeler

**Teklif** (talep / opsiyon durumunda) → **sözleşme** (kesine kadar; "imzalandı" kararı) → **proforma** (gerçekleşti / iptal; borç kesinleşince). Her tür yeni sürümle üretilir; türe göre tek güncel sürüm; PDF sunucuda, Türkçe font gömülü; anlık görüntüden çizilir (sonradan değişen kalem eski belgeyi değiştirmez). Teklif ve sözleşmede menünün içeriği (kurs, yemek, seçmelide kişiler, **alerjenler**) yazılır; proformada fiyat kalemi yeter. **Resmî fatura** Faturalar modülünde kesilir; burada "faturaya hazır" sayısı ve proforma vardır.

### Depozito, taksit ve ödemeler

- **Ödeme planı:** taksitler; "öneri" politikadaki depozito yüzdesine göre dağıtır (örneğin %30 depozito sözleşmede, %40 etkinlikten 7 gün önce, kalan etkinlik günü). Ödenen tutar vadesi eskiden yeniye dağıtılır; geciken kırmızı.
- **Ödemeler:** tahsilat (+), iade (−), hatalı girişin iptali; kasada "**Etkinlik**" kaynağı. Eşik üstü tahsilat / iade / iptal **dört göz** onayına gider. Kapanmış dosyada kalan borçtan fazlası alınmaz; yalnızca borcun üstündeki fazla iade edilir; alınmamış para iade edilmez; kaybedilen dosya borçsuzdur.
- **İptal:** politika kademesine göre iptal bedeli hesaplanır ve dosyaya kopyalanır; alınan depozito bedeli aşıyorsa iade uyarısı; bedelli proforma üretilebilir.

### Arka planda: banket turu (15 dk)

| Ne tetikler | Ne olur | Nerede görünür |
|-------------|---------|----------------|
| Opsiyon günü geçti | Opsiyon düşer (kilit altında yeniden bakar); sırası yükselene zil | Dosya durumu, zil |
| Opsiyonun son günü | Sorumluya hatırlatma | Zil |
| Taksit vadesi geçti | Gecikmiş taksit uyarısı (günde bir) | Ödemeler sekmesi kırmızı, özet kutusu |
| Kesin etkinlik gerçekleşmiş ama kapatılmamış | Hatırlatma | Zil |
| Kesin etkinliğe politikadaki gün kaldı, menü kesinleşmemiş | Sorumluya bir kez | Zil |
| Oturum saati kaydı | Kesin menülerin servis saati aynı farkla kayar; mutfağa haber | Menü sekmesi, zil |
| Faturalanacak kişi değişti | Kişiyi izleyen kesin menü varsa mutfağa haber | Zil |
| Kesin etkinlik iptal, açık talebi var | Mutfağa haber (talep elden iptal edilir) | Zil, Satın alma → Talepler |

**Örnek (düğün, 200 kişi):** Dosya ETK-2027-0031, Balo salonu, banket düzeni, 14 Ağustos 19:00–01:00 (kurulum 180 dk). 1. opsiyon alınır; teklif TKL üretilir (salon kirası tam gün + set menü "Düğün A" 200 × 1.450 TL). Müşteri kabul eder, sözleşme imzalanır, %30 depozito (87.000 TL + kira payı) kasaya "Etkinlik" kaynağıyla girer; eşik üstü olduğundan ikinci bir yetkili onaylar. Dosya kesinleşir. Menü: çorba (hepsi), ana yemek seçmeli — 120 et / 60 tavuk / kalan 20 vejetaryen, tatlı (hepsi); fazla hazırlık %5 → et için 120 × 1,05 = 126 porsiyon. 7 Ağustos'ta mutfağa kesinleştirilir. Malzeme ihtiyacı: dana bonfile 126 × 220 g ÷ (1 − 0,08 fire) ≈ 30,13 kg → kg binde bire yuvarlı **30,130 kg**, mutfakta olmalı 13 Ağustos; stokta 4 kg → eksik 26,130 kg → kasap grubu talebe çevrilir (bkz. Satın alma kılavuzu). Mutfak planı 13 Ağustos 14:00 "demi-glace 15 L" (ara ürün, 1 gün hazırlık), 14 Ağustos 15:00 "bonfile 126 porsiyon". Etkinlik sonrası gerçekleşen 190 kişi → faturalanacak en çok(200 garanti, 190) = 200; proforma üretilir; Faturalar → Faturalanacaklar'da görünür.

## Yetki özeti (düz dille)

| İş | Kim |
|----|-----|
| Vardiya açmak / kapatmak, adisyon açmak, sipariş göndermek, ödeme almak, odaya yazmak, servis edildi demek | Garson (F&B rolü — "işletme" yetkisi) |
| İkram, iptal + zayi, indirim, mutfaktaki oda servisi / paket siparişini iptal | Şef garson ("gözetim" yetkisi) + gerekçe |
| Eşik üstü düzeltme / tahsilat onayı | Onay karar yetkisi olan **başka** kişi (dört göz) |
| Menü, masa, satış noktası, politika tanımları | Müdür ("tanım" yetkisi) |
| Satış raporu, oda servisi raporu, vardiyaların tamamı | Muhasebe ve müdür ("rapor" yetkisi) |
| Mutfak ekranı | Garsonla aynı yetki (mutfak tableti) |
| Tepsi toplama, oda servisi bağlantısı verme | Garson **veya** istek yönetimi (kat hizmetleri, ön büro) |
| Reçete ve malzeme kartı görmek (maliyet dahil) | Müdür, F&B, muhasebe |
| Reçete yazmak | Müdür; şef için rol matrisinden verilir |
| Etkinlik dosyası açmak / yönetmek | Banket yönetimi |
| Salon, ekipman, politika, set menü | Müdür ("banket tanım" yetkisi) |
| Etkinlik tahsilatı / iadesi | Müdür, ön büro, muhasebe ("banket ödeme" yetkisi) |

## Uçtan uca örnek: bir köfte porsiyonunun yolculuğu

1. **Tanım:** Ürün "Izgara köfte" 380 TL (yiyecek, Sıcak). Reçete yukarıdaki gibi; porsiyon maliyeti 119,26 TL.
2. **Vardiya:** Garson Ayşe 17:00'de "Ana Restoran" için 500 TL avansla vardiya açar.
3. **Sipariş:** 19:40, T7, 4 kişi. 2 köfte + 2 tavuk + 4 ayran → "Gönder". Adisyon ADS-2027-1187. KDS Sıcak istasyonunda kart.
4. **Mutfak:** 19:45 Başla, 19:56 Hazır → Ayşe'nin ziline haber. Servis edildi.
5. **Düzeltme:** Bir köfte zayi + yeniden; şef garson gerekçeyle onaylar (380 TL < 500 TL eşik).
6. **Ödeme:** 1.180 TL'ye %10 indirim (şef garson) → 1.062 TL. 600 TL nakit + 462 TL kart. Adisyon kapanır. Nakit Ayşe'nin kasasına.
7. **Arka plan:** "adisyon kapandı" olayında köfte için satılan 2 + zayi 1 = **3 porsiyon** gider; Stok aktörü reçeteden 3 × 180 g = 540 g kıyma, 3 × 34,09 g soğan… düşer (Stok → Hareketler'de "satış" türüyle, adisyon numarasıyla). Kıyma minimumun altına inerse satın alma talebi açılır ve satın alma yetkilisine zil gider.
8. **Kapanış:** 23:30 Ayşe vardiyasını kapatır: beklenen 500 + günün nakitleri; sayılan girilir; fark varsa kaydedilir.
9. **Raporlar:** Satış raporu günün cirosunu, indirim / zayi tutarlarını gösterir. Stok → Maliyet raporu (ürün bazlı) köfte için satılan adet 2 (zayi satış değil), ciro, reçeteden düşen maliyet (3 porsiyonluk), yemek maliyeti % çıkarır.

## Sık sorulanlar

**Garson adisyon açamıyor, "vardiya yok" diyor.** Masa planındaki vardiya çubuğundan vardiya açmalı. Vardiyasız işlem bilinçli olarak yoktur; her kuruş bir kasaya ait olmalı.

**Menüde fiyat değiştirdim, açık adisyondaki kalem eski fiyatta.** Doğru davranış. Kalem gönderildiği anki fiyatı kopyalar. Yeni eklenen kalemler yeni fiyattan yazılır.

**Ürün silmek istiyorum.** Silme yoktur; pasife alın ya da "tükendi" işaretleyin. Geçmiş adisyonlar ve raporlar korunur.

**İkram yapamıyorum.** Şef garson yetkisi ve gerekçe gerekir; eşik üstüyse ikinci bir yetkilinin onayı da gerekir (Onaylar ekranı).

**Mutfak ekranı "servis edildi" düğmesi göstermiyor.** Oda servisi ve paket turlarında teslim ilgili panodan yapılır; mutfak ekranı yalnızca "Başla / Hazır" verir.

**Kahvaltı siparişi mutfak ekranında görünmüyor.** İleri saatli sipariş teslim − hazırlık payı anında düşer; öncesinde yalnızca oda servisi panosunda "planlı" durur ve hazırlık listesinde görünür.

**Misafir QR ile sipariş veremiyor.** Politikada "misafir siparişi açık" kapalı olabilir; konaklamada 3 açık sipariş sınırı dolmuş olabilir; oda değişmiş ya da çıkış yapılmışsa bağlantı geçersizdir (rezervasyondan yenileyin).

**Odaya yaz "kuruşu tutmuyor" diyor.** Hariç vergili kalem (servis ücreti) yüzünden; ekranın önerdiği iki tutardan birini seçin.

**Paket siparişin tamamı önceden ödendi ama adisyon açık.** Bilinçli: paket siparişi teslim edilene kadar adisyon açık kalır ki mutfak ve kurye görsün. Teslimde kapanır.

**Reçete maliyeti neden değişti, ben dokunmadım.** Malzeme birim maliyeti mal kabulde hareketli ortalamayla güncellenir; reçete maliyeti güncel malzeme maliyetinden hesaplanır.

**Ön büro reçeteyi görüyor ama maliyeti göremiyor.** Tasarım kararı: maliyet alanları yalnızca reçete görme yetkisine döner.

**Set menüyü değiştirdim, mevcut etkinliğin menüsü değişmedi.** Doğru: etkinliğe seçilen menü kopyalanır; etkinlikte ayrı düzenlenir.

**Opsiyon aldım ama kesinleştiremiyorum.** Yalnız 1. opsiyon kesinleşir; politika imzalı sözleşme istiyorsa önce sözleşme "imzalandı" olmalı.

## Sık yapılan hatalar

- **Vardiyayı kapatmadan eve gitmek.** 16 saatte uyarı düşer; kasa farkı birikir, ertesi gün sayım anlamsızlaşır. Vardiya kapanışı günün parçasıdır.
- **"İptal" yerine "iptal + zayi"yi ya da tersini seçmek.** Hazırlanmış ürün için zayi seçilmelidir; stok düşümü ve maliyet raporu buna göre çalışır. Hazırlanmamış ürün için zayi seçmek stoğu gereksiz düşürür.
- **İkramı indirim gibi kullanmak.** İkram kalem bazında bedavadır, indirim adisyon toplamına uygulanır; raporda ayrı sütunlardır.
- **Odaya yazmadan önce misafirin odasını kontrol etmemek.** Arama soyadıyla yapılır; aynı soyadlı iki konaklama varsa oda numarasıyla doğrulayın.
- **Tepsi ücretini elle ürün olarak eklemek.** Sistem ücreti kendisi ekler; elle eklemek çift ücret yazar.
- **Kahvaltı kartına geçmiş saat ya da çıkış sonrası saat yazmak.** Sistem reddeder (en az 10 dk sonra, en fazla 3 gün, çıkış gününden önce).
- **Kuryeye vardiya açtırmadan "yola çıkar" demek.** Kapıda para varsa kuryenin açık vardiyası şarttır; para onun kasasına girer.
- **Reçetesiz ürün satmak ve stok düşmediğine şaşırmak.** Her satılan yiyecek-içeceğe reçete bağlayın; aksi halde stok düşmez, maliyet raporu eksik çıkar.
- **Fire yüzdesini net miktara önceden ekleyip bir de fire yazmak.** Net miktar temizlenmiş halidir; fire ayrı alandadır. İkisini birden yapmak maliyeti şişirir.
- **Ara reçeteyi yemek olarak tanımlamak.** Köfte harcı, sos gibi ara ürünlerin verimi kg / L / adet olmalı; porsiyon yalnız servis edilen yemek içindir.
- **Banket menüsünü kesinleştirmeden malzeme talebi beklemek.** Talep yalnız kesin dosyadan ve kesin ihtiyaçtan açılır; opsiyonlu etkinlik "olası" sütununda kalır.
- **Etkinlik tahsilatını folyodan ya da restoran kasasından almak.** Etkinliğin kendi hesabı vardır; tahsilat dosyanın Ödemeler sekmesinden "Etkinlik" kaynağıyla alınır.
- **İptal politikasına 0 günü koymamak.** Politika 0 günü içermek zorundadır; aksi halde son günler bedelsiz kalır (sistem bunu reddeder).
