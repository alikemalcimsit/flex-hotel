# Uçtan uca senaryolar

Önceki bölümler ekranları tek tek anlattı. Bu bölüm aynı ekranları **bir hikâyenin içinde** gösterir: gerçek bir misafir, gerçek bir yemek, gerçek bir gün kapanışı. Her senaryo adım adım ilerler ve her adımda üç şeye bakar:

- **Ekranda ne yapılır:** personelin (ya da misafirin) tıkladığı şey.
- **Arka planda ne olur:** hangi olay yayınlanır, hangi aktör ne yapar, hangi kayıt yazılır.
- **Nerede görünür:** sonucun izini hangi ekranda bulursunuz.

Senaryolardaki isimler, oda numaraları ve tutarlar örnektir; otelinizin vergileri ve fiyatları farklıdır. Örnek otel: 60 odalı şehir oteli, para birimi TRY, KDV %10 oda ve yiyecek-içecek, konaklama vergisi %2 oda, KDV %20 minibar / çamaşır / spa / diğer (demo otelin düzeni).

Okumaya başlamadan iki hatırlatma:

- **Aktör** arka planda kendi kendine çalışan işçidir; kapatılsa işi "Görevler" ekranına düşer, kaybolmaz.
- **İş günü** otelin "bugün"üdür ve gün kapanışı yapılmadan değişmez. Oda ücretleri, kasa günü ve raporlar iş gününe göre işler; faturanın tarihi ise takvim günüdür.

## Senaryo haritası

| Senaryo | Kim okusun | Dokunduğu ekranlar | Devreye giren aktörler |
| --- | --- | --- | --- |
| A — Bir misafirin yolculuğu | Resepsiyon, yönetici | Widget, Rezervasyonlar, Online check-in, Gelecekler / Gidecekler, Folyolar, Kasa, Minibar, Restoran, Gün kapanış, Faturalar, Ön muhasebe, Anketler | Oda, folyo, muhasebe, bildirim, kat hizmetleri, kanal aktörleri |
| B — Bir yemeğin yolculuğu | F&B, satın alma, muhasebe | Mutfak (reçete), Menü ve tanımlar, Masa planı, Adisyon, Mutfak ekranı, Vardiyalar, Stok, Satın alma, Maliyet raporu | Stok (inventory) ve muhasebe aktörleri |
| C — Bir günün kapanışı | Gece görevlisi, müdür | Gün kapanış sihirbazı, Folyolar, Kasa, Panel | Folyo aktörü (ön basım); kapanış servisi |
| D — OTA rezervasyonu | Resepsiyon, gelir yöneticisi | Kanallar, Rezervasyonlar, Oda planı, Görevler | Kanal, oda, bildirim aktörleri |
| E — Arıza | Resepsiyon, teknik, kat | Mesajlar, İstekler, Teknik servis, Oda planı, Kat hizmetleri | Kat hizmetleri aktörü, kanal aktörü (envanter) |
| F — Fiyat önerisi | Gelir yöneticisi, müdür | Ayarlar → Dinamik fiyat, Fiyat önerileri, Onaylar, Kanallar | Kural işi, AI fiyat ajanı, kanal aktörü |
| G — Aktör kapalıyken | Yönetici | Aktörler, Görevler, Folyolar | Hepsi (kapalı hâli) |
| H — Banket satışı | Satış, muhasebe, mutfak | Etkinlikler, Salon takvimi, Mutfak, Satın alma, Kasa, Faturalar, Ön muhasebe | Muhasebe aktörü |
| I — Misafir şikâyeti | Resepsiyon, kat, misafir ilişkileri | Mesajlar, İstekler, Kat hizmetleri, Misafirler, Anketler | Router ve concierge ajanları, kat hizmetleri aktörü, içgörü ajanı |
| J — Stok sayımı ve maliyet | Depo, F&B, muhasebe | Stok → Sayım, Hareketler, Maliyet raporu, Bütçe | Stok aktörü |
| K — Acente grubu toplu giriş | Resepsiyon şefi, muhasebe | Acenteler (kontrat, kota), Yeni rezervasyon (grup, rooming list), Gruplar, Folyolar, Faturalar, Ön muhasebe, Acente primleri | Oda, folyo, muhasebe, kanal aktörleri |
| L — Bordro onayı ve ödemesi | İK, müdür, muhasebe | Bordro (puantaj, servis payı, bordro ekranı, ayarlar), Personel, Onaylar, Ön muhasebe, Demirbaş | Muhasebe aktörü |
| M — Ay sonu mizan ve dönem kapanışı | Muhasebe, müdür | Genel muhasebe (Ayarlar → Eşitle, Mizan, hesap ekstresi, Yevmiye, Kurallar, Dönem kilidi), Görevler | Muhasebe aktörü (yevmiye ve günlük gelir fişleri) |
| N — Yanlış kasa çıkışı fişinin düzeltilmesi | Muhasebe | Ön muhasebe (Kasa / banka → Çıkış, Fişler), Genel muhasebe (Yevmiye, fiş iptali, Fiş gir, Hesap planı) | Muhasebe aktörü |

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

### Ters giderse (Senaryo A)

| Durum | Ne olur | Ne yapılır |
| --- | --- | --- |
| Widget'ta yer yok | Rezervasyon açılmaz, misafire sebepli ret ("bu tarihlerde uygun oda kalmadı"); onaya gitmez | Misafir başka tarih dener; resepsiyon isterse Bekleme listesi'ne alır |
| Aynı anda son odaya iki istek | Envanter kilidi: biri açılır, diğeri `NO_AVAILABILITY` | Normal; ikinci misafire alternatif önerilir |
| Ayşe gelmedi | Gün kapanışında rezervasyon **Gelmedi** olur; folyo aktörü **gelmedi ücreti** (ilk gece 3.000) yazar; personel gerekçeyle vazgeçebilir (denetim izinde politika tutarı kalır) | Gün kapanış → adım 1; Rezervasyonlar → Gelmedi |
| Ayşe 2 gün önce iptal etti | İptal politikası ("X gün öncesine kadar ücretsiz") içindeyse ücretsiz; dışındaysa toplam × ceza oranı; folyo aktörü **iptal ücreti** kalemi; envanter geri açılır, kanala fark gider | Rezervasyon → İptal (gerekçe) |
| Online check-in'de belge fotoğrafı okunmuyor | Resepsiyon **Düzeltme iste** (sebep misafire kendi dilinde görünür); misafir yeniden yükler, kayıt yeniden incelemeye düşer | Ön büro → Online check-in |
| Oda 204 giriş sabahı arızalı çıktı | Giriş engellenir ("oda arızalı"); oda aktörü atamayı kaldırmış olabilir | Oda planı'nda başka Deluxe'e sürükle; sonra Check-in |
| Folyo aktörü kapalıyken giriş | `guest.checked_in` **"Folyo" görevine** düşer: "folyo açılacak, teminat işlenecek" | Görevler → üstlen → folyo ekranından yap → tamamla (aynı anahtar, çift kayıt yok) |
| Minibar fişi yanlış odaya yazıldı | Fiş silinmez / değişmez; düzeltme **folyodaki kalemin iptali** (dört göz) ve doğru odaya yeni fiş | Folyo → kalem → İptal iste; onaylar |
| Çıkıştaki 6.170 TL kart ödemesi otelin **büyük ödeme eşiğini** aşıyor | Satır "onay bekliyor"; **bakiyeye ve kasaya girmez**; çıkış yapılamaz (onay bekleyen ödemeli folyo kapanmaz) | Onaylar → Bekleyen → başka yetkili onaylar → çıkış tamamlanır. Reddedilirse ödeme hiç işlenmez, yeniden alınır |
| Ödeme yanlış tutarla girildi | **Ödeme iptali** (ters kayıt, onaylı); iade değil — para zaten alınmamışsa iptal, misafire geri verildiyse **iade** | Folyo → ödeme satırı → İptal iste |
| Çıkıştan 1 saat sonra "unuttuğumuz bir minibar" | Çıkmış misafirin **açık** folyosu varsa geç kalem; folyo kapandıysa folyo yetkilisine görev (fatura kesildiyse önce iptal) | Görevler; gerekirse yeni serbest fatura |
| Çıkış yanlışlıkla yapıldı | **Aynı gün** geri alınabilir; oda bu arada başka misafire verildiyse alınamaz; faturası kesilmiş folyo yeniden açılmaz (önce fatura iptali) | Konaklayanlar / Gidecekler → Çıkışı geri al |
| Fatura e-Arşiv "reddedildi" | Alıcı bilgisi hatalı; zil fatura yetkilisine | Düzelt → Tekrar gönder; ya da İptal iste → Yeni taslak |
| Anket gitmedi | Kanal + şablon ya da portal adresi yok → tur başlamaz; misafir "bildirim istemiyor" → satır gönderilmedi | Anketler → Ayarlar; Bildirimler → Kanallar |

## Senaryo B — Bir yemeğin yolculuğu

**Hikâye:** Otelin restoranında en çok satan ana yemek "Izgara Levrek". Menüde 450 TL (KDV %10 dahil). Şef Selin reçetesini şöyle kurmuş: 1 porsiyon = 300 g levrek fileto (temizleme firesi %10 → depodan 333 g çıkar), 20 ml zeytinyağı, 150 g roka. Levrek "Mutfak ana depo"da tutuluyor; minimum seviye 5 kg; tedarikçi Deniz Balıkçılık, vade 30 gün. Bu senaryo bir tabağın menüden depoya, depodan satın almaya ve ay sonu maliyet raporuna kadar bütün izini takip eder: garson Mehmet'in gönderdiği sipariş mutfak ekranına düşer, ödeme kasaya, satış reçete üzerinden stoğa, stok minimumun altına inince satın alma talebine, talep teklif turuna, sipariş mal kabule, mal kabul tedarikçi carisine ve nihayet rapora dönüşür. Aradaki bütün hesaplar (hareketli ortalama, KDV, yemek maliyeti yüzdesi) sayılarla gösterilir.

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

### Ters giderse (Senaryo B)

