# Folyo, kasa ve ek hizmetler

Bu bölüm paranın izlendiği ekranları anlatır: konaklamanın hesabı (**folyo**), tahsilat ve iade (**ödemeler**), günün parası (**kasa**) ve döviz kurları, odadan tüketilen **minibar** ile **çamaşırhane** siparişleri, **kayıp eşya** ve günü kapatan **gün kapanışı** (night audit).

Her ekran aynı düzende anlatılır: **nerede bulunur**, **ne yapar**, **ekranda gördüğünüz alanlar**, **adım adım**, **arka planda ne olur** (tetikleyici → sonuç → nerede görünür → aktör kapalıysa ne olur) ve **dikkat edilecekler**. Her alt bölümde sayılarla anlatılan en az bir örnek vardır; örneklerde para birimi TL, oda vergisi %10 ve fiyata dahil varsayılmıştır (otelinizin vergi ayarı farklı olabilir; formül aynıdır).

## Önce bilinmesi gereken kavramlar

### Folyo ve pencere

**Folyo**, bir konaklamanın hesabıdır: oda ücretleri, restoran, minibar, çamaşır, spa gibi **kalemler** (borç) ve **ödemeler** (alacak) buraya yazılır. Her konaklamanın en az bir folyosu vardır; buna **1. pencere** (ana folyo) denir. Hesabı ayırmak gerekirse (misafir odayı kendi öder, şirket yemeği öder) folyo **bölünür** ve 2., 3.… pencereler açılır (en fazla 8). Her pencerenin ayrı **ödeyeni** olabilir ("Ödeyen" alanı: şirket ya da acente adı — faturanın alıcı varsayılanı).

### Bakiye formülü

```
Bakiye = Σ (kalem toplamı) − Σ (işlenmiş ödemenin folyoya giren tutarı)
```

- "İşlenmiş" demek: onay bekleyen ve reddedilen ödemeler **sayılmaz**.
- Dövizli ödeme, kurla otelin parasına çevrilmiş tutarıyla girer (ödeme başına kuruşa yuvarlanır).
- İptal edilmiş kalem ve ödeme eksi tutarlı **ters kayıtla** sıfırlanmış sayılır; birleştirilerek başka folyoya taşınmış pencereler sayılmaz.
- Çıkış ekranı bakiyeyi yeniden kalemlerden hesaplar; ekrandaki toplamlar da her yazmada kalemlerden yenilenir.

### Vergi: dahil ve hariç

Her kalemin **tipi** vardır (Oda, Restoran, Minibar, Çamaşır, Spa, Diğer, İndirim) ve otelin vergi tanımları tipe göre uygulanır (Ayarlar → Vergiler → "uygulandığı kalem"). Satır hesabı:

- Brüt = birim fiyat × adet. Vergi **dahil** ise net = brüt ÷ (1 + dahil oranların toplamı), vergi = brüt − net.
- Vergi **hariç** ise her vergi = net × oran; toplam = brüt + hariç vergiler.
- Yuvarlama **satır başına** kuruşa yapılır; çok gecede rezervasyon ekranındaki toplamla kuruş farkı görülebilir (normaldir).

**Örnek:** Oda ücreti 2.500,00 TL, KDV %10 dahil → net 2.272,73, vergi 227,27, toplam 2.500,00. Vergi hariç olsaydı: net 2.500,00, vergi 250,00, toplam 2.750,00.

Kalem, **işlendiği andaki** vergi dökümünü saklar: vergi oranı sonradan değişse ya da vergi tanımı silinse geçmiş bozulmaz.

### Kalem kaynağı

Her kalemin nereden geldiği yazar: Elle, Gece oda ücreti, Erken giriş, Geç çıkış, İptal ücreti, Gelmedi ücreti, Restoran siparişi, Minibar tüketimi, Çamaşırhane siparişi, Spa, İptal kaydı. Sistem kalemleri bir **tekrar işleme anahtarı** taşır: aynı olay iki kez gelse de (aktör yeniden denese, sunucu yeniden başlasa) kalem **ikinci kez yazılmaz**.

### Dört göz kuralı

Kasa açığına karşı: kalem iptali, ödeme iptali, iade ve büyük ödeme **ikinci bir yetkilinin onayına** gider; **isteyen kendi isteğini onaylayamaz** (reddederek geri çekebilir). Onaylar Yönetim → Onaylar kuyruğundadır; kendi isteğinizde "Onayla" düğmesi kapalıdır, sebebi yazar.

### Sürüm damgası

Her kayıt bir sürüm taşır. İki kişi aynı anda aynı siparişi / folyoyu değiştirirse ikincisi "kayıt değişti, yenileyin" alır; veri ezilmez.

### Folyo aktörü (billing-worker)

Folyonun otomatik tarafını yürüten aktördür. Yaptığı işlerin tam listesi:

| Tetikleyici | Ne yapar | Nerede görünür | Aktör kapalıysa / hatada |
| --- | --- | --- | --- |
| Misafir giriş yaptı | Folyoyu açar; erken giriş ücreti varsa "Oda" vergisiyle kalem yazar; nakit / havale teminatı **ödeme** olarak işler | Konaklama folyosu, Kasa | "Folyo" modülünde manuel görev; personel folyo ekranından aynı işi yapar (aynı anahtar: sonradan ikinci kez yazılmaz) |
| İş günü ilerledi (gün kapanışı) | İçerideki bütün konaklamaların o geceye kadar eksik gecelerini oda ücreti olarak işler | Folyolar listesindeki oda ücreti şeridi, folyo dökümü | Şeritte "eksik gece" sayısı artar; personel "Oda ücretlerini işle" düğmesiyle aynı işi yapar |
| Gün kapanışı başlatıldı | Kapanış öncesi tamamlanmış gecelerin ücretini önceden basar | Sihirbazın "Oda ücretleri" adımı | Kapanış kendisi de aynı işlemi yapar (kapanış adımı idempotent) |
| Misafir çıkış yaptı | Kalan geceleri ve geç çıkış ücretini işler; bakiye sıfırsa folyoyu **kapatır**; kalırsa folyo yetkilisine zil | Folyo "Kapalı" rozeti; zil | Manuel görev; folyo açık kalır, personel kapatır |
| Folyo kapandı | **Fatura taslağı** açar (alıcı: folyo cariye aktarıldıysa cari, değilse ödeyen / misafir) | Faturalar → Taslaklar | Faturalar → Faturalanacaklar listesinde bekler; personel oradan keser |
| Rezervasyon iptal / gelmedi | İptal ücreti / gelmedi ücreti kalemi ("Diğer" vergisiyle) | Folyo dökümü | Manuel görev |
| İptal / gelmedi / giriş / çıkış geri alındı | Kendi işlediği ücreti ve teminatı **ters kayıtla** düşer; folyoyu yeniden açar | Dökümde üstü çizili kalem + iptal kaydı | Manuel görev |
| Restoran adisyonu odaya yazıldı | "Restoran siparişi" kalemi | Folyo dökümü | Manuel görev; restoran ekranı "odaya yazıldı" der ama kalem görünmez — görevi kapatın |
| Minibar fişi kesildi | "Minibar tüketimi" kalemi (minibar vergisiyle) | Folyo dökümü, Minibar kayıtları'nda "işlendi" | Minibar kayıtlarında "personele düştü" durumu + görev |
| Çamaşır **teslim edildi** | Parça satırları + ekspres farkı ayrı satır | Folyo dökümü | Manuel görev |
| Spa randevusu odaya yazıldı | "Spa" kalemi | Folyo dökümü | Manuel görev |
| Ödeme işlendi / iade / iptal (bitmiş konaklamada) | Bakiye sıfırlandıysa folyoyu kapatır → fatura taslağı | Folyo "Kapalı" | Folyo açık kalır; personel "Kapat" der |

