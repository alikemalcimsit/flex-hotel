# Arka planda ne oluyor

Bu bölüm FlexHotel'in görünmeyen yüzünü anlatır: siz bir düğmeye bastığınızda sistemin içinde ne olur, hangi işler kendiliğinden yapılır, kim yapar, bir şey ters giderse ne olur. Teknik bir metin değildir; otel müdürünün ya da sistemi başkasına anlatacak birinin "nasıl çalışıyor bu?" sorusuna cevap verebilmesi için yazıldı. Her alt bölümde somut bir örnek var; örnekler "Ayşe Hanım", "DEMO-0001" gibi uydurma ama gerçekçi verilerle anlatılır.

## Büyük resim: olay tabanlı sistem

Klasik bir otel programında "giriş yap" düğmesine basıldığında tek bir uzun kod parçası sırayla her şeyi yapar: odayı dolu yapar, hesabı açar, e-posta gönderir, kat hizmetine haber verir. Bu parçalardan biri bozulduğunda hepsi bozulur; birini değiştirmek için hepsine dokunmak gerekir.

FlexHotel farklı çalışır. "Giriş yap" düğmesi **yalnızca girişi yapar** ve sisteme bir **olay** bırakır: *"misafir giriş yaptı"* (teknik adı `guest.checked_in`). Bu olayı dinleyen **aktörler** vardır; her biri kendi işini bağımsız yapar:

- Oda aktörü olayı görür → odayı "dolu" yapar.
- Folyo aktörü olayı görür → misafirin hesabını (folyoyu) açar, erken giriş ücreti varsa işler, girişte alınan teminatı ödeme olarak yazar.
- Bildirim aktörü olayı görür → "Hoş geldiniz" mesajını şablondan hazırlayıp gönderim kuyruğuna yazar.

Aktörlerden biri kapalı olsa ya da hata verse diğerleri etkilenmez. Resepsiyonist düğmeye bastığında ekran anında döner; arka plandaki işler kendi hızlarında tamamlanır.

**Örnek:** Ayşe Hanım 14:05'te 204 numaralı odaya giriş yapıyor. Resepsiyonist "Giriş yap"a basar. Sistem şunları yapar: (1) rezervasyonu "içeride" durumuna alır, kimlik ve oda denetimini yapar, denetim izine "Resepsiyon kullanıcısı, 14:05, DEMO-0042 giriş yaptı" yazar ve `guest.checked_in` olayını kaydeder — hepsi tek bir veritabanı işleminde. (2) İşlem başarıyla bitince olay dağıtılır. (3) Oda aktörü 204'ü dolu yapar (yaklaşık birkaç milisaniye). (4) Folyo aktörü Ayşe Hanım'ın folyosunu açar; girişte alınan 1.000 TL nakit teminat ödeme olarak işlenir. (5) Bildirim aktörü Türkçe "Hoş geldiniz" SMS'ini kuyruğa yazar; gönderici 15 saniye içinde Netgsm'e iletir. (6) Bütün bu adımlar Aktivite → Canlı akış'ta tek bir **işlem zinciri** altında görünür.

### Olay nedir, nerede saklanır

Olay, sistemde olan önemli bir şeyin kaydıdır: adı, gövdesi (hangi otel, hangi rezervasyon, hangi oda…), zamanı, kim yaptığı ve hangi zincire ait olduğu. Olaylar bir **katalogda** tanımlıdır; katalogda olmayan bir olay yayınlanamaz ve gövdesi şemaya uymayan olay reddedilir. Bu, modüller arası "sözleşme"dir: rezervasyon modülü yazan kişiyle kat hizmeti modülünü yazan kişi farklı zamanlarda çalışsa da aynı dili konuşur.

Her olay `EventLog` tablosuna yazılır ve **Aktivite → Olaylar** (`/aktivite/olaylar`) ekranından görülebilir. Gövdedeki kişisel veriler (telefon, e-posta, kimlik, kart numarası) bu ekranda maskelenir.

Olay adları aile aile gruplanır; birkaç örnek:

| Olay ailesi | Örnekler | Kim yayınlar |
| --- | --- | --- |
| Ayarlar | otel bilgisi güncellendi, oda tipi / vergi / sezon / fiyat planı oluşturuldu-güncellendi-silindi, dinamik fiyat ayarı güncellendi | Ayarlar ekranları |
| Rezervasyon | oluşturuldu, güncellendi, onaylandı, iptal edildi, gelmedi, geri alındı, kanaldan istek geldi, reddedildi | Rezervasyon servisi, rezervasyon aktörü, kanal aktörü |
| Oda | atandı, durumu değişti, arızaya alındı / açıldı | Oda aktörü, kat hizmeti aktörü, teknik servis |
| Misafir | giriş yaptı, çıkış yaptı, giriş / çıkış geri alındı, mesaj geldi, niyet belirlendi, cevap yazıldı, istek açıldı | Ön büro, kanal geçitleri, niyet ajanı, istek ekranı |
| Folyo ve ödeme | folyo açıldı, kalem işlendi, oda ücretleri basıldı, kalem iptal edildi, kapandı, yeniden açıldı; ödeme alındı / iade edildi / iptal edildi | Folyo aktörü, ödeme servisi |
| Kat hizmeti | görev açıldı / değişti / başladı / bitti, oda kontrol edildi | Kat hizmeti aktörü ve ekranları |
| Bildirim | gönderim istendi, iptal edildi, başarısız oldu; personel uyarısı açıldı | Bildirim aktörü, bildirim merkezi |
| Onay | istendi, onaylandı, reddedildi, süresi doldu | Onay kuyruğu |
| Aktör ve görev | aktör ayarı değişti, manuel görev açıldı / güncellendi | Aktör paneli, aktör tabanı |
| Restoran ve stok | adisyon ödendi, adisyon odaya yazıldı, stok değişti, satın alma talebi değişti, mal kabul yapıldı | POS, stok aktörü, satın alma |
| Gün kapanışı | gün kapanışı başladı, kapandı | Gün kapanış ekranı |
| Rapor | soru soruldu / cevaplandı, kayıtlı rapor değişti, rapor tanımı değişti, veri yüklemesi tamamlandı | Rapor asistanı, tasarımcı, Excel yükleme |
| Kanal | kanal rezervasyonu alındı / değişti, fiyat değişti | Kanal yönetimi |
| Muhasebe, fatura, bordro | muhasebe kaydı işlendi, fatura kesildi / iptal edildi, bordro onaylandı / değişti | Muhasebe aktörü, fatura, bordro |
| İK | izin talebi açıldı / onaylandı / reddedildi / iptal edildi (`hr.leave.changed`); İK değişti — vardiya, puantaj, bordroya aktarım, belge, ayar, bakiye düzeltmesi (`hr.changed`) | İK servisi ve onay kararı dinleyicisi |
| Sadakat | sadakat puanı hareketi — kazanma, geri alma, harcama, iade, süre dolumu, düzeltme (`loyalty.points.changed`); sadakat seviyesi değişti (`loyalty.tier.changed`); üyelik / program ayarı değişti (`loyalty.changed`) | Sadakat aktörü, puan kullanma ve üyelik ekranları, süre işi |
| KBS | KBS kimlik bildirimi değişti — sıraya girdi, gönderiliyor, bildirildi, gönderilemedi, iptal, elle bildirildi, tekrar gönderildi (`kbs.notification.changed`); KBS ayarı değişti (`kbs.settings.changed`) | KBS aktörü, KBS göndericisi, KBS ekranları (tekrar gönder, elle bildirildi, ayar) |

### Outbox: olay kaybolmaz

Olayın yazılması ile dağıtılması arasında sunucu kapansa ne olur? Bunun için **transactional outbox** deseni kullanılır:

1. Olay, iş verisiyle **aynı veritabanı işleminde** yazılır (ör. rezervasyon kaydıyla birlikte). İşlem geri alınırsa olay da yazılmaz; "rezervasyon var ama olayı yok" ya da tersi olamaz.
2. İşlem tamamlanınca olay dinleyicilere dağıtılır ve "yayınlandı" diye işaretlenir.
3. Dağıtım yarıda kalırsa (sunucu çöktü) işaret boş kalır. Zamanlanmış **outbox tarayıcısı** 30 saniyede bir, iki dakikadan eski ve işaretsiz olayları bulup yeniden dağıtır.

Aktivite → Olaylar ekranındaki **"Yalnızca dağıtılmamış olaylar"** süzgeci bu bekleyenleri gösterir; normal çalışan bir sistemde liste boştur.

### Zincir (correlation)

Her HTTP isteği bir **zincir kimliği** alır. İsteğin yazdığı denetim izi, yayınladığı olay, o olayı işleyen aktörün aktivite satırı ve aktörün yayınladığı yeni olaylar aynı zincir kimliğini taşır. "Bu rezervasyona kim ne yaptı?" sorusunun cevabı tek tıktır: rezervasyon detayındaki **İşlem zinciri** bağlantısı ya da `/aktivite/zincir/:kimlik` adresi. Zincir bir ağaç olarak çizilir: olay → onu işleyen aktör → aktörün yazdığı değişiklik → yayınladığı yeni olay → onu işleyen aktör…

## Aktörler

### Aktör nedir

Aktör, bir ya da birkaç olayı dinleyen ve olay gelince kendi işini yapan bağımsız bir paket koddur. İki türü vardır:

- **Kural tabanlı aktör (worker):** Kesin kurallarla çalışır, yapay zekâ kullanmaz. Oda atama, folyo, kat hizmeti, bildirim, muhasebe, stok, kanal senkronu bu türdendir. Her zaman kuruludur.
- **LLM ajanı (agent):** Bir dil modeline (OpenAI) soru sorar; misafirle konuşmak, rapor sorusunu anlamak, bütçe sapmasını yorumlamak gibi "anlama" gereken işleri yapar. Sunucuda model anahtarı yoksa **kurulmaz**; sistem onlarsız eksiksiz çalışır.

Her aktörün bir **bildirgesi** (manifest) vardır: Türkçe adı, açıklaması, dinlediği olaylar, yayınladığı olaylar, onaya götürdüğü işler, yeniden deneme politikası ve kapalıyken işin düşeceği manuel görev modülü. Aktör paneli (`/aktorler`) "bu aktörü kapatırsam ne durur?" sorusunu koda bakmadan bu bildirgeden cevaplar.

### Her aktörün uyduğu beş kural

Bütün aktörler aynı tabandan türediği için aynı beş kurala uyar. Bunları bilmek, sistemin neden "güvenilir" olduğunu anlamanın anahtarıdır.