| Durum | Ne olur | Ne yapılır |
| --- | --- | --- |
| Mehmet'in açık vardiyası yok | Adisyon açılamaz ("vardiyasız işlem yok") | Restoran → Vardiyalar → Vardiya aç (avansla) |
| İki garson aynı masaya çift dokundu | İstek kimliği: ikinci dokunuş ikinci adisyon / tur açmaz | Hiçbir şey |
| Mutfak levrek bitti dedi | Ürün **"tükendi"** işaretlenir (Menü ve tanımlar / terminal); misafire alternatif; kalem **iptal + zayi** (şef garson gerekçe; eşik üstü dört göz) | Adisyon → kalem → iptal |
| Misafir "yemek kötüydü" — ikram | Şef garson yetkisi + gerekçe; politikadaki eşiğe eşit / üstüyse `POS_ADJUSTMENT` onayı; onay bekleyen düzeltme varken ödeme alınmaz | Adisyon → ikram; Onaylar |
| Nakit yerine yanlışlıkla kart girildi | Ödeme **iptal isteği** (`POS_PAYMENT` dört göz) → ters kayıt → doğru yöntemle yeniden; iptal kaydı parayı alanın kasasına | Adisyon → ödeme → İptal iste |
| Adisyon kapandı, sonra bir kalem daha istendi | **Yeniden aç** (aynı iş günü, vardiya açık, odaya yazılmamış); yeniden kapanınca `fnb.order.paid` yeniden yayınlanır, stok aktörü **son yayını esas alır** (fark düzeltmesi) | Adisyonlar → yeniden aç |
| Stok aktörü kapalı | Satış düşümü **"Stok" manuel görevine** düşer (adisyon numarasıyla); öneri sessizce atlanır | Görevler → Stok → Hareket gir (çıkış) ile tamamla |
| Satış noktasının deposu yok / pasif | `NO_WAREHOUSE` / `WAREHOUSE_INACTIVE` → manuel görev | Stok → Depolar → eşleme |
| Levrek eksiye düştü (−0,4 kg) | Yalnız satış düşümü eksiye iner; mal kabul girilmemiş ya da reçete hatalı | Mal kabulü gir; sayım düzeltir |
| Ucuz ama geç teklif seçmek istiyorum | En uygun dışı seçim **gerekçe** ister; süresi dolmuş teklif / pasif tedarikçi hiç seçilmez | Karşılaştırma → seç → gerekçe |
| Sipariş 25.000 TL eşiğini aştı | `PURCHASE_ORDER` onayı; isteyen onaylayamaz; **3 gün** karar yoksa reddedilmiş sayılır, satırlar tura döner | Onaylar → Bekleyen |
| Mal 11 kg geldi (sipariş 10) | Tartılan malzemede +%5 tolerans (10,5 kg); fazlası reddedilir | Gelen miktarı 10,5 ile kabul, kalanı irsaliyede not / iade |
| Mal 8 kg geldi, kalan gelmeyecek | **Eksik kapat**; talep durumu satırlardan türer | Sipariş ekranı → Eksik kapat |
| Muhasebe aktörü kapalı | "Mal kabul tedarikçi carisine işlenecek" görevi | Ön muhasebe → Ayarlar → Eşitle → görevi tamamla |
| Tedarikçi çeki karşılıksız döndü | Çek "karşılıksız"; cariye borcumuz geri doğar | Çek / senet → satır → Karşılıksız |

## Senaryo C — Bir günün kapanışı (night audit)

**Hikâye:** 14 Mart gecesi 23:45. Gece görevlisi Can resepsiyonda tek başına. Otelde 42 dolu oda var; bugün gelmesi gereken 3 rezervasyon henüz gelmedi; resepsiyon kasasında sistemin beklediği nakit 18.400 TL, bir de 200 EUR. Can'ın işi günü **kapatmak**: gelmeyenleri düşmek, 42 odanın gece ücretini bastırmak, kasayı saymak, farkı açıklamak ve iş gününü 15 Mart'a ilerletmek. Bu kapanış yapılmadan sistemde "bugün" değişmez; bu yüzden gece kapanışı bir formalite değil, günün muhasebesinin kesinleşmesidir. Aşağıda beş adımlı sihirbazın her adımında arkada ne döndüğü anlatılır.

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

### Ters giderse (Senaryo C)

| Durum | Ne olur | Ne yapılır |
| --- | --- | --- |
| Başka görevli kapanışı başlatmış | Gün **IN_PROGRESS**; ikinci kişi başlatamaz | Tek kişi sürdürür; yarım kalan kapanış aynı sihirbazdan devam eder |
| "Gün gelmedi" (`DAY_NOT_ARRIVED`) | Takvimden ileri gün kapatılamaz (otel saatine göre gece yarısı geçmemiş) | Bekleyin |
| "Zaten kapatıldı" (`ALREADY_CLOSED`) | Aynı gün iki kez kapatılamaz | Gün kapanış → Geçmiş'ten raporu alın |
| İki gün kapanış yapılmadı | İş günü 14 Mart'ta kaldı; oda ücretleri kuyrukta, gelecekler listesi kaymadı | **Sırayla** 14'ü, sonra 15'i kapatın; her kapanış kendi gecesini işler |
| Kasa farkı −50 TL | Kapanış engellenmez; fark ve not devir raporuna yazılır | Açıklama yazın; müdür raporu görür |
| Onay bekleyen 12.000 TL kart ödemesi var | Para çekmecede değil, defterde de değil; "onay bekleyenler" ayrı listelenir | Onaylar'dan karar çıkınca onay günü kasa günüdür |
| Gelmeyen misafir "yoldayım" dedi | Sihirbazda gelmedi işaretlemeyin; rezervasyonu gece girişine bırakın (giriş günü gelmiş misafir ertesi gün de girebilir) | Rezervasyon → tarih / not |
| Sunucu kapanışın ortasında kapandı | Kapanış **tek işlemdir**: ya hep ya hiç; yeniden başlatınca sihirbaz kaldığı yerden | Yeniden Kapat |
| Folyo aktörü kapalı | Kapanış oda ücretlerini **kendisi** basar (servis çağrısı), aktöre bağlı değil; yalnız gece öncesi ön basım atlanır | Hiçbir şey; kapanış sonrası eksik gece varsa Folyolar → "Oda ücretlerini işle" |
| Kur girilmedi, dövizli ödeme reddediliyor | Kur iş gününe kadar girilmiş en son kur, **3 günden eski olamaz** | Kasa → Döviz kurları → günün kuru (kapanışta da girilebilir) |
| Devir raporu PDF açılmıyor | `night_audit.view` izni gerekir | Rol matrisi |

## Senaryo D — Bir OTA rezervasyonu geldiğinde

**Hikâye:** Otel geçen ay Channex.io üzerinden Booking.com'a bağlandı (Booking, Expedia, Airbnb ve Agoda Channex'e bağlanır; biz yalnız Channex'e bağlanırız — Booking'e doğrudan bağlantı ayrı sertifika isterdi). Londra'dan John Smith, Booking'de 20–23 Nisan için bir Standart oda alıyor; Booking'in gösterdiği tutar 3 gece 9.600 TL. Bu senaryo rezervasyonun Booking'den sisteme nasıl düştüğünü, oda atamasını, müsaitliğin Booking'e geri nasıl yansıdığını, John'un tarih değiştirmesini ve iptalini anlatır; sonunda iCal (Airbnb) yolunun farkı özetlenir.

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

### Ters giderse (Senaryo D)

| Durum | Ne olur | Ne yapılır |
| --- | --- | --- |
| 20–23 Nisan'da Standart kalmamış | Rezervasyon **yine açılır** (OTA rezervasyonu reddedilmez), kapasite aşılır, resepsiyona **kritik overbooking** uyarısı | Misafiri üst tipe planlayın ya da başka otelde yer bulun; Booking'de kapatmayı (stop-sale) kontrol edin |
| Webhook gelmedi (Meta / Channex kesintisi) | Revizyon akışı **dakikada bir** okunur; webhook yalnız hızlandırır | Beklemek yeterli |
| Fiyat planı eşlenmemiş | Kayıt **"elle işlenmeli"**; "Kanal rezervasyonu" görevi | Kanal kartı → Eşleştirme → planı eşle; rezervasyonu elle açıp kaydı notla kapat |
| John zaten içeride, Booking tarihi değiştirdi | İçerideki misafirde değişiklik otomatik uygulanmaz → "elle işlenmeli" | Rezervasyon ekranından çıkışı uzat / kısalt |
| Booking tutarı EUR, otel TRY | Kayıt **"doğrulanmalı"**; rezervasyon açılır, fiyat kontrol ister | Rezervasyon → fiyatı gerekçeyle düzelt; kaydı kapat |
| Channex 429 (hız sınırı) | 1 dk bekleme, pencere geri işaretlenir; kayıp yok | Hiçbir şey |
| API anahtarı değişti | Anahtar hatasında 30 dk bekleme + müdüre uyarı; 3 art arda hata → uyarı | Kanal kartı → Ayarlar → yeni anahtar → bağlantı yeniden doğrulanır |
| Kanal aktörü kapalı | Gönderim atlanır (açılınca **tam eşitleme**); gelen rezervasyon **göreve düşer** | Aktörler → aç; Görevler |
| Airbnb iCal takvimi birden boş geldi | Toplu iptal **yapılmaz**, uyarı düşer (takvim hatası olabilir) | Kanal kartı → logu inceleyin |
| Airbnb "Not available" kapatması | Rezervasyon açmaz (otelin kendi kapatması) | — |
| Kendi dışa aktardığımız iCal Booking'den geri yansıdı | UID sonekiyle tanınır, döngü olmaz | — |

## Senaryo E — Bir arıza bildirildiğinde

**Hikâye:** Nisan ortası, oda 204'te klima soğutmuyor. Aynı arıza iki ayrı kapıdan sisteme girebilir: içerideki misafir Ayşe Demir WhatsApp'tan "oda çok sıcak" yazabilir ya da sabah temizliğe giren kat görevlisi Zeynep telefonundan "Sorun var" diyebilir. Her iki yol da teknik servis biletine çıkar. Senaryo, odanın envanterden düşürülmesini (arızalı oda satılamaz), içerideki misafirin taşınmasını, teknisyen Ali'nin işi bitirmesini ve odanın temizlik yoluyla satışa dönmesini adım adım izler; sonunda periyodik bakım planının bu akışa nasıl bağlandığı gösterilir.

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

### Ters giderse (Senaryo E)

