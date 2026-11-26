# Sık sorulan sorular ve sorun giderme

Bu bölüm iki parçadır: önce **sorun giderme** (ekranda gördüğünüz belirti → sebebi → ne yapacağınız; mümkünse ekran yolu), sonra **modül durumu tablosu** (hangi modül tamam, hangisi kısmi, hangisi yol haritasında).

Sorun giderirken üç ekranı yanınızda tutun:

- **Görevler** (`/gorevler`): bir aktörün yapamadığı iş buraya düşer.
- **Aktörler** (`/aktorler`): hangi aktör açık, kurulu olmayan ajan ve sebebi, son 24 saatte hata.
- **Aktivite → Canlı akış** (`/aktivite/akis`): her işin zinciri; "neden böyle oldu?" sorusunun cevabı çoğu zaman burada.

## Yetki ve oturum

### "Bu işlem için yetkiniz yok" (403)

- **Belirti:** bir düğmeye basınca kırmızı bildirim "yetkiniz yok"; ya da menüde beklediğiniz madde (Faturalar, Ön muhasebe, Bordro…) hiç görünmüyor.
- **Sebep:** rolünüzün izin matrisinde o izin kapalı. Menü ve düğmeler izne göre gizlenir; gerçek denetim sunucudadır. Bazı izinler varsayılanda yalnız müdürdedir (ayarlar, tanımlar, aktör aç / kapa, fiş iptali, amortisman kaydı). Bazı işler gövdeye bağlı izin ister: elle fiyat (`reservations.price_override`), bakiyeyle çıkış (`stays.checkout_open_balance`).
- **Çözüm:** yöneticiniz **Ayarlar → Roller & İzinler** matrisinde rolünüze izni açar; çıkış yapıp yeniden girin (izinler oturumla gelir). Matris kaydedildikten sonra kataloğa giren yeni modül izinleri rolün varsayılanına düşer; yöneticinin bilerek kaldırdığı izin geri gelmez.

### Oturum düştü / sürekli giriş ekranına atıyor

- **Belirti:** sayfa yenilenince giriş ekranı; istekler 401.
- **Sebep:** erişim belirteci süresi dolmuş ve yenileme yapılamamış (uzun süre kapalı sekme, şifre sıfırlandı, hesap pasife alındı).
- **Çözüm:** yeniden giriş. Hesap pasifse yönetici **Ayarlar → Kullanıcılar**'dan açar.

### Ücret / IBAN / kimlik numarası görünmüyor

- **Belirti:** personel listesinde ücret sütunu yok, kimlik numarası `***` ile maskeli.
- **Sebep:** bilerek böyle. Ücret, IBAN, avans, kesinti yalnız `payroll.view` ile gelir (sunucu göndermez); kimlik numarası `employees.manage` / `payroll.view` yoksa maskeli. Ön büro listelerinde ve denetim izinde misafir kimlik numarası da maskelidir (KVKK).
- **Çözüm:** gerçekten gerekiyorsa rolünüze ilgili izin eklenir.

## Ekran davranışı

### "Başkası değiştirdi, yenileyin" uyarısı

- **Belirti:** kaydet deyince "kayıt bu arada değişti" (`STALE_WRITE`); ekran yenilenir ve sizin değişikliğiniz kaybolur.
- **Sebep:** her kayıt **sürüm damgası** taşır. Siz formu açıkken başka biri (ya da bir aktör) aynı kaydı değiştirmiş. Sistem ikinci yazanı reddeder; veri ezilmez. Oda servisi / paket sipariş gibi hızlı ekranlarda "başkası ilerletti" de aynı aileden.
- **Çözüm:** ekranı yenileyin, güncel hâli görün, değişikliğinizi yeniden yapın. Sayımda (stok / demirbaş) iki sayımcı aynı anda yazıyorsa ikincisi güncel listeyi görür; bu normaldir. **Not:** misafirin mesaj yazması konuşmada çakışma sayılmaz; folyoda ödeme sürüm damgasını ilerletmez (aynı anda kalem giren personelin ekranı bozulmaz).

### Ekran yenilenmiyor / "canlı değil"

- **Belirti:** oda planı, gelen kutusu, mutfak ekranı, zil kendiliğinden güncellenmiyor; sayfa yenileyince veri geliyor.
- **Sebep:** canlı yayın (socket) bağlantısı kurulmamış. En sık: ters vekil (nginx) `/socket.io/` yolunu backend'e geçirmiyor ya da websocket yükseltmesi tanımlı değil; `VITE_API_URL` adresine yol eklenmiş (socket bunu ad alanı sayar ve bağlanmaz); ağ kopması (bağlantı üstel geri çekilmeyle kendiliğinden toparlanır).
- **Çözüm:** sayfayı yenileyin; sorun sürüyorsa sistem yöneticisi nginx'te `/socket.io/`, `/webhooks/`, `/webchat/` yollarını ve websocket başlıklarını kontrol eder. Oda planı gibi önbellekli ekranlar olaysız durumda en geç **15 sn** gecikmeyle tazelenir.

### Rozet / sayaç geç güncelleniyor

- **Belirti:** onay sayacı, görev rozeti, mesaj rozeti birkaç saniye geç.
- **Sebep:** büyük otel için bilerek seyreltilmiş: özetler dakika anahtarlı önbellekte, canlı haberle en çok 10 sn'de bir tazelenir; zil özeti 5 dk + rastgele payla.
- **Çözüm:** normal; tıklayınca liste güncel gelir.

### Saatler yanlış görünüyor (3 saat kayma)

- **Belirti:** teslim saati, kahvaltı saati, rapor günü tarayıcıdaki saatten farklı.
- **Sebep:** sistem her saati **otelin saat diliminde** gösterir ve girer (Ayarlar → Otel bilgileri). Tarayıcının dilimi farklıysa (yurt dışından bağlanan yönetici) kayma normaldir. Eskiden otel bağlamı yalnız ayar yetkilisine açıktı ve bazı roller tarayıcı dilimini görüyordu; bu düzeltildi.
- **Çözüm:** otel saat dilimini kontrol edin; tarayıcıya göre düzeltmeye çalışmayın.

## Zil, bildirim, aktör

### Zil gelmiyor

- **Belirti:** gecikmiş istek, kasa farkı, minimum altı stok, garanti, onay beklediğini biliyorsunuz ama çan boş.
- **Sebep (sırayla kontrol):** (1) uyarı **izne** gider — o modülün iznine sahip değilseniz size düşmez (ör. minimum stok zili `purchasing.request` iznine, garanti zili `assets.manage`'a, iptal onayı `approvals.decide`'a); (2) kişi o uyarı türünü **susturmuş** (zil → tercihler); (3) canlı bağlantı yok (yukarıdaki madde) — zil sunucudan ilk açılışta gelir, sonrası socket; (4) uyarı bir kez çalar ve aynı konu tek uyarıda birleşir (garanti: kart + bitiş tarihi başına bir kez; KDS "hazır": adisyon başına bir).
- **Çözüm:** izni ve tercihleri kontrol edin; zil listesini açın (30 gün saklanır); sayfayı yenileyin.

### Misafire bildirim gitmedi

- **Belirti:** Bildirimler → Gönderim geçmişi'nde satır "başarısız", "gönderilmedi" ya da hiç yok.
- **Sebep:** (a) **E-posta kanalı gerçek gönderici değil** — e-posta geçidi henüz taslaktır; e-posta satırı kuyruğa düşer ama misafire ulaşmaz (widget bu yüzden onay kodunu ekranda gösterir). (b) SMS (Netgsm) ayarı eksik / parola yanlış / onaysız başlık → kalıcı hata, yöneticiye "misafire ulaşmadı" zili (aynı gün aynı hata tek uyarı). (c) Sessiz saatler: 22:00–08:00 arası sıraya giren SMS bitişte gider. (d) Misafir kanal bazında **bildirim istemiyor** (misafir kartı → tercihler) → satır "gönderilmedi". (e) Oda bilgisi yalnız giriş günü / içerideyken gider. (f) WhatsApp bildirimi (otelin başlattığı şablonlu mesaj) yapılmadı; bildirimler e-posta / SMS ile. (g) Sunucuda `SETTINGS_SECRET_KEY` yoksa kanal parolası kaydedilemez — ekran bunu söyler.
- **Çözüm:** Bildirimler → **Kanallar**'da SMS ayarını test edin (**Test gönder**); geçmişteki satırdan **Tekrar gönder** (yeni kayıt açar, misafir kartındaki güncel adrese gider). Geçici hatalar 30 sn / 2 dk / 10 dk / 30 dk arayla 5 kez denenir.