**1. Aynı olay iki kez işlenmez (idempotency).** Her aktör işlediği olayın kimliğini `ProcessedEvent` tablosuna yazar. Aynı olay tekrar gelirse (outbox tarayıcısı yeniden dağıttı, sunucu yeniden başladı) aktör sessizce geçer. Bu kayıtlar 30 gün saklanır. *Örnek:* Rezervasyon DEMO-0042 için "oluşturuldu" olayı dağıtım sırasında sunucu çöktüğü için 30 saniye sonra yeniden dağıtıldı. Oda aktörü ilk seferde 204'ü atamıştı; ikinci seferde kaydı görür, bir şey yapmaz. Misafire iki oda atanmaz, iki onay mesajı gitmez.

**2. Kapalıyken iş kaybolmaz.** Aktör panelden kapatılmışsa iş yapılmaz ama **manuel görev** olarak personelin önüne düşer ve ilgili personelin ziline uyarı gider. Tek istisna: telafisi aktörün kendi zamanlanmış işi olan olaylar (ör. kanal aktörü kapalıyken müsaitlik gönderimi) görev açmadan atlanır; aktör açılınca tam eşitleme yapılır. *Örnek:* Yönetici oda aktörünü "resepsiyon odaları kendisi seçsin" gerekçesiyle kapattı. Yeni rezervasyon gelince Görevler'e "Rezervasyona oda atanacak" başlıklı görev düşer; oda işlemleri yetkisi olanların zili çalar.

**3. Geçici hatada yeniden denenir.** Veritabanı bir an cevap vermezse aktör pes etmez; bildirgedeki sayıda (çoğunlukla 3, ajanlarda 2) artan aralıklarla dener. İş kuralı hatası ("bu rezervasyon zaten iptal") tekrar denemekle düzelmez; hemen bırakılır. Son denemede de olmazsa iş manuel göreve düşer; **hiçbir hata işi yok etmez.**

**4. İz bırakır.** Her işlem, süresi ve sonucuyla aktivite akışına yazılır: bilgi (başarılı), uyarı (kapalıydı, sıra doldu), hata. Geçici hatadan sonra başaran işin deneme sayısı da izde görünür.

**5. Onaya götürür.** Aktör bir işin personel kararı gerektirdiğini görürse ("bu iade 5.000 TL, eşiğin üstünde") onay ister. Olay o anda ne işlenmiş sayılır ne göreve düşer; onay verilince **aynı aktör aynı olayla** kaldığı yerden devam eder. Ayrıntı "Onay kuyruğu" başlığında.

### Arka planda çalışan aktörler

Oda atama gibi kısa, veritabanı içi işler olayı yayınlayanla aynı anda çalışır. Model çağrısı ya da dış API gibi saniyeler süren işler ise **sıraya alınır**; olayı yayınlayan beklemez. Bildirge "aynı anda en çok kaç iş çalışır" ve "sırada en çok kaç iş bekler" sınırlarını söyler. Sıra dolarsa iş ya personele düşer ya da (başka bir yoldan telafi ediliyorsa) atlanır. Aktör paneli bu sırayı canlı gösterir ("Sıra (bu sunucu)").

### Kayıtlı aktörlerin tam listesi

Aşağıda sunucuda kayıtlı her aktör, "tetikleyen olay → yaptığı iş → ürettiği olay → kapalıysa ne olur" düzeninde anlatılır. Türkçe adlar aktör panelinde görünenlerdir; parantez içindeki teknik ad ayar ve izlerde geçer.

#### Oda aktörü (room-worker)

Kural tabanlı. Kapalıyken görevler **"Oda atama"** modülüne düşer (oda işlemleri yetkisi olanlar görür). 3 deneme, 400 ms'den başlayan bekleme.

| Tetikleyen olay | Yaptığı iş | Ürettiği olay | Kapalıysa düşen görev |
| --- | --- | --- | --- |
| Rezervasyon oluşturuldu | Oda tipine, tarihe ve kapasiteye uygun boş odayı seçip atar | Oda atandı | "Rezervasyona oda atanacak" |
| Misafir giriş yaptı | Odayı "dolu" yapar | Oda durumu değişti | "Oda 'dolu' olarak işaretlenecek" |
| Misafir çıkış yaptı | Odayı "boş · kirli" yapar | Oda durumu değişti | "Oda 'boş · kirli' olarak işaretlenecek" |
| Giriş geri alındı | Doluluğu düzeltir (boş) | Oda durumu değişti | Düzeltme görevi |
| Çıkış geri alındı | Odayı yeniden dolu yapar | Oda durumu değişti | Düzeltme görevi |

*Örnek:* 10 Ekim için 2 kişilik Standart rezervasyon açıldı. Oda aktörü o tarihte boş, Standart tipinde ve arızalı olmayan odaları bulur, birini atar ve "Oda atandı" olayını yayınlar. Bu olayı bildirim aktörü dinler; ama oda bilgisi mesajı yalnızca giriş günü ya da misafir içerideyken gönderilir (günler önce atanan oda değişebilir).

#### Rezervasyon aktörü (reservation-worker)

Kural tabanlı. Kapalıyken **"Rezervasyon"** modülüne düşer. 3 deneme, 500 ms.

| Tetikleyen olay | Yaptığı iş | Ürettiği olay | Kapalıysa düşen görev |
| --- | --- | --- | --- |
| Kanaldan rezervasyon isteği geldi (WhatsApp, web chat, web motoru) | Müsaitlik ve fiyat denetimiyle rezervasyonu açar; yer yoksa gerekçeli ret üretir | Rezervasyon oluşturuldu **ya da** Rezervasyon reddedildi | "WhatsApp rezervasyon isteği elle açılacak: Ayşe Yılmaz, 10.10 – 13.10" |

Ret bir hata değildir: "15 Ekim'de Deluxe kalmadı" cevabı concierge ajanı tarafından misafire iletilir. Aynı istek tekrar gelirse istek kimliği sayesinde ikinci rezervasyon açılmaz.

#### Kat hizmeti aktörü (housekeeping-worker)

Kural tabanlı. Kapalıyken **"Kat hizmeti"** modülüne düşer. 3 deneme, 400 ms.

| Tetikleyen olay | Yaptığı iş | Ürettiği olay | Kapalıysa |
| --- | --- | --- | --- |
| Misafir çıkış yaptı | Çıkış temizliği görevi açar | Görev açıldı | "Çıkış temizliği görevi açılacak" |
| Çıkış geri alındı | Açık çıkış temizliği görevini iptal eder | Görev değişti | Görev |
| Oda arızadan açıldı (bakım bitti) | Detaylı temizlik görevi açar | Görev açıldı | "204 odası: bakım sonrası detaylı temizlik görevi açılacak" |
| Misafir kat isteği açtı (havlu, yastık; odası belli) | İsteği kat görevine çevirir | Görev açıldı | **Atlanır** — istek zaten İstekler ekranında görünür |
| Görevli "Başladım" dedi | Odayı "Temizleniyor" yapar | Oda durumu değişti | Görev |
| Görevli "Bitti" dedi | Odayı "Temiz" yapar; bağlı misafir isteğini kapatır | Oda durumu değişti, istek güncellendi | Görev |
| Kat şefi odayı kontrol etti | Odayı "Kontrol edildi" yapar | Oda durumu değişti | Görev |

*Örnek:* 305'teki misafir web chat'ten "iki havlu rica ediyorum" yazdı. İstek "kat hizmeti" kategorisinde açıldı. Kat hizmeti aktörü isteği 305 için bir göreve çevirdi; görevli telefonundan "Bitti" deyince aktör hem odanın durumunu güncelledi hem isteği "tamamlandı" yaptı — resepsiyonist İstekler ekranında kapanmış gördü, kimse elle kapatmadı.

Konaklayan odaların günlük temizlik görevleri bu aktörden değil, zamanlanmış bir işten gelir (bkz. "Zamanlanmış işler").

#### Folyo aktörü (billing-worker)

Kural tabanlı. Kapalıyken **"Folyo"** modülüne düşer (folyoya harcama işleme yetkisi olanlar). 3 deneme, 400 ms.

| Tetikleyen olay | Yaptığı iş | Ürettiği olay | Kapalıysa düşen görev |
| --- | --- | --- | --- |
| Misafir giriş yaptı | Folyoyu açar; erken giriş ücretini işler; girişte alınan nakit / havale teminatını ödeme olarak işler | Folyo açıldı, kalem işlendi, ödeme alındı | "Misafir girdi: folyo açılacak; teminat (1000.00) ödeme olarak işlenecek" |
| Misafir çıkış yaptı | Kalan geceleri ve geç çıkış ücretini işler; bakiye sıfırsa folyoyu kapatır | Oda ücretleri basıldı, folyo kapandı | Görev |
| Giriş / çıkış geri alındı | Kendi işlediği ücreti ve teminatı ters kayıtla düşer; kapanmış folyoyu yeniden açar | Kalem iptal edildi, folyo yeniden açıldı | Görev |
| Rezervasyon iptal edildi / gelmedi | Politikadaki iptal / gelmedi ücretini işler | Kalem işlendi | Görev |
| Rezervasyon geri alındı | İptal ücretini düşer | Kalem iptal edildi | Görev |
| Gecenin oda ücretleri vadesi geldi (zamanlanmış iş haber verir) / Gün kapanışı başladı | İçerideki her konaklamaya o gecenin oda ücretini basar (gece hassasiyetli; aynı gece iki kez basılmaz) | Oda ücretleri basıldı | Görev |
| Restoran adisyonu odaya yazıldı / minibar tüketildi / çamaşır teslim edildi / spa randevusu ücretlendirildi | Kalemi folyoya işler (çıkmış misafirin açık folyosuna "geç kalem" olarak da) | Kalem işlendi | Görev |
| Ödeme alındı / iade edildi / iptal edildi (konaklaması bitmiş folyoda) | Bakiye sıfırlandıysa folyoyu kapatır | Folyo kapandı | Görev |
| Folyo kapandı | Fatura taslağını açar (alıcı: folyo cariye aktarıldıysa cari, değilse misafir) | Fatura değişti | Görev |

*Örnek:* Ayşe Hanım çıkış günü 11:40'ta restoranda 480 TL'lik kahvaltı adisyonunu "odaya yaz" dedi. Garson adisyonu kapattı → "adisyon odaya yazıldı" olayı → folyo aktörü 204'teki konaklamayı buldu, folyoya "Restoran · Adisyon #1187 · 480,00" kalemini vergi dökümüyle işledi. Resepsiyonist çıkış ekranını açtığında kalem oradaydı.

#### Bildirim aktörü (notification-worker)

Kural tabanlı, sektörden bağımsız. Kapalıyken **"Bildirim merkezi"** modülüne düşer. 3 deneme, 400 ms.

