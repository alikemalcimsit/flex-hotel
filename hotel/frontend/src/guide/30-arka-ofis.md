# Arka ofis: fatura, muhasebe, bordro, demirbaş

Bu bölüm otelin **para ve kayıt tarafını** anlatır: kesilen faturalar ve e-belge takibi, ön muhasebe (cariler, kasa / banka, çek / senet, fişler), personel ve bordro, demirbaş sicili ve amortisman. Hedef okuyucu muhasebe ve insan kaynakları personeli ile sistemi tanımak isteyen yöneticidir.

Dört modül birbirine bağlıdır ve çoğu kayıt **kendiliğinden** oluşur:

- Misafir çıkış yapıp folyosu kapanınca **fatura taslağı** açılır (folyo aktörü).
- Alınan her ödeme, mal kabul, acente primi, etkinlik bedeli ve bordro **ön muhasebeye** işlenir (muhasebe aktörü).
- Onaylanan bordro personel, SGK, vergi dairesi carilerine tahakkuk eder; maaş ödemesi kasadan / bankadan çıkar.
- Demirbaş personele zimmetlenir; işten çıkışta zimmet uyarısı bordro ekranında görünür.

Önce her ekranın nerede olduğunu, sonra adım adım nasıl kullanılacağını, en sonda da arka planda hangi aktörün neyi otomatik yaptığını okuyacaksınız. Bölümün sonunda sık yapılan hatalar ve bilinçli olarak henüz yapılmamış işler listelenir.

## Genel bakış: ekranlar ve yetkiler

| Alan | Menü yolu | Adres | Görmek için izin | Yazmak için izin |
| --- | --- | --- | --- | --- |
| Faturalar | Ön büro → Faturalar | `/faturalar` (Faturalanacaklar, Taslaklar, Kesilenler, Ayarlar) | `invoices.view` | `invoices.issue` (folyo / etkinlik faturası kesme, tekrar gönderme), `invoices.manage` (serbest fatura, satır düzenleme, iptal isteği), `invoices.setup` (ayarlar) |
| Ön muhasebe | Ön büro → Ön muhasebe | `/muhasebe` (Cariler, Yaşlandırma, Kasa / banka, Çek / senet, Fişler, Ayarlar) | `accounting.view` | `accounting.manage` (fiş, çek / senet işlemi, cari kartı, eşitleme), `accounting.setup` (tanımlar, eşleme, başlangıç günü, açılış bakiyesi, fiş iptali) |
| Personel | Ön büro → Personel | `/personel`, `/personel/:id` | `employees.view` ya da `payroll.view` | `employees.manage` (kart), `payroll.manage` (ücret alanları, avans, icra, çıkış) |
| Bordro | Ön büro → Bordro | `/bordro` (Bordrolar, Puantaj ve kalemler, Servis payı, Ayarlar), `/bordro/:id` | `payroll.view` | `payroll.manage` (puantaj, kalemler, hesapla, onaya gönder), `payroll.pay` (maaş / avans ödemesi), `payroll.setup` (parametreler, işyeri, kalemler, departmanlar) |
| Demirbaş | Ön büro → Demirbaş | `/demirbas` (Demirbaşlar, Sayım, Amortisman, Garanti, Tanımlar) | `assets.view` (sayım için `assets.count`) | `assets.manage` (kart, Excel, taşıma, zimmet, etiket, sayım aç / kapat, tanımlar), `assets.finance` (yıl amortismanı kaydet / geri al, elden çıkarma) |
| Bütçe | Ön büro → Bütçe | `/butce/plan`, `/butce/gerceklesen`, `/butce/sapma` | `budget.view` | `budget.manage`, `budget.approve` |

Varsayılan rol dağılımı: **Müdür** ve **Muhasebe** rolleri bu alanların tamamını görür ve çoğunu yazar; ön büro yalnızca folyo faturası kesebilir; ayar türü işler (seri, entegratör, başlangıç günü, eşleme, parametre teyidi) müdüre ayrılmıştır. Otel, Ayarlar → Roller & İzinler matrisinden bu dağılımı değiştirebilir. Bir düğmeyi görmüyorsanız sebebi büyük olasılıkla izindir; gerçek denetim sunucudadır, menüde gizlemek yalnızca kolaylıktır.

## Faturalar (fatura kesme ve e-belge)

### Ne işe yarar

Fatura modülü kapanan folyoları, gerçekleşen etkinlikleri ve folyo dışı satışları (cariye serbest fatura) resmî faturaya çevirir, faturayı **e-Fatura** ya da **e-Arşiv** olarak entegratör üzerinden GİB'e gönderir ve durumunu izler. Fatura kesme (yol haritasındaki 16. modül) ile e-belge (49. modül) tek yerde kurulmuştur; ikisini ayrı düşünmeyin.

### Nerede bulunur

Yan menüde **Faturalar**. Dört sekme:

- **Faturalanacaklar** (`/faturalar/faturalanacaklar`): faturası kesilmemiş kapanmış folyolar ve faturaya hazır etkinlikler.
- **Taslaklar** (`/faturalar/taslaklar`): açılmış ama kesilmemiş faturalar.
- **Kesilenler** (`/faturalar/liste`): numarası verilmiş faturalar, GİB durumu, tekrar gönderme, iptal.
- **Ayarlar** (`/faturalar/ayarlar`): satıcı bilgileri, seriler, faturalama başlangıcı, entegratör, vergi kodu eşlemesi (yalnız `invoices.setup`).

Ayrıca folyo ekranında ve etkinlik dosyasında bir **Fatura kutusu** vardır: geçerli faturası (taslak ya da kesilmiş) varsa bağlantı ve durum; yoksa yetkiliye "Fatura taslağı aç" düğmesi. Fatura ekranının kendisi `/faturalar/:id` adresindedir.

### Temel kavramlar

| Kavram | Anlamı |
| --- | --- |
| **Kaynak** | Faturanın neye dayandığı: **folyo** (konaklama hesabı), **etkinlik** (banket / toplantı dosyası) ya da **serbest** (bir cariye folyo dışı satış: salon kirası, hizmet bedeli). |
| **Taslak** | Numarası henüz verilmemiş fatura. Alıcı bilgisi düzenlenir, satırlar (yalnız serbest fatura ve iptal bedeli faturasında) girilir. Silinebilir. |
| **Kesim** | Taslağa resmî numara verilmesi ve e-belgenin üretilmesi. Geri alınamaz; yanlışsa **iptal** edilir, yenisi kesilir. |
| **e-Fatura / e-Arşiv** | Alıcı GİB'e kayıtlı e-Fatura mükellefiyse belge **e-Fatura** olarak posta kutusuna gider; değilse **e-Arşiv** kesilir. Karar kesim anında mükellef sorgusuyla verilir; yabancı kişi ve yurt dışındaki şirket her zaman e-Arşiv'dir. |
| **Fatura numarası** | 3 karakterlik seri + yıl + 9 hane (örn. `DMF2026000000123`). Seri × yıl başına boşluksuz, sıralı ilerler. ETTN (belgenin evrensel kimliği) ayrıca üretilir. |
| **GİB durumu** | Kesilen faturanın e-belge yolculuğu: sırada → gönderiliyor → entegratörde → **tamamlandı** / **reddedildi** / **gönderilemedi**. |
| **Yasal süre** | Hizmetten sonra 7 gün (VUK 231/5). Faturalanacaklar listesi süresi yaklaşan ve geçen kayıtları rozetle gösterir. |
| **Faturalama başlangıcı** | Ayarlardaki tarih. Bu tarihten önce kapanan folyo / etkinlik "önceki sistemde faturalandı" sayılır, kuyruğa girmez. Ayar yokken kuyruk boştur ve ekran "Faturalama başlamadı" der. |
| **Fatura günü** | Otelin takvim günüdür, iş günü değil. Gün kapanışı gecikse de fatura gerçekten düzenlendiği günü taşır; numaralar tarih sırasını bozmaz. |

