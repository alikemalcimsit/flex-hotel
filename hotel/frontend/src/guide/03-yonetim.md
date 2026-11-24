# Yönetim ekranları

Bu bölüm sol menünün **Yönetim** grubundaki ekranları ve onlarla birlikte düşünülmesi gereken üç ekranı (Görevler, Raporlar, Gün kapanış) anlatır. Her ekran aynı düzende verilir: nerede bulunur (menü yolu ve adres), ne yapar, adım adım nasıl kullanılır, arka planda ne olur, dikkat edilecekler. Her alt bölümde somut bir örnek vardır.

Yönetim ekranları çoğunlukla yöneticinin ve müdürün işidir; ama Görevler herkese (kendi modülü kadar), Bildirimler → Gönderim geçmişi ön büroya, Gün kapanış gece vardiyasına da açıktır.

## Görevler (manuel görevler)

**Nerede:** Genel → Görevler, adres `/gorevler`. Yan menüde açık görev sayısı rozet olarak görünür. Zildeki "Personele bırakılan iş" uyarısı doğrudan göreve götürür (`/gorevler?gorev=<kimlik>`).

**Kim görür:** Herkes, **kendi modülünün** görevlerini. Görevin modülü, görevi düşüren aktörün bildirgesinden gelir ve her modül bir izne eşlenir:

| Görev modülü | Kim görür ve kapatır | Hangi aktörden düşer |
| --- | --- | --- |
| Oda atama | Oda işlemleri yetkisi (ön büro, kat hizmetleri, müdür) | Oda aktörü |
| Rezervasyon | Rezervasyon yönetimi | Rezervasyon aktörü |
| Kanal rezervasyonu | Rezervasyon yönetimi | Kanal aktörü |
| Folyo | Folyoya harcama işleme | Folyo aktörü |
| Kat hizmeti | Temizlik görevi başlat / bitir | Kat hizmeti aktörü |
| Misafir mesajları | Mesaj yazma | Niyet ajanı, concierge ajanı, WhatsApp / web chat geçitleri |
| Bildirim merkezi | Bildirim ayarlarını yönet | Bildirim aktörü |
| Onay kuyruğu | Onayla / reddet | Aktörü kayıttan kalkmış onaylanan işler |
| Ön muhasebe | Muhasebe fişi girme | Muhasebe aktörü |
| Stok | Depo ve stok yönetimi | Stok aktörü |
| Rapor talebi | Gelir raporlarını görüntüle | Rapor ajanı |
| Teknik servis | Oda işlemleri | Kat hizmeti "sorun var" bildirimi |
| Listede olmayan modül (Bütçe, Anket, Fiyatlandırma…) | Ayarları yönet (yönetici) | Bütçe, geri bildirim, fiyat ajanları |

### Ekran

Üstte üç özet kutusu: **Açık görev** (tamamlanmayı bekleyen), **Kimse üstlenmedi** (üstlenilmeyi bekleyen; kırmızı), **En eski görev** (ne zamandır bekliyor). Süzgeçler: **Görünüm** (Açık — en eski önce / Kapanan — en yeni kapanan önce), **Modül**, ve aktör paneli üzerinden gelindiyse **aktör** süzgeci. Her satır: başlık, modül, aktör, durum (Bekliyor / Üstlenildi / Tamamlandı / Gerek kalmadı), açılış zamanı, üstlenen.

### Adım adım

1. Görevi tıklayın. Pencerede **Açıldı**, **Aktör**, **Olay** (Türkçe adı ve teknik adı), **Üstlenildi**, aktörün işi neden yapamadığı ("room-worker bu işi yapamadı: Aktör kapalı"), bağlı kayıtlara bağlantılar (rezervasyon, konuşma, istek, onay) ve **Olayın gövdesi** (işi yapmak için gereken bilgiler — burada kişisel veri **maskesiz** gelir, çünkü işi yapacak kişi misafirin telefonuna ihtiyaç duyar ve zaten o modülün yetkisine sahiptir).
2. **Üstlen** deyin. Görev size atanır; başkası üstlenemez (iş aciliyse yine tamamlayabilir, izde tamamlayan yazar). Üstlendiğiniz görevi yalnızca siz **bırakabilirsiniz**.
3. İşi ilgili ekranda yapın (ör. rezervasyon detayında odayı seçin).
4. Göreve dönüp **Tamamla** deyin; not isteğe bağlı ("204 numaralı oda atandı").
5. İş gereksiz kaldıysa (rezervasyon iptal oldu) **Gerek kalmadı** deyin; gerekçe **zorunludur**, çünkü iş yapılmadan kapanıyor.

Her işlem satırı kilitler: iki kişi aynı görevi üstlenemez; ikinci "tamamla" diyen "Bu görev zaten kapatılmış" alır. Kapanmış görev yeniden açılmaz (veritabanı kısıtı).

### Arka planda

Görev, aktör işi bırakırken **aynı işlemde** zile uyarıyla birlikte yazılır: görev varsa uyarı da vardır. Görev açıldığında ve her durum değişikliğinde olay yayınlanır; liste canlı kanaldan tazelenir. Görev, işi düşüren aktörü ve olayın zincir kimliğini taşır: aktör paneli "bu aktörün düşürdüğü işler"i, zincir görünümü "bu olayın hikâyesi"ni buradan bulur.

**Örnek:** Yönetici pazartesi oda aktörünü kapattı. 11:20'de web motorundan 3 gecelik rezervasyon geldi. Görevler'e "Rezervasyona oda atanacak" düştü; resepsiyonist Elif'in zili çaldı (oda işlemleri yetkisi var). Elif görevi üstlendi, rezervasyon detayında 312'yi atadı, göreve "312 atandı, misafir yüksek kat istemişti" notuyla tamamladı. Zincir görünümünde: rezervasyon oluşturuldu → oda aktörü (kapalı, iş personele düştü) → görev → Elif'in oda ataması.

### Dikkat

- Görev listesi iş listesi değil, **istisna** listesidir. Normal çalışan sistemde boş olmalıdır. Sürekli dolu kalıyorsa ya bir aktör kapalıdır ya da bir tanım eksiktir (ör. muhasebe yöntem eşlemesi).
- "Gerek kalmadı" demek işi yapmaz; emin değilseniz görevi tamamlamadan önce ilgili kaydı kontrol edin.

## Onaylar

**Nerede:** Yönetim → Onaylar; **Bekleyen** `/onaylar/bekleyen`, **Geçmiş** `/onaylar/gecmis`. Üst barda bekleyen sayacı (süresi yaklaşan varsa kırmızı), yan menüde rozet. Zildeki "Onay bekliyor" uyarısı doğrudan onaya götürür (`?onay=<kimlik>`).

**Kim görür:** Onay kuyruğunu görüntüleme izni (yönetici, müdür, muhasebe). **Karar** için onayla / reddet izni (varsayılan yönetici ve müdür).

### Bekleyen sekmesi