| Durum | Ne olur | Ne yapılır |
| --- | --- | --- |
| "Odayı kapat" işaretli, oda dolu | 409 — bilet açılmaz; ekran "misafiri taşıyın" der | Oda planı → sürükle → yeniden bilet |
| Odanın o tarihlerde rezervasyonu var | `HAS_RESERVATIONS` (örnek rezervasyonlarla) | Rezervasyonları başka odaya atayın ya da bloğu kısaltın |
| Blok overbooking yaratacak | `WOULD_OVERBOOK` — zaten eksi olan gün daha kötüleşemez | **Hizmet dışı (OUT_OF_SERVICE)** türü kullanın: envanterden düşmez, odaya misafir yerleştirilmez |
| Geçmiş tarihli blok | Açılamaz (iş günü) | Bugünden başlatın |
| Çakışan iki blok | `BLOCK_OVERLAP` | Mevcut kaydı uzatın |
| Bilet yanlış açıldı | **İptal** (`maintenance.manage`); başlamamış blok iptal olur, süren blok bugün biter | Teknik servis → bilet → İptal |
| Teknisyene zil gelmedi | Zil `MAINTENANCE` türü atananın kişisine gider; izin / susturma kontrolü | Zil tercihleri |
| Misafir isteği kapanmadı | Bilete bağlı istek bilet çözülünce **Tamamlandı** olur; bağ yoksa istek elle kapatılır | İstekler → tamamla |
| Kat hizmetleri aktörü kapalı | Blok bitince `DEEP_CLEAN` görevi açılmaz; manuel görev düşer | Görevler → kat şefi görevi elle açar |
| Plan işi bilet üretmedi | Planın `lastRunOn`'u iş gününe göre; plan başına tek açık bilet (öncekini kapatmadan yenisi açılmaz) | Önceki bileti çözün |

## Senaryo F — Fiyat önerisi onaylandığında

**Hikâye:** 28–30 Nisan bir uzun hafta sonu; Deluxe tipinde doluluk %84'e çıkmış. Gelir yöneticisi Deniz, Ayarlar → Dinamik fiyat'ta kuralları çoktan girmiş: doluluk ≥ %80 ise +%10, doluluk ≤ %30 ve 7 günden az kalmışsa −%15. Senaryo, sistemin bu kuraldan nasıl **öneri** ürettiğini (asla kendiliğinden fiyat değiştirmez), önerinin onay kuyruğuna düşmesini, Deniz'in onayını, onaylı çarpanın web sitesi / resepsiyon / OTA'ya aynı anda yansımasını ve acente kontratlarının neden etkilenmediğini anlatır. AI fiyat ajanının bu akışa nasıl eklendiği de gösterilir.

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

### Ters giderse (Senaryo F)

| Durum | Ne olur | Ne yapılır |
| --- | --- | --- |
| Öneri reddedildi | Sıfır yazım; sonraki turda koşul sürüyorsa yeni öneri | Onaylar → Geçmiş (not) |
| Öneri süresi doldu | `EXPIRED`; "yapılmadı" zili; fiyat değişmez | Yeni turu bekleyin ya da elle çarpan düzenleyip onaylayın |
| Çarpan 3,5 girildi | Emniyet aralığı 0,5–3: veritabanı kısıtı + sözleşme reddeder | 3 ve altı |
| AI ajanı yanlış tip / tarih önerdi | **Yalnız o satır** düşer; LLM hatası onay kuyruğuna taşmaz | Aktörler → pricing-agent → son işler |
| Aynı dönem için bekleyen öneri varken yeni tur | Çakışan dönem atlanır (kuyruk şişmez) | — |
| `OPENAI_API_KEY` yok | Ajan kayıt olmaz; **kural tabanlı yield çalışır**, kimse fiyatsız kalmaz | Aktörler'de sebep yazar |
| Kanal fiyatı güncellenmedi | `rate.changed` kanalı kirletti ama 429 / anahtar hatası bekletiyor | Kanallar → Senkron logu; Elle senkron |
| Acente rezervasyonu hâlâ 2.200 | Doğru: kontrat, paket ve elle fiyat **net**tir, çarpan onları ölçeklemez | — |
| Onaylı çarpanı geri almak | Yeni öneri (çarpan 1,0) düzenle + onayla; ya da süresi dolmasını bekle | Fiyat önerileri → Düzenle |

## Senaryo G — Aktör kapalıyken ne olur (manuel görev akışı)

**Hikâye:** Yönetici Burak, folyo aktörünün bir kalemi beklenmedik şekilde yazdığından şüpheleniyor ve incelemek için aktörü **bir saat kapatıyor**. Sistem durmaz: bu bir saat içinde misafir Mehmet Kaya oda 310'a giriş yapıyor, restoran 310'a odaya yaz yapıyor, bir ödeme alınıyor. Senaryo, kapalı aktörün işlerinin nasıl kaybolmadan personelin önüne düştüğünü, personelin aynı işi elle nasıl yaptığını (ve neden çift kayıt oluşmadığını), aktör yeniden açılınca ne olduğunu ve AI ajanlarının kapalı olmasının farkını anlatır. "Görevler" ekranı bu senaryonun ana sahnesidir.

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

### Ters giderse (Senaryo G)

| Durum | Ne olur | Ne yapılır |
| --- | --- | --- |
| İki kişi aynı görevi tamamladı | Satır kilidi: ikinci "tamamla" 409; kapanmış görev yeniden açılmaz | — |
| Görev artık gereksiz (misafir iptal etti) | **Gerek kalmadı** (gerekçe zorunlu) | Görevler → gerek kalmadı |
| Görevi göremiyorum | Görev işin modülünün iznine görünür (folyo → `folio.post`); izin yoksa listede yok | Rol matrisi |
| Aktörü açtım, görevler duruyor | Beklenen davranış: eski olaylar yeniden işlenmez; görevler personelin | Elle tamamlayın (muhasebe için Eşitle) |
| Aktör kayıttan kalkmış (paket yok) | Onaylanmış işi bekleyen aktör yoksa iş **"Onay kuyruğu"** modüllü göreve düşer | Görevler |
| Görev listesi 2500 odalı otelde yüzlerce | Liste imleçli, modül / aktör süzgeci; zil görevle bağlantılı | Süzgeç kullanın |
| Aktörü kim kapattı? | Satırda kim / ne zaman / gerekçe; denetim kaydında da | Aktörler; Aktivite → Denetim kaydı |

## Senaryo H — Bir etkinlik (banket) satışı

**Hikâye:** Yılmaz Holding'in satış müdürü arıyor: 12 Mayıs'ta 120 kişilik bayi toplantısı, 09:00–17:00, U düzeni, projeksiyon ve ses sistemi, öğle yemeği set menü. Otelin "Boğaz Salonu" bölünebilir (A + B parçaları); tam gün kirası 25.000 TL, kişi başı set menü 850 TL, teknik ekipman 4.000 TL. Satış sorumlusu Ece dosyayı açar. Senaryo, bir etkinliğin **talep → opsiyon → teklif → sözleşme → kesin → menü ve malzeme → depozito → gerçekleşme → fatura → tahsilat** zincirini; salon takviminin "sıralı opsiyon" mantığını; depozitonun ve bedelin müşteri carisine nasıl işlendiğini ve iptal durumunda iptal bedelinin nasıl hesaplandığını anlatır. Etkinliğin **kendi hesabı** vardır, folyo kullanılmaz.

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

### Ters giderse (Senaryo H)

| Durum | Ne olur | Ne yapılır |
| --- | --- | --- |
| Salon aynı saatte başka dosyada 1. opsiyonda | Ece'nin dosyası **2. opsiyon** olur; yalnız 1. kesinleşebilir; 1. düşerse / bırakılırsa Ece'ye zil | Bekleyin ya da başka salon / saat |
| Sözleşme imzalanmadan kesinleştir | Politika "imzalı sözleşme şart" ise reddedilir | Belgeler → sözleşme → İmzalandı |
| 120 kişi U düzeninde salon kapasitesini aşıyor | Kesinleştirme kilit altında kapasiteyi denetler, reddeder | Düzen / salon değiştir (A + B bütün) |
| Projeksiyon stoğu o gün başka etkinlikte | Ekipman tepe kullanımı aşılır → reddedilir | Ekipman ekle / kirala / başka kalem |
| Opsiyon süresi doldu | 15 dk'lık iş opsiyonu düşürür; sırası yükselenin sorumlusuna zil | Yeniden opsiyona al (yer varsa) |
| Depozito 10.000 yerine 100.000 girildi | Tutar eşiğin üstünde → `EVENT_PAYMENT` dört göz; hatalı giriş **iptal kaydı** (onaylı) | Onaylar; Ödemeler → İptal iste |
| Müşteri 5 gün kala iptal etti | İptal kademesi ("en az N gün kala %X"; politika 0 günü içerir) → iptal bedeli; cari bedel düzeltilir; depozito bedelden fazlaysa fazlası onaylı iade | Dosya → İptal → iptal bedeli faturası taslağı |
| Dosya "kaybedildi" (rakip otel) | Borçsuz; yazılmış bedel varsa geri alınır | Dosya → Kaybedildi |
| Gerçekleşen 115 kişi, fatura kaça? | **En çok (garanti 120, gerçekleşen 115) = 120** | — |
| Taksit gecikti | Günde bir zil (`BANQUET`) | Ödemeler → tahsilat |
| Muhasebe aktörü kapalı | "Etkinlik tahsilatı … işlenecek", "Etkinlik bedeli … işlenecek" görevleri | Eşitle |
| Fatura e-Fatura alıcısı posta kutusu yok | GİB reddi → "reddedildi" + zil | Alıcıyı düzelt → Tekrar gönder |

## Senaryo I — Bir misafir şikâyeti (WhatsApp → AI → personel → istek → anket)

**Hikâye:** Saat 22:40. Oda 512'deki Elif Aydın WhatsApp'tan yazıyor: "Odamız temizlenmemiş, havlular eksik, çok memnun değilim." Otelin AI concierge'i açık; ama bu bir **şikâyet** ve sistem şikâyeti modele bırakmaz, doğrudan personele devreder. Gece resepsiyoncusu Deniz konuşmayı alır, kat hizmetlerine acil istek açar, görevli havluları götürür, istek kapanır; Elif'in tercihi karta yazılır. İki gün sonra Elif çıkış yapar, anket gelir, düşük puan verir; sistem takip kaydı açar, misafir ilişkileri telafi teklif eder. Senaryo mesajdan ankete uzanan bu zincirin her halkasında hangi aktörün devreye girdiğini ve nelerin **bilerek** otomatik yapılmadığını gösterir.

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

### Ters giderse (Senaryo I)