### Faturalanacaklar sekmesi

**Ne gösterir:** faturası olmayan kapanmış folyolar ve faturaya hazır (gerçekleşmiş ya da iptal bedeli kesinleşmiş) etkinlikler. Süzgeçler: kaynak türü, kapanış penceresi (7 gün – 1 yıl), **süresi geçenler**, arama (misafir / cari adı, oda, onay kodu).

**Adım adım tek fatura:**

1. Satırda **Taslak aç** deyin (ya da folyo ekranındaki fatura kutusundan).
2. Sistem satırları folyo kalemlerinden kurar: gelir grubu başına tek satır (geceler "Konaklama" satırında, hizmet dönemi açıklamada), iptaller düşülmüş, indirimler satır iskontosu olarak, vergiler kalemin işlendiği andaki dökümünden.
3. Alıcı varsayılanı: folyo bir cariye aktarıldıysa (acente / şirket ödemesi) o cari; değilse misafir. Adres ve kimlik bilgisi aynı alıcının **son faturasından** doldurulur.
4. Taslak ekranına geçersiniz (aşağıda).

**Dikkat:** klasik kullanımda bu sekmeyi elle açmanız bile gerekmez — folyo kapanınca folyo aktörü taslağı kendiliğinden açar (ayarlarda "otomatik taslak" açıksa). Bu sekme daha çok **gözden kaçanı** yakalamak için kullanılır: aktör kapalıyken kapanan folyolar, otomatik taslağı silinmiş kayıtlar, süresi geçmekte olanlar.

### Taslak ekranı ve kesim

Taslakta görülenler:

- **Alıcı formu:** tür seçimi — kişi (TC kimlik), şirket (vergi no + vergi dairesi), yabancı kişi (uyruk + pasaport; kimlik alanına GİB kuralıyla 11111111111 yazılır), yurt dışındaki şirket (kendi vergi numarası notta, kimliğe 2222222222). Ad / ünvan, adres, e-posta.
- **"Kesmeden önce" listesi:** eksikler (alıcı adı yok, vergi no sağlamasız, adres eksik, vergi kodu eşlenmemiş, faturalama başlangıcından önce…) tek tek yazılır. Liste boşalmadan **Kes** düğmesi çalışmaz.
- **Yasal süre** ve varsa başlangıç uyarısı.
- **Satırlar ve vergi dökümü:** folyo faturasında satırlar kaynaktan gelir, düzenlenmez; serbest fatura ve iptal bedeli faturasında satır eklenir / çıkarılır (birim tutar otelin vergi ayarıyla folyodaki formülle hesaplanır).

**Kes** dediğinizde arka planda tek işlemde şunlar olur:

1. Kaynak (folyo / etkinlik) **yeniden okunur**. Taslak açıldıktan sonra folyo değişmişse (yeniden açılıp kalem eklenmiş) taslak yenilenir ve kesim durur; ekran "kaynak değişti, kontrol edin" der.
2. Şirket alıcı için **mükellef sorgusu** yapılır (sonuç 24 saat önbellekte): kayıtlı + posta kutusu varsa e-Fatura, değilse e-Arşiv. Sorgu yapılamıyorsa kesim durur — belge türü bilinmeden numara verilmez.
3. Seri × yıl için **sıradaki numara** alınır (satır kilidiyle; aynı anda sekiz kesim bile boşluk bırakmaz).
4. **UBL-TR belgesi** üretilir ve içeriği özetle (SHA-256) dondurulur; GİB kuralları uygulanır: KDV (0015) ve konaklama vergisi (0059) KDV hariç bedel üzerinden, vergisiz satır %0 + 351 muafiyet kodu, karekod GİB kılavuzuna göre.
5. Fatura **gönderim sırasına** girer; `invoice.issued` olayı yayınlanır (muhasebe aktörü dinler).

Kesimden sonra ekranda **e-belge kutusu** (belge türü, ETTN, posta kutusu, son cevap), **zaman çizelgesi** (kim ne zaman ne yaptı), **PDF** ve **İptal iste** düğmesi görünür.

### Kesilenler sekmesi ve GİB durumu

Liste üstünde dört uyarı kutusu vardır ve her biri süzgeç olarak çalışır: **gönderilemedi**, **reddedildi**, **sonuç bekleniyor**, **iptal onayı bekliyor**. Süzgeçler: tarih, seri, belge türü, durum, alıcı araması.

Durumlar ve ne yapılacağı:

| Durum | Anlamı | Ne yapılır |
| --- | --- | --- |
| Sırada / gönderiliyor | Gönderici henüz göndermedi ya da gönderiyor | Bekleyin. 5 dakikadan uzun "gönderiliyor"da kalan kayıt kendiliğinden sıraya döner. |
| Entegratörde | Entegratör aldı, GİB sonucu bekleniyor | Bekleyin; durum gönderimden 30 sn sonra sorulmaya başlar, 7 güne kadar sorulur. |
| Tamamlandı | GİB kabul etti | İş bitti. |
| Reddedildi | Entegratör ya da GİB belgeyi reddetti (kalıcı hata; örn. alıcının posta kutusu yok) | Alıcıyı düzeltip **Tekrar gönder** (numarayı korur) ya da iptal edip yeni taslak açın. Yetkiliye zil düşer. |
| Gönderilemedi | Geçici hatalar (ağ, hız sınırı) tekrar denemeyle de aşılamadı | Entegratör bağlantısını kontrol edip **Tekrar gönder**. Yetkiliye zil düşer. |
| İptal onayı bekliyor | İptal isteği onay kuyruğunda | Gönderim durur; onay çıkınca iptal işlenir ya da gönderim sürer. |
| İptal edildi | Fatura iptal | Gerekirse **Yeni taslak** düğmesiyle aynı kaynaktan yeniden taslak açın. |

Geçici hata yeniden deneme aralıkları: 1 dk, 5 dk, 15 dk, 1 saat, 4 saat; sonra "gönderilemedi".

**PDF** otelin kendi kopyasıdır: kesilmiş faturada GİB karekodu, ETTN, senaryo ve tip; taslakta "TASLAK", iptalde "İPTAL", test ortamında "mali değeri yoktur" damgası. Resmî görüntü entegratörün ürettiğidir.

### Toplu fatura (iki adım)

Ay sonu yoğunluğu için faturalanacaklar ve taslaklar listeleri **iş kuyruğu** gibi çalışır:

1. **Faturalanacaklar** sekmesinde satırları işaretleyip **Seçilenlere taslak aç**. Alıcısı eksik taslaklar işaretlenir (çözülmesi gerekir).
2. **Taslaklar** sekmesinde alıcısı tamam olanları işaretleyip **Seçilenleri kes**. Her taslak tek kesimin bütün kurallarından geçer; numaralar taslakların açılış sırasıyla verilir.

Bir turda en fazla 100 kayıt alınır; istek 20 saniyelik bütçeyle durur, ekran ilerleme göstererek kalanla kendiliğinden devam eder. Bu yüzden yüzlerce faturayı tek tıkla başlatıp beklemek yeterlidir. Alıcısı eksik taslak kesilmez, listede "alıcı eksik" olarak kalır.

### Serbest fatura (cariye)

Folyo ya da etkinlikle ilgisi olmayan satışlar için (toplantı salonu kirası, komisyon dışı hizmet) **Kesilenler** sekmesindeki **Serbest fatura** düğmesi. Cari seçilir; alıcı carinin kartından gelir, taslakta düzenlenir; satırlar elle girilir. Kesilince **cariye vadeli alacak** yazılır (ön muhasebe); iptal edilince fatura tarihli ters kayıt düşer. Yetki `invoices.manage`.

