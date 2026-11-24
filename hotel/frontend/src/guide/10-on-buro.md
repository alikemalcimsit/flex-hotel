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

### Rezervasyon ayrıntısı

Bara ya da satıra tıklayınca açılan sayfa dört kart gösterir:

- **Konaklama:** giriş, çıkış, oda tipi, oda (varsa "bu odada ... tarihinden beri" — oda değiştirmiş misafirde), kişi sayısı, pansiyon, paket, kaynak, acente, kanal, açan kişi ve zaman, onay zamanı.
- **Misafir:** ad soyad, uyruk, telefon, e-posta; misafir kartına bağlantı.
- **Fiyat:** gece gece döküm (taban fiyat, sezon çarpanı ya da fiyat planı adı, indirim), vergi dökümü (bilgi amaçlı; tahsilat folyoda), iptal koşulu, varsa promosyon ve kupon.
- **Folyo:** pencereler, bakiyeler, "eksik oda ücreti" uyarısı, folyo ekranına bağlantı; gelmeden önce "Ön ödeme al".
- **Misafir portalı** kartı: portal bağlantısı, QR, davet ve online check-in durumu (aşağıda ayrı anlatılır).

**İşlemler:** Onayla (opsiyonludan kesine), Düzenle, İptal, Gelmedi, İptali / gelmediyi geri al. Hangi düğmenin açık olduğuna **sunucu** karar verir; kapalı düğmenin yanında sebebi yazar.

**Geçmiş** sekmesi: bu rezervasyona dokunan her işlemin adımları — kim yaptı, hangi aktör ne zaman devreye girdi, hangi alan neye değişti. Şikâyet incelemesinde ilk bakılacak yer burasıdır.

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

#### Opsiyonlu rezervasyon

"Opsiyonlu (onay bekliyor)" durumla açılan rezervasyon envanteri tutar ama misafire onay bildirimi **gitmez**; "Rezervasyonu onayla" düğmesiyle kesine çevrilince bildirim gider. Web sitesi widget'ından gelen rezervasyonlar da opsiyonlu açılır (ödeme adımı henüz olmadığı için); resepsiyon onaylar.

#### Overbooking (kapasite aşımı) onayı

Ayarlar → Genel parametreler → "Kapasite aşımı" iki seçenek sunar:

- **Reddet:** yer yoksa rezervasyon açılmaz; form "bekleme listesine al" önerir.
- **Onaya gönder:** istek Yönetim → Onaylar kuyruğuna düşer. Yönetici onaylarsa aynı istek kapasite aşılarak açılır (açan: isteyen personel; onaylayan ayrıca kayıtlıdır); isteyenin ziline sonuç düşer. Reddedilirse açılmaz.

Düzenleme, geri alma ve **kanaldan gelen istekler** (WhatsApp, OTA, widget) onaya gitmez; yer yoksa reddedilir.

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

### Grup rezervasyonu ve grup dosyası

**Nerede:** Yeni rezervasyon formunda tür "Grup"; grup dosyaları Rezervasyonlar → Gruplar (`/gruplar`, dosya `/gruplar/<kimlik>`).

**Grup formu:** Grup adı (ör. "ABC Kongre") ve satırlar: oda tipi, oda sayısı, yetişkin/oda, çocuk/oda, pansiyon, isteğe bağlı satır misafiri (ad soyad yeter; iletişim grup sorumlusunda). Bir satırdaki tip satılamıyorsa (yer yok, kontratta fiyat yok) **grubun hiçbiri açılmaz** — ya hep ya hiç.

**Rooming list:** "Excel'den yükle" ile şablonu indirip doldurun: Ad, Soyad, Oda tipi kodu, Pansiyon, Yetişkin, Çocuk. Dosya tarayıcıda okunur; hatalı satırlar numarasıyla listelenir, geçerliler grup satırlarına dolar. Rooming list **ortak tarihlidir** (grubun giriş/çıkışı); satır başına farklı tarih ileriki sürümde.

