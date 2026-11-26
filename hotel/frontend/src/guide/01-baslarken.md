# Başlarken

Bu bölüm FlexHotel'i ilk kez açan birinin ihtiyaç duyduğu her şeyi anlatır: sistem nedir, nasıl giriş yapılır, hangi rol neyi görür, menü nasıl düzenlenmiştir, ekranlar hangi ortak kalıplarla çalışır ve yeni bir otel sisteme nasıl kurulur. Hiçbir şeyi bildiğinizi varsaymıyoruz; "aktör", "folyo", "iş günü" gibi kelimeleri ilk geçtikleri yerde açıklıyoruz.

## FlexHotel nedir

FlexHotel (kod adı HotelOS), bir otelin bütün operasyonunu **tek bir panelden** yürütmek için yazılmış bir otel yönetim sistemidir. Rezervasyon, giriş / çıkış, oda planı, kat hizmetleri, misafir hesabı (folyo), kasa, fatura, restoran POS, mutfak, stok, satın alma, demirbaş, ön muhasebe, bordro, anketler, spa randevuları ve raporlar aynı yerdedir; ayrı programlar arasında dosya taşımazsınız.

Sistemi klasik otel programlarından ayıran şey **otonom aktörler**dir. Aktör, arka planda kendi kendine çalışan bir işçidir. Sistemde önemli bir şey olduğunda ("rezervasyon açıldı", "misafir çıkış yaptı", "adisyon kapandı") ilgili aktör devreye girer ve kendi işini yapar:

- Rezervasyon açılır → **Oda aktörü** uygun odayı seçip atar.
- Misafir çıkış yapar → **Kat hizmeti aktörü** çıkış temizliği görevi açar, **Folyo aktörü** kalan ücretleri işler ve hesabı kapatır.
- Adisyon kapanır → **Stok aktörü** reçetelerden malzemeyi düşer; malzeme minimumun altına inerse satın alma talebi açar.
- Misafir WhatsApp'tan yazar → **Concierge ajanı** (yapay zekâ) müsaitlik bakar, teklif verir, misafir onaylayınca rezervasyon ister.

Aktörler yönetici tarafından **tek tek açılıp kapatılabilir**. Kapatılan bir aktörün işi kaybolmaz; aynı iş personelin önüne **manuel görev** olarak düşer ve elle yapılır. Riskli işler (büyük iade, kapasite aşımı, fiyat değişikliği) ise aktör ne kadar "akıllı" olsa da kendiliğinden yapılmaz; **onay kuyruğuna** düşer, yetkili bir kişi karar verir. Bu ikisi sistemin temel güvenlik ilkesidir: *hiçbir iş kaybolmaz, hiçbir riskli iş insansız yapılmaz.*

Yapay zekâ (AI) ajanları da aktördür ama bir farkla: bir dil modeline (OpenAI) ihtiyaç duyarlar. Sunucuda model anahtarı yoksa bu ajanlar hiç başlamaz ve sistem **AI'sız da eksiksiz çalışır** — misafir mesajları personele düşer, fiyat önerileri kural tabanlı üretilir, rapor soruları "rapor talebi" görevi olur. Ayrıntı "Arka planda ne oluyor" bölümünde.

**Örnek: bir rezervasyonun 20 saniyesi.** Resepsiyonist Elif 10:14'te telefonla gelen 2 kişilik, 3 gecelik Standart rezervasyonu "Yeni rezervasyon" ekranından kaydeder ve Kaydet'e basar. Ekran hemen "DEMO-0107 açıldı" der; Elif başka işine döner. Arka planda: oda aktörü 10:14:01'de 212 numaralı odayı atar; bildirim aktörü misafirin uyruğu TR olduğu için Türkçe "Rezervasyon onayı" SMS'ini kuyruğa yazar; gönderici 10:14:12'de Netgsm'e iletir; kanal aktörü Booking.com'daki Standart müsaitliğini bir düşürmek için kanalı işaretler, gönderim turu 10:14:16'da farkı iletir. Elif bunların hiçbirini yapmadı; hepsini Aktivite → Canlı akış'ta tek zincir olarak görebilir. Oda aktörü kapalı olsaydı Elif'in ziline "Rezervasyona oda atanacak" görevi düşerdi ve odayı kendisi seçerdi.

### Sistem neyi yapmaz

Dürüst bir sınır listesi, sistemi başkasına anlatırken en çok işe yarayan şeydir:

- **Fiyatı kendiliğinden değiştirmez.** Dinamik fiyat yalnızca öneri üretir; onay şarttır.
- **Riskli para işini insansız yapmaz.** İade, büyük ödeme, iptal, eşik üstü sipariş, bordro onay bekler.
- **Misafir "evet" demeden rezervasyon açmaz** (AI concierge).
- **Rakam uydurmaz.** Rapor, bütçe ve anket ajanları sistemin hesapladığı sayıyı yorumlar.
- **Veri silmez.** Silinen kayıt "silindi" işaretlenir; denetim izi kalır.
- **Henüz yapmadıkları:** WhatsApp üzerinden otelin başlattığı şablonlu bildirim, e-posta ile gelen misafir mesajını okuma, başka programdan tam veri göçü, çoklu otel konsolu, mobil uygulama, iki aşamalı doğrulama (2FA), KBS kimlik bildirimi. Bunlar yol haritasında vardır; bugün yoktur.

## Giriş yapmak

1. Tarayıcıda otelinizin FlexHotel adresini açın. Geliştirme ortamında bu `http://localhost:5173` adresidir.
2. **E-posta** ve **Şifre** alanlarını doldurun. Göz simgesi şifreyi gösterir / gizler.
3. **Giriş** düğmesine basın. Hatalı bilgide "Giriş yapılamadı" ya da sunucunun verdiği açıklama görünür.

Giriş yaptığınızda sistem size bir **oturum anahtarı** (JWT) verir; panel bu anahtarla konuşur ve süresi dolunca kendiliğinden yeniler (refresh). Oturum, **hangi otelde** çalıştığınızı ve **hangi izinlere** sahip olduğunuzu taşır. Menüde görmediğiniz bir şey, yetkinizin olmadığı bir şeydir; adresi elle yazsanız da sunucu reddeder ("yetkiniz yok", 403). Menünün gizlemesi görsel bir kolaylıktır; **gerçek yetki kontrolü sunucudadır**.

Çıkış için sağ üstteki kullanıcı menüsünü kullanın. Şifrenizi unuttuysanız, kullanıcı yönetimi yetkisi olan biri (yönetici) Ayarlar → Kullanıcılar'dan **şifre sıfırlar**; sistemde kendi kendine "şifremi unuttum" akışı henüz yoktur.

### Oturumun ömrü

- Erişim anahtarı **15 dakika** geçerlidir; panel süresi dolmadan arka planda yeniler, siz fark etmezsiniz.
- Yenileme anahtarı **30 gün** geçerlidir. 30 gün hiç girmediyseniz ya da çıkış yaptıysanız yeniden şifre istenir: "Oturum süresi doldu, tekrar giriş yapın".
- Hesabınız pasife alınırsa açık oturumunuz da düşer: ilk istekte "Oturum açmanız gerekiyor" alırsınız ve giriş ekranına dönersiniz.
- Aynı hesapla iki cihazdan girilebilir; her cihaz kendi yenileme anahtarını taşır.

**Örnek: Elif'in ilk günü.** Yönetici, Elif için `elif@otelim.com` adresiyle **Ön büro** rolünde kullanıcı açtı ve geçici şifre verdi. Elif giriş yaptı; sol menüde Panel, Görevler, Kılavuz, Giriş / çıkış, Rezervasyonlar, Oda planı, Misafirler, Satış CRM, Folyolar, Kasa, Minibar & çamaşır, Kat hizmetleri (yalnızca görüntüleme), Kayıp eşya, Teknik servis, Gün kapanış, Etkinlikler, Mesajlar, İstekler, Anketler, Spa, Faturalar, Odalar, Bildirimler (yalnızca Gönderim geçmişi) ve İzinlerim gördü. **Göremedi:** Raporlar (rapor izni yok), Onaylar (onay görüntüleme izni yok), Aktörler, Ayarlar, Bütçe, Acenteler, Promosyonlar, Kanallar, Stok, Satın alma, Mutfak, Restoran, Personel, Bordro, İK, Ön muhasebe, Demirbaş. Panel'de gelir kartları yerine hızlı erişim kartları çıktı, çünkü Ön büro rolünde "Günlük durumu görüntüle (gelir)" izni yok. Elif ilk iş olarak kullanıcı menüsünden kendi şifresini değiştirmek istedi; bu ekran yok — yönetici sıfırlar. Not aldı.

### Demo hesabı

`npm run db:seed` ile yüklenen demo verisinde iki hazır kullanıcı vardır:

| E-posta | Şifre | Rol |
| --- | --- | --- |
| admin@hotel.local | admin123 | Yönetici (ADMIN) |
| resepsiyon@hotel.local | 123456 | Ön büro (FRONT_DESK) |

Demo otelin kodu `DEMO`'dur; oda tipleri, odalar, sezonlar, vergiler, örnek rezervasyonlar ve 16 hazır bildirim şablonu yüklüdür. Canlı bir otelde bu hesapları silip kendi kullanıcılarınızı açın; şifreler en az 8 karakter olmalıdır.

## Roller ve yetkiler

FlexHotel'de iki katman vardır: **rol** ve **izin**.