| Tetikleyen olay | Yaptığı iş | Ürettiği olay | Kapalıysa |
| --- | --- | --- | --- |
| Rezervasyon oluşturuldu / onaylandı | "Rezervasyon onayı" bildirimini şablondan hazırlar, kuyruğa yazar | Gönderim istendi | "Misafire onay bildirimi elle gönderilecek" görevi |
| Oda atandı (giriş günü ya da içerideyken) | "Oda bilgisi" bildirimi | Gönderim istendi | Görev |
| Misafir giriş yaptı | "Hoş geldiniz" | Gönderim istendi | Görev |
| Misafir çıkış yaptı | "Teşekkür" | Gönderim istendi | Görev |

Aktör **göndermez**, kuyruğa yazar. Gönderimi ayrı bir gönderici yapar (15 saniyede bir ve yeni bildirimde anında). Dil: Türk ya da uyruğu bilinmeyen misafire Türkçe, diğerlerine İngilizce. Misafir kartında o kanal için "bildirim istemiyor" varsa satır "gönderilmedi" olur. Aynı olay iki kez işlense de ikinci bildirim açılmaz. Online check-in daveti, anket ve spa bildirimleri bu aktörden değil, kendi modüllerinin zamanlanmış işlerinden aynı kuyruğa girer.

#### Muhasebe aktörü (accounting-worker)

Kural tabanlı. Hem **ön muhasebeyi** (47: cari ve kasa / banka hareketleri) hem **genel muhasebeyi** (48: yevmiye fişleri) besler. Kapalıyken **"Ön muhasebe"** modülüne düşer; muhasebeci eşleme / cari / kural sorununu düzeltip **Ön muhasebe → Eşitle** (kayıtlar) ve **Genel muhasebe → Ayarlar → Eşitle** (fişler) ile dönemi tamamlar (aynı kaynak anahtarı: olay sonradan yeniden gelse kayıt ve fiş iki kez yazılmaz). 3 deneme, 400 ms.

| Tetikleyen olay | Yaptığı iş |
| --- | --- |
| Folyo ödemesi alındı / iade edildi / iptal edildi | Yöntem eşlemesine göre kasa / banka hareketi; "Acente / cari" ve voucher ile kapatılan folyoyu cariye borç; iptali ters kayıt |
| Etkinlik ödemesi değişti | Müşteri carisinden düşer |
| Restoran ödemesi değişti, spa ödemesi değişti | Kasa / bankaya işler |
| Mal kabul yapıldı | Tedarikçi carisine vadeli borç |
| Acente primi değişti (onaylandı) | Acente carisine alacak |
| Etkinlik değişti (gerçekleşti / iptal) | Etkinlik bedelini (iptalde iptal bedelini) müşteri carisine borç |
| Fatura kesildi / iptal edildi | Fatura numarasını cari harekete bağlar; serbest faturayı borç yazar, iptalde ters kayıt |
| Bordro onaylandı / değişti | Personel (net), SGK, vergi dairesi, BES, icra carilerine tahakkuk; maaş ödemesini kasa / bankadan çıkış |
| **Ön muhasebe kaydı işlendi** (`accounting.posted`, kaynak belge `sourceId` ile — kendi yazdığı dahil) | **Yevmiye fişi:** belgenin fişlenmemiş cari ve kasa / banka kayıtlarını Tek Düzen hesaplarına çevirir — kasa / banka hareketi `100.xx` / `102.xx`, cari hareketi kontrol hesabı (120.02, 320, 335…), kalan fark kurallara göre karşı hesap (gelir + KDV, stok + KDV, gider, 120.01). Kayıtlar fişe bağlanır; ikinci kez fişlenmez. Kilitli döneme ait belge kilit sonrası ilk güne yazılır. |
| **Gün kapandı** (`night.audit.closed`, iş günü `businessDay`) | **Günlük gelir fişi:** günün folyo kalemleri (hizmet günü; tür ve KDV oranıyla), odaya yazılmayan kapanan adisyonlar ve spa randevuları → gelir hesapları (600.xx) ve hesaplanan KDV (391) alacak, `120.01` misafir ve adisyon hesapları borç. Daha önce yazılanla **farkı** yazar ("düzeltme"). |

Ürettiği olaylar: "Muhasebe kaydı işlendi" (`accounting.posted`) ve "Genel muhasebe değişti" (`ledger.changed`: fiş / hesap planı / kural / ayar; Yevmiye ve Mizan ekranlarını tazeler). *Örnek:* Resepsiyon 2.400 TL kredi kartı tahsilatı aldı. Muhasebe aktörü yöntem eşlemesinde "Kredi kartı → Garanti POS hesabı" tanımını bulur ve o banka hesabına giriş hareketi yazar; `accounting.posted` yayınlar. Aynı aktör bu olayı dinler ve belgeyi yevmiye fişine çevirir: `102.02 Garanti POS (TRY)` 2.400,00 borç / `120.01 Misafir ve adisyon hesapları` 2.400,00 alacak. Eşleme yoksa iş "Ön muhasebe" görevi olur; muhasebeci eşlemeyi tanımlayıp Ön muhasebe → Eşitle'ye basar. Fiş kuralı eksikse (ör. hesap pasif) kayıt yazılır ama fiş yazılmaz; görev "Ön muhasebe kaydı … yevmiye fişine çevrilecek" başlığıyla düşer, muhasebeci kuralı düzeltip Genel muhasebe → Ayarlar → Eşitle'ye basar.

#### Stok aktörü (inventory-worker)

Kural tabanlı. Kapalıyken satış düşümü **"Stok"** modülüne düşer (elle çıkış hareketiyle tamamlanır; adisyon numarası görevde). 3 deneme, 400 ms.

| Tetikleyen olay | Yaptığı iş | Ürettiği olay | Kapalıysa |
| --- | --- | --- | --- |
| Adisyon ödendi (kapandı) | Satılan, ikram edilen ve hazırlanıp iptal edilen ürünleri reçetelerinden malzemeye açar, satış noktasının deposundan düşer; adisyon yeniden açılıp kapanırsa farkı düzeltir; reçetesi olmayan ürünü atlar; tepsi / paket ücretini düşmez | Stok değişti | "Adisyon 1187 stoktan düşülecek (4 ürün)" |
| Stok değişti (çıkış, fire, transfer, sayım) | Minimumun altına inen malzeme için (yoldaki ve talepteki düşüldükten sonra) satın alma talebi açar, satın alma yetkilisine zil | Satın alma talebi değişti, personel uyarısı | **Atlanır** — satın alma ekranındaki öneri listesi aynı hesabı her an gösterir |

#### Sadakat aktörü (loyalty-worker)

Kural tabanlı (modül 56). Misafire puan kazandırır ve kazanılanı düzeltir. Puan kullanma (folyoya indirim) aktörün işi değildir; resepsiyon rezervasyon ayrıntısından yapar. Kapalıyken iş **"Sadakat"** modülüne manuel görev olarak düşer (`loyalty.manage` sahibi görür) ve hesap sayfasında elle düzeltmeyle tamamlanır. Her kaynakta puan "hak edilen − yazılmış = fark" mantığıyla yazıldığı için aktör yeniden açılıp aynı olay gelse de puan iki kez yazılmaz. 3 deneme, 400 ms. İş kuralı hatası (ör. hesap kapalı) yeniden denenmez, doğrudan göreve düşer.

| Tetikleyen olay | Yaptığı iş | Ürettiği olay | Kapalıysa (görev başlığı) |
| --- | --- | --- | --- |
| Folyo kapandı (`folio.closed`) | Rezervasyon sahibine uygun harcamadan puan yazar: vergi kalemleri hariç, indirimler düşülmüş, seviye çarpanıyla, aşağı yuvarlı. Otomatik üyelik açıksa hesabı açar. Acente / voucher ödemeli folyoda (ayar açıkken) 0 | Sadakat puanı hareketi; seviye değiştiyse sadakat seviyesi değişti ve yükselişte zil (`LOYALTY`) | "Kapanan folyonun sadakat puanı yazılacak" |
| Folyo yeniden açıldı (`folio.reopened`) | O folyodan kazanılanı geri alır. Folyo yeniden kapanınca yeni toplamın puanı yazılır | Sadakat puanı hareketi | "Yeniden açılan folyonun sadakat puanı geri alınacak" |
| Folyo kalemi iptal edildi (`folio.item.voided`) | Kalem bir puan indirimiyse puanı düşüldüğü paketlere iade eder; değilse bir şey yapmaz | Sadakat puanı hareketi | "İptal edilen kalem puan indirimiyse puan iade edilecek" |
| Spa randevusu değişti (`spa.appointment.changed`: tamamlandı, geri alındı, ücretlendi, fiyatı değişti) | Misafir kartına bağlı randevuda spa kasasında ödenen tutarın puanını yazar ya da düzeltir (ayarda "Spa kasasında ödenen randevu kazanır" açıksa) | Sadakat puanı hareketi | "Spa randevusunun sadakat puanı yazılacak" |

*Örnek:* Ayşe Demir'in 2.480 TL'lik folyosu kapandı. Aktör `folio.closed`'u yakaladı. Ayşe'nin hesabı yoktu; otomatik üyelik açık olduğu için `SDK-000001` açıldı ve "Kazanıldı +248" yazıldı. Aktör `loyalty.points.changed` yayınladı; Aktivite → Canlı akış'ta aktörün işi "SDK-000001: +248 puan" diye göründü. Ertesi hafta müdür folyoyu yeniden açtı ve aktör −248 yazdı. Folyo 3.000 TL ile yeniden kapanınca aktör +300 yazdı. Aktör o sırada kapalı olsaydı Görevler'de "Kapanan folyonun sadakat puanı yazılacak" görevi çıkardı; müdür Sadakat → Üyeler → hesap → **Düzeltme** ile +248 girip (gerekçe: "Folyo … puanı, aktör kapalıydı") görevi tamamlardı.

#### KBS aktörü (kbs-worker)

Kural tabanlı (modül 58). Konaklama olaylarından **kişi başına** KBS kimlik bildirimi açar; bildirimi dışarı göndermez, gönderimi **KBS göndericisi** (zamanlanmış iş) yapar. KBS ayarı kapalıysa hiçbir şey yapmaz ("KBS kapalı"). Kapalıyken iş **"KBS"** modülüne manuel görev olarak düşer (`kbs.send` sahibi görür): bildirim yasal yükümlülük olduğu için personel resmî KBS ekranından elle bildirir. Bildirimin kaynak anahtarı tekil olduğundan aktör yeniden açılıp aynı olay gelse de ikinci bildirim açılmaz. 3 deneme, 400 ms. İş kuralı hatası (4xx) yeniden denenmez, doğrudan göreve düşer.