Yönetim → Aktörler ekranında aktörün açık / kapalı durumunu ve son işlerini görürsünüz; Görevler ekranında kapalıyken biriken işleri.

## Folyolar listesi

**Nerede:** Ön büro → Folyolar (`/folyolar`). **Yetki:** "folyo görüntüleme" (kat hizmetleri görmez).

**Ne yapar:** otelin bütün folyolarını görünümle süzer; üstte gece oda ücreti durumunu gösteren şerit vardır.

### Ekranda gördüğünüz alanlar

| Alan | Anlamı |
| --- | --- |
| Görünüm şeridi | **İçeridekiler** (şu an içeride olan misafirlerin folyoları) · **Açık bakiye** (bakiyesi sıfır olmayan açık folyolar — çıkmış misafir dahil) · **Bütün açıklar** · **Kapananlar** |
| Ara | Misafir adı, onay kodu, oda numarası ya da ödeyen (şirket) adı |
| Oda ücreti şeridi | Son çalışmanın zamanı ve **eksik gece sayısı** ("3 konaklamada 4 gece işlenmemiş") ve "Oda ücretlerini işle" düğmesi |
| Satır | Misafir, oda, pencere sayısı, harcama toplamı, ödenen, **bakiye**, durum (Açık / Kapalı / Birleştirildi), son hareket |

### Adım adım

1. Sabah "Açık bakiye" görünümüne bakın: çıkmış ama borcu kalmış misafirler burada birikir.
2. Şeritte eksik gece görürseniz "Oda ücretlerini işle"ye basın (aktör zaten koşmuşsa sayı sıfırdır; düğme zarar vermez — aynı gece ikinci kez yazılmaz).
3. Satıra tıklayınca konaklamanın folyo sayfası açılır.

**Dikkat:** liste sayfalıdır, sayım 2000'de kesilir. Liste her folyo haberinde seyrek tazelenir; anlık rakam için satıra girin.

## Konaklama folyosu

**Nerede:** `/folyolar/<rezervasyon kimliği>`; rezervasyon ayrıntısındaki Folyo kartından, ön büro listelerindeki bakiye bağlantısından, oda planı çekmecesinden ve çıkış penceresinden "Folyoyu aç" ile.

**Yetki:** görmek "folyo görüntüleme"; harcama, aktarma, bölme, birleştirme, yönlendirme, kapatma, iptal isteği "folyo işleme" (resepsiyon, müdür, muhasebe); **indirim** kalemi ve kapanmış folyoyu **yeniden açma** "folyo düzeltme" (müdür, muhasebe).

### Ekranda gördüğünüz alanlar

| Alan | Anlamı |
| --- | --- |
| Başlık | Misafir, oda, giriş–çıkış, durum; "Rezervasyon" düğmesi |
| Pencere sekmeleri | 1, 2, 3… Her pencerenin bakiyesi; saat simgesi "onay bekleyen iptal ya da ödeme var" demektir |
| Yönlendirme satırı | Hangi kalem tipinin hangi pencereye düştüğü ("Restoran → 2. pencere"); "Yönlendirme" düğmesi |
| Harcamalar / Ödenen / Bakiye | Seçili pencerenin toplamları |
| Vergi özeti | Pencerenin vergi dökümü (oran bazında) |
| Döküm tablosu | Kalemler işlenme sırasıyla: hizmet günü, açıklama, kaynak, adet × birim, vergi, toplam. İptal edilmiş kalem **üstü çizili**, altında iptal kaydı; başka konaklamadan gelen ya da aktarılan kalemin kaynağı yazar; "iptal onayı bekliyor" rozeti; "daha fazla" ile devam |
| Ödemeler | Tahsilat / iade / iptal kaydı satırları; durum (İşlendi, Onay bekliyor, Reddedildi); kaynak (Resepsiyon, Ön ödeme, Giriş teminatı); döviz × kur; "İptal iste" |
| Teminat şeridi | Girişte alınan nakit / havale teminatı ödeme olarak işlenmemişse "Teminatı işle"; kart provizyonu için "çıkışta kartla tahsil edin" hatırlatması |
| Eksik oda ücreti uyarısı | Bu konaklamada işlenmemiş gece varsa sayı ve "işle" düğmesi |
| Düğmeler | Ödeme al · İade · Harcama ekle · Aktar · Böl · Birleştir · Ödeyen · Yönlendirme · Kapat · Yeniden aç · "İptal edilenleri göster" anahtarı |

"Bu konaklamanın folyosu yok" görürseniz: folyo misafir giriş yapınca açılır; gelmeden önce depozito ya da ücret işleyecekseniz "Folyo aç" ile şimdi açabilirsiniz.

### Oda ücreti gece gece nasıl işlenir

Oda ücreti **personel tarafından yazılmaz**; gün kapandıkça folyo aktörü yazar.

| Tetikleyici | Ne olur | Nerede görünür | Kapalıysa / hatada |
| --- | --- | --- | --- |
| İş günü ilerler (gün kapanışı tamamlanır) | Sistem otel başına **bir kez** "oda ücretleri vadesi geldi" olayı yayınlar; aktör içerideki bütün konaklamaların o geceye kadar eksik gecelerini 100'lük parçalarla işler; yarıda kalan çalışma kaldığı yerden devam eder | Folyo dökümünde hizmet günü = gece olan "Gece oda ücreti" kalemleri; listede şerit | Şeritte eksik gece; "Oda ücretlerini işle" ile elle |
| Gece fiyatı sonradan değişti (rezervasyon düzenlendi) | Uzlaştırma: fark kalemi yazılır — artıysa "Oda", eksiyse oda gelirinden "İndirim" | Dökümde fark satırı, aynı hizmet günü | Aynı |
| Gece konaklamadan çıktı (erken ayrılış) | İşlenmiş gece ters kayıtla sıfırlanır | Üstü çizili kalem | Aynı |
| Gece ikram edildi (kalem iptal edilmiş) | **Dokunulmaz**; yeniden yazılmaz | — | — |
| Sunucu kapalıyken geceler geçti | İlk çalışmada bütün eksik geceler telafi edilir | Şerit | — |

**Örnek — Oda 204, 3 gece, oda ücreti 2.500 TL (KDV %10 dahil):**