- **Rol**, kişinin işini söyler: Yönetici, Müdür, Ön büro, Kat hizmetleri, Muhasebe, Yiyecek & İçecek. Her kullanıcıya tek rol verilir.
- **İzin**, tek tek yapılabilecek işi söyler: "Rezervasyonları yönet", "Ödeme al", "Günü kapat" gibi. Sistemde yüzden fazla izin vardır ve her biri Türkçe adıyla Ayarlar → Roller & İzinler ekranında görünür.

Her rolün **varsayılan** bir izin kümesi vardır. Otel bu kümeyi matris ekranından değiştirebilir (ör. kat şefi ile kat görevlisini ayırmak için Kat hizmetleri rolünden "görev aç / ata" iznini kaldırmak). Matris bir kez kaydedildiğinde veritabanı kaynak olur; sonradan sisteme eklenen yeni bir izin, o rolün varsayılanıyla gelir (kimse bir güncellemeden sonra kilitli kalmaz).

**Yönetici (ADMIN)** her zaman bütün izinlere sahiptir; matristen kısıtlanamaz. Bu, kimsenin kendini sistemden kilitleyememesi için bilinçli bir korumadır.

### Hangi rol neyi görür

Aşağıdaki tablo varsayılan izinlerden derlenmiştir; oteliniz matrisi değiştirdiyse farklı olabilir.

| Rol | Görür ve yapar | Görmez / yapamaz |
| --- | --- | --- |
| **Yönetici** | Her şey. Ayarlar menüsü yalnızca bu role açılır. Aktörleri açar / kapatır, rol matrisini düzenler, kullanıcı açar. | — |
| **Müdür** | Operasyonun tamamı: rezervasyon, giriş / çıkış, fiyatı elle belirleme, açık bakiyeyle çıkışa izin, folyo indirimi, iade / iptal isteme, onayları karara bağlama, kat hizmeti ve teknik servisin tüm akışı, misafir CRM, raporlar ve rapor asistanı, bütçe onayı, acente kontratı, promosyon, kanal yönetimi, acente primi, banket, POS (ikram / indirim yetkisi dahil), reçete, satın alma, stok, demirbaş, ön muhasebe, fatura ayarları, misafir portalı, anket, spa, gün kapanışı. Aktör panelini **görür**. | Aktörleri açıp kapatamaz (yöneticinin kararı), kullanıcı ekleyemez, rol matrisini düzenleyemez, bordro ve ücretleri görmez. Ayarlar menüsü görünmez (ayarları görüntüleme izni API düzeyinde vardır). |
| **Ön büro** | Rezervasyon açma / düzenleme / iptal, gelecekler-gidecekler-konaklayanlar, giriş / çıkış, oda atama ve oda durumu, misafir mesajları ve istekler, folyo görüntüleme ve harcama işleme, ödeme alma, iade isteme (onaylayamaz), kasa görünümü, minibar / çamaşır girişi, kayıp eşya teslimi, kat hizmeti kuyruğunu görme ("104 ne zaman hazır olur?"), salon takvimini görme ve etkinlik depozitosu alma, folyo faturası kesme, online check-in inceleme, düşük anket puanı takibi, spa randevusu alma, arıza bileti açma, misafir kartı düzenleme ve birleştirme, **gün kapanışı** (gece vardiyası). Satış CRM de ön büroya açıktır. | Folyo indirimi ve kapanmış folyoyu yeniden açma, bildirim şablonları, raporlar, bütçe, ayarlar, aktör paneli, onayları karara bağlama. |
| **Kat hizmetleri** | Oda durumu, gidecekler listesi (hangi oda boşalacak), kat hizmeti görevleri (başlat / bitir / sorun bildir; varsayılanda görev açma, atama ve kontrol de açık), misafir istekleri, minibar ve çamaşır girişi, bulunan eşyayı kaydetme, arıza bileti açma / çözme. | Folyo, kasa, rezervasyon açma, mesaj yazma, misafir iletişim bilgileri (kayıp eşyada teslim yetkisi yok), raporlar. |
| **Muhasebe** | Günlük durum (gelir içerir), folyo düzeltme ve indirim, tahsilat, iade isteme, kasa ve döviz kuru, minibar / çamaşır fiyat listeleri, gelir raporları ve rapor asistanı, bütçe hazırlama ve gerçekleşen gider girişi, acente carisi ve prim ödeme işareti, promosyon kullanım raporu, etkinlik tahsilatı, POS raporları, spa geliri, reçete maliyeti, satın alma ve stok izleme, ön muhasebe (cari, kasa / banka, çek / senet, fiş), genel muhasebe (hesap planı, yevmiye fişi, mizan, kurallar, dönem kilidi, fiş iptali), faturalar ve e-belge, personel ve bordro (ücret, puantaj, hesaplama, ödeme), demirbaş ve amortisman. Onay kuyruğunu görür. | Onayları karara bağlama, kontrat / promosyon / kanal düzenleme, kasa-banka tanımı ve fiş iptali (müdürün), bordro yasal parametre teyidi (yöneticinin), rezervasyon ve giriş / çıkış işlemleri. |
| **Yiyecek & İçecek** | POS: vardiya aç / kapat, adisyon, sipariş, ödeme, odaya yazma; mutfak ekranı; etkinlik programını ve menüsünü görme; misafir istekleri; restoranda unutulan eşyayı kaydetme; reçeteleri okuma; satın alma talebi açma ve mal kabul; stok görüntüleme. | İkram / indirim / gönderilmiş kalemi iptal (şef garson yetkisi — otel matristen açabilir), menü ve fiyat tanımları, reçete düzenleme (otel şef için açabilir), tedarikçi seçimi ve sipariş. |

### İzin grubu bazında varsayılan matris

Aşağıdaki tablo Ayarlar → Roller & İzinler ekranındaki varsayılan işaretleri grup grup verir (Yönetici hepsine sahiptir, listelenmez). "—" o rolün o grupta hiç izni olmadığını gösterir. Otel matrisi kaydettiyse kendi tablosu geçerlidir.

| İzin grubu | Müdür | Ön büro | Kat hizmetleri | Muhasebe | Yiyecek & İçecek |
| --- | --- | --- | --- | --- | --- |
| Ayarlar | Görüntüle | — | — | Görüntüle | — |
| Odalar | Görüntüle, envanter yönet, oda işlemleri | Görüntüle, oda işlemleri | Görüntüle, oda işlemleri | Görüntüle | Görüntüle |
| Rezervasyonlar | Görüntüle, yönet, fiyatı elle belirle | Görüntüle, yönet | — | — | — |
| Giriş / çıkış | Görüntüle, yap, bakiyesi kapanmadan çıkışa izin | Görüntüle, yap | Görüntüle | Görüntüle | — |
| Misafir iletişimi | Mesaj gör / yaz, istek gör / yönet | Mesaj gör / yaz, istek gör / yönet | İstek gör / yönet | — | İstek gör / yönet |
| Bildirimler | Görüntüle, ayarları yönet | Görüntüle | — | Görüntüle | — |
| Onaylar | Görüntüle, karar ver | — | — | Görüntüle | — |
| Yönetim (kullanıcı, rol) | Kullanıcıları görüntüle | — | — | — | — |
| Günlük durum | Görüntüle, tahmin eşikleri | — | — | Görüntüle | — |
| Folyo | Görüntüle, harcama işle, indirim / yeniden aç | Görüntüle, harcama işle | — | Görüntüle, harcama işle, indirim / yeniden aç | — |
| Ödeme ve kasa | Ödeme al, iade iste, kasa, döviz kuru | Ödeme al, iade iste, kasa | — | Ödeme al, iade iste, kasa, döviz kuru | — |
| Minibar ve çamaşır | Hepsi | Görüntüle, minibar gir, çamaşır al | Görüntüle, minibar gir, çamaşır al | Görüntüle, fiyat listeleri | — |
| Kat hizmetleri | Hepsi | Görüntüle | Hepsi (görevli + şef) | — | — |
| Kayıp eşya | Hepsi | Görüntüle, kaydet, teslim et | Görüntüle, kaydet | — | Görüntüle, kaydet |
| Raporlar | Görüntüle, asistana sor | — | — | Görüntüle, asistana sor | — |
| Gün kapanış | Görüntüle, kapat | Görüntüle, kapat | — | — | — |
| Teknik servis | Hepsi | Görüntüle, bilet aç / çöz | Görüntüle, bilet aç / çöz | — | — |
| Misafir CRM | Hepsi | Hepsi | — | — | — |
| Bütçe | Görüntüle, düzenle, onayla | — | — | Görüntüle, düzenle | — |
| Acente ve kontrat | Görüntüle, yönet | — | — | Görüntüle | — |
| Satış CRM | Görüntüle, yönet | Görüntüle, yönet | — | — | — |
| Promosyon ve kupon | Görüntüle, yönet | — | — | Görüntüle | — |
| Banket ve etkinlik | Hepsi | Görüntüle, ödeme al | — | Görüntüle, ödeme al | Görüntüle |
| Restoran POS ve menü | Hepsi | — | — | Raporlar | Servis (vardiya, adisyon, ödeme, odaya yaz) |
| Reçete ve maliyet | Görüntüle, yönet | — | — | Görüntüle | Görüntüle |
| Satın alma | Hepsi | — | — | Görüntüle | Görüntüle, talep aç, mal kabul |
| Stok ve depo | Görüntüle, yönet | — | — | Görüntüle | Görüntüle |
| Demirbaş | Hepsi | — | — | Hepsi | — |
| Ön muhasebe | Hepsi | — | — | Görüntüle, fiş gir | — |
| Genel muhasebe | Hepsi (`ledger.view`, `ledger.manage`, `ledger.setup`) | — | — | Hepsi (`ledger.view`, `ledger.manage`, `ledger.setup`) | — |
| Fatura ve e-belge | Hepsi | Görüntüle, folyo faturası kes | — | Görüntüle, kes, serbest fatura / iptal iste | — |
| Personel | Görüntüle | — | — | Görüntüle, yönet | — |
| Bordro | — | — | — | Görüntüle, yönet, öde | — |
| İK (`hr.view` / `hr.manage` / `hr.self`) | Hepsi (görüntüle, yönet, kendi sayfası) | Kendi sayfası (`hr.self`) | Kendi sayfası (`hr.self`) | Hepsi (görüntüle, yönet, kendi sayfası) | Kendi sayfası (`hr.self`) |
| Misafir portalı | Hepsi | Görüntüle, onayla / davet | — | — | — |
| Anket ve memnuniyet | Hepsi | Görüntüle, düşük puan takibi | — | — | — |
| Spa ve spor salonu | Hepsi | Görüntüle, randevu al | — | Görüntüle | — |
| Acente primi | Görüntüle, yönet, ödendi işaretle | — | — | Görüntüle, ödendi işaretle | — |
| Kanal yönetimi | Görüntüle, yönet | — | — | — | — |
| İzleme (aktivite, denetim) | Her ikisi | — | — | — | — |
| Aktörler | Görüntüle | — | — | — | — |