**Bugün gerçek KBS / JKBS bağlı değildir;** gönderici yalnız Test ortamına gönderir (dışarı bir şey gitmez). Ayrıntı ve elle bildirme yolu: Ön büro → "KBS kimlik bildirimi".

| Tetikleyen olay | Yaptığı iş | Ürettiği olay | Kapalıysa (görev başlığı) |
| --- | --- | --- | --- |
| Misafir giriş yaptı (`guest.checked_in`) | Belgesi girilen her kişi (rezervasyon sahibi ve refakatçiler) için **Giriş** bildirimi açar; belgesiz çocuk atlanır. Zorunlu alan eksikse bildirimi "Gönderilemedi" (`MISSING_FIELDS`) açar ve zil çalar | KBS bildirimi değişti; eksikte personel uyarısı (`KBS`) | "Giren misafirin KBS giriş bildirimi elle yapılacak" |
| Misafir çıkış yaptı (`guest.checked_out`) | İçeride bildirilmiş her kişi için **Çıkış** bildirimi (ayarda "Çıkış bildirimi" açıksa); kişinin son bildirilen odasıyla, girişe bağlı | KBS bildirimi değişti | "Çıkan misafirin KBS çıkış bildirimi elle yapılacak" |
| Giriş geri alındı (`guest.check_in_reverted`) | Gönderilmemiş bildirimleri iptal eder; gönderilmiş girişi **Çıkış** bildirimiyle kapatır ("Giriş geri alındı (yanlış giriş) …") | KBS bildirimi değişti | "Geri alınan girişin KBS kaydı elle düzeltilecek" |
| Çıkış geri alındı (`guest.check_out_reverted`) | Gönderilmemiş çıkışı iptal eder; gönderilmiş çıkıştan sonra yeniden **Giriş** bildirir | KBS bildirimi değişti | "Geri alınan çıkışın KBS kaydı elle düzeltilecek (yeniden giriş)" |
| Oda atandı (`room.assigned`, konaklama içerideyken) | Son bildirilen odası yeni odadan farklı her kişi için **Oda değişikliği** bildirimi (ayarda açıksa). Girişte oda verilmesi bildirim açmaz | KBS bildirimi değişti | "Oda değiştiren misafirin KBS oda değişikliği elle bildirilecek" |

**Gönderici** (aktör değil, zamanlanmış iş): sırası gelmiş ve bağlı olduğu bildirimi (girişi) bildirilmiş ya da elle bildirilmiş olanları üstlenir; iki süreç aynı bildirimi alamaz. Kimliği gönderim anında misafir kartından kurar ve zorunlu alanları yeniden denetler. Geçici hatada 1, 5, 15, 60, 180, 360 dakika sonra yeniden dener; hak bitince ya da kalıcı hatada "Gönderilemedi" yazar ve `kbs.send` sahiplerine zil çalar (`KBS`). Bağlı olduğu bildirim iptal edilen bekleyeni de iptal eder.

*Örnek:* Anna Schmidt, Max Schmidt ve belgesiz çocuk Mia 101'e girdi. Aktör `guest.checked_in`'i yakaladı ve 2 giriş bildirimi açtı; Aktivite → Canlı akış'ta aktörün işi "…: 2 giriş bildirimi sıraya alındı; 1 belgesiz çocuk bildirilmedi" diye göründü. Gönderici saniyeler içinde ikisini test ortamına gönderdi ve "Bildirildi" (`TKBS-…`) yazdı. Ertesi gün oda 103'e değişti; aktör `room.assigned`'dan 2 oda değişikliği bildirimi açtı. Aktör o sırada kapalı olsaydı Görevler'de "Oda değiştiren misafirin KBS oda değişikliği elle bildirilecek" görevi çıkardı; resepsiyon resmî KBS ekranından elle bildirip görevi notla tamamlardı.

#### Kanal aktörü (channel-sync-worker)

Kural tabanlı. Kapalıyken gelen rezervasyonlar **"Kanal rezervasyonu"** modülüne düşer (rezervasyon yönetimi yetkisi); giden değişiklikler görev açmadan atlanır. 3 deneme, 1 sn.

| Tetikleyen olay | Yaptığı iş | Ürettiği olay | Kapalıysa |
| --- | --- | --- | --- |
| Müsaitliği etkileyen her olay (rezervasyon, iptal, arıza…) ve fiyat değişti | Senkrondaki Channex ve iCal kanallarını "gönderilecek değişiklik var" diye işaretler; gönderimi zamanlanmış iş yapar (farkı birleştirir, hız sınırına uyar) | — | **Atlanır**; aktör açılınca tam eşitleme istenir |
| Aktör ayarı değişti (bu aktör açıldı) | Kanallarda tam eşitleme ister | — | — |
| Kanaldan rezervasyon alındı (yeni, değişiklik, iptal) | Rezervasyonu açar / değiştirir / iptal eder | Rezervasyon oluşturuldu / güncellendi / iptal edildi, kanal rezervasyonu değişti | "Kanaldan gelen rezervasyon elle işlenecek (Kanal yönetimi → Rezervasyonlar)" |

Eşleşmeyen oda tipi ya da içerideki misafirde değişiklik gibi işleyemediği durumlarda da aynı görev düşer.

#### WhatsApp geçidi (whatsapp-gateway) ve Web chat geçidi (webchat-gateway)

Kural tabanlı, "giden taraf" aktörleri. Her zaman kayıtlıdır; kanalın o otelde açık olup olmadığı Ayarlar → Mesaj kanalları'ndan okunur. Kapalıyken mesajlar "gönderim bekliyor" kalır; görev açılmaz (bekleyenleri gönderen iş telafi eder).

| Tetikleyen olay | Yaptığı iş | Ürettiği olay |
| --- | --- | --- |
| Misafire cevap yazıldı (personel ya da AI) | WhatsApp: Cloud API ile gönderir, teslim durumunu işler; 24 saat penceresi kapalıysa göndermez, sebebini yazar. Web chat: misafirin oturumuna iletir; çevrimdışıysa balon açılınca geçmişle alır | Mesaj teslim durumu |

Gelen mesajlar bu aktörlerden değil, webhook'tan (WhatsApp) ya da socket'ten (web chat) gelir ve "misafir mesajı geldi" olayını üretir. Her mesaj gönderilmeden önce **sahiplenilir**: hem olay yoluyla hem "bekleyenleri gönder" işiyle gelse de bir kez gider.

#### Niyet ajanı (router-agent) — LLM

Küçük, ucuz bir modelle misafir mesajının niyetini belirler: rezervasyon, soru, şikâyet, personel isteği. 2 deneme, 800 ms. Arka planda çalışır (16 eşzamanlı, 1000 sıra). Kapalıysa ya da hata verirse AI modundaki konuşma **personele alınır** (misafir cevapsız kalmaz) ve **"Misafir mesajları"** görevi düşer: "Misafir mesajı elle cevaplanacak (AI devre dışı)".

| Tetikleyen olay | Yaptığı iş | Ürettiği olay |
| --- | --- | --- |
| Misafir mesajı geldi (konuşma AI modundaysa) | Niyeti belirler, mesaja ve konuşma hafızasına yazar | Niyet belirlendi |

#### Concierge ajanı (concierge-agent) — LLM

Misafirle konuşur. 2 deneme, 1 sn. Arka planda (16 eşzamanlı, 1000 sıra). Kapalıysa konuşma personele alınır ve "Misafir mesajları" görevi düşer.

| Tetikleyen olay | Yaptığı iş | Ürettiği olay | Kapalıysa düşen görev |
| --- | --- | --- | --- |
| Niyet belirlendi | Müsaitlik ve fiyat bakar, teklif hazırlar, otel bilgisini cevaplar; misafir **yeni bir mesajda açıkça** onaylayınca rezervasyon ister; şikâyet ve personel isteğini modelsiz devreder | Rezervasyon isteği | "Misafir mesajı elle cevaplanacak (AI devre dışı)" |
| Rezervasyon oluşturuldu (kendi isteğinden) | Onay kodunu veritabanından şablonla sohbete yazar, konuşmayı rezervasyona bağlar | — | "Misafire rezervasyon onay kodu elle iletilecek" |
| Rezervasyon reddedildi | Sebebi sohbete yazar | — | Görev |

Korumalar: tur başına en fazla 5 model çağrısı; teklif 30 dakika geçerli; 30 geceden uzun, 10 kişiden kalabalık ya da 540 günden ileri istek personele; AI yalnızca otelin varsayılan pansiyonuyla fiyat verir (başka pansiyon, grup, uzun konaklama personele); konuşma başına günlük cevap sınırı (ayardan). AI'ın açtığı rezervasyon ayara göre **kesin** (onay bildirimi gider) ya da **opsiyonlu** olur.

*Örnek:* Pazar 22:40'ta web chat'ten "15-17 Ekim 2 kişi fiyat?" geldi. Niyet ajanı: rezervasyon. Concierge: müsaitlik aracıyla Standart ve Deluxe fiyatını baktı, "Standart 2 gece 4.800 TL, kahvaltı dahil" teklifini yazdı. Misafir "evet, Standart olsun" dedi → yeni mesajda açık onay + teklif önceki turda sunulmuş + fiyat yeniden denetlendi → "rezervasyon isteği" olayı → rezervasyon aktörü açtı → oda aktörü atadı → concierge "Rezervasyonunuz DEMO-0107 koduyla alındı" yazdı. Ekip pazartesi sabah Mesajlar'da bitmiş konuşmayı gördü.

#### Bütçe yorum ajanı (budget-agent) — LLM

| Tetikleyen olay | Yaptığı iş | Ürettiği olay | Kapalıysa |
| --- | --- | --- | --- |
| Bütçe yorumu istendi (sapma raporunda düğme) | Sistemin hesapladığı sapmayı (en büyük kalemler, oda gelirinde doluluk mu fiyat mı, eksik gerçekleşen) kısa Türkçe paragrafla yorumlar; **rakam hesaplamaz** | Bütçe yorumu tamamlandı | İstek "yorum yapılamadı" olarak kapanır; rapor yorumsuz tam çalışır |

#### Geri bildirim ajanı (insight-agent) — LLM

| Tetikleyen olay | Yaptığı iş | Ürettiği olay | Kapalıysa |
| --- | --- | --- | --- |
| Anket cevabı analizi istendi | Açık uçlu yoruma duygu (olumlu / nötr / olumsuz / karışık), en fazla beş konu ve tek cümlelik özet verir; **puanları sistem hesaplar**, ajan kişi adı ve iletişim bilgisi görmez | Analiz tamamlandı | İstek "yapılamadı" olur; anket AI'sız tam çalışır |
| Dönem özeti istendi | Ana temalar, örnek alıntılar, bir paragraf özet, en fazla üç öneri | Özet tamamlandı | Aynı |