Üç özet kutusu: **Bekleyen**, **Süresi yaklaşan** (1 saatten az kalmış), **En uzun bekleyen**. Liste en uzun bekleyen üstte; her satırda tür, özet, isteyen (aktör ya da kişi), tutar ve **akan kalan süre**. Süzgeçler: tür, arama. Satırdan tek tıkla onaylanır / reddedilir; detay ve karar aynı penceredir.

### Detay penceresi

Alanlar: **Tutar**, **İsteyen** ("billing-worker (aktör)" ya da kişinin e-postası), **İstendi**, **Son karar anı** (ya da "Süresiz"), **İlgili kayıt** (folyo, rezervasyon, adisyon… bağlantılı), **Onaylanınca devam edecek** (aktör isteğiyse hangi aktörün hangi olayla süreceği), isteyenin **gerekçesi** ve **verisi** (ekranda gösterilir, yorumlanmaz). Karar verilmişse **Karar** (kim, ne zaman, not).

### Karar vermek

1. Satırı açın, gerekçeyi ve ilgili kaydı inceleyin (bağlantıdan folyoya gidip dönebilirsiniz).
2. **Onayla** — not isteğe bağlı. Dört göz kuralına giren türde kendi isteğinizse düğme kilitlidir; üzerine gelince sebebi yazar: "Kendi isteğinizi onaylayamazsınız; başka bir yetkili onaylamalı (reddederek geri çekebilirsiniz)".
3. **Reddet** — gerekçe **zorunlu**. İş yapılmaz; isteyen aktör için olay kapanır, isteyen kişinin ziline "İstediğim onayın sonucu" düşer.
4. Süresi dolmuş onayda "Süresi dolmuş" uyarısı görünür ve karar verilemez; o anda düşürülür.

### Onay türleri

| Tür | Ne zaman açılır | Süre dolunca |
| --- | --- | --- |
| Para iadesi | Folyoya iade istendi | İade yapılmaz |
| Büyük ödeme | Tahsilat, Genel parametreler → "Büyük ödeme eşiği"ni aştı | Ödeme işlenmez |
| Ödeme iptali | Hatalı ödeme iptali istendi | Ödeme kalır |
| Folyo kalemi iptali | Folyo kaleminin iptali istendi | Kalem kalır |
| Toplu fiyat değişimi | Dinamik fiyat önerisi üretildi | Öneri "süresi doldu" olur, fiyat değişmez |
| Kapasite aşımı | Yer yokken rezervasyon, politika "Onaya gönder" | Rezervasyon açılmaz |
| Acente prim hak edişi | Dönem hak edişi onaya gönderildi | Hak ediş onaysız kalır, yeniden gönderilir |
| Etkinlik ödemesi | Büyük etkinlik ödemesi / iade / iptal | İşlenmez |
| Adisyon düzeltmesi | İkram, indirim, gönderilmiş kalem iptali | Uygulanmaz |
| Restoran ödemesi | Büyük ödeme, hatalı giriş iptali | İşlenmez |
| Spa ödemesi | Büyük ödeme, iade, hatalı giriş iptali | İşlenmez |
| Satın alma siparişi | Eşik üstü tutarlı kazanan teklif | Sipariş açılmaz |
| Ödeme fişi | Ön muhasebe eşiği üstü ödeme fişi | Fiş işlenmez |
| Fatura iptali | Kesilmiş fatura iptali istendi | Fatura kalır |
| Bordro onayı | Bordro hesaplanıp onaya gönderildi | Bordro taslak kalır |

Varsayılan bekleme süresi **1 gün**; isteyen 30 güne kadar verebilir ya da süresiz bırakabilir. Süresi dolan onay için zile "Süresi doldu, yapılmadı: …" uyarısı gider.

### Geçmiş sekmesi

Karara bağlanmış onaylar, yeni karar önce. Süzgeç: karar (Onaylandı / Reddedildi / Süresi doldu), tür, arama. Her satırda kararı veren ve notu.

### Arka planda

Karar satır kilidiyle yazılır (iki yönetici aynı anda karar veremez; ikinci "Bu onay zaten karara bağlanmış" alır). Onaylanan **aktör işi** aynı aktöre, aynı olayla, aynı zincirde devam ettirilir; aktör olarak onaylayan kişi yazılır. Onaylanan **servis işi** (iade, kalem iptali, adisyon düzeltmesi, sipariş…) ilgili modülün kendi dinleyicisiyle uygulanır. Açılış ve karar denetim izine düşer. Özet sayılar 30 saniye önbellekli, sayaç canlı haberle en sık 10 saniyede bir tazelenir.

**Örnek:** Satın alma müdürü Can, 48.000 TL'lik et siparişinde kazanan teklifi seçti; tutar eşiğin üstünde olduğu için "Satın alma siparişi" onayı açıldı. Genel müdür Selin'in zili çaldı. Selin teklif turunu bağlantıdan inceledi, "2. teklif %4 daha ucuz, teslimat süresi uzun; bu kabul" notuyla onayladı. Satın alma modülünün dinleyicisi siparişi açtı, tedarikçiye gidecek sipariş formu hazır oldu; Can'ın ziline sonuç düştü.

## Fiyat önerileri

**Nerede:** Yönetim → Fiyat önerileri, `/fiyat-onerileri`. Onay kuyruğu görüntüleme iznine açılır; düzenleme onayla / reddet izni ister.

**Ne yapar:** Dinamik fiyatın (modül 34) önerilerini onay kuyruğundan ayrı, fiyat bağlamıyla gösterir: dönem, oda tipi, mevcut fiyat, önerilen fiyat, çarpan, gerekçe metni ve **yapılandırılmış girdiler** (gün gün doluluk, satılabilir, satılan, kalan gün, geçen yıl). Kaynak rozeti: **Kural** ya da **AI**. Alt kısımda **fiyat geçmişi grafiği** uygulanmış çarpanları gösterir.

### Adım adım

1. Süzgeçle oda tipi / durumu seçin; bekleyen öneriyi açın.
2. Gerekçeyi ve girdi tablosunu okuyun ("20–22 Aralık doluluk %86, geçen yıl %71; +%10").
3. İsterseniz **Düzenle** ile çarpanı değiştirin (karar vermeden; taban öneriden türetilir, 0,5–3 aralığında).
4. **Onayla** ya da **Reddet**. Karar aslında onay kuyruğundaki "Toplu fiyat değişimi" onayına verilir; Onaylar ekranından da verilebilir.

### Arka planda

Onay verilince fiyatlandırma dinleyicisi geceye özel **çarpan katmanı** yazar (oda tipi × gece × çarpan; geceye tek ayar). Çarpan plan ve sezon fiyatını ölçekler; acente kontratı, paket ve elle fiyat etkilenmez. "Fiyat değişti" olayı yayınlanır; kanal aktörü OTA'lara yeni fiyatı iletir; yeni rezervasyonlar ve web motoru onaylı fiyattan satar. Ret sıfır yazım yapar.