Tabloyu okurken dikkat: "Bordro ayarları" (yasal parametre teyidi) ve "Aktörleri aç / kapat" gibi birkaç izin yalnızca Yöneticidedir; "Kullanıcıları yönet" ve "Rolleri yönet" de öyle.

**Örnek:** Kat görevlisi Hüseyin telefonundan Kat hizmetleri → Görevlerim'i açar, 305'te "Başladım" der; odanın durumu "Temizleniyor" olur. Aynı odanın folyosunu görmek ister; menüde Folyolar yoktur, adresi yazsa "Bu işlem için yetkiniz yok" alır. Odada unutulmuş bir saat bulur: Kayıp eşya'dan fotoğrafıyla kaydeder, ama misafirle eşleştirip teslim etme düğmeleri ona görünmez — o iş resepsiyonun. Kat şefi aynı rolde olduğu için 305'i "Kontrol et" ile onaylayabilir; dört göz kuralı Hüseyin'in kendi temizliğini onaylamasını zaten engeller.

### Yetki kuralları hakkında bilmeniz gerekenler

- **Dört göz kuralı.** Para izini değiştiren işlerde (iade, büyük ödeme, folyo kalemi iptali, ödeme iptali, acente primi, etkinlik ödemesi, adisyon düzeltmesi, satın alma siparişi, ödeme fişi, fatura iptali, bordro) isteyen kişi **kendi isteğini onaylayamaz**; başka bir yetkili onaylamalıdır. Reddetmek (geri çekmek) serbesttir.
- **Gerekçe isteyen işler.** Sistem fiyatı yerine elle toplam girmek, bakiyesi kapanmadan çıkışa izin vermek, kapalı folyoyu yeniden açmak gibi işler ayrı izinle korunur ve gerekçe ister; gerekçe denetim izine yazılır.
- **Kişisel veri maskeleme.** Kimlik numaraları listelerde ve denetim izinde maskeli görünür; personel listesinde ücret ve IBAN ayrı izin ister; kayıp eşyada misafirin iletişim bilgisi yalnızca teslim yetkisi olana görünür.
- **Otel kapsamı.** Her kullanıcı tek bir otele bağlıdır. Bütün sorgular oturumdaki otelle süzülür; başka otelin kaydını görmek adres değiştirerek de mümkün değildir.

## Menü düzeni

Sol menü üç gruptan oluşur. Hangi maddelerin görüneceği rolünüze ve izinlerinize bağlıdır; içi boşalan grup hiç çizilmez. Menü daraltılabilir (yalnızca simgeler), telefonda çekmece olarak açılır. Üst barda bulunduğunuz yerin **konum satırı**, **zil** (uyarılar) ve kullanıcı menüsü vardır.

### Genel

| Madde | Adres | Ne işe yarar |
| --- | --- | --- |
| Panel | `/` | Günlük durum: doluluk, gelecek / gidecek, oda durumu, gelir, 30 günlük tahmin, bekleyen işler. Gelir görme izni olmayan kişiye hızlı erişim kartları gösterilir. |
| Görevler | `/gorevler` | Aktörlerin yapamadığı ya da kapalı olduğu için personele düşen **manuel görevler**. Herkes kendi modülünün görevlerini görür; yan menüde açık görev sayısı rozet olur. |
| Kılavuz | `/kilavuz` | Bu doküman. Herkese açık. |

### Ön büro

Bu grup aslında "operasyon" grubudur; ön büro dışındaki departmanların ekranları da buradadır.

| Madde | Adres | Tek cümleyle işi |
| --- | --- | --- |
| Giriş / çıkış | `/on-buro` | Gelecekler, gidecekler, konaklayanlar listeleri; check-in / check-out; online check-in incelemesi. |
| Rezervasyonlar | `/rezervasyonlar` | Rezervasyon listesi, yeni rezervasyon, bekleme listesi, grup dosyaları (`/gruplar`). |
| Oda planı | `/oda-plani` | Takvim üzerinde odalar × günler; sürükleyerek oda değiştirme, doluluk özeti. |
| Misafirler | `/misafirler` | Misafir CRM: kart, tercih, geçmiş konaklamalar, notlar, etiketler, mükerrer birleştirme. |
| Satış CRM | `/satis` | Fırsat panosu, arama günlüğü, teklifler. |
| Folyolar | `/folyolar` | Konaklama hesapları: kalemler, bölme / birleştirme, aktarma, kapatma. |
| Kasa | `/kasa` | Günlük kasa (yöntem bazında tahsilat / iade) ve döviz kurları. |
| Minibar & çamaşır | `/ek-hizmetler` | Minibar girişi ve kayıtları, çamaşırhane siparişleri, günlük rapor, fiyat listeleri. |
| Kat hizmetleri | `/kat-hizmetleri` | Görev panosu, görevlinin kendi listesi, kat şefi kontrolü, kat haritası. |
| Kayıp eşya | `/kayip-esya` | Bulunan eşya kaydı, misafirle eşleştirme, teslim / kargo, kapatma. |
| Teknik servis | `/teknik-servis` | Arıza biletleri, bana atananlar, periyodik bakım planlaması. |
| Raporlar | `/raporlar` | Gelir raporları, rapor asistanı (AI), rapor tasarımcısı, kayıtlı raporlar. |
| Gün kapanış | `/gun-kapanis` | Night audit sihirbazı ve kapanış geçmişi. |
| Bütçe | `/butce/plan` | Yıllık bütçe, gerçekleşen, sapma raporu ve AI yorumu. |
| Acenteler | `/acenteler` | Acente kartı, kontrat fiyatları, allotment, komisyon, cari özeti. |
| Acente primleri | `/acente-primleri` | Hedef / prim kuralları, ilerleme, hak ediş, ödeme işareti. |
| Etkinlikler | `/etkinlikler` | Banket / etkinlik dosyaları, salon takvimi, teklif / sözleşme / proforma, ödemeler, F&B planı. |
| Restoran | `/pos` | Masa planı, mutfak ekranı, oda servisi, paket servis, adisyonlar, vardiyalar, satış raporu, menü ve tanımlar. |
| Promosyonlar | `/promosyonlar` | Promosyon ve kupon tanımları, kullanım raporu. |
| Kanallar | `/kanallar` | OTA (Channex) ve iCal kanalları, eşleştirme, senkron logu, kanal rezervasyonları. |
| Mesajlar | `/mesajlar` | Misafir konuşmaları (WhatsApp, web chat), AI / personel modu; cevap bekleyen sayısı rozet. |
| İstekler | `/istekler` | Misafir istekleri (havlu, yastık, arıza bildirimi…), öncelik, hedef süre, atama. |
| Anketler | `/anketler` | NPS, cevaplar, düşük puan takibi, AI dönem özeti. |
| Spa | `/spa` | Terapist takvimi, randevular, grup dersleri, spa kasası. |
| Mutfak | `/mutfak` | Reçeteler ve malzeme kartları (maliyet, kâr marjı, alerjen). |
| Satın alma | `/satin-alma` | Talepler → teklif turları → siparişler → mal kabul; tedarikçiler. |
| Stok | `/stok` | Mevcut, hareketler, sayım, maliyet raporu, depolar. |
| Demirbaş | `/demirbas` | Sicil, QR etiket, sayım, amortisman, garanti, tanımlar. |
| Faturalar | `/faturalar` | Faturalanacaklar, taslaklar, kesilenler; e-belge durumu. |
| Personel | `/personel` | Personel kartları (ücret bilgisi yetkiye göre). |
| Bordro | `/bordro` | Bordrolar, puantaj ve kalemler, servis payı, ayarlar. |
| İK | `/ik` | İzinler, izin bakiyeleri, vardiya çizelgesi, günlük puantaj ve bordroya aktarım, özlük belgeleri, İK ayarları (`hr.view`). |
| İzinlerim | `/ik/benim` | Personelin kendi sayfası: izin bakiyesi, izin talebi, izinleri, vardiyaları, bu ayın puantajı (`hr.self`; kullanıcı hesabı personel kartına bağlı olmalı). |
| Ön muhasebe | `/muhasebe` | Cariler, kasa / banka, çek / senet, fişler. |
| Genel muhasebe | `/genel-muhasebe` | Tek Düzen hesap planı, yevmiye fişleri (otomatik ve elle), mizan, hesap ekstresi, fiş kuralları, dönem kilidi. |
| Toplanacak tepsiler | `/oda-servisi/tepsiler` | Oda servisi tepsilerinin toplanma listesi. |
| Odalar | `/odalar` | Oda listesi, müsaitlik takvimi, oda atama. |