### "Aktör kapalı" / Görevler listesi doluyor

- **Belirti:** Görevler ekranında "Folyo açılacak", "Oda atanacak", "Folyo tahsilatı muhasebeye işlenecek" gibi görevler birikiyor; Aktörler'de satır kırmızı "kapalı".
- **Sebep:** yönetici aktörü kapatmış (kim, ne zaman, gerekçe satırda yazar) **ya da** aktör işini iş kuralı hatasıyla yapamamış (eşleme yok, cari seçilmemiş, depo pasif, folyo kapalı). Geçici hata 3 kez denenir, iş kuralı hatası beklemeden göreve düşer.
- **Çözüm:** görevi **üstlenin**, bağlantıdan ilgili ekrana gidip işi elle yapın (aynı kaynak anahtarı: sonradan ikinci kez yazılmaz), **tamamla** deyin. Aktörü **açmak eski görevleri kapatmaz**; yalnız yeni olayları işler. İstisnalar: kanal yöneticisi açılınca tam eşitleme yapar; muhasebe için **Ön muhasebe → Ayarlar → Eşitle** dönemdeki eksikleri işler. Kapatırken ekran "ne durur"u gösterir — okuyun.

### AI cevap vermiyor (concierge, rapor asistanı, bütçe yorumu, fiyat ajanı)

- **Belirti:** web chat / WhatsApp'ta misafire AI cevap vermiyor, konuşmalar "cevap bekleyen"de açılıyor; Raporlar → Rapor asistanı "cevaplanamadı — rapor talebi gönder" diyor; Bütçe → Sapma'da yorum "yazılamadı"; Aktörler'de ajanlar "kurulu değil".
- **Sebep (sırayla):** (1) sunucuda **`OPENAI_API_KEY` tanımlı değil** → ajanlar hiç kayıt olmaz; Aktörler ekranı "Sunucuda OPENAI_API_KEY tanımlı değil; ajan çalışmıyor" der. (2) Ayarlar → AI asistanı'nda AI kapalı ya da **model seçilmemiş**. (3) **Günlük bütçe doldu** (otel geneli USD bütçesi; `AI_BUDGET` zili). (4) Ajan panelden kapatılmış. (5) Konuşma **bilerek** personele devredildi: şikâyet, personel isteği, 30 geceden uzun / 10 kişiden kalabalık / 540 günden ileri istek, konuşma başına günlük cevap sınırı, 5 dk cevapsız kalan AI konuşması — iç notta sebep yazar. (6) AI yalnız WhatsApp ve web chat'te çalışır.
- **Çözüm:** sistem yöneticisi anahtarı `.env`'e girer ve sunucuyu başlatır; Ayarlar → AI asistanı'nda model ve bütçeyi kontrol edin (kullanım ve maliyet grafiği aynı ekranda). AI yokken hiçbir şey durmaz: konuşmalar personelde, rapor talebi görev olur, kural tabanlı yield çalışır, anket raporu AI etiketi olmadan eksiksizdir.

### "Onay bekleyen iş var" — işlem ilerlemiyor

- **Belirti:** folyo kapanmıyor ("bekleyen iptal / ödeme var"), adisyon kapanmıyor, vardiya kapanmıyor, fatura gönderimi durdu, fiş işlenmedi, bordro "onayda".
- **Sebep:** dört göz kuralı. Riskli işler onay kuyruğunda bekler: folyo kalemi iptali, iade, büyük ödeme, ödeme iptali, fatura iptali, eşik üstü ödeme fişi, eşik üstü sipariş, POS düzeltmesi / büyük tahsilat, etkinlik ödemesi, bordro, acente primi, fiyat önerisi, kapasite aşımı. **İsteyen kendi isteğini onaylayamaz** (reddedebilir). Süre: varsayılan 1 gün (sipariş 3 gün), dolunca "yapılmadı" uyarısı.
- **Çözüm:** `approvals.decide` yetkili başka biri **Onaylar → Bekleyen**'den karar verir (satırdan tek tıkla, detay aynı pencerede). Üst bardaki sayaç kırmızıysa süresi yaklaşan var. Onaylanan iş aktör kapalı olsa da yapılır; reddedilen / süresi dolan iş hiç işlenmez.

## Para ve muhasebe

### Fatura gönderilemedi / reddedildi

- **Belirti:** Faturalar → Kesilenler'de "gönderilemedi" ya da "reddedildi" kutusu dolu; zil.
- **Sebep:** **Gönderilemedi** = geçici hatalar (ağ, hız sınırı) 1 dk / 5 dk / 15 dk / 1 sa / 4 sa denemeden sonra da aşılamadı → entegratör bağlantısı yok. **Reddedildi** = entegratör / GİB belgeyi kalıcı reddetti (alıcı posta kutusu yok, vergi no uyuşmuyor, şema hatası). **Hatırlatma:** gerçek entegratör adaptörü henüz bağlı değil; test ortamında ret senaryoları "posta kutusu yok" test mükellefiyle üretilir.
- **Çözüm:** Ayarlar'da entegratör ve ortamı kontrol edin; reddedildiyse alıcıyı düzeltip faturadan **Tekrar gönder** (numara korunur) ya da **İptal iste** → onay → **Yeni taslak**. "Gönderiliyor"da 5 dk'dan uzun kalan kayıt kendiliğinden sıraya döner; süreç gönderim ortasında kapanmışsa ETTN aynı olduğundan entegratör ikinci gönderimi mükerrer sayar.

### Fatura kesilemiyor ("Kesmeden önce" listesi dolu)

- **Belirti:** Kes düğmesi pasif; liste "alıcı vergi no yok", "adres eksik", "vergi kodu eşlenmemiş", "faturalama başlangıcından önce", "kaynak değişti", "vergi dökümü eksik", "mükellef sorgusu yapılamadı", "para birimi TRY değil".
- **Sebep / çözüm:** her satır kendini söyler. Vergi kodu → Faturalar → Ayarlar → vergi kodu eşlemesi (0015 KDV, 0059 konaklama vergisi). Kaynak değişti → taslak yenilendi, satırları kontrol edip tekrar kesin. Vergi dökümü eksik → folyo kalemi dökümsüz işlenmiş (eski veri), kalem düzeltilir. Başlangıçtan önce → o folyo önceki sistemde faturalanmış sayılır; yine de kesilecekse başlangıç gününü geri alın (ekran uyarır). Mükellef sorgusu → entegratör / test mükellefi listesi. TRY dışı → döviz faturası bu sürümde yok.

### "Faturalama başlamadı" — faturalanacaklar boş

- **Sebep:** Faturalar → Ayarlar'da satıcı bilgisi ve **faturalama başlangıcı** girilmemiş. Canlıya alışta otellerin eski folyoları bir anda "süresi geçmiş" görünmesin diye böyle tasarlandı.
- **Çözüm:** `invoices.setup` yetkili ayarları girer. Başlangıç bugünden ileri olamaz.

### Folyo yeniden açılmıyor / çıkış geri alınamıyor

- **Belirti:** "faturası kesilmiş folyo açılamaz".
- **Sebep:** fatura ile folyo ayrışmasın diye kesilmiş (ya da iptali onay bekleyen) faturanın folyosu açılmaz.
- **Çözüm:** önce fatura iptali (dört göz), sonra folyoyu açın; folyo yeniden kapanınca taslak yeniden açılır.

### Ödeme alındı ama cari / kasaya düşmedi