### Fatura iptali

Fatura silinmez; **iptal edilir** ve iptal **dört göz** kuralına bağlıdır: isteyen `İptal iste` der (gerekçe zorunlu), onay kuyruğuna `Fatura iptali` türünde iş düşer, başka bir yetkili onaylar. Onay beklerken e-belge gönderimi durur. Onaylanınca:

- GİB'e ulaşmamış belge **yerelde** iptal edilir.
- e-Arşiv belgesi entegratör üzerinden iptal edilir.
- e-Fatura GİB portal referansıyla iptal edilir (referans ekranda istenir).

Muhasebe tarafında faturanın cari hareketteki bağı çözülür; serbest faturanın alacağı ters kayıtla düşer. İptal edilen faturanın kaynağından **Yeni taslak** açılabilir.

Önemli kural: **faturası kesilmiş folyo yeniden açılamaz.** Çıkışı geri almak, folyoya kalem eklemek için önce fatura iptal edilir. Taslağı olan folyo yeniden açılırsa taslak silinir; folyo yeniden kapanınca taslak yeniden açılır.

### e-Fatura / e-Arşiv entegrasyonunun gerçek durumu (dürüst not)

Bu konuda beklenti yönetimi önemlidir:

- Fatura, numara, UBL-TR belgesi, karekod, mükellef ayrımı, gönderim sırası, durum sorgusu, yeniden deneme, iptal akışları ve ekranlar **tamamdır ve testlidir**.
- Entegratör tarafında bir **adaptör sözleşmesi** ve **test entegratörü** vardır. Test ortamında "test mükellefleri" listesi (Ayarlar sekmesinde) ile e-Fatura / e-Arşiv ayrımı ve ret senaryoları denenir.
- **Gerçek bir özel entegratör adaptörü henüz yoktur.** Firma seçimi yapılmamıştır; canlı ortam gerçek adaptör yazılıp bağlanınca açılır. Yani bugün kesilen fatura GİB'e **fiilen gitmez**; test ortamında PDF'de "mali değeri yoktur" yazar. Ayarlar canlı ortam + test entegratörü birleşimine izin vermez.
- **e-Defter** (aylık yevmiye / kebir dosyası) yoktur; genel muhasebe (48) modülünden sonra planlanmıştır.
- **Döviz faturası** yoktur: otelin para birimi TRY değilse kesim durur.
- e-Arşiv faturanın alıcıya **e-posta ile gönderimi** entegratör adaptörüyle gelecektir.

### Ayarlar sekmesi

`/faturalar/ayarlar`, yalnız `invoices.setup`:

- **Satıcı:** otelin işletme ünvanı, VKN, vergi dairesi, adres. Girilmeden kesim yapılamaz.
- **Faturalama başlangıcı:** bugünden ileri olamaz; ileri alınırsa ekran aradaki kayıtların kuyruktan çıkacağını söyler.
- **Seriler:** e-Fatura ve e-Arşiv için ayrı 3 karakter seri.
- **Otomatik taslak:** folyo kapanınca taslak açılsın mı.
- **Entegratör ve ortam:** test / canlı (canlı yalnız gerçek adaptörle).
- **Vergi kodu eşlemesi:** otelin vergi satırları → GİB kodu (KDV 0015, konaklama vergisi 0059). Ad üzerinden öneri gelir, personel onaylar. Eşlenmemiş vergiyle kesim durur.
- **Test mükellefleri:** test ortamında hangi vergi numaraları e-Fatura kullanıcısı sayılacak.

### Arka planda otomatik olanlar

| Olay | Kim | Ne yapar |
| --- | --- | --- |
| Folyo kapandı | Folyo aktörü (billing-worker) | Faturalama başlangıcından sonraysa ve otomatik taslak açıksa taslak açar; alıcı folyo cariye aktarıldıysa cari, değilse misafir. |
| Fatura kesildi | e-belge göndericisi (sunucu içi zamanlanmış iş) | Sıradaki belgeleri üstlenir (4 eşzamanlı, tur başına 200), entegratöre gönderir, 30 sn sonra durum sormaya başlar. |
| Fatura kesildi | Muhasebe aktörü (accounting-worker) | Folyo / etkinlik faturasının **numarasını** alacağı doğuran cari harekete yazar (ikinci alacak açmaz); serbest faturayı cariye vadeli alacak olarak işler. |
| Fatura iptal edildi | Muhasebe aktörü | Bağı çözer; serbest faturanın alacağını ters kayıtla düşer. |
| Gönderilemedi / reddedildi | Gönderici | Fatura yetkilisine zil (uyarı türü "Fatura"). |

Folyo aktörü ya da muhasebe aktörü kapalıysa işleri **Görevler** ekranına düşer ("Folyo" ve "Ön muhasebe" modüllerinde); personel aynı işi fatura ekranından ya da Muhasebe → Eşitle ile yapar. Gönderici bir aktör değil sunucu işidir; kapatılmaz.

### Dikkat edilecekler ve sık hatalar

- **"Faturalama başlamadı"** görüyorsanız Ayarlar'da satıcı ve başlangıç günü girilmemiştir.
- **Kesim durdu: kaynak değişti.** Folyo taslaktan sonra yeniden açılmış. Taslak yenilenmiştir; satırları kontrol edip tekrar kesin.
- **Mükellef sorgusu yapılamadı.** Entegratör bağlantısı yok; test ortamında test mükellefleri listesini kontrol edin.
- **Vergi kodu eşlenmemiş.** Otele yeni vergi eklendiyse Ayarlar → vergi kodu eşlemesine kodunu girin.
- **Fatura kesildikten sonra folyo açılmıyor.** Doğru davranış; önce iptal.
- Folyo kalemleri vergi dökümü olmadan işlenmişse (eski veriler) kesim "vergi dökümü eksik" hatasıyla durur; kalem düzeltilmelidir.
- Faturanın tarihi takvim günüdür; **gece kapanışını geciktirmek fatura tarihini değiştirmez**.
- Yasal süre rozeti kırmızıya dönmüşse öncelik verin; sistem süreyi kendisi uzatamaz.

## Ön muhasebe (cariler, kasa / banka, çek / senet, fişler)

### Ne işe yarar

Ön muhasebe otelin **kimden alacağı, kime borcu olduğunu** (cariler), **parasının nerede durduğunu** (kasa ve banka hesapları), **çek ve senetlerin yolculuğunu** ve bunları değiştiren **fişleri** tutar. Genel muhasebe (hesap planı, yevmiye, mizan) **bu modülde yoktur**; 48. modül yol haritasındadır. Burada "borç / alacak" cari ve kasa dilidir, Tek Düzen hesap kodu yoktur.

Modülün ayırt edici özelliği: para hareketlerinin büyük kısmı **operasyondan kendiliğinden gelir**. Resepsiyonun aldığı ödeme, restoranın kapattığı adisyon, depoya giren mal, onaylanan acente primi, kesilen fatura, onaylanan bordro — hepsini **muhasebe aktörü** işler. Muhasebecinin elle girdiği fişler tahsilat / ödeme / virman / masraf gibi dış dünya hareketleridir.

### Nerede bulunur

Yan menüde **Ön muhasebe**. Sekmeler:

- **Cariler** (`/muhasebe/cariler`), cari kartı `/muhasebe/cariler/:id`
- **Yaşlandırma** (`/muhasebe/yaslandirma`)
- **Kasa / banka** (`/muhasebe/kasa-banka`)
- **Çek / senet** (`/muhasebe/cek-senet`)
- **Fişler** (`/muhasebe/fisler`), fiş ekranı `/muhasebe/fisler/:id`
- **Ayarlar** (`/muhasebe/ayarlar`)