### Yönetim

| Madde | Adres | Tek cümleyle işi |
| --- | --- | --- |
| Onaylar | `/onaylar` | Bekleyen ve geçmiş onaylar; karar verme. Bekleyen sayısı rozet. |
| Fiyat önerileri | `/fiyat-onerileri` | Dinamik fiyat önerileri (kural ve AI); gerekçe, düzenleme, onay / ret; fiyat geçmişi. |
| Bildirimler | `/bildirimler` | Gönderim geçmişi, şablonlar, kanallar (e-posta / SMS). |
| Aktivite | `/aktivite` | Canlı akış, olaylar, denetim kaydı. |
| Excel'den yükle | `/ice-aktar` | Misafir listesi ve fiyat planı toplu yükleme sihirbazı. |
| Aktörler | `/aktorler` | Aktör paneli: durum, aç / kapat, ne durur, AI kullanımı. |
| Ayarlar | `/ayarlar` | Otel bilgileri, oda tipleri, vergiler, sezonlar, fiyat planları, paketler, dinamik fiyat, genel parametreler, kullanıcılar, roller & izinler, AI asistanı, mesaj kanalları. Yalnızca Yönetici görür. |

Bu kılavuzun "Yönetim ekranları" bölümü bu grubun her maddesini ayrıntısıyla anlatır.

### Menüde yolunuzu bulmak

- **Konum satırı** (üst bar) her an "Ön büro › Rezervasyonlar › Liste" gibi nerede olduğunuzu gösterir.
- Alt sayfaları olan maddeler (Rezervasyonlar, Kasa, Raporlar…) hem yan menüde açılır hem sayfanın üstünde sekme olur; ikisi aynı listeden beslenir.
- Rozetli maddeler (Görevler, Mesajlar, İstekler, Onaylar) bekleyen iş sayısını yan menüde gösterir; sayı canlı artar.
- Menü daraltıldığında yalnızca simgeler kalır; üzerine gelince ad görünür. Tercih tarayıcıda saklanır.

**Örnek:** Müdür Zeynep sabah şu sırayla dolaşır: Panel (doluluk %78, 14 gelecek, 9 gidecek, bekleyen 2 onay, 1 görev) → Onaylar rozeti 2 → `/onaylar/bekleyen`'de iade isteğini onaylar, eşik üstü ödemeyi reddeder (gerekçe: "misafir kartla ödeyecek") → Görevler'de "Kanaldan gelen rezervasyon elle işlenecek" görevini açar; Booking.com'dan gelen rezervasyonun oda tipi eşleşmemiş; Kanallar → eşleştirme'yi düzeltir, rezervasyonu elle açar, görevi tamamlar → Kat hizmetleri → Kat haritası'nda 4. katın %60'ının "kirli" olduğunu görür. Beş dakika; hepsi menüden.

## Ortak ekran kalıpları

Sistemdeki ekranlar aynı birkaç kalıpla kurulmuştur. Bir kalıbı öğrendiğinizde bütün modüllerde tanırsınız.

### Liste + süzgeç + sayfalama

Çoğu ekran bir listedir. Üstte süzgeç çubuğu (durum, tarih, arama…), altta kayıtlar vardır. Listeler **imleçli** çalışır: "daha fazla" dediğinizde bir sonraki sayfa yüklenir; sayfa numarası yoktur çünkü canlı değişen listede numara kayar. Süzgeçler çoğu ekranda **adres çubuğuna yazılır**; adresi kopyalayıp bir arkadaşınıza gönderirseniz aynı süzgeçle açılır. Arama kutuları en az birkaç karakter ister ve Türkçe karakter farklarını (ı / i gibi) tolere eder.

**Örnek:** Elif, Rezervasyonlar → Liste'de süzgeci "Durum: Opsiyonlu, Giriş: önümüzdeki 7 gün" yapar; adres çubuğu süzgeçle birlikte değişir. Adresi müdüre gönderir; müdür açınca aynı süzgeçli liste gelir. Listede 23 kayıt var, 20'si yüklü; "Daha fazla" ile kalan 3 gelir.

### Sekmeler

Bölüm sayfaları (Odalar, Ayarlar, Raporlar, Onaylar…) alt sayfalarını üstte sekme olarak gösterir. Sekmeler, yan menüdeki alt maddelerle aynı listeden beslenir; yetkiniz olmayan sekme görünmez.

### Formlar ve doğrulama

Formlar kaydetmeden önce tarayıcıda, kaydederken de sunucuda **aynı kurallarla** doğrulanır. Hatalı alan kırmızı olur ve altında Türkçe açıklama çıkar ("Şifre en az 8 karakter olmalı", "Check-out saati check-in saatinden önce olmalı"). Para ve oran alanları iki ondalıklı yazılır ("1250.00"); tarihler takvimden seçilir.

Veritabanı kısıtına takılan kayıt da Türkçe açıklamayla döner; birkaç gerçek örnek:

| Durum | Göreceğiniz mesaj |
| --- | --- |
| Aynı kodla ikinci oda tipi | "Bu kodlu bir oda tipi zaten var." |
| Aynı numarayla ikinci oda | "Bu numaralı bir oda zaten var." |
| Çakışan sezon | "Bu tarih aralığı mevcut bir sezonla çakışıyor. Aynı güne iki sezon çarpanı düşemez." |
| Sezon bitişi başlangıçtan önce | "Sezon bitiş tarihi başlangıç tarihinden önce olamaz." |
| İptal politikasında yalnızca gün dolu | "İptal politikası ya tamamen kapalı olmalı ya da hem gün hem ceza oranı dolu olmalı." |
| Aynı odayı aynı geceye iki misafire vermek | "Bu oda seçilen gecelerde başka bir rezervasyona ait. Aynı oda aynı geceye iki misafire verilemez." |
| Arızalı odaya misafir atamak | "Oda bu tarihlerde arızalı veya hizmet dışı; misafir atanamaz." |
| Rezervasyonlu odayı arızaya almak | "Bu tarihlerde odada rezervasyon var; arıza kaydı açılamaz. Önce misafiri başka odaya taşıyın." |
| Çıkış tarihi girişle aynı gün | "Çıkış tarihi girişten en az bir gece sonra olmalı." |

### Hata mesajları ve anlamları

Sunucudan gelen mesajların dili tektir; aynı kelimeleri her ekranda görürsünüz:

| Mesaj | Kod | Ne demek, ne yapmalı |
| --- | --- | --- |
| "Oturum açmanız gerekiyor" | 401 | Oturum yok ya da düştü. Giriş ekranına yönlendirilirsiniz. |
| "Oturum süresi doldu, tekrar giriş yapın" | 401 | Yenileme anahtarı 30 günü geçti ya da çıkış yapıldı. Şifreyle girin. |
| "Bu işlem için yetkiniz yok" | 403 | Rolünüzde o izin yok. Menüde görünmeyen bir adresi elle yazdıysanız ya da izniniz az önce kaldırıldıysa çıkar. Yöneticiye izin için başvurun. |
| "Kayıt bulunamadı" | 404 | Kayıt silinmiş ya da başka otele ait. Listeyi yenileyin. |
| "Bu kayıt siz düzenlerken başkası tarafından değiştirildi. Sayfayı yenileyip tekrar deneyin." | 409 | Sürüm çakışması (aşağıda). Yenileyin, yeniden deneyin. |
| "Bu görev zaten kapatılmış (Tamamlandı)" / "Bu görevi başka biri üstlendi" | 409 | Görev durumu değişti; liste tazelenir. |
| "Bu onay zaten karara bağlanmış (Onaylandı)" | 409 | Başka yetkili sizden önce karar verdi. |
| "Bu onayın süresi dolmuş; iş yapılmayacak" | 409 | Onay 1 günlük süreyi aştı; iş yapılmaz. |
| "Kendi isteğinizi onaylayamazsınız; başka bir yetkili onaylamalı (reddederek geri çekebilirsiniz)" | — | Dört göz kuralı. |
| Kırmızı alan altı mesaj ("Şifre en az 8 karakter olmalı") | 400 | Doğrulama hatası; alanı düzeltin. |
| "Sistem şu an çok yoğun. Lütfen birkaç saniye sonra tekrar deneyin." | 503 | Sunucu yoğun ya da uzun rapor süre sınırını aştı; bekleyin ya da aralığı kısaltın. |

### Sürüm damgası: "başkası değiştirdi"

İki kişi aynı kaydı aynı anda açıp düzenleyebilir. İkinci kişi kaydettiğinde sistem şu uyarıyı verir:

> Bu kayıt siz düzenlerken başkası tarafından değiştirildi. Sayfayı yenileyip tekrar deneyin.