- **Belirti:** Kasa → Günlük kasa'da ödeme var, Ön muhasebe → Kasa / banka'da yok; Görevler'de "Folyo tahsilatı muhasebeye işlenecek".
- **Sebep:** (1) muhasebe aktörü kapalı; (2) **yöntem eşlemesi eksik** (o kanal × yöntem × para birimi için kasa / banka seçilmemiş) ya da hesabın para birimi tutmuyor; (3) "Acente / cari" ödemesinde **cari seçilmemiş**; (4) belge **başlangıç gününden önce** (bilerek işlenmez; açılış bakiyesiyle gelir); (5) ödeme hâlâ "onay bekliyor" (onaylanana kadar muhasebe etkisi yok).
- **Çözüm:** Ön muhasebe → **Ayarlar → Tahsilat eşlemesi**'ni tamamlayın, **Eksik kayıtları eşitle** çalıştırın (20 sn çalışır, kalanı söyler, yeniden çalıştırınca devam eder), görevleri kapatın. İşlenmiş belgeye bir şey yapmaz (kaynak anahtarı).

### Kasa farkı

- **Belirti:** gün kapanışında / POS vardiya kapanışında "beklenen 18.400, sayılan 18.350, fark −50"; ön muhasebede "kasa eksiye düşemez".
- **Sebep (gün kapanışı / vardiya):** beklenen = işlenmiş ödeme − iade ± iptal kaydı; **onay bekleyen ödemeler** para çekmecede ama defterde değil (ayrıca raporlanır); döviz nakit kendi para biriminde sayılır; iptal kaydı asıl alanın çekmecesine yazılır; restoran kasası garsonun vardiya kasasıdır (avans + işlenmiş nakit − iptal). Fark kapanışı **engellemez**, devir raporuna yazılır; POS'ta politikadaki fark uyarısı şef garsona.
- **Sebep (ön muhasebe):** elle çıkış ya da fiş iptali kasadaki paradan büyük. Kasa eksiye düşmez, banka düşebilir.
- **Çözüm:** onay bekleyenleri kontrol edin; döviz kasasını ayrı sayın; farkı notla kapatın. Ön muhasebede önce **virman** ile kasaya para aktarın ya da doğru kasayı seçin. Kur: döviz ödemesi iş gününe kadar girilmiş en son kuru kullanır, **3 günden eski kur** reddedilir (Kasa → Döviz kurları → günün kuru).

### Çıkış yapılamıyor: "bakiye var"

- **Sebep:** ödenecek = folyo bakiyesi + çıkışta işlenecekler (kalan geceler, geç çıkış ücreti). Onay bekleyen ödeme bakiyeye girmez. Birden fazla açık pencere varsa ödeme pencere seçilmeden alınmaz (`FOLIO_REQUIRED`). Teslim edilmemiş çamaşır siparişi uyarı verir.
- **Çözüm:** çıkış penceresinden **Ödeme al** (tek pencerede) ya da folyo ekranına gidin; yetkili gerekçeyle **bakiyeyle çıkış** yapabilir (zile uyarı düşer).

### Giriş yapılamıyor