- 12 Kasım 15:00 giriş. Folyo aktörü folyoyu açar; erken giriş yoktur, kalem yazılmaz. Dökümde hiç kalem yok, bakiye 0,00.
- 12 Kasım gecesi gün kapanışı yapılır → iş günü 13 Kasım olur → aktör **12 Kasım gecesi**nin ücretini yazar: "Gece oda ücreti · hizmet günü 12.11 · 2.500,00 (net 2.272,73 + KDV 227,27)". Bakiye 2.500,00.
- 13 ve 14 Kasım geceleri aynı şekilde: bakiye 7.500,00.
- 15 Kasım 11:00 çıkış: kalan gece yok, geç çıkış yok. Misafir 7.500,00 kartla öder → ödeme işlenir → bakiye 0,00 → folyo aktörü folyoyu **kapatır** ve fatura taslağı açar.
- Aynı misafir 14 Kasım sabahı erken ayrılsaydı: çıkış penceresi "1 gece bırakılacak" der; 14 Kasım gecesi hiç yazılmamış olur, bakiye 5.000,00 kalır.
- Rezervasyon 13 Kasım'da düzenlenip gece fiyatı 2.000 TL'ye düşürülse: 12 Kasım gecesi işlenmişti; uzlaştırma −500,00 "İndirim (oda)" fark kalemi yazar; sonraki geceler 2.000 TL'den işlenir.

**Gün kapanışı yapılmıyorsa** iş günü ilerlemez ve oda ücretleri **yazılmaz**. Kapanışı aksatan otelde bütün folyolar "eksik gece" gösterir; çıkışta ödenecek tutar yine doğru hesaplanır (çıkış kalan geceleri işler), ama gün içi raporlar eksik kalır.

### Harcama ekle

**Adım adım:**

1. Doğru **pencereyi** seçin (elle harcama seçili pencereye gider; sistem kalemleri yönlendirmeye uyar).
2. "Harcama ekle" → **Harcama tipi** çipleri: Restoran, Minibar, Çamaşır, Spa, Diğer; yetkiniz varsa **İndirim**.
3. İndirimde "Hangi gelirden indirim" seçilir (indirim o gelirin vergisini düşürür).
4. **Hazır açıklamalar** çipi ya da serbest **Açıklama** (200 karakter), **Birim fiyat**, **Adet** (1–999).
5. Vergi önizlemesi sunucudan canlı gelir ("Vergi hesaplanıyor…" → satır dökümü; "Bu kalem tipine vergi tanımlı değil" de olabilir).
6. **Kaydet.** Çift tık ikinci kalem açmaz (pencere açılırken istek kimliği üretilir).

**Örnek:** Misafir lobide 2 kahve içti, restoran POS'u kapalı. "Restoran" tipi, açıklama "Kahve", birim 120,00, adet 2 → brüt 240,00; restoran vergisi %10 dahil ise net 218,18 + KDV 21,82. Dökümde kaynak "Elle", açan sizsiniz.

**Dikkat:** oda ücreti elle yazılamaz (tiplerde yoktur); gece gece sistemden gelir. Kapalı folyoya kalem düşmez — önce "Yeniden aç" (yetkili, gerekçeli).

### Kalem iptali (void) ve onay

Kalem **silinmez**; iptal, eksi tutarlı bir **ters kayıt**tır ve iptal günü tarihlidir (kapanmış günün geliri geriye dönük değişmez).

**Adım adım:**

1. Dökümde kalemin yanındaki "İptal iste" → **Hazır gerekçeler** çipi ya da serbest **Gerekçe**.
2. Gönderince kalem "iptal onayı bekliyor" rozeti alır; istek Yönetim → Onaylar kuyruğuna düşer.
3. **Başka bir yetkili** onaylar → ters kayıt onaylayan adına işlenir; asıl kalem üstü çizili olur, altında "İptal kaydı" görünür. Reddederse rozet kalkar, kalem olduğu gibi kalır.
4. Siz kendi isteğinizi onaylayamazsınız; vazgeçmek için **reddedin**.

| Tetikleyici | Ne olur | Nerede görünür | Not |
| --- | --- | --- | --- |
| İptal istendi | Onay kaydı açılır; folyo **kapanamaz** (bekleyen iptal) | Onaylar → Bekleyen; pencere sekmesinde saat simgesi | İsteyenin "Onayla" düğmesi kapalı |
| Onaylandı | Ters kayıt (−tutar, aynı vergi dökümü) iptal günü tarihli | Döküm, Onaylar → Geçmiş | Bakiye düşer |
| Reddedildi | Hiçbir kayıt yazılmaz | Onaylar → Geçmiş | — |

**Örnek:** 13 Kasım'da yanlışlıkla 2 yerine 20 adet kahve yazıldı (2.400,00). 14 Kasım'da müdür iptali onaylar → 14 Kasım tarihli −2.400,00 "İptal kaydı"; sonra doğru kalem 240,00 yeniden eklenir. Gelir raporunda 13 Kasım 2.400 görünür, 14 Kasım −2.400 + 240 görünür; toplam doğrudur.

Minibar ve çamaşır fişleri de **silinmez, değişmez**: düzeltme yine folyodaki kalem iptaliyle yapılır.

### Aktar, Böl, Birleştir, Yönlendirme, Ödeyen

**Aktar (transfer):** dökümden kalemleri işaretleyin (iptal edilmiş, iptal kaydı ve onay bekleyen kalem seçilemez) → "Aktar" → hedef: aynı konaklamanın başka penceresi ya da **arama** ile başka konaklamanın açık folyosu (oda no, misafir, onay kodu, şirket). Kalem "doğduğu konaklama"yı hatırlar; hedef dökümde kaynağı yazar.

**Böl (split):** yeni pencere açar; isteğe bağlı **Ödeyen** ve bu pencereye düşecek kalem tiplerinin yönlendirmesi seçilir. En fazla 8 pencere.

**Birleştir (merge) — grup hesabı:** "Birleştir" → çoklu arama ile kaynak folyoları seçin → hedef bu folyodur. Kaynakların **bütün kalem ve ödemeleri** hedefe taşınır; kaynak "Birleştirildi" durumuna geçer; kaynak konaklamada o pencereye düşen tipler artık hedefe yönlenir. **Geri alınmaz** — ayırmak için kalemler aktarılarak yeni pencere açılır. Uyarı kutusu "Grup hesabı" bunu söyler.

**Yönlendirme:** konaklamanın tiplerini (Oda, Restoran, Minibar, Çamaşır, Spa, Diğer) pencerelere dağıtır; seçilmeyen tip "İlk açık folyo (varsayılan)"a düşer. Sistem kalemleri (gece, ücretler, restoran, minibar, çamaşır, spa) **bu tabloya uyar**; elle harcama seçili pencereye gider. Açık folyosu yoksa yeni pencere açılır.

**Ödeyen:** pencerenin ödeyen adı (şirket / acente) — fatura alıcısının varsayılanı.