Bu bir hata değil, korumadır: ilk kaydeden kişinin değişikliği **ezilmez**. Sayfayı yenileyin, güncel değeri görün, gerekiyorsa değişikliğinizi yeniden yapın. Teknik olarak her kayıt bir sürüm damgası (son güncelleme zamanı) taşır; form bunu okuduğu hâliyle geri gönderir; eşleşmiyorsa kayıt reddedilir. Arka planda çalışan zamanlanmış işler (ör. spa hatırlatması, gecikme uyarısı) bu damgaya **dokunmaz**; yani ekranı açık tutan personel sırf sistem bir alanı işaretledi diye "başkası değiştirdi" almaz.

**Örnek:** Elif ve Murat aynı anda DEMO-0107'nin detayını açtı. Elif misafir notuna "yüksek kat" yazıp 10:20'de kaydetti. Murat 10:21'de telefon numarasını düzeltip kaydetmek istedi; "Bu kayıt siz düzenlerken başkası tarafından değiştirildi…" aldı. Sayfayı yeniledi: Elif'in notu geldi, telefon hâlâ eski. Numarayı tekrar düzeltip kaydetti; iki değişiklik de durdu. Kimse kimseninkini silmedi; denetim kaydında iki satır var.

### Canlı tazeleme

Ekranlar kendiliğinden yenilenir. Bir rezervasyon açılınca oda planı, bir ödeme alınınca kasa, bir onay düşünce onay sayacı tazelenir. Mekanizma şöyledir: sunucu, panellere **"şu otelde şu değişti"** haberini socket kanalıyla gönderir (veriyi değil, yalnızca haberi); ekran kendi sorgusunu yeniden çalıştırır. Haber yalnızca o ekranı açık tutan panellere gider, bu yüzden 2500 odalı bir otelde bile trafik şişmez. Bağlantı koptuğunda ekranlar birkaç dakikada bir kendi kendine yeniler; bağlantı gelince kaldığı yerden devam eder.

**Örnek:** Resepsiyonda iki bilgisayar Oda planı'nı açık tutuyor. Elif birinde 212'deki misafiri 214'e taşıdı. Diğer bilgisayarda Murat hiçbir şeye basmadan 1–2 saniye içinde çubuğun 214'e kaydığını gördü. Aynı anda mutfaktaki tablet (Mutfak ekranı) hiçbir haber almadı; o ekran oda planı kanalına abone değil. Günlük durum (Panel) ise "envanter değişti" haberini aldı ama en sık 15 saniyede bir tazelendiği için sayılar birkaç saniye sonra güncellendi.

### Zil ve uyarılar

Sağ üstteki **zil** size yönelik uyarıları toplar. Bir uyarı ya **bir kişiye** (ör. istediğiniz onayın sonucu, size atanan istek) ya da **bir izne** (ör. "onay bekleyen iş" onaylayabilen herkese; "personele bırakılan iş" o modülde yetkili herkese) gider. Uyarı türleri arasında şunlar vardır: yeni misafir mesajı, acil misafir isteği, geciken misafir isteği, personele bırakılan iş, misafire ulaşamayan bildirim, onay bekleyen iş, bekleme listesinde yer açıldı, bakiyesi kapanmadan çıkış, AI konuşmayı devretti, AI bütçesi doldu, kanal rezervasyonu dikkat istiyor, kanal senkronu başarısız, banket opsiyon / depozito, POS uzun vardiya / unutulmuş adisyon, fatura gönderilemedi, online check-in inceleme bekliyor, ankette düşük puan, spa, arıza, satış takibi, demirbaş garanti bitişi, stok minimum altı, İK (izin talebi / kararı, süresi dolacak özlük belgesi).

Uyarıya tıkladığınızda ilgili ekrana gidersiniz (ör. göreve, onaya, konuşmaya). Zil tercihlerinden istemediğiniz türleri susturabilirsiniz. Uyarılar 30 gün saklanır; zil bir iş listesi değildir — işin kendisi ilgili ekranda durur. Aynı konu için tekrar tekrar uyarı üretilmez (aynı onay, aynı görev tek uyarıda birleşir).

**Örnek:** 16:40'ta 418'den "klima çalışmıyor, acil" isteği açıldı. İsteğin sahibi yok; istek yönetme izni olan herkesin (resepsiyon, kat, F&B) zilinde "Acil misafir isteği" çıktı. Elif isteği üstlendi; artık sonraki uyarılar (ör. "hedef süresi geçti") yalnızca Elif'e gider. Elif teknik servise bilet açtı; teknisyen Ali'nin zilinde "Arıza / teknik servis" belirdi. Muhasebeci Deniz bu uyarıların hiçbirini görmedi; onun zilinde o sırada "Onay bekleyen iş" vardı.

### Manuel görevler

Bir aktör kapalıysa, hata verdiyse ya da bir işi yapamadıysa (eşleşmeyen oda tipi, bütçesi dolan AI, cevaplanamayan rapor sorusu) iş **Görevler** ekranına (`/gorevler`) düşer. Görev okunur bir başlık taşır ("DEMO-0001 için oda ata", "Gelen kanal rezervasyonunu işle"), hangi aktörün neden bırakamadığını, orijinal olayı ve bağlı kayıtlara (rezervasyon, konuşma, onay) bağlantı içerir. Görevi **üstlenir**, işi ilgili ekranda yaparsınız, sonra görevi **tamamlarsınız** (notla) ya da **"gerek kalmadı"** dersiniz (gerekçe zorunlu). Ayrıntı "Yönetim ekranları" bölümünde.

**Örnek:** Stok aktörü, "Izgara somon" ürününün reçetesi olmadığı için adisyon #1187'nin düşümünü yapamadı; Görevler'e "Adisyon 1187 stoktan düşülecek (4 ürün)" düştü. Depo sorumlusu görevi üstlendi, Mutfak'ta reçeteyi tanımladı, Stok → Hareketler'den adisyon numarası kaynaklı elle çıkış girdi, görevi "reçete eklendi, çıkış elle yapıldı" notuyla tamamladı. Ertesi adisyonlar kendiliğinden düştü.

### Onay kuyruğu

Riskli bir iş onay istediğinde yetkililerin ziline "Onay bekliyor" düşer ve yan menüde **Onaylar** rozeti artar. Onay, varsayılan olarak **bir gün** bekler; kimse karar vermezse süresi dolar ve iş yapılmaz (uyarı düşer). Onaylanınca isteyen aktör kaldığı yerden devam eder; reddedilince iş yapılmaz ve bir daha ele alınmaz.

**Örnek:** Genel parametrelerde büyük ödeme eşiği 20.000 TL. Bir grup lideri 36.000 TL nakit ödemek istedi. Elif ödemeyi girdi; ekran "onaya gönderildi" dedi, ödeme "bekliyor" durumunda kaldı, müdürün zili çaldı. Müdür tutarı ve folyoyu kontrol edip onayladı; ödeme işlendi, folyo bakiyesi düştü, muhasebe aktörü kasaya yazdı. Elif ödemeyi 3.600 yerine yanlışlıkla 36.000 yazmış olsaydı müdür reddederdi ve kasa açığı doğmazdı — eşik tam bunun içindir.

### Denetim izi

Sistemdeki her değişiklik (kim, ne zaman, hangi kayıt, eski ve yeni değer) **değişiklikle aynı işlemde** kaydedilir; "değişti ama izi yok" durumu teknik olarak imkânsızdır. Denetim kaydını `/aktivite/denetim` ekranından yetkili kişiler görür. Aktörlerin yaptığı işler ise **aktivite akışına** yazılır (hangi olay, hangi aktör, ne kadar sürdü, sonuç). Bir rezervasyonun bütün hikâyesini ("İşlem zinciri") tek tıkla görebilirsiniz.

**Örnek:** Misafir "bana 4.800 denmişti, folyoda 5.200 var" dedi. Müdür rezervasyon detayında **İşlem zinciri**'ne bastı: 3 Kasım 15:12 Elif rezervasyonu 4.800 ile açtı → 5 Kasım 09:40 Murat tarihi bir gün uzattı, fiyat 5.200 oldu (denetim kaydında eski 4.800 → yeni 5.200, değişen alanlar: çıkış tarihi, toplam) → folyo aktörü her gece ücreti bastı. Fark gerçek; misafirle konuşma netleşti. Kimse "sistem kendi değiştirdi" diyemedi.

### Gerekçe isteyen işler

Bazı düğmeler açıklama kutusu açar ve boş bırakılamaz: fiyatı elle belirleme, bakiyesi kapanmadan çıkış, folyoyu yeniden açma, onay reddi, göreve "gerek kalmadı", bildirim iptali, ödeme iptali; aktör kapatmada gerekçe isteğe bağlıdır. Gerekçe denetim izine yazılır ve ilgili uyarıda görünür. Bu, "neden böyle yapıldı" sorusunun bir yıl sonra bile cevaplanabilmesi içindir.

### İş günü

Otelin "bugün"ü takvimden değil **gün kapanışından** okunur. Gece görevlisi günü kapatmadan iş günü ilerlemez; oda ücretleri, raporlar, "bugün gelecekler" hep bu güne göre çalışır. Gece yarısını geçtiğinizde ekranlar hâlâ "dünü" gösterirse bunun sebebi günün kapatılmamış olmasıdır — bu bir hata değil, tasarımdır. Ayrıntı "Arka planda ne oluyor" ve "Yönetim ekranları → Gün kapanış" bölümlerinde.