#### Dinamik fiyat ajanı (pricing-agent) — LLM

| Tetikleyen olay | Yaptığı iş | Ürettiği olay | Kapalıysa |
| --- | --- | --- | --- |
| Fiyat değerlendirmesi istendi (6 saatte bir zamanlanmış iş) | Yalnız eşiklere yakın günlerin kompakt verisine (doluluk, kalan gün, geçen yıl; en fazla 120 satır) bakar, gerekçeli öneriler üretir; çıktı satır satır doğrulanır (bilinmeyen tip, pencere dışı tarih, emniyet dışı yüzde, bekleyen dönemle çakışma yalnız o satırı düşürür) | Öneriler **onay kuyruğuna** girer (kural tabanlı yield ile aynı kapıdan) | **Kural tabanlı yield çalışmaya devam eder**; kimse fiyatsız kalmaz |

Ajan **hiçbir yerde fiyat değiştirme yetkisine sahip değildir**; her önerisi "Toplu fiyat değişimi" onayıdır.

#### Rapor ajanı (report-agent) — LLM

| Tetikleyen olay | Yaptığı iş | Ürettiği olay | Kapalıysa |
| --- | --- | --- | --- |
| Rapor sorusu soruldu | Soruyu bir **rapor tanımına** çevirir (doluluk, oda geliri / ADR / RevPAR, oda tipi ve kaynak kırılımı, 30 günlük tahmin, bütçe sapması + göreli dönem + gruplama), raporu araçla görür, grafik tipini (çizgi / sütun / tablo) ve kısa yorumu seçer; **tabloyu sistem çalıştırır**, model rakam üretmez; en fazla 6 model çağrısı | Rapor sorusu cevaplandı | Soru "cevaplanamadı" olur; **"Rapor talebi"** görevi rapor yetkilisine düşer (başlık sorudan) |

### Aktör kapalıysa ne olur — adım adım

1. Yönetici Aktörler panelinde aktörün anahtarını kapatır; sistem "Kapatınca ne olur" uyarısını gösterir, gerekçe ister (isteğe bağlı).
2. Ayar kilitli olarak yazılır (iki yönetici aynı anda kapatsa sonuç yine kapalı), denetim izine ve aktivite akışına düşer, "aktör ayarı değişti" olayı yayınlanır.
3. Aktör her olayda ayarı veritabanından okur; **bir sonraki olayda** durur (önbellek yoktur).
4. Gelen her olay için: ya manuel görev açılır + ilgili iznin zili çalar + akışa uyarı satırı yazılır, ya da (telafisi başka yolla olan olaylarda) "atlandı" bilgisi yazılır.
5. Onaylanmış bir iş, aktör kapalı olsa da yapılır: onay bir kez verilmiştir, personele aynı işi ikinci kez sormak olmaz.
6. Aktör yeniden açıldığında aradaki olaylar **yeniden işlenmez** (zaten göreve düştü ve işlenmiş sayıldı); açık görevler personelde kalır. Kanal aktörü istisnadır: açılınca kanallarda tam eşitleme ister.

## Onay kuyruğu

### Hangi işler onaya gider

Para izini ya da kapasiteyi değiştiren riskli işler kendi kendine yapılmaz. Onayı bir **aktör** isteyebilir (ör. ödeme eşiği) ya da bir **servis** doğrudan açabilir (ör. folyo kalemi iptali düğmesi). HTTP'den elle onay açılamaz; onay her zaman bir işin sonucudur.

| Onay türü | Hangi iş | Kim ister | Kim karar verir | Dört göz |
| --- | --- | --- | --- | --- |
| Para iadesi | Folyoya iade | Ödeme ekranı (iade isteme yetkisi) | Onayla / reddet yetkisi (varsayılan: yönetici, müdür) | Evet |
| Büyük ödeme | Genel parametrelerdeki **büyük ödeme eşiğini** aşan tahsilat | Ödeme ekranı | Aynı | Evet |
| Ödeme iptali | Hatalı girilen ödemenin iptali | Ödeme ekranı | Aynı | Evet |
| Folyo kalemi iptali | Folyodaki kalemin iptali | Folyo ekranı (harcama işleme yetkisi) | Aynı | Evet |
| Toplu fiyat değişimi | Dinamik fiyat önerisi (kural ya da AI) | Yield işi / fiyat ajanı | Aynı (Fiyat önerileri ekranından da) | Hayır (isteyen sistem) |
| Kapasite aşımı (overbooking) | Yer yokken rezervasyon açma (politika "Onaya gönder" ise) | Rezervasyon servisi | Aynı | Hayır |
| Acente prim hak edişi | Dönem sonu hak edişinin onayı | Acente primi ekranı (hesapla → onaya gönder) | Aynı | Evet |
| Etkinlik ödemesi | Büyük etkinlik ödemesi, iade, iptal | Etkinlik ödeme ekranı | Aynı | Evet |
| Adisyon düzeltmesi | İkram, indirim, gönderilmiş kalemin iptali | POS (şef garson) | Aynı | Evet |
| Restoran ödemesi | Büyük ödeme, hatalı giriş iptali | POS | Aynı | Evet |
| Spa ödemesi | Büyük ödeme, iade, hatalı giriş iptali | Spa kasası | Aynı | Evet |
| Satın alma siparişi | Eşik üstü tutarlı sipariş (kazanan teklif) | Satın alma → teklif turu | Aynı | Evet |
| Ödeme fişi | Eşik üstü ödeme fişi (ön muhasebe ayarındaki eşik) | Ön muhasebe → fiş | Aynı | Evet |
| Fatura iptali | Kesilmiş faturanın iptali | Faturalar | Aynı | Evet |
| Bordro onayı | Hesaplanan bordronun onayı | Bordro → onaya gönder | Aynı | Evet |
| İzin talebi (`LEAVE`) | Personelin izin talebi ya da İK'nın personel adına girdiği izin (İK ayarında izin onayı açıksa); **süresiz bekler** | İzinlerim → İzin talebi; İK → İzinler → İzin gir | Aynı | Evet |
| Diğer | Serbest | — | Aynı | Hayır |

**Dört göz kuralı:** "Evet" yazan türlerde isteyen kişi **kendi isteğini onaylayamaz**; ekranda düğme kilitlenir ve sebebi yazar. Reddederek geri çekebilir. Sebep basittir: nakit alınmış bir ödemeyi iptal edip farkı cebe atmak ya da kendine iade yazmak klasik kasa açığıdır; büyük ödemede yazım hatası (10.000 yerine 100.000) misafiri "ödendi" diye çıkarır.

### Bir onayın hayatı

1. **İstek.** Onay kaydı açılır: tür, özet ("DEMO-0042 iade 1.250,00 TRY"), gerekçe, tutar, ilgili kayıt, isteyen (aktör ya da kişi), **son karar anı**. Aktör istediyse olayın zarfı "bekleyen iş" olarak saklanır. Aynı aktör + aynı olay için ikinci istek açılmaz.
2. **Uyarı.** Karar yetkisi olanların ziline "Onay bekliyor" düşer; yan menüde Onaylar rozeti ve üst barda sayaç artar (süresi yaklaşan varsa kırmızı).
3. **Karar.** Yetkili `/onaylar/bekleyen`'de satırdan ya da detaydan **Onayla** (not isteğe bağlı) ya da **Reddet** (gerekçe zorunlu) der. Karar satır kilidiyle yazılır: iki yönetici aynı anda karar veremez; ikinci "zaten karara bağlanmış" alır.
4. **Devam.** Onaylandıysa isteyen aktör **aynı olayla, aynı zincirde** kaldığı yerden devam eder; aktör olarak onaylayan kişi yazılır ("kim yetkilendirdi"). Olay bus'a yeniden verilmez — verilseydi aynı olayı dinleyen diğer aktörler işi ikinci kez yapardı. Servis istediyse ilgili modülün kendi dinleyicisi işi bitirir. Reddedildiyse iş yapılmaz, olay o aktör için işlenmiş sayılır.
5. **Süre dolumu.** İsteyen süre vermediyse onay **1 gün** bekler (en çok 30 gün; bazı istekler süresiz). Dakikada bir çalışan iş süresi dolanları düşürür; iş yapılmaz, zile "Süresi doldu, yapılmadı: …" uyarısı gider, aktivite akışına nedeni yazılır. Süresi geçmiş ama henüz düşürülmemiş onaya karar verilemez; o anda düşürülür.
6. **İz.** Açılış ve karar denetim izine (karar veren kişiyle), aktör tarafı aktivite akışına yazılır ("onaya gönderildi", "onay reddedildi", "iade yapıldı").

*Örnek:* Resepsiyonist Mehmet 16:20'de 1.250 TL iade isteği açtı. Müdür Zeynep'in zili çaldı. Zeynep 16:35'te detayı açtı: gerekçe "misafir erken ayrıldı, 1 gece iade", ilgili folyo bağlantısı, son karar anı ertesi gün 16:20. "Onayla" dedi, not yazdı. Ödeme modülünün dinleyicisi iadeyi yazdı; Mehmet'in ziline "İstediğim onayın sonucu: onaylandı" düştü; muhasebe aktörü iadeyi kasadan çıkış olarak işledi. Mehmet kendi isteğini açsaydı "Onayla" düğmesi kilitli olurdu.

*Örnek (izin talebi):* Resepsiyonist Ayşe İzinlerim'den 3 günlük yıllık izin istedi. İzin "Onay bekliyor" açıldı, onay kuyruğuna `LEAVE` ("İzin talebi") türünde iş düştü (süresiz), İK izni olanların ziline `HR` türünde "İzin talebi: Ayşe Demir" uyarısı gitti. Ayşe kendi talebini onaylayamaz. Müdür Burak onaylayınca İK modülünün dinleyicisi `approval.granted`'ı yakaladı, yıllık izin bakiyesini **yeniden denetledi** (bu arada bakiye değiştiyse izni reddeder), izni "Onaylandı" yaptı, `hr.leave.changed` yayınladı ve Ayşe'nin ziline "İzniniz onaylandı" düştü; açık İK ekranları `hr.changed` kanalından tazelendi. Ayşe talebi kararlanmadan iptal etseydi onay işi "süresi doldu" olarak kapanırdı.

Aktör kayıttan kalkmışsa (paket kaldırıldı, ad değişti) onaylanan iş kaybolmaz: **"Onay kuyruğu"** modülünde "Onaylanan iş elle yapılacak: …" görevi açılır.

## Yapay zekâ ajanları: sınırlar ve güvenceler

### Anahtar yoksa

AI ajanları (niyet, concierge, bütçe yorum, geri bildirim, dinamik fiyat, rapor) yalnızca sunucuda `OPENAI_API_KEY` tanımlıysa kaydedilir. Yoksa:

- Aktör paneli onları yine gösterir, yanında "Sunucuda OPENAI_API_KEY tanımlı değil; ajan çalışmıyor" notuyla; ayarları değiştirilebilir (anahtar gelince geçerli).
- Yeni misafir konuşmaları **personel modunda** açılır; gelen kutusu normal çalışır.
- Rapor asistanı "AI asistanı şu an kullanılamıyor" uyarısı gösterir ve soruyu **"Rapor talebi gönder"** ile personele iletir.
- Dinamik fiyat **kural tabanlı** çalışır.
- Bütçe yorumu ve anket özeti düğmeleri "yapılamadı" döner; rapor ve anket eksiksizdir.

### Her model çağrısından önce üç denetim

Her ajan, modeli çağırmadan önce şunu sorar: (1) Otelin AI'ı açık mı (Ayarlar → AI asistanı)? (2) Modelin fiyatı tanımlı mı? (3) **Günlük bütçe** yetiyor mu? Biri "hayır" ise çağrı yapılmaz, tekrar denenmez; ajan işi personele devreder. Çağrıdan hemen sonra token kullanımı ve maliyet kaydedilir — işin geri kalanı hata verse de harcanan para görünür.

### Bütçe

- Bütçe **otel geneli, günlük, USD** cinsindendir ve bütün ajanlar paylaşır (iş gününe göre sıfırlanır). Fiyatlar (girdi / önbellekli girdi / çıktı, milyon token başına) ayarlara girilir; maliyet yukarı yuvarlanır.
- Bütçe dolunca model çağrılmaz; konuşma personele geçer; yönetimin ziline **"AI bütçesi doldu"** uyarısı düşer. Aktör panelindeki ajan kartı günlük bütçeyi, ajanın payını ve dönem maliyetini çubukla gösterir.
- Her çağrı ayrıca günlük özete (otel × gün × ajan × model) sayılır; büyük otelde günde on binlerce çağrı olsa da ekran birkaç satır okur.

### Devir (handoff)

Konuşma şu durumlarda **personele devredilir**: misafir şikâyet etti ya da "bir yetkiliyle görüşmek istiyorum" dedi (modelsiz, anında); istek sınırların dışında (30+ gece, 10+ kişi, 540+ gün, farklı pansiyon, grup); bütçe doldu; ajan hata verdi ya da kapalı; ajan 5 dakikadan uzun süre cevap vermedi (süpürücü iş). Devirde misafire kısa bilgi yazılır ("ekibimiz dönecek"; dili bilinmiyorsa modelsiz tahmin), konuşmaya iç not düşer (sebep), zile **"AI konuşmayı devretti"** uyarısı gider ve konuşma Mesajlar'da "cevap bekleyen" olur.

### Ajanlar panelden kapatılırsa

Yönetici concierge / niyet ajanını Aktörler'den kapatırsa AI misafire cevap vermez: yeni konuşmalar personelde açılır, AI modundaki konuşmaya gelen mesaj konuşmayı personele alır. Her mesaj ayrı göreve düşmez (gelen kutusu zaten işi gösterir). AI ayar ekranı bu durumu uyarı olarak gösterir.

### Model rakam üretmez

Rapor ajanı tabloyu sistemden alır; fiyat ajanının her satırı doğrulanır ve onaya gider; bütçe ve anket ajanları sistemin hesapladığı sayıları yorumlar. Hiçbir yerde modelin "icat ettiği" bir sayı ekrana çıkmaz.

## İş günü ve gün kapanışı

### "Bugün" nedir

Otelin "bugün"ü duvar saatinden değil **kapatılmamış son gün**den okunur: kapatılmış son günün ertesi. Gece 02:00 olsa da gün kapatılmadıysa otel hâlâ dünkü gündedir. Hiç kapanış yapılmamış otelde (ilk kurulum) takvim günü kullanılır. "Bugün"e ihtiyaç duyan her yer — gelecekler listesi, oda ücretleri, raporlar, doluluk, bütçe, AI bütçesi — aynı fonksiyondan okur.

*Örnek:* Gece görevlisi 03:10'da hâlâ 24 Kasım'ı kapatmadı. 25 Kasım 00:30'da gelen bir walk-in misafir "bugün giriş" ile açılırsa sistem onu 24 Kasım gecesine yazar; çünkü otel için gece henüz bitmemiştir. Bu, otelcilikte "iş günü" kavramının ta kendisidir.

### Kapanışta ne olur

Gece görevlisi `/gun-kapanis` sihirbazını adım adım geçer: **Gelmeyenler → Oda ücretleri → Kasa sayımı → Fark → Günü kapat**. İlk dört adım yalnızca önizlemedir; hiçbir şey yazmaz. "Kapat" düğmesi tek işlemde şunları yapar:

1. Girişi geçmiş, gelmemiş rezervasyonları **gelmedi** işaretler (isteğe bağlı "gelmeyen ücretini uygulama").
2. O gecenin **oda ücretlerini** içerideki bütün konaklamalara basar (gece hassasiyetli; iki kez basılmaz).
3. **Günlük özeti** (`DailyStats`: doluluk, oda geliri, ADR, RevPAR, tahsilat) yazar — göstergeler gelir raporuyla aynı tanımla.
4. **Vardiya raporunu** (yöntem bazında beklenen / sayılan / fark, devir notu) kaydeder; PDF olarak indirilebilir.
5. Günü **kapandı** işaretler, "gün kapandı" olayını (`night.audit.closed`) yayınlar, iş gününü ilerletir.
6. "Gün kapandı" olayını **muhasebe aktörü** dinler ve günün **gelir fişini** yazar (genel muhasebe): folyo kalemleri, odaya yazılmayan adisyonlar ve spa randevuları gelir ve KDV hesaplarına alacak, `120.01` borç. Aktör kapalıysa "… gününün gelir fişi yazılacak" görevi düşer; Genel muhasebe → Ayarlar → Eşitle kapanmış günlerin fişini sonradan yazar.

"Başlat" iki görevlinin aynı anda kapatmasını engeller (gün "sürüyor" olur). Takvimden ileri gün kapatılamaz; aynı gün iki kez kapatılamaz. Gün kapanışı başladığında folyo aktörü tamamlanmış gecelerin ücretini önceden basar; dolu odaların kat hizmeti durumu "kirli" olur (ertesi sabahın konaklayan temizliği buradan beslenir).

## Zamanlanmış işler

Olaylar sistemin ana tetikleyicisidir; zamanlanmış işler **güvenlik ağı** ve "zamanla olan" şeylerin motorudur. Hepsi yalnızca sunucu sürecinde çalışır (testler başlatmaz), açılıştan 5 saniye sonra ilk tur başlar, bir iş kendi turunu bitirmeden yeniden başlamaz, bir işin hatası diğerlerini durdurmaz. Sunucu kapalıyken kaçan turlar sonraki açılışta telafi edilir çünkü işler "saat X'te yap" değil "eksikse tamamla" mantığıyla yazılmıştır.