**Örnek — şirket odayı öder, misafir ekstraları:** Oda 305, 2 gece 3.000 TL/gece, ABC A.Ş. ödeyecek. Girişte "Böl": 2. pencere, Ödeyen "ABC A.Ş.", yönlendirme **Oda → 2. pencere**; Restoran, Minibar, Spa 1. pencerede kalır. Geceler 2. pencereye yazılır (6.000,00); misafirin minibarı (180,00) ve restoranı (950,00) 1. pencereye. Çıkışta misafir 1.130,00 öder; 2. pencere "Acente / cari" yöntemiyle kapatılır (aşağıda). Çıkış ekranındaki ödenecek tutar misafir için 1.130,00'dır; 6.000 TL misafirin borcuna yazılmaz — ancak 2. pencere **bu konaklamanın** penceresi olduğu için kapanmamış bakiye çıkışı engeller; o yüzden "Acente / cari" ödemesi çıkıştan önce girilir ya da yetkili "bakiyeyle çıkış" yapar.

### Cariye devir (acente / şirket hesabı)

Şirketin ya da acentenin sonradan ödeyeceği pencere, ödeme yöntemi **"Acente / cari"** ile kapatılır (referans: belge no, isteğe bağlı). Bu bir tahsilat satırıdır ama kasaya para girmez; acentenin **cari özeti**nde "cariye aktarılan" tutar ve vadesi gelen kısım (çıkış + vade günü) görünür. Acentenin gerçek ödemesi Ön muhasebe → Cariler'de düşülür. Fatura taslağının alıcısı bu durumda cari olur.

### Folyo kapanışı → fatura taslağı

**Kapatma kuralları:** bakiye sıfır olmalı; bekleyen iptal / ödeme / iade olmamalı; içerideki misafirin **son açık folyosu** kapatılamaz (kalemleri bir yere düşmeli — önce yapısal engel söylenir). Kapanan pencereye yönlenen tipler serbest kalır.

| Tetikleyici | Ne olur | Nerede görünür | Kapalıysa |
| --- | --- | --- | --- |
| Çıkışta bakiye 0 | Folyo aktörü kapatır | "Kapalı" rozeti | Personel "Kapat" |
| Çıkmış / iptal / gelmedi misafirin folyosu sonradan ödemeyle sıfırlandı | Aktör kapatır | "Kapalı" | Personel "Kapat" |
| Folyo kapandı | Aktör **fatura taslağı** açar: satırlar kalemlerin işlendiği andaki vergi dökümünden; alıcı cari / ödeyen / misafir | Faturalar → Taslaklar | Faturalar → Faturalanacaklar'da bekler |
| Fatura kesilmiş folyo | **Yeniden açılamaz**; düzeltme fatura iptali (onaylı) ile başlar | Yeniden aç düğmesi sebebiyle kapalı | — |

"Yeniden aç" yetkili ve gerekçeli; giriş / çıkış geri alınınca aktör de folyoyu yeniden açar.

## Ödemeler

**Nerede:** konaklama folyosunda "Ödeme al" / "İade"; rezervasyon ayrıntısında "Ön ödeme al" (gelmeden önce); çıkış penceresinde "Ödeme al"; giriş penceresinde teminat.

**Yetki:** tahsilat, ön ödeme, teminatı işleme "ödeme alma" (resepsiyon, müdür, muhasebe); iade ve ödeme iptali istemek "iade" (aynı roller; onaylayamaz); karar "onay verme" ve isteyenden farklı biri.

### Ödeme al penceresi — alanlar

| Alan | Anlamı |
| --- | --- |
| Yöntem | Nakit · Kredi kartı · Havale / EFT · Sanal POS · Acente / cari · Voucher |
| Tutar | Ödemenin **kendi para biriminde** tutarı |
| Para birimi | Yalnızca **nakit ve havale** döviz olabilir; kart otelin parasıyla çekilir |
| Kur | Formda **yazılmaz**; günün kur tablosundan gelir (iş gününe kadar girilmiş en son kur, en fazla 3 gün eski). Form gördüğü kuru gönderir; bu arada kur değiştiyse sunucu yazmaz, yeni kur gösterilir, yeniden onaylarsınız |
| Folyoya girecek tutar | Sunucunun hesabı: tutar × kur, kuruşa yuvarlı — canlı gösterilir |
| Onaya gider mi | Eşik üstündeyse "ikinci yetkilinin onayına gidecek" uyarısı canlı |
| Referans | Nakit dışı yöntemlerde **zorunlu**: Slip / provizyon no (kart), Dekont no (havale), İşlem no (sanal POS), Voucher no; nakit için makbuz no isteğe bağlı. Kart numarasına benzeyen dizi reddedilir |
| Not | Serbest; kart numarası yazılamaz |

Pencere açılırken istek kimliği üretilir: çift tık ikinci satır açmaz.

### Adım adım — tahsilat

1. Doğru pencereyi seçin. Konaklamada **birden çok açık folyo** varsa ödeme pencere seçilmeden alınamaz ("folyo gerekli") — tahmin edilse toplam sıfırlanır ama pencereler ters bakiyeyle açık kalırdı.
2. "Ödeme al" → yöntem, tutar, (döviz), referans.
3. Önizlemeyi okuyun: folyoya girecek tutar, onaya gidip gitmeyeceği.
4. Kaydet. Sonuç: **İşlendi** (bakiye ve kasa anında güncellenir) ya da **Onay bekliyor** (büyük tutar).

### Büyük tutar onayı

Ayarlar → Genel parametreler → **Ödeme onayı** eşiği (0 = onay yok; varsayılan 0, kurulumda girilmelidir). Folyoya girecek tutar eşiğe **eşit ya da büyükse** ödeme "Onay bekliyor" kaydedilir.

| Durum | Bakiye | Kasa | Folyo kapanışı |
| --- | --- | --- | --- |
| Onay bekliyor | Düşmez | "Onay bekleyenler" kutusunda görünür (para çekmecede, defterde değil) | Engellenir |
| Onaylandı | Düşer | Onay **gününün** kasasına girer | Serbest |
| Reddedildi / süresi doldu | Hiç işlenmez | Girmez | Serbest |

**Örnek:** eşik 20.000 TL. Misafir 25.000 TL nakit ödedi. Satır "Onay bekliyor"; çıkış penceresi "Onay bekleyen ödeme (henüz düşülmedi): 25.000,00" der ve bakiye hâlâ 25.000,00 görünür. Müdür onaylar → bakiye 0,00 → çıkış yapılır. Resepsiyonist kendi aldığı ödemeyi onaylayamaz; müdür ya da muhasebe onaylar.

### Döviz

**Örnek:** Misafir 200 EUR nakit öder; günün kuru 1 EUR = 36,50 TL. Folyoya 7.300,00 TL girer; ödeme satırı "200,00 EUR × 36,50" yazar ve kendi kurunu saklar — kur tablosu sonradan değişse ödeme değişmez. Kasa raporunda nakit EUR kendi para biriminde (200 EUR) sayılır. Kur 3 günden eskiyse ödeme alınamaz: önce Kasa → Döviz kurları'ndan günün kurunu girin.

### İade