| Durum | Ne olur | Ne yapılır |
| --- | --- | --- |
| Elif 24 saattir yazmamış, Deniz ilk yazan | WhatsApp 24 saat penceresi kapalı → "gönderilemedi" + sebep | Misafir yazınca pencere açılır; telefonla arayın |
| AI günlük bütçesi dolmuş | Konuşma zaten personelde (şikâyet); bütçe dolunca bütün AI konuşmaları personele geçer, yönetime `AI_BUDGET` zili | Ayarlar → AI asistanı → bütçe |
| Misafir telefonu kartta yok | Konuşma misafire bağlanamaz; personel ekranda oda seçip konaklamaya bağlar | Mesajlar → konuşma → bağla |
| İstek 15 dk'da kapanmadı | Gecikme zili isteğin sahibine, yoksa istek yönetenlere; rozet kırmızı; başlatılmış işi geri almak süreyi **sıfırlamaz** | İstekler → ata / tamamla |
| Kat görevlisi görevi görmedi | `GUEST_REQUEST` görevi kat hizmetleri panosunda; kat hizmetleri aktörü kapalıysa oda durumu güncellemesi göreve düşer, istek yine görev bitince kapanır | Kat hizmetleri → Görevler |
| Anket daveti gitmedi | Portal adresi / kanal / şablon eksik → tur başlamaz; misafir bildirim istemiyor → satır gönderilmedi; aynı misafire `minDaysBetweenSurveys` günden sık anket gitmez | Anketler → Ayarlar; Bildirimler → Kanallar |
| Elif anketi iki kez doldurmaya çalıştı | Davet başına **tek cevap** (tekil kısıt) | — |
| Takip 48 saatte kapanmadı | Hedef süre aşımı listede kırmızı | Anketler → Takip → üstlen / kapat |
| AI etiketi gelmedi | AI kapalı / anahtar yok → yorum "etiketlenemedi" (30 dk); rapor AI'sız eksiksiz | — |
| Düşük puan ara ankette (misafir hâlâ içeride) | Zil **kritik**, hedef **2 saat** | Hemen misafirle temas |

## Senaryo J — Ay sonu stok sayımı ve maliyet raporu

**Hikâye:** 30 Nisan akşamı, servis bitimine doğru. Depo sorumlusu Hakan ve aşçı Selin "Mutfak ana depo"yu sayacak; depoda 86 malzeme var, ikisi iki tabletle aynı sayımı paylaşacak. Restoran bu arada kapanmamış: sayım sürerken birkaç levrek daha satılacak. Senaryo, sayımın açılışta "beklenen"i nasıl dondurduğunu, iki sayımcının birbirinin kaydını nasıl ezmediğini, onayda farkın neden **onay anındaki** mevcuda göre hesaplandığını, farkın stoğa ve satın alma önerisine nasıl yansıdığını ve ay sonu maliyet raporunun (malzeme ve ürün görünümleri) nasıl okunduğunu anlatır; en sonda rakamın bütçeye nasıl taşındığı gösterilir.

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

### Ters giderse (Senaryo J)

| Durum | Ne olur | Ne yapılır |
| --- | --- | --- |
| Depoda açık sayım var | Yeni sayım açılmaz (depoda tek açık sayım) | Eskisini onayla ya da iptal et |
| Hakan ve Selin aynı satırı aynı anda yazdı | İkincisi "başkası değiştirdi" (`STALE_WRITE`) ve güncel listeyi görür | Yeniden gir |
| Sayım sürerken satış devam etti | Beklenen değişmez, "şu anki" değişir; **fark onay anına göre** | Onaydan hemen önce kritik satırları yeniden say |
| Yanlış depoda açıldı | **İptal** (sebep) — hiçbir hareket yazılmaz | Doğru depoda yeniden aç |
| Sayılmayan satır | Dokunulmaz (fark yazılmaz) | Eksik saymayın; sayılmayanı bilerek bırakın |
| Fark eksiye indiriyor | Sayım düzeltmesi eksiye inebilir (gerçek mevcut) | Normal |
| Stok aktörü kapalı | Öneri sessizce atlanır; satın alma → min. stok önerileri ekranı aynı hesabı gösterir | Elle talep aç |
| Fire sebebi boş | Sözleşme reddeder (fire sebebi zorunlu) | Sebep yaz |
| Transfer hedef depo pasif | Reddedilir | Depoyu aktifle |
| Rapor 400 günlük aralık | En fazla 366 gün | Aralığı daralt |

## Senaryo K — Acente grubunun rooming list ile toplu girişi

