# Ön büro

Bu bölüm resepsiyonun günlük işini anlatır: rezervasyon açmak, oda planına bakmak, misafiri karşılamak (check-in) ve uğurlamak (check-out), online check-in'i incelemek, odaların durumunu izlemek ve misafir kartını tanımak.

Her ekran şu düzende anlatılır: **nerede bulunur**, **ne yapar**, **adım adım nasıl kullanılır**, **arka planda ne olur** (hangi aktör neyi kendiliğinden yapar) ve **dikkat edilecekler**.

Ön bürodaki bütün ekranlar yan menünün **Ön büro** bölümündedir. Yetkiniz yoksa ilgili menü maddesi görünmez; gerçek yetki kontrolü sunucuda yapılır, yani adresi elle yazsanız da yetkisiz işlem reddedilir.

## Önce bilinmesi gereken kavramlar

### Otelin "bugün"ü (iş günü)

Sistemde "bugün" sunucunun saati değil, **otelin iş günüdür**. İş günü, gün kapanışı (night audit) yapılana kadar değişmez. Gece 01:00'de hâlâ "bugün gidecekler" listesi dünkü günün listesidir; çünkü gün henüz kapatılmamıştır. Bu, oda ücretlerinin doğru geceye yazılması ve raporların tutması için bilinçli bir tercihtir (bkz. "Folyo, kasa ve ek hizmetler" bölümünde Gün kapanış).

### Tarih aralığı: çıkış günü sayılmaz

Bir konaklama **giriş gecesinden çıkış sabahına** kadar odayı tutar. 15–18 tarihli rezervasyon 15, 16 ve 17 gecelerini tutar; 18'inde oda boşalır ve **aynı gün** yeniden satılabilir. Oda planında ve müsaitlik tablosunda bir sütun bir **gece**dir; çıkış günü boyanmaz.

### Oda durumu üç ayrı bilgidir

Eski sistemlerdeki "boş / dolu / kirli / arızalı" tek kutusu burada üçe ayrılmıştır. Üçü birbirinden bağımsızdır; bir oda aynı anda "dolu" ve "kirli" olabilir, ya da "boş", "temiz" ve "hizmet dışı" olabilir.

| Bilgi | Değerler | Kim değiştirir |
| --- | --- | --- |
| **Doluluk** | Boş · Dolu | **Yalnızca sistem** (check-in ve check-out). Ekranda değiştirecek düğme yoktur; bu bilinçlidir. |
| **Kat hizmeti** | Kirli · Temizleniyor · Temiz · Kontrol edildi | Kat görevlisi ve kat şefi (Kat hizmetleri bölümü); sistem de yazar (çıkışta kirli). |
| **Arıza kaydı** | Arızalı (satılamaz) · Hizmet dışı (satılabilir ama misafir yerleştirilmez) | Yönetim; tarihli kayıt olarak açılır (ör. "20–25 Ekim tadilat"). Günü gelince kendiliğinden devreye girer. |

**Arızalı** oda satılabilir oda sayısından düşer (envanter azalır). **Hizmet dışı** oda sayıdan düşmez, oda satılmış sayılır ama kimse o odaya atanamaz (ör. perde değişimi). İkisi de oda atamayı engeller.

### Aktörler ve manuel görevler

Ön büroyu ilgilendiren üç aktör vardır:

- **Oda aktörü** (room-worker): yeni rezervasyona uygun odayı seçip atar; misafir giriş yapınca odayı **dolu**, çıkış yapınca **boş + kirli** yapar; yanlış giriş/çıkış geri alınınca doluluğu düzeltir.
- **Rezervasyon aktörü** (reservation-worker): kanaldan (WhatsApp, web chat, web sitesi widget'ı, OTA) gelen rezervasyon isteğini müsaitlik ve fiyat denetimiyle açar; yer yoksa gerekçeli ret üretir.
- **Folyo aktörü** (billing-worker): girişte folyoyu açar, oda ücretlerini işler; ayrıntısı bir sonraki bölümde.

Bir aktör kapalıysa ya da hata verirse işi **kaybolmaz**: yan menüdeki **Görevler** ekranına "manuel görev" olarak düşer ve personel aynı işi elle yapar. Kılavuzun "Arka planda ne oluyor" bölümünde aktör paneli anlatılır.

## Rezervasyonlar

**Nerede:** Ön büro → Rezervasyonlar. Alt sekmeler: **Liste** (`/rezervasyonlar/liste`), **Yeni rezervasyon** (`/rezervasyonlar/yeni`), **Bekleme listesi** (`/rezervasyonlar/bekleme-listesi`), **Gruplar** (`/gruplar`). Bir rezervasyonun ayrıntısı `/rezervasyonlar/<kimlik>` adresinde açılır.

**Yetki:** görmek için "rezervasyon görüntüleme"; açma, düzenleme, iptal, gelmedi ve bekleme listesi için "rezervasyon yönetimi". Fiyatı elle girmek ayrı bir yetkidir ("elle fiyat"); varsayılan rol matrisinde yönetici ve müdürde açık, ön büroda kapalıdır.

### Rezervasyon listesi

**Ne yapar:** otelin bütün rezervasyonlarını süzgeçle gösterir.

**Görünümler (üst şerit):** Tümü · Bugün gelecek · Bugün gidecek · İçeride · Gelecek · Opsiyonlu. "Bugün" otelin iş günüdür.

**Süzgeçler:** durum, kaynak (Resepsiyon, Telefon, E-posta, Acente, Web chat, WhatsApp, Web sitesi, Online kanal), oda tipi, grup, tarih aralığı. **Arama** kutusu ad, onay kodu, telefon ya da oda numarası alır. Sıralama: giriş tarihi (yakın önce / uzak önce) ya da son açılan önce.

**Dikkat:** liste sayfalıdır; toplam sayı 2000'de kesilir (büyük otelde "2000+" görürsünüz). Üç harften kısa adla arama yapılmaz.

#### Ekranda gördüğünüz alanlar

| Alan | Anlamı |
| --- | --- |
| Onay kodu | Rezervasyonun kimliği (misafire söylenen kod); aramada tam eşleşir |
| Misafir | Ad soyad; tıklayınca misafir kartı |
| Giriş / Çıkış · gece | Konaklama aralığı ve gece sayısı (çıkış günü sayılmaz) |
| Oda tipi · Oda | Tip kodu; oda atanmışsa numarası, atanmamışsa "oda bekliyor" |
| Kişi | "2+1" = 2 yetişkin, 1 çocuk |
| Pansiyon | RO / BB / HB / FB / AI / UAI |
| Kaynak | Resepsiyon, Telefon, E-posta, Acente (acente adı), Web chat, WhatsApp, Web sitesi, Online kanal |
| Durum rozeti | Opsiyonlu · Kesin · İçeride · Çıktı · İptal · Gelmedi |
| Toplam | Gecelerin toplamı (indirim düşülmüş); fiyat elle girilmişse işaretli |
| Grup | Grup adı / kodu; tıklayınca grup dosyası |
| Açılış | Açan kişi ve zaman |

**Örnek — listeyi okumak:** 14 Kasım sabahı "Bugün gelecek" görünümünde 6 satır: 4'ü Kesin ve odası atanmış, 1'i Kesin ama "oda bekliyor" (Oda aktörü uygun oda bulamamış — Odalar → Oda atama'dan elle verilir), 1'i Opsiyonlu (misafir onaylamadı; gelmezse akşam "Gelmedi" değil, önce onay durumu sorgulanır). "Bugün gidecek" görünümünde 5 satır, birinin çıkışı 13 Kasım'dı ve hâlâ İçeride (gecikmiş çıkış; Gidecekler listesinde üstte kırmızı görünür).

### Rezervasyon ayrıntısı

Bara ya da satıra tıklayınca açılan sayfa dört kart gösterir:

- **Konaklama:** giriş, çıkış, oda tipi, oda (varsa "bu odada ... tarihinden beri" — oda değiştirmiş misafirde), kişi sayısı, pansiyon, paket, kaynak, acente, kanal, açan kişi ve zaman, onay zamanı.
- **Misafir:** ad soyad, uyruk, telefon, e-posta; misafir kartına bağlantı.
- **Fiyat:** gece gece döküm (taban fiyat, sezon çarpanı ya da fiyat planı adı, indirim), vergi dökümü (bilgi amaçlı; tahsilat folyoda), iptal koşulu, varsa promosyon ve kupon.
- **Folyo:** pencereler, bakiyeler, "eksik oda ücreti" uyarısı, folyo ekranına bağlantı; gelmeden önce "Ön ödeme al".
- **Misafir portalı** kartı: portal bağlantısı, QR, davet ve online check-in durumu (aşağıda ayrı anlatılır).

**İşlemler:** Onayla (opsiyonludan kesine), Düzenle, İptal, Gelmedi, İptali / gelmediyi geri al. Hangi düğmenin açık olduğuna **sunucu** karar verir; kapalı düğmenin yanında sebebi yazar.

**Geçmiş** sekmesi: bu rezervasyona dokunan her işlemin adımları — kim yaptı, hangi aktör ne zaman devreye girdi, hangi alan neye değişti. Şikâyet incelemesinde ilk bakılacak yer burasıdır.

#### İşlem düğmeleri — ne zaman açık

| Düğme | Açık olduğu durum | Kapalıysa yazan sebep (örnek) |
| --- | --- | --- |
| Onayla | Opsiyonlu | "Rezervasyon zaten kesin" |
| Düzenle | Opsiyonlu, Kesin, İçeride (yalnız çıkış ve not) | "Çıkmış rezervasyon düzenlenemez" |
| İptal | Opsiyonlu, Kesin | "İçerideki misafir iptal edilemez — çıkış yapın" |
| Gelmedi | Opsiyonlu / Kesin ve giriş günü gelmiş | "Giriş günü gelmedi" |
| İptali / gelmediyi geri al | İptal / Gelmedi ve çıkış tarihi geçmemiş | "Çıkış tarihi geçti" |
| Ön ödeme al | Gelmeden önce | — |
| Oda değiştir / ata | Odası olan ya da olmayan açık rezervasyon | "Konaklama bitti" |

**Örnek — geçmiş okuması:** FLX-3M8K: "01.02 10:12 Ayşe — açıldı (Kesin, 8.415 TL, kupon BAHAR15)" → "01.02 10:12 Oda aktörü — oda 405 atandı" → "01.02 10:12 Bildirim — onay e-postası kuyruğa" → "20.02 15:40 Mehmet — düzenlendi: çıkış 18.03 → 19.03; eklenen gece 3.300 (plan), indirim yeniden hesaplandı −1.980 → toplam 11.220" → "20.02 15:40 Oda aktörü — 405 uygun (18.03 boş), atama korundu" → "15.03 14:05 Ayşe — giriş yapıldı, oda 405, teminat nakit 1.000" → "15.03 14:05 Folyo aktörü — folyo açıldı, teminat ödemesi işlendi".

### Yeni rezervasyon formu

**Ne yapar:** tek oda ya da grup için rezervasyon açar; müsaitliği ve fiyatı siz yazarken canlı hesaplar.

**Adım adım (tek oda):**

1. **Giriş** ve **Çıkış** tarihlerini seçin (geçmiş tarih seçilemez; çıkış girişten en az bir gün sonra).
2. **Rezervasyon türü**: Tek oda ya da Grup.
3. **Kaynak**: Resepsiyon, Telefon, E-posta ya da **Acente**. Acente seçilince aramalı acente seçici açılır; fiyat kontrattan gelir (aşağıda).
4. Sistem "Müsaitlik hesaplanıyor…" der, sonra **oda tipi kartları** gelir: her tipte kaç oda boş, gecelik toplam, varsa liste fiyatı ve indirim, kapasiteye sığmayan tipler soluk. Bir tip seçin.
5. **Yetişkin** ve **Çocuk** sayısı; **Pansiyon** (RO/BB/HB/FB/AI/UAI — otelin varsayılanıyla açılır); isterseniz **Paket**.
6. **Misafir**: arama kutusuna ad, telefon ya da e-posta yazın (telefon/e-posta için 2, ad için 3 karakter yeter). Mevcut kart çıkarsa seçin; yoksa yeni misafir alanlarını doldurun. Seçili misafirin **CRM önizlemesi** (etiketler: VIP, Sorunlu…; tercihler: kat, yastık, alerji) formun içinde görünür — CRM yetkiniz varsa.
7. **Kupon** kodu varsa girin; tip kartında "uygulanıyor / daha avantajlısı var / uymuyor / geçersiz / hak yetmez" biçiminde durumu yazar.
8. **Durum**: Kesin (onaylı) ya da Opsiyonlu (onay bekliyor). **Not** alanı serbesttir.
9. Yetkiniz varsa **"Fiyatı elle gir"**: Toplam ve **Gerekçe** (zorunlu; gerekçesiz elle fiyat kaydedilemez).
10. **Kaydet**. Üç sonuç olabilir: rezervasyon açıldı; "aynı istek daha önce açılmıştı" (çift tık korunması — ikinci kayıt oluşmaz); ya da yer yoktu ve istek **onaya gönderildi** (otel politikası "onaya gönder" ise).

**Misafir eşleştirme sorusu:** telefon ya da e-posta mevcut bir kartla eşleşiyor ama ad soyad farklıysa sistem size sorar: "bu kişi mi, yoksa yeni kart mı?". Telefonlar otelin ülke koduyla okunur (`0532…` yazarsanız `+90532…` kaydedilir). Kanaldan gelen istek bu soruyu soramadığı için yeni kart açar; mükerrerleri sonradan misafir kartından birleştirirsiniz.

#### Fiyat nasıl hesaplanır — öncelik sırası

Fiyat **gece gece** hesaplanır; toplam gecelerin toplamıdır. Bir gecenin fiyatı şu sırayla belirlenir (üstteki varsa alttakilere bakılmaz):

1. **Elle girilen fiyat** (yetki + gerekçe ister). Toplam gecelere eşit bölünür. Elle fiyatlı rezervasyonun konaklaması sonradan değişirse sistem "fiyat kararı" ister: yeni toplamı siz söylersiniz.
2. **Acente kontratı**: kaynak Acente ise her gece, o günü kapsayan satıştaki kontratın oda tipi × pansiyon fiyatından yazılır. Kontratta fiyatı olmayan gece ya da **stop-sale** günü reddedilir (hangi geceler olduğu mesajda yazar). Stop-sale elle fiyatla da aşılmaz. Acente satışına promosyon ve kupon uygulanmaz.
3. **Paket**: seçilince pansiyon paketten gelir ve gece fiyatı paketin sabit gecelik fiyatıdır. Sezon, fiyat planı, kişi başı ek, promosyon, kupon, acente fiyatı hiçbiri paketle birleşmez (sistem reddeder). Paket bileşenleri (SPA, transfer…) bilgi amaçlıdır; folyoya ayrı kalem olarak **yansımaz** (bu ileriki sürüm işi).
4. **Fiyat planı**: oda tipi × pansiyon × tarih aralığı için tanımlı sabit gecelik fiyat (Ayarlar → Fiyat planları). Plan fiyatı belirli kişi sayısı içindir; fazla yetişkin ve çocuk için kişi başı ek eklenir. Plan varsa sezon çarpanı **uygulanmaz**.
5. **Sezon × taban fiyat**: plan yoksa oda tipinin taban fiyatı × o gecenin sezon çarpanı.

Bunların üstüne iki katman daha gelir:

- **Dinamik fiyat çarpanı** (onaylanmış fiyat önerisi): plan ve sezon fiyatını oransal ölçekler; acente kontratı, paket ve elle fiyat etkilenmez. Hiçbir fiyat kendiliğinden değişmez; her öneri onay kuyruğundan geçer.
- **Promosyon / kupon**: doğrudan satışta liste fiyatının üstüne **tek indirim** — uygun otomatik promosyonlar ve girilen kupon arasından misafire en avantajlısı. Kupon daha avantajlı değilse kullanılmaz ve hakkı düşmez. İndirim türleri: yüzde, konaklama başına tutar, "X gece kal Y gece öde". Koşullar (satış dönemi, konaklama dönemi, en az gece, erken rezervasyon günü, oda tipi, pansiyon, kanal) rezervasyona **kopyalanır**: promosyon sonradan değişse de misafire verilen söz değişmez. Konaklama kısalır ve şart bozulursa indirim kalkar (düzenleme önizlemesi bunu önceden söyler; fark folyoya işlenir).

**Vergi dökümü** formda ve ayrıntıda görünen bilgi amaçlı bir hesaptır; gerçek tahsilat folyodan yapılır.

#### Örnek — 15–18 Mart, 2 yetişkin 1 çocuk, Deluxe

Otelin tanımları: Deluxe taban fiyatı 2.000 TL; "Yüksek sezon" 15 Mart–30 Nisan çarpanı 1,20; Deluxe × BB fiyat planı 1 Mart–31 Mart: 3.000 TL / gece, 2 kişi için, fazla yetişkin 600, çocuk 300; "Erken rezervasyon %10" promosyonu: 30 gün önce alınan, en az 3 gece, BB; kupon `BAHAR15`: %15, tek kullanımlık. Form 1 Şubat'ta dolduruluyor.

1. Giriş 15.03, çıkış 18.03 → **3 gece** (15, 16, 17 Mart). Çıkış günü 18 Mart sayılmaz.
2. Kaynak Resepsiyon, tür Tek oda. Sistem müsaitliği hesaplar: Deluxe her gece için 3 boş.
3. Oda tipi kartı Deluxe: pansiyon BB seçildi. Gece fiyatı **fiyat planından** gelir (plan varsa sezon çarpanı uygulanmaz): 3.000 + çocuk 300 = **3.300 TL / gece** → 3 gece **9.900 TL** liste.
4. Promosyon: 30 gün önce (1 Şubat → 15 Mart = 42 gün ✓), 3 gece ✓, BB ✓ → %10 = 990 TL. Kupon `BAHAR15` girildi → %15 = 1.485 TL; kupon daha avantajlı → **kupon uygulanır**, promosyon uygulanmaz. Tip kartı: "Liste 9.900 · İndirim −1.485 (BAHAR15) · Toplam **8.415 TL**". Kupon kartında "uygulanıyor".
5. Gece dökümü (ayrıntıda): 15.03 3.300 − 495 = 2.805; 16.03 2.805; 17.03 2.805 (kaynak: "Deluxe BB planı", indirim BAHAR15). Vergi dökümü (bilgi): %10 dahil → net 7.650,00, KDV 765,00.
6. Pansiyon HB seçilseydi ve Deluxe × HB planı yoksa: 2.000 × 1,20 (Yüksek sezon) = 2.400 TL / gece, kişi başı ek yok (plan yok), 3 gece 7.200; promosyon BB şartı tutmaz, kupon şartı yoksa %15 → 6.120.
7. Kaynak **Acente** "Tur A.Ş." seçilseydi: kontratın Deluxe × BB dönem fiyatı (ör. 2.600) × 3 = 7.800; kupon ve promosyon **uygulanmaz**; 16 Mart stop-sale ise form "16.03 gecesi satışa kapalı" der ve kaydetmez.
8. "Fiyatı elle gir" 8.000 + gerekçe "kurumsal anlaşma" → geceler 2.666,67 / 2.666,67 / 2.666,66; indirim kalkar (elle fiyatta promosyon yok); fiyat modu "Elle girilen fiyat".
9. Kaydet → "Rezervasyon açıldı · FLX-3M8K". Arka planda Oda aktörü 15–18 Mart'ta boş, kapasitesi 3 olan bir Deluxe seçer (ör. 405) ve atar; bildirim merkezi onay bildirimini kuyruğa alır (kesin olduğu için hemen).

#### Düzenleme kuralları

- Anlaşılan geceler anlaşılan fiyatında kalır; **eklenen geceler** güncel fiyatla hesaplanır. Oda tipi değişirse bütün geceler yeni tipin fiyatıyla yeniden hesaplanır.
- İçerideki misafirde giriş tarihi ve oda tipi kilitlidir; yalnızca çıkış uzatılır/kısaltılır. Odası o gecelerde doluysa uzatma reddedilir — misafiri oda planından taşıyın.
- Atanmış oda yeni hâle uymuyorsa (tip, kapasite, arıza, başkasına ait gece) atama kendiliğinden kalkar ve rezervasyon "oda bekleyen" olur.
- Acente sonradan atanabilir / değiştirilebilir / kaldırılabilir (geceler yeniden fiyatlanır); içerideki misafirde acente değişmez.
- Düzenleme penceresi yazmadan önce **önizleme** gösterir: yeni toplam, indirimin akıbeti, folyoya düşecek fark.

#### İptal ve gelmedi

- **İptal:** sebep zorunlu. Ceza, iptal politikasına göre hesaplanır (Ayarlar → Genel parametreler: "X gün öncesine kadar ücretsiz", sonrası toplam × ceza oranı). Tutar önceden gösterilir; personel gerekçeyle uygulamayabilir (denetim izine politika tutarı yazılır). Kuponlu rezervasyon iptal edilince kupon hakkı geri açılır.
- **Gelmedi (no-show):** giriş günü gelmiş ama misafir gelmemişse. Ücret ilk gecenin fiyatıdır; gerekçeyle vazgeçilebilir. Oda yeniden satışa açılır. Gün kapanışı sihirbazı, gelmeyenleri toplu olarak işaretler.
- **Geri alma:** iptal ya da gelmedi kaydı, çıkış tarihi geçmediyse geri alınır; yer yeniden denetlenir, eski oda doluysa atama kalkar. Kuponla açılmış rezervasyonda kupon hakkı başkasına gitmişse geri alma reddedilir.

**Arka planda:** iptal / gelmedi ücreti **folyo aktörü** tarafından folyoya "İptal ücreti" / "Gelmedi ücreti" kalemi olarak işlenir ("Diğer" vergisiyle); geri alınınca aynı aktör ters kayıtla düşer.

| Tetikleyici | Aktör / kim | Sonuç | Nerede görünür | Kapalıysa |
| --- | --- | --- | --- | --- |
| İptal | Sunucu | Durum İptal; oda ataması kalkar; envanter döner; kupon hakkı açılır; bekleme listesi taranır | Liste (İptal rozeti), oda planı (bar kalkar) | — |
| İptal (ceza > 0) | Folyo aktörü | "İptal ücreti" kalemi (folyo yoksa açılır) | Folyo; Folyolar → Açık bakiye | "Folyo" manuel görevi |
| Gelmedi | Sunucu + folyo aktörü | Durum Gelmedi; ilk gece ücreti kalemi; oda satışa döner | Liste, folyo | Manuel görev |
| Geri al | Sunucu + folyo aktörü | Yer denetlenir; durum Kesin / Opsiyonlu; ücret ters kayıtla düşer; eski oda doluysa atama kalkar → oda aktörü yeniden atar | Liste, folyo, şerit | Manuel görev |
| Gün kapanışı "Gelmeyenler" adımı | Gece görevlisi | Toplu Gelmedi (ücret "uygulama" seçeneğiyle) | Rezervasyonlar, folyolar | — |

**Örnek — iptal cezası:** Politika "3 gün öncesine kadar ücretsiz, sonrası %50". FLX-3M8K (15 Mart giriş, toplam 8.415) 13 Mart'ta iptal ediliyor → süre içinde değil → ceza 8.415 × %50 = **4.207,50 TL** pencerede gösterilir. Sebep "misafir hastalandı"; resepsiyon "cezayı uygulama" işaretler → denetim izinde "politika tutarı 4.207,50, uygulanmadı". Uygulansaydı: folyo aktörü folyoyu açar, "İptal ücreti 4.207,50" kalemi ("Diğer" vergisiyle); misafirden tahsil edilince folyo kapanır ve fatura taslağı çıkar. Kupon BAHAR15 hakkı geri açılır; 15–18 Mart Deluxe envantere döner; bekleme listesinde Deluxe bekleyen varsa zil çalar. 10 Mart'ta iptal edilseydi ceza 0 olurdu.

#### Opsiyonlu rezervasyon

"Opsiyonlu (onay bekliyor)" durumla açılan rezervasyon envanteri tutar ama misafire onay bildirimi **gitmez**; "Rezervasyonu onayla" düğmesiyle kesine çevrilince bildirim gider. Web sitesi widget'ından gelen rezervasyonlar da opsiyonlu açılır (ödeme adımı henüz olmadığı için); resepsiyon onaylar.

#### Overbooking (kapasite aşımı) onayı

Ayarlar → Genel parametreler → "Kapasite aşımı" iki seçenek sunar:

- **Reddet:** yer yoksa rezervasyon açılmaz; form "bekleme listesine al" önerir.
- **Onaya gönder:** istek Yönetim → Onaylar kuyruğuna düşer. Yönetici onaylarsa aynı istek kapasite aşılarak açılır (açan: isteyen personel; onaylayan ayrıca kayıtlıdır); isteyenin ziline sonuç düşer. Reddedilirse açılmaz.

Düzenleme, geri alma ve **kanaldan gelen istekler** (WhatsApp, OTA, widget) onaya gitmez; yer yoksa reddedilir.

**Adım adım — onaya giden rezervasyon:**

1. Politika "Onaya gönder". 20 Mart'ta Standart odanın tümü (10 oda) satılmış; resepsiyonist 20–21 Mart Standart rezervasyon açmaya çalışır.
2. Form yer olmadığını gösterir (Standart kartı kırmızı, "0 boş") ama kaydetmeye izin verir. Kaydet → cevap: **"İstek yönetici onayına gönderildi"**; rezervasyon henüz açılmamıştır, listede görünmez.
3. Yönetim → Onaylar → Bekleyen'de "Kapasite aşımı — Standart, 20–21 Mart, 1 oda, isteyen: Ayşe" satırı; yöneticinin ziline düşer. Ayşe kendi isteğini onaylayamaz.
4. Yönetici **Onayla** → aynı istek kimliğiyle rezervasyon **kapasite aşılarak** açılır (Standart 20 Mart: −1 → müsaitlik tablosunda kırmızı); açan "Ayşe", onaylayan "Müdür" kayıtlıdır; Ayşe'nin ziline "onaylandı" düşer; oda aktörü oda bulamaz → rezervasyon "oda bekliyor" (oda planı şeridinde). Resepsiyon o gün bir iptal / yükseltme ile çözer.
5. Yönetici **Reddet** → hiçbir şey açılmaz; Ayşe'nin ziline "reddedildi"; misafire bekleme listesi önerilir.

| Tetikleyici | Aktör / kim | Sonuç | Nerede görünür | Kapalıysa |
| --- | --- | --- | --- | --- |
| Yer yok + politika Reddet | Sunucu | "Yer yok" hatası; "bekleme listesine al" önerisi | Form | — |
| Yer yok + politika Onaya gönder | Sunucu → onay kuyruğu | Onay kaydı; rezervasyon yok | Onaylar → Bekleyen; yönetici zili | — |
| Onaylandı | Onaylayan yönetici | Rezervasyon açılır (kapasite aşımı), isteyene zil | Liste, oda planı şeridi | Aktör işi değil; onay sunucuda açar |
| Reddedildi / süresi doldu | Yönetici / zaman | Açılmaz; isteyene zil | Onaylar → Geçmiş | — |

**Teknik güvence:** son odaya aynı saniyede gelen iki rezervasyondan yalnızca biri açılır; ikincisi "yer yok" alır. Aynı fiziksel odaya çakışan iki rezervasyon veritabanı seviyesinde engellenir.

### Bekleme listesi

**Nerede:** Rezervasyonlar → Bekleme listesi.

**Ne yapar:** yer yokken misafiri listeye alır; yer açılınca haber verir.

**Adım adım:**

1. Yeni rezervasyon formunda yer yoksa "Bekleme listesine al" düğmesine basın (misafir iletişimi, tip, tarih, kişi sayısı kayda geçer). Ya da bu ekrandan doğrudan kayıt açın.
2. Yer açılınca kayıt **"Yer açıldı"** olur ve rezervasyon yetkililerinin **ziline** düşer. Zildeki bağlantı bu ekranı ilgili satır vurgulu açar.
3. Misafiri arayın, "Rezervasyona çevir" ile form kayıtla dolu açılır; rezervasyon açılınca kayıt kapanır ("Rezervasyona çevrildi").
4. Misafir vazgeçtiyse "Kapat" (Vazgeçildi). Giriş tarihi geçen kayıt kendiliğinden "Tarihi geçti" olur.

**Arka planda:** envanteri artırabilen her olaydan (iptal, gelmedi, tarih kısaltma, arıza kaydının kapanması, acente kotasının serbest kalması) sonra sistem bekleme listesini tarar; ayrıca her 5 dakikada bir güvenlik taraması yapar. Yer dolunca kayıt "Yer bekliyor"a geri döner. Acente kotasında tutulu odaya zil **çalmaz**.

**Görünümler:** varsayılan açık kayıtlar (en yakın giriş önce); "Kapananlar" çevrilen, vazgeçilen ve tarihi geçenleri gösterir.

#### Ekranda gördüğünüz alanlar

| Alan | Anlamı |
| --- | --- |
| Misafir / iletişim | Ad, telefon ya da e-posta (aramak için) |
| Oda tipi · tarih · kişi | İstenen konaklama |
| Durum | Yer bekliyor · **Yer açıldı** · Rezervasyona çevrildi · Vazgeçildi · Tarihi geçti |
| Yer açıldı zamanı | Zilin çaldığı an; "Yer bekliyor"a geri dönmüşse boşalır |
| Rezervasyona çevir | Formu kayıtla dolu açar |
| Kapat | Vazgeçildi olarak kapatır |

| Tetikleyici | Ne olur | Nerede görünür | Not |
| --- | --- | --- | --- |
| İptal, gelmedi, erken çıkış, tarih kısaltma, arıza kaydı kapanması, acente kotası azalması | Sistem 2 sn içinde otelin bekleme listesini tarar (ayrıca her 5 dk güvenlik taraması) | — | Birleştirilmiş tarama: 50 iptal 50 tarama demek değildir |
| Kayda uyan yer açıldı | Durum **Yer açıldı**; rezervasyon yetkililerinin ziline "bekleme listesinde yer açıldı" | Zil, liste | Acente kotasında tutulu odaya çalmaz |
| Yer tekrar doldu (başkası aldı) | Durum **Yer bekliyor**'a döner | Liste | — |
| Giriş tarihi geçti | **Tarihi geçti** | Kapananlar | — |
| Rezervasyona çevrildi | Kapanır | Kapananlar | — |

**Örnek:** 20–21 Mart Standart dolu; misafir Kemal B. listeye alınır (telefon, 2 kişi). 18 Mart 14:02'de başka bir misafirin 20–22 Mart Standart rezervasyonu iptal edilir → 14:02:02 tarama → Kemal B. "Yer açıldı", resepsiyon ziline bildirim. 14:05 resepsiyon arar, "Rezervasyona çevir" → form 20–21 Mart, Standart, 2 kişi, Kemal B. ile dolu; kaydet → rezervasyon açılır, bekleme kaydı "Rezervasyona çevrildi". Resepsiyon aramadan 14:30'da web sitesinden başka biri 20 Mart Standart alırsa kayıt "Yer bekliyor"a döner — zil çaldığında hızlı davranmak gerekir.

### Grup rezervasyonu ve grup dosyası

**Nerede:** Yeni rezervasyon formunda tür "Grup"; grup dosyaları Rezervasyonlar → Gruplar (`/gruplar`, dosya `/gruplar/<kimlik>`).

**Grup formu:** Grup adı (ör. "ABC Kongre") ve satırlar: oda tipi, oda sayısı, yetişkin/oda, çocuk/oda, pansiyon, isteğe bağlı satır misafiri (ad soyad yeter; iletişim grup sorumlusunda). Bir satırdaki tip satılamıyorsa (yer yok, kontratta fiyat yok) **grubun hiçbiri açılmaz** — ya hep ya hiç.

**Rooming list:** "Excel'den yükle" ile şablonu indirip doldurun: Ad, Soyad, Oda tipi kodu, Pansiyon, Yetişkin, Çocuk. Dosya tarayıcıda okunur; hatalı satırlar numarasıyla listelenir, geçerliler grup satırlarına dolar. Rooming list **ortak tarihlidir** (grubun giriş/çıkışı); satır başına farklı tarih ileriki sürümde.

**Grup dosyası ekranı:** grubun rezervasyonları, durum dağılımı, folyo bakiyeleri ve toplamlar; seçimli **toplu oda atama**, **toplu check-in** (en fazla 50; kimlik bilgisi karttan ya da online check-in'den okunur), **toplu check-out**, grup iptali. Toplu işlemler tek tek işlemin aynı kurallarından geçer: odası atanmamış ya da kimliği eksik kayıt "ayrıntı ister" diye **atlanır** ve sebebiyle listelenir — o kayıtları tek tek alırsınız.

**Grup master folyo:** grubun hesabını tek folyoda toplamak için folyo ekranındaki **Birleştir** kullanılır (bkz. Folyo bölümü); grup dosyası yalnızca bakiyeleri okur.

#### Grup dosyası — ekranda gördüğünüz alanlar

| Alan | Anlamı |
| --- | --- |
| Grup adı / kodu, tarih aralığı | Grubun kimliği |
| Durum dağılımı | Kaç oda Kesin / İçeride / Çıktı / İptal |
| Toplamlar | Rezervasyon toplamı, folyo borç / ödenen / **bakiye** (birleştirilmiş pencereler hariç) |
| Rezervasyon satırı | Misafir, tip, oda, durum, bakiye; seçim kutusu |
| Toplu oda atama | Seçili odasız rezervasyonlara otomatik oda |
| Toplu check-in | Seçili rezervasyonlar (≤ 50); sonuç listesi: giren / atlanan (sebebiyle) |
| Toplu check-out | Seçili içerideki rezervasyonlar; bakiyesi açık olan atlanır |
| Grup iptali | Açık odaların tümü, sebep zorunlu |

**Örnek — 20 odalık tur grubu:** "Baltık Turu" 10–13 Nisan, acente "Tur A.Ş.", 20 Standart BB, rooming list Excel'den 20 satır (18 geçerli, 2 satırda oda tipi kodu yanlış → düzeltilip yeniden yüklenir). Kontrat fiyatı 2.600 × 3 gece × 20 = 156.000 TL. Acentenin Standart kotası 15 ise: 15 oda kotadan, 5 oda genel havuzdan (yer varsa) açılır; kota dolmuş diye reddedilmez. 10 Nisan 14:00 otobüs gelir: grup dosyasında 20 satır seçilir → **Toplu oda atama** → 20 oda; **Toplu check-in** → 17 giriş yapılır, 3 atlanır: 2'sinde kimlik bilgisi eksik (rooming list'te belge yok; karttan da okunamadı), 1'inde oda Arızalı çıktı. Bu 3'ü Gelecekler'den tek tek alınır. Giriş yapılan 17 odanın folyoları açılır; acente ödeyeceği için her odada 2. pencere yerine daha pratik yol: rehberin odasında **Birleştir** ile 20 odanın "Oda" kalemlerini master folyoya toplamak ve ödeyeni "Tur A.Ş." yapmak; ekstralar her odanın 1. penceresinde kalır. 13 Nisan çıkışta **Toplu check-out**: ekstrası ödenmemiş 2 oda atlanır, resepsiyon tahsil eder, sonra çıkarır.

**Acente kotası (allotment):** acente kartındaki "Kota" sekmesinde tanımlanır. Kota bir **garantidir, tavan değil**: acentenin kotası dolunca satış genel havuzdan devam eder. Release günü (giriş gecesi − release gün sayısı) gelince kullanılmamış kota herkese açılır. Yeni rezervasyon formunda "N oda acente kotasında tutulu" mesajı görürseniz sebebi budur. **Oda planı kota düşümünü göstermez**; planda boş görünen oda satışta kotaya takılabilir — kota görünürlüğü acente kartındaki kullanım tablosundadır.

## Oda planı

**Nerede:** Ön büro → Oda planı (`/oda-plani`).

**Ne yapar:** otelin tamamını tek ekranda gösterir — satır oda, sütun gece. Barlar konaklama, şeritler arıza kaydı. Resepsiyonun "nerede kim var, hangi oda ne zaman boşalır" sorusunun cevabı burasıdır.

### Ekranın üç katmanı

1. **Oda bekleyen rezervasyonlar şeridi** (üstte): odası atanmamış rezervasyonlar. Envanteri tüketirler ama hiçbir satırda görünmezler; bu şerit olmasaydı "8 oda boş" görüp aslında 3'ünün satılmış olduğunu kaçırırdınız. Kartı bir odanın satırına **sürükleyin** ya da karta tıklayıp çekmeceden oda seçin; "Otomatik ata" düğmesi uygun odayı sistemin seçmesini sağlar.
2. **Izgara:** 7 / 14 / 30 günlük pencere, "bugüne git", tarih seçici; kat, oda tipi ve durum süzgeçleri; misafir adı / onay koduyla arama. Satır başında odanın doluluğu ve kat hizmeti durumu. Pencereden taşan barlar kırpılır ve ok işaretiyle "devam ediyor" denir. Oda değiştirmiş misafir iki bar olur (eski odada "taşındı", yeni odada "taşındı geldi").
3. **Çekmece:** bara tıklayınca açılır — misafir, konaklama, bütün pencerelerin toplam folyo bakiyesi, oda geçmişi, işlemler (oda değiştir, atamayı kaldır, rezervasyon sayfasına git). Hangi işlemin açık olduğunu sunucu söyler.

### Adım adım

- **Boş hücreye tıklamak** o oda ve tarihle yeni rezervasyon formunu açar (form adresten ön dolar).
- **Oda değiştirmek:** barı başka satıra sürükleyin. Sürüklerken yeşil/kırmızı çerçeve yalnızca ipucudur; kararı (arıza, kapasite, overbooking) sunucu verir. **İçerideki misafiri** taşırken onay ve **sebep** istenir (arıza mı, misafir talebi mi, upgrade mi) — gece kapanışında ve şikâyette ilk sorulan şey budur.
- Dokunmatik ekranda ve klavyeyle sürükleme yoktur; her bar Enter ile çekmeceyi açar, oda değişikliği oradan yapılır.
- Görünüm (tarih, gün sayısı, süzgeçler) adres çubuğunda durur: sayfa yenilenince kaybolmaz, "şu tarihe bak" diye bağlantı paylaşılabilir.

### Arka planda

- İçerideki misafir taşınınca **aynı işlemde** eski oda boş + kirli, yeni oda dolu olur; geçmiş geceler eski odada kalır (oda geçmişi). Kat hizmeti aktörü eski oda için çıkış temizliği açmaz (çıkış değil, taşınmadır) — oda kirli göründüğü için sabah listesine düşer.
- Ekran canlıdır: başka bir resepsiyonist bir şey değiştirince birkaç saniye içinde yansır. Bağlantı koparsa rozet "canlı değil" olur ve ekran periyodik tazelemeye düşer.
- Üstteki günlük özet (giriş / çıkış / doluluk) sayfalanmaz; otelin tamamından hesaplanır. Doluluk paydası satılabilir odadır (toplam − arızalı); oda bekleyen rezervasyonlar paya dahildir. Öğleden sonra "8 çıkıştan 5'i yapıldı" gibi okunur.

### Ekranda gördüğünüz alanlar

| Alan | Anlamı |
| --- | --- |
| Günlük özet (üst) | Giriş (yapılan / beklenen), çıkış (yapılan / beklenen), doluluk %, satılabilir oda; otelin tamamından |
| Pencere düğmeleri | 7 / 14 / 30 gün; "Bugün"; tarih seçici; ok tuşları |
| Süzgeçler | Kat, oda tipi, durum; ad / onay kodu arama |
| Satır başı | Oda numarası, tip; doluluk noktası (dolu / boş) ve kat hizmeti rengi; arıza işareti |
| Bar | Misafir adı, kişi sayısı, durum rengi (opsiyonlu / kesin / içeride / çıktı); "devam ediyor" oku; taşınma işaretleri |
| Şerit (arıza) | Kayıt türü ve sebebi; tarih aralığı |
| Oda bekleyenler şeridi | Odası olmayan rezervasyon kartları: misafir, tip, tarih; "Otomatik ata" |
| Çekmece | Misafir, konaklama, **toplam bakiye** (bütün pencereler), oda geçmişi, işlemler (açık / kapalı sebebiyle), "Rezervasyon sayfası" |
| Canlı rozeti | "Canlı" / "Canlı değil — periyodik tazeleme" |

| Tetikleyici | Aktör / kim | Sonuç | Nerede görünür | Kapalıysa |
| --- | --- | --- | --- | --- |
| Yeni rezervasyon açıldı | Oda aktörü | Uygun oda atanır → bar ızgaraya iner | Izgara (önce şeritte görünür, saniyeler sonra satıra) | Kart şeritte kalır; "Otomatik ata" ya da sürükleme |
| Şeritten odaya sürüklendi | Sunucu (oda değişikliği servisi) | Atama; kapasite / arıza / overbooking denetimi | Bar satırda | — |
| İçerideki misafir taşındı | Sunucu | Aynı işlemde eski oda boş + kirli, yeni oda dolu; oda geçmişi | İki bar; kat haritası | Aktör işi değil |
| Herhangi bir rezervasyon / oda değişikliği | Canlı yayın | Açık planlar birkaç saniyeye yayılarak tazelenir | Rozet | Bağlantı yoksa 15 sn içinde periyodik tazeleme |

**Örnek:** 14 Kasım, 14 günlük pencere. Satır 305: 12–15 Kasım "Demir, A. (2)" barı (içeride, yeşil), 15 Kasım boş, 16–19 Kasım "Yılmaz, B." (kesin, mavi). Satır 311: 14–16 Kasım kırmızı şerit "Arızalı — klima". Şeritte "Kaya, C. · Deluxe · 15–17 Kasım" kartı. Resepsiyon kartı 305'e sürükler: 15 Kasım'da 305 boş ama 16'da Yılmaz var → çerçeve kırmızı, sunucu "15–17 Kasım'da 305 başkasına ait" der. 404'e sürükler → yeşil → atanır. Demir, A. 14 Kasım'da "klima gürültülü" der → barı 305'ten 307'ye sürükle → onay penceresi, sebep "misafir talebi" → 305 boş + kirli (sabah listesine düşer), 307 dolu; 305 satırında 12–13 Kasım "Demir, A. — taşındı" barı kalır, 307'de 14 Kasım'dan başlayan bar. Çekmecede "Oda geçmişi: 305 (12–14), 307 (14–)".

**Dikkat:** sürükle-bırakla **tarih** değiştirme yoktur; tarih değişikliği rezervasyon ayrıntısındaki Düzenle ile yapılır. Bitmiş konaklamanın oda ataması kaldırılamaz.

## Giriş / çıkış

**Nerede:** Ön büro → Giriş / çıkış (`/on-buro`). Sekmeler: **Gelecekler** (`/on-buro/gelecekler`), **Gidecekler** (`/on-buro/gidecekler`), **Konaklayanlar** (`/on-buro/konaklayanlar`), **Online check-in** (`/on-buro/online-check-in`). Üstte günün özeti: gelecek / gidecek / içeride / gecikmiş sayıları, canlı tazelenir.

**Yetki:** listeleri "konaklama görüntüleme" yetkisi olan herkes görür (kat hizmetleri gidecekleri temizlik sırası için izler); giriş, çıkış ve geri alma "konaklama yönetimi" ister. Bakiyeyle çıkış ayrı bir yönetim yetkisidir.

### Gelecekler

**Görünümler:** "Bekleniyor" (girişi bugün olan ve geç kalanlar — dün gelmesi gerekip gelmeyen ertesi gün de girer) ve "Bugün girenler" (aynı gün yapılan giriş buradan geri alınır).

Satırda: misafir, oda (yoksa "oda verilmemiş"), odanın hazırlığı (temiz / kirli / arızalı), kimlik durumu, online check-in rozeti, "Giriş yap" düğmesi.

#### Ekranda gördüğünüz alanlar (Gelecekler)

| Alan | Anlamı |
| --- | --- |
| Misafir · kişi | Ad, yetişkin + çocuk |
| Onay kodu · kaynak | Rezervasyon kimliği, nereden geldi |
| Giriş → çıkış | Geç kalan misafirde giriş tarihi dünkü (ya da daha eski) görünür |
| Oda | Numara + kat hizmeti rozeti (Kontrol edildi / Temiz / Kirli / Temizleniyor) + arıza işareti; yoksa "Oda verilmemiş" |
| Kimlik | "Kayıtlı" (karttan), "Online check-in — onaylı / inceleme bekliyor", "Eksik" |
| Teminat / ön ödeme | Varsa ön ödeme tutarı |
| Giriş yap | Pencereyi açar; "Bugün girenler"de yerine "Geri al" |

### Check-in penceresi

**Adım adım:**

1. "Giriş yap"a basın. Pencere konaklamayı yükler; **giriş yapılamayacak** bir durum varsa (çıkış günü geçmiş, iptal edilmiş, zaten içeride) üstte sebebiyle söyler.
2. **Oda:** verilmemişse aday odalar listelenir — misafirin tipi önce, en hazır (kontrol edilmiş / temiz) oda başta; kapasitesi yetmeyen ya da overbooking yaratacak oda listelenmez. Seçilen oda girişle **aynı işlemde** atanır. Odada önceki misafir hâlâ içerideyse ya da oda arızalıysa giriş olmaz; oda **kirliyse** uyarı çıkar, personel onaylayarak devam edebilir (otelin tercihi).
3. **Kimlik (KBS):** belgeyi **Kimlik tara** ile okutabilirsiniz (aşağıda ayrı anlatılır) ya da elle girersiniz. Rezervasyon sahibinin belgesi zorunludur — Belge türü (Kimlik kartı / Pasaport / Diğer), Belge numarası (TC kimlik no sağlaması yapılır, pasaport biçimi denetlenir), uyruk, isteğe bağlı doğum tarihi. Otelin politikası "Bütün yetişkinler" ise refakatçi yetişkinlerin de belgesi girilir; **çocuk** işaretlenen refakatçide belge isteğe bağlıdır. Refakatçi belge numarasından tanınır: aynı kişiye ikinci kart açılmaz; belge başka adla kayıtlıysa pencere söyler.
4. **Online check-in'den dolduruldu** uyarısı görürseniz misafir bilgilerini portaldan göndermiştir; form onunla dolu gelir, onay durumu uyarıda yazar. Yalnızca kontrol edin.
5. **Araç plakası** (isteğe bağlı).
6. **Teminat:** Teminat yok / Nakit / Kart provizyonu / Havale-EFT; tutar ve isteğe bağlı provizyon-dekont no. **Kart numarası yazmayın** — kart numarasına benzeyen dizi referansa ve nota kaydedilemez.
7. **Erken giriş ücreti:** otelin giriş saatinden önce giriyorsa ve otelde ücret tanımlıysa (Ayarlar → Genel parametreler → Giriş / çıkış: ücret yok / sabit tutar / gecelik fiyatın yüzdesi) tutar gösterilir. "Ücret uygulama" kutusuyla iyi niyet gösterilebilir; denetim izine politika tutarı yazılır. Pencere açıkken saat geçip tutar değişirse sunucu yazmaz ve yeniden onay ister.
8. **Giriş yap.** Aynı konaklamaya iki resepsiyonist aynı anda giriş yaparsa yalnızca biri olur; diğeri "zaten giriş yapmış" alır.

**Arka planda — giriş yapıldığında:**

- **Oda aktörü** odayı **dolu** yapar. Aktör kapalıysa "Oda dolu olarak işaretlenecek" manuel görevi düşer.
- **Folyo aktörü** konaklamanın **folyosunu açar**, erken giriş ücretini "Oda" vergisiyle kalem olarak işler ve nakit / havale **teminatı ödeme olarak** yazar (kart provizyonu ödeme değildir, çıkışta kartla tahsil edilir). Teminat tutarı büyük ödeme eşiğinin üstündeyse onaya gider.
- **Bildirim merkezi** "hoş geldiniz" bildirimini kuyruğa alır (kanal ve şablon kurulmuşsa).
- Online check-in kaydı varsa "Giriş yapıldı" olur.
- Kimlik numarası listelerde ve denetim izinde **maskeli** gösterilir (KVKK).

| Tetikleyici | Aktör | Sonuç | Nerede görünür | Kapalıysa / hatada |
| --- | --- | --- | --- | --- |
| "Giriş yap" | Oda aktörü | Oda **Dolu** | Oda listesi, kat haritası, oda planı satır başı | "Oda dolu olarak işaretlenecek" manuel görevi; Odalar ekranında doluluk düğmesi yok — görev tamamlanınca sistem yazar |
| "Giriş yap" | Folyo aktörü | Folyo açılır; erken giriş ücreti kalemi; nakit / havale teminatı **ödeme** (kaynak "Giriş teminatı") | Konaklama folyosu; Kasa → Günlük kasa | "Folyo" manuel görevi; folyo ekranında "Teminatı işle" şeridi |
| Teminat ≥ büyük ödeme eşiği | Folyo aktörü → onay kuyruğu | Ödeme "Onay bekliyor" | Onaylar; folyo "Giriş teminatı onay bekliyor" | — |
| "Giriş yap" | Bildirim merkezi | "Hoş geldiniz" bildirimi (kanal + şablon varsa) | Bildirimler → Gönderim geçmişi | Kanal yoksa satır açılmaz |
| "Giriş yap" | Online check-in | Kayıt "Giriş yapıldı" | Online check-in sekmesi | — |
| Giriş geri alındı | Oda aktörü / folyo aktörü | Oda Boş; erken giriş ücreti ve teminat ödemesi ters kayıtla düşer; online check-in "Onaylandı"ya döner | Folyo, oda listesi | Manuel görevler |

**Örnek — teminat 1.000 TL nakit:** 14 Kasım 13:30, Deluxe 405, 3 gece 3.300 TL / gece, otelin giriş saati 14:00, erken giriş ücreti "gecelik fiyatın %20'si". Check-in penceresi: oda 405 "Kontrol edildi" (hazır); kimlik: TC kimlik no girilir (sağlama geçer); refakatçi 1 yetişkin (politika "yalnızca sahibi" — belge istenmez), 1 çocuk; plaka 34 ABC 123; **Teminat: Nakit 1.000 TL**; **Erken giriş ücreti: 660,00 TL** uyarısı (3.300 × %20) — resepsiyon "Ücret uygulama" işaretler (oda hazırdı). "Giriş yap". 13:30:02 oda aktörü 405'i Dolu yapar. 13:30:02 folyo aktörü folyoyu açar: kalem yok (ücretten vazgeçildi; denetim izinde "politika tutarı 660, uygulanmadı"), **ödeme: Nakit 1.000,00 · Giriş teminatı · İşlendi**. Folyo: Harcamalar 0,00 · Ödenen 1.000,00 · **Bakiye −1.000,00** (misafir alacaklı). Kasa 14 Kasım: Nakit tahsilat +1.000 (kaynak Konaklama, alan: resepsiyonist). Gece kapanışlarıyla 3 × 3.300 işlenir → çıkışta bakiye 9.900 − 1.000 = **8.900 TL** ödenecek. Teminat **kart provizyonu** seçilmiş olsaydı: ödeme yazılmaz, folyoda "Provizyon var — çıkışta kartla tahsil edin" şeridi; çıkışta 9.900 kartla çekilir. Eşik 500 TL olsaydı nakit teminat "Onay bekliyor" kalır, müdür onaylayınca kasaya girerdi.

### Kimlik tarama (pasaport / kimlik kartı)

**Nerede:** check-in penceresinde "Misafirin kimliği"nin yanında **Kimlik tara**; refakatçilerde her kişide **Kimlik tara** ve **Tarayarak ekle**; misafir kartında "Kartı düzenle" → **Kimlik tara**; online check-in inceleme penceresinde **Belgeyi oku / Belgeleri oku**.

**Ne okunur:** belgenin altındaki **makine okunur satırlar** (MRZ, `<<<` dolgulu satırlar): pasaportun fotoğraflı sayfası (2 × 44 karakter) ve yeni TC kimlik kartının **arka yüzü** (3 × 30). Satırlardan ad, soyad, belge türü, belge numarası, **TC kimlik no** (kimlik kartında ve Türk pasaportunda), uyruk, doğum tarihi ve son kullanma tarihi çıkar. Eski tip nüfus cüzdanında ve ehliyette bu satır yoktur — bilgiler elle girilir.

**Görüntü nereye gider:** hiçbir yere. Okuma bu bilgisayarda / telefonda tarayıcının içinde yapılır; fotoğraf sunucuya gönderilmez ve saklanmaz. Sunucuya yalnızca seçtiğiniz değerler ve okunan satırların metni gider; sunucu satırları **kendisi yeniden sağlar** ve saklamaz. Okuyucu ilk kullanımda ~7 MB dosya indirir (bir kez; tarayıcı önbelleğe alır), sonra her okuma 1–5 saniyedir.

**Adım adım:**

1. **Kimlik tara**'ya basın. Kaynak seçin: **Kamerayla tara** (telefon / tablette arka kamera; çerçevedeki kesikli alana `<<<` satırlarını hizalayıp **Çek ve oku**), **Fotoğraf / tarama dosyası seç** (belge tarayıcısının çıktısı ya da telefon fotoğrafı) ya da misafir online check-in'de fotoğraf yüklediyse **misafirin yüklediği belge**.
2. Okunan satırlar ve özet gelir. **Sağlama haneleri tuttu** yazıyorsa belge numarası, doğum ve son kullanma tarihi doğrulanmıştır. Tutmadıysa satırları belgeye bakarak düzeltebilir (kutu düzenlenebilir) ya da yeniden tarayabilirsiniz. Okunamazsa **Satırları elle yaz** da olur.
3. **Karşılaştır:** her alan için "Kayıttaki" ve "Belgeden okunan" yan yana; **aynı / farklı** işaretli. Kimlik alanlarında varsayılan belgedeki; **adda** varsayılan kayıttaki (adın sağlaması yoktur, okuma hatası olabilir; MRZ'de Ç, Ş, Ğ, İ, Ö, Ü yoktur — "Öztürk" ile "OZTURK" aynı sayılır). Farklı adı belgedekiyle değiştirmek için o satırda "Belgeden okunan"ı seçin.
4. **Forma yaz.** Kimlik alanlarının yanında **Kimlikten okundu** rozeti çıkar. Rezervasyon sahibinin adı değiştiyse pencerede "Ad belgedeki gibi düzeltilecek" uyarısı ve **Geri al** görünür; ad girişle birlikte misafir kartına yazılır (denetim izine eski adla).
5. Okumadan sonra bir kimlik alanını elle değiştirirseniz rozet **"okunduktan sonra elle değişti"** olur: kimlik artık elle girilmiş sayılır.

**Uyarılar:** belgenin **süresi dolmuşsa** kırmızı uyarı (giriş engellenmez; geçerli belge isteyin). Aynı belge numarası **başka bir misafir kartında** kayıtlıysa uyarı ve kartın adı — aynı kişiyse Misafirler ekranından kartları birleştirin. Ad satıra sığmadıysa (uzun adlar) "kısaltılmış olabilir" notu.

**Arka planda:** sunucu satırları ayrıştırıp sağlar ve gönderilen kimlik alanlarıyla karşılaştırır. Tutarsa misafir kartına **"kimlikten okundu"** işareti (kim, ne zaman, nereden: resepsiyonda tarandı / online check-in belgesinden) yazılır; tutmazsa giriş "Kimlikten okunan bilgiler değiştirilmiş" sebebiyle durur. Kimlik sonradan elle değiştirilirse işaret kendiliğinden silinir; kartta yalnızca etiket / telefon değişirse kalır. Denetim izinde belge numarası maskelidir, okunan satırlar hiçbir yere yazılmaz.

| Tetikleyici | Ne olur | Nerede görünür | Hatada |
| --- | --- | --- | --- |
| Okunan kimlikle "Giriş yap" | Kart "kimlikten okundu" (resepsiyonda tarandı) | Misafir kartı kimlik satırı, sonraki girişlerde rozet | Okunan değiştirilmişse ya da sağlama tutmuyorsa giriş durur, sebep alanın altında |
| Belgedeki ada göre düzeltme | Misafir kartının adı değişir | Kart, denetim izi (eski ad) | — |
| Misafir kartında okuma + Kaydet | Aynı işaret; kimlik değişti | Kart | Aynı |
| Kimlik elle değişti | İşaret silinir | Kartta rozet yok | — |

**Örnek — OTA'dan yanlış yazılmış ad:** Booking'den "Aise Yilmas" adıyla gelen rezervasyon. Misafir TC kimlik kartını uzatır; resepsiyon arka yüzü kameraya tutar → 2 saniyede okunur: YILMAZ / AYSE, TC 1•••••••••6, 15.01.1990, son kullanma 2031. Karşılaştırma: soyad "farklı" (Yilmas / Yilmaz), ad "farklı" (Aise / Ayse) — resepsiyon ikisinde de "Belgeden okunan"ı seçer, formda "Ayşe Yılmaz" olarak Türkçe harfleri düzeltir; kimlik alanları belgedeki. **Giriş yap** → kart "Ayşe Yılmaz", kimlikten okundu; denetim izinde "Aise Yilmas → Ayşe Yılmaz, girişte belgedeki ada göre düzeltildi".

### Gidecekler

**Görünümler:** "Çıkacaklar" (çıkışı bugün olan içerideki misafirler; çıkışı geçmiş **gecikmiş** olanlar üstte, gün sayısıyla) ve "Bugün çıkanlar" (aynı gün yapılan çıkış geri alınır).

Satırda folyo bakiyesi (folyoya bağlantı) ve alınan teminat görünür.

### Check-out penceresi

**Adım adım:**

1. "Çıkış yap"a basın; "Hesap hazırlanıyor…" sonra özet gelir. Çıkış yapılamayacak bir durum varsa üstte söylenir.
2. **Erken ayrılış:** misafir çıkış tarihinden önce gidiyorsa pencere "N gece bırakılacak" der; kalan geceler envantere döner ve fiyattan düşer. "Misafir bugün ayrılıyor; kalan geceleri bırak" kutusunu işaretlemeniz gerekir. Promosyon şartı bozulursa indirimin akıbeti burada yazar.
3. **Gecikmiş çıkış:** çıkış günü geçmişse (unutulmuş çıkış) uyarı çıkar; tarih değişmez, ücret alınmaz.
4. **Geç çıkış ücreti:** otelin çıkış saatinden sonraysa ve ücret tanımlıysa tutar görünür; "Ücret uygulama" ile vazgeçilebilir (denetim izinde).
5. **Ödenecek tutar** = folyo bakiyesi + çıkışta işlenecekler (kalan oda geceleri, geç çıkış ücreti — vergileriyle). Yönlendirmeyle **başka konaklamanın folyosuna** düşecek tutar (ör. grup hesabı) misafirin borcuna yazılmaz. "Onay bekleyen ödeme (henüz düşülmedi)" satırı varsa para çekmecededir ama onaylanana kadar bakiyeye girmez.
6. Bakiye varsa **"Ödeme al"** düğmesi (tek açık folyoda doğrudan; birden çok pencere varsa folyo ekranına yönlendirir).
7. Bakiye yine açıksa ve yetkiniz varsa **"Bakiyeyle çıkış yap"** + zorunlu **Gerekçe** (ör. "Şirket faturası ay sonunda ödenecek"). Yönetime zil düşer.
8. Uyarı kutuları: **teslim edilmemiş çamaşır siparişi**, misafirin **teslim bekleyen kayıp eşyası**, odasında bulunup sahibi belirlenmemiş eşya, girişte alınan **teminat** (provizyonsa "kartla tahsil edin" hatırlatması), açık **spa randevusu ya da spa borcu**.
9. **Çıkış yap.**

**Arka planda — çıkış yapıldığında:**

- **Oda aktörü** odayı **boş + kirli** yapar.
- **Kat hizmeti aktörü** odaya **çıkış temizliği** görevi açar (öncelik yüksek). Sabahki konaklama temizliği açıksa onu çıkış temizliğine yükseltir.
- **Folyo aktörü** kalan geceleri ve geç çıkış ücretini işler; bakiyesi sıfırsa folyoyu **kapatır** ve kapanan folyonun **fatura taslağını** açar. Bakiye kaldıysa (bakiyeyle çıkış değilse) folyo yetkilisinin ziline uyarı düşer.
- **Bildirim merkezi** teşekkür mesajını kuyruğa alır; **anket** işi çıkış sonrası anketi ayardaki gün ve saatte gönderir.
- Portal bağlantısı çıkıştan 14 gün sonra kapanır; belge fotoğrafları saklama süresi sonunda silinir.

#### Check-out penceresi — ekranda gördüğünüz alanlar

| Alan | Anlamı |
| --- | --- |
| "Çıkış yapılamaz" uyarısı | Yapısal engel (zaten çıkmış, iptal) — sebebi yazar |
| Erken ayrılış uyarısı + onay kutusu | "N gece bırakılacak"; indirimin akıbeti; kutu işaretlenmeden çıkış olmaz |
| Gecikmiş çıkış uyarısı | "Çıkış N gün gecikmiş"; tarih değişmez |
| Geç çıkış ücreti | Tutar + "Ücret uygulama" kutusu; otelde ücret tanımlı değilse bilgi notu |
| Folyo bakiyesi | Pencere bazında; birleştirilmiş pencereler hariç |
| Çıkışta işlenecekler | Kalan geceler (bugünkü gece dahil), geç çıkış ücreti — vergileriyle |
| Onay bekleyen ödeme | Henüz düşülmemiş tutar |
| **Ödenecek** | Bakiye + işlenecekler − (yönlendirmeyle başka konaklamaya düşecekler) |
| Ödeme al | Tek açık pencerede doğrudan; çok pencerede folyoya yönlendirir |
| Bakiyeyle çıkış yap + Gerekçe | Yetkili; yönetime zil |
| Uyarı kutuları | Teslim edilmemiş çamaşır, kayıp eşya (eşleşmiş / odada bulunmuş), teminat, açık spa randevusu / borcu |
| Çıkış yap | İşlemi yapar |

| Tetikleyici | Aktör | Sonuç | Nerede görünür | Kapalıysa / hatada |
| --- | --- | --- | --- | --- |
| "Çıkış yap" | Oda aktörü | Oda **Boş + Kirli** | Kat haritası kırmızı, oda listesi | Manuel görev |
| "Çıkış yap" | Kat hizmeti aktörü | **Çıkış temizliği** görevi (Yüksek); açık konaklama temizliği varsa yükseltir | Kat hizmetleri → Görev panosu | Manuel görev; şef elle açar |
| "Çıkış yap" | Folyo aktörü | Kalan geceler + geç çıkış ücreti kalemleri; bakiye 0 → folyo **Kapalı** → **fatura taslağı**; bakiye kaldıysa folyo yetkilisine zil | Folyo; Faturalar → Taslaklar | Manuel görev; Faturalanacaklar listesi |
| "Çıkış yap" | Bildirim merkezi | Teşekkür bildirimi | Gönderim geçmişi | — |
| "Çıkış yap" | Anket işi | Çıkış sonrası anket, ayardaki gün + saatte | Anketler → Rapor (davet) | Portal adresi / kanal yoksa gitmez |
| "Çıkış yap" | Spa | Açık randevu / borç varsa spa ziline | Spa | — |
| Çıkış geri alındı (aynı gün) | Oda / folyo aktörü | Oda Dolu; folyo yeniden açılır, geç çıkış ücreti düşer; çıkış temizliği iptal | Folyo, pano | Manuel görevler |

**Örnek — erken ayrılış ve geç çıkış:** 405'teki misafir (3 gece, 14–17 Kasım, 3.300 / gece, 1.000 nakit teminat) 16 Kasım 13:40'ta ayrılmaya karar verir; otelin çıkış saati 12:00, geç çıkış ücreti "gecelik %30". Pencere: "Erken ayrılış: 1 gece bırakılacak (16.11)" + onay kutusu; "Geç çıkış ücreti: 990,00 TL" (3.300 × %30) + "Ücret uygulama" kutusu; folyo bakiyesi: 14 ve 15 Kasım geceleri işlenmiş 6.600 − teminat 1.000 = **5.600**; çıkışta işlenecek: 16 Kasım gecesi **yok** (bırakılıyor), geç çıkış 990 → **Ödenecek 6.590 TL**. Minibar 110 TL fişi 13:00'te kesilmişse bakiyeye dahildir → 6.700. Resepsiyon "Ödeme al" → 6.700 kart, slip no → bakiye 0 → "Çıkış yap" → oda aktörü 405 Boş + Kirli; kat aktörü çıkış temizliği; folyo aktörü geç çıkış 990 kalemini yazar (zaten ödendiği için bakiye 0) → folyo Kapalı → fatura taslağı (alıcı: misafir). 16 Kasım gecesi envantere döner: bekleme listesinde Deluxe bekleyen varsa zil çalar. Misafir 20 dakika sonra "eşyamı unuttum, bir gece daha kalırım" derse: çıkış **geri alınamaz** şekilde bırakılan gece geri gelmez; aynı gün geri alma yalnızca folyoyu ve odayı eski hâline getirir, 16 Kasım gecesi için rezervasyon ayrıntısından çıkış tarihi 17'ye uzatılır (yer varsa).

### Konaklayanlar

Şu an içeride olan herkes: oda, giriş, çıkış, bakiye. Sıralama: çıkışı yakın olan önce / son giren önce / oda numarası. Tarih aralığı süzgeci "şu tarihlerde kim içerideydi" sorusuna da cevap verir.

| Alan | Anlamı |
| --- | --- |
| Oda · misafir · kişi | İçerideki konaklama |
| Giriş → çıkış · kalan gece | Bugün çıkacaklar "0 gece" |
| Bakiye | Bütün pencerelerin toplamı; tıklayınca folyo |
| Teminat | Girişte alınan (nakit / havale işlenmiş; provizyon hatırlatma) |
| Etiketler | Misafir kartından (VIP, Sadık…) |
| Sıralama | Çıkışı yakın olan önce / Son giren önce / Oda numarası |

**Örnek — gece vardiyası kullanımı:** 23:30'da gece görevlisi "Çıkışı yakın olan önce" ile bakar: sabah 8 çıkış var; 3'ünün bakiyesi açık (toplam 14.200 TL) — sabah yoğunluğu öngörülür; biri VIP etiketli → geç çıkış sorulacak notu alınır. Tarih aralığı 10–12 Kasım seçilince "o günlerde kim içerideydi" listesi gelir — kayıp eşya ya da güvenlik sorusu için.

### Girişi / çıkışı geri alma

**Nerede:** Gelecekler → "Bugün girenler" ve Gidecekler → "Bugün çıkanlar" görünümleri.

- Yalnızca **aynı iş günü** içinde geri alınır; sebep zorunludur ve denetim izine yazılır.
- **Giriş**, folyoda resepsiyonda alınan bir ödeme varsa geri alınmaz (ön ödeme ve giriş teminatı engellemez). Geri alınınca folyo aktörü erken giriş ücretini ve teminat ödemesini ters kayıtla düşer; oda aktörü odayı boşaltır.
- **Çıkış**, oda bu arada başka misafire verildiyse geri alınmaz. Erken ayrılışta bırakılan geceler geri **gelmez**. Geri alınınca folyo yeniden açılır, geç çıkış ücreti düşer; oda yeniden dolu olur.
- Daha sonraki düzeltmeler rezervasyon düzenlemesiyle yapılır.

| Tetikleyici | Aktör | Sonuç | Nerede görünür | Kapalıysa |
| --- | --- | --- | --- | --- |
| Giriş geri alındı | Oda aktörü | Oda Boş (kat hizmeti değişmez) | Oda listesi, plan | Manuel görev |
| Giriş geri alındı | Folyo aktörü | Erken giriş ücreti ters kayıt; teminat ödemesi iptal kaydı (onay bekleyense isteği geri çekilir); folyo açık kalır (kalem yoksa) | Folyo | Manuel görev |
| Giriş geri alındı | Online check-in | "Onaylandı"ya döner | Sekme | — |
| Çıkış geri alındı | Oda aktörü | Oda Dolu | Plan | Manuel görev |
| Çıkış geri alındı | Kat hizmeti aktörü | Çıkış temizliği görevi iptal | Pano | Manuel görev |
| Çıkış geri alındı | Folyo aktörü | Folyo yeniden açılır; geç çıkış ücreti düşer; fatura taslağı varsa durdurulur (fatura **kesilmişse** geri alma engellenir) | Folyo, Faturalar | Manuel görev |

**Örnek:** 14 Kasım 13:30'da 405'e yanlışlıkla "Kaya, C." yerine "Demir, A." giriş yapıldı (ikisi de Deluxe bekliyor). 13:35 Gelecekler → "Bugün girenler" → Demir, A. → **Geri al**, sebep "yanlış misafir". Oda aktörü 405'i Boş yapar; folyo aktörü 1.000 TL nakit teminat ödemesini iptal kaydıyla düşer (kasa: +1.000 ve −1.000 aynı gün, net 0); folyoda kalem yoktu, açık kalır; denetim izinde geri alma ve sebep. Ardından Kaya, C. için giriş yapılır; Demir, A. başka Deluxe'e girer. Aynı misafire folyoda resepsiyon ödemesi alınmış olsaydı (ör. 2.000 TL "Resepsiyon" kaynağıyla) geri alma **engellenir**: önce ödeme iptali (onaylı), sonra geri alma. Gün kapanmış olsaydı geri alma yoktur; çözüm rezervasyon düzenlemesi ve folyo aktarmasıyla.

## Online check-in ve misafir portalı

**Nerede (personel):** Ön büro → Giriş / çıkış → **Online check-in** sekmesi; rezervasyon ayrıntısındaki **Misafir portalı** kartı; portal ayarları (yetkili için). **Misafir tarafı:** `/misafir/p/<bağlantı>` adresindeki küçük misafir uygulaması (TR, EN, DE, RU; dil uyruğa göre açılır, misafir değiştirebilir).

### Portal ne sunar

Misafir, rezervasyonuna özel imzalı bağlantıyla (ya da QR'la) açar; şifre yoktur. Sayfalar: **Rezervasyonum**, **Online check-in**, **Folyom** (yalnızca misafirin ödediği pencereler; şirket / acente penceresi gösterilmez, yalnızca varlığı söylenir), **İstek gönder** (misafir istekleri ekranına "Misafir portalı" kaynağıyla düşer), **Oda servisi** (içerideki misafire; QR menü ve sipariş), **Spa randevusu** (otel açmışsa), **Anket** (açık anket varsa kutu), **Web sohbeti** (kanal açıksa). **Dijital anahtar** düğmesi yerinde ama **pasiftir** — donanım entegrasyonu gelince açılır.

Bağlantı rezervasyona bağlıdır; yenilenince eskisi geçersiz olur; iptal / gelmedi ve çıkıştan 14 gün sonra kapanır.

#### Rezervasyon ayrıntısındaki "Misafir portalı" kartı

| Alan / düğme | Anlamı |
| --- | --- |
| Bağlantı | Misafire özel adres; "Kopyala" |
| QR | Telefona okutmak için (resepsiyonda ekrandan) |
| Daveti gönder | Bildirim kanallarıyla elle davet (misafirde e-posta / telefon olmalı) |
| Yenile | Yeni bağlantı üretir, eskisi geçersiz (bağlantı yanlış kişiye gittiyse) |
| İptal | Bağlantıyı kapatır |
| Davet durumu | "Gönderildi (e-posta, 13.03 09:01)" / "Gönderilmedi — iletişim yok" |
| Online check-in durumu | İnceleme bekliyor / Onaylandı / Düzeltme istendi / Giriş yapıldı / "Henüz gönderilmedi"; "İncele" bağlantısı |

### Davet

- **Otomatik:** portal ayarlarında "Davet: girişten kaç gün önce" dolu ve **portal adresi** girilmişse, sistem 30 dakikada bir tarar ve bildirim kanallarıyla (e-posta / SMS şablonu "Online check-in daveti") davet gönderir. İletişimi olmayan misafirde davet harcanmaz; bilgi eklenince sonraki turda gider.
- **Elle:** rezervasyon ayrıntısındaki portal kartından "Daveti gönder", "Bağlantıyı kopyala", QR göster, bağlantıyı yenile / iptal et. Personelin iptal ettiği ya da yenilediği bağlantıya otomatik davet gitmez — elle gönderin.
- Davetin **fiilen** ulaşması için Yönetim → Bildirimler → Kanallar'da SMTP (e-posta) ya da SMS sağlayıcı kurulmuş ve şablon etkin olmalıdır. Kanal yoksa tur hiç başlamaz; personel bağlantıyı yine kopyalayıp WhatsApp'tan elle gönderebilir.

### Misafirin yaptığı online check-in

Girişten "Online check-in kaç gün önce açılır" (varsayılan 7) gün önce açılır. Misafir: her yetişkin için kimlik bilgisi + **zorunlu belge fotoğrafı** (telefonda küçültülür, konum bilgisi düşer; en az 1, en fazla 2 fotoğraf), çocuklar, tahmini varış saati, araç plakası, ödeme / teminat tercihi (Girişte kartla / Girişte nakit / Önceden ödendi / Şirket öder — kart numarası hiçbir yerde tutulmaz; "kartla ön ödeme" sanal POS gelince açılacak), konaklama kuralları + KVKK + fotoğraf rızası + ticari ileti tercihi onayları ve **parmakla imza**. Gönderince resepsiyonun **ziline** "online check-in geldi" uyarısı düşer.

### Personelin incelemesi

**Online check-in sekmesi:** giriş gününe göre liste, durum sayıları, görünüm (Gelecek girişler / Tümü), durum süzgeci (İnceleme bekliyor / Onaylandı / Düzeltme istendi / Giriş yapıldı), arama.

**İnceleme penceresi:** kişiler (belge türü, maskeli numara, uyruk, doğum tarihi), belge fotoğrafları (büyütülebilir), imza, onaylar, tahmini varış, plaka, ödeme tercihi, portal dili, misafirin notu.

- **Onayla:** "bilgiler ve belge görüldü" demektir. Online check-in girişi **hızlandırır, yerine geçmez**: giriş yine Gelecekler'den ya da bu pencereden "Girişi yap" ile yapılır ve check-in penceresi bu bilgilerle dolu açılır.
- **Düzeltme iste:** sebep yazın; misafir portalda görür (kendi dilinde), düzeltip yeniden gönderir → yeniden "İnceleme bekliyor".
- **Belgeleri oku:** fotoğraflardaki makine okunur satırlar bu bilgisayarda okunur ve misafirin yazdıklarıyla karşılaştırılır; her fotoğrafın altında **Belgeyle uyuşuyor**, **Uyuşmuyor: Belge numarası, Doğum tarihi…**, **Satır okunamadı** ya da **Belgenin süresi dolmuş** yazar. Sunucuya değerler değil sonuç gider. Misafir formu yeniden gönderirse eski sonuçlar düşer; yeniden okuyun. Uyuşmazlık varsa **Düzeltme iste** ile misafire söyleyin ya da girişte belgeyi tarayın.
- Misafir onaydan **sonra** bilgi değiştirirse kayıt yeniden incelemeye düşer.

#### Online check-in sekmesi — ekranda gördüğünüz alanlar

| Alan | Anlamı |
| --- | --- |
| Durum sayıları | İnceleme bekliyor / Onaylandı / Düzeltme istendi / Giriş yapıldı |
| Görünüm | Gelecek girişler / Tümü |
| Satır | Giriş günü, misafir, onay kodu, oda tipi, kişi (belge sayısı), durum rozeti, gönderim zamanı, portal dili |
| İnceleme penceresi | Kişiler (belge türü, maskeli numara, uyruk, doğum tarihi, fotoğraf sayısı), fotoğraflar (büyüt), imza, onaylar (kurallar, KVKK, fotoğraf rızası, ticari ileti), tahmini varış, plaka, ödeme tercihi, misafir notu; **Onayla** · **Düzeltme iste** (sebep) · **Girişi yap** (giriş günü geldiyse) |

| Tetikleyici | Ne olur | Nerede görünür | Kapalıysa / hatada |
| --- | --- | --- | --- |
| Girişe N gün kaldı (ayar) ve portal adresi + kanal var | 30 dk'lık iş davet bildirimi yazar ("Online check-in daveti" şablonu, e-posta / SMS) | Bildirimler → Gönderim geçmişi; portal kartında "davet gönderildi" | Adres / kanal / şablon yoksa tur başlamaz; elle gönderim |
| Misafir formu gönderdi | Kayıt **İnceleme bekliyor**; resepsiyon ziline "Online check-in" | Sekme sayacı, zil | — |
| Onaylandı | **Onaylandı**; Gelecekler satırında "online check-in onaylı" | Gelecekler | — |
| Düzeltme istendi | **Düzeltme istendi**; misafir portalda sebebi kendi dilinde görür | Portal | — |
| Misafir onaydan sonra değiştirdi | Yeniden **İnceleme bekliyor** | Sekme | — |
| Giriş yapıldı | **Giriş yapıldı**; geri alınırsa Onaylandı'ya döner | Sekme | — |
| Rezervasyon tarihi değişti | Kaydın giriş günü eşitlenir | Liste sırası | — |
| Çıkıştan (gelmeyende girişten) saklama günü geçti | Belge fotoğrafları ve kimlik no / doğum tarihi kopyası silinir | Pencerede "belge silindi" | — |

**Örnek:** Rezervasyon 20 Mart girişli; ayar "davet 7 gün önce", online check-in "7 gün önce açılır", saklama 7 gün. 13 Mart 09:00 iş turu: misafirin e-postası var, SMTP kanalı kurulu → davet e-postası kuyruğa, 09:01 gönderildi. 14 Mart misafir telefondan açar (dil: EN, uyruk DE olduğu için portal Almanca açılır, misafir İngilizceye çevirir): 2 yetişkin → 2 pasaport fotoğrafı (her biri 1 adet), çocuk 1 (belge yok), tahmini varış 16:00, plaka yok, ödeme "Girişte kartla", 4 onay kutusu, imza → gönder → resepsiyon ziline. 14 Mart 10:30 resepsiyon inceler: ikinci pasaport fotoğrafı bulanık → "Düzeltme iste: 2. kişinin pasaport fotoğrafı okunmuyor" → misafir 11:00'de yeni fotoğraf yükler → "İnceleme bekliyor" → 11:10 Onaylandı. 20 Mart 15:50 misafir gelir: Gelecekler satırında "Online check-in onaylı" → "Giriş yap" → form 2 pasaport, çocuk, varış bilgisiyle dolu; resepsiyon teminat ve odayı kontrol eder, "Giriş yap" → kayıt "Giriş yapıldı". Çıkış 23 Mart → 30 Mart fotoğraflar ve pasaport numaralarının kopyası silinir; ad, belge türü, uyruk, imza kalır.

**KVKK:** belge fotoğrafları çıkıştan (gelmeyende girişten) "Belge fotoğrafı saklama (gün)" sonra silinir; silinince kimlik numarası ve doğum tarihi kopyası da temizlenir (ad, belge türü, uyruk, imza kalır). Bağlanmayan yükleme 48 saat sonra silinir. İşlem kaydına kimlik numarası yazılmaz.

### Portal ayarları

Yetkili (müdür) için: portal açık/kapalı, **portal adresi** (davet bağlantısının tabanı — boşsa otomatik davet gitmez), davet günü, online check-in açılış günü, belge saklama günü, dört dilde karşılama / konaklama kuralları / KVKK metni (boş bırakılan metin varsayılana düşer; KVKK metnini hukukçuya gözden geçirtin). Web sohbetinin portalda görünmesi için Ayarlar → Mesaj kanalları'ndaki izinli site adreslerine portal adresini ekleyin.

## Odalar

**Nerede:** Ön büro → Odalar. Sekmeler: **Oda listesi** (`/odalar/liste`), **Müsaitlik** (`/odalar/musaitlik`), **Oda atama** (`/odalar/atama`). Oda tipleri, taban fiyatlar ve sezonlar Yönetim → Ayarlar'dadır.

### Oda listesi

**Ne yapar:** odanın numarası, katı, tipi, doluluğu, kat hizmeti durumu ve arıza durumu; oda ekle / düzenle (numara, kat, tip, not); **Arıza kayıtları** penceresi.

**Süzgeçler:** ara, oda tipi, doluluk, kat hizmeti, arıza. Oda numaraları doğal sırada (1, 2, 10).

**Arıza kayıtları penceresi (yönetim):** odaya tarihli kayıt aç — tür (**Arızalı**: satılamaz, envanterden düşer; **Hizmet dışı**: envanterde kalır, misafir yerleştirilmez), Başlangıç, Bitiş (boş = süresiz), Sebep. Listede o odanın ya da bütün otelin kayıtları; başlamamış kayıt **iptal edilir** (silinir, iz kalır), süren kayıt **bitirilir** (bugün biter). Arızalı kayıt bitince oda **kirli** olur (teknisyen sonrası temizlik) ve kat hizmeti aktörü **detaylı temizlik** görevi açar.

**Engeller:** o tarihlerde rezervasyonu olan odaya kayıt açılamaz ("misafiri başka odaya taşıyın"); kayıt yeni overbooking yaratacaksa reddedilir ("Bu kayıt overbooking'e yol açar"); geçmiş tarihli kayıt açılamaz; çakışan iki kayıt olamaz.

#### Oda listesi — ekranda gördüğünüz alanlar

| Alan | Anlamı |
| --- | --- |
| Oda no · Kat · Tip | Envanter tanımı |
| Doluluk | Boş / Dolu (yalnızca okunur) |
| Kat hizmeti | Kirli / Temizleniyor / Temiz / Kontrol edildi (kat ekranından değişir) |
| Arıza | Bugün odayı kapsayan kayıt: Arızalı / Hizmet dışı + sebep; yoksa "Hizmette" |
| Not | Oda notu (manzara, bağlantılı oda…) |
| Düzenle / Sil | Envanter tanımı (yönetim); rezervasyonu olan oda silinemez |
| Arıza kayıtları | Pencere (yönetim) |

**Örnek — planlı tadilat:** 20–25 Ekim'de 3. kat banyoları yenilenecek: 301–310 için 10 ayrı Arızalı kaydı (başlangıç 20.10, bitiş 25.10, sebep "banyo tadilatı") 1 Eylül'de girilir. 1 Eylül'den itibaren müsaitlik tablosunda 20–24 Ekim geceleri Standart sayısı 10 azalır (25 Ekim'de odalar döner — çıkış günü mantığı), oda planında kırmızı şeritler görünür, oda atama bu odaları o tarihlerde listelemez, bekleme listesi kota hesabı buna göre çalışır. 305'te 22–24 Ekim rezervasyonu varsa kayıt **reddedilir**: önce rezervasyon başka odaya taşınır. Tadilat 24 Ekim'de erken biterse kayıt "Bitir" ile 24'te sonlandırılır → odalar Kirli → kat aktörü 10 detaylı temizlik görevi açar → bekleme listesi taranır. 20 Ekim gelmeden iptal edilirse kayıt silinir (denetim izinde kalır).

**Teknik servisle ilişki:** teknik servis bileti "Odayı kullanıma kapat" ile açılırsa arıza kaydını o açar ve bilet çözülünce kapatır. Günlük arıza işi için Teknik servis ekranını kullanın; bu pencere doğrudan tadilat / plan kaydı içindir.

### Müsaitlik

**Ne yapar:** satır oda tipi, sütun gece, hücrede **boş oda sayısı**. Renk kodu: kırmızı = overbooking (eksi), turuncu = son odalar, yeşil = rahat. Arızalı odalar sayıdan düşer; hizmet dışı odalar sayılır ama hücrede **nokta** ile işaretlenir — o gecenin son boş odası hizmet dışıysa satılan misafire oda bulunamaz.

| Alan | Anlamı |
| --- | --- |
| Satır | Oda tipi (kod, ad, toplam oda) |
| Sütun | Gece (tarih); pencere 7 / 14 / 30 gün |
| Hücre sayısı | Boş oda = toplam − arızalı − o geceyi tutan rezervasyonlar (odası atanmış ya da atanmamış) |
| Renk | Yeşil rahat · turuncu son odalar · **kırmızı eksi (overbooking)** |
| Nokta | O gece hizmet dışı oda var (sayıda ama atanamaz) |
| Tıklama | Hücreden o tip ve tarihle yeni rezervasyon formu ön dolu |

**Örnek:** Deluxe 10 oda. 20 Mart sütunu: 7 rezervasyon (5'i odalı, 2'si oda bekliyor) + 1 Arızalı (klima) → hücre **2** (turuncu). 21 Mart: 10 rezervasyon + 1 Arızalı → **−1** kırmızı: overbooking var (onaya gönder politikasıyla açılmış ya da arıza sonradan girilmiş); o gün bir misafir başka tipe yükseltilmeli ya da iptal beklenmeli. 22 Mart: 6 boş ama hücrede nokta: 1 oda Hizmet dışı; 6 satış yapılırsa altıncı misafire oda verilemez.

**Dikkat:** sayı "kaç tane satılabilir"dir; acente kotasında tutulu odalar burada düşülmez (satış sırasında denetlenir).

### Oda atama

**Ne yapar:** odası olmayan rezervasyonlara oda vermek için bağımsız ekran (oda planındaki şeridin liste hâli). Görünümler ve arama ile rezervasyonu bulun; aday listesi sayfalıdır, "Diğer oda tiplerini de göster" ile başka tipe atama (üst sınıf / yan / alt sınıf olarak işaretli) yapılabilir; kapasite aşımı reddedilir. Giriş günü gelmiş ama gelmeyen misafir buradan "Gelmedi" işaretlenebilir ("Gelmeme ücretinden vazgeç" seçeneğiyle).

| Tetikleyici | Aktör / kim | Sonuç | Nerede görünür | Kapalıysa |
| --- | --- | --- | --- | --- |
| Rezervasyon açıldı | Oda aktörü | Tip içinde boş, kapasitesi yeten, arızalı olmayan oda; bugün girecekse Temiz / Kontrol edilmiş öne | Rezervasyon "Oda" alanı; oda planı | "Oda atanacak" manuel görevi; Oda atama ekranı |
| Rezervasyon düzenlendi ve oda uymuyor | Sunucu | Atama kaldırılır ("oda bekliyor") | Şerit | — |
| Elle atama | Resepsiyon | Aday listesi: aynı tip önce; başka tip "üst sınıf / yan / alt sınıf" işaretli | Oda atama / plan | — |
| Oda arızalı / dolu / overbooking yaratır | Sunucu | Reddedilir (409) | Hata mesajı | — |

**Örnek:** 14 Kasım 09:00, 3 Deluxe boş: 401 (Kirli — gece çıkış), 405 (Kontrol edildi), 409 (Temiz). Bugün giriş yapacak Deluxe rezervasyon açılırsa Oda aktörü **405**'i seçer (en hazır). 15 Kasım girişli rezervasyon için hazırlık önemsizdir; numara sırasıyla 401 verilebilir. 4 kişilik aile Deluxe (kapasite 3) isterse aday listesi boş gelir, "Diğer oda tiplerini de göster" ile Aile odası "üst sınıf" olarak listelenir; fiyat rezervasyonun tipinden (Deluxe) hesaplanmaya devam eder — fiyat farkı istenirse rezervasyonun tipi düzenlenir.

**Arka planda — otomatik atama:** rezervasyon açılınca **Oda aktörü** uygun odayı seçip atar. Bugün girecek misafir için **temiz / kontrol edilmiş** oda öne alınır — kat hizmetinin durumu zamanında işaretlemesi doğrudan atama kalitesini etkiler. Aktör kapalıysa "oda atanacak" manuel görevi düşer. Atama **yeni overbooking yaratamaz** ve arızalı / dolu odaya yapılamaz (veritabanı son savunma hattıdır).

## Misafirler ve misafir kartı (CRM)

**Nerede:** Ön büro → Misafirler (`/misafirler`); kart `/misafirler/<kimlik>`. Rezervasyon ayrıntısından ve mesajlar ekranından da açılır.

**Yetki:** görmek "misafir görüntüleme"; kart / tercih / not düzenleme "misafir yönetimi"; birleştirme ayrı "birleştirme" yetkisi (müdür ve resepsiyon).

### Misafir listesi

Ad, telefon ya da e-posta ile arama; her kartta konaklama sayısı, toplam harcama ve son konaklama. Üç harften kısa adla arama yapılmaz.

| Alan | Anlamı |
| --- | --- |
| Arama | Ad (≥ 3 harf), telefon ya da e-posta (≥ 2 karakter); telefon ülke kodsuz yazılabilir |
| Kart | Ad soyad, telefon, e-posta, uyruk, etiketler |
| Konaklama | Tamamlanmış konaklama sayısı |
| Toplam harcama | Folyolara işlenen borç toplamı |
| Son konaklama | Tarih ve oda tipi |

**Örnek:** "kaya" aranır → 14 kart; "0532 111" aranır → otelin ülke koduyla `+90532111…` olarak eşleşen 2 kart: "Ayşe Kaya" (4 konaklama, 38.400) ve "Ayse Kaya" (1 konaklama, 6.600) — aynı kişi, widget'tan açılan ikinci kart; birleştirme adayı.

### Misafir kartı

Üstte **özet**: tamamlanmış konaklama sayısı (ilk / son konaklama), **toplam harcama** (folyolara işlenen borç), son konaklama. "Kartı düzenle": ad, soyad, telefon, e-posta, uyruk, doğum tarihi, kimlik türü ve no — kimlik girişteki kurallarla denetlenir (TC no sağlaması, uyruk listeden, belge eksiksiz) ve **Kimlik tara** ile belgeden okunabilir. Boş bırakılan telefon / e-posta karttan silinir. Telefonu ülke kodu olmadan yazarsanız otelin kodu varsayılır. Kimlik satırında belge türü, maskeli numara ve belgeden okunduysa **Kimlikten okundu** rozeti görünür.

**Etiketler:** VIP, Sorunlu, Sadık, Kurumsal, Balayı, Engelli erişimi (öneriler; serbest etiket de girilir). Etiketler rezervasyon formundaki CRM önizlemesinde görünür.

**Sekmeler:**

- **Tercihler:** kategori (Kat / konum, Yatak, Yastık, Beslenme, **Alerji**, Oda özelliği, Ulaşım, Özel gün, Diğer) + değer + kaynak (Personel / Misafir / Yapay zekâ) + güven (Düşük / Orta / Yüksek) + son teyit tarihi. Alerji değerleri mutfağın alerjen kodlarından seçilir — reçete ve menüyle aynı dil.
- **Konaklama geçmişi:** bütün rezervasyonlar durumlarıyla.
- **Harcama:** misafirin folyoları (borç / ödeme / bakiye).
- **Notlar:** tarihli, yazarlı; sabitlenen üstte durur.
- Bildirim tercihi: misafir kanal bazında bildirim istemiyorsa (SMS, e-posta) kartta işaretlenir; o kanaldan gönderim yapılmaz.

### Mükerrer kart birleştirme

**Ne zaman gerekir:** aynı kişi farklı telefon / yazımla iki kez kaydolmuşsa (kanal istekleri soru soramadığı için yeni kart açar).

**Adım adım:**

1. **Kalacak** kartı açın (hedef).
2. "Birleştir" → "Birleştirilecek kart"ı arayıp seçin (kaynak; silinecek).
3. Her alan için hangi değerin kalacağını seçin (telefon, e-posta, kimlik…).
4. Onaylayın. **Geri alınamaz.**

**Arka planda:** kaynağın rezervasyonları, refakatçi kayıtları, konuşmaları, istekleri, folyoları, kayıp eşyaları, faturaları, bekleme listesi kayıtları, bildirimleri, tercihleri ve notları hedefe taşınır; etiketler birleştirilir; kaynak kart silinmiş olarak işaretlenir (iz kalır).

#### Misafir kartı — ekranda gördüğünüz alanlar

| Alan | Anlamı |
| --- | --- |
| Özet kutuları | Konaklama sayısı (ilk / son), **Toplam harcama** (folyolara işlenen borç), Son konaklama |
| Kimlik / iletişim | Ad, soyad, telefon (`+90…`), e-posta, uyruk, doğum tarihi, kimlik türü, kimlik no (maskeli) |
| Etiketler | VIP, Sorunlu, Sadık, Kurumsal, Balayı, Engelli erişimi, serbest |
| Tercihler sekmesi | Kategori · değer · kaynak · güven · son teyit |
| Konaklama geçmişi | Rezervasyonlar, durumları, odalar |
| Harcama | Folyolar: borç / ödeme / bakiye |
| Notlar | Tarih, yazar, metin; sabitle |
| Bildirim tercihi | Kanal bazında "istemiyor" |
| Birleştir | Mükerrer kartı bu karta katar |

| Tetikleyici | Ne olur | Nerede görünür |
| --- | --- | --- |
| Yeni rezervasyon (telefon / e-posta eşleşti) | Mevcut kart kullanılır; eşleşme adla çelişirse personele sorulur | Form |
| Kanaldan rezervasyon (WhatsApp, widget) | Soru soramadığı için **yeni kart** açılır → sonradan birleştirme | Misafir listesi (mükerrer) |
| Check-in | Kimlik türü / no karta yazılır (maskeli gösterilir) | Kart |
| Online check-in | Kimlik bilgisi karta; saklama süresi sonunda numara kopyası silinir | Kart |
| Folyoya kalem işlendi | Toplam harcama artar | Özet kutusu |
| Çıkış | Konaklama sayısı +1, son konaklama güncellenir | Özet kutusu |
| WhatsApp mesajı | Telefondan eşleşen kart konuşmaya bağlanır (birden çok kartta en son güncellenen) | Mesajlar sağ paneli |
| Anket yorumu (AI) | Tercih çıkarımı **yapılmaz** (ileriki sürüm — "misafir tanıma"); etiketler yalnızca ankette kalır | Anketler |
| Birleştirme | 9 tablodaki kayıt hedefe taşınır; kaynak silinmiş işaretlenir | Kart, Aktivite → Denetim kaydı |

**Örnek:** "Ayşe Kaya" kartı: 4 konaklama (ilk 03.2025, son 11.2026), toplam harcama 38.400 TL, etiket "Sadık"; tercihler: Kat / konum "üst kat, sessiz" (Personel, Yüksek, teyit 11.2026), Yastık "sert" (Misafir, Orta), Alerji "fındık" (Personel, Yüksek — mutfağın alerjen kodu). WhatsApp'tan +90 532 … ile yazıyor; ama widget'tan yaptığı rezervasyonda "Ayse Kaya", e-posta farklı → ikinci kart açılmış (1 konaklama, 6.600 TL). Resepsiyon asıl kartı açar → Birleştir → "Ayse Kaya"yı seçer → telefon asıl karttan, e-posta yeni karttan kalsın → onayla → asıl kart: 5 konaklama, 45.000 TL; ikinci kart silinmiş; WhatsApp konuşmaları ve folyolar tek kartta. Rezervasyon formunda bu misafir seçilince CRM önizlemesi "Sadık · üst kat, sessiz · sert yastık · **alerji: fındık**" gösterir; mutfak alerjen koduyla aynı dilde olduğu için oda servisi siparişinde uyarı çıkabilir.

### Arka planda misafir kartına ne yazılır

- Gelen WhatsApp mesajı misafiri **telefonundan** bulur ve konuşmayı karta bağlar; aynı numaraya birden çok kart varsa en son güncellenen alınır (bu yüzden mükerrerleri birleştirmek önemlidir).
- Rezervasyon formu telefon / e-posta eşleşmesiyle mevcut kartı bulur.
- Online check-in kimlik bilgilerini karta işler; saklama süresi sonunda kimlik numarası kopyası temizlenir.
- Toplam harcama, folyolara işlenen borçlardan hesaplanır; ödeme değil borç ölçülür.

## Sık sorulanlar

**"Yer yok" diyor ama oda planında boş oda görüyorum.**
Üç olası sebep: (1) oda **hizmet dışı** ya da **arızalı** kayıtlıdır (müsaitlik tablosunda nokta / düşülmüş sayı); (2) o oda tipinde **oda bekleyen** rezervasyonlar vardır — şeride bakın, envanteri tüketirler; (3) acente **kotasında tutulu** odadır — oda planı kotayı göstermez, mesaj "N oda acente kotasında tutulu" der.

**Rezervasyonu açtım, oda atanmadı.**
Oda aktörü kapalı ya da uygun oda bulamamış olabilir. Görevler ekranında "oda atanacak" görevi varsa oradan ya da Odalar → Oda atama'dan elle verin. Yönetim → Aktörler ekranında aktörün durumuna bakın.

**Fiyat neden beklediğimden farklı?**
Rezervasyon ayrıntısındaki gece gece dökümde her gecenin kaynağı yazar: sezon adı, fiyat planı adı, kontrat adı, paket, indirim, dinamik çarpan. Öncelik sırası: elle > acente kontratı > paket > fiyat planı > sezon × taban. Kişi sayısı plan fiyatının kişi sayısını aşıyorsa kişi başı ek eklenir.

**Kupon girdim ama indirim yapılmadı.**
Tip kartındaki kupon durumuna bakın: "daha avantajlısı var" (otomatik promosyon daha iyiydi, kupon hakkı harcanmadı), "uymuyor" (koşul: tarih, gece sayısı, oda tipi, pansiyon, kanal), "hak yetmez" (tek kullanımlık kupon kullanılmış). Acente satışında ve paketli odada kupon hiç uygulanmaz.

**Misafir erken geldi, oda kirli. Giriş yapabilir miyim?**
Evet; pencere "oda kirli" uyarısı verir, onaylayarak devam edersiniz. Arızalı odaya ya da önceki misafir çıkmamış odaya giriş **yapılamaz**.

**Check-out'ta "Çıkış yapılamaz: bakiye var" diyor.**
"Ödeme al" ile tahsilat yapın. Şirket ödeyecekse yetkili "Bakiyeyle çıkış yap" + gerekçe ile çıkarır; yönetime zil düşer. "Onay bekleyen ödeme" satırı varsa, o ödeme onaylanınca bakiye kapanır — onaylayan isteyenden farklı biri olmalıdır.

**Yanlış misafire giriş yaptım.**
Aynı gün içinde Gelecekler → "Bugün girenler" görünümünden sebep yazarak geri alın. Folyoda resepsiyonda alınan ödeme varsa önce o iptal edilmelidir (onaylı). Gün kapandıysa geri alma yoktur; rezervasyon düzenlemesiyle düzeltin.

**Online check-in onaylandı; misafir yine resepsiyona gelecek mi?**
Evet. Onay "bilgiler ve belge görüldü" demektir; fiziksel giriş (anahtar, teminat) resepsiyonda yapılır — ama form dolu açılır, saniyeler sürer.

**Davet gitmedi.**
Sırayla: portal ayarında **portal adresi** dolu mu; "Davet: girişten kaç gün önce" 0 mı (0 = yalnız elle); misafirde e-posta/telefon var mı; Bildirimler → Kanallar'da e-posta ya da SMS kanalı kurulu ve test edilmiş mi; "Online check-in daveti" şablonu etkin mi; bağlantı personelce iptal / yenilenmiş mi (o zaman elle gönderin). Bildirimler → Gönderim geçmişi'nde satırı ve hatasını görürsünüz.

**Misafir WhatsApp'tan yazdı ama kartı bulunmadı.**
Karttaki telefon ülke kodsuz ve otelin kodu farklı ülkeye işaret ediyorsa eşleşmez. Kartı düzenleyip telefonu `+90…` biçiminde yazın; Mesajlar ekranında konuşmayı misafire / odaya bağlayın.

## Sık yapılan hatalar

- **Oda durumunu elle "boş" yapmaya çalışmak.** Böyle bir düğme yoktur; doluluğu yalnızca giriş / çıkış akışı değiştirir. Misafir gittiyse çıkış yapın; yanlış giriş varsa geri alın.
- **Çıkış gününü "dolu gün" sanmak.** 15–18 rezervasyonu 18'inde odayı boşaltır; o gün aynı oda yeniden satılır. Müsaitlik tablosunu buna göre okuyun.
- **Elle fiyatı gerekçesiz girmeye çalışmak.** Gerekçe zorunludur; yetkiniz yoksa kutu görünmez. Kurumsal anlaşma varsa acente / kontrat tanımı daha doğrudur.
- **Paketle kupon / acente birleştirmeye çalışmak.** Paket net demet fiyatıdır; sistem reddeder.
- **Aynı rezervasyonu iki kez göndermek.** Çift tık ikinci kayıt açmaz (aynı istek kimliği), ama formu yeniden doldurup göndermek açar. Listede arayın.
- **Gün kapanmadan "yarın" diye düşünmek.** Gece 01:00'de iş günü hâlâ "bugün"dür; gelecekler listesi gün kapanışından sonra değişir.
- **Teminat referansına kart numarası yazmak.** Reddedilir (PCI). Slip / provizyon numarası yazın.
- **Kirli odaya misafir vermeyi engel sanmak.** Uyarıdır, engel değildir; onaylayıp girebilirsiniz. Engel olan: arızalı oda ve içinde misafir olan oda.
- **Online check-in'i onaylamayı giriş sanmak.** Onay belge kontrolüdür; girişi Gelecekler'den ya da pencerenin "Girişi yap" düğmesiyle yapın.
- **Mükerrer misafir kartlarını bırakmak.** WhatsApp eşleşmesi ve toplam harcama bozulur. Aynı kişinin iki kartını birleştirin (geri alınamaz; önce kalacak kartı doğru seçin).
- **Grup rooming list'inde oda tipi kodunu yanlış yazmak.** Hatalı satırlar yüklenmez, numarasıyla listelenir; şablondaki kodları Ayarlar → Oda tipleri'nden alın.
- **Oda planında sürükleyerek tarih değiştirmeyi denemek.** Yalnızca oda değişir; tarih için rezervasyon ayrıntısı → Düzenle.
- **Portal adresini girmeden otomatik davet beklemek.** Adres yoksa tur başlamaz; personel bağlantıyı yine kopyalayabilir.