İade **her zaman onaylıdır**. Sınır: folyonun işlenmiş net ödemesi − bekleyen iadeler (alınmamış para iade edilmez). Voucher iade edilmez. İadesi yapılmış paranın ödemesi sonradan iptal edilemez.

**Adım adım:** "İade" → yöntem, tutar (sınır gösterilir), referans, gerekçe → Onay bekliyor → yetkili onaylar → eksi satır işlenir, kasa raporunda "İade" sütununa düşer.

### Ödeme iptali (hatalı giriş)

Ödeme **silinmez**. Yanlış tutar / yanlış folyo için ödeme satırındaki "İptal iste" → gerekçe → onay → **İptal kaydı** (asıl satırın tersi) işlenir; kasa etkisi parayı alanın kasasına yazılır. Misafire geri verilen para iptal değil **iade**dir.

### Ön ödeme ve giriş teminatı

- **Ön ödeme (gelmeden önce):** rezervasyon ayrıntısı → "Ön ödeme al". Folyo yoksa açılır; kaynak "Ön ödeme". Girişin geri alınmasını engellemez.
- **Giriş teminatı:** check-in penceresinde Nakit / Havale seçilirse folyo aktörü girişle birlikte **ödeme** olarak işler (kaynak "Giriş teminatı", ana pencereye, bir kez). Kart **provizyonu** ödeme değildir: çıkışta kartla tahsil edilir; folyoda yalnızca hatırlatma şeridi görünür. Aktör kapalıysa şeritte "Teminatı işle" düğmesi çıkar. Giriş geri alınınca teminat ödemesi iptal kaydıyla düşer.

## Kasa

**Nerede:** Ön büro → Kasa. Sekmeler: **Günlük kasa** (`/kasa/gun`), **Döviz kurları** (`/kasa/kurlar`). **Yetki:** kasa "kasa görüntüleme"; kur girişi "kur yönetimi" (müdür, muhasebe).

### Günlük kasa — alanlar

| Alan | Anlamı |
| --- | --- |
| İş günü | Hangi günün kasası (varsayılan bugün; geçmiş gün seçilebilir) |
| Yalnızca benim aldıklarım | Çekmece sahibi bazında süzgeç (iptal kaydı da asıl alanın kasasında) |
| Toplam tablosu | Yöntem × döviz: Tahsilat / İade / İptal / **Net** |
| Onay bekleyenler | Henüz deftere girmemiş ödemeler (para çekmecede) |
| Hareketler | Son işlenen önce; süzgeç: yöntem, tür (Tahsilat / İade / İptal kaydı), kaynak (Konaklama / Etkinlik / Restoran / Spa) |

Kasa canlıdır; yoğun saatte seyrek tazelenir.

**"Kasanın günü"** ödemenin bakiyeye girdiği iş günüdür. Gece 00:30'da alınan ödeme, gün kapanmadıysa hâlâ "bugün"ün kasasındadır — gece görevlisinin sayımına girer. Onay bekleyen ödeme onaylandığı günün kasasına yazılır.

**Örnek:** 14 Kasım kasası: Nakit TL tahsilat 12.400 / iade 500 / net 11.900; Nakit EUR 200; Kart 38.250; Havale 6.000; Acente/cari 6.000 (kasaya para girmedi, cari takibi). Onay bekleyen: 25.000 nakit (çekmecede var, defterde yok). Gece kapanışında nakit TL beklenen 11.900 + 25.000 çekmecedeki fazlalık ayrıca açıklanır.

### Döviz kurları

"Bugünün kurları" kartına döviz ve kur girilir (1 birim döviz = kur × otel parası). Yalnızca **iş günü** için girilir; aynı gün yeniden kaydederseniz üzerine yazar. "Güncel kurlar" her dövizin geçerli kurunu ve yaşını gösterir; "Geçmiş" döviz süzgeciyle eski girişler. Kur girilmeden dövizli ödeme alınamaz. Gece kapanışı sırasında da girilebilir.

### Vardiya devri

Vardiya devir sayımı Gün kapanış sihirbazının **Kasa sayımı** ve **Fark** adımlarıdır (aşağıda); devir notu ve PDF devir raporu oradan çıkar. Gün içinde vardiya değişiminde "Yalnızca benim aldıklarım" süzgeciyle kendi çekmecenizi sayabilirsiniz.

## Minibar & çamaşırhane

**Nerede:** Ön büro → Minibar & çamaşır (`/ek-hizmetler`). Sekmeler: **Minibar girişi** (`/minibar`), **Minibar kayıtları** (`/minibar-kayitlari`), **Çamaşırhane** (`/camasir`), **Günlük rapor** (`/rapor`), **Fiyat listeleri** (`/fiyatlar`).

**Yetki:** kayıtlar, pano, rapor "ek hizmet görüntüleme" (kat, resepsiyon, müdür, muhasebe); minibar sayımı "minibar işleme" ve çamaşır "çamaşır işleme" (kat, resepsiyon, müdür); fiyat listeleri "ek hizmet yönetimi" (müdür, muhasebe).

### Fiyat listeleri (önce bunu kurun)

- **Minibar ürünleri:** kod (otel içinde tekil), ad, kategori (İçecek, Alkollü içecek, Atıştırmalık, Diğer), fiyat, odadaki standart adet, satışta / pasif, sıra. En fazla 120 ürün satışta.
- **Çamaşır parçaları:** parça × hizmet (Yıkama + ütü / Kuru temizleme / Yalnız ütü), fiyat. En fazla 150 satışta.
- **Ekspres farkı (%)**: varsayılan %50.

Ürün listesi boşsa giriş ekranı "Minibar ürün listesi boş" der.

### Minibar girişi (telefon için tasarlandı)

**Adım adım:**

1. **Oda numarasını** yazın. Ekran odanın şimdiki durumunu getirir: odadaki misafir, **son 24 saatte odadan ayrılanlar** (çıkış ya da oda değişimi), son sayımlar, açık çamaşır.
2. Tüketilen ürünlerin adedini büyük **+ / −** düğmeleriyle girin; alt şeritte anlık toplam.
3. **Kime yazılsın:** Odadaki misafir · Odadan ayrılan misafir (geç kalem) · Kimseye yazma (kayıp — **gerekçe zorunlu**).
4. Aynı odaya son 24 saatte girilmiş sayım varsa **uyarı** görürsünüz (iki görevli aynı odayı iki kez yazmasın).
5. İsteğe bağlı not → **Kaydet**. Fiş numarası (`MB-XXXXXX`) oluşur.

| Tetikleyici | Ne olur | Nerede görünür | Kapalıysa / hatada |
| --- | --- | --- | --- |
| Fiş odadaki misafire kesildi | Folyo aktörü "Minibar tüketimi" kalemini minibar vergisiyle, yönlendirmeye uyarak işler | Folyo dökümü; Minibar kayıtları'nda durum **İşlendi** | Durum "personele düştü" + Folyo görevi; personel kalemi elle işler, görevi kapatır |
| Fiş ayrılan misafire kesildi (geç kalem) | Misafirin **açık** folyosuna yazılır | Çıkmış misafirin folyosu "Açık bakiye" görünümüne düşer | Folyo kapanmışsa aktör yeni folyo **açmaz**: "folyo kapalı" → folyo yetkilisine görev (misafiri arayıp tahsil ya da ikram kararı) |
| Kayıp seçildi | Folyoya gitmez; raporda "kayıp" sütunu | Günlük rapor | — |
| Seçilen misafir bu arada değişti (çıkış yaptı) | Fiş yazılmaz, "konaklama değişti" uyarısı; odayı yeniden açın | Giriş ekranı | — |

