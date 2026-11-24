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

## Giriş yapmak

1. Tarayıcıda otelinizin FlexHotel adresini açın. Geliştirme ortamında bu `http://localhost:5173` adresidir.
2. **E-posta** ve **Şifre** alanlarını doldurun. Göz simgesi şifreyi gösterir / gizler.
3. **Giriş** düğmesine basın. Hatalı bilgide "Giriş yapılamadı" ya da sunucunun verdiği açıklama görünür.

Giriş yaptığınızda sistem size bir **oturum anahtarı** (JWT) verir; panel bu anahtarla konuşur ve süresi dolunca kendiliğinden yeniler (refresh). Oturum, **hangi otelde** çalıştığınızı ve **hangi izinlere** sahip olduğunuzu taşır. Menüde görmediğiniz bir şey, yetkinizin olmadığı bir şeydir; adresi elle yazsanız da sunucu reddeder ("yetkiniz yok", 403). Menünün gizlemesi görsel bir kolaylıktır; **gerçek yetki kontrolü sunucudadır**.

Çıkış için sağ üstteki kullanıcı menüsünü kullanın. Şifrenizi unuttuysanız, kullanıcı yönetimi yetkisi olan biri (yönetici) Ayarlar → Kullanıcılar'dan **şifre sıfırlar**; sistemde kendi kendine "şifremi unuttum" akışı henüz yoktur.

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
| **Muhasebe** | Günlük durum (gelir içerir), folyo düzeltme ve indirim, tahsilat, iade isteme, kasa ve döviz kuru, minibar / çamaşır fiyat listeleri, gelir raporları ve rapor asistanı, bütçe hazırlama ve gerçekleşen gider girişi, acente carisi ve prim ödeme işareti, promosyon kullanım raporu, etkinlik tahsilatı, POS raporları, spa geliri, reçete maliyeti, satın alma ve stok izleme, ön muhasebe (cari, kasa / banka, çek / senet, fiş), faturalar ve e-belge, personel ve bordro (ücret, puantaj, hesaplama, ödeme), demirbaş ve amortisman. Onay kuyruğunu görür. | Onayları karara bağlama, kontrat / promosyon / kanal düzenleme, kasa-banka tanımı ve fiş iptali (müdürün), bordro yasal parametre teyidi (yöneticinin), rezervasyon ve giriş / çıkış işlemleri. |
| **Yiyecek & İçecek** | POS: vardiya aç / kapat, adisyon, sipariş, ödeme, odaya yazma; mutfak ekranı; etkinlik programını ve menüsünü görme; misafir istekleri; restoranda unutulan eşyayı kaydetme; reçeteleri okuma; satın alma talebi açma ve mal kabul; stok görüntüleme. | İkram / indirim / gönderilmiş kalemi iptal (şef garson yetkisi — otel matristen açabilir), menü ve fiyat tanımları, reçete düzenleme (otel şef için açabilir), tedarikçi seçimi ve sipariş. |

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
| Ön muhasebe | `/muhasebe` | Cariler, kasa / banka, çek / senet, fişler. |
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

## Ortak ekran kalıpları

Sistemdeki ekranlar aynı birkaç kalıpla kurulmuştur. Bir kalıbı öğrendiğinizde bütün modüllerde tanırsınız.

### Liste + süzgeç + sayfalama

Çoğu ekran bir listedir. Üstte süzgeç çubuğu (durum, tarih, arama…), altta kayıtlar vardır. Listeler **imleçli** çalışır: "daha fazla" dediğinizde bir sonraki sayfa yüklenir; sayfa numarası yoktur çünkü canlı değişen listede numara kayar. Süzgeçler çoğu ekranda **adres çubuğuna yazılır**; adresi kopyalayıp bir arkadaşınıza gönderirseniz aynı süzgeçle açılır. Arama kutuları en az birkaç karakter ister ve Türkçe karakter farklarını (ı / i gibi) tolere eder.

### Sekmeler

Bölüm sayfaları (Odalar, Ayarlar, Raporlar, Onaylar…) alt sayfalarını üstte sekme olarak gösterir. Sekmeler, yan menüdeki alt maddelerle aynı listeden beslenir; yetkiniz olmayan sekme görünmez.

### Formlar ve doğrulama

Formlar kaydetmeden önce tarayıcıda, kaydederken de sunucuda **aynı kurallarla** doğrulanır. Hatalı alan kırmızı olur ve altında Türkçe açıklama çıkar ("Şifre en az 8 karakter olmalı", "Check-out saati check-in saatinden önce olmalı"). Para ve oran alanları iki ondalıklı yazılır ("1250.00"); tarihler takvimden seçilir.

### Sürüm damgası: "başkası değiştirdi"