- **Belirti:** "oda arızalı", "odada önceki misafir içeride", "oda bu gecelerde başkasına", "kimlik sağlaması hatalı", "giriş günü gelmemiş".
- **Sebep / çözüm:** arızalı odaya giriş olmaz → oda değiştirin (Oda planı'nda sürükle); önceki misafir çıkmamış → önce çıkış; kimlik → TC kimlik algoritması / pasaport biçimi; politika "bütün yetişkinler" ise refakatçi kimliği de zorunlu; kirli odaya giriş personel onayı ister (engel değil). Erken gelen misafir giriş gününden önce giremez; geç gelen ertesi gün girebilir.

### Fiş onay bekliyor / fiş iptal edilemiyor

- **Sebep:** ödeme fişi toplamı Ön muhasebe → Ayarlar'daki eşiğe eşit / üstü → dört göz; onay anında kasa yeterliliği yeniden denetlenir. İptal: yalnız işlenmiş fişte, gerekçeyle, fiş tarihli ters kayıtla; fişin açtığı çek ilk durumunda olmalı (tahsile verilmiş / ciro edilmiş / tahsil edilmiş çekin fişi iptal edilemez); kasayı eksiye düşüren iptal reddedilir.
- **Çözüm:** başka yetkili onaylar; çeki önce iade / geri alın.

### Yevmiye fişini silebilir miyim?

- **Cevap:** Hayır. Genel muhasebede fiş silinmez; **İptal et** (`ledger.setup`) fişi "İptal edildi" yapar ve seçilen günde bütün satırları ters çeviren bir **ters kayıt fişi** yazar. İki fiş birbirine bağlıdır, mizanda ikisi de sayılır (net sıfır). Ters kayıt fişi iptal edilemez; iptal edilmiş fiş ikinci kez iptal edilemez; kilitli dönemdeki fiş kilidi açmadan iptal edilemez.
- **Dikkat:** otomatik fişi iptal ettiğinizde ön muhasebedeki kaynak kayıt **fişli kalır**; Eşitle onu yeniden yazmaz. Doğru satırları elle fişle girin. Tutar yanlışsa yevmiye fişini değil **ön muhasebe fişini** iptal edin (kasa da düzelir; yevmiyede ters fiş kendiliğinden oluşur).

### Mizan neden dengesiz görünüyor / "fişlenmemiş hareket" ne demek?

- **Belirti:** Genel muhasebe → Mizan'da "Fişlenmemiş hareket var" sarı uyarısı (sayı + Ayarlar → Eşitle bağlantısı); Ayarlar'da "Fişlenmemiş cari hareketi" / "Fişlenmemiş kasa / banka hareketi" sayaçları sıfır değil.
- **Sebep:** ön muhasebeye yazılmış ama henüz **yevmiye fişine çevrilmemiş** kayıt var: muhasebe aktörü kapalıydı, kuralın hesabı yok / pasif / ana hesap, döviz kasası hareketi için kur yok, ya da fiş tek satıra iniyor. Görevler'de "Ön muhasebe kaydı (…) yevmiye fişine çevrilecek" görevi ve sebebi vardır. Bu kayıtlar mizanda **yoktur** — bu bir denge sorunu değil, eksiklik uyarısıdır; rozet yine "Mizan dengeli" der.
- **Çözüm:** sebebi düzeltin (Kurallar → hesap; Hesap planı → etkinleştir; Kasa → Döviz kurları), Genel muhasebe → **Ayarlar → Eşitle** (dönem) çalıştırın; sonuç kutusunda Hata 0 ve Kalan 0 olunca uyarı kalkar. Rozet gerçekten "Mizan dengesiz" diyorsa (normal işletimde görülmez) o günün fişlerini Yevmiye'de inceleyip teknik ekibe bildirin.

### KDV oranına göre ayrı hesap nasıl açarım?

- **Cevap:** Hesap planı → **Hesap ekle**: `391.10 Hesaplanan KDV %10`, `391.20 Hesaplanan KDV %20` (üst hesap `391`; alt hesap açılınca `391` satır almaz olur — `391`'in geçmiş satırı varsa alt hesap açılamaz, o zaman `392` gibi boş bir ana hesabın altını kullanın ya da `192.10` / `192.20` örneğindeki gibi başka hesabı seçin). Sonra Kurallar → "Hesaplanan KDV" kartı → **Oran ekle** "10" → `391.10`, "20" → `391.20`; "Bütün oranlar" satırı listede olmayan oranlar için kalır. İndirilecek KDV için aynı yol ("İndirilecek KDV" kartı; ör. `192.10` / `192.20`). Kural **yalnız yeni fişleri** etkiler.

### Kasa / banka hesabı açtım, hesap planında nereye düştü?

- **Cevap:** Ön muhasebede kasa açılınca `100 Kasa` altında, banka açılınca `102 Bankalar` altında **ilk boş alt kod**la hesap kendiliğinden açılır (`100.01`, `100.02`, `102.01`…); adı ön muhasebedeki ad + para birimi ("Resepsiyon kasası (TRY)", "Döviz kasası (EUR)"). Kurallar → "Kasa / banka hesabı" kartında her kasa / bankanın hangi yevmiye hesabına bağlı olduğu görünür; başka bir yaprak hesaba bağlayabilirsiniz. Hesap planı henüz yüklenmemişken açılan kasalar ilk yüklemede toplu açılır. Adı Hesap planı'ndan düzenleyebilirsiniz; kodu değişmez.

### Açılış bakiyeleri neden 500 Sermaye'ye gidiyor, nasıl değiştiririm?

- **Cevap:** Ön muhasebedeki açılış fişleri (cari devri, kasa / banka devri) yevmiyede karşı hesap ister; bir bilanço olmadığı için varsayılan kural "Açılış bakiyesi karşı hesabı" = `500 Sermaye`'dir. Böylece açılışlar dengeli yazılır ve hangi hesaba gitmesi gerektiğine siz karar verirsiniz. Değiştirmek için Kurallar → "Açılış bakiyesi karşı hesabı" → başka bir yaprak hesap (ör. `570 Geçmiş Yıllar Kârları`, ya da geçiş döneminde bir `9xx` nazım hesabı) → Kaydet; bundan sonraki açılış fişleri oraya gider. Yazılmış açılış fişleri için: açılış bilançosunu elle fişle dağıtın (`500` borç / `570`, `102.xx`, `120.xx`… alacak gibi) ya da yevmiye fişini iptal edip doğru satırlarla elle girin.

### Bordro gideri hangi hesaba gidiyor?

- **Cevap:** Bordro onaylanınca tahakkuk fişinde **işveren maliyeti** "Personel gideri (departman)" kuralına göre borç yazılır: varsayılan `770 Genel Yönetim Giderleri`; Kurallar → "Personel gideri (departman)" kartında her bordro departmanı için ayrı hesap seçilebilir (ör. Mutfak → `740.01`, Kat hizmetleri → `740.02`, departmansız → "Diğer" satırı). Tutar personelin işveren maliyetiyle (brüt + SGK işveren payı − indirimler) departmanlara ağırlıklı bölünür. Alacak tarafı: `335` net ücret, `361` SGK, `360` gelir ve damga vergisi, `369` BES, `336` icra / nafaka ("Bordro yükümlülükleri" kuralı). Maaş ödemesi `335` borç / `102.xx` alacak. Kural değişikliği yalnız sonraki bordrolara uygulanır.

### Bordro onaya gidemiyor / hesaplanamıyor

- **Belirti:** "parametre seti teyit edilmedi", "önceki ay onaylı değil", "yeniden hesaplanmalı", "ay kilitli".
- **Sebep / çözüm:** Bordro → Ayarlar → parametre setini resmî kaynakla karşılaştırıp **Teyit ettim**; yılın önceki aylık bordrolarını sırayla onaylayın (yıl içi birikmiş matrah onaylı bordrolardan gelir; yıl ortasında geçişte matrah devri girilir); girdi değiştiyse **Hesapla**'ya yeniden basın; onaylı ayı düzeltmek için **fark bordrosu**. Elden ödeme yalnız kasadan ve kasa eksiye düşmez; ödeme tarihi bugünü geçemez. Hazırlayan onaylayamaz.

### Demirbaş kartı düzenlenemiyor / amortisman kaydedilemiyor

- **Belirti:** "finansal alanlar kilitli", "yıllar ardışık kaydedilir", "gelecek yıl kaydedilemez", "elden çıkarma tarihi kapanmış yıla düşüyor", "yalnız son yıl geri alınır".
- **Sebep:** VUK kuralları: kaydedilmiş yıl kilitlidir; alış / tutar / ömür / açılış değişmez; elden çıkarma kaydedilen son yıldan sonra olmalı; yalnız son yıl geri alınır ve o yıldan sonra elden çıkarılan kart varsa alınamaz.
- **Çözüm:** Demirbaş → Amortisman → son yılı **Geri al**, düzeltin, yeniden **Kaydet**.

## İK (izin, vardiya, puantaj, özlük)

### İzin bakiyem neden 28 gün? / Bakiyem yanlış görünüyor

- **Cevap:** Yıllık izin hakkı 4857 sayılı İş Kanunu md. 53'e göre **her tamamlanan hizmet yılında**, işe giriş gününüzün yıl dönümünde doğar: 1–5 yıl için yılda 14 gün, 5'ten çok 15'ten az yıl için 20, 15 yıl ve üstü için 26; 18 yaşından küçük ve 50 yaşından büyük çalışana en az 20. 15.01.2024'te işe giren biri 15.01.2025'te 14, 15.01.2026'da 14 gün daha kazanır → **28**. Bakiye = hak + İK'nın elle düzeltmeleri − onaylı yıllık izinleriniz (ileri tarihli onaylı izinler de düşer); onay bekleyen talepler "kullanılabilir"den düşer. İlk yılınız dolmadan hak yoktur. Rakam beklediğinizden farklıysa İK'dan personel kartınızdaki **işe giriş** ve **doğum tarihini** kontrol etmesini, önceki sistemden devreden izni **düzeltme** olarak girmesini isteyin (İK → İzin bakiyeleri → satır → ayrıntı penceresinde hak kayıtları ve düzeltmeler yıl yıl görünür).

### Yarım gün izin alabilir miyim?

- **Cevap:** İzin talebi gün bazındadır; başlangıç ve bitiş günü seçilir, yarım gün seçeneği yoktur. Yarım gün için İK, İzin bakiyeleri → **Düzeltme ekle** ile `-0,5` gün ve gerekçe ("05.12 öğleden sonra izin") girer; puantajda o gün **Geldi** ve gerçek giriş / çıkış saatleriyle yazılır. Düzeltme bir ondalık kabul eder (`-1,5`, `2,5`).

### Raporu (istirahat) kim girer?

- **Cevap:** **İK** girer: İK → İzinler (`/ik/izinler`) → **İzin gir** → personel, tür "Rapor (istirahat)", rapordaki başlangıç ve bitiş. Rapor **takvim günüyle** sayılır (hafta tatili düşmez), yıllık izin bakiyesinden düşmez, bordroya **eksik gün** (SGK kodu 01) olarak gider. İK ayarında izin onayı açıksa rapor da onay kuyruğuna gider ve İK kendi girdiğini onaylayamaz; kapalıysa doğrudan onaylıdır. Raporun taranmış hâlini Belgeler'e yükleyebilirsiniz. Personel teknik olarak İzinlerim'den rapor talebi de açabilir, ama belge İK'ya gelmeden onaylanmamalıdır.

### Vardiya uyarısı kaydı engeller mi?

- **Cevap:** **Hayır**, iki vardiya arasında 11 saatten az dinlenme ve haftalık normun (varsayılan 45 saat) aşılması yalnız **uyarıdır**: kayıt yazılır, çip ve satır toplamı sarı olur, çizelgenin üstünde "Çizelgede uyarı var" kutusu çıkar. Otelcilikte denkleştirme yaygın olduğu için karar yöneticiye bırakılmıştır. **Engelleyen tek kural çakışmadır**: aynı personelin iki vardiyası üst üste binemez (`SHIFT_OVERLAP`, ör. 22:00–06:00 gece vardiyasından sonra ertesi gün 05:00'te başlayan vardiya). Vardiya ayrıca sıfır ya da 16 saatten uzun olamaz.

### Puantaj bordroya nasıl gider? Onaylı ayda ne olur?

- **Cevap:** Kendiliğinden gitmez. Ay sonunda İK → Puantaj (`/ik/puantaj`) → **Bordroya aktar** → ay seçilir. Her personel için eksik gün (gelmedi + rapor / ücretsiz / doğum izni), eksik gün nedeni (tek neden kodu ya da karışıksa 12), çalışılan gün, fazla çalışma saati, bayram ve hafta tatili çalışması hesaplanıp Bordro → Puantaj ve kalemler satırına **kaynak TIMESHEET** ile yazılır; o ayın elle girilmiş satırının yerine geçer. Hesaplanmış bordro varsa "yeniden hesaplanmalı" olur: **Hesapla**'ya yeniden basın. Ayın bordrosu **onayda ya da onaylıysa** ay kilitlidir: aktarım, o ayın puantaj yazımı ve o aya dokunan onaylı izin iptali "ay kilitli" (`PAYROLL_MONTH_LOCKED`) ile reddedilir. Düzeltme fark bordrosuyla yapılır (Bordro → fark bordrosu, kalem olarak).

### Özlük belgesi yükleyemiyorum

- **Belirti:** "Dosya çok büyük (en fazla 5 MB)", "Dosya PDF, JPEG, PNG ya da WebP olmalı", "Dosya türü bildirilenle uyuşmuyor".
- **Sebep / çözüm:** Dosya en fazla **5 MB** ve yalnız **PDF, JPEG, PNG, WebP** olabilir. Sunucu türü dosyanın içinden okur; uzantısı değiştirilmiş dosya (ör. `.png` adı verilmiş PDF) reddedilir. iPhone'un HEIC fotoğrafını JPEG olarak paylaşın / kaydedin, Word belgesini PDF'e çevirin, büyük taramayı düşük çözünürlükte yeniden tarayın ya da sıkıştırın. Yükleme için `hr.manage` gerekir. Dosya hazır değilse belgeyi dosyasız kaydedip (tür, bitiş tarihi) süre takibini başlatabilirsiniz.

### "Kullanıcı hesabınız bir personel kartına bağlı değil"

- **Cevap:** İzinlerim sayfası oturumdaki kullanıcının personel kartını bulamadı. İK, Personel → kartınızda **Kullanıcı hesabı** alanına kullanıcınızı bağlamalı. Bağdan sonra sayfayı yenileyin.

## Stok ve satın alma

### Stok eksiye düştü

- **Belirti:** Stok → Mevcut'ta kırmızı eksi (ör. levrek −0,4 kg).
- **Sebep:** **yalnız satış düşümü eksiye inebilir** — adisyon gerçektir, stok kaydı geride kalmıştır (mal kabul girilmemiş, yanlış depo eşlemesi, reçete miktarı hatalı). Elle çıkış / fire / transfer mevcuttan fazla çıkamaz (`INSUFFICIENT_STOCK`).
- **Çözüm:** bekleyen mal kabulü girin; Stok → Depolar'da satış noktası → depo eşlemesini kontrol edin; reçeteyi gözden geçirin; ay sonunda **sayım** gerçek mevcudu yazar (sayım farkı eksiye de inebilir). Depo yok / pasifse satış düşümü "Stok" manuel görevine düşer (adisyon numarasıyla; elle çıkışla tamamlanır).

### Sayım onaylanamıyor / sayım açılamıyor

- **Belirti:** "depoda açık sayım var", "başkası değiştirdi", onayda beklenmedik farklar.
- **Sebep:** depoda **tek açık sayım** olabilir; satır yazımı sürüm damgalıdır (iki sayımcı); **fark = sayılan − onay anındaki mevcut** (açılıştaki beklenen değil — sayım sürerken satış sürer).
- **Çözüm:** önce eski sayımı onaylayın ya da iptal edin (iptal hiçbir şeye dokunmaz); onaydan hemen önce son satışlardan sonra kritik satırları yeniden sayın; sayılmayan satıra dokunulmaz. Demirbaş sayımında eksikler kendiliğinden düşmez — elden çıkarma ayrı yetkili işlemdir.

### Minimum altı önerisi gelmiyor / sürekli geliyor

- **Sebep:** öneri yalnız **miktarı düşen** hareketlerden sonra ve minimumun altına inenler için tek talep açar; **açık talep "talep edilen"e sayıldığı için aynı malzeme yeniden önerilmez**; talep iptal edilince bir sonraki hareket yeniden önerir. Yoldaki siparişler düşülür. Stok aktörü kapalıyken öneri sessizce atlanır (Satın alma → min. stok önerileri ekranı aynı hesabı her an gösterir).
- **Çözüm:** Satın alma → Talepler'de açık STOCK talebini kontrol edin; Stok → Mevcut'ta minimum seviyeyi düzenleyin.

### Teklif turu / sipariş hataları

- **Belirti:** "satırlar değişti" (`LINES_CHANGED`), "ucuz teklif seçilemiyor", "süresi dolmuş teklif", "sipariş onay bekliyor".
- **Sebep:** tur açılırken sunucu talepleri kilitleyip yeniden toplar — bu arada biri satır değiştirdiyse yeniden açılır; **ihtiyaca yetişmeyen (geç) teklif önerilmez**, en uygun dışı seçim gerekçe ister; süresi dolmuş teklif / pasif tedarikçi seçilmez; KDV dahil tutar politika eşiğinde / üstünde → `PURCHASE_ORDER` dört göz (isteyen onaylayamaz; 3 gün karar yoksa reddedilmiş sayılır, satırlar tura döner).
- **Çözüm:** turu yenileyin; gerekçe yazın; müdür onaylar. Mal kabulde teslim alınan ≤ sipariş (+%5 tartılan malzeme); eksik kalan "eksik kapat" ile kapanır.

## Kanallar ve dış dünya

### Kanal senkronu başarısız

- **Belirti:** Kanallar → kanal kartı kırmızı; Senkron logu'nda hata; müdüre `CHANNEL_SYNC` zili; OTA'da fiyat / müsaitlik eski.
- **Sebep:** Channex **429** (hız sınırı: dakikada 10 + 10) → 1 dk bekleme; **anahtar hatası** → 30 dk bekleme ve uyarı; geçici hata → 30 sn × 2ⁿ (en çok 15 dk); kanalın reddettiği satırlar "kısmen"; eşleştirme eksik (oda tipi / fiyat planı eşlenmemiş → kart "eksikler" listeler); kanal aktörü kapalı (gönderim atlanır, gelen rezervasyon göreve düşer).
- **Çözüm:** kanal kartı → **Ayarlar**'da bağlantıyı yeniden doğrulayın (anahtar, mülk); **Eşleştirme**'yi tamamlayın; **Elle senkron** (tam eşitleme 500 gün); logdaki ayrıntı penceresinde görev kimliklerini Channex desteğine iletin. iCal içe aktarma: yalnız https, 2 MB / 15 sn sınırı, özel ağa çözülen adres reddedilir; takvim birden boş gelirse toplu iptal yapılmaz (uyarı).

### OTA rezervasyonu "elle işlenmeli" / "doğrulanmalı"

- **Sebep:** eşleşmeyen fiyat planı, misafir içeride / çıkmış, geçmiş giriş tarihi, elle fiyatlı rezervasyonun tarihi değişti → **elle işlenmeli** (Görevler'de "Kanal rezervasyonu"); para birimi farkı ve iCal tutarı → **doğrulanmalı** (fiyat geçici sistem fiyatı).
- **Çözüm:** resepsiyon gereğini yapar (rezervasyonu açar / düzenler), kanal kartı → Rezervasyonlar'da kaydı **notla kapatır**. Overbooking uyarısı: OTA rezervasyonu yer yoksa da açılır; misafiri başka tipe / otele planlayın.

### Web widget çalışmıyor

- **Belirti:** sitede takvim yüklenmiyor, 403 / 404.
- **Sebep:** site adresi **izinli siteler** listesinde değil (403); motor kapalı ya da anahtar yanlış (ikisi de 404); hız sınırı (okuma 30 / dk, yazma 5 / dk).
- **Çözüm:** Ayarlar → Mesaj kanalları → Web chat: izinli sitelere alan adını ekleyin, "rezervasyon motoru" açık olsun, gömme kodunu yeniden kopyalayın. Misafir portalı adresi de izinli sitelerde olmalı (portalda sohbet için).

### Misafir portalı / oda servisi QR bağlantısı geçersiz

- **Sebep:** bağlantı imzalıdır ve **oda değişince, çıkışta, yenilenince** eskisi geçersiz olur; portal bağlantısı iptal / gelmedi ve çıkıştan 14 gün sonra kapanır; misafir siparişi politikada kapalı ya da konaklamada 3 açık sipariş sınırı; otel Wi-Fi'ında hız sınırı bağlantı başınadır (IP değil).
- **Çözüm:** rezervasyon detayı → portal kartı → **Yenile** ve yeni QR; oda servisi bağlantısı rezervasyondan yeniden verilir.

### WhatsApp mesajı "gönderilemedi"

- **Sebep:** Meta'nın **24 saat penceresi** kapalı (misafir 24 saattir yazmadı) → serbest metin gönderilemez; webhook imzası / token hatalı; geçit kapalıyken yazılan cevaplar "gönderim bekliyor"da durur ve açılışta dakikada bir işle gönderilir.
- **Çözüm:** misafir yazınca pencere açılır; Ayarlar → Mesaj kanalları → WhatsApp bilgilerini ve Meta panelindeki webhook adresini kontrol edin.

## Veri yükleme ve gün kapanışı

### Excel yükleme hataları

- **Belirti:** sihirbazda satırlar "hatalı"; "zaten var"; "çakışan fiyat planı"; hiçbir şey yüklenmedi.
- **Sebep:** yükleme **ya hep ya hiç**tir — tek hatalı satır bütün dosyayı durdurur. Sık hatalar: tarih biçimi (GG.AA.YYYY ya da ISO), tutar biçimi ("2.500,00"), pansiyon / belge türü kodu ya da adı tanınmıyor, TC kimlik sağlaması, sütun eşleştirmesi yanlış (sihirbaz başlık adından önerir, eş anlamlılarla). **Misafir:** mevcut kişi **atlanır ve raporlanır** (karta dokunulmaz); dosyada tekrar eden kişi bir kez. **Fiyat planı:** mevcut planla **çakışan satır reddedilir** (habersiz fiyat değişmez). **Demirbaş:** kategori / alan / sicil adları tanımlarla birebir eşleşmeli, 1000 satır sınırı. **Bütçe:** şablon kod sütunuyla eşleşir, 1 MB sınırı, yüklenen değer "kaydedilmemiş değişiklik" olarak gelir.
- **Çözüm:** şablonu ekrandan indirip doldurun; önizlemedeki satır hatalarını düzeltip yeniden yükleyin. Aynı yükleme kimliğiyle ikinci gönderim ikinci kez yazmaz. Yetki: misafir `guests.manage`, fiyat planı `settings.manage`, demirbaş `assets.manage`.

### Gün kapanışı yapılamıyor

- **Belirti:** "gün gelmedi" (`DAY_NOT_ARRIVED`), "zaten kapatıldı" (`ALREADY_CLOSED`), "kapanış sürüyor", oda ücretleri işlenmedi, iş günü ilerlemiyor.
- **Sebep:** takvimden ileri gün kapatılamaz; aynı gün iki kez kapatılamaz; **başka görevli kapanışı başlatmış** (IN_PROGRESS — iki görevli aynı anda kapatamaz); iş günü **yalnız kapanışla ilerler** — kapanış yapılmadığı her gün sistem "bugün"ü eski günde tutar (oda ücretleri kuyrukta bekler, gelecekler listesi kaymaz).
- **Çözüm:** Gün kapanış → Kapanış'ı tek kişi yürütsün; birikmiş günler varsa **sırayla** her günü kapatın (her kapanış kendi gecesinin oda ücretlerini ve gelmeyenlerini işler; sunucu kapalı kalmışsa geçen geceler ilk çalışmada telafi edilir). Kasa sayımı farkı kapanışı engellemez; onay bekleyen ödemeler ayrıca listelenir. Kurlar kapanış sırasında girilebilir.

### Rapor ve bütçe rakamları tutmuyor

- **Sebep:** gelir raporu, panel, bütçe ve gün kapanışı **aynı tanımları** kullanır (satılabilir = oda − arızalı; hizmet dışı paydada kalır; gelir vergiler hariç; gece fiyatları gece tablosundan). Bütçe gerçekleşeni **yalnız kapanmış günleri** sayar; içinde bulunulan ayın planı kapanmış gün oranında; tahsilat onay bekleyenleri saymaz; **gider gerçekleşeni elle** girilir (satın alma / ön muhasebeden otomatik beslenme yol haritasında). Rapor tasarımcısı kayıt anlarını otelin saat diliminde güne çevirir.
- **Çözüm:** gün kapanışlarının güncel olduğundan emin olun; bütçede yılın onaylı bütçesi yoksa taslak kullanılır (işaretli).

## Sadakat programı

### Misafirin folyosu kapandı ama puan gelmedi

- **Sebep / çözüm:** Hesap sayfasında (Sadakat → **Üyeler** → misafir) ya da misafir kartının sadakat kutusunda sırayla şunlara bakın:
  1. **Program açık mı?** Sadakat → **Ayarlar** (`/sadakat/ayarlar`) sayfasında **Program açık** işaretli olmalı. "Program henüz kurulmadı" uyarısı varsa program hiç kaydedilmemiştir.
  2. **Misafir üye mi?** Otomatik üyelik kapalıysa yalnız üye yapılan misafir kazanır. Misafir kartında "Üye değil" yazıyorsa önce **Üye yap** (açık rızayla). O folyonun puanı kendiliğinden gelmez; müdür gerekçeli **Düzeltme** ile ekleyebilir.
  3. **Folyo acente / voucher ödemeli mi?** Ayar açıkken bu folyolar puan kazanmaz. Hareket açıklamasında "acente / cari ödemeli folyo puan kazanmaz" yazar.
  4. **Doğru misafir mi?** Puanı rezervasyon sahibi kazanır. Refakatçi kazanmaz, mükerrer kart da ayrı hesap demektir.
  5. **Aktör açık mı?** Görevler'de "Kapanan folyonun sadakat puanı yazılacak" görevi varsa sadakat aktörü kapalıdır (Yönetim → Aktörler). Görev hesap sayfasında elle düzeltmeyle tamamlanır.

  Tutar beklediğinizden azsa unutmayın: vergi kalemleri sayılmaz, indirimler düşülür ve küsurat aşağı yuvarlanır (2.489,99 TL → 248 puan).

### "Bu folyoda en çok N puan kullanılır" / "Puan kullan" düğmesi çalışmıyor

- **Sebep / çözüm:** Bir folyoda en çok, folyo harcamasının ayardaki yüzdesi (varsayılan %50) kadar puan kullanılır. 2.000 TL'lik folyoda 1.000 TL, yani 0,50 TL'lik puanla **2.000 puan** kullanılabilir. Bakiye daha azsa sınır bakiyedir. Bu sınır en az kullanımın (varsayılan 100) altında kalıyorsa satırda 0 görünür. Folyoya harcama işlendikçe sınır büyür. Satır hiç yoksa konaklamanın **açık folyosu** yoktur: puan girişten sonra, çıkıştan önce kullanılır (`LOYALTY_NO_OPEN_FOLIO`). Düğme hiç görünmüyorsa `loyalty.redeem` izniniz yoktur (Muhasebe rolü yalnız görür).

### Yanlış puan indirimi yaptım, nasıl geri alırım?

- **Cevap:** Folyodan indirim kalemine **iptal** isteyin. İptal dört göz onayıyla kesinleşince sadakat aktörü puanı kendiliğinden iade eder ("Harcama iade edildi"). Puan düşüldüğü paketlere döner, son kullanma günleri değişmez. Ardından doğru tutar ve gelir türüyle yeniden **Puan kullan** penceresini açın. Hesaba ayrıca elle artı düzeltme girmeyin; yoksa puan iki kez döner. Çift tıklamadan korkmayın: aynı pencereden gelen ikinci gönderim ikinci kalem açmaz.

### Misafirin seviyesi neden düştü? / Puanı neden azaldı?

- **Cevap:** Seviye **son 12 ayda kazanılan** puana göre hesaplanır ve pencere her gün kayar. Misafir bir yıl gelmezse eski kazanmalar pencereden çıkar ve seviye düşer; bakiye bundan etkilenmez. Harcanan puan seviyeyi düşürmez, ama geri alınan kazanma (folyo yeniden açıldı) düşürür. Bakiyenin azalmasının sebebi hareketler tablosunda yazar: "Süresi doldu" (kullanılmayan puan ayardaki ay sonunda düşer, varsayılan 24 ay; **Sadakat puan süresi** işi 12 saatte bir çalışır), "Kazanma geri alındı" (folyo yeniden açıldı) ya da "Elle düzeltme" (gerekçesiyle). Süresi 30 gün içinde dolacak puan misafir kartında önceden uyarı olarak görünür.

### Kazanma oranını ya da seviye eşiklerini değiştirirsem eski puanlar ne olur?

- **Cevap:** Değişmez. Yeni oran, çarpan ve puan değeri bundan sonraki işlemlere uygulanır. Kazanılmış puan aynı sayıda kalır, ama kullanılırken **yeni puan değeriyle** TL'ye çevrilir; puan değerini düşürmek dolaşımdaki puanın karşılığını da düşürür (Üyeler → "Karşılığı" kutusu). Seviye eşiği değişince üyelerin seviyesi bir sonraki harekette ya da 12 saatlik işte yeniden hesaplanır; yükselenler için zil çalar. Ayarı kaydetmek için `loyalty.manage` gerekir; kayıt denetim izine düşer.

## Genel kullanım soruları

**Bir işi kimin yaptığını nasıl bulurum?** Aktivite → Canlı akış (zincir kimliği ile aktör işleri) ve Aktivite → Denetim kaydı (personel işlemleri; kimlik numaraları maskeli). Folyo kalemi, ödeme, fiş, fatura, demirbaş kartı kendi zaman çizelgesini / hareket geçmişini taşır.

**Sildiğim kayıt nerede?** Hiçbir para kaydı silinmez; iptal **ters kayıttır** ve üstü çizili görünür. Tanımlar (menü ürünü, kategori, alan, hizmet) silinmez, **pasife alınır**. Demo verisi dışında silme yoktur.

**İki kişi aynı anda aynı şeyi yaparsa?** Satır kilidi + sürüm damgası: biri kazanır, diğeri "başkası değiştirdi" ya da "zaten karara bağlandı" (409) görür. Son oda, aynı adisyon, aynı görev, aynı onay, aynı sayım satırı — hepsi testli.

**Sunucu kapandı, işler kayboldu mu?** Hayır. Olaylar işlem içinde kuyruğa yazılır; aktörler yeniden başlayınca kaldığı yerden sürer; oda ücreti geceleri telafi eder; e-belge ve bildirim göndericileri takılı kalan kaydı süre sonra sıraya geri koyar.

**Demo verisi nasıl sıfırlanır?** Sistem yöneticisi demo betikleriyle (sunucu tarafı). Canlı otelde demo folyoları canlıya alırken temizlenmeli (yedekle, onayla).

**Canlıya alırken unutulmaması gerekenler (özet):** `OPENAI_API_KEY` (AI için), `SETTINGS_SECRET_KEY` (kanal parolaları), nginx yolları (`/socket.io/`, `/webhooks/`, `/webchat/`, misafir uygulaması `/misafir/`), otel saat dilimi ve para birimi, büyük ödeme eşiği (varsayılan 0 = onay yok), döviz kurları (personel girer), fatura satıcı + faturalama başlangıcı + seriler, muhasebe başlangıç günü + açılış bakiyeleri + tahsilat eşlemesi, bordro işyeri + parametre teyidi, portal adresi, SMS kanalı, Channex hesabı.

## Modül durumu tablosu

Durum sözlüğü: **Tamam** = görev listesindeki maddelerin tümü işaretli ve tamamlanma notu var; **Kısmi** = çekirdek çalışıyor, bazı maddeler bilinçli olarak sonraya bırakılmış (not sütununda); **Planlı** = yol haritasında, kod yok (ya da yalnız iskelet). Kaynak: MODUL-SIRASI.md ve GOREVLER.md'deki işaretler (24 Kasım 2026).

### 1. Ön büro (temel)

| No | Modül | Aktör | Durum | Not |
| --- | --- | --- | --- | --- |
| 1 | Ayarlar / parametreler | manuel | Tamam | Otel, oda tipleri, vergiler, sezonlar, genel parametreler |
| 2 | Kullanıcı, rol, yetki (RBAC) | manuel | Tamam | JWT, rol → izin matrisi, izne göre gizlenen menü |
| 3 | Oda tipi müsaitlik & oda atama | room-worker | Tamam | Üç parçalı oda durumu (doluluk / kat hizmeti / arıza kaydı) |
| 4 | Rezervasyon yönetimi | reservation-worker | Tamam | Grup, bekleme listesi, overbooking politikası |
| 5 | Oda planı / takvim | room-worker | Tamam | Sürükle-bırak oda değişikliği |
| 6 | Check-in / Check-out | reservation + room-worker | Tamam | Çıkışta ödeme bağlantısı 17 ile geldi |
| 7 | Misafir mesajları / istek takibi | concierge-agent | Tamam | Gelen kutusu, istekler, SLA |
| 8 | WhatsApp / web chat ile rezervasyon | concierge-agent | Tamam | AI yalnız `OPENAI_API_KEY` varsa; WhatsApp bildirim şablonu (otelin başlattığı) yok |
| 9 | Bildirim merkezi | notification-worker | Kısmi | SMS (Netgsm) ve uygulama içi çalışır; **e-posta geçidi gerçek gönderici değil**; WhatsApp bildirimi 8'e bırakıldı |
| 10 | Aktör Activity Feed + audit log | sistem | Tamam | |
| 11 | Onay kuyruğu | sistem | Tamam | Dört göz, süre dolumu, devam isteyen aktöre |
| 12 | Aktör yönetim paneli | sistem | Tamam | Manuel görevler, LLM kullanım kartı |
| 13 | Günlük durum ekranı | manuel | Tamam | |

### 2. Ön büro (operasyon + para)

| No | Modül | Aktör | Durum | Not |
| --- | --- | --- | --- | --- |
| 14 | Housekeeping | housekeeping-worker | Tamam | Canlıya almadan önce dört düzeltme yapıldı |
| 15 | Folyo yönetimi | billing-worker | Tamam | |
| 16 | Fatura kesme | billing-worker | Tamam | Çekirdeği 49 içinde kuruldu |
| 17 | Ödeme alma | billing-worker (onaylı) | Tamam | Büyük ödeme eşiği varsayılan 0 |
| 18 | Vardiya / kasa kapama (night audit) | billing-worker | Tamam | İş günü kapanıştan okunur |
| 19 | Çamaşırhane & minibar | manuel | Tamam | |
| 20 | Teknik servis / arıza-bakım | manuel | Tamam | Periyodik plan, oda kapatma 3'e devredilir |
| 21 | Kayıp eşya | manuel | Tamam | |
| 22 | CRM & misafir kartı | manuel | Tamam | Tercih, not, birleştirme |

### 3. Raporlama

| No | Modül | Aktör | Durum | Not |
| --- | --- | --- | --- | --- |
| 23 | Gelir raporları | report-agent | Tamam | |
| 24 | Doğal dil raporlama | report-agent | Tamam | AI yoksa "rapor talebi" görevi; gerçek modelle canlıda ölçülmedi |
| 25 | Günlük durum — forecast | report-agent | Tamam | |
| 26 | Rapor tasarımcısı + Excel | manuel | Tamam | Kaynaklar: rezervasyon, folyo kalemi, misafir, ödeme |
| 27 | Bütçe yönetimi | report-agent | Tamam | Gider gerçekleşeni elle (45 / 47 bağı yol haritasında) |

### 4. Satış & dağıtım

| No | Modül | Aktör | Durum | Not |
| --- | --- | --- | --- | --- |
| 28 | Paket / pansiyon tipleri | manuel | Tamam | |
| 29 | Kontrat & acente | manuel | Tamam | |
| 30 | Grup & allotment | manuel | Tamam | |
| 31 | Promosyon & kupon | manuel | Tamam | |
| 32 | Online rezervasyon motoru | concierge + reservation-worker | Tamam | Onay e-postası e-posta geçidi yüzünden gitmez; ödeme adımı 50 ile; paket satışı sonra |
| 33 | Kanal yönetimi | channel-sync-worker | Tamam | Channex.io + iCal |
| 34 | Dinamik fiyat / yield | pricing-agent (onaylı) | Tamam | Kural tabanlı AI'sız çalışır; etkinlik takvimi / rakip fiyat girdisi sonra |
| 35 | Acente bonus | manuel | Tamam | |
| 36 | Call center & satış CRM | manuel | Tamam | |
| 37 | Banket / etkinlik | manuel | Tamam | Resmî fatura 49'da |

### 5. F&B / POS

| No | Modül | Aktör | Durum | Not |
| --- | --- | --- | --- | --- |
| 38 | Menü & reçete | manuel | Kısmi | Menü 39'da, reçete / maliyet 43'te yapıldı; **ürün görseli ve QR menü JSON'u yok** (QR menü sayfası 41 / 53 ile var) |
| 39 | Restoran POS | fnb-worker | Tamam | Olaylar yayında; tüketicileri 40 ve 44; mali fiş / ÖKC yok (74) |
| 40 | Mutfak ekranı (KDS) | fnb-worker | Tamam | |
| 41 | Oda servisi | fnb + billing-worker | Tamam | Misafir QR siparişi dahil |
| 42 | Online paket sipariş | fnb-worker | Kısmi | Personel girişi, kurye, pano tamam; **public sipariş sayfası ve platform entegrasyonu yok** (kullanıcı kararı) |
| 43 | Banket F&B planlaması | manuel | Tamam | |

### 6. Stok & satın alma

| No | Modül | Aktör | Durum | Not |
| --- | --- | --- | --- | --- |
| 44 | Stok & maliyet analizi | inventory-worker | Tamam | |
| 45 | Satın alma | inventory-worker | Tamam | Stok çekirdeği burada |
| 46 | Demirbaş & amortisman | manuel | Tamam | Otomatik amortisman fişi yok (elle yevmiye fişi girilir); zimmet tutanağı PDF'i sonra |

### 7. Muhasebe / ERP

| No | Modül | Aktör | Durum | Not |
| --- | --- | --- | --- | --- |
| 47 | Ön muhasebe | accounting-worker | Tamam | |
| 48 | Genel muhasebe | accounting-worker | Tamam | Tek Düzen hesap planı, otomatik yevmiye fişleri, günlük gelir fişi, mizan, ekstre, kurallar, dönem kilidi; e-Defter dosyası 49'da |
| 49 | e-Fatura / e-Arşiv / e-Defter | entegrasyon | Kısmi | Fatura + e-belge akışı tamam; **gerçek entegratör adaptörü yok (test entegratörü)**; **e-Defter dosyası (yevmiye / kebir XML) yok** — veri 48'de hazır |
| 50 | Sanal POS / ödeme geçidi | entegrasyon | **Planlı** | Portalda "kartla ödeme" pasif bekliyor |
| 51 | Personel & bordro | manuel | Tamam | Gider tarafı 48'de yazılır (tahakkuk fişi) |
| 52 | İK (izin, mesai, özlük) | manuel | Tamam | İzin talebi → onay (`LEAVE`) → bakiye (4857 md. 53), vardiya çizelgesi, günlük puantaj ve bordroya aktarım (TIMESHEET), özlük belgeleri ve hatırlatma; personel tablosu 51'de ortak. Puantaj cihazı / mobil giriş (76) ve otomatik vardiya planlama (88) yok |

### 8. Misafir deneyimi

| No | Modül | Aktör | Durum | Not |
| --- | --- | --- | --- | --- |
| 53 | Temassız (online check-in, portal) | concierge-agent | Kısmi | Portal, online check-in, folyo, QR menü tamam; **kart adımı 50'ye, dijital anahtar 62'ye bağlı (pasif)** |
| 54 | Misafir yorum entegrasyonu + duygu analizi | insight-agent | **Planlı** | |
| 55 | Anket & memnuniyet | notification-worker + insight-agent | Tamam | |
| 56 | Sadakat programı | loyalty-worker | Tamam | Folyo kapanınca puan (vergi hariç, indirim düşülmüş, seviye çarpanı; acente ödemeli hariç; spa kasası), yeniden açılınca geri alma; açık folyoda puanla indirim (611), iptalde iade; son 12 aya göre seviye ve yükseliş zili (`LOYALTY`); süre dolumu (12 saatlik iş, FIFO); elle düzeltme; misafir birleştirmede hesap birleşir; portal kutusu. Kampanya / bonus puan kuralları, puanla oda satışı ve zincir genelinde ortak hesap yok |
| 57 | SPA & spor salonu | manuel | Tamam | |

### 9. Yasal & entegrasyon, 10. Dikey paketler

| No | Modül | Durum | Not |
| --- | --- | --- | --- |
| 58 | Emniyet kimlik bildirimi (KBS) | **Planlı** | Check-in'de kimlik alanları KBS'ye uygun toplanır, bildirim gönderilmez |
| 59 | Kimlik / pasaport okuma (OCR) | **Tamam** | |
| 60 | Çoklu dil & çoklu para birimi | **Planlı** | Misafir portalı ve widget metinleri çok dilli hazır; panel Türkçe; döviz yalnız ödemede |
| 61 | Webhook & açık API | **Planlı** | |
| 62 | Donanım entegrasyonları | **Planlı** | |
| 63 | Multi-tenant zincir konsolu | **Planlı** | Veri modeli otel kapsamlı; konsol yok |
| 64–68 | Apart, yurt, devremülk, marina, klinik | **Planlı** | |

### FLEXAI 2.0 (69–104)

Tamamı **planlı**dır; kod yok. Başlıklar: 69–74 sağlam zemin (göç sihirbazı, kesintisiz çalışma, güvenlik / 2FA / SSO, gözlem ve lisans, mobil temel, yazarkasa / e-Adisyon); 75–79 sahip ve okul (patron uygulaması, personel mobil, Akademi, staj ağı, uygulama içi yardım); 80–84 lüks misafir deneyimi (misafir tanıma, servis kurtarma, concierge masası, upsell, ödeme güvencesi / hediye çeki); 85–89 otonom operasyon (otomasyon stüdyosu, işlem yapan asistan + MCP, gece müdürü ajanı, işgücü planlama, akıllı oda / enerji); 90–93 gelir ve kârlılık (no-show tahmini, rakip fiyat, kontrat kârlılığı, USALI); 94–97 uyum ve finans otomasyonu (uyum merkezi, gelen e-belge, dış muhasebe aktarımı — Logo / Mikro / Netsis / Luca, banka mutabakatı); 98–101 resort ve dağıtım (tur operatörü, tesis rezervasyonu, acente B2B portalı, sesli santral); 102–104 kalite, sürdürülebilirlik, anonim pazar karşılaştırması. Mevcut modüllerde bunlara yer bırakılmıştır (ör. fiyat önerisinin yapılandırılmış girdileri, gün kapanışı olayı, portalın sayfa kaydı).

### Özet sayılar

- 1–68 arası: **52 tamam**, **6 kısmi** (9, 38, 42, 49, 53 ve e-posta bağımlılığıyla 32'nin bildirim adımı), **10 planlı** (50, 54, 58–63, 64–68 dikey paketler tek satırda sayılırsa).
- Otelin **günlük operasyonu** (rezervasyon → giriş → folyo → ödeme → çıkış → fatura → muhasebe; restoran → stok → satın alma; kat hizmetleri, teknik servis, anket, spa) uçtan uca çalışır.
- **Dış dünyaya bağlanan** parçaların bir kısmı taslaktır: e-posta gönderimi, e-belge entegratörü, online kart ödemesi, KBS. Ekranlar bunu açıkça söyler; "gönderildi" gibi görünen ama gitmeyen hiçbir şey yoktur.