**Örnek:** 24 Kasım 23:50'de bir misafir resepsiyona geldi, "bu gece kalacağım" dedi. Burak rezervasyonu "bugün giriş" ile açıp giriş yaptı; sistem konaklamayı 24 Kasım gecesine yazdı. Burak 00:30'da günü kapattı; folyo aktörü o misafire de 24 Kasım gecesinin ücretini bastı. Gün kapatılmadan 00:30'da gelen başka bir misafir de yine 24 Kasım gecesine yazılır — otel için gece henüz bitmemiştir.

### Para ve vergi

Bütün tutarlar otelin **tek para biriminde** tutulur. Döviz ödemeleri günlük kurla çevrilir (Kasa → Döviz kurları). Vergiler ayarda "fiyata dahil" ya da "hariç" olarak tanımlanır; raporlardaki gelir, ADR ve RevPAR **vergiler hariç** hesaplanır. Rezervasyon ve folyo kalemlerindeki vergi dökümü aynı formülü kullanır; iki ekran arasında fark görmezsiniz.

**Örnek:** Oda fiyatı 2.000 TL, KDV %10 ve konaklama vergisi %2 "fiyata dahil". Rezervasyon ekranındaki vergi dökümü net 1.785,71 + KDV 178,57 + konaklama vergisi 35,71 = 2.000,00 gösterir. Gelir raporunda o gecenin "oda geliri" 1.785,71'dir; misafirin ödediği 2.000'dir. Bir Alman misafir 100 € nakit ödedi; Kasa → Döviz kurları'ndaki günün kuruyla (ör. 38,20) 3.820,00 TL olarak kasaya işlendi; raporlar hep TL'dir.

### Kişisel veri ve maskeleme

Kimlik numarası listelerde maskeli görünür; tam numara yalnızca ilgili kartta ve yetkiliye. Olay gövdelerinde (Aktivite → Olaylar) telefon, e-posta, kimlik ve kart numarası maskelenir. Manuel görev detayında gövde **maskesiz** gelir, çünkü işi yapacak kişi misafiri arayacaktır ve zaten o modülün yetkisine sahiptir. Kimlik ve eşya fotoğrafları saklama süresi dolunca kendiliğinden silinir.

## İlk kurulum sırası

Yeni bir oteli sisteme almak için aşağıdaki kontrol listesini sırayla geçin. Sıra önemlidir çünkü her adım bir öncekine yaslanır (oda, oda tipine; fiyat planı, oda tipi ve sezona; rezervasyon, hepsine). Her adımda **ekran**, **girilecek alanlar**, **kontrol** (bitti mi nasıl anlarsınız) ve **atlanırsa ne olur** verilmiştir. Yazdırıp yanınıza koyabilirsiniz.

### Sunucu tarafı (kurulumdan önce, teknik kişi)

- [ ] `.env` dosyasında `DATABASE_URL`, `JWT_SECRET` (üretimde uzun ve rastgele; yoksa sunucu açılmaz), `CORS_ORIGINS` (panelin adresi), `SETTINGS_SECRET_KEY` (32 bayt base64; yoksa kanal parolaları kaydedilemez), isteğe bağlı `OPENAI_API_KEY` (yoksa AI ajanları çalışmaz), `REPORTING_DATABASE_URL` (salt okunur rapor kullanıcısı; isteğe bağlı).
- [ ] `npm run db:migrate` çalıştırıldı (`prisma db push` **asla**).
- [ ] PostgreSQL'de `postgresql-contrib` kurulu (sezon çakışma kısıtı için `btree_gist`).
- [ ] nginx `/webhooks/`, `/webchat/`, `/socket.io/` yollarını backend'e geçiriyor; `X-Forwarded-For` başlığı iletiliyor.
- **Atlanırsa:** sunucu açılmaz ya da kanal parolası kaydedilemez; ekran "Sunucuda SETTINGS_SECRET_KEY tanımlı değil" benzeri uyarı verir.

### Adım 1 — Otel bilgileri

- **Ekran:** Ayarlar → Otel bilgileri (`/ayarlar/otel`).
- **Alanlar:** Otel adı, Kod (sonradan değişmez), Telefon, E-posta, Adres, Logo adresi (http/https); **Operasyon** kartında Para birimi, Saat dilimi, Check-in saati, Check-out saati.
- **Kontrol:** Kaydet sonrası üst barda otel adı; Panel'de saat diliminize göre "bugün".
- **Atlanırsa:** Para birimi ilk rezervasyon / folyodan sonra **kilitlenir** ("CURRENCY_LOCKED"); yanlış seçim sonradan düzelmez. Saat dilimi yanlışsa "bugün gelecekler" gece yarısından sonra kayar. Check-out saati check-in'den önce olmalıdır; aksi hâlde form kaydetmez.

### Adım 2 — Genel parametreler

- **Ekran:** Ayarlar → Genel parametreler (`/ayarlar/genel`).
- **Alanlar:** Varsayılan pansiyon (RO / BB / HB / FB / AI / UAI); Ücretsiz iptal süresi (gün) ve Ceza oranı (%) — ikisi birlikte dolu ya da birlikte sıfır; Telefon ülke kodu (90); Kapasite aşımı politikası (Reddet / Onaya gönder); Erken giriş ve geç çıkış ücreti (sabit ya da yüzde); Girişte kimliği istenenler; **Büyük ödeme eşiği**.
- **Kontrol:** Her kartın altındaki "Özet" kutusu politikayı cümleyle anlatır ("3 gün öncesine kadar ücretsiz, sonra %100").
- **Atlanırsa:** İptal / gelmedi ücreti işlenmez; büyük ödeme eşiği boşsa hiçbir tahsilat onaya gitmez; AI asistanı pansiyon bilemez.

### Adım 3 — Oda tipleri

- **Ekran:** Ayarlar → Oda tipleri (`/ayarlar/oda-tipleri`).
- **Alanlar:** Kod (STD, DLX…), Ad, Yetişkin ve çocuk kapasitesi, Taban fiyat, Açıklama.
- **Kontrol:** Liste dolu; "Bu kodlu bir oda tipi zaten var." hatası almadınız.
- **Atlanırsa:** Oda açılamaz, rezervasyon alınamaz. Kapasiteyi sonradan düşürmek, ileride fazla kişili rezervasyon varsa reddedilir ("CAPACITY_IN_USE").

### Adım 4 — Vergiler

- **Ekran:** Ayarlar → Vergiler (`/ayarlar/vergiler`).
- **Alanlar:** Ad (KDV, Konaklama vergisi), Oran, Fiyata dahil mi, Kategori (oda, restoran, minibar…).
- **Kontrol:** Rezervasyon önizlemesinde vergi dökümü görünür.
- **Atlanırsa:** Folyo kalemleri vergisiz yazılır; raporlardaki net / brüt ayrımı yanlış olur; fatura yanlış kesilir.

### Adım 5 — Sezonlar

- **Ekran:** Ayarlar → Sezonlar (`/ayarlar/sezonlar`).
- **Alanlar:** Ad, Başlangıç, Bitiş, Çarpan (1,00 = taban fiyat; 1,30 = %30 fazla).
- **Kontrol:** Takvimde boşluk yok; çakışma denemesi "Bu tarih aralığı mevcut bir sezonla çakışıyor…" veriyor.
- **Atlanırsa:** Fiyat planı olmayan geceler taban fiyattan satılır (çarpan 1 sayılır). Çalışır ama yaz / kış fiyat farkı olmaz.

### Adım 6 — Fiyat planları ve paketler (önerilir)

- **Ekran:** Ayarlar → Fiyat planları (`/ayarlar/fiyat-planlari`); Ayarlar → Paketler (`/ayarlar/paketler`).
- **Alanlar (plan):** Oda tipi, Pansiyon, Dönem, Gecelik fiyat, Dahil kişi (varsayılan 2), Ek yetişkin, Çocuk başı ek, En az gece. **Alanlar (paket):** Kod, Ad, Pansiyon, Gecelik fiyat, Bileşenler.
- **Kontrol:** Rezervasyon önizlemesinde gece satırında plan adı görünür (sezon adı yerine).
- **Atlanırsa:** Fiyat sezon × taban olarak hesaplanır; pansiyon farkı fiyata yansımaz. Toplu yükleme için Excel'den yükle kullanılabilir.
- **Hatırlatma:** Öncelik **elle > acente kontratı > paket > fiyat planı > sezon × taban**; dinamik fiyat çarpanı yalnızca plan ve sezonu ölçekler.

### Adım 7 — Odalar

- **Ekran:** Odalar → Oda listesi (`/odalar/liste`).
- **Alanlar:** Oda numarası, Kat, Oda tipi, Özellikler.
- **Kontrol:** Odalar → Müsaitlik takviminde her tip için doğru oda sayısı; "Bu numaralı bir oda zaten var." hatası yok.
- **Atlanırsa:** Müsaitlik sıfır; hiçbir rezervasyon açılamaz. Arıza / hizmet dışı işaretleri sonradan Teknik servis'ten yapılır.

### Adım 8 — Kullanıcılar ve roller

- **Ekran:** Ayarlar → Kullanıcılar (`/ayarlar/kullanicilar`); Ayarlar → Roller & İzinler (`/ayarlar/roller`).
- **Alanlar:** Ad, E-posta, Rol, Aktif, Şifre (en az 8 karakter). Matris: gerekiyorsa rolleri uyarlayın (kat şefi / görevli ayrımı, şef garson ikram yetkisi, muhasebeye onay yetkisi…).
- **Kontrol:** Her personel kendi hesabıyla girip beklediği menüyü görüyor; demo hesapları (admin@hotel.local, resepsiyon@hotel.local) pasif.
- **Atlanırsa:** Herkes tek hesaptan çalışırsa denetim izi "kim yaptı" sorusuna cevap veremez; dört göz kuralı işlemez (aynı kişi hem ister hem onaylar gibi görünür ve kilitlenir).