**Grup dosyası ekranı:** grubun rezervasyonları, durum dağılımı, folyo bakiyeleri ve toplamlar; seçimli **toplu oda atama**, **toplu check-in** (en fazla 50; kimlik bilgisi karttan ya da online check-in'den okunur), **toplu check-out**, grup iptali. Toplu işlemler tek tek işlemin aynı kurallarından geçer: odası atanmamış ya da kimliği eksik kayıt "ayrıntı ister" diye **atlanır** ve sebebiyle listelenir — o kayıtları tek tek alırsınız.

**Grup master folyo:** grubun hesabını tek folyoda toplamak için folyo ekranındaki **Birleştir** kullanılır (bkz. Folyo bölümü); grup dosyası yalnızca bakiyeleri okur.

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

**Dikkat:** sürükle-bırakla **tarih** değiştirme yoktur; tarih değişikliği rezervasyon ayrıntısındaki Düzenle ile yapılır. Bitmiş konaklamanın oda ataması kaldırılamaz.

## Giriş / çıkış

**Nerede:** Ön büro → Giriş / çıkış (`/on-buro`). Sekmeler: **Gelecekler** (`/on-buro/gelecekler`), **Gidecekler** (`/on-buro/gidecekler`), **Konaklayanlar** (`/on-buro/konaklayanlar`), **Online check-in** (`/on-buro/online-check-in`). Üstte günün özeti: gelecek / gidecek / içeride / gecikmiş sayıları, canlı tazelenir.

**Yetki:** listeleri "konaklama görüntüleme" yetkisi olan herkes görür (kat hizmetleri gidecekleri temizlik sırası için izler); giriş, çıkış ve geri alma "konaklama yönetimi" ister. Bakiyeyle çıkış ayrı bir yönetim yetkisidir.

### Gelecekler

**Görünümler:** "Bekleniyor" (girişi bugün olan ve geç kalanlar — dün gelmesi gerekip gelmeyen ertesi gün de girer) ve "Bugün girenler" (aynı gün yapılan giriş buradan geri alınır).

Satırda: misafir, oda (yoksa "oda verilmemiş"), odanın hazırlığı (temiz / kirli / arızalı), kimlik durumu, online check-in rozeti, "Giriş yap" düğmesi.

### Check-in penceresi

**Adım adım:**

1. "Giriş yap"a basın. Pencere konaklamayı yükler; **giriş yapılamayacak** bir durum varsa (çıkış günü geçmiş, iptal edilmiş, zaten içeride) üstte sebebiyle söyler.
2. **Oda:** verilmemişse aday odalar listelenir — misafirin tipi önce, en hazır (kontrol edilmiş / temiz) oda başta; kapasitesi yetmeyen ya da overbooking yaratacak oda listelenmez. Seçilen oda girişle **aynı işlemde** atanır. Odada önceki misafir hâlâ içerideyse ya da oda arızalıysa giriş olmaz; oda **kirliyse** uyarı çıkar, personel onaylayarak devam edebilir (otelin tercihi).
3. **Kimlik (KBS):** rezervasyon sahibinin belgesi zorunludur — Belge türü (Kimlik kartı / Pasaport / Diğer), Belge numarası (TC kimlik no sağlaması yapılır, pasaport biçimi denetlenir), uyruk, isteğe bağlı doğum tarihi. Otelin politikası "Bütün yetişkinler" ise refakatçi yetişkinlerin de belgesi girilir; **çocuk** işaretlenen refakatçide belge isteğe bağlıdır. Refakatçi belge numarasından tanınır: aynı kişiye ikinci kart açılmaz; belge başka adla kayıtlıysa pencere söyler.
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

### Konaklayanlar

Şu an içeride olan herkes: oda, giriş, çıkış, bakiye. Sıralama: çıkışı yakın olan önce / son giren önce / oda numarası. Tarih aralığı süzgeci "şu tarihlerde kim içerideydi" sorusuna da cevap verir.

### Girişi / çıkışı geri alma

**Nerede:** Gelecekler → "Bugün girenler" ve Gidecekler → "Bugün çıkanlar" görünümleri.

- Yalnızca **aynı iş günü** içinde geri alınır; sebep zorunludur ve denetim izine yazılır.
- **Giriş**, folyoda resepsiyonda alınan bir ödeme varsa geri alınmaz (ön ödeme ve giriş teminatı engellemez). Geri alınınca folyo aktörü erken giriş ücretini ve teminat ödemesini ters kayıtla düşer; oda aktörü odayı boşaltır.
- **Çıkış**, oda bu arada başka misafire verildiyse geri alınmaz. Erken ayrılışta bırakılan geceler geri **gelmez**. Geri alınınca folyo yeniden açılır, geç çıkış ücreti düşer; oda yeniden dolu olur.
- Daha sonraki düzeltmeler rezervasyon düzenlemesiyle yapılır.

## Online check-in ve misafir portalı

**Nerede (personel):** Ön büro → Giriş / çıkış → **Online check-in** sekmesi; rezervasyon ayrıntısındaki **Misafir portalı** kartı; portal ayarları (yetkili için). **Misafir tarafı:** `/misafir/p/<bağlantı>` adresindeki küçük misafir uygulaması (TR, EN, DE, RU; dil uyruğa göre açılır, misafir değiştirebilir).

### Portal ne sunar

Misafir, rezervasyonuna özel imzalı bağlantıyla (ya da QR'la) açar; şifre yoktur. Sayfalar: **Rezervasyonum**, **Online check-in**, **Folyom** (yalnızca misafirin ödediği pencereler; şirket / acente penceresi gösterilmez, yalnızca varlığı söylenir), **İstek gönder** (misafir istekleri ekranına "Misafir portalı" kaynağıyla düşer), **Oda servisi** (içerideki misafire; QR menü ve sipariş), **Spa randevusu** (otel açmışsa), **Anket** (açık anket varsa kutu), **Web sohbeti** (kanal açıksa). **Dijital anahtar** düğmesi yerinde ama **pasiftir** — donanım entegrasyonu gelince açılır.

Bağlantı rezervasyona bağlıdır; yenilenince eskisi geçersiz olur; iptal / gelmedi ve çıkıştan 14 gün sonra kapanır.

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
- Misafir onaydan **sonra** bilgi değiştirirse kayıt yeniden incelemeye düşer.

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

**Teknik servisle ilişki:** teknik servis bileti "Odayı kullanıma kapat" ile açılırsa arıza kaydını o açar ve bilet çözülünce kapatır. Günlük arıza işi için Teknik servis ekranını kullanın; bu pencere doğrudan tadilat / plan kaydı içindir.

### Müsaitlik

**Ne yapar:** satır oda tipi, sütun gece, hücrede **boş oda sayısı**. Renk kodu: kırmızı = overbooking (eksi), turuncu = son odalar, yeşil = rahat. Arızalı odalar sayıdan düşer; hizmet dışı odalar sayılır ama hücrede **nokta** ile işaretlenir — o gecenin son boş odası hizmet dışıysa satılan misafire oda bulunamaz.

**Dikkat:** sayı "kaç tane satılabilir"dir; acente kotasında tutulu odalar burada düşülmez (satış sırasında denetlenir).

### Oda atama

**Ne yapar:** odası olmayan rezervasyonlara oda vermek için bağımsız ekran (oda planındaki şeridin liste hâli). Görünümler ve arama ile rezervasyonu bulun; aday listesi sayfalıdır, "Diğer oda tiplerini de göster" ile başka tipe atama (üst sınıf / yan / alt sınıf olarak işaretli) yapılabilir; kapasite aşımı reddedilir. Giriş günü gelmiş ama gelmeyen misafir buradan "Gelmedi" işaretlenebilir ("Gelmeme ücretinden vazgeç" seçeneğiyle).

**Arka planda — otomatik atama:** rezervasyon açılınca **Oda aktörü** uygun odayı seçip atar. Bugün girecek misafir için **temiz / kontrol edilmiş** oda öne alınır — kat hizmetinin durumu zamanında işaretlemesi doğrudan atama kalitesini etkiler. Aktör kapalıysa "oda atanacak" manuel görevi düşer. Atama **yeni overbooking yaratamaz** ve arızalı / dolu odaya yapılamaz (veritabanı son savunma hattıdır).

## Misafirler ve misafir kartı (CRM)

**Nerede:** Ön büro → Misafirler (`/misafirler`); kart `/misafirler/<kimlik>`. Rezervasyon ayrıntısından ve mesajlar ekranından da açılır.

**Yetki:** görmek "misafir görüntüleme"; kart / tercih / not düzenleme "misafir yönetimi"; birleştirme ayrı "birleştirme" yetkisi (müdür ve resepsiyon).

### Misafir listesi

Ad, telefon ya da e-posta ile arama; her kartta konaklama sayısı, toplam harcama ve son konaklama. Üç harften kısa adla arama yapılmaz.

### Misafir kartı

Üstte **özet**: tamamlanmış konaklama sayısı (ilk / son konaklama), **toplam harcama** (folyolara işlenen borç), son konaklama. "Kartı düzenle": ad, soyad, telefon, e-posta, uyruk, doğum tarihi, kimlik türü ve no. Telefonu ülke kodu olmadan yazarsanız otelin kodu varsayılır.

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