Öneri üretimi 6 saatte bir çalışır (Ayarlar → Dinamik fiyat'ta kural tabanlı yield açıksa); çakışan bekleyen öneri ve "zaten aynı çarpan uygulanmış" dönem atlanır — kuyruk şişmez.

**Örnek:** Yılbaşı haftasında Deluxe doluluğu %88'e çıktı. Kural işi 29 Aralık–2 Ocak için tek birleştirilmiş öneri üretti: çarpan 1,10 (3.200 → 3.520 TL). Gelir yöneticisi girdilere baktı, çarpanı 1,15'e düzenledi ve onayladı. Beş gece için çarpan yazıldı; Booking.com'a 10 saniye içinde yeni fiyat gitti; o akşam web motorundan açılan rezervasyon 3.680 TL'den satıldı.

## Bildirimler

**Nerede:** Yönetim → Bildirimler; **Gönderim geçmişi** `/bildirimler/gecmis` (bildirim görüntüleme — ön büroda da var), **Şablonlar** `/bildirimler/sablonlar` ve **Kanallar** `/bildirimler/kanallar` (bildirim ayarlarını yönetme).

### Kanalların dürüst durumu

| Kanal | Durum | Nasıl çalışır |
| --- | --- | --- |
| **E-posta** | Gerçek | SMTP sunucusu (sunucu adı, port, güvenlik: SSL/TLS 465 / STARTTLS 587 / şifrelemesiz), kullanıcı, parola, gönderen adı ve adresi. Test gönderimi var. |
| **SMS** | Gerçek | Netgsm: kullanıcı, parola, onaylı başlık. Türkçe karakter ve parça sayısı şartnameye göre hesaplanır; teslim raporu 2 dakikada bir sorgulanır. Test gönderimi var. **Sessiz saatler** (ör. 22:00–08:00) ayarlanabilir; o arada sıraya giren SMS bitişte gider. |
| **WhatsApp** | Konuşma gerçek, **bildirim yok** | Misafire gelen mesaja cevap WhatsApp'tan gider (Mesajlar ekranı, Ayarlar → Mesaj kanalları). Otelin başlattığı şablonlu bildirim (rezervasyon onayı vb.) için Meta şablon onayı gerekir; **henüz bağlanmadı**. Şablon ekranında WhatsApp sütunu hazır bekler; kanal bağlanınca Kanallar'da açılabilir. |
| **Uygulama içi (zil)** | Gerçek | Personel uyarıları; şablonsuz, kanal ayarı gerekmez. |

Kanal parolaları şifreli saklanır; sunucuda `SETTINGS_SECRET_KEY` yoksa kaydedilemez ve ekran bunu söyler.

### Gönderim geçmişi

Üstte özet kutuları (sırada, gönderildi, teslim edildi, başarısız, iptal) **süzgeç olarak** çalışır. Liste canlıdır; süzgeçler: durum, kanal, olay (kaynak), arama. Detay: alıcı, kanal, **dondurulmuş tam metin** (şablon sonra değişse de giden metin görünür), denemeler ve hata kodları, sağlayıcı kaydı; **Tekrar gönder** (yeni kayıt açar, misafir kartındaki güncel adrese gider) ve **İptal** (yalnızca sıradaki bildirim; sebep zorunlu).

Durumlar: **Sırada** → **Gönderiliyor** → **Gönderildi** (sağlayıcı kabul etti) → **Teslim edildi** (SMS teslim raporu); ya da **Başarısız** / **İptal**. Geçici hatada 30 sn / 2 dk / 10 dk / 30 dk arayla en çok 5 deneme; kalıcı hatada (yanlış parola, onaysız başlık) hemen vazgeçilir ve yöneticinin ziline "Misafire ulaşamayan bildirim" düşer (aynı gün aynı hata tek uyarı).

Kaynaklar: Rezervasyon onayı, Oda bilgisi, Hoş geldiniz, Teşekkür, Online check-in daveti, Çıkış sonrası anket, Ara anket, Spa randevu onayı, Spa randevu hatırlatması, Kanal testi (test gönderimleri tekrar gönderilmez, zil açmaz, özete girmez).

### Şablonlar

Olay × kanal × dil (Türkçe / İngilizce) başına tek metin; e-postada ayrıca konu. Kurulumda 16 önerilen metin yüklenir. Editörde **değişken çipleri** ({misafirAdi}, {odaNo}, {tarih}, {portalLinki}, {anketLinki}…), örnek değerlerle **önizleme**, SMS için **karakter ve parça sayacı**, kaydedilmemiş değişiklik uyarısı. Her olayın altında ne zaman gönderildiğini anlatan ipucu vardır (ör. "Oda bilgisi: giriş günü ya da misafir içerideyken atanınca gönderilir; günler önceden yapılan atamada gönderilmez"). Şablon kapatılabilir (o kanal / dilde gönderilmez). İngilizce metin kapalıysa Türkçeye düşülür.

### Adım adım: SMS kanalını açmak

1. Netgsm'den kullanıcı adı, parola ve onaylı başlığı alın.
2. Bildirimler → Kanallar → SMS: bilgileri girin, "açık" yapın, gerekiyorsa sessiz saatleri yazın, **Kaydet**.
3. **Test gönder**: kendi numaranıza. Sonuç ve son hata kartta görünür.
4. Şablonlar sekmesinde "Rezervasyon onayı · SMS · Türkçe" metnini kontrol edin; parça sayacı 1–2 parça olmalı.
5. İlk gerçek rezervasyonda Gönderim geçmişi'nden "Gönderildi → Teslim edildi" akışını izleyin.

### Arka planda

Olay → bildirim aktörü metni **o anki şablondan** hazırlar ve kuyruğa yazar (aynı olay iki kez işlense de tek bildirim) → gönderici 15 saniyede bir (yeni bildirimde anında) kuyruğu üstlenir → sağlayıcı. Oda bilgisi için ek kural: olay geç işlendiyse ve oda yine değiştiyse eski oda gitmez. Dil misafirin uyruğundan: Türk ya da bilinmeyen → Türkçe, diğerleri → İngilizce. Misafir kartındaki "bildirim istemiyor" tercihi kanal bazında uygulanır; satır "gönderilmedi" kalır.

**Örnek:** Alman misafir Herr Müller'in rezervasyonu Booking.com'dan geldi. Kanal aktörü rezervasyonu açtı → bildirim aktörü uyruk DE olduğu için İngilizce "Reservation confirmation" e-postasını kuyruğa yazdı → gönderici SMTP'ye verdi; kart "Gönderildi" oldu. Gece 23:40'ta oda ataması yapıldı ama "Oda bilgisi" SMS'i gönderilmedi: giriş günü değil. Giriş günü sabah oda değişti; yeni oda numarasıyla SMS 10:00'da (sessiz saat bitişinde) gitti.

## Aktivite

**Nerede:** Yönetim → Aktivite; **Canlı akış** `/aktivite/akis`, **Olaylar** `/aktivite/olaylar` (aktivite görüntüleme izni: yönetici, müdür), **Denetim kaydı** `/aktivite/denetim` (denetim görüntüleme izni). Ayrıca zincir görünümü `/aktivite/zincir/:kimlik` ve kayıt geçmişi `/aktivite/kayit/:tür/:kimlik`. Süzgeçler adres çubuğunda; paylaşılabilir.

### Canlı akış

Aktörlerin işlediği her olay bir satırdır: zaman, aktör, olay (Türkçe adı ve teknik adı), mesaj ("Rezervasyona 204 atandı", "Aktör kapalı; iş personele düştü (Çıkış temizliği görevi açılacak)"), seviye (**Bilgi** / **Uyarı** / **Hata**), süre, ayrıntı (deneme sayısı, onay kimliği…). Süzgeçler: aktör, olay, seviye (**Sorunlar** = uyarı + hata), tarih. **Duraklat** okuduğunuz yeri korur, "N yeni" sayacı birikeni gösterir. Satırdan zincire geçilir.

Satır yazılınca sunucu 500 ms'de bir yalnızca kimlikleri yayınlar; panel içeriği aynı süzgeçle HTTP'den çeker. 200 kimliği aşan pakette liste baştan yüklenir.

### Olaylar

Yayınlanan bütün olaylar: zaman, ad, yayınlayan (kişi ya da aktör), zincirdeki derinlik, gövde (**kişisel veri maskeli**). Süzgeçler: olay adı, zincir kimliği, tarih, **"Yalnızca dağıtılmamış olaylar"**. Son süzgeç outbox'ta bekleyenleri gösterir; sağlıklı sistemde boştur; dolu kalıyorsa sunucu loglarına bakılmalıdır.

### Denetim kaydı

Kişilerin değişiklikleri: **Kişi** (e-posta ya da aktör), **Kayıt türü** (Rezervasyon, Oda tipi, Kullanıcı, Onay…), **İşlem** (oluşturma / güncelleme / silme), tarih. Her satırda eski → yeni değer ve değişen alan listesi (yalnızca denetim iznine). "Bu kişinin değişiklikleri" ve "bu kaydın geçmişi" kısa yolları. Eski ve yeni değerler kişisel veri alanlarında maskelidir.

### Zincir görünümü

Bir zincir kimliği seçince: tetikleyen istek / olay → onu işleyen aktörler (süreleriyle) → yazdıkları değişiklikler → yayınladıkları yeni olaylar → onları işleyen aktörler… ağaç olarak. Her kaynaktan en çok 500 adım; bozuk kayıtta döngü koruması. Rezervasyon detayındaki **İşlem zinciri** düğmesi buraya gelir.

**Örnek:** Müdür "misafire iki onay SMS'i gitti" şikâyetini araştırıyor. Rezervasyonun zincirine girer: "rezervasyon oluşturuldu" → bildirim aktörü tek bildirim kuyruğa yazmış. Gönderim geçmişinde ikinci SMS'in kaynağı "Tekrar gönder" — resepsiyonist elle göndermiş. Denetim kaydında kişi ve saat var. Sorun sistemde değil; eğitim notu düşülür.

### Dikkat

- Aktivite ve olay satırları için saklama süresi henüz yok (politika kararı bekliyor); denetim kaydı silinmez.
- Socket kimliği şimdilik istemcinin söylediği e-postadır; bu yüzden socket'ten içerik gönderilmez, yalnızca "yeni satır var" haberi.

## Aktörler paneli

**Nerede:** Yönetim → Aktörler, `/aktorler` (aktör panelini görüntüleme: yönetici, müdür); aç / kapat için aktörleri yönetme izni (varsayılan yalnızca yönetici). Detay `/aktorler/:ad`.

### Liste

Her aktör tek satır: Türkçe adı, tür (**Kural tabanlı** / **LLM ajanı**), paket, bu otelde **açık mı** (kim, ne zaman, hangi gerekçeyle değiştirdi), son 24 saatte iş / uyarı / hata, son iş, açık manuel görev sayısı, arka plan sırası (çalışan / bekleyen; bu sunucununki). Sunucuda **kurulu olmayan** aktör (model anahtarı yokken AI ajanları) yine listelenir, sebebiyle: "Sunucuda OPENAI_API_KEY tanımlı değil; ajan çalışmıyor (kural tabanlı yield çalışır)". Altta **"LLM ajanları — bugün"** kartı: otelin günlük bütçesi ve harcamanın oranı.

### Detay

- **Kapatırsam ne olur?** kartı: işler hangi manuel göreve düşer, bu aktörün yayınladığı olayları bekleyen diğer aktörler kimler (bildirgeden hesaplanır).
- **Dinlediği olaylar** (yanında kim yayınlıyor) ve **Yayınladığı olaylar** (yanında kim dinliyor), Türkçe adlarıyla.
- **Onay gerektiren işler**: aktörün kendi başına yapmadığı, kuyruğa götürdüğü işler.
- **Yeniden deneme politikası**: deneme sayısı, bekleme, "olmazsa … manuel görevi", arka plan sınırları (ya da "olayı yayınlayanla aynı anda").
- **Son işler** (10 satır, zincire bağlantılı).
- LLM ajanında **kullanım kartı**: model, otelin günlük bütçesi (ajanın payı koyu), bugünkü ve dönem maliyeti, çağrı başına ortalama, gün gün çubuk (varsayılan 14 gün), model kırılımı.

### Aç / kapat

1. Anahtara tıklayın. Kapatırken pencere açılır: "**Oda aktörü kapatılsın mı?**", altında **Kapatınca ne olur** uyarısı (hangi işler hangi göreve düşer) ve **Gerekçe (isteğe bağlı)**, en çok 300 karakter.
2. Onaylayın. Ayar kilitli yazılır; iki yönetici aynı anda kapatsa sonuç yine kapalı, ikinci istek iz bırakmaz.
3. Denetim izine ve aktivite akışına (uyarı satırı) düşer; "aktör ayarı değişti" olayı yayınlanır.
4. Aktör **bir sonraki olayda** durur (ayar her olayda veritabanından okunur, önbellek yok).

Açarken de gerekçe isteğe bağlıdır. Kanal aktörü açılınca kanallarda tam eşitleme ister.

### Ne zaman kapatılır

- Otel bir işi bilinçli olarak elle yürütmek istiyor ("odaları resepsiyon seçsin").
- Bir entegrasyon sorunlu ("Channex bakımda; kanal aktörünü kapat, açılınca tam eşitlesin").
- AI'ı geçici durdurmak ("hafta sonu misafirlere personel cevap versin": niyet ve concierge ajanlarını kapat).

**Örnek:** Muhasebe müdürü, yöntem eşlemeleri tanımlanmadan muhasebe aktörünün fiş yazmasını istemiyor. Yönetici aktörü "eşleme tanımlanıncaya kadar" gerekçesiyle kapattı. İki gün boyunca tahsilatlar "Ön muhasebe" görevi olarak biriktirildi, kayıt yazılmadı. Eşlemeler tanımlandı, aktör açıldı; muhasebeci Ön muhasebe → Eşitle ile iki günü tek seferde işledi; aynı kaynak anahtarı sayesinde hiçbir tahsilat iki kez yazılmadı.

### Dikkat

- Arka plan sırası süreç içidir; birden fazla sunucu çalışıyorsa panel isteğin düştüğü sunucununkini gösterir.
- Ajan başına ayrı bütçe yoktur; bütçe otel geneli USD'dir (Ayarlar → AI asistanı).

## Ayarlar

**Nerede:** Yönetim → Ayarlar, `/ayarlar`. Menüde **yalnızca Yönetici** görür. Alt sekmeler: Otel bilgileri, Oda tipleri, Vergiler, Sezonlar, Fiyat planları, Paketler, Dinamik fiyat, Genel parametreler, Kullanıcılar, Roller & İzinler, AI asistanı, Mesaj kanalları.

Bütün ayar formları sürüm damgalıdır ("başkası değiştirdi" koruması) ve her değişiklik denetim izine yazılır. Ayar değişikliği bir olay yayınlar; önbellekler (fiyat, sezon, oda tipi) o olayla tazelenir, kanal aktörü fiyat / envanter etkisi varsa senkron ister.

### Otel bilgileri (`/ayarlar/otel`)

Kart 1 **Otel bilgileri**: Otel adı, Kod (sonradan değiştirilemez), Telefon, E-posta, Adres, Logo adresi (URL; http/https). Faturada, onay e-postalarında ve misafire giden belgelerde görünür. Kart 2 **Operasyon**: para birimi, saat dilimi, check-in ve check-out saati. **Para birimi, rezervasyon ya da folyo oluştuktan sonra değiştirilemez** ("CURRENCY_LOCKED"). Check-out saati check-in'den önce olmalı.

### Oda tipleri (`/ayarlar/oda-tipleri`)

Kod, ad, yetişkin / çocuk kapasitesi, taban fiyat, açıklama. Kapasite, ileride o tipte fazla kişili rezervasyon varken düşürülemez ("CAPACITY_IN_USE"). Fiyat planı ya da odası olan tip silinemez. Silinen kod yeniden kullanılabilir.

### Vergiler (`/ayarlar/vergiler`)

Ad, oran, fiyata dahil mi, kategori (oda, restoran, minibar…). Raporlardaki net gelir, fiyata dahil **oda** vergilerini ayırır: net = brüt ÷ (1 + dahil oranlar).

### Sezonlar (`/ayarlar/sezonlar`)

Ad, başlangıç, bitiş, çarpan. Çakışan sezon kaydedilemez (veritabanı kısıtı; ekran daha iyi mesaj için önceden de denetler). Fiyat planı olmayan gecede fiyat = taban × çarpan.

### Fiyat planları (`/ayarlar/fiyat-planlari`)

Tablo: oda tipi × pansiyon (RO / BB / HB / FB / AI / UAI) × dönem; gecelik fiyat, dahil kişi, ek yetişkin, çocuk başı ek, en az gece. Aynı oda tipi + pansiyonda yayındaki planlar çakışamaz. Plan varsa sezon çarpanı uygulanmaz. Excel'den toplu yükleme Yönetim → Excel'den yükle'den.

### Paketler (`/ayarlar/paketler`)

Kod, ad, pansiyon, gecelik sabit fiyat, bileşenler (SPA, transfer… bilgi amaçlı; ayrı folyo satırı değil). Paketli rezervasyonda sezon / plan / kişi farkı / promosyon / acente / elle fiyat uygulanmaz. Pasif paket seçilemez.

### Dinamik fiyat (`/ayarlar/dinamik-fiyat`)

**Kural tabanlı yield açık** anahtarı (varsayılan kapalı), **Değerlendirme ufku (gün)**, **Yüksek doluluk eşiği (%)** (varsayılan 80) ve **Artış (%)** (10), **Düşük doluluk eşiği (%)** (30), **Son gün sayısı** (7) ve **İndirim (%)** (15). Düşük eşik yüksekten küçük olmalı. Kurallar: doluluk ≥ yüksek eşik → +artış; doluluk ≤ düşük eşik **ve** girişe ≤ son gün → −indirim. Hepsi öneri olarak onaya gider.

### Genel parametreler (`/ayarlar/genel`)

| Kart | Alanlar | Etkisi |
| --- | --- | --- |
| Varsayılanlar | Varsayılan pansiyon; para birimi (salt okunur, Otel bilgileri'nden) | Rezervasyon formu ve AI fiyatı |
| İptal politikası | Ücretsiz iptal süresi (gün), ceza oranı (%) — ikisi birlikte sıfır ya da birlikte dolu | İptal / gelmedi ücreti |
| Misafir iletişimi | Telefon ülke kodu (varsayılan 90) | Telefon eşleştirme ve SMS |
| Kapasite aşımı (overbooking) | Politika: **Reddet** (yer yoksa rezervasyon açılmaz) / **Onaya gönder** (yönetici onaylarsa kapasite aşılarak açılır) | Onay kuyruğuna "Kapasite aşımı" |
| Giriş / çıkış | Erken giriş ücreti (sabit tutar ya da yüzde), geç çıkış ücreti, girişte kimliği istenenler | Folyo aktörünün girişte / çıkışta işlediği ücret; check-in kimlik zorunluluğu |
| Ödeme onayı | Büyük ödeme eşiği (otel para birimi) | Eşiği aşan tahsilat "Büyük ödeme" onayına gider |

### Kullanıcılar (`/ayarlar/kullanicilar`)

Arama (ad / e-posta). **Yeni kullanıcı**: Ad, E-posta, Rol, Aktif, Şifre (en az 8 karakter). Düzenle: aynı alanlar (şifre hariç). **Şifre sıfırla**: yeni şifre. Pasif kullanıcı giriş yapamaz ama kayıtları ve izleri kalır; kullanıcı silinmez. Kullanıcı listesini görmek ayrı izin (müdür görür, düzenleyemez).

### Roller & İzinler (`/ayarlar/roller`)

Satır rol (Müdür, Ön büro, Kat hizmetleri, Muhasebe, Yiyecek & İçecek), sütun izin; izinler gruplara bölünür (Ayarlar, Odalar, Rezervasyonlar, Giriş / çıkış, Misafir iletişimi, Bildirimler, Onaylar, Yönetim, Günlük durum, Folyo, Ödeme ve kasa, Minibar ve çamaşır, Kat hizmetleri, Kayıp eşya, Raporlar, Gün kapanış, Teknik servis, Misafir CRM, Bütçe, Acente ve kontrat, Satış CRM, Promosyon ve kupon, Banket ve etkinlik, Restoran POS ve menü, Reçete ve maliyet, Satın alma, Stok ve depo, Demirbaş, Ön muhasebe, Fatura ve e-belge, Personel, Bordro, Misafir portalı, Anket, Spa, Acente primi, Kanal yönetimi, İzleme, Aktörler). Yönetici satırı yoktur: her zaman tüm izinler. Kaydedilince veritabanı kaynak olur; o günkü izin kataloğu da kaydedilir, sonradan eklenen izinler rolün varsayılanıyla gelir. Değişiklik oturumla uygulanır (çıkış-giriş).

**Örnek:** Otel, şef garsona ikram yetkisi vermek istiyor ama bütün garsonlara değil. Yönetici "Şef garson" adında ayrı rol açamaz (roller sabittir); bunun yerine Yiyecek & İçecek rolüne "POS: ikram, indirim…" iznini **açmaz**, şef garsona **Müdür** rolü vermek yerine ikram onayını onay kuyruğundan müdürün vermesini tercih eder (adisyon düzeltmesi zaten onaya gider). Kat tarafında ise Kat hizmetleri rolünden "temizlik görevi aç, ata, iptal et" ve "kontrol" izinlerini kaldırıp kat şefine Müdür rolü verir.

### AI asistanı (`/ayarlar/ai`)

"**AI asistanı yeni mesajlara cevap versin**" anahtarı; **Sınıflandırma modeli (küçük)** ve **Konuşma modeli**; model **fiyatları** (girdi / önbellekli girdi / çıktı, milyon token başına USD); **Günlük bütçe (USD)** (AI açıkken 0'dan büyük olmalı); **Konuşma başına günlük AI cevabı** sınırı; **AI'ın açtığı rezervasyon**: Kesin (misafire onay bildirimi gider) / Opsiyonlu; **Otel bilgisi** (en çok 8.000 karakter; AI'ın misafire anlattığı metin: kahvaltı saati, havuz, otopark, evcil hayvan…). Altta **kullanım kartı**: gün gün maliyet, model kırılımı. Sunucuda anahtar yoksa ya da ajanlar panelden kapalıysa ekran uyarır.

Konuşma modeli aynı zamanda bütçe yorum, geri bildirim, fiyat ve rapor ajanlarının modelidir.

### Mesaj kanalları (`/ayarlar/mesaj-kanallari`)

**WhatsApp Business** kartı: hat açık / kapalı, Telefon numarası kimliği (Meta Phone number ID), Numara (gösterim), Graph API sürümü, Erişim token'ı, Uygulama sırrı, Webhook doğrulama token'ı (sırlar şifreli; "Kayıtlı — değiştirmek için yazın"), **Callback URL** (kopyalanır, Meta uygulamasına yazılır), son hata. **Web sitesi sohbet balonu** kartı: Balon açık, **Online rezervasyon motoru açık**, balonun çalışacağı site adresleri (en çok 20), başlık, karşılama mesajı, renk, **gömme kodu** (siteye yapıştırılır), anahtar döndürme.

Canlıya alırken nginx `/webhooks/`, `/webchat/` ve `/socket.io/` yollarını backend'e geçirmelidir.

## Excel'den yükle

**Nerede:** Yönetim → Excel'den yükle, `/ice-aktar`. Misafir listesi için misafir yönetimi, fiyat planı için ayar yönetimi izni (ikisi de yoksa ekran "Yükleme yetkiniz yok" der).

### Sihirbaz

1. **Ne yüklenecek?** Misafir listesi ya da Fiyat planı. Şablon indirilebilir.
2. **Dosya** (.xlsx). Dosya tarayıcıda okunur; sunucuya satırlar gider.
3. **Eşleştirme**: her alan için dosyadaki sütun; başlık adlarından eş anlamlılarla **önerilir** ("Cep Telefonu" → Telefon, "TCKN" → Belge no), örnek değerlerle. "— Eşleme yok —" seçilebilir.
4. **Denetim**: her satır **Hazır** / **Zaten var** / **Hatalı** (süzgeçli). Tarih GG.AA.YYYY ya da ISO, tutar "2.500,00" biçiminde kabul edilir; TC kimlik sağlaması yapılır; pansiyon kodu ya da adı tanınır (Türkçe "I" tuzağı çözülmüştür).
5. **İçe aktar**: **ya hep ya hiç** — hatalı satır varsa hiçbir şey yazılmaz (hatalıları çıkarıp yeniden deneyin). Sonuç: "N kayıt içe aktarıldı".
6. **Geçmiş**: önceki yüklemeler (dosya adı, sayılar, satır sonuçları).

### Alanlar

| Misafir listesi | Fiyat planı |
| --- | --- |
| Ad*, Soyad*, Telefon, E-posta, Uyruk (iki harf), Belge türü (TC kimlik / Pasaport / Diğer), Belge no, Doğum tarihi, Etiketler (virgülle), Not | Oda tipi* (kod ya da ad), Plan adı*, Pansiyon*, Başlangıç*, Bitiş* (dahil), Gecelik fiyat*, Dahil kişi (boşsa 2), Ek yetişkin, Çocuk başı ek, En az gece |

### Kurallar

- **Misafirde mevcut kişi atlanır ve raporlanır**; mevcut karta dokunulmaz. Eşleşme, rezervasyondaki misafir aramasıyla aynı kuralla (e-posta küçük harf, telefon son 7 hane, belge no). Dosyada tekrar eden kişi bir kez yazılır.
- **Fiyat planında çakışan satır reddedilir** (sistemdeki kapalı planlar dahil ve dosyanın kendi içinde); mevcut fiyat habersiz değişmez. Yazılan planlar fiyat önbelleğini tazeler ve tek "fiyat değişti" olayı yayınlar (kanallara gider).
- Yükleme kimliği kayıt kimliğidir: aynı yükleme ikinci kez gönderilse yazılmaz.

**Örnek:** Eski programdan 1.840 misafirlik Excel geldi. Eşleştirmede "GSM" otomatik Telefon'a bağlandı. Denetim: 1.790 hazır, 38 zaten var (geçen ay elle açılmış), 12 hatalı (doğum tarihi "31.02.1985", geçersiz TC). 12 satır düzeltilip dosya yeniden yüklendi; 1.802 kart açıldı, 38 atlandı; geçmişte iki deneme görünür.

## Raporlar

**Nerede:** Ön büro grubu → Raporlar, `/raporlar`; dört sekme: **Gelir raporları** `/raporlar/gelir` (rapor görüntüleme: müdür, muhasebe), **Rapor asistanı** `/raporlar/asistan` (rapor asistanına soru sorma: müdür, muhasebe — AI bütçesi harcar), **Rapor tasarımcısı** `/raporlar/tasarim`, **Kayıtlı raporlar** `/raporlar/kayitli`.

### Tanımlar (bütün raporlar ortak)

- **Satılan gece:** bugün ve sonrası için opsiyonlu + kesin + içerideki konaklamaların geceleri (eldeki); geçmişte yalnızca gerçekleşen (içeride ya da çıkmış) konaklamalar — gelmeyen misafirin gecesi "gelmedi" işaretlenmemiş olsa da dolu sayılmaz.
- **Satılabilir oda:** o gece kayıtlı oda − arızalı oda (hizmet dışı paydada kalır; silinen oda silindiği güne kadar sayılır).
- **Doluluk** = satılan / satılabilir. **ADR** = oda geliri / satılan gece (satış yoksa tanımsız, "0" değil). **RevPAR** = oda geliri / satılabilir.
- **Oda geliri vergiler hariç**; geçmiş günlerde **folyoya işlenen** gerçekleşen gelir (düzeltme, indirim, iptal dahil; iptal işlendiği güne düşer), bugün ve sonrası rezervasyonun gece fiyatından eldeki. Erken giriş / geç çıkış ücreti ve iptal / gelmedi geliri ayrı sütun, ADR'ye girmez. F&B, minibar, çamaşır oda geliri değildir.
- **Geçen yıl** = haftanın aynı günü (364 gün önce). Oranlar dönem toplamından hesaplanır (ortalamaların ortalaması alınmaz). Başka para birimindeki rezervasyon karıştırılmaz, sayısı bildirilir.

Günlük durum, oda planı, gün kapanışı özeti ve raporlar **aynı tanımları** kullanır; iki ekran arasında fark görmezsiniz.

### Gelir raporları

Hazır aralıklar (bu ay, geçen ay, son 30 gün, önümüzdeki 30 gün, yılbaşından bugüne, son 12 ay) + özel aralık (en çok 366 gün, en ileri iş günü + 730 gün); gruplama gün / hafta / ay. Dört gösterge kartı (doluluk, ADR, RevPAR, oda geliri — geçen yıl ve değişim), çizgi grafik (bu dönem vurgulu, geçen yıl gri, eldeki dönem gölgeli), tablo görünümü (toplam satırıyla), **oda tipine göre** ve **rezervasyon kaynağına göre** kırılım (gece, ADR, geçen yıl), "rakamlar nasıl hesaplanıyor" açıklaması. "N gece başka para biriminde" uyarısı çıkabilir.

Geçmiş günler saatlik işin ürettiği özetten okunur; son 14 gün, eldeki rezervasyon ve özeti olmayan gün canlı hesaplanır — rapor her zaman doğrudur, özet yalnızca hızlandırır. Çok uzun aralıkta süre sınırı aşılırsa "daha kısa aralık" uyarısı gelir.

### Rapor asistanı (doğal dil)

Soru kutusu ve örnek sorular: "Geçen ayın haftalık doluluğu", "Bu yıl kaynağa göre oda geliri", "Önümüzdeki 30 günün doluluk tahmini", "Geçen ayın bütçe sapması", "Son 7 günün ADR ve RevPAR'ı". Kapsam: doluluk, oda geliri / ADR / RevPAR, oda tipi ve kaynak kırılımı, 30 günlük tahmin, bütçe sapması. Göreli dönemler: Bugün, Dün, Bu hafta, Geçen hafta, Bu ay, Geçen ay, Gelecek ay, Bu yıl, Geçen yıl, Son 7 / 30 / 90 gün, Önümüzdeki 7 / 30 gün, özel.

1. Soruyu yazın (5–500 karakter), gönderin. Durum **Hazırlanıyor**; kişi başı en çok 3 bekleyen soru.
2. Cevap kartı: başlık, rapor · dönem, kısa yorum, özet, grafik (çizgi / sütun / tablo, en çok 3 seri), tablo, notlar. Kapsam dışı soru ("restoranın cirosu") metinle cevaplanır, kaydedilemez.
3. **Kaydet** (başlık; isterseniz otelle paylaş), **Excel'e aktar**, **Bunu değiştir** (devam sorusu: "bunu aylık göster" — önceki raporun tanımı bağlam olur).
4. AI kullanılamıyorsa uyarı ve **Rapor talebi gönder**: soru "Rapor talebi" manuel görevi olur, rapor yetkilisi hazırlar.

Arka planda rapor ajanı soruyu rapor **tanımına** çevirir; tabloyu sistem çalıştırır (MCP rapor araçları, salt okunur işlem, süre sınırı). Model rakam üretmez. Soru başına en çok 6 model çağrısı, AI bütçesinden düşer. 3 dakikada cevap gelmezse "zamanında cevaplanmadı" sayılır.

**Örnek:** Muhasebeci Deniz "geçen ayın haftalık doluluğunu göster" yazdı. 8 saniye sonra kart geldi: "Ekim 2026 haftalık doluluk" · Geçen ay (01.10–31.10) · çizgi grafik 5 hafta · yorum "Doluluk ekim ortasında %82'ye çıkıp son hafta %61'e geriledi; geçen yıl aynı dönem %74." Deniz "bunu oda tipine göre kır" dedi; devam sorusu kaynak kırılımı raporuna dönüştü. Kaydet → "Ekim doluluk" → otelle paylaş. Kasım'da müdür aynı kayıtlı raporu çalıştırdı; "geçen ay" artık Kasım'ı gösterdi, **AI çağrılmadı**.

### Rapor tasarımcısı

Kaynak → sütunlar → gruplama → filtreler → sıralama + satır sınırı → **Önizle** (100 satır) / **Excel** (5.000 satıra kadar) / **Kaydet** (sahibi değilseniz "farklı kaydet").

| Kaynak | Ek yetki |
| --- | --- |
| Rezervasyonlar | Rezervasyonları görüntüle |
| Folyo kalemleri (harcamalar) | Folyoları görüntüle |
| Misafirler | Misafir kartlarını görüntüle |
| Ödemeler | Kasayı görüntüle |

Sütunlar sürükle-bırak ile sıralanır (en çok 20). Filtre işleçleri türe göre: metin (içerir / eşittir / boş / dolu), seçenek (şunlardan biri / dışında), tarih (**göreli dönem** / arasında / önce / sonra), sayı ve tutar (eşittir / en az / en çok / arasında). **Gruplu** modda boyut + adet / toplam / ortalama / en az / en çok. Kayıt anları otelin saat diliminde güne çevrilir. Belge numarası sütunu yoktur (kişisel veri).

Arka planda sorgu üretici SQL enjeksiyonuna kapalıdır: kullanıcıdan yalnızca katalogla doğrulanmış sütun anahtarı ve parametre değer gelir; SQL ifadeleri sunucuda. Kaynağın yetkisi **her çalıştırmada** denetlenir; paylaşılan rapor yetkisize "yetkiniz yok" görünür.

**Örnek:** Satış müdürü "acente kaynaklı, önümüzdeki 30 günde girişi olan rezervasyonların oda tipine göre adedi ve toplam tutarı" raporunu kurdu: kaynak Rezervasyonlar, filtre Kaynak ∈ {Acente}, Giriş = Önümüzdeki 30 gün, gruplama Oda tipi, toplamlar Adet ve Tutar. Kaydetti, paylaştı. Her pazartesi aynı raporu çalıştırıyor; dönem kayıyor.

### Kayıtlı raporlar

Asistan ve tasarımcı raporları birlikte (tür rozeti): **Benim** / **Paylaşılan**. İşlemler: **Çalıştır** (aynı sonuç bloğu; göreli dönem çalıştırıldığı güne göre; AI'sız), **Yeniden adlandır**, **Paylaş** / paylaşımı kaldır, **Sil** (yalnızca sahibi), tasarım raporunda **Tasarımda düzenle**. Kişi başı en çok 100 kayıtlı rapor. Kayıtlı raporun zamanlanmış e-postası henüz yoktur (devir notu).

## Gün kapanış

**Nerede:** Ön büro grubu → Gün kapanış; **Kapanış** `/gun-kapanis`, **Geçmiş** `/gun-kapanis/gecmis`. Görüntüleme izni (durumu görür) ve **günü kapatma** izni (ön büro ve müdür varsayılan).

### Sihirbaz

Ekran "Gece görevlisi günü adım adım kapatır" başlığıyla açılır; kapatma yetkiniz yoksa "yalnızca durumu görüyorsunuz" bilgisi çıkar. Beş adım; ilk dördü **önizleme**dir, hiçbir şey yazmaz:

1. **Gelmeyenler** — bugün girişi olup gelmeyen rezervasyonlar (kod, misafir, oda tipi, tutar).
2. **Oda ücretleri** — içeride olan konaklamalar ve bu gece basılacak ücretler (iş günü gösterilir).
3. **Kasa sayımı** — her ödeme yöntemi için "beklenen" (sistemden) ve **sayılan** (siz girersiniz): "Nakit — beklenen 12.450,00".
4. **Fark** — yöntem bazında beklenen / sayılan / fark.
5. **Günü kapat** — "Gelmeyen ücretini uygulama" seçeneği, **Devir notu** (isteğe bağlı, devralan vardiyaya), uyarı: "Gün kapatılınca iş günü ilerler ve bu işlem geri alınamaz."

"Kapat" tek işlemde: gelmeyenleri işaretler → gecenin oda ücretlerini basar → günlük özeti (doluluk, oda geliri, ADR, RevPAR, tahsilat) yazar → vardiya raporunu kaydeder → günü kapatır → "gün kapandı" olayını yayınlar → iş gününü ilerletir. Ekran "Gün kapatıldı — 24.11.2026 kapanışı tamamlandı; iş günü ilerledi" ve günlük özeti gösterir.

### Kurallar

- İki görevli aynı anda kapatamaz: ilk "Başlat" günü "sürüyor" yapar.
- Takvimden ileri gün kapatılamaz ("DAY_NOT_ARRIVED"); aynı gün iki kez kapatılamaz ("ALREADY_CLOSED").
- Her adım idempotent: oda ücreti gece anahtarıyla bir kez basılır; gelmedi tek tek işaretlenir. Kapanış yarıda kalırsa yeniden çalıştırmak çift kayıt üretmez.
- Kapanışla dolu odaların kat hizmeti durumu "kirli" olur; ertesi sabahın konaklayan temizliği (10 dakikalık iş) buradan beslenir.
- Gelmedi işaretlenen rezervasyonlar geçmiş doluluğu ve tahmin örneklerini kendiliğinden düzeltir.

### Geçmiş

Kapanışlar sayfalı listelenir: gün, kapatan, kapanış anı, özet göstergeler, kasa farkı. Detayda günlük özet ve **vardiya devir raporu PDF** (yöntem bazında sayım, fark, devir notu).

**Örnek:** Gece görevlisi Burak 23:55'te sihirbazı açtı. Gelmeyenler: 2 rezervasyon (biri acente garantili; iptal politikası ücreti 1 gece). Oda ücretleri: 61 içeride konaklama. Kasa: nakit beklenen 12.450, sayılan 12.400 (−50); kart beklenen 38.200, sayılan 38.200. Devir notu: "305 misafiri sabah 06:00 taksi istedi." Kapat. 00:02'de iş günü 25 Kasım oldu; Panel'deki gelecekler listesi yeni güne döndü; folyo aktörü 61 oda ücretini bastı; 24 Kasım'ın özeti raporlara ve bütçe gerçekleşenine düştü. Sabah müdür Geçmiş'ten PDF'i açıp −50 TL farkı gördü.

## Sık sorulanlar

**Görevler ekranı boş ama zil "personele bırakılan iş" diyor.**
Görev başka bir modülün olabilir ve sizin o modüle yetkiniz yoktur; zil uyarısı ise genel bir izne gitmiştir. Uyarıya tıklayın: yetkiniz yoksa "yetkiniz yok" görürsünüz; o modülün yetkilisi görevi görür.

**Onaylar'da "Onayla" düğmesi gri.**
Dört göz kuralı: isteği siz açtınız. Başka bir yetkili onaylamalı; siz yalnızca reddedebilirsiniz. Düğmenin üzerine gelince sebebi yazar.

**Onayın süresi dolmuş, ne oldu?**
İş yapılmadı. Zile "Süresi doldu, yapılmadı" uyarısı gitmiştir; aktivite akışında neden yazılıdır. Gerekiyorsa işi ilgili ekrandan yeniden başlatın (yeni iade isteği, yeni öneri bir sonraki turda).

**Fiyat önerisini düzenleyip onayladım; OTA'da ne zaman görünür?**
Kanal aktörü anında işaretler, gönderim turu 5 saniyede bir çalışır (kanal başına en sık 10 saniye). Kanallar → senkron logunda gönderimi görürsünüz.

**Bildirim "Başarısız" — misafire nasıl ulaşırım?**
Detayda hata kodunu okuyun. Kanal sorunuysa (parola, başlık) Kanallar'da düzeltip test gönderin, sonra bildirimi "Tekrar gönder". Misafir adresi yanlışsa misafir kartını düzeltin; tekrar gönderim güncel adrese gider.

**Şablonu değiştirdim; sıradaki bildirimler yeni metinle mi gider?**
Hayır. Metin kuyruğa girerken dondurulur; sıradakiler eski metinle gider, yeni olaylar yeni metni kullanır. Geçmişte giden metni de aynen görürsünüz.

**Aktörü kapattım, sonra açtım. Aradaki işler yeniden yapılır mı?**
Hayır; onlar manuel görev olarak düştü ve orada kalır. Yalnızca kanal aktörü açılınca tam eşitleme ister.

**Rol matrisinde yöneticiyi kısıtlayabilir miyim?**
Hayır. Yönetici her zaman tüm izinlere sahiptir (kilitlenme koruması). Yeni bir "süper olmayan yönetici" için Müdür rolünü matristen genişletin.

**Rapor asistanı "AI şu an kullanılamıyor" diyor.**
Sunucuda model anahtarı yok, AI ayarlardan kapalı, model seçilmemiş, günlük bütçe dolmuş ya da rapor ajanı panelden kapalı. Gelir raporları ve kayıtlı raporlar AI'sız çalışır; soruyu "Rapor talebi gönder" ile personele iletebilirsiniz.

**Günü yanlışlıkla kapattım; geri alabilir miyim?**
Hayır; kapanış geri alınamaz ve iş günü ilerler. Yanlış "gelmedi" işaretlenen rezervasyonu rezervasyon ekranından geri alın (ücret ters kayıtla düşer); kasa farkı notu için devir raporu kalır.

**Excel yükleme "ya hep ya hiç" — 1.000 satırda 3 hata var, hepsini mi düzeltmeliyim?**
Evet, ya da hatalı 3 satırı dosyadan çıkarıp ayrı yükleyin. Kısmi yükleme bilinçli olarak yoktur: yarım veri, eksik veriden daha kötüdür.

**Ayarlar menüsünü müdür göremiyor; ayarları kim değiştirecek?**
Menü yalnızca Yönetici role açılır. Müdür ayar görüntüleme iznine sahiptir (API düzeyinde) ama düzenleme yetkisi yöneticidedir. Otel isterse bir müdüre Yönetici rolü verir.