### Adım 9 — Bildirim kanalları ve şablonlar

- **Ekran:** Bildirimler → Kanallar (`/bildirimler/kanallar`); Bildirimler → Şablonlar (`/bildirimler/sablonlar`).
- **Alanlar (e-posta):** Sunucu, Port, Güvenlik (SSL/TLS / STARTTLS), Kullanıcı, Parola, Gönderen. **(SMS):** Netgsm kullanıcı, parola, onaylı başlık; Sessiz saatler. Şablonlar: olay × kanal × dil metinleri, değişken çipleri.
- **Kontrol:** "Test gönder" kendi adresinize ulaştı; SMS şablonu parça sayacı 1–2.
- **Atlanırsa:** Misafire hiçbir bildirim gitmez; Gönderim geçmişi'nde "Başarısız" birikir, yöneticinin ziline "Misafire ulaşamayan bildirim" düşer. Sistem yine çalışır.

### Adım 10 — Mesaj kanalları ve AI (isteğe bağlı)

- **Ekran:** Ayarlar → Mesaj kanalları (`/ayarlar/mesaj-kanallari`); Ayarlar → AI asistanı (`/ayarlar/ai`).
- **Alanlar (WhatsApp):** Telefon numarası kimliği, Numara, Erişim token'ı, Uygulama sırrı, Webhook doğrulama token'ı; Callback URL'yi Meta'ya yazın. **(Web chat):** Balon açık, Online rezervasyon motoru açık, izinli site adresleri, Başlık, Karşılama, Renk; gömme kodunu siteye yapıştırın. **(AI):** AI açık, modeller, fiyatlar, Günlük bütçe (USD), Konuşma başına günlük cevap, AI'ın açtığı rezervasyon (Kesin / Opsiyonlu), Otel bilgisi metni.
- **Kontrol:** Sitedeki balondan yazılan mesaj Mesajlar'da görünüyor; AI açıksa cevap geliyor, kapalıysa konuşma "cevap bekleyen".
- **Atlanırsa:** Misafir mesajı kanalı yoktur; rezervasyonlar telefon ve OTA'dan alınır. AI yoksa her şey personelde.

### Adım 11 — Aktörleri gözden geçirin

- **Ekran:** Yönetim → Aktörler (`/aktorler`).
- **Alanlar:** Her aktörün anahtarı; kapatırken gerekçe.
- **Kontrol:** Elle yürütmek istediğiniz işler dışında hepsi açık; kurulu olmayan AI ajanları sebebiyle listede.
- **Atlanırsa:** Varsayılan **açık** olduğu için bir şey bozulmaz; yalnızca otelin tercihleri uygulanmamış olur.

### Adım 12 — Departman tanımları (ihtiyaca göre)

| Departman | Ekran | Girilecek | Atlanırsa |
| --- | --- | --- | --- |
| Restoran | Restoran → Menü ve tanımlar | Satış noktaları, masalar, menü grupları / ürünler / fiyatlar, POS politikası | Adisyon açılamaz |
| Mutfak | Mutfak → Reçeteler / Malzeme kartları | Malzeme birim maliyeti, reçete satırları, fire | Stok aktörü satışı düşemez (reçetesiz ürün atlanır) |
| Stok | Stok → Depolar | Depolar, satış noktası → depo eşlemesi, minimum seviyeler | Satış düşümü "Stok" görevine düşer; minimum altı önerisi çıkmaz |
| Satın alma | Satın alma → Tedarikçiler | Tedarikçi kartları, satın alma politikası (onay eşiği) | Teklif turu açılamaz |
| Banket | Etkinlikler → tanımlar | Salonlar, ekipman, fiyat, opsiyon süresi, depozito, iptal kademeleri | Etkinlik dosyası açılamaz |
| Spa | Spa → tanımlar | Hizmetler, terapistler, odalar, ders programı, hatırlatma süresi | Randevu alınamaz |
| Demirbaş | Demirbaş → Tanımlar | Kategoriler, alanlar, amortisman oranları | Kart açılamaz |
| Ön muhasebe | Ön muhasebe → ayarlar | Kasa / banka tanımları, **ödeme yöntemi eşlemesi**, başlangıç günü, onay eşiği, açılış bakiyeleri | Muhasebe aktörü her tahsilatı "Ön muhasebe" görevine düşürür |
| Genel muhasebe | Genel muhasebe → Hesap planı, Kurallar | Tek Düzen hesap planı ilk açılışta kendiliğinden yüklenir; gözden geçirilecekler: gelir alt hesapları (600.01–600.09), açılış karşı hesabı (varsayılan 500), carisiz giriş / çıkış karşı hesapları, KDV oran hesapları, bordro departman hesapları | Varsayılan kurallarla çalışır; yalnız kural hesabı pasif / eksikse fiş "Ön muhasebe" görevine düşer |
| Fatura | Faturalar → ayarlar | Satıcı bilgileri, seriler, faturalama başlangıcı, vergi kodları, entegratör | Fatura kesilemez; e-belge gitmez |
| Bordro | Bordro → Ayarlar | Yasal parametreler (teyit), kalem türleri, departmanlar, işyeri | Bordro hesaplanamaz |
| İK | İK → Ayarlar; Personel kartı → Kullanıcı hesabı | Hafta tatili günü, günlük / haftalık norm, resmî tatiller (sabit tatilleri ekle + dinî bayramlar elle), izin onayı, belge hatırlatma günü; her personel kartına kullanıcı hesabı bağı ve doğum tarihi | Varsayılanlarla çalışır (Pazar, 7,5 / 45 saat, sabit tatiller); dinî bayramlar izinden düşmez; bağı olmayan personel İzinlerim'i kullanamaz |
| Misafir portalı | Portal ayarları | Davet günü, açılış günü, belge saklama süresi, metinler | Online check-in daveti gitmez |
| Anket | Anketler → ayarlar | Sorular, gönderim günü / saati, yorum bağlantıları | Anket daveti gitmez |

### Adım 13 — Mevcut veriyi taşıyın

- **Ekran:** Yönetim → Excel'den yükle (`/ice-aktar`); Demirbaş kartları kendi ekranından Excel ile.
- **Alanlar:** Misafir listesi (Ad*, Soyad*, Telefon, E-posta, Uyruk, Belge türü, Belge no, Doğum tarihi, Etiketler, Not) ve Fiyat planı (Oda tipi*, Plan adı*, Pansiyon*, Başlangıç*, Bitiş*, Gecelik fiyat*, Dahil kişi, Ek yetişkin, Çocuk başı ek, En az gece).
- **Kontrol:** Denetim adımında "Hatalı" sıfır; yükleme geçmişinde kayıt.
- **Atlanırsa:** Misafir kartları ilk konaklamalarında tek tek oluşur; eski tercih ve geçmiş bilgisi olmaz. Açık rezervasyonlar bugün elle açılır (tam göç sihirbazı yol haritasında; henüz yok).

### Adım 14 — İlk gün kapanışı

- **Ekran:** Gün kapanış (`/gun-kapanis`).
- **Alanlar:** Kasa sayımı (yöntem bazında), devir notu.
- **Kontrol:** "Gün kapatıldı … iş günü ilerledi" mesajı; Panel ertesi günü gösteriyor; Gün kapanış → Geçmiş'te ilk kayıt.
- **Atlanırsa:** İş günü ilerlemez; ertesi günün oda ücretleri basılmaz; "bugün gelecekler" eski günü gösterir; raporlar eski günü "bugün" sayar. Kapanış yapılınca hepsi düzelir.

**Örnek: iki günlük kurulum.** 40 odalı bir şehir oteli. 1. gün sabah teknik kişi sunucuyu ve `.env`'i kurdu, migrasyonu çalıştırdı. Öğleden sonra yönetici Adım 1–7'yi geçti: para birimi TRY, saat dilimi Europe/Istanbul, 14:00 / 12:00; 3 oda tipi (STD 2+1, DLX 2+2, SUT 3+2); KDV %10 dahil, konaklama vergisi %2 dahil; 4 sezon (çakışma denemesinde hata aldı, düzeltti); 40 oda. Akşam 8 kullanıcı açıldı, matris Kat hizmetleri rolünden kontrol yetkisini aldı (şef Müdür rolü aldı). 2. gün: SMTP ve Netgsm girildi, test gönderildi; 12 şablon Türkçe / İngilizce gözden geçirildi; AI anahtarı henüz yok, ajanlar listede "kurulu değil"; restoran menüsü ve 1 depo tanımlandı; 1.800 misafir Excel'den yüklendi (38 mevcut atlandı). 2. gün gece 23:40 ilk gün kapanışı: gelmeyen yok, 0 içeride (henüz misafir yok), kasa sıfır. 3. gün sabah ilk gerçek rezervasyon açıldı ve oda aktörü ilk odayı atadı.

## Günlük iş akışı kısa özeti

Sistemin tipik bir gününü bilmek, ekranları nereye yerleştireceğinizi kolaylaştırır:

1. **Sabah:** Panel'de doluluk, gelecekler, hazır oda sayısı ve bekleyen işler. Kat hizmeti görev panosunda günün temizlikleri (konaklayan odaların görevleri iş günü dönünce kendiliğinden açılmıştır).
2. **Gün içi:** Resepsiyon rezervasyon açar (oda aktörü atar), misafir girişi yapar (folyo aktörü hesabı açar, bildirim aktörü hoş geldiniz mesajını kuyruğa yazar), ödeme alır. Restoran adisyon kapatır (folyo aktörü odaya yazar, stok aktörü malzemeyi düşer). Misafir WhatsApp'tan yazar (AI ya da personel cevaplar).
3. **Gün boyu arka planda:** Zamanlanmış işler bildirimleri gönderir, geciken istekleri işaretler, kanallara müsaitliği iter, fiyat önerilerini üretir (6 saatte bir), süresi dolan onayları düşürür.
4. **Gece:** Gece görevlisi gün kapanışını yapar: gelmeyenler düşer, oda ücretleri basılır, kasa sayılır, fark raporlanır, iş günü ilerler.

**Örnek: Elif'in bir vardiyası (08:00–16:00).**

| Saat | Elif ne yaptı | Sistem arka planda ne yaptı |
| --- | --- | --- |
| 08:05 | Giriş yaptı; Panel'e baktı: 14 gelecek, 9 gidecek, 3 hazır boş oda | Konaklayan temizliği işi 06:10'da günün görevlerini açmıştı |
| 08:30 | Gidecekler listesinden 3 çıkış yaptı; birinde bakiye 320 TL açıktı, misafir kartla ödedi | Oda aktörü odaları "boş · kirli", kat hizmeti aktörü çıkış temizliği görevi, folyo aktörü folyoyu kapattı ve fatura taslağı açtı, bildirim aktörü "Teşekkür" SMS'i, muhasebe aktörü kart tahsilatını banka hesabına yazdı |
| 09:40 | Telefonla 2 rezervasyon açtı | Oda aktörü oda atadı, bildirim aktörü onay SMS'i, kanal aktörü OTA müsaitliğini düşürdü |
| 10:15 | Zilde "Kanal rezervasyonu dikkat istiyor": Booking.com'dan gelen rezervasyonun oda tipi eşleşmemiş; Görevler'den görevi üstlendi, müdüre haber verdi | Kanal aktörü işi "Kanal rezervasyonu" görevine düşürmüştü |
| 11:20 | 418 "klima arızalı" isteği: üstlendi, teknik servise bilet açtı, misafiri 420'ye taşıdı | Teknisyenin zili çaldı; oda planı diğer bilgisayarlarda anında güncellendi |
| 12:00 | Mesajlar'da WhatsApp'tan gelen "havuz saat kaçta açılıyor?" sorusunu AI'ın cevapladığını gördü; bir şikâyet mesajı "AI devretti" etiketiyle ona düşmüştü, cevapladı | Niyet ajanı şikâyeti modelsiz devretti, zile "AI konuşmayı devretti" |
| 13:30 | 6 giriş yaptı; birinde 1.000 TL nakit teminat aldı | Folyo aktörü teminatı ödeme olarak işledi, oda aktörü odaları dolu yaptı, "Hoş geldiniz" SMS'leri gitti |
| 14:10 | 1.250 TL iade isteği açtı (misafir erken ayrıldı) | Onay kuyruğuna "Para iadesi" düştü; müdürün zili çaldı; Elif kendi isteğini onaylayamaz |
| 15:45 | Kasa → Günlük kasa'da vardiyasının toplamını kontrol etti, Murat'a devretti | Günün kasa sayımı gece kapanışında yapılacak |

## Sık sorulanlar

**Menüde bir ekranı göremiyorum.**
Rolünüzün o ekrana izni yok. Yöneticiniz Ayarlar → Roller & İzinler'den rolünüze izni ekleyebilir ya da size farklı bir rol verebilir. Değişiklikten sonra çıkıp yeniden girin; izinler oturumla gelir.

**"Yetkiniz yok" (403) aldım ama menüde ekran görünüyor.**
Ekranı görmek ile içindeki bir işlemi yapmak farklı izinlerdir (ör. "Folyoları görüntüle" ile "İndirim uygula"). Düğme izniniz yoksa normalde gizlidir; görünüyorsa sayfayı yenileyin — izinleriniz az önce değişmiş olabilir.

**Kaydederken "başkası tarafından değiştirildi" hatası alıyorum.**
Aynı kaydı sizden önce biri kaydetti. Sayfayı yenileyin, güncel değere bakın, değişikliğinizi yeniden yapın. Verisi kaybolan kimse yoktur.

**Saat gece yarısını geçti ama sistem hâlâ dünü "bugün" sayıyor.**
Gün kapanışı yapılmamış. Gece görevlisi `/gun-kapanis` sihirbazını tamamlayınca iş günü ilerler. Bu bilinçli bir tasarımdır: raporlar ve oda ücretleri otelin gününe göre işler, duvar saatine göre değil.

**Zilde "Personele bırakılan iş" uyarısı çıkıyor. Ne yapmalıyım?**
Bir aktör işi yapamadı ya da kapalı. Uyarıya tıklayın; sizi Görevler ekranındaki göreve götürür. Görevi üstlenin, işi ilgili ekranda elle yapın, görevi tamamlayın.

**Misafire bildirim gitmedi.**
Bildirimler → Gönderim geçmişi'nde kaydı bulun; durum ve hata sebebi yazar. Kanal ayarı eksikse (SMTP parolası, Netgsm başlığı) Kanallar sekmesinden düzeltip test gönderin; bildirimi "tekrar gönder" ile yeniden kuyruğa alın. Misafir kartında o kanal için "bildirim istemiyor" işaretliyse satır "gönderilmedi" kalır.

**WhatsApp'tan gelen mesaja AI cevap vermedi.**
Sunucuda model anahtarı (`OPENAI_API_KEY`) yoksa, AI ayarlardan kapalıysa, günlük bütçe dolmuşsa ya da ajan aktör panelinden kapatılmışsa konuşma personel modunda açılır; Mesajlar ekranından siz cevaplarsınız. Durumu Ayarlar → AI asistanı ve Aktörler ekranı gösterir.

**Fiyatlar kendi kendine değişir mi?**
Hayır. Dinamik fiyat (kural tabanlı iş de AI ajanı da) yalnızca **öneri** üretir; her öneri onay kuyruğuna düşer. Onaylanan çarpan 0,5 ile 3 arasında sınırlıdır; hiçbir onay fiyatı yarıya düşüremez ya da üç katına çıkaramaz.

**Demo veriyi silip temiz başlayabilir miyim?**
Evet; veritabanını yeniden kurup `db:migrate` çalıştırın, `db:seed` çalıştırmayın. Şablonlar için seed gerekir; bunun yerine şablonları Bildirimler → Şablonlar'dan elle de yazabilirsiniz. Canlıda `prisma db push` **asla** kullanılmaz; yalnızca migration.

**Sistem birden fazla oteli yönetebilir mi?**
Veri modeli otel kapsamlıdır (her kayıt bir otele bağlı) ancak zincir konsolu / çoklu otel ekranı henüz yoktur (yol haritasında modül 63). Bugün her kullanıcı tek otele bağlıdır.

**Telefonda çalışır mı?**
Panel duyarlı tasarımdır; menü çekmece olur, tablolar ve grafikler daralır. Ayrı bir mobil uygulama (PWA, anlık bildirim) FlexAI 2.0 yol haritasındadır; henüz yoktur.

**"Oturum açmanız gerekiyor" diyor ama az önce giriş yapmıştım.**
Hesabınız pasife alınmış ya da yenileme anahtarınız iptal edilmiş olabilir (başka cihazdan çıkış yapılmaz, her cihaz ayrıdır). Yeniden giriş yapın; olmazsa yöneticinize hesabınızın aktif olduğunu sorun.

**Kendi şifremi nasıl değiştiririm?**
Bugün kullanıcı kendi şifresini değiştiremez; Ayarlar → Kullanıcılar'da yönetici "Şifre sıfırla" yapar. Kendi şifre değiştirme ve 2FA, güvenlik modülü (yol haritası 71) ile gelecektir.

**Bir oda tipini sildim ama kodunu yeniden kullanamıyorum.**
Kullanabilirsiniz: silinen kaydın kodu serbesttir. "Bu kodlu bir oda tipi zaten var." alıyorsanız aynı kodla **silinmemiş** bir tip var; listeyi süzgeçsiz kontrol edin.

**Rezervasyon açarken "Bu oda seçilen gecelerde başka bir rezervasyona ait" aldım; müsaitlikte boş görünüyordu.**
İki kişi aynı anda aynı odayı seçti; envanter kilidi ikinciyi durdurdu. Oda atamasını boş bırakın; oda aktörü uygun odayı kendisi seçer ya da listeden başka oda seçin.

**Para birimini değiştirmek istiyorum ama alan kilitli.**
İlk rezervasyon ya da folyo oluştuktan sonra para birimi değişmez; kayıtlı tutarlar anlamsızlaşırdı. Yeni para birimi gerekiyorsa yeni otel kaydı açılır.

**Sistemi başkasına 2 dakikada nasıl anlatırım?**
"Otelin bütün işi tek panelde. Önemli her şey bir olay bırakır; arka planda aktörler bu olayları dinleyip işi kendileri yapar — oda atar, hesabı tutar, mesaj gönderir, stoğu düşer. Aktörü kapatırsan iş kaybolmaz, personele görev düşer. Riskli para işleri ve fiyat değişiklikleri onay bekler. Her şeyin izi var. Yapay zekâ varsa misafirle konuşur ve rapor hazırlar; yoksa sistem yine eksiksiz çalışır."