**Örnek:** Oda 118, 15 Kasım 10:20 sayım: 2 su (25 TL) + 1 çikolata (60 TL) = 110,00. Misafir 09:40'ta çıkış yapmıştı → ekranda "Son 24 saatte ayrılan: Ayşe K." görünür → "Odadan ayrılan misafir (geç kalem)" seçilir → fiş `MB-004512` → Ayşe K.'nin folyosu çıkışta kapanmıştı (bakiye 0) → aktör kalem yazamaz → Görevler ekranında "Folyo: kapalı folyoya minibar kalemi" görevi; resepsiyon misafiri arar, kartından tahsil eder ya da ikram kararı verir, görevi kapatır. Misafir hâlâ içerideyse 110,00 TL doğrudan 1. pencereye düşer, çıkışta ödenir.

Fiş **silinmez, değişmez**; yanlış fiş folyodaki kalem iptaliyle düzeltilir. Fişin durumu (işlendi / işleniyor / personele düştü / kayıp) Minibar kayıtları'nda görünür.

### Minibar kayıtları

Günün fişleri: saat, oda, kime yazıldı, satırlar, toplam, **folyo durumu**, folyoya bağlantı. Gün seçilebilir; liste yoğun saatte seyrek tazelenir.

### Çamaşırhane

**Ne yapar:** içerideki misafirden alınan çamaşır siparişlerini yaşam döngüsüyle izler: **Alındı → Yıkamada → Hazır → Teslim edildi** (ya da İptal). Durum ileri atlanabilir (Alındı'dan Hazır'a), geri dönülmez.

**Yeni sipariş (adım adım):**

1. Oda numarası → odadaki misafir gelir ("Odada konaklayan misafir yok" uyarısı varsa sipariş alınamaz — sipariş içerideki misafir adınadır).
2. Parça ve adetleri seçin (fiyat listesinden; en fazla 50 satır, adet ≤ 99).
3. **Ekspres** işaretlenirse sipariş anındaki yüzde fark eklenir.
4. **Teslim zamanı**: ileride ve en fazla 7 gün sonra (form önerir).
5. Not (leke, hasar, özel istek) → Kaydet. Sipariş no `LND-XXXXXX`.

**Pano:** görünümler Açık / Geciken (kırmızı) / Teslim edilen / İptal; arama oda no, sipariş no, misafir adı. Satır işlemleri: **Sayım düzelt** (yalnız Alındı / Yıkamada iken; siparişteki parça **eski fiyatını** korur, yeni parça güncel fiyatla), **Sonraki adım**, **Teslim et** (onay ister), **İptal** (hazır gerekçeler).

| Tetikleyici | Ne olur | Nerede görünür | Kapalıysa / hatada |
| --- | --- | --- | --- |
| Sipariş **teslim edildi** | Folyo aktörü parça satırlarını + **ekspres farkını ayrı satır** olarak "Çamaşırhane siparişi" kaynağıyla yazar | Folyo dökümü | Folyo görevi |
| İptal edildi | Hiç işlenmez | Pano "İptal" | — |
| Misafir çıkmış, siparişi teslim edilmemiş | Çıkış penceresi "Teslim edilmemiş N çamaşır siparişi var" uyarır | Check-out | — |
| Çıkıştan sonra teslim | Açık folyoya geç kalem; folyo kapalıysa görev | Folyo / Görevler | — |
| Aynı siparişi iki kişi aynı anda teslim etti | İkincisi "kayıt değişti" alır; ücret **iki kez yazılmaz** | Pano | — |

**Örnek:** Oda 402, 2 gömlek yıkama+ütü (80 TL) + 1 ceket kuru temizleme (250 TL) = 410,00; ekspres %50 → +205,00; toplam 615,00; teslim yarın 12:00. Teslim edilince folyoya üç satır düşer: "Gömlek yıkama+ütü ×2 160,00", "Ceket kuru temizleme ×1 250,00", "Ekspres farkı 205,00" (çamaşır vergisiyle). Misafir siparişi teslimden önce iptal ederse hiçbir şey yazılmaz.

### Günlük rapor

Seçili gün için: **Minibar** — folyoya yazılan (odadaki + geç kalem), kayıp, ürün ve personel kırılımı; **Çamaşırhane** — o gün alınan, teslim edilen (gelir, hizmet kırılımı), şu an açık ve geciken. Tutarlar liste fiyatıdır; vergili toplam folyoda.

## Kayıp eşya

**Nerede:** Ön büro → Kayıp eşya (`/kayip-esya`); eşya sayfası `/kayip-esya/<kimlik>`.

**Yetki:** liste, eşya ve fotoğraf "görüntüleme" (müdür, resepsiyon, kat, F&B); kayıt, düzeltme, fotoğraf "kayıt" (aynı); eşleştirme, iletişim notu, teslim "teslim" (müdür, resepsiyon); kapatma ve saklama süreleri "yönetim" (müdür). Misafirin telefonu / e-postası ve kargo adresi yalnızca teslim yetkisine gösterilir.

### Akış ve durumlar

**Depoda** → (eşleştirme) → **Sahibi bulundu** → **Teslim edildi**; ya da süre dolunca **Kapatıldı** (bağış / imha / polis / hatalı kayıt). Kapanmış kayıt değişmez; iletişim notu her durumda yazılır.

### Liste — alanlar

| Alan | Anlamı |
| --- | --- |
| Sayaçlar | Saklanan / teslim bekleyen / **süresi dolan** |
| Görünümler | Saklananlar · Teslim bekleyen · Süresi dolan · Teslim edilen · Kapatılan |
| Arama / süzgeç | Etiket no, oda no, açıklama, yer, misafir; kategori; "değerli"; tarih |
| Satır | Etiket no `LF-XXXXXX`, kapak fotoğrafı, açıklama, nerede bulundu, bulunma günü, durum |

### Kayıt (adım adım)

1. "Yeni eşya" → **Açıklama**, **Kategori** (Elektronik, Takı / saat, Cüzdan / kimlik / para, Giysi, Çanta / gözlük / aksesuar, Oyuncak, Diğer), **Değerli eşya** kutusu.
2. **Bulunduğu yer:** Odada (oda seçilir) ya da Ortak alanda (yer yazılır).
3. **Bulunma zamanı**, **Bulan** (hesabı olmayan personel de yazılabilir), **Saklandığı yer** (raf / kasa), not.
4. Kaydet → etiket no oluşur; **poşetin üstüne yazın**.
5. Eşya sayfasında **fotoğraf** ekleyin (telefonda kamera açılır; en fazla 4; tarayıcı küçültür, konum bilgisi düşer).