İki kişi aynı kaydı aynı anda açıp düzenleyebilir. İkinci kişi kaydettiğinde sistem şu uyarıyı verir:

> Bu kayıt siz düzenlerken başkası tarafından değiştirildi. Sayfayı yenileyip tekrar deneyin.

Bu bir hata değil, korumadır: ilk kaydeden kişinin değişikliği **ezilmez**. Sayfayı yenileyin, güncel değeri görün, gerekiyorsa değişikliğinizi yeniden yapın. Teknik olarak her kayıt bir sürüm damgası (son güncelleme zamanı) taşır; form bunu okuduğu hâliyle geri gönderir; eşleşmiyorsa kayıt reddedilir. Arka planda çalışan zamanlanmış işler (ör. spa hatırlatması, gecikme uyarısı) bu damgaya **dokunmaz**; yani ekranı açık tutan personel sırf sistem bir alanı işaretledi diye "başkası değiştirdi" almaz.

### Canlı tazeleme

Ekranlar kendiliğinden yenilenir. Bir rezervasyon açılınca oda planı, bir ödeme alınınca kasa, bir onay düşünce onay sayacı tazelenir. Mekanizma şöyledir: sunucu, panellere **"şu otelde şu değişti"** haberini socket kanalıyla gönderir (veriyi değil, yalnızca haberi); ekran kendi sorgusunu yeniden çalıştırır. Haber yalnızca o ekranı açık tutan panellere gider, bu yüzden 2500 odalı bir otelde bile trafik şişmez. Bağlantı koptuğunda ekranlar birkaç dakikada bir kendi kendine yeniler; bağlantı gelince kaldığı yerden devam eder.

### Zil ve uyarılar

Sağ üstteki **zil** size yönelik uyarıları toplar. Bir uyarı ya **bir kişiye** (ör. istediğiniz onayın sonucu, size atanan istek) ya da **bir izne** (ör. "onay bekleyen iş" onaylayabilen herkese; "personele bırakılan iş" o modülde yetkili herkese) gider. Uyarı türleri arasında şunlar vardır: yeni misafir mesajı, acil misafir isteği, geciken misafir isteği, personele bırakılan iş, misafire ulaşamayan bildirim, onay bekleyen iş, bekleme listesinde yer açıldı, bakiyesi kapanmadan çıkış, AI konuşmayı devretti, AI bütçesi doldu, kanal rezervasyonu dikkat istiyor, kanal senkronu başarısız, banket opsiyon / depozito, POS uzun vardiya / unutulmuş adisyon, fatura gönderilemedi, online check-in inceleme bekliyor, ankette düşük puan, spa, arıza, satış takibi, demirbaş garanti bitişi, stok minimum altı.

Uyarıya tıkladığınızda ilgili ekrana gidersiniz (ör. göreve, onaya, konuşmaya). Zil tercihlerinden istemediğiniz türleri susturabilirsiniz. Uyarılar 30 gün saklanır; zil bir iş listesi değildir — işin kendisi ilgili ekranda durur. Aynı konu için tekrar tekrar uyarı üretilmez (aynı onay, aynı görev tek uyarıda birleşir).

### Manuel görevler

Bir aktör kapalıysa, hata verdiyse ya da bir işi yapamadıysa (eşleşmeyen oda tipi, bütçesi dolan AI, cevaplanamayan rapor sorusu) iş **Görevler** ekranına (`/gorevler`) düşer. Görev okunur bir başlık taşır ("DEMO-0001 için oda ata", "Gelen kanal rezervasyonunu işle"), hangi aktörün neden bırakamadığını, orijinal olayı ve bağlı kayıtlara (rezervasyon, konuşma, onay) bağlantı içerir. Görevi **üstlenir**, işi ilgili ekranda yaparsınız, sonra görevi **tamamlarsınız** (notla) ya da **"gerek kalmadı"** dersiniz (gerekçe zorunlu). Ayrıntı "Yönetim ekranları" bölümünde.

### Onay kuyruğu

Riskli bir iş onay istediğinde yetkililerin ziline "Onay bekliyor" düşer ve yan menüde **Onaylar** rozeti artar. Onay, varsayılan olarak **bir gün** bekler; kimse karar vermezse süresi dolar ve iş yapılmaz (uyarı düşer). Onaylanınca isteyen aktör kaldığı yerden devam eder; reddedilince iş yapılmaz ve bir daha ele alınmaz.

### Denetim izi

Sistemdeki her değişiklik (kim, ne zaman, hangi kayıt, eski ve yeni değer) **değişiklikle aynı işlemde** kaydedilir; "değişti ama izi yok" durumu teknik olarak imkânsızdır. Denetim kaydını `/aktivite/denetim` ekranından yetkili kişiler görür. Aktörlerin yaptığı işler ise **aktivite akışına** yazılır (hangi olay, hangi aktör, ne kadar sürdü, sonuç). Bir rezervasyonun bütün hikâyesini ("İşlem zinciri") tek tıkla görebilirsiniz.