| Modül | İş | Sıklık | Ne yapar |
| --- | --- | --- | --- |
| Çekirdek | Outbox tarayıcısı | 30 sn | Dağıtılamamış (2 dakikadan eski) olayları yeniden dağıtır |
| Çekirdek | İşlenmiş olay temizliği | 1 sa | 30 günden eski "işlendi" kayıtlarını siler |
| Bildirimler | Sıradaki bildirimler | 15 sn | Yeniden deneme (30 sn / 2 dk / 10 dk / 30 dk, en çok 5 deneme) ve sessiz saat sonrası gönderim |
| Bildirimler | Takılı gönderim kurtarma | 1 dk | Süreç gönderim ortasında kapandıysa 5 dk sonra sıraya geri alır |
| Bildirimler | Geciken istek taraması | 1 dk | Hedef süresi geçen misafir isteğine "gecikti" uyarısı (bir kez) |
| Bildirimler | SMS teslim raporu | 2 dk | Netgsm'den teslim durumu (dakikada en çok 10 sorgu) |
| Bildirimler | Eski uyarı silme | 1 sa | 30 günden eski zil uyarıları |
| Onaylar | Süresi dolan onaylar | 1 dk | Süresi dolan onayı düşürür, zile "yapılmadı" uyarısı |
| Folyo | Gecenin oda ücretleri | 5 dk | İş günü dönünce dün gecenin ücret çalışmasını bir kez açar, folyo aktörüne haber verir; kaçan geceler uzlaştırmayla tamamlanır |
| Kat hizmetleri | Konaklayan temizliği | 10 dk | İş günü dönünce içerideki odaların günlük temizlik görevlerini açar (o güne görevi olan oda atlanır) |
| Rezervasyon | Bekleme listesi taraması | 5 dk | Açılan yer kaçsa da fark edilsin; girişi geçen bekleme kayıtları kapansın |
| Mesaj kanalları | Bekleyen mesajlar | 1 dk | Kanal kapalıyken yazılmış, geçici hatada kalmış, sıra dolduğu için atlanmış ya da sahipliği düşmüş cevapları gönderir (geçit kapalıysa o otelinkini göndermez) |
| AI asistanı | Takılı AI konuşması | 1 dk | 5 dakikadan uzun cevapsız AI konuşmasını personele devreder, misafire bilgi, zile uyarı |
| Dinamik fiyat | Öneri üretimi | 6 sa | Kural tabanlı yield: eşik dışı günler için öneri (ardışık günler birleştirilir), fiyat ajanına değerlendirme olayı; çakışan bekleyen öneri atlanır |
| Satış CRM | Satış süpürmesi | 30 dk | Geçerliliği geçen teklifler "süresi doldu"; takip tarihi gelen fırsatlar için günde tek zil |
| Teknik servis | Periyodik bakım biletleri | 6 sa | Süresi gelen bakım planından bilet üretir (plan başına tek açık bilet) |
| Teknik servis | Kapanmış bilet fotoğrafı | 24 sa | Çözülen biletlerin fotoğrafları süre dolunca silinir |
| Kayıp eşya | Fotoğraf temizliği | 1 sa | Teslim edilen / kapatılan eşyanın fotoğrafı bir ay sonra silinir (kişisel veri, disk) |
| Misafir portalı | Online check-in davetleri | 30 dk | Girişten ayardaki gün kadar önce davet; yeni günün varışları sıraya girer |
| Misafir portalı | Belge fotoğrafı silme | 1 sa | KVKK: saklama süresi dolan kimlik fotoğrafı |
| Anketler | Anket davetleri | 15 dk | Çıkış sonrası ve ara anket, otelin ayarladığı saatte (saatin ilk çeyreğinde gider) |
| Spa | Randevu hatırlatması | 5 dk | Randevudan ayardaki süre kadar önce (varsayılan 2 saat) misafire hatırlatma; randevu önce sahiplenilir, tek hatırlatma gider |
| Raporlar | Gelir özeti | 1 sa | Son 31 kapanmış günü yeniden hesaplar, eski günleri 62'lik parçalarla doldurur, kendini onarır; özet yalnız hızlandırır, rapor özetsiz de doğrudur |
| Kanal yönetimi | Gönderim turu | 5 sn | İşaretli kanallara farkı, zamanı gelene tam eşitlemeyi gönderir (kanal başına en sık 10 sn) |
| Kanal yönetimi | Rezervasyon akışı | 60 sn | Channex kanallarının teyit edilmemiş revizyonları (webhook gelince hemen) |
| Kanal yönetimi | Takvim okuma | 60 sn | Zamanı gelen iCal kanalları (kanal başına 15 dk'da bir) |
| Kanal yönetimi | Log temizliği | 6 sa | 90 günden eski senkron logu |
| Acente primi | Hedef ilerlemesi + dönem sonu | 30 dk | Yürürlükteki kuralların gerçekleşen üretimi; kademe yükselince uyarı; dönemi biten kuralın hak edişi hesaplanır, "onaya gönderin" uyarısı |
| Banket | Banket süpürmesi | 15 dk | Opsiyon süresi dolan dosya düşer (salon bırakılır), son gün uyarısı, gecikmiş taksit, kapatılmamış etkinlik, kesinleşmemiş menü (hepsi bir kez) |
| Restoran POS | POS süpürmesi | 15 dk | 16 saati geçen açık vardiya ve 8 saati geçen açık adisyon için şef garsona uyarı (bir kez) |
| Restoran POS | Oda servisi süpürmesi | 1 dk | Zamanı gelen planlı siparişi mutfağa düşürür; konaklaması biten siparişi iptal eder; kabul bekleyen / geciken sipariş ve toplanmayan tepsi uyarıları |
| Demirbaş | Garanti zili | 6 sa | Garantisi uyarı penceresine giren kartlar için zil (kart başına bir kez; aynı günün kartları tek zilde) |
| İK | Özlük belgesi hatırlatması | 12 sa | Süresi İK ayarındaki gün (varsayılan 30) içinde dolacak / dolmuş belgeler için `hr.manage` sahiplerine tek özet zil (`HR`); aynı belge 7 günde bir |
| Sadakat | Sadakat puan süresi | 12 sa | Programı açık her otelde son kullanma günü geçmiş, kullanılmamış puanı "Süresi doldu" hareketiyle düşer (hesap başına günde bir); 12 aylık seviye penceresi kaydığı için etkin hesapların seviyesini yeniden hesaplar (yükselişte zil `LOYALTY`, düşüşte zil yok) |
| Faturalar | E-belge gönderimi | 30 sn | Sıradaki e-Fatura / e-Arşiv belgelerini entegratöre gönderir, durumunu izler |
| KBS | KBS gönderici | 30 sn (ve yeni bildirim sıraya girince hemen) | Sırası gelmiş, girişi bildirilmiş KBS bildirimlerini sırayla gönderir (bugün yalnız test ortamı); geçici hatada 1 / 5 / 15 / 60 / 180 / 360 dk sonra yeniden, hak bitince "Gönderilemedi" + zil; bağlı olduğu bildirim iptal edilen bekleyeni iptal eder. KBS'si kapalı otelin bildirimi gönderilmez |
| KBS | KBS takılı kurtarma | 5 dk | Süreç gönderim ortasında kapandıysa 5 dakikadan uzun "Gönderiliyor"da kalan bildirimi "Sırada"ya geri alır |
| KBS | KBS gecikme zili | 1 sa | Açılalı 2 saati geçmiş ve hâlâ bildirilmemiş giriş bildirimi için kritik zil (`KBS`, bildirim başına bir kez): "… yasal süre geçmeden KBS ekranından elle bildirin" |

*Örnek:* Sunucu bakım için pazar 03:00–05:00 arası kapalıydı. Açılışta: outbox tarayıcısı dağıtılmamış 3 olayı dağıttı; oda ücreti işi cumartesi gecesini (zaten kapatılmıştı) kontrol etti, eksik yoktu; konaklayan temizliği pazar sabahının görevlerini açtı; bekleyen mesajlar işi 03:12'de personelin yazdığı ama gönderilemeyen WhatsApp cevabını gönderdi. Kimse bir şey yapmadı.

## Canlı kanallar: ekranlar nasıl kendiliğinden yenilenir

Sunucu, bir şey değiştiğinde panellere socket üzerinden **yalnızca haber** gönderir ("bu otelde envanter değişti", "onaylar değişti", "manuel görevler değişti", "mesajlar değişti", "genel muhasebe değişti" — `ledger.changed`, "İK değişti" — `hr.changed`, "sadakat değişti" — `loyalty.changed`: puan hareketi, seviye, üyelik, ayar; "KBS değişti" — `kbs.changed`: kimlik bildirimleri, mutabakat, ayar); veri göndermez. Haber yalnızca o kanala abone olan — yani ilgili ekranı açık tutan — panellere gider; otelin tamamına yayın yapılmaz. Panel haberi alınca kendi sorgusunu tazeler (bazı ekranlarda en sık 10–15 saniyede bir).

Zil haberi kişiye (`kullanıcı`) ya da izne (`perm`) gider; rozet sunucudan bir kez gelir, sonra haberle artar. Aktivite akışı 500 ms'de bir toplu "yeni satır kimlikleri" alır; içerik HTTP'den okunur (socket kimliği şimdilik istemcinin söylediği e-postadır, bu yüzden socket'ten içerik taşınmaz).

Bağlantı koptuğunda ekranlar birkaç dakikada bir kendiliğinden yenilenir; bağlantı gelince rastgele kısa bir beklemeyle yeniden abone olur (2500 panel aynı anda yüklenmesin).

## Denetim izi ve aktivite: iki ayrı defter

| | Denetim kaydı (AuditLog) | Aktivite akışı (ActivityLog) |
| --- | --- | --- |
| Ne yazar | **Kişilerin** yaptığı değişiklikler: kim, ne zaman, hangi kayıt, eski / yeni değer, değişen alanlar | **Aktörlerin** yaptığı işler: hangi olay, hangi aktör, sonuç, süre, deneme sayısı |
| Ne zaman yazılır | Değişiklikle **aynı işlemde**; "değişti ama izi yok" imkânsız | Olay işlenince (işlem içinde yazılan satır işlem bitince yayınlanır) |
| Nerede görünür | `/aktivite/denetim` (denetim görüntüleme izni) | `/aktivite/akis`, aktör detayı "son işler", zincir görünümü |
| Saklama | Silinmez | Politika kararı bekliyor (şimdilik silinmez) |

Onay kararları, aktör açma / kapama, ayar değişiklikleri, kullanıcı işlemleri denetim kaydına; "onaya gönderildi", "aktör kapalı, iş personele düştü", "3. denemede başardı" aktivite akışına düşer.

## Veri güvenliği

- **Kimlik:** E-posta + şifre ile giriş; şifreler bcrypt ile saklanır (düz metin asla). Erişim anahtarı (JWT) **15 dakika** geçerlidir ve otomatik yenilenir; yenileme anahtarı 30 gün. Çıkış yenileme anahtarını iptal eder.
- **Yetki:** Her uç, isteğin gövdesi doğrulanmadan **önce** kimlik ve izin denetiminden geçer: anonim → 401, izinsiz → 403. Korumalı bir ucun alan listesi yetkisize sızmaz.
- **Otel kapsamı:** Oturum oteli taşır; her sorgu otelle süzülür. Başka otelin kaydı adres değiştirerek de görünmez.
- **Sırlar:** SMTP ve SMS parolaları, WhatsApp token'ları AES-256-GCM ile şifreli saklanır (`SETTINGS_SECRET_KEY`); hiçbir cevapta geri dönmez. Anahtar değişirse parolalar yeniden girilir.
- **Kişisel veri:** Kimlik numaraları maskeli; olay gövdelerinde telefon / e-posta / kart maskelenir; AI ajanları anket yorumunu kişi adı ve iletişim bilgisi olmadan görür; kimlik ve eşya fotoğrafları saklama süresi dolunca silinir; rapor tasarımcısında belge numarası sütunu yoktur.
- **Hız sınırı:** IP + personel başına (varsayılan dakikada 600 istek). Web chat'te IP ve oturum başına ayrı sınır.
- **Soft delete:** Silinen kayıt veritabanından silinmez, "silindi" işaretlenir; listelerde görünmez ama izi kalır. Silinen oda numarası ya da oda tipi kodu yeniden kullanılabilir.
- **Para:** Tutarlar metin olarak taşınır ve özel para aritmetiğiyle hesaplanır; kayan nokta hatası (0,1 + 0,2) olmaz. Envanteri azaltan yazmalar kilitle yapılır: iki resepsiyonist son odayı aynı anda satamaz.
- **Üretim koruması:** Üretimde `JWT_SECRET` yoksa / kısaysa sunucu açılmaz; CORS yalnızca listelenen adreslere açıktır; `prisma db push` kullanılmaz (veritabanı kısıtlarını sessizce silerdi).

## Uçtan uca örnek: bir OTA rezervasyonunun yolculuğu

Bütün parçaları tek hikâyede görmek için Booking.com'dan gelen bir rezervasyonu baştan sona izleyelim. Saatler örnektir.

| Saat | Ne oldu | Kim yaptı | İz |
| --- | --- | --- | --- |
| 14:02:00 | Booking.com, Channex üzerinden yeni rezervasyon revizyonu gönderdi (webhook) | Kanal yönetimi modülü revizyonu sakladı, "kanal rezervasyonu alındı" olayını yayınladı | Olaylar ekranında satır; Kanallar → senkron logu |
| 14:02:01 | Revizyon rezervasyona çevrildi: oda tipi eşleştirmeden bulundu, fiyat planı uygulandı, misafir kartı telefon / e-postadan eşleşti (yoksa açıldı) | **Kanal aktörü** | Aktivite: "Kanal rezervasyonu açıldı: DEMO-0131", "rezervasyon oluşturuldu" olayı |
| 14:02:01 | Uygun boş oda seçildi ve atandı | **Oda aktörü** | "Oda atandı" olayı |
| 14:02:02 | "Rezervasyon onayı" e-postası kuyruğa yazıldı (misafir uyruğu NL → İngilizce) | **Bildirim aktörü** | Gönderim geçmişi: Sırada |
| 14:02:02 | Diğer kanallar (ör. Expedia iCal, otelin web motoru) için müsaitlik "gönderilecek değişiklik var" işaretlendi | **Kanal aktörü** | — |
| 14:02:06 | Fark Channex'e gönderildi; Expedia'ya iCal bir sonraki okumada | Kanal gönderim turu (5 sn) | Senkron logu |
| 14:02:15 | E-posta SMTP'ye verildi | Bildirim göndericisi (15 sn) | Gönderim geçmişi: Gönderildi |
| 14:02:20 | Panel'deki doluluk ve gelecekler kartı tazelendi | Canlı kanal haberi → ekran sorgusu | — |
| 14:03 | Yield işi bir sonraki turunda (6 saatte bir) bu haftanın doluluğunun %80'i geçtiğini görürse öneri üretir | Dinamik fiyat işi | Onaylar: "Toplu fiyat değişimi" |
| Giriş günü 09:10 | Misafir portalı daveti (ayarda 1 gün önce ise bir gün önce gitmişti); misafir online check-in yaptı | Misafir portalı işi (30 dk) | Online check-in listesi: inceleme bekliyor; zil |
| 15:20 | Resepsiyon online check-in'i onayladı, girişi yaptı | Personel | Denetim kaydı |
| 15:20 | Oda dolu; folyo açıldı; "Hoş geldiniz" e-postası | Oda, folyo, bildirim aktörleri | Zincir: aynı kimlik |
| Her gece | Oda ücreti folyoya | Folyo aktörü (gün kapanışı / 5 dk'lık iş) | Folyo kalemleri |
| Çıkış günü 10:40 | Çıkış; restoran adisyonu folyoda; kart tahsilatı; folyo kapandı; fatura taslağı açıldı; "Teşekkür" e-postası; muhasebeye kasa / banka kaydı; çıkış temizliği görevi | Personel + oda, folyo, bildirim, muhasebe, kat hizmeti aktörleri | Zincir |
| Çıkış + 1 gün 11:00 | Çıkış sonrası anket daveti; misafir 9 puan ve yorum yazdı; yorum etiketlendi (olumlu; "temizlik", "kahvaltı") | Anket işi (15 dk), **geri bildirim ajanı** | Anketler ekranı |

Bu yolculukta personel üç kez dokundu: online check-in onayı, giriş ve çıkış. Geri kalan on iki adım aktörler ve zamanlanmış işlerdi. Kanal aktörü kapalı olsaydı ilk adım "Kanaldan gelen rezervasyon elle işlenecek" görevi olurdu ve yolculuk oradan aynı şekilde sürerdi.

## Kısa sözlük

| Terim | Anlamı |
| --- | --- |
| Olay | Sistemde olan önemli bir şeyin kaydı; aktörler bunu dinler |
| Outbox | Olayın iş verisiyle aynı işlemde yazılıp sonra dağıtılması; dağıtılamayan 30 sn'de yeniden denenir |
| Aktör / worker / ajan | Olay dinleyen bağımsız işçi; kural tabanlı (worker) ya da dil modeli kullanan (ajan) |
| Bildirge (manifest) | Aktörün beyanı: ne dinler, ne yayınlar, neyi onaya götürür, kapalıyken iş nereye düşer |
| İdempotent | Aynı iş iki kez tetiklense de bir kez yapılır |
| Manuel görev | Aktörün yapamadığı / kapalı olduğu için personele düşen iş |
| Onay kuyruğu | Riskli işin yetkili kararına bırakılması; isteyen aktör onayda kaldığı yerden sürer |
| Dört göz | İsteyen kendi isteğini onaylayamaz |
| Zincir (correlation) | Bir isteğin yol açtığı bütün olay, aktör işi ve değişikliklerin ortak kimliği |
| İş günü | Kapatılmış son günün ertesi; gün kapanışıyla ilerler |
| Zil | Kişiye ya da izne giden personel uyarısı; 30 gün saklanır |
| Canlı kanal | "Şu değişti" haberini ilgili ekranlara taşıyan socket kanalı |
| Yevmiye fişi | Bir belgenin Tek Düzen hesaplarına çift taraflı kaydı (borç = alacak); ön muhasebe hareketinden kendiliğinden ya da elle |
| Günlük gelir fişi | Gün kapanışında günün gelirini (folyo, adisyon, spa) gelir ve KDV hesaplarına yazan otomatik yevmiye fişi; yeniden çalışınca yalnız farkı yazar |
| Sürüm damgası | Aynı kaydı iki kişinin aynı anda ezmesini engelleyen koruma |
| Denetim kaydı | Kişilerin yaptığı değişikliklerin eski / yeni değerle defteri |
| Aktivite akışı | Aktörlerin işlerinin defteri |
| İzin bakiyesi | Personelin yıllık ücretli izin hakkı (4857 md. 53: işe giriş yıl dönümlerinde 14 / 20 / 26 gün; 18 yaş altı ve 50 yaş üstüne en az 20) + elle düzeltmeler − onaylı yıllık izinler; iş günüyle |
| Puantaj (günlük) | Bir personelin bir günü: geldi / gelmedi / izinli / hafta tatili / resmî tatil, giriş-çıkış, mola, çalışılan ve norm üstü dakika; ay sonunda bordroya aktarılır (kaynak TIMESHEET) |
| Sadakat puanı | Folyo kapanınca harcamadan kazanılan tamsayı puan (varsayılan 10 TL = 1 puan); açık folyoda indirim olarak harcanır (varsayılan 1 puan = 0,50 TL) |
| Sadakat seviyesi | Son 12 ayda kazanılan puana göre Klasik / Gümüş / Altın…; çarpanı kazanmaya uygulanır, düşebilir |
| Puan paketi (lot) ve FIFO | Her kazanma ayrı paket olur (kendi son kullanma günüyle); harcama ve süre dolumu en eski paketten başlar |
| KBS / JKBS | Konaklama tesislerinin misafir kimliğini bildirdiği sistem: Emniyet'in Kimlik Bildirim Sistemi ve Jandarma'nınki. FlexHotel'de kuyruk, mutabakat ve iz hazır; gerçek servis bağlantısı tesis yetkisi ve servis dokümanı bekliyor (bugün yalnız test ortamı) |
| KBS bildirimi | Bir kişinin giriş, çıkış ya da oda değişikliği kaydı; durumları Sırada / Gönderiliyor / Bildirildi / Gönderilemedi / İptal / Elle bildirildi |
| Bildirim zinciri | Aynı konaklamada aynı kişinin bildirimleri; her halka öncekine bağlıdır, çıkış girişi bildirilmeden gönderilmez |
| Elle bildirildi | Personelin resmî KBS ekranından bildirip FlexHotel'de notla işaretlediği bildirim; bağlı çıkışı serbest bırakır |
| KBS mutabakatı | İçerideki her kişinin girişi bildirilmiş mi denetimi; eksikler nedenleriyle listelenir |

## Sık sorulanlar

**Aktörler kapalıyken otel çalışır mı?**
Evet, tamamen. Her iş manuel görev olarak personele düşer ve aynı ekranlardan elle yapılır. Sistem baştan "aktörsüz de çalışır" ilkesiyle tasarlandı.

**Bir olay iki kez işlenebilir mi?**
Hayır. Her aktör işlediği olayı kaydeder; tekrar gelen olay sessizce geçilir. Onaylanan iş de bus'a yeniden verilmez; yalnızca isteyen aktör devam eder.

**Sunucu çökerse veri kaybolur mu?**
Olay ve iş verisi aynı işlemde yazıldığı için ya ikisi de vardır ya ikisi de yok. Dağıtılamayan olay outbox tarayıcısıyla 30 saniye içinde yeniden dağıtılır. Gönderim ortasında kalan bildirim 5 dakika sonra sıraya döner.

**AI yanlış rezervasyon açabilir mi?**
Misafir yeni bir mesajda açıkça onaylamadan rezervasyon istenmez; fiyat ve müsaitlik istek anında yeniden denetlenir; istek rezervasyon aktörünün normal denetiminden geçer. Yine de otel isterse AI rezervasyonunu "opsiyonlu" yapar: personel kesinleştirmeden kesin olmaz.

**AI maliyeti kontrolden çıkabilir mi?**
Günlük USD bütçesi vardır; dolunca model çağrılmaz ve zile uyarı düşer. Her çağrının maliyeti anında kaydedilir ve aktör panelinde ajan başına görünür.

**Fiyatlar gece kendiliğinden değişir mi?**
Hayır. Yield işi ve fiyat ajanı yalnızca öneri üretir; her öneri onay bekler. Onaylı çarpan 0,5–3 aralığındadır ve yalnızca plan / sezon fiyatını ölçekler; acente kontratı, paket ve elle fiyat etkilenmez.

**Gün kapanışını unutursak ne olur?**
İş günü ilerlemez: ertesi günün oda ücretleri basılmaz, "bugün gelecekler" eski günü gösterir, raporlar eski günü "bugün" sayar. Kapanış yapıldığı anda hepsi düzelir; oda ücretleri kaçan geceler için uzlaştırmayla tamamlanır.

**Aktivite akışında "uyarı" satırları görüyorum, sorun mu?**
Uyarı, "aktör kapalıydı, iş personele düştü" ya da "sıra doldu" gibi beklenen durumlardır. Hata (kırmızı) satırları incelenmelidir; her hata ayrıca manuel görev açar, yani iş kaybolmamıştır. "Sorunlar" süzgeci ikisini birlikte gösterir.

**WhatsApp bildirimi gönderebiliyor muyuz?**
Misafirle **konuşma** (gelen mesaja cevap) WhatsApp üzerinden çalışır. Otelin başlattığı **bildirim** (rezervasyon onayı vb.) WhatsApp'tan gitmez; Meta'nın şablon onayı otel başına ayrı iştir ve henüz yapılmadı. Bildirimler e-posta ve SMS ile gider; şablon ekranında WhatsApp sütunu hazırdır, kanal bağlanınca kullanılır. E-posta geçidi (gelen e-postayı mesaja çevirmek) da henüz yoktur.

**KBS bildirimi gerçekten Emniyet'e gidiyor mu?**
Hayır, henüz değil. Gerçek KBS / JKBS servisi otelin tesis yetkisi ve servis dokümanıyla bağlanır; o güne kadar yalnız Test ortamı seçilebilir ve dışarı hiçbir şey gönderilmez. Kuyruk, zil, mutabakat ve iz bugünden çalışır; otel resmî ekrandan elle bildirip **Elle bildirildi** işaretler. Bağlantı gelince yalnız sağlayıcı adaptörü yazılır, akış aynı kalır.

**Birden fazla sunucu çalıştırabilir miyiz?**
Bugün olay bus'ı, aktör sıraları ve kanal kaydı tek süreç içindedir. Çok sunuculu kurulum için bunların paylaşılan bir kuyruğa taşınması gerekir; bu FlexAI 2.0 yol haritasındaki altyapı işlerindendir.