**Hikâye:** Mavi Tur acentesi 5–8 Haziran (3 gece) için 12 Standart oda, 24 kişi, oda-kahvaltı istiyor. Acentenin kontratında Standart × oda-kahvaltı × Haziran dönemi için **oda başı gecelik 2.200 TL** var; ayrıca acenteye Haziran ayı için 15 odalık **kota (allotment)**, release 7 gün tanımlı. Acente rooming list'i (misafir adları) Excel ile gönderiyor. Resepsiyon şefi Murat grubu açıyor, giriş günü 12 odayı toplu check-in yapıyor, çıkışta acente hesabını kapatıp acenteye tek fatura kesiyor. Senaryo kota, kontrat fiyatı, grup dosyası, toplu işlemler, acente carisi ve acente primi zincirini anlatır.

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 1 | (Önceden) Müdür Acenteler → Mavi Tur → **Kontrat**: Standart × oda-kahvaltı × 1–30 Haziran = 2.200 TL / oda / gece; komisyon %10; vade 30 gün. **Kota** sekmesi: Standart, 1–30 Haziran, 15 oda, release 7 gün. | Kota bir **garantidir, tavan değil**: acentenin kotası dolunca satış genel havuzdan sürer. Release tarihi = giriş gecesi − 7; o günden itibaren kullanılmamış kota genel havuza döner. Aynı acente + tipte çakışan dönem olamaz. Kota değişikliği kanal yöneticisine gider: **OTA'ya giden boş sayıdan tutulu kota düşülür** (kanal kotalı odayı satamaz). | Acenteler → Mavi Tur → Kontrat / Kota; **Kota kullanım tablosu** (gün gün verilen / kullanılan / kalan / release). |
| 2 | Murat, Rezervasyonlar → **Yeni rezervasyon** → **Grup** → acente Mavi Tur, 5–8 Haziran → **Rooming list** → şablonu indirir, acentenin gönderdiği dosyayı yükler (sütunlar: Ad, Soyad, Oda tipi kodu, Pansiyon, Yetişkin, Çocuk). | Excel **tarayıcıda** okunur; hatalı satırlar numarasıyla listelenir ("satır 7: oda tipi kodu tanınmadı"), geçerliler grup satırlarına dolar. Rooming list **ortak tarihli**dir (grubun giriş / çıkışı). Satır misafiri **kendi kartına** açılır (ad soyad yeter; iletişim grup sorumlusunda); isim çakışması bütün grubu düşürmez. | Grup formu: 12 satır, her satırda misafir adı. |
| 3 | Fiyat önizlemesi: 12 oda × 3 gece × **2.200** = 79.200 TL (kontrat). Kaydet. | Envanter kilidi altında müsaitlik: satan acentenin **kendi kotası düşülmez**, diğer acentelerin kullanılmamış kotası düşülür. Kontratta fiyatı olmayan gece reddedilir; stop-sale elle fiyatla da aşılmaz. Grup `ReservationGroup` (ad, kod); 12 rezervasyon onaylı, kaynak acente. Kota kullanımı **türetilir**: acentenin o geceyi kapsayan geçerli rezervasyonları kotaya mahsup edilir (iptal kota hakkını kendiliğinden geri açar). `reservation.created` × 12 → oda aktörü 12 Standart oda atar. | **Gruplar** (`/gruplar`) → Mavi Tur 5–8 Haziran: 12 rezervasyon, odalar, durum dağılımı. Kota tablosu: 5–7 Haziran kullanılan 12 / kalan 3. |
| 4 | Giriş günü 5 Haziran 14:00: otobüs gelir. Murat Gruplar → dosya → tümünü seç → **Toplu oda atama** (gerekirse) → **Toplu check-in**. | `check-in-batch` (en fazla 50): kimlik ve refakatçiler **misafir kartından okunur**. **Kimlik politikası:** sahibinin kimlik belgesi zorunludur; rooming list yalnız ad taşıdığı için kimliği kartta olmayan satır **atlanır** ("kimlik eksik") ve sonuç listesinde sebebiyle görünür. Odasız, erken giriş ücreti isteyen kayıtlar da atlanır — bunlar tek tek alınır. | Grup dosyası: sonuç listesi (girildi / atlandı + sebep). |
| 5 | Murat atlanan 12 kaydı tek tek açar: misafir kimliğini girer (otobüste toplanan kimlik fotokopileri), **Check-in**. Pratik yol: acenteden kimlik bilgilerini önceden alıp **Misafirler** ekranından kartlara işlemek ya da misafirlere portal daveti gönderip online check-in yaptırmak (iletişim bilgisi olan misafirde). | Her giriş `guest.checked_in` → oda aktörü dolu; **folyo aktörü 12 folyo açar**; bildirim aktörü hoş geldiniz (iletişim yoksa gönderilmez). | Konaklayanlar: 12 oda; Folyolar. |
| 6 | Murat grup hesabını düzenler: her folyoda **ödeyen** "Mavi Tur" (kontrat fiyatı acente öder; misafir ekstraları ayrı pencere) — folyoyu **böl**: pencere 1 oda ücreti (ödeyen Mavi Tur), pencere 2 ekstralar (misafir). İsterse 12 odanın pencere 1'lerini grup liderinin folyosuna **birleştirir** (grup hesabı). | Yönlendirme: gece ücreti pencere 1'e, restoran / minibar pencere 2'ye. Birleştirmede kaynakların kalem ve ödemeleri hedefe taşınır, kaynak `TRANSFERRED` (geri alınmaz). Misafir portalı **şirket / acente penceresini göstermez** (kontrat fiyatı sızmaz), yalnız varlığını söyler. | Folyo ekranı: pencere sekmeleri, yönlendirme satırı. |
| 7 | Gece kapanışları: 5, 6, 7 Haziran. | Folyo aktörü her oda için 2.200 TL gece ücreti (vergi dökümü dahil; kontrat fiyatı). Kota tablosunda 8 Haziran'dan itibaren kalan 15. | Folyo kalemleri. |
| 8 | 8 Haziran çıkış: misafirler ekstralarını (pencere 2) kartla öder; Murat Gruplar → **Toplu check-out** (acente pencereleri hâlâ 6.600 TL / oda borçlu). | Toplu çıkış bakiye sıfır olmayan folyoyu çıkaramaz → Murat önce acente penceresini kapatır: **Ödeme al → yöntem "Acente / cari"**, cari **Mavi Tur** (varsayılan rezervasyonun acentesi), tutar 6.600 × 12 = **79.200**. Para girmez; `payment.received` → **muhasebe aktörü** Mavi Tur carisine **79.200 borç**, vade = 8 Haziran + 30 = 8 Temmuz. Sonra toplu çıkış: `guest.checked_out` × 12 → odalar boş + kirli, 12 çıkış temizliği görevi, folyolar kapanır (`folio.closed` × 12). | Kasa → Günlük kasa: "Acente / cari" satırları (nakit değil); Ön muhasebe → Cariler → Mavi Tur (B) 79.200; Yaşlandırma: vadesi gelmemiş. |
| 9 | Folyo aktörü 12 taslak açar; alıcı **cari** (Mavi Tur — şirket). Muhasebe **toplu kesim**: Taslaklar → 12 taslağı seç → **Seçilenleri kes**. (Acente tek fatura isterse: pencere 1'ler grup liderine birleştirilmişse tek folyo → tek fatura.) | Her taslak tek kesimin kuralıyla; mükellef sorgusu Mavi Tur → e-Fatura; 12 numara açılış sırasıyla. `invoice.issued` × 12 → muhasebe aktörü **her faturanın numarasını Mavi Tur carisindeki ilgili 6.600 TL borç satırına yazar**. | Faturalar → Kesilenler; cari ekstresinde her satırda fatura no. |
| 10 | 8 Temmuz: Mavi Tur 79.200 TL havale eder. Muhasebe → Mavi Tur → **Tahsilat fişi** → banka 79.200. | Cari sıfırlanır. Vadesi geçseydi yaşlandırmada 1–30 dilimine düşerdi. | Cari ekstresi; Kasa / banka. |
| 11 | Dönem sonu: Acente primleri → Mavi Tur Haziran kuralı (hedef 100 gece, %5 prim) → **Hesapla**: üretim = gerçekten kalınan geceler (36 gece bu gruptan), matrah vergisiz oda geliri → hak ediş → **Onaya gönder** → başka yetkili onaylar. | `agency.bonus.changed APPROVED` → muhasebe aktörü Mavi Tur carisine **alacak** (prim borcumuz; fark kaydıyla). Ödenince "ödendi". | Acente primleri; cari ekstresi (A). |

### Ters giderse (Senaryo K)

| Durum | Ne olur | Ne yapılır |
| --- | --- | --- |
| Acente 16. odayı istiyor (kota 15) | Kota tavan değil: fiziksel yer varsa genel havuzdan açılır | — |
| Başka acente / web sitesi 5 Haziran'da Standart istiyor, 3 oda boş ama 15 kota tutulu | Guard "N oda acente kotasında tutulu" der; **release** (29 Mayıs) öncesi genel satış kotaya takılır; release sonrası serbest | Release tarihini bekleyin ya da kotayı küçültün |
| Rooming list satırı hatalı | Satır numarasıyla hata; geçerliler dolar | Dosyayı düzelt, yeniden yükle |
| Toplu check-in'de 12 kayıt da atlandı: "kimlik eksik" | Kimlik politikası; toplu giriş kimliği karttan okur | Kimlikleri karta işle (Misafirler) ya da tek tek giriş |
| Aynı adlı iki misafir | Satır misafiri **kendi kartına** açılır (isim çakışması grubu düşürmez); aynı ad + iletişim varsa mevcut kart | Sonradan Misafirler → birleştir |
| Bir oda gelmedi | Grup içinde tek rezervasyon **Gelmedi**; folyo aktörü gelmedi ücreti (kontrat / politika) | Rezervasyon → gelmedi |
| Acente çıkışta "faturayı tek kes" dedi ama 12 folyo var | 12 fatura ya da önceden pencere birleştirme (grup hesabı) | Çıkıştan önce birleştirin |
| "Acente / cari" ödemesinde cari seçilmedi | Reddedilir (cari zorunlu; referans zorunlu değil) | Cari seçin |
| Muhasebe aktörü kapalı | "Folyo tahsilatı muhasebeye işlenecek" × 12 görevi | Eşitle |
| Fatura iptali gerekti | Dört göz; cari hareketteki bağ çözülür; folyo yeniden açılabilir | Faturalar → İptal iste |
| Prim hak edişini hesaplayan onaylamaya çalıştı | Dört göz: gönderen onaylayamaz | Başka yetkili |

## Senaryo L — Personel bordrosunun onayı ve ödenmesi

**Hikâye:** Nisan 2026 bordrosu. Otelde 45 personel, 8 departman. İK sorumlusu Merve puantajı ve ek ödemeleri girer, servis payı havuzunu dağıtır, bordroyu hesaplar ve onaya gönderir; genel müdür Burak onaylar; muhasebe Hande 5 Mayıs'ta bankadan öder, iki personelin maaşını elden verir, ay sonunda SGK ve vergi borcunu kapatır. Örnek personel: aşçı Selin Kaya, brüt 30.000 TL, 2.000 TL avans; garson Mehmet Yıldız, net anlaşmalı 25.000 TL, 12 saat fazla mesai, servis payı. Senaryo bordronun **hesapla → onaya gönder → dört göz → öde** akışını, yasal parametre teyidini, ay kilidini, fark bordrosunu ve ön muhasebeye düşen kayıtları anlatır.

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 1 | (Bir kez) Burak, Bordro → **Ayarlar**: işyeri (ünvan, SGK sicil, vergi dairesi, sektör), **Hazır setleri yükle** (2026: 1 Ocak, 17 Nisan, 1 Temmuz setleri), her seti Resmî Gazete / SGK / GİB metniyle karşılaştırıp **Teyit ettim**; departmanlar; kalemler. | Set "teyitsiz" başlar; teyitsiz setle hesaplanan bordro **onaya gidemez**. Nisan ayı **30 Nisan'da yürürlükte olan** setle hesaplanır (17 Nisan seti: yemek SGK istisnası). Onaylı bordronun seti artık değiştirilemez / teyidi kaldırılamaz. | Bordro → Ayarlar → parametre setleri (durum rozeti). |
| 2 | Merve, Bordro → **Puantaj ve kalemler** → Nisan: Selin eksik gün 0, çalışılan gün 22; Mehmet fazla çalışma 12 saat, hafta tatili çalışması 1 gün. **Kaydet** (değişen satırlar birlikte). Kalemler: Selin'e "performans primi" 1.500 TL; Mehmet'e "yol" 1.200 TL. | Puantaj satırları `PayrollAttendance`; kalemler ayın girdisi. Ay onaydaysa / onaylıysa sunucu reddeder. Girdi değişikliği ayın hesaplanmış açık bordrosunu "yeniden hesaplanmalı" işaretler. | Puantaj tablosu; kalem listesi. |
| 3 | **Servis payı**: Nisan havuzu 60.000 TL, dağıtım puanla (Mehmet 3 puan, komi 1 puan…), çalışılan güne göre ağırlıklı → **Dağıt**. | Paylar ayın "Servis payı" kalemine yazılır; kuruş artığı en büyük paydan dağıtılır, toplam havuza eşit. Ay kilitliyse dağıtım değişmez. | Servis payı ekranı: kişi başı pay. |
| 4 | Personel → Selin Kaya → **Avanslar**: 2.000 TL, 15 Nisan, kasadan (`payroll.pay`). | Kasadan çıkış; **Selin'in personel carisine borç 2.000** (muhasebe aktörü değil, bordro servisi; cari yoksa açılır). Onayda mahsup edilecek. | Kasa / banka hareketleri; Selin carisi (B) 2.000. |
| 5 | Bordro → Bordrolar → Nisan → **Bordro aç** → **Hesapla**. | Hesap motoru her personel için (kuruş tam sayı): prime esas kazanç, SGK işçi / işsizlik, GV matrahı (yıl içi birikmiş matrah **Ocak–Mart onaylı bordrolarından**), tarife, asgari ücret GV / DV istisnası, DV, net; Mehmet'te **net → brüt** çözümü (en küçük brüt, ikili arama), fazla çalışma saat ücreti × 1,5 (aylık / 225), hafta tatili günlük × 1,5; işveren payları, Hazine indirimi. Önceki ay onaylanmamışsa hesap durur. Eşzamanlı ikinci hesap sırayı bekler. | `/bordro/:id`: toplamlar (brüt, SGK, GV, DV, net, maliyet), departman icmali, 45 satır; satırda **hesap izi**. |
| 6 | Merve uyarıları okur: "parametre seti teyitli", "önceki aylar onaylı", "yeniden hesaplanmalı" yok. **Onaya gönder**. | Onay kuyruğuna `Bordro` türünde iş (özet: Nisan, 45 kişi, net toplam); durum **onayda**; ay **kilitlenir** (puantaj / kalem / servis payı değişmez). | Onaylar → Bekleyen; üst bar sayacı. |
| 7 | Burak, Onaylar → Bekleyen → bordro → ayrıntı (toplamlar, departman icmali bağlantısı) → **Onayla**. Merve'nin kendi "Onayla" düğmesi kapalıdır (dört göz). | `approval.granted` → bordro dinleyicisi: durum **onaylı**; **avans taksitleri ve icra / nafaka kesintileri kesinleşir** (Selin'in 2.000 TL avansı bu bordrodan düşer). `payroll.run.approved` yayınlanır. | Bordro ekranı "onaylı"; Onaylar → Geçmiş. |
| 8 | — | **Muhasebe aktörü** ay sonu (30 Nisan) tarihli **tahakkuk** yazar, 250 kişilik parçalarla: her personelin carisine net ücret alacak (Selin 21.447,30 → avans borcu 2.000 ile cari bakiyesi (A) 19.447,30), **SGK carisine** işçi + işveren payları − indirimler (45 kişinin toplamı), **vergi dairesi carisine** GV + DV, **BES şirketine** katkılar, **icra dosyalarına** kesintiler. Eksik personel carileri toplu açılır. | Ön muhasebe → Cariler (tür personel / kurum): SGK (A), vergi dairesi (A); personel ekstreleri. |
| 9 | Merve **Çıktılar**: bordro listesi PDF, pusulalar PDF (departman departman), departman icmali, **banka dosyası** (Excel; IBAN + ödenecek), müşavir tablosu. Onaylı olduğu için "TASLAK" damgası yok. | PDF'ler sunucuda; 2.500 kişilik bordro ~5 sn. | Bordro ekranı → Çıktılar. |
| 10 | Hande 5 Mayıs: Bordro ekranı → **Öde** → yöntem banka, hesap "İş Bankası TRY", tarih 5 Mayıs (bugünü geçemez). Bankaya dosyayı yükler. | Ödeme kaydı; `payroll.run.changed PAID` → **muhasebe aktörü**: İş Bankası hesabından **tek çıkış** (banka ödemelilerin toplamı), her personelin carisine **borç** → cariler sıfırlanır. | Kasa / banka → İş Bankası (kaynak "Bordro"); personel ekstreleri 0. |
| 11 | İki personel elden alıyor: **Öde → elden → Resepsiyon kasası**. | Elden ödeme **yalnız kasadan**; kasa yetersizse reddedilir ("kasa eksiye düşmez"). Kasadan çıkış + iki personel carisi kapanır. | Kasa hareketleri. |
| 12 | Ay sonu Hande, Ön muhasebe → Cariler → **SGK** → **Ödeme fişi** → banka (tutar carinin bakiyesi); aynı şekilde **vergi dairesi**. | Fişler eşik üstüyse dört göz onayı. Cari borçlar kapanır. **Gider tarafı** genel muhasebede: 8. adımdaki tahakkuk aynı anda yevmiye fişi olur — `770` (işveren maliyeti; departman kuralı varsa departman hesaplarına) borç / `335` net ücret, `361` SGK, `360` vergi, `369` BES, `336` icra alacak. Bu ödeme fişleri de `361` / `360` borç, `102.01` alacak fişi olur. | Fişler; cari ekstreleri; Genel muhasebe → Yevmiye (kaynak "Bordro tahakkuku", "Ön muhasebe fişi"). |
| 13 | 12 Mayıs: Mehmet'in Nisan fazla mesaisi 12 değil 20 saatmiş. Merve Nisan → **Fark bordrosu aç** → kalem: fazla çalışma +8 saat → Hesapla → Onaya gönder → Burak onaylar → öde. | Fark bordrosu: ay onaylı girdi + yeni kalemlerle baştan hesaplanır, önceki onaylı tutarlar çıkarılır (fark eksi olabilir). BES / avans / icra kesintisi yapılmaz. Tahakkuk ve ödeme aynı yolla (eksi tutarda ters taraf). | Bordrolar listesi: Nisan aylık (onaylı, ödendi) + Nisan fark. |
| 14 | 31 Mayıs: komi Ahmet Çelik işten çıkıyor. Personel → Ahmet → **İşten çıkış** → tarih, sebep → **önizleme**: kıdem (yalnız DV, tavanlı; tavan çıkış gününde yürürlükteki setten), ihbar (GV + DV, SGK yok), kullanılmayan izin 6 gün (tam tabi) → **Kaydet**. Pencerede **zimmetli demirbaş uyarısı**: "DM-000087 El terminali — iade alınmadı" (engellemez). | Kalemler Mayıs bordrosuna düşer; çıkış geri alınabilir. Demirbaş → kart → **İade al** ayrıca yapılır. | Mayıs bordrosu satırı; Demirbaş kartı. |