### İş günü

Otelin "bugün"ü takvimden değil **gün kapanışından** okunur. Gece görevlisi günü kapatmadan iş günü ilerlemez; oda ücretleri, raporlar, "bugün gelecekler" hep bu güne göre çalışır. Gece yarısını geçtiğinizde ekranlar hâlâ "dünü" gösterirse bunun sebebi günün kapatılmamış olmasıdır — bu bir hata değil, tasarımdır. Ayrıntı "Arka planda ne oluyor" ve "Yönetim ekranları → Gün kapanış" bölümlerinde.

### Para ve vergi

Bütün tutarlar otelin **tek para biriminde** tutulur. Döviz ödemeleri günlük kurla çevrilir (Kasa → Döviz kurları). Vergiler ayarda "fiyata dahil" ya da "hariç" olarak tanımlanır; raporlardaki gelir, ADR ve RevPAR **vergiler hariç** hesaplanır. Rezervasyon ve folyo kalemlerindeki vergi dökümü aynı formülü kullanır; iki ekran arasında fark görmezsiniz.

## İlk kurulum sırası

Yeni bir oteli sisteme almak için aşağıdaki sırayı izleyin. Sıra önemlidir çünkü her adım bir öncekine yaslanır (oda, oda tipine; fiyat planı, oda tipi ve sezona; rezervasyon, hepsine).

### 1. Otel bilgileri

**Ayarlar → Otel bilgileri** (`/ayarlar/otel`). Otel adı, adres, telefon, logo adresi (http/https), **para birimi**, **saat dilimi**, **check-in ve check-out saatleri**. Para birimi, ilk rezervasyon ya da folyo oluştuktan sonra **değiştirilemez**; baştan doğru seçin. Check-out saati check-in saatinden önce olmalıdır (ör. 14:00 giriş, 12:00 çıkış).

### 2. Genel parametreler

**Ayarlar → Genel parametreler** (`/ayarlar/genel`). İptal politikası (kaç gün önce, ceza yüzdesi — ikisi birlikte ya hep ya hiç), **varsayılan pansiyon** (RO / BB / HB / FB / AI / UAI), telefon ülke kodu (varsayılan 90). Rezervasyon formu ve AI asistanı varsayılan pansiyonu buradan okur.

### 3. Oda tipleri

**Ayarlar → Oda tipleri** (`/ayarlar/oda-tipleri`). Kod (ör. STD, DLX), ad, yetişkin / çocuk kapasitesi, taban fiyat, açıklama. Kapasite, gelecekte o tipte fazla kişili rezervasyon varken düşürülemez. Silinen kodu yeniden kullanabilirsiniz.

### 4. Vergiler

**Ayarlar → Vergiler** (`/ayarlar/vergiler`). Ad, oran, fiyata dahil mi, hangi kategoriye uygulanır (oda, restoran, minibar…). Fiyata dahil oda vergileri raporlarda gelirden ayrılır.

### 5. Sezonlar

**Ayarlar → Sezonlar** (`/ayarlar/sezonlar`). Ad, başlangıç, bitiş, **çarpan** (taban fiyat × çarpan). Sezonlar **çakışamaz**; bu kural veritabanı düzeyinde korunur. Fiyat planı tanımlamadığınız gecelerde fiyat = taban fiyat × sezon çarpanıdır.

### 6. Fiyat planları ve paketler (isteğe bağlı ama önerilir)

**Ayarlar → Fiyat planları** (`/ayarlar/fiyat-planlari`): oda tipi × pansiyon × tarih aralığı için sabit gecelik fiyat, dahil kişi sayısı, ek yetişkin ve çocuk ücreti, en az gece. Plan varsa sezon çarpanının **yerine geçer**. Aynı oda tipi ve pansiyonda yayındaki planlar çakışamaz.

**Ayarlar → Paketler** (`/ayarlar/paketler`): oda + ek hizmet (spa, transfer…) demeti, sabit gecelik fiyat. Paket seçilen rezervasyonda promosyon, acente ve elle fiyat uygulanmaz.

Fiyat önceliği: **elle girilen > acente kontratı > paket > fiyat planı > sezon × taban**. Dinamik fiyat çarpanı (onaylı) plan ve sezon fiyatını ölçekler; kontrat, paket ve elle fiyatı etkilemez.

### 7. Odalar

**Odalar → Oda listesi** (`/odalar/liste`). Oda numarası, kat, oda tipi, özellikler. Oda numarası benzersizdir (silinen numara yeniden kullanılabilir). Arızalı / hizmet dışı işaretleme sonradan teknik servisten yapılır.