### Sahibini bulma

- Eşya **odada** bulunduysa "Sahibini bul" adayları listeler: o sırada odada kalan ve **son 7 günde** odadan ayrılanlar (çıkış ya da oda değişimi), ayrılış yakınlığına göre; refakatçiler dahil. Eşyadan **sonra** gelen misafir aday değildir.
- **Ortak alanda** bulunduysa misafir araması (ad, telefon, e-posta; en az 2 karakter).
- Eşleştirme sonrası iletişim notları yazılır (kanal: Telefon, WhatsApp, SMS, E-posta, Yüz yüze, Not). Eşleşme gerekçeyle kaldırılabilir; nota da düşer.

### Teslim ve kapatma

- **Elden teslim:** teslim alan adı; **değerli eşyada "Teslim alanın kimliğini gördüm" zorunlu**.
- **Kargo:** firma, takip no, alıcı, gönderim adresi, kargo ücreti kim ödedi (misafir / otel), tutar.
- **Kapatma (yönetim):** Ne yapıldı (Bağışlandı / İmha edildi / Polise teslim / Hatalı kayıt) + gerekçe. Saklama süresi dolmadıysa uyarı çıkar (yine de kapatılabilir).

| Tetikleyici | Ne olur | Nerede görünür |
| --- | --- | --- |
| Saklama süresi doldu (normal 90 gün, değerli 365 — ayarlanır) | Eşya "Süresi dolan" görünümüne düşer | Liste sayacı |
| Kayıt kapandı | Fotoğraflar **30 gün sonra** otomatik silinir | — |
| Misafir çıkış yapıyor | Çıkış penceresi misafire eşleşmiş eşyayı ve odasında bulunup eşleşmemiş eşyayı uyarır | Check-out |
| Aynı eşya iki kişiye teslim edilmeye çalışıldı | İkincisi "kayıt değişti" alır | Eşya sayfası |

**Örnek:** 14 Kasım 11:30 kat görevlisi 204'te saat bulur; "Takı / saat", **değerli** işaretli, etiket `LF-000731`, fotoğraf 2 adet. Resepsiyon "Sahibini bul": 204'ten 14 Kasım 09:50'de çıkan Mehmet A. ilk aday → eşleştir → WhatsApp notu "misafire yazıldı, kargo istiyor". 16 Kasım kargo: firma, takip no, adres, ücret misafir ödemeli → "Teslim edildi". Saklama süresi 365 gün olduğundan kapatma gerekmedi. Sahip bulunamasa 365 gün sonra "Süresi dolan"a düşer, müdür "Polise teslim, tutanak no 12" ile kapatır; fotoğraflar 30 gün sonra silinir.

## Gün kapanış (night audit)

**Nerede:** Ön büro → Gün kapanış. Sekmeler: **Kapanış** (`/gun-kapanis`), **Geçmiş** (`/gun-kapanis/gecmis`). **Yetki:** durum, geçmiş, PDF "gün kapanışı görüntüleme"; başlatma ve kapatma "gün kapatma" (resepsiyon ve müdür).

### İş günü kavramı

İş günü **son kapatılan günün ertesidir**. Hiç kapanış yoksa takvim günü kullanılır. Gün kapatılmadan iş günü ilerlemez: oda ücretleri yazılmaz, "bugün gelecekler" değişmez, kasanın günü değişmez, raporların "bugün"ü değişmez. Takvimden ileri bir gün kapatılamaz ("gün gelmedi"); aynı gün iki kez kapatılamaz.

### Sihirbaz — 5 adım

Adımlar ilerlerken **veri yazılmaz**; yalnızca son adımdaki "Günü kapat" işler. İki görevli aynı anda kapatamaz (başlatan "devam ediyor" işaretler).

| Adım | Ne gösterir | Ne yaparsınız |
| --- | --- | --- |
| 1. Gelmeyenler | Giriş günü bugün olan, gelmemiş rezervasyonlar (misafir, tip, ilk gece ücreti) | Listeyi kontrol edin; geç gelecek misafir için kapanışı erteleyin ya da sonra "geri al" kullanın |
| 2. Oda ücretleri | İçerideki konaklamalar ve bu gece yazılacak ücretler; iş günü | Kontrol |
| 3. Kasa sayımı | Yöntem bazında **beklenen** (sistemdeki işlenmiş ödemeler); her yöntem için **sayılan** girilir (nakit döviz kendi para biriminde) | Çekmeceyi sayın, yazın |
| 4. Fark | Beklenen − sayılan, yöntem bazında | Farkı açıklayın (devir notuna) |
| 5. Günü kapat | "Gelmeyen ücretini uygulama" seçeneği, **Devir notu**, uyarı: geri alınamaz | "Günü kapat" |

Yetkiniz yoksa sihirbazı yalnızca görürsünüz ("Görüntüleme yetkisi" uyarısı).

### Arka planda — "Günü kapat" basıldığında

| Sıra | Ne olur | Nerede görünür | Not |
| --- | --- | --- | --- |
| 1 | Başlatıldığında folyo aktörü tamamlanmış gecelerin ücretini önceden basar | Folyo dökümleri | İdempotent |
| 2 | Gelmeyenler toplu **Gelmedi** yapılır (ücret: ilk gece; "uygulama" seçeneğiyle vazgeçilir) | Rezervasyon durumları; folyo aktörü gelmedi ücreti kalemi | Odalar satışa döner, bekleme listesi taranır |
| 3 | **O gecenin** oda ücretleri bütün içerideki konaklamalara yazılır | Folyolar | Aynı anahtar: ikinci kez yazılmaz |
| 4 | Dolu odaların kat hizmeti **Kirli** yapılır (konaklama temizliği) ve sabah görevleri için kaynak olur | Kat haritası, görev panosu | Kat hizmeti aktörü / zamanlayıcı STAYOVER görevlerini üretir |
| 5 | **Günlük özet** yazılır: doluluk, oda geliri, ADR, RevPAR, tahsilat (satılabilir oda = toplam − arızalı) | Kapanış özeti, Geçmiş, Panel | Gelir raporlarıyla aynı tanımlar |
| 6 | **Vardiya raporu** kaydedilir: yöntem bazında beklenen / sayılan / fark, devir notu | Geçmiş → gün → PDF | — |
| 7 | Gün **Kapalı** olur; iş günü ilerler; "gün kapandı" olayı yayınlanır | Üst barda tarih; her ekranın "bugün"ü | Geri alınamaz |

**Örnek:** 14 Kasım kapanışı. Adım 1: 2 gelmeyen (biri 1.800, diğeri 2.500 TL ilk gece). Adım 2: 37 içeride konaklama, 37 gece ücreti yazılacak. Adım 3: beklenen Nakit TL 11.900 — sayılan 11.880 (fark −20); Nakit EUR 200 — sayılan 200; Kart 38.250 — sayılan 38.250 (slipler). Adım 4 fark: −20 TL nakit. Adım 5: devir notu "20 TL nakit açık, bozuk para; 25.000 TL nakit onay bekliyor, çekmecede ayrı zarfta", "Günü kapat". Sonuç: 2 gelmedi ücreti folyolara düşer, 37 oda ücreti yazılır, dolu odalar kirli olur, 14 Kasım özeti: doluluk %74, oda geliri 92.500, ADR 2.500, RevPAR 1.850, tahsilat 56.350; iş günü 15 Kasım.