### Ters giderse (Senaryo L)

| Durum | Ne olur | Ne yapılır |
| --- | --- | --- |
| "Parametre seti teyit edilmedi" | Hesap yapılır ama **onaya gidemez** | Ayarlar → set → Teyit ettim (resmî metinle karşılaştırarak) |
| "Mart onaylı değil" | Nisan hesaplanamaz / onaya gidemez (birikmiş matrah) | Mart'ı onaylayın; yıl ortası geçişte **matrah devri** girin |
| Burak reddetti ("prim tutarı yanlış") | Bordro **hesaplandı**ya döner, ay kilidi açılır; not görünür | Kalemi düzelt → Hesapla → Onaya gönder |
| Onaylandı, sonra hata fark edildi | Onaylı ay **kilitli**; düzeltme **fark bordrosu** | Fark bordrosu aç |
| Merve kendi bordrosunu onaylamaya çalıştı | Dört göz: hazırlayan onaylayamaz (düğme kapalı, sebebi yazılı) | Başka yetkili |
| Elden ödemede kasa yetersiz | "Kasa eksiye düşmez" → reddedilir | Ön muhasebe → Virman (banka → kasa) |
| Ödeme tarihi 10 Mayıs girildi (bugün 5 Mayıs) | Tarih bugünü geçemez | Bugün ya da geçmiş |
| Muhasebe aktörü kapalı | "Onaylanan bordro carilere tahakkuk ettirilecek" / "Maaş ödemesi … işlenecek" görevleri | Ön muhasebe → Ayarlar → Eşitle (Nisan) |
| Muhasebe başlangıç günü 1 Mayıs (bordro 30 Nisan tarihli) | Tahakkuk **işlenmez** (başlangıçtan önce); açılış bakiyesiyle gelir | Personel / SGK / vergi carilerine açılış girin |
| Personel kartında ücret görünmüyor | `payroll.view` yok | Rol matrisi |
| Hesap 2.500 kişide uzun sürüyor | ~3,6 sn normal; aynı anda ikinci hesap bekler | Bekleyin |
| İşten çıkışta zimmet uyarısı | Engellemez; demirbaş iadesi ayrı işlem | Demirbaş → kart → İade al |

## Senaryo M — Ay sonu mizan ve dönem kapanışı (genel muhasebe)

**Hikâye:** Kasım 2026 kapanıyor. Muhasebe Hande ayın mizanını müşavire verecek ve ayı kilitleyecek. Ay boyunca ön büro tahsilatları, restoran adisyonları, mal kabuller, acente aktarımları ve bordro **kendiliğinden** yevmiye fişi oldu; her gün kapanışında günlük gelir fişi yazıldı. Hande'nin işi: eksik kalanı tamamlamak, mizanı denetlemek, bir düzeltme fişi girmek, dönemi kilitlemek. Örnek sayılar: ay içinde 120.01'e 2.200,00 + 1.100,00 TL gelir borcu yazıldı, 1.000,00 TL nakit tahsilat alacaklandı; kasadan 750,00 TL elektrik çıkışı yanlışlıkla `770` yerine `760`'a gitmiş.

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 1 | 1 Aralık sabahı Hande, Genel muhasebe → **Ayarlar**: "Fişlenmemiş cari hareketi 3", "Fişlenmemiş kasa / banka hareketi 1". Görevler'de iki "Ön muhasebe kaydı (FOLIO_PAYMENT) yevmiye fişine çevrilecek" görevi; açıklamada "100.03 Döviz kasası (USD) hareketi için 28.11.2026 kuru yok". | Ay içinde bir USD nakit tahsilat fişlenemedi (ön muhasebeye yazıldı, kuru yok). Mizan bu kaydı içermiyor; Mizan sekmesinde "Fişlenmemiş hareket var" uyarısı. | Ayarlar sayaçları; Mizan uyarısı; Görevler. |
| 2 | Kasa → Döviz kurları → 28 Kasım USD kurunu girer. Genel muhasebe → Ayarlar → **Eşitle**: 1–30 Kasım → **Eşitle**. | Dönemdeki fişlenmemiş belgeler fişlenir (USD hareketi günün kuruyla `100.03` borç / `120.01` alacak); Kasım'ın 30 kapanmış günü için gelir fişi hedefi yeniden hesaplanır — değişmeyen günler "Atlandı", geç kalem işlenmiş 2 gün "(düzeltme)" fişi alır. Sonuç: İşlendi 4, Atlandı 28, Hata 0, Kalan 0. | Eşitle sonuç kutusu; Yevmiye'de yeni fişler; Ayarlar sayaçları 0. Görevler kapatılır. |
| 3 | Genel muhasebe → **Mizan**: 01.11–30.11, "Yalnız hareketliler" açık. Rozet **Mizan dengeli**, uyarı yok. | Her fiş dengeli yazıldığı için dip toplam borç = alacak. Üst hesaplar alt hesapların toplamı: `120` = 120.01 + 120.02 + …; `6` = bütün gelir tablosu. | Mizan tablosu; dip toplam. |
| 4 | Hande `120.01` satırına tıklar → **ekstre** aynı dönemle açılır: her gün "Günlük gelir fişi" borç satırları, tahsilat fişleri alacak satırları, yürüyen bakiye. Kapanış 2.300,00 (B) = 2.200,00 + 1.100,00 − 1.000,00: ay sonunda tahsil edilmemiş folyo alacağı. Folyolar → açık folyolar toplamıyla karşılaştırır: tutar. | Ekstre satırları fiş sayfasına, fiş sayfası kaynak belgeye (folyo ödemesi, gün) bağlanır. | `/genel-muhasebe/hesaplar/:id` |
| 5 | Mizanda `760 Pazarlama Satış ve Dağıtım Giderleri` 750,00 borç kalanı görür; beklemiyordu. Yevmiye → Hesap süzgeci 760 → fiş `YEV-2026-00231` "Ön muhasebe fişi · Elektrik faturası": `760` 750,00 / `100.01` 750,00. Sebep: carisiz çıkış fişinde karşı hesap seçilmemiş ve "Carisiz çıkışın karşı hesabı" kuralı birisi tarafından 760'a çevrilmiş. | Otomatik fiş kuralı o anki hâliyle uygulamıştır; fiş doğru yazılmış, kural yanlıştı. | Yevmiye liste ve fiş sayfası (kaynak bağlantısı ön muhasebe fişine gider). |
| 6 | Kurallar → "Carisiz kasa / banka çıkışının karşı hesabı" satırını `770`'e geri alır (sil → varsayılan) → **Kaydet**. Sonra fiş `YEV-2026-00231` → **İptal et**: ters kaydın günü 30 Kasım, sebep "Yanlış gider hesabı (760 → 770)". Ardından Yevmiye → **Fiş gir**: gün 30 Kasım, "Elektrik faturası — düzeltme", satır 1 `770` borç 750,00, satır 2 `100.01` alacak 750,00 → Dengeli → **Kaydet**. | Kural yalnız yeni fişleri etkiler. İptal: asıl fiş "İptal edildi", ters fiş `YEV-2026-00298` (`100.01` 750,00 borç / `760` 750,00 alacak). Elle fiş `YEV-2026-00299`. Ön muhasebedeki kasa hareketi fişli kalır, yeniden fişlenmez. Mizan: `760` kalan 0 (borç 750 / alacak 750), `770` +750,00; `100.01` kalanı değişmedi (−750 +750 −750). | Fiş sayfaları birbirine bağlı; mizan güncel (canlı kanal). |
| 7 | Mizan yeniden: dengeli, `760` "yalnız hareketliler" açıkken hâlâ görünür (dönemde hareketi var, kalanı 0). Hande dönemi Excel'e alır / ekran görüntüsünü müşavire gönderir. | — | Mizan. |
| 8 | Ayarlar → **Dönem kilidi**: Kilit günü **30.11.2026** → Kaydet: "Dönem 30.11.2026 gününe kadar kilitlendi". | 30 Kasım'a kadar (dahil) elle fiş girilemez, fiş iptal edilemez. Aralık'ta gelen ama Kasım'a ait bir belge (ör. geç işlenen 29 Kasım tarihli ödeme) kilit sonrasındaki ilk güne, 1 Aralık'a yazılır; açıklamasında "(kilitli dönem 29.11.2026, 01.12.2026 gününe yazıldı)" notu. | Ayarlar "Kilitli dönem"; Yevmiye'de kilit notlu fişler. |
| 9 | 3 Aralık: Hande Kasım'a ait bir elle düzeltme daha gerektiğini görür. Fiş gir → gün 30 Kasım → "Dönem 30.11.2026 gününe kadar kilitli". Fişi **3 Aralık** tarihiyle "Kasım düzeltmesi: …" açıklamasıyla girer (cari ayda düzeltme). | Kilit korur; kapanan ayın rakamı değişmez. Gerçekten Kasım'a yazılması gerekiyorsa yetkili kilidi geçici olarak 31 Ekim'e çeker, fişi girer, kilidi geri koyar (denetim izinde görünür). | Yevmiye. |