### 8. Kullanıcılar ve roller

**Ayarlar → Kullanıcılar** (`/ayarlar/kullanicilar`): ad, e-posta, rol, aktif / pasif, şifre. **Ayarlar → Roller & İzinler** (`/ayarlar/roller`): gerekiyorsa varsayılan matrisi otelinize uyarlayın (ör. şef garsona ikram yetkisi, kat şefine kontrol yetkisi). Demo hesaplarını kapatın.

### 9. Bildirim kanalları ve şablonlar

**Bildirimler → Kanallar** (`/bildirimler/kanallar`): SMTP (e-posta) ve Netgsm (SMS) bilgileri, sessiz saatler, test gönderimi. Sunucuda `SETTINGS_SECRET_KEY` tanımlı olmalıdır; yoksa parola kaydedilemez ve ekran bunu söyler. **Bildirimler → Şablonlar** (`/bildirimler/sablonlar`): rezervasyon onayı, oda bilgisi, hoş geldiniz, teşekkür, online check-in daveti, anket, spa metinleri (Türkçe / İngilizce).

### 10. Mesaj kanalları ve AI (isteğe bağlı)

**Ayarlar → Mesaj kanalları** (`/ayarlar/mesaj-kanallari`): WhatsApp Cloud API bilgileri ve webhook adresi, web chat balonu ve gömme kodu. **Ayarlar → AI asistanı** (`/ayarlar/ai`): AI açık / kapalı, modeller, fiyatlar, günlük bütçe, AI'ın açtığı rezervasyonun kesin mi opsiyonlu mu olacağı, otel bilgisi metni. Sunucuda `OPENAI_API_KEY` yoksa ajanlar çalışmaz; ekran bunu uyarı olarak gösterir.

### 11. Aktörleri gözden geçirin

**Yönetim → Aktörler** (`/aktorler`). Varsayılan olarak bütün aktörler **açıktır**. Otel bir işi elle yürütmek istiyorsa (ör. oda atamasını resepsiyon kendisi yapsın) ilgili aktörü kapatır; işler Görevler'e düşer.

### 12. Departman tanımları

Sırası otelin ihtiyacına göre: restoran satış noktaları, masalar ve menü (**Restoran → Menü ve tanımlar**), depolar (**Stok → Depolar**), reçete ve malzeme kartları (**Mutfak**), tedarikçiler (**Satın alma → Tedarikçiler**), banket salonları ve fiyatları (**Etkinlikler**), spa hizmetleri ve terapistler (**Spa**), demirbaş kategorileri (**Demirbaş → Tanımlar**), kasa / banka tanımları ve yöntem eşlemesi (**Ön muhasebe**), fatura ayarları (**Faturalar**), bordro yasal parametreleri (**Bordro → Ayarlar**), misafir portalı ve anket ayarları.

### 13. Mevcut veriyi taşıyın

**Yönetim → Excel'den yükle** (`/ice-aktar`): misafir listesi ve fiyat planı Excel'den toplu yüklenir. Demirbaş kartları kendi ekranından Excel ile yüklenir. Açık rezervasyonlar şimdilik elle açılır (başka PMS'ten tam göç sihirbazı FlexAI 2.0 yol haritasındadır; henüz yoktur).

### 14. İlk gün kapanışı

İlk günün sonunda **Gün kapanış** (`/gun-kapanis`) sihirbazını çalıştırın. Kapanış yapılmadıkça iş günü ilerlemez ve ertesi günün oda ücretleri basılmaz.

## Günlük iş akışı kısa özeti

Sistemin tipik bir gününü bilmek, ekranları nereye yerleştireceğinizi kolaylaştırır:

1. **Sabah:** Panel'de doluluk, gelecekler, hazır oda sayısı ve bekleyen işler. Kat hizmeti görev panosunda günün temizlikleri (konaklayan odaların görevleri iş günü dönünce kendiliğinden açılmıştır).
2. **Gün içi:** Resepsiyon rezervasyon açar (oda aktörü atar), misafir girişi yapar (folyo aktörü hesabı açar, bildirim aktörü hoş geldiniz mesajını kuyruğa yazar), ödeme alır. Restoran adisyon kapatır (folyo aktörü odaya yazar, stok aktörü malzemeyi düşer). Misafir WhatsApp'tan yazar (AI ya da personel cevaplar).
3. **Gün boyu arka planda:** Zamanlanmış işler bildirimleri gönderir, geciken istekleri işaretler, kanallara müsaitliği iter, fiyat önerilerini üretir (6 saatte bir), süresi dolan onayları düşürür.
4. **Gece:** Gece görevlisi gün kapanışını yapar: gelmeyenler düşer, oda ücretleri basılır, kasa sayılır, fark raporlanır, iş günü ilerler.

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