**Onay bekleyen ödemeler** (para çekmecede, defterde değil) kapanışta beklenen tutara girmez; sayımda fazlalık olarak görünür. Devir notuna yazın ya da kapanıştan önce onaylattırın.

### Geçmiş

Kapanmış günler: doluluk, gelir, kasa farkı; günün ayrıntısında özet, gelmeyen sayısı ve **devir raporu PDF**.

## Sık sorulanlar

**Oda ücretleri folyoda görünmüyor.**
İş günü ilerlememiştir (gün kapanışı yapılmamış) ya da folyo aktörü kapalıdır. Folyolar listesindeki şeritte eksik gece sayısını görürsünüz; "Oda ücretlerini işle" ile elle çalıştırın. Kalıcı çözüm: gece kapanışını her gün yapın, Aktörler ekranında folyo aktörünün açık olduğunu doğrulayın.

**Çıkışta ödenecek tutar folyodaki bakiyeden fazla.**
Normaldir: çıkış ekranı bakiyeye **çıkışta işlenecekleri** (o gece dahil kalan geceler, geç çıkış ücreti) ekler. Çıkış yapılınca kalemler folyoya düşer ve bakiye eşitlenir.

**Kalemi sildim mi? Hâlâ görünüyor.**
Kalem silinmez; iptal onaylanınca üstü çizili olur ve altında iptal kaydı görünür. "İptal edilenleri göster" anahtarı kapalıysa ikisi de gizlenir.

**Kendi iptal isteğimi neden onaylayamıyorum?**
Dört göz kuralı: isteyen onaylayamaz (kasa açığına karşı). Reddederek geri çekebilirsiniz; başka yetkili onaylar.

**Dövizli ödeme "kur eski" diyerek reddedildi.**
Kasa → Döviz kurları'ndan günün kurunu girin (yetki: müdür / muhasebe). Kur en fazla 3 gün eski olabilir.

**Ödeme aldım, bakiye düşmedi.**
Büyük tutar eşiği aşıldı; satır "Onay bekliyor". Onaylanana kadar bakiyeye ve kasaya girmez. Onaylar → Bekleyen'de başka bir yetkili onaylar.

**Misafir çıktı, sonra minibar fişi geldi; folyo kapalı.**
Aktör yeni folyo açmaz; Görevler ekranına "Folyo" görevi düşer. Misafiri arayıp kartından tahsil (fiyatı folyoya yazmak için folyoyu yetkili yeniden açar, kalemi işler, ödemeyi alır, kapatır) ya da ikram kararı (görevi "gerek kalmadı" ile gerekçeli kapatın).

**Şirket ödeyecek; misafiri nasıl çıkarırım?**
Şirket penceresini "Acente / cari" yöntemiyle kapatın (belge no) — kasaya para girmez, cari takibe düşer; sonra çıkış. Ya da yetkili "Bakiyeyle çıkış yap" + gerekçe.

**Çamaşır ücreti folyoda yok.**
Çamaşır **teslimde** yazılır; sipariş hâlâ "Hazır" ise yazılmaz. Teslim edince düşer.

**Gün kapanışında kasa farkı çıktı; ne yapmalı?**
Fark adımı farkı gösterir; devir notuna açıklayın ve kapatın. Fark raporda kalır. Onay bekleyen ödemeler beklenen tutara girmez — çekmecedeki fazlalığın sebebi çoğunlukla budur.

**Gün kapanışını yanlışlıkla erken yaptım.**
Geri alınamaz. Gelmedi işaretlenen misafir gelirse rezervasyonundan "İptali / gelmediyi geri al" kullanın (ücret ters kayıtla düşer, yer denetlenir). Oda ücretleri zaten doğru geceye yazılmıştır.

**Fatura taslağı oluşmadı.**
Folyo kapanmamıştır (bakiye ya da bekleyen onay) ya da aktör kapalıdır. Faturalar → Faturalanacaklar listesi kapanan ama taslağı açılmamış folyoları gösterir; oradan kesin.

## Sık yapılan hatalar

- **Oda ücretini elle "Diğer" kalemi olarak yazmak.** Gece ücreti sistemden gelir; elle yazarsanız gün kapanışında **ikinci kez** yazılır. Eksik gece varsa "Oda ücretlerini işle" düğmesini kullanın.
- **Yanlış pencereye harcama yazmak.** Elle harcama **seçili** pencereye gider; şirket penceresi açıkken misafirin kahvesini oraya yazmayın. Yanlış yazdıysanız "Aktar".
- **Birden çok açık folyoda pencere seçmeden ödeme almaya çalışmak.** Sistem reddeder ("folyo gerekli"); doğru pencereyi seçin.
- **Kur yazmaya çalışmak.** Form kur almaz; kur tablosundan gelir. Gün kuru girilmemişse önce Kasa → Döviz kurları.
- **Kart numarasını referansa / nota yazmak.** Reddedilir (PCI). Slip / provizyon numarası yazın.
- **İade yerine ödeme iptali (ya da tersi) istemek.** Misafire geri verilen para **iade**; yanlış girilen satır **iptal**. İadesi yapılmış ödeme iptal edilemez.
- **Grup folyolarını birleştirip sonra ayırmaya çalışmak.** Birleştirme geri alınmaz; önce bölme / yönlendirmeyle planlayın.
- **Fatura kesilmiş folyoyu yeniden açmaya çalışmak.** Engellidir; önce fatura iptali (onaylı).
- **Minibar fişini "düzeltmek" için yeni fiş kesmek.** Fiş değişmez; yanlış fişin kalemini folyodan iptal ettirin. Aynı odaya 24 saat içinde ikinci sayım uyarısını ciddiye alın.
- **Çamaşırı teslim etmeden "Hazır"da bırakmak.** Ücret teslimde yazılır; misafir çıkarsa çıkış penceresi uyarır, ücret kaçar ya da geç kalem olur.
- **Kayıp eşyayı poşete etiket numarası yazmadan kaldırmak.** Arama etiket numarasıyla tam eşleşir; numara yoksa depoda bulunmaz.
- **Değerli eşyayı kimlik görmeden teslim etmeye çalışmak.** Sistem reddeder; "kimliğini gördüm" zorunludur.
- **Gün kapanışını atlamak ya da sabaha bırakmak.** İş günü ilerlemez; oda ücretleri yazılmaz, gelecekler listesi dünde kalır, kasanın günü karışır. Gece görevlisinin son işi kapanıştır.
- **Kapanışta onay bekleyen ödemeyi "fazlalık" sanıp düzeltmeye çalışmak.** Para çekmecededir ama onaylanmadıkça defterde değildir; devir notuna yazın ya da önce onaylattırın.