### Ters giderse (Senaryo M)

| Durum | Ne olur | Ne yapılır |
| --- | --- | --- |
| Eşitle "Hata 2": "… için … kuru yok" | Döviz kasası hareketi fişlenemedi | Kasa → Döviz kurları → o günün kuru → Eşitle |
| Eşitle "Hata": "600.03 … satır alamaz (pasif …)" | Kuraldaki hesap pasif ya da alt hesabı açılmış ana hesap | Hesap planı → hesabı etkinleştir ya da Kurallar → yaprak hesap seç → Eşitle |
| Eşitle "Kalan 120" | 20 saniyelik süre doldu | Yeniden Eşitle; kaldığı yerden sürer |
| "Mizan dengesiz" rozeti | Normal işletimde görülmez; veri sorunu | Yevmiye'de o günün fişlerini inceleyin; teknik ekibe bildirin |
| Fişlenmemiş hareket uyarısı sayıları Eşitle'den sonra da sıfırlanmıyor | O belgeler hata listesinde | Hata mesajını okuyup kuralı / hesabı / kuru düzeltin |
| Kilit günü bugünden sonra | Reddedilir | En çok bugün |
| Otomatik fişi iptal etti, Eşitle yeniden yazmadı | Beklenen: kaynak kayıt fişli kalır | Doğru satırlarla elle fiş |
| Ters kayıt fişini iptal etmeye çalıştı | "Ters kayıt fişi iptal edilemez" | Yeni elle fiş |
| Muhasebe aktörü kapalı | Fiş yok, Görevler'de "yevmiye fişine çevrilecek" / "gelir fişi yazılacak" | Genel muhasebe → Ayarlar → Eşitle; görevleri kapat |
| Müşavir "120'de misafir alacağı çok yüksek" dedi | 120.01 kalanı tahsil edilmemiş açık folyoları gösterir (gelir gün gün yazılır, tahsilat çıkışta) | Folyolar → açık folyolarla karşılaştırın; normaldir |

## Senaryo N — Yanlış kasa çıkışı fişinin düzeltilmesi

**Hikâye:** Resepsiyon kasasından 1.250,00 TL temizlik malzemesi ödendi. Muhasebe Hande ön muhasebede **Çıkış** fişi kesti ama "Karşı hesap" alanına yanlışlıkla `760` (pazarlama) seçti ve tutarı 1.520,00 yazdı. Senaryo iki düzeltme yolunu gösterir: tutar yanlışsa **ön muhasebe fişi** iptal edilir (kasa da düzelir); yalnız gider hesabı yanlışsa **yevmiye fişi** iptal edilip elle fiş girilir (kasaya dokunulmaz).

| Adım | Ekranda ne yapılır | Arka planda ne olur | Nerede görünür |
| --- | --- | --- | --- |
| 1 | Ön muhasebe → Kasa / banka → **Çıkış**: hesap Resepsiyon kasası, tutar **1.520,00**, açıklama "Temizlik malzemesi", **Karşı hesap** `760`. Kaydet. | Fiş `CKS-2026-0042`; kasadan 1.520,00 çıkış; `accounting.posted` → muhasebe aktörü yevmiye fişi `YEV-2026-00310`: `760` 1.520,00 borç / `100.01` 1.520,00 alacak (fişte seçilen hesap kuralın önüne geçer). | Fişler; Kasa / banka hareketleri; Yevmiye (kaynak "Ön muhasebe fişi", bağlantı `CKS-2026-0042`). |
| 2 | Hande hatayı görür: tutar 1.250,00 olmalıydı. Ön muhasebe → Fişler → `CKS-2026-0042` → **İptal** (gerekçe "Tutar hatalı"). | Ön muhasebe ters kaydı: kasaya 1.520,00 geri (kasa yeterli). `accounting.posted` (ters kayıt) → yevmiyede **ayrı** fiş `YEV-2026-00311` "Ön muhasebe fişi — ters kayıt": `100.01` 1.520,00 borç / `760` 1.520,00 alacak. `YEV-2026-00310` "İşlendi" olarak **kalır**; net sıfır. | Fişler (iptal); Yevmiye'de iki fiş; `760` ekstresinde +1.520 / −1.520. |
| 3 | Yeni **Çıkış** fişi: 1.250,00, Karşı hesap bu kez `770`. | Kasadan 1.250,00; yevmiye `YEV-2026-00312`: `770` 1.250,00 / `100.01` 1.250,00. | Kasa bakiyesi doğru; mizanda `770` +1.250,00. |
| 4 | **Varyant:** tutar doğru, yalnız hesap yanlış olsaydı (1.250,00 ama `760`). Ön muhasebe fişine dokunulmaz (kasa doğru). Genel muhasebe → Yevmiye → `YEV-2026-00310` → **İptal et** (ters kaydın günü = bugün, sebep "Gider hesabı 760 yerine 770"). | Asıl fiş "İptal edildi", ters fiş `100.01` 1.250,00 borç / `760` 1.250,00 alacak. Ön muhasebedeki kasa hareketi **fişli kalır** (Eşitle yeniden yazmaz). | Fiş sayfası: "İptal edildi" kutusu, ters fişe bağlantı. |
| 5 | Yevmiye → **Fiş gir**: gün bugün, açıklama "Temizlik malzemesi — gider hesabı düzeltmesi (CKS-2026-0042)", satır 1 `770` borç 1.250,00, satır 2 `100.01` alacak 1.250,00 → Dengeli → Kaydet. | Elle fiş `YEV-2026-00313`. `100.01` net etkisi: −1.250 (otomatik) +1.250 (ters) −1.250 (elle) = −1.250 → kasa hesabı doğru; `760` 0; `770` +1.250. Kasa bakiyesi ön muhasebede zaten doğruydu. | Mizan; `770` ve `760` ekstreleri. |
| 6 | Hande bir dahaki sefere kuralı düzeltir: Kurallar → "Carisiz kasa / banka çıkışının karşı hesabı" `770` (varsayılan) kalsın; sık kullanılan masraflar için `770.01 Elektrik`, `770.02 Temizlik malzemesi` alt hesapları açar ve resepsiyona "Çıkış fişinde karşı hesabı seçin" der. | `770` alt hesabı açıldığı için artık satır almaz; eski `770` satırları yerinde kalır. | Hesap planı. |

### Ters giderse (Senaryo N)

| Durum | Ne olur | Ne yapılır |
| --- | --- | --- |
| Ön muhasebe fişi iptal edilemiyor ("kasa eksiye düşer") | Çıkış iptali kasaya para geri getirir, bu durumda sorun olmaz; **giriş** fişi iptalinde kasa yetersiz olabilir | Virmanla kasaya para aktarın |
| Yevmiye fişini iptal etti, kasa bakiyesi değişmedi | Doğru: yevmiye iptali ön muhasebeye dokunmaz | Tutar yanlışsa ön muhasebe fişini iptal edin |
| Hem ön muhasebe fişini hem yevmiye fişini iptal etti | Çift ters kayıt: `100.01` ve `760` fazladan 1.520 ters döner, mizan hesapları kayar (yine dengeli) | Elle fiş ile düzeltin (`760` borç / `100.01` alacak); bir daha yalnız birini iptal edin |
| Elle fişte `770` seçilemiyor | `770`'in alt hesabı açılmış, ana hesap satır almaz | `770.xx` alt hesabını seçin |
| Ters kaydın günü kilitli dönemde | "Dönem … gününe kadar kilitli" | Ters kaydın gününü bugüne alın ya da kilidi geçici açın |
| Fiş "başkası değiştirdi" | Aynı fişi iki kişi aynı anda iptal etmeye çalıştı | Yenileyin; fiş zaten iptal edilmişse ikinci iptal 409 |

## Senaryolarda geçen olaylar, aktörler, onaylar ve görevler

Bu bölüm senaryoları başkasına anlatırken "bunu kim yapıyor?" sorusuna hızlı cevap için bir başvuru tablosudur. Olay adları Aktivite → Olaylar ekranında Türkçe karşılıklarıyla görünür; buradaki teknik adlar yalnız eşleştirmek içindir.

### Olay → kim yayınlar → kim dinler

