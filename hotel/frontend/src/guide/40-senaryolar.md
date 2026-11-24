# Uçtan uca senaryolar

Önceki bölümler ekranları tek tek anlattı. Bu bölüm aynı ekranları **bir hikâyenin içinde** gösterir: gerçek bir misafir, gerçek bir yemek, gerçek bir gün kapanışı. Her senaryo adım adım ilerler ve her adımda üç şeye bakar:

- **Ekranda ne yapılır:** personelin (ya da misafirin) tıkladığı şey.
- **Arka planda ne olur:** hangi olay yayınlanır, hangi aktör ne yapar, hangi kayıt yazılır.
- **Nerede görünür:** sonucun izini hangi ekranda bulursunuz.

Senaryolardaki isimler, oda numaraları ve tutarlar örnektir; otelinizin vergileri ve fiyatları farklıdır. Örnek otel: 60 odalı şehir oteli, para birimi TRY, KDV %10 oda ve yiyecek-içecek, konaklama vergisi %2 oda, KDV %20 minibar / çamaşır / spa / diğer (demo otelin düzeni).

Okumaya başlamadan iki hatırlatma:

- **Aktör** arka planda kendi kendine çalışan işçidir; kapatılsa işi "Görevler" ekranına düşer, kaybolmaz.
- **İş günü** otelin "bugün"üdür ve gün kapanışı yapılmadan değişmez. Oda ücretleri, kasa günü ve raporlar iş gününe göre işler; faturanın tarihi ise takvim günüdür.

## Senaryo A — Bir misafirin yolculuğu

**Kahraman:** Ayşe Demir, İstanbul'dan, 2 yetişkin, 14–16 Mart (2 gece), Deluxe oda. Otel sitesindeki widget'tan rezervasyon yapıyor. Deluxe taban fiyat 3.000 TL / gece, Mart sezonu çarpanı 1,0.

### A1. Web sitesinden rezervasyon

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 1 | Ayşe otel sitesindeki **rezervasyon widget'ında** 14–16 Mart, 2 yetişkin seçer. | Widget `/public/booking/<anahtar>/quote` ile teklif ister. Sunucu personel teklifini **kırpar**: promosyon / acente kimlikleri dönmez, kalan oda "Son 3" ya da "5+" olarak görünür (gerçek envanter sızmaz). | Yalnız widget. |
| 2 | Deluxe kartında "6.000 TL" (2 gece × 3.000) ve varsa indirim etiketini görür, seçer; ad, soyad, e-posta, telefon girer; özeti onaylar. | `POST /reserve`: rezervasyon **bekleyen (PENDING)** açılır, kaynak `WIDGET`, istek kimliği ile (ağ hatasında ikinci gönderim ikinci rezervasyon açmaz). Yer yoksa sebepli reddedilir, onaya gitmez. `reservation.created` yayınlanır. | Rezervasyonlar → Liste'de "Bekleyen" rozetiyle, kaynak "Web sitesi". |
| 3 | Widget **onay kodunu ekranda** gösterir ("otel onaylayınca e-posta ile bilgi verilecek"). | **Dürüst not:** `reservation.created` bildirim kuyruğuna düşer ama **e-posta geçidi henüz gerçek gönderici değildir**; Ayşe'ye e-posta fiilen gitmez. Bu yüzden kod ekranda gösterilir. SMS kanalı (Netgsm) kurulu ve açıksa SMS gidebilir. | Bildirimler → Gönderim geçmişi (durum ve sebep). |
| 4 | — | **Oda aktörü** (room-worker) `reservation.created`'ı dinler, kapasite / arıza / temizlik durumuna göre uygun bir Deluxe oda seçer: **204**. `room.assigned` yayınlanır. | Rezervasyon detayında oda 204; Oda planı'nda 14–16 Mart 204 satırında blok. |
| 5 | Resepsiyon sabah Rezervasyonlar → Liste'de bekleyenleri açar, Ayşe'nin kaydını **Onayla**. | `reservation.confirmed` yayınlanır. Bildirim aktörü **onay bildirimini** şimdi gönderir (bekleyen rezervasyona onay bildirimi gitmez, onaylanınca gider). Kanal yöneticisi (varsa) envanteri **kirli** işaretler; 5 sn'lik iş OTA'ya 14–16 Mart Deluxe müsaitliğini bir eksik gönderir. | Rezervasyon durumu "Onaylı"; Kanallar → Senkron logu'nda gönderim satırı. |

Telefonla gelen rezervasyonda 1–3. adımların yerine resepsiyon **Rezervasyonlar → Yeni rezervasyon** formunu kullanır: misafir arama (telefon / e-posta ile mevcut kart bulunur; ad farklıysa sistem "aynı kişi mi?" diye sorar), tarih, kişi, oda tipi, pansiyon, canlı fiyat önizlemesi. Form kaydedilince rezervasyon doğrudan **onaylı** açılır ve 4. adım aynı şekilde işler.