### Temel kavramlar

| Kavram | Anlamı |
| --- | --- |
| **Cari** | Para alışverişi yaptığımız taraf: acente, tedarikçi, etkinlik müşterisi, şirket, şahıs, personel, SGK / vergi dairesi gibi kurumlar. Her carinin kodu, türü, vadesi ve bakiyesi vardır. |
| **Bakiye (B / A)** | Bakiye = borç − alacak. **(B)** cari bize borçlu (alacağımız var), **(A)** biz cariye borçluyuz. Cariler listesinin üstünde iki kutu: toplam alacağımız / toplam borcumuz. |
| **Kasa / banka hesabı** | Paranın durduğu yer. Kasa (nakit; döviz kasası olabilir) ya da banka (IBAN'lı). Her hesabın para birimi vardır ve hareket gördükten sonra değişmez. |
| **Yöntem eşlemesi** | Ön büro / etkinlik / restoran / spa tahsilatının ödeme yöntemi × para birimine göre hangi kasa / bankaya gireceği. Eşleme yoksa otomatik kayıt yazılamaz ve iş personele düşer. |
| **Fiş** | Tahsilat, ödeme, virman, kasa / banka giriş-çıkış ve açılış belgeleri. Her fişin numarası, tarihi, satırları vardır; iptali ters kayıtla olur. |
| **Başlangıç günü** | Muhasebenin "sistemde tutulmaya başladığı" gün. O günden (dahil) sonraki belgeler otomatik işlenir; öncesi **açılış bakiyesiyle** gelir. |
| **Açılış bakiyesi** | Başlangıç gününden bir gün önce tarihli, hesap başına tek kayıt: carinin devreden borcu / alacağı (vadesiyle), kasanın / bankanın devreden parası. |
| **Kaynak anahtarı** | Her otomatik kaydın dayandığı belgenin kimliği. Aynı belge iki kez işlense de ikinci kayıt açılmaz. |

### Cariler sekmesi ve cari kartı

**Cariler nereden gelir:**

- **Acente** ve **tedarikçi** carileri kartları açıldığında kendiliğinden açılır; ünvan, vergi ve iletişim bilgisi o karttan gelir ve kart değişince eşitlenir. Muhasebe yalnız vade, not ve kullanım alanını değiştirir.
- **Etkinlik müşterisi** carisi ilk etkinlik kaydında açılır.
- **Personel** carileri ilk bordro tahakkukunda açılır (ad / iletişim personel kartıyla eşitlenir). SGK, vergi dairesi, BES şirketi, icra / nafaka dosyası carileri de bordro tahakkukunda açılır.
- **Şirket / şahıs / diğer** cariler elle açılır (**Yeni cari**): ünvan, vergi no / TC kimlik, vergi dairesi, iletişim, vade, not.

**Liste:** tür, bakiye yönü ve durum süzgeci; sıralama; arama. Satıra tıklayınca kart.

**Cari kartı** (`/muhasebe/cariler/:id`):

- Bakiye ve **yaşlandırma** (bakiyenin vadeye göre dilimleri).
- **Açık çek / senetler** (bu cariden alınan / bu cariye verilen, henüz sonuçlanmamış).
- **Açılış** düğmesi (yoksa) ya da açılış bilgisi.
- **Ekstre:** dönem başı devir, belge günü sırasıyla hareketler, yürüyen bakiye, dönem toplamı; "daha fazla" ile sayfa sayfa. Her satırda kaynak (folyo ödemesi, mal kabul, fatura no, fiş no…) ve bağlantı.
- **Tahsilat fişi / Ödeme fişi** düğmeleri: fiş penceresi cari seçili açılır.

**Adım adım: acenteden havale geldi**

1. Cariler → acenteyi bulun → kart → **Tahsilat fişi**.
2. Tarih (iş günü), açıklama; satır: hesap = banka hesabı, tutar.
3. Kaydet. Cari alacaklanır (borcu düşer), banka hesabına giriş yazılır; ekstrede iki satır görünür.

### Yaşlandırma raporu

`/muhasebe/yaslandirma`: açık bakiyeler vadesine göre dilimlere ayrılır — **vadesi gelmemiş / 1–30 / 31–60 / 61–90 / 90+ gün**. Hesap **FIFO** mantığıyladır: en eski borç önce kapanmış sayılır, bakiye en yeni hareketlerde kalır. Yön süzgeci: alacaklarımız (bize borçlu cariler) ya da borçlarımız; tür süzgeci (acente, tedarikçi…). Gecikmesi en büyük cari üstte; dip satır süzgece göre toplam. Tahsilat takibinde haftalık bakılması gereken ekrandır.

### Kasa / banka sekmesi

`/muhasebe/kasa-banka`: üstte hesap kutuları (ad, tür, para birimi, bakiye), seçilen hesabın hareketleri altta (dönem başı devir, yürüyen bakiye, kaynak süzgeci: ön büro, etkinlik, restoran, spa, fiş, bordro…).

**Hesap tanımlama** (`accounting.setup`): **Yeni hesap** → kasa ya da banka, ad, para birimi, bankada IBAN (otel içinde tekil). Bakiyesi olan ya da eşlemede kullanılan hesap kullanımdan kaldırılamaz.

**Düğmeler:** **Giriş** (carisiz para girişi: banka faizi, bulunan para), **Çıkış** (masraf: kırtasiye, bahşiş avansı…), **Virman** (kasa → banka, banka → banka; aynı para biriminde). Hepsi fiştir, Fişler sekmesinde de görünür.

**Kural:** kasa **eksiye düşmez** — elle çıkış ve iptal kasada yeterli para yoksa reddedilir; banka eksiye düşebilir (kredili mevduat).

### Yöntem eşlemesi (ayarlar)

Ayarlar → **Tahsilat eşlemesi**: her kanal (ön büro, etkinlik, restoran, spa) × yöntem (nakit, kart, havale, döviz nakit…) × para birimi için hedef kasa / banka seçilir. Örnekler:

- Ön büro × nakit × TRY → "Resepsiyon kasası"
- Ön büro × kart × TRY → "POS bankası"
- Ön büro × nakit × EUR → "Euro kasası" (yoksa tutar otel parasına çevrilir ve kaynak döviz + kur hareket notunda saklanır)
- Restoran × nakit × TRY → "Restoran kasası"

Eşleme eksikse o yöntemle gelen tahsilat **otomatik işlenemez**: muhasebe aktörü işi "Ön muhasebe" manuel görevine düşürür. Eşlemeyi tamamlayıp **Eşitle** çalıştırınca birikenler işlenir.

### Çek / senet sekmesi

`/muhasebe/cek-senet`: alınan (portföy) ve verilen çek / senetler; durum, yön ve vade süzgeci; "vadesi geçmiş" ve "bu hafta vadesi gelen" özetleri. Çek **fişle doğar**: tahsilat fişinde "alınan çek" satırı, ödeme fişinde "verilen çek" satırı ya da **ciro** (portföydeki çeki tedarikçiye vermek).

Portföydeki çekin yolculuğu (satırdaki işlemler, her biri tarihlidir ve geçmişe yazılır):

- **Portföyde** → **Tahsile ver** (bankaya) → **Tahsil edildi** (banka hesabına giriş) ya da **Karşılıksız** (carinin borcu geri doğar) ya da **İade** (carinin borcu geri doğar).
- **Ciro edildi**: ciro edilen tedarikçiye borcumuz düşer; çek karşılıksız dönerse hem asıl carinin borcu geri doğar hem ciro edilene borcumuz geri doğar.
- Verilen çek: **Ödenecek** → **Ödendi** (bankadan çıkış) ya da **Karşılıksız**.

Kısıtlar: aynı çek iki fişte ciro edilemez; çek numarası (yön × tür × banka) iptal edilmemişlerde tekildir; tahsil edilmiş çekin fişi iptal edilemez.

### Fişler sekmesi

`/muhasebe/fisler`: tür, tarih, durum (işlendi / onay bekliyor / iptal), cari ve hesap süzgeci; fiş ekranı `/muhasebe/fisler/:id` (satırlar, karşı taraf, çekler, iz, iptal düğmesi).

Fiş türleri ve etkileri:

| Fiş | Cari etkisi | Para etkisi |
| --- | --- | --- |
| **Tahsilat** | Cari alacaklanır (bize borcu düşer) | Kasa / banka satırları giriş; alınan çek / senet portföye |
| **Ödeme** | Cari borçlanır (bizim borcumuz düşer) | Kasa / banka çıkış; verilen çek "ödenecek"; portföydeki çek **ciro** |
| **Virman** | — | Kaynak hesaptan çıkış, hedefe giriş (aynı para birimi) |
| **Giriş / Çıkış** | — | Carisiz hareket (masraf, faiz) |
| **Açılış** | Devir borcu / alacağı (vadesiyle) | Devir parası; başlangıç gününden bir gün önce tarihli, hesap başına tek |

**Fiş penceresi:** canlı toplam, birden fazla kasa / banka satırı, çek satırları (çek no, banka, vade, keşideci), ciro seçimi (portföyden). Satır toplamı karşı tarafla eşit olmalıdır.

**Dört göz:** ödeme fişinin toplamı ayarlardaki **eşiğe** eşit ya da üstündeyse fiş "onay bekliyor" yazılır, onay kuyruğuna `Ödeme fişi` türünde iş düşer; başka bir yetkili onaylar; onay anında kasanın yeterliliği **yeniden** denetlenir (bu arada kasa boşaldıysa onay reddedilir). Reddedilir / süresi dolarsa fiş hiç işlenmez.

**İptal** (`accounting.setup`): yalnız işlenmiş fişte, gerekçeyle, **fiş tarihli ters kayıt** ile. Fişin açtığı çek ilk durumunda olmalı (tahsile verilmiş / ciro edilmiş çekin fişi iptal edilemez). Kasa iptalle eksiye düşecekse iptal reddedilir.

### Otomatik kayıtlar: muhasebe aktörü neyi nasıl işler

Muhasebe aktörü (panelde "Muhasebe aktörü") şu olayları dinler ve **kaynak belgeyi okuyarak** kayıt yazar. Her kayıt kaynak anahtarıyla tekildir: aynı olay iki kez gelse, aktör sonradan açılıp olayı yeniden alsa da ikinci kayıt açılmaz.

| Ne oldu | Muhasebeye ne yazılır |
| --- | --- |
| Folyoya **ödeme** alındı (nakit / kart / havale / döviz) | Eşlemedeki kasaya / bankaya giriş. Döviz nakit: döviz kasası varsa oraya; yoksa otel parasına çevrilir, kaynak döviz ve kur notta. |
| Folyo **"Acente / cari"** ya da **voucher** ile kapatıldı | Para girmez; ödeme penceresinde seçilen cariye (varsayılan rezervasyonun acentesi) **borç** yazılır, vade = gün + carinin vadesi. Fatura kesilince numarası bu harekete bağlanır. |
| Folyo ödemesi **iade** edildi / **iptal** edildi | Kasadan / bankadan çıkış; iptal asıl satırın tersi. İade cariye yapılmışsa carinin alacağı. |
| **Etkinlik** tahsilatı | Eşlemedeki kasa / banka + etkinlik müşterisinin carisinden düşer. |
| Etkinlik **gerçekleşti** / **iptal bedeli** kesinleşti | Müşteri carisine bedel borç; **fark kaydıyla** eşitlenir (daha önce yazılmış toplam hedeften farklıysa yalnız fark yazılır). |
| **Restoran / oda servisi / spa** ödemesi | Restoran / spa eşlemesine göre kasa / banka. Onay bekleyen ya da reddedilen ödemenin muhasebe etkisi yoktur. |
| **Mal kabul** (satın alma) | Tedarikçi carisine **KDV dahil** borcumuz; vade = kabul günü + tedarikçi vadesi. |
| **Acente primi** onaylandı / ödendi / geri alındı | Acente carisine alacak; fark kaydıyla eşitlenir, geri alınan primde ters fark. |
| **Fatura kesildi** | Folyo / etkinlik faturası: numara mevcut cari harekete yazılır (ikinci alacak yok). Serbest fatura: cariye vadeli alacak. |
| **Fatura iptal** | Bağ çözülür; serbest faturanın alacağı fatura tarihli ters kayıt. |
| **Bordro onaylandı** | Ay sonu tarihli tahakkuk: personel carisine net ücret (avans mahsubu dahil), SGK carisine işçi + işveren payı − indirimler, vergi dairesine gelir + damga vergisi, BES şirketine katkılar, icra / nafaka dosyasına kesinti. |
| **Maaş ödendi** | Kasadan / bankadan tek çıkış; her personelin carisine borç (cari kapanır). |

Kurallar:

- **Başlangıç gününden önceki** belge işlenmez (açılış bakiyesiyle gelir). İptal kaydı, asıl satır işlenmişse işlenir.
- Eşleme yoksa ya da hesabın para birimi tutmuyorsa iş **anlamlı hatayla durur** ve "Ön muhasebe" manuel görevine düşer (bekleyip yeniden denemez; iş kuralı hatası beklemekle düzelmez).
- Her kayıt kaynak belgeden okunur, olayın gövdesinden değil — belge sonradan düzeltildiyse düzeltilmiş hâl yazılır.

### "Eşitle" ile tamamlama

Ayarlar → **Eksik kayıtları eşitle**: bir dönem seçilir, sistem o dönemdeki bütün belgeleri (ödemeler, mal kabuller, primler, etkinlik bedelleri, faturalar, bordrolar) tarar ve **henüz işlenmemiş** olanları aynı fonksiyonlarla işler. Kullanım yerleri:

- Aktör kapalıyken biriken işler.
- Eşleme eksikken düşen görevler: eşlemeyi tamamlayın, Eşitle'yi çalıştırın, görevleri "tamamlandı" işaretleyin.
- Canlıya alış: başlangıç gününden bugüne kadarki belgeler.

Eşitleme **20 saniye** çalışır, kalan belge sayısını kesin olarak söyler; yeniden çalıştırınca kaldığı yerden sürer. Aynı hata türü tek satırda sayılır. İşlenmiş belgeye bir şey yapmaz (kaynak anahtarı).

### Aktör kapalıyken

Aktör panelinden Muhasebe aktörü kapatılırsa hiçbir şey kaybolmaz: her olay **Görevler** ekranında "Ön muhasebe" modüllü bir görev olur ("Folyo tahsilatı muhasebeye işlenecek (kasa / banka ya da cari)", "Mal kabul tedarikçi carisine işlenecek", "Onaylanan bordro carilere tahakkuk ettirilecek"…). Muhasebeci sorunu (eşleme, cari) düzeltir, **Eşitle** ile dönemi işler ve görevleri kapatır. Aktör yeniden açılıp aynı olay gelse de kayıt ikinci kez yazılmaz.

### Ayarlar sekmesi

`/muhasebe/ayarlar`:

- **Başlangıç günü** (ilk muhasebe ekranı açıldığında otelin bugünü olarak kurulur; değiştirilebilir).
- **Ödeme fişi onay eşiği** (dört göz sınırı).
- **Tahsilat eşlemesi** (yukarıda).
- **Eksik kayıtları eşitle**.

Kasa / banka tanımları Kasa / banka sekmesindedir; cari seçici folyo ödeme penceresinde ön büroya da açıktır ("Acente / cari" ve voucher yönteminde cari seçmek için).

### Dikkat edilecekler ve sık hatalar

- **Kasa eksiye düşemez** uyarısı: elle çıkış ya da iptal kasadaki paradan büyük. Önce virmanla kasaya para aktarın ya da doğru kasayı seçin.
- **Eşleme yok** görevi: Ayarlar → Tahsilat eşlemesinde o kanal × yöntem × para birimi satırını doldurun, Eşitle çalıştırın.
- **Cari seçilmemiş**: resepsiyon "Acente / cari" yöntemiyle ödeme alırken cari seçmemiş. Ödeme penceresinde cari seçimi zorunludur; eski kayıt için muhasebeci görevi görür.
- **Açılış bakiyesi yanlış girildi**: açılış fişini iptal edip yenisini açın (hesap başına tek açılış).
- **Hesap türü / para birimi değişmiyor**: hareket görmüş hesabın türü ve para birimi değişmez; yeni hesap açın.
- **Genel muhasebe yok**: hesap planı, yevmiye fişi, mizan, gider hesapları (740 / 760 / 770) bu sürümde yoktur. Bordronun gider tarafı, amortisman fişi, dış muhasebe programına aktarım 48 ve sonrası (96) ile gelecektir. Muhasebe müşavirine veri göndermek için şimdilik ekstreler, Excel çıktıları ve bordro müşavir tablosu kullanılır.
- Bütçede **gider gerçekleşeni** elle girilir (Bütçe → Gerçekleşen); satın alma ve ön muhasebeden otomatik beslenmesi yol haritasındadır. Gelir, doluluk ve tahsilat gerçekleşeni sistemden gelir.

## Personel ve bordro

### Ne işe yarar

Personel kartları, aylık puantaj, ek ödeme / kesinti kalemleri, servis payı dağıtımı, bordro hesabı (brüt → net; SGK, gelir ve damga vergisi, istisnalar, teşvikler), dört gözlü onay, maaş ödemesi ve çıktılar (bordro listesi, pusula, departman icmali, banka dosyası, müşavir tablosu). Onaylanan bordro ön muhasebeye kendiliğinden düşer. İK tarafı (izin, vardiya, özlük belgesi) bu modülde **yoktur**; 52. modül yol haritasındadır.

### Nerede bulunur

- **Personel** (`/personel`): liste ve kart (`/personel/:id`).
- **Bordro** (`/bordro`): Bordrolar, Puantaj ve kalemler (`/bordro/puantaj`), Servis payı (`/bordro/servis-payi`), Ayarlar (`/bordro/ayarlar`); bordro ekranı `/bordro/:id`.

### Personel kartı

**Liste:** ad, sicil ya da T.C. kimlik no ile arama; departman ve durum (çalışan / çıkmış) süzgeci. **Ücret sütunu yalnız bordro görüntüleme izniyle gelir** (sunucu göndermez); kimlik numarası izne göre maskelidir.

**Yeni personel / düzenle** (`employees.manage`): kimlik (ad, T.C. kimlik, doğum), iş (sicil, departman, pozisyon, işe giriş, sektör / teşvik durumu, engellilik), **ücret** (`payroll.manage` ister): ücret türü **brüt ya da net anlaşmalı** (net anlaşmada sistem en küçük brütü ikili aramayla bulur), tutar, ödeme yöntemi (banka → IBAN / elden), BES.

Kart ekranındaki kutular (hepsi sözleşme şemasıyla doğrulanır, alan hataları alanın altında görünür):

- **Teşvikler:** çalışan bazında teşvik türü ve dönemi.
- **Avanslar:** tutar, taksit; avans ödendiği gün personel carisine borç yazılır, bordro onayında mahsup edilir.
- **İcra / nafaka:** dosya, tutar / oran, sıra; kesinti sırası BES → nafaka → icra (ilk dosya, netin dörtte biri) → avans → diğer.
- **Matrah devri:** yıl içinde başka işyerinden gelen personelin birikmiş gelir vergisi matrahı ve asgari ücret istisnası.
- **İşten çıkış:** tarih ve sebep seçilir, **önizleme** kıdem, ihbar (ya da ihbar kesintisi), kullanılmayan izin ücreti kalemlerini gösterir; kaydedince kalemler o ayın bordrosuna düşer. Geri alınabilir. Pencerede personelin **zimmetindeki demirbaşlar** uyarı olarak listelenir (engellemez; önce iade alınması hatırlatılır).

Kart değişikliği o aydan itibaren hesaplanmış açık bordroları **"yeniden hesaplanmalı"** işaretler.

### Puantaj ve kalemler

`/bordro/puantaj`: ay seçilir; personel başına **eksik gün** (SGK nedeniyle), **fiilen çalışılan gün** (yemek / yol istisnası için), **fazla çalışma saati**, **bayram** ve **hafta tatili** çalışması. Değişen satırlar birlikte kaydedilir (200 satıra kadar tek kayıt). Ay onaydaysa ya da onaylıysa sunucu reddeder ("ay kilitli").

Altında ayın **ek ödeme / kesinti kalemleri**: kalem (prim, ikramiye, yol, yemek, kesinti…), personel, tutar. Sistem kalemleri (ücret, fazla mesai, kıdem, servis payı…) elle girilmez; hesaptan, puantajdan, çıkıştan ve servis payından gelir.

### Servis payı

`/bordro/servis-payi`: ayın **havuzu** girilir; dağıtım **puan** ya da **eşit pay**, istenirse **çalışılan güne göre** ağırlıklı. Paylar ayın "Servis payı" kalemine yazılır; kuruş artığı en büyük paydan başlanarak dağıtılır, toplam havuza eşittir. Ay onaydaysa dağıtım değişmez.

### Bordro hesaplama, onay ve ödeme

**Bordrolar** (`/bordro`): ay ay aylık ve fark bordroları, durum (taslak / hesaplandı / onayda / onaylı / ödendi), toplamlar. **Bordro aç** ayın aylık bordrosunu (ya da onaylı ayın **fark bordrosunu**) açar.

**Bordro ekranı** (`/bordro/:id`) akışı:

1. **Hesapla.** Puantaj, kalemler, ücret, teşvik, matrah devri toplanır; saf hesap motoru 30 gün esasıyla hesaplar: prime esas kazanç taban–tavan arası, işçi SGK + işsizlik, gelir vergisi birikmiş matrah üzerinden dilimli, asgari ücret GV / DV istisnası, engellilik indirimi, yemek / yol istisnası, damga vergisi, işveren payları, 5510 Hazine indirimi ya da teşvik. Her personel satırında **hesap izi** açılır. Eşzamanlı ikinci hesap sırayı bekler.
2. Uyarıları okuyun: **yeniden hesaplanmalı** (girdi değişti), **parametre seti teyitsiz** (onaya gidemez), **önceki ay onaylanmamış** (yıl içi birikmiş matrah onaylı bordrolardan gelir; önceki aylar onaylanmadan bu ay hesaplanamaz / onaya gidemez).
3. **Onaya gönder.** Onay kuyruğuna `Bordro` türünde iş düşer; **hazırlayan onaylayamaz** (dört göz). Onayda **avans taksitleri ve icra / nafaka kesintileri kesinleşir** (hesap tekrarlanabilir, kesinti bir kez düşer). Reddedilirse bordro "hesaplandı"ya döner.
4. **Onaylı ay kilitlidir.** Puantaj, kalem, servis payı değişmez. Düzeltme **fark bordrosuyla**: ay onaylı girdi + yeni kalemlerle baştan hesaplanır, önceki onaylı tutarlar çıkarılır; fark eksi olabilir. Fark bordrosunda BES / avans / icra kesintisi yapılmaz.
5. **Öde** (`payroll.pay`): **banka** → banka hesabından çıkış + IBAN dosyası (Excel); **elden** → yalnız kasadan (kasa eksiye düşmez). Ödeme tarihi bugünü geçemez.

**Çıktılar:** bordro listesi PDF (bütün personel, toplamlı), personel pusulaları PDF (kişi başı bir sayfa; büyük otelde departman ya da sayfa sayfa), departman icmali, banka dosyası ve müşavir tablosu (Excel). Onaylanmamış bordronun her sayfasında **"TASLAK"** yazar.

### Ayarlar

`/bordro/ayarlar` (görmek `payroll.view`, değiştirmek `payroll.setup`):

- **İşyeri:** ünvan, SGK işyeri sicil, vergi dairesi, sektör (imalatta Hazine indirimi 5 puan). Canlıya alırken girilmesi şarttır.
- **Yasal parametre setleri:** FlexAI kataloğundan **hazır setleri yükle** (2026'nın üç seti: 1 Ocak; 17 Nisan yemek SGK istisnası; 1 Temmuz kıdem tavanı). Yüklenen set **"teyit edilmedi"** başlar; bir yetkili resmî kaynakla karşılaştırıp **Teyit ettim** demeden o setle hesaplanan bordro onaya gidemez. Onaylı ya da onaydaki bordronun seti değiştirilemez, teyidi kaldırılamaz. Mevzuat değişince ekranda "yeni hazır set var" görünür. Bir ay, **ayın son günü** yürürlükte olan setle hesaplanır.
- **Kalemler:** ödeme / kesinti kalemleri (sistem kalemleri silinmez).
- **Departmanlar.**

### Arka planda otomatik olanlar

| Olay | Kim | Ne yapar |
| --- | --- | --- |
| Bordro onaylandı | Muhasebe aktörü | Ay sonu tarihli tahakkuk: personel carisine net ücret (alacak), SGK, vergi dairesi, BES, icra / nafaka carilerine tutarlar. 250 kişilik parçalarla; büyük otelde kesilirse yeniden çağrıda kalan yazılır. |
| Maaş ödendi | Muhasebe aktörü | Kasadan / bankadan tek çıkış, her personelin carisine borç (cari kapanır). |
| Personel kartı değişti | Bordro dinleyicisi | Personel carisinin adı / iletişimi eşitlenir. |
| Avans ödendi | Bordro servisi | Personel carisine borç; onayda mahsup. |
| İşten çıkış kaydedildi | Bordro servisi | Kıdem / ihbar / izin kalemleri; demirbaş zimmet uyarısı (46). |

Bordronun **gider tarafı** (personel gideri, SGK işveren payı hesapları) genel muhasebe (48) ile gelecektir; şimdilik ön muhasebede yalnız cari tarafı vardır.

### Dikkat edilecekler ve sık hatalar

- **"Parametre seti teyit edilmedi"**: Ayarlar → parametre setinde Teyit ettim. Setler 2 Kasım 2026'da derlendi; Resmî Gazete / SGK / GİB metniyle karşılaştırmadan teyit etmeyin.
- **"Önceki ay onaylı değil"**: yılın önceki aylık bordrolarını sırayla onaylayın; yıl ortasında geçiş yapan otel matrah devri girer.
- **"Ay kilitli"**: onaylı ayı düzeltmek için fark bordrosu açın.
- **Elden ödeme kasadan düşmüyor**: elden ödeme yalnız kasadan yapılır, kasa yetersizse önce virman.
- Ücret, IBAN, avans, kesinti alanları yalnız `payroll.view` olana görünür; ön büro personel listesini görebilir ama ücreti göremez.
- İzin bakiyesi, vardiya çizelgesi, özlük belgesi bu sürümde yok (52). Puantaj elle girilir.

## Demirbaş ve amortisman

### Ne işe yarar

Otelin sabit kıymetleri (televizyon, klima, mobilya, mutfak ekipmanı…) **kodlu kart** olarak tutulur: nerede (oda ya da alan), kimde (zimmet), ne zaman kaça alındı, garantisi ne zaman bitiyor, yıl yıl amortismanı ve net değeri. QR etiket yazdırılır; sayımda etiket okutulur; VUK usulü yıllık doğrusal amortisman tablosu alınır; garantisi bitecekler için zil çalar.

### Nerede bulunur

**Demirbaş** menüsü: Demirbaşlar (`/demirbas`), Sayım (`/demirbas/sayim`, sayım ekranı `/demirbas/sayim/:id`), Amortisman (`/demirbas/amortisman`), Garanti (`/demirbas/garanti`), Tanımlar (`/demirbas/tanimlar`). Kart `/demirbas/:id`; etiketteki QR `/demirbas/k/DM-000123` adresine gider ve karta yönlendirir. Yalnız sayım yetkisi olan personel (etiket okutan) sadece Sayım sekmesini görür.

### Tanımlar (önce bunlar)

- **Kategoriler:** ad + varsayılan faydalı ömür (yıl). Ömür VUK oranına karşılık gelir; yeni karta kopyalanır, mevcut kartlar değişmez.
- **Alanlar:** oda dışı yerler (lobi, restoran, depo, çatı…). Adlar büyük / küçük harf duyarsız tekildir. Kullanımdaki demirbaşın durduğu alan kaldırılamaz (önce taşınır); kullanılan tanım silinmez, pasifleştirilir.

### Demirbaş kartı

**Liste:** kod / ad / seri no / marka / model araması (**QR bağlantısı da yapıştırılabilir**), durum, kategori, konum ve zimmet süzgeci; süzgeçteki kart sayısı ve toplam maliyet; seçilenlerin etiketi yazdırılır. **Net değer = maliyet − birikmiş amortisman.**

**Yeni kart** (`assets.manage`): kod otomatik `DM-000001` (kesintisiz sıra), ad, kategori (faydalı ömür kategoriden gelir, değiştirilebilir), marka / model / seri no, **yer tam olarak bir oda ya da bir alan**, zimmet (bordro personel kartından), alış tarihi ve tutarı, garanti bitişi. Alış yılı bu yıldan önceyse **açılış amortismanı** (sistemden önce ayrılmış tutar ve hangi yıla kadar) yazılır. Gelecek tarihli alış olamaz.

**Kart ekranı:** bilgiler, finansal özet, **yıl yıl amortisman tablosu** (açılış, kaydedilmiş, plan), hareket geçmişi (ekle-yalnız; yer ve zimmet o anki adlarıyla), işlemler:

- **Düzelt:** kaydedilmiş amortismanı olan kartın alış tarihi / tutarı / ömrü / açılışı **kilitlidir** (önce son yılın kaydı geri alınır).
- **Taşı:** yeni oda ya da alan, not.
- **Zimmetle / İade al:** personel seçimi.
- **Elden çıkar** (`assets.finance`): tarih, tür (satış / hurda / kayıp), satış bedeli. Çıkarıldığı yıl amortisman ayrılmaz; tarih kartın amortismanla kapanmış son yılından sonra olmalı. Net değer o anda dondurulur; satışta kâr / zarar ondan hesaplanır.
- **Etiket yazdır.**

### Excel ile toplu yükleme

Liste → **Excel'den yükle**: şablon indir → doldur (kategori adı, konum: oda no — "Oda 101" de olur — ya da alan adı, zimmet: sicil no, önceki yıllarda ayrılmış amortisman) → dosya seç → **önizleme** (sunucu her satırı doğrular, adları kayda çevirir, satır satır hata) → hatasızsa **yükle**. **Ya hep ya hiç:** tek hatalı satırda hiçbir kart açılmaz. Aynı yükleme ikinci kez gönderilirse yeni kart açılmaz. Sınır 1000 satır.

### QR etiket yazdırma

Etiket **QR + kod yazısı** içerir. İki biçim: **50 × 30 mm etiket yazıcısı** ya da **A4 3 × 8** (başlangıç konumu seçilir; yarı kullanılmış sayfa israf olmaz). Telefon kamerasıyla okutan personel giriş yapmışsa doğrudan kartı görür. 2D el okuyucusu sayımda okutur; **1D lazer okuyucu QR okuyamaz**.

### Sayım

`/demirbas/sayim`: açık sayımlar üstte. **Yeni sayım** kapsamı: tüm otel, bir alan ya da bir oda. Açılışta kapsamdaki kullanımdaki kartlar o anki yerleriyle **"beklenen"** olarak dondurulur — sayım sürerken taşınan kart listeyi kaydırmaz.

**Sayım ekranı** (`/demirbas/sayim/:id`, `assets.count`):

1. Sayımcı **"şu an buradayım"** diye oda / alan seçer.
2. Etiketleri okutur: el okuyucusu klavye gibi yazar; kamera düğmesi tarayıcı destekliyorsa (Chrome / Android) arka kamerayı açar; kod elle de yazılabilir. QR bağlantısı da kod da kabul edilir.
3. Her okutma sonuç verir: **yerinde**, **başka yerde** (beklenen yer farklı), **fazla** (kapsam dışı kart), **tekrar** (zaten okutuldu), **elden çıkarılmış**, **bilinmeyen kod**. Son üçü hata değil sonuçtur.
4. Birden çok sayımcı aynı anda okutur; aynı etiketi ilk okutan kazanır.
5. **Kapat** (`assets.manage`): başka yerde ya da kapsam dışında bulunanlar istenirse **bulunduğu yere taşınır** (hareket geçmişine sayım numarasıyla). **Eksikler kendiliğinden düşmez** — elden çıkarma ayrı ve yetkili işlemdir. **İptal** hiçbir şeye dokunmaz.

### Amortisman (VUK, yıllık doğrusal)

`/demirbas/amortisman`: yıl seçilir; yıl içinde defterde olan her kart için yıl başı birikmiş, **yılın payı**, yıl sonu birikmiş ve net değer; kategori özeti ve genel toplam; **aylık pay** (yıllık / 12 — aylık raporlar için); Excel'e aktar.

Kurallar (kullanıcı kararı):

- **Alındığı yıl tam yıl** amortisman ayrılır; **elden çıkarıldığı yıl ayrılmaz**.
- Yılın payı = kalan net değer / ömrün kalan yılı (son yıl kalanın tamamı). Yolunda giden kartta maliyet / ömür; açılışla gelen kartta kalan değer kalan yıllara yayılır.
- **Yıl kaydı** (`assets.finance`, "Kaydet"): yıllar **ardışık** kaydedilir (ilk kayıt geçmiş ya da bu yıl; gelecek yıl kaydedilemez). Kaydedilen yıl **kilitlidir**: kartların finansal alanları değişmez, o yıla ya da öncesine elden çıkarma yazılamaz.
- **Geri al:** yalnız **son yıl**; o kayıttan sonra elden çıkarılan kart varsa alınamaz (dondurulan net değer o kaydı içerir).

**Muhasebe fişi yoktur** (genel muhasebe 48 yok); amortisman ve elden çıkarma kâr / zararı tabloda görülür. Azalan bakiyeler usulü yoktur.

### Garanti

`/demirbas/garanti`: seçilen pencerede garantisi bitecek kullanımdaki demirbaşlar (en yakın önce) ya da son bir yılda bitmişler. **Garanti zili:** 6 saatte bir çalışan iş, garantisi 30 gün içinde bitecek kartı yakalar ve `assets.manage` iznine zil düşürür (bağlantı garanti listesine). Kart ve bitiş tarihi başına **bir kez**; garanti uzatılırsa yeniden; aynı günün kartları tek zilde.

### Arka planda otomatik olanlar

| Ne | Kim | Nasıl |
| --- | --- | --- |
| Garanti uyarısı | Sunucu zamanlanmış işi (6 saat) | Pencereye giren kartlar için tek zil |
| Zimmet uyarısı | Bordro işten çıkış penceresi | Personelin zimmetindeki kullanımdaki demirbaşlar listelenir, engellemez |
| Kart / sayım / amortisman değişti | Canlı yayın kanalı | Açık ekranlar tazelenir; sürüm hatasında kayıt yeniden okunur |

Demirbaş modülünde aktör yoktur; satın almadan otomatik kart açılması (satın alma yalnız stok kalemi taşır) ve zimmet tutanağı PDF'i bilinçli olarak sonraya bırakılmıştır.

### Dikkat edilecekler ve sık hatalar

- **"Finansal alanlar kilitli"**: kartın kaydedilmiş amortismanı var. Amortisman sekmesinden son yılı geri alın, düzeltin, yeniden kaydedin.
- **"Elden çıkarma tarihi kapanmış yıla düşüyor"**: tarih kaydedilmiş son yıldan sonra olmalı.
- **"Gelecek yıl kaydedilemez" / "Yıllar ardışık"**: 2025'i kaydetmeden 2026 kaydedilmez.
- **Sayımda eksik görünen kart** yerinde değilse önce aranır; gerçekten yoksa yetkili **elden çıkar (kayıp)** yapar. Sayım kapanışı bunu yapmaz.
- **Kamera düğmesi yok**: tarayıcı QR okumayı desteklemiyor (Safari / iOS'ta yok). El okuyucusu ya da elle yazma kullanılır.
- **Excel yüklemesi geçmedi**: tek satır hatası bütün dosyayı durdurur; önizlemedeki satır hatalarını düzeltip yeniden yükleyin. Kategori / alan / sicil adları tanımlarla birebir eşleşmelidir.
- Lazer barkod okuyucu QR okumaz; 2D okuyucu ya da telefon gerekir.

## Bölüm sonu: sık sorulanlar

**Fatura GİB'e gerçekten gidiyor mu?** Hayır, henüz değil. Akış ve belge hazır; gerçek entegratör adaptörü bağlanınca canlı ortam açılır. Şimdilik test ortamı.

**Misafir çıkış yaptı, taslak açılmadı.** Üç sebep: faturalama başlangıcından önce kapanmış folyo (kuyruğa girmez), "otomatik taslak" kapalı, folyo aktörü kapalı (Görevler'de "Folyo" görevi vardır). Faturalanacaklar sekmesinden elle açın.

**Ödeme alındı ama cari / kasaya düşmedi.** Muhasebe aktörü kapalı ya da eşleme eksik; Görevler'de "Ön muhasebe" görevine bakın, eşlemeyi tamamlayın, Eşitle çalıştırın.

**Resepsiyon muhasebe ekranını görüyor mu?** Varsayılanda hayır; yalnız folyo ödemesinde cari seçicisini kullanır.

**Bordroyu kim onaylar?** Onay kuyruğunda `approvals.decide` yetkisi olan ve bordroyu **hazırlamamış** biri.

**Amortisman fişi nereye gidiyor?** Hiçbir yere; genel muhasebe gelince yevmiye fişi üretilecek. Tabloyu Excel'e alıp müşavire verin.

**Demirbaş etiketini hangi cihaz okur?** Telefon kamerası (Chrome / Android), 2D el okuyucu. 1D lazer okuyucu okumaz.