| Olay | Yayınlayan | Dinleyen ve yaptığı iş | Senaryo |
| --- | --- | --- | --- |
| `reservation.created` | Rezervasyon servisi (widget, resepsiyon, kanal aktörü, concierge) | Oda aktörü → oda atar; bildirim aktörü → onay bildirimi (bekleyende onaylanınca); kanal aktörü → envanter farkı | A, D, K |
| `reservation.confirmed` / `cancelled` / `no_show` / `reinstated` | Rezervasyon servisi, gün kapanışı | Folyo aktörü → iptal / gelmedi ücreti (geri alınırsa düşer); kanal aktörü → envanter; bekleme listesi taraması | A, C, D |
| `guest.checked_in` | Giriş servisi | Oda aktörü → dolu; folyo aktörü → folyo + erken giriş ücreti + teminat ödemesi; bildirim → hoş geldiniz; online check-in → "giriş yapıldı" | A, G, K |
| `guest.checked_out` | Çıkış servisi | Oda aktörü → boş + kirli; kat hizmetleri aktörü → çıkış temizliği; folyo aktörü → kalan gece / geç çıkış, kapanış; bildirim → teşekkür; anket işi → çıkış sonrası anket | A, I, K |
| `guest.check_in_reverted` / `check_out_reverted` | Geri alma | Oda aktörü doluluğu düzeltir; folyo aktörü ücreti / teminatı ters kayıtla düşer, folyoyu yeniden açar | A |
| `folio.room_charges.due` | Gün dönüşü zamanlayıcısı | Folyo aktörü → eksik geceler (100'lük parçalar) | A, C |
| `night.audit.started` / `night.audit.closed` | Gün kapanışı | Folyo aktörü → ön basım; **muhasebe aktörü → günlük gelir fişi** (`businessDay` günü; genel muhasebe); (2.0: gece müdürü, kârlılık, dış muhasebe) | C, M |
| `fnb.order.placed` | POS (adisyon turu, oda servisi, paket) | Mutfak ekranı panosu | B |
| `fnb.order.status_changed` | Mutfak ekranı | POS adisyon ekranı rozeti; garson zili ("hazır") | B |
| `fnb.order.charged` | POS "odaya yaz", oda servisi teslimi | Folyo aktörü → folyo kalemi (vergi kategorisiyle) | A, G |
| `fnb.order.paid` | POS adisyon kapanışı | Stok aktörü → reçeteden satış düşümü (son yayın esas) | A, B |
| `pos.payment.changed` / `banquet.payment.changed` / `spa.payment.changed` | POS, banket, spa ödemeleri | Muhasebe aktörü → kasa / banka (+ etkinlikte müşteri carisi); yalnız işlenmiş / iptal | B, H |
| `minibar.consumed` / `laundry.charged` / `spa.charged` | Minibar fişi, çamaşır teslimi, spa randevusu | Folyo aktörü → kalem (çıkmış misafirde açık folyoya geç kalem) | A |
| `payment.received` / `refunded` / `voided` | Ödeme servisi | Muhasebe aktörü → kasa / banka ya da cari; folyo aktörü → bitmiş konaklamanın sıfırlanan folyosunu kapatır | A, K |
| `folio.closed` | Folyo aktörü / kapatma | Folyo aktörü → fatura taslağı | A, K |
| `invoice.issued` / `invoice.cancelled` | Fatura kesimi / iptali | Muhasebe aktörü → numara cari harekete / serbest fatura alacağı / ters kayıt | A, H, K |
| `stock.changed` | Stok hareketleri (mal kabul, satış, sayım, elle) | Stok aktörü (yalnız SALE / MOVEMENT / COUNT) → minimum altı talebi + zil | B, J |
| `purchase.goods.received` | Mal kabul | Muhasebe aktörü → tedarikçi carisine KDV dahil borç, vade | B |
| `purchase.request.changed` | Satın alma talebi | Ekranlar; zil | B |
| `agency.bonus.changed` | Prim hak edişi | Muhasebe aktörü → acente carisine alacak (fark kaydı) | K |
| `banquet.event.changed` | Etkinlik durumu | Muhasebe aktörü → müşteri carisine bedel / iptal bedeli / geri alma | H |
| `payroll.run.approved` / `payroll.run.changed PAID` | Bordro onayı / ödemesi | Muhasebe aktörü → tahakkuk / ödeme kayıtları | L |
| `accounting.posted` (`sourceId` ile) | Muhasebe aktörü (ön muhasebe kaydı yazıldığında), Ön muhasebe → Eşitle | Muhasebe aktörü → belgenin fişlenmemiş kayıtlarını **yevmiye fişine** çevirir (genel muhasebe) | A, B, H, K, L, M, N |
| `ledger.changed` | Yevmiye fişi, hesap planı, kural, ayar değişikliği | Genel muhasebe ekranları (Mizan, Yevmiye, Hesap planı) tazelenir | M, N |
| `rate.changed` | Fiyat planı, sezon, onaylı fiyat önerisi, Excel fiyat yüklemesi | Kanal aktörü → fiyat farkı; fiyat önbelleği tazelenir | F |
| `agency.allotment.changed` | Kota tanımı | Kanal aktörü → OTA'ya giden boş sayıdan kota düşülür; bekleme listesi taraması | K |
| `channel.booking.received` | Channex revizyonu / iCal | Kanal aktörü → rezervasyon açar / günceller / iptal eder | D |
| `room.assigned` / `room.blocked` / `room.unblocked` | Oda aktörü, blok servisi | Bildirim (oda bilgisi, giriş günü); kat hizmetleri aktörü (blok bitince derin temizlik); kanal aktörü (envanter) | A, E |
| `housekeeping.issue.reported` | Kat görevlisi "Sorun var" | Teknik servis dinleyicisi → arıza bileti | E |
| `housekeeping.task.completed` / `room.inspected` | Kat görevi | Kat hizmetleri aktörü → oda temiz / kontrol edildi; isteğe bağlı görev isteği kapatır | A, I |
| `maintenance.ticket.created` / `assigned` / `resolved` | Teknik servis | Zil (atanan); isteğe bağlı bilet isteği işlemde / tamamlandı | E |
| `guest.message.received` / `guest.intent.detected` / `guest.message.reply` | Mesaj geçitleri, router ajanı, personel / AI | Router ajanı → niyet; concierge → cevap ya da devir; geçit → gönderim | I |
| `guest.request.created` / `updated` | İstek servisi, AI, oda servisi | Kat hizmetleri (görev), teknik servis (bilet), oda servisi (sipariş) | E, I |
| `pricing.review.requested` | Günlük iş | AI fiyat ajanı → öneri | F |
| `approval.requested` / `granted` / `denied` / `expired` | Onay kuyruğu | İsteyen aktör / modül dinleyicisi → işi bitirir ya da vazgeçer | A, F, H, L |
| `manual_task.created` | Aktör taban sınıfı (kapalı / yapamadı) | Görevler ekranı, zil | G |
| `survey.*` | Anket | Takip kaydı, zil (düşük puan), içgörü ajanı | I |

### Senaryolarda geçen onay türleri (dört göz)

| Onay türü | Kim ister | Ne zaman | Senaryo |
| --- | --- | --- | --- |
| Folyo kalemi iptali | Folyo yetkilisi | Her elle kalem iptali | A |
| İade | Ödeme alan | Her iade | A, H |
| Büyük ödeme | Ödeme servisi | Folyo ödemesi eşiğe eşit / üstü (Ayarlar → Genel parametreler) | A |
| Ödeme iptali | Ödeme alan | Hatalı giriş | A, B |
| Fatura iptali | Fatura yetkilisi | Her fatura iptali | A, H, K |
| POS düzeltmesi / POS ödemesi | Şef garson / garson | İkram, iptal, indirim eşik üstü; büyük tahsilat ve ödeme iptali | B |
| Satın alma siparişi | Satın almacı | KDV dahil tutar politika eşiğinde / üstünde; 3 gün | B |
| Ödeme fişi | Muhasebeci | Ön muhasebe ödeme fişi eşik üstü | B, L |
| Etkinlik ödemesi | Satış / ön büro | Büyük tahsilat, iade, iptal kaydı | H |
| Toplu fiyat değişikliği | Kural işi / AI fiyat ajanı | Her fiyat önerisi | F |
| Bordro | Bordroyu hazırlayan | Her bordro ve fark bordrosu | L |
| Acente primi | Prim hesaplayan | Her hak ediş | K |
| Kapasite aşımı (overbooking) | Rezervasyon açan | Politika "onaya gönder" ise yer yokken | A |

### Senaryolarda geçen manuel görev başlıkları (aktör kapalıysa)

| Modül (görev sütunu) | Örnek başlık | Kim görür | Nasıl tamamlanır |
| --- | --- | --- | --- |
| Folyo | "Misafir girişi: folyo açılacak, teminat işlenecek"; "Restoran adisyonu folyoya yazılacak"; "Kapanan folyonun fatura taslağı açılacak" | `folio.post` | Folyo ekranından aynı iş; Faturalanacaklar'dan taslak |
| Ön muhasebe | "Folyo tahsilatı muhasebeye işlenecek (kasa / banka ya da cari)"; "Mal kabul tedarikçi carisine işlenecek"; "Onaylanan bordro carilere tahakkuk ettirilecek"; **genel muhasebe:** "Ön muhasebe kaydı (FOLIO_PAYMENT) yevmiye fişine çevrilecek: kuralı / hesabı düzeltip Genel muhasebe → Ayarlar → Eşitle", "2026-11-25 gününün gelir fişi yazılacak (Genel muhasebe → Ayarlar → Eşitle)" | `accounting.manage` | Eşleme / cari düzelt → Ön muhasebe → Ayarlar → Eşitle; kural / hesap düzelt → Genel muhasebe → Ayarlar → Eşitle |
| Oda işlemleri | "Rezervasyona oda atanacak"; "Oda dolu olarak işaretlenecek" | `rooms.operate` | Oda atama / oda planı |
| Kat hizmetleri | Oda durumu güncellemesi | Kat yetkisi | Kat haritasından |
| Stok | "Adisyon ADS-… için satış düşümü yapılacak" | `stock.manage` | Hareket gir (çıkış) |
| Kanal rezervasyonu | "Elle işlenmeli: eşleşmeyen fiyat planı" | `reservations.manage` | Rezervasyonu elle aç / düzenle; kaydı notla kapat |
| Mesajlar | Cevapsız konuşma (AI kapalı / bütçe) | Mesaj yazma yetkisi | Konuşmayı personel yürütür |
| Rapor talebi | "Rapor talebi: geçen ayın haftalık doluluğu" | `reports.view` | Raporu elle hazırlayıp kişiye iletme |
| Onay kuyruğu | Aktörü kayıttan kalkmış onaylanan iş | Ayar yöneticisi | İşi elle yap |

## Senaryoların ortak dersleri

1. **Her para hareketi tek kez yazılır.** Folyo kalemi, ödeme, stok hareketi, muhasebe kaydı — hepsinin bir **kaynak anahtarı** vardır; aynı olay iki kez gelse, aktör kapanıp açılsa, personel aynı işi elle yapsa ikinci kayıt oluşmaz.
2. **Silme yok, ters kayıt var.** Folyo kalemi, ödeme, fiş, fatura, adisyon ödemesi silinmez; iptal ters tutarlı kayıttır ve iptal günü tarihlidir. Geçmiş rapor geriye dönük değişmez.
3. **Riskli iş dört göz ister.** Kalem iptali, iade, büyük ödeme, fatura iptali, eşik üstü ödeme fişi, bordro, sipariş, fiyat değişikliği, acente primi, kapasite aşımı: isteyen onaylayamaz.
4. **Aktör kapalıysa iş personele düşer.** Görevler ekranı boş değilse birisi bir şeyi elle yapmalı demektir; aktörü açmak eski görevleri kendiliğinden kapatmaz.
5. **Sürüm damgası veriyi korur.** İki kişi aynı kaydı değiştirirse ikincisi "başkası değiştirdi, yenileyin" görür. Hata değil, güvenlik.
6. **İş günü ≠ takvim günü.** Oda ücreti, kasa ve raporlar iş gününe; fatura tarihi ve anket saati takvime bağlıdır.
7. **Dürüst sınırlar:** e-posta geçidi gerçek gönderici değil (SMS kurulabilir), e-belge gerçek entegratöre bağlı değil, e-Defter dosyası ve dış muhasebe aktarımı yok (yevmiye ve mizan ekranda var), online kart ödemesi yok, KBS bildirimi yok. Bunlar yol haritasındadır ve ekranlar bunu söyler; sahte "gönderildi" yazan hiçbir şey yoktur.