### A2. Online check-in (girişten önce)

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 6 | — | Girişten 7 gün önce (`checkinOpenDays`) zamanlanmış iş (30 dk'da bir) **portal daveti** gönderir: e-posta / SMS şablonu `CHECKIN_INVITE`, içinde imzalı bağlantı `/misafir/p/<kimlik>.<imza>`. Portal adresi ve açık bir kanal yoksa tur başlamaz. | Rezervasyon detayı → **Misafir portalı kartı** (bağlantı, QR, davet durumu, "yeniden gönder"). |
| 7 | Ayşe telefonunda portalı açar: "Rezervasyonum", **Online check-in** formu — her yetişkin için kimlik bilgisi + **belge fotoğrafı** (zorunlu, telefonda küçültülür), KVKK ve fotoğraf rızası, ticari ileti tercihi, parmakla imza. Gönderir. | Kayıt "inceleme bekliyor" olur; resepsiyon ziline `ONLINE_CHECKIN` uyarısı düşer. Belge fotoğrafları çıkıştan 7 gün sonra kendiliğinden silinir (KVKK). | Ön büro → **Online check-in** sekmesi (giriş günü, durum sayıları, arama). |
| 8 | Resepsiyon kaydı açar: kişiler, belge fotoğrafları, imza. **Onayla** (ya da "düzeltme iste" — sebep misafire kendi dilinde görünür). | Durum "onaylandı". Ayşe sonradan bir şey değiştirirse yeniden incelemeye düşer. | Aynı ekran; portalda Ayşe "onaylandı" görür. |

### A3. Giriş günü

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 9 | Ayşe 14 Mart 13:30'da gelir. Resepsiyon Ön büro → **Gelecekler** → Ayşe → **Check-in**. Form online check-in'den **dolu** gelir (kimlik, refakatçi, plaka). Teminat: 1.000 TL nakit. Oda 204 "Temiz, kontrol edildi". | `POST /front-desk/stays/:id/check-in`: giriş günü gelmiş mi, oda arızalı / dolu değil mi, kimlik sağlaması (TC kimlik no algoritması) denetlenir. Kirli odaya giriş personel onayı ister. Aynı konaklamaya iki eşzamanlı giriş: biri olur. `guest.checked_in` yayınlanır (teminat bilgisiyle). | Ön büro → Konaklayanlar'da Ayşe, oda 204. |
| 10 | — | **Oda aktörü:** 204'ü **Dolu** yapar (doluluğun tek yazıcısı sistemdir; ekranda "boş / dolu" düğmesi bilerek yoktur). | Odalar → Oda listesi; Oda planı. |
| 11 | — | **Folyo aktörü** (billing-worker): Ayşe'nin **folyosunu açar** (pencere 1), girişi saat 13:30 olduğu için **erken giriş ücreti** otel ayarına göre varsa işler (ör. "yok"), **1.000 TL nakit teminatı ödeme olarak** yazar (kaynak "giriş teminatı", alan: girişi yapan personel, kasa günü bugün). Teminat eşik üstüyse onaya gider. | Folyolar → Ayşe → ödemeler: "1.000,00 TRY nakit — giriş teminatı". Kasa → Günlük kasa: nakit +1.000. |
| 12 | — | **Muhasebe aktörü:** `payment.received` → eşlemede "Ön büro × nakit × TRY" → **Resepsiyon kasası** hesabına 1.000 TL giriş (kaynak: folyo ödemesi). | Ön muhasebe → Kasa / banka → Resepsiyon kasası hareketleri. |
| 13 | — | **Bildirim aktörü:** "Hoş geldiniz" bildirimi (SMS / e-posta; Türk misafire Türkçe). Online check-in kaydı "giriş yapıldı" olur. Oda bilgisi yalnız giriş günü gönderilir. | Bildirimler → Gönderim geçmişi. |

### A4. Konaklama sırasında harcamalar

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 14 | Akşam Ayşe restoranda yemek yer. Garson Mehmet, Restoran → **Masa planı** → Masa 7 → adisyon açar, 2 × Izgara Levrek (450 TL) + 1 şişe su (60 TL) = 960 TL gönderir. | Adisyon `ADS-2026-000412` açılır (Mehmet'in açık vardiyasında; vardiya yoksa adisyon açılmaz). `fnb.order.placed` → mutfak ekranına düşer (bkz. Senaryo B). | Restoran → Adisyonlar. |
| 15 | Ödemede Mehmet **Odaya yaz** → "204 / Demir" arar → seçer. | `fnb.order.charged` yayınlanır (kalemler vergi kategorisiyle). **Folyo aktörü** kalemi Ayşe'nin folyosuna yazar: "Restoran · ADS-2026-000412" 960,00 TL (KDV %10 dahil döküm kalemde saklanır). Aynı olay iki kez gelse tek kalem (kaynak anahtarı). Adisyon kapanır; `fnb.order.paid` yayınlanır → **stok aktörü** reçeteden levrek ve su stoğunu düşer. | Folyolar → Ayşe → kalemler: Restoran 960,00. Stok → Hareketler: SALE satırları. |
| 16 | Ertesi sabah kat görevlisi Zeynep, odayı temizlerken telefonundan Minibar & çamaşır → **Minibar girişi** → oda 204 → 1 × Kola (90 TL), 1 × Fıstık (120 TL) → "odadaki misafire yaz". | Fiş `MB-000287` kesilir (ekran odadaki ve son 24 saatte odadan ayrılanları gösterir; kimse yoksa "kayıp" seçilir, gerekçe zorunlu). `minibar.consumed` → folyo aktörü **Minibar** kalemi 210,00 TL (KDV %20 dahil). Aynı odaya son 24 saatte başka sayım varsa uyarı (çift giriş). | Folyo kalemleri; Minibar & çamaşır → Minibar kayıtları ("folyoya işlendi" bağlantısı). |
| 17 | Zeynep temizliği bitirir: Kat hizmetleri → Görevlerim → 204 **Bitti**. | Sabah zamanlayıcısı konaklayan odalar için **STAYOVER** görevi üretmişti. `housekeeping.task.completed` → **kat hizmetleri aktörü** odayı Temiz yapar; kat şefi kontrol edince "Kontrol edildi". | Kat hizmetleri → Kat haritası. |

### A5. Gece: oda ücreti

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 18 | Gece görevlisi **Gün kapanış** sihirbazını çalıştırır (ayrıntı Senaryo C). | `night.audit.started` → folyo aktörü tamamlanmış gecelerin oda ücretini **önceden basar**. Kapanışta 14 Mart gecesi için Ayşe'nin folyosuna **"Konaklama 14.03"** 3.000,00 TL (KDV %10 + konaklama vergisi %2 dahil, döküm kalemde) yazılır. Anahtar `night:<konaklama>:2026-03-14`: iki çalışma aynı anda koşsa da çift kalem olmaz. | Folyo kalemleri: Konaklama 14.03 — 3.000,00. |
| 19 | — | Gün kapanınca **iş günü 15 Mart** olur. Kapanış yapılmazsa oda ücreti kuyruğu bekler; sunucu kapalı kalsa bile ilk çalışmada geçen geceler telafi edilir. | Gün kapanış → Geçmiş. |
| 20 | 15 Mart gecesi aynı şekilde "Konaklama 15.03" 3.000,00. | Folyo borcu: 3.000 + 3.000 + 960 + 210 = **7.170,00 TL**; ödenen 1.000 (teminat); bakiye **6.170,00 TL**. | Folyo toplamları. |

### A6. Çıkış, folyo kapanışı, fatura, muhasebe

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 21 | 16 Mart 11:00. Ön büro → **Gidecekler** → Ayşe → **Check-out**. Pencere ödenecek tutarı gösterir: bakiye 6.170,00 + çıkışta işlenecekler (geç çıkış saati geçmediyse 0). | Çıkış bakiye sıfır olmadan **yapılamaz** (`BALANCE_DUE`); yalnız yetkili gerekçeyle "bakiyeyle çıkış" yapar ve zile uyarı düşer. | Çıkış penceresi. |
| 22 | **Ödeme al**: kredi kartı, 6.170,00 TL, slip referansı (nakit dışı yöntemlerde referans zorunlu; kart numarasına benzeyen dizi yazılamaz). | Ödeme folyo kilidiyle yazılır, toplamlar aynı işlemde yenilenir. Tutar otelin **büyük ödeme eşiğinin** üstündeyse satır "onay bekliyor" olur ve onaylanana kadar bakiyeye girmez. `payment.received` yayınlanır → **muhasebe aktörü** "Ön büro × kart × TRY" eşlemesiyle **POS bankası** hesabına 6.170 TL giriş. | Kasa → Günlük kasa: kart 6.170. Ön muhasebe → Kasa / banka → POS bankası. |
| 23 | Bakiye 0. **Çıkışı tamamla**. | `guest.checked_out`: **oda aktörü** 204'ü Boş + Kirli yapar; **kat hizmetleri aktörü** `CHECKOUT_CLEAN` görevi açar (açık STAYOVER varsa ona yükselir); **folyo aktörü** kalan gece / geç çıkış ücreti varsa işler, bakiyesi sıfır folyoyu **kapatır** → `folio.closed`; **bildirim aktörü** "teşekkür" mesajı; **anket**: çıkıştan 1 gün sonra `postStaySendHour` saatinde anket daveti kuyruğa girer. | Konaklayanlar'dan düşer; Kat hizmetleri → görev listesinde 204 "Çıkış temizliği"; Folyolar → Kapananlar. |
| 24 | — | **Folyo aktörü** `folio.closed` ile **fatura taslağı** açar (faturalama başlangıcından sonraysa ve otomatik taslak açıksa). Satırlar gelir grubuna göre: "Konaklama 14.03–16.03 (2 gece)" 6.000, "Restoran" 960, "Minibar" 210; vergi dökümü kalemlerden. Alıcı: folyo cariye aktarılmadığı için **misafir** (Ayşe Demir, kişi). Adres ve kimlik önceki faturasından doldurulur. | Faturalar → **Taslaklar**; folyo ekranındaki fatura kutusu. |
| 25 | Muhasebe (ya da resepsiyon) taslağı açar, alıcı TC kimlik ve adresi kontrol eder, "Kesmeden önce" listesi boş → **Kes**. | Tek işlemde: kaynak yeniden okunur (değiştiyse durur), kişi alıcı → **e-Arşiv**, seri × yıl numarası `DMA2026000000731`, UBL-TR belgesi üretilir ve dondurulur, gönderim sırasına girer. `invoice.issued` yayınlanır. **Not:** gerçek entegratör adaptörü henüz yok; test ortamında belge GİB'e fiilen gitmez, PDF'de "mali değeri yoktur" yazar. | Faturalar → Kesilenler: GİB durumu "sırada → entegratörde → tamamlandı" (test entegratöründe). PDF indirilebilir. |
| 26 | — | **Muhasebe aktörü** `invoice.issued`'u işler: folyo faturasında numara **alacağı doğuran cari harekete** yazılır. Ayşe kartla ödediği için cari hareket yoktur (para zaten bankaya işlenmişti); bağlanacak hareket olmadan iş biter. Acente / voucher ile kapanan folyoda ise acente carisindeki borç satırına fatura numarası yazılırdı. | Ön muhasebe → cari ekstresi (acente senaryosunda). |
| 27 | Ertesi gün Ayşe'ye **anket** gider; cevaplar. Puan düşükse takip kaydı açılır (bkz. Senaryo I). | — | Anketler → Cevaplar / Takip. |

**Özet:** Ayşe'nin yolculuğunda personel beş kez tıkladı (onayla, online check-in onayı, giriş, çıkış + ödeme, fatura kes). Geri kalan on beş adım aktörlerin işiydi. Her adımın izi Aktivite → Canlı akış'ta aynı zincir kimliğiyle görülür.

## Senaryo B — Bir yemeğin yolculuğu

**Kahraman:** "Izgara Levrek" — menüde 450 TL (KDV %10 dahil). Reçete: 1 porsiyon = 300 g levrek fileto (fire %10 → brüt 333 g), 20 ml zeytinyağı, 150 g roka. Depo: Mutfak ana depo. Levrek minimum seviyesi 5 kg.

### B1. Tanımlar (bir kez yapılır)

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 1 | Şef, Mutfak → **Malzeme kartları**: "Levrek fileto" (kg, KDV hariç birim maliyet 400 TL, alerjen: balık), "Zeytinyağı" (L), "Roka" (kg). | Malzeme kartı stok kartının temelidir; elde stok varken birim maliyet elle değişmez (hareketli ortalama yazar). Birim ailesi reçetede kullanılırken değişemez. | Mutfak → Malzeme kartları; Stok → Mevcut. |
| 2 | Mutfak → **Reçeteler** → "Izgara Levrek": satırlar malzeme + miktar + fire %; porsiyon; istasyon SICAK; restoran ürününe bağla. | Reçete maliyeti satır × birim maliyet (fire payı brüt): ≈ 133 + 3 + 12 = ~148 TL. Kâr marjı tabloda. | Mutfak → Reçeteler (maliyet, kâr marjı, "yalnız menü ürünleri"). |
| 3 | Müdür, Restoran → **Menü ve tanımlar**: grup "Ana yemekler", ürün "Izgara Levrek" 450 TL, vergi kategorisi FNB, istasyon SICAK, satış noktası "Ana restoran". | Ürün silinmez; satılmış ürün pasife alınır. Adisyon kalemi gönderildiği anki ad / fiyat / vergiyi kopyalar. | Terminalde ürün listesi. |
| 4 | Stok → **Depolar**: "Ana restoran → Mutfak ana depo" eşlemesi (satış noktası → depo). | Eşleme yoksa satış düşümü **varsayılan depodan** yapılır. Depo yoksa / pasifse iş manuel göreve düşer. | Stok → Depolar. |

### B2. Adisyon → mutfak → ödeme

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 5 | Garson Mehmet vardiya açar (Restoran → Vardiyalar → **Vardiya aç**, avans 500 TL). | Bir garsona tek açık vardiya. Vardiya yoksa adisyon açılamaz. | Vardiya çubuğu. |
| 6 | Masa planı → Masa 7 (2 kişi) → sepete 2 × Izgara Levrek + 1 su, not "az pişmiş" → **Gönder**. | Adisyon `ADS-2026-000412`, **sipariş turu 1** `NEW`. `fnb.order.placed` yayınlanır (nokta, masa, garson, kalemler, istasyon, not). Çift dokunuş / ağ tekrarı ikinci tur açmaz (istek kimliği). Mutfak fişi yazdırılabilir (bilgi fişi; mali ÖKC entegrasyonu yok). | Restoran → **Mutfak ekranı** (`/pos/mutfak-ekrani`): kart "Masa 7 · 2 Izgara Levrek · az pişmiş". |
| 7 | Mutfak tableti (istasyon süzgeci SICAK) karta **Başla**. 10 dk'da kart sarı, 20 dk'da kırmızı olur. | Tur `PREPARING`; `fnb.order.status_changed`. İki tablet aynı karta basarsa ikincisi "bayat" alır. | Adisyon ekranında turun mutfak rozeti "hazırlanıyor". |
| 8 | Aşçı **Hazır**. | Tur `READY`; Mehmet'in **ziline** "Masa 7 hazır" (adisyon başına tek uyarı). | Mehmet'in zili; adisyon ekranında "Servis edildi" düğmesi. |
| 9 | Mehmet servis eder, adisyonda **Servis edildi**. Misafir hesap ister. | Tur `SERVED`. | Masa planı: masa "hesap istiyor". |
| 10 | Adisyon ekranı → **Ödeme** → nakit 960 TL (hızlı nakit 1.000, para üstü 40). | Ödeme Mehmet'in vardiya kasasına yazılır; adisyon kapanır. `fnb.order.paid` yayınlanır (ürün başına satılan / ikram / zayi adet). `pos.payment.changed` → **muhasebe aktörü** "Restoran × nakit × TRY" eşlemesiyle **Restoran kasası**na 960 TL. Büyük tahsilat eşik üstüyse `POS_PAYMENT` onayı. | Restoran → Vardiyalar → Mehmet (beklenen nakit); Kasa → Günlük kasa "Restoran" kaynağı; Ön muhasebe → Kasa / banka. |

İkram / iptal / indirim: şef garson yetkisi + gerekçe; politikadaki eşiğe eşit ya da üstüyse `POS_ADJUSTMENT` dört göz onayı. Onay bekleyen düzeltme varken ödeme alınmaz.

### B3. Stok düşümü ve minimum altı

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 11 | — | **Stok aktörü** (inventory-worker) `fnb.order.paid`'i alır: 2 × Izgara Levrek → reçete → brüt ihtiyaç 2 × 333 g = **0,666 kg levrek**, 40 ml zeytinyağı, 300 g roka. Hareketler `SALE` türünde, menü ürünü kimliğiyle, o anki ortalama maliyetle (**çıkış ortalamayı değiştirmez**). Sistem ürünleri (tepsi ücreti) ve reçetesiz ürün (su) atlanır. Adisyon yeniden açılıp kapanırsa son yayın esas: fark düzeltme hareketi. | Stok → **Hareketler** (tür SALE, kaynak adisyon bağlantısı). |
| 12 | — | Levrek mevcudu 5,4 kg → 4,734 kg: **minimumun (5 kg) altına** düştü. Aktör `stock.changed`'i dinler → **tek satın alma talebi** açar (kaynak `STOCK`, ihtiyaç bugün + 2 gün, miktar öneri hesabıyla: yoldaki ve açık talepler düşülür) + **zil** satın alma yetkilisine. Açık talep "talep edilen"e sayıldığı için aynı malzeme yeniden önerilmez. | Satın alma → **Talepler** (kaynak "Stok"); zil. |
| 13 | **Yalnız satış düşümü eksiye inebilir** (adisyon gerçek, kayıt geride kalmış; sayım düzeltir). Elle çıkış / fire / transfer mevcuttan fazla çıkamaz. | | Stok → Mevcut (kırmızı eksi). |

### B4. Satın alma: talep → teklif → sipariş → mal kabul

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 14 | Satın almacı Satın alma → Talepler → "Levrek fileto 10 kg (Stok)" talebini görür; **Açık satırlar** sekmesinde levreği ve o hafta biriken diğer malzemeleri işaretler → **Teklif turu aç**. | Tur `TKT-2026-0031`; açık satırlar malzeme başına birleşir. Ekran gördüğü toplamı gönderir, sunucu talepleri kilitleyip yeniden toplar — tutmazsa "satırlar değişti". | Satın alma → **Teklif turları**. |
| 15 | Turda üç tedarikçiye **teklif girer**: Deniz Balıkçılık 440 TL/kg termin 1 gün; Ege Su Ürünleri 420 TL/kg termin 4 gün (ihtiyaç 2 gün sonra — **geç**); Marmara Gıda 455 TL/kg termin 1 gün. KDV %1. | Turda tedarikçi başına tek teklif; her kayıt turun sürümünü ilerletir. | **Karşılaştırma matrisi** (tedarikçi × fiyat × termin): en uygun yeşil, geç teklif uyarılı. |
| 16 | **Kazanan seç**: sistem satır bazında en uygunu önerir — ihtiyaca yetişen → fiyat → termin → önce girilen. Ege ucuz ama geç, **önerilmez**; Deniz Balıkçılık kazanır. En uygun dışını seçmek gerekçe ister. | Tedarikçi başına ayrı **sipariş** `SAS-2026-0102` (10 kg × 440 = 4.400 + KDV %1 = 4.444 TL). Tutar politikadaki eşiğin (ör. 25.000 TL) altında → onaya gitmez; üstü olsaydı `PURCHASE_ORDER` dört göz onayına giderdi (3 gün karar yoksa reddedilmiş sayılır; red satırları tura döndürür). | Satın alma → **Siparişler** (PDF). |
| 17 | Mal gelir. Sipariş ekranı → **Mal kabul**: depo "Mutfak ana depo", irsaliye no, gelen 10 kg (tartılan malzemede +%5 tolerans), eksik varsa "eksik kapat". | `MKB-2026-0098`. **Stok girer:** depo satırı, toplam mevcut 14,734 kg; **hareketli ortalama** güncellenir: (4,734 × 400 + 10 × 440) / 14,734 ≈ **427,15 TL/kg**. Hareket kaydı (hareket sonrası mevcut ve ortalama). `purchase.goods.received` yayınlanır. | Stok → Mevcut (levrek 14,734 kg, ortalama 427,15); Stok → Hareketler (RECEIPT). |
| 18 | — | **Muhasebe aktörü** `purchase.goods.received` → **Deniz Balıkçılık carisine KDV dahil 4.444 TL borcumuz**, vade = kabul günü + tedarikçi vadesi (ör. 30 gün). | Ön muhasebe → Cariler → Deniz Balıkçılık (A) 4.444; Yaşlandırma → "vadesi gelmemiş". |
| 19 | 30 gün sonra muhasebeci cari kartından **Ödeme fişi** → banka hesabı 4.444 TL (ya da çek). Eşik üstüyse `Ödeme fişi` dört göz onayı. | Cari borç kapanır; banka çıkışı. | Cari ekstresi; Kasa / banka hareketleri. |

### B5. Maliyet raporu

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 20 | Ay sonu muhasebe Stok → **Maliyet raporu** → dönem Mart, görünüm **Malzeme**: levrek — giriş 10 kg / 4.400 TL, satış düşümü 9,2 kg, fire 0,3 kg, sayım farkı −0,15 kg; tüketim = satış + çıkış + fire; bugünkü mevcut ve değer. | Rapor hareketlerden; depo süzgecinde deponun mevcudu × kartın ortalaması. Aralık en fazla 366 gün. | Stok → Maliyet raporu. |
| 21 | Görünüm **Ürün**: Izgara Levrek — satılan 48 adet, ciro 21.600 TL (liste fiyatı, iptal / ikram düşülmüş), ürün maliyeti (SALE hareketlerinden) ≈ 7.100 TL → brüt kâr 14.500, **yemek maliyeti %32,9**. | Ciro KDV dahil liste fiyatıyla (bilinçli sınır). Eşikler reçete modülünün eşikleri. | Aynı ekran, Excel'e aktar. |

## Senaryo C — Bir günün kapanışı (night audit)

**Kahraman:** gece görevlisi Can, 14 Mart gecesi 23:45. Otelde 42 dolu oda, bugün gelecek 3 rezervasyon gelmedi, resepsiyon kasasında nakit tahsilat 18.400 TL beklenen.

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 1 | Can **Gün kapanış** → **Kapanış** (`/gun-kapanis`). Sihirbaz önizlemesi: gelmeyenler (3), içeride (42), beklenen kasa (yöntem × döviz). | `GET /night-audit/status`. Takvimden ileri gün kapatılamaz (`DAY_NOT_ARRIVED`); aynı gün iki kez kapatılamaz (`ALREADY_CLOSED`). | Sihirbaz adım 1. |
| 2 | **Başlat**. | `startNightAudit` günü **IN_PROGRESS** işaretler (iki görevli aynı anda kapatamaz); günü ilerletmez. `night.audit.started` yayınlanır → **folyo aktörü** tamamlanmış gecelerin oda ücretlerini **kapanış öncesi** basar. | Aktivite → Canlı akış. |
| 3 | **Adım 1 — Gelmeyenler:** 3 rezervasyonu gözden geçirir; biri telefonla "yarın geleceğim" demiş → tarihini değiştirir (sihirbaz dışında, rezervasyon ekranından); kalan 2'si gelmedi. | Kapanışta `markNoShowBatch`: 2 rezervasyon **NO_SHOW**; `reservation.no_show` → folyo aktörü **gelmedi ücreti** (ilk gece; politika gerekçeyle vazgeçilebilir) işler; kanal yöneticisi envanteri geri açar. | Rezervasyonlar → "Gelmedi"; folyo kalemi "Gelmedi ücreti". |
| 4 | **Adım 2 — Oda ücretleri:** 42 odanın gece ücreti listesi; eksik / fark varsa görünür. | `runRoomCharges(night, allowCurrent)`: her içerideki konaklamanın eksik geceleri `night:<konaklama>:<gün>` anahtarıyla işlenir; fiyatı sonradan değişen gece için fark kalemi; ikram (iptal edilmiş) geceye dokunulmaz. 100'lük parçalar, yarıda kalan kaldığı yerden sürer. | Folyolar → "Oda ücretlerini işle" şeridi; folyo kalemleri. |
| 5 | **Adım 3 — Kasa sayımı:** yöntem × döviz başına beklenen (sistem) ve **sayılan** (Can çekmeceyi sayar): nakit TRY beklenen 18.400, sayılan 18.350; EUR nakit beklenen 200, sayılan 200. Devir notu yazar. | Beklenen `getCashSummary` (işlenmiş ödeme − iade ± iptal; **onay bekleyen ödemeler** para çekmecede ama defterde değil — ayrıca raporlanır). Kişi bazında çekmece sahibi `receivedBy`. | Sihirbaz adım 3. |
| 6 | **Adım 4 — Fark:** −50 TL nakit farkı görünür; Can açıklama yazar. | Fark `ShiftReport`'a yazılır; gün kapanışı farkı engellemez, raporlar. | Vardiya devir raporu. |
| 7 | **Adım 5 — Kapat.** | `closeDay` **tek işlemde**: gelmeyenler → oda ücretleri → `DailyStats` (doluluk, oda geliri, ADR, RevPAR, tahsilat — gelir raporuyla aynı tanımlar: satılabilir = oda − arızalı) → `ShiftReport` → `NightAudit` **CLOSED**. `night.audit.closed` yayınlanır. Commit sonrası **iş günü 15 Mart** olur (her ekran `getBusinessDate`'ten okur). | Gün kapanış → **Geçmiş** (`/gun-kapanis/gecmis`): 14 Mart satırı, **devir raporu PDF**. Panel (`/`) 15 Mart'ı gösterir. |
| 8 | — | İş günü ilerleyince: oda ücreti zamanlayıcısı yeni gece için `folio.room_charges.due` hazırlar; kat hizmetleri sabah zamanlayıcısı (10 dk'da bir, idempotent) konaklayan odalara **STAYOVER** görevi üretir; kasa günü 15 Mart'tan başlar; bütçe gerçekleşeni kapanmış günleri sayar. | Kat hizmetleri → Görevler; Kasa → Günlük kasa (gün seçimi). |
| 9 | Sabah müdür Panel'de 14 Mart özetini görür: doluluk %70, ADR 2.850, RevPAR 1.995, tahsilat. | `DailyStats` panel ve gelir raporlarının kaynağıdır; forecast 30 günlük tahmini bundan ve rezervasyon defterinden kurar. | Panel; Raporlar → Gelir raporları. |

**Kapanış yapılmazsa ne olur?** İş günü ilerlemez: 15 Mart sabahı sistem hâlâ "14 Mart" der, oda ücretleri işlenmez, gelecekler listesi kaymaz, kasa günü uzar. Sistem bunu bilerek yapar — gün kapatılmadan rapor kesinleşmez. Gün kapanışı geç yapılsa bile **fatura tarihi etkilenmez** (takvim günü).

## Senaryo D — Bir OTA rezervasyonu geldiğinde

**Kahraman:** Booking.com üzerinden John Smith, 20–23 Nisan, Standart oda, OTA tutarı 9.600 TL (3 gece). Otel Channex.io üzerinden bağlı (Booking, Expedia, Airbnb… Channex'e, biz Channex'e).

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 1 | (Bir kez) Müdür Kanallar → **Yeni kanal** → Channex: mülk kimliği, API anahtarı (şifreli saklanır), webhook sırrı; **Eşleştirme**: bizim "Standart" ↔ Channex "Standard Double", fiyat planı ↔ pansiyon "Oda-kahvaltı"; fiyat farkı %, kaç gün ileri; **Senkrona al**. | Tam eşitleme (500 gün, iki çağrı): müsaitlik oda tipine, fiyat + stop-sale fiyat planına. Sonra her envanter / fiyat olayı kanalı **kirli** işaretler; 5 sn'lik iş yalnız **farkı** gönderir (kanal başına en sık 10 sn'de bir). | Kanallar → kanal kartı → Senkron logu (görev kimlikleri). |
| 2 | — | Booking'de John rezervasyon yapar. Channex revizyon akışına düşer; sistem **dakikada bir** okur, webhook gelince **hemen**. Revizyon **önce saklanır, sonra teyit edilir** (kart bilgisi saklanmaz). | Kanallar → kanal kartı → **Rezervasyonlar** (gelen kutusu). |
| 3 | — | **Kanal aktörü** (channel-sync-worker) işler: oda başına **onaylı** rezervasyon açılır; fiyat **OTA'nın tutarı** (elle fiyat, gerekçe "kanal"); pansiyon fiyat planı eşlemesinden; misafir kartı "John Smith" (uyruk bilinmiyorsa İngilizce bildirim); not: kanal, kod, ödeme kimde. `reservation.created`. | Rezervasyonlar → Liste: kaynak "Booking.com", kanal rozeti ve kodu. |
| 4 | — | **Yer yoksa reddedilmez:** kapasite aşılarak açılır, resepsiyona **kritik "overbooking" uyarısı** düşer (uyarı türü `CHANNEL_BOOKING`). | Zil; Oda planı'nda kırmızı. |
| 5 | — | **Oda aktörü** uygun Standart odayı atar (ör. 118). Bildirim aktörü onay bildirimi hazırlar (e-posta geçidi gerçek gönderici değil; SMS kurulu ise gider). Kanal yöneticisi müsaitliği 1 eksik olarak Channex'e geri gönderir (kendi kaydımız olduğu için döngü olmaz). | Rezervasyon detayı. |
| 6 | John Booking'den tarihi 21–23'e çeker. | Yeni revizyon → aktör bekleyen / onaylı rezervasyonu **günceller**; oda sayısı azalırsa fazla oda iptal edilir. Eski revizyon yenisinin üstüne yazılmaz. | Rezervasyon geçmişi: "kanal: değişiklik". |
| 7 | John iptal eder. | **Cezasız iptal** (iptal eden "kanal: Booking.com"); envanter geri açılır, kanala fark gönderilir. | Rezervasyon "İptal". |
| 8 | Yapılamayan adım: eşleşmeyen fiyat planı, misafir zaten içeride, geçmiş giriş tarihi, para birimi farklı. | Kayıt **"elle işlenmeli"** olur; resepsiyona **"Kanal rezervasyonu"** modüllü manuel görev düşer. Para birimi farkı ve iCal tutarı **"doğrulanmalı"**. Müdür gereğini yapıp kaydı notla kapatır. | Görevler; Kanallar → Rezervasyonlar (dikkat sayısı). |
| 9 | Hata: Channex 429 (hız sınırı) ya da anahtar hatası. | Pencere geri işaretlenir; 429'da 1 dk, anahtar hatasında 30 dk, geçici hatada 30 sn × 2ⁿ (en çok 15 dk) beklenir; 3 art arda hatada müdüre uyarı (`CHANNEL_SYNC`). Kanalın reddettiği satırlar loga "kısmen". | Senkron logu (ayrıntı penceresi); zil. |
| 10 | Kanal aktörü **kapalıysa**. | Gönderim tetikleyicileri görev açmadan atlanır (açılınca tam eşitleme); **gelen rezervasyon göreve düşer** (kaybolmaz). | Aktörler; Görevler. |

**iCal alternatifi (Airbnb):** dışa aktarma adresi `/channel-ical/<belirteç>.ics` (satılamayan günler "dolu"); içe aktarma 15 dk'da bir — iCal'deki dolu günler **onaylı rezervasyon** olarak açılır ("Airbnb misafiri HM…", fiyat geçici sistem fiyatı, kayıt "doğrulanmalı"); takvimden kalkan, henüz gelinmemiş kayıt iptal edilir; takvim birden boş gelirse toplu iptal yapılmaz, uyarı düşer.

## Senaryo E — Bir arıza bildirildiğinde

**Kahraman:** oda 204'te klima bozuk. İki giriş yolu: misafir WhatsApp'tan yazar ya da kat görevlisi "Sorun var" der.

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 1a | Misafir WhatsApp'tan "Klima çalışmıyor, oda çok sıcak" yazar. | Webhook → `guest.message.received` → router-agent niyeti **şikâyet / personel isteği** olarak işaretler → **modelsiz personele devredilir** (zil `AI_HANDOFF`, konuşmaya iç not). Konuşma oda 204'ün konaklamasına telefonla bağlanır. | Mesajlar (cevap bekleyen); zil. |
| 1b | Resepsiyon konuşmadan **tek tıkla istek** açar: kategori **Teknik (MAINTENANCE)**, öncelik yüksek (hedef 30 dk). | `guest.request.created`. | İstekler (geri sayım). |
| 2a | **Alternatif:** kat görevlisi Zeynep telefonundan Kat hizmetleri → görev 204 → **Sorun var** ("klima soğutmuyor"). | `housekeeping.issue.reported` → dinleyici **doğrudan arıza bileti** açar (görev başına tek açık bilet, idempotent). | Teknik servis → Arızalar. |
| 2 | Resepsiyon Teknik servis → **Yeni arıza**: oda 204, "Klima soğutmuyor", kategori klima, öncelik yüksek, fotoğraf, **"Odayı kapat"** işaretli, tür **Arızalı (OUT_OF_ORDER)**, bitiş 2 gün. | `createTicket({ closeRoom })` önce `blockRoom` çağırır. **Oda dolu → 409:** ekran "misafiri başka odaya taşıyın" der, bilet açılmaz. | Yeni arıza formu. |
| 3 | Resepsiyon Oda planı'nda Ayşe'yi 204'ten **206**'ya sürükler (oda değişikliği). | `changeRoom`: aynı işlemde 204 Boş + Kirli, 206 Dolu; oda geçmişi (`RoomStaySegment`) "o gece hangi odadaydı"yı doğru tutar; oda servisi QR bağlantısı eskisi için geçersiz olur, portal yenisini verir. | Oda planı; Konaklayanlar (206). |
| 4 | Yeniden **Yeni arıza** → 204, odayı kapat → kaydet. | Bilet açılır, `RoomBlock` (Arızalı, 2 gün) bağlanır; **204 envanterden düşer** (satılabilir oda −1; hizmet dışı türü düşürmezdi). Rezervasyonu olan odaya blok açılamaz (`HAS_RESERVATIONS`); overbooking yaratacaksa `WOULD_OVERBOOK`. Kanal yöneticisi Channex'e müsaitliği 1 eksik gönderir. `maintenance.ticket.created`. İsteğe bağlı bilet isteği **İşlemde** yapar. | Teknik servis → Arızalar; Odalar → Oda listesi (arıza rozeti); Kanallar → Senkron logu. |
| 5 | Teknik şef bileti teknisyen **Ali'ye atar**. | `maintenance.ticket.assigned`; Ali'nin ziline `MAINTENANCE` uyarısı (bağlantı bilete). | Teknik servis → **Bana atananlar** (Ali). |
| 6 | Ali telefonundan **Başla**, kompresörü değiştirir, fotoğraf ekler, **Çözüldü** (not: "kompresör değişti"). | `maintenance.ticket.resolved`. `removeBlock`: süren kayıt **bugün biter**, oda **Kirli**'ye düşer → `room.unblocked ENDED` → **kat hizmetleri aktörü** `DEEP_CLEAN` görevi açar. 204 envantere döner → kanala müsaitlik +1. İstek **Tamamlandı**; misafire konuşmadan bilgi yazılır. Kapanmış bilet fotoğrafları günlük işle silinir. | Kat hizmetleri → görev "Derin temizlik 204"; İstekler → tamamlandı; Mesajlar. |
| 7 | **Periyodik bakım:** Teknik servis → **Planlama**: "Klima filtre kontrolü — aylık, kontrol listesi". | 6 saatte bir çalışan iş, süresi gelen planlardan **bilet üretir** (plan başına tek açık bilet). | Teknik servis → Arızalar (kaynak "plan"). |

## Senaryo F — Fiyat önerisi onaylandığında

**Kahraman:** 28–30 Nisan hafta sonu, Deluxe tipinde doluluk %84'e çıktı. Yield kuralı: doluluk ≥ %80 → +%10; ≤ %30 ve ≤ 7 gün kala → −%15 (Ayarlar → Dinamik fiyat).

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 1 | (Bir kez) Müdür Ayarlar → **Dinamik fiyat**: eşikler, yüzdeler, ufuk. | Parametreler otel ayarında saklanır. **Hiçbir fiyat kendiliğinden değişmez** — kural işi de AI ajanı da yalnız öneri üretir. | Ayarlar → Dinamik fiyat. |
| 2 | — | **Kural işi** 6 saatte bir koşar: otel başına tek envanter görüntüsü + geçen yılın aynı haftanın günü (364 gün önce). 28, 29, 30 Nisan Deluxe için `evaluateDay` → +%10; **ardışık aynı çarpanlı günler tek öneriye** birleşir (onay kuyruğu gün × tip ile boğulmasın). Çakışan bekleyen öneri ya da "zaten uygulanmış" dönem atlanır (idempotent). | Fiyat önerileri (`/fiyat-onerileri`). |
| 3 | — | Öneri **onay kuyruğuna** düşer (tür `Toplu fiyat değişikliği`), gerekçe + **yapılandırılmış girdiler** (gün gün doluluk, satılabilir, satılan, kalan gün, geçen yıl). Onay yetkilisine zil. | Onaylar → Bekleyen; üst barda sayaç. |
| 4 | — | **AI fiyat ajanı** (pricing-agent) sunucuda `OPENAI_API_KEY` varsa günlük `pricing.review.requested` ile uyanır; yalnız eşiklere yakın günleri (≤ 120 satır) okur, katı JSON çıktısı satır satır doğrulanır — bilinmeyen tip, pencere dışı tarih, emniyet dışı yüzde, bekleyen dönemle çakışma **yalnız o satırı** düşürür. Öneriler kural işiyle **aynı kapıdan** girer. Anahtar yoksa ajan kayıt olmaz; **kural tabanlı yield yine çalışır**. | Aktörler → pricing-agent (kurulu değilse sebebiyle). |
| 5 | Gelir yöneticisi Fiyat önerileri → kaydı açar: Deluxe 28–30 Nisan, mevcut 3.000 → önerilen 3.300, gerekçe, girdi tablosu. İsterse **Düzenle** (çarpan 1,08 → 3.240). **Onayla**. | Karar olayı (`approval.granted`) fiyat dinleyicisine gider: **gece hassasiyetli çarpan** yazılır (tip × gece × 1,10; bir geceye tek ayar). Fiyat planına dokunulmaz; çarpan plan VE sezon fiyatını ölçekler, **acente kontratı, paket ve elle fiyat etkilenmez**. Emniyet aralığı 0,5–3. `rate.changed` yayınlanır. | Fiyat önerileri → Onaylandı; **fiyat geçmişi grafiği**. |
| 6 | — | **Kanal yöneticisi** `rate.changed` ile 28–30 Nisan penceresini kirli işaretler; Channex'e Deluxe fiyat planına 3.300 (+ kanal farkı %) gider. Web widget ve personel teklifi aynı çarpanı gösterir: misafir sitede ne görüyorsa kanal onu satar. | Kanallar → Senkron logu (fiyat satırları). |
| 7 | Resepsiyon 28–30 Nisan Deluxe için yeni rezervasyon açar: önizleme **3.300 / gece**. Acente kontratıyla açılan rezervasyon kontrat fiyatında kalır. | Satış yolu etkin çarpanları 5 dk önbellekle okur; ayar olayı önbelleği düşürür. | Rezervasyonlar → Yeni rezervasyon (fiyat önizlemesi). |
| 8 | Öneri **reddedilirse** ya da süresi dolarsa. | Sıfır yazım; bir sonraki kural turunda koşullar sürüyorsa yeni öneri (reddedilen dönem için bekleyen yok). | Onaylar → Geçmiş. |

## Senaryo G — Aktör kapalıyken ne olur (manuel görev akışı)

**Kahraman:** yönetici Burak, folyo aktöründe şüphelendiği bir davranış için aktörü bir saat kapatıyor. Bu arada misafir Mehmet Kaya oda 310'a giriş yapıyor.

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 1 | Burak **Aktörler** (`/aktorler`) → "Folyo aktörü" → **Kapat**. Ekran "ne durur"u listeler (folyo açma, oda ücreti, restoran / minibar kalemi, teminat, çıkışta kapanış, fatura taslağı) ve **gerekçe** ister. | Ayar satırı kilitlenir, denetim izine ve aktivite akışına yazılır, `actor.setting.changed`. İki yönetici aynı anda "kapat" derse sonuç kapalı, ikinci iz bırakmaz. Aktör **her olayda ayarı veritabanından okur**: bir sonraki olayda durur. | Aktörler listesi: "kapalı — Burak, 14:05, gerekçe". |
| 2 | Resepsiyon Mehmet Kaya'ya check-in yapar (500 TL nakit teminat). | `guest.checked_in` yayınlanır. Oda aktörü (açık) 310'u dolu yapar. **Folyo aktörü kapalı:** iş kaybolmaz, **"Folyo" modüllü manuel görev** açılır: "Misafir girişi: folyo açılacak, teminat işlenecek". Görev olayın zincirini ve rezervasyon bağlantısını taşır. | **Görevler** (`/gorevler`) — folyo yetkisi olanlara; menüde rozet; zil. |
| 3 | Resepsiyon Görevler → görevi **Üstlen** → bağlantıdan folyo ekranına gider → **Folyoyu aç**, ödemeler → **Teminatı işle** (500 TL nakit). | Aynı servis, **aynı tekrar işleme anahtarı** (konaklama + giriş anı): aktör sonradan açılıp olayı yeniden alsa da teminat ikinci kez yazılmaz. | Folyolar → Mehmet Kaya. |
| 4 | Görevi **Tamamla** (not). | Görev kapanır (kapanmış görev yeniden açılmaz; iki kişi aynı görevi aynı anda tamamlayamaz — ikincisi 409). "Gerek kalmadı" seçeneği gerekçe ister. | Görevler → Kapananlar. |
| 5 | Aynı saat içinde restoran 310'a "odaya yaz" yapar; muhasebe aktörü açık. | `fnb.order.charged` → **"Folyo" görevi**: "Restoran adisyonu folyoya yazılacak". Muhasebe aktörü kendi işini yapar (restoran ödemesi kasaya). Bu arada **onaylanmış bir iş** (ör. daha önce onaya gönderilmiş folyo kalemi iptali) aktör kapalı olsa da uygulanır — onay bir kez verilmiştir. | Görevler. |
| 6 | Burak aktörü **Aç**. | Açılış denetim izine yazılır. Aktör yeni olayları işler. **Eski olaylar kendiliğinden yeniden işlenmez** — açık görevler personelin elindedir; personel folyo ekranından yapar ve kapatır. (Bazı aktörlerde fark vardır: kanal yöneticisi açılınca tam eşitleme yapar; muhasebe için Ayarlar → **Eşitle** dönemi tarar.) | Aktörler. |
| 7 | **Kıyaslama — AI ajanları kapalı:** Burak concierge-agent'ı kapatır. | AI misafire cevap vermez; **yeni konuşmalar personelde açılır** (her mesaj ayrı göreve düşmez). AI ayar ekranı uyarı gösterir. | Mesajlar (cevap bekleyen); Ayarlar → AI asistanı. |
| 8 | **Kıyaslama — bütçe / anahtar yok:** `OPENAI_API_KEY` tanımlı değil. | Ajanlar hiç kayıt olmaz; panelde "kurulu değil, sebebi" görünür; rapor asistanı "cevaplanamadı" + **"Rapor talebi" görevi**; bütçe yorumu "yazılamadı"; fiyat ajanı yok ama kural tabanlı yield çalışır. | Aktörler; Raporlar → Rapor asistanı uyarısı. |

**Manuel görev kuralları (özet):** görev işin modülüne yetkili olana görünür (oda atama → oda işlemleri yetkisi, mesaj → mesaj yazma, muhasebe → ön muhasebe); üstlen / bırak / tamamla / gerek kalmadı; satır kilidi; görev açılınca olay gövdesi **maskesiz** gelir (işi yapan misafirin iletişimine ihtiyaç duyar). Aktörün **iş kuralı hatası** (ör. "eşleme yok", "cari seçilmemiş") beklemeden göreve düşer; **geçici hata** (ağ) 3 kez 400 ms arayla denenir.

## Senaryo H — Bir etkinlik (banket) satışı

**Kahraman:** Yılmaz Holding, 120 kişilik bayi toplantısı, 12 Mayıs 09:00–17:00, "Boğaz Salonu" (bölünebilir: A + B), U düzeni, projeksiyon + ses, öğle yemeği set menü. Kişi başı menü 850 TL, salon kirası tam gün 25.000 TL.

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 1 | Satış, Etkinlikler → **Yeni dosya** → müşteri ara ("Yılmaz Holding" yoksa yeni müşteri: ünvan, vergi no, yetkili). | Dosya `ETK-2026-0045`, durum **Talep**. Etkinlik müşterisinin **carisi** ilk kayıtta açılır (ön muhasebe). | Etkinlikler → dosya listesi; Ön muhasebe → Cariler (etkinlik müşterisi). |
| 2 | **Program** → oturum ekle: 12 Mayıs 09:00–17:00, Boğaz Salonu (bütün), U düzeni, 120 kişi. Uygunluk önizlemesi: salon boş, kurulum / söküm süresi dahil; kira önerisi "tam gün 25.000 en ucuz". | Oturum salonun **atomik parçaları** (A ve B) için tutma oluşturur. Başka dosya aynı saatte tutuyorsa "2. opsiyon olursunuz" uyarısı. | Etkinlikler → **Salon takvimi** (salon × gün; kesin / 1. opsiyon / sırada renkleri). |
| 3 | **Fiyat kalemleri:** salon kirası 25.000 (vergi DİĞER %20), projeksiyon + ses 4.000, öğle yemeği menü kalemi (Senaryo H6'da menüden gelir). | Tutarlar folyonun vergi motoruyla kuruş hassasiyetli. | Dosya → Fiyat kalemleri. |
| 4 | **Opsiyona al.** | Durum **Opsiyon**, sıralı: aynı saatte önce tutan **1. opsiyon**. Opsiyon süresi politikadan (ör. 7 gün); 15 dk'lık iş süresi dolanı düşürür, sırası yükselenin sorumlusuna zil. | Takvimde sarı. |
| 5 | **Belgeler → Teklif üret** → `TKL-2026-0019` PDF (sunucuda üretilir), müşteriye gönderilir. Müşteri kabul eder → **Kabul**. | Belge anlık görüntü + PDF; sürüm "TKL-2026-0019/2" olabilir. Teklif geçerliliği politikadan. | Dosya → Belgeler. |
| 6 | **Sözleşme üret** `SZL-…`, müşteri imzalar → **İmzalandı** işaretle. **Kesinleştir.** | Kesinleştirme salonu + parçalarını kilitler, kapasite / düzen / pasiflik / imzalı sözleşme şartı kilit altında denetlenir; **kesin tutmalar farklı etkinlikler arasında çakışamaz** (veritabanı kısıtı). Durum **Kesin**; 2. opsiyondaki dosyanın sorumlusuna "salon gitti" zili. Ödeme planı: depozito %30 = ~10.000 TL, kalan etkinlik günü. | Takvimde yeşil; ödeme planı taksitleri. |
| 7 | **Menü (banket F&B):** dosya → Menü → katalogdan "Set menü — Toplantı A" kopyalanır, 120 kişi, servis 12:30; mutfağa kesinleşme. | `EventMenu` kopyadır — katalog sonradan değişse dosya bozulmaz. Reçetelerden **malzeme ihtiyacı** (kişi × porsiyon, ara reçeteler, fire payı, fazla üretim % politikadan). Kişi başı menü kalemi 120 × 850 = 102.000 TL fiyat kalemine düşer. **Mutfak üretim planı** (gün / saat, hazırlık süresi). | Dosya → Menü; Mutfak → üretim planı. |
| 8 | Malzeme ihtiyaç listesi → **Satın alma talebine çevir**. | `PurchaseRequest` `STR-2026-0210` (kaynak banket) → Senaryo B4 zinciri (tur → teklif → sipariş → mal kabul). | Satın alma → Talepler (kaynak "Banket"). |
| 9 | Müşteri depozitoyu havaleyle yatırır. Dosya → **Ödemeler → Tahsilat**: havale 10.000 TL, dekont no. | Kasada **"Etkinlik"** kaynağı. Eşik üstüyse `EVENT_PAYMENT` dört göz. `banquet.payment.changed RECEIVED` → **muhasebe aktörü**: eşlemedeki banka hesabına 10.000 giriş **ve müşteri carisinden düşer** (cari −10.000 → henüz bedel yazılmadığı için (A) görünür). | Kasa → Günlük kasa "Etkinlik"; Ön muhasebe → cari ekstresi. |
| 10 | 12 Mayıs: etkinlik yapılır; gerçekleşen 115 kişi (garanti 120). Satış dosyayı **Gerçekleşti** yapar. | Faturalanacak kişi = en çok (garanti, gerçekleşen) = 120. `banquet.event.changed COMPLETED` → **muhasebe aktörü** müşteri carisine **bedeli borç yazar** (fark kaydıyla: toplam 131.000 TL; depozito düşülmüş bakiye 121.000 (B)). Dosya **"faturaya hazır"**; gecikmiş taksit günde bir zil. | Cari kartı: (B) 121.000, vade; Faturalar → Faturalanacaklar (kaynak etkinlik). |
| 11 | Muhasebe Faturalar → Faturalanacaklar → etkinliği **Taslak aç** → alıcı Yılmaz Holding (şirket; vergi no karttan) → **Kes**. | Mükellef sorgusu: Yılmaz Holding e-Fatura kullanıcısı → **e-Fatura**, posta kutusu etiketi; `DMF2026000000412`. `invoice.issued` → muhasebe aktörü **numarayı cari harekete yazar** (ikinci alacak yok). | Kesilenler (GİB durumu); cari ekstresinde satırda fatura no. |
| 12 | Kalan 121.000 TL havale gelir → Ön muhasebe → cari kartı → **Tahsilat fişi** (ya da dosya → Ödemeler → Tahsilat; ikisi de cariyi kapatır — birini kullanın). | Cari sıfırlanır. | Cari ekstresi; Yaşlandırma'dan düşer. |
| 13 | **İptal varyantı:** müşteri 5 gün kala iptal eder → dosya **İptal**; iptal kademesi (politika: "en az N gün kala %X") iptal bedeli üretir. | `banquet.event.changed CANCELLED` → cari bedel **iptal bedeline** düzeltme farkıyla eşitlenir; alınmış depozito bedelden fazlaysa fazlası onaylı **iade**. Bedelli proforma; iptal bedeli faturası taslağı satırlarıyla açılır. | Dosya; cari; Faturalar. |

## Senaryo I — Bir misafir şikâyeti (WhatsApp → AI → personel → istek → anket)

**Kahraman:** oda 512'deki Elif Aydın, 22:40'ta WhatsApp'tan yazar: "Odamız temizlenmemiş, havlular eksik, çok memnun değilim."

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 1 | Elif WhatsApp'tan yazar. | Meta webhook `/webhooks/whatsapp/<kanal>` imzası doğrulanır; tekrar gelen mesaj tek kayıt. `receiveInboundMessage`: misafir **telefondan** bulunur (+90… biçimi; ülke kodsuz numara otelin koduyla okunur), **içerideki konaklamaya** (512) bağlanır; konuşma AI modunda açılır (concierge kayıtlıysa). `guest.message.received`. | Mesajlar → konuşma listesi (kanal ikonu WhatsApp, oda 512). |
| 2 | — | **Router ajanı** (küçük model) niyeti **şikâyet** olarak etiketler. Kural: şikâyet ve personel isteği **modelsiz devredilir** — concierge cevap üretmez. Konuşma **personele** geçer; misafire kısa bilgi ("ekibimiz hemen ilgilenecek", dili bilinmiyorsa tahmin); konuşmaya **iç not** (sebep: şikâyet); zile `AI_HANDOFF`. 5 dk'dan uzun cevapsız AI konuşmasını süpürücü iş de personele geçirir. | Mesajlar → "cevap bekleyen" görünümü, niyet etiketi "şikâyet"; yan menü rozeti kırmızı (SLA). |
| 3 | Gece resepsiyoncusu Deniz konuşmayı açar, Elif'e yazar: "Çok üzgünüz, 10 dakika içinde havlu ve temizlik ekibi odanızda." | Personel yazınca konuşma zaten MANUAL; mesaj `guest.message.reply` → WhatsApp geçidi gönderir, teslim durumu SENT → DELIVERED → READ mesaja işlenir. 24 saat penceresi kapalıysa "gönderilemedi" + sebep. | Konuşma balonları (teslim tiki). |
| 4 | Deniz mesajdan **tek tıkla istek** açar: kategori **Kat hizmetleri**, öncelik **acil** (hedef 15 dk), not "havlu + oda toparlama, 512". | `guest.request.created` (kategori HOUSEKEEPING) → kat hizmetleri modülü **GUEST_REQUEST görevi** açar ve isteğe bağlar (temizlik göreviyle aynı anda olabilir). Geri sayım başlar. | İstekler (`/istekler`, akan geri sayım); Kat hizmetleri → görev listesi. |
| 5 | Gece kat görevlisi telefonunda görevi görür → **Başladım** → havluları götürür → **Bitti**. | `housekeeping.task.completed` → görev bitince **istek Tamamlandı** (`changeRequestStatus`); hedef süre içinde kapandı. Başlatılmış işi geri almak süreyi sıfırlamaz (gecikme gizlenemez). | İstekler → tamamlandı (süre); konuşmada sistem notu. |
| 6 | Deniz misafire "Havlularınız teslim edildi, iyi geceler" yazar; tercih kaydı: Misafirler → Elif → **Tercihler**: "ekstra havlu" (kaynak personel), not "22.04 şikâyet, çözüldü". | `guest.preference.updated`, `guest.note.added`. Sonraki rezervasyon formunda misafir kartı önizlemesinde tercih görünür. | Misafirler → Elif Aydın kartı. |
| 7 | Elif ertesi gün çıkış yapar. | `guest.checked_out` + 1 gün (`postStayDelayDays`), `postStaySendHour` saatinde **anket daveti** (e-posta / SMS şablonu `SURVEY_POST_STAY`, imzalı bağlantı `/misafir/a/…`, dört dil). Davet bir kanala satır açılınca "gitti" sayılır. | Bildirimler → Gönderim geçmişi; Anketler. |
| 8 | Elif anketi doldurur: NPS **5**, temizlik puanı **2**, yorum "İlk gece havlu yoktu ama hızlı çözdüler." | Davet başına tek cevap. NPS ≤ 6 ya da bir puan ≤ 2 → cevapla aynı işlemde **takip kaydı** + zil `SURVEY_LOW_SCORE`; hedef çıkmış misafirde **48 saat**. **İçgörü ajanı** (AI açıksa) yoruma ton + en fazla 5 konu + tek cümle etiketi yazar (model ad, onay kodu, iletişim görmez). Anket bitince puandan bağımsız Google / TripAdvisor bağlantısı. | Anketler → **Cevaplar**; **Takip** (açık, 48 saat); zil. |
| 9 | Misafir ilişkileri takip kaydını **üstlenir**, Elif'i arar, not yazar (değişmez), sonuç "telafi: bir sonraki konaklamada ücretsiz kahvaltı" ile **kapatır**. | Takip kapanışı sonuç + açıklama ister (veritabanı kısıtı). İşlem kaydına yorum metni yazılmaz. | Anketler → Takip → kapanmış. |
| 10 | Ay sonu müdür Anketler → **Rapor**: NPS eğilimi, bölüm puanları ("temizlik" düşük), AI konu dökümü ("havlu" teması 6 yorumda), takip özeti. | Rapor indekslerden (1 yıl ~0,2 sn). Dönem özeti AI isteği `surveys.setup` yetkisiyle. | Anketler → Rapor. |

## Senaryo J — Ay sonu stok sayımı ve maliyet raporu

**Kahraman:** Mutfak ana depo, 30 Nisan akşamı. Depo sorumlusu Hakan ve aşçı Selin birlikte sayıyor. Depoda 86 malzeme.

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 1 | Hakan Stok → **Sayım** → **Yeni sayım** → depo "Mutfak ana depo". | Sayım `SYM-2026-0004`; depoda **tek açık sayım** olabilir. Açılışta deponun **sıfır olmayan mevcutları ve o anki birim maliyeti dondurulur** ("beklenen"). | Stok → Sayım listesi. |
| 2 | İki tablet aynı sayımı açar; Hakan kuru gıdaları, Selin soğuk odayı sayar; her satıra **sayılan** girer, ara ara **Kaydet**. Levrek beklenen 14,734 kg, sayılan **14,2 kg**. | Satır yazımı sayımın **sürüm damgasıyla**: ikisi aynı anda kaydederse ikincisi "başkası değiştirdi" alır ve güncel listeyi görür (`STALE_WRITE`) — veri ezilmez. | Sayım ekranı: satır başına beklenen / şu anki / sayılan / fark + değer. |
| 3 | Listede olmayan bir malzeme bulunur (bağış gelen zeytinyağı) → **Malzeme ekle** (beklenen = o anki depo mevcudu = 0). | Satır eklenir. | Aynı ekran. |
| 4 | Sayım sürerken restoran akşam servisi devam eder: 4 levrek daha satılır (−1,33 kg). | Satış düşümü depoya yazılır; sayımdaki "beklenen" **değişmez**, "şu anki mevcut" değişir. | Satır: şu anki 13,4 kg. |
| 5 | Hakan servis bittikten sonra son kez satırları gözden geçirir, levreği yeniden sayar (12,9 kg bulur, düzeltir) ve **Onayla** der (`stock.manage`). | **Onayda fark = sayılan − onay anındaki depo mevcudu** (açılıştaki "beklenen" değil — sayım sürerken satış devam etti): 12,9 − 13,4 = **−0,5 kg**. Bu yüzden onaydan önce son satışların ardından yeniden saymak önemlidir; servisten önce sayılıp onayda düzeltilmeyen satır yanlış fark üretir. Sıfır olmayan fark `COUNT_ADJUST` hareketi (o anki ortalama maliyetle değerlenir, ortalamayı değiştirmez; sayım eksiye de inebilir). Sayılmayan satıra dokunulmaz. `stock.changed COUNT`. | Stok → Hareketler (COUNT_ADJUST −0,5 kg ≈ −213,58 TL, kaynak sayım bağlantısı); Stok → Mevcut güncel. |
| 6 | — | **Stok aktörü** `stock.changed COUNT`'u alır → `suggestPurchases`: sayımla minimumun altına inen malzemeler için **STOCK talebi** + zil. | Satın alma → Talepler. |
| 7 | **İptal varyantı:** sayım yanlış depoda açıldı → **İptal** (sebep). | Hiçbir hareket yazılmaz. | Sayım listesi (iptal). |
| 8 | Muhasebe Stok → **Maliyet raporu**, Nisan, depo süzgeci "Mutfak ana depo", görünüm **Malzeme**: her malzemede giriş / satış düşümü / çıkış / fire / **sayım farkı** / transfer (depo süzgecinde net) miktar + tutar; tüketim = satış + çıkış + fire; bugünkü mevcut ve değer (deponun mevcudu × kartın ortalaması). | Hareketlerden toplanır. | Maliyet raporu → Excel'e aktar. |
| 9 | Görünüm **Ürün**: satılan adet, ciro, ürün maliyeti, brüt kâr, **yemek maliyeti %**; eşik üstü ürünler işaretli. Şef marjı düşük ürünlerin reçetesini gözden geçirir. | Ciro adisyon kalemlerinin kapanış iş gününe göre; maliyet `SALE` hareketlerinden. | Maliyet raporu; Mutfak → Reçeteler (kâr marjı). |
| 10 | Bütçe → **Gerçekleşen**: Nisan "Yiyecek maliyeti" gider kalemine raporun tüketim tutarı elle girilir. | Gider gerçekleşeni bu sürümde elle (satın alma / ön muhasebeden otomatik beslenme yol haritasında). Bütçe → **Sapma**: plan / gerçek / fark; AI yorumu istenebilir. | Bütçe → Sapma. |

**Fire ve transfer:** Stok → Hareketler → **Hareket gir**: tür çipleri **çıkış / fire / transfer**; fire sebebi zorunlu; transferde hedef depo (kaynakta eksi, hedefte artı, kart toplamı sabit). Formun istek kimliği çift gönderimde ikinci hareket yazmaz. Elle hareket mevcuttan fazla çıkamaz (`INSUFFICIENT_STOCK`).

## Senaryoların ortak dersleri

1. **Her para hareketi tek kez yazılır.** Folyo kalemi, ödeme, stok hareketi, muhasebe kaydı — hepsinin bir **kaynak anahtarı** vardır; aynı olay iki kez gelse, aktör kapanıp açılsa, personel aynı işi elle yapsa ikinci kayıt oluşmaz.
2. **Silme yok, ters kayıt var.** Folyo kalemi, ödeme, fiş, fatura, adisyon ödemesi silinmez; iptal ters tutarlı kayıttır ve iptal günü tarihlidir. Geçmiş rapor geriye dönük değişmez.
3. **Riskli iş dört göz ister.** Kalem iptali, iade, büyük ödeme, fatura iptali, eşik üstü ödeme fişi, bordro, sipariş, fiyat değişikliği, acente primi, kapasite aşımı: isteyen onaylayamaz.
4. **Aktör kapalıysa iş personele düşer.** Görevler ekranı boş değilse birisi bir şeyi elle yapmalı demektir; aktörü açmak eski görevleri kendiliğinden kapatmaz.
5. **Sürüm damgası veriyi korur.** İki kişi aynı kaydı değiştirirse ikincisi "başkası değiştirdi, yenileyin" görür. Hata değil, güvenlik.
6. **İş günü ≠ takvim günü.** Oda ücreti, kasa ve raporlar iş gününe; fatura tarihi ve anket saati takvime bağlıdır.
7. **Dürüst sınırlar:** e-posta geçidi gerçek gönderici değil (SMS kurulabilir), e-belge gerçek entegratöre bağlı değil, genel muhasebe yok, online kart ödemesi yok, KBS bildirimi yok. Bunlar yol haritasındadır ve ekranlar bunu söyler; sahte "gönderildi" yazan hiçbir şey yoktur.
